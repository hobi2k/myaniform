interface Props {
  totalDuration: number;
  pxPerSec: number;
}

/**
 * Time ruler. Tick density adapts to zoom: every 1s when zoomed in, every
 * 5s/15s/30s/1min as we zoom out. Major ticks get labels; minor ticks just
 * a hatch.
 */
export default function TimelineRuler({ totalDuration, pxPerSec }: Props) {
  const majorStep = chooseMajorStep(pxPerSec);
  const minorStep = majorStep / 5;
  const ticks: { t: number; major: boolean }[] = [];
  for (let t = 0; t <= totalDuration + 0.01; t += minorStep) {
    const isMajor = Math.abs((t / majorStep) - Math.round(t / majorStep)) < 0.001;
    ticks.push({ t: Math.round(t * 1000) / 1000, major: isMajor });
  }

  return (
    <div className="absolute left-0 right-0 top-0 h-7 bg-black/40 border-b border-white/10 select-none">
      {ticks.map((tk, i) => {
        const x = tk.t * pxPerSec;
        return (
          <div
            key={i}
            className={`absolute top-0 ${tk.major ? "h-7 border-l border-white/30" : "h-3 border-l border-white/10"}`}
            style={{ left: x }}
          >
            {tk.major && (
              <span className="absolute -top-0.5 left-1 text-[9px] font-mono text-gray-500 whitespace-nowrap">
                {fmt(tk.t)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function chooseMajorStep(pxPerSec: number): number {
  // Aim for ~80px between major ticks regardless of zoom.
  const target = 80;
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const c of candidates) {
    if (c * pxPerSec >= target) return c;
  }
  return candidates[candidates.length - 1];
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  if (m === 0) return `${s}s`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
