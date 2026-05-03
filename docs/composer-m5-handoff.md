# Composer M5-M6 — 다음 세션 핸드오프

M4 (멀티트랙 오디오 + BGM) 완료. 남은 마일스톤은 M5 (오버레이 에디터) + M6 (렌더 정합).

## 진행 상황

| | 제목 | 상태 |
|---|---|---|
| M1 | 플레이어 엔진 + 실시간 프리뷰 | ✅ |
| M2 | 드래그-편집 타임라인 UI | ✅ |
| M3 | 클립별 인스펙터 + 효과 | ✅ |
| M4 | 멀티트랙 오디오 믹서 + BGM | ✅ (이번 세션) |
| M5 | 오버레이 에디터 | ⏳ |
| M6 | 렌더 정합 (preview ↔ ffmpeg) | ⏳ |

## M5 — 오버레이 에디터

### 동기
현재 오버레이는 `TimelineComposer` 의 폼에서 텍스트/씬 인덱스/시작/지속을 입력. 사용자가 마우스로 Player 화면 위에 직접 박을 수 있어야 진짜 NLE 의 자막/타이틀 편집기.

### 데이터 모델 변경

`EditOverlay` 타입 확장 (frontend/src/types/index.ts):

```ts
export interface EditOverlay {
  kind: "title" | "caption" | "sticker" | "shape" | "image";
  text?: string;
  image_url?: string;       // sticker/image kind 용
  scene_index: number;
  start: number;
  duration: number;
  // 위치/크기 — 화면 비율(0..1)로 저장해서 해상도 무관
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;        // degrees
  // 스타일
  font_family?: string;
  font_size?: number;       // 1080p 기준 px (스케일링 후 적용)
  font_weight?: number;
  color?: string;
  shadow?: string;          // CSS shadow string
  outline?: string;         // 외곽선 색
  background?: string;      // 박스 배경
  // 애니메이션
  animation_in?: "fade" | "slide_up" | "slide_left" | "scale";
  animation_out?: "fade" | "slide_down" | "slide_right" | "scale";
  animation_duration?: number;  // 진입/이탈 각 시간 (sec)
}
```

기존 필드 (`kind`, `text`, `scene_index`, `start`, `duration`) 와의 하위 호환 — 신규 필드 모두 optional 이라 깨지지 않음.

### 영구화

현재 오버레이는 `TimelineComposer` 의 메모리 state (`overlays`). M5 에서는 프로젝트 단위로 백엔드 영구화:

```python
# backend/models.py
class Project(SQLModel, table=True):
    ...
    overlays_json: Optional[str] = None  # JSON list of EditOverlay
```

라우트:
- `PUT /projects/{id}/overlays` body: `{ overlays: EditOverlay[] }` → `overlays_json` 갱신.

### 신규 컴포넌트

```
composer/overlay/
  OverlayCanvas.tsx     # Player 위 투명 SVG/HTML 레이어 — 더블클릭으로 신규 텍스트
  OverlayHandle.tsx     # 선택된 오버레이의 8방향 리사이즈 + 회전 핸들
  OverlayInspector.tsx  # 폰트/색/크기/그림자/애니메이션 인라인 편집
  overlayTrack.ts       # 타임라인 위에 오버레이 [start, end] 마크 그리기 헬퍼
  animations.ts         # animation_in/out → CSS transform/opacity 진행도 보간
```

### 인터랙션

- **빈 영역 더블클릭** → 새 텍스트 오버레이 생성 (clickPosition 으로 x,y 자동 설정, 현재 시점에서 시작, 3초 default duration).
- **오버레이 클릭** → 선택. SelectedClipInspector 자리에 OverlayInspector 가 잠시 차지 (선택 우선순위는 마지막 클릭 — 클립 선택과 상호 배타).
- **드래그** → 위치 이동. Position 은 % 단위 저장.
- **모서리 8핸들** → 리사이즈.
- **위쪽 ⊙ 핸들** → 회전.
- **Delete 키** → 삭제.
- **타임라인 행** → 오버레이마다 작은 마크 (오버레이 표시 시간 [start, end] 를 색상으로 강조). 클릭하면 해당 오버레이 선택 + 그 시점으로 seek.

