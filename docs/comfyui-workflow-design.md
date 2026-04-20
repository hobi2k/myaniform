# ComfyUI 워크플로우 설계

## 핵심 원칙

기존 워크플로우들을 **결합/확장**하는 방식으로 개발.
새로 만들기보다 검증된 구조를 이어 붙임.

---

## 워크플로우 1: 립싱크 장면 (S2V + TTS + MMAudio)

### 결합할 기존 워크플로우
- S2V 구조: `Wan2.2-S2V_ Audio-Driven Video Generation.json`
- TTS+SFX+Mixer: `MoanForge – MMAudio SFW+NSFW Audio Enhancer w_ Qwen TTS v1.1.json`

### 노드 플로우

```
[LoadImage: character_bg_composite]
        │
        ▼
[WanSoundImageToVideo]
  model: DasiwaWan2214BS2V_littledemonV2 or sassycatV1
  audio: ─────────────────────────────────────────────┐
                                                       │
[Qwen3Loader]                                          │
        │                                              │
[Qwen3VoiceClone / Qwen3VoiceDesign]                  │
  text: "어머, 이렇게 오실 줄 몰랐어요."               │
  ref: voices/chara_ref.wav                            │
        │ (WAV audio)                                  │
        ▼──────────────────────────────────────────────┘
[WanSoundImageToVideo]
        │ (video frames)
        ▼
[MMAudioSampler]
  model: mmaudio_large_44k_nsfw_gold
  prompt: "indoor ambience, soft breathing"
  input: video frames 참조
        │ (sfx audio)
        ▼
[GeekyAudioMixer]
  audio_1: TTS 음성 (볼륨: 1.0)
  audio_2: MMAudio SFX (볼륨: 0.3~0.5)
        │ (mixed audio)
        ▼
[VHS_VideoCombine]
  video: S2V 출력
  audio: 믹싱된 오디오
  → scene_N_lipsync.mp4
```

### 중요 설정값

```
WanSoundImageToVideo:
  UNETLoader → DasiwaWan2214BS2V_* 모델
  AudioEncoderLoader → AudioEncoderEncode 연결
  KSamplerAdvanced: steps=20, cfg=4.5~6.0
  해상도: 832×480 (가로) or 480×832 (세로)
  길이: TTS 오디오 길이 기준 자동 계산
        → JWInteger + MathExpression 활용 (기존 워크플로우 방식)
```

---

## 워크플로우 2: 루프 장면 (TI2V + MMAudio)

### 결합할 기존 워크플로우
- 루프: `동영상 루프 워크플로우.json`
- SFX: MMAudio 파트만 추출

### 노드 플로우

```
[이미지 생성]
  UNETLoader: Dasiwa Illustrious Anime 체크포인트
  KSamplerAdvanced → VAEDecode → start_image
        │
        ▼
[WanFirstLastFrameToVideo]
  model: Wan2_2-TI2V-5B
  start_image: 생성된 이미지
  end_image: 동일 이미지 (= 씨임리스 루프)
  LoRA: SmoothMixAnimation_High or livewallpaper_wan22
  prompt: "gentle ambient motion, curtain swaying"
  frames: 81 (3.4초 @ 24fps)
        │
        ▼
[RIFE VFI]  ← 선택 (프레임 보간으로 부드럽게)
  multiplier: 2x
        │
        ▼
[MMAudioSampler]
  prompt: "quiet room, breeze, ambient"
        │
        ▼
[GeekyAudioMixer] → BGM이 있으면 믹싱
        │
[VHS_VideoCombine] → scene_N_loop.mp4
```

---

## 워크플로우 3: 이펙트 장면 (AniEffect LoRA)

### 결합할 기존 워크플로우
- `2D+animation+effects.json`

### 노드 플로우

```
[LoadImage: scene_base]
        │
        ▼
[WanVideoModelLoader: Wan2.2 I2V 14B High/Low]
[WanVideoLoraSelect: 2D_animation_effects_high_noise]
[WanVideoSetLoRAs]
        │
[WanVideoTextEncode: 이펙트 설명 프롬프트]
[WanVideoImageToVideoEncode]
        │
[WanVideoSLG]  ← Skip Layer Guidance (이펙트 강화)
[WanVideoSampler]
        │
[WanVideoDecode]
        │
        ▼
[MMAudioSampler]
  prompt: "anime impact, whoosh, dramatic sting"
  볼륨: 높게
        │
[VHS_VideoCombine] → scene_N_effect.mp4
```

