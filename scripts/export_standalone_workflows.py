#!/usr/bin/env python3
"""Export runnable ComfyUI API prompts for every runtime workflow.

The exported JSON files do not import myaniform code at execution time. They can
be copied to another ComfyUI setup and submitted directly to `/prompt`.
"""

from __future__ import annotations

import json
import math
import struct
import sys
import wave
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.workflow_catalog import STANDALONE_WORKFLOWS_DIR
from backend.services.workflow_patcher import (
    patch_character_sheet,
    patch_character_sprite_existing,
    patch_image,
    patch_video_effect,
    patch_video_lipsync,
    patch_video_loop,
    patch_voice,
    patch_voice_design,
)

API_DIR = STANDALONE_WORKFLOWS_DIR / "api"
PAYLOAD_DIR = STANDALONE_WORKFLOWS_DIR / "payload"
INPUT_DIR = STANDALONE_WORKFLOWS_DIR / "input_examples"


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, rgb: tuple[int, int, int]) -> None:
    """Write a simple RGB PNG without external dependencies."""
    path.parent.mkdir(parents=True, exist_ok=True)
    row = bytes([0]) + bytes(rgb) * width
    raw = row * height
    png = (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + _png_chunk(b"IDAT", zlib.compress(raw, level=9))
        + _png_chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def write_wav(path: Path, seconds: float = 1.0, sample_rate: int = 44100) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(seconds * sample_rate)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        for i in range(frames):
            sample = int(0.18 * 32767 * math.sin(2 * math.pi * 220 * i / sample_rate))
            f.writeframesraw(struct.pack("<h", sample))


def ensure_input_examples() -> dict[str, Path]:
    assets = {
        "charref_0": INPUT_DIR / "charref_0.png",
        "charref_1": INPUT_DIR / "charref_1.png",
        "visualref_0": INPUT_DIR / "visualref_0.png",
        "character_sprite_ref": INPUT_DIR / "character_sprite_ref.png",
        "video_start": INPUT_DIR / "video_start.png",
        "video_end": INPUT_DIR / "video_end.png",
        "standalone_scene": INPUT_DIR / "standalone_scene.png",
        "voicesample": INPUT_DIR / "voicesample.wav",
        "standalone_voice": INPUT_DIR / "standalone_voice.wav",
    }
    write_png(assets["charref_0"], 512, 768, (218, 196, 184))
    write_png(assets["charref_1"], 512, 768, (178, 198, 218))
    write_png(assets["visualref_0"], 832, 1216, (64, 58, 52))
    write_png(assets["character_sprite_ref"], 512, 768, (214, 188, 176))
    write_png(assets["video_start"], 832, 480, (70, 55, 48))
    write_png(assets["video_end"], 832, 480, (92, 63, 52))
    write_png(assets["standalone_scene"], 832, 480, (72, 56, 50))
    write_wav(assets["voicesample"])
    write_wav(assets["standalone_voice"], seconds=2.0)
    return assets


def validate_api_prompt(name: str, workflow: dict) -> None:
    if not workflow:
        raise ValueError(f"{name}: empty workflow")
    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            raise ValueError(f"{name}: node {node_id} is not an object")
        if not node.get("class_type"):
            raise ValueError(f"{name}: node {node_id} has no class_type")
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            raise ValueError(f"{name}: node {node_id} inputs is not an object")
        for value in inputs.values():
            if isinstance(value, str) and str(ROOT) in value:
                raise ValueError(f"{name}: node {node_id} contains project-local absolute path")


def write_workflow(name: str, workflow: dict, manifest: list[dict], required_inputs: list[str]) -> None:
    validate_api_prompt(name, workflow)
    API_DIR.mkdir(parents=True, exist_ok=True)
    PAYLOAD_DIR.mkdir(parents=True, exist_ok=True)
    path = API_DIR / f"{name}.json"
    path.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    payload_path = PAYLOAD_DIR / f"{name}.json"
    payload_path.write_text(
        json.dumps({"prompt": workflow}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    manifest.append(
        {
            "name": name,
            "api_prompt": str(path.relative_to(ROOT)),
            "prompt_payload": str(payload_path.relative_to(ROOT)),
            "required_inputs": required_inputs,
            "submit": (
                "curl -s http://127.0.0.1:8188/prompt "
                "-H 'Content-Type: application/json' "
                f"--data-binary @{payload_path.relative_to(STANDALONE_WORKFLOWS_DIR)}"
            ),
        }
    )


def main() -> None:
    assets = ensure_input_examples()
    manifest: list[dict] = []

    write_workflow(
        "voice_design_qwen3",
        patch_voice_design(
            "Warm intimate Korean female voice, soft breath, natural pacing",
            sample_text="오늘은 천천히 이야기해볼게요.",
            language="Korean",
            output_prefix="standalone/voice_design_qwen3",
        ),
        manifest,
        [],
    )
    write_workflow(
        "tts_clone_qwen3",
        patch_voice(
            "안녕하세요. 독립 실행 워크플로우 테스트입니다.",
            str(assets["voicesample"]),
            "qwen3",
            output_prefix="standalone/tts_clone_qwen3",
        ),
        manifest,
        ["voicesample.wav"],
    )
    write_workflow(
        "tts_clone_s2pro",
        patch_voice(
            "안녕하세요. Fish Audio S2 Pro 독립 실행 테스트입니다.",
            str(assets["voicesample"]),
            "s2pro",
            output_prefix="standalone/tts_clone_s2pro",
        ),
        manifest,
        ["voicesample.wav"],
    )
    write_workflow(
        "character_sprite_new",
        patch_character_sheet(
            "StandaloneHeroine",
            "adult woman, slim body, long brown hair, amber eyes, neutral expression",
            negative_prompt="low quality, distorted anatomy, watermark",
            character_fields={
                "background_color": "green",
                "aesthetics": "masterpiece, best quality",
                "nsfw": False,
                "sex": "female",
                "age": 24,
                "race": "human",
                "eyes": "amber eyes",
                "hair": "long brown hair",
                "face": "soft oval face",
                "body": "slim body",
                "skin_color": "fair skin",
                "lora_prompt": "",
            },
            output_prefix="standalone/character_sprite_new",
        ),
        manifest,
        [],
    )
    write_workflow(
        "character_sprite_reference",
        patch_character_sprite_existing(
            character_name="StandaloneClone",
            description="adult woman, consistent face and body proportions",
            reference_image_path=str(assets["character_sprite_ref"]),
            negative_prompt="low quality, distorted anatomy, watermark",
            character_fields={"sex": "female", "age": 24, "race": "human"},
            output_prefix="standalone/character_sprite_reference",
        ),
        manifest,
        ["character_sprite_ref.png"],
    )
    write_workflow(
        "scene_image_qwen_edit",
        patch_image(
            prompt=(
                "cinematic bedroom conversation, two characters sitting close together, "
                "warm practical lighting, controlled composition, expressive faces"
            ),
            character_refs=[
                {
                    "name": "Heroine",
                    "description": "adult woman, long brown hair, amber eyes",
                    "image_path": str(assets["charref_0"]),
                },
                {
                    "name": "Hero",
                    "description": "adult man, short black hair, calm expression",
                    "image_path": str(assets["charref_1"]),
                },
            ],
            visual_refs=[str(assets["visualref_0"])],
            workflow="qwen_edit",
            resolution=(832, 1216),
            negative_prompt="low quality, watermark, different character, bad anatomy",
            output_prefix="standalone/scene_image_qwen_edit",
        ),
        manifest,
        ["charref_0.png", "charref_1.png", "visualref_0.png"],
    )
    write_workflow(
        "video_lipsync_s2v_fastfidelity",
        patch_video_lipsync(
            image_path="standalone_scene.png",
            voice_path="standalone_voice.wav",
            bg_prompt="subtle mouth movement, intimate close-up, warm room lighting",
            sfx_prompt="quiet room tone, fabric rustle, soft breathing",
            output_prefix="standalone/video_lipsync_s2v_fastfidelity",
        ),
        manifest,
        ["standalone_scene.png", "standalone_voice.wav"],
    )
    write_workflow(
        "video_loop_i2v",
        patch_video_loop(
            image_path=str(assets["video_start"]),
            bg_prompt="subtle breathing motion, slow camera drift, warm interior light",
            sfx_prompt="quiet room tone, soft cloth movement",
            output_prefix="standalone/video_loop_i2v",
        ),
        manifest,
        ["video_start.png"],
    )
    write_workflow(
        "video_first_last_i2v",
        patch_video_effect(
            image_path=str(assets["video_start"]),
            end_image_path=str(assets["video_end"]),
            effect_prompt="slow romantic scene transition, gentle head turn, warm lighting shift",
            sfx_prompt="soft ambient movement, quiet room tone",
            output_prefix="standalone/video_first_last_i2v",
        ),
        manifest,
        ["video_start.png", "video_end.png"],
    )

    (STANDALONE_WORKFLOWS_DIR / "manifest.json").write_text(
        json.dumps({"workflows": manifest}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"exported {len(manifest)} workflows to {API_DIR}")


if __name__ == "__main__":
    main()
