#!/usr/bin/env bash
# myaniform 의존성 설치 스크립트
# - uv 기반 venv 관리 (pip 직접 호출 금지)
# - ComfyUI 커스텀 노드와 필수 모델은 새 클론에서도 자동으로 clone/pull/download 함
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
if ! command -v git >/dev/null 2>&1; then
    echo "✗ git 이 설치되어 있지 않음."
    echo "  설치: sudo apt install -y git"
    exit 1
fi
echo "=== [0/8] uv: $(uv --version) ==="

# ═══════════════════════════════════════════════════════════════════
# PHASE 1: 모델 디렉토리 확보
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [1/8] 모델 디렉토리 확인 ==="
mkdir -p ComfyUI/models/{checkpoints,clip,vae,ipadapter,clip_vision,audio_encoders,vfi_models}
mkdir -p ComfyUI/models/{mmaudio,tts,text_encoders,unet,sams,upscale_models,SEEDVR2}
mkdir -p ComfyUI/models/fishaudioS2/s2-pro
mkdir -p ComfyUI/models/diffusion_models/{wan_s2v,wan_i2v_high,wan_i2v_low}
mkdir -p ComfyUI/models/loras/{wan_smoothmix,wan_anieffect,wan_wallpaper,qwen/VNCCS,DMD2}
mkdir -p ComfyUI/models/controlnet/SDXL
mkdir -p ComfyUI/models/ultralytics/{bbox,segm}
mkdir -p ComfyUI/models/Qwen3-TTS
if [ -d ComfyUI/models/tts/Qwen3TTS ] \
   && [ ! -e ComfyUI/models/Qwen3-TTS/Qwen3-TTS-12Hz-1.7B-Base/model.safetensors ] \
   && [ ! -L ComfyUI/models/Qwen3-TTS ]; then
    rmdir ComfyUI/models/Qwen3-TTS 2>/dev/null || true
    if [ ! -e ComfyUI/models/Qwen3-TTS ]; then
        ln -s tts/Qwen3TTS ComfyUI/models/Qwen3-TTS
        echo "  [migrate] 기존 tts/Qwen3TTS 모델을 Qwen3-TTS 경로로 연결"
    fi
fi
echo "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 2: ComfyUI 커스텀 노드 확보
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [2/8] ComfyUI 커스텀 노드 확인 ==="
mkdir -p ComfyUI/custom_nodes

ensure_custom_node() {
    local name="$1"
    local url="$2"
    local dest="ComfyUI/custom_nodes/$name"

    if [ -d "$dest/.git" ]; then
        echo "  [pull] $name"
        git -C "$dest" pull --ff-only --quiet || {
            echo "        업데이트 실패. 기존 체크아웃 유지: $dest"
        }
    elif [ -d "$dest" ]; then
        echo "  [keep] $name (로컬 디렉토리 존재)"
    else
        echo "  [clone] $name"
        git clone --depth 1 --quiet "$url" "$dest"
    fi
}

ensure_custom_node "ComfyUI-Crystools" "https://github.com/crystian/ComfyUI-Crystools.git"
ensure_custom_node "ComfyUI-Custom-Scripts" "https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git"
ensure_custom_node "ComfyUI-Easy-Use" "https://github.com/yolain/ComfyUI-Easy-Use.git"
ensure_custom_node "ComfyUI_Qwen3-TTS" "https://github.com/hobi2k/ComfyUI_Qwen3-TTS.git"
ensure_custom_node "ComfyUI-FishAudioS2" "https://github.com/Saganaki22/ComfyUI-FishAudioS2.git"
ensure_custom_node "ComfyUI-Frame-Interpolation" "https://github.com/Fannovel16/ComfyUI-Frame-Interpolation.git"
ensure_custom_node "ComfyUI-GGUF" "https://github.com/city96/ComfyUI-GGUF.git"
ensure_custom_node "ComfyUI_essentials" "https://github.com/cubiq/ComfyUI_essentials.git"
ensure_custom_node "ComfyUI-Image-Selector" "https://github.com/SLAPaper/ComfyUI-Image-Selector.git"
ensure_custom_node "ComfyUI_Geeky_AudioMixer" "https://github.com/GeekyGhost/ComfyUI_Geeky_AudioMixer.git"
ensure_custom_node "ComfyUI-KJNodes" "https://github.com/kijai/ComfyUI-KJNodes.git"
ensure_custom_node "ComfyUI-MMAudio" "https://github.com/kijai/ComfyUI-MMAudio.git"
ensure_custom_node "ComfyUI-SeedVR2_VideoUpscaler" "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git"
ensure_custom_node "ComfyUI-VideoHelperSuite" "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git"
ensure_custom_node "ComfyUI-WanVideoWrapper" "https://github.com/kijai/ComfyUI-WanVideoWrapper.git"
ensure_custom_node "ComfyUI_IPAdapter_plus" "https://github.com/cubiq/ComfyUI_IPAdapter_plus.git"
ensure_custom_node "ComfyUI_UltimateSDUpscale" "https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git"
ensure_custom_node "Derfuu_ComfyUI_ModdedNodes" "https://github.com/Derfuu/Derfuu_ComfyUI_ModdedNodes.git"
ensure_custom_node "audio-separation-nodes-comfyui" "https://github.com/christian-byrne/audio-separation-nodes-comfyui.git"
ensure_custom_node "comfyui-impact-pack" "https://github.com/ltdrdata/ComfyUI-Impact-Pack.git"
ensure_custom_node "comfyui-impact-subpack" "https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git"
ensure_custom_node "efficiency-nodes-ED" "https://github.com/NyaamZ/efficiency-nodes-ED.git"
ensure_custom_node "efficiency-nodes-comfyui" "https://github.com/jags111/efficiency-nodes-comfyui.git"
ensure_custom_node "rgthree-comfy" "https://github.com/rgthree/rgthree-comfy.git"
ensure_custom_node "universaltoolkit" "https://github.com/whmc76/ComfyUI-UniversalToolkit.git"
ensure_custom_node "vnccs" "https://github.com/AHEKOT/ComfyUI_VNCCS.git"
ensure_custom_node "vnccs-utils" "https://github.com/AHEKOT/ComfyUI_VNCCS_Utils.git"

