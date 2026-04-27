# 공통 파이프라인 — 장면 타입 상세

A안과 B안이 공유하는 장면 처리 방식.

---

## 장면 타입 1: `lipsync`

### 사용 모델/노드

| 요소 | 선택 |
|------|------|
| 립싱크 엔진 | `WanSoundImageToVideo` |
| 립싱크 모델 | Wan2.2 S2V 14B (Dasiwa 파인튜닝) |
| TTS | QWEN3 `Qwen3ClonePromptFromAudio` + `Qwen3CustomVoiceFromPrompt` / `Qwen3DirectedCloneFromVoiceDesign` or S2Pro `FishS2VoiceCloneTTS` |
| SFX | `MMAudioSampler` |
| 오디오 믹싱 | `GeekyAudioMixer` |

### 처리 흐름

```
이미지 (캐릭터+배경)
    +
TTS 오디오 (QWEN3 or S2Pro)
    ↓
WanSoundImageToVideo (S2V)
    ↓ 영상 프레임
MMAudioSampler (SFX)
    ↓ SFX 오디오
GeekyAudioMixer (TTS 1.0 + SFX 0.35)
    ↓ 믹싱 오디오
VHS_VideoCombine
    → scene_N.mp4
```

### 중요 파라미터

```
WanSoundImageToVideo:
  steps: 20
  cfg: 5.0 (Dasiwa S2V 파인튜닝에 맞는 값)
  resolution: 832×480 or 480×832
  frames: TTS 오디오 길이 × fps (자동 계산)
  
  AudioEncoderLoader 필요:
    → AudioEncoderEncode로 오디오 임베딩 변환 후 주입

GeekyAudioMixer:
  audio_1 (TTS): volume 1.0
  audio_2 (SFX): volume 0.3~0.4
```

### TTS 선택 기준

```
일반 대사, 내레이션           → QWEN3 VoiceClone
감정 폭발 / 숨소리 / 떨림     → S2Pro VoiceClone (감정 태그 활용)
2인 대화 장면                 → FishS2MultiSpeakerTTS
레퍼런스 음성 없는 새 캐릭터  → QWEN3 VoiceDesign (텍스트 설명)
```

### S2Pro 감정 태그 예시

```
"저...저는 그런 게 아니에요! [breath] 정말이에요."
"그게... [pause:0.8] 사실이에요?"
"[whisper]가까이 와요.[/whisper]"
"하... [laugh] 그런 거였군요."
```

---

## 장면 타입 2: `loop`

### 사용 모델/노드 (2026-04-19 현재)

| 요소 | 선택 |
|------|------|
| 루프 엔진 | `WanVideoSampler` (WanVideoWrapper, 2-stage MoE) |
| HIGH 모델 | `DasiwaWAN22I2V14BLightspeed_synthseductionHighV9` (fp8_e4m3fn, sageattn) |
| LOW 모델 | `DasiwaWAN22I2V14BLightspeed_synthseductionLowV9` (fp8_e4m3fn, sageattn) |
| BlockSwap | 30 blocks (CPU offload per forward) |
| 루프 LoRA | SmoothMix Illustrious (선택) |
| SFX | `MMAudioSampler` (배경음) |
| 보간 | `RIFE VFI` (rife49, ×2, ensemble) |

### 처리 흐름 (원본 루프 I2V)

```
이미지 생성 (Qwen Image Edit 또는 SDXL)
    ↓ start_image = end_image
WanVideoVAELoader + WanVideoImageToVideoEncode (480×832 × 49 frames)
    ↓ image_embeds
[HIGH stage]
  WanVideoBlockSwap(30) + WanVideoLoraSelectMulti
  → WanVideoModelLoader HIGH (sageattn)
  → WanVideoSampler HIGH (steps=6, cfg=1, euler, start=0, end=3)
    ↓ samples (force_offload)
[LOW stage]
  WanVideoBlockSwap(30) + WanVideoLoraSelectMulti
  → WanVideoModelLoader LOW (sageattn)
  → WanVideoSampler LOW (steps=6, cfg=1, euler, start=3, end=-1)
    ↓ samples (force_offload)
WanVideoDecode (tiled 272×272)
    ↓ images
ColorMatch(mkl, strength=1.0) → ImageScaleBy(×1) → RIFE VFI(×2)
    ↓
MMAudioSampler (환경음/배경음)
    ↓
VHS_VideoCombine (h264, crf=15, 32fps) → scene_N.mp4
```

