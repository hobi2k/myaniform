# Composer M5 — 완료 보고

오버레이 에디터. 폼 기반 입력을 Player 위 마우스 직접 박기 + 백엔드 영구화 + 풀 스타일 인스펙터로 교체.

## 결과물

신규 파일:

```
composer/overlay/
  animations.ts          # animation_in/out 진행도 → CSS transform/opacity 매핑, overlayBoxStyle()
  OverlayCanvas.tsx      # Player 위 투명 레이어 — 더블클릭 신규/드래그 이동/리사이즈/회전/Delete
  OverlayInspector.tsx   # 우측 인스펙터 — 종류/시간/위치/스타일/애니메이션 풀 편집
```

수정된 파일:

```
backend/models.py                        # Project.overlays_json
backend/database.py                      # _ADDITIVE_MIGRATIONS: project.overlays_json
backend/routers/projects.py              # PUT /projects/{id}/overlays
frontend/src/types/index.ts              # EditOverlay 확장 (id/x/y/width/rotation/스타일/애니메이션)
                                         # Project.overlays_json
frontend/src/api/index.ts                # api.projects.updateOverlays
composer/OverlayLayer.tsx                # 동적 좌표(x/y%) + 애니메이션 적용, computeAnimatedStyle
composer/Player.tsx                      # overlayEditor prop slot — stage 위에 사용자 편집 UI
composer/Composer.tsx                    # OverlayCanvas 마운트 + 클립↔오버레이 선택 배타
components/video/TimelineComposer.tsx
                                         # overlays state 가 project.overlays_json 에서 옴
                                         # 폼 기반 카드 → "빠른 추가" 카드 + 목록 + 인스펙터
                                         # handleOverlaysChange 로 PUT 백엔드, 250ms throttle
                                         # OverlayInspector 가 SelectedClipInspector 와 배타
```

## EditOverlay 신규 필드

| 그룹 | 필드 | 설명 |
|---|---|---|
| 식별 | `id` | 클라 부여 (안정 식별자, 영구화 후 선택 추적) |
| 종류 | `kind` | `caption / title / sticker / shape / image` |
| 위치 | `x / y` | 0..1 화면 비율 (해상도 무관) |
| 위치 | `width / height` | 0..1 (선택 사항) |
| 위치 | `rotation` | degrees |
| 스타일 | `font_family / font_size / font_weight` | |
| 스타일 | `color` | 글자색 |
| 스타일 | `shadow` | CSS shadow string |
| 스타일 | `outline / outline_width` | 8방향 textShadow 외곽선 |
| 스타일 | `background / padding` | 박스 배경 |
| 애니 | `animation_in / animation_out` | `none/fade/slide_up/slide_left/scale` 등 |
| 애니 | `animation_duration` | sec, default 0.4 |

기존 (`kind`, `text`, `scene_index`, `start`, `duration`) 와 하위 호환 — 신규는 모두 optional. 옛 데이터는 `parseOverlays` 가 id 자동 부여.

## 인터랙션

### 신규 오버레이 만들기 (3가지 경로)

1. **Player 위 빈 영역 더블클릭** — 클릭 위치 (x, y) 와 현재 씬 + 그 씬 시작 후 시간 자동 설정. 텍스트 "텍스트" default. 즉시 선택 + 인스펙터 노출.
2. **빠른 추가 버튼** — 우측 카드 `+ 타이틀 / + 자막 / + 스티커`. 종류별 정형화 위치 (타이틀=상단 중앙, 자막=하단 중앙, 스티커=우상단). 0번 씬에 추가.
3. **OverlayInspector** 에서 직접 시간/씬/스타일 편집.

### 편집

- **드래그** → 위치 이동 (x, y 갱신).
- **우하단 핸들** (분홍 사각) → 리사이즈. font_size 를 mouse delta * 0.5 로 증감 (텍스트 박스가 글자 크기로 자동 확장).
- **위쪽 ⊙ 핸들** → 중심 기준 회전. atan2 로 각도 산출 + base 더해 회전.
- **Delete / Backspace** → 삭제 (선택 해제). Esc → 선택 해제.

### 시간 윈도우 안에서만 편집 가능

