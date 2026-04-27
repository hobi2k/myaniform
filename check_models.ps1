# 필수 모델 존재 여부 확인 (Windows PowerShell)
# 실행: .\check_models.ps1

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$MODELS = Join-Path $ROOT "ComfyUI\models"
$CUSTOM_NODES = Join-Path $ROOT "ComfyUI\custom_nodes"

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

function Check-Optional {
    param([string]$Label, [string]$Pattern)
    $matches = Get-ChildItem -Path $Pattern -ErrorAction SilentlyContinue
    if ($matches.Count -gt 0) {
        Write-Host "  [OK]  $Label"
        $script:ok++
    } else {
        Write-Host "  [OPTIONAL]  $Label  (없음)  ->  $Pattern"
    }
}

Write-Host "================================================================="
Write-Host "  myaniform 모델 체크"
Write-Host "================================================================="
Write-Host ""

Write-Host "-- 이미지 생성 --------------------------------------------------"
Check "Dasiwa Illustrious SDXL checkpoint" "$MODELS\checkpoints\Dasiwa*.safetensors"
Check "Animagine XL 3.1 checkpoint"       "$MODELS\checkpoints\animagineXLV31_v31.safetensors"
Check "SDXL CLIP"                          "$MODELS\clip\*.safetensors"
Check "SDXL VAE"                           "$MODELS\vae\*.safetensors"

Write-Host ""
Write-Host "-- S2V 립싱크 ---------------------------------------------------"
Check "Wan2.2 S2V diffusion model"         "$MODELS\diffusion_models\wan_s2v\*"
Check "DaSiWa S2V FastFidelity"            "$MODELS\diffusion_models\wan_s2v\DasiwaWan2214BS2V_littledemonV2.safetensors"
Check "Audio Encoder (S2V)"                "$MODELS\audio_encoders\*.safetensors"
Check "Audio Encoder fp16 (S2V FastFidelity)" "$MODELS\audio_encoders\wav2vec2_large_english_fp16.safetensors"
Check "WanVideo T5 Text Encoder"           "$MODELS\text_encoders\*.safetensors"
Check "WanVideo VAE"                       "$MODELS\vae\[Ww]an*.safetensors"
Check "Wan 2.1 VAE canonical"              "$MODELS\vae\wan_2.1_vae.safetensors"

Write-Host ""
Write-Host "-- I2V 루프/이펙트 ----------------------------------------------"
Check "I2V High noise model"               "$MODELS\diffusion_models\wan_i2v_high\*.safetensors"
Check "I2V Low noise model"                "$MODELS\diffusion_models\wan_i2v_low\*.safetensors"

Write-Host ""
Write-Host "-- LoRA ---------------------------------------------------------"
Check "SmoothMix Animation LoRA"           "$MODELS\loras\wan_smoothmix\*.safetensors"
Check-Optional "AniEffect LoRA"            "$MODELS\loras\wan_anieffect\*.safetensors"

Write-Host ""
Write-Host "-- TTS (gated / 특수) -------------------------------------------"
Check "Qwen3-TTS Base"           "$MODELS\Qwen3-TTS\Qwen3-TTS-12Hz-1.7B-Base\model.safetensors"
Check "Qwen3-TTS CustomVoice"    "$MODELS\Qwen3-TTS\Qwen3-TTS-12Hz-1.7B-CustomVoice\model.safetensors"
Check "Qwen3-TTS VoiceDesign"    "$MODELS\Qwen3-TTS\Qwen3-TTS-12Hz-1.7B-VoiceDesign\model.safetensors"
Check "Qwen3-TTS Tokenizer"      "$MODELS\Qwen3-TTS\Qwen3-TTS-Tokenizer-12Hz\model.safetensors"
Check "Fish Audio S2 Pro"        "$MODELS\fishaudioS2\s2-pro\model-00001-of-00002.safetensors"

Write-Host ""
Write-Host "-- MMAudio ------------------------------------------------------"
Check "MMAudio large 44k"        "$MODELS\mmaudio\mmaudio_large_44k*.safetensors"
Check "MMAudio NSFW gold"       "$MODELS\mmaudio\mmaudio_large_44k_nsfw_gold_8.5k_final_fp16.safetensors"
Check "MMAudio VAE"              "$MODELS\mmaudio\mmaudio_vae*.safetensors"
Check "MMAudio Synchformer"      "$MODELS\mmaudio\mmaudio_synchformer*.safetensors"
Check "MMAudio CLIP"             "$MODELS\mmaudio\apple_DFN5B-CLIP-ViT-H-14-384*.safetensors"

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
Check "SeedVR2 DiT Upscaler"              "$MODELS\SEEDVR2\seedvr2_ema_3b_fp16.safetensors"
Check "SeedVR2 VAE"                       "$MODELS\SEEDVR2\ema_vae_fp16.safetensors"

Write-Host ""
Write-Host "-- FaceDetailer -------------------------------------------------"
Check "face_yolov8m"             "$MODELS\ultralytics\bbox\face_yolov8m.pt"
Check "hand_yolov8s"             "$MODELS\ultralytics\bbox\hand_yolov8s.pt"
Check "person_yolov8m-seg"       "$MODELS\ultralytics\segm\person_yolov8m-seg.pt"

Write-Host ""
Write-Host "-- IP-Adapter (레거시) ------------------------------------------"
Check "IP-Adapter FaceID SDXL"   "$MODELS\ipadapter\ip-adapter-faceid*.bin"
Check "CLIP Vision SDXL"         "$MODELS\clip_vision\*.safetensors"

Write-Host ""
Write-Host "-- ComfyUI custom nodes -----------------------------------------"
Check "WanVideoWrapper"                  "$CUSTOM_NODES\ComfyUI-WanVideoWrapper"
Check "MMAudio node"                     "$CUSTOM_NODES\ComfyUI-MMAudio"
Check "Qwen3-TTS node (hobi2k)"          "$CUSTOM_NODES\ComfyUI_Qwen3-TTS"
Check "ImageSelector node"               "$CUSTOM_NODES\ComfyUI-Image-Selector"
Check "Geeky AudioMixer"                 "$CUSTOM_NODES\ComfyUI_Geeky_AudioMixer"
Check "Derfuu DynamicPrompts node"       "$CUSTOM_NODES\Derfuu_ComfyUI_ModdedNodes"
Check "UniversalToolkit / AudioCropProcessUTK" "$CUSTOM_NODES\universaltoolkit"
Check "audio-separation-nodes-comfyui"   "$CUSTOM_NODES\audio-separation-nodes-comfyui"

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
