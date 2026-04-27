from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..services.workflow_patcher import load_original_workflow
from ..services.workflow_catalog import (
    SCENE_TYPE_TO_WORKFLOW_ALIAS,
    WORKFLOW_VIEWER_ALIASES,
)

router = APIRouter(prefix="/api/workflows", tags=["workflows"])

_WORKFLOWS_DIR = Path(__file__).resolve().parent.parent.parent / "workflows"

ORIGINAL_WORKFLOW_ALIASES = WORKFLOW_VIEWER_ALIASES
SCENE_TYPE_TO_WORKFLOW = SCENE_TYPE_TO_WORKFLOW_ALIAS


@router.get("")
def list_workflows():
    local = {p.stem for p in _WORKFLOWS_DIR.glob("*.json")}
    return {
        "workflows": sorted(local | set(ORIGINAL_WORKFLOW_ALIASES)),
        "scene_type_map": SCENE_TYPE_TO_WORKFLOW,
        "original_workflows": ORIGINAL_WORKFLOW_ALIASES,
    }


@router.get("/{name}")
def get_workflow(name: str):
    if "/" in name or ".." in name:
        raise HTTPException(400, "invalid name")
    stem = name[:-5] if name.endswith(".json") else name
    if stem in ORIGINAL_WORKFLOW_ALIASES:
        try:
            return load_original_workflow(ORIGINAL_WORKFLOW_ALIASES[stem])
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))
        except Exception as e:
            raise HTTPException(500, f"invalid original workflow: {e}")

    path = _WORKFLOWS_DIR / f"{stem}.json"
    if not path.is_file():
        raise HTTPException(404, f"workflow not found: {stem}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"invalid workflow json: {e}")
