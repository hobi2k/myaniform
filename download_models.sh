#!/usr/bin/env bash
# myaniform 모델 자동 다운로드
# - HuggingFace: 공개 모델 직접 다운로드
# - Civitai:     .civitai_token 또는 CIVITAI_TOKEN 환경변수 사용
#
# 사용:
#   bash download_models.sh              # 전체
#   bash download_models.sh --hf-only    # HF 모델만
#   bash download_models.sh --civitai    # Civitai만
#   bash download_models.sh --list       # 목록만 출력

# 개별 다운로드 실패가 전체 스크립트를 죽이지 않도록 set -e 사용하지 않음.
# 실패 항목은 마지막 요약에서 집계됨.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS="$ROOT/ComfyUI/models"
FAILED_DOWNLOADS=()

# Civitai 토큰 로드
if [ -z "$CIVITAI_TOKEN" ] && [ -f "$ROOT/.civitai_token" ]; then
    CIVITAI_TOKEN="$(tr -d '[:space:]' < "$ROOT/.civitai_token")"
fi

# HuggingFace 토큰 로드 (gated repo용)
if [ -z "$HF_TOKEN" ] && [ -f "$ROOT/.hf_token" ]; then
    HF_TOKEN="$(tr -d '[:space:]' < "$ROOT/.hf_token")"
fi

MODE="${1:-all}"  # all | --hf-only | --civitai | --list

# ═══════════════════════════════════════════════════════════════════
# 다운로드 헬퍼
# ═══════════════════════════════════════════════════════════════════
hf_dl() {
    # hf_dl <repo> <path-in-repo> <local_dir> [local_filename]
    local repo="$1"
    local path="$2"
    local dest_dir="$3"
    local dest_name="${4:-$(basename "$path")}"
    local full="$dest_dir/$dest_name"

    if [ "$MODE" = "--list" ]; then
        printf "  [HF]      %-55s  ← %s/%s\n" "$dest_name" "$repo" "$path"
        return
    fi
    mkdir -p "$dest_dir"
    if [ -s "$full" ]; then
        printf "  ✓ %-55s  (이미 존재, %s)\n" "$dest_name" "$(du -h "$full" | cut -f1)"
        return
    fi
    local url="https://huggingface.co/$repo/resolve/main/$path"
    printf "  ↓ %-55s  (%s)\n" "$dest_name" "$repo"
    local auth_args=()
    [ -n "$HF_TOKEN" ] && auth_args+=(-H "Authorization: Bearer $HF_TOKEN")

    # 재시도 포함 curl. --retry 로 네트워크 글리치 대응, -C - 로 부분 파일 이어받기.
    local attempt=0
    local max_attempts=3
    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))
        if curl -L --fail --progress-bar \
            --retry 5 --retry-delay 3 --retry-all-errors \
            --connect-timeout 30 \
            -C - \
            -H "User-Agent: myaniform/1.0" \
            "${auth_args[@]}" \
            -o "$full.part" "$url"; then
            mv "$full.part" "$full"
            return 0
        fi
        echo "    ⚠ 시도 $attempt/$max_attempts 실패, 재시도..."
        sleep 5
    done
    echo "    ❌ 다운로드 최종 실패: $url"
    FAILED_DOWNLOADS+=("$repo/$path")
    return 0  # set -e 없지만 호출부 안전하게 0 반환 (실패는 배열로 추적)
}

hf_rev_dl() {
    # hf_rev_dl <repo> <revision> <path-in-repo> <local_dir> [local_filename]
    local repo="$1"
    local revision="$2"
    local path="$3"
    local dest_dir="$4"
    local dest_name="${5:-$(basename "$path")}"
    local full="$dest_dir/$dest_name"

    if [ "$MODE" = "--list" ]; then
        printf "  [HF@rev]  %-55s  ← %s@%s/%s\n" "$dest_name" "$repo" "$revision" "$path"
        return
    fi
    mkdir -p "$dest_dir"
    if [ -s "$full" ]; then
        printf "  ✓ %-55s  (이미 존재, %s)\n" "$dest_name" "$(du -h "$full" | cut -f1)"
        return
    fi
    local url="https://huggingface.co/$repo/resolve/$revision/$path"
    printf "  ↓ %-55s  (%s@%s)\n" "$dest_name" "$repo" "$revision"
    local auth_args=()
    [ -n "$HF_TOKEN" ] && auth_args+=(-H "Authorization: Bearer $HF_TOKEN")

    local attempt=0
    local max_attempts=3
    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))
        if curl -L --fail --progress-bar \
            --retry 5 --retry-delay 3 --retry-all-errors \
            --connect-timeout 30 \
            -C - \
            -H "User-Agent: myaniform/1.0" \
            "${auth_args[@]}" \
            -o "$full.part" "$url"; then
            mv "$full.part" "$full"
            return 0
        fi
        echo "    ⚠ 시도 $attempt/$max_attempts 실패, 재시도..."
        sleep 5
    done
    echo "    ❌ 다운로드 최종 실패: $url"
    FAILED_DOWNLOADS+=("$repo@$revision/$path")
    return 0
}

