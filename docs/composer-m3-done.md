# Composer M3 — 완료 보고

클립별 인스펙터와 per-clip 효과 (속도 / 색감 오버레이 / 음량 / 트림 정밀 / per-boundary 트랜지션) 추가. M2 의 메모리-only 트림이 백엔드 영구화로 승격.

## 결과물

신규 파일:

```
composer/
  SelectedClipInspector.tsx   # 우측 인스펙터 패널 — 트림/속도/볼륨/색감/트랜지션
```

수정된 파일:

```
backend/models.py             # Scene 에 8개 필드 추가
backend/database.py           # _ADDITIVE_MIGRATIONS 동기화
frontend/src/types/index.ts   # Scene 타입에 동일 필드
composer/types.ts             # ComposerClip 에 speed/volume/color_overlay/out_transition_*
composer/buildComposition.ts  # clipFromScene 가 백엔드 필드 매핑, layoutClips 가 per-boundary
                              #   transition_sec 사용. applyTrim 헬퍼 제거 (백엔드가 권위)
composer/useClipSync.ts       # SyncOptions { playbackRate, volume } 지원, video.playbackRate
                              #   + element.volume 자동 sync
composer/ClipLayer.tsx        # clip_color_overlay 를 글로벌 grade 위에 추가 filter chain
                              #   sfx_volume = video element, voice_volume = audio element
composer/Composer.tsx         # selectedClipId/onSelectClip prop 통과
composer/Timeline.tsx         # 빈 영역 클릭 = 선택 해제 + seek, 클립 선택 = highlight + seek
composer/TimelineClip.tsx     # isSelected prop, 선택 시 accent 테두리 + 그림자
components/video/TimelineComposer.tsx
                              # selectedClipId state, patchScene optimistic update,
                              # handleTrim 이 백엔드 PATCH (120ms throttle), SelectedClipInspector 렌더
```

## 8개 신규 백엔드 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `clip_in_offset_sec` | REAL | 트림 시작점 (0..duration). null=처음 |
| `clip_out_offset_sec` | REAL | 트림 끝점 (in..duration). null=끝까지 |
| `clip_speed` | REAL | 재생 속도 배율 (0.25..4). null=1.0 |
| `clip_voice_volume` | REAL | 보이스 트랙 볼륨 (0..2). null=1.0 |
| `clip_sfx_volume` | REAL | 클립 자체 오디오/SFX 볼륨 (0..2). null=1.0 |
| `out_transition_style` | VARCHAR | 이 클립 → 다음 클립 트랜지션 종류. null=글로벌 |
| `out_transition_sec` | REAL | per-boundary 트랜지션 시간. null=글로벌 |
| `clip_color_overlay` | VARCHAR | 클립 단위 색감 프리셋. null=오버레이 없음 |

DB 마이그레이션은 `_ADDITIVE_MIGRATIONS` 에 8줄 추가. SQLite ALTER TABLE 자동 실행.

## 인터랙션

### 클립 선택
1. 사용자가 타임라인 클립 본체 클릭 (드래그 아닌 짧은 클릭) → `Timeline` 의 `onSelectClip(slot.clip.id)` → `TimelineComposer` 의 `setSelectedClipId(id)`.
2. 동시에 `playback.seek(slot.start)` 로 그 클립 시작 시점으로 이동.
3. 선택된 클립 카드는 accent 색 테두리 (2px) + 그림자.
4. `SelectedClipInspector` 가 우측에 등장 — 트림/속도/볼륨/색감/트랜지션 컨트롤.
5. 빈 트랙 영역 클릭 → 선택 해제 + 그 시간으로 seek.

### 인스펙터에서 값 변경
1. 사용자가 슬라이더/숫자 입력/select 변경 → `SelectedClipInspector` 의 `onPatch(partial)` 콜백.
2. `TimelineComposer.patchScene(id, patch)` 호출 →
   - **즉시 React Query 캐시 optimistic update** → composition useMemo 가 즉시 재계산 → Player 가 1프레임 안에 반영 (no round-trip wait).
   - 백그라운드로 `api.scenes.update(id, patch)` PATCH → 실패하면 `invalidateQueries` 로 복구.
