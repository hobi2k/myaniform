"""SQLModel 데이터 스키마."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


# ── Enums ─────────────────────────────────────────────────────────────────

class SceneType(str, Enum):
    lipsync = "lipsync"
    basic   = "basic"
    loop    = "loop"
    effect  = "effect"

class TTSEngine(str, Enum):
    qwen3 = "qwen3"
    s2pro = "s2pro"

class GenerationStatus(str, Enum):
    idle      = "idle"
    running   = "running"
    completed = "completed"
    failed    = "failed"


# ── Project ───────────────────────────────────────────────────────────────

class Project(SQLModel, table=True):
    id:         str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    title:      str
    episode:    Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status:     GenerationStatus = GenerationStatus.idle
    output_path: Optional[str] = None  # 완성 영상 경로
    # Composer M4 — 프로젝트 단위 BGM (배경음악) 트랙
    bgm_path:        Optional[str] = None  # uploads/<project_id>_bgm.<ext>
    measured_lufs:   Optional[float] = None  # 마지막 렌더의 LUFS 측정값 (캐시)
    # Composer M5 — 오버레이 (자막/타이틀/스티커) 영구화. JSON list of EditOverlay.
    overlays_json:   Optional[str] = None


class ProjectCreate(SQLModel):
    title:   str
    episode: Optional[str] = None

class ProjectRead(SQLModel):
    id:          str
    title:       str
    episode:     Optional[str]
    created_at:  datetime
    status:      GenerationStatus
    output_path: Optional[str]
    bgm_path:      Optional[str] = None
    measured_lufs: Optional[float] = None
    overlays_json: Optional[str] = None


# ── Character ─────────────────────────────────────────────────────────────

class Character(SQLModel, table=True):
    id:           str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    project_id:   str = Field(foreign_key="project.id")
    name:         str
    description:  Optional[str] = None   # 텍스트 설명 (이미지 생성용)
    background_color: Optional[str] = None
    aesthetics:   Optional[str] = None
    nsfw:         Optional[bool] = None
    sex:          Optional[str] = None
    age:          Optional[int] = None
    race:         Optional[str] = None
    eyes:         Optional[str] = None
    hair:         Optional[str] = None
    face:         Optional[str] = None
    body:         Optional[str] = None
    skin_color:   Optional[str] = None
    lora_prompt:  Optional[str] = None
    negative_prompt: Optional[str] = None
    resolution_w: Optional[int] = None
    resolution_h: Optional[int] = None
    image_params: Optional[str] = None   # JSON ImageParams
    sprite_params: Optional[str] = None  # JSON ImageParams for VN sprite workflows

    # 이미지 (단일 레퍼런스)
    image_path:   Optional[str] = None   # 업로드 or 생성된 이미지 경로
    # VNCCS 스프라이트/시트 (Phase 4)
    sprite_path:  Optional[str] = None   # VN_Step4 결과: 투명 배경 스프라이트

    # 목소리
    voice_design:      Optional[str] = None  # Voice Design 텍스트 설명
    voice_sample_path: Optional[str] = None  # 생성/업로드된 WAV
    voice_sample_text: Optional[str] = None
    voice_language: Optional[str] = None
    voice_params: Optional[str] = None       # JSON VoiceGenParams
    tts_engine:        TTSEngine = TTSEngine.qwen3


class CharacterCreate(SQLModel):
    name:        str
    description: Optional[str] = None

class CharacterRead(SQLModel):
    id:                str
    project_id:        str
    name:              str
    description:       Optional[str]
    background_color:  Optional[str]
    aesthetics:        Optional[str]
    nsfw:              Optional[bool]
    sex:               Optional[str]
    age:               Optional[int]
    race:              Optional[str]
    eyes:              Optional[str]
    hair:              Optional[str]
    face:              Optional[str]
    body:              Optional[str]
    skin_color:        Optional[str]
    lora_prompt:       Optional[str]
    negative_prompt:   Optional[str]
    resolution_w:      Optional[int]
    resolution_h:      Optional[int]
    image_params:      Optional[str]
    sprite_params:     Optional[str]
    image_path:        Optional[str]
    sprite_path:       Optional[str]
    voice_design:      Optional[str]
    voice_sample_path: Optional[str]
    voice_sample_text: Optional[str]
    voice_language:    Optional[str]
    voice_params:      Optional[str]
    tts_engine:        TTSEngine


# ── Scene ─────────────────────────────────────────────────────────────────

class Scene(SQLModel, table=True):
    id:           str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    project_id:   str = Field(foreign_key="project.id")
    order:        int = 0           # 장면 순서
    type:         SceneType = SceneType.lipsync

    # 공통
    bg_prompt:    Optional[str] = None
    sfx_prompt:   Optional[str] = None

    # 캐릭터 (Phase 2: N-명 지원)
    # character_ids_json 이 우선 — JSON list ["id1","id2",...] 최대 N명
    # character_id / character_b_id 는 기존 DB 프로젝트 읽기용 보조 컬럼.
    character_id:      Optional[str] = None
    character_b_id:    Optional[str] = None
    character_ids_json: Optional[str] = None

    # Phase 3: 이미지/비디오 파라미터 (모두 옵션, JSON 으로 유연)
    # image_workflow: "qwen_edit" (기본, 캐릭터 스프라이트 레퍼런스 사용) | "sdxl" (명시 선택 시 텍스트→이미지)
    image_workflow: Optional[str] = None
    resolution_w:   Optional[int] = None  # 기본 832 (SDXL) / 832 (Qwen)
    resolution_h:   Optional[int] = None  # 기본 1216
    # image_params JSON: {"steps": 30, "cfg": 5.0, "sampler": "euler_ancestral",
    #                     "scheduler": "sgm_uniform", "loras": [{"name","strength"}…],
    #                     "face_detailer": true, "hand_detailer": true}
    image_params:   Optional[str] = None
    # "new_scene": 현재 씬 이미지 생성/사용 | "previous_last_frame": 이전 씬의 마지막 프레임으로 시작
    frame_source_mode: Optional[str] = "new_scene"
    # video_params JSON: Wan 2.2 튜닝값
    # {"steps": 4, "cfg": 1.0, "sampler": "unipc", "scheduler": "simple",
    #  "frames": 81, "fps": 16}
    video_params:   Optional[str] = None

    # lipsync 전용
    dialogue:     Optional[str] = None
    tts_engine:   TTSEngine = TTSEngine.qwen3

    # effect 전용
    effect_prompt: Optional[str] = None

    # LoRA 선택 (JSON 직렬화: [{"name": "x.safetensors", "strength": 1.0}, ...])
    loras_json:    Optional[str] = None

    # 디퓨전 모델 선택 (경로, 예: "wan_i2v_high/smoothMix...safetensors")
    diffusion_model: Optional[str] = None

    # 산출물 (단계별)
    voice_path:   Optional[str] = None  # TTS 결과 wav (lipsync)
    image_path:   Optional[str] = None  # 장면 키프레임 png
    clip_path:    Optional[str] = None  # 최종 비디오
    clip_stale:   bool = False          # voice/image 변경 후 clip 갱신 필요 여부
    clip_duration_sec: Optional[float] = None  # ffprobe 측정. Remotion Player 시간 배치용.

    # ── 편집 메타 (Composer M3) ──
    # 트림: 소스 클립 안에서 사용할 [in, out] 범위. None=전체 사용.
    clip_in_offset_sec:  Optional[float] = None
    clip_out_offset_sec: Optional[float] = None
    # 클립 단위 재생 속도 배율 (0.25 ~ 4.0). None = 1.0.
    clip_speed:          Optional[float] = None
    # 클립 단위 음량. None = 1.0.
    clip_voice_volume:   Optional[float] = None
    clip_sfx_volume:     Optional[float] = None
    # 이 씬 → 다음 씬으로 가는 트랜지션 (per-boundary override).
    # None 이면 글로벌 EditRenderSettings 의 transition_style/sec 사용.
    out_transition_style: Optional[str] = None
    out_transition_sec:   Optional[float] = None
    # 클립 단위 색감 프리셋 오버레이 (글로벌 grade 위에 chain).
    # 값은 EditRenderSettings.color_preset 와 동일 enum 문자열.
    clip_color_overlay:   Optional[str] = None


class SceneCreate(SQLModel):
    order:              int = 0
    type:               SceneType
    bg_prompt:          Optional[str] = None
    sfx_prompt:         Optional[str] = None
    character_id:       Optional[str] = None
    character_b_id:     Optional[str] = None
    character_ids_json: Optional[str] = None
    image_workflow:     Optional[str] = None
    resolution_w:       Optional[int] = None
    resolution_h:       Optional[int] = None
    image_params:       Optional[str] = None
    frame_source_mode:  Optional[str] = "new_scene"
    video_params:       Optional[str] = None
    dialogue:           Optional[str] = None
    tts_engine:         TTSEngine = TTSEngine.qwen3
    effect_prompt:      Optional[str] = None
    loras_json:         Optional[str] = None
    diffusion_model:    Optional[str] = None

class SceneRead(SQLModel):
    id:                 str
    project_id:         str
    order:              int
    type:               SceneType
    bg_prompt:          Optional[str]
    sfx_prompt:         Optional[str]
    character_id:       Optional[str]
    character_b_id:     Optional[str]
    character_ids_json: Optional[str]
    image_workflow:     Optional[str]
    resolution_w:       Optional[int]
    resolution_h:       Optional[int]
    image_params:       Optional[str]
    frame_source_mode:  Optional[str]
    video_params:       Optional[str]
    dialogue:           Optional[str]
    tts_engine:         TTSEngine
    effect_prompt:      Optional[str]
    loras_json:         Optional[str]
    diffusion_model:    Optional[str]
    voice_path:         Optional[str]
    image_path:         Optional[str]
    clip_path:          Optional[str]
    clip_stale:         bool
    clip_duration_sec:  Optional[float] = None
    clip_in_offset_sec:  Optional[float] = None
    clip_out_offset_sec: Optional[float] = None
    clip_speed:           Optional[float] = None
    clip_voice_volume:    Optional[float] = None
    clip_sfx_volume:      Optional[float] = None
    out_transition_style: Optional[str]   = None
    out_transition_sec:   Optional[float] = None
    clip_color_overlay:   Optional[str]   = None


# ── Generation event (SSE payload) ───────────────────────────────────────

class GenerationEvent(SQLModel):
    type:    str           # "progress" | "scene_done" | "complete" | "error"
    scene_index: Optional[int] = None
    total:       Optional[int] = None
    message:     str = ""
    output_path: Optional[str] = None
