# Composer M6 — 완료 보고

렌더 정합 (전략 B). 백엔드 ffmpeg `renderEdit` 가 M3-M5 의 신규 데이터 (per-clip 트림/속도/볼륨/색감 오버레이, per-boundary 트랜지션, BGM 트랙, 오버레이 위치/스타일/애니메이션) 를 모두 반영하도록 확장.

## 결과물

수정된 파일:

```
backend/services/ffmpeg_utils.py     # color_filter_chain (공용), _atempo_chain,
                                     # prepare_clip (per-clip 전처리),
                                     # concat (per-boundary transitions= 인자),
                                     # add_bgm_track (M4 BGM 믹싱),
                                     # _ass_color_from_css + _ass_override_for_overlay
                                     #   (M5 오버레이 위치/스타일/페이드 → ASS overrides)

backend/routers/generation.py        # EditOverlay 모델 확장 (M5 모든 필드)
                                     # EditRenderRequest 에 bgm_* 옵션 4개
                                     # render_edit 핸들러 4-step 파이프라인 재구성
```

## 새 파이프라인 4단계

기존 `render_edit` 는 `concat → finish` 2단. M6 에서 4단으로 확장:

### Step 1 — Per-clip 전처리 (`prepare_clip`)

각 씬마다 신규 필드 적용:
- **트림**: `-ss <in> -to <out>` (ffmpeg input args)
- **속도**: `setpts=PTS/SPEED` 영상, `atempo=` 체인 음성 (0.25..4.0 지원, atempo 0.5..2.0 제약 우회)
- **음량**: `volume=voice_volume * sfx_volume` (단일 channel — 백엔드는 voice/sfx 분리 트랙 없음, 곱셈으로 두 슬라이더 의도 합성)
- **색감 오버레이**: `clip_color_overlay` 가 set 되면 그 프리셋의 `eq/colorbalance/curves` 체인 추가

오버라이드가 모두 없으면 원본 경로 그대로 반환 (no-op, 재인코딩 회피).

### Step 2 — Per-boundary 트랜지션 (`concat(transitions=...)`)

`concat()` 시그니처에 `transitions: list[tuple[str, float]] | None` 추가.

각 씬의 `out_transition_style/sec` 가 set 이면 그 boundary 만 그 값 사용, 아니면 글로벌 `payload.transition_style/sec`. ffmpeg `xfade` 체인이 boundary 마다 다른 transition= 사용.

오디오는 `acrossfade` 체인으로 매끄러운 cross-fade.

### Step 3 — Finish (기존)

`finish_visual_novel_episode` 가 글로벌 색감 / vignette / grain / ASS 자막 + 오버레이 합성. 색감 필터 inline 정의는 `color_filter_chain` 공용 함수로 통합 (per-clip 과 같은 코드 경로).

### Step 4 — BGM 트랙 (`add_bgm_track`)

`Project.bgm_path` 가 있으면 마지막 단계로 BGM 믹싱:
- `aloop=loop=-1:size=2e9` (옵션) 으로 영상 길이까지 반복
- `volume=`, `afade=t=in:st=0:d=fade_in`, `afade=t=out:st=total-fade_out:d=fade_out`
- `atrim=duration=` 으로 정확한 길이 컷
- 메인 오디오에 +6dB (`volume=2.0`) 보정 후 `amix=inputs=2:duration=first` (amix 가 평균내려서 dB 떨어지는 것 보상)
- 비디오는 `-c:v copy` 로 재인코딩 안 함

## 오버레이 (M5) → ASS overrides

`write_ass_subtitles` 가 신규 필드 인식. `_ass_override_for_overlay` 가 `{\\...}` 블록 생성:

| EditOverlay 필드 | ASS override |
|---|---|
| `x, y` | `\\an5\\pos(x_px, y_px)` (중앙 정렬) |
| `rotation` | `\\frz<deg>` |
| `font_size` | `\\fs<n>` |
| `font_weight ≥ 600` | `\\b1` (bold) |
| `color` | `\\1c&Hbbggrr&` (CSS → BGR hex) |
| `outline` | `\\3c&Hbbggrr&` |
| `outline_width` | `\\bord<n>` |
| `animation_in/out=fade` | `\\fad(in_ms, out_ms)` |
| `animation_in=slide_up/left` | `\\move(x1,y1,x2,y2,0,dur_ms)` |

