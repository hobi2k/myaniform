#!/usr/bin/env bash
# myaniform 서비스 런처 (ComfyUI + 백엔드)
# 사용: bash run.sh
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# .env 로드 — uvicorn / ComfyUI 둘 다 이 셸의 자식 프로세스라
# COMFYUI_URL 등 env 가 자동 상속됨. 이미 export 된 셸 변수는 보존.
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
fi

if [ ! -d .venv ]; then
    echo "ERR: .venv 없음. 먼저 bash setup.sh 실행"
    exit 1
fi
source .venv/bin/activate

# ── OS 감지 — ComfyUI 플래그 분기에 사용 ──
case "$(uname -s)" in
    Darwin) PLATFORM=mac ;;
    Linux)
        if grep -qi microsoft /proc/version 2>/dev/null; then PLATFORM=wsl
        else PLATFORM=linux
        fi
        ;;
    *) PLATFORM=other ;;
esac

mkdir -p logs
pkill -f "ComfyUI/main.py" 2>/dev/null || true
pkill -f "uvicorn backend.main:app" 2>/dev/null || true
sleep 1

# ComfyUI 플래그 — 플랫폼별 분기.
#  공통: --port --listen --cache-none --disable-smart-memory --preview-method auto
#  CUDA only: --normalvram --disable-pinned-memory --reserve-vram (mac MPS 무시 또는 거부)
#  Mac MPS: --use-pytorch-cross-attention (Metal 친화 attention impl)
COMFY_FLAGS=(--port 8188 --listen 0.0.0.0 --cache-none --disable-smart-memory --preview-method auto)
if [ "$PLATFORM" = "mac" ]; then
    # MPS 가 일부 PyTorch 연산 (e.g. aten::_fft_r2c) 미지원 → CPU fallback 켜야 영상/오디오
    # 워크플로우가 죽지 않음. 성능보다 안정성 우선 — 미지원 op 만 CPU 로 떨어지므로 대부분
    # MPS 에서 그대로 실행됨.
    export PYTORCH_ENABLE_MPS_FALLBACK=1
    # Metal 메모리 워터마크 — 큰 모델 (Wan 14B) 로드 중 OOM 회피.
    # 기본 0.0 = 시스템 자동, 0 으로 두면 Metal 이 알아서 다 쓰도록 허용.
    export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0
    # SDPA 기반 cross-attention — sageattention 의 MPS 친화 대체.
    COMFY_FLAGS+=(--use-pytorch-cross-attention)
    LAUNCH_NOTE="MPS (Apple Silicon) + cross-attn + cache-none + MPS_FALLBACK=1"
else
    COMFY_FLAGS+=(--normalvram --disable-pinned-memory --reserve-vram 0.5)
    LAUNCH_NOTE="normalvram + cache-none + smart-memory off + reserve-vram (CUDA OOM 방지)"
fi

echo "[1/2] ComfyUI (:8188) 기동 — $LAUNCH_NOTE"
nohup python ComfyUI/main.py "${COMFY_FLAGS[@]}" \
    > logs/comfyui.log 2>&1 &
echo "  PID=$!  로그: logs/comfyui.log"

echo "[2/2] FastAPI 백엔드 (:8000) 기동"
nohup uvicorn backend.main:app --host 0.0.0.0 --port 8000 \
    > logs/backend.log 2>&1 &
echo "  PID=$!  로그: logs/backend.log"

echo ""
echo "대기 중 (15초)..."
sleep 15
echo ""
if curl -sS http://127.0.0.1:8188/system_stats > /dev/null 2>&1; then
    echo "  ✔ ComfyUI OK"
else
    echo "  ✗ ComfyUI 실패 — tail -f logs/comfyui.log"
fi
if curl -sS http://127.0.0.1:8000/docs > /dev/null 2>&1; then
    echo "  ✔ 백엔드 OK"
else
    echo "  ✗ 백엔드 실패 — tail -f logs/backend.log"
fi
echo ""
echo "프런트: cd frontend && npm run dev"
