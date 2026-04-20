# 필요 모델 및 노드 목록

새 ComfyUI 환경 기준. 실제 설치 과정은 [install.md](install.md) 참고.

---

## 커스텀 노드 (모두 리포에 벤더링됨 — 재클론 불필요)

리포 클론 시 `ComfyUI/custom_nodes/` 에 이미 포함된 노드 (2026-04-20 기준 17개):

| 노드 | 용도 |
|------|------|
| ComfyUI-WanVideoWrapper | Wan 2.2 S2V/I2V 전용 래퍼 (sageattn 지원) |
| ComfyUI-VideoHelperSuite (VHS) | 비디오 로드/저장 (`VHS_VideoCombine`) |
| ComfyUI-MMAudio | MMAudio SFX 생성 |
| ComfyUI_Geeky_AudioMixer | 오디오 믹싱 (TTS + SFX) |
| ComfyUI-FL-Qwen3TTS | FL_Qwen3TTS_VoiceClone 등 |
| ComfyUI-FishAudioS2 | Fish S2 Pro TTS (4종 노드) |
| ComfyUI_IPAdapter_plus | IP-Adapter FaceID (레거시 폴백) |
| ComfyUI-Frame-Interpolation | RIFE VFI |
| ComfyUI-KJNodes | 유틸 (ColorMatch, ImageScaleBy) |
| ComfyUI-Easy-Use | easy cleanGpuUsed 등 |
| rgthree-comfy | Any Switch, Power Lora (레거시) |
| ComfyUI-GGUF | GGUF 양자화 모델 로드 (S2V Q4_K_M) |
| ComfyUI-Crystools | 시스템 모니터링 노드 |
| **ComfyUI-Impact-Pack** | `FaceDetailer`, `UltralyticsDetectorProvider`, `SAMLoader` — `ws_image_sdxl.json` Phase 1 필수 |
| **ComfyUI-Impact-Subpack** | Impact Pack 확장 (Ultralytics 래퍼) |
| **vnccs** | VNCCS 본 파이프라인 (`VNCCS_*` 노드들, Phase 4 캐릭터 시트/스프라이트) |
| **vnccs-utils** | VNCCS 보조 유틸 노드 (문자열 처리, 포즈 헬퍼) |

---

## 파이썬 의존성 (별도 `pip install`)

setup.sh 가 처리하지만 핵심 패키지 정리:

| 패키지 | 버전 | 왜 |
|---|---|---|
| `torch` | 2.11.0+cu130 | CUDA 13.0 빌드. NVIDIA 570+ 필요 |
| `sageattention` | 1.0.6+ | **필수** — O(n) attention (OOM 방지) |
| `fastapi` + `uvicorn[standard]` | 0.111+ / 0.29+ | 백엔드 |
| `sqlmodel` | 0.0.18+ | 스키마·ORM |
| `httpx` | 0.27+ | ComfyUI REST 클라이언트 |
| `websockets` | 12+ | ComfyUI 진행률 수신 (현재는 미사용, future) |

---

## 모델 파일 (다운로드 필요)

자동 받기: `bash download_models.sh`. 실패분 재시도: 같은 명령 재실행 (이어받기).

### Wan 2.2 공통 (T5 + VAE)

| 모델 | 경로 | 크기 | 출처 |
|---|---|---|---|
| umt5-xxl T5 (bf16) | `text_encoders/umt5-xxl-enc-bf16.safetensors` | 10GB | `Kijai/WanVideo_comfy` |
| Wan VAE (bf16) | `vae/Wan2_1_VAE_bf16.safetensors` | 1GB | `Kijai/WanVideo_comfy` |

**중요**: WanVideoWrapper 는 **bf16** T5 를 요구. `umt5_xxl_fp8_e4m3fn_scaled.safetensors` (코어 Comfy 호환) 는 "Invalid T5 text encoder model, fp8 scaled is not supported by this node" 에러.

### Wan 2.2 I2V 14B High/Low (루프·이펙트)

| 모델 | 경로 | 크기 |
|---|---|---|
| Dasiwa SynthSeduction HIGH V9 | `diffusion_models/wan_i2v_high/DasiwaWAN22I2V14BLightspeed_synthseductionHighV9.safetensors` | 28GB |
| Dasiwa SynthSeduction LOW V9 | `diffusion_models/wan_i2v_low/DasiwaWAN22I2V14BLightspeed_synthseductionLowV9.safetensors` | 28GB |
| (보조) SmoothMix HIGH V20 | `diffusion_models/wan_i2v_high/smoothMixWan2214BI2V_i2vHigh.safetensors` | 28GB |

