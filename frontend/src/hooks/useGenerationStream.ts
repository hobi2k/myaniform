import { useCallback, useState } from "react";

export type StreamStage =
  | "idle"
  | "preparing"
  | "queued"
  | "running"
  | "saving"
  | "complete"
  | "error";

export interface StreamEvent<T> {
  type: "status" | "complete" | "error";
  stage?: StreamStage;
  message?: string;
  progress_pct?: number;
  node?: string;
  prompt_id?: string;
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
            } else if (ev.type === "complete") {
              const entity = (ev as Record<string, unknown>)[payloadField] as T | undefined;
              setTask((prev) => ({
                ...prev,
                stage: "complete",
                message: `${label} 완료`,
                progressPct: 100,
                running: false,
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
