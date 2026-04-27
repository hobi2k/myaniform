# Operations

실행·로그·메모리 튜닝·장애 대응.

---

## 서비스 런처 (`run.sh`)

현재 플래그 (WSL2, RTX 5080 16GB 기준):

```bash
python ComfyUI/main.py --port 8188 \
    --normalvram --cache-none --disable-smart-memory \
    --reserve-vram 0.5
```

백엔드:
```bash
uvicorn backend.main:app --port 8000
```

### 플래그 히스토리 — 왜 이 조합인가

| 플래그 | 역할 | 히스토리 |
|---|---|---|
| `--normalvram` | 모델 VRAM 상주 허용 | `--lowvram` 는 step 당 11,000s (모델 블록별로 CPU→GPU 왕복). normalvram 으로 168s/step (65× 빠름) |
| `--cache-none` | 이전 프롬프트 캐시 해제 | 다음 워크플로우가 OOM 되는 것 방지 |
| `--disable-smart-memory` | Comfy 의 모델 재사용 로직 비활성 | 순차 실행(S2V→I2V HIGH→LOW→MMAudio)에서 이전 모델이 VRAM 에 남아 OOM |
| `--reserve-vram 0.5` | 예비 VRAM 확보 | PyTorch 할당자 여유 (CUDA OOM 방지) |

**주의**: `--normalvram` 단독 사용 시 이전 씬의 모델이 해제되지 않아 **peak 19.7GB** 로 OOM. `--cache-none --disable-smart-memory` 조합이 필수.

### 씬 간 /free 호출

`backend/services/comfyui_client.py` 의 `run_workflow()` 가 프롬프트 완료 직후 `POST /free { unload_models: true, free_memory: true }` 호출 → 다음 워크플로우 전에 VRAM·RAM 정리.

---

## I2V 2-stage 메모리 안전 설정 (16GB VRAM)

**2026-04-19**: I2V 2-stage 워크플로우가 scene 2 (loop) 에서 7차례 연속 OOM. 같은 GPU(16GB) 의 Windows 환경에서는 동일 모델이 돌아감을 확인 → 핵심 차이는 `WanVideoModelLoader` 의 **`load_device`** 와 **`base_precision`**.

| 시도 | 주요 조치 | 결과 | 소요 |
|---|---|---|---|
| gen #11 | 해상도 832×1216 × 85 frames | OOM (seq 86944, 28GiB 요청) | — |
| gen #12 | 480×832 × 85 frames, block_swap=30 | OOM (seq 34320) | — |
| gen #13 | 480×832 × 53 frames | OOM (seq 21840, activation) | — |
| gen #14 | ComfyUI fresh restart | OOM — 단편화 아님 확인 | — |
| gen #15 | `attention_mode: sageattn` 추가 | OOM (LOW 모델 로드 시 44GB 시도) | 31:39 |
| gen #16 | `blocks_to_swap: 40` (전체 오프로드) | OOM (HIGH 샘플러 step 0) | 22:44 |
| **gen #17** | **`load_device: offload_device` + `base_precision: fp16_fast` + `blocks_to_swap: 20`** | **✅ HIGH+LOW+MMAudio 완주** | **3:12** |

**근본 원인 2개**:
1. **`load_device: main_device`** 이면 `WanVideoModelLoader` 가 전체 14B 가중치를 GPU 로 로드 → 16GB 한참 초과. `offload_device` 로 바꿔야 기본 위치가 CPU 가 되고 forward 시 필요한 블록만 스트리밍됨.
2. **`base_precision: bf16`** 는 블록 활성화 메모리가 fp16 대비 약 2배 차지. `fp16_fast` 로 바꾸면 동일 품질에 VRAM 여유.

PyTorch SDPA O(n²) → `sageattn` O(n) 전환은 필요조건이지만 충분조건이 아니었음.

**최종 파라미터 (`workflows/originals/동영상 루프 워크플로우.json`, `workflows/originals/동영상 첫끝프레임 워크플로우.json` 공통 적용)**:

```json
WanVideoModelLoader:
  base_precision: "fp16_fast"       # ← bf16 에서 변경
  quantization:   "fp8_e4m3fn"
  load_device:    "offload_device"  # ← main_device 에서 변경 (핵심)
  attention_mode: "sageattn"

WanVideoBlockSwap:
  blocks_to_swap: 20                # 14B 모델은 총 40 블록 — 절반 스트리밍
  offload_img_emb: false
  offload_txt_emb: false
```

