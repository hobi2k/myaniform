#!/usr/bin/env bash
# 필수 모델 존재 여부 확인
# 실행: bash check_models.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS="$ROOT/ComfyUI/models"

ok=0
missing=0

check() {
    local label="$1"
    local pattern="$2"
    if ls $pattern 2>/dev/null | grep -q .; then
        echo "  ✅  $label"
        ((ok++))
    else
        echo "  ❌  $label  →  $pattern"
        ((missing++))
    fi
}

echo "================================================================="
echo "  myaniform 모델 체크"
echo "================================================================="
echo ""

echo "── 이미지 생성 ──────────────────────────────────────────────────"
check "Dasiwa Illustrious SDXL checkpoint" "$MODELS/checkpoints/Dasiwa*.safetensors"
check "SDXL CLIP" "$MODELS/clip/*.safetensors"
check "SDXL VAE" "$MODELS/vae/*.safetensors"

echo ""
echo "── S2V 립싱크 ───────────────────────────────────────────────────"
check "Wan2.2 S2V diffusion model" "$MODELS/diffusion_models/wan_s2v/*"
check "Audio Encoder (S2V)" "$MODELS/audio_encoders/*.safetensors"
check "WanVideo T5 Text Encoder" "$MODELS/text_encoders/*.safetensors"
check "WanVideo VAE" "$MODELS/vae/[Ww]an*.safetensors"

echo ""
echo "── I2V 루프/이펙트 ──────────────────────────────────────────────"
check "I2V High noise model (SmoothMix)" "$MODELS/diffusion_models/wan_i2v_high/*.safetensors"
check "I2V Low noise model (Dasiwa)" "$MODELS/diffusion_models/wan_i2v_low/*.safetensors"

echo ""
echo "── LoRA ─────────────────────────────────────────────────────────"
check "SmoothMix Animation LoRA" "$MODELS/loras/wan_smoothmix/*.safetensors"
check "AniEffect LoRA (선택)" "$MODELS/loras/wan_anieffect/*.safetensors"

echo ""
echo "── TTS (수동 다운로드 필요 — gated / 특수) ─────────────────────"
check "Qwen3-TTS Base" "$MODELS/tts/Qwen3TTS/Qwen3-TTS-12Hz-1.7B-Base/model.safetensors"
check "Qwen3-TTS CustomVoice" "$MODELS/tts/Qwen3TTS/Qwen3-TTS-12Hz-1.7B-CustomVoice/model.safetensors"
check "Qwen3-TTS VoiceDesign" "$MODELS/tts/Qwen3TTS/Qwen3-TTS-12Hz-1.7B-VoiceDesign/model.safetensors"
check "Qwen3-TTS Tokenizer" "$MODELS/tts/Qwen3TTS/Qwen3-TTS-Tokenizer-12Hz/model.safetensors"
check "Fish Audio S2 Pro" "$MODELS/fishaudioS2/s2-pro/model-00001-of-00002.safetensors"

echo ""
echo "── MMAudio ──────────────────────────────────────────────────────"
check "MMAudio large 44k" "$MODELS/mmaudio/mmaudio_large_44k*.safetensors"
check "MMAudio VAE" "$MODELS/mmaudio/mmaudio_vae*.safetensors"
check "MMAudio Synchformer" "$MODELS/mmaudio/mmaudio_synchformer*.safetensors"

echo ""
echo "── Qwen Image Edit (캐릭터 일관성 메인) ─────────────────────────"
check "Qwen Image Edit GGUF (Q5_0)"      "$MODELS/unet/qwen-image-edit-2511-Q*.gguf"
check "Qwen Edit Lightning 4-step LoRA"  "$MODELS/loras/qwen/Qwen-Image-Edit*Lightning*.safetensors"
check "Qwen 2.5 VL Text Encoder"         "$MODELS/text_encoders/qwen_2.5_vl_7b*.safetensors"
check "Qwen Image VAE"                   "$MODELS/vae/qwen_image_vae.safetensors"

echo ""
echo "── VNCCS LoRA / ControlNet ──────────────────────────────────────"
check "poser_helper_v2 LoRA"             "$MODELS/loras/qwen/VNCCS/poser_helper_v2*.safetensors"
check "ClothesHelperUltimate LoRA"       "$MODELS/loras/qwen/VNCCS/ClothesHelperUltimate*.safetensors"
check "EmotionCore LoRA"                 "$MODELS/loras/qwen/VNCCS/EmotionCore*.safetensors"
check "TransferClothes LoRA"             "$MODELS/loras/qwen/VNCCS/TransferClothes*.safetensors"
check "Character Sheet SDXL LoRA"        "$MODELS/loras/vn_character_sheet*.safetensors"
check "DMD2 SDXL 4-step LoRA"            "$MODELS/loras/DMD2/dmd2_sdxl*.safetensors"
check "Illustrious OpenPose ControlNet"  "$MODELS/controlnet/SDXL/IllustriousXL_openpose.safetensors"
check "SAM ViT-B"                        "$MODELS/sams/sam_vit_b*.pth"
check "APISR 4x Upscaler"                "$MODELS/upscale_models/4x_APISR*.pth"

echo ""
echo "── FaceDetailer (bbox 모델) ─────────────────────────────────────"
check "face_yolov8m (얼굴 감지)"          "$MODELS/ultralytics/bbox/face_yolov8m.pt"
check "hand_yolov8s (손 감지)"            "$MODELS/ultralytics/bbox/hand_yolov8s.pt"

echo ""
echo "── IP-Adapter (레거시, SDXL fallback) ───────────────────────────"
check "IP-Adapter FaceID SDXL" "$MODELS/ipadapter/ip-adapter-faceid*.bin"
check "CLIP Vision SDXL" "$MODELS/clip_vision/*.safetensors"

echo ""
echo "================================================================="
echo "  결과: ✅ $ok 개 확인됨 / ❌ $missing 개 누락"
echo "================================================================="

if [ "$missing" -gt 0 ]; then
    echo ""
    echo "  누락된 모델은 docs/models-and-nodes.md 를 참조하여 배치하세요."
    echo "  배치 후 다시 bash check_models.sh 로 확인하세요."
    exit 1
else
    echo ""
    echo "  모든 필수 모델이 준비되었습니다. 서버를 실행하세요:"
    echo "    터미널 1-2: bash run.sh   (ComfyUI + FastAPI)"
    echo "    터미널 3:   cd frontend && npm run dev"
fi
