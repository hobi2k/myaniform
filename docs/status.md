# myaniform 현재 상태

> 최종 업데이트: 2026-04-26

## 플랫폼 개요

히어하트 스타일의 멀티샷 웹툰풍 애니메이션 영상 제작 플랫폼.
1~2명의 캐릭터가 일관되게 등장하는 다양한 장면(클로즈업, 미디엄, 풀샷)을
음성 + SFX + 장면 전환으로 연결하여 하나의 영상으로 합성.

## 품질 기준

최종 목표는 빠른 데모가 아니라 사용자가 지정한 장면 연출을 유지하는 고품질 영상 제작이다.

- **캐릭터 일관성**: 캐릭터 스프라이트를 먼저 만들고, 장면 이미지는 Qwen Image Edit을 캐릭터 일관성 레퍼런스로만 사용한다.
- **사용자 연출 제어**: 의상, 포즈, 구도, 카메라, 표정, 조명, 스타일은 사용자가 입력한 프롬프트만 반영한다. 비어 있는 값은 강제하지 않는다.
- **원본 워크플로우 우선**: `D:\Stable Diffusion\StabilityMatrix-win-x64\Data\Packages\ComfyUI\user\default\workflows` 의 원본 워크플로우를 기준으로 자동화한다. 간이/축약/열화 워크플로우를 런타임 기본 경로로 쓰지 않는다.
- **오디오 품질**: TTS와 MMAudio SFX를 모두 장면 단위로 제어하고, 최종 편집에서 음성/SFX/BGM 레이어를 분리 가능한 구조로 유지한다.
- **장면 연속성**: 각 씬은 새 장면샷으로 시작하거나 이전 씬 라스트프레임을 이어받을 수 있어야 한다. 화면 속 발화는 S2V를 사용하고, 비발화/인서트/전환 컷의 대사는 voiceover 트랙으로 MMAudio와 믹스한다.
- **편집 가능성**: 생성 클립을 보존한 상태에서 전환, 자막, 타이틀, 사운드 레이어를 후편집 메타데이터로 쌓는다.
- **유지보수성**: 품질 정책은 문서와 테스트로 고정한다. 속도를 위해 모델/노드/업스케일/디테일러를 몰래 생략하지 않는다.

- **프론트**: React + Vite (`localhost:5173`) — Pretendard + Tailwind 다크 테마
- **백엔드**: FastAPI (`localhost:8000`) — SQLite + SSE 스트리밍
- **ComfyUI**: 워크플로우 실행 (`localhost:8188`) — embedded

---

## 최근 이벤트 로그

### 2026-04-26

- **캐릭터 스프라이트 흐름 정리** — 신규 생성은 `VN_Step1_QWEN_CharSheetGenerator_v1.json`, 참조 이미지 기반 복제는 `VN_Step1.1_QWEN_Clone_Existing_Character_v1.json` 로 명시 분리. 프론트 버튼도 `처음부터 스프라이트 생성` / `참조 이미지로 스프라이트 생성` 으로 분리.
- **장면샷 생성 정책 정리** — 씬 이미지는 업로드가 아니라 선택 캐릭터 스프라이트 + 장면샷 프롬프트 + Qwen Image Edit 경로로 생성. Qwen Edit은 캐릭터 일관성만 담당하고, 의상/포즈/구도/카메라/표정/조명/스타일은 사용자가 입력한 값만 프롬프트에 합친다.
- **장면 프롬프트 회귀 테스트 추가** — `tests/test_scene_policy.py` 로 빈 옵션일 때 의상/포즈를 강제하지 않는지, 사용자 입력 필드만 positive prompt에 들어가는지 검증.
- **기본 I2V 워크플로우 편입** — `동영상 기본 워크플로우.app.json`을 원본 워크플로우 카탈로그에 추가. 씬 타입은 `basic`/`loop`/`effect`/`lipsync`로 분리하고, 모든 영상 프롬프트에 입력 장면샷 기반 identity lock을 주입해 스프라이트 기반 캐릭터가 영상 단계에서 다른 인물로 바뀌는 문제를 억제.
- **프론트 API 명명 정리** — 캐릭터 이미지 업로드 API 호출명을 `uploadReferenceImage` 로 바꿔 Step1.1 참조 이미지 용도임을 명확히 함. 씬 이미지 업로드 API는 프론트 노출 제거.

### 2026-04-21

