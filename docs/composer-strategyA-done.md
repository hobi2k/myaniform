# Composer — Strategy A: 픽셀-퍼펙트 색감 정합 (Done)

## 무엇을 해결했나
M6 까지 미리보기와 ffmpeg 최종 렌더링은 **다른 색감 파이프라인**을 썼다:
- **미리보기**: CSS `filter: saturate() contrast() brightness() sepia() ...` 근사치
- **최종**: ffmpeg `eq → colorbalance → curves` 정밀 필터 체인

같은 영상이 편집 화면과 export 결과에서 다르게 보이는 게 가장 큰 위험.
M6 핸드오프에서 "전략 A: LUT + ffmpeg 필터 통일" 로 거론됐던 안을 이번 라운드에 모두 구현했다.

## 어떻게 정합을 보장하나
한 개의 `.cube` 3D LUT 파일이 두 파이프라인이 모두 참조하는 single source of truth.

```
backend/services/ffmpeg_utils.py::_COLOR_FILTERS  ──┐
                                                    ▼
                            scripts/generate_color_luts.py  (offline bake)
                                                    ▼
                           assets/luts/<preset>.cube
                                                    ├──► ffmpeg lut3d=... (백엔드 prepare_clip & finish)
                                                    └──► WebGL2 sampler3D (프런트 LUTVideo)
```

ffmpeg 의 `lut3d` 필터와 WebGL2 의 `sampler3D` 모두 trilinear 보간을 쓰므로
33³ 그리드 안의 동일한 voxel 데이터로 동일 결과를 낸다.

## 새로 추가/수정된 파일

### 1. LUT bake 스크립트 — `scripts/generate_color_luts.py` (신규)
- 1089×33 identity HALD-style PNG 생성 (모든 (R,G,B) 그리드 포인트)
- 각 프리셋(`reference_soft`/`warm_room`/`clean_neutral`/`dream_blush`)마다
  ffmpeg 로 `_COLOR_FILTERS` 체인을 적용해 출력 PNG 를 얻고,
  Resolve 호환 `.cube` 파일을 `assets/luts/<preset>.cube` 에 기록.
- `LUT_3D_SIZE 33` (35,937 entries, ~948 KB / file).
- 재실행 idempotent — 필터 체인 손볼 때마다 그냥 다시 굽는다.

```bash
.venv/bin/python scripts/generate_color_luts.py
# Baking 4 preset(s) at LUT_3D_SIZE=33 → assets/luts
#   ✓ clean_neutral      → clean_neutral.cube  (947.6 KB, 2 filters)
#   ✓ dream_blush        → dream_blush.cube  (947.6 KB, 3 filters)
#   ✓ reference_soft     → reference_soft.cube  (947.7 KB, 3 filters)
#   ✓ warm_room          → warm_room.cube  (947.6 KB, 3 filters)
```

### 2. 백엔드 ffmpeg 통합 — `backend/services/ffmpeg_utils.py`
- `_lut3d_path_for(preset)` — `.cube` 가 있으면 Path, 없으면 None
- `color_filter_chain(preset)` 가 `.cube` 가 존재하면 `["lut3d='/.../<preset>.cube'"]` 반환,
  부재하면 기존 eq/colorbalance/curves 체인으로 graceful fallback
- 두 호출 지점 모두 자동 적용:
  - `prepare_clip(...)` — per-clip `color_overlay` 를 가진 씬
  - `finish_visual_novel_episode(...)` — 글로벌 `color_preset`

### 3. 정적 서빙 — `backend/main.py`, `frontend/vite.config.ts`
- FastAPI 가 `/luts` 경로로 `assets/luts/` 를 서빙
- Vite dev proxy 에 `/luts` 추가

### 4. 프런트 WebGL2 LUT 파이프라인 — `frontend/src/composer/webgl/`
| 파일 | 역할 |
|---|---|
| `parseCube.ts` | Resolve `.cube` 텍스트 → `{ size, data: Float32Array, domainMin, domainMax }`. `identityLut(size)` 도 제공. |
| `lutCache.ts` | URL 별 fetch+parse 캐시. `loadLut(url)` Promise dedupe. `lutUrlForPreset(preset)` → `/luts/<preset>.cube`. |
| `lutShaders.ts` | GLSL ES 3.00. 비디오 2D 텍스처 → per-clip sampler3D LUT → global sampler3D LUT → 출력. trilinear, edge-bias 보정. |
| `LUTVideo.tsx` | `forwardRef<HTMLVideoElement>` 컴포넌트. 내부에 숨겨진 `<video>` + 표시용 `<canvas>` 를 두고, `requestAnimationFrame` + `requestVideoFrameCallback` 으로 매 프레임 비디오 프레임을 RGBA 2D 텍스처에 업로드 후 LUT 셰이더로 그린다. WebGL2 미지원 환경에서는 `<video>` 직접 표시 + CSS `fallbackFilter` 로 graceful fallback. |

