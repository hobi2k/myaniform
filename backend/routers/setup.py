"""
/api/setup/status — 필수 모델 존재 여부 확인
프론트엔드 startup 체크에서 호출됨
"""
from pathlib import Path
from fastapi import APIRouter
import httpx

from ..services.model_catalog import (
    ANIMAGINE_XL_CHECKPOINT,
    APISR_UPSCALER,
    DMD2_SDXL_LORA,
    ILLUSTRIOUS_OPENPOSE_CONTROLNET,
    MMAUDIO_NSFW_MODEL,
    MMAUDIO_SFW_MODEL,
    QWEN_IMAGE_EDIT_UNET,
    QWEN_IMAGE_LIGHTNING_LORA,
    QWEN_IMAGE_TEXT_ENCODER,
    QWEN_IMAGE_VAE,
    QWEN_VNCCS_CLOTHES_LORA,
    QWEN_VNCCS_POSE_LORA,
    SAM_VIT_B,
    S2V_FASTFIDELITY_MODEL,
    SEEDVR2_DIT,
    SEEDVR2_VAE,
    ULTRALYTICS_FACE_BBOX,
    ULTRALYTICS_HAND_BBOX,
    ULTRALYTICS_PERSON_SEGM,
    VN_CHARACTER_SHEET_LORA,
)

router = APIRouter(prefix="/api/setup", tags=["setup"])

# ComfyUI models 루트 (backend는 myaniform/backend/ 에서 실행)
_MODELS = Path(__file__).resolve().parents[2] / "ComfyUI" / "models"
_CUSTOM_NODES = Path(__file__).resolve().parents[2] / "ComfyUI" / "custom_nodes"
_COMFYUI_URL = "http://127.0.0.1:8188"


def _any(*patterns: str) -> bool:
    return any(list(_MODELS.glob(p)) for p in patterns)


def _node_dir(*names: str) -> bool:
    return any((_CUSTOM_NODES / name).exists() for name in names)


@router.get("/status")
def setup_status():
    checks = {
        "sdxl_checkpoint":     _any("checkpoints/Dasiwa*.safetensors"),
        "animagine_checkpoint": _any(ANIMAGINE_XL_CHECKPOINT),
        "sdxl_clip":           _any("clip/*.safetensors"),
        "sdxl_vae":            _any("vae/sdxl*.safetensors", "vae/*sdxl*.safetensors"),
        "qwen_image_edit":      _any(f"unet/{QWEN_IMAGE_EDIT_UNET}"),
        "qwen_edit_lora":       _any(f"loras/{QWEN_IMAGE_LIGHTNING_LORA}"),
        "qwen_vl_encoder":      _any(f"text_encoders/{QWEN_IMAGE_TEXT_ENCODER}"),
        "qwen_image_vae":       _any(f"vae/{QWEN_IMAGE_VAE}"),
        "vnccs_poser":          _any(f"loras/{QWEN_VNCCS_POSE_LORA}"),
        "vnccs_clothes":        _any(f"loras/{QWEN_VNCCS_CLOTHES_LORA}"),
        "char_sheet_lora":      _any(VN_CHARACTER_SHEET_LORA),
        "dmd2_sdxl_lora":       _any(DMD2_SDXL_LORA),
        "openpose_controlnet":  _any(ILLUSTRIOUS_OPENPOSE_CONTROLNET),
        "sam_vit_b":           _any(SAM_VIT_B),
        "apisr_upscaler":       _any(APISR_UPSCALER),
        "seedvr2_dit":          _any(SEEDVR2_DIT),
        "seedvr2_vae":          _any(SEEDVR2_VAE),
        "ultra_face":           _any(ULTRALYTICS_FACE_BBOX),
        "ultra_hand":           _any(ULTRALYTICS_HAND_BBOX),
        "ultra_person_segm":    _any(ULTRALYTICS_PERSON_SEGM),
        "s2v_diffusion":       _any("diffusion_models/wan_s2v/*.safetensors",
                                    "diffusion_models/wan_s2v/*.gguf"),
        "s2v_fastfidelity":    _any(f"diffusion_models/{S2V_FASTFIDELITY_MODEL}"),
        "audio_encoder":       _any("audio_encoders/*.safetensors"),
        "audio_encoder_fp16":  _any("audio_encoders/wav2vec2_large_english_fp16.safetensors"),
        "text_encoder":        _any("text_encoders/*.safetensors"),
        "wan_vae":             _any("vae/[Ww]an*.safetensors", "vae/wan_2.1_vae.safetensors"),
        "i2v_high":            _any("diffusion_models/wan_i2v_high/*.safetensors"),
        "i2v_low":             _any("diffusion_models/wan_i2v_low/*.safetensors"),
        "lora_smoothmix":      _any("loras/wan_smoothmix/*.safetensors"),
        "lora_anieffect":      _any("loras/wan_anieffect/*.safetensors"),
        "qwen3_tts":           _any("Qwen3-TTS/Qwen3-TTS-*"),
        "fish_s2pro":          _any("fishaudioS2/s2-pro/model-*.safetensors"),
        "mmaudio_large":       _any(f"mmaudio/{MMAUDIO_SFW_MODEL}"),
        "mmaudio_nsfw":        _any(f"mmaudio/{MMAUDIO_NSFW_MODEL}"),
        "mmaudio_vae":         _any("mmaudio/mmaudio_vae*.safetensors"),
        "mmaudio_synchformer": _any("mmaudio/mmaudio_synchformer*.safetensors"),
        "mmaudio_clip":        _any("mmaudio/apple_DFN5B-CLIP-ViT-H-14-384*.safetensors"),
        "ipadapter_faceid":    _any("ipadapter/ip-adapter-faceid*.bin"),
        "clip_vision":         _any("clip_vision/*.safetensors"),
        "node_universaltoolkit": _node_dir("universaltoolkit", "ComfyUI-UniversalToolkit"),
        "node_audio_separation": _node_dir("audio-separation-nodes-comfyui"),
        "node_wanvideo":       _node_dir("ComfyUI-WanVideoWrapper"),
        "node_mmaudio":        _node_dir("ComfyUI-MMAudio"),
        "node_geeky_audio":    _node_dir("ComfyUI_Geeky_AudioMixer"),
        "node_qwen3_tts":      _node_dir("ComfyUI_Qwen3-TTS"),
    }

    # 없이도 기본 기능은 동작 — critical vs optional 분류
    critical = [
        "animagine_checkpoint", "qwen_image_edit", "qwen_edit_lora",
        "qwen_vl_encoder", "qwen_image_vae", "vnccs_poser",
        "vnccs_clothes", "char_sheet_lora", "dmd2_sdxl_lora",
        "openpose_controlnet", "sam_vit_b", "apisr_upscaler",
        "seedvr2_dit", "seedvr2_vae",
        "ultra_face", "ultra_hand", "ultra_person_segm",
        "s2v_diffusion", "s2v_fastfidelity", "audio_encoder", "audio_encoder_fp16", "text_encoder", "wan_vae",
        "i2v_high", "i2v_low", "qwen3_tts",
        "mmaudio_large", "mmaudio_nsfw", "mmaudio_vae", "mmaudio_synchformer", "mmaudio_clip",
        "node_universaltoolkit", "node_audio_separation",
        "node_wanvideo", "node_mmaudio", "node_geeky_audio", "node_qwen3_tts",
    ]
    # AniEffect 등은 LoRA 옵션이라 critical이 아님
    optional = [k for k in checks if k not in critical]

    missing_critical = [k for k in critical if not checks[k]]
    missing_optional = [k for k in optional if not checks[k]]

    ready = len(missing_critical) == 0

    return {
        "ready": ready,
        "checks": checks,
        "missing_critical": missing_critical,
        "missing_optional": missing_optional,
        "models_path": str(_MODELS),
    }


