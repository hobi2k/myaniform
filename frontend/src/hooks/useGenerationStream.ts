import { useCallback, useState } from "react";

export type StreamStage =
  | "idle"
  | "preparing"
  | "queued"
  | "running"
  | "saving"
  | "complete"
  | "error";

/**
 * Union type for all SSE events emitted by myaniform's streaming endpoints.
 *
 * Two families share this hook:
 *   1. "status-shaped" events from `render_edit/stream` — high-level stage
 *      messages with `stage`, `message`, `progress_pct`.
 *   2. ComfyUI passthrough events from `regenerate/image/stream` and
 *      `regenerate/voice/stream` — per-node `queued/executing/progress/
 *      executed/preview_image/freed/output_ready` events forwarded straight
 *      from the ComfyUI websocket.
 *
 * Both end with `complete` (with arbitrary payload field) or `error`.
 */
export interface StreamEvent<T> {
  type:
    | "status"
    | "complete"
    | "error"
    | "queued"
    | "executing"
    | "progress"
    | "executed"
    | "preview_image"
    | "freed"
    | "output_ready";
  stage?: StreamStage;
  message?: string;
  progress_pct?: number;
  value?: number;
  max?: number;
  node?: string;
  prompt_id?: string;
  data_url?: string;
  mime?: string;
  size?: number;
  path?: string;
  /** Backend-specific payload key for the completed entity (e.g. "character" or "scene"). */
  [k: string]: unknown;
  payload?: T;
}

export interface StreamState {
  kind: string | null;
  label: string;
  stage: StreamStage;
  message: string;
  progressPct: number;
  node: string | null;
  logs: string[];
  error: string | null;
  running: boolean;
  /** Latest base64 data URL from a ComfyUI `preview_image` (latent thumbnail).
   *  null until the first preview frame; cleared on reset/complete. */
  previewDataUrl: string | null;
}

export const IDLE_STREAM: StreamState = {
  kind: null,
  label: "",
  stage: "idle",
  message: "",
  progressPct: 0,
  node: null,
  logs: [],
  error: null,
  running: false,
  previewDataUrl: null,
};

export interface RunStreamOpts<T> {
  kind: string;
  label: string;
  url: string;
  body?: unknown;
  /** Field name on the SSE 'complete' event that holds the updated entity. */
  payloadField: string;
  beforeStart?: () => Promise<void>;
  onComplete?: (entity: T) => void;
}

/**
 * Generic SSE consumer for /stream endpoints emitting:
 *   data: {"type":"status", stage, message, progress_pct, node, prompt_id}
 *   data: {"type":"complete", <payloadField>: {...}}
 *   data: {"type":"error", message}
 */
export function useGenerationStream<T = unknown>() {
  const [task, setTask] = useState<StreamState>(IDLE_STREAM);

  const reset = useCallback(() => setTask(IDLE_STREAM), []);

  const appendLog = useCallback((message: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    setTask((prev) => ({ ...prev, logs: [...prev.logs, line] }));
  }, []);

  const shouldLogStatus = (ev: StreamEvent<T>) => {
    if (ev.stage !== "running") return true;
    const pct = ev.progress_pct ?? -1;
    return pct >= 0 && pct % 10 === 0;
  };

  const run = useCallback(
    async ({ kind, label, url, body, payloadField, beforeStart, onComplete }: RunStreamOpts<T>) => {
      setTask({
        kind,
        label,
        stage: "preparing",
        message: "작업 준비 중...",
        progressPct: 1,
        node: null,
        logs: [`[${new Date().toLocaleTimeString()}] ${label} 시작`],
        error: null,
        running: true,
        previewDataUrl: null,
      });

      try {
        if (beforeStart) await beforeStart();

        const resp = await fetch(url, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!resp.ok || !resp.body) {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }));
          throw new Error(err.detail ?? `${label} 요청 실패`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const ev = JSON.parse(line.slice(6)) as StreamEvent<T>;
            if (ev.type === "status") {
              setTask((prev) => ({
                ...prev,
                stage: ev.stage ?? prev.stage,
                message: ev.message ?? prev.message,
                progressPct: ev.progress_pct ?? prev.progressPct,
                node: ev.node ?? prev.node,
                running: (ev.stage ?? prev.stage) !== "complete",
              }));
              if (ev.message && shouldLogStatus(ev)) appendLog(ev.message);
            } else if (ev.type === "queued") {
              // ComfyUI passthrough: prompt accepted into the queue.
              setTask((prev) => ({ ...prev, stage: "queued", message: "ComfyUI 큐 진입" }));
              appendLog("ComfyUI 큐 진입");
            } else if (ev.type === "executing") {
              setTask((prev) => ({
                ...prev,
                stage: "running",
                node: ev.node ?? prev.node,
                message: ev.node ? `노드 ${ev.node} 실행 중` : prev.message,
              }));
            } else if (ev.type === "progress") {
              // Per-sampler-step progress (0..100). Multiple nodes (sampler →
              // face detailer → hand detailer) each cycle through 0→100, so
              // we don't try to reconcile into a single global percentage —
              // we just expose the current step %.
              setTask((prev) => ({
                ...prev,
                stage: "running",
                node: ev.node ?? prev.node,
                progressPct: ev.progress_pct ?? prev.progressPct,
              }));
            } else if (ev.type === "preview_image" && ev.data_url) {
              // Latent thumbnail — overwrite so UI shows the freshest one.
              setTask((prev) => ({ ...prev, previewDataUrl: ev.data_url ?? null }));
            } else if (ev.type === "executed") {
              // Per-node completion (no extra UI state beyond a log line).
              if (ev.node) appendLog(`노드 ${ev.node} 완료`);
            } else if (ev.type === "output_ready") {
              setTask((prev) => ({ ...prev, stage: "saving", message: "결과 파일 저장 중", progressPct: 95 }));
              appendLog("산출물 파일 준비 완료");
            } else if (ev.type === "freed") {
              // VRAM freed — informational log only.
            } else if (ev.type === "complete") {
              const entity = (ev as Record<string, unknown>)[payloadField] as T | undefined;
              setTask((prev) => ({
                ...prev,
                stage: "complete",
                message: `${label} 완료`,
                progressPct: 100,
                running: false,
                // Keep the last preview thumbnail visible after complete so
                // the UI doesn't flash empty between SSE end and asset
                // version bump that swaps to the real file.
              }));
              appendLog(`${label} 완료`);
              if (entity && onComplete) onComplete(entity);
            } else if (ev.type === "error") {
              throw new Error(ev.message ?? `${label} 실패`);
            }
          }
        }
      } catch (err) {
        const message = (err as Error).message;
        setTask((prev) => ({
          ...prev,
          stage: "error",
          message,
          error: message,
          running: false,
        }));
        appendLog(`오류: ${message}`);
      }
    },
    [appendLog],
  );

  return { task, run, reset, appendLog };
}
