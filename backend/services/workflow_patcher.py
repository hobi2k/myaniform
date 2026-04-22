"""워크플로우 JSON 동적 패칭.

- 원본 런타임 워크플로우만 사용한다.
- 임의 축약/간이 워크플로우는 사용하지 않는다.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Optional

from .ui_workflow_adapter import load_ui_workflow_as_api_prompt

WORKFLOWS_DIR = Path(__file__).parent.parent.parent / "workflows"
_COMFY_INPUT = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "input"
_ORIGINAL_WORKFLOW_DIR = Path(
    "/mnt/d/Stable Diffusion/StabilityMatrix-win-x64/Data/Packages/ComfyUI/user/default/workflows"
)


def _original_workflow_path(name: str, fallback: str | None = None) -> Path:
    primary = _ORIGINAL_WORKFLOW_DIR / name
    if primary.exists():
        return primary
    if fallback:
        local = WORKFLOWS_DIR / fallback
        if local.exists():
            return local
    raise FileNotFoundError(f"원본 워크플로우 파일을 찾을 수 없습니다: {name}")


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


def _fill_known_required_defaults(wf: dict) -> dict:
    for node in wf.values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") == "UltimateSDUpscale":
            node.setdefault("inputs", {}).setdefault("batch_size", 1)
    return wf


def load_workflow(name: str) -> dict:
    path = WORKFLOWS_DIR / name
    raw = json.loads(path.read_text(encoding="utf-8"))
    return _sanitize_workflow_graph(raw)


def load_original_workflow(name: str, *, fallback: str | None = None) -> dict:
    wf = load_ui_workflow_as_api_prompt(_original_workflow_path(name, fallback=fallback))
    wf = _normalize_model_path_values(wf)
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
            elif cls == "FL_Qwen3TTS_VoiceClone":
                inp["text"] = dialogue
        _apply_filename_prefixes(wf, default_prefix=output_prefix)
        return wf

    wf = load_workflow("ws_voice_design.json")
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls == "FL_Qwen3TTS_VoiceDesign":
            inp["text"] = dialogue
            if voice_design_text:
                inp["voice_description"] = voice_design_text
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
    지원 필드: steps, cfg, sampler, scheduler, seed, denoise, loras[].
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
        if cls in ("KSampler", "KSamplerAdvanced"):
            for k, mapped in ksampler_fields.items():
                if k in params and mapped in inp:
                    inp[mapped] = params[k]
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

    # LoRA 스택 주입 — 선택된 항목만 앞 슬롯에 압축하고 빈 슬롯은 그래프에서 우회
    raw_loras = params.get("loras") or []
    loras = [l for l in raw_loras if (l or {}).get("name") not in (None, "", "None")]
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
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls == "CheckpointLoaderSimple" and not qwen_only and "ckpt_name" in inp:
            inp["ckpt_name"] = model_name
        elif cls in ("UnetLoaderGGUF", "UNETLoader") and "unet_name" in inp:
            inp["unet_name"] = model_name


def _inject_multi_loadimages(wf: dict, staged_refs: list[str]) -> None:
    """ws_scene_keyframe.json 의 "10"(A), "11"(B) LoadImage 를 N 개로 확장.
    3명 이상이면 "12","13",... 을 새로 삽입하고 TextEncodeQwenImageEditPlus 의
    image3/image4/… 입력에 연결.
    """
    # A, B 노드는 그대로 사용
    if len(staged_refs) >= 1 and "10" in wf:
        wf["10"].setdefault("inputs", {})["image"] = staged_refs[0]
    if len(staged_refs) >= 2 and "11" in wf:
        wf["11"].setdefault("inputs", {})["image"] = staged_refs[1]

    # 3번째 이상은 새 LoadImage 노드 추가
    next_id = 12
    extra_ids: list[str] = []
    for ref in staged_refs[2:]:
        nid = str(next_id)
        wf[nid] = {
            "_meta": {"title": f"캐릭터 {chr(64 + next_id - 9)} 레퍼런스"},  # C, D, …
            "class_type": "LoadImage",
            "inputs": {"image": ref},
        }
        extra_ids.append(nid)
        next_id += 1

    # Positive 노드의 image3..N 입력 추가, 없는 이미지 입력은 제거
    for node in _iter_nodes(wf):
        if node.get("class_type") != "TextEncodeQwenImageEditPlus":
            continue
        if "Positive" not in _title(node) and "positive" not in _title(node):
            # Negative 쪽은 이미지 입력이 없어야 함
            inp = node.setdefault("inputs", {})
            inp.pop("image1", None)
            inp.pop("image2", None)
            continue
        inp = node.setdefault("inputs", {})
        if len(staged_refs) < 1:
            inp.pop("image1", None)
        if len(staged_refs) < 2:
            inp.pop("image2", None)
        for i, nid in enumerate(extra_ids, start=3):
            inp[f"image{i}"] = [nid, 0]

    # B 슬롯이 비어있는데 노드 "11" 이 남아있으면 제거 (image2 입력도 이미 제거됨)
    if len(staged_refs) < 2:
        wf.pop("11", None)


def patch_image(
    prompt: str,
    character_refs: Optional[list[dict]] = None,
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
    for i, r in enumerate(refs):
        name = _stage_ref(r.get("image_path"), f"charref_{i}")
        if name:
            staged.append(name)

    # 3. 워크플로우 선택
    wf_name = (workflow or "qwen_edit").lower()

    # Qwen Edit 모델 없으면 SDXL 폴백
    qwen_unet = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "models" / "unet"
    has_qwen = any(qwen_unet.glob("qwen-image-edit-*.gguf")) if qwen_unet.exists() else False
    if wf_name == "qwen_edit" and not has_qwen:
        wf_name = "sdxl"

    # 레퍼런스가 전혀 없으면 자동으로 SDXL (텍스트→이미지)
    if wf_name == "qwen_edit" and not staged:
        wf_name = "sdxl"

    # 4. SDXL 워크플로우
    if wf_name == "sdxl":
        wf = load_original_workflow("이미지 워크플로우.json")
        # Positive 텍스트 = 프롬프트 그대로 (레퍼런스 없이 설명으로만)
        for node in _iter_nodes(wf):
            if node.get("class_type") in ("CLIPTextEncode", "DF_DynamicPrompts_Text_Box"):
                t = _title(node)
                if t == "Positive" or "Positive Prompt" in t:
                    node.setdefault("inputs", {})["text"] = prompt or node["inputs"].get("text", "")
                    node.setdefault("inputs", {})["Text"] = prompt or node["inputs"].get("Text", "")
                elif t == "Negative" and negative_prompt is not None:
                    node.setdefault("inputs", {})["text"] = negative_prompt
        for node in _iter_nodes(wf):
            cls = node.get("class_type")
            inp = node.setdefault("inputs", {})
            if cls == "FaceDetailer":
                if negative_prompt is not None and "negative" in inp and isinstance(inp["negative"], str):
                    inp["negative"] = negative_prompt
            elif cls == "LoadImage":
                # 원본 워크플로우의 예제 레퍼런스 이미지는 런타임 씬 생성에서 사용하지 않는다.
                if "image" in inp and not staged:
                    inp.pop("image", None)
        _apply_image_params(wf, params, resolution)
        _apply_image_model(wf, image_model)
        _apply_filename_prefixes(wf, default_prefix=output_prefix)
        return wf

    # 5. VNCCS 캐릭터 시트
    if wf_name == "vnccs_sheet":
        wf = load_original_workflow(
            "VN_Step1_QWEN_CharSheetGenerator_v1.json",
            fallback="vnccs_step1_sheet_ui.json",
        )
        _apply_character_sheet_prompt(
            wf,
            character_name="",
            description=prompt,
            negative_prompt=negative_prompt,
            params=params,
        )
        _apply_image_params(wf, params, resolution)
        _apply_image_model(wf, image_model)
        _apply_filename_prefixes(wf, default_prefix=output_prefix)
        return wf

    # 6. Qwen Image Edit (기본, 레퍼런스 사용)
    wf = load_workflow("ws_scene_keyframe.json")
    _inject_multi_loadimages(wf, staged)
    # Positive 프롬프트
    for node in _iter_nodes(wf):
        if node.get("class_type") != "TextEncodeQwenImageEditPlus":
            continue
        if "Positive" in _title(node) or "positive" in _title(node):
            node.setdefault("inputs", {})["prompt"] = prompt
    _apply_image_params(wf, params, resolution)
    _apply_image_model(wf, image_model, qwen_only=True)
    _apply_filename_prefixes(wf, default_prefix=output_prefix)
    return wf


# ── 단계 3: 비디오 ────────────────────────────────────────────────────

def patch_video_lipsync(
    image_path: str,
    voice_path: str,
    bg_prompt: str,
    sfx_prompt: str,
    diffusion_model: Optional[str] = None,
    params: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    wf = load_workflow("ws_lipsync.json")
    for node in _iter_nodes(wf):
        cls = node.get("class_type", "")
        inp = node.setdefault("inputs", {})
        if cls in ("UnetLoaderGGUF", "UNETLoader") and diffusion_model:
            inp["unet_name"] = diffusion_model
        elif cls == "LoadImage":
            inp["image"] = image_path
        elif cls == "LoadAudio":
            inp["audio"] = voice_path
        elif cls == "CLIPTextEncode":
            t = _title(node)
            if "Positive" in t:
                inp["text"] = bg_prompt or inp.get("text", "")
        elif cls == "MMAudioSampler":
            if sfx_prompt:
                inp["prompt"] = sfx_prompt
    _apply_video_params(wf, params or {})
    _apply_filename_prefixes(wf, default_prefix=output_prefix)
    return wf


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
        if cls in ("WanVideoEmptyEmbeds", "EmptyLatentImage") and "frames" in params:
            if "num_frames" in inp:
                inp["num_frames"] = int(params["frames"])
        if cls in ("CreateVideo", "VHS_VideoCombine") and "fps" in params:
            if "fps" in inp:
                inp["fps"] = int(params["fps"])
            elif "frame_rate" in inp:
                inp["frame_rate"] = int(params["fps"])


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
    if "10" in wf:
        _set_model_name(wf["10"], _I2V_MODELS["high"])
    if "20" in wf:
        _set_model_name(wf["20"], _I2V_MODELS["low"])

    if "5" in wf:
        wf["5"].setdefault("inputs", {})["image"] = image_path
    if "7" in wf:
        wf["7"].setdefault("inputs", {})["image"] = end_image_path or image_path

    if prompt:
        for node in _iter_nodes(wf):
            if node.get("class_type") == "WanVideoTextEncode":
                node.setdefault("inputs", {})["positive_prompt"] = prompt
                break
        else:
            for node in _iter_nodes(wf):
                if node.get("class_type") != "CLIPTextEncode":
                    continue
                t = _title(node)
                if any(kw in t for kw in prompt_keywords):
                    node.setdefault("inputs", {})["text"] = prompt
                    break

    if sfx_prompt:
        for node in _iter_nodes(wf):
            if node.get("class_type") == "MMAudioSampler":
                node.setdefault("inputs", {})["prompt"] = sfx_prompt

    if "12" in wf and wf["12"].get("class_type") == "WanVideoLoraSelectMulti":
        _apply_loras_wrapper(wf["12"], loras_high)
    if "22" in wf and wf["22"].get("class_type") == "WanVideoLoraSelectMulti":
        _apply_loras_wrapper(wf["22"], loras_low if loras_low is not None else loras_high)

    _apply_video_params(wf, params or {})
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
    wf = load_original_workflow("동영상 루프 워크플로우.json")
    return _patch_2stage_video(
        wf, image_path, image_path, bg_prompt, sfx_prompt,
        loras, loras_low, ("Positive", "루프"), params, output_prefix,
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
    wf = load_original_workflow("동영상 첫끝프레임 워크플로우.json")
    return _patch_2stage_video(
        wf, image_path, end_image_path, effect_prompt, sfx_prompt,
        loras, loras_low, ("Positive", "이펙트"), params, output_prefix,
    )


# ── 보조 ─────────────────────────────────────────────────────────────────

def patch_char_generate(
    character_name: str,
    description: str,
    negative_prompt: Optional[str] = None,
    resolution: tuple[Optional[int], Optional[int]] = (None, None),
    params: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    wf = load_original_workflow(
        "VN_Step1_QWEN_CharSheetGenerator_v1.json",
        fallback="vnccs_step1_sheet_ui.json",
    )
    _apply_character_sheet_prompt(
        wf,
        character_name=character_name,
        description=description,
        negative_prompt=negative_prompt,
        params=params or {},
    )
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


def patch_character_sheet(
    character_name: str,
    description: str,
    negative_prompt: Optional[str] = None,
    resolution: tuple[Optional[int], Optional[int]] = (None, None),
    params: Optional[dict] = None,
    output_prefix: Optional[str] = None,
) -> dict:
    wf = load_original_workflow(
        "VN_Step1_QWEN_CharSheetGenerator_v1.json",
        fallback="vnccs_step1_sheet_ui.json",
    )
    _apply_character_sheet_prompt(
        wf,
        character_name=character_name,
        description=description,
        negative_prompt=negative_prompt,
        params=params or {},
    )
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


def _apply_character_sheet_prompt(
    wf: dict,
    *,
    character_name: str,
    description: str,
    negative_prompt: Optional[str],
    params: dict,
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
        if negative_prompt:
            merged = ", ".join(x for x in [base_negative, negative_prompt] if x)
            inp["negative_prompt"] = merged
        if "seed" in params:
            inp["seed"] = int(params["seed"])
        return


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
        if cls == "FL_Qwen3TTS_VoiceDesign":
            inp["voice_description"] = voice_design_text
            inp["text"] = sample_text
            if language:
                inp["language"] = language
            for src, dst in {
                "top_k": "top_k",
                "top_p": "top_p",
                "temperature": "temperature",
                "repetition_penalty": "repetition_penalty",
                "max_new_tokens": "max_new_tokens",
                "seed": "seed",
            }.items():
                if src in params:
                    inp[dst] = params[src]
    _apply_filename_prefixes(wf, default_prefix=output_prefix)
    return wf
