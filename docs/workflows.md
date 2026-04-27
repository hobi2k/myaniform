# ComfyUI 워크플로우 카탈로그

런타임 워크플로우는 세 종류다.

- 로컬 API 포맷 JSON: 음성, 립싱크, 후처리처럼 앱 전용으로 관리하는 워크플로우.
- 원본 ComfyUI UI-export JSON: `workflows/originals/`에 벤더링한 원본을 `ui_workflow_adapter` 로 API prompt로 변환한 뒤 입력값·모델명·LoRA 를 주입한다.
- standalone export JSON: `workflows/standalone/payload/`에 저장된, myaniform 없이 ComfyUI `/prompt`에 직접 제출 가능한 실행본.

---

## 워크플로우 목록

| 파일 | 단계 | 주입 함수 | 설명 |
|---|---|---|---|
| `ws_tts_clone.json` | voice | `patch_voice()` | hobi2k Qwen3-TTS Base로 x-vector clone prompt를 만들고 CustomVoice로 렌더링 |
| `ws_tts_s2pro.json` | voice | `patch_voice()` | Fish Audio S2 Pro 로 보이스 클론 |
| `ws_voice_design.json` | voice | `patch_voice()` / `patch_voice_design()` | hobi2k DirectedCloneFromVoiceDesign으로 묘사 기반 보이스를 일관된 CustomVoice 출력으로 렌더링 |
| `이미지 워크플로우.json` | image | `patch_image(workflow="qwen_edit")` | 원본 이미지 워크플로우에 Qwen Image Edit 2511 브랜치를 주입해 N-캐릭터 일관성 유지 (`image1..imageN`). 의상/포즈/구도/카메라 등 장면 연출은 사용자 프롬프트만 반영 |
| `VN_Step1_QWEN_CharSheetGenerator_v1.json` | image | `patch_character_sheet()` | 신규 캐릭터 스프라이트/시트 원본 워크플로우 |
| `VN_Step1.1_QWEN_Clone_Existing_Character_v1.json` | image | `patch_character_sprite_existing()` | 업로드한 참조 이미지/기존 생성 자산을 기준으로 스프라이트/시트 재생성 |
| `동영상 루프 워크플로우.json` | video | `patch_video_loop()` | 원본 **WanVideoWrapper** I2V FLF(start=end) 2-stage HIGH+LOW 루프 |
| `동영상 첫끝프레임 워크플로우.json` | video | `patch_video_effect()` | 원본 **WanVideoWrapper** I2V FLF(start+end 분리) 2-stage 이펙트 |
| `Wan2.2-S2V_ Audio-Driven Video Generation.json` | video | `patch_video_lipsync()` | 원본 S2V branch 기반 FastFidelity 립싱크. DaSiWa S2V 모델 + 4step/cfg8/shift5 + MMAudio 믹스 |

---

## 비디오 워크플로우 상세

### `동영상 루프 워크플로우.json` / `동영상 첫끝프레임 워크플로우.json` — I2V 2-stage (WanVideoWrapper)

런타임은 로컬 축약판이 아니라 repo에 포함된 다음 원본 UI-export를 직접 읽는다.

- `workflows/originals/동영상 루프 워크플로우.json`
- `workflows/originals/동영상 첫끝프레임 워크플로우.json`

FastAPI 뷰어 alias:

- `video_loop_original`
- `video_effect_original`
주의: `DaSiWa WAN 2.2 i2v FastFidelity C-AiO-65.json`, `DaSiWa WAN 2.2 i2v FastFidelity C-SVI-29.json` 는 그대로 실행/선택하지 않는다. 이 파일들은 I2V/FLF2V/S2V/Audio/Combine 이 섞인 올인원 레퍼런스라서, 앱에는 S2V에 실제 필요한 서브구조만 추출해서 포팅해야 한다.

MMAudio SFX:

- S2V 립싱크는 `LoadAudio` TTS와 `MMAudioSampler` SFX를 `GeekyAudioMixer`에서 섞은 뒤 `VHS_VideoCombine.audio`로 연결한다.
- I2V 루프/첫끝프레임 원본 워크플로우에는 런타임에서 MMAudio SFX branch를 후단 주입한다. 원본 프레임 생성 그래프는 유지하고, 최종 `VHS_VideoCombine.audio`에 SFX를 연결한다.
- MoanForge 레퍼런스에서 가져오는 것은 전체 워크플로우가 아니라 SFW/NSFW MMAudio 모델 선택, prompt/negative, steps/cfg/duration, 믹서 볼륨 구조다.

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
| `동영상 루프 워크플로우.json` | 480×832 | 49 | 3s @ 16fps → 6s @ 32fps |
| `동영상 첫끝프레임 워크플로우.json` | 480×832 | 49 | 3s @ 16fps → 6s @ 32fps |

Wan 2.2 는 480×832 (9:16) 에서 학습 최적 — 임의 해상도 사용 시 activation 메모리 폭증.

**파라미터 차이**:

| 항목 | loop | effect |
|---|---|---|
| LoadImage | 하나 (5, start=end 로 사용) | 두 개 (5=start, 7=end) |
| ColorMatch strength | 1.0 | 0.5 |
| MMAudio duration | 5.0s | 3.0s |

### `Wan2.2-S2V_ Audio-Driven Video Generation.json` — FastFidelity S2V 립싱크

