import json
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlmodel import Session, select

from ..database import get_session
from ..models import Character, Project, Scene, SceneCreate, SceneRead, SceneType
from ..services import comfyui_client as comfy
from ..services.workflow_patcher import (
    build_multi_ref_prompt,
    patch_image,
    patch_video_effect,
    patch_video_lipsync,
    patch_video_loop,
    patch_voice,
)


def _scene_characters(s: Scene, session: Session) -> list[Character]:
    """scene.character_ids_json 우선. 폴백: character_id + character_b_id."""
    ids: list[str] = []
    if s.character_ids_json:
        try:
            arr = json.loads(s.character_ids_json)
            if isinstance(arr, list):
                ids = [str(x) for x in arr if x]
        except json.JSONDecodeError:
            pass
    if not ids:
        if s.character_id:
            ids.append(s.character_id)
        if s.character_b_id:
            ids.append(s.character_b_id)
    out: list[Character] = []
    for cid in ids:
        c = session.get(Character, cid)
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

router = APIRouter(prefix="/projects/{project_id}/scenes", tags=["scenes"])

# ComfyUI/input 은 LoadImage/LoadAudio 의 기준 디렉터리.
# 생성한 산출물을 여기에 드롭해 다음 단계가 바로 참조할 수 있게 한다.
_COMFY_INPUT = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "input"
_COMFY_INPUT.mkdir(parents=True, exist_ok=True)

OUTPUT_DIR = Path("output")
OUTPUT_DIR.mkdir(exist_ok=True)


def _check_project(project_id: str, session: Session):
    if not session.get(Project, project_id):
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")


def _get_scene(project_id: str, scene_id: str, session: Session) -> Scene:
    s = session.get(Scene, scene_id)
    if not s or s.project_id != project_id:
        raise HTTPException(404, "씬을 찾을 수 없습니다.")
    return s


@router.get("", response_model=list[SceneRead])
def list_scenes(project_id: str, session: Session = Depends(get_session)):
    return session.exec(
        select(Scene).where(Scene.project_id == project_id).order_by(Scene.order)
    ).all()


@router.post("", response_model=SceneRead, status_code=201)
def create_scene(
    project_id: str,
    data: SceneCreate,
    session: Session = Depends(get_session),
):
    _check_project(project_id, session)
    scene = Scene(project_id=project_id, **data.model_dump())
    session.add(scene)
    session.commit()
    session.refresh(scene)
    return scene


@router.put("/{scene_id}", response_model=SceneRead)
def update_scene(
    project_id: str,
    scene_id: str,
    data: SceneCreate,
    session: Session = Depends(get_session),
):
    s = _get_scene(project_id, scene_id, session)
    for k, v in data.model_dump().items():
        setattr(s, k, v)
    s.clip_stale = True
    session.add(s)
    session.commit()
    session.refresh(s)
    return s


@router.delete("/{scene_id}", status_code=204)
def delete_scene(project_id: str, scene_id: str, session: Session = Depends(get_session)):
    s = _get_scene(project_id, scene_id, session)
    session.delete(s)
    session.commit()


@router.post("/reorder", status_code=204)
def reorder_scenes(
    project_id: str,
    body: dict,
    session: Session = Depends(get_session),
):
    ids: list[str] = body.get("order", [])
    for i, scene_id in enumerate(ids):
        s = session.get(Scene, scene_id)
        if s and s.project_id == project_id:
            s.order = i
            session.add(s)
    session.commit()


@router.post("/{scene_id}/image/upload", response_model=SceneRead)
def upload_scene_image(
    project_id: str,
    scene_id: str,
    file: UploadFile,
    session: Session = Depends(get_session),
):
    s = _get_scene(project_id, scene_id, session)
    suffix = Path(file.filename or "img.png").suffix or ".png"
    dst_name = f"scene_image_{scene_id}{suffix}"
    with open(_COMFY_INPUT / dst_name, "wb") as f:
        f.write(file.file.read())
    s.image_path = dst_name
    s.clip_stale = True
    session.add(s)
    session.commit()
    session.refresh(s)
    return s


# ── 단계별 재생성 엔드포인트 ──────────────────────────────────────────────

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


