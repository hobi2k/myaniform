# myaniform — 애니풍 멀티샷 영상 제작 플랫폼

> 최종 업데이트: 2026-04-17

---

## 목표

사용자가 캐릭터·목소리·장면을 설정하면, 립싱크·루프·이펙트·사운드이펙트·장면전환이 포함된 애니풍 멀티샷 영상을 자동 생성하는 **완결된 웹 플랫폼**.

E2E 파이프라인이 동작 중이며, 한 번의 "생성" 클릭으로 여러 씬이 순차 처리되어 한 편의 영상으로 합성된다.

---

## 전체 아키텍처

```
┌──────────────────────────────────────────────────────┐
│              React + TypeScript Frontend              │
│                    (Vite, port 5173)                  │
│                                                      │
│  /                  ProjectList                      │
│  /projects/:id      ProjectEditor                    │
│                       ├── CharacterPanel             │
│                       │    ├── 이미지 업로드 / AI 생성  │
│                       │    └── 보이스 설계 / 클론       │
│                       └── SceneEditor                │
│                            └── 씬별 타입·대사·프롬프트  │
│  /projects/:id/generate   GenerationPage (SSE)       │
└───────────────────────┬──────────────────────────────┘
                        │ REST / SSE (fetch stream)
┌───────────────────────▼──────────────────────────────┐
│              FastAPI Backend (port 8000)              │
│                                                      │
│  SQLModel/SQLite — 프로젝트·캐릭터·씬 영속화            │
│  파일 업로드 처리 → ComfyUI/input/                    │
│  워크플로우 패칭 후 ComfyUI 큐잉                       │
│  ComfyUI 상태 폴링 → SSE로 프론트 전달                 │
│  씬 간 ComfyUI `/free` 호출로 메모리 해제               │
└───────────────────────┬──────────────────────────────┘
                        │ HTTP (httpx)
┌───────────────────────▼──────────────────────────────┐
│              ComfyUI (port 8188, embedded)            │
│                                                      │
│  originals/*.json → runtime patched API prompts       │
│  standalone/payload/*.json → external ComfyUI 실행본  │
│  ws_tts_clone.json ws_tts_s2pro.json ws_voice_design │
└──────────────────────────────────────────────────────┘
```

---

## 디렉토리 구조

```
myaniform/
├── ComfyUI/              # embedded AI 백엔드
├── backend/              # FastAPI
│   ├── main.py
│   ├── models.py         # SQLModel 스키마
│   ├── routers/
│   │   ├── projects.py
│   │   ├── characters.py
│   │   ├── scenes.py
│   │   ├── generation.py # SSE 파이프라인
│   │   └── setup.py      # 모델 체크
│   ├── services/
│   │   ├── comfyui_client.py
│   │   ├── workflow_patcher.py
│   │   └── ffmpeg_utils.py
│   └── requirements.txt
├── frontend/             # Vite + React + TypeScript
│   ├── src/
│   │   ├── pages/        # ProjectList, ProjectEditor, Generation
│   │   ├── components/
│   │   │   ├── character/ CharacterPanel
│   │   │   ├── scene/     SceneEditor
│   │   │   └── ui/        Button, Layout
│   │   ├── api/          # REST 클라이언트 + React Query
│   │   └── types.ts
│   ├── tailwind.config.ts
│   └── package.json
├── workflows/            # ComfyUI API JSON (README.md 참고)
├── voices/               # 보이스 레퍼런스
├── output/               # 생성된 클립 및 최종 영상
├── run.sh                # 서비스 런처
├── setup.sh              # 의존성 + 모델 다운로드
└── docs/
```

---

## 사용자 흐름

```
[1] 프로젝트 생성
    제목, 에피소드 번호

[2] 캐릭터 설정
    이미지: 파일 업로드  OR  텍스트 설명 → AI 생성 (SDXL)
    보이스: VoiceDesign 텍스트 → Qwen3 TTS 생성 → WAV 저장
            or 직접 WAV 업로드
            → 이후 장면에서 VoiceClone (Qwen3 or S2Pro) 입력으로 사용

[3] 씬 편집
    씬 추가/순서 변경
    타입 선택: loop | lipsync | effect
      loop:    배경 프롬프트, SFX 프롬프트, I2V 모델, LoRA
      lipsync: 배경 프롬프트, 대사, 캐릭터, TTS 엔진, S2V 모델
      effect:  이펙트 프롬프트, SFX 프롬프트, I2V 모델, LoRA

[4] 생성 실행
    "생성 시작" → FastAPI가 씬 순서대로 ComfyUI 큐잉
    SSE로 scene_index + stage(voice/image/video) + message 스트리밍
    씬 완료마다 `/free`로 메모리 해제 후 다음 씬
    전체 완료 → ffmpeg xfade 합성 → 최종 영상 미리보기 + 다운로드
```

---

## 공통 기술 스택

### 이미지/영상 생성 (ComfyUI 내)

| 역할 | 모델 |
|------|------|
| 이미지 생성 | Dasiwa Illustrious Anime (SDXL) |
| 캐릭터 일관성 | IP-Adapter FaceID SDXL (선택) |
| S2V 립싱크 | Wan2.2 S2V 14B Q4_K_M GGUF |
| 루프 (High) | Dasiwa SynthSeduction HIGH V9 + LoRA 선택 |
| 루프 (Low) | Dasiwa SynthSeduction LOW V9 |
| 이펙트 | Dasiwa SynthSeduction HIGH + AniEffect LoRA |

### 오디오

| 역할 | 선택 |
|------|------|
| TTS (기본) | Qwen3-TTS 1.7B (VoiceDesign → VoiceClone) |
| TTS (감정) | Fish Audio S2 Pro |
| SFX | MMAudio large 44k v2 |
| 오디오 믹싱 | GeekyAudioMixer (워크플로우 내) + ffmpeg (씬 간) |
