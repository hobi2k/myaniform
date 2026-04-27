# myaniform 모델 자동 다운로드 (Windows PowerShell)
# - HuggingFace: 공개 모델 직접 다운로드
# - Civitai:     .civitai_token 또는 CIVITAI_TOKEN 환경변수 사용
#
# 사용:
#   .\download_models.ps1              # 전체
#   .\download_models.ps1 -Mode hf     # HF 모델만
#   .\download_models.ps1 -Mode civitai  # Civitai 만
#   .\download_models.ps1 -Mode list   # 목록만 출력

param(
    [ValidateSet('all', 'hf', 'civitai', 'list')]
    [string]$Mode = 'all'
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$MODELS = Join-Path $ROOT "ComfyUI\models"
$script:FAILED = New-Object System.Collections.ArrayList

# Civitai 토큰 로드
if (-not $env:CIVITAI_TOKEN -and (Test-Path "$ROOT\.civitai_token")) {
    $env:CIVITAI_TOKEN = (Get-Content "$ROOT\.civitai_token" -Raw).Trim()
}
# HuggingFace 토큰 로드
if (-not $env:HF_TOKEN -and (Test-Path "$ROOT\.hf_token")) {
    $env:HF_TOKEN = (Get-Content "$ROOT\.hf_token" -Raw).Trim()
}

# curl.exe 확인 (Windows 10+ 내장, resumable download 용)
$curlExe = (Get-Command curl.exe -ErrorAction SilentlyContinue).Path
if (-not $curlExe) {
    Write-Host "✗ curl.exe 가 PATH 에 없음. Windows 10 Build 17063+ 에는 기본 포함."
    Write-Host "  수동 설치: winget install cURL.cURL"
    exit 1
}

# ═══════════════════════════════════════════════════════════════════
# 다운로드 헬퍼
# ═══════════════════════════════════════════════════════════════════
function Hf-Download {
    param(
        [string]$Repo,
        [string]$PathInRepo,
        [string]$DestDir,
        [string]$DestName = $null
    )
    if (-not $DestName) { $DestName = Split-Path -Leaf $PathInRepo }
    $full = Join-Path $DestDir $DestName

    if ($Mode -eq 'list') {
        Write-Host ("  [HF]      {0,-55}  <- {1}/{2}" -f $DestName, $Repo, $PathInRepo)
        return
    }
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    if ((Test-Path $full) -and ((Get-Item $full).Length -gt 0)) {
        $sizeMB = [math]::Round((Get-Item $full).Length / 1MB, 1)
        Write-Host ("  [OK] {0,-55}  (이미 존재, {1} MB)" -f $DestName, $sizeMB)
        return
    }
    $url = "https://huggingface.co/$Repo/resolve/main/$PathInRepo"
    Write-Host ("  [DL] {0,-55}  ({1})" -f $DestName, $Repo)

    $curlArgs = @(
        "-L", "--fail", "--progress-bar",
        "--retry", "5", "--retry-delay", "3", "--retry-all-errors",
        "--connect-timeout", "30",
        "-C", "-",
        "-H", "User-Agent: myaniform/1.0",
        "-o", "$full.part", $url
    )
    if ($env:HF_TOKEN) { $curlArgs = @("-H", "Authorization: Bearer $env:HF_TOKEN") + $curlArgs }

    $attempt = 0
    while ($attempt -lt 3) {
        $attempt++
        & $curlExe @curlArgs
        if ($LASTEXITCODE -eq 0) {
            Move-Item -Path "$full.part" -Destination $full -Force
            return
        }
        Write-Host "    [warn] 시도 $attempt/3 실패, 재시도..."
        Start-Sleep -Seconds 5
    }
    Write-Host "    [fail] 다운로드 최종 실패: $url"
    $script:FAILED.Add("$Repo/$PathInRepo") | Out-Null
}

function Hf-DownloadRevision {
    param(
        [string]$Repo,
        [string]$Revision,
        [string]$PathInRepo,
        [string]$DestDir,
        [string]$DestName = $null
    )
    if (-not $DestName) { $DestName = Split-Path -Leaf $PathInRepo }
    $full = Join-Path $DestDir $DestName

    if ($Mode -eq 'list') {
        Write-Host ("  [HF@rev]  {0,-55}  <- {1}@{2}/{3}" -f $DestName, $Repo, $Revision, $PathInRepo)
        return
    }
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    if ((Test-Path $full) -and ((Get-Item $full).Length -gt 0)) {
        $sizeMB = [math]::Round((Get-Item $full).Length / 1MB, 1)
        Write-Host ("  [OK] {0,-55}  (이미 존재, {1} MB)" -f $DestName, $sizeMB)
        return
    }
    $url = "https://huggingface.co/$Repo/resolve/$Revision/$PathInRepo"
    Write-Host ("  [DL] {0,-55}  ({1}@{2})" -f $DestName, $Repo, $Revision)

    $curlArgs = @(
        "-L", "--fail", "--progress-bar",
        "--retry", "5", "--retry-delay", "3", "--retry-all-errors",
        "--connect-timeout", "30",
        "-C", "-",
        "-H", "User-Agent: myaniform/1.0",
        "-o", "$full.part", $url
    )
    if ($env:HF_TOKEN) { $curlArgs = @("-H", "Authorization: Bearer $env:HF_TOKEN") + $curlArgs }

    $attempt = 0
    while ($attempt -lt 3) {
        $attempt++
        & $curlExe @curlArgs
        if ($LASTEXITCODE -eq 0) {
            Move-Item -Path "$full.part" -Destination $full -Force
            return
        }
        Write-Host "    [warn] 시도 $attempt/3 실패, 재시도..."
        Start-Sleep -Seconds 5
    }
    Write-Host "    [fail] 다운로드 최종 실패: $url"
    $script:FAILED.Add("$Repo@$Revision/$PathInRepo") | Out-Null
}

function Civitai-Download {
    param(
        [string]$VersionId,
        [string]$DestDir,
        [string]$DestName
    )
    $full = Join-Path $DestDir $DestName

    if ($Mode -eq 'list') {
        Write-Host ("  [Civitai] {0,-55}  <- versionId={1}" -f $DestName, $VersionId)
        return
    }
    if (-not $env:CIVITAI_TOKEN) {
        Write-Host ("  [skip] {0,-55}  (CIVITAI_TOKEN 없음)" -f $DestName)
        $script:FAILED.Add("civitai:$VersionId (CIVITAI_TOKEN 없음)") | Out-Null
        return
    }
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    if ((Test-Path $full) -and ((Get-Item $full).Length -gt 0)) {
        $sizeMB = [math]::Round((Get-Item $full).Length / 1MB, 1)
        Write-Host ("  [OK] {0,-55}  (이미 존재, {1} MB)" -f $DestName, $sizeMB)
        return
    }
    Write-Host ("  [DL] {0,-55}  (Civitai vid={1})" -f $DestName, $VersionId)

    $curlArgs = @(
        "-L", "--fail", "--progress-bar",
        "--retry", "5", "--retry-delay", "3", "--retry-all-errors",
        "--connect-timeout", "30",
        "-C", "-",
        "-H", "Authorization: Bearer $env:CIVITAI_TOKEN",
        "-o", "$full.part",
        "https://civitai.com/api/download/models/$VersionId"
    )
    $attempt = 0
    while ($attempt -lt 3) {
        $attempt++
        & $curlExe @curlArgs
        if ($LASTEXITCODE -eq 0) {
            Move-Item -Path "$full.part" -Destination $full -Force
            return
        }
        Write-Host "    [warn] 시도 $attempt/3 실패, 재시도..."
        Start-Sleep -Seconds 5
    }
    Write-Host "    [fail] 다운로드 최종 실패 (vid=$VersionId)"
    $script:FAILED.Add("civitai:$VersionId") | Out-Null
}

# ═══════════════════════════════════════════════════════════════════
# 모델 목록
# ═══════════════════════════════════════════════════════════════════
function Download-HF {
    Write-Host ""
    Write-Host "--- WanVideo 공통 (T5 + VAE) ---"
    Hf-Download "Kijai/WanVideo_comfy" "umt5-xxl-enc-bf16.safetensors"    "$MODELS\text_encoders"
    Hf-Download "Kijai/WanVideo_comfy" "Wan2_1_VAE_bf16.safetensors"      "$MODELS\vae"
    Hf-Download "Comfy-Org/Wan_2.2_ComfyUI_Repackaged" "split_files/vae/wan_2.1_vae.safetensors" `
                "$MODELS\vae" "wan_2.1_vae.safetensors"

    Write-Host ""
    Write-Host "--- Wan 2.2 I2V 14B High/Low (bf16) ---"
    Hf-Download "Kijai/WanVideo_comfy" "Wan2_2-I2V-A14B-HIGH_bf16.safetensors"  "$MODELS\diffusion_models\wan_i2v_high"
    Hf-Download "Kijai/WanVideo_comfy" "Wan2_2-I2V-A14B-LOW_bf16.safetensors"   "$MODELS\diffusion_models\wan_i2v_low"

    Write-Host ""
    Write-Host "--- Wan 2.2 S2V 14B (GGUF Q4) ---"
    Hf-Download "QuantStack/Wan2.2-S2V-14B-GGUF" "Wan2.2-S2V-14B-Q4_K_M.gguf"   "$MODELS\diffusion_models\wan_s2v"

    Write-Host ""
    Write-Host "--- S2V Audio Encoder ---"
    Hf-Download "Wan-AI/Wan2.2-S2V-14B" "wav2vec2-large-xlsr-53-english/model.safetensors" `
                "$MODELS\audio_encoders" "wav2vec2_large_english_fp32.safetensors"
    Hf-Download "Comfy-Org/Wan_2.2_ComfyUI_Repackaged" "split_files/audio_encoders/wav2vec2_large_english_fp16.safetensors" `
                "$MODELS\audio_encoders" "wav2vec2_large_english_fp16.safetensors"

    Write-Host ""
    Write-Host "--- MMAudio (SFX) ---"
    Hf-Download "Kijai/MMAudio_safetensors" "mmaudio_large_44k_v2_fp16.safetensors"         "$MODELS\mmaudio"
    Hf-Download "phazei/NSFW_MMaudio" "mmaudio_large_44k_nsfw_gold_8.5k_final_fp16.safetensors" "$MODELS\mmaudio"
    Hf-Download "Kijai/MMAudio_safetensors" "mmaudio_vae_44k_fp16.safetensors"              "$MODELS\mmaudio"
    Hf-Download "Kijai/MMAudio_safetensors" "mmaudio_synchformer_fp16.safetensors"          "$MODELS\mmaudio"
    Hf-Download "Kijai/MMAudio_safetensors" "apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors" "$MODELS\mmaudio"

    Write-Host ""
    Write-Host "--- Qwen Image Edit 2511 ---"
    Hf-Download "unsloth/Qwen-Image-Edit-2511-GGUF" "qwen-image-edit-2511-Q5_0.gguf" "$MODELS\unet"

    Write-Host ""
    Write-Host "--- Qwen Image Edit Lightning LoRA ---"
    Hf-Download "lightx2v/Qwen-Image-Edit-2511-Lightning" `
                "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" `
                "$MODELS\loras\qwen"

    Write-Host ""
    Write-Host "--- Qwen Image Text Encoder + VAE ---"
    Hf-Download "Comfy-Org/Qwen-Image_ComfyUI" "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors" `
                "$MODELS\text_encoders" "qwen_2.5_vl_7b_fp8_scaled.safetensors"
    Hf-Download "Comfy-Org/Qwen-Image_ComfyUI" "split_files/vae/qwen_image_vae.safetensors" `
                "$MODELS\vae" "qwen_image_vae.safetensors"

    Write-Host ""
    Write-Host "--- VNCCS 캐릭터 일관성 LoRA ---"
    $vnccsFiles = @(
        "models/loras/qwen/VNCCS/poser_helper_v2_000004200.safetensors",
        "models/loras/qwen/VNCCS/ClothesHelperUltimateV1_000005100.safetensors",
        "models/loras/qwen/VNCCS/EmotionCoreV2_000004700.safetensors",
        "models/loras/qwen/VNCCS/TransferClothes_000006700.safetensors"
    )
    foreach ($f in $vnccsFiles) {
        Hf-Download "MIUProject/VNCCS" $f "$MODELS\loras\qwen\VNCCS" (Split-Path -Leaf $f)
    }
    Hf-Download "MIUProject/VNCCS" "models/loras/vn_character_sheet_v4.safetensors" `
                "$MODELS\loras" "vn_character_sheet_v4.safetensors"
    Hf-Download "MIUProject/VNCCS" "models/loras/DMD2/dmd2_sdxl_4step_lora_fp16.safetensors" `
                "$MODELS\loras\DMD2" "dmd2_sdxl_4step_lora_fp16.safetensors"
    Hf-Download "MIUProject/VNCCS" "models/loras/IL/mimimeter.safetensors" `
                "$MODELS\loras\IL" "mimimeter.safetensors"
    Hf-Download "MIUProject/VNCCS" "models/controlnet/SDXL/IllustriousXL_openpose.safetensors" `
                "$MODELS\controlnet\SDXL" "IllustriousXL_openpose.safetensors"
    Hf-Download "MIUProject/VNCCS" "models/controlnet/SDXL/AnytestV4.safetensors" `
                "$MODELS\controlnet\SDXL" "AnytestV4.safetensors"
    Hf-Download "MIUProject/VNCCS" "models/sams/sam_vit_b_01ec64.pth" `
                "$MODELS\sams" "sam_vit_b_01ec64.pth"
    Hf-Download "MIUProject/VNCCS" "models/upscale_models/2x_APISR_RRDB_GAN_generator.pth" `
                "$MODELS\upscale_models" "2x_APISR_RRDB_GAN_generator.pth"
    Hf-Download "MIUProject/VNCCS" "models/upscale_models/4x_APISR_GRL_GAN_generator.pth" `
                "$MODELS\upscale_models" "4x_APISR_GRL_GAN_generator.pth"

    Write-Host ""
    Write-Host "--- SeedVR2 업스케일 모델 ---"
    Hf-Download "numz/SeedVR2_comfyUI" "seedvr2_ema_3b_fp16.safetensors" `
                "$MODELS\SEEDVR2" "seedvr2_ema_3b_fp16.safetensors"
    Hf-Download "numz/SeedVR2_comfyUI" "ema_vae_fp16.safetensors" `
                "$MODELS\SEEDVR2" "ema_vae_fp16.safetensors"

    Write-Host ""
    Write-Host "--- FaceDetailer bbox ---"
    Hf-Download "Bingsu/adetailer" "face_yolov8m.pt" "$MODELS\ultralytics\bbox" "face_yolov8m.pt"
    Hf-Download "Bingsu/adetailer" "hand_yolov8s.pt" "$MODELS\ultralytics\bbox" "hand_yolov8s.pt"

    Write-Host ""
    Write-Host "--- 이미지 워크플로우 segmentation ---"
    Hf-Download "Bingsu/adetailer" "person_yolov8m-seg.pt" `
                "$MODELS\ultralytics\segm" "person_yolov8m-seg.pt"

    Write-Host ""
    Write-Host "--- (Legacy) IP-Adapter FaceID ---"
    Hf-Download "h94/IP-Adapter-FaceID" "ip-adapter-faceid-plusv2_sdxl.bin"             "$MODELS\ipadapter"
    Hf-Download "h94/IP-Adapter-FaceID" "ip-adapter-faceid-plusv2_sdxl_lora.safetensors" "$MODELS\loras"

    Write-Host ""
    Write-Host "--- CLIP Vision SDXL ---"
    Hf-Download "h94/IP-Adapter" "models/image_encoder/model.safetensors" `
                "$MODELS\clip_vision" "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"

    Write-Host ""
    Write-Host "--- SDXL VAE ---"
    Hf-Download "madebyollin/sdxl-vae-fp16-fix" "sdxl_vae.safetensors" "$MODELS\vae"

    Write-Host ""
    Write-Host "--- ILFlatMix 원본 체크포인트 (VN Step1) ---"
    Hf-DownloadRevision "MIUProject/ILFlatMix" `
        "143a907f20c1380658c5d6e9c768a2f3dc4c4874" `
        "ILFlatMixV4_00001_.safetensors" `
        "$MODELS\checkpoints\Illustrious" `
        "ILFlatMix.safetensors"

    Write-Host ""
    Write-Host "--- Animagine XL 3.1 체크포인트 (원본 이미지 워크플로우) ---"
    Hf-Download "LyliaEngine/animagineXLV31_v31" "animagineXLV31_v31.safetensors" `
                "$MODELS\checkpoints" "animagineXLV31_v31.safetensors"

    Write-Host ""
    Write-Host "--- SDXL Text Encoder ---"
    Hf-Download "comfyanonymous/flux_text_encoders" "clip_l.safetensors" "$MODELS\clip"

    if (-not $env:HF_TOKEN) {
        Write-Host ""
        Write-Host "--- Qwen3-TTS (HF_TOKEN 없음, 스킵) ---"
        return
    }

    $q3Base = "$MODELS\Qwen3-TTS"
    $mainFiles = @(
        "config.json", "generation_config.json", "merges.txt", "vocab.json",
        "preprocessor_config.json", "tokenizer_config.json", "model.safetensors"
    )
    $stFiles = @(
        "speech_tokenizer/config.json",
        "speech_tokenizer/configuration.json",
        "speech_tokenizer/preprocessor_config.json",
        "speech_tokenizer/model.safetensors"
    )

    foreach ($variant in @('Base', 'CustomVoice', 'VoiceDesign')) {
        Write-Host ""
        Write-Host "--- Qwen3-TTS $variant ---"
        $repo = "Qwen/Qwen3-TTS-12Hz-1.7B-$variant"
        $dst  = "$q3Base\Qwen3-TTS-12Hz-1.7B-$variant"
        foreach ($f in $mainFiles) { Hf-Download $repo $f $dst }
        foreach ($f in $stFiles)   { Hf-Download $repo $f "$dst\speech_tokenizer" (Split-Path -Leaf $f) }
    }

    Write-Host ""
    Write-Host "--- Qwen3-TTS Tokenizer (12Hz audio codec) ---"
    $repo = "Qwen/Qwen3-TTS-Tokenizer-12Hz"
    $dst  = "$q3Base\Qwen3-TTS-Tokenizer-12Hz"
    foreach ($f in @('config.json', 'configuration.json', 'preprocessor_config.json', 'model.safetensors')) {
        Hf-Download $repo $f $dst
    }

    Write-Host ""
    Write-Host "--- Fish Audio S2 Pro (~24GB) ---"
    $repo = "fishaudio/s2-pro"
    $dst  = "$MODELS\fishaudioS2\s2-pro"
    $fishFiles = @(
        "config.json", "chat_template.jinja", "codec.pth",
        "model-00001-of-00002.safetensors", "model-00002-of-00002.safetensors",
        "model.safetensors.index.json", "special_tokens_map.json",
        "tokenizer.json", "tokenizer_config.json"
    )
    foreach ($f in $fishFiles) { Hf-Download $repo $f $dst }
}

function Download-Civitai {
    Write-Host ""
    Write-Host "--- Civitai SDXL Anime ---"
    Civitai-Download "2682302" "$MODELS\checkpoints" "DasiwaIllustriousRealistic_v1.safetensors"
    Civitai-Download "2514310" "$MODELS\checkpoints" "waiIllustriousSDXL_v160.safetensors"

    Write-Host ""
    Write-Host "--- Civitai SmoothMix Ultimate I2V High 대체 ---"
    Civitai-Download "2746772" "$MODELS\diffusion_models\wan_i2v_high" "smoothmixUltimate_illustriousV20.safetensors"

    Write-Host ""
    Write-Host "--- Civitai DaSiWa Wan 2.2 S2V FastFidelity ---"
    Civitai-Download "2433140" "$MODELS\diffusion_models\wan_s2v" "DasiwaWan2214BS2V_littledemonV2.safetensors"

    Write-Host ""
    Write-Host "--- Civitai SmoothMix LoRA ---"
    Civitai-Download "2695694" "$MODELS\loras\wan_smoothmix" "SmoothMix_illustrious.safetensors"
}

# ═══════════════════════════════════════════════════════════════════
# 실행
# ═══════════════════════════════════════════════════════════════════
Write-Host "================================================================="
Write-Host "  myaniform 모델 다운로드"
Write-Host "  저장 경로: $MODELS"
if ($env:CIVITAI_TOKEN) {
    Write-Host "  Civitai:   토큰 로드됨"
} else {
    Write-Host "  Civitai:   토큰 없음 (HF 만)"
}
Write-Host "================================================================="

switch ($Mode) {
    'hf'      { Download-HF }
    'civitai' { Download-Civitai }
    'list'    { Download-HF; Download-Civitai }
    default   { Download-HF; Download-Civitai }
}

Write-Host ""
Write-Host "================================================================="
if ($script:FAILED.Count -gt 0) {
    Write-Host "  [warn] 실패한 다운로드 $($script:FAILED.Count) 개:"
    foreach ($f in $script:FAILED) { Write-Host "     - $f" }
    Write-Host "  -> 네트워크 안정화 후 .\download_models.ps1 재실행 (이어받기)"
} else {
    Write-Host "  모든 다운로드 성공"
}
Write-Host "  .\check_models.ps1 로 최종 확인"
Write-Host "================================================================="

exit $script:FAILED.Count
