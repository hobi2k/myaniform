# Composer M6 — 다음 세션 핸드오프

M5 (오버레이 에디터) 까지 모두 완료. 마지막 마일스톤 M6 — **렌더 정합** (preview ↔ ffmpeg 픽셀-정확 매칭) 만 남음.

## 진행 상황

| | 제목 | 상태 |
|---|---|---|
| M1 | 플레이어 엔진 + 실시간 프리뷰 | ✅ |
| M2 | 드래그-편집 타임라인 UI | ✅ |
| M3 | 클립별 인스펙터 + 효과 | ✅ |
| M4 | 멀티트랙 오디오 믹서 + BGM | ✅ |
| M5 | 오버레이 에디터 (마우스 박기) | ✅ |
| M6 | 렌더 정합 (preview ↔ ffmpeg) | ⏳ |

## M6 — 렌더 정합 — 무엇이 어긋나 있나

현재 프리뷰는 자체 NLE 가 모두 표현하지만, 백엔드 `api.generation.renderEdit` 는 옛 ffmpeg 파이프라인 그대로라 다음 신규 데이터를 **무시**:

### 무시되는 신규 필드

**Scene (per-clip M3)**
- `clip_in_offset_sec / clip_out_offset_sec` (트림)
- `clip_speed`
- `clip_voice_volume / clip_sfx_volume`
- `out_transition_style / out_transition_sec` (per-boundary)
- `clip_color_overlay`

**Project (M4)**
- `bgm_path`
- `EditRenderSettings.bgm_volume / bgm_loop / bgm_fade_in / bgm_fade_out`

**Project (M5)**
- `overlays_json` 의 신규 필드 (x/y/rotation/font_size/color/outline/shadow/background/animation_*)
  - 옛 폼 기반 (kind+text+scene_index+start+duration) 만 부분 적용 가능

### 추가로 어긋나는 부분

- **색감 정합**: 프리뷰 CSS filter (saturate/contrast/brightness/sepia/hue-rotate) ≠ ffmpeg `eq=/colorbalance=/curves=` 의 결과. 프리뷰에서 본 톤이 최종에는 다르게 나옴.
- **vignette/grain**: 프리뷰는 SVG noise + radial gradient. ffmpeg 는 `vignette=`/`noise=` 필터.
- **트랜지션**: 프리뷰는 opacity/black/white/translate. ffmpeg 는 `xfade=transition=...` (다른 보간 곡선).

## 해결 전략 — 두 갈래

### 전략 A: 정합 우선 (LUT + ffmpeg 필터 통일)

**목표**: 프리뷰 = 최종 렌더 픽셀 동일.

**프리뷰 변경**
1. 색감을 CSS filter 에서 **3D LUT (.cube)** 기반으로 통일.
2. 새 컴포넌트 `composer/webgl/LUTRenderer.tsx` — `<canvas>` + WebGL2.
   - `<video>` 를 텍스처로 매 프레임 업로드 (`gl.texImage2D(target, 0, format, video)`).
   - LUT (32×32×32 RGB) 를 sampler3D 로.
   - Fragment shader 가 video 색상 → LUT lookup → canvas 출력.
3. ClipLayer 의 `<video>` 를 `display:none` 으로 두고 LUTRenderer canvas 만 화면 노출.
4. Color overlay 도 LUT chain: 글로벌 LUT → 클립 단위 LUT → 출력.

**백엔드 변경**
1. `assets/luts/` 에 4개 프리셋 (.cube) 파일 두기 — DaVinci Resolve / OCIO 로 생성.
2. `backend/services/ffmpeg_utils.py` 에 `apply_color_preset_lut(preset)` 추가 — `-vf lut3d=path` 만 붙임. 기존 `eq=/colorbalance=` 경로 대체.
3. vignette/grain 도 동일한 ffmpeg 필터 (`vignette`, `noise=alls=N`) 로 통일하고 프리뷰의 SVG 노이즈를 같은 noise pattern 으로 시드 매칭.

**비용**: 5-7일. 어려움:
- WebGL 텍스처 매 프레임 업로드 비용 (mobile/저사양 GPU 에서 60fps 보장 안 됨)
- LUT 정확도 (보간 trilinear vs tetrahedral) 가 ffmpeg 와 1:1
- video → CPU 메모리 → GPU 텍스처 → canvas 의 GPU↔CPU 왕복 비용

