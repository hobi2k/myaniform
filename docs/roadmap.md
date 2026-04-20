# 구현 로드맵

> **상태 (2026-04-17)**: Phase 0~4 완료 — 플랫폼 E2E 동작 중. 현재 상태·남은 작업은 `status.md` 참고. 이 문서는 초기 설계 기록.

---

## Phase 0: 환경 구성

### ComfyUI 설치
```bash
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
pip install -r requirements.txt
```

### 커스텀 노드 설치
```bash
cd custom_nodes

# 핵심 (필수)
git clone https://github.com/kijai/ComfyUI-WanVideoWrapper
git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite
git clone https://github.com/kijai/ComfyUI-MMAudio
git clone https://github.com/GeekyGhost/ComfyUI_Geeky_AudioMixer
git clone https://github.com/ShmuelRonen/ComfyUI_Qwen3-TTS     # (노드 구현체 확인 후 교체 가능)
git clone https://github.com/ShmuelRonen/ComfyUI-FishAudioS2   # (구현체 확인 후 교체 가능)
git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus
git clone https://github.com/rgthree/rgthree-comfy
git clone https://github.com/kijai/ComfyUI-KJNodes
git clone https://github.com/city96/ComfyUI-GGUF
git clone https://github.com/yuvraj108c/ComfyUI-Whisper        # Audio 관련
git clone https://github.com/spacepxl/ComfyUI-Image-Filters

# 선택
git clone https://github.com/Fannovel16/ComfyUI-Frame-Interpolation  # RIFE VFI
git clone https://github.com/huchenlei/ComfyUI_layerstyle
git clone https://github.com/crystian/ComfyUI-Crystools
```

### 모델 다운로드
`docs/models-and-nodes.md` 목록 참조. 우선순위:
1. Wan2.2 S2V 14B (fp8) + Audio Encoder → S2V 립싱크
2. Wan2.2 TI2V 5B → 루프
3. Dasiwa SDXL 체크포인트 → 이미지 생성
4. QWEN3-TTS 1.7B → TTS
5. MMAudio 모델 세트 → SFX
6. IP-Adapter FaceID SDXL → 캐릭터 일관성

---

## Phase 1: 단일 장면 워크플로우 제작 및 검증

### 1-1. ws_lipsync.json

**검증 기준**:
- 한국어 TTS 음성 → S2V 입력 → 입 모양 일치 여부
- Dasiwa 파인튜닝 S2V 모델의 애니 캐릭터 품질
- GeekyAudioMixer TTS+SFX 믹싱 결과
- QWEN3 ↔ S2Pro 전환 스위치 정상 동작

**핵심 이슈 예상**:
```
오디오 길이 → 프레임 수 자동 계산:
  JWInteger + MathExpression으로
  audio_length_sec × fps = num_frames
  → KSamplerAdvanced 또는 WanSoundImageToVideo에 주입
```

### 1-2. ws_loop.json

**검증 기준**:
- WanFirstLastFrameToVideo: 동일 start/end 이미지 → 씨임리스 루프 여부
- SmoothMix vs livewallpaper LoRA 모션 비교
- RIFE VFI 보간 후 이음새 자연스러움

### 1-3. ws_effect.json

**검증 기준**:
- WanVideoSLG 강도에 따른 이펙트 과장 수준
- AniEffect LoRA trigger word 확인 (triggerword.txt 참조)
- MMAudio 임팩트음 타이밍

---

## Phase 2: 캐릭터 준비 워크플로우

### ws_char_create.json (텍스트 → 캐릭터)

CharacterCreator 또는 SDXL KSampler로 텍스트 설명에서 캐릭터 생성.  
다각도 얼굴 추출 → IP-Adapter FaceID 입력용 레퍼런스 준비.

### ws_char_clone.json (이미지 → 클론)

LoadImage → IP-Adapter FaceID SDXL 바로 주입.  
추가 얼굴 정제 필요 시 comfyui-rmbg로 배경 제거 후 사용.

---

## Phase 3: ws_concat.json (A안 마무리)

A안 전용. 생성된 클립들을 ComfyUI 안에서 연결.

```
VHS_LoadVideo (scene_001)
VHS_LoadVideo (scene_002)
VHS_LoadVideo (scene_003)
...
    ↓
ImageBatchMulti (프레임 합산)
    ↓
VHS_VideoCombine (단순 연결)
  or
RIFE 보간 (전환 근사)
    ↓ final.mp4
```

**A안 완성 기준**: 사용자가 ComfyUI만으로 1~N장면 영상을 만들 수 있음.

---

## Phase 4: B안 — Python 오케스트레이터 + Gradio

### 개발 항목

```
orchestrator.py      ComfyUI API 호출, WebSocket 폴링
workflow_patcher.py  장면 JSON → 워크플로우 노드 패칭
ffmpeg_utils.py      xfade 전환, 오디오 믹싱
app.py               Gradio UI
```

### 워크플로우 패칭 노드 ID 확정

Phase 1~2에서 워크플로우 제작 완료 후,  
각 워크플로우 JSON의 노드 ID를 확인해 `workflow_patcher.py`의 매핑 테이블 작성.

```python
# 워크플로우 JSON에서 노드 ID 확인 방법
import json
wf = json.load(open("workflows/ws_lipsync.json"))
for node_id, node in wf.items():
    if isinstance(node, dict) and "class_type" in node:
        print(node_id, node["class_type"])
```

### B안 완성 기준

```
Gradio 앱 실행 → 캐릭터 이미지 업로드 → JSON 입력 →
"생성" 버튼 클릭 → 진행 표시 → 최종 영상 다운로드
```

---

## 위험 요소 및 대응

| 위험 | 대응 |
|------|------|
| Dasiwa S2V 파인튜닝 모델 입수 불가 | 공식 Wan2.2 S2V fp8로 대체 |
| 한국어 S2V 립싱크 품질 미흡 | AudioCropProcessUTK로 오디오 전처리 |
| QWEN3-TTS 노드 구현체 버전 충돌 | 여러 노드 중 동작하는 것 확인 후 고정 |
| WanFirstLastFrameToVideo 씨임리스 실패 | TI2V 대신 I2V + 루프 LoRA로 대체 |
| GeekyAudioMixer 없음 | ffmpeg amix 필터로 대체 or 다른 믹서 노드 |
| S2V와 I2V 모델 동시 VRAM 적재 | easy cleanGpuUsed로 순차 언로드 |

---

## 최종 산출물

```
A안:
  workflows/
    ws_char_create.json
    ws_char_clone.json
    ws_lipsync.json
    ws_loop.json
    ws_effect.json
    ws_concat.json

B안:
  app.py
  orchestrator.py
  workflow_patcher.py
  ffmpeg_utils.py
  config.py
  + A안 워크플로우 공유 사용
```
