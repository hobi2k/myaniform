# B안: ComfyUI + WebUI *(초기 설계 — Gradio → React로 전환되어 구현됨)*

> **상태**: 2026-04-17 기준 FastAPI + React + TypeScript로 구현 완료. Gradio 대신 Vite+React 선택. 현재 상태는 `status.md`, 디렉토리 구조는 `overview.md` 참고.

## 개요

A안의 워크플로우 JSON을 Python이 API로 호출.  
Gradio UI에서 사용자 입력 → 영상 자동 생성.  
장면 수 제한 없음, FFmpeg xfade 전환 지원.

---

## 전체 아키텍처

```
[Gradio WebUI: port 7860]
  사용자 입력:
    - 캐릭터 이미지 (선택)
    - 캐릭터 텍스트 설명 (이미지 없을 때)
    - 장면 목록 (테이블 or JSON)
    - TTS 설정 (엔진 선택 + 레퍼런스 음성)
    - SFX 설정 (장면별 분위기)
    - 전환 효과 선택
        │
        ▼ HTTP POST
[Python 오케스트레이터: orchestrator.py]
  1. 장면 JSON 파싱
  2. 워크플로우 JSON 패칭
  3. ComfyUI API 큐잉
  4. WebSocket으로 진행 상태 수신
  5. 출력 파일 수집
  6. FFmpeg로 최종 합성
        │
        ▼ WebSocket
[ComfyUI: port 8188]
  ws_lipsync.json 실행
  ws_loop.json 실행
  ws_effect.json 실행
        │
        ▼
[FFmpeg]
  xfade 전환 + 오디오 믹싱
        │
        ▼
[Gradio WebUI]
  결과 영상 스트리밍 미리보기 + 다운로드
```

---

## 디렉토리 구조

```
webtoon-gen/
├── app.py                    # Gradio 앱 진입점
├── orchestrator.py           # ComfyUI API 오케스트레이터
├── ffmpeg_utils.py           # 장면 연결 및 전환
├── workflow_patcher.py       # 워크플로우 JSON 동적 패칭
├── config.py                 # 설정값 (ComfyUI URL 등)
│
├── workflows/                # A안과 공유하는 워크플로우 JSON
│   ├── ws_char_create.json
│   ├── ws_char_clone.json
│   ├── ws_lipsync.json
│   ├── ws_loop.json
│   ├── ws_effect.json
│   └── ws_concat.json
│
├── voices/                   # TTS 레퍼런스 음성 파일
│   └── (캐릭터명.wav)
│
└── output/                   # 생성된 클립 및 최종 영상
    ├── scene_001_lipsync.mp4
    ├── scene_002_loop.mp4
    └── final.mp4
```

---

## orchestrator.py

