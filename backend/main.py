from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .database import init_db
from .routers import characters, generation, projects, scenes, setup, workflows

app = FastAPI(title="myaniform API", version="0.1.0")


@app.exception_handler(RuntimeError)
async def runtime_error_handler(request: Request, exc: RuntimeError):
    # ComfyUI validation / 출력 누락 등 — 프론트가 detail 로 표시
    return JSONResponse(status_code=500, content={"detail": str(exc)})

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:8188", "http://127.0.0.1:8188",  # ComfyUI iframe 확장이 /api/workflows 접근
    ],
    allow_origin_regex=r"http://(\d{1,3}\.){3}\d{1,3}:(5173|8000|8188)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router,   prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(scenes.router,     prefix="/api")
app.include_router(generation.router, prefix="/api")
app.include_router(workflows.router)
app.include_router(setup.router)

# 업로드 / 출력 파일 정적 서빙
for d in ("uploads", "voices", "output"):
    Path(d).mkdir(exist_ok=True)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/voices",  StaticFiles(directory="voices"),  name="voices")
app.mount("/output",  StaticFiles(directory="output"),  name="output")

_COMFY_INPUT = Path(__file__).resolve().parent.parent / "ComfyUI" / "input"
_COMFY_INPUT.mkdir(parents=True, exist_ok=True)
app.mount("/comfy_input", StaticFiles(directory=str(_COMFY_INPUT)), name="comfy_input")


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}
