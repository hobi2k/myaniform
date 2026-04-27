# Gold Fixture Quality Pipeline

이 프로젝트는 특정 영상을 그대로 복제하지 않는다. 대신 사용자가 가진 reference video를 **구조적 품질 기준**으로 분석해서, myaniform 생성물이 같은 제작 밀도와 기술 기준을 만족하는지 검증한다.

분석기는 프레임, 오디오, 대사, 캐릭터, 스토리 비트를 저장하지 않는다. 저장하는 값은 해상도, 화면비, FPS, 오디오 포맷, loudness, 컷 타이밍, shot duration 통계뿐이다.

## Reference Profile 생성

```bash
./.venv/bin/python scripts/gold_fixture.py analyze \
  --source "/path/to/reference.mp4" \
  --output goldfixtures/heeheart_reference.profile.json
```

또는 로컬 환경변수로 지정할 수 있다.

```bash
MYANIFORM_GOLD_FIXTURE_VIDEO="/path/to/reference.mp4" \
  ./.venv/bin/python scripts/gold_fixture.py analyze
```

현재 `heeheart_reference.profile.json` 기준값:

- 1920×1032, aspect 1.86047
- 29.966fps, yuv420p
- AAC 48kHz stereo
- 72.549초
- scene threshold 0.10 기준 10 cuts, 11 shots
- median shot 7.333초
- render spec: 832×448, 29.966fps, transition 0.367초, 70초 기준 권장 10 scenes

## 생성물 비교

```bash
./.venv/bin/python scripts/gold_fixture.py compare \
  --profile goldfixtures/heeheart_reference.profile.json \
  --candidate output/my_generated_video.mp4 \
  --output output/my_generated_video.quality.json
```

비교 항목:

- aspect ratio: ±0.03
- FPS: ±3fps
- audio sample rate: exact
- integrated loudness: ±4 LUFS
- shots per minute: reference의 45%-180%

## 파이프라인에 적용하는 기준

- 장면 구성은 70초 기준 약 10 scenes를 목표로 한다.
- 한 shot의 중심 길이는 7초 전후로 잡고, 중요한 감정 변화 지점에는 1.6-4초 shot도 허용한다.
- 최종 렌더는 reference의 1.86:1 화면비를 유지하되, ComfyUI/Wan 안전 해상도인 832×448부터 시작한다.
- 오디오는 48kHz stereo를 기본으로 하고, TTS와 MMAudio SFX를 최종 믹스 후 loudness 검증한다.
- Remotion/FFmpeg 편집 레이어는 `render_spec.editing.transition_sec`를 기본 전환 길이로 사용한다.

## 금지

- reference 영상의 프레임 추출물을 dataset처럼 저장하지 않는다.
- reference 음성을 voice cloning sample로 사용하지 않는다.
- reference의 인물, 대사, 특정 장면을 그대로 재현하지 않는다.
- 품질 기준을 맞추기 위해 간이/축약 ComfyUI 워크플로우로 우회하지 않는다.