핵심 데이터 흐름 (LUTVideo 매 프레임):
```
<video>.videoFrame
  └─► texImage2D(uVideo, RGBA8)
       └─► fragment shader:
             vec3 c = texture(uVideo, vUv).rgb;
             if (uClipEnabled)   c = sampleLut3D(uLutClip,   c);
             if (uGlobalEnabled) c = sampleLut3D(uLutGlobal, c);
             outColor = vec4(c, 1.0);
       └─► <canvas> (visible)
```

3D LUT 텍스처는 `RGB16F` 로 업로드해 8bit 양자화 손실(`1/255` banding)을 피한다 — `.cube` 의 float 정밀도를 그대로 보존해야 ffmpeg 와 매치된다.

### 5. ClipLayer 통합 — `frontend/src/composer/ClipLayer.tsx`
- `<video>` 를 `<LUTVideo>` 로 교체. `videoRef` 는 그대로 forwardRef 로 받음 — `useClipSync` / `useAudioRoute` 가 변경 없이 동작.
- props 에 `globalPreset?: ColorPreset | null` 추가. 부모(Player)가 `composition.settings.color_preset` 을 내려준다.
- per-clip overlay (`clip.color_overlay`) → primary LUT, 글로벌 → secondary LUT 로 LUTVideo 에 전달.
- 정적 이미지 fallback 분기에서는 여전히 CSS `filter` 로 grade — `<video>` 가 없으니 셰이더 단계도 없음. 정확도는 떨어지지만 video 가 없는 stale 씬에선 어차피 export 전에 재생성이 필수.

### 6. Player.tsx
- 더 이상 stage 전체를 CSS `filter: gradeFilter` 래퍼로 감싸지 않는다 — LUTVideo 가 영상 픽셀에 LUT 를 직접 적용하므로 wrapper 까지 두면 **double-apply** 가 된다.
- `globalPreset` 을 모든 ClipLayer 인스턴스에 prop drill.
- vignette / grain / 자막 / overlay 는 LUT 가 적용된 캔버스 **위에** 그대로 컴포지션. ffmpeg `finish_visual_novel_episode` 의 `color → vignette → noise → subtitles` 순서와 동일한 시각적 적층.

## 검증 단계
1. **LUT 베이크 재현성**: `.venv/bin/python scripts/generate_color_luts.py` — 4개 파일 모두 947.6KB±, 35,937 entry.
2. **ffmpeg lut3d 적용 확인**:
   ```bash
   ffmpeg -y -f lavfi -i "testsrc2=64x36:rate=24:duration=0.2" \
          -vf "lut3d='/.../assets/luts/warm_room.cube'" -frames:v 1 /tmp/lut.png
   # ↳ 정상 종료, PNG 출력
   ```
3. **백엔드 라우터 import**: `from backend import main` — 100% 통과.
4. **`color_filter_chain('warm_room')`** → `["lut3d='/.../warm_room.cube'"]`.
5. **프런트 빌드**: `npm run build` — TypeScript 통과, 400KB / 119KB gzip.

## 알려진 한계 / Edge cases
- **vignette / film grain 은 여전히 ffmpeg 픽셀 vs WebGL CSS overlay** 로 처리되어 픽셀 정합 대상이 아니다. M6 핸드오프 합의대로 "그래도 색감이 정합" 이면 충분히 신뢰할 만하다고 봄.
- **stale 씬(클립 없는 키프레임 이미지)** 은 셰이더 경로를 안 거치고 CSS filter 근사로 grade — 진짜 export 전에 클립 재생성이 전제.
- **WebGL2 미지원 브라우저**: `<video>` 직접 + CSS fallback. 기능 회귀 없이 "근사" 수준으로 떨어짐.
- **`requestVideoFrameCallback` 미지원 브라우저**(Firefox 일부 버전): rAF 만으로도 매 프레임 그려서 시각적 차이는 미미. seek 시 1프레임 늦게 갱신될 수 있음.

## 후속 후보
- vignette / grain 도 셰이더 패스로 흡수 → 픽셀 정합 100% 만들기. (현 단계에선 over-engineering.)
- 사용자 정의 `.cube` 업로드 슬롯. backend StaticFiles 가 이미 `/luts` 를 노출하므로 어렵지 않다.
- LUT bake 자동화: `_COLOR_FILTERS` 가 변경된 commit 의 CI 후크에서 굽기.

## 신규 산출물 요약
```
scripts/generate_color_luts.py                        +160 lines (신규)
assets/luts/{reference_soft, warm_room, clean_neutral, dream_blush}.cube  ~948KB×4 (신규)
backend/services/ffmpeg_utils.py                      _lut3d_path_for / color_filter_chain 수정
backend/main.py                                       /luts mount 추가
frontend/vite.config.ts                               /luts proxy 추가
frontend/src/composer/webgl/parseCube.ts              +96 lines (신규)
frontend/src/composer/webgl/lutCache.ts               +50 lines (신규)
frontend/src/composer/webgl/lutShaders.ts             +56 lines (신규)
frontend/src/composer/webgl/LUTVideo.tsx              +290 lines (신규)
frontend/src/composer/ClipLayer.tsx                   LUTVideo 통합
frontend/src/composer/Player.tsx                      CSS filter 래퍼 제거 + globalPreset prop drill
```
