# 필수 모델 존재 여부 확인 (Windows PowerShell)
# 실행: .\check_models.ps1

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$MODELS = Join-Path $ROOT "ComfyUI\models"

$script:ok = 0
$script:missing = 0

function Check {
    param([string]$Label, [string]$Pattern)
    $matches = Get-ChildItem -Path $Pattern -ErrorAction SilentlyContinue
    if ($matches.Count -gt 0) {
        Write-Host "  [OK]  $Label"
        $script:ok++
    } else {
        Write-Host "  [MISS]  $Label  ->  $Pattern"
        $script:missing++
    }
}

Write-Host "================================================================="
Write-Host "  myaniform 모델 체크"
Write-Host "================================================================="
Write-Host ""

Write-Host "-- 이미지 생성 --------------------------------------------------"
Check "Dasiwa Illustrious SDXL checkpoint" "$MODELS\checkpoints\Dasiwa*.safetensors"
Check "SDXL CLIP"                          "$MODELS\clip\*.safetensors"
Check "SDXL VAE"                           "$MODELS\vae\*.safetensors"

Write-Host ""
Write-Host "-- S2V 립싱크 ---------------------------------------------------"
Check "Wan2.2 S2V diffusion model"         "$MODELS\diffusion_models\wan_s2v\*"
Check "Audio Encoder (S2V)"                "$MODELS\audio_encoders\*.safetensors"
Check "WanVideo T5 Text Encoder"           "$MODELS\text_encoders\*.safetensors"
Check "WanVideo VAE"                       "$MODELS\vae\[Ww]an*.safetensors"

Write-Host ""
Write-Host "-- I2V 루프/이펙트 ----------------------------------------------"
Check "I2V High noise model"               "$MODELS\diffusion_models\wan_i2v_high\*.safetensors"
Check "I2V Low noise model"                "$MODELS\diffusion_models\wan_i2v_low\*.safetensors"

Write-Host ""
Write-Host "-- LoRA ---------------------------------------------------------"
Check "SmoothMix Animation LoRA"           "$MODELS\loras\wan_smoothmix\*.safetensors"
Check "AniEffect LoRA (선택)"              "$MODELS\loras\wan_anieffect\*.safetensors"

Write-Host ""
Write-Host "-- TTS (gated / 특수) -------------------------------------------"
Check "Qwen3-TTS Base"           "$MODELS\tts\Qwen3TTS\Qwen3-TTS-12Hz-1.7B-Base\model.safetensors"
Check "Qwen3-TTS CustomVoice"    "$MODELS\tts\Qwen3TTS\Qwen3-TTS-12Hz-1.7B-CustomVoice\model.safetensors"
Check "Qwen3-TTS VoiceDesign"    "$MODELS\tts\Qwen3TTS\Qwen3-TTS-12Hz-1.7B-VoiceDesign\model.safetensors"
Check "Qwen3-TTS Tokenizer"      "$MODELS\tts\Qwen3TTS\Qwen3-TTS-Tokenizer-12Hz\model.safetensors"
Check "Fish Audio S2 Pro"        "$MODELS\fishaudioS2\s2-pro\model-00001-of-00002.safetensors"

Write-Host ""
Write-Host "-- MMAudio ------------------------------------------------------"
Check "MMAudio large 44k"        "$MODELS\mmaudio\mmaudio_large_44k*.safetensors"
Check "MMAudio VAE"              "$MODELS\mmaudio\mmaudio_vae*.safetensors"
Check "MMAudio Synchformer"      "$MODELS\mmaudio\mmaudio_synchformer*.safetensors"

Write-Host ""
Write-Host "-- Qwen Image Edit ----------------------------------------------"
Check "Qwen Image Edit GGUF"              "$MODELS\unet\qwen-image-edit-2511-Q*.gguf"
Check "Qwen Edit Lightning 4-step LoRA"   "$MODELS\loras\qwen\Qwen-Image-Edit*Lightning*.safetensors"
Check "Qwen 2.5 VL Text Encoder"          "$MODELS\text_encoders\qwen_2.5_vl_7b*.safetensors"
Check "Qwen Image VAE"                    "$MODELS\vae\qwen_image_vae.safetensors"

Write-Host ""
Write-Host "-- VNCCS LoRA / ControlNet --------------------------------------"
Check "poser_helper_v2 LoRA"              "$MODELS\loras\qwen\VNCCS\poser_helper_v2*.safetensors"
Check "ClothesHelperUltimate LoRA"        "$MODELS\loras\qwen\VNCCS\ClothesHelperUltimate*.safetensors"
Check "EmotionCore LoRA"                  "$MODELS\loras\qwen\VNCCS\EmotionCore*.safetensors"
Check "TransferClothes LoRA"              "$MODELS\loras\qwen\VNCCS\TransferClothes*.safetensors"
Check "Character Sheet SDXL LoRA"         "$MODELS\loras\vn_character_sheet*.safetensors"
Check "DMD2 SDXL 4-step LoRA"             "$MODELS\loras\DMD2\dmd2_sdxl*.safetensors"
Check "Illustrious OpenPose ControlNet"   "$MODELS\controlnet\SDXL\IllustriousXL_openpose.safetensors"
Check "SAM ViT-B"                         "$MODELS\sams\sam_vit_b*.pth"
Check "APISR 4x Upscaler"                 "$MODELS\upscale_models\4x_APISR*.pth"

Write-Host ""
Write-Host "-- FaceDetailer -------------------------------------------------"
Check "face_yolov8m"             "$MODELS\ultralytics\bbox\face_yolov8m.pt"
Check "hand_yolov8s"             "$MODELS\ultralytics\bbox\hand_yolov8s.pt"

Write-Host ""
Write-Host "-- IP-Adapter (레거시) ------------------------------------------"
Check "IP-Adapter FaceID SDXL"   "$MODELS\ipadapter\ip-adapter-faceid*.bin"
Check "CLIP Vision SDXL"         "$MODELS\clip_vision\*.safetensors"

Write-Host ""
Write-Host "================================================================="
Write-Host "  결과: OK $script:ok 개 / MISS $script:missing 개"
Write-Host "================================================================="

if ($script:missing -gt 0) {
    Write-Host ""
    Write-Host "  누락된 모델은 docs\models-and-nodes.md 를 참조하여 배치하세요."
    Write-Host "  배치 후 .\check_models.ps1 로 재확인."
    exit 1
} else {
    Write-Host ""
    Write-Host "  모든 필수 모델 준비 완료. 서버 실행:"
    Write-Host "    터미널 1: .\run.ps1                   (ComfyUI + FastAPI)"
    Write-Host "    터미널 2: cd frontend; npm run dev"
}