### Player 의 OverlayLayer 변경

현재는 `position: absolute; left/top/transform: translateX(-50%)` 같은 정적 위치. M5 에서는:
- `style.left = x*100%`, `style.top = y*100%`, `transform: translate(-50%, -50%) rotate(<rot>deg)` 적용.
- 진입/이탈 애니메이션: 현재 시점이 `[start, start + animation_duration]` 사이면 `animation_in` 의 진행도 0..1 보간 (opacity / translate / scale 적용). 출구도 마찬가지.

### 알려진 까다로운 부분

- **편집 중 시점 처리**: 사용자가 오버레이 추가하려고 더블클릭한 시점이 그 오버레이의 `start` 가 되는데, Player 가 재생 중이면 `start` 가 매 프레임 변함. 더블클릭 순간의 `playback.state.currentTime` 을 capture 해서 사용해야 함.
- **z-index**: 다중 오버레이 겹칠 때 어느 것이 위? 입력 순서로 z 부여 가능. 인스펙터에서 "위로/아래로" 버튼 추가.
- **편집 화면의 좌표계 vs 렌더 좌표계**: Player container 가 16:9 aspect ratio 고정이라 % 좌표 그대로 ffmpeg 백엔드가 사용 가능. 실제 출력 해상도 (예: 1920×1080) 는 % * 해상도로 계산.

---

## M6 — 렌더 정합 (preview ↔ ffmpeg)

### 동기
프리뷰는 CSS filter / SVG / overlay div 로 합성. 백엔드 ffmpeg 는 별개 파이프라인. 같은 설정이 다른 결과 — 사용자 경험상 큰 단절. M3 의 8개 per-clip 필드 + M4 의 BGM 트랙 + M5 의 오버레이 위치 모두 ffmpeg 가 사용해야 함.

### 백엔드 작업

#### 1) Per-clip 트림/속도/볼륨/색감 적용

`backend/services/ffmpeg_utils.py` 의 `concat()` (또는 새 함수) 가 각 클립을 처리할 때:

```python
def build_clip_filters(scene: Scene) -> list[str]:
    filters = []
    if scene.clip_in_offset_sec:
        filters.append(f"-ss {scene.clip_in_offset_sec}")
    if scene.clip_out_offset_sec:
        filters.append(f"-to {scene.clip_out_offset_sec}")
    speed = scene.clip_speed or 1.0
    if speed != 1.0:
        filters.append(f"setpts=PTS/{speed}")
        filters.append(f"atempo={speed}")  # 음정 같이 변함, 문서화 필요
    if scene.clip_color_overlay:
        filters.append(f"lut3d=assets/luts/{scene.clip_color_overlay}.cube")
    if scene.clip_voice_volume is not None:
        # voice 트랙에만 적용 (별도 입력 stream)
        ...
    if scene.clip_sfx_volume is not None:
        # video 의 audio stream 에 적용
        filters.append(f"volume={scene.clip_sfx_volume}")
    return filters
```

#### 2) 트랜지션 정밀 적용

ffmpeg `xfade` 필터로 클립 간 cross-fade. per-boundary `out_transition_style` / `out_transition_sec` 사용:

```python
def apply_transitions(scenes: list[Scene], settings: EditRenderSettings) -> str:
    # ffmpeg filter_complex string for chained xfade
    fc = []
    for i in range(len(scenes) - 1):
        cur = scenes[i]
        style = cur.out_transition_style or settings.transition_style
        sec = cur.out_transition_sec or settings.transition_sec
        if style == "cut" or sec <= 0:
            continue
        ffmpeg_style = {
            "soft": "fade", "fade": "fade",
            "dip_to_black": "fadeblack",
            "flash": "fadewhite",
        }[style]
        fc.append(f"[v{i}][v{i+1}]xfade=transition={ffmpeg_style}:duration={sec}:offset=...")
    return ",".join(fc)
```

#### 3) BGM 믹싱

