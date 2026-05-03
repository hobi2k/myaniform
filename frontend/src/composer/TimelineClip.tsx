import { useEffect, useRef, useState } from "react";
import type { ClipSlot } from "./types";

interface Props {
  slot: ClipSlot;
  index: number;
  pxPerSec: number;
  trackHeight: number;
  isPlaying: boolean;
  isSelected?: boolean;
  slotsCount: number;
  ghostMode: boolean;
  onSelect: () => void;
  onTrim?: (clipId: string, inSec: number, outSec: number) => void;
  onReorderToIndex: (targetIdx: number) => void;
  onDragStateChange: (dragging: boolean) => void;
}

const HANDLE_WIDTH = 8;
const TYPE_COLOR: Record<string, string> = {
  lipsync: "#7aa2ff",
  basic: "#22d3ee",
  loop: "#4ade80",
  effect: "#fbbf24",
};

type DragMode = "move" | "trim-in" | "trim-out" | null;

interface DragStart {
  mode: Exclude<DragMode, null>;
  pointerX: number;
  baseInSec: number;
  baseOutSec: number;
}

export default function TimelineClip({
  slot,
  index,
  pxPerSec,
  trackHeight,
  isPlaying,
  isSelected = false,
  slotsCount,
  ghostMode,
  onSelect,
  onTrim,
  onReorderToIndex,
}: Props) {
  const { clip } = slot;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragStart | null>(null);
  // While dragging-move, we track the simulated center-X to compute drop index.
  const [dragXOffset, setDragXOffset] = useState(0);

  const startX = slot.start * pxPerSec;
  const widthPx = (slot.end - slot.start) * pxPerSec;

  const beginDrag = (mode: Exclude<DragMode, null>, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      mode,
      pointerX: e.clientX,
      baseInSec: clip.clip_in_offset_sec,
      baseOutSec: clip.clip_out_offset_sec,
    });
    if (mode === "move") setDragXOffset(0);
  };

  // Pointer move: translate to time delta in source-clip seconds.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dxPx = e.clientX - drag.pointerX;
      if (drag.mode === "move") {
        setDragXOffset(dxPx);
        return;
      }
      const dxSec = dxPx / pxPerSec;
      let newIn = drag.baseInSec;
      let newOut = drag.baseOutSec;
      if (drag.mode === "trim-in") {
        newIn = Math.max(0, Math.min(drag.baseOutSec - 0.1, drag.baseInSec + dxSec));
      } else if (drag.mode === "trim-out") {
        newOut = Math.max(drag.baseInSec + 0.1, Math.min(clip.duration_sec, drag.baseOutSec + dxSec));
      }
      onTrim?.(clip.id, newIn, newOut);
    };
    const onUp = () => {
      if (drag.mode === "move" && Math.abs(dragXOffset) > 12) {
        // Determine target index from accumulated offset.
        const newCenterPx = startX + widthPx / 2 + dragXOffset;
        const targetIdx = Math.max(0, Math.min(slotsCount - 1, Math.floor(newCenterPx / Math.max(40, widthPx / 2))));
        // Simpler: shift by dragXOffset in clip-widths.
        const shift = Math.round(dragXOffset / Math.max(40, widthPx));
        const targetByShift = Math.max(0, Math.min(slotsCount - 1, index + shift));
        onReorderToIndex(targetByShift !== index ? targetByShift : targetIdx);
      }
      setDrag(null);
      setDragXOffset(0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, dragXOffset, pxPerSec, clip.duration_sec, clip.id, index, slotsCount, startX, widthPx, onTrim, onReorderToIndex]);

  const accent = TYPE_COLOR[clip.type] ?? "#7aa2ff";
  const showThumb = !!clip.image_url;

  // Apply drag-move offset visually.
  const visualLeft = drag?.mode === "move" ? startX + dragXOffset : startX;

  return (
    <div
      ref={cardRef}
      data-clip-card
      onPointerDown={(e) => {
        // Body click/drag begins move-mode unless a handle was hit.
        const t = e.target as HTMLElement;
        if (t.dataset.handle === "in") {
          beginDrag("trim-in", e);
        } else if (t.dataset.handle === "out") {
          beginDrag("trim-out", e);
        } else {
          beginDrag("move", e);
        }
      }}
      onClick={(e) => {
        // Click without drag → seek to clip start.
        if (Math.abs(dragXOffset) < 4 && !drag) onSelect();
        e.stopPropagation();
      }}
      className="absolute group rounded-md overflow-hidden border cursor-grab active:cursor-grabbing select-none touch-none"
      style={{
        left: visualLeft,
        top: 4,
        width: widthPx,
        height: trackHeight - 8,
        background: showThumb ? "#000" : `${accent}33`,
        borderColor: isSelected
          ? "#ff7a90"
          : ghostMode
            ? accent
            : "rgba(255,255,255,0.14)",
        borderWidth: isSelected ? 2 : 1,
        opacity: ghostMode ? 0.6 : 1,
        zIndex: drag?.mode === "move" ? 30 : isSelected ? 20 : 10,
        boxShadow: drag?.mode === "move"
          ? "0 6px 20px rgba(0,0,0,0.6)"
          : isSelected
            ? "0 0 0 2px rgba(255,122,144,0.35)"
            : undefined,
      }}
    >
      {showThumb && (
        <img
          src={clip.image_url!}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover opacity-90 pointer-events-none"
        />
      )}
      <div
        className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[9px] font-mono text-white pointer-events-none"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
        }}
      >
        <span className="opacity-80">#{index + 1}</span>{" "}
        <span className="opacity-60">{(slot.end - slot.start).toFixed(1)}s</span>
        {clip.clip_in_offset_sec > 0 || clip.clip_out_offset_sec < clip.duration_sec ? (
          <span className="opacity-60"> · trim {clip.clip_in_offset_sec.toFixed(1)}–{clip.clip_out_offset_sec.toFixed(1)}</span>
        ) : null}
      </div>
      <div
        className="absolute top-1 left-1 px-1 py-0.5 text-[9px] font-mono rounded"
        style={{ background: accent, color: "#0d1117" }}
      >
        {clip.type[0].toUpperCase()}
      </div>
      {clip.clip_stale && (
        <div className="absolute top-1 right-1 px-1 py-0.5 text-[9px] font-mono bg-yellow-500/90 text-black rounded">
          stale
        </div>
      )}

      {/* Trim handles */}
      <div
        data-handle="in"
        className="absolute top-0 left-0 h-full bg-white/0 hover:bg-white/30 cursor-ew-resize"
        style={{ width: HANDLE_WIDTH }}
        title={`트림 시작 (${clip.clip_in_offset_sec.toFixed(2)}s)`}
      />
      <div
        data-handle="out"
        className="absolute top-0 right-0 h-full bg-white/0 hover:bg-white/30 cursor-ew-resize"
        style={{ width: HANDLE_WIDTH }}
        title={`트림 끝 (${clip.clip_out_offset_sec.toFixed(2)}s / ${clip.duration_sec.toFixed(2)}s)`}
      />

      {isPlaying && drag === null && null}
    </div>
  );
}
