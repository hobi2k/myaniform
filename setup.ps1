# myaniform 의존성 설치 스크립트 (Windows PowerShell)
# - uv 기반 venv 관리
# - ComfyUI + 커스텀 노드는 리포에 벤더링됨 (추가 clone 불필요)
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
Write-Host "=== [0/6] uv: $(uv --version) ==="

# ═══════════════════════════════════════════════════════════════════
# PHASE 1: 모델 디렉토리 확보
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [1/6] 모델 디렉토리 확인 ==="
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
    "ComfyUI\models\tts\Qwen3TTS"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
Write-Host "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 2: Python venv (uv)
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [2/6] Python 3.11 venv ==="
if (-not (Test-Path ".venv")) {
    uv venv --python 3.11 .venv
    Write-Host "  생성: .venv"
} else {
    Write-Host "  [skip] .venv 이미 존재"
}
# venv 활성화 (현재 스크립트 프로세스)
& ".\.venv\Scripts\Activate.ps1"

# ═══════════════════════════════════════════════════════════════════
# PHASE 3: ComfyUI + 커스텀 노드 파이썬 의존성
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [3/6] ComfyUI 파이썬 의존성 ==="
uv pip install --quiet -r ComfyUI\requirements.txt
Write-Host "  완료"

Write-Host ""
Write-Host "=== [3b/6] 커스텀 노드 의존성 ==="
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
Write-Host "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 4: sageattention (필수 — O(n) attention, OOM 방지)
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [4/6] sageattention (O(n) attention) ==="
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
# PHASE 5: 백엔드 파이썬 의존성
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [5/6] 백엔드 의존성 ==="
uv pip install --quiet -r backend\requirements.txt
Write-Host "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 6: 프론트엔드 Node.js 의존성
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== [6/6] 프론트엔드 의존성 ==="
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
# 완료
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "================================================================="
Write-Host "  의존성 설치 완료"
Write-Host ""
Write-Host "  ★ 다음 단계"
Write-Host ""
Write-Host "  1. (선택) 토큰 설정"
Write-Host "       'hf_xxx...'      | Set-Content .hf_token         # Qwen3-TTS (gated)"
Write-Host "       'xxxxxxxx...'    | Set-Content .civitai_token    # Civitai 모델"
Write-Host ""
Write-Host "  2. 모델 다운로드 (~150GB — 이어받기 지원)"
Write-Host "       .\download_models.ps1"
Write-Host ""
Write-Host "  3. 모델 배치 확인"
Write-Host "       .\check_models.ps1"
Write-Host ""
Write-Host "  4. 서비스 실행"
Write-Host "       터미널 1: .\run.ps1                  (ComfyUI + FastAPI)"
Write-Host "       터미널 2: cd frontend; npm run dev"
Write-Host ""
Write-Host "  5. http://localhost:5173"
Write-Host ""
Write-Host "  상세 문서: docs\install.md"
Write-Host "================================================================="
