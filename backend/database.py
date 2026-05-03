from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

_DB_PATH = Path(__file__).resolve().parent.parent / "myaniform.db"
DATABASE_URL = f"sqlite:///{_DB_PATH}"
engine = create_engine(DATABASE_URL, echo=False)


# 기존 DB 에 누락된 컬럼을 추가하는 최소 마이그레이션.
# (SQLModel.create_all 은 기존 테이블을 수정하지 않음)
_ADDITIVE_MIGRATIONS = [
    ("scene", "character_b_id",     "VARCHAR"),
    # Phase 2: N-character multi-select (JSON list of character IDs)
    ("scene", "character_ids_json", "TEXT"),
    # Phase 3: per-scene image/video params (JSON)
    ("scene", "resolution_w",       "INTEGER"),
    ("scene", "resolution_h",       "INTEGER"),
    ("scene", "image_workflow",     "VARCHAR"),
    ("scene", "image_params",       "TEXT"),
    ("scene", "frame_source_mode",  "VARCHAR DEFAULT 'new_scene'"),
    ("scene", "video_params",       "TEXT"),
    ("scene", "clip_duration_sec",   "REAL"),
    # Composer M3
    ("scene", "clip_in_offset_sec",  "REAL"),
    ("scene", "clip_out_offset_sec", "REAL"),
    ("scene", "clip_speed",          "REAL"),
    ("scene", "clip_voice_volume",   "REAL"),
    ("scene", "clip_sfx_volume",     "REAL"),
    ("scene", "out_transition_style","VARCHAR"),
    ("scene", "out_transition_sec",  "REAL"),
    ("scene", "clip_color_overlay",  "VARCHAR"),
    # Composer M4 — Project BGM
    ("project", "bgm_path",          "VARCHAR"),
    ("project", "measured_lufs",     "REAL"),
    # Composer M5 — overlays
    ("project", "overlays_json",     "TEXT"),
    # Phase 4: VNCCS sprite reference
    ("character", "sprite_path",    "VARCHAR"),
    # Character image advanced params
    ("character", "negative_prompt","TEXT"),
    ("character", "resolution_w",   "INTEGER"),
    ("character", "resolution_h",   "INTEGER"),
    ("character", "image_params",   "TEXT"),
    ("character", "sprite_params",  "TEXT"),
    ("character", "background_color","VARCHAR"),
    ("character", "aesthetics",      "TEXT"),
    ("character", "nsfw",            "BOOLEAN"),
    ("character", "sex",             "VARCHAR"),
    ("character", "age",             "INTEGER"),
    ("character", "race",            "VARCHAR"),
    ("character", "eyes",            "TEXT"),
    ("character", "hair",            "TEXT"),
    ("character", "face",            "TEXT"),
    ("character", "body",            "TEXT"),
    ("character", "skin_color",      "TEXT"),
    ("character", "lora_prompt",     "TEXT"),
    ("character", "voice_sample_text", "TEXT"),
    ("character", "voice_language",    "VARCHAR"),
    ("character", "voice_params",      "TEXT"),
]


def _run_additive_migrations():
    with engine.connect() as conn:
        for table, column, coltype in _ADDITIVE_MIGRATIONS:
            exists = conn.execute(
                text(f"SELECT 1 FROM pragma_table_info('{table}') WHERE name=:c"),
                {"c": column},
            ).first()
            if not exists:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}"))
        conn.commit()


def init_db():
    SQLModel.metadata.create_all(engine)
    _run_additive_migrations()


def get_session():
    with Session(engine) as session:
        yield session
