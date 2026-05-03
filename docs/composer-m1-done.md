# Composer M1 — 완료 보고

자체 NLE(영상 편집 엔진) 구축의 첫 마일스톤. Remotion 같은 외부 라이브러리에 의존하지 않고 myaniform 안에 통째로 내장.

## 결과물

`frontend/src/composer/` 안에 production-grade 모듈로 들어감.

```
composer/
  types.ts             # ComposerClip / ClipSlot / PlaybackState 데이터 모델
  buildComposition.ts  # Scene[] → TimelineComposition 변환 + 시간축 layout
  resolveActiveSlot.ts # currentTime 으로 활성/outgoing 씬 + 트랜지션 진행도 산출
  colorGrade.ts        # 색감 프리셋 → CSS filter, vignette/grain 오버레이
  transitions.ts       # cut/soft/fade/dip_to_black/flash 5종 레이어 스타일 계산
  usePlayback.ts       # RAF 기반 마스터 플레이헤드 (play/pause/seek/seekRelative/toggle)
  useClipSync.ts       # <video>/<audio> element를 timeline currentTime 에 동기화
  ClipLayer.tsx        # 단일 씬 비디오/이미지 + voice 트랙 렌더
  OverlayLayer.tsx     # 시간축 기반 자막/타이틀/스티커
  Player.tsx           # 메인 진입점 — 모든 걸 합쳐서 화면에 그리고 transport 컨트롤
```

## 동작 방식

1. `buildComposition(scenes, settings, overlays)` — 백엔드 씬 데이터를 컴포저용 타입으로 정규화 (`ComposerClip`). 자산 URL 도 여기서 결정 (clip_path → `/<root>`, image_path/voice_path → `/comfy_input/<name>`).
2. `layoutClips()` — 각 클립을 시간축에 배치. `transition_sec > 0` 이면 인접 클립이 그 만큼 겹쳐서 cross-fade 가능.
3. `usePlayback()` — RAF 루프로 currentTime 진행. setState 기반이라 React 리렌더 발생하지만 ref 로 핫패스는 캐시. play/pause/seek/seekRelative/toggle 임퍼러티브.
4. `resolveActiveSlot(slots, t)` — 매 프레임 활성 클립 인덱스, 진행 중인 outgoing 클립 인덱스, incoming/outgoing 진행도 (0..1) 계산.
5. `Player` —
   - 모든 클립을 마운트한 채 활성/outgoing/preload 이웃만 `nearWindow=true` 로 디코딩 살림 (PRELOAD_NEIGHBOR_COUNT=1)
   - `transitionLayerStyles()` 가 각 레이어의 opacity + flash/black 오버레이 결정
   - `colorGradeFilter()` 가 모든 레이어에 일괄 CSS filter 적용
   - `vignetteStyle()` / `grainStyle()` 이 그 위에 라디얼 그라디언트 + SVG 노이즈
   - `OverlayLayer` 가 활성 씬 dialogue 를 자막으로, 사용자 오버레이를 시간 기반 표시
6. `useClipSync` — `<video>` / `<audio>` 엘리먼트를 마스터 시간에 동기화. drift > 120ms 면 currentTime 직접 jump, 그 외엔 자연 진행. `loadedmetadata` 이벤트로 메타 로드 후 한번 더 sync.

## 통합 지점

- **`components/video/TimelineComposer.tsx`** — 기존 정적 썸네일 트랙 + JSON 디버그 패널 제거. 좌측에 `<Player>` 가 들어가서 실시간 프리뷰. 우측에 컷/색보정/자막/출력/오버레이 설정 패널 (그대로 유지). 설정 변경하면 useMemo 가 composition 재생성 → Player 가 즉시 반영.
- **`pages/EditStudioPage.tsx`** — 손대지 않음. `TimelineComposer` 가 알아서 새 동작.
- **`api.scenes.probeDurations`** — 백엔드의 `POST /projects/{id}/scenes/probe_durations` 호출. 기존에 `clip_path` 만 있고 `clip_duration_sec` 없는 씬을 ffprobe 로 백필. UI 에 노란 알림 띄우고 클릭하면 호출.

## 백엔드 변경

- **`backend/models.py`** — `Scene.clip_duration_sec: Optional[float] = None` 추가. SceneRead 도 노출.
- **`backend/database.py`** — `_ADDITIVE_MIGRATIONS` 에 `("scene", "clip_duration_sec", "REAL")` 추가. SQLite ALTER TABLE 자동.
- **`backend/routers/scenes.py`** — `regenerate_video` 끝에서 `ffmpeg.get_duration()` 으로 측정 후 저장 (실패 시 None). `POST /scenes/probe_durations` 백필 라우트 신규.
- **`frontend/src/types/index.ts`** — Scene 타입에 `clip_duration_sec: number | null` 추가.
- **`frontend/src/api/index.ts`** — `api.scenes.probeDurations(projectId)` 추가.

## 키보드 단축키

Player 가 포커스를 잡으면 다음 동작:
- `Space` — 재생/정지
- `←` / `→` — −1s / +1s seek
- `Shift + ←/→` — −5s / +5s
- `Home` / `End` — 처음/끝으로
- `F` — 전체화면 토글

## 한계 / 알려진 이슈

1. **오디오 baked-in vs 분리**: 씬 클립이 voice 를 자체 음성트랙에 갖고 있는지(`s2v` lipsync 결과), 별도로 `voice_path` 만 갖고 있는지(`i2v` voiceover) 백엔드가 명시적으로 표시하지 않음. 컴포저는 일단 둘 다 깔고 나서 `<video muted={!active}>` 로 active 만 들리게 하는데, baked voice + 분리 voice 가 동시 있는 케이스에서는 살짝 phasing 가능. M4 (multi-track 오디오 믹서) 에서 정밀 처리.
2. **첫 재생 autoplay**: 브라우저 정책상 muted 가 아닌 `<video>` 는 사용자 제스처 전에는 재생 거부. Play 버튼은 사용자 클릭이라 OK. 자동 재생은 안 함.
3. **대용량 클립 메모리**: 모든 클립을 mount-and-park 하므로 N=20+ 짜리 프로젝트는 브라우저 메모리 압박. PRELOAD_NEIGHBOR_COUNT=1 로 제한된 구간만 디코딩 살림. 진짜 대용량은 M2 에서 viewport-based mount 도입.
4. **트랜지션 == 단순 opacity/색**: cut/soft/fade/dip_to_black/flash 5종은 전부 레이어 알파/오버레이 만으로 구현. wipe/slide/morph 같은 복잡 트랜지션은 M3+ 의 영역.
5. **자막**: 활성 씬의 `dialogue` 를 통째로 화면 중앙 하단에 표시. 글자 크기/그림자/외곽선 만 styled. SRT/ASS 같은 시간 분할 자막은 미지원.
6. **렌더 정합**: 백엔드 ffmpeg 의 색감 적용은 별도 코드 경로라 이 컴포저의 CSS filter 와 픽셀 단위로 같지 않음. 비슷하게 보이는 정도. M6 에서 정합.

## 라이선스

자체 구현이라 외부 라이브러리 라이선스 부담 없음. 의존성: React (MIT) + lucide-react (ISC) + Tailwind (MIT) — 기존 프로젝트가 이미 쓰던 것들.
