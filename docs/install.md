# Install — 제로부터 재현 가이드

> 목적: **빈 머신에서 `git clone` 한 번으로 myaniform 을 끝까지 빌드·실행**할 수 있게 한다.
> 지원 환경: Linux / WSL2 Ubuntu / **네이티브 Windows**.
> 검증 환경 (primary): WSL2 Ubuntu 22.04, RTX 5080 16GB, Python 3.11, CUDA 13.0.

모든 단계는 **idempotent** — 중간에 막히면 같은 명령 재실행.

## 환경 선택

| 경로 | 스크립트 | 권장 대상 | 검증 상태 |
|---|---|---|---|
| **A. Linux / WSL2** | `setup.sh` / `run.sh` / `download_models.sh` / `check_models.sh` | 기본 경로 (주 개발 환경) | ✅ 완주 검증 |
| **B. 네이티브 Windows** | `setup.ps1` / `run.ps1` / `download_models.ps1` / `check_models.ps1` | WSL2 를 쓸 수 없는 Windows 환경 | ⚠ 기능 동일하지만 CI 미검증 |

Windows 유저는 GPU ML 에서 **WSL2 가 표준** 이지만 (PyTorch/ComfyUI 튜토리얼 대부분이 WSL2 기준), WSL2 를 설치할 수 없는 환경 (회사 정책·디스크 제약) 을 위해 네이티브 PowerShell 스크립트도 제공. 양쪽 모두 동일한 `git clone` 리포로부터 동작.

---

## 0. 전체 요약

### A. Linux / WSL2

```bash
# 1) 시스템 패키지 + uv
sudo apt update && sudo apt install -y git git-lfs ffmpeg build-essential wget curl
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2) 리포 클론
git clone https://github.com/hobi2k/myaniform.git
cd myaniform

# 3) 토큰 준비
echo "<HF_TOKEN>"       > .hf_token
echo "<CIVITAI_TOKEN>"  > .civitai_token

# 4) 파이썬 venv + 의존성 + custom_nodes + 모델 자동 다운로드/검증
bash setup.sh

# 5) 실행
bash run.sh                     # ComfyUI(:8188) + FastAPI(:8000) 백그라운드
cd frontend && npm run dev      # :5173 (별도 터미널)
```

설치 후 실제 생성 smoke test:

```bash
bash check_models.sh
./.venv/bin/python scripts/generate_romance_smoke.py
```

### B. 네이티브 Windows (PowerShell)

```powershell
# 1) 시스템 툴
winget install --id Git.Git
winget install --id OpenJS.NodeJS.LTS
winget install --id Gyan.FFmpeg                # ffmpeg.exe + PATH
winget install --id astral-sh.uv               # or: irm https://astral.sh/uv/install.ps1 | iex
# NVIDIA 드라이버: 최신 Game Ready Driver + CUDA 13.0 Toolkit 설치 (nvidia.com)

# 2) PowerShell 실행 정책 (최초 1회, 현재 사용자 범위)
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

# 3) 클론
git clone https://github.com/hobi2k/myaniform.git
cd myaniform

# 4) 토큰 준비
'hf_xxx...'   | Set-Content -NoNewline .hf_token
'xxxxxxxx...' | Set-Content -NoNewline .civitai_token

# 5) venv + 의존성 + custom_nodes + 모델 자동 다운로드/검증
.\setup.ps1

# 6) 실행
.\run.ps1                           # ComfyUI + FastAPI 백그라운드
cd frontend; npm run dev            # :5173 (별도 PowerShell 창)
```

설치 후 실제 생성 smoke test:

```powershell
.\check_models.ps1
.\.venv\Scripts\python.exe scripts\generate_romance_smoke.py
```

접속: http://localhost:5173

---

## 1. 하드웨어·OS 요구사항

| 항목 | 최소 | 권장 |
|---|---|---|
| GPU | NVIDIA 12GB VRAM (sm_80+ sageattn 지원) | RTX 4080/5080 이상 16GB |
| 시스템 RAM | 16GB | 32GB |
| 스왑/페이지 파일 | 32GB | 64GB |
| 디스크 | 200GB | 500GB+ (모델 150GB + 산출물) |
| OS | Ubuntu 22.04 / WSL2 / Windows 10 build 19044+ / Windows 11 | 최신 |
| 드라이버 | NVIDIA 570+ (CUDA 13 호환) | 595.79 검증됨 |

