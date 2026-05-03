# Composer M4-M6 — 다음 세션 핸드오프

M3 (per-clip 인스펙터 + 효과) 완료. 남은 마일스톤은 M4-M6.

## 진행 상황

| | 제목 | 상태 |
|---|---|---|
| M1 | 플레이어 엔진 + 실시간 프리뷰 | ✅ |
| M2 | 드래그-편집 타임라인 UI | ✅ |
| M3 | 클립별 인스펙터 + 효과 | ✅ (이번 세션) |
| M4 | 멀티트랙 오디오 믹서 | ⏳ |
| M5 | 오버레이 에디터 | ⏳ |
| M6 | 렌더 정합 (preview ↔ ffmpeg) | ⏳ |

## M4 — 멀티트랙 오디오 믹서

### 동기
M3 까지는 `<video>` 의 자체 오디오 + `<audio>` 의 voice_path 두 element 의 단순 element.volume 으로 끝. 진짜 NLE 라면:
- 트랙별 미터 (피크 표시)
- 페이드인/아웃 곡선
- 음정 보존 속도 (pitch-preserved time stretch)
- 트랙 mute/solo
- 프로젝트 단위 BGM 트랙 (현재 구조에 없음)
- 라우드니스 정규화 미리보기 (loudness LUFS 측정)

### 구조
```
composer/
  audio/
    AudioGraph.ts        # AudioContext 싱글턴 + 트랙 등록/해제
    useAudioTrack.ts     # element → MediaElementAudioSourceNode → GainNode → Destination
    LevelMeter.tsx       # AnalyserNode 로 RMS/Peak 표시 (canvas 그리기)
    fadeCurve.ts         # 페이드 곡선 (linear / equal-power / log)
  TrackStack.tsx         # Player 아래 트랙 UI 스택 — Voice / SFX / BGM 행
```

### Web Audio 그래프
```
<video>   ──MediaElementSourceNode──┐
                                    ├─→ sfxGain ─┐
<audio voice> ─MediaElementSourceNode─→ voiceGain ─┼─→ masterGain ─→ destination
                                                    │
<audio bgm> ───MediaElementSourceNode─→ bgmGain ─────┘
```

각 GainNode 는 `useAudioTrack` 이 트랙 단위로 들고 있고 `setVolume(v, atTime)` 으로 곡선 자동화. 페이드는 `gain.linearRampToValueAtTime()`.

### 백엔드 변경
- 프로젝트 단위 BGM:
  - `Project` 모델에 `bgm_path: Optional[str]` 추가
  - `POST /projects/{id}/bgm/upload` — mp3/wav 업로드
  - `EditRenderSettings` 에 `bgm_volume`, `bgm_loop`, `bgm_fade_in/out` 추가
- 라우드니스: 프로젝트 단위 측정값 캐시 (`Project.measured_lufs`).

### 구현 포인트
- AudioContext.resume() 은 사용자 제스처 직후에만 가능. Player 의 첫 play 클릭에서 `AudioGraph.ensureRunning()` 호출.
- video 의 audio 를 Web Audio 에 라우팅하면 element.volume 은 무시되고 GainNode 가 권위. `useClipSync` 의 `volume` 옵션은 GainNode 로 전달하는 형태로 변경 필요.
- 음정 보존: 단기적으로는 SoundTouch.js (WASM) 통합. AudioWorklet 으로 처리. 0.7~1.5x 범위에선 좋고 극단치에선 아티팩트.

### 트랙 UI
```
[● solo] [♪ Voice]  ━━━━━━━━━━━━ -3dB ━━━━━━━━ ━━ ━ (level meter)
[● solo] [♪ SFX]    ━━━━━━━━━━━━━━━━━━━━━━ -6dB
[● solo] [♪ BGM]    ━━━━━━━━━ -12dB
```
좌측 mute/solo 토글, 가운데 볼륨 슬라이더, 우측 실시간 미터.

---

## M5 — 오버레이 에디터

### 동기
현재 오버레이는 `TimelineComposer` 의 폼에서 텍스트/씬 인덱스/시작/지속 입력. Premiere/CapCut 처럼 Player 화면 위에 직접 박는 게 자연스러움.

### 구조
```
composer/
  overlay/
    OverlayCanvas.tsx     # Player 위 투명 SVG/HTML 레이어 — 더블클릭으로 새 텍스트 추가
    OverlayHandle.tsx     # 선택된 오버레이의 8방향 리사이즈 핸들 + 회전 핸들
    OverlayInspector.tsx  # 폰트/색/크기/그림자 인라인 편집 (선택된 오버레이 따라 갱신)
    overlayTrack.ts       # 오버레이의 시간 [start, end] 를 Timeline 에 작은 마크로 그리는 헬퍼
```

### 백엔드 변경
오버레이는 현재 `EditRenderSettings.overlays: EditOverlay[]` 로 전달만 됨. 영구화하려면:
- `Project.overlays_json: Optional[str]` 또는
- `Scene.overlays_json` (scene-bound 오버레이만)

전자가 깔끔. 별도 라우트 `PUT /projects/{id}/overlays`.

### EditOverlay 타입 확장
```ts
export interface EditOverlay {
  kind: "title" | "caption" | "sticker" | "shape" | "image";
  text?: string;
  image_url?: string;
  scene_index: number;
  start: number;
  duration: number;
  // 위치/크기 (% of screen)
  x: number;       // 0..1
  y: number;       // 0..1
  width?: number;  // optional, default auto
  height?: number;
  rotation?: number; // degrees
  // 스타일
  font_family?: string;
  font_size?: number;
  font_weight?: number;
  color?: string;
  shadow?: string;
  outline?: string;
  background?: string;
  // 애니메이션
  animation_in?: "fade" | "slide_up" | "slide_left" | "scale";
  animation_out?: "fade" | "slide_down" | "slide_right" | "scale";
}
```