cp -R comfy_custom_nodes/myaniform_workflow_viewer ComfyUI/custom_nodes/
cp comfy_custom_nodes/websocket_image_save.py ComfyUI/custom_nodes/
cp comfy_custom_nodes/myaniform_compat_nodes.py ComfyUI/custom_nodes/
echo "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 3: Python venv (uv)
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [3/8] Python 3.11 venv ==="
if [ ! -d .venv ]; then
    uv venv --python 3.11 .venv
    echo "  생성: .venv"
else
    echo "  [skip] .venv 이미 존재"
fi
# shellcheck disable=SC1091
source .venv/bin/activate

# ═══════════════════════════════════════════════════════════════════
# PHASE 4: ComfyUI + 커스텀 노드 파이썬 의존성
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [4/8] ComfyUI 파이썬 의존성 ==="
uv pip install --quiet -r ComfyUI/requirements.txt
echo "  완료"

echo ""
echo "=== [4b/8] 커스텀 노드 의존성 ==="
for d in ComfyUI/custom_nodes/*/; do
    if [ -f "${d}requirements.txt" ]; then
        name="$(basename "$d")"
        echo "  [*] $name"
        uv pip install --quiet -r "${d}requirements.txt" 2>&1 | tail -3 | sed 's/^/      /' || true
    fi
done
if [ -f ComfyUI/custom_nodes/efficiency-nodes-ED/install.py ]; then
    echo "  [*] efficiency-nodes-ED patch installer"
    (cd ComfyUI/custom_nodes/efficiency-nodes-ED && python install.py) || true
fi
echo "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 5: sageattention (필수 — O(n) attention, OOM 방지)
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [5/8] sageattention (O(n) attention) ==="
if python -c "from sageattention import sageattn" 2>/dev/null; then
    echo "  [skip] 이미 설치됨"
else
    uv pip install --quiet sageattention
    echo "  완료"
fi

# ═══════════════════════════════════════════════════════════════════
# PHASE 6: 백엔드 파이썬 의존성
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [6/8] 백엔드 의존성 ==="
uv pip install --quiet -r backend/requirements.txt
echo "  완료"

# ═══════════════════════════════════════════════════════════════════
# PHASE 7: 프론트엔드 Node.js 의존성
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [7/8] 프론트엔드 의존성 ==="
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
# PHASE 8: 모델 자동 다운로드 + 검증
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "=== [8/8] 모델 자동 다운로드 및 검증 ==="
if [ "${MYANIFORM_SKIP_MODEL_DOWNLOAD:-0}" = "1" ]; then
    echo "  [skip] MYANIFORM_SKIP_MODEL_DOWNLOAD=1"
else
    echo "  download_models.sh 실행 (이어받기 지원)"
    bash download_models.sh
    echo ""
    echo "  check_models.sh 실행"
    bash check_models.sh
fi

# ═══════════════════════════════════════════════════════════════════
# 완료
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "================================================================="
echo "  의존성 설치 완료"
echo ""
echo "  ★ 다음 단계"
echo ""
echo "  1. 서비스 실행"
echo "       터미널 1: bash run.sh       (ComfyUI + FastAPI)"
echo "       터미널 2: cd frontend && npm run dev"
echo ""
echo "  2. http://localhost:5173"
echo ""
echo "  참고: 모델 다운로드를 건너뛰려면 MYANIFORM_SKIP_MODEL_DOWNLOAD=1 bash setup.sh"
echo ""
echo "  상세 문서: docs/install.md"
echo "================================================================="