- **모델 저장소 Windows D: 드라이브로 이전 + 심볼릭 링크** — `ComfyUI/models/*` 전체 236 GB 를 `rsync --remove-source-files` 로 `/mnt/d/myaniform/models` 로 이동 (DrvFs 쓰루풋 제한 탓에 약 2시간 소요). 이후 `ComfyUI/models -> /mnt/d/myaniform/models` 심볼릭 링크 생성. 기존 상대 경로가 투명하게 동작하도록 유지. 이동 후 `myaniform/ComfyUI` 디렉토리는 669 MB (코드 + 커스텀 노드만) 로 축소.
- **⚠️ WSL2 `ext4.vhdx` 컴팩션 아직 미완** — WSL 내부 `df` 상에서는 714 GB 여유 (정상) 이지만 Windows 호스트 측 `ext4.vhdx` 는 **여전히 539 GB 차지** (WSL2 는 자동 shrink 안 함). 다음 Codex/Claude 세션 또는 사용자가 직접 아래 수동 절차 실행 필요:
  1. **모든** WSL 세션 종료 (Claude Code/VSCode WSL 포함)
  2. 관리자 PowerShell 에서 `wsl --shutdown` 후 10초 대기
  3. `diskpart` 실행 → `select vdisk file="C:\Users\Hosung\AppData\Local\Packages\CanonicalGroupLimited.Ubuntu24.04LTS_79rhkp1fndgsc\LocalState\ext4.vhdx"` → `attach vdisk readonly` → `compact vdisk` → `detach vdisk` → `exit`
  4. 예상 결과: 539 GB → ~270 GB (약 236 GB 반환)
- **SetupBanner 제거** — `frontend/src/components/ui/SetupBanner.tsx` 삭제 + `Layout.tsx` 에서 import/JSX 삭제. 사유: 모델 체크가 폴스 포지티브를 너무 자주 띄움.
- **LoRA 자유 입력 지원** — `SceneEditor.tsx` 의 `LoraPicker` 에 텍스트 입력 + Plus 버튼 추가. 기존 드롭다운 목록에 없는 LoRA 파일명도 사용자가 직접 입력 가능 (Enter 키로도 추가). 커스텀/신규 LoRA 추가 시 매번 백엔드 재시작 필요 없음.
- **서비스 상태 (migrations 적용 후 재시작)**: ComfyUI PID 707955, backend PID 709522 (uvicorn), Vite PID 356989 — 모두 `200 OK`.

### 2026-04-20

- **Phase 1 — 원본 이미지 워크플로우 기반 장면샷** — `workflows/originals/이미지 워크플로우.json`을 기준으로 Qwen Image Edit 2511 branch를 주입. SDXL/업스케일/Detailer 원본 품질 경로는 유지하고, 캐릭터 일관성만 Qwen Edit 레퍼런스로 보강한다.
- **Phase 2 — N-캐릭터 지원** — DB 에 `scene.character_ids_json` 추가. Qwen Edit Plus 의 `image1/image2/…/imageN` 입력에 LoadImage 노드를 런타임 추가. 프롬프트 앵커링: `"Picture 1 shows A. Picture 2 shows B. Both/All N characters appear together in the same scene."` 프론트 `<CharacterMultiPicker>` 로 N명 선택.
- **Phase 3 — 사용자 조절 가능 파라미터** — `scene.image_params` JSON 추가. 씬 에디터 "고급 파라미터" 섹션(접기) 에 `<ImageParamsEditor>` (steps/cfg/sampler/scheduler/seed/denoise/face_detailer/hand_detailer) + 해상도 + LoRA 3슬롯 + 워크플로우 선택 (qwen_edit/sdxl/vnccs_sheet). `_apply_image_params()` 가 KSampler/EmptyLatent/LoraLoader 슬롯에 주입.
- **Phase 4 — VNCCS 캐릭터 스프라이트 파이프라인** — `character.sheet_path` / `character.sprite_path` 컬럼 추가. 이후 정책 변경으로 런타임 기본 경로는 원본 `VN_Step1_QWEN_CharSheetGenerator_v1.json` / `VN_Step1.1_QWEN_Clone_Existing_Character_v1.json` 만 허용. 참조 이미지 업로드는 Step1.1 입력 전용이며, 씬 이미지는 생성된 `sprite_path` 를 레퍼런스로 사용.
- **Phase 5 — 비디오 파이프라인 파라미터 UI** — `scene.video_params` JSON 추가. `<VideoParamsEditor>` (steps/cfg/sampler/shift/frames/fps). `_apply_video_params()` 가 `WanVideoSampler` / `KSampler*` / `VHS_VideoCombine` 에 주입. 기본값은 검증된 안전 구간 (HIGH+LOW 6+6 step, cfg=1, shift=8, frames=49, fps=32).
- **문서 갱신** — `workflows.md`, `pipeline.md`, `operations.md`, `models-and-nodes.md`, `install.md`, `status.md` Phase 1~5 반영.

