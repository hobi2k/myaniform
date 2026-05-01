import type { StreamState } from "../../hooks/useGenerationStream";

interface Props {
  task: StreamState;
}

export default function TaskProgress({ task }: Props) {
  if (task.stage === "idle" && task.logs.length === 0) return null;

  const tone =
    task.stage === "error"
      ? "border-red-500/40 bg-red-950/20"
      : task.stage === "complete"
        ? "border-emerald-500/40 bg-emerald-950/20"
        : "border-accent/30 bg-surface-overlay/40";

  const barTone =
    task.stage === "error"
      ? "bg-red-500"
      : task.stage === "complete"
        ? "bg-emerald-500"
        : "bg-gradient-to-r from-accent-hover to-accent";

  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-200 truncate">
            {task.label || "작업 상태"}
          </p>
          <p className="text-[11px] text-gray-400 truncate">
            {task.message || "대기 중"}
          </p>
        </div>
        <span className="text-xs font-mono text-accent flex-shrink-0">{task.progressPct}%</span>
      </div>
      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden mb-2">
        <div className={`h-full transition-all duration-300 ${barTone}`} style={{ width: `${task.progressPct}%` }} />
      </div>
      {task.node && task.stage === "running" && (
        <p className="text-[11px] text-gray-500 mb-2">현재 노드: {task.node}</p>
      )}
      <div className="rounded-lg bg-black/30 border border-white/5 p-2 max-h-32 overflow-y-auto font-mono text-[11px] text-gray-300 space-y-0.5">
        {task.logs.length === 0 ? (
          <div className="text-gray-600">로그 대기 중...</div>
        ) : (
          task.logs.map((line, index) => (
            <div key={index} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
      </div>
      {task.error && <p className="mt-2 text-xs text-red-300">{task.error}</p>}
    </div>
  );
}
