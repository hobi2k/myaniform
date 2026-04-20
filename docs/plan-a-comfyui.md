# A안: 순수 ComfyUI 워크플로우 *(레거시)*

> **상태**: 2026-04-17 기준, 실제 플랫폼은 B안(FastAPI + React)으로 구현 완료. 이 문서는 초기 설계 기록으로 보존한다. 현재 상태는 `status.md` 참고.

## 개요

ComfyUI 안에서 모든 처리가 완결된다.  
Python 코드 없이 노드 그래프만으로 동작.  
사용자가 ComfyUI를 직접 열어 장면별로 실행.

---

## 워크플로우 실행 순서

```
[Step 0] 캐릭터 준비 (1회)
  ws_char_create.json  or  ws_char_clone.json
  → 캐릭터 레퍼런스 이미지 추출 및 저장

[Step 1~N] 장면별 실행
  각 장면마다 해당 ws_*.json 실행
  → output/scene_001.mp4, scene_002.mp4, ...

[Step Final] 연결
  ws_concat.json 실행
  → output/final.mp4
```

---

## ws_lipsync.json 노드 구조

```
[LoadImage]  ←  캐릭터+배경 합성 이미지
    │
    ├──────────────────────────────────────┐
    │                                      │
    ▼                                      ▼
[이미지 경로로 직접 사용]        [TTS 오디오 생성]
                                           │
                          ┌────────────────┴────────────────┐
                          │ QWEN3 경로                       │ S2Pro 경로
                          │ Qwen3Loader                      │ FishS2VoiceCloneTTS
                          │ → Qwen3VoiceClone                │   or FishS2MultiSpeakerTTS
                          │   or Qwen3VoiceDesign            │
                          └──────────┬───────────────────────┘
                                     │ (WAV audio)
                                     ▼
                    [Any Switch (rgthree)]  ← QWEN3 / S2Pro 전환 스위치
                                     │
    ┌────────────────────────────────┘
    │
    ▼
[UNETLoader]  ← Wan2.2 S2V 14B 모델
[AudioEncoderLoader → AudioEncoderEncode]  ← 오디오 인코딩
[CLIPLoader]
[CLIPTextEncode]  ← 장면 프롬프트
    │
    ▼
[WanSoundImageToVideo]
  입력: 이미지 + 인코딩된 오디오 + 텍스트 조건
    │ (video latent)
    ▼
[KSamplerAdvanced]
    │
    ▼
[VAEDecode]
    │ (video frames)
    ├────────────────────────────────────────┐
    │                                        │
    ▼                                        ▼
[VHS_VideoCombine]               [MMAudioModelLoader]
  (영상만 임시 저장)              [MMAudioFeatureUtilsLoader]
                                 [MMAudioSampler]
                                   prompt: SFX 설명
                                   입력: video frames
                                     │ (sfx audio)
                                     ▼
                                 [GeekyAudioMixer]
                                   audio_1: TTS 음성
                                   audio_2: MMAudio SFX
                                   sfx_volume: 0.35
                                     │ (mixed audio)
                                     ▼
[VHS_VideoCombine]  ← 영상 + 믹싱 오디오 최종 결합
  → output/scene_NNN_lipsync.mp4

[easy cleanGpuUsed]  ← S2V 모델 VRAM 해제
```

**QWEN3 / S2Pro 전환**: rgthree `Any Switch` 또는 `Fast Groups Bypasser`로 한쪽을 Bypass 처리.

---

## ws_loop.json 노드 구조

```
[이미지 생성 파트]
  UNETLoader (Dasiwa SDXL 체크포인트)
  CLIPTextEncode (배경 프롬프트)
  KSamplerAdvanced → VAEDecode → start_image
    │
    ▼
[SmoothMix I2V 파트]
  WanVideoModelLoader  ← High: smoothMixWan2214BI2V_i2vHigh
                          Low:  DasiwaWAN22I2V14BLightspeed_tastysinLowV8
  WanVideoLoraSelect   ← High: SmoothMixAnimation_High LoRA
                          Low:  (LoRA 불필요, Dasiwa 모델 자체로 충분)
  WanVideoVAELoader
  WanVideoTextEncode   ← ambient 모션 프롬프트
  WanVideoImageToVideoEncode
    start_image: 생성된 이미지 (끝 프레임 지정 불필요)
    │
  WanVideoSampler
    │
  WanVideoDecode
    │ (video frames)
    │
    ├──────────────────────────────────────┐
    │                                      ▼
    │                          [MMAudioSampler]
    │                            prompt: 배경/환경음
    │                              │ (sfx audio)
    │                              ▼
    │                          [GeekyAudioMixer]
    │                            audio_1: SFX (배경음만)
    │                              │
    ▼                              ▼
[RIFE VFI]            ←───[VHS_VideoCombine]
  multiplier: 2x          영상 + 오디오
(선택: 보간)
    │
[VHS_VideoCombine]
  → output/scene_NNN_loop.mp4

[easy cleanGpuUsed]
```

---

## ws_effect.json 노드 구조

```
[LoadImage]  ← 기반 이미지
    │
[WanVideoModelLoader]  ← Wan2.2 I2V 14B High Noise
[WanVideoLoraSelect]   ← 2D_animation_effects_high_noise
[WanVideoSetLoRAs]
[WanVideoTextEncode]   ← 이펙트 강조 프롬프트
[WanVideoImageToVideoEncode]
[WanVideoSLG]          ← Skip Layer Guidance (이펙트 강도 제어)
    │
[WanVideoSampler]
    │
[WanVideoDecode]
    │
[MMAudioSampler]
  model: nsfw_gold or v2
  prompt: "anime impact sound, whoosh, dramatic"
  volume: 높게 (SFX 강조)
    │
[GeekyAudioMixer]
    │
[VHS_VideoCombine]
  → output/scene_NNN_effect.mp4

[easy cleanGpuUsed]
```

---

## ws_concat.json 노드 구조

A안의 핵심: 장면 클립들을 ComfyUI 안에서 연결.  
xfade 전환은 ComfyUI 내에서 직접 구현이 어려우므로  
**전환용 블렌드 프레임을 직접 생성**하거나 단순 이어붙임 사용.

```
[VHS_LoadVideo: scene_001.mp4]
[VHS_LoadVideo: scene_002.mp4]
[VHS_LoadVideo: scene_003.mp4]
...
    │
[ImageBatchMulti]  ← 프레임 배치 통합
    │
    ※ 전환 옵션:
      Option 1) 단순 연결 (cut): 그대로 VHS_VideoCombine
      Option 2) RIFE VFI로 마지막/첫 프레임 사이 보간 (fade 효과 근사)
    │
[VHS_VideoCombine]
  → output/final.mp4
```

**전환 한계**: ComfyUI 내에서 xfade는 어렵다.  
실제 크로스페이드가 필요하다면 B안의 FFmpeg 사용이 맞음.  
A안은 컷 편집 또는 RIFE 보간 근사치.

---

## A안의 한계 정리

| 항목 | 한계 |
|------|------|
| 장면 수 | 실행 시마다 고정 (동적 추가 불가) |
| 장면 전환 | 컷 or RIFE 보간 (xfade 없음) |
| 자동화 | 장면마다 수동 실행 필요 |
| 모델 전환 | S2V→I2V 모델 swap 시 VRAM cleanGpu 필요 |

→ 단일 작품 제작, 직접 ComfyUI를 다루는 사용자에게 적합.
