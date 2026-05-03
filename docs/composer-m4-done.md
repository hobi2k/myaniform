# Composer M4 — 완료 보고

Web Audio API 기반 멀티트랙 오디오 믹서 + 프로젝트 단위 BGM 트랙. 모든 클립 오디오가 단일 그래프로 라우팅되어 트랙별 mute/solo/볼륨/실시간 레벨미터 동작.

## 결과물

신규 파일:

```
composer/audio/
  AudioGraph.ts         # Web Audio 싱글턴 — element → elementGain → trackGain → master → destination
                        #   + 트랙별 AnalyserNode, mute/solo 상태 머신
  useAudioRoute.ts      # 엘리먼트 라우팅 훅 + 트랙 상태 구독 훅 (useTrackState)
  BgmPlayer.tsx         # 프로젝트 BGM <audio> 마운트 + 마스터 시간에 sync, fade in/out 자동
  LevelMeter.tsx        # canvas + AnalyserNode 로 RMS/Peak 실시간 미터, dB 마커 포함
  TrackStack.tsx        # Voice / SFX / BGM 3행 믹서 UI (M/S/볼륨/dB/level meter)
```

수정된 파일:

```
backend/models.py                    # Project.bgm_path, Project.measured_lufs
backend/database.py                  # _ADDITIVE_MIGRATIONS: project.bgm_path/measured_lufs
backend/routers/projects.py          # POST /bgm/upload, DELETE /bgm
frontend/src/types/index.ts          # Project.bgm_path/measured_lufs, EditRenderSettings.bgm_*
frontend/src/api/index.ts            # api.projects.uploadBgm, deleteBgm
composer/Composer.tsx                # BgmPlayer + TrackStack 마운트, bgmUrl prop
composer/Player.tsx                  # 첫 재생 시 audioGraph.ensureRunning() 호출 (사용자 제스처)
composer/useClipSync.ts              # 라우팅된 element 는 audioGraph.setElementGain 사용
composer/ClipLayer.tsx               # video → 'sfx' 트랙, audio → 'voice' 트랙 라우팅
components/video/TimelineComposer.tsx
                                     # 프로젝트 query 추가, BGM 업로드/제거 mutation,
                                     # 우측 카드: BGM 업로드 + 볼륨/loop/fade in/out 옵션
```

## 신호 흐름 (오디오 그래프)

```
                  ┌──> trackAnalyser (level meter)
                  │
video element ── elementGain ── trackGain[sfx]    ┐
                                                  │
voice <audio> ── elementGain ── trackGain[voice]  ├── masterGain ── destination (스피커)
                                                  │
BGM <audio> ──── elementGain ── trackGain[bgm]    ┘
```

각 단계의 GainNode 가 역할:
- **elementGain**: 클립 단위 볼륨 (per-clip `clip_voice_volume` / `clip_sfx_volume`, BGM 의 fade envelope)
- **trackGain**: 트랙 단위 볼륨 + mute/solo (TrackStack UI 가 직접 조작)
- **masterGain**: 글로벌 게인 (현재는 항상 1.0, M6 에서 LUFS 정규화 자동 조정 예정)

## 트랙 동작

### Voice 트랙
- 씬마다 `voice_path` 가 있으면 `<audio>` element 를 `'voice'` 트랙으로 라우팅
- 클립 단위 볼륨: `clip.voice_volume` (M3 의 SelectedClipInspector 슬라이더)
- 트랙 단위: TrackStack 의 Voice 행 슬라이더

### SFX 트랙
- 씬 클립 비디오의 자체 오디오 (s2v 의 baked voice + i2v 의 mmaudio mixed SFX 등)
- 클립 단위 볼륨: `clip.sfx_volume`

### BGM 트랙
- 프로젝트 단위 (`Project.bgm_path`) — 프로젝트당 1개 BGM
- BgmPlayer 가 마스터 시간에 sync. `bgm_loop` true 면 BGM 길이 < 영상 길이일 때 모듈로로 wrap
- Fade envelope: `bgm_fade_in/out` 으로 시작/끝 자동 페이드
- 클립 단위 게인 = `bgm_volume * fadeMultiplier`, 매 프레임 갱신
- 트랙 단위 (TrackStack): 다른 트랙과 동일

## Mute/Solo 의미

`audioGraph._applyState()` 가 매 변경 시:
1. 현재 솔로 활성 트랙이 하나라도 있는지 확인 (`anySolo`)
2. 각 트랙의 effective gain:
   - solo 가 켜진 트랙들 중 하나라면 `volume`
   - solo 가 켜진 트랙이 있는데 자기는 솔로 아니면 `0`
   - 솔로 없는 모드면 `mute ? 0 : volume`
3. `linearRampToValueAtTime(target, currentTime + 0.04)` 로 부드럽게 전환 (zipper noise 방지)

## 사용자 제스처 처리

브라우저 자동재생 정책상 AudioContext 는 사용자 제스처 직후에만 resume 가능. Player 의 ▶ 버튼 클릭과 Space 키 토글에서 `audioGraph.ensureRunning()` 호출. 이후 routed elements 가 정상적으로 destination 으로 출력.

## 알려진 한계

1. **렌더 정합 미동기** — 백엔드 ffmpeg `renderEdit` 는 BGM 파일을 모름. 파라미터(`bgm_volume`, `bgm_fade_*`) 는 `EditRenderSettings` 에 들어가지만 백엔드에서 사용되려면 `apply_audio_mix_with_bgm()` 추가 필요. M6 영역.
2. **음정 보존 속도 변경 없음** — `clip_speed` 가 element.playbackRate 로만 적용되어 chipmunk effect. SoundTouch.js / RubberBand WASM 통합은 별도 작업.
3. **레벨미터 DPR 처리** — 캔버스가 device pixel ratio 무시. 고해상도 디스플레이에서 살짝 흐릿할 수 있음. 픽셀 정밀도 필요하면 추후 보정.
4. **BGM 1개만** — 프로젝트당 BGM 트랙 1개. 챕터마다 다른 BGM 같은 케이스는 추후 멀티 BGM 트랙으로 확장 가능 (Scene 에 bgm_track_index 추가).
5. **MediaElementSource 영구 결합** — Web Audio 스펙상 한 번 라우팅된 element 는 unroute 불가. 컴포넌트 unmount 시 elementGain 만 disconnect 하고 source 는 garbage 방치 (브라우저가 element 함께 GC).
6. **CORS audio** — element 가 다른 origin 에서 로드되면 createMediaElementSource 가 거부할 수 있음. 현재 모든 자산이 같은 origin 이라 OK.

## 빌드 결과

- TypeScript: clean
- Vite production build: 377KB JS / 112KB gzip
- 모든 기존 페이지 정상 동작