### 2026-04-19

- **I2V 2-stage 16GB OOM 최종 해결 (gen #17 3분 12초 완주)** — gen #11~#16 은 `load_device: main_device` + `base_precision: bf16` 탓에 전체 14B 가중치가 GPU 에 상주하려다 반복 OOM (22~31분 허비 후 죽음). `ComfyUI-WanVideoWrapper/example_workflows/wanvideo_2_2_I2V_A14B_example_WIP.json` 레퍼런스와 diff 를 뜨니 우리 설정만 `main_device` / `bf16` 이었음. `load_device: offload_device` + `base_precision: fp16_fast` + `blocks_to_swap: 20` + `attention_mode: sageattn` 4-셋으로 교정하니 Max allocated 13.155 GB 로 안정. 자세한 gen 기록은 [operations.md#i2v-2-stage-메모리-안전-설정-16gb-vram](operations.md#i2v-2-stage-메모리-안전-설정-16gb-vram).
- **setup.sh uv 기반 재작성** — 기존 pip 호출을 `uv pip install` 로, venv 도 `uv venv --python 3.11` 로 관리. sageattention 설치 step 편입.
- **docs/install.md 신규** — 빈 리눅스 머신에서 git clone 만으로 끝까지 재현 가능한 설정 가이드.

### 2026-04-18

- **원본 루프 I2V 2-stage HIGH+LOW 자동화** — `workflows/originals/동영상 루프 워크플로우.json` 기준. `Dasiwa Lightspeed Synthseduction High/Low V9` 병용. shift=8, 6+6 step, euler_ancestral, latent 릴레이(HIGH end=10000→LOW start=3).
- **원본 첫끝프레임 I2V 자동화** — `workflows/originals/동영상 첫끝프레임 워크플로우.json` 기준. Start/End LoadImage 분리, 480×832, length=49.
- **workflow_patcher.py `_patch_2stage_video()` 공통화** — UNETLoader 10/20, Power Lora 12/22 자동 주입.
- **TTS 1초 무음 버그 수정** — 런타임을 hobi2k `ComfyUI_Qwen3-TTS` 로 교체. `Qwen3ClonePromptFromAudio(x_vector_only_mode=true)` → `Qwen3CustomVoiceFromPrompt` 구조로 ref_text 없이 clone prompt 기반 렌더링.
- **SFX 프롬프트 구체화** — "ambient / warm" 류 제네릭 → 씬별 구체적 acoustic 이벤트 (cherry blossom wind, sparrow chirp, wind chimes 등).
- **Gen #9 실행 중** — 첫눈에 반한 봄 프로젝트 TTS 재생 + 2-stage 루프 적용 전면 재생성.

### 2026-04-17 이전

- E2E 파이프라인 가동, 첫 완성본 `output/5e6d4b5d-…mp4` (4씬, 18.2초).
- 메모리 튜닝: `--lowvram` → `--normalvram --cache-none --disable-smart-memory --reserve-vram 0.5` (65× 빠름).

---

## 현재 동작 범위

| 기능 | 상태 | 비고 |
|---|---|---|
| 프로젝트 CRUD | ✅ | 썸네일 자동 호버 재생 |
| 캐릭터 관리 (스프라이트/키비주얼/보이스) | ✅ | 신규 Step1 스프라이트 + 참조 이미지 기반 Step1.1 스프라이트 + VoiceDesign |
| 캐릭터 스프라이트 (VNCCS) | ✅ | 원본 Step1/Step1.1 자동화. 참조 이미지 업로드는 Step1.1 입력 전용 |
| 씬 편집 (lipsync/basic/loop/effect) | ✅ | 타입별 UI 분기, 준비도 배지 |
| **N-캐릭터 씬** | ✅ | `CharacterMultiPicker`, `image1..imageN` 레퍼런스 |
| **고급 파라미터 (이미지)** | ✅ | steps/cfg/sampler/scheduler/LoRA 3슬롯/FaceDetailer 토글 |
| **고급 파라미터 (비디오)** | ✅ | steps/cfg/sampler/shift/frames/fps |
| 장면샷 이미지 생성 | ✅ | Qwen Edit + 캐릭터 스프라이트 레퍼런스. 업로드 UI 없음 |
| 장면샷 연출 파라미터 | ✅ | 의상/포즈/구도/카메라/표정/조명/스타일/네거티브를 사용자 입력으로 제어 |
| 디퓨전 모델 선택 (per-scene) | ✅ | S2V/I2V 모델 목록 |
| LoRA 선택 (per-scene) | ✅ | loop/effect 양 스테이지 주입 |
| TTS 음성 생성 | ✅ | Qwen3 x-vector / Fish S2 Pro / VoiceDesign |
| Qwen Image Edit 2511 키프레임 | ✅ | N-캐릭터 스프라이트 기반 일관성 |
| SDXL 고품질 키프레임 | ✅ | Illustrious + 30step + Face/Hand Detailer |
| S2V 립싱크 영상 | ✅ | ~50~60분/씬 |
| I2V 기본 영상 (2-stage) | ✅ | 원본 `동영상 기본 워크플로우.app.json` 기반 |
| I2V 루프 영상 (2-stage) | ✅ | ~15~20분/씬 |
| I2V 이펙트 영상 (2-stage) | ✅ | ~10~15분/씬 |
| 전체 파이프라인 (SSE) | ✅ | voice→image→video→concat |
| ffmpeg 장면 연결 (xfade) | ✅ | fade 트랜지션 |
| 생성 페이지 (진행률+ETA+로그) | ✅ | 실시간 씬별 스테이지 표시 |
| ComfyUI 메모리 해제 | ✅ | 씬 간 `/free` 호출 |

---

## 디퓨전 모델 세트

| 카테고리 | 파일명 | 크기 | 기본값 |
|---|---|---|---|
| **I2V HIGH** | `wan_i2v_high/DasiwaWAN22I2V14BLightspeed_synthseductionHighV9.safetensors` | 14.5 GB | ✅ |
| **I2V LOW** | `wan_i2v_low/DasiwaWAN22I2V14BLightspeed_synthseductionLowV9.safetensors` | 14.5 GB | ✅ |
| I2V HIGH (보조) | `smoothMixWan2214BI2V_i2vHigh.safetensors` | 14.6 GB | 선택 |
| I2V LOW (보조) | `smoothMixWan2214BI2V_i2vLow.safetensors` | 21.3 GB | 선택 |
| **S2V FastFidelity** | `wan_s2v/DasiwaWan2214BS2V_littledemonV2.safetensors` | 15+ GB | 기본 |
| T5 Encoder | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 6.7 GB | ✅ |
| WAN VAE | `Wan2_1_VAE_bf16.safetensors` | — | ✅ |
| Audio Encoder | `wav2vec2_large_english_fp32.safetensors` | — | ✅ |

자동 다운로드: `setup.sh` / `download_models.sh`. FastFidelity S2V는 Civitai token 필요.

---

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `run.sh` | 서비스 런처 (ComfyUI + FastAPI) |
| `setup.sh` | 의존성 + 모델 자동 다운로드 |
| `backend/main.py` | FastAPI 앱 + 정적 마운트 |
| `backend/models.py` | SQLModel 스키마 (Project, Character, Scene) |
| `backend/routers/scenes.py` | 씬 CRUD + 스프라이트 기반 장면샷 생성 + 단계별 재생성 |
| `backend/routers/generation.py` | 전체 파이프라인 SSE 스트리밍 |
| `backend/routers/setup.py` | 모델 체크 + LoRA/디퓨전 모델 목록 |
| `backend/services/workflow_patcher.py` | ComfyUI JSON 동적 패칭 (+ 2-stage 공통 헬퍼) |
| `backend/services/comfyui_client.py` | ComfyUI HTTP + 메모리 해제 |
| `backend/services/ffmpeg_utils.py` | xfade 장면 연결 |
| `workflows/*.json` | ComfyUI 워크플로우 (`docs/workflows.md` 참고) |
| `frontend/src/pages/GenerationPage.tsx` | 생성 진행률 UI (ETA/stage/로그) |
| `frontend/src/pages/ProjectListPage.tsx` | 프로젝트 목록 (호버 썸네일) |
| `frontend/src/components/scene/SceneEditor.tsx` | 씬 편집 (N-캐릭터 + 이미지/비디오 파라미터 + 워크플로우 선택) |
| `frontend/src/components/character/CharacterPanel.tsx` | 캐릭터 편집 (이미지·보이스·VNCCS 시트·스프라이트) |

---

## 알려진 한계

- **생성 시간**: 품질 우선 경로는 시간이 오래 걸릴 수 있다. 모델/노드/디테일러를 생략하지 않고, 필요한 경우 진행률과 로그를 개선한다.
- **캐릭터 일관성**: Qwen Image Edit 2511 로 개선됐으나, 각도 변화가 큰 장면에서 얼굴이 미세하게 변함. IPAdapter FaceID 도입 검토.
- **MMAudio SFX 품질**: 짧은 duration(2~5s) + 제네릭 프롬프트 시 잡음처럼 들림. 씬별로 구체적 acoustic event 을 프롬프트에 명시 필요.
- **CUDA illegal memory access**: 장기 실행 직후 즉시 다음 생성 시도 시 간헐적 발생. ComfyUI 재시작으로 해결.

---

## 남은 작업

### 단기
1. FastFidelity S2V 실생성 검증 — 모델/노드 설치 및 런타임 workflow 변환 검증 완료. 다음은 ComfyUI 실행 상태에서 1씬 end-to-end 렌더 검증.
2. 캐릭터 일관성 강화 (IPAdapter FaceID — 같은 캐릭터가 다른 구도에서도 일관)
3. BGM 레이어 추가 (전체 영상에 배경음악 믹싱)
4. ComfyUI `/ws` 진행률을 백엔드 → 프런트까지 step 단위로 중계

### 중기
5. WebUI 에 ComfyUI 워크플로우 뷰어 페이지 (사용자 편집 지원)
6. 자막 오버레이 (선택적)
7. 에피소드 프리셋/템플릿
8. 프로젝트 export/import

---

## Codex 핸드오프 메모 (2026-04-21 기준)

**진행 중인 단일 작업**: FastFidelity S2V는 `workflows/originals/Wan2.2-S2V_ Audio-Driven Video Generation.json` 원본 branch 기반으로 포팅됨.

**모델 경로 계약**:
- 모든 워크플로우 JSON 은 `models/<subdir>/<filename>` 상대 경로 가정 → `ComfyUI/models` 심볼릭 링크가 이를 `/mnt/d/myaniform/models` 로 투명하게 매핑.
- 신규 모델 추가 시 `/mnt/d/myaniform/models/<subdir>/` 에 직접 배치 (WSL 내부 `ComfyUI/models/<subdir>` 경로로 쓰면 자동으로 D: 에 들어감).
- `setup.sh` / `setup.ps1` 및 `download_models.*`는 FastFidelity S2V 모델, fp16 wav2vec, Wan VAE, MMAudio, UniversalToolkit, audio-separation 노드를 자동 준비한다.

**다음 우선 작업 후보**:
1. ComfyUI 실행 상태에서 FastFidelity S2V 1씬 end-to-end 렌더 검증.
2. 원본 첫끝프레임 I2V end-to-end 검증.
3. Remotion 기반 고급 편집 레이어 설계/구현.

**건드리면 안 되는 것**:
- `ComfyUI/models` 심볼릭 링크 — 실수로 `rm -rf` 하면 target 도 따라감. 풀 때는 `unlink ComfyUI/models` 만.
- `workflow_patcher.py` 의 `_apply_image_params` / `_apply_video_params` — Phase 2~5 UI 가 이 함수들에 묶여 있음. 시그니처 바꾸면 프론트 파라미터 주입 전부 깨짐.
- `ws_tts_clone.json` 의 `x_vector_only_mode=true` — false 로 돌리면 TTS 가 1초 무음으로 돌아감 (known bug, memory 기록).

**서비스 재기동 레시피**:
```bash
cd /home/hosung/pytorch-demo/myaniform && source .venv/bin/activate
# ComfyUI (16GB VRAM 안전 조합)
nohup python ComfyUI/main.py --port 8188 --normalvram --cache-none --disable-smart-memory --reserve-vram 0.5 > logs/comfyui.log 2>&1 &
# Backend
nohup python -m uvicorn backend.main:app --port 8000 --host 127.0.0.1 > logs/backend.log 2>&1 &
# Frontend (이미 돌고 있으면 생략)
cd frontend && nohup npm run dev > ../logs/frontend.log 2>&1 &
```

**헬스 체크**:
```bash
curl -s -o /dev/null -w "ComfyUI=%{http_code}\n" http://127.0.0.1:8188/system_stats
curl -s -o /dev/null -w "backend=%{http_code}\n"  http://127.0.0.1:8000/api/projects
curl -s -o /dev/null -w "vite=%{http_code}\n"     http://127.0.0.1:5173/
```

세 줄 다 `200` 이면 정상.
