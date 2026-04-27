"""Scene-generation prompt policy helpers."""

from __future__ import annotations


def _clean(text: object | None) -> str:
    return str(text or "").strip()


def merge_negative_prompt(*parts: object | None) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        for item in _clean(part).split(","):
            token = item.strip()
            key = token.lower()
            if not token or key in seen:
                continue
            seen.add(key)
            out.append(token)
    return ", ".join(out)


def compose_scene_image_prompts(base_prompt: str, image_params: dict | None) -> tuple[str, str | None]:
    """Return final positive/negative prompts for scene keyframes.

    Qwen Image Edit is used only as the character-consistency reference path.
    Outfit, pose, framing, camera, expression, lighting, and style are user
    prompt controls; empty fields add nothing and the backend must not force them.
    """
    params = image_params or {}
    user_controls = [
        params.get("outfit_prompt") or params.get("wardrobe_prompt"),
        params.get("pose_prompt"),
        params.get("composition_prompt"),
        params.get("camera_prompt"),
        params.get("expression_prompt"),
        params.get("lighting_prompt"),
        params.get("style_prompt"),
    ]
    positive = ". ".join(
        part
        for part in [_clean(base_prompt), *[_clean(item) for item in user_controls]]
        if part
    )
    negative = merge_negative_prompt(
        params.get("clothing_negative_prompt"),
        params.get("negative_prompt"),
    )
    return positive, negative or None
