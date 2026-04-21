# myaniform

애니풍 멀티샷 영상 자동 제작 플랫폼. 캐릭터·대사·씬을 설정하면 립싱크·루프·이펙트·SFX·장면전환이 포함된 한 편의 영상을 생성.

**스택**: FastAPI (:8000) + ComfyUI (:8188) + React/Vite (:5173) + SQLite.
**GPU**: NVIDIA RTX 5080 16GB VRAM (WSL2, normalvram + sageattention).

---

## Quick start

처음 클론하는 사람은 → **[docs/install.md](docs/install.md)** 순서대로.

요약:
```bash
# 1) 시스템 패키지
sudo apt install -y git git-lfs ffmpeg build-essential
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2) 클론 + 의존성
git clone https://github.com/hobi2k/myaniform.git && cd myaniform
bash setup.sh

# 3) 모델 (~150GB)
echo '<HF_TOKEN>' > .hf_token           # Qwen3-TTS (gated) 가 필요하면
echo '<CIVITAI_TOKEN>' > .civitai_token # Civitai 모델이 필요하면
bash download_models.sh
bash check_models.sh

# 4) 실행
bash run.sh                             # ComfyUI + FastAPI (백그라운드)
cd frontend && npm run dev              # :5173 (별도 터미널)
```

접속: http://localhost:5173

### 서버 끄기

`run.sh` 로 올린 백엔드 서버(ComfyUI + FastAPI)를 내릴 때:

```bash
pkill -f "ComfyUI/main.py"
pkill -f "uvicorn backend.main:app"
```

프론트 개발 서버도 같이 끄려면:

```bash
pkill -f "vite"
```

실행 중인지 확인:

```bash
ps -ef | rg "ComfyUI/main.py|uvicorn backend.main:app|vite"
```

---

## 문서

- **[install](docs/install.md)** — 제로부터 재현 가이드 (새 환경에서 git clone 후 이 문서만 따라가면 끝까지 도달)
- [overview](docs/overview.md) — 아키텍처·사용자 흐름
- [workflows](docs/workflows.md) — ComfyUI 워크플로우 카탈로그 (립싱크/루프/이펙트/TTS/이미지)
- [operations](docs/operations.md) — run.sh 플래그, sageattention OOM fix, 로그, 메모리 튜닝, 장애 대응
- [models-and-nodes](docs/models-and-nodes.md) — 모델 경로·커스텀 노드 목록
- [pipeline](docs/pipeline.md) — 데이터 플로우 (씬 → voice → image → video → concat)
- [status](docs/status.md) — 현재 동작 범위·성능 수치
- [roadmap](docs/roadmap.md) — 계획
- [tts-comparison](docs/tts-comparison.md) — Qwen3 vs S2Pro vs VoiceDesign
- [comfyui-workflow-design](docs/comfyui-workflow-design.md) — 설계 근거

---

## 프로젝트 레이아웃

```
myaniform/
├── ComfyUI/                   # embedded (custom_nodes 포함 — 클론 시 함께 복제됨)
├── backend/                   # FastAPI
│   ├── main.py
│   ├── models.py              # SQLModel (Project·Character·Scene)
│   ├── routers/               # projects/characters/scenes/generation/setup
│   └── services/              # comfyui_client / workflow_patcher / ffmpeg_utils
├── frontend/                  # Vite + React
├── workflows/                 # ComfyUI API JSON (per-type workflow)
├── uploads/                   # 사용자 업로드 이미지 (런타임 생성)
├── voices/                    # 캐릭터 보이스 레퍼런스 (런타임 생성)
├── output/                    # 산출물
├── myaniform.db               # SQLite (런타임 생성)
├── docs/
├── setup.sh                   # uv venv + 의존성 + sageattention
├── download_models.sh         # HF + Civitai 자동 다운로드 (이어받기 지원)
├── check_models.sh            # 필수 모델 존재 검증
└── run.sh                     # ComfyUI + FastAPI 런처
```
