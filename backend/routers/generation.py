"""전체 생성 및 SSE 진행률 스트리밍.

각 씬을 voice→image→video 3단계로 돌리고 최종 concat.
이미 산출물이 있고 stale 이 아니면 해당 단계를 스킵.
"""

import json
import shutil
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..database import get_session
from ..models import Character, GenerationStatus, Project, Scene, SceneType
from ..services import comfyui_client as comfy
from ..services import ffmpeg_utils as ffmpeg
from ..services.scene_policy import compose_scene_image_prompts
from ..services.workflow_patcher import (
    build_multi_ref_prompt,
    find_video_output_targets,
    patch_image,
    patch_video_basic,
    patch_video_effect,
    patch_video_lipsync,
    patch_video_loop,
    patch_voice,
)


def _scene_character_list(scene: Scene, characters: dict[str, Character]) -> list[Character]:
    """Return selected scene characters, keeping old A/B columns readable."""
    ids: list[str] = []
    if scene.character_ids_json:
        try:
            parsed = json.loads(scene.character_ids_json)
            if isinstance(parsed, list):
                ids = [str(x) for x in parsed if x]
        except json.JSONDecodeError:
            pass
    if not ids:
        if scene.character_id:
            ids.append(scene.character_id)
        if scene.character_b_id:
            ids.append(scene.character_b_id)
    out: list[Character] = []
    for cid in ids:
        c = characters.get(cid)
        if c:
            out.append(c)
    return out


def _parse_json(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}

OUTPUT_DIR = Path("output")
VOICES_DIR = Path("voices")
UPLOADS_DIR = Path("uploads")
for d in (OUTPUT_DIR, VOICES_DIR, UPLOADS_DIR):
    d.mkdir(exist_ok=True)

_COMFY_INPUT = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "input"
_COMFY_INPUT.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/projects/{project_id}/generate", tags=["generation"])


class SubtitleStyle(BaseModel):
    font_size: int = Field(default=34, ge=16, le=72)
    margin_v: int = Field(default=34, ge=0, le=240)
    outline: float = Field(default=2.4, ge=0, le=8)
    shadow: float = Field(default=0.0, ge=0, le=8)


class EditOverlay(BaseModel):
    # 식별
    id: str | None = None
    # 종류
    kind: Literal["title", "caption", "sticker", "shape", "image"] = "caption"
    text: str = Field(default="", max_length=600)
    image_url: str | None = None
    scene_index: int = Field(default=0, ge=0)
    start: float = Field(default=0.0, ge=0.0, le=3600.0)
    duration: float = Field(default=3.0, ge=0.25, le=600.0)
    # M5 위치/스타일
    x: float | None = None
    y: float | None = None
    width: float | None = None
    height: float | None = None
    rotation: float | None = None
    font_family: str | None = None
    font_size: int | None = None
    font_weight: int | None = None
    color: str | None = None
    shadow: str | None = None
    outline: str | None = None
    outline_width: float | None = None
    background: str | None = None
    padding: int | None = None
    animation_in: Literal["none", "fade", "slide_up", "slide_left", "scale"] | None = None
    animation_out: Literal["none", "fade", "slide_down", "slide_right", "scale"] | None = None
    animation_duration: float | None = None


class EditRenderRequest(BaseModel):
    transition_style: Literal["cut", "soft", "fade", "dip_to_black", "flash"] = "cut"
    transition_sec: float = Field(default=0.0, ge=0.0, le=3.0)
    fps: int = Field(default=30, ge=12, le=60)
    width: int | None = Field(default=None, ge=320, le=3840)
    height: int | None = Field(default=None, ge=240, le=2160)
    audio_sample_rate: int = Field(default=48000, ge=8000, le=192000)
    target_lufs: float | None = Field(default=None, ge=-40, le=-8)
    loudness_range_lu: float | None = Field(default=None, ge=1, le=30)
    color_preset: Literal["reference_soft", "warm_room", "clean_neutral", "dream_blush"] = "reference_soft"
    grain_strength: int = Field(default=2, ge=0, le=12)
    vignette_strength: float = Field(default=7.0, ge=0.0, le=20.0)
    subtitle_style: SubtitleStyle = Field(default_factory=SubtitleStyle)
    overlays: list[EditOverlay] = Field(default_factory=list)
    # M4 BGM 옵션
    bgm_volume: float = Field(default=0.5, ge=0.0, le=4.0)
    bgm_loop: bool = True
    bgm_fade_in: float = Field(default=0.0, ge=0.0, le=30.0)
    bgm_fade_out: float = Field(default=0.0, ge=0.0, le=30.0)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stage_into_input(src: Path, prefix: str) -> str:
    """ComfyUI/output 산출물을 input/ 에 고유 파일명으로 복사하고 파일명 반환."""
    dst_name = f"{prefix}{src.suffix}"
    shutil.copy(src, _COMFY_INPUT / dst_name)
    return dst_name


