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
    ("scene", "video_params",       "TEXT"),
    # Phase 4: VNCCS sprite reference
    ("character", "sprite_path",    "VARCHAR"),
    ("character", "sheet_path",     "VARCHAR"),
    # Character image advanced params
    ("character", "negative_prompt","TEXT"),
    ("character", "resolution_w",   "INTEGER"),
    ("character", "resolution_h",   "INTEGER"),
    ("character", "image_params",   "TEXT"),
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
