import asyncio
import json
import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..database import get_session
from ..models import Character, CharacterCreate, CharacterRead, TTSEngine
from ..services.comfyui_client import ensure_nodes_available, run_workflow
from ..services.model_catalog import (
    CHARACTER_IMAGE_REQUIRED_MODEL_PATHS,
)
from ..services.scene_policy import compose_scene_image_prompts
from ..services.workflow_patcher import (
    build_multi_ref_prompt,
    find_output_targets,
    patch_image,
    patch_character_sheet,
    patch_character_sprite_existing,
    patch_voice_design,
)

UPLOAD_DIR = Path("uploads")
VOICES_DIR = Path("voices")
MODELS_DIR = Path(__file__).resolve().parents[2] / "ComfyUI" / "models"
UPLOAD_DIR.mkdir(exist_ok=True)
VOICES_DIR.mkdir(exist_ok=True)

router = APIRouter(prefix="/projects/{project_id}/characters", tags=["characters"])
logger = logging.getLogger("myaniform.characters")
_CHAR_IMAGE_REQUIRED_NODES = [
    "CheckpointLoaderSimple",
    "CLIPTextEncode",
    "EmptyLatentImage",
    "KSampler",
    "KSamplerAdvanced",
    "VAEDecode",
    "SaveImage",
    "LoraLoader",
    "LoadImage",
    "CLIPLoader",
    "VAELoader",
    "UnetLoaderGGUF",
    "TextEncodeQwenImageEditPlus",
    "EmptyQwenImageLayeredLatentImage",
    "UltralyticsDetectorProvider",
    "SAMLoader",
    "FaceDetailer",
]
_CHAR_IMAGE_REQUIRED_MODELS = [
    MODELS_DIR / model_path for model_path in CHARACTER_IMAGE_REQUIRED_MODEL_PATHS
]