```python
import json, uuid, requests, websocket, time, shutil
from pathlib import Path
from workflow_patcher import patch_workflow
from ffmpeg_utils import concat_with_transitions

COMFYUI_URL = "http://127.0.0.1:8188"
OUTPUT_DIR = Path("output")

def queue_prompt(workflow: dict, client_id: str) -> str:
    res = requests.post(
        f"{COMFYUI_URL}/prompt",
        json={"prompt": workflow, "client_id": client_id}
    )
    return res.json()["prompt_id"]

def wait_for_output(prompt_id: str, client_id: str) -> Path:
    """ComfyUI WebSocket으로 완료 대기 후 출력 파일 경로 반환"""
    ws = websocket.WebSocket()
    ws.connect(f"ws://127.0.0.1:8188/ws?clientId={client_id}")

    while True:
        msg = json.loads(ws.recv())
        if msg["type"] == "executing":
            data = msg["data"]
            if data["node"] is None and data["prompt_id"] == prompt_id:
                break  # 완료

    ws.close()

    # 출력 파일 조회
    history = requests.get(f"{COMFYUI_URL}/history/{prompt_id}").json()
    outputs = history[prompt_id]["outputs"]

    for node_id, node_out in outputs.items():
        if "gifs" in node_out:  # VHS_VideoCombine 출력
            filename = node_out["gifs"][0]["filename"]
            subfolder = node_out["gifs"][0].get("subfolder", "")
            src = Path("ComfyUI/output") / subfolder / filename
            dst = OUTPUT_DIR / filename
            shutil.copy(src, dst)
            return dst

    raise RuntimeError(f"No video output found for prompt {prompt_id}")

def generate(project: dict, scenes: list, on_progress=None) -> Path:
    OUTPUT_DIR.mkdir(exist_ok=True)
    client_id = str(uuid.uuid4())
    clips = []

    # 장면별 처리
    for i, scene in enumerate(scenes):
        wf_file = {
            "lipsync": "workflows/ws_lipsync.json",
            "loop":    "workflows/ws_loop.json",
            "effect":  "workflows/ws_effect.json",
        }[scene["type"]]

        wf = json.loads(Path(wf_file).read_text(encoding="utf-8"))
        patch_workflow(wf, scene, project)

        prompt_id = queue_prompt(wf, client_id)

        if on_progress:
            on_progress(i, len(scenes), f"Scene {scene['id']} 생성 중...")

        clip = wait_for_output(prompt_id, client_id)
        clips.append(clip)

        if on_progress:
            on_progress(i + 1, len(scenes), f"Scene {scene['id']} 완료")

    # 최종 합성
    transitions = project.get("transitions", {"default": "fade", "duration_frames": 8})
    final = concat_with_transitions(clips, transitions)
    return final
```

---

## workflow_patcher.py

```python
import json
from pathlib import Path

# 워크플로우 JSON에서 패칭할 노드 타입 → 위젯 인덱스 매핑
# (실제 워크플로우 제작 후 인덱스 확정 필요)
PATCH_MAP = {
    "ws_lipsync.json": {
        "LoadImage":            {"widgets": {0: "image_path"}},
        "CLIPTextEncode":       {"widgets": {0: "bg_prompt"}},
        "Qwen3VoiceClone":      {"widgets": {0: "dialogue", 1: "voice_ref"}},
        "FishS2VoiceCloneTTS":  {"widgets": {0: "dialogue", 1: "voice_ref"}},
        "MMAudioSampler":       {"widgets": {0: "sfx_prompt"}},
    },
    "ws_loop.json": {
        "CLIPTextEncode":       {"widgets": {0: "bg_prompt"}},
        "WanVideoLoraSelect":   {"widgets": {0: "loop_lora"}},
        "MMAudioSampler":       {"widgets": {0: "sfx_prompt"}},
    },
    "ws_effect.json": {
        "LoadImage":            {"widgets": {0: "image_path"}},
        "WanVideoTextEncode":   {"widgets": {0: "effect_prompt"}},
        "MMAudioSampler":       {"widgets": {0: "sfx_prompt"}},
    },
}

def patch_workflow(wf: dict, scene: dict, project: dict):
    """워크플로우 JSON 노드의 위젯값을 장면 파라미터로 교체"""
    for node_id, node in wf.items():
        if not isinstance(node, dict) or "class_type" not in node:
            continue

        class_type = node["class_type"]
        wf_name = scene.get("_wf_file", "")

        # TTS 엔진 스위치: QWEN3 or S2Pro Bypass
        if class_type in ("Fast Groups Bypasser (rgthree)", "Any Switch (rgthree)"):
            engine = scene.get("tts_engine", "qwen3")
            # 실제 노드 ID에 따라 bypass 설정 조정 (워크플로우 제작 시 확정)

        # 이미지 경로
        if class_type == "LoadImage":
            char_img = project.get("character_ref_image")
            if char_img:
                node["inputs"]["image"] = char_img

        # 텍스트 인코더 (배경 프롬프트)
        if class_type == "CLIPTextEncode":
            if "bg_prompt" in scene:
                node["inputs"]["text"] = scene["bg_prompt"]

        # QWEN3 보이스 클론
        if class_type == "Qwen3VoiceClone":
            node["inputs"]["text"] = scene.get("dialogue", "")
            if scene.get("tts_voice_ref"):
                node["inputs"]["reference_audio"] = scene["tts_voice_ref"]

        # Fish S2 보이스 클론
        if class_type == "FishS2VoiceCloneTTS":
            node["inputs"]["text"] = scene.get("dialogue", "")
            if scene.get("tts_voice_ref"):
                node["inputs"]["reference_audio"] = scene["tts_voice_ref"]

        # MMAudio SFX
        if class_type == "MMAudioSampler":
            node["inputs"]["prompt"] = scene.get("sfx_prompt", "ambient sound")
```