### 전략 B: 데이터 우선 (ffmpeg 가 신규 필드 모두 사용)

**목표**: 색감은 비슷하기만 하면 OK. 신규 데이터 (트림/속도/볼륨/per-boundary 트랜지션/per-clip 색감/BGM/오버레이 위치+애니) 가 ffmpeg 결과에 정확히 반영되도록.

**백엔드 변경**

1. **트림/속도** (per-clip): `concat` 전에 각 입력에 `-ss in -to out` + `setpts=PTS/SPEED, atempo=SPEED` 적용.

2. **클립 단위 볼륨**: 트랙별 입력 stream 분리 후 `volume=` 필터.

3. **per-boundary 트랜지션**: ffmpeg `xfade` filter_complex chain. 각 boundary 마다 outgoing clip 의 `out_transition_sec/style` 사용.

4. **per-clip 색감 오버레이**: 각 클립 입력 chain 끝에 `lut3d=clip_overlay.cube` (또는 글로벌과 합성된 LUT) 추가.

5. **BGM 트랙 믹싱**: `apply_audio_mix_with_bgm()` — voice + sfx + BGM 을 amix. BGM 에 `volume`, `afade=t=in:d=fade_in`, `afade=t=out:st=total-fade_out:d=fade_out`. `bgm_loop` 면 `aloop`.

6. **오버레이 (M5 신규 필드)**:
   - `kind=title/caption/sticker` → `drawtext` (font 등록 필요)
   - 좌표: `x=W*overlay.x, y=H*overlay.y - text_h/2`
   - 회전: ffmpeg 자체적으로 drawtext 회전 안 됨 → PNG 레이어로 pre-render 후 `overlay=rotate=...:enable='between(t,start,end)'`
   - 애니메이션 (fade/slide/scale): `enable=` 와 `alpha=if(...)` expression 으로 진입/이탈 보간 — 또는 PNG sequence 로 풀어서 합성

**프리뷰 변경**: 거의 없음. 현재 코드 그대로.

**비용**: 7-10일. 어려움:
- ffmpeg `xfade` 가 모든 transition_style 지원 안 함 (e.g., 'flash' 직접 매핑 안 됨 → fadewhite 로 근사)
- drawtext 의 한글 폰트 경로/렌더 (font 레지스트리 필요)
- 오버레이 회전 + 애니메이션 = `overlay` filter 의 expression 한계로 PNG pre-render 가 사실상 필수
- 다중 입력 stream 의 filter_complex 표현이 길고 복잡 (디버깅 난이도)

### 추천

전략 B 부터 → 전략 A 는 별도 future work. 사용자가 "같은 데이터로 비슷하게 나온다" 를 먼저 보장한 후 색감 픽셀 정합은 advanced 로.

## 즉시 시작 가능한 액션 — 전략 B 첫 30분 todo

1. `backend/routers/generation.py` 의 `renderEdit` 핸들러 찾고 어떤 함수가 ffmpeg 파이프라인을 짜는지 확인 (현재 `concat()` / `finish_visual_novel_episode()` 등).
2. `Scene.clip_in_offset_sec / clip_out_offset_sec / clip_speed` 만 먼저 적용 — `-ss` `-to` `setpts/atempo`. 단순 케이스: 트림된 단일 클립이 그대로 잘려 나오는지 검증.
3. 그 다음 `clip_voice_volume / clip_sfx_volume` 적용.
4. BGM 단순 amix (loop/fade 미적용) 먼저.
5. 오버레이는 M5 데이터를 옛 형태로 다운컨버트해서 임시 적용 (위치/스타일 무시) → 이후 정밀.

각 단계마다 짧은 mp4 출력해서 시각 검증.

## 컨텍스트 / 진입점

- 진입점: `pages/EditStudioPage.tsx` → `components/video/TimelineComposer.tsx` → `composer/Composer.tsx` → Player + Timeline + BgmPlayer + TrackStack + OverlayCanvas
- 데이터 흐름:
  - Scenes: `api.scenes.list(projectId)` → `buildComposition()` → composition.clips (per-clip 효과 모두 포함)
  - BGM: `Project.bgm_path` → `Composer.bgmUrl`
  - Overlays: `Project.overlays_json` → parseOverlays → composition.overlays
- 백엔드 렌더 진입: `api.generation.renderEdit(projectId, EditRenderSettings)` → POST `/projects/{id}/generate/render_edit`

핸드오프 끝.
