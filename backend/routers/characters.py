import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, select

from ..database import get_session
from ..models import Character, CharacterCreate, CharacterRead, TTSEngine
from ..services.comfyui_client import run_workflow
from ..services.workflow_patcher import patch_char_generate, patch_character_sheet, patch_voice_design

UPLOAD_DIR = Path("uploads")
VOICES_DIR = Path("voices")
UPLOAD_DIR.mkdir(exist_ok=True)
VOICES_DIR.mkdir(exist_ok=True)

router = APIRouter(prefix="/projects/{project_id}/characters", tags=["characters"])


def _get_char(project_id: str, char_id: str, session: Session) -> Character:
    c = session.get(Character, char_id)
    if not c or c.project_id != project_id:
        raise HTTPException(404, "캐릭터를 찾을 수 없습니다.")
    return c


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

@router.post("/{char_id}/image/generate", response_model=CharacterRead)
async def generate_image(
    project_id: str,
    char_id: str,
    session: Session = Depends(get_session),
):
    char = _get_char(project_id, char_id, session)
    if not char.description:
        raise HTTPException(400, "description이 없습니다. 캐릭터 설명을 먼저 입력하세요.")

    wf = patch_char_generate(char.description)
    output = await run_workflow(wf)

    dest = UPLOAD_DIR / f"{char_id}_generated.png"
    shutil.copy(output, dest)
    char.image_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


# ── Phase 4: VNCCS 캐릭터 시트 / 스프라이트 ──────────────────────────────

@router.post("/{char_id}/sheet/generate", response_model=CharacterRead)
async def generate_sheet(
    project_id: str,
    char_id: str,
    session: Session = Depends(get_session),
):
    """SDXL 간이 캐릭터 시트 생성 (ws_character_sheet.json).

    본격 VNCCS 파이프라인 (VN_Step1/Step1.1) 은 /workflows 뷰어에서 수동 실행.
    여기서는 단일 이미지 턴어라운드 시트를 만들어 sheet_path 로 저장.
    """
    char = _get_char(project_id, char_id, session)
    if not char.description:
        raise HTTPException(400, "description이 없습니다.")
    wf = patch_character_sheet(char.name, char.description)
    output = await run_workflow(wf)
    dest = UPLOAD_DIR / f"{char_id}_sheet.png"
    shutil.copy(output, dest)
    char.sheet_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char


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

    wf = patch_voice_design(voice_design)
    output = await run_workflow(wf)

    dest = VOICES_DIR / f"{char_id}.wav"
    shutil.copy(output, dest)

    char.voice_design = voice_design
    char.voice_sample_path = str(dest)
    session.add(char)
    session.commit()
    session.refresh(char)
    return char
