# myaniform 현재 상태

> 최종 업데이트: 2026-04-20

## 플랫폼 개요

히어하트 스타일의 멀티샷 웹툰풍 애니메이션 영상 제작 플랫폼.
1~2명의 캐릭터가 일관되게 등장하는 다양한 장면(클로즈업, 미디엄, 풀샷)을
음성 + SFX + 장면 전환으로 연결하여 하나의 영상으로 합성.

- **프론트**: React + Vite (`localhost:5173`) — Pretendard + Tailwind 다크 테마
- **백엔드**: FastAPI (`localhost:8000`) — SQLite + SSE 스트리밍
- **ComfyUI**: 워크플로우 실행 (`localhost:8188`) — embedded

---

## 최근 이벤트 로그

### 2026-04-20

- **Phase 1 — SDXL 고품질 이미지 워크플로우 (`ws_image_sdxl.json`)** — 사용자 레퍼런스 `이미지 워크플로우.json` 1:1 포팅. waiIllustriousSDXL_v160 + LoRA 3슬롯 + 30-step euler_ancestral + SAM vit_b 기반 FaceDetailer(face) + HandDetailer(hand) 체인. 기존 Qwen Lightning 4-step 폴백을 대체하는 새 기본 캐릭터 생성 경로. 필수 커스텀 노드 `ComfyUI-Impact-Pack` + `ComfyUI-Impact-Subpack` 벤더링 완료.
- **Phase 2 — N-캐릭터 지원** — DB 에 `scene.character_ids_json` 추가 (기존 `character_id`/`character_b_id` 는 하위 호환 유지). `workflow_patcher._inject_multi_loadimages()` 가 Qwen Edit Plus 의 `image1/image2/…/imageN` 입력에 LoadImage 노드를 런타임 추가. 프롬프트 앵커링: `"Picture 1 shows A. Picture 2 shows B. Both/All N characters appear together in the same scene."` 프론트 `<CharacterMultiPicker>` 로 A/B 드롭다운 치환.
- **Phase 3 — 사용자 조절 가능 파라미터** — `scene.image_params` JSON 추가. 씬 에디터 "고급 파라미터" 섹션(접기) 에 `<ImageParamsEditor>` (steps/cfg/sampler/scheduler/seed/denoise/face_detailer/hand_detailer) + 해상도 + LoRA 3슬롯 + 워크플로우 선택 (qwen_edit/sdxl/vnccs_sheet). `_apply_image_params()` 가 KSampler/EmptyLatent/LoraLoader 슬롯에 주입.
- **Phase 4 — VNCCS 캐릭터 스프라이트 파이프라인** — `character.sheet_path` / `character.sprite_path` 컬럼 추가. 캐릭터 패널에 VNCCS 섹션(시트/스프라이트 썸네일 + AI 생성 + 업로드). 백엔드 `POST /characters/{id}/sheet/generate|upload`, `POST /characters/{id}/sprite/upload` 엔드포인트. 간이 `ws_character_sheet.json` (SDXL + vn_character_sheet_v4 LoRA) + ComfyUI 뷰어용 `vnccs_step1_sheet_ui.json`, `vnccs_step1_1_clone_ui.json`, `vnccs_step4_sprite_ui.json` 배치. 커스텀 노드 `vnccs` + `vnccs-utils` 벤더링. 씬 이미지 생성 시 레퍼런스 우선순위: **sprite > sheet > image**.
- **Phase 5 — 비디오 파이프라인 파라미터 UI** — `scene.video_params` JSON 추가. `<VideoParamsEditor>` (steps/cfg/sampler/shift/frames/fps). `_apply_video_params()` 가 `WanVideoSampler` / `KSampler*` / `VHS_VideoCombine` 에 주입. 기본값은 검증된 안전 구간 (HIGH+LOW 6+6 step, cfg=1, shift=8, frames=49, fps=32).
- **문서 갱신** — `workflows.md`, `pipeline.md`, `operations.md`, `models-and-nodes.md`, `install.md`, `status.md` Phase 1~5 반영.

### 2026-04-19