civitai_dl() {
    # civitai_dl <version_id> <local_dir> <local_filename>
    local vid="$1"
    local dest_dir="$2"
    local dest_name="$3"
    local full="$dest_dir/$dest_name"

    if [ "$MODE" = "--list" ]; then
        printf "  [Civitai] %-55s  ← versionId=%s\n" "$dest_name" "$vid"
        return
    fi
    if [ -z "$CIVITAI_TOKEN" ]; then
        printf "  ✗ %-55s  (CIVITAI_TOKEN 없음, 스킵)\n" "$dest_name"
        return 1
    fi
    mkdir -p "$dest_dir"
    if [ -s "$full" ]; then
        printf "  ✓ %-55s  (이미 존재, %s)\n" "$dest_name" "$(du -h "$full" | cut -f1)"
        return
    fi
    printf "  ↓ %-55s  (Civitai vid=%s)\n" "$dest_name" "$vid"
    local attempt=0
    local max_attempts=3
    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))
        if curl -L --fail --progress-bar \
            --retry 5 --retry-delay 3 --retry-all-errors \
            --connect-timeout 30 \
            -C - \
            -H "Authorization: Bearer $CIVITAI_TOKEN" \
            -o "$full.part" \
            "https://civitai.com/api/download/models/$vid"; then
            mv "$full.part" "$full"
            return 0
        fi
        echo "    ⚠ 시도 $attempt/$max_attempts 실패, 재시도..."
        sleep 5
    done
    echo "    ❌ 다운로드 최종 실패 (vid=$vid)"
    FAILED_DOWNLOADS+=("civitai:$vid")
    return 0
}

