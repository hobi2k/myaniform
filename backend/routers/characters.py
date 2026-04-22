import asyncio
import json
import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..database import get_session
from ..models import Character, CharacterCreate, CharacterRead, TTSEngine
from ..services.comfyui_client import ensure_nodes_available, run_workflow
from ..services.workflow_patcher import (
    find_output_targets,
    patch_char_generate,
    patch_character_sheet,
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
    "VAEDecode",
    "SaveImage",
    "LoraLoader",
    "UltralyticsDetectorProvider",
    "SAMLoader",
    "FaceDetailer",
]
_CHAR_IMAGE_REQUIRED_MODELS = [
    MODELS_DIR / "sams" / "sam_vit_b_01ec64.pth",
    MODELS_DIR / "ultralytics" / "bbox" / "face_yolov8m.pt",
    MODELS_DIR / "ultralytics" / "bbox" / "hand_yolov8s.pt",
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


def _ensure_char_image_models(context: str) -> None:
    missing = [str(path.relative_to(MODELS_DIR)) for path in _CHAR_IMAGE_REQUIRED_MODELS if not path.exists()]
    if missing:
        raise HTTPException(
            400,
            f"{context}에 필요한 ComfyUI 모델 파일이 없습니다: {', '.join(missing)}",
        )


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


# ── 이미지 업로드 ─────────────────────────────────────────────────────────

@router.post("/{char_id}/image/upload", response_model=CharacterRead)
async def upload_image(
    project_id: str,
    char_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
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


# ── 이미지 AI 생성 ────────────────────────────────────────────────────────
#
# 캐릭터 기본 생성은 "대표 얼굴샷"보다 "전체샷/시트 기반 참조 자산"이 중요하므로
# 생성 결과를 image_path 와 sheet_path 양쪽에 함께 저장한다.

@router.post("/{char_id}/image/generate", response_model=CharacterRead)
async def generate_image(
    project_id: str,
    char_id: str,
    session: Session = Depends(get_session),
):
    char = _get_char(project_id, char_id, session)
    if not char.description:
        raise HTTPException(400, "description이 없습니다. 캐릭터 설명을 먼저 입력하세요.")
    await ensure_nodes_available(_CHAR_IMAGE_REQUIRED_NODES, context="캐릭터 이미지 생성")
    _ensure_char_image_models("캐릭터 이미지 생성")

    wf = patch_char_generate(
        char.name or char.id,
        char.description,
        negative_prompt=char.negative_prompt,
        resolution=(char.resolution_w, char.resolution_h),
        params=_parse_json(char.image_params),
        output_prefix=f"projects/{project_id}/characters/{char_id}/image",
    )
    output_targets = find_output_targets(wf, title_contains="sheet") or find_output_targets(wf)
    output = await run_workflow(wf, kind="image", execution_targets=output_targets)

    dest = UPLOAD_DIR / f"{char_id}_generated.png"
    shutil.copy(output, dest)
    char.image_path = str(dest)
    char.sheet_path = str(dest)
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
    await ensure_nodes_available(_CHAR_IMAGE_REQUIRED_NODES, context="캐릭터 이미지 생성")
    _ensure_char_image_models("캐릭터 이미지 생성")

    wf = patch_char_generate(
        char.name or char.id,
        char.description,
        negative_prompt=char.negative_prompt,
        resolution=(char.resolution_w, char.resolution_h),
        params=_parse_json(char.image_params),
        output_prefix=f"projects/{project_id}/characters/{char_id}/image",
    )
    output_targets = find_output_targets(wf, title_contains="sheet") or find_output_targets(wf)

    def persist(output: Path) -> Character:
        dest = UPLOAD_DIR / f"{char_id}_generated.png"
        shutil.copy(output, dest)
        char.image_path = str(dest)
        char.sheet_path = str(dest)
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


# ── Phase 4: VNCCS 캐릭터 시트 / 스프라이트 ──────────────────────────────

@router.post("/{char_id}/sheet/generate", response_model=CharacterRead)
async def generate_sheet(
    project_id: str,
    char_id: str,
    session: Session = Depends(get_session),
):
    """캐릭터 시트 생성.

    축약 워크플로우는 제거되었고, 원본 VN Step1 자동화 경로만 허용한다.
    """
    char = _get_char(project_id, char_id, session)
    if not char.description:
        raise HTTPException(400, "description이 없습니다.")
    await ensure_nodes_available(_CHAR_IMAGE_REQUIRED_NODES, context="캐릭터 시트 생성")
    _ensure_char_image_models("캐릭터 시트 생성")
    wf = patch_character_sheet(
        char.name,
        char.description,
        negative_prompt=char.negative_prompt,
        resolution=(char.resolution_w, char.resolution_h),
        params=_parse_json(char.image_params),
        output_prefix=f"projects/{project_id}/characters/{char_id}/sheet",
    )
    output_targets = find_output_targets(wf, title_contains="sheet") or find_output_targets(wf)
    output = await run_workflow(wf, kind="image", execution_targets=output_targets)
    dest = UPLOAD_DIR / f"{char_id}_sheet.png"
    shutil.copy(output, dest)
    char.sheet_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


@router.post("/{char_id}/sheet/generate/stream")
async def generate_sheet_stream(
    project_id: str,
    char_id: str,
    session: Session = Depends(get_session),
):
    char = _get_char(project_id, char_id, session)
    if not char.description:
        raise HTTPException(400, "description이 없습니다.")
    await ensure_nodes_available(_CHAR_IMAGE_REQUIRED_NODES, context="캐릭터 시트 생성")
    _ensure_char_image_models("캐릭터 시트 생성")
    wf = patch_character_sheet(
        char.name,
        char.description,
        negative_prompt=char.negative_prompt,
        resolution=(char.resolution_w, char.resolution_h),
        params=_parse_json(char.image_params),
        output_prefix=f"projects/{project_id}/characters/{char_id}/sheet",
    )
    output_targets = find_output_targets(wf, title_contains="sheet") or find_output_targets(wf)

    def persist(output: Path) -> Character:
        dest = UPLOAD_DIR / f"{char_id}_sheet.png"
        shutil.copy(output, dest)
        char.sheet_path = str(dest)
        return char

    return await _run_character_workflow_stream(
        char=char,
        workflow=wf,
        kind="image",
        execution_targets=output_targets,
        success_message="캐릭터 시트 생성 완료",
        persist=persist,
        session=session,
    )


@router.post("/{char_id}/sheet/upload", response_model=CharacterRead)
async def upload_sheet(
    project_id: str,
    char_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    """외부에서 만든 캐릭터 시트를 업로드 (예: VN_Step1.1 결과물)."""
    char = _get_char(project_id, char_id, session)
    ext = Path(file.filename or "sheet.png").suffix or ".png"
    dest = UPLOAD_DIR / f"{char_id}_sheet{ext}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    char.sheet_path = str(dest)
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
    """투명 배경 스프라이트 (VN_Step4 결과) 업로드.
    씬 이미지 생성 시 sheet 보다 우선하는 레퍼런스."""
    char = _get_char(project_id, char_id, session)
    ext = Path(file.filename or "sprite.png").suffix or ".png"
    dest = UPLOAD_DIR / f"{char_id}_sprite{ext}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    char.sprite_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


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