색상 파서 (`_ass_color_from_css`) 가 `#rgb`, `#rrggbb`, `rgb(r,g,b)`, `rgba(r,g,b,a)`, named ('white'/'black'/...) 처리. 실패 시 None 반환 → 색상 변경 없이 기본 스타일 유지.

## 알려진 제약 / 한계

1. **Voice ↔ SFX 분리 안 됨** — 씬 클립이 이미 voice + SFX 합성된 단일 오디오 stream. Per-clip `clip_voice_volume * clip_sfx_volume` 곱셈으로 단일 게인 적용. 진정한 트랙 분리는 씬 생성 단계에서 voice/sfx 별 stream 으로 출력하는 리팩터 필요 (M6+).
2. **animation_out=slide/scale 미지원** — ASS `\move` 가 지정된 시간 동안만 동작. 입장 후 정지 → 이탈에 다시 slide 는 단일 dialogue line 안에서 표현 어려움 (두 dialogue line 분할 필요). 현재는 slide_up/left 입장만 지원, 이탈은 fade fallback.
3. **animation scale 무지원** — ASS `\fscx/\fscy` 와 `\t()` 로 가능하지만 복잡도 vs 가치 trade-off 로 일단 보류. PNG pre-render 가 정답.
4. **오버레이 background 무지원** — ASS 는 per-line 박스 배경 직접 못 깜. 외곽선만 사용.
5. **오버레이 `kind=image|shape` 미렌더** — text 만 렌더. image 는 PNG 합성 단계 추가 필요.
6. **xfade 의 'flash' 매핑** — ffmpeg 에 flash 직접 없음, `fadewhite` 로 매핑 (`_transition_to_ffmpeg` 의 'fadefast' 는 옛 매핑이라 fadewhite 로 교체 검토).
7. **prepare_clip 이 매 렌더마다 재생성** — 캐싱 없음. 큰 프로젝트는 전처리 시간이 길어짐. 트림/속도/색감/볼륨 hash 로 캐싱 가능 (TODO).
8. **색감 픽셀 정합 미통일** — 프리뷰 CSS filter 와 ffmpeg eq/colorbalance 가 아직 다른 결과. LUT 통일 (전략 A) 은 별도 future work. 사용자가 보는 톤과 최종 톤은 비슷하지만 1:1 아님.

## 빌드 결과

- 백엔드 syntax OK
- 프런트엔드 영향 없음 (M5 빌드 그대로 392KB JS / 116KB gzip)

## 종료 — Composer 6 마일스톤 요약

| | 제목 | 주요 결과 |
|---|---|---|
| M1 | Player 엔진 + 실시간 프리뷰 | composer/ 모듈, RAF 마스터 플레이헤드, 트랜지션/색감/오버레이 합성 |
| M2 | 드래그-편집 타임라인 | Timeline UI, 클립 드래그 reorder, 좌우 트림 핸들, transition ◇ |
| M3 | 클립별 인스펙터 + 효과 | per-clip 트림/속도/볼륨/색감/per-boundary 트랜지션 (DB 영구화) |
| M4 | 멀티트랙 오디오 + BGM | Web Audio AudioGraph 싱글턴, 트랙별 mute/solo/volume/level meter, BGM player |
| M5 | 오버레이 에디터 | Player 위 마우스 박기/드래그/리사이즈/회전, OverlayInspector, 백엔드 영구화 |
| M6 | 렌더 정합 (전략 B) | ffmpeg 가 M3-M5 신규 데이터 모두 사용, per-clip 전처리, per-boundary xfade, BGM amix, 오버레이 ASS overrides |

다음 단계 (out-of-scope, future work):
- 전략 A (3D LUT 기반 픽셀 정합) — 프리뷰와 ffmpeg 색감을 같은 .cube 로 매핑
- 음정 보존 시간 신축 (SoundTouch.js / RubberBand WASM)
- 오버레이 PNG pre-render (회전/scale 애니메이션 정확 반영)
- 씬 생성 시 voice / sfx stream 분리 → render 시 per-track 볼륨 정확 적용