---

## 멀티샷 통합 구조

### 기존 `SVI-Wan22-1210-4/10-Clips.json` 방식 활용

기존 멀티클립 워크플로우는 VACE 방식으로 전 장면 끝 프레임 → 다음 장면 시작 프레임을 이어주는 구조.

**단, S2V는 별도 흐름이므로 병렬 처리 후 FFmpeg 합산이 더 현실적.**

```
[Python 오케스트레이터]

for scene in scenes:
    if scene.type == "lipsync":
        result = comfyui_api_queue("workflow_lipsync.json", scene_params)
    elif scene.type == "loop":
        result = comfyui_api_queue("workflow_loop.json", scene_params)
    elif scene.type == "effect":
        result = comfyui_api_queue("workflow_effect.json", scene_params)
    
    wait_for_comfyui(result.prompt_id)
    clips.append(result.output_path)

ffmpeg_concat_xfade(clips, transition="fade", output="final.mp4")
```

### 장면 전환 옵션 (FFmpeg xfade)

```bash
# 기본: 크로스페이드 0.3초
-filter_complex "
  [0:v][1:v]xfade=transition=fade:duration=0.3:offset=T1[v01];
  [v01][2:v]xfade=transition=fade:duration=0.3:offset=T2[v02];
  ...
"
```

| 전환 | 설명 | 추천 장면 |
|------|------|-----------|
| `fade` | 기본 크로스페이드 | 모든 장면 |
| `wipeleft`/`right` | 좌우 와이프 | 장소 이동 |
| `dissolve` | 디졸브 | 회상/몽환 |
| `pixelize` | 픽셀화 | 이펙트→일반 |
| `radial` | 방사형 | 충격/이펙트 |

---

## 캐릭터 준비 플로우

### Case A: 이미지 제공

```
[LoadImage: 레퍼런스.png]
        │
        ▼
[VN Step 1.1 - Clone Existing Character]
  VNCCS_PoseGenerator
  CharacterCreator
  → 여러 앵글 캐릭터 시트 생성
        │
        ▼
[IP-Adapter FaceID sdxl]
  ip-adapter-faceid-plusv2_sdxl.bin
  weight: 0.8
  → 이후 모든 장면 이미지 생성에 주입
```

### Case B: 이미지 없음 (텍스트만)

```
[텍스트 설명]
  "갈색 단발, 주부, 30대 초반, 온화한 인상, 앞치마"
        │
        ▼
[VN Step 1 - CharSheetGenerator]
  CharacterCreator + VNCCS 파이프
  Dasiwa 체크포인트 + 웹툰 스타일 LoRA
  → 다양한 표정/포즈 캐릭터 시트 자동 생성
        │
        ▼
[캐릭터 시트에서 얼굴 추출]
[IP-Adapter FaceID 주입]
```

---

## Gradio 프론트엔드 (최소 버전)

ComfyUI를 직접 노출하지 않고 얇은 UI만 제공.

```python
import gradio as gr
import json, requests, websocket, uuid

COMFYUI = "http://127.0.0.1:8188"

def run_scene_pipeline(char_image, scenes_json, tts_engine):
    config = json.loads(scenes_json)
    client_id = str(uuid.uuid4())
    clips = []

    for scene in config["scenes"]:
        workflow = load_workflow_template(scene["type"])
        patch_workflow(workflow, scene, char_image, tts_engine)
        prompt_id = queue_prompt(workflow, client_id)
        output = wait_and_get_output(prompt_id, client_id)
        clips.append(output)

    final = ffmpeg_concat(clips, config.get("transitions", {}))
    return final

with gr.Blocks() as app:
    gr.Markdown("## 애니 웹툰 영상 생성기")
    with gr.Row():
        char_img = gr.Image(label="캐릭터 이미지 (없으면 비워두세요)", type="filepath")
        with gr.Column():
            scenes_tb = gr.Textbox(label="장면 JSON", lines=15)
            tts_sel = gr.Radio(["qwen3", "s2pro"], label="기본 TTS", value="qwen3")
    btn = gr.Button("생성", variant="primary")
    out = gr.Video(label="결과 영상")
    btn.click(run_scene_pipeline, [char_img, scenes_tb, tts_sel], out)

app.launch(server_port=7860)
```