---

## ffmpeg_utils.py

```python
import subprocess
from pathlib import Path

def concat_with_transitions(clips: list, transitions: dict) -> Path:
    """
    FFmpeg xfade로 장면 연결.
    transitions = {"default": "fade", "duration_frames": 8}
    """
    if len(clips) == 1:
        return clips[0]

    fps = 24
    trans_type = transitions.get("default", "fade")
    trans_frames = transitions.get("duration_frames", 8)
    trans_sec = trans_frames / fps  # 기본 0.33초

    # 각 클립 길이 파악
    durations = [get_video_duration(c) for c in clips]

    # xfade 필터 체인 생성
    filter_parts = []
    inputs = []
    for i, clip in enumerate(clips):
        inputs += ["-i", str(clip)]

    # 첫 오프셋 계산
    offsets = []
    cumulative = 0.0
    for i in range(len(clips) - 1):
        cumulative += durations[i] - trans_sec
        offsets.append(round(cumulative, 3))

    # 필터 문자열 생성
    filter_chain = ""
    prev = "[0:v]"
    for i, (offset, clip_idx) in enumerate(zip(offsets, range(1, len(clips)))):
        out_label = f"[v{i}]" if i < len(offsets) - 1 else "[vout]"
        filter_chain += (
            f"{prev}[{clip_idx}:v]xfade=transition={trans_type}"
            f":duration={trans_sec}:offset={offset}{out_label};"
        )
        prev = f"[v{i}]"

    # 오디오는 단순 concat
    audio_inputs = "".join(f"[{i}:a]" for i in range(len(clips)))
    filter_chain += f"{audio_inputs}concat=n={len(clips)}:v=0:a=1[aout]"

    output = Path("output/final.mp4")
    cmd = (
        ["ffmpeg", "-y"]
        + inputs
        + ["-filter_complex", filter_chain,
           "-map", "[vout]", "-map", "[aout]",
           "-c:v", "libx264", "-crf", "18",
           "-c:a", "aac", "-b:a", "192k",
           str(output)]
    )
    subprocess.run(cmd, check=True)
    return output

def get_video_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_streams", str(path)],
        capture_output=True, text=True
    )
    import json
    streams = json.loads(result.stdout)["streams"]
    for s in streams:
        if s["codec_type"] == "video":
            return float(s["duration"])
    return 0.0
```

---

## app.py (Gradio UI)

