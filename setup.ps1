# myaniform 의존성 설치 스크립트 (Windows PowerShell)
# - uv 기반 venv 관리
# - ComfyUI 커스텀 노드와 필수 모델은 새 클론에서도 자동으로 clone/pull/download 함
# - 실행: pwsh -File setup.ps1  (또는 PowerShell 에서 .\setup.ps1)
#
# 상세 가이드: docs/install.md
#
# 실행 정책 오류 시 한 번만:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

Write-Host "================================================================="
Write-Host "  myaniform 의존성 설치 (Windows)"
Write-Host "================================================================="
Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# PHASE 0: uv 확인
# ═══════════════════════════════════════════════════════════════════
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "✗ uv 가 설치되어 있지 않음."
    Write-Host "  설치: powershell -c `"irm https://astral.sh/uv/install.ps1 | iex`""
    Write-Host "  설치 후 새 셸에서 재실행."
    exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "✗ git 이 설치되어 있지 않음."
    Write-Host "  설치: winget install --id Git.Git"
    exit 1
}
Write-Host "=== [0/8] uv: $(uv --version) ==="

# ═══════════════════════════════════════════════════════════════════
# PHASE 1: 모델 디렉토리 확보
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [1/8] 모델 디렉토리 확인 ==="
$dirs = @(
    "ComfyUI\models\checkpoints",
    "ComfyUI\models\clip",
    "ComfyUI\models\vae",
    "ComfyUI\models\ipadapter",
    "ComfyUI\models\clip_vision",
    "ComfyUI\models\audio_encoders",
    "ComfyUI\models\vfi_models",
    "ComfyUI\models\mmaudio",
    "ComfyUI\models\tts",
    "ComfyUI\models\text_encoders",
    "ComfyUI\models\unet",
    "ComfyUI\models\sams",
    "ComfyUI\models\upscale_models",
    "ComfyUI\models\SEEDVR2",
    "ComfyUI\models\fishaudioS2\s2-pro",
    "ComfyUI\models\diffusion_models\wan_s2v",
    "ComfyUI\models\diffusion_models\wan_i2v_high",
    "ComfyUI\models\diffusion_models\wan_i2v_low",
    "ComfyUI\models\loras\wan_smoothmix",
    "ComfyUI\models\loras\wan_anieffect",
    "ComfyUI\models\loras\wan_wallpaper",
    "ComfyUI\models\loras\qwen\VNCCS",
    "ComfyUI\models\loras\DMD2",
    "ComfyUI\models\controlnet\SDXL",
    "ComfyUI\models\ultralytics\bbox",
    "ComfyUI\models\ultralytics\segm",
    "ComfyUI\models\Qwen3-TTS"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
$oldQwen = "ComfyUI\models\tts\Qwen3TTS"
$newQwen = "ComfyUI\models\Qwen3-TTS"
$newBaseModel = Join-Path $newQwen "Qwen3-TTS-12Hz-1.7B-Base\model.safetensors"
if ((Test-Path $oldQwen) -and -not (Test-Path $newBaseModel)) {
    try {
        $items = Get-ChildItem $newQwen -Force -ErrorAction SilentlyContinue
        if ($items.Count -eq 0) {
            Remove-Item $newQwen -Force -ErrorAction SilentlyContinue
            cmd /c mklink /J $newQwen $oldQwen | Out-Null
            Write-Host "  [migrate] 기존 tts\Qwen3TTS 모델을 Qwen3-TTS 경로로 연결"
        }
    } catch {
        Write-Host "  [migrate] Qwen3-TTS 기존 경로 연결 실패. download_models.ps1 이 새 경로로 다시 확인합니다."
    }
}
Write-Host "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 2: ComfyUI 커스텀 노드 확보
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [2/8] ComfyUI 커스텀 노드 확인 ==="
New-Item -ItemType Directory -Force -Path "ComfyUI\custom_nodes" | Out-Null

function Ensure-CustomNode {
    param([string]$Name, [string]$Url)
    $dest = Join-Path "ComfyUI\custom_nodes" $Name
    if (Test-Path (Join-Path $dest ".git")) {
        Write-Host "  [pull] $Name"
        try {
            git -C $dest pull --ff-only --quiet
        } catch {
            Write-Host "        업데이트 실패. 기존 체크아웃 유지: $dest"
        }
    } elseif (Test-Path $dest) {
        Write-Host "  [keep] $Name (로컬 디렉토리 존재)"
    } else {
        Write-Host "  [clone] $Name"
        git clone --depth 1 --quiet $Url $dest
    }
}

Ensure-CustomNode "ComfyUI-Crystools" "https://github.com/crystian/ComfyUI-Crystools.git"
Ensure-CustomNode "ComfyUI-Custom-Scripts" "https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git"
Ensure-CustomNode "ComfyUI-Easy-Use" "https://github.com/yolain/ComfyUI-Easy-Use.git"
Ensure-CustomNode "ComfyUI_Qwen3-TTS" "https://github.com/hobi2k/ComfyUI_Qwen3-TTS.git"
Ensure-CustomNode "ComfyUI-FishAudioS2" "https://github.com/Saganaki22/ComfyUI-FishAudioS2.git"
Ensure-CustomNode "ComfyUI-Frame-Interpolation" "https://github.com/Fannovel16/ComfyUI-Frame-Interpolation.git"
Ensure-CustomNode "ComfyUI-GGUF" "https://github.com/city96/ComfyUI-GGUF.git"
Ensure-CustomNode "ComfyUI_essentials" "https://github.com/cubiq/ComfyUI_essentials.git"
Ensure-CustomNode "ComfyUI-Image-Selector" "https://github.com/SLAPaper/ComfyUI-Image-Selector.git"
Ensure-CustomNode "ComfyUI_Geeky_AudioMixer" "https://github.com/GeekyGhost/ComfyUI_Geeky_AudioMixer.git"
Ensure-CustomNode "ComfyUI-KJNodes" "https://github.com/kijai/ComfyUI-KJNodes.git"
Ensure-CustomNode "ComfyUI-MMAudio" "https://github.com/kijai/ComfyUI-MMAudio.git"
Ensure-CustomNode "ComfyUI-SeedVR2_VideoUpscaler" "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git"
Ensure-CustomNode "ComfyUI-VideoHelperSuite" "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git"
Ensure-CustomNode "ComfyUI-WanVideoWrapper" "https://github.com/kijai/ComfyUI-WanVideoWrapper.git"
Ensure-CustomNode "ComfyUI_IPAdapter_plus" "https://github.com/cubiq/ComfyUI_IPAdapter_plus.git"
Ensure-CustomNode "ComfyUI_UltimateSDUpscale" "https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git"
Ensure-CustomNode "Derfuu_ComfyUI_ModdedNodes" "https://github.com/Derfuu/Derfuu_ComfyUI_ModdedNodes.git"
Ensure-CustomNode "audio-separation-nodes-comfyui" "https://github.com/christian-byrne/audio-separation-nodes-comfyui.git"
Ensure-CustomNode "comfyui-impact-pack" "https://github.com/ltdrdata/ComfyUI-Impact-Pack.git"
Ensure-CustomNode "comfyui-impact-subpack" "https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git"
Ensure-CustomNode "efficiency-nodes-ED" "https://github.com/NyaamZ/efficiency-nodes-ED.git"
Ensure-CustomNode "efficiency-nodes-comfyui" "https://github.com/jags111/efficiency-nodes-comfyui.git"
Ensure-CustomNode "rgthree-comfy" "https://github.com/rgthree/rgthree-comfy.git"
Ensure-CustomNode "universaltoolkit" "https://github.com/whmc76/ComfyUI-UniversalToolkit.git"
Ensure-CustomNode "vnccs" "https://github.com/AHEKOT/ComfyUI_VNCCS.git"
Ensure-CustomNode "vnccs-utils" "https://github.com/AHEKOT/ComfyUI_VNCCS_Utils.git"

Copy-Item -Path "comfy_custom_nodes\myaniform_workflow_viewer" -Destination "ComfyUI\custom_nodes\" -Recurse -Force
Copy-Item -Path "comfy_custom_nodes\websocket_image_save.py" -Destination "ComfyUI\custom_nodes\" -Force
Copy-Item -Path "comfy_custom_nodes\myaniform_compat_nodes.py" -Destination "ComfyUI\custom_nodes\" -Force
Write-Host "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 3: Python venv (uv)
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [3/8] Python 3.11 venv ==="
if (-not (Test-Path ".venv")) {
    uv venv --python 3.11 .venv
    Write-Host "  생성: .venv"
} else {
    Write-Host "  [skip] .venv 이미 존재"
}
# venv 활성화 (현재 스크립트 프로세스)
& ".\.venv\Scripts\Activate.ps1"

# ═══════════════════════════════════════════════════════════════════
# PHASE 4: ComfyUI + 커스텀 노드 파이썬 의존성
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [4/8] ComfyUI 파이썬 의존성 ==="
uv pip install --quiet -r ComfyUI\requirements.txt
Write-Host "  완료"

Write-Host ""
Write-Host "=== [4b/8] 커스텀 노드 의존성 ==="
Get-ChildItem ComfyUI\custom_nodes -Directory | ForEach-Object {
    $reqFile = Join-Path $_.FullName "requirements.txt"
    if (Test-Path $reqFile) {
        Write-Host "  [*] $($_.Name)"
        try {
            uv pip install --quiet -r $reqFile 2>&1 | Select-Object -Last 3 | ForEach-Object { "      $_" }
        } catch {
            Write-Host "      (일부 패키지 스킵 — Windows 빌드 불가일 수 있음)"
        }
    }
}
if (Test-Path "ComfyUI\custom_nodes\efficiency-nodes-ED\install.py") {
    Write-Host "  [*] efficiency-nodes-ED patch installer"
    Push-Location "ComfyUI\custom_nodes\efficiency-nodes-ED"
    try {
        python install.py
    } catch {
        Write-Host "      efficiency-nodes-ED installer 실패. 기존 파일 유지."
    }
    Pop-Location
}
Write-Host "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 5: sageattention (필수 — O(n) attention, OOM 방지)
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [5/8] sageattention (O(n) attention) ==="
$sageOk = $false
try {
    python -c "from sageattention import sageattn" 2>$null
    if ($LASTEXITCODE -eq 0) { $sageOk = $true }
} catch { }

if ($sageOk) {
    Write-Host "  [skip] 이미 설치됨"
} else {
    Write-Host "  설치 중 (Windows 에서는 triton-windows 도 필요할 수 있음)"
    # triton-windows 가 선행 조건 — Windows 에 triton 공식 배포가 없을 수 있음
    uv pip install --quiet triton-windows 2>$null
    uv pip install --quiet sageattention
    try {
        python -c "from sageattention import sageattn" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  완료"
        } else {
            Write-Host "  ⚠ 설치했지만 import 실패 — PyTorch CUDA 버전과 매칭 확인 필요"
            Write-Host "     docs/install.md 의 'Windows sageattention 트러블슈팅' 참고"
        }
    } catch {
        Write-Host "  ⚠ import 검증 실패"
    }
}