`apply_audio_mix_with_bgm()`:
- 메인 오디오 (voice + sfx 합성) 와 BGM 을 amix
- BGM 에 `volume`, `afade=t=in:d={fade_in}` / `afade=t=out:st={total-fade_out}:d={fade_out}` 적용
- BGM `loop` 옵션이면 `aloop` 필터로 반복

#### 4) 오버레이 적용

`drawtext` 또는 PNG 레이어 합성. `EditOverlay.x/y` 가 0..1 이면 ffmpeg 좌표는 `x=W*overlay.x, y=H*overlay.y`. 회전은 `rotate` 필터.

### 프런트 변경 (LUT 통일)

#### 1) DaVinci Resolve / OCIO 로 4개 색감 .cube 파일 생성

```
assets/luts/
  reference_soft.cube
  warm_room.cube
  clean_neutral.cube
  dream_blush.cube
```

#### 2) WebGL2 LUT 셰이더

```
composer/webgl/
  LUTRenderer.tsx       # <canvas> 위에 video texture + 3D LUT 매핑
  parseCube.ts          # .cube 파서 → Float32Array (size×size×size×4 RGBA)
```

`LUTRenderer` 가 `<video>` 를 텍스처로 업로드 (`gl.texImage2D(target, 0, format, video)`), 3D LUT 텍스처와 함께 fragment shader 로 매핑. Player 의 `<video>` 를 hidden 으로 두고 canvas 만 노출.

이렇게 하면 ffmpeg 의 `lut3d` 와 같은 LUT 파일을 쓰니 픽셀-정확.

### 비용

이 작업이 가장 큼 — 5-7일 추정. 핵심 어려움:
- WebGL 텍스처 매 프레임 업로드 비용 (RAF 동기 필요)
- Mobile/저사양 GPU 에서 성능 저하 가능
- LUT 정확도 (보간 방식: trilinear vs tetrahedral)
- 원본 video 디코더 → CPU 메모리 → GPU 텍스처 → 캔버스 표시 (메모리 왕복)

---

## 즉시 시작 가능한 액션

### M5 첫 30분 todo
1. `EditOverlay` 타입에 위치/스타일/애니메이션 필드 추가 (frontend/src/types/index.ts).
2. 백엔드 `Project.overlays_json` 필드 + `_ADDITIVE_MIGRATIONS` + `PUT /projects/{id}/overlays` 라우트.
3. `Player.OverlayLayer` 가 `style.left = x*100%, top = y*100%` 사용하도록 변경 (현재 정적 위치 → 동적 좌표).
4. `composer/overlay/OverlayCanvas.tsx` 신규 — Player 위 투명 div, 더블클릭 → contentEditable span 생성.

### M6 첫 30분 todo
1. DaVinci Resolve 무료판으로 `reference_soft.cube` 1개 먼저 만들기.
2. 백엔드 `apply_color_preset_lut(preset)` 함수 — `-vf lut3d=path` 만 붙임. 1개 프리셋만 먼저 동작 확인.
3. WebGL2 LUT 셰이더 데모 — video → texture → 3D LUT lookup → canvas (1개 프리셋만).

## 컨텍스트 / 진입점

- 진입점 페이지: `pages/EditStudioPage.tsx` → `components/video/TimelineComposer.tsx` → `composer/Composer.tsx` → Player + Timeline + BgmPlayer + TrackStack
- 데이터 흐름: `api.scenes.list(projectId)` + `api.projects.get(projectId)` → `buildComposition()` + `bgmUrl` → Composer
- 설정 흐름: `useState<EditRenderSettings>` (TimelineComposer) → composition (useMemo) → 즉시 반영
- per-clip 효과: Scene 의 8 개 필드 → `clipFromScene()` → `ComposerClip` → `ClipLayer.tsx`
- BGM: `Project.bgm_path` → `Composer.bgmUrl` → `BgmPlayer` 가 Web Audio 그래프의 `'bgm'` 트랙으로 라우팅
- 오디오 그래프: `composer/audio/AudioGraph.ts` 싱글턴, useAudioRoute 훅, TrackStack UI

핸드오프 끝.
