# Composer M2-M6 — 다음 세션 핸드오프

M1 (플레이어 엔진 + 실시간 프리뷰) 은 완료. 이 문서는 M2~M6 의 구체적 작업 계획.

## 전체 마일스톤

| | 제목 | 작업량 추정 | 결과물 |
|---|---|---|---|
| M1 | 플레이어 엔진 + 실시간 프리뷰 | ✅ 완료 | `composer/` + `TimelineComposer` 통합 |
| M2 | 드래그-편집 타임라인 UI | 5-7일 | 클립 카드 드래그/트림/트랜지션 핸들 |
| M3 | 클립별 인스펙터 + 효과 | 3-5일 | 우측 패널에서 클립 단위 색감/볼륨/속도 |
| M4 | 멀티트랙 오디오 믹서 | 5-7일 | TTS/SFX/BGM 분리 트랙, Web Audio gain/fade |
| M5 | 오버레이 에디터 | 3-5일 | 마우스로 캔버스에 텍스트/스티커 박기 |
| M6 | 렌더 정합 (preview ↔ ffmpeg) | 5-7일 | 컴포저 CSS filter 와 ffmpeg 색감 1:1 매칭 |

총합 ~3-4주 풀 production. 이번 세션에서 M1 끝.

---

## M2 — 드래그-편집 타임라인 UI

### 목표
기존 `TimelineComposer` 의 우측 설정 패널은 그대로 두고, **좌측 Player 아래에 드래그 가능한 타임라인 트랙** 추가. 사용자가 마우스로 클립을 끌어 순서 바꾸기 / 좌우 핸들로 트림 / 인접 클립 사이 핸들로 트랜지션 시간 조절.

### 데이터 모델 변경
현재 `ComposerClip.duration_sec` 은 클립의 실제 ffprobe 길이. M2 에서 사용자가 트림하면:
- `clip_in_offset_sec`: 클립 시작 위치 (기본 0)
- `clip_out_offset_sec`: 클립 끝 위치 (기본 duration_sec)
- `effective_duration = clip_out_offset_sec - clip_in_offset_sec`

`useClipSync` 가 글로벌 시간 → 로컬 element currentTime 변환할 때 `clip_in_offset_sec` 만큼 더해야 함.

```ts
const localT = (globalTime - slot.start) + clip.clip_in_offset_sec;
```

### 컴포넌트 신규
- `composer/Timeline.tsx` — 가로 스크롤 트랙 컨테이너
- `composer/TimelineClip.tsx` — 클립 카드 (드래그 가능, 좌/우 트림 핸들 + 가운데 본체)
- `composer/TransitionHandle.tsx` — 인접 클립 사이의 ◇ 핸들. 가로 드래그로 트랜지션 시간 0~max 조절
- `composer/TimelineRuler.tsx` — 상단 시간 눈금 (0:00, 0:05, 0:10...)
- `composer/PlayheadCursor.tsx` — 현재 시간 위치 세로선

### 인터랙션
- **클립 본체 드래그**: 가로 방향만 받고, 다른 클립과 드롭 위치 충돌하면 swap. `react-dnd` 안 쓰고 native HTML5 drag-and-drop 또는 pointer events 직접 작성 (M1 의 `LibraryPanel.tsx` / `TimelineStrip.tsx` 가 이미 비슷한 패턴 있음).
- **트림 핸들 (좌/우)**: pointer down → 마우스 이동 양만큼 `clip_in_offset_sec` 또는 `clip_out_offset_sec` 조정. 최소 0.1s 보장.
- **트랜지션 핸들**: 인접 클립 경계에 ◇. drag 좌/우로 `transition_sec` 조정 (전역 값이라 모든 트랜지션 동시 변경; 차후 per-boundary 트랜지션은 M3 영역).
- **타임라인 클릭 → seek**: 빈 공간 클릭 시 그 시간으로 jump.

### 상태 관리
설정 데이터를 `EditStudioPage` 또는 `TimelineComposer` 에서 `useState<EditTimeline>` 으로 들고 컴포저로 prop 전달. 변경 시 useMemo 통과해서 Player 가 즉시 반영. localStorage 동기화도 추가하면 새로고침해도 편집 유지.

### M2 완료 기준
- 클립 5개짜리 프로젝트에서 마우스만으로 순서 바꾸기 / 클립 트림 / 트랜지션 시간 조절 가능
- 각 액션 직후 Player 프리뷰가 (RAF 1프레임 안에) 갱신됨
- 키보드: 선택된 클립 `Delete` 로 트랙에서 빼기, `Shift+Z` 로 undo

---

## M3 — 클립별 인스펙터 + 효과

### 목표
타임라인에서 클립 클릭 → 우측 인스펙터에 그 클립 단위의 속성 노출. 전역 설정과 별도로 클립마다 다른 색감/볼륨/속도 가능.

### 백엔드 변경
- `Scene` 모델에 추가:
  - `clip_speed: float = 1.0` (0.25 ~ 4.0)
  - `clip_color_overlay: Optional[str]` (per-clip color preset override; null=전역)
  - `clip_voice_volume: float = 1.0`
  - `clip_sfx_volume: float = 1.0`
  - 추후: `clip_in_offset_sec`, `clip_out_offset_sec` (M2 결과물 영구 저장)
- DB 마이그레이션 + Scene/SceneRead 갱신