워크플로우에서 `fp8_e4m3fn` 로 양자화 로드 → 실제 VRAM 점유 14GB.

### Wan 2.2 S2V 14B (립싱크)

| 모델 | 경로 | 크기 |
|---|---|---|
| Wan2.2 S2V Q4_K_M (GGUF) | `diffusion_models/wan_s2v/Wan2.2-S2V-14B-Q4_K_M.gguf` | 9GB |
| Audio Encoder (wav2vec2) | `audio_encoders/wav2vec2_large_english_fp32.safetensors` | 1GB |

### MMAudio (SFX)

| 모델 | 경로 | 크기 |
|---|---|---|
| mmaudio_large_44k_v2 | `mmaudio/mmaudio_large_44k_v2_fp16.safetensors` | 2GB |
| mmaudio VAE 44k | `mmaudio/mmaudio_vae_44k_fp16.safetensors` | 200MB |
| mmaudio Synchformer | `mmaudio/mmaudio_synchformer_fp16.safetensors` | 400MB |
| apple DFN5B CLIP ViT-H-14-384 | `mmaudio/apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors` | 1GB |

### Qwen Image Edit 2511 (캐릭터 일관성)

| 모델 | 경로 | 크기 |
|---|---|---|
| Qwen Image Edit 2511 Q5_0 (GGUF) | `unet/qwen-image-edit-2511-Q5_0.gguf` | 14GB |
| Qwen Edit Lightning 4-step LoRA | `loras/qwen/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` | 1.5GB |
| Qwen 2.5 VL Text Encoder fp8 | `text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors` | 7GB |
| Qwen Image VAE | `vae/qwen_image_vae.safetensors` | 700MB |

### VNCCS 캐릭터 일관성 LoRA 세트 (MIUProject)

| LoRA | 경로 |
|---|---|
| poser_helper_v2 | `loras/qwen/VNCCS/poser_helper_v2_000004200.safetensors` |
| ClothesHelperUltimate V1 | `loras/qwen/VNCCS/ClothesHelperUltimateV1_000005100.safetensors` |
| EmotionCore V2 | `loras/qwen/VNCCS/EmotionCoreV2_000004700.safetensors` |
| TransferClothes | `loras/qwen/VNCCS/TransferClothes_000006700.safetensors` |
| vn_character_sheet_v4 (SDXL) | `loras/vn_character_sheet_v4.safetensors` |
| DMD2 SDXL 4-step | `loras/DMD2/dmd2_sdxl_4step_lora_fp16.safetensors` |

### TTS — Qwen3-TTS (gated, HF_TOKEN 필요)

`tts/Qwen3TTS/` 아래에:

| Variant | 용도 |
|---|---|
| `Qwen3-TTS-12Hz-1.7B-Base` | VoiceClone x-vector 모드 베이스 |
| `Qwen3-TTS-12Hz-1.7B-CustomVoice` | 9개 사전정의 보이스 |
| `Qwen3-TTS-12Hz-1.7B-VoiceDesign` | 텍스트 묘사 보이스 생성 |
| `Qwen3-TTS-Tokenizer-12Hz` | 12Hz audio codec 토크나이저 |

각 variant 마다: `config.json`, `generation_config.json`, `merges.txt`, `vocab.json`, `preprocessor_config.json`, `tokenizer_config.json`, `model.safetensors` + `speech_tokenizer/*` (4개 variant 중 3개).

### TTS — Fish Audio S2 Pro (~24GB)

`fishaudioS2/s2-pro/` 아래에:

| 파일 |
|---|
| `config.json`, `chat_template.jinja`, `codec.pth` |
| `model-00001-of-00002.safetensors` (~12GB) |
| `model-00002-of-00002.safetensors` (~12GB) |
| `model.safetensors.index.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json` |

### 캐릭터 시트 / 폴백 (SDXL 경로)