```python
import gradio as gr
import json
from orchestrator import generate

def run(char_image, char_desc, scenes_json, tts_engine, voice_ref, progress=gr.Progress()):
    try:
        scenes = json.loads(scenes_json)
    except json.JSONDecodeError as e:
        return None, f"JSON 오류: {e}"

    project = {
        "character_ref_image": char_image,
        "character_text_desc": char_desc,
        "tts_engine":          tts_engine,
        "transitions":         {"default": "fade", "duration_frames": 8},
    }

    # 장면마다 공통 TTS 설정 주입
    for scene in scenes:
        if "tts_engine" not in scene:
            scene["tts_engine"] = tts_engine
        if voice_ref and "tts_voice_ref" not in scene:
            scene["tts_voice_ref"] = voice_ref

    def on_progress(done, total, msg):
        progress(done / total, desc=msg)

    final = generate(project, scenes, on_progress=on_progress)
    return str(final), "완료"


EXAMPLE_JSON = json.dumps([
    {
        "id": 1, "type": "loop",
        "bg_prompt": "아파트 거실, 따뜻한 오후, 햇살, 커튼",
        "sfx_prompt": "quiet room, air conditioner, city ambience",
        "duration_sec": 3
    },
    {
        "id": 2, "type": "lipsync",
        "bg_prompt": "거실, 소파, 여성 캐릭터 미디엄샷, 정면",
        "dialogue": "어머, 이렇게 오실 줄 몰랐어요.",
        "sfx_prompt": "indoor ambience, soft"
    },
    {
        "id": 3, "type": "lipsync",
        "bg_prompt": "같은 거실, 클로즈업, 당황한 표정",
        "dialogue": "저...저는 그런 게 아니에요!",
        "tts_engine": "s2pro",
        "sfx_prompt": "heartbeat, nervous breathing"
    },
    {
        "id": 4, "type": "effect",
        "bg_prompt": "캐릭터 얼굴 클로즈업, 홍조, 빛 산란",
        "sfx_prompt": "anime sparkle, blush sound, heartbeat"
    }
], ensure_ascii=False, indent=2)


with gr.Blocks(title="애니 웹툰 영상 생성기") as app:
    gr.Markdown("## 애니풍 멀티샷 웹툰 영상 생성기")

    with gr.Row():
        with gr.Column(scale=1):
            char_image = gr.Image(
                label="캐릭터 레퍼런스 이미지 (없으면 비워두세요)",
                type="filepath"
            )
            char_desc = gr.Textbox(
                label="캐릭터 설명 (이미지 없을 때 사용)",
                placeholder="갈색 단발, 주부, 30대, 온화한 인상, 앞치마"
            )
            tts_engine = gr.Radio(
                choices=["qwen3", "s2pro"],
                label="기본 TTS 엔진",
                value="qwen3",
                info="장면별로 개별 지정도 가능 (JSON의 tts_engine 필드)"
            )
            voice_ref = gr.Audio(
                label="보이스 레퍼런스 (없으면 VoiceDesign 사용)",
                type="filepath"
            )

        with gr.Column(scale=2):
            scenes_input = gr.Code(
                label="장면 목록 (JSON)",
                language="json",
                value=EXAMPLE_JSON,
                lines=25
            )

    with gr.Row():
        run_btn = gr.Button("영상 생성 시작", variant="primary", scale=2)
        status = gr.Textbox(label="상태", scale=1, interactive=False)

    output_video = gr.Video(label="생성된 영상")

    run_btn.click(
        fn=run,
        inputs=[char_image, char_desc, scenes_input, tts_engine, voice_ref],
        outputs=[output_video, status]
    )

if __name__ == "__main__":
    app.launch(server_port=7860, share=False)
```

---

## 장면 전환 옵션

```python
# transitions 설정 예시
{
    "default": "fade",          # 기본 전환
    "duration_frames": 8,       # 전환 길이 (24fps 기준 0.33초)
    "overrides": {
        "1→2": "fade",          # 1→2 장면은 fade
        "2→3": "wipeleft",      # 2→3 장면은 좌측 와이프
        "3→4": "pixelize"       # 3→4 장면은 픽셀화
    }
}
```

| 전환 효과 | 추천 용도 |
|-----------|-----------|
| `fade` | 일반적인 장면 전환 |
| `wipeleft` / `wiperight` | 시간 경과, 장소 이동 |
| `dissolve` | 몽환적, 회상 |
| `pixelize` | 이펙트 장면 전후 |
| `radial` | 충격/감정 폭발 |
| `slideright` | 대화 전환 |

---

## B안의 A안 대비 장점

| 항목 | A안 | B안 |
|------|-----|-----|
| 장면 수 | 고정 | 동적 (N개) |
| 장면 전환 | 컷/RIFE 근사 | FFmpeg xfade |
| 자동화 | 수동 실행 | 원클릭 |
| 사용 난이도 | ComfyUI 숙지 필요 | 브라우저만 필요 |
| 진행 상태 표시 | ComfyUI 기본 UI | Gradio 프로그레스 바 |
| 장면 순서 재배열 | 워크플로우 재설계 | JSON 수정만 |
