import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipSlot } from "../types";
import type { EditOverlay } from "../../types";
import { overlayBoxStyle } from "./animations";

interface Props {
  slots: ClipSlot[];
  globalTime: number;
  overlays: EditOverlay[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: EditOverlay[]) => void;
  /** When the user double-clicks empty space, we create a new overlay starting
   *  at the *current* timeline second. Caller seeds default font/color etc. */
  defaults?: Partial<EditOverlay>;
}

type DragMode =
  | { kind: "none" }
  | { kind: "move"; id: string; pointerX: number; pointerY: number; baseX: number; baseY: number }
  | { kind: "resize"; id: string; pointerX: number; pointerY: number; baseW: number; baseH: number; baseFs: number }
  | { kind: "rotate"; id: string; centerX: number; centerY: number; baseAngle: number; pointerAngle: number };

const DEFAULT_OVERLAY_DURATION = 3;
const MIN_FONT_SIZE = 10;

/**
 * Transparent layer sitting on top of the Player rendering stage. Provides:
 *   - Double-click empty area → create new caption at that point, current time.
 *   - Click overlay → select.
 *   - Drag overlay body → move (x/y persisted as 0..1).
 *   - Drag corner handle → resize via font_size scaling (no fixed width box).
 *   - Drag rotation handle (top) → rotate.
 *   - Delete key when selected → remove.
 *
 * Visible overlays (within their [start, start+duration] window at current
 * globalTime) are rendered with selection handles. Off-window overlays are
 * not interactive — only what the viewer sees can be edited at this moment.
 */
