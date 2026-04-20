from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/workflows", tags=["workflows"])

_WORKFLOWS_DIR = Path(__file__).resolve().parent.parent.parent / "workflows"

# scene.type → 렌더링 워크플로우 매핑 (workflow_patcher.py 와 동일)
SCENE_TYPE_TO_WORKFLOW = {
    "lipsync": "ws_lipsync",
    "loop":    "ws_loop",
    "effect":  "ws_effect",
}


@router.get("")
def list_workflows():
    return {
        "workflows": sorted(p.stem for p in _WORKFLOWS_DIR.glob("*.json")),
        "scene_type_map": SCENE_TYPE_TO_WORKFLOW,
    }


@router.get("/{name}")
def get_workflow(name: str):
    if "/" in name or ".." in name:
        raise HTTPException(400, "invalid name")
    stem = name[:-5] if name.endswith(".json") else name
    path = _WORKFLOWS_DIR / f"{stem}.json"
    if not path.is_file():
        raise HTTPException(404, f"workflow not found: {stem}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"invalid workflow json: {e}")
