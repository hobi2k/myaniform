import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export type StepState = "todo" | "ready" | "running" | "done" | "stale" | "blocked";

interface Props {
  index: number;
  title: string;
  subtitle?: string;
  state: StepState;
  /** Right-aligned slot (typically a Generate button) */
  action?: ReactNode;
  /** Body shown only when expanded */
  children?: ReactNode;
  open: boolean;
  onToggle: () => void;
}

const STATE_LABEL: Record<StepState, string> = {
  todo: "대기",
  ready: "준비됨",
  running: "실행 중",
  done: "완료",
  stale: "오래됨",
  blocked: "선행 단계 필요",
};

function StateIcon({ state }: { state: StepState }) {
  if (state === "done")
    return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (state === "running")
    return <Loader2 className="w-4 h-4 text-accent animate-spin" />;
  if (state === "stale")
    return <Circle className="w-4 h-4 text-yellow-400" />;
  if (state === "blocked")
    return <Circle className="w-4 h-4 text-gray-700" />;
  return <Circle className="w-4 h-4 text-gray-500" />;
}

export default function StepCard({ index, title, subtitle, state, action, children, open, onToggle }: Props) {
  const tone =
    state === "done"
      ? "border-emerald-500/30"
      : state === "running"
        ? "border-accent/40"
        : state === "stale"
          ? "border-yellow-500/30"
          : state === "blocked"
            ? "border-white/5 opacity-70"
            : "border-white/10";

  const stateColor =
    state === "done"
      ? "text-emerald-300"
      : state === "running"
        ? "text-accent"
        : state === "stale"
          ? "text-yellow-300"
          : "text-gray-500";

  return (
    <section className={`rounded-xl border ${tone} bg-surface-overlay/30`}>
      <header
        className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] font-mono text-gray-500 w-4 text-right">{index}</span>
          <StateIcon state={state} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-100 truncate">{title}</p>
          {subtitle && <p className="text-[11px] text-gray-500 truncate">{subtitle}</p>}
        </div>
        <span className={`text-[10px] flex-shrink-0 ${stateColor}`}>{STATE_LABEL[state]}</span>
        {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
      </header>
      {open && children && (
        <div className="px-3 pb-3 border-t border-white/5 pt-3">{children}</div>
      )}
    </section>
  );
}