`attention_mode: sageattn` 이 필수 (OOM 방지). 자세한 이유는 [operations.md#sageattention-oom-fix](operations.md#sageattention-oom-fix) 참고.

### 모델 + LoRA 조합

```
[High noise - 역동적인 모션]
  smoothMixWan2214BI2V_i2vHigh + SmoothMixAnimation_High
  → 커튼, 빛, 머리카락 등 눈에 띄는 ambient 모션

[Low noise - 미묘한 모션]
  DasiwaWAN22I2V14BLightspeed_tastysinLowV8 (or synthseductionLowV9)
  → 숨결, 미세 흔들림, 정적인 장면에 자연스러운 움직임 (LoRA 없이도 충분)
```

High/Low 선택 기준: 장면의 분위기. 동적인 장면(바람, 커튼)은 High, 조용하고 정적인 장면(실내 대기, 클로즈업)은 Low.

### TI2V를 쓰지 않는 이유

TI2V(WanFirstLastFrameToVideo)는 시작·끝 프레임을 강제 고정해 씨임리스를 보장하지만,  
SmoothMix I2V는 모델 자체가 smooth ambient 모션을 내도록 파인튜닝되어 있어  
별도의 끝 프레임 제약 없이도 자연스러운 루프성 영상이 생성됨.  
또한 Dasiwa 계열 스타일과 일관성을 유지할 수 있음.

---

## 장면 타입 3: `effect`

### 사용 모델/노드

| 요소 | 선택 |
|------|------|
| 이펙트 엔진 | `WanVideoSampler` + `WanVideoSLG` |
| 모델 | Wan2.2 I2V 14B High Noise |
| 이펙트 LoRA | 2D_animation_effects_high_noise |
| SFX | `MMAudioSampler` (효과음, 임팩트음) |

### 처리 흐름

```
기반 이미지 (정적 컷)
    ↓
WanVideoImageToVideoEncode
    + AniEffect LoRA
    + WanVideoSLG (Skip Layer Guidance)
WanVideoSampler
    ↓ 이펙트 영상
MMAudioSampler
  prompt: "anime impact, whoosh, dramatic sting"
  volume: 0.8 (SFX 강조)
    ↓
VHS_VideoCombine → scene_N.mp4
```

### 이펙트 프롬프트 예시

```
속도선 + 충격: "speed lines, impact flash, dramatic zoom, 2D anime style"
홍조/감정:    "blush effect, sparkle, heart symbols, warm glow"
충격파:       "shockwave, wind burst, dramatic light rays"
```

---

## 캐릭터 일관성 전략 (2026-04-20 재정비)

Phase 2 오버홀로 **N-캐릭터 동시 등장**을 1차 시민으로 지원. 씬마다 `character_ids_json` 에 캐릭터 ID 배열을 저장, 백엔드가 각 캐릭터의 이미지를 `Picture 1/2/…` 로 라벨링해 Qwen Edit Plus 의 `image1/2/…` 입력에 주입.

### 방법 1: Qwen Image Edit 2511 멀티레퍼런스 (기본 경로)

```
캐릭터 N명 — 각각 sprite_path > sheet_path > image_path 중 최선 선택
    ↓ ComfyUI/input 에 charref_0, charref_1, … 로 스테이징
workflows/originals/이미지 워크플로우.json + TextEncodeQwenImageEditPlus
  image1 = charref_0
  image2 = charref_1
  image3..N = 런타임 추가된 LoadImage 노드
    ↓
프롬프트 앵커: "Picture 1 shows (A) … . Picture 2 shows (B) … . Both/All N characters appear together in the same scene. <scene_desc>"
    ↓
20 step Qwen Edit KSampler → 씬 키프레임
```

구현: `build_multi_ref_prompt()` + 원본 이미지 워크플로우에 Qwen Image Edit branch 주입.

### 방법 2: VNCCS 원본 스프라이트 파이프라인

repo에 포함된 원본 UI-export:

```
workflows/originals/VN_Step1_QWEN_CharSheetGenerator_v1.json
  → 턴어라운드 시트 (정면/측면/후면)
workflows/originals/VN_Step1.1_QWEN_Clone_Existing_Character_v1.json
  → 외부 레퍼런스를 VNCCS 스타일로 클론
```

산출물을 캐릭터 패널 "VNCCS 시트/스프라이트" 섹션에서 업로드 →
`character.sheet_path` / `character.sprite_path` 저장 → 이후 씬 생성 시 자동으로
sprite > sheet > image 순으로 레퍼런스 선택.

간이 대안: `ws_character_sheet.json` (SDXL + `vn_character_sheet_v4` LoRA) 로
단일 턴어라운드 이미지를 백엔드에서 바로 생성 (`POST /characters/{id}/sheet/generate`).

### Seed 고정

`scene.image_params.seed` 고정으로 동일 캐릭터의 얼굴 흔들림 최소화. 비워두면 `control_after_generate: randomize`.

---

## MMAudio 운용 상세

### 모델 선택

```
성인 콘텐츠 포함 장면: mmaudio_large_44k_nsfw_gold_8.5k_final_fp16
일반 장면:            mmaudio_large_44k_v2_fp16
```

### 장면 타입별 SFX 볼륨

| 장면 타입 | SFX 역할 | 권장 볼륨 |
|-----------|---------|-----------|
| lipsync | 배경 분위기 보조 | 0.3~0.4 |
| loop | 주요 오디오 (TTS 없음) | 0.7~0.9 |
| effect | 임팩트 강조 | 0.7~0.85 |

### SFX 프롬프트 모음

```
거실 (낮):    "quiet apartment room, air conditioner hum, distant city"
거실 (저녁):  "warm indoor ambience, soft evening sounds"
침실:         "quiet bedroom, soft breathing, fabric sounds"
창가 (바람):  "gentle breeze, curtain rustling, birds"
감정 폭발:    "heartbeat, nervous breathing, tense atmosphere"
이펙트:       "anime impact, whoosh, dramatic sting, sparkle"
친밀한 장면:  "heavy breathing, fabric sounds, intimate atmosphere"
```