# ═══════════════════════════════════════════════════════════════════
# 모델 목록
# ═══════════════════════════════════════════════════════════════════
download_hf() {
    echo ""
    echo "━━━ WanVideo 공통 (T5 + VAE) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    hf_dl "Kijai/WanVideo_comfy" "umt5-xxl-enc-bf16.safetensors"          "$MODELS/text_encoders"
    hf_dl "Kijai/WanVideo_comfy" "Wan2_1_VAE_bf16.safetensors"            "$MODELS/vae"

    echo ""
    echo "━━━ Wan 2.2 I2V 14B High/Low (bf16) ━━━━━━━━━━━━━━━━━━━━━━"
    hf_dl "Kijai/WanVideo_comfy" "Wan2_2-I2V-A14B-HIGH_bf16.safetensors"  "$MODELS/diffusion_models/wan_i2v_high"
    hf_dl "Kijai/WanVideo_comfy" "Wan2_2-I2V-A14B-LOW_bf16.safetensors"   "$MODELS/diffusion_models/wan_i2v_low"

    echo ""
    echo "━━━ Wan 2.2 S2V 14B (GGUF Q4 — VRAM 효율) ━━━━━━━━━━━━━━━━━"
    hf_dl "QuantStack/Wan2.2-S2V-14B-GGUF" "Wan2.2-S2V-14B-Q4_K_M.gguf"   "$MODELS/diffusion_models/wan_s2v"

    echo ""
    echo "━━━ S2V Audio Encoder (wav2vec2 large english) ━━━━━━━━━━━"
    hf_dl "Wan-AI/Wan2.2-S2V-14B" "wav2vec2-large-xlsr-53-english/model.safetensors" \
          "$MODELS/audio_encoders" "wav2vec2_large_english_fp32.safetensors"

    echo ""
    echo "━━━ MMAudio (SFX 생성) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    hf_dl "Kijai/MMAudio_safetensors" "mmaudio_large_44k_v2_fp16.safetensors"        "$MODELS/mmaudio"
    hf_dl "Kijai/MMAudio_safetensors" "mmaudio_vae_44k_fp16.safetensors"             "$MODELS/mmaudio"
    hf_dl "Kijai/MMAudio_safetensors" "mmaudio_synchformer_fp16.safetensors"         "$MODELS/mmaudio"
    hf_dl "Kijai/MMAudio_safetensors" "apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors" "$MODELS/mmaudio"

    echo ""
    echo "━━━ Qwen Image Edit 2511 (캐릭터 일관성 메인 엔진, GGUF Q5_0) ━━━"
    # Q5_0 quantization ≈ 14.4GB. 이미지 편집 모델 — 기존 이미지를 입력받아 새 포즈·구도로 재생성
    hf_dl "unsloth/Qwen-Image-Edit-2511-GGUF" "qwen-image-edit-2511-Q5_0.gguf" \
          "$MODELS/unet"

    echo ""
    echo "━━━ Qwen Image Edit Lightning LoRA (4-step distill) ━━━━━━━"
    # cfg=1, steps=4 추론 가속
    hf_dl "lightx2v/Qwen-Image-Edit-2511-Lightning" \
          "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" \
          "$MODELS/loras/qwen"

    echo ""
    echo "━━━ Qwen Image Text Encoder + VAE (Qwen Edit 전용) ━━━━━━━━"
    hf_dl "Comfy-Org/Qwen-Image_ComfyUI" "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors" \
          "$MODELS/text_encoders" "qwen_2.5_vl_7b_fp8_scaled.safetensors"
    hf_dl "Comfy-Org/Qwen-Image_ComfyUI" "split_files/vae/qwen_image_vae.safetensors" \
          "$MODELS/vae" "qwen_image_vae.safetensors"

    echo ""
    echo "━━━ VNCCS 캐릭터 일관성 LoRA 세트 (MIUProject) ━━━━━━━━━━━━"
    # Qwen Edit과 함께 사용하는 포즈·의상·감정 전이 LoRA
    for f in \
        "models/loras/qwen/VNCCS/poser_helper_v2_000004200.safetensors" \
        "models/loras/qwen/VNCCS/ClothesHelperUltimateV1_000005100.safetensors" \
        "models/loras/qwen/VNCCS/EmotionCoreV2_000004700.safetensors" \
        "models/loras/qwen/VNCCS/TransferClothes_000006700.safetensors"; do
        hf_dl "MIUProject/VNCCS" "$f" "$MODELS/loras/qwen/VNCCS" "$(basename "$f")"
    done

    # 캐릭터 시트 생성용 SDXL LoRA
    hf_dl "MIUProject/VNCCS" "models/loras/vn_character_sheet_v4.safetensors" \
          "$MODELS/loras" "vn_character_sheet_v4.safetensors"
    hf_dl "MIUProject/VNCCS" "models/loras/DMD2/dmd2_sdxl_4step_lora_fp16.safetensors" \
          "$MODELS/loras/DMD2" "dmd2_sdxl_4step_lora_fp16.safetensors"

    # 포즈 제어용 ControlNet (Illustrious용)
    hf_dl "MIUProject/VNCCS" "models/controlnet/SDXL/IllustriousXL_openpose.safetensors" \
          "$MODELS/controlnet/SDXL" "IllustriousXL_openpose.safetensors"
    hf_dl "MIUProject/VNCCS" "models/controlnet/SDXL/AnytestV4.safetensors" \
          "$MODELS/controlnet/SDXL" "AnytestV4.safetensors"

    # 원본 VN Step1 LoRA
    hf_dl "MIUProject/VNCCS" "models/loras/IL/mimimeter.safetensors" \
          "$MODELS/loras/IL" "mimimeter.safetensors"

    # SAM + APISR 업스케일러
    hf_dl "MIUProject/VNCCS" "models/sams/sam_vit_b_01ec64.pth" \
          "$MODELS/sams" "sam_vit_b_01ec64.pth"
    hf_dl "MIUProject/VNCCS" "models/upscale_models/2x_APISR_RRDB_GAN_generator.pth" \
          "$MODELS/upscale_models" "2x_APISR_RRDB_GAN_generator.pth"
    hf_dl "MIUProject/VNCCS" "models/upscale_models/4x_APISR_GRL_GAN_generator.pth" \
          "$MODELS/upscale_models" "4x_APISR_GRL_GAN_generator.pth"

    echo ""
    echo "━━━ SeedVR2 업스케일 모델 (원본 VN Step1 업스케일 체인) ━━━"
    hf_dl "numz/SeedVR2_comfyUI" "seedvr2_ema_3b_fp16.safetensors" \
          "$MODELS/SEEDVR2" "seedvr2_ema_3b_fp16.safetensors"
    hf_dl "numz/SeedVR2_comfyUI" "ema_vae_fp16.safetensors" \
          "$MODELS/SEEDVR2" "ema_vae_fp16.safetensors"

    echo ""
    echo "━━━ FaceDetailer bbox 모델 (얼굴 자동 리파인) ━━━━━━━━━━━━━"
    hf_dl "Bingsu/adetailer" "face_yolov8m.pt" \
          "$MODELS/ultralytics/bbox" "face_yolov8m.pt"
    hf_dl "Bingsu/adetailer" "hand_yolov8s.pt" \
          "$MODELS/ultralytics/bbox" "hand_yolov8s.pt"

    echo ""
    echo "━━━ (Legacy) IP-Adapter FaceID — 호환성 유지 ━━━━━━━━━━━━━━"
    # Qwen Edit 파이프라인이 기본. IPAdapter는 SDXL-only 대체 경로용.
    hf_dl "h94/IP-Adapter-FaceID" "ip-adapter-faceid-plusv2_sdxl.bin"                "$MODELS/ipadapter"
    hf_dl "h94/IP-Adapter-FaceID" "ip-adapter-faceid-plusv2_sdxl_lora.safetensors"   "$MODELS/loras"

    echo ""
    echo "━━━ CLIP Vision (SDXL, IP-Adapter용) ━━━━━━━━━━━━━━━━━━━━━"
    hf_dl "h94/IP-Adapter" "models/image_encoder/model.safetensors" \
          "$MODELS/clip_vision" "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"

    echo ""
    echo "━━━ SDXL VAE (fp16 fix) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    hf_dl "madebyollin/sdxl-vae-fp16-fix" "sdxl_vae.safetensors"                     "$MODELS/vae"

    echo ""
    echo "━━━ ILFlatMix 원본 체크포인트 (VN Step1 원본 워크플로우) ━━━"
    hf_rev_dl "MIUProject/ILFlatMix" \
        "143a907f20c1380658c5d6e9c768a2f3dc4c4874" \
        "ILFlatMixV4_00001_.safetensors" \
        "$MODELS/checkpoints/Illustrious" \
        "ILFlatMix.safetensors"

    echo ""
    echo "━━━ SDXL Text Encoder (CLIP G, 루프용 이미지 생성) ━━━━━━━━"
    hf_dl "comfyanonymous/flux_text_encoders" "clip_l.safetensors"                   "$MODELS/clip"

    # ─── Qwen3-TTS (gated, HF_TOKEN 필요, FL-Qwen3TTS 노드용) ───
    # 저장 경로: ComfyUI/models/tts/Qwen3TTS/<variant>/ (노드 규약)
    if [ -z "$HF_TOKEN" ]; then
        echo ""
        echo "━━━ Qwen3-TTS (HF_TOKEN 없음, 스킵) ━━━━━━━━━━━━━━━━━━━━━━"
        return
    fi

    local Q3BASE="$MODELS/tts/Qwen3TTS"

    echo ""
    echo "━━━ Qwen3-TTS Base (1.7B, 음성 클로닝·파인튜닝) ━━━━━━━━━━"
    local REPO="Qwen/Qwen3-TTS-12Hz-1.7B-Base"
    local DST="$Q3BASE/Qwen3-TTS-12Hz-1.7B-Base"
    for f in config.json generation_config.json merges.txt vocab.json \
             preprocessor_config.json tokenizer_config.json model.safetensors; do
        hf_dl "$REPO" "$f" "$DST"
    done
    for f in speech_tokenizer/config.json speech_tokenizer/configuration.json \
             speech_tokenizer/preprocessor_config.json speech_tokenizer/model.safetensors; do
        hf_dl "$REPO" "$f" "$DST/speech_tokenizer" "$(basename "$f")"
    done

    echo ""
    echo "━━━ Qwen3-TTS CustomVoice (9개 사전정의 보이스) ━━━━━━━━━━"
    REPO="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
    DST="$Q3BASE/Qwen3-TTS-12Hz-1.7B-CustomVoice"
    for f in config.json generation_config.json merges.txt vocab.json \
             preprocessor_config.json tokenizer_config.json model.safetensors; do
        hf_dl "$REPO" "$f" "$DST"
    done
    for f in speech_tokenizer/config.json speech_tokenizer/configuration.json \
             speech_tokenizer/preprocessor_config.json speech_tokenizer/model.safetensors; do
        hf_dl "$REPO" "$f" "$DST/speech_tokenizer" "$(basename "$f")"
    done

    echo ""
    echo "━━━ Qwen3-TTS VoiceDesign (텍스트 설명 보이스 생성) ━━━━━━"
    REPO="Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
    DST="$Q3BASE/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
    for f in config.json generation_config.json merges.txt vocab.json \
             preprocessor_config.json tokenizer_config.json model.safetensors; do
        hf_dl "$REPO" "$f" "$DST"
    done
    for f in speech_tokenizer/config.json speech_tokenizer/configuration.json \
             speech_tokenizer/preprocessor_config.json speech_tokenizer/model.safetensors; do
        hf_dl "$REPO" "$f" "$DST/speech_tokenizer" "$(basename "$f")"
    done

    echo ""
    echo "━━━ Qwen3-TTS Tokenizer (12Hz audio codec) ━━━━━━━━━━━━━━━"
    REPO="Qwen/Qwen3-TTS-Tokenizer-12Hz"
    DST="$Q3BASE/Qwen3-TTS-Tokenizer-12Hz"
    for f in config.json configuration.json preprocessor_config.json model.safetensors; do
        hf_dl "$REPO" "$f" "$DST"
    done

    echo ""
    echo "━━━ Fish Audio S2 Pro (대사 TTS, ~24GB) ━━━━━━━━━━━━━━━━━━"
    REPO="fishaudio/s2-pro"
    DST="$MODELS/fishaudioS2/s2-pro"
    for f in config.json chat_template.jinja codec.pth \
             model-00001-of-00002.safetensors model-00002-of-00002.safetensors \
             model.safetensors.index.json special_tokens_map.json \
             tokenizer.json tokenizer_config.json; do
        hf_dl "$REPO" "$f" "$DST"
    done
}

