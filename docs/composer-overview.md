# Composer — 자체 NLE (Non-Linear Editor) 통합 가이드

myaniform 안에 내장된 영상 편집 엔진. Remotion 같은 외부 의존성 없이 React + HTML5 video + Web Audio + ffmpeg 으로 풀 구현.

## 기능 한눈에

- **실시간 프리뷰** — 씬 클립을 시간순으로 합성한 영상이 브라우저에서 즉시 재생. 트랜지션/색감/자막/오버레이 변경 시 1프레임 안에 반영.
- **드래그 편집 타임라인** — 클립 카드 끌어 순서 바꾸기, 좌/우 가장자리 트림, ◇ 핸들로 트랜지션 시간 조절, 플레이헤드 드래그 scrubbing.
- **클립별 효과** — 트림/속도/음량/색감 오버레이/per-boundary 트랜지션을 클립마다 독립 설정.
- **멀티트랙 오디오** — Voice / SFX / BGM 3 트랙 mute/solo/볼륨/실시간 레벨미터. Web Audio API 그래프.
- **BGM 트랙** — 프로젝트 단위 배경음 업로드, 루프/페이드 in/out.
- **오버레이 에디터** — Player 위 마우스로 자막/타이틀/스티커 직접 박고 드래그/리사이즈/회전. 5종 진입/이탈 애니.
- **백엔드 정합 렌더** — 위 모든 편집 데이터가 ffmpeg 최종 mp4 에 그대로 반영.

## 진입점

```
사용자 → /projects/:id/edit-studio
       → pages/EditStudioPage.tsx
       → components/video/TimelineComposer.tsx (state 관리, settings UI, BGM 업로드)
       → composer/Composer.tsx (Player + Timeline + BgmPlayer + TrackStack + OverlayCanvas 마운트)
```

## 모듈 구조

```
frontend/src/composer/
  types.ts                  # ComposerClip, ClipSlot, PlaybackState, FALLBACK_CLIP_SEC
  buildComposition.ts       # Scene[] → TimelineComposition + 시간축 layout (per-boundary transition 인식)
  resolveActiveSlot.ts      # currentTime → 활성/outgoing 슬롯 + 진행도
  colorGrade.ts             # 색감 프리셋 CSS filter, vignette/grain 오버레이
  transitions.ts            # 5종 트랜지션 레이어 스타일 계산
  usePlayback.ts            # RAF 마스터 플레이헤드 (play/pause/seek/seekRelative/toggle)
  useClipSync.ts            # element ↔ 글로벌 시간 sync (트림 + 속도 + 음량)
  ClipLayer.tsx             # 단일 씬 비디오/이미지/voice 렌더 + per-clip color filter chain
  OverlayLayer.tsx          # 시간축 자막/타이틀/스티커 (M5 위치/스타일/애니 인식)
  Player.tsx                # 메인 진입, 모든 레이어 합치고 transport + 키보드 단축키 + overlayEditor slot
  Composer.tsx              # 오케스트레이터 — Player + Timeline + BgmPlayer + TrackStack + OverlayCanvas

  Timeline.tsx              # 가로 스크롤 트랙 + 줌 + 빈 영역 클릭 seek
  TimelineRuler.tsx         # 적응형 시간 눈금
  TimelineClip.tsx          # 클립 카드 (드래그 reorder + 트림 핸들 + 선택 강조)
  TransitionHandle.tsx      # 인접 경계 ◇ 핸들 (transition_sec 좌우 드래그)
  PlayheadCursor.tsx        # 빨간 세로선 + 캡 (드래그 가능)

  SelectedClipInspector.tsx # 클립 선택 시 우측 인스펙터 (트림 정밀/속도/볼륨/색감/트랜지션)

  audio/
    AudioGraph.ts           # Web Audio 싱글턴 — element → elementGain → trackGain → master
                            #   트랙별 AnalyserNode, mute/solo 상태 머신
    useAudioRoute.ts        # 엘리먼트 라우팅 훅 + useTrackState (UI 구독)
    BgmPlayer.tsx           # 프로젝트 BGM 마스터 시간 sync, fade in/out 자동
    LevelMeter.tsx          # canvas + AnalyserNode RMS/Peak 실시간 미터
    TrackStack.tsx          # Voice/SFX/BGM 3행 믹서 UI

  overlay/
    animations.ts           # 5종 진입/이탈 애니메이션 진행도 → CSS, overlayBoxStyle
    OverlayCanvas.tsx       # Player 위 투명 레이어 — 더블클릭 신규/드래그/리사이즈/회전/Delete
    OverlayInspector.tsx    # 오버레이 종류/시간/위치/스타일/애니 풀 편집

backend/services/
  ffmpeg_utils.py           # color_filter_chain (공용), prepare_clip (per-clip 전처리),
                            # concat (per-boundary transitions), add_bgm_track, ASS overrides

backend/routers/
  generation.py             # render_edit 4-step 파이프라인:
                            #   1. prepare_clip (per-clip 트림/속도/볼륨/색감)
                            #   2. concat (per-boundary xfade + acrossfade)
                            #   3. finish_visual_novel_episode (글로벌 grade + 자막 + 오버레이)
                            #   4. add_bgm_track (BGM 믹싱)
  projects.py               # POST /bgm/upload, DELETE /bgm, PUT /overlays
  scenes.py                 # POST /probe_durations, POST /image/upload
```

