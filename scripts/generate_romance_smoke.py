#!/usr/bin/env python3
"""Generate a reference-directed romance VN pipeline sample from two sprites.

This script intentionally uses the same production patchers as the Web UI:
- original `이미지 워크플로우.json` + injected Qwen Image Edit reference branch
- original loop/effect video workflows
- MMAudio branch on each I2V scene

Default target: 832x480, 30fps, about 30 seconds.

The sample is intentionally original. It does not copy a specific commercial
episode's characters, dialogue, or explicit shot list; instead it encodes the
production grammar we need to match: pale romance VN grading, close/OTS camera
language, Korean subtitle rhythm, voice-led pacing, and strict scene continuity.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from PIL import Image
from sqlmodel import Session, select

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.database import engine, init_db
from backend.models import Character
from backend.routers.characters import _CHAR_IMAGE_REQUIRED_NODES, _ensure_char_image_models
from backend.services import comfyui_client as comfy
from backend.services import ffmpeg_utils
from backend.services.gold_fixture import compare_to_profile
from backend.services.workflow_patcher import (
    find_output_targets,
    find_video_output_targets,
    patch_character_sheet,
    patch_image,
    patch_video_basic,
    patch_video_lipsync,
    patch_video_effect,
    patch_video_loop,
    patch_voice_design,
)

MMAUDIO_NSFW = ROOT / "ComfyUI/models/mmaudio/mmaudio_large_44k_nsfw_gold_8.5k_final_fp16.safetensors"
VIDEO_SUFFIXES = {".mp4", ".webm", ".mov", ".mkv"}

STYLE_BIBLE = (
    "premium adult Korean romance visual novel frame, soft cel-shaded anime illustration, "
    "pale beige and blush-pink palette, low contrast, milky highlights, desaturated shadows, "
    "soft bedroom and apartment practical lighting, gentle bloom, thin clean lineart, "
    "consistent hair volume, consistent eye shape, consistent skin tone, cinematic crop, "
    "subtitle-safe lower third composition, no browser UI, no watermark"
)

NEGATIVE_IMAGE_PROMPT = (
    "different character, inconsistent face, inconsistent hair color, inconsistent outfit, "
    "swapped outfits, heroine wearing the hero outfit, heroine in black sweater, heroine in black knit top, "
    "hero wearing the heroine outfit, "
    "yellow skin, green skin, neon skin, chroma spill, color cast on skin, "
    "harsh saturated colors, orange lamp overcast, high contrast, messy background, "
    "wide empty composition, duplicate people, extra limbs, bad hands, malformed fingers, "
    "watermark, text, browser frame, low quality, blurry, jpeg artifacts"
)

SCENES = [
    {
        "kind": "basic",
        "lipsync": False,
        "shot": "mature title beat into apartment doorway establishing shot",
        "prompt": (
            "adult romance visual novel opening, a silver-lavender haired woman meets a black-haired man "
            "at the doorway of a compact apartment at night, over-the-shoulder camera from behind the man, "
            "her guarded smile and distinctive beauty mark under the left eye are visible, soft beige wall, "
            "muted indoor light, intimate mood; both fully clothed"
        ),
        "effect": "slow parallax push through the doorway, subtle hair movement, door shadow sliding across the wall",
        "sfx": "apartment hallway room tone, door latch click, soft footsteps, distant night city hum",
        "dialogue": "잠깐만 들어올래요? 오늘은 이상하게 혼자 있기 싫어서요.",
    },
    {
        "kind": "basic",
        "lipsync": True,
        "shot": "heroine reaction close-up with mouth movement",
        "prompt": (
            "adult romance visual novel close-up, the woman turns back toward camera inside the apartment, "
            "silver-lavender wavy hair framing her face, amber-gray eyes, beauty mark under left eye, "
            "hesitant half-smile, soft cream wall and framed picture behind her, shallow depth of field, "
            "pale pink highlights and beige shadows, subtitle-safe composition"
        ),
        "effect": "small head turn, blinking, shy breath, camera micro push-in, hair tips moving gently",
        "sfx": "quiet apartment room tone, soft fabric rustle, kettle hum, subtle footsteps on wooden floor",
        "dialogue": "오해하진 말아요. 그냥, 누군가한테 기대고 싶은 밤이 있잖아요.",
    },
    {
        "kind": "basic",
        "lipsync": False,
        "shot": "male listening cutaway and hand detail",
        "prompt": (
            "adult romance visual novel cutaway, the black-haired man lowers his gaze and gently closes the apartment door, "
            "lean adult build, narrow eyes, subtle undercut, small earring, dark knit top, one hand still on the doorknob, "
            "the woman is softly blurred in the background, warm beige hallway light"
        ),
        "effect": "door closes slowly, hand releases the knob, shallow focus rack from hand to his face",
        "sfx": "soft door click, cloth rustle, quiet breath, room tone",
        "dialogue": "",
    },
    {
        "kind": "basic",
        "lipsync": False,
        "shot": "two-shot tension at bed edge",
        "prompt": (
            "adult romance visual novel medium shot, the woman and man sit close together at the edge of a bed, "
            "white sheets and beige wall, their shoulders nearly touching, she looks away while he listens quietly, "
            "soft blush lighting, pale washed highlights, private emotional tension; both remain recognizably the same"
        ),
        "effect": "slow push-in, her fingers tighten around the bed sheet, his shoulder moves closer, soft breath-like camera drift",
        "sfx": "soft bed creak, quiet breathing, cloth rustle, faint refrigerator hum, warm room ambience",
        "dialogue": "당신 앞에서는 숨기던 말이 자꾸 먼저 나와요. 그래서 조금 무서워요.",
    },
    {
        "kind": "basic",
        "lipsync": False,
        "shot": "consensual first kiss close-up",
        "prompt": (
            "adult romance visual novel close-up, the man and woman share a hesitant first kiss, "
            "faces large in frame, soft blush on her cheeks, silver-lavender hair across the pillow edge, "
            "tasteful adult romance, cinematic crop, no explicit nudity in this shot"
        ),
        "effect": "very slow lean-in into kiss, eyelids lowering, hair strand movement, soft bloom pulse",
        "sfx": "quiet breath, fabric rustle, soft kiss, low room tone",
        "dialogue": "",
    },
    {
        "kind": "effect",
        "lipsync": True,
        "shot": "whisper close-up",
        "prompt": (
            "adult romance visual novel extreme close-up, the woman whispers while looking up at the man, "
            "flushed cheeks, amber-gray eyes, beauty mark under left eye, loose blue-gray blouse slightly off one shoulder, "
            "white bedding visible, intimate but composed framing"
        ),
        "effect": "subtle mouth movement, trembling eyelashes, slight camera sway, warm vignette",
        "sfx": "soft sheet rustle, close breath, quiet room tone",
        "dialogue": "싫으면 바로 멈출게요. 그러니까 지금은, 내 목소리만 들어줘요.",
    },
    {
        "kind": "effect",
        "lipsync": False,
        "shot": "bedside adult composition",
        "prompt": (
            "adult romance visual novel overhead bedside shot, the same woman reclines on white sheets with blouse loosened, "
            "the man leans beside her, consensual intimate adult mood, tasteful partial nudity suggested by bedding and pose, "
            "soft cream and blush palette, cinematic visual novel lighting, no graphic sex act"
        ),
        "effect": "slow overhead drift, sheet folds moving, gentle breathing motion, pale pink highlights",
        "sfx": "sheet rustle, close breathing, mattress creak, warm room ambience",
        "dialogue": "",
    },
    {
        "kind": "effect",
        "lipsync": False,
        "shot": "hand and skin insert",
        "prompt": (
            "adult romance visual novel insert close-up, a hand rests gently on warm skin above white bedding, "
            "soft blush shading, delicate fingers, tasteful sensual detail, no explicit sex act, pale milky highlights"
        ),
        "effect": "hand glides a few centimeters, shallow focus, soft light flicker, intimate insert shot",
        "sfx": "soft touch, sheet rustle, quiet inhale, low room tone",
        "dialogue": "",
    },
    {
        "kind": "effect",
        "lipsync": False,
        "shot": "emotional climax close-up",
        "prompt": (
            "adult romance visual novel emotional close-up, the same woman lies against white bedding, flushed and teary-eyed "
            "but smiling, silver-lavender hair spread over the pillow, the man partly visible at frame edge, "
            "consensual adult intimacy, painterly blush palette, subtitle-safe lower third"
        ),
        "effect": "slow handheld-like sway, blinking, hair settling on pillow, soft bloom and breath motion",
        "sfx": "breath, bedding movement, distant night ambience, subtle heartbeat-like low tone",
        "dialogue": "오늘 밤은 여기까지만 기억해요. 다음 이야기는, 우리 속도로 해요.",
    },
    {
        "kind": "loop",
        "lipsync": False,
        "shot": "quiet aftermath ending",
        "prompt": (
            "adult romance visual novel final quiet shot, two silhouettes under white bedding in a small apartment bedroom, "
            "curtain moving by the window, soft city light, emotional afterglow, pale cream and blush palette, "
            "low contrast, soft vignette, no explicit detail"
        ),
        "effect": "curtain moves slowly, city light flickers, very slow pull-back ending shot",
        "sfx": "distant night city ambience, soft curtain movement, quiet breathing, gentle emotional room tone",
        "dialogue": "",
    },
]

FEMALE_OUTFIT = "loose blue-gray blouse and a pale skirt, soft natural fabric, muted colors, later loosened only when the shot prompt says so"
MALE_OUTFIT = "charcoal knit top, dark trousers, small silver earring, understated adult casual wear"
ROLE_LOCK = (
    "Role lock: heroine means the silver-lavender haired woman and she wears the blue-gray blouse; "
    "hero means the black-haired man and he wears the charcoal knit top. "
    "Never swap their clothes, colors, faces, hairstyles, or body silhouettes."
)

DEFAULT_CHARACTERS = [
    {
        "key": "heroine",
        "name": "Serin",
        "description": (
            "adult Korean woman, silver-lavender wavy long hair, amber-gray eyes, beauty mark under the left eye, "
            "soft oval face with a guarded smile, slim elegant body, distinctive visual novel heroine design, "
            "consistent face, hair silhouette, and proportions"
        ),
        "fields": {
            "background_color": "green",
            "aesthetics": "masterpiece, best quality, visual novel character sheet, clean lineart",
            "nsfw": False,
            "sex": "female",
            "age": 26,
            "race": "human",
            "eyes": "amber-gray almond eyes",
            "hair": "long silver-lavender wavy hair with airy bangs",
            "face": "soft oval face, delicate nose, gentle lips, beauty mark under the left eye",
            "body": "slim elegant adult body, natural proportions",
            "skin_color": "fair warm natural human skin, peach undertone, no yellow tint, no green tint",
            "lora_prompt": "",
        },
        "ref_description": (
            "female character sprite sheet identity reference only; preserve exact face, hair, eye shape, "
            f"body proportions, and silhouette. Scene outfit continuity: {FEMALE_OUTFIT}"
        ),
    },
    {
        "key": "hero",
        "name": "Taehan",
        "description": (
            "adult Korean man, neat black undercut hair, narrow dark eyes, small silver earring, calm mature expression, "
            "lean build, distinctive visual novel hero design, consistent face and proportions, "
            "natural peach-toned human skin without yellow or green tint"
        ),
        "fields": {
            "background_color": "green",
            "aesthetics": "masterpiece, best quality, visual novel character sheet, clean lineart, neutral balanced color grading, natural skin color",
            "nsfw": False,
            "sex": "male",
            "age": 29,
            "race": "human",
            "eyes": "narrow dark brown eyes",
            "hair": "neat short black undercut hair",
            "face": "calm handsome face, straight nose, gentle expression, small silver earring",
            "body": "lean adult body, natural proportions",
            "skin_color": "fair neutral natural human skin, peach undertone, no yellow tint, no green tint",
            "lora_prompt": "",
        },
        "ref_description": (
            "male character sprite sheet identity reference only; preserve exact face, hair, eye shape, "
            f"body proportions, and silhouette. Scene outfit continuity: {MALE_OUTFIT}"
        ),
        "postprocess": {"skin_cast_repair": "yellow_to_peach"},
    },
]


def _resolve_path(raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        path = ROOT / raw
    if not path.exists():
        raise FileNotFoundError(f"sprite not found: {path}")
    return path


def _db_sprite_refs() -> list[dict]:
    init_db()
    refs: list[dict] = []
    with Session(engine) as session:
        for char in session.exec(select(Character)).all():
            if not char.sprite_path:
                continue
            path = _resolve_path(char.sprite_path)
            refs.append(
                {
                    "name": char.name,
                    "description": char.description or char.name,
                    "image_path": str(path),
                    "mtime": path.stat().st_mtime,
                }
            )
    refs.sort(key=lambda ref: float(ref["mtime"]), reverse=True)
    return refs


def romance_character_refs(female_sprite: str | None, male_sprite: str | None) -> list[dict]:
    if female_sprite or male_sprite:
        if not (female_sprite and male_sprite):
            raise ValueError("--female-sprite와 --male-sprite는 둘 다 지정해야 합니다.")
        return [
            {
                "name": "heroine",
                "description": (
                    "female character sprite sheet identity reference only; preserve the exact face, hair, "
                    f"eye shape, body proportions, and silhouette. Scene outfit continuity: {FEMALE_OUTFIT}"
                ),
                "image_path": str(_resolve_path(female_sprite)),
            },
            {
                "name": "hero",
                "description": (
                    "male character sprite sheet identity reference only; preserve the exact face, hair, "
                    f"eye shape, body proportions, and silhouette. Scene outfit continuity: {MALE_OUTFIT}"
                ),
                "image_path": str(_resolve_path(male_sprite)),
            },
        ]

    refs = _db_sprite_refs()
    if len(refs) < 2:
        available = ", ".join(f"{r['name']}={r['image_path']}" for r in refs) or "none"
        raise RuntimeError(
            "컷 기반 성인 VN 일관성 검증에는 여성/남성 2개의 캐릭터 스프라이트가 필요합니다. "
            "현재 사용 가능한 sprite_path가 2개 미만입니다. 먼저 두 캐릭터 스프라이트를 생성하거나 "
            f"--female-sprite / --male-sprite를 지정하세요. available: {available}"
        )

    return [
        {
            "name": refs[0]["name"],
            "description": (
                f"{refs[0]['description']}; Picture 1 identity reference only; keep the same character. "
                f"Scene outfit continuity: {FEMALE_OUTFIT}"
            ),
            "image_path": refs[0]["image_path"],
        },
        {
            "name": refs[1]["name"],
            "description": (
                f"{refs[1]['description']}; Picture 2 identity reference only; keep the same character. "
                f"Scene outfit continuity: {MALE_OUTFIT}"
            ),
            "image_path": refs[1]["image_path"],
        },
    ]


def _latest_png(out_prefix: str) -> Path | None:
    output_path = ROOT / "ComfyUI/output" / out_prefix
    matches: list[Path] = []
    if output_path.is_dir():
        matches.extend(output_path.glob("*.png"))

    # ComfyUI SaveImage treats output_prefix as a filename prefix, so a prefix
    # such as `sprites/heroine` is saved as `sprites/heroine_00001_.png`.
    if output_path.parent.exists():
        matches.extend(output_path.parent.glob(f"{output_path.name}_*.png"))

    unique_matches = {path.resolve(): path for path in matches}
    sorted_matches = sorted(
        unique_matches.values(),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return sorted_matches[0] if sorted_matches else None


def repair_yellow_skin_cast(path: Path) -> Path:
    """Repair the VNCCS male-sheet yellow chroma spill without changing identity."""
    image = Image.open(path).convert("RGBA")
    pixels = image.load()
    width, height = image.size

    shadow = (186, 116, 78)
    mid = (239, 184, 145)
    highlight = (255, 226, 202)

    changed = 0
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            yellow_skin = (
                r > 130
                and g > 105
                and b < 125
                and r >= g * 0.65
                and g >= r * 0.55
            )
            if not yellow_skin:
                continue

            lum = min(1.0, max(0.0, (0.60 * r + 0.35 * g + 0.05 * b) / 255.0))
            if lum < 0.58:
                t = lum / 0.58
                nr = round(shadow[0] * (1 - t) + mid[0] * t)
                ng = round(shadow[1] * (1 - t) + mid[1] * t)
                nb = round(shadow[2] * (1 - t) + mid[2] * t)
            else:
                t = (lum - 0.58) / 0.42
                nr = round(mid[0] * (1 - t) + highlight[0] * t)
                ng = round(mid[1] * (1 - t) + highlight[1] * t)
                nb = round(mid[2] * (1 - t) + highlight[2] * t)
            pixels[x, y] = (nr, ng, nb, a)
            changed += 1

    if changed == 0:
        return path

    repaired = path.with_name(f"{path.stem}_skin_repaired{path.suffix}")
    image.save(repaired)
    print(f"[sprite repair] yellow skin cast repaired: {repaired} ({changed} pixels)", flush=True)
    return repaired


async def generate_default_sprite(
    spec: dict,
    *,
    out_prefix: str,
    force: bool,
) -> dict:
    sprite_prefix = f"{out_prefix}/sprites/{spec['key']}"
    cached = None if force else _latest_png(sprite_prefix)
    if cached:
        print(f"[sprite {spec['key']}] reuse {cached}", flush=True)
        return {
            "name": spec["name"],
            "description": spec["ref_description"],
            "image_path": str(cached),
        }

    wf = patch_character_sheet(
        spec["name"],
        spec["description"],
        negative_prompt=(
            "low quality, worst quality, distorted anatomy, bad hands, bad face, cropped, "
            "watermark, text, inconsistent character, duplicate character, yellow skin, green skin, "
            "neon skin, chroma spill, unnatural skin color"
        ),
        params={
            "seed": 2026042500 + (1 if spec["key"] == "heroine" else 2),
            # Keep the original SeedVR2 upscale branch, but avoid WSL pinned-memory crashes.
            "seedvr2_resolution": 2048,
            "seedvr2_max_resolution": 2048,
            "seedvr2_blocks_to_swap": 8,
            "seedvr2_batch_size": 1,
            "seedvr2_cache_model": False,
        },
        character_fields=spec["fields"],
        output_prefix=sprite_prefix,
    )
    targets = find_output_targets(wf, title_contains="sheet") or find_output_targets(wf)
    print(f"[sprite {spec['key']}] queue", flush=True)
    output = await comfy.run_workflow(
        wf,
        kind="image",
        execution_targets=targets or None,
        on_event=progress_printer(f"sprite {spec['key']}"),
    )
    if spec.get("postprocess", {}).get("skin_cast_repair") == "yellow_to_peach":
        output = repair_yellow_skin_cast(output)
    print(f"[sprite {spec['key']}] {output}", flush=True)
    return {
        "name": spec["name"],
        "description": spec["ref_description"],
        "image_path": str(output),
    }


async def ensure_ready(*, include_sprite: bool, include_tts: bool) -> None:
    if not MMAUDIO_NSFW.exists():
        raise FileNotFoundError(f"NSFW MMAudio model missing: {MMAUDIO_NSFW}")

    required = [
        "LoadImage",
        "TextEncodeQwenImageEditPlus",
        "EmptyQwenImageLayeredLatentImage",
        "UnetLoaderGGUF",
        "FaceDetailer",
        "VHS_VideoCombine",
        "MMAudioSampler",
        "MMAudioModelLoader",
    ]
    if include_tts:
        required.extend(
            [
                "Qwen3Loader",
                "Qwen3DirectedCloneFromVoiceDesign",
                "Qwen3ClonePromptFromAudio",
                "Qwen3CustomVoiceFromPrompt",
                "AudioCropProcessUTK",
                "WanSoundImageToVideo",
                "GeekyAudioMixer",
            ]
        )
    if include_sprite:
        required.extend(_CHAR_IMAGE_REQUIRED_NODES)
    await comfy.ensure_nodes_available(required, context="romance smoke test")
    if include_sprite:
        _ensure_char_image_models("로맨스 샘플 스프라이트 생성")


def latest_output(out_prefix: str, glob_pattern: str) -> Path | None:
    root = ROOT / "ComfyUI/output" / out_prefix
    matches = sorted(root.glob(glob_pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    return matches[0] if matches else None


def cache_marker(out_prefix: str, name: str) -> Path:
    return ROOT / "ComfyUI/output" / out_prefix / f".{name}.selected"


def read_cached_selection(out_prefix: str, name: str) -> Path | None:
    marker = cache_marker(out_prefix, name)
    if not marker.exists():
        return None
    path = Path(marker.read_text(encoding="utf-8").strip())
    if path.exists():
        return path
    return None


def is_video_file(path: Path | None) -> bool:
    return path is not None and path.suffix.lower() in VIDEO_SUFFIXES


def write_cached_selection(out_prefix: str, name: str, path: Path) -> None:
    marker = cache_marker(out_prefix, name)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(str(path), encoding="utf-8")


def _wan_frame_count(target_seconds: float, fps: int) -> int:
    """Wan workflows are happiest with 4n+1 frame counts."""
    frames = max(33, round(target_seconds * fps))
    return max(33, 4 * round((frames - 1) / 4) + 1)


def build_render_spec(args: argparse.Namespace) -> dict:
    if args.quality_profile:
        render_spec = json.loads(Path(args.quality_profile).read_text(encoding="utf-8"))["render_spec"]
    else:
        render_spec = {
            "video": {
                "width": 832,
                "height": 480,
                "fps": 30,
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": 18,
            },
            "audio": {"sample_rate": 48000},
            "editing": {"transition_sec": 0.12},
            "target_duration_sec": 30.0,
        }

    video_spec = render_spec.setdefault("video", {})
    if args.width is not None:
        video_spec["width"] = int(args.width)
    if args.height is not None:
        video_spec["height"] = int(args.height)
    if args.fps is not None:
        video_spec["fps"] = float(args.fps)
    if args.crf is not None:
        video_spec["crf"] = int(args.crf)
    video_spec.setdefault("format", "video/h264-mp4")
    video_spec.setdefault("pix_fmt", "yuv420p")

    audio_spec = render_spec.setdefault("audio", {})
    if args.audio_sample_rate is not None:
        audio_spec["sample_rate"] = int(args.audio_sample_rate)
    editing_spec = render_spec.setdefault("editing", {})
    if args.transition_sec is not None:
        editing_spec["transition_sec"] = float(args.transition_sec)
    if args.transition_style == "cut":
        editing_spec["transition_sec"] = 0.0
    if args.duration_sec is not None:
        render_spec["target_duration_sec"] = float(args.duration_sec)

    fps = int(round(float(video_spec["fps"])))
    transition_sec = float(editing_spec.get("transition_sec", 0.12))
    scene_count = args.max_scenes if args.max_scenes and args.max_scenes > 0 else len(SCENES)
    target_duration = float(render_spec.get("target_duration_sec", 30.0))
    clip_seconds = (target_duration + transition_sec * max(0, scene_count - 1)) / scene_count
    render_spec["scene_frames"] = _wan_frame_count(clip_seconds, fps)
    render_spec["scene_clip_seconds"] = render_spec["scene_frames"] / fps
    return render_spec


def progress_printer(label: str):
    last_progress: tuple[str | None, int | None] = (None, None)

    async def _print(event: dict) -> None:
        nonlocal last_progress
        typ = event.get("type")
        if typ == "queued":
            print(f"[{label}] queued {event.get('prompt_id')}", flush=True)
        elif typ == "executing":
            node = event.get("node")
            if node is not None:
                print(f"[{label}] executing node {node}", flush=True)
        elif typ == "progress":
            key = (str(event.get("node")), event.get("progress_pct"))
            if key != last_progress and event.get("progress_pct") is not None:
                last_progress = key
                print(f"[{label}] {event.get('progress_pct')}%", flush=True)
        elif typ == "output_ready":
            print(f"[{label}] output {event.get('path')}", flush=True)
        elif typ == "freed":
            print(f"[{label}] freed models", flush=True)

    return _print


async def generate_voice(
    idx: int,
    dialogue: str,
    *,
    out_prefix: str,
    force: bool,
) -> Path:
    cache_name = f"scene_{idx:02d}_voice"
    cached = None if force else read_cached_selection(out_prefix, cache_name)
    if cached is None and not force:
        cached = latest_output(out_prefix, f"{cache_name}*.flac")
    if cached:
        print(f"[voice {idx}] reuse {cached}", flush=True)
        return cached

    wf = patch_voice_design(
        (
            "Natural Korean adult female visual novel voice, intimate but controlled, "
            "quiet bedroom-volume performance, soft breath before emotional phrases, "
            "slower pacing, realistic hesitation, no exaggerated anime acting, no robotic tone"
        ),
        sample_text=dialogue,
        language="Korean",
        params={
            "seed": 2026042800 + idx,
            "temperature": 0.72,
            "top_p": 0.9,
            "max_new_tokens": 2048,
            "x_vector_only_mode": True,
        },
        output_prefix=f"{out_prefix}/scene_{idx:02d}_voice",
    )
    print(f"[voice {idx}] queue", flush=True)
    path = await comfy.run_workflow(
        wf,
        kind="voice",
        on_event=progress_printer(f"voice {idx}"),
    )
    print(f"[voice {idx}] {path}", flush=True)
    write_cached_selection(out_prefix, cache_name, path)
    return path


async def generate_image(
    idx: int,
    character_refs: list[dict],
    prompt: str,
    *,
    out_prefix: str,
    force: bool,
    render_spec: dict,
    continuity_ref: Path | None = None,
) -> Path:
    cache_name = f"scene_{idx:02d}_image"
    cached = None if force else read_cached_selection(out_prefix, cache_name)
    if cached is None and not force:
        # Fallback for old runs before marker files existed. Prefer the first
        # SaveImage output because the original workflow can save intermediate
        # comparison/detailer images with the same prefix later in the run.
        root = ROOT / "ComfyUI/output" / out_prefix
        matches = sorted(root.glob(f"{cache_name}_*.png"))
        cached = matches[0] if matches else None
    if cached:
        print(f"[image {idx}] reuse {cached}", flush=True)
        write_cached_selection(out_prefix, cache_name, cached)
        return cached

    print(f"[image {idx}] queue", flush=True)
    video_spec = render_spec["video"]
    scene_prompt = (
        f"{STYLE_BIBLE}. {ROLE_LOCK}. Shot grammar: {SCENES[idx - 1].get('shot', 'intimate VN shot')}. "
        f"{prompt}. Preserve the exact same heroine and hero identities from the character references. "
        "The heroine's small dark beauty mark under her left eye must remain visible in every close shot. "
        f"Keep outfit continuity unless this prompt explicitly changes it: heroine wears {FEMALE_OUTFIT}; "
        f"hero wears {MALE_OUTFIT}. Keep the same apartment/bedroom geography across shots, "
        "same wall color, same bedding color, same lighting direction, and same emotional continuity."
    )
    wf = patch_image(
        prompt=scene_prompt,
        character_refs=character_refs,
        visual_refs=[str(continuity_ref)] if continuity_ref else None,
        workflow="qwen_edit",
        resolution=(int(video_spec["width"]), int(video_spec["height"])),
        params={
            "seed": 2026042600 + idx,
            "steps": 10,
            "cfg": 1.0,
            "detailer_steps": 4,
            "bbox_threshold": 0.99,
            "detailer_drop_size": 9999,
            "face_detailer_steps": 4,
            "face_detailer_bbox_threshold": 0.99,
            "face_detailer_drop_size": 9999,
            "body_detailer_steps": 4,
            "body_detailer_bbox_threshold": 0.99,
            "body_detailer_drop_size": 9999,
            "hand_detailer_steps": 4,
            "hand_detailer_bbox_threshold": 0.99,
            "hand_detailer_drop_size": 9999,
            # Match Qwen layers to the actual references: 2 character sheets plus
            # an optional continuity frame. Extra empty layers can amplify detector
            # false positives in the original detailer chain.
            "qwen_layers": 2 + (1 if continuity_ref else 0),
            "continuity_reference": True,
        },
        negative_prompt=NEGATIVE_IMAGE_PROMPT,
        output_prefix=f"{out_prefix}/scene_{idx:02d}_image",
    )
    targets = find_output_targets(wf)
    path = await comfy.run_workflow(
        wf,
        kind="image",
        execution_targets=targets or None,
        on_event=progress_printer(f"image {idx}"),
    )
    print(f"[image {idx}] {path}", flush=True)
    write_cached_selection(out_prefix, cache_name, path)
    return path


async def generate_video(
    idx: int,
    image: Path,
    scene: dict,
    *,
    out_prefix: str,
    force: bool,
    render_spec: dict,
    voice_path: Path | None = None,
) -> Path:
    cache_name = f"scene_{idx:02d}_video"
    cached = None if force else read_cached_selection(out_prefix, cache_name)
    target_seconds = float(render_spec["scene_clip_seconds"])
    if cached and not is_video_file(cached):
        print(f"[video {idx}] ignore non-video cache {cached}", flush=True)
        cached = None
    if cached is None and not force:
        cached = latest_output(out_prefix, f"{cache_name}*-audio.mp4") or latest_output(out_prefix, f"{cache_name}*.mp4")
    if cached:
        actual_seconds = ffmpeg_utils.get_duration(cached)
        tolerance = max(0.75, target_seconds * 0.35)
        if abs(actual_seconds - target_seconds) > tolerance:
            print(
                f"[video {idx}] ignore stale-duration cache {cached} "
                f"({actual_seconds:.2f}s != target {target_seconds:.2f}s)",
                flush=True,
            )
            cached = None
        else:
            print(f"[video {idx}] reuse {cached}", flush=True)
            write_cached_selection(out_prefix, cache_name, cached)
            return cached
    print(f"[video {idx}] queue", flush=True)
    video_spec = render_spec["video"]
    params = {
        "seed": 2026042700 + idx,
        "steps": int(render_spec.get("video_steps", 6)),
        "cfg": 1.0,
        "frames": int(render_spec["scene_frames"]),
        "fps": int(round(float(video_spec["fps"]))),
        "width": int(video_spec["width"]),
        "height": int(video_spec["height"]),
        "i2v_refiner_start_step": 2,
        "mmaudio_enabled": True,
        "mmaudio_model": "mmaudio_large_44k_nsfw_gold_8.5k_final_fp16.safetensors",
        "mmaudio_duration": float(render_spec["scene_clip_seconds"]),
        "mmaudio_steps": 16,
        "mmaudio_cfg": 4.0,
        "mmaudio_negative_prompt": "talking, speech, voice, voices, singing, music, words, laughter, robotic, low quality",
        "sfx_volume": 0.28,
        "video_format": video_spec.get("format", "video/h264-mp4"),
        "pix_fmt": video_spec.get("pix_fmt", "yuv420p"),
        "crf": int(video_spec.get("crf", 18)),
        "voice_volume": 1.0,
        "audio_output_duration": float(render_spec["scene_clip_seconds"]),
        "s2v_audio_duration": float(render_spec["scene_clip_seconds"]),
        "motion_prompt": scene.get("motion") or scene.get("effect") or (
            "natural VN performance with visible body language, changing gaze, head movement, "
            "small hand movement, breathing, fabric and hair motion"
        ),
        "gesture_prompt": (
            "mouth, blinking, gaze, head angle, shoulders, hands and breathing react naturally "
            "to the emotion of the shot"
        ),
        "camera_motion_prompt": scene.get("effect") or "subtle cinematic camera push-in with parallax",
        "audio_sync_prompt": (
            "Synchronize mouth, gaze, head, shoulders, hand gestures, breathing and posture to "
            "the Korean dialogue timing and MMAudio sound-effect beats."
        ),
        "motion_negative_prompt": (
            "static body, frozen pose, only lips moving, disconnected voice, off-beat gestures, "
            "dead eyes, mannequin motion"
        ),
    }
    if voice_path and scene.get("lipsync"):
        wf = patch_video_lipsync(
            image_path=str(image),
            voice_path=str(voice_path),
            bg_prompt=f"{STYLE_BIBLE}. {scene['prompt']}. {scene.get('effect', '')}.",
            sfx_prompt=scene["sfx"],
            params={
                **params,
                "s2v_refiner_start_step": 2,
                "sampler": "euler",
                "scheduler": "simple",
            },
            output_prefix=f"{out_prefix}/scene_{idx:02d}_video",
        )
    elif scene["kind"] == "effect":
        wf = patch_video_effect(
            image_path=str(image),
            effect_prompt=scene["effect"],
            sfx_prompt=scene["sfx"],
            params={**params, **({"voice_path": str(voice_path)} if voice_path else {})},
            output_prefix=f"{out_prefix}/scene_{idx:02d}_video",
        )
    elif scene["kind"] == "basic":
        wf = patch_video_basic(
            image_path=str(image),
            bg_prompt=f"{STYLE_BIBLE}. {scene['prompt']}. {scene.get('effect', 'cinematic character performance with visible body language')}.",
            sfx_prompt=scene["sfx"],
            params={**params, **({"voice_path": str(voice_path)} if voice_path else {})},
            output_prefix=f"{out_prefix}/scene_{idx:02d}_video",
        )
    else:
        wf = patch_video_loop(
            image_path=str(image),
            bg_prompt=f"{STYLE_BIBLE}. {scene['prompt']}. {scene.get('effect', 'natural VN character motion')}.",
            sfx_prompt=scene["sfx"],
            params={**params, **({"voice_path": str(voice_path)} if voice_path else {})},
            output_prefix=f"{out_prefix}/scene_{idx:02d}_video",
        )
    targets = find_video_output_targets(wf)
    path = await comfy.run_workflow(
        wf,
        kind="video",
        execution_targets=targets or None,
        on_event=progress_printer(f"video {idx}"),
    )
    if not is_video_file(path):
        raise RuntimeError(f"Video workflow returned a non-video output: {path}")
    print(f"[video {idx}] {path}", flush=True)
    write_cached_selection(out_prefix, cache_name, path)
    return path


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--female-sprite", help="Female character *_sprite.png path, relative to repo root or absolute.")
    parser.add_argument("--male-sprite", help="Male character *_sprite.png path, relative to repo root or absolute.")
    parser.add_argument("--prefix", default="myaniform/adult_vn_directed_832x480_30s")
    parser.add_argument("--output", default="output/adult_vn_directed_832x480_30s.mp4")
    parser.add_argument(
        "--quality-profile",
        default=None,
        help="Optional quality profile JSON. Width/height/fps/duration args override it only when explicitly provided.",
    )
    parser.add_argument("--width", type=int, default=None)
    parser.add_argument("--height", type=int, default=None)
    parser.add_argument("--fps", type=float, default=None)
    parser.add_argument("--duration-sec", type=float, default=None)
    parser.add_argument("--transition-sec", type=float, default=None)
    parser.add_argument(
        "--transition-style",
        choices=("cut", "fade"),
        default=None,
        help="Final edit transition style. Quality-profile runs default to cut so shot density matches VN references.",
    )
    parser.add_argument("--audio-sample-rate", type=int, default=None)
    parser.add_argument("--crf", type=int, default=None)
    parser.add_argument("--no-tts", action="store_true", help="Generate video with MMAudio SFX only, without Qwen TTS/S2V lipsync.")
    parser.add_argument("--skip-auto-sprites", action="store_true", help="Fail instead of generating default sprites when no sprite refs exist.")
    parser.add_argument("--sprites-only", action="store_true", help="Generate/reuse character sprites and stop before scene frames.")
    parser.add_argument("--images-only", action="store_true", help="Generate/reuse character sprites and scene keyframes, then stop before video.")
    parser.add_argument("--max-scenes", type=int, default=0, help="Limit the number of scenes to generate for inspection.")
    parser.add_argument(
        "--use-previous-frame-ref",
        action="store_true",
        help="Use the previous generated frame as a Qwen visual reference. Keep off for new shots; enable for continuous shots.",
    )
    parser.add_argument("--force", action="store_true", help="Ignore cached ComfyUI outputs and regenerate every scene.")
    args = parser.parse_args()
    if args.transition_style is None:
        args.transition_style = "cut" if args.quality_profile else "fade"

    needs_auto_sprites = not (args.female_sprite and args.male_sprite)
    await ensure_ready(
        include_sprite=needs_auto_sprites and not args.skip_auto_sprites,
        include_tts=not args.no_tts,
    )
    render_spec = build_render_spec(args)
    print(
        "[target] "
        f"{render_spec['video']['width']}x{render_spec['video']['height']} "
        f"{render_spec['video']['fps']}fps, "
        f"{render_spec['target_duration_sec']:.1f}s target, "
        f"{render_spec['scene_frames']} frames/scene",
        flush=True,
    )
    try:
        character_refs = romance_character_refs(args.female_sprite, args.male_sprite)
    except RuntimeError:
        if args.skip_auto_sprites:
            raise
        print("[sprite] DB/CLI 스프라이트가 없어 기본 여성/남성 캐릭터 시트를 먼저 생성합니다.", flush=True)
        character_refs = [
            await generate_default_sprite(spec, out_prefix=args.prefix, force=args.force)
            for spec in DEFAULT_CHARACTERS
        ]
    for idx, ref in enumerate(character_refs, start=1):
        print(f"[ref {idx}] {ref['name']} {ref['image_path']}", flush=True)
    if args.sprites_only:
        print("[stop] sprites-only", flush=True)
        return

    clips: list[Path] = []
    previous_image: Path | None = None
    scenes = SCENES[: args.max_scenes] if args.max_scenes and args.max_scenes > 0 else SCENES
    generated_images: list[Path] = []
    for idx, scene in enumerate(scenes, start=1):
        image = await generate_image(
            idx,
            character_refs,
            scene["prompt"],
            out_prefix=args.prefix,
            force=args.force,
            render_spec=render_spec,
            continuity_ref=previous_image if args.use_previous_frame_ref else None,
        )
        generated_images.append(image)
        previous_image = image
        if args.images_only:
            continue
        voice = None
        if not args.no_tts and scene.get("dialogue"):
            voice = await generate_voice(idx, scene["dialogue"], out_prefix=args.prefix, force=args.force)
        clip = await generate_video(
            idx,
            image,
            scene,
            out_prefix=args.prefix,
            force=args.force,
            render_spec=render_spec,
            voice_path=voice,
        )
        clips.append(clip)
    if args.images_only:
        print("[frames]", flush=True)
        for path in generated_images:
            print(path, flush=True)
        print("[stop] images-only", flush=True)
        return

    fps = int(round(float(render_spec["video"]["fps"])))
    transition_sec = float(render_spec.get("editing", {}).get("transition_sec", 0.35))
    transition_frames = 0 if args.transition_style == "cut" else max(1, round(transition_sec * fps))
    final_output = Path(args.output)
    if not final_output.is_absolute():
        final_output = ROOT / final_output
    rough_final = ffmpeg_utils.concat(
        clips,
        project_id=f"{final_output.stem}_rough",
        transition=args.transition_style,
        fps=fps,
        duration_frames=transition_frames,
        audio_sample_rate=int(render_spec.get("audio", {}).get("sample_rate", 48000)),
    )
    final = ffmpeg_utils.finish_visual_novel_episode(
        rough_final,
        output=final_output,
        subtitles=[scene.get("dialogue", "") for scene in scenes],
        scene_durations=[ffmpeg_utils.get_duration(clip) for clip in clips],
        transition_sec=transition_sec,
        width=int(render_spec["video"]["width"]),
        height=int(render_spec["video"]["height"]),
        audio_sample_rate=int(render_spec.get("audio", {}).get("sample_rate", 48000)),
        target_lufs=render_spec.get("audio", {}).get("target_lufs"),
        loudness_range_lu=render_spec.get("audio", {}).get("loudness_range_lu"),
        subtitle_style={
            "font_size": 28,
            "margin_v": 24,
            "outline": 2.1,
            "shadow": 0.0,
        },
    )
    print(f"[final] {final}", flush=True)
    if args.quality_profile:
        profile = json.loads(Path(args.quality_profile).read_text(encoding="utf-8"))
        quality = compare_to_profile(profile, final)
        quality_path = final.with_suffix(".quality.json")
        quality_path.write_text(json.dumps(quality, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[quality] {quality_path}", flush=True)
        if not quality["ok"]:
            failed = ", ".join(check["name"] for check in quality["checks"] if not check["ok"])
            raise RuntimeError(f"quality profile check failed: {failed}")


if __name__ == "__main__":
    asyncio.run(main())
