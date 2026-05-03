import type { CSSProperties } from "react";
import type { EditOverlay, OverlayAnimationIn, OverlayAnimationOut } from "../../types";

/**
 * Compute the CSS transform/opacity for an overlay based on the elapsed time
 * within its display window.
 *
 * - `enterT` 0..1 — progress through the entry animation (0 = just appeared).
 * - `exitT`  0..1 — progress through the exit animation (1 = about to vanish).
 *
 * Both are passed in by the OverlayLayer; this helper just maps them to CSS.
 */
export interface AnimatedStyle {
  opacity: number;
  transform: string;
}

const SLIDE_PX = 80;

export function computeAnimatedStyle(
  ov: EditOverlay,
  enterT: number,   // 0..1 (0 = just appeared, 1 = fully in)
  exitT: number,    // 0..1 (0 = stable, 1 = fully out)
  baseTransform: string,
): AnimatedStyle {
  const inKind: OverlayAnimationIn = ov.animation_in ?? "fade";
  const outKind: OverlayAnimationOut = ov.animation_out ?? "fade";
  let opacity = 1;
  const tForms: string[] = [baseTransform];

  // Entry contribution.
  if (enterT < 1) {
    const t = clamp01(enterT);
    switch (inKind) {
      case "fade":
        opacity *= t;
        break;
      case "slide_up":
        opacity *= t;
        tForms.push(`translateY(${(1 - t) * SLIDE_PX}px)`);
        break;
      case "slide_left":
        opacity *= t;
        tForms.push(`translateX(${(1 - t) * SLIDE_PX}px)`);
        break;
      case "scale":
        opacity *= t;
        tForms.push(`scale(${0.8 + 0.2 * t})`);
        break;
      case "none":
      default:
        break;
    }
  }

  // Exit contribution (multiplies on top).
  if (exitT > 0) {
    const t = clamp01(exitT);
    switch (outKind) {
      case "fade":
        opacity *= 1 - t;
        break;
      case "slide_down":
        opacity *= 1 - t;
        tForms.push(`translateY(${t * SLIDE_PX}px)`);
        break;
      case "slide_right":
        opacity *= 1 - t;
        tForms.push(`translateX(${t * SLIDE_PX}px)`);
        break;
      case "scale":
        opacity *= 1 - t;
        tForms.push(`scale(${1 - 0.2 * t})`);
        break;
      case "none":
      default:
        break;
    }
  }

  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    transform: tForms.join(" "),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** CSS for the overlay box itself (color/font/background/outline). */
export function overlayBoxStyle(ov: EditOverlay): CSSProperties {
  const style: CSSProperties = {
    fontFamily: ov.font_family ?? "Pretendard, Inter, sans-serif",
    fontSize: ov.font_size ?? defaultFontSize(ov.kind),
    fontWeight: ov.font_weight ?? defaultFontWeight(ov.kind),
    color: ov.color ?? "white",
    background: ov.background,
    padding: ov.padding ?? defaultPadding(ov.kind),
    borderRadius: ov.kind === "sticker" ? 6 : 4,
    whiteSpace: "pre-wrap",
    pointerEvents: "none",
  };
  // Shadow + outline (text shadows can stack — outline first then drop shadow).
  const shadows: string[] = [];
  if (ov.outline) {
    const w = ov.outline_width ?? 2;
    // 8-direction outline approximation.
    const c = ov.outline;
    shadows.push(
      `${w}px 0 0 ${c}`,
      `-${w}px 0 0 ${c}`,
      `0 ${w}px 0 ${c}`,
      `0 -${w}px 0 ${c}`,
      `${w}px ${w}px 0 ${c}`,
      `-${w}px ${w}px 0 ${c}`,
      `${w}px -${w}px 0 ${c}`,
      `-${w}px -${w}px 0 ${c}`,
    );
  }
  if (ov.shadow) shadows.push(ov.shadow);
  if (shadows.length > 0) style.textShadow = shadows.join(", ");
  return style;
}

function defaultFontSize(kind: EditOverlay["kind"]): number {
  if (kind === "title") return 38;
  if (kind === "sticker") return 24;
  return 22;
}

function defaultFontWeight(kind: EditOverlay["kind"]): number {
  return kind === "title" ? 700 : 600;
}

function defaultPadding(kind: EditOverlay["kind"]): number {
  if (kind === "sticker") return 8;
  if (kind === "caption") return 6;
  return 0;
}
