import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, select

from ..database import get_session
from ..models import Project, ProjectCreate, ProjectRead

router = APIRouter(prefix="/projects", tags=["projects"])

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


@router.get("", response_model=list[ProjectRead])
def list_projects(session: Session = Depends(get_session)):
    return session.exec(select(Project).order_by(Project.created_at.desc())).all()


@router.post("", response_model=ProjectRead, status_code=201)
def create_project(data: ProjectCreate, session: Session = Depends(get_session)):
    project = Project(**data.model_dump())
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: str, session: Session = Depends(get_session)):
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
    return p


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(project_id: str, data: ProjectCreate, session: Session = Depends(get_session)):
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(404)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, session: Session = Depends(get_session)):
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(404)
    session.delete(p)
    session.commit()


# ── Composer M4 — BGM (배경음악) 업로드 ────────────────────────────────

@router.post("/{project_id}/bgm/upload", response_model=ProjectRead)
async def upload_bgm(
    project_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    """프로젝트 단위 BGM 트랙 업로드. mp3/wav/flac 등."""
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(404)
    ext = Path(file.filename or "").suffix or ".mp3"
    dest = UPLOAD_DIR / f"{project_id}_bgm{ext}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    p.bgm_path = str(dest)
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


@router.delete("/{project_id}/bgm", response_model=ProjectRead)
def delete_bgm(project_id: str, session: Session = Depends(get_session)):
    """BGM 트랙 제거."""
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(404)
    if p.bgm_path:
        try:
            Path(p.bgm_path).unlink(missing_ok=True)
        except Exception:
            pass
    p.bgm_path = None
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


# ── Composer M5 — 오버레이 영구화 ────────────────────────────────────

@router.put("/{project_id}/overlays", response_model=ProjectRead)
def update_overlays(
    project_id: str,
    body: dict,
    session: Session = Depends(get_session),
):
    """프로젝트 오버레이 목록 갱신.
    body: { "overlays": [EditOverlay, ...] }
    프런트는 한 번에 전체 목록을 보내고 백엔드는 통째로 교체.
    """
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(404)
    overlays = body.get("overlays", [])
    if not isinstance(overlays, list):
        raise HTTPException(400, "overlays 가 list 가 아닙니다.")
    import json as _json
    p.overlays_json = _json.dumps(overlays, ensure_ascii=False)
    session.add(p)
    session.commit()
    session.refresh(p)
    return p
