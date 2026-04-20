#!/usr/bin/env bash
# myaniform 서비스 런처 (ComfyUI + 백엔드)
# 사용: bash run.sh
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ ! -d .venv ]; then
    echo "ERR: .venv 없음. 먼저 bash setup.sh 실행"
    exit 1
fi
source .venv/bin/activate

mkdir -p logs
pkill -f "ComfyUI/main.py" 2>/dev/null || true
pkill -f "uvicorn backend.main:app" 2>/dev/null || true
sleep 1

echo "[1/2] ComfyUI (:8188) 기동 — normalvram + cache-none + smart-memory off (누적 OOM 방지)"
nohup python ComfyUI/main.py --port 8188 \
    --normalvram --cache-none --disable-smart-memory \
    --reserve-vram 0.5 \
    > logs/comfyui.log 2>&1 &
echo "  PID=$!  로그: logs/comfyui.log"

echo "[2/2] FastAPI 백엔드 (:8000) 기동"
nohup uvicorn backend.main:app --port 8000 \
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