@router.get("/loras")
def list_loras():
    """ComfyUI/models/loras 아래 *.safetensors 목록 — 씬별 LoRA 선택용."""
    root = _MODELS / "loras"
    if not root.exists():
        return {"loras": []}
    items = []
    for p in sorted(root.rglob("*.safetensors")):
        rel = p.relative_to(root).as_posix()
        items.append({"name": rel, "group": rel.split("/", 1)[0] if "/" in rel else ""})
    return {"loras": items}


def _scan_models(
    subdir: str,
    extensions: tuple[str, ...] = (".safetensors", ".gguf"),
    relative_to: str | None = None,
) -> list[dict]:
    """모델 파일 스캔.

    relative_to 를 주면 해당 디렉토리 기준 상대 경로를 반환한다.
    예:
    - checkpoints => CheckpointLoaderSimple.ckpt_name 호환
    - unet => UnetLoaderGGUF.unet_name 호환
    - diffusion_models => UNETLoader.unet_name 호환
    """
    root = _MODELS / subdir
    rel_root = _MODELS / relative_to if relative_to else root
    if not root.exists():
        return []
    items = []
    for p in sorted(root.rglob("*")):
        if p.suffix.lower() in extensions and p.is_file():
            rel = p.relative_to(rel_root).as_posix()
            items.append({
                "name": rel,
                "filename": p.name,
                "size_gb": round(p.stat().st_size / 1e9, 1),
            })
    return items


@router.get("/diffusion_models")
def list_diffusion_models():
    """I2V / S2V 디퓨전 모델 목록 — 씬별 모델 선택용."""
    return {
        "i2v_high": _scan_models("diffusion_models/wan_i2v_high", relative_to="diffusion_models"),
        "i2v_low": _scan_models("diffusion_models/wan_i2v_low", relative_to="diffusion_models"),
        "s2v": _scan_models("diffusion_models/wan_s2v", relative_to="diffusion_models"),
    }


@router.get("/image_models")
def list_image_models():
    """이미지 생성용 모델 목록.

    - checkpoints: SDXL / 캐릭터 시트 계열 CheckpointLoaderSimple.ckpt_name
    - qwen_edit: Qwen Edit 계열 UnetLoaderGGUF.unet_name
    """
    qwen_edit_models = [
        item
        for item in _scan_models("unet", relative_to="unet")
        if "qwen-image-edit" in item["name"].lower()
    ]
    return {
        "checkpoints": _scan_models("checkpoints", extensions=(".safetensors", ".ckpt", ".pt"), relative_to="checkpoints"),
        "qwen_edit": qwen_edit_models,
    }


@router.get("/comfy_status")
async def comfy_status():
    """ComfyUI 연결 상태 및 간단한 진단."""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{_COMFYUI_URL}/system_stats", timeout=3)
            res.raise_for_status()
        return {"online": True, "url": _COMFYUI_URL}
    except Exception as exc:
        return {
            "online": False,
            "url": _COMFYUI_URL,
            "detail": str(exc),
        }