### WSL2 를 쓰는 경우 (경로 A): 메모리 설정

`%USERPROFILE%\.wslconfig` 에:

```ini
[wsl2]
memory=28GB
swap=64GB
processors=12
```

수정 후 PowerShell 에서 `wsl --shutdown` 한 번 실행.

### 네이티브 Windows 를 쓰는 경우 (경로 B): 페이지 파일 확보

Windows 의 가상 메모리 (페이지 파일) 가 60GB+ 있어야 Wan 2.2 14B 모델이 CPU 에 오프로드되는 동안 죽지 않음.

1. `sysdm.cpl` 실행 → "고급" → "성능 설정" → "고급" → "가상 메모리 변경"
2. "자동으로 관리" 해제 → 시스템 드라이브에 "사용자 지정 크기" → 초기 32768 / 최대 65536 (MB)
3. 재부팅

### NVIDIA 드라이버·CUDA (공통)

- **WSL2**: Windows 호스트에 NVIDIA 드라이버만 설치. WSL 안에는 CUDA Toolkit 설치 불필요 (호스트 드라이버가 `/usr/lib/wsl/lib/` 로 libcuda 주입).
- **네이티브 Windows**: NVIDIA 드라이버 + CUDA Toolkit 13.0. `nvcc --version` 으로 확인.

검증: 어느 쪽이든 `nvidia-smi` 가 CUDA 13.0+ 와 GPU 를 보여야 한다.

---

## 2. 시스템 패키지

### 경로 A (Linux / WSL2) — apt

```bash
sudo apt update
sudo apt install -y \
    git git-lfs \
    ffmpeg \
    build-essential \
    python3-dev \
    wget curl \
    libgl1 libglib2.0-0   # OpenCV runtime (RIFE/VFI)
```

### 경로 B (네이티브 Windows) — winget

```powershell
winget install --id Git.Git
winget install --id Git.LFS                    # 또는 Git 설치 후: git lfs install
winget install --id Gyan.FFmpeg                # ffmpeg.exe + PATH 자동
winget install --id OpenJS.NodeJS.LTS          # Node 20+
winget install --id astral-sh.uv               # uv
```

설치 후 **PowerShell 창 새로 열어** PATH 반영 확인:
```powershell
git --version; ffmpeg -version; node --version; uv --version
```

