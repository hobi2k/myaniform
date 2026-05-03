# Composer M2 — 완료 보고

드래그-편집 타임라인 UI. 사용자가 마우스로 클립을 끌어 순서 바꾸고, 좌우 가장자리로 트림하고, ◇ 핸들로 트랜지션 시간을 조절할 수 있게 됨. 플레이헤드도 드래그 가능.

## 결과물

`frontend/src/composer/` 에 추가된 신규 파일:

```
composer/
  Composer.tsx          # 오케스트레이터 — Player 와 Timeline 을 함께 마운트하고
                        #   layout/usePlayback 을 공유
  Timeline.tsx          # 가로 스크롤 트랙 컨테이너. 줌/스크롤/빈 영역 클릭 seek
  TimelineRuler.tsx     # 적응형 시간 눈금 (1s/5s/15s/30s/1m 자동 선택)
  TimelineClip.tsx      # 단일 클립 카드 — 본체 드래그 reorder, 좌/우 트림 핸들
  TransitionHandle.tsx  # 인접 클립 경계 ◇ — 좌우 드래그로 transition_sec 조절
  PlayheadCursor.tsx    # 빨간 세로선 + 캡 — 캡 드래그하면 글로벌 시점 이동
```

수정된 파일:

```
composer/
  types.ts              # ComposerClip 에 clip_in/out_offset_sec 추가, effectiveDurationSec()
  buildComposition.ts   # applyTrim() 추가, layoutClips 가 effective duration 사용
  useClipSync.ts        # video element 의 currentTime = inOffset + (globalTime - slot.start)
                        #   → 트림된 구간만 재생
  Player.tsx            # layout 과 playback 을 외부 prop 으로 받도록 시그니처 변경
                        #   (Composer 가 주입)
components/video/TimelineComposer.tsx
                        # Player 단독 → Composer (Player+Timeline) 으로 교체
                        # trimMap state 보유, onReorder/onTrim/onTransitionSecChange 핸들러
```

## 인터랙션 (사용자 입장)

- **클립 본체 드래그** → 12px 이상 움직이면 reorder 모드. 클립 폭 단위로 좌/우 이동량을 추산해서 새 인덱스 산출 → `api.scenes.reorder` 호출 → 백엔드 order 영구 변경.
- **클립 좌측 가장자리 (8px)** → 커서 ew-resize. 우측으로 드래그하면 in-point 가 늘어나 클립 앞부분 잘라냄. 트림은 composer-only 로컬 상태 (M3 에서 백엔드 영구화 예정).
- **클립 우측 가장자리 (8px)** → out-point 좌측으로 당기는 방식. 클립 뒷부분 잘라냄.
- **클립 본체 클릭 (드래그 아닌)** → 해당 클립 시작 시점으로 seek.
- **인접 경계 ◇** → 좌우 드래그로 글로벌 transition_sec 0~3 사이 조절. 이동량 dx/pxPerSec 만큼 sec 변경.
- **플레이헤드 캡 드래그** → 글로벌 시점 이동. 재생 중에도 동작.
- **타임라인 빈 영역 클릭** → 그 시간으로 seek.
- **Ctrl/Cmd + 마우스 휠** → 줌 인/아웃 (12 ~ 240 px/s).
- **줌 버튼** → 확대/축소 단계별 (×exp(0.4)).

## 동작 메커니즘

### 트림이 video element 에 반영되는 경로

1. 사용자가 클립 좌측 핸들을 드래그 → `TimelineClip` 의 pointermove 가 `dxSec = dxPx / pxPerSec` 계산.
2. `onTrim(clipId, newIn, newOut)` → `TimelineComposer` 의 `setTrimMap((m) => ({...m, [id]: {in, out}}))`.
3. `composition` useMemo 가 재실행 → `buildComposition` + `applyTrim` 으로 새 ComposerClip 만듦.
4. `Composer` 의 `layoutClips()` useMemo 가 재실행 → 클립 폭/위치 새로 계산.
5. `useClipSync` 가 트림된 in-offset 만큼 `<video>` 의 currentTime 에 더해서 sync → 잘려나간 앞부분 건너뛰고 재생.