- **I2V 2-stage 16GB OOM 최종 해결 (gen #17 3분 12초 완주)** — gen #11~#16 은 `load_device: main_device` + `base_precision: bf16` 탓에 전체 14B 가중치가 GPU 에 상주하려다 반복 OOM (22~31분 허비 후 죽음). `ComfyUI-WanVideoWrapper/example_workflows/wanvideo_2_2_I2V_A14B_example_WIP.json` 레퍼런스와 diff 를 뜨니 우리 설정만 `main_device` / `bf16` 이었음. `load_device: offload_device` + `base_precision: fp16_fast` + `blocks_to_swap: 20` + `attention_mode: sageattn` 4-셋으로 교정하니 Max allocated 13.155 GB 로 안정. 자세한 gen 기록은 [operations.md#i2v-2-stage-메모리-안전-설정-16gb-vram](operations.md#i2v-2-stage-메모리-안전-설정-16gb-vram).
- **setup.sh uv 기반 재작성** — 기존 pip 호출을 `uv pip install` 로, venv 도 `uv venv --python 3.11` 로 관리. sageattention 설치 step 편입.
- **docs/install.md 신규** — 빈 리눅스 머신에서 git clone 만으로 끝까지 재현 가능한 설정 가이드.

### 2026-04-18

- **ws_loop.json 2-stage HIGH+LOW 포팅** — 레퍼런스 `동영상 루프 워크플로우.json` 1:1 이식. `Dasiwa Lightspeed Synthseduction High/Low V9` 병용. shift=8, 6+6 step, euler_ancestral, latent 릴레이(HIGH end=10000→LOW start=3).
- **ws_effect.json 2-stage 포팅** — Start/End LoadImage 분리, 480×832, length=49.
- **workflow_patcher.py `_patch_2stage_video()` 공통화** — UNETLoader 10/20, Power Lora 12/22 자동 주입.
- **TTS 1초 무음 버그 수정** — `ws_tts_clone.json` `x_vector_only_mode=true`. 사유: `FL_Qwen3TTS_VoiceClone` 가 ICL 모드에서 `ref_text` 없으면 예외를 잡아 `empty_audio(24000)` 1초 silence 반환. 자세히는 [operations.md#tts-출력이-1초-무음](operations.md#2-tts-출력이-1초-무음).
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
| 캐릭터 관리 (이미지/보이스) | ✅ | 업로드 + SDXL 생성 + VoiceDesign |
| 캐릭터 시트·스프라이트 (VNCCS) | ✅ | AI 시트 생성 + 수동 업로드, `/workflows?workflow=vnccs_step1_sheet_ui` 링크 |
| 씬 편집 (lipsync/loop/effect) | ✅ | 타입별 UI 분기, 준비도 배지 |
| **N-캐릭터 씬** | ✅ | `CharacterMultiPicker`, `image1..imageN` 레퍼런스 |
| **고급 파라미터 (이미지)** | ✅ | steps/cfg/sampler/scheduler/LoRA 3슬롯/FaceDetailer 토글 |
| **고급 파라미터 (비디오)** | ✅ | steps/cfg/sampler/shift/frames/fps |
| 워크플로우 선택 (per-scene) | ✅ | qwen_edit / sdxl / vnccs_sheet |
| 씬별 이미지 업로드 | ✅ | 외부 웹툰 패널 직접 사용 가능 |
| 디퓨전 모델 선택 (per-scene) | ✅ | S2V/I2V 모델 목록 |
| LoRA 선택 (per-scene) | ✅ | loop/effect 양 스테이지 주입 |
| TTS 음성 생성 | ✅ | Qwen3 x-vector / Fish S2 Pro / VoiceDesign |
| Qwen Image Edit 2511 키프레임 | ✅ | N-캐릭터 일관성 (sprite > sheet > image) |
| SDXL 고품질 키프레임 | ✅ | Illustrious + 30step + Face/Hand Detailer |
| S2V 립싱크 영상 | ✅ | ~50~60분/씬 |
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
| **S2V** | `wan_s2v/Wan2.2-S2V-14B-Q4_K_M.gguf` | 13.9 GB | ✅ |
| S2V (FastFidelity 후보) | `DasiwaWan2214BS2V_littledemonV2.safetensors` | 18.5 GB | 미설치 |
| T5 Encoder | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 6.7 GB | ✅ |
| WAN VAE | `Wan2_1_VAE_bf16.safetensors` | — | ✅ |
| Audio Encoder | `wav2vec2_large_english_fp32.safetensors` | — | ✅ |

자동 다운로드: `setup.sh`. FastFidelity 대응 모델은 수동 복사 (operations.md 참고).

---

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `run.sh` | 서비스 런처 (ComfyUI + FastAPI) |
| `setup.sh` | 의존성 + 모델 자동 다운로드 |
| `backend/main.py` | FastAPI 앱 + 정적 마운트 |
| `backend/models.py` | SQLModel 스키마 (Project, Character, Scene) |
| `backend/routers/scenes.py` | 씬 CRUD + 이미지 업로드 + 단계별 재생성 |
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

- **생성 속도**: S2V 립싱크가 씬당 약 1시간. FastFidelity 포팅 시 10× 단축 가능 (모델 다운로드 필요).
- **캐릭터 일관성**: Qwen Image Edit 2511 로 개선됐으나, 각도 변화가 큰 장면에서 얼굴이 미세하게 변함. IPAdapter FaceID 도입 검토.
- **MMAudio SFX 품질**: 짧은 duration(2~5s) + 제네릭 프롬프트 시 잡음처럼 들림. 씬별로 구체적 acoustic event 을 프롬프트에 명시 필요.
- **CUDA illegal memory access**: 장기 실행 직후 즉시 다음 생성 시도 시 간헐적 발생. ComfyUI 재시작으로 해결.

---

## 남은 작업

### 단기
1. FastFidelity S2V 레시피 포팅 (모델 복사 + 샘플러 파라미터 교체 + CFGZeroStar) — [operations.md#fastfidelity-참고](operations.md#fastfidelity-참고)
2. 캐릭터 일관성 강화 (IPAdapter FaceID — 같은 캐릭터가 다른 구도에서도 일관)
3. BGM 레이어 추가 (전체 영상에 배경음악 믹싱)
4. ComfyUI `/ws` 진행률을 백엔드 → 프런트까지 step 단위로 중계

### 중기
5. WebUI 에 ComfyUI 워크플로우 뷰어 페이지 (사용자 편집 지원)
6. 자막 오버레이 (선택적)
7. 에피소드 프리셋/템플릿
8. 프로젝트 export/import
