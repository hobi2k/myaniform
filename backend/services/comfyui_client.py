"""ComfyUI API 클라이언트 (비동기)."""

import inspect
import json
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
import websockets

COMFYUI_URL = "http://127.0.0.1:8188"
COMFYUI_WS  = "ws://127.0.0.1:8188"
OUTPUT_DIR  = Path(__file__).parent.parent.parent / "ComfyUI" / "output"
ProgressCallback = Callable[[dict[str, Any]], Awaitable[None] | None]


async def _emit(cb: ProgressCallback | None, event: dict[str, Any]) -> None:
    if cb is None:
        return
    result = cb(event)
    if inspect.isawaitable(result):
        await result


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


async def wait_for_output(
    prompt_id: str,
    client_id: str,
    on_event: ProgressCallback | None = None,
) -> Path:
    """WebSocket으로 완료 대기 후 출력 파일 경로 반환."""
    uri = f"{COMFYUI_WS}/ws?clientId={client_id}"
    async with websockets.connect(uri) as ws:
        async for raw in ws:
            msg = json.loads(raw)
            msg_type = msg.get("type")
            data = msg.get("data", {})
            event_prompt_id = data.get("prompt_id")
            if event_prompt_id not in (None, prompt_id):
                continue

            if msg_type == "progress":
                value = data.get("value")
                total = data.get("max")
                pct = None
                if isinstance(value, (int, float)) and isinstance(total, (int, float)) and total:
                    pct = max(0, min(100, round((value / total) * 100)))
                await _emit(
                    on_event,
                    {
                        "type": "progress",
                        "prompt_id": prompt_id,
                        "node": data.get("node"),
                        "value": value,
                        "max": total,
                        "progress_pct": pct,
                    },
                )
            elif msg_type == "executing":
                await _emit(
                    on_event,
                    {
                        "type": "executing",
                        "prompt_id": prompt_id,
                        "node": data.get("node"),
                    },
                )
                if data.get("node") is None and event_prompt_id == prompt_id:
                    break
            elif msg_type == "executed":
                await _emit(
                    on_event,
                    {
                        "type": "executed",
                        "prompt_id": prompt_id,
                        "node": data.get("node"),
                    },
                )
            elif msg_type == "execution_error":
                await _emit(
                    on_event,
                    {
                        "type": "execution_error",
                        "prompt_id": prompt_id,
                        "node": data.get("node_id"),
                        "node_type": data.get("node_type"),
                        "message": data.get("exception_message"),
                    },
                )
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


async def run_workflow(
    workflow: dict,
    kind: str = "video",
    on_event: ProgressCallback | None = None,
) -> Path:
    """워크플로우를 큐잉 → 완료 대기 → 모델/VRAM 해제 → 출력 경로 반환."""
    cid = str(uuid.uuid4())
    pid = await queue_prompt(workflow, cid)
    await _emit(on_event, {"type": "queued", "prompt_id": pid, "kind": kind})
    out = await wait_for_output(pid, cid, on_event=on_event)
    await _emit(on_event, {"type": "output_ready", "prompt_id": pid, "kind": kind, "path": str(out)})
    # 다음 워크플로우가 로드되기 전에 현재 캐시된 모델을 해제해 OOM 방지.
    await free_memory()
    await _emit(on_event, {"type": "freed", "prompt_id": pid, "kind": kind})
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
