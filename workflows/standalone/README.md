# Standalone ComfyUI Workflows

이 디렉터리는 myaniform 백엔드 없이도 ComfyUI에서 독립 실행할 수 있는 워크플로우 묶음이다.

## 구조

- `api/*.json`: ComfyUI API prompt 본문. 다른 자동화 코드에서 `prompt` 값으로 넣어 쓸 수 있다.
- `payload/*.json`: ComfyUI `/prompt`에 바로 제출 가능한 `{ "prompt": ... }` 래퍼.
- `input_examples/*`: `LoadImage` / `LoadAudio` 노드가 참조하는 예시 입력 파일.
- `manifest.json`: export된 워크플로우 목록, 필요한 입력 파일, 제출 명령.

## 실행 방법

1. `input_examples` 안의 필요한 파일을 대상 ComfyUI의 `input/` 폴더에 복사한다.
2. 대상 ComfyUI에서 필요한 custom node와 모델을 설치한다.
3. 이 디렉터리에서 manifest의 `submit` 명령을 실행한다.

예:

```bash
cp input_examples/charref_0.png /path/to/ComfyUI/input/
cp input_examples/charref_1.png /path/to/ComfyUI/input/
cp input_examples/visualref_0.png /path/to/ComfyUI/input/
curl -s http://127.0.0.1:8188/prompt \
  -H 'Content-Type: application/json' \
  --data-binary @payload/scene_image_qwen_edit.json
```

## 재생성

앱 런타임 패처와 standalone JSON이 갈라지지 않도록, 직접 수정하지 말고 아래 스크립트로 다시 생성한다.

```bash
./.venv/bin/python scripts/export_standalone_workflows.py
```

## 포함된 런타임 워크플로우

- `voice_design_qwen3`: Qwen3 VoiceDesign
- `tts_clone_qwen3`: Qwen3 voice clone
- `tts_clone_s2pro`: Fish Audio S2 Pro voice clone
- `character_sprite_new`: VN Step1 신규 캐릭터 스프라이트
- `character_sprite_reference`: VN Step1.1 기존 캐릭터 참조 스프라이트
- `scene_image_qwen_edit`: 캐릭터 스프라이트 레퍼런스 기반 Qwen Image Edit 장면샷
- `video_lipsync_s2v_fastfidelity`: FastFidelity S2V 립싱크 + MMAudio 믹스
- `video_loop_i2v`: 원본 루프 I2V + MMAudio SFX
- `video_first_last_i2v`: 원본 첫끝프레임 I2V + MMAudio SFX