| 모델 | 경로 | 출처 |
|---|---|---|
| Dasiwa Illustrious Realistic v1 | `checkpoints/DasiwaIllustriousRealistic_v1.safetensors` | Civitai |
| WAI-illustrious v160 (alt) | `checkpoints/waiIllustriousSDXL_v160.safetensors` | Civitai |
| Illustrious OpenPose ControlNet | `controlnet/SDXL/IllustriousXL_openpose.safetensors` | MIUProject |
| SAM ViT-B | `sams/sam_vit_b_01ec64.pth` | MIUProject |
| APISR 4x GRL GAN | `upscale_models/4x_APISR_GRL_GAN_generator.pth` | MIUProject |
| CLIP-ViT-H-14 laion2B | `clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` | h94/IP-Adapter |
| SDXL VAE fp16 fix | `vae/sdxl_vae.safetensors` | madebyollin |
| CLIP L | `clip/clip_l.safetensors` | comfyanonymous/flux_text_encoders |

### FaceDetailer

| 파일 | 경로 |
|---|---|
| face_yolov8m | `ultralytics/bbox/face_yolov8m.pt` |
| hand_yolov8s | `ultralytics/bbox/hand_yolov8s.pt` |

### SmoothMix / AniEffect 루프 LoRA

| 파일 | 경로 | 출처 |
|---|---|---|
| SmoothMix illustrious | `loras/wan_smoothmix/SmoothMix_illustrious.safetensors` | Civitai |
| smoothMix Ultimate illustriousV20 | `diffusion_models/wan_i2v_high/smoothmixUltimate_illustriousV20.safetensors` | Civitai |

---

## 필수 모델만 (최소 구성, ≈ 80GB)

립싱크·이미지 편집·VNCCS 없이 기본 **루프 + SFX** 만 돌리려면:

- `text_encoders/umt5-xxl-enc-bf16.safetensors`
- `vae/Wan2_1_VAE_bf16.safetensors`
- `diffusion_models/wan_i2v_high/DasiwaWAN22I2V14BLightspeed_synthseductionHighV9.safetensors`
- `diffusion_models/wan_i2v_low/DasiwaWAN22I2V14BLightspeed_synthseductionLowV9.safetensors`
- `mmaudio/mmaudio_large_44k_v2_fp16.safetensors` + vae + synchformer + apple CLIP
- `checkpoints/DasiwaIllustriousRealistic_v1.safetensors` (이미지용)
- Frame Interpolation 자동 다운로드: `rife49.pth` (최초 사용 시 Kijai HF)

`check_models.sh` 가 체크하는 목록이 대략 이 범위.

---

## models/ 디렉토리 최종 구조

```
ComfyUI/models/
├── audio_encoders/      wav2vec2_large_english_fp32.safetensors
├── checkpoints/         Dasiwa*.safetensors (SDXL)
├── clip/                clip_l.safetensors
├── clip_vision/         CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors
├── controlnet/SDXL/     IllustriousXL_openpose.safetensors
├── diffusion_models/
│   ├── wan_i2v_high/    Dasiwa...HighV9.safetensors, smoothMix*
│   ├── wan_i2v_low/     Dasiwa...LowV9.safetensors
│   └── wan_s2v/         Wan2.2-S2V-14B-Q4_K_M.gguf
├── fishaudioS2/s2-pro/  config.json, model-000{01,02}-of-00002.safetensors, …
├── ipadapter/           ip-adapter-faceid-plusv2_sdxl.bin
├── loras/
│   ├── qwen/            Qwen-Image-Edit-2511-Lightning*.safetensors
│   ├── qwen/VNCCS/      poser_helper_v2, ClothesHelperUltimate, …
│   ├── wan_smoothmix/   SmoothMix_illustrious.safetensors
│   ├── wan_anieffect/   (비움 — 옵션)
│   ├── wan_wallpaper/   (비움 — 옵션)
│   └── DMD2/            dmd2_sdxl_4step_lora_fp16.safetensors
├── mmaudio/             mmaudio_large_44k_v2_fp16.safetensors + vae + synchformer + apple CLIP
├── sams/                sam_vit_b_01ec64.pth
├── text_encoders/       umt5-xxl-enc-bf16.safetensors, qwen_2.5_vl_7b_fp8_scaled.safetensors
├── tts/Qwen3TTS/        Qwen3-TTS-12Hz-1.7B-{Base,CustomVoice,VoiceDesign}/, Qwen3-TTS-Tokenizer-12Hz/
├── ultralytics/bbox/    face_yolov8m.pt, hand_yolov8s.pt
├── unet/                qwen-image-edit-2511-Q5_0.gguf
├── upscale_models/      4x_APISR_GRL_GAN_generator.pth
└── vae/                 Wan2_1_VAE_bf16.safetensors, sdxl_vae.safetensors, qwen_image_vae.safetensors
```