### 인터랙션
- Player 위 더블클릭 → 텍스트 입력 시작 (cursor 등장).
- 기존 오버레이 클릭 → 선택, 우측에 OverlayInspector 가 SelectedClipInspector 자리를 잠시 차지 (선택 우선순위는 마지막 클릭).
- 드래그 → 위치 이동 (% 기준으로 저장해서 해상도 무관).
- 모서리 핸들 → 리사이즈.
- 회전 핸들 (위쪽 +20px) → 회전.
- Delete 키 → 삭제.

---

## M6 — 렌더 정합 (preview ↔ ffmpeg)

### 동기
현재:
- 프리뷰는 CSS filter / SVG noise / overlay div 로 합성.
- ffmpeg 백엔드는 `eq=` / `colorbalance=` / `curves=` / `drawtext=` 로 별개 파이프라인.
- 같은 `color_preset = warm_room` 이라도 결과가 다름.

### 해결 — 3D LUT 통일
1. DaVinci Resolve 또는 OCIO 로 4개 색감 프리셋의 3D LUT (.cube) 만들기.
2. 백엔드 ffmpeg: `-vf lut3d=warm_room.cube` 적용 (기존 `eq` 등 대체).
3. 프런트: WebGL2 컨텍스트로 같은 .cube 파일을 sampler3D 텍스처에 업로드, fragment shader 가 video 픽셀을 LUT 매핑.
4. vignette/grain 은 똑같이 백엔드도 ffmpeg `vignette=` / `noise=` 필터로 통일.

### 구조
```
assets/luts/
  reference_soft.cube
  warm_room.cube
  clean_neutral.cube
  dream_blush.cube

composer/
  webgl/
    LUTRenderer.tsx       # <canvas> + WebGL2 + video texture upload + LUT shader
    parseCube.ts          # .cube 파일 파서 → 3D 배열
backend/services/
  ffmpeg_utils.py         # apply_color_preset_lut(preset) → -vf lut3d=...
```

### 트림/속도/볼륨/per-clip 색감 백엔드 적용
M3 가 추가한 8개 필드를 ffmpeg 렌더가 실제로 사용하도록:
- `clip_in_offset_sec` / `clip_out_offset_sec` → `-ss in -t (out-in)` 추가.
- `clip_speed` → `setpts=PTS/SPEED, atempo=SPEED` 필터 (음정 변경; pitch-preserved 옵션은 rubberband).
- `clip_voice_volume` / `clip_sfx_volume` → ffmpeg `volume=` 필터를 트랙별로.
- `clip_color_overlay` → 클립 단위 `lut3d=` 추가 chain.
- `out_transition_style` / `out_transition_sec` → 인접 클립 사이 ffmpeg `xfade=duration=X:offset=Y` 또는 `acrossfade` 정밀 적용.

### 어려운 부분
- WebGL 텍스처 매 프레임 업로드 (`gl.texImage2D(...video)`) 는 비싸지만 RAF 동기로 충분함. mobile/저사양 GPU 에선 느림.
- LUT 정확도: .cube 파일의 보간 방식 (trilinear vs tetrahedral) 이 ffmpeg 와 셰이더에서 같아야 1:1.
- 프리뷰 `<video>` 는 이미 디코더가 들어있어서 추가 WebGL 합성하면 GPU↔CPU 왕복 발생. 픽셀-동일 보장하려면 어쩔 수 없음.

---

## 즉시 시작 가능한 액션 (다음 세션 첫 30분)

### M4 첫 30분 todo
1. `composer/audio/AudioGraph.ts` 스켈레톤 — singleton AudioContext, `connectElement(el, kind)` API, `setGain(kind, value, atTime)`.
2. `composer/audio/useAudioTrack.ts` — useEffect 로 element 등록/해제, useClipSync 와 별도 훅.
3. `Player` 가 첫 재생 클릭에서 `AudioGraph.ensureRunning()` 호출.
4. 단계적: 먼저 Voice 트랙만 Web Audio 로 라우팅, 다른 element 는 기존대로. 동작 확인 후 SFX/BGM 확장.

### M5 첫 30분 todo
1. `EditOverlay` 타입에 위치(x,y) + 스타일 필드 추가.
2. `Player` 의 `OverlayLayer` 가 `style.left = x*100%, top = y*100%` 사용하도록 변경.
3. `OverlayCanvas` 신규 — Player 위 투명 div, 더블클릭 → contentEditable span 생성 → blur 시 새 EditOverlay 객체로 저장.

### M6 첫 30분 todo
1. DaVinci Resolve 무료 버전 + `Lut Generator` 로 reference_soft.cube 만들기 (1개 먼저).
2. 백엔드 `apply_color_preset_lut(preset)` 함수 — `-vf lut3d=path` 만 붙임.
3. WebGL2 LUT 셰이더 미니 데모 (1개 프리셋만, video → texture → 3D LUT lookup → canvas 출력).

## 컨텍스트 / 진입점

- 진입점 페이지: `pages/EditStudioPage.tsx` → `components/video/TimelineComposer.tsx` → `composer/Composer.tsx` → `composer/Player.tsx` + `composer/Timeline.tsx`
- 데이터 흐름: `api.scenes.list(projectId)` → `buildComposition()` → `Composer` props
- 설정 흐름: `useState<EditRenderSettings>` → `composition` (useMemo) → `Composer` → `Player` 즉시 반영
- per-clip 효과: `Scene` 의 8개 필드 → `clipFromScene()` → `ComposerClip` → `ClipLayer.tsx` 가 적용
- ffmpeg 백엔드 렌더: `api.generation.renderEdit` (M6 까지 미정합)

핸드오프 끝.
