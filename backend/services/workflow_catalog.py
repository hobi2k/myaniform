"""ComfyUI workflow catalog used by the app and standalone exporters."""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS_DIR = PROJECT_ROOT / "workflows"
ORIGINAL_WORKFLOWS_DIR = WORKFLOWS_DIR / "originals"
STANDALONE_WORKFLOWS_DIR = WORKFLOWS_DIR / "standalone"

WORKFLOW_DIR_ENV = "MYANIFORM_COMFYUI_WORKFLOW_DIR"

ORIGINAL_WORKFLOWS = {
    "scene_image": "이미지 워크플로우.json",
    "video_basic": "동영상 기본 워크플로우.app.json",
    "video_loop": "동영상 루프 워크플로우.json",
    "video_effect": "동영상 첫끝프레임 워크플로우.json",
    "video_s2v_fastfidelity": "Wan2.2-S2V_ Audio-Driven Video Generation.json",
    "character_sprite_new": "VN_Step1_QWEN_CharSheetGenerator_v1.json",
    "character_sprite_reference": "VN_Step1.1_QWEN_Clone_Existing_Character_v1.json",
}

LOCAL_RUNTIME_WORKFLOWS = {
    "tts_qwen3_clone": "ws_tts_clone.json",
    "tts_s2pro_clone": "ws_tts_s2pro.json",
    "voice_design": "ws_voice_design.json",
}

WORKFLOW_VIEWER_ALIASES = {
    "scene_image_original": ORIGINAL_WORKFLOWS["scene_image"],
    "video_basic_original": ORIGINAL_WORKFLOWS["video_basic"],
    "video_loop_original": ORIGINAL_WORKFLOWS["video_loop"],
    "video_effect_original": ORIGINAL_WORKFLOWS["video_effect"],
    "s2v_fastfidelity_original": ORIGINAL_WORKFLOWS["video_s2v_fastfidelity"],
    "character_sprite_new_original": ORIGINAL_WORKFLOWS["character_sprite_new"],
    "character_sprite_reference_original": ORIGINAL_WORKFLOWS["character_sprite_reference"],
}

SCENE_TYPE_TO_WORKFLOW_ALIAS = {
    "lipsync": "s2v_fastfidelity_original",
    "basic": "video_basic_original",
    "loop": "video_loop_original",
    "effect": "video_effect_original",
}


def resolve_original_workflow_path(name: str) -> Path:
    """Resolve a UI-export workflow without relying on a machine-local path."""
    repo_path = ORIGINAL_WORKFLOWS_DIR / name
    if repo_path.exists():
        return repo_path

    override = os.environ.get(WORKFLOW_DIR_ENV)
    if override:
        override_path = Path(override) / name
        if override_path.exists():
            return override_path

    raise FileNotFoundError(
        f"원본 워크플로우 파일을 찾을 수 없습니다: {name}. "
        f"repo의 {ORIGINAL_WORKFLOWS_DIR}에 두거나 {WORKFLOW_DIR_ENV}를 설정하세요."
    )