### 프런트
- `composer/SelectedClipInspector.tsx` — 클립 선택 시 우측에 슬라이드 인. 색감/속도/볼륨 컨트롤. 변경 즉시 PATCH 백엔드 + 로컬 컴포저 갱신.
- `useClipSync` 가 `playbackRate` 도 동기화하도록 확장.
- `ClipLayer` 의 색감은 전역 grade 위에 per-clip overlay 가 있으면 합성 (CSS filter 두 번 chain).

---

## M4 — 멀티트랙 오디오 믹서

### 목표
현재 audio 는 `<audio>` 엘리먼트 한 줄로 voice 만 흘림. 진짜 NLE 처럼 voice/SFX/BGM 트랙 분리 + 트랙별 볼륨 / 페이드인-아웃 / 음소거 / 솔로.

### Web Audio API 채택
- `composer/audioGraph.ts` — `AudioContext` 생성, 트랙별 `MediaElementAudioSourceNode` + `GainNode` 체인. RAF 동기로 gain 업데이트 (페이드 곡선 구현).
- 각 씬 클립의 audio 는:
  - **video 의 internal audio track** (s2v 결과면 voice 포함, i2v 면 SFX 만 또는 무음)
  - **별도 voice_path** (i2v 의 voiceover)
  - **별도 SFX 음원** (현재는 mmaudio 가 클립 안에 mix 함, M4 에서 분리하면 외부 SFX 라이브러리도 가능)
- BGM: 프로젝트 단위로 한 줄. 사용자가 mp3 업로드.

### UI
- Player 아래에 트랙 스택. 각 트랙: 이름 / 볼륨 슬라이더 / mute / solo / 페이드인-아웃 시간.

### 어려운 부분
- 브라우저 audio 정책 (사용자 제스처 후에만 AudioContext.resume()).
- video element 와 audio context 동기화 (drift 누적 가능, 5s 마다 리캘리브레이션).

---

## M5 — 오버레이 에디터

### 목표
현재 오버레이는 폼으로 텍스트/위치 입력. M5 에선 **Player 화면 위에 직접 마우스로 박기**.

### 구현
- Player 위에 투명 캔버스 레이어. 사용자가 빈 곳 더블클릭 → 텍스트 입력 시작.
- 이미 있는 오버레이는 hover 시 핸들 표시 → 드래그로 이동.
- 오버레이 시간 범위는 타임라인에 작은 마크로 표시 (M2 의 `Timeline.tsx` 와 통합).
- 텍스트 스타일링: 폰트/크기/색/그림자 — CSS 인스펙터와 비슷하게 클릭 후 인라인 편집.
- 애니메이션 진입: 단순 fadeIn/slideIn — `transitionInEnd` 와 비슷하게 진행도 0..1 보간.

---

## M6 — 렌더 정합 (preview ↔ ffmpeg)

### 문제
브라우저 Player 의 색감은 CSS filter (`saturate/contrast/brightness/sepia/hue-rotate`). 백엔드 ffmpeg 의 `color_preset` 은 별개의 ffmpeg `eq=` / `colorbalance=` / `curves=` 필터. 둘이 다른 결과 냄.

### 해결 방향
1. 백엔드 ffmpeg 색감을 LUT (3D LUT, .cube 파일) 기반으로 통일.
2. 같은 LUT 를 프런트에서 WebGL 셰이더로 적용 → 픽셀 1:1 일치.
3. `composer/ColorGradeWebGL.tsx` 신규 — `<canvas>` 위에서 `<video>` 텍스처 + LUT 텍스처를 합성. 기존 CSS filter 경로는 fallback.

### 작업
- `backend/services/ffmpeg_utils.py` — `apply_color_preset_lut(input, output, preset)` 신규. LUT 파일은 `assets/luts/<preset>.cube`.
- LUT 파일은 DaVinci Resolve / OCIO 에서 export. 4개 프리셋 만들기.
- 프런트: WebGL2 컨텍스트 만들고 LUT 를 sampler3D 로 업로드. fragment shader 가 video 픽셀 색상을 LUT 매핑.

### 어려운 부분
- 비디오 → WebGL 텍스처 업로드 cost (매 프레임 `gl.texImage2D`). RAF 동기 OK 지만 CPU↔GPU 전송이 한계.
- vignette/grain 은 그대로 CSS overlay 유지하거나 같은 셰이더에서 합성.

---

## 즉시 시작 가능한 액션

다음 세션 첫 30분 todo:
1. `frontend/src/composer/Timeline.tsx` 신규 — 빈 가로 스크롤 컨테이너부터.
2. `composer/TimelineClip.tsx` — 단일 클립 카드 (M1 의 `TimelineStrip.tsx` 코드 참고하면 비슷한 패턴 있음).
3. 데이터 모델에 `clip_in_offset_sec`, `clip_out_offset_sec` 추가 — 컴포저 only (백엔드는 M3 까지 대기).

## 컨텍스트 / 진입점

- 진입점 페이지: `pages/EditStudioPage.tsx` → `components/video/TimelineComposer.tsx` → `composer/Player.tsx`
- 데이터 흐름: `api.scenes.list(projectId)` → `buildComposition()` → `Player`
- 설정 흐름: `useState<EditRenderSettings>` → `composition` (useMemo) → `Player` props → 즉시 반영
- 기존 ffmpeg 백엔드 렌더: `api.generation.renderEdit` (변경 없음, M6 까지 그대로)

핸드오프 끝.
