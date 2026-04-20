# ComfyUI 워크플로우 카탈로그

모든 워크플로우는 **API 포맷** JSON (ComfyUI `/prompt` 엔드포인트용).
`backend/services/workflow_patcher.py` 가 런타임에 입력값·모델명·LoRA 를 주입.

---

## 워크플로우 목록

| 파일 | 단계 | 주입 함수 | 설명 |
|---|---|---|---|
| `ws_tts_clone.json` | voice | `patch_voice()` | Qwen3-TTS 1.7B **Base** 로 보이스 클론 (x_vector 모드) |
| `ws_tts_s2pro.json` | voice | `patch_voice()` | Fish Audio S2 Pro 로 보이스 클론 |
| `ws_voice_design.json` | voice | `patch_voice()` / `patch_voice_design()` | 레퍼런스 없이 묘사 텍스트만으로 Qwen3 VoiceDesign 생성 |
| `ws_image_sdxl.json` | image | `patch_image(workflow="sdxl")` | **SDXL Illustrious 30-step + 2-pass FaceDetailer** (2026-04-20 신규 — 기본 캐릭터 생성 경로) |
| `ws_scene_keyframe.json` | image | `patch_image(workflow="qwen_edit")` | Qwen Image Edit 2511 로 N-캐릭터 일관성 유지 (`image1..imageN`) |
| `ws_character_sheet.json` | image | `patch_character_sheet()` | VNCCS 간이 턴어라운드 시트 (SDXL + `vn_character_sheet_v4` LoRA) |
| `vnccs_step1_sheet_ui.json` | (뷰어) | — | VNCCS 본 파이프라인 Step1 — ComfyUI `/workflows` 에서 수동 실행 |
| `vnccs_step1_1_clone_ui.json` | (뷰어) | — | VNCCS Step1.1 (외부 레퍼런스 캐릭터 클론) |
| `vnccs_step4_sprite_ui.json` | (뷰어) | — | VNCCS Step4 (투명배경 스프라이트 추출) |
| `ws_char_create.json` | image | (legacy) | 더 이상 기본 경로 아님 — `ws_image_sdxl.json` 로 대체 |
| `ws_char_clone.json` | image | (legacy) | 비활성 |
| `ws_loop.json` | video | `patch_video_loop()` | **WanVideoWrapper** I2V FLF(start=end) 2-stage HIGH+LOW 루프 |
| `ws_effect.json` | video | `patch_video_effect()` | **WanVideoWrapper** I2V FLF(start+end 분리) 2-stage 이펙트 |
| `ws_lipsync.json` | video | `patch_video_lipsync()` | Wan 2.2 S2V 14B Q4 GGUF 립싱크 (코어 노드) |
| `ws_concat.json` | (unused) | — | ffmpeg 쪽에서 xfade 로 대체 |

---

## 비디오 워크플로우 상세

### `ws_loop.json` / `ws_effect.json` — I2V 2-stage (WanVideoWrapper)

