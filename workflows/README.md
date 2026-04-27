# ComfyUI Workflows

myaniform에서 사용하는 ComfyUI 워크플로우는 모두 repo 안에 보관하며, 앱 밖에서도 실행할 수 있게 export한다.

## 디렉터리

- `originals/`: 사용자가 제공한 ComfyUI UI-export 원본. 앱은 이 사본을 우선 사용한다.
- `standalone/api/`: 앱 패처를 적용한 최종 ComfyUI API prompt.
- `standalone/payload/`: ComfyUI `/prompt`에 바로 제출 가능한 payload.
- `standalone/input_examples/`: standalone payload 실행에 필요한 예시 입력 파일.
- 루트의 `ws_tts_clone.json`, `ws_tts_s2pro.json`, `ws_voice_design.json`: 음성 런타임용 API 워크플로우.

## 원칙

- 간이/축약 워크플로우를 런타임 기본 경로로 사용하지 않는다.
- 원본 UI-export는 `workflows/originals/`에 벤더링한다.
- 패치된 실행본은 직접 손수정하지 않고 `scripts/export_standalone_workflows.py`로 재생성한다.
- `LoadImage` / `LoadAudio` 입력은 ComfyUI `input/` 폴더 기준 파일명이어야 한다.

## 활성 워크플로우

| standalone payload | 용도 |
| --- | --- |
| `voice_design_qwen3.json` | Qwen3 VoiceDesign |
| `tts_clone_qwen3.json` | Qwen3 보이스 클론 |
| `tts_clone_s2pro.json` | Fish Audio S2 Pro 보이스 클론 |
| `character_sprite_new.json` | VN Step1 신규 캐릭터 스프라이트 |
| `character_sprite_reference.json` | VN Step1.1 참조 기반 캐릭터 스프라이트 |
| `scene_image_qwen_edit.json` | 스프라이트 참조 기반 Qwen Image Edit 장면샷 |
| `video_lipsync_s2v_fastfidelity.json` | FastFidelity S2V 립싱크 + MMAudio |
| `video_loop_i2v.json` | 원본 루프 I2V + MMAudio |
| `video_first_last_i2v.json` | 원본 첫끝프레임 I2V + MMAudio |

## 재생성

```bash
./.venv/bin/python scripts/export_standalone_workflows.py
```