### Reorder 가 백엔드에 반영되는 경로

1. 사용자가 클립 본체를 드래그하면서 12px 이상 움직임 → pointerup 시 `targetByShift` 산출.
2. `onReorderToIndex(targetIdx)` → `Timeline.reorderToIndex(sourceId, targetIdx)` → `onReorder(orderedIds)`.
3. `TimelineComposer` 의 `reorderMutation.mutate(ids)` → `api.scenes.reorder(projectId, ids)` → 백엔드 PUT.
4. mutation onSuccess → `["scenes", projectId]` 쿼리 invalidate → 새 order 로 다시 fetch → `composition` 재구성.

### 트랜지션 시간 드래그가 즉시 반영되는 경로

1. ◇ 핸들 좌/우 드래그 → `TransitionHandle` 의 pointermove → `onChange(newSec)`.
2. `TimelineComposer` 의 `setSettings((p) => ({...p, transition_sec: sec}))`.
3. `composition.settings.transition_sec` 변경 → `layoutClips` 가 새 transition 으로 클립 재배치 (인접 클립 겹침 polynomial).
4. Player 의 `transitionLayerStyles()` 가 새 incoming/outgoing 진행도로 opacity/black/flash 보간.

## 한계 / 알려진 이슈

1. **트림 영구화 안 됨** — composer-only state 라 페이지 새로고침하면 트림이 사라짐. M3 에서 백엔드에 `clip_in_offset_sec/clip_out_offset_sec` 필드 추가하고 PATCH 할 예정.
2. **per-boundary 트랜지션 불가** — 모든 트랜지션이 단일 글로벌 transition_sec / transition_style 공유. M3 에서 클립별 `out_transition_style/sec` 필드 추가하면 경계마다 다른 트랜지션 가능.
3. **드래그 중 자동 스크롤 없음** — 클립을 트랙 가장자리로 끌고 가도 스크롤이 따라가지 않음. 큰 프로젝트에서는 불편할 수 있음. M3 에서 추가 (RAF 로 트랙 가장자리 검출 + scrollLeft 자동 증가).
4. **스내핑 없음** — 인접 클립 경계나 정수 second 에 자동 스냅 안 함. 사용자가 정밀 조정해야 함. M3 추가 가능.
5. **undo/redo 없음** — Ctrl+Z 미구현. M3 에서 trimMap/reorder 히스토리 추가.
6. **ffmpeg 백엔드 렌더가 트림을 모름** — 최종 렌더는 클립을 자르지 않고 전체를 사용. 사용자에게 노란 경고 추가 필요 또는 M6 까지 같이 처리.

## 다음 (M3) 필수 백엔드 변경

```python
# backend/models.py 의 Scene 클래스에 추가
class Scene(SQLModel, table=True):
    ...
    clip_in_offset_sec: Optional[float] = None   # 0..duration
    clip_out_offset_sec: Optional[float] = None  # in..duration
    out_transition_style: Optional[str] = None   # cut/soft/fade/...
    out_transition_sec: Optional[float] = None   # per-boundary override
    clip_speed: Optional[float] = None           # 0.25..4.0
    clip_color_overlay: Optional[str] = None     # per-clip color preset
    clip_voice_volume: Optional[float] = None
    clip_sfx_volume: Optional[float] = None
```

DB 마이그레이션:
```python
("scene", "clip_in_offset_sec",  "REAL"),
("scene", "clip_out_offset_sec", "REAL"),
("scene", "out_transition_style","VARCHAR"),
("scene", "out_transition_sec",  "REAL"),
("scene", "clip_speed",          "REAL"),
("scene", "clip_color_overlay",  "VARCHAR"),
("scene", "clip_voice_volume",   "REAL"),
("scene", "clip_sfx_volume",     "REAL"),
```

ffmpeg 렌더는 trim 을 `-ss inSec -t (out-in) -i clip.mp4` 로 적용.
