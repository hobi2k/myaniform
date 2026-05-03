import { useEffect, useRef, useState } from "react";

interface Props {
  boundaryT: number;
  pxPerSec: number;
  trackHeight: number;
  transitionSec: number;
  onChange?: (sec: number) => void;
}

const MIN_TRANSITION = 0;
const MAX_TRANSITION = 3;

/**
 * Diamond handle straddling the boundary between two adjacent clips.
 * Drag horizontally to adjust the global transition_sec value.
 *
 * The transition is *symmetric* around the boundary — pulling the handle
 * outward (away from the boundary) shortens the transition; pulling inward
 * lengthens it. This matches how NLE 'crossfade tool' grips work.
 *
 * Note: per-boundary transitions arrive in M3+. For now this drives the
 * single global setting.
 */
export default function TransitionHandle({
  boundaryT,
  pxPerSec,
  trackHeight,
  transitionSec,
  onChange,
}: Props) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [drag, setDrag] = useState<{ pointerX: number; baseSec: number } | null>(null);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.pointerX;
      const ddt = dx / pxPerSec;
      // Drag right increases transition window proportionally.
      const next = Math.max(MIN_TRANSITION, Math.min(MAX_TRANSITION, drag.baseSec + ddt));
      onChange?.(next);
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, pxPerSec, onChange]);

  const x = boundaryT * pxPerSec;
  const size = 14;

  return (
    <button
      ref={ref}
      data-transition-handle
      type="button"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDrag({ pointerX: e.clientX, baseSec: transitionSec });
      }}
      title={`트랜지션 시간 ${transitionSec.toFixed(2)}s — 좌우로 드래그`}
      className="absolute z-20 grid place-items-center cursor-ew-resize border-0"
      style={{
        left: x - size / 2,
        top: trackHeight / 2 - size / 2,
        width: size,
        height: size,
        background: "transparent",
      }}
    >
      <span
        style={{
          width: size - 2,
          height: size - 2,
          background: "#ff7a90",
          transform: "rotate(45deg)",
          border: "1.5px solid white",
          boxShadow: "0 1px 3px rgba(0,0,0,0.6)",
        }}
      />
    </button>
  );
}