3. 리셋 버튼은 `null` 을 PATCH 해서 글로벌 기본값으로 되돌림.

### 트림 영구화
M2 까지는 `trimMap` 메모리 state 였음. M3 는:
1. 사용자가 클립 좌/우 가장자리 드래그 → `Timeline.TimelineClip` 의 pointermove 가 `onTrim(id, in, out)` 매 프레임 호출.
2. `TimelineComposer.handleTrim`:
   - 매 프레임: `qc.setQueryData` 로 캐시만 즉시 갱신 (composition 재계산 → Player 즉시 반영).
   - 120ms throttle 로 백엔드 PATCH 한 번씩만 보냄. 마지막 throttle 끝난 뒤 pointerup 이 떨어지면 자연스레 마지막 호출이 살아남음.
3. 새로고침해도 트림 그대로 유지.

### per-boundary 트랜지션
`out_transition_sec` / `out_transition_style` 이 set 된 클립은 그 클립 → 다음 클립 사이의 트랜지션이 글로벌 설정과 다르게 동작.

`layoutClips` 가 `tBefore(i)` (= 이전 클립의 out_transition_sec or 글로벌) 와 `tAfter(i)` (= 현재 클립의 out_transition_sec or 글로벌) 로 각 슬롯의 트랜지션 윈도우 계산. Player 의 `transitionLayerStyles` 에는 글로벌 style 이 그대로 전달되지만, 시간 길이는 per-boundary 라 자연스럽게 분기.

(현재 한 가지 한계: `transitionLayerStyles` 가 글로벌 `transition_style` 만 받음. 두 인접 클립이 서로 다른 style 을 원하면 outgoing 의 style 을 우선 사용해야 함 — 다음 세션에서 Player.tsx 의 `transition_style` 인자를 outgoing slot 에서 가져오도록 작은 패치 필요.)

### 클립 단위 색감 오버레이
1. 인스펙터 select 에서 한 색감 프리셋 고름 → PATCH `clip_color_overlay`.
2. `ClipLayer` 가 `colorGradeFilter(clip.color_overlay)` 로 추가 CSS filter 생성, 자기 wrapper 의 `filter:` 로 적용.
3. Player 의 글로벌 grade wrapper 가 모든 레이어를 통째로 한번 grading → 각 ClipLayer 가 자기에만 추가 grade chain. → 결과적으로 그 클립만 글로벌 + 오버레이 두 단 grade 받음.

### 속도 / 볼륨
- 속도: `useClipSync` 가 video element 의 `playbackRate` 를 sync. 글로벌 시간을 로컬 element time 으로 변환할 때 `playbackRate` 곱해줌 → 이미 빠른 속도로 재생되는 element 가 마스터 시간과 정렬됨.
- 볼륨: `useClipSync` 가 element 의 `volume` 도 sync (0~1 클램프). active 가 false 면 0 강제. video 와 audio 두 element 가 별도 볼륨 (sfx_volume vs voice_volume).
- 음정 변화: 현재는 단순 playbackRate (속도 + 음정 같이 변함). pitch 보존 음정 변경은 Web Audio API + AudioWorklet 필요 → M4 에서 처리.

## 한계 / 알려진 이슈

1. **per-boundary transition_style 정합** — `Player.transitionLayerStyles` 가 아직 outgoing slot 의 style 을 보지 않고 글로벌만 사용. 픽업으로 작은 패치 1줄 필요.
2. **렌더 정합 미동기** — 백엔드 ffmpeg `renderEdit` 는 아직 신규 8개 필드를 모름. 사용자가 트림/속도/색감 다 만져놔도 최종 렌더는 무시. M6 영역.
3. **음정 보존 음속변경 안 됨** — playbackRate 만으로는 chipmunk effect. 정확한 NLE 처럼 하려면 Web Audio + SoundTouch.js 또는 RubberBand 라이브러리. M4 후보.
4. **per-clip 선택이 키보드로 안 됨** — Timeline 위에서 ←/→ 로 다음 클립 선택 같은 단축키 없음. 추후 추가 가능.

## 빌드 결과

- TypeScript: clean
- Vite production build: 364KB JS / 108KB gzip
- 모든 기존 페이지 (캐릭터/씬 인스펙터, EditStudio) 정상 동작
