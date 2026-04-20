# ComfyUI 워크플로우

FastAPI 백엔드가 `backend/services/workflow_patcher.py`로 동적 패치한 뒤 ComfyUI `/prompt`에 제출한다.
모든 `LoadImage` / `LoadAudio` 입력은 `ComfyUI/input/` 기준 파일명이다.

## 활성 (런타임)

| 파일 | 용도 | 패치 함수 | 핵심 노드 (class_type) |
| --- | --- | --- | --- |
| `ws_tts_clone.json` | Qwen3 TTS Voice Clone | `patch_voice` | `FL_Qwen3TTS_VoiceClone`, `LoadAudio` |
| `ws_tts_s2pro.json` | Fish S2 Pro Voice Clone | `patch_voice` | `FishS2VoiceCloneTTS`, `LoadAudio` |
| `ws_voice_design.json` | Qwen3 VoiceDesign (레퍼런스 없음) | `patch_voice`, `patch_voice_design` | `FL_Qwen3TTS_VoiceDesign` |
| `ws_char_create.json` | SDXL 키프레임 이미지 | `patch_image`, `patch_char_generate` | `CheckpointLoaderSimple`, `CLIPTextEncode` |
| `ws_lipsync.json` | Wan 2.2 S2V 립싱크 | `patch_video_lipsync` | `UnetLoaderGGUF`, `WanSoundImageToVideo`, `MMAudioSampler` |
| `ws_loop.json` | Wan 2.2 I2V FirstLastFrame 루프 | `patch_video_loop` | `UNETLoader`, `WanFirstLastFrameToVideo`, `Power Lora Loader (rgthree)` |
| `ws_effect.json` | Wan 2.2 I2V 이펙트 | `patch_video_effect` | `UNETLoader`, `WanFirstLastFrameToVideo`, `Power Lora Loader (rgthree)` |

## 보조 / 레거시

| 파일 | 설명 |
| --- | --- |
| `ws_char_clone.json` | IP-Adapter FaceID로 캐릭터 레퍼런스 시트 생성 (수동) |
| `ws_concat.json` | A안 전용 — ComfyUI 내부 클립 연결. 현재 파이프라인은 ffmpeg xfade로 대체 |

## 컨벤션

- **노드 번호**: 로더(1~4) → 인코딩/프롬프트 → 생성(샘플러) → 후처리 → 출력 순.
- **`_meta.title`**: 한국어 설명. 패처가 `"Positive"`, `"Negative"`, `"루프"`, `"이펙트"`, `"캐릭터"`, `"장면"` 키워드를 보고 노드를 찾으므로 변경 시 주의.
- **`filename_prefix`**: `myaniform/<kind>` 형식. 출력 경로 일관성 유지.