`build-essential` / `python3-dev` 에 해당하는 네이티브 컴파일 툴은 대부분의 경우 불필요 — 이 리포의 파이썬 의존성은 모두 wheel 로 배포됨. 만약 sageattention 이 wheel 로 설치되지 않으면 [Section 4](#4-의존성-설치) 트러블슈팅 참고.

### uv 설치 (파이썬 환경 매니저, 공통)

이 리포는 **uv** 기반이다. pip 직접 호출 금지.

A. Linux / WSL2:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc          # or exec $SHELL
uv --version              # 0.10.x 이상
```

B. Windows (winget 으로 안 받은 경우):
```powershell
irm https://astral.sh/uv/install.ps1 | iex
# 새 PowerShell 창에서
uv --version              # 0.10.x 이상
```

### Node.js (프론트엔드용)

A. Linux / WSL2:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version            # v20.x
```

B. Windows: 위 `winget install OpenJS.NodeJS.LTS` 가 처리. 버전 확인만:
```powershell
node --version            # v20.x
```

---

## 3. 리포 클론

A. Linux / WSL2:
```bash
git clone https://github.com/hobi2k/myaniform.git
cd myaniform
```

B. Windows (PowerShell):
```powershell
git clone https://github.com/hobi2k/myaniform.git
cd myaniform
# 최초 1회: PowerShell 에서 .\*.ps1 실행을 허용
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

> 윈도우 경로 길이 제한 주의: `C:\myaniform\...` 처럼 **짧은 경로**에 둘 것. `C:\Users\<이름>\OneDrive\...` 같은 깊은 경로는 ComfyUI 커스텀 노드 일부에서 260자 제한 에러 발생 가능. 필요 시 `git config --system core.longpaths true` 설정.

리포에 **이미 포함**된 것:
- `ComfyUI/` — Comfy 본체 코드 (버전 0.19.0 스냅샷)
- `comfy_custom_nodes/*` — myaniform 전용 로컬 ComfyUI 확장 템플릿 (`workflow_viewer`, `SaveImageWebsocket`)
- `workflows/*.json` — 13개 ComfyUI 워크플로우 (10 API + 3 VNCCS UI)
- `backend/` — FastAPI
- `frontend/` — React 18 + Vite 5

**포함 안 된 것** (아래 단계에서 받음):
- `.venv/` — 파이썬 가상환경
- `ComfyUI/models/**` — 모델 파일 (150GB+)
- `ComfyUI/custom_nodes/**` — `setup.sh` / `setup.ps1` 가 필요한 외부 커스텀 노드를 자동 clone/pull
- `frontend/node_modules/`

---

## 4. 의존성 설치

A. Linux / WSL2:
```bash
bash setup.sh
```

B. Windows (PowerShell):
```powershell
.\setup.ps1
```

양쪽 스크립트가 동일 순서로 수행:

1. **모델 디렉토리 생성** — `ComfyUI/models/{checkpoints,clip,vae,...}`
2. **venv 생성** — `uv venv --python 3.11 .venv`
3. **ComfyUI + 커스텀 노드 파이썬 의존성** — `uv pip install -r ComfyUI/requirements.txt` 및 각 `custom_nodes/*/requirements.txt`
4. **sageattention 설치** — O(n) 메모리 attention. **필수** (OOM 방지)
5. **백엔드 의존성** — `uv pip install -r backend/requirements.txt`
6. **프론트엔드 의존성** — `cd frontend && npm install`
7. **워크플로우 복사** — `workflows/*.json → ComfyUI/user/default/workflows/` (ComfyUI GUI 에서 편집 가능하게)

예상 시간: 첫 실행 시 **5~10분** (네트워크 의존). 재실행은 수초 (캐시 재사용).

### Windows sageattention 트러블슈팅

sageattention 은 O(n) attention 커널로 **OOM 방지를 위해 필수**지만 Windows 에서 설치가 까다롭다.

1. **triton-windows 선행 설치** — `setup.ps1` 이 자동으로 `uv pip install triton-windows` 먼저 시도. triton 본가는 Windows wheel 을 배포하지 않음.
2. **PyTorch CUDA 버전 매칭** — sageattention wheel 은 `torch==2.11.0+cu130` 에 맞춰져야 함. 다른 CUDA 빌드면 import 실패.
3. **수동 재시도**:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   uv pip install triton-windows
   uv pip install sageattention
   python -c "from sageattention import sageattn; print('OK')"
   ```
4. **정 안 되면** — 원본 I2V 워크플로우 패처의 `attention_mode` 를 `sdpa` 로 바꿔 임시 우회. 단 블록 스왑만으로는 OOM 날 확률이 높으므로 블록 수를 더 늘려야 함 (`blocks_to_swap: 30~40`).

### 설치되는 주요 파이썬 버전

| 패키지 | 버전 | 비고 |
|---|---|---|
| Python | 3.11.15 | uv 로 자동 설치 |
| torch | 2.11.0+cu130 | CUDA 13.0 빌드 |
| sageattention | 1.0.6+ | OOM 방지 (필수) |
| fastapi | 0.111+ | 백엔드 |
| sqlmodel | 0.0.18+ | ORM |
| uvicorn[standard] | 0.29+ | ASGI 서버 |

---

## 5. 모델 다운로드

`setup.sh` / `setup.ps1` 는 기본적으로 `download_models.*` 와 `check_models.*` 까지 실행한다. 즉 새 clone 후 토큰을 먼저 넣고 setup 을 실행하면, 추가된 모델과 노드까지 한 번에 준비된다.

모델 다운로드를 의도적으로 건너뛰려면:

Linux / WSL2:
```bash
MYANIFORM_SKIP_MODEL_DOWNLOAD=1 bash setup.sh
```

Windows:
```powershell
$env:MYANIFORM_SKIP_MODEL_DOWNLOAD='1'; .\setup.ps1
```

### 토큰 준비

| 토큰 | 필요 시점 | 획득처 |
|---|---|---|
| `HF_TOKEN` | Qwen3-TTS (gated) | huggingface.co → Settings → Access Tokens → Read |
| `CIVITAI_TOKEN` | Dasiwa Illustrious SDXL, SmoothMix, DaSiWa S2V FastFidelity | civitai.com → Settings → API Keys |

A. Linux / WSL2:
```bash
echo "hf_xxx..."     > .hf_token
echo "xxxxxxxx..."   > .civitai_token
# (.gitignore 에 이미 등록됨)
```

B. Windows (PowerShell — 줄바꿈이 추가되지 않도록 `Set-Content` 사용):
```powershell
'hf_xxx...'   | Set-Content -NoNewline .hf_token
'xxxxxxxx...' | Set-Content -NoNewline .civitai_token
```

토큰 없이도 일부 공개 모델은 받아지지만, 현재 필수 경로에는 Civitai 모델과 gated 모델이 포함된다. 토큰이 없으면 setup/download 가 실패로 끝나며 누락 항목을 요약한다.

### 다운로드 실행

A. Linux / WSL2:
```bash
bash download_models.sh              # 전체 (~150GB)
bash download_models.sh --list       # 받을 목록만 프린트
bash download_models.sh --hf-only    # HuggingFace 만
bash download_models.sh --civitai    # Civitai 만
```

B. Windows (PowerShell):
```powershell
.\download_models.ps1                # 전체
.\download_models.ps1 list           # 목록만
.\download_models.ps1 hf             # HuggingFace 만
.\download_models.ps1 civitai        # Civitai 만
```

- 모든 다운로드에 `curl -C - --retry 5` (Linux) 또는 `curl.exe -C - --retry 5` (Windows 10 Build 17063+ 내장) 적용 — 중간에 끊겨도 **재실행 시 이어받기**.
- 실패한 모델은 스크립트가 배열에 모아 마지막에 목록 출력. 네트워크 복구 후 재실행.

### 다운로드되는 모델 (카테고리별)

| 카테고리 | 저장 경로 | 대표 파일 | 크기 |
|---|---|---|---|
| Wan T5 Encoder | `text_encoders/` | `umt5-xxl-enc-bf16.safetensors` | 10GB |
| Wan VAE | `vae/` | `Wan2_1_VAE_bf16.safetensors` | 1GB |
| Wan 2.2 I2V HIGH | `diffusion_models/wan_i2v_high/` | `Dasiwa...synthseductionHighV9.safetensors` | 28GB |
| Wan 2.2 I2V LOW | `diffusion_models/wan_i2v_low/` | `Dasiwa...synthseductionLowV9.safetensors` | 28GB |
| Wan 2.2 S2V | `diffusion_models/wan_s2v/` | `Wan2.2-S2V-14B-Q4_K_M.gguf` | 9GB |
| S2V Audio Encoder | `audio_encoders/` | `wav2vec2_large_english_fp32.safetensors` | 1GB |
| MMAudio (4종) | `mmaudio/` | `mmaudio_large_44k_v2_fp16` 외 | 3GB |
| Qwen Image Edit | `unet/` | `qwen-image-edit-2511-Q5_0.gguf` | 14GB |
| Qwen Image VL/VAE | `text_encoders/`, `vae/` | `qwen_2.5_vl_7b_fp8_scaled` | 8GB |
| VNCCS LoRA 세트 | `loras/qwen/VNCCS/` | 4개 LoRA | 2GB |
| FaceDetailer | `ultralytics/bbox/` | `face_yolov8m.pt` | 25MB |
| Qwen3-TTS (gated) | `Qwen3-TTS/` | 4 variants | 16GB |
| Fish Audio S2 Pro | `fishaudioS2/s2-pro/` | `model-000{01,02}-of-00002` | 24GB |
| SDXL checkpoint | `checkpoints/` | `DasiwaIllustriousRealistic_v1` | 6.5GB |
| SmoothMix LoRA | `loras/wan_smoothmix/` | `SmoothMix_illustrious` | 150MB |

총합 ≈ **150GB**.

### 검증

A. Linux / WSL2:
```bash
bash check_models.sh
```

B. Windows (PowerShell):
```powershell
.\check_models.ps1
```

각 카테고리에서 필수 파일을 체크. 누락된 것은 `[MISS]` 로 표시 — 해당 경로에 수동 배치 후 재실행.

---

## 6. 서비스 실행

### 터미널 1: ComfyUI + 백엔드

A. Linux / WSL2:
```bash
bash run.sh
```

B. Windows (PowerShell):
```powershell
.\run.ps1
```

하는 일 (양쪽 동일):
1. 기존 프로세스 종료
   - Linux: `pkill -f "ComfyUI/main.py"`, `pkill -f "uvicorn backend.main"`
   - Windows: `Get-CimInstance Win32_Process` 로 python.exe 중 ComfyUI/uvicorn 커맨드라인만 골라 `Stop-Process`
2. ComfyUI 백그라운드 실행 → `logs/comfyui.log` (Windows: `logs\comfyui.log`)
3. FastAPI 백그라운드 실행 → `logs/backend.log`
4. 15초 대기 후 헬스체크 (:8188/system_stats, :8000/docs)

ComfyUI 플래그 (16GB VRAM 용, 공통):
```
--normalvram --cache-none --disable-smart-memory --reserve-vram 0.5
```
이 조합이 **필수**다. 이유는 [operations.md#서비스-런처](operations.md#서비스-런처-runsh) 참고.

### 터미널 2: 프론트엔드

A. Linux / WSL2:
```bash
cd frontend
npm run dev
```

B. Windows (PowerShell — 별도 창):
```powershell
cd frontend
npm run dev
```

Vite dev 서버가 :5173 에서 뜸. 브라우저에서 http://localhost:5173 접속.

---

## 7. 첫 프로젝트 생성 — 동작 확인

1. 브라우저: http://localhost:5173
2. "새 프로젝트" → 제목 입력
3. 캐릭터 패널에서 이미지 업로드 + 보이스 설계 (or 직접 WAV 업로드)
4. 씬 2~3개 추가 (type: `lipsync`, `loop`, `effect`)
5. "생성 시작" 클릭 → SSE 로그에서 scene_done 이벤트 확인

5씬 프로젝트 소요 시간: **2~3시간** (주로 립싱크 S2V 가 씬당 50분).

---

## 8. 트러블슈팅

### 에러: `sageattention not found` / OOM 반복

A. Linux / WSL2:
```bash
source .venv/bin/activate
uv pip install sageattention
python -c "from sageattention import sageattn; print(sageattn)"
```

B. Windows (PowerShell):
```powershell
.\.venv\Scripts\Activate.ps1
uv pip install triton-windows      # 선행 조건
uv pip install sageattention
python -c "from sageattention import sageattn; print(sageattn)"
```

### 에러: `torch.AcceleratorError: CUDA error`

누적된 GPU 상태 잔류. ComfyUI 만 재시작.

A. Linux / WSL2:
```bash
pkill -f "ComfyUI/main.py"; sleep 3
bash run.sh
```

B. Windows (PowerShell):
```powershell
Get-Process python -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "ComfyUI\\main\.py"
} | Stop-Process -Force
Start-Sleep -Seconds 3
.\run.ps1
```

### 에러: TTS 보이스가 1초 무음 플레이스홀더

`workflows/ws_tts_clone.json` 은 hobi2k `ComfyUI_Qwen3-TTS` 기준이다. `Qwen3ClonePromptFromAudio` 의 **`x_vector_only_mode` 는 반드시 `true`** 이며, 최종 렌더링은 `Qwen3CustomVoiceFromPrompt` 가 담당한다.

### 모델 다운로드 재개

- Linux/WSL2: `bash download_models.sh`
- Windows: `.\download_models.ps1`

양쪽 모두 `curl -C -` 로 이어받기 지원.

### WSL2 메모리 부족 (generate 도중 프로세스 죽음)

`.wslconfig` 의 `swap=64GB` 올리고 PowerShell 에서 `wsl --shutdown` → 재기동.

### 네이티브 Windows 메모리 부족 (generate 도중 Python.exe 죽음)

페이지 파일 확인. [Section 1 "네이티브 Windows 를 쓰는 경우: 페이지 파일 확보"](#네이티브-windows-를-쓰는-경우-경로-b-페이지-파일-확보) 의 32768/65536 MB 설정이 되었는지 `sysdm.cpl` 에서 재확인. 작업 관리자 → 성능 → 메모리 에서 커밋 한도가 `RAM + 페이지파일` 에 가까운지 확인.

### Windows 경로 길이 260자 제한

커스텀 노드 설치나 모델 다운로드 중 `path too long` 에러:
```powershell
# 관리자 PowerShell 에서
git config --system core.longpaths true
# Windows 자체 긴 경로 활성화 (재부팅 필요)
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
    -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

### 모델 이름 불일치

워크플로우 JSON 의 모델명은 `download_models.{sh,ps1}` 이 받는 파일명과 **정확히** 매칭되어야 한다. 커스텀 파인튜닝 모델로 바꾸려면:
1. `ComfyUI/models/diffusion_models/wan_i2v_{high,low}/` 에 파일 배치
2. `backend/services/workflow_patcher.py` 의 `_I2V_MODELS` 딕셔너리 갱신
3. 또는 웹 UI 의 씬 에디터 → "모델" 드롭다운에서 선택

---

## 9. 업데이트

A. Linux / WSL2:
```bash
git pull
bash setup.sh              # 의존성 변경 있으면 반영 (idempotent)
bash run.sh                # 서비스 재기동
```

B. Windows (PowerShell):
```powershell
git pull
.\setup.ps1                # idempotent
.\run.ps1                  # 서비스 재기동
```

새 모델이 추가되면 `download_models.{sh,ps1}` 도 재실행.

---

## 10. 디렉토리 참조

```
myaniform/
├── ComfyUI/                     # ComfyUI 본체 (git clone 에 포함)
│   ├── custom_nodes/            # setup.sh/setup.ps1 가 외부 노드를 clone/pull
│   ├── models/                  # 모델 파일 (download_models.sh 로 채움)
│   ├── input/                   # 런타임 입력 스테이징
│   ├── output/                  # ComfyUI 생성 산출물
│   └── user/default/workflows/  # setup.sh 가 workflows/*.json 복사
├── backend/
│   ├── requirements.txt         # pip 의존성
│   ├── main.py
│   ├── models.py                # SQLModel 스키마
│   ├── routers/                 # API 엔드포인트
│   └── services/                # comfyui_client / workflow_patcher / ffmpeg_utils
├── frontend/
│   ├── package.json
│   └── src/
├── comfy_custom_nodes/          # myaniform 로컬 ComfyUI 확장 템플릿
├── workflows/                   # ComfyUI API JSON (원본, 런타임 패칭됨)
├── docs/                        # 이 문서 포함
├── logs/                        # run.sh 가 tee 하는 로그
├── uploads/                     # 사용자 업로드 이미지 (런타임 생성)
├── voices/                      # 보이스 레퍼런스 (런타임 생성)
├── output/                      # 완성된 MP4
├── myaniform.db                 # SQLite (런타임 생성)
├── .civitai_token               # (gitignore)
├── .hf_token                    # (gitignore)
├── setup.sh                     # A. Linux/WSL2 설치
├── download_models.sh
├── check_models.sh
├── run.sh
├── setup.ps1                    # B. 네이티브 Windows 설치
├── download_models.ps1
├── check_models.ps1
└── run.ps1
```

---

## 11. 더 읽어볼 문서

- [overview.md](overview.md) — 아키텍처 & 사용자 흐름
- [workflows.md](workflows.md) — ComfyUI 워크플로우 상세
- [operations.md](operations.md) — 런타임 플래그, 메모리 튜닝, 장애 대응
- [models-and-nodes.md](models-and-nodes.md) — 모델 카탈로그
- [pipeline.md](pipeline.md) — 씬 타입별 처리 로직
