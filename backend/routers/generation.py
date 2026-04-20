"""전체 생성 및 SSE 진행률 스트리밍.

각 씬을 voice→image→video 3단계로 돌리고 최종 concat.
이미 산출물이 있고 stale 이 아니면 해당 단계를 스킵.
"""

import json
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..database import get_session
from ..models import Character, GenerationStatus, Project, Scene, SceneType
from ..services import comfyui_client as comfy
from ..services import ffmpeg_utils as ffmpeg
from ..services.workflow_patcher import (
    build_multi_ref_prompt,
    patch_image,
    patch_video_effect,
    patch_video_lipsync,
    patch_video_loop,
    patch_voice,
)


def _scene_character_list(scene: Scene, characters: dict[str, Character]) -> list[Character]:
    """scene.character_ids_json 우선, 없으면 A/B 폴백. 결과는 Character 객체 리스트."""
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
            for i, scene in enumerate(scenes):
                chars = _scene_character_list(scene, characters)
                char = chars[0] if chars else None  # 립싱크 화자(첫번째)

                # 1) 음성 (립싱크만)
                if scene.type == SceneType.lipsync:
                    if not scene.voice_path or scene.clip_stale:
                        yield emit("voice", i, f"[{i+1}/{total}] 음성 생성 중...")
                        if not scene.dialogue:
                            raise RuntimeError(f"씬 #{i+1}: 대사가 비어 있음")
                        await comfy.free_memory()
                        wf = patch_voice(
                            dialogue=scene.dialogue,
                            voice_sample=char.voice_sample_path if char else None,
                            tts_engine=scene.tts_engine.value,
                            voice_design_text=char.voice_design if char else None,
                        )
                        out = await comfy.run_workflow(wf, kind="audio")
                        staged = _stage_into_input(out, f"scene_voice_{scene.id}")
                        scene.voice_path = staged
                        session.add(scene)
                        session.commit()

                # 2) 이미지 — Qwen Edit / SDXL / VNCCS 중 선택
                if not scene.image_path or scene.clip_stale:
                    yield emit("image", i, f"[{i+1}/{total}] 이미지 생성 중...")
                    char_descs = [(c.name, c.description or "") for c in chars]
                    prompt = build_multi_ref_prompt(char_descs, scene.bg_prompt or "")
                    character_refs = [
                        {
                            "name": c.name,
                            "description": c.description or "",
                            # 스프라이트 > 시트 > 단일 이미지 순으로 우선 선택
                            "image_path": c.sprite_path or c.sheet_path or c.image_path,
                        }
                        for c in chars
                        if (c.sprite_path or c.sheet_path or c.image_path)
                    ]
                    if prompt or character_refs:
                        await comfy.free_memory()
                        wf = patch_image(
                            prompt=prompt,
                            character_refs=character_refs,
                            workflow=scene.image_workflow,
                            resolution=(scene.resolution_w, scene.resolution_h),
                            params=_parse_json(scene.image_params),
                        )
                        out = await comfy.run_workflow(wf, kind="image")
                        staged = _stage_into_input(out, f"scene_image_{scene.id}")
                        scene.image_path = staged
                        session.add(scene)
                        session.commit()

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
                            params=video_params,
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
                            params=video_params,
                        )
                    else:
                        raise RuntimeError(f"알 수 없는 씬 타입: {scene.type}")

                    out = await comfy.run_workflow(wf, kind="video")
                    dest = OUTPUT_DIR / f"scene_{scene.id}{out.suffix}"
                    shutil.copy(out, dest)
                    scene.clip_path = str(dest)
                    scene.clip_stale = False
                    session.add(scene)
                    session.commit()

                clips.append(Path(scene.clip_path))
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
