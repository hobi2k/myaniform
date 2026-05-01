"""워크플로우 JSON 동적 패칭.

- 원본 런타임 워크플로우만 사용한다.
- 임의 축약/간이 워크플로우는 사용하지 않는다.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Optional

from .model_catalog import (
    IL_FLAT_MIX_CKPT_NAME,
    MMAUDIO_SFW_MODEL,
    QWEN_IMAGE_EDIT_UNET,
    QWEN_IMAGE_LIGHTNING_LORA,
    QWEN_IMAGE_TEXT_ENCODER,
    QWEN_IMAGE_VAE,
    QWEN_VNCCS_CLOTHES_LORA,
    QWEN_VNCCS_POSE_LORA,
    S2V_FASTFIDELITY_MODEL,
)
from .ui_workflow_adapter import load_ui_workflow_as_api_prompt
from .workflow_catalog import ORIGINAL_WORKFLOWS, WORKFLOWS_DIR, resolve_original_workflow_path

_COMFY_INPUT = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "input"


def _original_workflow_path(name: str) -> Path:
    return resolve_original_workflow_path(name)


def _sanitize_workflow_graph(raw: dict) -> dict:
    """ComfyUI API 에 전달 가능한 실행 노드만 남긴다.

    UI export 에는 최상위 `_meta`, `extra`, `version` 같은 실행 불가 엔트리가
    섞일 수 있다. ComfyUI /prompt 는 각 top-level item 을 노드로 해석하므로
    `class_type` 이 없는 항목은 사전에 제거해야 한다.
    """
    cleaned: dict = {}
    for node_id, node in raw.items():
        if not isinstance(node, dict):
            continue
        if "class_type" not in node or not node.get("class_type"):
            continue
        if node.get("class_type") in {"Note", "MarkdownNote", "Fast Groups Bypasser (rgthree)"}:
            continue
        cleaned[str(node_id)] = node
    return cleaned


def _normalize_model_path_values(wf: dict) -> dict:
    for node in wf.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        for key, value in list(inputs.items()):
            if isinstance(value, str) and "\\" in value:
                inputs[key] = value.replace("\\", "/")
    return wf


def _normalize_compat_node_types(wf: dict) -> dict:
    """Map older ComfyUI class_type names to installed equivalent nodes."""
    for node in wf.values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") == "Text Concatenate":
            node["class_type"] = "TextConcatenate_UTK"
            inputs = node.setdefault("inputs", {})
            inputs.setdefault("delimiter", "")
            inputs.setdefault("clean_whitespace", "true")
        elif node.get("class_type") == "Text Find and Replace":
            node["class_type"] = "StringFunction|pysssss"
            inputs = node.setdefault("inputs", {})
            inputs["text_a"] = inputs.pop("text", "")
            inputs["text_b"] = inputs.pop("find", "")
            inputs["text_c"] = inputs.pop("replace", "")
            inputs["action"] = "replace"
            inputs["tidy_tags"] = "no"
    return wf


def _fill_known_required_defaults(wf: dict) -> dict:
    for node in wf.values():
        if not isinstance(node, dict):
            continue
        cls = node.get("class_type")
        inp = node.setdefault("inputs", {})
        if cls == "UltimateSDUpscale":
            inp.setdefault("batch_size", 1)
        elif cls == "Efficient Loader 💬ED":
            inp.setdefault("ckpt_name", IL_FLAT_MIX_CKPT_NAME)
            inp.setdefault("vae_name", "Baked VAE")
            inp.setdefault("clip_skip", -2)
            inp.setdefault("paint_mode", "✍️ Txt2Img")
            inp.setdefault("batch_size", 1)
            inp.setdefault("seed", 0)
            inp.setdefault("cfg", 5.0)
            inp.setdefault("sampler_name", "euler_ancestral")
            inp.setdefault("scheduler", "sgm_uniform")
            inp.setdefault("image_width", 832)
            inp.setdefault("image_height", 1216)
        elif cls == "KSampler (Efficient) 💬ED":
            inp.setdefault("set_seed_cfg_sampler", "from node only")
            inp.setdefault("seed", 0)
            inp.setdefault("steps", 30)
            inp.setdefault("cfg", 5.0)
            inp.setdefault("sampler_name", "euler_ancestral")
            inp.setdefault("scheduler", "sgm_uniform")
            inp.setdefault("denoise", 1.0)
    return wf


def load_workflow(name: str) -> dict:
    path = WORKFLOWS_DIR / name
    raw = json.loads(path.read_text(encoding="utf-8"))
    return _sanitize_workflow_graph(raw)


def load_original_workflow(name: str) -> dict:
    wf = load_ui_workflow_as_api_prompt(_original_workflow_path(name))
    wf = _sanitize_workflow_graph(wf)
    wf = _normalize_model_path_values(wf)
    wf = _normalize_compat_node_types(wf)
    return _fill_known_required_defaults(wf)


def _stage_ref(path: Optional[str], prefix: str) -> Optional[str]:
    """이미지/오디오 레퍼런스를 ComfyUI/input 에 복사하고 파일명 반환."""
    if not path:
        return None
    src = Path(path)
    if not src.exists():
        candidate = _COMFY_INPUT / path
        if candidate.exists():
            return path
        return None
    _COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    dst_name = f"{prefix}{src.suffix}"
    shutil.copy(src, _COMFY_INPUT / dst_name)
    return dst_name


def _iter_nodes(wf: dict):
    for node in wf.values():
        if isinstance(node, dict):
            yield node


def _title(node: dict) -> str:
    return node.get("_meta", {}).get("title", "")


def find_output_targets(
    wf: dict,
    *,
    class_type: str = "SaveImage",
    title_contains: str | None = None,
) -> list[str]:
    targets: list[str] = []
    needle = title_contains.lower() if title_contains else None
    for node_id, node in wf.items():
        if node.get("class_type") != class_type:
            continue
        if needle and needle not in _title(node).lower():
            continue
        targets.append(str(node_id))
    return targets


def find_video_output_targets(wf: dict) -> list[str]:
    """Return final video output nodes, avoiding intermediate SaveImage outputs."""
    preferred: list[str] = []
    fallback: list[str] = []
    for node_id, node in wf.items():
        if node.get("class_type") != "VHS_VideoCombine":
            continue
        inputs = node.get("inputs", {})
        if inputs.get("save_output") is False:
            continue
        images = inputs.get("images")
        source = wf.get(str(images[0])) if isinstance(images, list) and images else None
        source_class = (source or {}).get("class_type", "")
        title = _title(node).lower()
        target = str(node_id)
        if source_class in ("RIFE VFI", "ImageScaleBy", "ColorMatch") or any(
            token in title for token in ("final", "upscale", "interpolation", "rife")
        ):
            preferred.append(target)
        else:
            fallback.append(target)
    return preferred or fallback or find_output_targets(wf, class_type="VHS_VideoCombine")


def _loads(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _apply_filename_prefixes(
    wf: dict,
    *,
    default_prefix: str | None = None,
    title_prefix_map: dict[str, str] | None = None,
) -> None:
    title_prefix_map = title_prefix_map or {}
    normalized_map = {k.lower(): v for k, v in title_prefix_map.items()}
    for node in _iter_nodes(wf):
        inputs = node.setdefault("inputs", {})
        title = _title(node).lower()
        cls = node.get("class_type", "")
        if cls == "VHS_VideoCombine":
            if default_prefix:
                inputs["filename_prefix"] = default_prefix
                inputs.setdefault("save_output", True)
            continue
        if "filename_prefix" not in inputs:
            continue
        for needle, prefix in normalized_map.items():
            if needle in title:
                inputs["filename_prefix"] = prefix
                break
        else:
            if default_prefix:
                inputs["filename_prefix"] = default_prefix


# ── 단계 1: TTS ────────────────────────────────────────────────────────

def patch_voice(
    dialogue: str,
    voice_sample: Optional[str],
    tts_engine: str,
    voice_design_text: Optional[str] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    staged_voice = _stage_ref(voice_sample, "voicesample") if voice_sample else None

    if tts_engine == "s2pro" and staged_voice:
        wf = load_workflow("ws_tts_s2pro.json")
        for node in _iter_nodes(wf):
            cls = node.get("class_type", "")
            inp = node.setdefault("inputs", {})
            if cls == "LoadAudio":
                inp["audio"] = staged_voice
            elif cls == "FishS2VoiceCloneTTS":
                inp["text"] = dialogue
        _apply_filename_prefixes(wf, default_prefix=output_prefix)
        return wf

    if staged_voice and tts_engine == "qwen3":
        wf = load_workflow("ws_tts_clone.json")
        for node in _iter_nodes(wf):
            cls = node.get("class_type", "")
            inp = node.setdefault("inputs", {})
            if cls == "LoadAudio":
                inp["audio"] = staged_voice
            elif cls == "Qwen3CustomVoiceFromPrompt":
                inp["text"] = dialogue
        _apply_filename_prefixes(wf, default_prefix=output_prefix)
        return wf

    wf = load_workflow("ws_voice_design.json")
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls == "Qwen3DirectedCloneFromVoiceDesign":
            inp["design_text"] = dialogue
            inp["target_text"] = dialogue
            if voice_design_text:
                inp["design_instruct"] = voice_design_text
    _apply_filename_prefixes(wf, default_prefix=output_prefix)
    return wf


# ── 단계 2: 이미지 ────────────────────────────────────────────────────

def build_multi_ref_prompt(
    character_descs: list[tuple[str, str]],
    scene_desc: str,
) -> str:
    """멀티 레퍼런스 앵커링 프롬프트 생성.
    character_descs = [(name, description), ...]  — 길이 N
    Qwen Edit Plus 의 image1/image2/… 와 1:1 매칭되도록 "Picture 1/2/…" 로 라벨링.
    """
    if not character_descs:
        return scene_desc.strip(", ")

    parts: list[str] = []
    n = len(character_descs)
    for i, (name, desc) in enumerate(character_descs, 1):
        name_part = f"({name})" if name else ""
        desc_part = desc or "character"
        parts.append(f"Picture {i} shows {name_part} {desc_part}".strip())

    if n == 1:
        head = parts[0]
    elif n == 2:
        head = f"{parts[0]}. {parts[1]}. Both characters appear together in the same scene"
    else:
        head = ". ".join(parts) + f". All {n} characters appear together in the same scene"

    scene = scene_desc.strip(", ")
    if scene:
        head = f"{head}. {scene}"
    return head


def _apply_image_params(wf: dict, params: dict, resolution: tuple[Optional[int], Optional[int]]) -> None:
    """KSampler/EmptyLatent/LoraLoader 슬롯에 사용자 파라미터 주입.
    지원 필드: steps, cfg, sampler, scheduler, seed, denoise, loras[],
    detailer_*, bbox_*, sam_*.
    워크플로우에 해당 노드가 없으면 조용히 스킵."""
    w, h = resolution
    # 샘플러 계열
    ksampler_fields = {
        "steps": "steps", "cfg": "cfg",
        "sampler": "sampler_name", "scheduler": "scheduler",
        "seed": "seed", "denoise": "denoise",
    }
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls in ("KSampler", "KSamplerAdvanced", "KSampler (Efficient) 💬ED"):
            for k, mapped in ksampler_fields.items():
                if k in params and mapped in inp:
                    inp[mapped] = params[k]
        if cls == "Efficient Loader 💬ED":
            for k, mapped in ksampler_fields.items():
                if k in params and mapped in inp:
                    inp[mapped] = params[k]
            if w and "image_width" in inp:
                inp["image_width"] = int(w)
            if h and "image_height" in inp:
                inp["image_height"] = int(h)
        if cls in ("EmptyLatentImage", "EmptyQwenImageLayeredLatentImage", "EmptySD3LatentImage"):
            if w and "width" in inp:
                inp["width"] = int(w)
            if h and "height" in inp:
                inp["height"] = int(h)
        if cls in ("VNCCSSheetManager",):
            if w and "target_width" in inp:
                inp["target_width"] = int(w)
            if h and "target_height" in inp:
                inp["target_height"] = int(h)
        if cls == "FaceDetailer":
            title = _title(node).lower()
            detailer_fields = {
                "detailer_steps": "steps",
                "detailer_cfg": "cfg",
                "detailer_denoise": "denoise",
                "detailer_guide_size": "guide_size",
                "detailer_max_size": "max_size",
                "bbox_threshold": "bbox_threshold",
                "bbox_dilation": "bbox_dilation",
                "bbox_crop_factor": "bbox_crop_factor",
                "sam_threshold": "sam_threshold",
                "noise_mask_feather": "noise_mask_feather",
                "detailer_drop_size": "drop_size",
            }
            for k, mapped in detailer_fields.items():
                if k in params and mapped in inp:
                    inp[mapped] = params[k]
            if "face" in title or "페이스" in title:
                role_prefix = "face_detailer"
            elif "hand" in title or "핸드" in title:
                role_prefix = "hand_detailer"
            elif "body" in title or "바디" in title:
                role_prefix = "body_detailer"
            else:
                role_prefix = ""
            if role_prefix:
                role_fields = {
                    f"{role_prefix}_steps": "steps",
                    f"{role_prefix}_bbox_threshold": "bbox_threshold",
                    f"{role_prefix}_drop_size": "drop_size",
                    f"{role_prefix}_denoise": "denoise",
                }
                for k, mapped in role_fields.items():
                    if k in params and mapped in inp:
                        inp[mapped] = params[k]

    # LoRA 스택 주입 — 선택된 항목만 앞 슬롯에 압축하고 빈 슬롯은 그래프에서 우회
    raw_loras = params.get("loras") or []
    loras = [l for l in raw_loras if (l or {}).get("name") not in (None, "", "None")]
    for node in _iter_nodes(wf):
        if node.get("class_type") != "LoRA Stacker":
            continue
        inp = node.setdefault("inputs", {})
        inp["input_mode"] = "simple"
        inp["lora_count"] = min(len(loras), 50)
        for i in range(1, 51):
            if i <= len(loras):
                lora = loras[i - 1]
                strength = float(lora.get("strength", 1.0))
                inp[f"lora_name_{i}"] = lora["name"]
                inp[f"lora_wt_{i}"] = strength
                inp[f"model_str_{i}"] = strength
                inp[f"clip_str_{i}"] = strength
            else:
                inp[f"lora_name_{i}"] = "None"
                inp[f"lora_wt_{i}"] = 1.0
                inp[f"model_str_{i}"] = 1.0
                inp[f"clip_str_{i}"] = 1.0

    slot_ids = ("2", "3", "4")
    current_upstream = "1"
    for i, slot_id in enumerate(slot_ids):
        node = wf.get(slot_id)
        if not node or node.get("class_type") != "LoraLoader":
            continue
        inp = node.setdefault("inputs", {})
        if i < len(loras):
            inp["model"] = [current_upstream, 0]
            inp["clip"] = [current_upstream, 1]
            inp["lora_name"] = loras[i]["name"]
            inp["strength_model"] = float(loras[i].get("strength", 1.0))
            inp["strength_clip"] = float(loras[i].get("strength", 1.0))
            current_upstream = slot_id
            continue

        # 남은 슬롯은 아예 우회해서 invalid lora_name 검증을 피한다.
        for other in _iter_nodes(wf):
            other_inputs = other.get("inputs", {})
            for key, value in list(other_inputs.items()):
                if value == [slot_id, 0]:
                    other_inputs[key] = [current_upstream, 0]
                elif value == [slot_id, 1]:
                    other_inputs[key] = [current_upstream, 1]
        wf.pop(slot_id, None)


def _apply_image_model(wf: dict, model_name: Optional[str], *, qwen_only: bool = False) -> None:
    if not model_name:
        return
    is_gguf = model_name.lower().endswith(".gguf")
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls == "CheckpointLoaderSimple" and not qwen_only and "ckpt_name" in inp:
            if is_gguf:
                continue
            inp["ckpt_name"] = model_name
        elif cls == "Efficient Loader 💬ED" and not qwen_only and "ckpt_name" in inp:
            if is_gguf:
                continue
            inp["ckpt_name"] = model_name
        elif cls == "UnetLoaderGGUF" and "unet_name" in inp:
            if not is_gguf:
                continue
            inp["unet_name"] = model_name
        elif cls == "UNETLoader" and "unet_name" in inp:
            if is_gguf:
                continue
            inp["unet_name"] = model_name


def _set_original_image_prompt_nodes(
    wf: dict,
    *,
    prompt: str,
    negative_prompt: Optional[str],
) -> None:
    default_negative = (
        "worst quality, low quality, blurry, deformed, bad anatomy, extra limbs, "
        "watermark, text, subtitles"
    )
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        title = _title(node)
        inp = node.setdefault("inputs", {})
        if cls == "StringFunction|pysssss":
            inp["text_a"] = prompt or inp.get("text_a", "")
            inp["text_b"] = ""
            inp["text_c"] = ""
        elif cls == "Simple Text 💬ED" and "부정값" in title:
            inp["text"] = negative_prompt or inp.get("text") or default_negative


def _inject_qwen_reference_branch_into_original(
    wf: dict,
    *,
    staged_refs: list[str],
    prompt: str,
    negative_prompt: Optional[str],
    resolution: tuple[Optional[int], Optional[int]],
    params: dict,
) -> None:
    if not staged_refs:
        return

    next_id = max(int(node_id) for node_id in wf.keys()) + 1

    def add_node(class_type: str, inputs: dict, title: str) -> str:
        nonlocal next_id
        node_id = str(next_id)
        next_id += 1
        wf[node_id] = {
            "class_type": class_type,
            "inputs": inputs,
            "_meta": {"title": title},
        }
        return node_id

    ref_ids: list[str] = []
    for idx, ref in enumerate(staged_refs, start=1):
        ref_ids.append(
            add_node(
                "LoadImage",
                {"image": ref},
                f"Qwen 캐릭터 레퍼런스 {idx}",
            )
        )

    clip = add_node(
        "CLIPLoader",
        {
            "clip_name": QWEN_IMAGE_TEXT_ENCODER,
            "type": "qwen_image",
            "device": "default",
        },
        "Qwen 2.5 VL Text Encoder",
    )
    vae = add_node(
        "VAELoader",
        {"vae_name": QWEN_IMAGE_VAE},
        "Qwen Image VAE",
    )
    unet = add_node(
        "UnetLoaderGGUF",
        {"unet_name": QWEN_IMAGE_EDIT_UNET},
        "Qwen Image Edit (GGUF Q5_0)",
    )
    lora_lightning = add_node(
        "LoraLoader",
        {
            "model": [unet, 0],
            "clip": [clip, 0],
            "lora_name": QWEN_IMAGE_LIGHTNING_LORA,
            "strength_model": float(params.get("qwen_lightning_strength", 1.0) or 1.0),
            "strength_clip": float(params.get("qwen_lightning_strength", 1.0) or 1.0),
        },
        "Lightning 4-step distill LoRA",
    )
    lora_pose = add_node(
        "LoraLoader",
        {
            "model": [lora_lightning, 0],
            "clip": [lora_lightning, 1],
            "lora_name": QWEN_VNCCS_POSE_LORA,
            "strength_model": float(params.get("qwen_pose_strength", 1.0) or 1.0),
            "strength_clip": float(params.get("qwen_pose_strength", 1.0) or 1.0),
        },
        "Pose transfer LoRA",
    )
    lora_clothes = add_node(
        "LoraLoader",
        {
            "model": [lora_pose, 0],
            "clip": [lora_pose, 1],
            "lora_name": QWEN_VNCCS_CLOTHES_LORA,
            "strength_model": float(params.get("qwen_clothes_strength", 0.8) or 0.8),
            "strength_clip": float(params.get("qwen_clothes_strength", 1.0) or 1.0),
        },
        "Clothes preserve LoRA",
    )

    qwen_positive_inputs = {
        "clip": [lora_clothes, 1],
        "vae": [vae, 0],
        "prompt": prompt,
    }
    for idx, ref_id in enumerate(ref_ids, start=1):
        qwen_positive_inputs[f"image{idx}"] = [ref_id, 0]

    qwen_positive = add_node(
        "TextEncodeQwenImageEditPlus",
        qwen_positive_inputs,
        "Qwen Positive (참조 일관성)",
    )
    qwen_negative_text = negative_prompt or (
        "worst quality, low quality, blurry, deformed, extra limbs, "
        "bad anatomy, different character, watermark, text"
    )
    qwen_negative = add_node(
        "TextEncodeQwenImageEditPlus",
        {
            "clip": [lora_clothes, 1],
            "vae": [vae, 0],
            "prompt": qwen_negative_text,
        },
        "Qwen Negative",
    )

    width = int(resolution[0]) if resolution[0] else 832
    height = int(resolution[1]) if resolution[1] else 1216
    qwen_layers = (
        max(1, int(params["qwen_layers"]))
        if "qwen_layers" in params
        else len(ref_ids) + 1
    )
    latent = add_node(
        "EmptyQwenImageLayeredLatentImage",
        {
            "width": width,
            "height": height,
            "layers": qwen_layers,
            "batch_size": 1,
        },
        "Qwen 레퍼런스 latent",
    )
    qwen_ksampler = add_node(
        "KSamplerAdvanced",
        {
            "model": [lora_clothes, 0],
            "positive": [qwen_positive, 0],
            "negative": [qwen_negative, 0],
            "latent_image": [latent, 0],
            "add_noise": "enable",
            "noise_seed": int(params.get("seed", 0) or 0),
            "control_after_generate": "randomize" if "seed" not in params else "fixed",
            "steps": int(params.get("steps", 4) or 4),
            "cfg": float(params.get("cfg", 1.0) or 1.0),
            "sampler_name": params.get("sampler", "euler") or "euler",
            "scheduler": params.get("scheduler", "simple") or "simple",
            "start_at_step": int(params.get("qwen_start_at_step", 0) or 0),
            "end_at_step": int(params.get("qwen_end_at_step", 10000) or 10000),
            "return_with_leftover_noise": "disable",
        },
        "Qwen KSampler",
    )
    qwen_decode = add_node(
        "VAEDecode",
        {
            "samples": [qwen_ksampler, 0],
            "vae": [vae, 0],
        },
        "Qwen VAE Decode",
    )

    if "4" in wf and wf["4"].get("class_type") == "FaceDetailer":
        wf["4"].setdefault("inputs", {})["image"] = [qwen_decode, 0]
    if "1" in wf and wf["1"].get("class_type") == "Image Comparer (rgthree)":
        wf["1"].setdefault("inputs", {})["image_b"] = [qwen_decode, 0]


def patch_image(
    prompt: str,
    character_refs: Optional[list[dict]] = None,
    visual_refs: Optional[list[str]] = None,
    # 하위 호환 별칭 (구 호출부용)
    character_ref_a: Optional[str] = None,
    character_ref_b: Optional[str] = None,
    workflow: Optional[str] = None,        # "qwen_edit" | "sdxl" | None
    resolution: tuple[Optional[int], Optional[int]] = (None, None),
    params: Optional[dict] = None,
    negative_prompt: Optional[str] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    """씬 키프레임 생성.

    character_refs = [{"name": str, "description": str, "image_path": str}, ...]
    visual_refs = previous scene keyframes or outfit/style references. These are
    passed to Qwen Image Edit as extra images, but are not treated as additional
    characters in the character prompt.
    또는 구 시그니처 character_ref_a/b 사용 시 자동 변환.
    """
    params = params or {}
    image_model = params.get("model")

    # 1. 구 시그니처 → 신규 포맷 변환
    refs: list[dict] = list(character_refs or [])
    if not refs:
        if character_ref_a:
            refs.append({"name": "", "description": "", "image_path": character_ref_a})
        if character_ref_b:
            refs.append({"name": "", "description": "", "image_path": character_ref_b})

    # 2. staged 파일명 준비
    staged: list[str] = []
    staged_character_descs: list[tuple[str, str]] = []
    for i, r in enumerate(refs):
        name = _stage_ref(r.get("image_path"), f"charref_{i}")
        if name:
            staged.append(name)
            staged_character_descs.append((r.get("name", ""), r.get("description", "")))
    for i, ref_path in enumerate(visual_refs or []):
        name = _stage_ref(ref_path, f"visualref_{i}")
        if name:
            staged.append(name)

    if staged_character_descs:
        prompt = build_multi_ref_prompt(staged_character_descs, prompt)

    # 3. 워크플로우 선택
    wf_name = (workflow or "qwen_edit").lower()

    if wf_name == "qwen_edit" and not staged:
        raise RuntimeError("Qwen Edit 이미지 생성에는 캐릭터 스프라이트 레퍼런스가 필요합니다.")

    # 4. 원본 이미지 워크플로우 기반
    #    - qwen_edit: SDXL 본체 + Qwen Edit 레퍼런스 브랜치 주입 (캐릭터 일관성)
    #    - sdxl: 순수 SDXL 텍스트→이미지 (캐릭터 락 없음, 배경/무드샷용)
    if wf_name in ("sdxl", "qwen_edit"):
        wf = load_original_workflow(ORIGINAL_WORKFLOWS["scene_image"])
        _set_original_image_prompt_nodes(wf, prompt=prompt, negative_prompt=negative_prompt)
        _apply_image_params(wf, params, resolution)
        _apply_image_model(wf, image_model)
        if staged and wf_name == "qwen_edit":
            _inject_qwen_reference_branch_into_original(
                wf,
                staged_refs=staged,
                prompt=prompt,
                negative_prompt=negative_prompt,
                resolution=resolution,
                params=params,
            )
        _apply_filename_prefixes(wf, default_prefix=output_prefix)
        return wf

    raise RuntimeError(f"지원하지 않는 이미지 워크플로우입니다: {wf_name}")


# ── 단계 3: 비디오 ────────────────────────────────────────────────────

_S2V_DEFAULT_NEGATIVE = (
    "watermark, channel logo, vivid/saturated tones, overexposed, static, blurry, "
    "subtitles, text, artwork, painting, still frame, worst quality, low quality, "
    "jpeg artifacts, ugly, damaged hands, poorly drawn face, deformity, disfigured, "
    "malformed limbs, fused fingers, frozen frame, cluttered background, "
    "different character, different face, changed hairstyle, changed outfit"
)

_VIDEO_IDENTITY_LOCK = (
    "Preserve the exact character identity from the input frame: same face shape, eye shape, "
    "hair color, hairstyle, outfit, body silhouette, and relative positions. Do not redesign, "
    "recast, age-shift, change clothes, or introduce a different person."
)

_VIDEO_IDENTITY_NEGATIVE = (
    "different character, changed face, changed hairstyle, changed hair color, changed outfit, "
    "new person, inconsistent identity, inconsistent body, recast character"
)

_VIDEO_AUDIO_PERFORMANCE_PROMPT = (
    "Audio-driven character performance: synchronize mouth movement, blinking, gaze shifts, "
    "head turns, shoulder posture, hand gestures, breathing, weight shifts, and emotional timing "
    "to the spoken line and sound effects. This must be a performed scene, not a static talking-head "
    "shot and not lips-only animation."
)

_VIDEO_SFX_PERFORMANCE_PROMPT = (
    "Motion rhythm should match the sound design: camera movement, body language, hair and fabric "
    "movement, breathing, and small environmental reactions should land on the same beats as the audio."
)

_VIDEO_MOTION_NEGATIVE = (
    "static body, frozen pose, only lips moving, lips-only animation, disconnected voice, "
    "off-beat gestures, mismatched audio rhythm, unmoving shoulders, dead eyes, mannequin motion"
)


def _join_prompt_parts(*parts: object, separator: str = ". ") -> str:
    cleaned: list[str] = []
    for part in parts:
        if part is None:
            continue
        text = str(part).strip()
        if not text:
            continue
        cleaned.append(text.rstrip("., "))
    return separator.join(cleaned)


def _compose_video_positive_prompt(
    base_prompt: str,
    params: dict,
    *,
    audio_driven: bool,
    sfx_driven: bool = False,
) -> str:
    parts: list[object] = [
        base_prompt,
        params.get("motion_prompt"),
        params.get("gesture_prompt"),
        params.get("camera_motion_prompt"),
    ]
    if audio_driven:
        parts.append(params.get("audio_sync_prompt") or _VIDEO_AUDIO_PERFORMANCE_PROMPT)
    elif sfx_driven or params.get("audio_sync_prompt"):
        parts.append(params.get("audio_sync_prompt") or _VIDEO_SFX_PERFORMANCE_PROMPT)
    parts.append(_VIDEO_IDENTITY_LOCK)
    return _join_prompt_parts(*parts)


def _compose_video_negative_prompt(base_negative: str, params: dict, *, audio_driven: bool) -> str:
    motion_negative = params.get("motion_negative_prompt")
    if audio_driven and not motion_negative:
        motion_negative = _VIDEO_MOTION_NEGATIVE
    return _join_prompt_parts(base_negative, motion_negative, _VIDEO_IDENTITY_NEGATIVE, separator=", ")


def _patch_original_s2v_fastfidelity(
    wf: dict,
    *,
    image_path: str,
    voice_path: str,
    bg_prompt: str,
    sfx_prompt: str,
    diffusion_model: Optional[str],
    params: dict,
    output_prefix: Optional[str],
) -> dict:
    model_name = diffusion_model or params.get("s2v_model") or S2V_FASTFIDELITY_MODEL
    if str(model_name).lower().endswith(".gguf"):
        raise RuntimeError(
            "FastFidelity S2V는 safetensors UNETLoader 경로만 지원합니다. "
            f"{Path(S2V_FASTFIDELITY_MODEL).name}를 사용하세요."
        )
    voice_audio: list | None = None

    _connect_clip_loader_to_text_encoders(wf)
    if not params.get("torch_compile_enabled", False):
        _bypass_torch_compile_nodes(wf)

    for node_id, node in wf.items():
        cls = node.get("class_type", "")
        title = _title(node).lower()
        inp = node.setdefault("inputs", {})

        if cls == "LoadImage":
            inp["image"] = image_path
        elif cls == "LoadAudio":
            inp["audio"] = voice_path
            voice_audio = [str(node_id), 0]
        elif cls == "AudioCropProcessUTK":
            if "s2v_audio_offset" in params:
                inp["offset_seconds"] = float(params["s2v_audio_offset"])
            if "s2v_audio_duration" in params:
                inp["duration_seconds"] = float(params["s2v_audio_duration"])
        elif cls == "AudioEncoderLoader":
            inp["audio_encoder_name"] = "wav2vec2_large_english_fp16.safetensors"
        elif cls == "VAELoader":
            inp["vae_name"] = "wan_2.1_vae.safetensors"
        elif cls == "WanSoundImageToVideo":
            inp["ref_image"] = inp.get("ref_image") or _first_load_image_output(wf)
            inp["width"] = int(params.get("width", 832))
            inp["height"] = int(params.get("height", 480))
            inp["length"] = int(params.get("frames", 81))
        elif cls in ("UNETLoader", "UnetLoaderGGUF"):
            if cls == "UnetLoaderGGUF":
                inp["unet_name"] = model_name
            else:
                inp["unet_name"] = model_name
                inp.setdefault("weight_dtype", "fp8_e4m3fn_fast")
        elif cls == "ModelSamplingSD3":
            inp["shift"] = float(params.get("shift", 5))
        elif cls == "KSamplerAdvanced":
            inp["noise_seed"] = int(params.get("seed", params.get("mmaudio_seed", 0)))
            inp["steps"] = int(params.get("steps", 4))
            inp["cfg"] = float(params.get("cfg", 8.0))
            inp["sampler_name"] = params.get("sampler", "euler")
            inp["scheduler"] = params.get("scheduler", "simple")
            if inp.get("add_noise") == "enable":
                inp["positive"] = ["13", 0]
                inp["negative"] = ["13", 1]
                inp["latent_image"] = ["13", 2]
                inp["start_at_step"] = 0
                inp["end_at_step"] = int(params.get("s2v_refiner_start_step", 2))
                inp["return_with_leftover_noise"] = "enable"
            else:
                inp["positive"] = ["13", 0]
                inp["negative"] = ["13", 1]
                inp["latent_image"] = ["10", 0]
                inp["start_at_step"] = int(params.get("s2v_refiner_start_step", 2))
                inp["end_at_step"] = 10000
                inp["return_with_leftover_noise"] = "disable"
        elif cls == "CLIPTextEncode":
            if "negative" in title or "watermark" in str(inp.get("text", "")).lower():
                negative = params.get("video_negative_prompt", _S2V_DEFAULT_NEGATIVE)
                inp["text"] = _compose_video_negative_prompt(negative, params, audio_driven=True)
            else:
                base = bg_prompt or inp.get("text", "")
                inp["text"] = _compose_video_positive_prompt(base, params, audio_driven=True)
        elif cls == "VHS_VideoCombine":
            inp.setdefault("frame_rate", 16)
            inp.setdefault("loop_count", 0)
            inp.setdefault("format", "video/h264-mp4")
            inp.setdefault("pix_fmt", "yuv420p")
            inp.setdefault("crf", 19)
            inp.setdefault("pingpong", False)
            inp.setdefault("trim_to_audio", False)
            inp["save_output"] = True
            if "fps" in params:
                inp["frame_rate"] = int(params["fps"])

    if voice_audio is None:
        voice_audio = ["29", 0]

    if params.get("reuse_s2v_model", True):
        first_stage_model: list | None = None
        for node in wf.values():
            if node.get("class_type") != "KSamplerAdvanced":
                continue
            inputs = node.setdefault("inputs", {})
            if inputs.get("add_noise") == "enable":
                model_ref = inputs.get("model")
                if isinstance(model_ref, list):
                    first_stage_model = model_ref
                    break
        if first_stage_model:
            for node in wf.values():
                if node.get("class_type") != "KSamplerAdvanced":
                    continue
                inputs = node.setdefault("inputs", {})
                if inputs.get("add_noise") == "disable":
                    inputs["model"] = first_stage_model

    _ensure_mmaudio_mixed_audio_branch(
        wf,
        voice_audio=voice_audio,
        sfx_prompt=sfx_prompt,
        params=params,
    )
    _apply_video_params(wf, params)
    _apply_filename_prefixes(wf, default_prefix=output_prefix)
    _prune_unreachable_from_roots(
        wf,
        [node_id for node_id, node in wf.items() if node.get("class_type") == "VHS_VideoCombine"],
    )
    return wf


def _first_load_image_output(wf: dict) -> list | None:
    for node_id, node in wf.items():
        if node.get("class_type") == "LoadImage":
            return [str(node_id), 0]
    return None


def patch_video_lipsync(
    image_path: str,
    voice_path: str,
    bg_prompt: str,
    sfx_prompt: str,
    diffusion_model: Optional[str] = None,
    params: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    params = params or {}
    wf = load_original_workflow(ORIGINAL_WORKFLOWS["video_s2v_fastfidelity"])
    return _patch_original_s2v_fastfidelity(
        wf,
        image_path=image_path,
        voice_path=voice_path,
        bg_prompt=bg_prompt,
        sfx_prompt=sfx_prompt,
        diffusion_model=diffusion_model,
        params=params,
        output_prefix=output_prefix,
    )


_I2V_MODELS = {
    "high": "wan_i2v_high/DasiwaWAN22I2V14BLightspeed_synthseductionHighV9.safetensors",
    "low":  "wan_i2v_low/DasiwaWAN22I2V14BLightspeed_synthseductionLowV9.safetensors",
}


def _apply_loras_wrapper(node: dict, loras: Optional[list[dict]]) -> None:
    inp = node.setdefault("inputs", {})
    arr = list(loras or [])[:5]
    for i in range(5):
        if i < len(arr):
            inp[f"lora_{i}"] = arr[i]["name"]
            inp[f"strength_{i}"] = float(arr[i].get("strength", 1.0))
        else:
            inp[f"lora_{i}"] = "none"
            inp[f"strength_{i}"] = 1.0


def _set_model_name(node: dict, model_name: str) -> None:
    inp = node.setdefault("inputs", {})
    cls = node.get("class_type", "")
    if cls == "WanVideoModelLoader":
        inp["model"] = model_name
    else:
        inp["unet_name"] = model_name


def _next_node_id(wf: dict) -> str:
    numeric = [int(k) for k in wf if str(k).isdigit()]
    return str((max(numeric) if numeric else 0) + 1)


def _append_node(wf: dict, class_type: str, title: str, inputs: dict) -> str:
    node_id = _next_node_id(wf)
    wf[node_id] = {
        "_meta": {"title": title},
        "class_type": class_type,
        "inputs": inputs,
    }
    return node_id


def _find_node(wf: dict, node_id: str) -> dict | None:
    node = wf.get(str(node_id))
    return node if isinstance(node, dict) else None


def _find_video_images_source(wf: dict) -> list | None:
    candidates: list[tuple[int, list]] = []
    priority_by_class = {
        "RIFE VFI": 0,
        "ImageScaleBy": 1,
        "ColorMatch": 2,
    }
    for node in _iter_nodes(wf):
        if node.get("class_type") != "VHS_VideoCombine":
            continue
        images = node.get("inputs", {}).get("images")
        if not (isinstance(images, list) and images):
            continue
        source = _find_node(wf, str(images[0]))
        priority = priority_by_class.get((source or {}).get("class_type"), 10)
        candidates.append((priority, images))
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: item[0])[0][1]


def _connect_clip_loader_to_text_encoders(wf: dict) -> None:
    clip_source: list | None = None
    for node_id, node in wf.items():
        if node.get("class_type") in ("CLIPLoader", "CLIPLoaderGGUF"):
            clip_source = [str(node_id), 0]
            break
    if not clip_source:
        return
    for node in _iter_nodes(wf):
        if node.get("class_type") != "CLIPTextEncode":
            continue
        node.setdefault("inputs", {}).setdefault("clip", clip_source)


def _prune_unreachable_from_roots(wf: dict, roots: list[str]) -> None:
    reachable: set[str] = set()

    def visit(node_id: str) -> None:
        node_id = str(node_id)
        if node_id in reachable or node_id not in wf:
            return
        reachable.add(node_id)
        node = wf.get(node_id)
        if not isinstance(node, dict):
            return
        for value in node.get("inputs", {}).values():
            if isinstance(value, list) and value:
                visit(str(value[0]))

    for root in roots:
        visit(root)
    for node_id in list(wf):
        if node_id not in reachable:
            wf.pop(node_id, None)


def _bypass_torch_compile_nodes(wf: dict) -> None:
    """Bypass runtime compile wrappers without changing model weights or sampling."""
    compile_ids = [
        node_id
        for node_id, node in wf.items()
        if isinstance(node, dict) and node.get("class_type") == "TorchCompileModelWanVideoV2"
    ]
    for node_id in compile_ids:
        node = wf.get(node_id) or {}
        upstream = node.get("inputs", {}).get("model")
        if not (isinstance(upstream, list) and upstream):
            continue
        for other in _iter_nodes(wf):
            inputs = other.get("inputs", {})
            for key, value in list(inputs.items()):
                if value == [str(node_id), 0]:
                    inputs[key] = upstream
        wf.pop(str(node_id), None)


def _apply_mmaudio_params(wf: dict, params: dict, sfx_prompt: str | None = None) -> None:
    """MMAudio SFX 및 TTS+SFX 믹싱 파라미터를 주입한다.

    MoanForge 레퍼런스의 핵심값만 노출한다: SFW/NSFW 모델 선택, prompt/negative,
    sampler steps/cfg/duration/seed, 그리고 GeekyAudioMixer 볼륨.
    """
    params = params or {}
    if params.get("mmaudio_enabled") is False:
        for mixer_id, mixer in wf.items():
            if not isinstance(mixer, dict) or mixer.get("class_type") != "GeekyAudioMixer":
                continue
            voice_audio = mixer.get("inputs", {}).get("audio_1")
            if not voice_audio:
                continue
            for node in _iter_nodes(wf):
                if node.get("class_type") != "VHS_VideoCombine":
                    continue
                inp = node.setdefault("inputs", {})
                if inp.get("audio") == [str(mixer_id), 0]:
                    inp["audio"] = voice_audio
        for node in _iter_nodes(wf):
            if node.get("class_type") != "VHS_VideoCombine":
                continue
            inp = node.setdefault("inputs", {})
            audio = inp.get("audio")
            if isinstance(audio, list):
                source = _find_node(wf, str(audio[0]))
                if source and source.get("class_type") == "MMAudioSampler":
                    inp.pop("audio", None)
        return

    prompt = sfx_prompt or params.get("mmaudio_prompt")
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls == "MMAudioModelLoader":
            if params.get("mmaudio_model"):
                inp["mmaudio_model"] = params["mmaudio_model"]
            if params.get("mmaudio_precision"):
                inp["base_precision"] = params["mmaudio_precision"]
        elif cls == "MMAudioFeatureUtilsLoader":
            if params.get("mmaudio_feature_precision"):
                inp["precision"] = params["mmaudio_feature_precision"]
        elif cls == "MMAudioSampler":
            if prompt:
                inp["prompt"] = prompt
            if "mmaudio_negative_prompt" in params:
                inp["negative_prompt"] = params["mmaudio_negative_prompt"]
            for src_key, dst_key, cast in (
                ("mmaudio_duration", "duration", float),
                ("mmaudio_steps", "steps", int),
                ("mmaudio_cfg", "cfg", float),
                ("mmaudio_seed", "seed", int),
            ):
                if src_key in params:
                    inp[dst_key] = cast(params[src_key])
            if "mmaudio_mask_away_clip" in params:
                inp["mask_away_clip"] = bool(params["mmaudio_mask_away_clip"])
            if "mmaudio_force_offload" in params:
                inp["force_offload"] = bool(params["mmaudio_force_offload"])
        elif cls == "GeekyAudioMixer":
            for src_key, dst_key, cast in (
                ("voice_volume", "audio_1_volume", float),
                ("sfx_volume", "audio_2_volume", float),
                ("sfx_start_time", "audio_2_start_time", float),
                ("sfx_fade_in", "audio_2_fade_in", float),
                ("sfx_fade_out", "audio_2_fade_out", float),
                ("audio_output_duration", "output_duration", float),
            ):
                if src_key in params:
                    inp[dst_key] = cast(params[src_key])


def _ensure_mmaudio_sfx_branch(wf: dict, sfx_prompt: str, params: dict) -> None:
    """I2V 원본 워크플로우에 SFX branch가 없으면 후단에 MMAudio를 추가한다."""
    if params.get("mmaudio_enabled") is False:
        return
    if any(node.get("class_type") == "MMAudioSampler" for node in _iter_nodes(wf)):
        _apply_mmaudio_params(wf, params, sfx_prompt)
        return

    images = _find_video_images_source(wf)
    if not images:
        return

    model_id = _append_node(
        wf,
        "MMAudioModelLoader",
        "MMAudio 모델",
        {
            "mmaudio_model": params.get("mmaudio_model", MMAUDIO_SFW_MODEL),
            "base_precision": params.get("mmaudio_precision", "fp16"),
        },
    )
    utils_id = _append_node(
        wf,
        "MMAudioFeatureUtilsLoader",
        "MMAudio Feature Utils",
        {
            "vae_model": "mmaudio_vae_44k_fp16.safetensors",
            "synchformer_model": "mmaudio_synchformer_fp16.safetensors",
            "clip_model": "apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors",
            "mode": "44k",
            "precision": params.get("mmaudio_feature_precision", "fp16"),
        },
    )
    sampler_id = _append_node(
        wf,
        "MMAudioSampler",
        "MMAudio SFX",
        {
            "mmaudio_model": [model_id, 0],
            "feature_utils": [utils_id, 0],
            "images": images,
            "duration": float(params.get("mmaudio_duration", 5.0)),
            "steps": int(params.get("mmaudio_steps", 25)),
            "cfg": float(params.get("mmaudio_cfg", 4.5)),
            "seed": int(params.get("mmaudio_seed", params.get("seed", 0))),
            "prompt": sfx_prompt or params.get("mmaudio_prompt", "ambient room tone, subtle movement sounds"),
            "negative_prompt": params.get(
                "mmaudio_negative_prompt",
                "talking, speech, voice, voices, singing, music, words, laughter, robotic, low quality",
            ),
            "mask_away_clip": bool(params.get("mmaudio_mask_away_clip", False)),
            "force_offload": bool(params.get("mmaudio_force_offload", True)),
        },
    )
    for node in _iter_nodes(wf):
        if node.get("class_type") == "VHS_VideoCombine":
            node.setdefault("inputs", {})["audio"] = [sampler_id, 0]


def _ensure_mmaudio_mixed_audio_branch(
    wf: dict,
    *,
    voice_audio: list,
    sfx_prompt: str,
    params: dict,
) -> None:
    """S2V: TTS voice + MMAudio SFX를 섞어서 최종 video combine에 연결."""
    if params.get("mmaudio_enabled") is False:
        for node in _iter_nodes(wf):
            if node.get("class_type") == "VHS_VideoCombine":
                node.setdefault("inputs", {})["audio"] = voice_audio
        return

    images = _find_video_images_source(wf)
    if not images:
        return

    model_id = _append_node(
        wf,
        "MMAudioModelLoader",
        "MMAudio 모델",
        {
            "mmaudio_model": params.get("mmaudio_model", MMAUDIO_SFW_MODEL),
            "base_precision": params.get("mmaudio_precision", "fp16"),
        },
    )
    utils_id = _append_node(
        wf,
        "MMAudioFeatureUtilsLoader",
        "MMAudio Feature Utils",
        {
            "vae_model": "mmaudio_vae_44k_fp16.safetensors",
            "synchformer_model": "mmaudio_synchformer_fp16.safetensors",
            "clip_model": "apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors",
            "mode": "44k",
            "precision": params.get("mmaudio_feature_precision", "fp16"),
        },
    )
    sampler_id = _append_node(
        wf,
        "MMAudioSampler",
        "MMAudio SFX",
        {
            "mmaudio_model": [model_id, 0],
            "feature_utils": [utils_id, 0],
            "images": images,
            "duration": float(params.get("mmaudio_duration", 5.0)),
            "steps": int(params.get("mmaudio_steps", 25)),
            "cfg": float(params.get("mmaudio_cfg", 4.5)),
            "seed": int(params.get("mmaudio_seed", params.get("seed", 0))),
            "prompt": sfx_prompt or params.get("mmaudio_prompt", "ambient room tone, subtle movement sounds"),
            "negative_prompt": params.get(
                "mmaudio_negative_prompt",
                "talking, speech, voice, voices, singing, music, words, laughter, robotic, low quality",
            ),
            "mask_away_clip": bool(params.get("mmaudio_mask_away_clip", False)),
            "force_offload": bool(params.get("mmaudio_force_offload", True)),
        },
    )
    mixer_id = _append_node(
        wf,
        "GeekyAudioMixer",
        "TTS + MMAudio SFX 믹스",
        {
            "audio_1": voice_audio,
            "audio_2": [sampler_id, 0],
            "output_duration": float(params.get("audio_output_duration", 10.0)),
            "output_format": "wav",
            "sample_rate": 44100,
            "audio_1_volume": float(params.get("voice_volume", 1.0)),
            "audio_1_start_time": 0.0,
            "audio_1_fade_in": 0.0,
            "audio_1_fade_out": 0.0,
            "audio_2_volume": float(params.get("sfx_volume", 0.35)),
            "audio_2_start_time": float(params.get("sfx_start_time", 0.0)),
            "audio_2_fade_in": float(params.get("sfx_fade_in", 0.1)),
            "audio_2_fade_out": float(params.get("sfx_fade_out", 0.2)),
        },
    )
    for node in _iter_nodes(wf):
        if node.get("class_type") == "VHS_VideoCombine":
            node.setdefault("inputs", {})["audio"] = [mixer_id, 0]


def _apply_video_params(wf: dict, params: dict) -> None:
    """Phase 5: 비디오 샘플러/프레임/FPS 튜닝값 주입.
    대상 노드 탐지: WanVideoSampler, KSampler, CreateVideo, VHS_VideoCombine 등."""
    if not params:
        return
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls in ("KSampler", "KSamplerAdvanced", "WanVideoSampler"):
            for k, mapped in (("steps", "steps"), ("cfg", "cfg"),
                              ("sampler", "sampler_name"), ("scheduler", "scheduler"),
                              ("shift", "shift")):
                if k in params and mapped in inp:
                    inp[mapped] = params[k]
            if "seed" in params:
                if "noise_seed" in inp:
                    inp["noise_seed"] = int(params["seed"])
                elif "seed" in inp:
                    inp["seed"] = int(params["seed"])
            if cls == "KSamplerAdvanced" and "i2v_refiner_start_step" in params:
                split = int(params["i2v_refiner_start_step"])
                if inp.get("add_noise") == "enable" and "end_at_step" in inp:
                    inp["end_at_step"] = split
                elif inp.get("add_noise") == "disable" and "start_at_step" in inp:
                    inp["start_at_step"] = split
        if cls in ("WanVideoEmptyEmbeds", "EmptyLatentImage") and "frames" in params:
            if "num_frames" in inp:
                inp["num_frames"] = int(params["frames"])
        if cls in ("CreateVideo", "VHS_VideoCombine") and "fps" in params:
            if "fps" in inp:
                inp["fps"] = int(params["fps"])
            elif "frame_rate" in inp:
                inp["frame_rate"] = int(params["fps"])
            elif cls == "VHS_VideoCombine":
                inp["frame_rate"] = int(params["fps"])
        if cls == "VHS_VideoCombine":
            inp.setdefault("frame_rate", int(params.get("fps", 16)))
            inp.setdefault("loop_count", int(params.get("loop_count", 0)))
            inp.setdefault("pingpong", bool(params.get("pingpong", False)))
            inp.setdefault("save_output", bool(params.get("save_output", True)))
            inp.setdefault("format", params.get("video_format", "video/h264-mp4"))
            inp.setdefault("pix_fmt", params.get("pix_fmt", "yuv420p"))
            inp.setdefault("crf", int(params.get("crf", 19)))
        if cls in ("CreateVideo", "VHS_VideoCombine"):
            for k, caster in (
                ("video_format", str),
                ("pix_fmt", str),
                ("crf", int),
                ("loop_count", int),
                ("pingpong", bool),
                ("trim_to_audio", bool),
                ("save_output", bool),
            ):
                target = "format" if k == "video_format" else k
                if k in params and (target in inp or cls == "VHS_VideoCombine"):
                    inp[target] = caster(params[k])
    _apply_mmaudio_params(wf, params)


def _patch_2stage_video(
    wf: dict,
    image_path: str,
    end_image_path: Optional[str],
    prompt: str,
    sfx_prompt: str,
    loras_high: Optional[list[dict]],
    loras_low: Optional[list[dict]],
    prompt_keywords: tuple[str, ...],
    params: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    params = params or {}
    staged_start = _stage_ref(image_path, "video_start") or image_path
    staged_end = _stage_ref(end_image_path, "video_end") if end_image_path else staged_start

    for node_id, node in wf.items():
        cls = node.get("class_type", "")
        title = _title(node).lower()
        inputs = node.setdefault("inputs", {})
        if cls in ("UNETLoader", "UnetLoaderGGUF"):
            current = str(inputs.get("unet_name", "")).lower()
            model_name = (
                _I2V_MODELS["low"]
                if "low" in title or "low" in current
                else _I2V_MODELS["high"]
            )
            if cls == "UnetLoaderGGUF":
                wf[str(node_id)] = {
                    "_meta": {"title": "Runtime Wan I2V model"},
                    "class_type": "UNETLoader",
                    "inputs": {"unet_name": model_name, "weight_dtype": "default"},
                }
                continue
            if "low" in title or "low" in current:
                _set_model_name(node, _I2V_MODELS["low"])
            else:
                _set_model_name(node, _I2V_MODELS["high"])
        elif cls == "LoadImage":
            inputs["image"] = staged_start
            inputs["upload"] = "image"
        elif cls == "LoadImagesFromFolderKJ":
            wf[str(node_id)] = {
                "_meta": {"title": "Runtime start image"},
                "class_type": "LoadImage",
                "inputs": {"image": staged_start, "upload": "image"},
            }
        elif cls == "CLIPLoaderGGUF":
            wf[str(node_id)] = {
                "_meta": {"title": "Runtime Wan text encoder"},
                "class_type": "CLIPLoader",
                "inputs": {
                    "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
                    "type": "wan",
                    "device": "default",
                },
            }
        elif cls == "CLIPLoader" and inputs.get("type") == "wan":
            inputs["clip_name"] = "umt5_xxl_fp8_e4m3fn_scaled.safetensors"
            inputs.setdefault("device", "default")

    has_voice_track = bool(params.get("voice_path"))
    locked_prompt = _compose_video_positive_prompt(
        prompt,
        params,
        audio_driven=has_voice_track,
        sfx_driven=bool(sfx_prompt),
    )
    if locked_prompt:
        prompt_applied = False
        for node in _iter_nodes(wf):
            if node.get("class_type") == "WanVideoTextEncode":
                node.setdefault("inputs", {})["positive_prompt"] = locked_prompt
                prompt_applied = True
                break
        for node in _iter_nodes(wf):
            cls = node.get("class_type")
            title = _title(node).lower()
            inp = node.setdefault("inputs", {})
            if cls in ("DF_DynamicPrompts_Text_Box", "DynamicPrompts Text Box"):
                inp["Text"] = locked_prompt
                prompt_applied = True
            elif cls == "StringConcatenate":
                # 원본 워크플로우 예시 프롬프트가 string_b/delimiter에 남아 섞이지 않게 비운다.
                inp.setdefault("string_a", locked_prompt)
                inp["string_b"] = ""
                inp["delimiter"] = ""
            elif cls == "CLIPTextEncode" and any(kw.lower() in title for kw in prompt_keywords):
                inp["text"] = locked_prompt
                prompt_applied = True
        if not prompt_applied:
            raise RuntimeError("비디오 워크플로우 positive prompt 노드를 찾지 못했습니다.")
    for node in _iter_nodes(wf):
        if node.get("class_type") != "CLIPTextEncode":
            continue
        inp = node.setdefault("inputs", {})
        title = _title(node).lower()
        text = str(inp.get("text", ""))
        if "negative" in title or "watermark" in text.lower() or "低质量" in text:
            inp["text"] = _compose_video_negative_prompt(
                params.get("video_negative_prompt", text),
                params,
                audio_driven=has_voice_track,
            )

    if sfx_prompt:
        for node in _iter_nodes(wf):
            if node.get("class_type") == "MMAudioSampler":
                node.setdefault("inputs", {})["prompt"] = sfx_prompt

    for node in list(_iter_nodes(wf)):
        if node.get("class_type") in ("WanImageToVideo", "WanFirstLastFrameToVideo"):
            inp = node.setdefault("inputs", {})
            if "start_image" in inp:
                inp["start_image"] = _first_load_image_output(wf)
            if "end_image" in inp:
                end_node = None
                if staged_end != staged_start:
                    end_node = _append_node(
                        wf,
                        "LoadImage",
                        "Runtime end image",
                        {"image": staged_end, "upload": "image"},
                    )
                inp["end_image"] = [end_node, 0] if end_node else _first_load_image_output(wf)
            if "width" in params:
                inp["width"] = int(params["width"])
            if "height" in params:
                inp["height"] = int(params["height"])
            if "frames" in params:
                inp["length"] = int(params["frames"])

    primitive_ids = {
        str(node_id)
        for node_id, node in wf.items()
        if isinstance(node, dict) and node.get("class_type") == "PrimitiveNode"
    }
    for node in _iter_nodes(wf):
        inp = node.setdefault("inputs", {})
        seed_input = inp.get("noise_seed")
        if isinstance(seed_input, list) and seed_input and str(seed_input[0]) in primitive_ids:
            inp["noise_seed"] = int(params.get("seed", 0))
    for node_id in primitive_ids:
        wf.pop(node_id, None)

    if params.get("voice_path"):
        staged_voice = _stage_ref(str(params["voice_path"]), "video_voice") or str(params["voice_path"])
        voice_id = _append_node(
            wf,
            "LoadAudio",
            "Runtime voice track",
            {"audio": staged_voice, "audioUI": None},
        )
        _ensure_mmaudio_mixed_audio_branch(
            wf,
            voice_audio=[voice_id, 0],
            sfx_prompt=sfx_prompt,
            params=params,
        )
    else:
        _ensure_mmaudio_sfx_branch(wf, sfx_prompt, params)

    if "12" in wf and wf["12"].get("class_type") == "WanVideoLoraSelectMulti":
        _apply_loras_wrapper(wf["12"], loras_high)
    if "22" in wf and wf["22"].get("class_type") == "WanVideoLoraSelectMulti":
        _apply_loras_wrapper(wf["22"], loras_low if loras_low is not None else loras_high)

    _apply_video_params(wf, params)
    _apply_filename_prefixes(wf, default_prefix=output_prefix)
    return wf


def patch_video_loop(
    image_path: str,
    bg_prompt: str,
    sfx_prompt: str,
    high_noise: bool = True,
    loras: Optional[list[dict]] = None,
    loras_low: Optional[list[dict]] = None,
    diffusion_model: Optional[str] = None,
    params: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    wf = load_original_workflow(ORIGINAL_WORKFLOWS["video_loop"])
    return _patch_2stage_video(
        wf, image_path, image_path, bg_prompt, sfx_prompt,
        loras, loras_low, ("Positive", "루프"), params, output_prefix,
    )


def patch_video_basic(
    image_path: str,
    bg_prompt: str,
    sfx_prompt: str,
    loras: Optional[list[dict]] = None,
    loras_low: Optional[list[dict]] = None,
    diffusion_model: Optional[str] = None,
    params: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    wf = load_original_workflow(ORIGINAL_WORKFLOWS["video_basic"])
    return _patch_2stage_video(
        wf, image_path, None, bg_prompt, sfx_prompt,
        loras, loras_low, ("Positive", "기본"), params, output_prefix,
    )


def patch_video_effect(
    image_path: str,
    effect_prompt: str,
    sfx_prompt: str,
    end_image_path: Optional[str] = None,
    loras: Optional[list[dict]] = None,
    loras_low: Optional[list[dict]] = None,
    diffusion_model: Optional[str] = None,
    params: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    wf = load_original_workflow(ORIGINAL_WORKFLOWS["video_effect"])
    return _patch_2stage_video(
        wf, image_path, end_image_path, effect_prompt, sfx_prompt,
        loras, loras_low, ("Positive", "이펙트"), params, output_prefix,
    )


# ── 보조 ─────────────────────────────────────────────────────────────────

def patch_character_sheet(
    character_name: str,
    description: str,
    negative_prompt: Optional[str] = None,
    resolution: tuple[Optional[int], Optional[int]] = (None, None),
    params: Optional[dict] = None,
    character_fields: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    wf = load_original_workflow(ORIGINAL_WORKFLOWS["character_sprite_new"])
    _apply_character_sheet_prompt(
        wf,
        character_name=character_name,
        description=description,
        negative_prompt=negative_prompt,
        params=params or {},
        character_fields=character_fields or {},
    )
    _apply_character_sheet_runtime_params(wf, params or {})
    _apply_image_params(wf, params or {}, resolution)
    _apply_image_model(wf, (params or {}).get("model"))
    _apply_filename_prefixes(
        wf,
        default_prefix=output_prefix,
        title_prefix_map={
            "faces": f"{output_prefix}_faces" if output_prefix else "",
            "chracter sheet": output_prefix or "",
        },
    )
    return wf


def patch_character_sprite_existing(
    *,
    character_name: str,
    description: str,
    reference_image_path: str,
    negative_prompt: Optional[str] = None,
    resolution: tuple[Optional[int], Optional[int]] = (None, None),
    params: Optional[dict] = None,
    character_fields: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    params = params or {}
    staged_ref = _stage_ref(reference_image_path, "character_sprite_ref")
    if not staged_ref:
        raise FileNotFoundError(f"기존 캐릭터 레퍼런스를 찾을 수 없습니다: {reference_image_path}")

    wf = load_original_workflow(ORIGINAL_WORKFLOWS["character_sprite_reference"])
    _apply_character_sheet_prompt(
        wf,
        character_name=character_name,
        description=description,
        negative_prompt=negative_prompt,
        params=params,
        character_fields=character_fields or {},
    )
    _apply_character_sheet_runtime_params(wf, params)
    for node in _iter_nodes(wf):
        cls = node.get("class_type")
        inp = node.setdefault("inputs", {})
        if cls == "CharacterCreator":
            inp["existing_character"] = character_name
            inp["new_character_name"] = ""
        elif cls == "LoadImage" and "image" in inp:
            inp["image"] = staged_ref
            inp["upload"] = "image"

    _apply_image_params(wf, params, resolution)
    _apply_image_model(wf, params.get("model"))
    _apply_filename_prefixes(
        wf,
        default_prefix=output_prefix,
        title_prefix_map={
            "faces": f"{output_prefix}_faces" if output_prefix else "",
            "refined faces character sheet": output_prefix or "",
        },
    )
    return wf


def _apply_character_sheet_prompt(
    wf: dict,
    *,
    character_name: str,
    description: str,
    negative_prompt: Optional[str],
    params: dict,
    character_fields: dict,
) -> None:
    for node in _iter_nodes(wf):
        if node.get("class_type") != "CharacterCreator":
            continue
        inp = node.setdefault("inputs", {})
        base_negative = str(inp.get("negative_prompt", "") or "")
        if character_name:
            inp["existing_character"] = "None"
            inp["new_character_name"] = character_name
        if description:
            inp["additional_details"] = description
        for key in (
            "background_color",
            "aesthetics",
            "sex",
            "race",
            "eyes",
            "hair",
            "face",
            "body",
            "skin_color",
            "lora_prompt",
        ):
            if key in character_fields and character_fields[key] is not None:
                inp[key] = character_fields[key]
        if "nsfw" in character_fields and character_fields["nsfw"] is not None:
            inp["nsfw"] = bool(character_fields["nsfw"])
        if "age" in character_fields and character_fields["age"] is not None:
            inp["age"] = int(character_fields["age"])
        if negative_prompt:
            merged = ", ".join(x for x in [base_negative, negative_prompt] if x)
            inp["negative_prompt"] = merged
        if "seed" in params:
            inp["seed"] = int(params["seed"])
        return


def _apply_character_sheet_runtime_params(wf: dict, params: dict) -> None:
    """Tune expensive character-sheet runtime nodes while preserving the original graph."""
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls == "SeedVR2VideoUpscaler":
            if "seedvr2_resolution" in params:
                inp["resolution"] = int(params["seedvr2_resolution"])
            if "seedvr2_max_resolution" in params:
                inp["max_resolution"] = int(params["seedvr2_max_resolution"])
            if "seedvr2_batch_size" in params:
                inp["batch_size"] = int(params["seedvr2_batch_size"])
            if "seedvr2_color_correction" in params:
                inp["color_correction"] = params["seedvr2_color_correction"]
            inp.setdefault("offload_device", "cpu")
        elif cls == "SeedVR2LoadDiTModel":
            if "seedvr2_blocks_to_swap" in params:
                inp["blocks_to_swap"] = int(params["seedvr2_blocks_to_swap"])
            inp.setdefault("offload_device", "cpu")
        elif cls == "SeedVR2LoadVAEModel":
            if "seedvr2_cache_model" in params:
                inp["cache_model"] = bool(params["seedvr2_cache_model"])
            inp.setdefault("offload_device", "cpu")


def patch_voice_design(
    voice_design_text: str,
    sample_text: str = "안녕하세요.",
    language: Optional[str] = None,
    params: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    params = params or {}
    wf = load_workflow("ws_voice_design.json")
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls == "Qwen3DirectedCloneFromVoiceDesign":
            inp["design_instruct"] = voice_design_text
            inp["design_text"] = sample_text
            inp["target_text"] = sample_text
            if language:
                inp["language"] = language
            for src, dst in {
                "top_p": "top_p",
                "temperature": "temperature",
                "max_new_tokens": "max_new_tokens",
                "seed": "seed",
                "ref_audio_max_seconds": "ref_audio_max_seconds",
                "x_vector_only_mode": "x_vector_only_mode",
            }.items():
                if src in params:
                    inp[dst] = params[src]
    _apply_filename_prefixes(wf, default_prefix=output_prefix)
    return wf