## 데이터 모델

### Scene 신규 필드 (M3)
- `clip_duration_sec` — ffprobe 측정 (M1)
- `clip_in_offset_sec` / `clip_out_offset_sec` — 트림 in/out (M2/M3)
- `clip_speed` — 0.25..4× (M3)
- `clip_voice_volume` / `clip_sfx_volume` — 트랙별 음량 (M3)
- `out_transition_style` / `out_transition_sec` — per-boundary 트랜지션 (M3)
- `clip_color_overlay` — per-clip 색감 (M3)

### Project 신규 필드 (M4-M5)
- `bgm_path` — BGM 파일 경로 (M4)
- `measured_lufs` — 마지막 렌더의 라우드니스 측정값 캐시 (M4)
- `overlays_json` — EditOverlay[] JSON (M5)

### EditOverlay 확장 (M5)
- `id` — 안정 식별자
- `kind` — `caption | title | sticker | shape | image`
- `x, y, width, height, rotation` — 0..1 비율 위치/크기
- `font_family / font_size / font_weight / color / shadow / outline / outline_width / background / padding`
- `animation_in / animation_out / animation_duration` — 5종 진입/이탈 애니

### EditRenderSettings 확장 (M4)
- `bgm_volume / bgm_loop / bgm_fade_in / bgm_fade_out`

## API 엔드포인트

```
POST   /api/projects/{id}/bgm/upload          # BGM 파일 업로드
DELETE /api/projects/{id}/bgm                 # BGM 제거
PUT    /api/projects/{id}/overlays            # 오버레이 목록 통째 교체
POST   /api/projects/{id}/scenes/probe_durations  # ffprobe 백필
POST   /api/projects/{id}/scenes/{sid}/image/upload  # 외부 편집본 업로드
POST   /api/projects/{id}/generate/render_edit    # 최종 mp4 렌더
```

## 키보드 단축키 (Player 포커스 시)

- `Space` — 재생/일시정지
- `←` / `→` — −1s / +1s seek
- `Shift + ←/→` — −5s / +5s
- `Home` / `End` — 처음/끝
- `F` — 전체화면
- `Delete` (오버레이 선택 시) — 삭제
- `Esc` (오버레이 선택 시) — 선택 해제

## 마우스 인터랙션

- 클립 본체 드래그 → 순서 변경
- 클립 좌/우 가장자리 → 트림
- ◇ 핸들 좌우 드래그 → transition_sec
- 플레이헤드 캡 드래그 → seek
- 빈 영역 클릭 → 선택 해제 + seek
- Player 위 더블클릭 → 새 오버레이 (그 위치, 현재 시점)
- 오버레이 본체 → 위치 이동
- 오버레이 우하단 → 리사이즈
- 오버레이 위쪽 ⊙ → 회전
- Ctrl/Cmd + 휠 → 타임라인 줌

## 라이선스

자체 구현 — 외부 라이브러리 라이선스 부담 없음. 기존 프로젝트 의존성 (React MIT, lucide-react ISC, Tailwind MIT) 위에서만 동작.

## 참고 문서

- `composer-m1-done.md` ~ `composer-m6-done.md` — 마일스톤별 상세 보고
- `composer-m2-handoff.md` ~ `composer-m6-handoff.md` — 다음 마일스톤 진입 가이드 (현재 모두 완료, 참조용)
