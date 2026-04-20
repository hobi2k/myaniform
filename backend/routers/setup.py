"""
/api/setup/status — 필수 모델 존재 여부 확인
프론트엔드 startup 체크에서 호출됨
"""
from pathlib import Path
from fastapi import APIRouter

router = APIRouter(prefix="/api/setup", tags=["setup"])

# ComfyUI models 루트 (backend는 myaniform/backend/ 에서 실행)
_MODELS = Path(__file__).resolve().parents[2] / "ComfyUI" / "models"


def _any(*patterns: str) -> bool:
    return any(list(_MODELS.glob(p)) for p in patterns)


@router.get("/status")
def setup_status():
    checks = {
        "sdxl_checkpoint":     _any("checkpoints/Dasiwa*.safetensors"),
        "sdxl_clip":           _any("clip/*.safetensors"),
        "sdxl_vae":            _any("vae/sdxl*.safetensors", "vae/*sdxl*.safetensors"),
        "s2v_diffusion":       _any("diffusion_models/wan_s2v/*.safetensors",
                                    "diffusion_models/wan_s2v/*.gguf"),
        "audio_encoder":       _any("audio_encoders/*.safetensors"),
        "text_encoder":        _any("text_encoders/*.safetensors"),
        "wan_vae":             _any("vae/[Ww]an*.safetensors"),
        "i2v_high":            _any("diffusion_models/wan_i2v_high/*.safetensors"),
        "i2v_low":             _any("diffusion_models/wan_i2v_low/*.safetensors"),
        "lora_smoothmix":      _any("loras/wan_smoothmix/*.safetensors"),
        "lora_anieffect":      _any("loras/wan_anieffect/*.safetensors"),
        "qwen3_tts":           _any("tts/Qwen3TTS/Qwen3-TTS-*",
                                    "tts/Qwen3-TTS-*"),
        "fish_s2pro":          _any("fishaudioS2/s2-pro/model-*.safetensors"),
        "mmaudio_large":       _any("mmaudio/mmaudio_large_44k*.safetensors"),
        "mmaudio_vae":         _any("mmaudio/mmaudio_vae*.safetensors"),
        "mmaudio_synchformer": _any("mmaudio/mmaudio_synchformer*.safetensors"),
        "ipadapter_faceid":    _any("ipadapter/ip-adapter-faceid*.bin"),
        "clip_vision":         _any("clip_vision/*.safetensors"),
    }

    # 없이도 기본 기능은 동작 — critical vs optional 분류
    critical = [
        "s2v_diffusion", "audio_encoder", "text_encoder", "wan_vae",
        "i2v_high", "i2v_low", "qwen3_tts",
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


def _scan_models(subdir: str, extensions: tuple[str, ...] = (".safetensors", ".gguf")) -> list[dict]:
    """모델 파일 스캔. name 은 diffusion_models/ 기준 상대 경로 (UNETLoader.unet_name 호환)."""
    root = _MODELS / subdir
    diff_root = _MODELS / "diffusion_models"
    if not root.exists():
        return []
    items = []
    for p in sorted(root.rglob("*")):
        if p.suffix.lower() in extensions and p.is_file():
            # UNETLoader expects path relative to models/diffusion_models/
            rel = p.relative_to(diff_root).as_posix() if str(p).startswith(str(diff_root)) else p.relative_to(_MODELS).as_posix()
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
        "i2v_high": _scan_models("diffusion_models/wan_i2v_high"),
        "i2v_low": _scan_models("diffusion_models/wan_i2v_low"),
        "s2v": _scan_models("diffusion_models/wan_s2v"),
    }