def _parse_loras(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        arr = json.loads(raw)
        return arr if isinstance(arr, list) else []
    except json.JSONDecodeError:
        return []


def _stage_previous_last_frame(scene: Scene, previous_clip_path: Path | None) -> str:
    if previous_clip_path is None:
        raise RuntimeError(f"씬 #{scene.order + 1}: 첫 씬 또는 이전 영상이 없는 상태에서는 이전 라스트프레임을 사용할 수 없습니다.")
    if not previous_clip_path.exists():
        raise RuntimeError(f"씬 #{scene.order + 1}: 이전 씬 영상 파일을 찾을 수 없습니다: {previous_clip_path}")

    extracted = OUTPUT_DIR / f"scene_{scene.id}_previous_last_frame.png"
    ffmpeg.extract_last_frame(previous_clip_path, extracted)
    return _stage_into_input(extracted, f"scene_prev_last_{scene.id}")


def _transition_to_ffmpeg(style: str) -> str:
    return {
        "cut": "cut",
        "soft": "fade",
        "fade": "fade",
        "dip_to_black": "fadeblack",
        "flash": "fadefast",
    }.get(style, "cut")


def _clip_paths_for_project(project_id: str, session: Session) -> tuple[list[Scene], list[Path]]:
    scenes: list[Scene] = session.exec(
        select(Scene).where(Scene.project_id == project_id).order_by(Scene.order)
    ).all()
    if not scenes:
        raise HTTPException(400, "장면이 없습니다.")
    missing = [str(i + 1) for i, scene in enumerate(scenes) if not scene.clip_path or scene.clip_stale]
    if missing:
        raise HTTPException(400, f"아직 렌더할 수 없는 씬이 있습니다: {', '.join(missing)}")
    clips = [Path(scene.clip_path or "") for scene in scenes]
    missing_files = [str(path) for path in clips if not path.exists()]
    if missing_files:
        raise HTTPException(400, f"씬 비디오 파일을 찾을 수 없습니다: {', '.join(missing_files)}")
    return scenes, clips


@router.post("")
async def start_generation(
    project_id: str,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404)

    scenes: list[Scene] = session.exec(
        select(Scene).where(Scene.project_id == project_id).order_by(Scene.order)
    ).all()
    if not scenes:
        raise HTTPException(400, "장면이 없습니다.")

    characters: dict[str, Character] = {
        c.id: c
        for c in session.exec(
            select(Character).where(Character.project_id == project_id)
        ).all()
    }

    project.status = GenerationStatus.running
    session.add(project)
    session.commit()

    async def stream():
        clips: list[Path] = []
        total = len(scenes)

        def emit(stage: str, i: int, message: str, extra: dict | None = None):
            payload = {
                "type": "progress",
                "stage": stage,
                "scene_index": i,
                "total": total,
                "message": message,
            }
            if extra:
                payload.update(extra)
            return _sse(payload)

        try:
            previous_clip_path: Path | None = None
            previous_scene_image_path: str | None = None
            for i, scene in enumerate(scenes):
                chars = _scene_character_list(scene, characters)
                char = chars[0] if chars else None  # 립싱크 화자(첫번째)

                # 1) 음성: lipsync는 입모양 구동용, 나머지는 voiceover/mix 트랙용.
                if scene.dialogue:
                    if not scene.voice_path or scene.clip_stale:
                        yield emit("voice", i, f"[{i+1}/{total}] 음성 생성 중...")
                        await comfy.free_memory()
                        wf = patch_voice(
                            dialogue=scene.dialogue,
                            voice_sample=char.voice_sample_path if char else None,
                            tts_engine=scene.tts_engine.value,
                            voice_design_text=char.voice_design if char else None,
                            output_prefix=f"projects/{project_id}/scenes/{scene.id}/voice",
                        )
                        out = await comfy.run_workflow(wf, kind="audio")
                        staged = _stage_into_input(out, f"scene_voice_{scene.id}")
                        scene.voice_path = staged
                        session.add(scene)
                        session.commit()

                # 2) 이미지 — Qwen Edit / SDXL / VNCCS 중 선택
                if not scene.image_path or scene.clip_stale:
                    frame_source_mode = scene.frame_source_mode or "new_scene"
                    if frame_source_mode == "previous_last_frame":
                        yield emit("image", i, f"[{i+1}/{total}] 이전 씬 라스트프레임 추출 중...")
                        scene.image_path = _stage_previous_last_frame(scene, previous_clip_path)
                        scene.clip_stale = True
                        session.add(scene)
                        session.commit()
                    else:
                        yield emit("image", i, f"[{i+1}/{total}] 이미지 생성 중...")
                        image_params = _parse_json(scene.image_params)
                        char_descs = [(c.name, c.description or "") for c in chars]
                        prompt, negative_prompt = compose_scene_image_prompts(
                            build_multi_ref_prompt(char_descs, scene.bg_prompt or ""),
                            image_params,
                        )
                        character_refs = [
                            {
                                "name": c.name,
                                "description": c.description or "",
                                "image_path": c.sprite_path,
                            }
                            for c in chars
                            if c.sprite_path
                        ]
                        image_workflow = (scene.image_workflow or "qwen_edit").lower()
                        if image_workflow == "qwen_edit":
                            missing = [c.name for c in chars if not c.sprite_path]
                            if missing:
                                raise RuntimeError(f"씬 #{i+1}: Qwen Edit 장면 이미지는 선택된 모든 캐릭터의 스프라이트가 필요합니다: {', '.join(missing)}")
                            if not character_refs:
                                raise RuntimeError(f"씬 #{i+1}: Qwen Edit 장면 이미지는 캐릭터 스프라이트 레퍼런스가 필요합니다. 배경 전용 이미지는 SDXL을 명시 선택하세요.")
                        if prompt or character_refs:
                            await comfy.free_memory()
                            wf = patch_image(
                                prompt=prompt,
                                character_refs=character_refs,
                                visual_refs=(
                                    [previous_scene_image_path]
                                    if previous_scene_image_path and image_params.get("continuity_reference") is not False
                                    else None
                                ),
                                workflow=image_workflow,
                                resolution=(scene.resolution_w, scene.resolution_h),
                                params=image_params,
                                negative_prompt=negative_prompt,
                                output_prefix=f"projects/{project_id}/scenes/{scene.id}/image",
                            )
                            out = await comfy.run_workflow(wf, kind="image")
                            staged = _stage_into_input(out, f"scene_image_{scene.id}")
                            scene.image_path = staged
                            session.add(scene)
                            session.commit()
                if scene.image_path:
                    previous_scene_image_path = scene.image_path

                # 3) 비디오
                if not scene.clip_path or scene.clip_stale:
                    yield emit("video", i, f"[{i+1}/{total}] 영상 생성 중...")
                    await comfy.free_memory()
                    image_path = scene.image_path or (char.image_path if char else None)
                    video_params = _parse_json(scene.video_params)

                    if scene.type == SceneType.lipsync:
                        if not (scene.voice_path and image_path):
                            raise RuntimeError(f"씬 #{i+1}: 음성/이미지 없음")
                        wf = patch_video_lipsync(
                            image_path=image_path,
                            voice_path=scene.voice_path,
                            bg_prompt=scene.bg_prompt or "",
                            sfx_prompt=scene.sfx_prompt or "ambient",
                            diffusion_model=scene.diffusion_model,
                            params=video_params,
                            output_prefix=f"projects/{project_id}/scenes/{scene.id}/video",
                        )
                    elif scene.type == SceneType.basic:
                        if not image_path:
                            raise RuntimeError(f"씬 #{i+1}: 기본 영상 기준 이미지 없음")
                        wf = patch_video_basic(
                            image_path=image_path,
                            bg_prompt=scene.bg_prompt or "",
                            sfx_prompt=scene.sfx_prompt or "ambient",
                            loras=_parse_loras(scene.loras_json),
                            diffusion_model=scene.diffusion_model,
                            params={
                                **video_params,
                                **({"voice_path": scene.voice_path} if scene.voice_path else {}),
                            },
                            output_prefix=f"projects/{project_id}/scenes/{scene.id}/video",
                        )
                    elif scene.type == SceneType.loop:
                        if not image_path:
                            raise RuntimeError(f"씬 #{i+1}: 루프 기준 이미지 없음")
                        wf = patch_video_loop(
                            image_path=image_path,
                            bg_prompt=scene.bg_prompt or "",
                            sfx_prompt=scene.sfx_prompt or "ambient",
                            loras=_parse_loras(scene.loras_json),
                            diffusion_model=scene.diffusion_model,
                            params={
                                **video_params,
                                **({"voice_path": scene.voice_path} if scene.voice_path else {}),
                            },
                            output_prefix=f"projects/{project_id}/scenes/{scene.id}/video",
                        )
                    elif scene.type == SceneType.effect:
                        if not image_path:
                            raise RuntimeError(f"씬 #{i+1}: 이펙트 기반 이미지 없음")
                        wf = patch_video_effect(
                            image_path=image_path,
                            effect_prompt=scene.effect_prompt or "",
                            sfx_prompt=scene.sfx_prompt or "impact",
                            loras=_parse_loras(scene.loras_json),
                            diffusion_model=scene.diffusion_model,
                            params={
                                **video_params,
                                **({"voice_path": scene.voice_path} if scene.voice_path else {}),
                            },
                            output_prefix=f"projects/{project_id}/scenes/{scene.id}/video",
                        )
                    else:
                        raise RuntimeError(f"알 수 없는 씬 타입: {scene.type}")

                    out = await comfy.run_workflow(wf, kind="video", execution_targets=find_video_output_targets(wf) or None)
                    dest = OUTPUT_DIR / f"scene_{scene.id}{out.suffix}"
                    shutil.copy(out, dest)
                    scene.clip_path = str(dest)
                    scene.clip_stale = False
                    session.add(scene)
                    session.commit()

                clips.append(Path(scene.clip_path))
                previous_clip_path = Path(scene.clip_path)
                yield _sse({"type": "scene_done", "scene_index": i, "total": total,
                             "clip_path": scene.clip_path})

            # 최종 합성
            if len(clips) > 1:
                yield emit("concat", total, "최종 합성 중...")
                final = ffmpeg.concat(clips, project_id=project_id)
            else:
                final = clips[0]

            project.status = GenerationStatus.completed
            project.output_path = str(final)
            session.add(project)
            session.commit()
            yield _sse({"type": "complete", "output_path": str(final)})

        except Exception as e:
            project.status = GenerationStatus.failed
            session.add(project)
            session.commit()
            yield _sse({"type": "error", "message": str(e)})

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/cancel", status_code=204)
async def cancel_generation(project_id: str, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404)
    await comfy.interrupt()
    project.status = GenerationStatus.idle
    session.add(project)
    session.commit()


@router.post("/render_edit")
def render_edit(
    project_id: str,
    payload: EditRenderRequest,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404)

    scenes, clips = _clip_paths_for_project(project_id, session)

    # ── M6 Step 1: per-clip pre-processing ────────────────────────────
    # Apply trim / speed / volume / per-clip color overlay to each scene's
    # source clip. If a scene has no overrides, prepare_clip returns the
    # original path (no re-encode).
    work_dir = OUTPUT_DIR / f"{project_id}_edit_work"
    prepared: list[Path] = [
        ffmpeg.prepare_clip(
            src=clip,
            work_dir=work_dir,
            scene_id=scene.id,
            clip_in_offset_sec=scene.clip_in_offset_sec,
            clip_out_offset_sec=scene.clip_out_offset_sec,
            clip_speed=scene.clip_speed,
            clip_voice_volume=scene.clip_voice_volume,
            clip_sfx_volume=scene.clip_sfx_volume,
            clip_color_overlay=scene.clip_color_overlay,
        )
        for scene, clip in zip(scenes, clips)
    ]

    # ── M6 Step 2: per-boundary transitions ────────────────────────────
    # Build a (style, sec) tuple for each boundary. Outgoing scene's
    # `out_transition_*` overrides the global default.
    boundaries: list[tuple[str, float]] = []
    for i in range(len(scenes) - 1):
        cur = scenes[i]
        style = cur.out_transition_style or payload.transition_style
        sec = cur.out_transition_sec if cur.out_transition_sec is not None else payload.transition_sec
        boundaries.append((_transition_to_ffmpeg(style), float(sec or 0.0)))

    rough = ffmpeg.concat(
        prepared,
        transition=_transition_to_ffmpeg(payload.transition_style),
        duration_frames=0 if payload.transition_sec <= 0 else max(1, round(payload.transition_sec * payload.fps)),
        fps=payload.fps,
        project_id=f"{project_id}_edit_rough",
        audio_sample_rate=payload.audio_sample_rate,
        transitions=boundaries if boundaries else None,
    )

    first_w, first_h = ffmpeg.get_video_size(prepared[0])
    width = payload.width or first_w
    height = payload.height or first_h

    # ── M6 Step 3: finish (color grade / vignette / grain / subtitles + overlays) ──
    final = ffmpeg.finish_visual_novel_episode(
        rough,
        output=OUTPUT_DIR / f"{project_id}_edit.mp4",
        subtitles=[scene.dialogue or "" for scene in scenes],
        scene_durations=[ffmpeg.get_duration(path) for path in prepared],
        transition_sec=payload.transition_sec,
        width=width,
        height=height,
        audio_sample_rate=payload.audio_sample_rate,
        target_lufs=payload.target_lufs,
        loudness_range_lu=payload.loudness_range_lu,
        color_preset=payload.color_preset,
        grain_strength=payload.grain_strength,
        vignette_strength=payload.vignette_strength,
        overlays=[overlay.model_dump() for overlay in payload.overlays],
        subtitle_style=payload.subtitle_style.model_dump(),
        boundary_secs=[sec for _, sec in boundaries] if boundaries else None,
    )

    # ── M6 Step 4: BGM (if project has one) ────────────────────────────
    if project.bgm_path and Path(project.bgm_path).exists():
        bgm_final = OUTPUT_DIR / f"{project_id}_edit_bgm.mp4"
        final = ffmpeg.add_bgm_track(
            final,
            Path(project.bgm_path),
            output=bgm_final,
            main_duration_sec=ffmpeg.get_duration(final),
            bgm_volume=payload.bgm_volume,
            fade_in=payload.bgm_fade_in,
            fade_out=payload.bgm_fade_out,
            loop=payload.bgm_loop,
        )

    project.output_path = str(final)
    project.status = GenerationStatus.completed
    session.add(project)
    session.commit()
    return {"output_path": str(final)}


@router.post("/render_edit/stream")
async def render_edit_stream(
    project_id: str,
    payload: EditRenderRequest,
    session: Session = Depends(get_session),
):
    """SSE-streamed variant of render_edit. Emits progress events for each
    of the 4 ffmpeg steps so the frontend can show a real progress bar
    instead of a spinner.

    Event shapes:
      data: {"type": "status", "stage": "<id>", "message": "...", "progress_pct": 0..100}
      data: {"type": "complete", "output_path": "..."}
      data: {"type": "error", "message": "..."}
    """
    import asyncio
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404)

    scenes, clips = _clip_paths_for_project(project_id, session)

    async def stream():
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        def emit(stage: str, message: str, pct: int):
            payload = {"type": "status", "stage": stage, "message": message, "progress_pct": pct}
            asyncio.get_event_loop().call_soon_threadsafe(
                queue.put_nowait, _sse(payload)
            )

        async def worker():
            try:
                # Step 1: per-clip pre-processing.
                emit("prepare", f"클립 전처리 시작 (씬 {len(scenes)}개)", 5)
                work_dir = OUTPUT_DIR / f"{project_id}_edit_work"
                prepared: list[Path] = []
                for i, (scene, clip) in enumerate(zip(scenes, clips)):
                    emit("prepare", f"씬 #{i + 1} 전처리 (트림/속도/색감)", 5 + int(20 * (i + 1) / max(1, len(scenes))))
                    prepared.append(
                        await asyncio.to_thread(
                            ffmpeg.prepare_clip,
                            src=clip,
                            work_dir=work_dir,
                            scene_id=scene.id,
                            clip_in_offset_sec=scene.clip_in_offset_sec,
                            clip_out_offset_sec=scene.clip_out_offset_sec,
                            clip_speed=scene.clip_speed,
                            clip_voice_volume=scene.clip_voice_volume,
                            clip_sfx_volume=scene.clip_sfx_volume,
                            clip_color_overlay=scene.clip_color_overlay,
                        )
                    )

                # Step 2: per-boundary transitions + concat.
                emit("concat", "트랜지션 + concat 합성 중", 30)
                boundaries: list[tuple[str, float]] = []
                for i in range(len(scenes) - 1):
                    cur = scenes[i]
                    style = cur.out_transition_style or payload.transition_style
                    sec = cur.out_transition_sec if cur.out_transition_sec is not None else payload.transition_sec
                    boundaries.append((_transition_to_ffmpeg(style), float(sec or 0.0)))

                rough = await asyncio.to_thread(
                    ffmpeg.concat,
                    prepared,
                    transition=_transition_to_ffmpeg(payload.transition_style),
                    duration_frames=0 if payload.transition_sec <= 0 else max(1, round(payload.transition_sec * payload.fps)),
                    fps=payload.fps,
                    project_id=f"{project_id}_edit_rough",
                    audio_sample_rate=payload.audio_sample_rate,
                    transitions=boundaries if boundaries else None,
                )
                emit("concat", "트랜지션 + concat 완료", 55)

                first_w, first_h = await asyncio.to_thread(ffmpeg.get_video_size, prepared[0])
                width = payload.width or first_w
                height = payload.height or first_h

                # Step 3: finish.
                emit("finish", "색감 + 자막 + 오버레이 적용 중", 60)
                durations = [await asyncio.to_thread(ffmpeg.get_duration, p) for p in prepared]
                final = await asyncio.to_thread(
                    ffmpeg.finish_visual_novel_episode,
                    rough,
                    output=OUTPUT_DIR / f"{project_id}_edit.mp4",
                    subtitles=[scene.dialogue or "" for scene in scenes],
                    scene_durations=durations,
                    transition_sec=payload.transition_sec,
                    width=width,
                    height=height,
                    audio_sample_rate=payload.audio_sample_rate,
                    target_lufs=payload.target_lufs,
                    loudness_range_lu=payload.loudness_range_lu,
                    color_preset=payload.color_preset,
                    grain_strength=payload.grain_strength,
                    vignette_strength=payload.vignette_strength,
                    overlays=[overlay.model_dump() for overlay in payload.overlays],
                    subtitle_style=payload.subtitle_style.model_dump(),
                    boundary_secs=[sec for _, sec in boundaries] if boundaries else None,
                )
                emit("finish", "색감 + 자막 + 오버레이 완료", 85)

                # Step 4: BGM.
                if project.bgm_path and Path(project.bgm_path).exists():
                    emit("bgm", "BGM 트랙 믹싱", 90)
                    bgm_final = OUTPUT_DIR / f"{project_id}_edit_bgm.mp4"
                    final_dur = await asyncio.to_thread(ffmpeg.get_duration, final)
                    final = await asyncio.to_thread(
                        ffmpeg.add_bgm_track,
                        final,
                        Path(project.bgm_path),
                        output=bgm_final,
                        main_duration_sec=final_dur,
                        bgm_volume=payload.bgm_volume,
                        fade_in=payload.bgm_fade_in,
                        fade_out=payload.bgm_fade_out,
                        loop=payload.bgm_loop,
                    )
                    emit("bgm", "BGM 믹싱 완료", 98)
                else:
                    emit("bgm", "BGM 없음 — 스킵", 95)

                project.output_path = str(final)
                project.status = GenerationStatus.completed
                session.add(project)
                session.commit()
                emit("complete", "최종 편집본 렌더 완료", 100)
                await queue.put(_sse({"type": "complete", "output_path": str(final)}))
            except Exception as exc:
                await queue.put(_sse({"type": "error", "message": str(exc)}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(worker())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream")