# ═══════════════════════════════════════════════════════════════════
# PHASE 6: 백엔드 파이썬 의존성
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [6/8] 백엔드 의존성 ==="
uv pip install --quiet -r backend\requirements.txt
Write-Host "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 7: 프론트엔드 Node.js 의존성
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [7/8] 프론트엔드 의존성 ==="
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "  ✗ npm 이 없음. Node.js 20+ 설치 후 재실행."
    Write-Host "    winget install OpenJS.NodeJS.LTS"
    exit 1
}
Push-Location "$ROOT\frontend"
npm install --silent
Pop-Location
Write-Host "  완료"

# ═══════════════════════════════════════════════════════════════════
# 워크플로우 JSON 을 ComfyUI user 폴더로 복사 (GUI 편집 가능하게)
# ═══════════════════════════════════════════════════════════════════
New-Item -ItemType Directory -Force -Path "ComfyUI\user\default\workflows" | Out-Null
Copy-Item -Path "workflows\*.json" -Destination "ComfyUI\user\default\workflows\" -Force -ErrorAction SilentlyContinue

# ═══════════════════════════════════════════════════════════════════
# PHASE 8: 모델 자동 다운로드 + 검증
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [8/8] 모델 자동 다운로드 및 검증 ==="
if ($env:MYANIFORM_SKIP_MODEL_DOWNLOAD -eq "1") {
    Write-Host "  [skip] MYANIFORM_SKIP_MODEL_DOWNLOAD=1"
} else {
    Write-Host "  download_models.ps1 실행 (이어받기 지원)"
    & "$ROOT\download_models.ps1"
    if ($LASTEXITCODE -ne 0) {
        throw "모델 다운로드 실패. 토큰/네트워크 확인 후 .\download_models.ps1 재실행."
    }
    Write-Host ""
    Write-Host "  check_models.ps1 실행"
    & "$ROOT\check_models.ps1"
    if ($LASTEXITCODE -ne 0) {
        throw "필수 모델 검증 실패. 누락 항목을 채운 뒤 .\check_models.ps1 재실행."
    }
}

# ═══════════════════════════════════════════════════════════════════
# 완료
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "================================================================="
Write-Host "  의존성 설치 완료"
Write-Host ""
Write-Host "  ★ 다음 단계"
Write-Host ""
Write-Host "  1. 서비스 실행"
Write-Host "       터미널 1: .\run.ps1                  (ComfyUI + FastAPI)"
Write-Host "       터미널 2: cd frontend; npm run dev"
Write-Host ""
Write-Host "  2. http://localhost:5173"
Write-Host ""
Write-Host "  참고: 모델 다운로드를 건너뛰려면 `$env:MYANIFORM_SKIP_MODEL_DOWNLOAD='1'; .\setup.ps1"
Write-Host ""
Write-Host "  상세 문서: docs\install.md"
Write-Host "================================================================="