@router.post("/{scene_id}/regenerate/voice", response_model=SceneRead)
async def regenerate_voice(
    project_id: str, scene_id: str, session: Session = Depends(get_session)
):
    s = _get_scene(project_id, scene_id, session)
    if s.type != SceneType.lipsync:
        raise HTTPException(400, "립싱크 씬에서만 음성 재생성이 가능합니다.")
    if not s.dialogue:
        raise HTTPException(400, "대사가 비어 있습니다.")

    chars = _scene_characters(s, session)
    character = chars[0] if chars else None

    wf = patch_voice(
        dialogue=s.dialogue,
        voice_sample=character.voice_sample_path if character else None,
        tts_engine=s.tts_engine.value,
        voice_design_text=character.voice_design if character else None,
    )
    out = await comfy.run_workflow(wf, kind="audio")
    staged = _stage_into_input(out, f"scene_voice_{scene_id}")

    s.voice_path = staged
    s.clip_stale = True
    session.add(s)
    session.commit()
    session.refresh(s)
    return s


@router.post("/{scene_id}/regenerate/image", response_model=SceneRead)
async def regenerate_image(
    project_id: str, scene_id: str, session: Session = Depends(get_session)
):
    s = _get_scene(project_id, scene_id, session)
    chars = _scene_characters(s, session)

    char_descs = [(c.name, c.description or "") for c in chars]
    prompt = build_multi_ref_prompt(char_descs, s.bg_prompt or "")
    character_refs = [
        {
            "name": c.name,
            "description": c.description or "",
            "image_path": c.sprite_path or c.sheet_path or c.image_path,
        }
        for c in chars
        if (c.sprite_path or c.sheet_path or c.image_path)
    ]

    if not prompt and not character_refs:
        raise HTTPException(400, "배경 프롬프트나 캐릭터가 필요합니다.")

    wf = patch_image(
        prompt=prompt,
        character_refs=character_refs,
        workflow=s.image_workflow,
        resolution=(s.resolution_w, s.resolution_h),
        params=_parse_json(s.image_params),
    )
    out = await comfy.run_workflow(wf, kind="image")
    staged = _stage_into_input(out, f"scene_image_{scene_id}")

    s.image_path = staged
    s.clip_stale = True
    session.add(s)
    session.commit()
    session.refresh(s)
    return s


@router.post("/{scene_id}/regenerate/video", response_model=SceneRead)
async def regenerate_video(
    project_id: str, scene_id: str, session: Session = Depends(get_session)
):
    s = _get_scene(project_id, scene_id, session)
    chars = _scene_characters(s, session)
    character = chars[0] if chars else None
    image_path = s.image_path or (character.image_path if character else None)
    video_params = _parse_json(s.video_params)

    if s.type == SceneType.lipsync:
        if not s.voice_path:
            raise HTTPException(400, "먼저 음성을 생성하세요.")
        if not image_path:
            raise HTTPException(400, "먼저 이미지를 생성하거나 캐릭터 이미지를 설정하세요.")
        wf = patch_video_lipsync(
            image_path=image_path,
            voice_path=s.voice_path,
            bg_prompt=s.bg_prompt or "",
            sfx_prompt=s.sfx_prompt or "ambient indoor sounds",
            diffusion_model=s.diffusion_model,
            params=video_params,
        )
    elif s.type == SceneType.loop:
        if not image_path:
            raise HTTPException(400, "루프 씬은 기준 이미지가 필요합니다.")
        wf = patch_video_loop(
            image_path=image_path,
            bg_prompt=s.bg_prompt or "",
            sfx_prompt=s.sfx_prompt or "ambient indoor sounds",
            loras=_parse_loras(s.loras_json),
            diffusion_model=s.diffusion_model,
            params=video_params,
        )
    elif s.type == SceneType.effect:
        if not image_path:
            raise HTTPException(400, "이펙트는 기반 이미지가 필요합니다.")
        wf = patch_video_effect(
            image_path=image_path,
            effect_prompt=s.effect_prompt or "",
            sfx_prompt=s.sfx_prompt or "impact whoosh",
            loras=_parse_loras(s.loras_json),
            diffusion_model=s.diffusion_model,
            params=video_params,
        )
    else:
        raise HTTPException(400, f"알 수 없는 씬 타입: {s.type}")

    out = await comfy.run_workflow(wf, kind="video")
    dest = OUTPUT_DIR / f"scene_{scene_id}{out.suffix}"
    shutil.copy(out, dest)

    s.clip_path = str(dest)
    s.clip_stale = False
    session.add(s)
    session.commit()
    session.refresh(s)
    return s
