import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  header: ReactNode;
  library: ReactNode;
  preview: ReactNode;
  inspector: ReactNode;
  timeline: ReactNode;
}

/**
 * Three-pane editor shell with collapsible bottom timeline strip.
 *
 *   ┌──────────────── header (status) ────────────────┐
 *   │ library │      preview         │   inspector    │
 *   └─────────────── timeline (toggle) ───────────────┘
 */
export default function EditorShell({ header, library, preview, inspector, timeline }: Props) {
  const [showTimeline, setShowTimeline] = useState(true);

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] gap-2">
      {header}
      <div className="grid flex-1 min-h-0 gap-2 grid-cols-[260px_1fr_420px] grid-rows-1">
        <div className="rounded-xl border border-white/10 bg-surface-overlay/30 overflow-y-auto min-h-0">
          {library}
        </div>
        <div className="rounded-xl border border-white/10 bg-surface-overlay/30 overflow-hidden flex min-h-0">
          {preview}
        </div>
        <div className="rounded-xl border border-white/10 bg-surface-overlay/30 overflow-y-auto min-h-0">
          {inspector}
        </div>
      </div>
      <div className="flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowTimeline((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-accent transition-colors px-2 py-1"
        >
          {showTimeline ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          타임라인 {showTimeline ? "숨김" : "보기"}
        </button>
        {showTimeline && (
          <div className="rounded-xl border border-white/10 bg-surface-overlay/30 overflow-x-auto">
            {timeline}
          </div>
        )}
      </div>
    </div>
  );
}