def _parse_json(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _get_char(project_id: str, char_id: str, session: Session) -> Character:
    c = session.get(Character, char_id)
    if not c or c.project_id != project_id:
        raise HTTPException(404, "캐릭터를 찾을 수 없습니다.")
    return c


def _character_workflow_fields(char: Character) -> dict:
    return {
        "background_color": char.background_color,
        "aesthetics": char.aesthetics,
        "nsfw": char.nsfw,
        "sex": char.sex,
        "age": char.age,
        "race": char.race,
        "eyes": char.eyes,
        "hair": char.hair,
        "face": char.face,
        "body": char.body,
        "skin_color": char.skin_color,
        "lora_prompt": char.lora_prompt,
    }


def _ensure_char_image_models(context: str) -> None:
    missing = [str(path.relative_to(MODELS_DIR)) for path in _CHAR_IMAGE_REQUIRED_MODELS if not path.exists()]
    if missing:
        raise HTTPException(
            400,
            f"{context}에 필요한 ComfyUI 모델 파일이 없습니다: {', '.join(missing)}",
        )


def _build_sprite_workflow(char: Character, project_id: str, char_id: str, mode: str) -> tuple[dict, list[str] | None]:
    """Build the exact VN Step1/Step1.1 sprite workflow selected by the UI."""
    selected_mode = mode.lower()
    if selected_mode not in {"auto", "new", "reference"}:
        raise HTTPException(400, "sprite mode는 auto, new, reference 중 하나여야 합니다.")

    output_prefix = f"projects/{project_id}/characters/{char_id}/sprite"
    common = {
        "negative_prompt": char.negative_prompt,
        "resolution": (char.resolution_w, char.resolution_h),
        "params": _parse_json(char.sprite_params),
        "character_fields": _character_workflow_fields(char),
        "output_prefix": output_prefix,
    }

    if selected_mode == "new":
        wf = patch_character_sheet(char.name, char.description or "", **common)
        return wf, find_output_targets(wf, title_contains="sheet") or find_output_targets(wf)

    reference_image_path = char.image_path if selected_mode == "reference" else (char.image_path or char.sprite_path)
    if reference_image_path:
        wf = patch_character_sprite_existing(
            character_name=char.name,
            description=char.description or "",
            reference_image_path=reference_image_path,
            **common,
        )
        return wf, find_output_targets(wf, title_contains="refined faces character sheet") or find_output_targets(wf)

    if selected_mode == "reference":
        raise HTTPException(400, "참조 이미지 기반 스프라이트 생성에는 먼저 참조 이미지를 업로드해야 합니다.")

    wf = patch_character_sheet(char.name, char.description or "", **common)
    return wf, find_output_targets(wf, title_contains="sheet") or find_output_targets(wf)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _character_event(
    stage: str,
    message: str,
    *,
    progress_pct: int | None = None,
    node: str | None = None,
    prompt_id: str | None = None,
) -> dict:
    payload = {
        "type": "status",
        "stage": stage,
        "message": message,
    }
    if progress_pct is not None:
        payload["progress_pct"] = progress_pct
    if node:
        payload["node"] = node
    if prompt_id:
        payload["prompt_id"] = prompt_id
    return payload


async def _run_character_workflow_stream(
    *,
    char: Character,
    workflow: dict,
    kind: str,
    execution_targets: list[str] | None,
    success_message: str,
    persist,
    session: Session,
):
    async def stream():
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        logger.info("[%s] %s 시작", char.id, success_message)
        await queue.put(_sse(_character_event("preparing", "워크플로우 준비 중...", progress_pct=2)))

        async def worker():
            try:
                async def on_event(event: dict):
                    etype = event.get("type")
                    prompt_id = event.get("prompt_id")
                    node = event.get("node")
                    if etype == "queued":
                        logger.info("[%s] queued prompt_id=%s kind=%s", char.id, prompt_id, kind)
                        payload = _character_event(
                            "queued",
                            f"작업이 큐에 등록됐습니다. prompt_id={prompt_id}",
                            progress_pct=5,
                            prompt_id=prompt_id,
                        )
                    elif etype == "executing":
                        message = f"노드 실행 중: {node}" if node else "실행 중..."
                        logger.info("[%s] executing node=%s", char.id, node)
                        payload = _character_event(
                            "running",
                            message,
                            progress_pct=10,
                            node=node,
                            prompt_id=prompt_id,
                        )
                    elif etype == "progress":
                        pct = event.get("progress_pct")
                        value = event.get("value")
                        total = event.get("max")
                        message = f"생성 중... {value}/{total}"
                        if node:
                            message += f" · node {node}"
                        logger.info("[%s] progress %s/%s node=%s", char.id, value, total, node)
                        payload = _character_event(
                            "running",
                            message,
                            progress_pct=pct if isinstance(pct, int) else None,
                            node=node,
                            prompt_id=prompt_id,
                        )
                    elif etype == "output_ready":
                        logger.info("[%s] output ready path=%s", char.id, event.get("path"))
                        payload = _character_event("saving", "출력 파일 저장 중...", progress_pct=96)
                    elif etype == "freed":
                        logger.info("[%s] memory freed", char.id)
                        payload = _character_event("saving", "메모리 정리 중...", progress_pct=99)
                    else:
                        return
                    await queue.put(_sse(payload))

                output = await run_workflow(
                    workflow,
                    kind=kind,
                    execution_targets=execution_targets,
                    on_event=on_event,
                )
                updated = persist(output)
                session.add(updated)
                session.commit()
                session.refresh(updated)
                logger.info("[%s] %s 완료", char.id, success_message)
                await queue.put(_sse(_character_event("complete", success_message, progress_pct=100)))
                await queue.put(
                    _sse(
                        {
                            "type": "complete",
                            "character": CharacterRead.model_validate(updated).model_dump(mode="json"),
                        }
                    )
                )
            except Exception as exc:
                logger.exception("[%s] %s 실패: %s", char.id, success_message, exc)
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


@router.get("", response_model=list[CharacterRead])
def list_characters(project_id: str, session: Session = Depends(get_session)):
    return session.exec(
        select(Character).where(Character.project_id == project_id)
    ).all()


@router.post("", response_model=CharacterRead, status_code=201)
def create_character(
    project_id: str,
    data: CharacterCreate,
    session: Session = Depends(get_session),
):
    char = Character(project_id=project_id, **data.model_dump())
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


@router.get("/{char_id}", response_model=CharacterRead)
def get_character(project_id: str, char_id: str, session: Session = Depends(get_session)):
    return _get_char(project_id, char_id, session)


@router.patch("/{char_id}", response_model=CharacterRead)
def update_character(
    project_id: str,
    char_id: str,
    data: dict,
    session: Session = Depends(get_session),
):
    char = _get_char(project_id, char_id, session)
    for k, v in data.items():
        if hasattr(char, k):
            setattr(char, k, v)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


@router.delete("/{char_id}", status_code=204)
def delete_character(project_id: str, char_id: str, session: Session = Depends(get_session)):
    char = _get_char(project_id, char_id, session)
    session.delete(char)
    session.commit()


# ── 스프라이트 참조 이미지 업로드 ─────────────────────────────────────────

@router.post("/{char_id}/reference/upload", response_model=CharacterRead)
async def upload_reference_image(
    project_id: str,
    char_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    """VN Step1.1 스프라이트 복제 생성에 사용할 참조 이미지를 업로드한다."""
    char = _get_char(project_id, char_id, session)
    ext = Path(file.filename).suffix or ".png"
    dest = UPLOAD_DIR / f"{char_id}{ext}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    char.image_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


@router.post("/{char_id}/sprite/upload", response_model=CharacterRead)
async def upload_sprite(
    project_id: str,
    char_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    """외부 편집(포토샵/클립스튜디오 등)으로 리터칭한 스프라이트를 업로드해 AI 생성본을 교체한다."""
    char = _get_char(project_id, char_id, session)
    dest = UPLOAD_DIR / f"{char_id}_sprite.png"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    char.sprite_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


@router.post("/{char_id}/image/upload", response_model=CharacterRead)
async def upload_character_image(
    project_id: str,
    char_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    """씬 프리뷰(캐릭터 단독 컷)의 AI 결과를 외부 편집본으로 교체한다."""
    char = _get_char(project_id, char_id, session)
    dest = UPLOAD_DIR / f"{char_id}_generated.png"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    char.image_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


# ── 이미지 AI 생성 ────────────────────────────────────────────────────────

@router.post("/{char_id}/image/generate", response_model=CharacterRead)
async def generate_image(
    project_id: str,
    char_id: str,
    session: Session = Depends(get_session),
):
    char = _get_char(project_id, char_id, session)
    if not char.description:
        raise HTTPException(400, "description이 없습니다. 캐릭터 설명을 먼저 입력하세요.")
    if not char.sprite_path:
        raise HTTPException(400, "캐릭터 이미지는 먼저 캐릭터 스프라이트를 생성한 뒤 만들 수 있습니다.")
    await ensure_nodes_available(_CHAR_IMAGE_REQUIRED_NODES, context="캐릭터 이미지 생성")
    _ensure_char_image_models("캐릭터 이미지 생성")

    image_params = _parse_json(char.image_params)
    base_prompt = build_multi_ref_prompt([(char.name, char.description or "")], "")
    prompt, scene_negative = compose_scene_image_prompts(base_prompt, image_params)
    negative_prompt = scene_negative or char.negative_prompt
    wf = patch_image(
        prompt=prompt,
        character_refs=[{
            "name": char.name,
            "description": char.description or "",
            "image_path": char.sprite_path,
        }],
        workflow="qwen_edit",
        negative_prompt=negative_prompt,
        resolution=(char.resolution_w, char.resolution_h),
        params=image_params,
        output_prefix=f"projects/{project_id}/characters/{char_id}/image",
    )
    output_targets = find_output_targets(wf)
    output = await run_workflow(wf, kind="image", execution_targets=output_targets)

    dest = UPLOAD_DIR / f"{char_id}_generated.png"
    shutil.copy(output, dest)
    char.image_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


@router.post("/{char_id}/image/generate/stream")
async def generate_image_stream(
    project_id: str,
    char_id: str,
    session: Session = Depends(get_session),
):
    char = _get_char(project_id, char_id, session)
    if not char.description:
        raise HTTPException(400, "description이 없습니다. 캐릭터 설명을 먼저 입력하세요.")
    if not char.sprite_path:
        raise HTTPException(400, "캐릭터 이미지는 먼저 캐릭터 스프라이트를 생성한 뒤 만들 수 있습니다.")
    await ensure_nodes_available(_CHAR_IMAGE_REQUIRED_NODES, context="캐릭터 이미지 생성")
    _ensure_char_image_models("캐릭터 이미지 생성")

    image_params = _parse_json(char.image_params)
    base_prompt = build_multi_ref_prompt([(char.name, char.description or "")], "")
    prompt, scene_negative = compose_scene_image_prompts(base_prompt, image_params)
    negative_prompt = scene_negative or char.negative_prompt
    wf = patch_image(
        prompt=prompt,
        character_refs=[{
            "name": char.name,
            "description": char.description or "",
            "image_path": char.sprite_path,
        }],
        workflow="qwen_edit",
        negative_prompt=negative_prompt,
        resolution=(char.resolution_w, char.resolution_h),
        params=image_params,
        output_prefix=f"projects/{project_id}/characters/{char_id}/image",
    )
    output_targets = find_output_targets(wf)

    def persist(output: Path) -> Character:
        dest = UPLOAD_DIR / f"{char_id}_generated.png"
        shutil.copy(output, dest)
        char.image_path = str(dest)
        return char

    return await _run_character_workflow_stream(
        char=char,
        workflow=wf,
        kind="image",
        execution_targets=output_targets,
        success_message="캐릭터 이미지 생성 완료",
        persist=persist,
        session=session,
    )


# ── VNCCS 캐릭터 스프라이트 ──────────────────────────────────────────────

@router.post("/{char_id}/sprite/generate", response_model=CharacterRead)
async def generate_sprite(
    project_id: str,
    char_id: str,
    mode: str = Query("auto"),
    session: Session = Depends(get_session),
):
    """캐릭터 스프라이트 생성. new=Step1, reference=Step1.1, auto=참조 우선."""
    char = _get_char(project_id, char_id, session)
    if not char.description:
        raise HTTPException(400, "description이 없습니다.")
    await ensure_nodes_available(_CHAR_IMAGE_REQUIRED_NODES, context="캐릭터 스프라이트 생성")
    _ensure_char_image_models("캐릭터 스프라이트 생성")
    wf, output_targets = _build_sprite_workflow(char, project_id, char_id, mode)
    output = await run_workflow(wf, kind="image", execution_targets=output_targets)
    dest = UPLOAD_DIR / f"{char_id}_sprite.png"
    shutil.copy(output, dest)
    char.sprite_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


@router.post("/{char_id}/sprite/generate/stream")
async def generate_sprite_stream(
    project_id: str,
    char_id: str,
    mode: str = Query("auto"),
    session: Session = Depends(get_session),
):
    char = _get_char(project_id, char_id, session)
    if not char.description:
        raise HTTPException(400, "description이 없습니다.")
    await ensure_nodes_available(_CHAR_IMAGE_REQUIRED_NODES, context="캐릭터 스프라이트 생성")
    _ensure_char_image_models("캐릭터 스프라이트 생성")
    wf, output_targets = _build_sprite_workflow(char, project_id, char_id, mode)

    def persist(output: Path) -> Character:
        dest = UPLOAD_DIR / f"{char_id}_sprite.png"
        shutil.copy(output, dest)
        char.sprite_path = str(dest)
        return char

    return await _run_character_workflow_stream(
        char=char,
        workflow=wf,
        kind="image",
        execution_targets=output_targets,
        success_message="캐릭터 스프라이트 생성 완료",
        persist=persist,
        session=session,
    )


# ── 목소리 업로드 ─────────────────────────────────────────────────────────

@router.post("/{char_id}/voice/upload", response_model=CharacterRead)
async def upload_voice(
    project_id: str,
    char_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    char = _get_char(project_id, char_id, session)
    dest = VOICES_DIR / f"{char_id}.wav"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    char.voice_sample_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


# ── Voice Design → 목소리 생성 ────────────────────────────────────────────

@router.post("/{char_id}/voice/design", response_model=CharacterRead)
async def design_voice(
    project_id: str,
    char_id: str,
    body: dict,
    session: Session = Depends(get_session),
):
    """
    body: { "voice_design": "calm Korean female voice, gentle, warm" }
    QWEN3 VoiceDesign으로 샘플 WAV를 생성하고 voice_sample_path에 저장.
    이후 VoiceClone의 레퍼런스로 사용됨.
    """
    char = _get_char(project_id, char_id, session)
    voice_design = body.get("voice_design", "")
    if not voice_design:
        raise HTTPException(400, "voice_design 텍스트를 입력하세요.")

    wf = patch_voice_design(
        voice_design,
        sample_text=char.voice_sample_text or "안녕하세요.",
        language=char.voice_language or "Korean",
        params=_parse_json(char.voice_params),
        output_prefix=f"projects/{project_id}/characters/{char_id}/voice",
    )
    output = await run_workflow(wf)

    dest = VOICES_DIR / f"{char_id}.wav"
    shutil.copy(output, dest)

    char.voice_design = voice_design
    char.voice_sample_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


@router.post("/{char_id}/voice/design/stream")
async def design_voice_stream(
    project_id: str,
    char_id: str,
    body: dict,
    session: Session = Depends(get_session),
):
    char = _get_char(project_id, char_id, session)
    voice_design = body.get("voice_design", "")
    if not voice_design:
        raise HTTPException(400, "voice_design 텍스트를 입력하세요.")

    wf = patch_voice_design(
        voice_design,
        sample_text=char.voice_sample_text or "안녕하세요.",
        language=char.voice_language or "Korean",
        params=_parse_json(char.voice_params),
        output_prefix=f"projects/{project_id}/characters/{char_id}/voice",
    )

    def persist(output: Path) -> Character:
        dest = VOICES_DIR / f"{char_id}.wav"
        shutil.copy(output, dest)
        char.voice_design = voice_design
        char.voice_sample_path = str(dest)
        return char

    return await _run_character_workflow_stream(
        char=char,
        workflow=wf,
        kind="audio",
        execution_targets=None,
        success_message="보이스 디자인 생성 완료",
        persist=persist,
        session=session,
    )