`globalTime` 이 오버레이의 `[start, start+duration]` 사이일 때만 OverlayCanvas 가 렌더 + 핸들 표시. 사용자가 보는 타이밍 = 편집할 수 있는 타이밍. (안 보이는 오버레이는 우측 목록에서 클릭하면 선택 + 그 시점으로 seek 도 가능 — TODO 다음 마일스톤).

### 클립 ↔ 오버레이 선택 배타

`Composer` 에 `selectedClipId` / `selectedOverlayId` 둘 다 prop. 한 쪽이 set 되면 다른 쪽 자동 null. UI 상으로는 SelectedClipInspector 와 OverlayInspector 가 같은 자리에 한 번에 하나만 노출.

### 영구화 흐름

1. 사용자 드래그/스타일 변경 → `OverlayCanvas` 또는 `OverlayInspector` 의 onChange → `handleOverlaysChange(next)`.
2. 즉시 `qc.setQueryData<Project>(...)` 로 캐시 갱신 → useMemo `overlays` 재계산 → Player + OverlayCanvas 1프레임 안에 반영.
3. 250ms throttle 로 `api.projects.updateOverlays` PUT. 컴포넌트 unmount 시 마지막 변경 한 번 더 fire-and-forget.
4. 새로고침해도 그대로 복원.

## OverlayLayer (Player 안의 오버레이 렌더) 변경

이전: 정적 위치 (`bottom: 110px`, `right: 24px` 등 kind 기반 hardcoded).
현재:
- `style.left/top = x*100% / y*100%` (비율).
- `transform: translate(-50%, -50%) rotate(<rot>deg)` 로 중심 정렬 + 회전.
- 진입/이탈 애니메이션: `globalTime` 이 `[visibleStart, visibleStart + animDur]` 사이면 enterT, `[visibleEnd - animDur, visibleEnd]` 사이면 exitT 보간 → opacity / translate / scale.
- 텍스트 외곽선/그림자: `overlayBoxStyle` 이 8방향 textShadow + 사용자 그림자 chain.

## animations.ts 의 5종

| In | Out | 설명 |
|---|---|---|
| `none` | `none` | 그냥 나타남 / 사라짐 |
| `fade` | `fade` | 단순 opacity (default) |
| `slide_up` | `slide_down` | translateY 80px → 0 |
| `slide_left` | `slide_right` | translateX 80px → 0 |
| `scale` | `scale` | scale 0.8 → 1 |

## 한계 / 알려진 이슈

1. **OverlayCanvas 가 자체 cursor crosshair** — Player 의 ▶ 버튼이나 transport 와 같은 stage 가 아닌 곳에서는 영향 없지만, 사용자가 단순 시점 이동을 위해 영상 위 클릭하면 오버레이 추가가 아니라 해제만 됨 (더블클릭이어야 추가). 일관성 OK.
2. **렌더 정합 미동기** — 백엔드 ffmpeg `renderEdit` 는 신규 EditOverlay 필드 (x/y/rotation/animation 등) 를 모름. 폼 기반 시절의 단순 자막/타이틀/스티커 위치만 적용. M6 영역.
3. **width/height 가 자동 결정** — 사용자가 명시적으로 박스 크기를 드래그할 수 없음. 글자 크기로 박스가 자동 확장되는 모델. 정형화 박스가 필요하면 width/height 필드 입력.
4. **이미지/도형 종류 미구현** — `kind: "image" | "shape"` enum 만 있고 렌더 코드 없음. M5+ 후속 (이미지 업로드 + Image kind 렌더).
5. **viewport vs 실제 출력 좌표** — Player container 가 16:9 고정. 백엔드 출력이 다른 aspect (e.g. 9:16 세로) 면 좌표 의미가 달라짐. 같은 비율 가정.
6. **z-index 조절 안 됨** — 오버레이 여러 개 겹칠 때 위/아래 순서는 입력 순서. 인스펙터에 "위로/아래로" 추가 가능 (TODO).
7. **편집 중 BgmPlayer 키 입력 차단 안 됨** — Delete 키가 Player 키보드 (Space 등) 와 무관하게 동작하니 OK.

## 빌드 결과

- TypeScript: clean
- Vite production build: 392KB JS / 116KB gzip
- 모든 기존 페이지 정상 동작
