#!/usr/bin/env bash
# myaniform 의존성 설치 스크립트
# - uv 기반 venv 관리 (pip 직접 호출 금지)
# - ComfyUI 코드·커스텀 노드는 리포에 벤더링되어 있음 (클론 불필요)
# - 실행: bash setup.sh
#
# 상세 가이드: docs/install.md
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "================================================================="
echo "  myaniform 의존성 설치"
echo "================================================================="
echo ""

# ═══════════════════════════════════════════════════════════════════
# PHASE 0: uv 확인
# ═══════════════════════════════════════════════════════════════════
if ! command -v uv >/dev/null 2>&1; then
    echo "✗ uv 가 설치되어 있지 않음."
    echo "  설치: curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo "  설치 후 'source ~/.bashrc' 또는 새 셸에서 재실행."
    exit 1
fi
echo "=== [0/6] uv: $(uv --version) ==="

# ═══════════════════════════════════════════════════════════════════
# PHASE 1: 모델 디렉토리 확보
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [1/6] 모델 디렉토리 확인 ==="
mkdir -p ComfyUI/models/{checkpoints,clip,vae,ipadapter,clip_vision,audio_encoders,vfi_models}
mkdir -p ComfyUI/models/{mmaudio,tts,text_encoders,unet,sams,upscale_models}
mkdir -p ComfyUI/models/fishaudioS2/s2-pro
mkdir -p ComfyUI/models/diffusion_models/{wan_s2v,wan_i2v_high,wan_i2v_low}
mkdir -p ComfyUI/models/loras/{wan_smoothmix,wan_anieffect,wan_wallpaper,qwen/VNCCS,DMD2}
mkdir -p ComfyUI/models/controlnet/SDXL
mkdir -p ComfyUI/models/ultralytics/bbox
mkdir -p ComfyUI/models/tts/Qwen3TTS
echo "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 2: Python venv (uv)
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [2/6] Python 3.11 venv ==="
if [ ! -d .venv ]; then
    uv venv --python 3.11 .venv
    echo "  생성: .venv"
else
    echo "  [skip] .venv 이미 존재"
fi
# shellcheck disable=SC1091
source .venv/bin/activate

# ═══════════════════════════════════════════════════════════════════
# PHASE 3: ComfyUI + 커스텀 노드 파이썬 의존성
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [3/6] ComfyUI 파이썬 의존성 ==="
uv pip install --quiet -r ComfyUI/requirements.txt
echo "  완료"

echo ""
echo "=== [3b/6] 커스텀 노드 의존성 ==="
for d in ComfyUI/custom_nodes/*/; do
    if [ -f "${d}requirements.txt" ]; then
        name="$(basename "$d")"
        echo "  [*] $name"
        uv pip install --quiet -r "${d}requirements.txt" 2>&1 | tail -3 | sed 's/^/      /' || true
    fi
done
echo "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 4: sageattention (필수 — O(n) attention, OOM 방지)
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [4/6] sageattention (O(n) attention) ==="
if python -c "from sageattention import sageattn" 2>/dev/null; then
    echo "  [skip] 이미 설치됨"
else
    uv pip install --quiet sageattention
    echo "  완료"
fi

# ═══════════════════════════════════════════════════════════════════
# PHASE 5: 백엔드 파이썬 의존성
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [5/6] 백엔드 의존성 ==="
uv pip install --quiet -r backend/requirements.txt
echo "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 6: 프론트엔드 Node.js 의존성
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [6/6] 프론트엔드 의존성 ==="
if ! command -v npm >/dev/null 2>&1; then
    echo "  ✗ npm 이 없음. Node.js 20+ 설치 후 재실행."
    echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "    sudo apt install -y nodejs"
    exit 1
fi
cd "$ROOT/frontend"
npm install --silent
cd "$ROOT"
echo "  완료"

# ═══════════════════════════════════════════════════════════════════
# 워크플로우 JSON 을 ComfyUI user 폴더로 복사 (GUI 편집 가능하게)
# ═══════════════════════════════════════════════════════════════════
mkdir -p ComfyUI/user/default/workflows
cp workflows/*.json ComfyUI/user/default/workflows/ 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════
# 완료
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "================================================================="
echo "  의존성 설치 완료"
echo ""
echo "  ★ 다음 단계"
echo ""
echo "  1. (선택) 토큰 설정"
echo "       echo 'hf_xxx...'    > .hf_token         # Qwen3-TTS (gated)"
echo "       echo 'xxxxxxxx...'  > .civitai_token    # Civitai 모델"
echo ""
echo "  2. 모델 다운로드 (~150GB — 이어받기 지원)"
echo "       bash download_models.sh"
echo ""
echo "  3. 모델 배치 확인"
echo "       bash check_models.sh"
echo ""
echo "  4. 서비스 실행"
echo "       터미널 1: bash run.sh       (ComfyUI + FastAPI)"
echo "       터미널 2: cd frontend && npm run dev"
echo ""
echo "  5. http://localhost:5173"
echo ""
echo "  상세 문서: docs/install.md"
echo "================================================================="