**2026-04-19 전환**: 기존 `UnetLoaderGGUF + KSamplerAdvanced + rgthree Power Lora` 기반에서
`ComfyUI-WanVideoWrapper` 기반 노드 체인으로 전환 (OOM 방지 — [operations.md#sageattention-oom-fix](operations.md#sageattention-oom-fix) 참고).

레퍼런스: `D:\...\Wan 2_2 Reasoning Loops v1_0.json` (Windows 환경 메모리 세이프 레시피).

**노드 그래프 (API id 기준, loop/effect 공통)**:

```
                    WanVideoVAELoader (1) ─────────────────────────────────┐
                    LoadWanVideoT5TextEncoder (2) → WanVideoTextEncode (3) │
                    LoadImage (5) [start] ─────────────────────────────────┤
                    LoadImage (7) [end, effect 전용] ──────────────────────┤
                                                                           ▼
                                                       WanVideoImageToVideoEncode (6)
                                                                           │ image_embeds
  ┌────────────────────── HIGH stage ──────────────────────┐               │
  │ WanVideoBlockSwap (11, 30 blocks)                      │               │
  │ WanVideoLoraSelectMulti (12)                           │               │
  │ WanVideoModelLoader (10, HIGH, sageattn, bf16/fp8)     │               │
  └────────────┬────────────────────────────────────────── ┘               ▼
               │                                                  WanVideoSampler (14)
               └──────────────── model ───────────────────────▶   steps=6, cfg=1, euler
                                                                  start_step=0, end_step=3
                                                                           │ samples
  ┌─────────────────────── LOW stage ──────────────────────┐               │
  │ WanVideoBlockSwap (21, 30 blocks)                      │               │
  │ WanVideoLoraSelectMulti (22)                           │               │
  │ WanVideoModelLoader (20, LOW, sageattn, bf16/fp8)      │               │
  └────────────┬────────────────────────────────────────── ┘               ▼
               │                                                  WanVideoSampler (24)
               └──────────────── model ───────────────────────▶   steps=6, cfg=1, euler
                                                                  start_step=3, end_step=-1
                                                                           │ samples
                             WanVideoDecode (30, tiled, 272×272) ◀─────────┘
                                          │ images
                             ColorMatch (31, mkl, loop=1.0/effect=0.5)
                                          │
                             ImageScaleBy (32, lanczos ×1)
                                          │
                             RIFE VFI (33, rife49, ×2, ensemble)
                                          │            ──────────────────────┐
                                          │            MMAudio (40/41/42)    │
                                          ▼                                  │
                             VHS_VideoCombine (50, h264, crf=15, 32fps) ◀────┘
```

**샘플러 파라미터**:

| 노드 | steps | cfg | scheduler | shift | start_step | end_step |
|---|---|---|---|---|---|---|
| WanVideoSampler HIGH (14) | 6 | 1.0 | euler | 8.0 | 0 | 3 |
| WanVideoSampler LOW (24) | 6 | 1.0 | euler | 8.0 | 3 | -1 |

- LOW 의 `samples` 입력은 HIGH 의 출력을 릴레이 (latent 인계).
- 두 샘플러 모두 `force_offload=true` — 완료 직후 모델을 CPU 로 내림 (다음 스테이지/씬 VRAM 확보).

**모델 로더**:

| 노드 | base_precision | quantization | load_device | attention_mode | blocks_to_swap |
|---|---|---|---|---|---|
| WanVideoModelLoader (10/20) | `fp16_fast` | `fp8_e4m3fn` | `offload_device` | `sageattn` | 20 (BlockSwap 11/21) |

**4개 파라미터가 모두 맞아야** 16GB VRAM 에서 480×832 × 49 frames 가 완주함 (Max allocated 13.155 GB):

1. `load_device: offload_device` — 모델 상주 위치를 CPU 로. `main_device` 면 전체 14B 가중치가 GPU 로 로드되어 즉시 OOM.
2. `base_precision: fp16_fast` — 활성화 메모리를 fp16 단위로 관리. `bf16` 는 ~2배 소모.
3. `attention_mode: sageattn` — O(n²)→O(n) activation. `sdpa` 는 seq 21840 에서 초과.
4. `blocks_to_swap: 20` — 40 블록 중 절반을 CPU↔GPU 스트리밍.

자세한 실패/성공 이력은 [operations.md#i2v-2-stage-메모리-안전-설정-16gb-vram](operations.md#i2v-2-stage-메모리-안전-설정-16gb-vram).

**해상도·프레임**:

| 워크플로우 | 해상도 | num_frames | 길이 (RIFE 전/후) |
|---|---|---|---|
| `ws_loop.json` | 480×832 | 49 | 3s @ 16fps → 6s @ 32fps |
| `ws_effect.json` | 480×832 | 49 | 3s @ 16fps → 6s @ 32fps |

Wan 2.2 는 480×832 (9:16) 에서 학습 최적 — 임의 해상도 사용 시 activation 메모리 폭증.

**파라미터 차이**:

| 항목 | loop | effect |
|---|---|---|
| LoadImage | 하나 (5, start=end 로 사용) | 두 개 (5=start, 7=end) |
| ColorMatch strength | 1.0 | 0.5 |
| MMAudio duration | 5.0s | 3.0s |

### `ws_lipsync.json` — S2V 립싱크

**노드는 아직 코어 ComfyUI 체인** (WanVideoWrapper 로 전환 안 됨).

Wan2.2 S2V 14B (GGUF Q4_K_M).

**핵심 노드**:

- `UnetLoaderGGUF` (1) — S2V 모델 로드
- `AudioEncoderLoader` (4) — wav2vec2 large English fp32
- `AudioEncoderEncode` (7) — 음성 → 임베딩
- `WanSoundImageToVideo` (10) — 음성+이미지 → latent
- `KSamplerAdvanced` (11) — steps=20, cfg=5.0, euler, simple
- `VAEDecode` (12) → `ColorMatch` (50, strength=0.5) → `RIFE VFI` (51) → `VHS_VideoCombine` (17)
- 음성 믹싱: `GeekyAudioMixer` (16) — 대사 1.0 + MMAudio SFX 0.35 (10s 고정)

**해상도**: 832×1216, length=81 (≈ 5s @ 16fps → 10s @ 32fps).
**소요시간**: ~50분/씬 (20 step × ~150s).

**FastFidelity 포팅 후보**(미적용): `DasiwaWan2214BS2V_littledemonV2.safetensors` + steps=4 + cfg=8 + CFGZeroStar 로 10배 단축 가능. 모델(18.5GB) 별도 다운로드 필요. 참고: [operations.md#fastfidelity-참고](operations.md#fastfidelity-참고).

---

## 음성 워크플로우 상세

### `ws_tts_clone.json` — Qwen3-TTS VoiceClone

**중요**: `x_vector_only_mode=true` 로 설정 (2026-04-18 수정).

- `false` + `ref_text` 미제공 시 **silent 1초 플레이스홀더** 출력 (노드 내부 except 처리)
- `true` = x-vector 임베딩만으로 화자 특성 복사, ref_text 불필요
- 레퍼런스 오디오 길이 권장: 3초 이상

### `ws_tts_s2pro.json` — Fish Audio S2 Pro

ref_text 불필요. 더 자연스럽지만 모델 로드 시간·VRAM 소비 큼.

### `ws_voice_design.json` — VoiceDesign (레퍼런스 없음)

한글 보이스 묘사만으로 새 보이스 생성. 캐릭터 생성 단계에서 보이스 샘플이 없을 때 사용.

---

## 이미지 워크플로우 상세

### `ws_image_sdxl.json` — SDXL 고품질 키프레임 (2026-04-20 신규, 기본 폴백)

레퍼런스 `이미지 워크플로우.json` 1:1 포팅. SDXL Illustrious + 30-step euler_ancestral + SAM+YOLO 기반 FaceDetailer/HandDetailer 체인.

**노드 그래프**:

```
CheckpointLoaderSimple(1, waiIllustriousSDXL_v160)
  ↓
LoraLoader(2) → LoraLoader(3) → LoraLoader(4)   # 사용자 LoRA 슬롯 3개
  ↓ model, clip
CLIPTextEncode(10, Positive) / CLIPTextEncode(11, Negative)
  ↓
EmptyLatentImage(20, 832×1216)
  ↓
KSampler(30, steps=30, cfg=5.0, euler_ancestral, sgm_uniform)
  ↓
VAEDecode(40)
  ↓
FaceDetailer(60, face_yolov8m + sam_vit_b, guide_size=512, steps=10, cfg=4.5, denoise=0.25)
  ↓
FaceDetailer(61, hand_yolov8s + sam_vit_b, 동일 파라미터)
  ↓
SaveImage(70)
```

**필수 모델**: `waiIllustriousSDXL_v160.safetensors`, `sam_vit_b_01ec64.pth`,
`ultralytics/bbox/face_yolov8m.pt`, `ultralytics/bbox/hand_yolov8s.pt`.

**커스텀 노드**: `ComfyUI-Impact-Pack` + `ComfyUI-Impact-Subpack` (벤더링 완료).

**파라미터 주입** (`_apply_image_params`):
- `steps/cfg/sampler/scheduler/seed/denoise` → KSampler(30) (FaceDetailer 는 유지)
- `width/height` → EmptyLatentImage(20)
- `loras[0..2]` → LoraLoader(2,3,4) `lora_name` + `strength_*`
- `params.face_detailer=false` → 노드 60/61 제거, SaveImage 입력을 VAEDecode 로 직결
- `params.hand_detailer=false` → 노드 61 만 제거, SaveImage 입력을 FaceDetailer(60) 로

### `ws_scene_keyframe.json` — Qwen Image Edit 2511 (N-캐릭터)

캐릭터 레퍼런스 **1~N 개** 이미지를 조건으로 새 장면을 편집 생성.

- `LoadImage(10)` = 첫 번째 캐릭터 레퍼런스 (staged `charref_0.{ext}`)
- `LoadImage(11)` = 두 번째 (staged `charref_1.{ext}`, 1인 씬에서는 노드 자체 제거)
- `LoadImage(12)`, `LoadImage(13)`, … = 3번째 이상 캐릭터에 대해 런타임 생성
- `TextEncodeQwenImageEditPlus` Positive 의 `image1`..`imageN` 입력에 각 LoadImage 연결

**멀티 레퍼런스 앵커 프롬프트** (`build_multi_ref_prompt`):
- 1명: `"Picture 1 shows (이름) 설명. 씬 설명"`
- 2명: `"Picture 1 shows (A) A설명. Picture 2 shows (B) B설명. Both characters appear together in the same scene. 씬 설명"`
- 3명 이상: `". ".join(Picture i shows …) + ". All N characters appear together in the same scene. 씬 설명"`

캐릭터 레퍼런스 우선순위: **sprite_path > sheet_path > image_path** (투명 배경 스프라이트가 가장 깨끗한 합성을 만듦).

**자동 폴백**:
- Qwen Image Edit GGUF 미설치 → `ws_image_sdxl.json` (SDXL t2i)
- 레퍼런스 이미지가 하나도 없으면 → `ws_image_sdxl.json`

### `ws_character_sheet.json` — VNCCS 간이 시트 (SDXL)

`waiIllustriousSDXL_v160` + `vn_character_sheet_v4.safetensors` LoRA (strength 0.9 / 1.0) + 1536×1024 wide canvas. 프롬프트 키워드 `character sheet, turnaround, front view, side view, back view, full body`.

본격 VNCCS 파이프라인 (`vnccs_step1_sheet_ui.json`, `vnccs_step1_1_clone_ui.json`, `vnccs_step4_sprite_ui.json`) 은 ComfyUI `/workflows` 뷰어에서 수동 실행 — `/workflows?workflow=vnccs_step1_sheet_ui` 링크가 프론트 캐릭터 패널에 노출되어 있음.

### `ws_char_create.json` — SDXL 텍스트→이미지 (legacy)

2026-04-20 이후 `ws_image_sdxl.json` 가 기본 폴백 — 이 파일은 비활성.

---

## 런타임 주입 규칙 (`workflow_patcher.py`)

- **파일 경로** 파라미터는 `ComfyUI/input/` 기준 파일명으로 **스테이징** (uploads/voices 에서 복사).
- **LoRA 주입**:
  - `WanVideoLoraSelectMulti` (node 12=HIGH, 22=LOW) 의 **flat schema**: `lora_0`~`lora_4`, `strength_0`~`strength_4` (`_apply_loras_wrapper()`).
  - 남는 슬롯은 `"none"` + `1.0` 으로 채움.
  - `loras_low` 파라미터로 LOW 전용 LoRA 분기 가능.
- **모델명**:
  - WanVideoModelLoader: `inputs.model` 키 (e.g. `wan_i2v_high/DasiwaWAN22I2V14BLightspeed_synthseductionHighV9.safetensors`) — `_set_model_name()` 에서 처리.
  - UNETLoader (립싱크): `inputs.unet_name` 키. 같은 함수가 class_type 보고 분기.
- **프롬프트**:
  - `WanVideoTextEncode` (node 3): `inputs.positive_prompt` / `inputs.negative_prompt` 에 직접 쓰기.
  - 코어 `CLIPTextEncode`: `_meta.title` 에 "Positive" / "루프" / "이펙트" 포함된 노드에만 주입 (네거티브 분리).
- **MMAudioSampler**: `inputs.prompt` 를 씬 DB 의 `sfx_prompt` 로 덮어쓰기.

### 사용자 파라미터 주입 (Phase 3/5)

- **이미지 파라미터** (`_apply_image_params`): `scene.image_params` JSON 이 다음 필드를 받아 KSampler/EmptyLatent/LoraLoader 에 주입:
  ```json
  {
    "steps": 30,
    "cfg": 5.0,
    "sampler": "euler_ancestral",
    "scheduler": "sgm_uniform",
    "seed": 0,
    "denoise": 1.0,
    "loras": [
      {"name": "add_detail.safetensors", "strength": 0.6},
      {"name": "style_xyz.safetensors", "strength": 0.8}
    ],
    "face_detailer": true,
    "hand_detailer": true
  }
  ```
- **비디오 파라미터** (`_apply_video_params`): `scene.video_params` JSON 이 다음 필드를 받아 WanVideoSampler/KSampler/VideoCombine 에 주입:
  ```json
  {
    "steps": 6,
    "cfg": 1.0,
    "sampler": "euler",
    "scheduler": "beta",
    "shift": 8.0,
    "frames": 49,
    "fps": 32
  }
  ```
  `params` 가 비어 있으면 워크플로우 원본 값 유지. `_apply_video_params` 는 노드 class_type 로 분기 (WanVideoSampler, KSampler\*, WanVideoEmptyEmbeds, EmptyLatentImage, CreateVideo, VHS_VideoCombine).

- **해상도** (`resolution`): `(scene.resolution_w, scene.resolution_h)` 튜플이 EmptyLatentImage 의 width/height 를 덮어씀. None 이면 워크플로우 기본값.

프론트 UI: `SceneEditor.tsx` 의 **"고급 파라미터"** 섹션 (접기/펴기) 에서 워크플로우 선택 + 해상도 + ImageParamsEditor + VideoParamsEditor 노출.

### 모델명 딕셔너리 (`_I2V_MODELS` 등)

`backend/services/workflow_patcher.py` 상단의 딕셔너리에 정의. 새 파인튜닝 모델을 붙이려면:

1. 파일을 `ComfyUI/models/diffusion_models/wan_i2v_{high,low}/` 에 배치
2. `_I2V_MODELS` 에 key 추가
3. 웹 UI 씬 에디터의 "모델" 드롭다운에서 선택 (프론트의 옵션도 `backend/routers/setup.py` 의 응답 기반)