export default function OverlayCanvas({
  slots,
  globalTime,
  overlays,
  selectedId,
  onSelect,
  onChange,
  defaults,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragMode>({ kind: "none" });

  // Compute which overlays are visible right now.
  const visible = useMemo(() => {
    return overlays
      .map((ov, idx) => {
        const slot = slots[ov.scene_index];
        if (!slot) return null;
        const sceneStart = slot.start;
        const start = sceneStart + ov.start;
        const end = start + ov.duration;
        if (globalTime < start || globalTime > end) return null;
        return { ov, idx, absStart: start, absEnd: end };
      })
      .filter((x): x is { ov: EditOverlay; idx: number; absStart: number; absEnd: number } => !!x);
  }, [overlays, slots, globalTime]);

  // Determine which scene_index to assign to a new overlay based on globalTime.
  const currentSceneIndex = useMemo(() => {
    let idx = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].start <= globalTime) idx = i;
      else break;
    }
    return idx;
  }, [slots, globalTime]);

  // ─── Drag handling (window-level pointermove/up) ───────────────────────
  useEffect(() => {
    if (drag.kind === "none") return;
    const onMove = (e: PointerEvent) => {
      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      if (drag.kind === "move") {
        const dx = (e.clientX - drag.pointerX) / rect.width;
        const dy = (e.clientY - drag.pointerY) / rect.height;
        const next = overlays.map((ov) =>
          ov.id === drag.id
            ? {
                ...ov,
                x: clamp01(drag.baseX + dx),
                y: clamp01(drag.baseY + dy),
              }
            : ov,
        );
        onChange(next);
      } else if (drag.kind === "resize") {
        // Use the larger of dx/dy (in screen px) as scale factor on font_size.
        const dx = e.clientX - drag.pointerX;
        const dy = e.clientY - drag.pointerY;
        const delta = Math.max(dx, dy);
        const newFs = Math.max(MIN_FONT_SIZE, drag.baseFs + delta * 0.5);
        const next = overlays.map((ov) =>
          ov.id === drag.id ? { ...ov, font_size: Math.round(newFs) } : ov,
        );
        onChange(next);
      } else if (drag.kind === "rotate") {
        const angle = Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX);
        const delta = ((angle - drag.pointerAngle) * 180) / Math.PI;
        const next = overlays.map((ov) =>
          ov.id === drag.id ? { ...ov, rotation: Math.round((drag.baseAngle + delta) * 10) / 10 } : ov,
        );
        onChange(next);
      }
    };
    const onUp = () => setDrag({ kind: "none" });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, overlays, onChange]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onChange(overlays.filter((o) => o.id !== selectedId));
        onSelect(null);
      } else if (e.key === "Escape") {
        onSelect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, overlays, onChange, onSelect]);

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-overlay]")) return;
    if ((e.target as HTMLElement).closest("[data-overlay-handle]")) return;
    onSelect(null);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-overlay]")) return;
    const c = containerRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // Convert globalTime → relative to scene at clicked moment.
    const slot = slots[currentSceneIndex];
    const sceneRelativeStart = slot ? Math.max(0, globalTime - slot.start) : 0;
    const id = `ov-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(16)}`;
    const newOverlay: EditOverlay = {
      id,
      kind: "caption",
      text: "텍스트",
      scene_index: currentSceneIndex,
      start: sceneRelativeStart,
      duration: DEFAULT_OVERLAY_DURATION,
      x,
      y,
      rotation: 0,
      font_size: 22,
      color: "white",
      shadow: "0 2px 6px rgba(0,0,0,0.7)",
      outline: "rgba(0,0,0,0.85)",
      outline_width: 1,
      animation_in: "fade",
      animation_out: "fade",
      animation_duration: 0.4,
      ...defaults,
    };
    onChange([...overlays, newOverlay]);
    onSelect(id);
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-30"
      onClick={handleBackgroundClick}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: "crosshair" }}
    >
      {visible.map(({ ov }) => {
        const isSelected = ov.id != null && ov.id === selectedId;
        const x = ov.x ?? 0.5;
        const y = ov.y ?? 0.5;
        const rotation = ov.rotation ?? 0;
        return (
          <div
            key={ov.id ?? `${ov.scene_index}-${ov.start}`}
            data-overlay
            onPointerDown={(e) => {
              e.stopPropagation();
              if (!ov.id) return;
              onSelect(ov.id);
              const c = containerRef.current;
              if (!c) return;
              setDrag({
                kind: "move",
                id: ov.id,
                pointerX: e.clientX,
                pointerY: e.clientY,
                baseX: x,
                baseY: y,
              });
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            className="absolute"
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              maxWidth: ov.width !== undefined ? `${ov.width * 100}%` : "80%",
              cursor: "move",
              outline: isSelected ? "1.5px dashed #ff7a90" : "none",
              outlineOffset: 4,
            }}
          >
            <div style={{ ...overlayBoxStyle(ov), pointerEvents: "auto" }}>{ov.text ?? ""}</div>

            {isSelected && (
              <SelectionHandles
                ov={ov}
                onResizeStart={(e, fs) => {
                  e.stopPropagation();
                  setDrag({
                    kind: "resize",
                    id: ov.id!,
                    pointerX: e.clientX,
                    pointerY: e.clientY,
                    baseW: 0,
                    baseH: 0,
                    baseFs: fs,
                  });
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onRotateStart={(e) => {
                  e.stopPropagation();
                  const c = containerRef.current;
                  if (!c) return;
                  const rect = c.getBoundingClientRect();
                  const cx = rect.left + x * rect.width;
                  const cy = rect.top + y * rect.height;
                  const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
                  setDrag({
                    kind: "rotate",
                    id: ov.id!,
                    centerX: cx,
                    centerY: cy,
                    baseAngle: rotation,
                    pointerAngle: angle,
                  });
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SelectionHandles({
  ov,
  onResizeStart,
  onRotateStart,
}: {
  ov: EditOverlay;
  onResizeStart: (e: React.PointerEvent, currentFontSize: number) => void;
  onRotateStart: (e: React.PointerEvent) => void;
}) {
  const fs = ov.font_size ?? 22;
  return (
    <>
      {/* Corner resize handle (bottom-right). */}
      <div
        data-overlay-handle
        onPointerDown={(e) => onResizeStart(e, fs)}
        className="absolute"
        style={{
          right: -8,
          bottom: -8,
          width: 14,
          height: 14,
          background: "#ff7a90",
          border: "1.5px solid white",
          borderRadius: 2,
          cursor: "nwse-resize",
          pointerEvents: "auto",
          touchAction: "none",
        }}
        title="크기 조절"
      />
      {/* Rotation handle on top. */}
      <div
        data-overlay-handle
        onPointerDown={onRotateStart}
        className="absolute"
        style={{
          left: "50%",
          top: -28,
          width: 14,
          height: 14,
          marginLeft: -7,
          background: "#fff",
          border: "1.5px solid #ff7a90",
          borderRadius: "50%",
          cursor: "grab",
          pointerEvents: "auto",
          touchAction: "none",
        }}
        title="회전"
      />
      {/* Connector line for rotation handle. */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: "50%",
          top: -14,
          width: 1.5,
          height: 14,
          marginLeft: -0.75,
          background: "#ff7a90",
        }}
      />
    </>
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