**검증 지표 (gen #17)**: Max allocated 13.155 GB / Max reserved 13.281 GB — 16GB 대비 여유 ~3GB. HIGH 샘플러 3 step 1분 4초, LOW 3 step 유사, MMAudio 1 분.

**setup.sh 부수 변경**:
1. `uv pip install sageattention` (PHASE 4)
2. `from sageattention import sageattn` 임포트 검증

**기타 주의**:
- sageattn 은 `sm_80+` GPU 에서만 동작 (RTX 30/40/50 OK, RTX 20 불가).
- 첫 호출 시 커널 컴파일로 ~30~50초 지연 (HIGH 샘플러 1 step 이 ~50s, 2 step 부터 16s).
- 레퍼런스: `ComfyUI-WanVideoWrapper/example_workflows/wanvideo_2_2_I2V_A14B_example_WIP.json` (이 프로젝트는 이 레시피를 그대로 따름).

---

## WSL2 설정

`C:\Users\<user>\.wslconfig`:

```ini
[wsl2]
memory=28GB
swap=64GB
processors=12
```

호스트 RAM 32GB 기준. 모델 로딩 피크에서 swap 필요 (WSL 자동 종료 방지).

---

## 로그·디버깅

| 파일 | 내용 |
|---|---|
| `logs/comfyui.log` | ComfyUI 노드 실행, KSampler 진행률(`\r` 로 덮어쓰기 — `tr '\r' '\n'` 로 변환해서 보기) |
| `logs/backend.log` | uvicorn stdout/stderr — SSE 스트림·예외 |
| `/tmp/myaniform-generate*.sse` | curl 로 SSE 를 따로 덤프할 때 사용 (gen #N 별) |

유용한 커맨드:

```bash
# KSampler 진행률 보기
tail -50 logs/comfyui.log | tr '\r' '\n' | tail -20

# 에러 라인만
grep -nE "Error|Exception|Traceback|OOM|CUDA error" logs/comfyui.log

# 서비스 재기동 (깔끔하게)
pkill -f "ComfyUI/main.py"; pkill -f "uvicorn backend.main:app"; sleep 3
bash run.sh

# VRAM 실시간 (별도 터미널)
watch -n 1 nvidia-smi --query-gpu=memory.used,memory.free,utilization.gpu --format=csv
```

---

## 알려진 장애와 대응

### 1. CUDA illegal memory access

**증상**: KSampler 첫 step 진입 직후 `torch.AcceleratorError: CUDA error: an illegal memory access was encountered`.

**원인**: 이전 장기 실행(60 분 S2V) 직후 즉시 2-stage I2V 큐잉 시 GPU 상태 잔류.

**해결**: ComfyUI 재시작. 백엔드는 그대로 두어도 무방.

```bash
pkill -f "ComfyUI/main.py"; sleep 3
source .venv/bin/activate
nohup python ComfyUI/main.py --port 8188 --normalvram --cache-none \
    --disable-smart-memory --reserve-vram 0.5 > logs/comfyui.log 2>&1 &
```

### 2. TTS 출력이 1초 무음

**증상**: `scene_voice_*.flac` 가 일관되게 **1.0s / ~9KB** — 실제 음성이 없음.

**원인**: 과거 FL_Qwen3TTS 워크플로우에서 `x_vector_only_mode=false` + `ref_text` 미제공 조합을 썼기 때문.
현재 런타임은 hobi2k `ComfyUI_Qwen3-TTS` 로 교체되어 FL_Qwen3TTS 노드를 사용하지 않는다.

**해결**: `Qwen3ClonePromptFromAudio(x_vector_only_mode=true)` 로 clone prompt를 만들고 `Qwen3CustomVoiceFromPrompt` 로 렌더링한다. x-vector 임베딩만으로 화자 클론 — ref_text 불필요.

검증: 생성된 `voice_*.flac` 가 **3~7초** 범위인지 ffprobe 로 확인.

```bash
ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 ComfyUI/output/myaniform/voice_*.flac
```

### 3. 2-stage I2V OOM

**증상**: `WanVideoSampler` HIGH stage 에서 `CUDA out of memory`.

**원인** (중요도 순):
1. `WanVideoModelLoader.load_device: "main_device"` — 전체 모델이 GPU 에 로드되어 14GB+ 소모.
2. `base_precision: "bf16"` — 활성화 메모리가 fp16 대비 더 큼.
3. `attention_mode: "sdpa"` — seq 21840 에서 O(n²) activation 초과.

**해결** (3개 동시 적용):
```json
"load_device":    "offload_device",
"base_precision": "fp16_fast",
"attention_mode": "sageattn",
"blocks_to_swap": 20
```

원본 I2V 워크플로우 패처에 반영됨. 신규 워크플로우 추가 시 동일 설정. 자세한 원인 분석은 상단 [I2V 2-stage 메모리 안전 설정](#i2v-2-stage-메모리-안전-설정-16gb-vram) 참고.

추가 최적화 (필요 시):
- `num_frames` 49 → 33 (씬 길이 짧아짐)
- 해상도는 480×832 로 고정 (Wan 2.2 학습 aspect ratio)

### 4. 씬 2 (loop) 재생성 실패 — 디스크/메모리 잔류

**증상**: 직전 장기 생성 완료 직후 regenerate/video 호출 시 CUDA error.

**대응**: ComfyUI 재시작 후 재시도. 재시도 전 `nvidia-smi` 로 VRAM 상태 확인.

### 5. 모델 다운로드 실패

**증상**: `download_models.sh` 끝에 `⚠ 실패한 다운로드 N 개` 출력.

**대응**: 네트워크 복구 후 같은 명령 재실행. `curl -C -` 로 이어받기.

```bash
bash download_models.sh              # 실패분만 재시도 됨
bash check_models.sh                 # 최종 확인
```

---

## 성능 체크리스트

| 씬 타입 | 1회 소요 | 주 부하 |
|---|---|---|
| lipsync (S2V 20 step) | ~50~60 분 | KSampler (168s/step × 20) |
| loop (2-stage I2V, 6+6 step, sageattn) | ~15~20 분 | KSampler HIGH/LOW + RIFE ×2 |
| effect (2-stage I2V, 6+6 step, sageattn) | ~10~15 분 | length=49 로 loop 보다 짧음 |
| image (Qwen Edit) | ~1~2 분 | 20 step |
| voice (Qwen3-TTS) | ~10~30초 | 텍스트 길이 비례 |

5-씬 프로젝트 전체 ≈ 2~3 시간.

---

## 사용자 파라미터 튜닝 가이드 (Phase 3/5)

씬 에디터의 **"고급 파라미터"** 섹션에서 워크플로우별 샘플링 파라미터를 덮어쓸 수 있음. 각 필드는 `scene.image_params` / `scene.video_params` JSON 으로 DB 에 저장되고, `workflow_patcher._apply_image_params()` / `_apply_video_params()` 가 런타임에 주입.

### 이미지 파라미터 (`image_params`)

| 필드 | 기본값 (SDXL) | 기본값 (Qwen Edit) | 용도 |
|---|---|---|---|
| `steps` | 30 | 20 | 샘플링 단계. 줄이면 빠름/품질↓ |
| `cfg` | 5.0 | 4.5 | CFG Scale. Illustrious 는 4~6 권장 |
| `sampler` | `euler_ancestral` | `euler` | `dpmpp_2m`, `uni_pc` 등 교체 가능 |
| `scheduler` | `sgm_uniform` | `sgm_uniform` | `karras`, `beta`, `simple` |
| `seed` | `0` (+ randomize) | 동일 | 캐릭터 일관성 잠금 시 고정 |
| `denoise` | 1.0 | 1.0 | img2img 강도 (Qwen Edit 에서는 내부 고정) |
| `loras[]` | `[]` | `[]` | `{name, strength}` 배열. SDXL 은 최대 3개 슬롯 (LoraLoader 2/3/4) |
| `face_detailer` | `true` | — | SDXL 전용. false 면 FaceDetailer 체인 제거 |
| `hand_detailer` | `true` | — | SDXL 전용. false 면 Hand 만 제거 (Face 는 유지) |

해상도: `scene.resolution_w` / `scene.resolution_h` 가 EmptyLatentImage 의 width/height 를 덮어씀. SDXL 은 832×1216 (세로) / 1216×832 (가로), Qwen Edit 는 레퍼런스 비율 유지 권장.

### 비디오 파라미터 (`video_params`)

| 필드 | 기본값 (2-stage I2V) | 기본값 (S2V) | 용도 |
|---|---|---|---|
| `steps` | 6 (HIGH+LOW 각각) | 4 | S2V FastFidelity 기본 |
| `cfg` | 1.0 | 8.0 | 2-stage I2V 는 1.0, S2V FastFidelity 는 8.0 |
| `sampler` | `euler` | `euler` | 거의 고정 |
| `scheduler` | — | `simple` | 2-stage 는 shift 기반이라 scheduler 무의미 |
| `shift` | 8.0 | 5.0 | ModelSamplingSD3 shift |
| `frames` | 49 | 81 | 프레임 길이 (높이면 OOM 위험) |
| `fps` | 32 | 16 | VHS_VideoCombine frame_rate |
| `s2v_refiner_start_step` | — | 2 | S2V high/refiner split |
| `s2v_audio_duration` | — | 5.0 | TTS audio crop duration |

**주의**: `frames` 를 480×832 기준 49→85 로 올리면 16GB VRAM 에서 OOM 발생. 해상도·프레임·block_swap 은 서로 연동. 기본값이 검증된 안전 구간.

---

## FastFidelity S2V 참고

`DaSiWa WAN 2.2 i2v FastFidelity C-AiO-65.json` / `C-SVI-29.json` 는 그대로 실행하지 않는다. 해당 파일은 I2V, FLF2V, S2V, Audio, Combine 기능이 섞인 올인원 레퍼런스이므로, 앱에는 **실제 S2V에 필요한 구조만** 추출해서 포팅해야 한다.

S2V 포팅 시 참고할 구조:

- S2V 모델은 I2V HIGH/LOW가 아니라 `DasiwaWan2214BS2V_littledemonV2.safetensors` 계열을 사용한다.
- 오디오 입력은 S2V용 audio encoder/whisper 계열로 인코딩하고, I2V/FLF2V first-last-frame branch는 쓰지 않는다.
- 샘플링은 S2V용 `WanVideoSampler`/S2V embed 구조에만 적용한다.
- MMAudio/Foley/Combine/Post-processing 블록은 선택 기능으로만 붙이고, 립싱크 S2V 코어와 섞어서 기본값으로 실행하지 않는다.

샘플링 레시피:

| 파라미터 | FastFidelity S2V |
|---|---|
| steps | **4** |
| cfg | **8.0** |
| sampler | **euler** |
| ModelSamplingSD3 shift | **5** |
| I2V HIGH/LOW split | 쓰지 않음 |
| 추가 노드 | 원본 S2V branch + ModelSamplingSD3 shift=5 + app-injected MMAudio mixer |
| 모델 (S2V) | `DasiwaWan2214BS2V_littledemonV2.safetensors` (18.5GB) |

**제한**: 4step+cfg8 은 distilled S2V 모델 전용. 앱 기본 경로는 `littledemonV2.safetensors` 를 `ComfyUI/models/diffusion_models/wan_s2v/` 에 요구한다.

Windows 경로: `D:\Stable Diffusion\StabilityMatrix-win-x64\Data\Packages\ComfyUI\models\diffusion_models\wan_s2v\DasiwaWan2214BS2V_littledemonV2.safetensors`.

---

## 데이터베이스

SQLite: `myaniform.db`. 스키마는 `backend/models.py` 참고.

주요 테이블:
- `project` — title, episode, status, output_path
- `character` — name, description, image_path, voice_sample_path, tts_engine
- `scene` — order, type, dialogue, bg_prompt, sfx_prompt, effect_prompt, voice_path, image_path, clip_path, clip_stale, loras_json, diffusion_model

### 강제 재생성 (이미지는 유지, 음성+영상만)

```sql
UPDATE scene SET voice_path=NULL, clip_path=NULL WHERE project_id='<id>';
-- clip_stale=0 유지 → image 단계 스킵됨
```

### 전체 재생성

```sql
UPDATE scene SET voice_path=NULL, clip_path=NULL, image_path=NULL, clip_stale=1 WHERE project_id='<id>';
```

그 후 `POST /api/projects/<id>/generate` 호출.

---

## 설치·재구축 가이드

**처음 클론하는 경우**: [docs/install.md](install.md) 를 순서대로 따라간다. 모든 스크립트는 idempotent — 중단되면 같은 명령 재실행.
