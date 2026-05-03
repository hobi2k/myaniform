import type { CSSProperties } from "react";
import type { ColorPreset } from "../types";

/**
 * CSS filter strings approximating each `color_preset` ffmpeg pipeline.
 *
 * The backend renderer (ffmpeg) owns the precise color science. These filters
 * are an in-browser approximation tuned to match the look closely enough for
 * preview judgment. They are deliberately cheap — applied as a single
 * `filter:` CSS property so the GPU can compose them with no extra layers.
 */
export function colorGradeFilter(preset: ColorPreset): string {
  switch (preset) {
    case "reference_soft":
      return "saturate(0.85) contrast(0.94) brightness(1.02) sepia(0.05)";
    case "warm_room":
      return "saturate(0.95) contrast(0.96) brightness(1.04) sepia(0.12)";
    case "clean_neutral":
      return "saturate(1.0) contrast(1.0) brightness(1.0)";
    case "dream_blush":
      return "saturate(0.78) contrast(0.92) brightness(1.05) sepia(0.18) hue-rotate(-6deg)";
    default:
      return "none";
  }
}

/**
 * Vignette overlay tuned 0..10. Anything ≤ 0 disables. Edges darken with a
 * radial gradient. The strength curve maps linearly to corner alpha 0..0.7.
 */
export function vignetteStyle(strength: number): CSSProperties {
  if (!strength || strength <= 0) return { display: "none" };
  const alpha = Math.min(0.7, strength / 14);
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background: `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${alpha}) 100%)`,
  };
}

/**
 * SVG-noise film-grain overlay tuned 0..10. ≤ 0 disables. Tiles a fractal
 * noise SVG and composites with `mix-blend-mode: overlay`.
 */
export function grainStyle(strength: number): CSSProperties {
  if (!strength || strength <= 0) return { display: "none" };
  const opacity = Math.min(0.18, strength / 60);
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='1'/></svg>`,
  );
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    backgroundImage: `url("data:image/svg+xml;utf8,${svg}")`,
    opacity,
    mixBlendMode: "overlay",
  };
}