런타임 기본 립싱크는 원본 S2V 워크플로우를 변환해서 사용한다.

기본 모델: `wan_s2v/DasiwaWan2214BS2V_littledemonV2.safetensors`.

**핵심 노드**:

- `UNETLoader` — DaSiWa FastFidelity S2V safetensors
- `ModelSamplingSD3` — shift=5
- `AudioEncoderLoader` — `wav2vec2_large_english_fp16.safetensors`
- `AudioCropProcessUTK` — TTS 음성 crop/resample
- `AudioEncoderEncode` — 음성 → S2V audio embedding
- `WanSoundImageToVideo` — 음성+이미지 → latent
- `KSamplerAdvanced` high/refiner — 기본 steps=4, cfg=8, euler/simple, split 0→2→end
- `VAEDecode` → `VHS_VideoCombine`
- 앱 주입 MMAudio: `MMAudioSampler` → `GeekyAudioMixer` — TTS 1.0 + SFX 0.35

**주의**: FastFidelity 기본 경로는 safetensors `UNETLoader`만 허용한다.

---

## 음성 워크플로우 상세

### `ws_tts_clone.json` — Qwen3-TTS VoiceClone

**중요**: hobi2k `ComfyUI_Qwen3-TTS` 노드만 사용한다. FL_Qwen3TTS 런타임 워크플로우는 제거되었다.

- `Qwen3ClonePromptFromAudio` 에서 `x_vector_only_mode=true`
- `Qwen3CustomVoiceFromPrompt` 가 clone prompt를 받아 최종 음성을 렌더링
- 레퍼런스 오디오 길이 권장: 3초 이상

### `ws_tts_s2pro.json` — Fish Audio S2 Pro

ref_text 불필요. 더 자연스럽지만 모델 로드 시간·VRAM 소비 큼.

### `ws_voice_design.json` — VoiceDesign (레퍼런스 없음)

한글 보이스 묘사만으로 새 보이스 생성. 캐릭터 생성 단계에서 보이스 샘플이 없을 때 사용.

---

## 이미지 워크플로우 상세

### `이미지 워크플로우.json` + Qwen Image Edit — 장면샷

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

**커스텀 노드**: `ComfyUI-Impact-Pack` + `ComfyUI-Impact-Subpack` (`setup.sh` / `setup.ps1` 자동 clone/pull).

**파라미터 주입** (`_apply_image_params`):
- `steps/cfg/sampler/scheduler/seed/denoise` → KSampler(30) (FaceDetailer 는 유지)
- `width/height` → EmptyLatentImage(20)
- `loras[0..2]` → LoraLoader(2,3,4) `lora_name` + `strength_*`
- `params.face_detailer=false` → 노드 60/61 제거, SaveImage 입력을 VAEDecode 로 직결
- `params.hand_detailer=false` → 노드 61 만 제거, SaveImage 입력을 FaceDetailer(60) 로

### `이미지 워크플로우.json` + Qwen Image Edit 2511 — 장면샷 (N-캐릭터)

캐릭터 레퍼런스 **1~N 개** 이미지를 조건으로 새 장면을 편집 생성.
이 단계에서 Qwen Image Edit은 캐릭터 얼굴/머리/체형/정체성 일관성을 위한 레퍼런스 역할만 한다.
의상, 포즈, 구도, 카메라, 표정, 조명, 스타일은 `scene.bg_prompt` 와 `scene.image_params` 의 사용자 입력 필드만 합쳐 사용한다.
비어 있는 연출 필드는 런타임에서 아무것도 추가하지 않는다.

- `LoadImage(10)` = 첫 번째 캐릭터 레퍼런스 (staged `charref_0.{ext}`)
- `LoadImage(11)` = 두 번째 (staged `charref_1.{ext}`, 1인 씬에서는 노드 자체 제거)
- `LoadImage(12)`, `LoadImage(13)`, … = 3번째 이상 캐릭터에 대해 런타임 생성
- `TextEncodeQwenImageEditPlus` Positive 의 `image1`..`imageN` 입력에 각 LoadImage 연결

**멀티 레퍼런스 앵커 프롬프트** (`build_multi_ref_prompt`):
- 1명: `"Picture 1 shows (이름) 설명. 씬 설명"`
- 2명: `"Picture 1 shows (A) A설명. Picture 2 shows (B) B설명. Both characters appear together in the same scene. 씬 설명"`
- 3명 이상: `". ".join(Picture i shows …) + ". All N characters appear together in the same scene. 씬 설명"`

캐릭터 레퍼런스: **sprite_path 필수**. 장면샷 UI는 업로드 이미지를 받지 않고, 먼저 생성된 캐릭터 스프라이트를 사용한다.

**품질 정책**:
- Qwen Image Edit GGUF/노드/스프라이트가 없으면 대체 경로로 넘기지 않고 오류로 중단한다.
- 속도를 위해 SDXL 텍스트 이미지나 간이 그래프로 몰래 대체하지 않는다.
- 장면 연출 값은 사용자가 넣은 값만 반영한다. 의상이나 노출 상태도 앱이 강제하지 않는다.

스프라이트 신규 생성은 `VN_Step1_QWEN_CharSheetGenerator_v1.json`, 참조 이미지 기반 복제는 `VN_Step1.1_QWEN_Clone_Existing_Character_v1.json` 만 사용한다.

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