download_civitai() {
    echo ""
    echo "━━━ Civitai — SDXL Anime Checkpoint ━━━━━━━━━━━━━━━━━━━━━━"
    # Dasiwa Illustrious (Realistic 계열 대체)
    civitai_dl "2682302" "$MODELS/checkpoints" "DasiwaIllustriousRealistic_v1.safetensors"
    # 대체 옵션 - WAI-illustrious
    civitai_dl "2514310" "$MODELS/checkpoints" "waiIllustriousSDXL_v160.safetensors"

    echo ""
    echo "━━━ Civitai — SmoothMix Ultimate (루프 I2V High 대체) ━━━━"
    civitai_dl "2746772" "$MODELS/diffusion_models/wan_i2v_high" "smoothmixUltimate_illustriousV20.safetensors"

    echo ""
    echo "━━━ Civitai — SmoothMix LoRA (애니메이션 모션) ━━━━━━━━━━━"
    civitai_dl "2695694" "$MODELS/loras/wan_smoothmix" "SmoothMix_illustrious.safetensors"
}

# ═══════════════════════════════════════════════════════════════════
# 실행
# ═══════════════════════════════════════════════════════════════════
echo "================================================================="
echo "  myaniform 모델 다운로드"
echo "  저장 경로: $MODELS"
if [ -n "$CIVITAI_TOKEN" ]; then
    echo "  Civitai:   토큰 로드됨"
else
    echo "  Civitai:   토큰 없음 (HF만 다운로드)"
fi
echo "================================================================="

case "$MODE" in
    --hf-only)   download_hf ;;
    --civitai)   download_civitai ;;
    --list)      download_hf; download_civitai ;;
    *)           download_hf; download_civitai ;;
esac

echo ""
echo "================================================================="
if [ ${#FAILED_DOWNLOADS[@]} -gt 0 ]; then
    echo "  ⚠ 실패한 다운로드 ${#FAILED_DOWNLOADS[@]} 개:"
    for f in "${FAILED_DOWNLOADS[@]}"; do
        echo "     - $f"
    done
    echo "  → 네트워크 안정화 후 bash download_models.sh 재실행 (이어받기)"
else
    echo "  모든 다운로드 성공"
fi
echo "  bash check_models.sh 로 최종 확인"
echo "================================================================="
exit ${#FAILED_DOWNLOADS[@]}
