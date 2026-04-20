"""ComfyUI API 클라이언트 (비동기)."""

import json
import uuid
from pathlib import Path
from typing import AsyncIterator

import httpx
import websockets

COMFYUI_URL = "http://127.0.0.1:8188"
COMFYUI_WS  = "ws://127.0.0.1:8188"
OUTPUT_DIR  = Path(__file__).parent.parent.parent / "ComfyUI" / "output"


async def queue_prompt(workflow: dict, client_id: str) -> str:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{COMFYUI_URL}/prompt",
            json={"prompt": workflow, "client_id": client_id},
            timeout=30,
        )
        if res.status_code >= 400:
            # ComfyUI 의 상세 validation 에러를 그대로 전달
            try:
                body = res.json()
            except Exception:
                body = {"raw": res.text}
            raise RuntimeError(
                f"ComfyUI 워크플로우 거부 ({res.status_code}): {json.dumps(body, ensure_ascii=False)[:1500]}"
            )
        return res.json()["prompt_id"]


async def wait_for_output(prompt_id: str, client_id: str) -> Path:
    """WebSocket으로 완료 대기 후 출력 파일 경로 반환."""
    uri = f"{COMFYUI_WS}/ws?clientId={client_id}"
    async with websockets.connect(uri) as ws:
        async for raw in ws:
            msg = json.loads(raw)
            if msg.get("type") == "executing":
                data = msg.get("data", {})
                if data.get("node") is None and data.get("prompt_id") == prompt_id:
                    break
            elif msg.get("type") == "execution_error":
                data = msg.get("data", {})
                raise RuntimeError(
                    f"ComfyUI 오류 node={data.get('node_id')}: {data.get('exception_message')}"
                )

    async with httpx.AsyncClient() as client:
        res = await client.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=10)
        outputs = res.json().get(prompt_id, {}).get("outputs", {})

    for node_out in outputs.values():
        items = (
            node_out.get("gifs")
            or node_out.get("videos")
            or node_out.get("audio")
            or node_out.get("images")
            or []
        )
        if items:
            item = items[0]
            src = OUTPUT_DIR / item.get("subfolder", "") / item["filename"]
            if src.exists():
                return src

    raise RuntimeError(f"출력 파일 없음 (prompt_id={prompt_id})")


async def run_workflow(workflow: dict, kind: str = "video") -> Path:
    """워크플로우를 큐잉 → 완료 대기 → 모델/VRAM 해제 → 출력 경로 반환."""
    cid = str(uuid.uuid4())
    pid = await queue_prompt(workflow, cid)
    out = await wait_for_output(pid, cid)
    # 다음 워크플로우가 로드되기 전에 현재 캐시된 모델을 해제해 OOM 방지.
    await free_memory()
    return out


async def interrupt():
    """현재 실행 중인 작업 중단."""
    async with httpx.AsyncClient() as client:
        await client.post(f"{COMFYUI_URL}/interrupt", timeout=5)


async def free_memory(unload_models: bool = True, free_memory: bool = True) -> None:
    """ComfyUI에 캐시된 모델/VRAM 해제. 워크플로우 간에 호출해 OOM 방지."""
    async with httpx.AsyncClient() as client:
        try:
            await client.post(
                f"{COMFYUI_URL}/free",
                json={"unload_models": unload_models, "free_memory": free_memory},
                timeout=30,
            )
        except Exception:
            pass
