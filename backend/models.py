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


# ── Character ─────────────────────────────────────────────────────────────

class Character(SQLModel, table=True):
    id:           str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    project_id:   str = Field(foreign_key="project.id")
    name:         str
    description:  Optional[str] = None   # 텍스트 설명 (이미지 생성용)

    # 이미지 (단일 레퍼런스)
    image_path:   Optional[str] = None   # 업로드 or 생성된 이미지 경로
    # VNCCS 스프라이트/시트 (Phase 4)
    sheet_path:   Optional[str] = None   # VN_Step1 결과: 캐릭터 시트 (정면/후면/측면)
    sprite_path:  Optional[str] = None   # VN_Step4 결과: 투명 배경 스프라이트

    # 목소리
    voice_design:      Optional[str] = None  # Voice Design 텍스트 설명
    voice_sample_path: Optional[str] = None  # 생성/업로드된 WAV
    tts_engine:        TTSEngine = TTSEngine.qwen3


class CharacterCreate(SQLModel):
    name:        str
    description: Optional[str] = None

class CharacterRead(SQLModel):
    id:                str
    project_id:        str
    name:              str
    description:       Optional[str]
    image_path:        Optional[str]
    sheet_path:        Optional[str]
    sprite_path:       Optional[str]
    voice_design:      Optional[str]
    voice_sample_path: Optional[str]
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
    # 비어있으면 character_id + character_b_id 로 폴백 (구버전 호환)
    character_id:      Optional[str] = None  # [deprecated] 주 캐릭터
    character_b_id:    Optional[str] = None  # [deprecated] 보조 캐릭터
    character_ids_json: Optional[str] = None  # 신규: N-char 리스트

    # Phase 3: 이미지/비디오 파라미터 (모두 옵션, JSON 으로 유연)
    # image_workflow: "qwen_edit" (기본, 캐릭터 레퍼런스 사용) | "sdxl" (고품질, 텍스트→이미지)
    image_workflow: Optional[str] = None
    resolution_w:   Optional[int] = None  # 기본 832 (SDXL) / 832 (Qwen)
    resolution_h:   Optional[int] = None  # 기본 1216
    # image_params JSON: {"steps": 30, "cfg": 5.0, "sampler": "euler_ancestral",
    #                     "scheduler": "sgm_uniform", "loras": [{"name","strength"}…],
    #                     "face_detailer": true, "hand_detailer": true}
    image_params:   Optional[str] = None
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


# ── Generation event (SSE payload) ───────────────────────────────────────

class GenerationEvent(SQLModel):
    type:    str           # "progress" | "scene_done" | "complete" | "error"
    scene_index: Optional[int] = None
    total:       Optional[int] = None
    message:     str = ""
    output_path: Optional[str] = None
