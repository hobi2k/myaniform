import type { CSSProperties } from "react";
import type { ClipSlot } from "./types";
import type { EditOverlay, EditRenderSettings } from "../types";
import { computeAnimatedStyle, overlayBoxStyle } from "./overlay/animations";

interface Props {
  slots: ClipSlot[];
  globalTime: number;
  overlays: EditOverlay[];
  subtitleStyle: EditRenderSettings["subtitle_style"];
  /** Active scene's dialogue rendered as the primary subtitle line. */
  activeDialogue: string | null;
}

const ANIM_DEFAULT_SEC = 0.4;

/**
 * Time-driven overlay rendering:
 *   - Active scene's `dialogue` → primary subtitle line (settings-styled).
 *   - User overlays (title/caption/sticker/shape/image) → positioned per their
 *     kind/x/y/rotation, shown during their absolute [start, start+duration]
 *     window. Entry/exit animations interpolated against animation_duration.
 *
 * Position is stored in the overlay as 0..1 fractions of the player area.
 * Defaults (when x/y missing) fall back to kind-based placement so legacy
 * overlays still render sensibly.
 */
export default function OverlayLayer({ slots, globalTime, overlays, subtitleStyle, activeDialogue }: Props) {
  const subtitleStyleObj: CSSProperties = {
    position: "absolute",
    left: "50%",
    bottom: subtitleStyle.margin_v,
    transform: "translateX(-50%)",
    fontSize: subtitleStyle.font_size,
    color: "white",
    textAlign: "center",
    maxWidth: "90%",
    lineHeight: 1.25,
    textShadow:
      `0 0 ${subtitleStyle.outline}px black,` +
      `0 ${subtitleStyle.shadow}px ${Math.max(2, subtitleStyle.shadow * 2)}px rgba(0,0,0,0.7)`,
    fontWeight: 600,
    letterSpacing: 0.4,
    pointerEvents: "none",
  };

  return (
    <>
      {activeDialogue && <div style={subtitleStyleObj}>{activeDialogue}</div>}
      {overlays.map((ov, i) => {
        const slot = slots[ov.scene_index];
        if (!slot) return null;
        const sceneStart = slot.start;
        const visibleStart = sceneStart + ov.start;
        const visibleEnd = visibleStart + ov.duration;
        if (globalTime < visibleStart || globalTime > visibleEnd) return null;

        // Entry/exit progress (0..1).
        const animDur = ov.animation_duration ?? ANIM_DEFAULT_SEC;
        const enterT = animDur > 0 ? Math.min(1, (globalTime - visibleStart) / animDur) : 1;
        const exitT = animDur > 0 ? Math.max(0, 1 - (visibleEnd - globalTime) / animDur) : 0;

        const { x, y, rotation } = resolvePosition(ov);
        const baseTransform = buildBaseTransform(ov, rotation);
        const animated = computeAnimatedStyle(ov, enterT, exitT, baseTransform);

        const positionStyle: CSSProperties = {
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          maxWidth: ov.width !== undefined ? `${ov.width * 100}%` : "90%",
          width: ov.width !== undefined ? `${ov.width * 100}%` : undefined,
          opacity: animated.opacity,
          transform: animated.transform,
          transformOrigin: "center center",
          textAlign: "center",
        };

        return (
          <div key={ov.id ?? `ov-${i}`} style={positionStyle}>
            <div style={overlayBoxStyle(ov)}>{ov.text ?? ""}</div>
          </div>
        );
      })}
    </>
  );
}

/**
 * Default position by kind when x/y are not set (legacy overlays).
 */
function resolvePosition(ov: EditOverlay): { x: number; y: number; rotation: number } {
  const rotation = ov.rotation ?? 0;
  if (ov.x !== undefined && ov.y !== undefined) return { x: ov.x, y: ov.y, rotation };
  switch (ov.kind) {
    case "title":
      return { x: 0.5, y: 0.07, rotation };
    case "sticker":
      return { x: 0.92, y: 0.12, rotation };
    case "caption":
    default:
      return { x: 0.5, y: 0.83, rotation };
  }
}

function buildBaseTransform(_ov: EditOverlay, rotation: number): string {
  // Center the box on (x, y). Rotation is around that center.
  const parts = ["translate(-50%, -50%)"];
  if (rotation) parts.push(`rotate(${rotation}deg)`);
  return parts.join(" ");
}
