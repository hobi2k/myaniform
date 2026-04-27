#!/usr/bin/env python3
"""Generate missing romance character sprites from existing character images."""

from __future__ import annotations

import argparse
import asyncio
import shutil
import sys
from pathlib import Path

from sqlmodel import Session, select

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.database import engine
from backend.models import Character
from backend.routers.characters import (
    _CHAR_IMAGE_REQUIRED_NODES,
    _character_workflow_fields,
    _ensure_char_image_models,
)
from backend.services import comfyui_client as comfy
from backend.services.workflow_patcher import (
    find_output_targets,
    patch_character_sheet,
    patch_character_sprite_existing,
)

UPLOAD_DIR = ROOT / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def _parse_json(raw: str | None) -> dict:
    if not raw:
        return {}
    import json

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _find_character(session: Session, name: str) -> Character:
    char = session.exec(select(Character).where(Character.name == name)).first()
    if not char:
        raise RuntimeError(f"캐릭터를 찾을 수 없습니다: {name}")
    if not char.description:
        raise RuntimeError(f"{name}: description이 없습니다.")
    return char


async def generate_sprite(char: Character, *, force: bool) -> Character:
    if char.sprite_path and not force:
        print(f"[sprite] reuse {char.name}: {char.sprite_path}", flush=True)
        return char

    params = _parse_json(char.sprite_params)
    if char.image_path and Path(char.image_path).exists():
        wf = patch_character_sprite_existing(
            character_name=char.name,
            description=char.description or "",
            reference_image_path=char.image_path,
            negative_prompt=char.negative_prompt,
            resolution=(char.resolution_w, char.resolution_h),
            params=params,
            character_fields=_character_workflow_fields(char),
            output_prefix=f"romance_sprites/{char.id}/sprite",
        )
        targets = find_output_targets(wf, title_contains="refined faces character sheet") or find_output_targets(wf)
    else:
        wf = patch_character_sheet(
            char.name,
            char.description or "",
            negative_prompt=char.negative_prompt,
            resolution=(char.resolution_w, char.resolution_h),
            params=params,
            character_fields=_character_workflow_fields(char),
            output_prefix=f"romance_sprites/{char.id}/sprite",
        )
        targets = find_output_targets(wf, title_contains="sheet") or find_output_targets(wf)

    print(f"[sprite] queue {char.name}", flush=True)
    output = await comfy.run_workflow(wf, kind="image", execution_targets=targets)
    dest = UPLOAD_DIR / f"{char.id}_sprite.png"
    shutil.copy(output, dest)
    char.sprite_path = str(dest.relative_to(ROOT))
    print(f"[sprite] done {char.name}: {char.sprite_path}", flush=True)
    return char


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--female", default="유나")
    parser.add_argument("--male", default="준")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    await comfy.ensure_nodes_available(_CHAR_IMAGE_REQUIRED_NODES, context="로맨스 캐릭터 스프라이트 생성")
    _ensure_char_image_models("로맨스 캐릭터 스프라이트 생성")

    with Session(engine) as session:
        chars = [_find_character(session, args.female), _find_character(session, args.male)]
        for char in chars:
            updated = await generate_sprite(char, force=args.force)
            session.add(updated)
            session.commit()


if __name__ == "__main__":
    asyncio.run(main())
