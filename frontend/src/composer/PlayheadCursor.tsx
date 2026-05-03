import { useEffect, useRef, useState } from "react";

interface Props {
  currentTime: number;
  duration: number;
  pxPerSec: number;
  trackHeight: number;
  onSeek: (t: number) => void;
}

/**
 * Vertical playhead cursor. Drawn over the timeline track. Dragging the cap
 * scrubs the master playhead.
 */
export default function PlayheadCursor({ currentTime, duration, pxPerSec, trackHeight, onSeek }: Props) {
  const [drag, setDrag] = useState(false);
  const startXRef = useRef<number>(0);
  const baseTRef = useRef<number>(0);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startXRef.current;
      const dt = dx / pxPerSec;
      const t = Math.max(0, Math.min(duration, baseTRef.current + dt));
      onSeek(t);
    };
    const onUp = () => setDrag(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, pxPerSec, duration, onSeek]);

  const x = currentTime * pxPerSec;

  return (
    <div
      data-playhead
      className="absolute top-0 z-40 pointer-events-none"
      style={{ left: x - 6, height: trackHeight, width: 12 }}
    >
      {/* Vertical line */}
      <div
        className="absolute"
        style={{
          left: 6,
          top: 0,
          bottom: 0,
          width: 1.5,
          background: "#ff7a90",
          boxShadow: "0 0 6px rgba(255,122,144,0.7)",
        }}
      />
      {/* Cap (pointer-active) */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          startXRef.current = e.clientX;
          baseTRef.current = currentTime;
          setDrag(true);
        }}
        className="absolute pointer-events-auto cursor-ew-resize"
        style={{
          left: 0,
          top: 0,
          width: 12,
          height: 14,
          background: "#ff7a90",
          border: "1.5px solid white",
          borderRadius: 2,
        }}
        title={`현재 시점 ${currentTime.toFixed(2)}s — 드래그하여 이동`}
      />
    </div>
  );
}
