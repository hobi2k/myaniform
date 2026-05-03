import type { CSSProperties } from "react";
import type { EditTransitionStyle } from "../types";

/**
 * Compute per-layer styles during a transition window.
 *
 * `incomingProgress` 0..1 — the active clip's incoming reveal (0 = just entering
 * frame, 1 = fully visible).
 * `outgoingProgress` 0..1 — the previous clip's outgoing fade (0 = just started,
 * 1 = gone).
 *
 * Active layer renders on top; outgoing layer below. Returned `flashAlpha` is
 * a white wash painted on top during 'flash' transitions.
 */
export interface TransitionLayerStyles {
  active: CSSProperties;
  outgoing: CSSProperties;
  flashAlpha: number;
  blackOverlay: number;
}

export function transitionLayerStyles(
  style: EditTransitionStyle,
  incomingProgress: number,
  outgoingProgress: number,
): TransitionLayerStyles {
  const active: CSSProperties = { opacity: 1 };
  const outgoing: CSSProperties = { opacity: 1 };
  let flashAlpha = 0;
  let blackOverlay = 0;

  switch (style) {
    case "cut":
      // No blending — when active is on, outgoing is gone.
      active.opacity = 1;
      outgoing.opacity = outgoingProgress > 0 ? 0 : 1;
      break;

    case "soft":
    case "fade":
      // Cross-dissolve. Active fades in; outgoing fades out.
      // Both progresses can be > 0 simultaneously inside the overlap window.
      if (incomingProgress > 0) active.opacity = incomingProgress;
      if (outgoingProgress > 0) outgoing.opacity = 1 - outgoingProgress;
      break;

    case "dip_to_black": {
      // Outgoing fades to black (first half), then active fades from black
      // (second half). We model the curve via the *combined* transition window.
      // When outgoing is in its tail: black covers up; when incoming is in its
      // head: black retreats.
      if (outgoingProgress > 0) {
        outgoing.opacity = 1 - outgoingProgress;
        blackOverlay = Math.max(blackOverlay, outgoingProgress);
      }
      if (incomingProgress > 0) {
        active.opacity = incomingProgress;
        // Incoming side: previous step was full black; now black retreats.
        blackOverlay = Math.max(blackOverlay, 1 - incomingProgress);
      }
      break;
    }

    case "flash": {
      // Quick white wash. Active stays at 1, outgoing flips immediately, white
      // peaks at the boundary and decays from both sides.
      const peakAlpha = 0.85;
      const fromOut = outgoingProgress > 0 ? outgoingProgress : 0;
      const fromIn = incomingProgress > 0 ? 1 - incomingProgress : 0;
      flashAlpha = Math.max(fromOut, fromIn) * peakAlpha;
      outgoing.opacity = outgoingProgress > 0 ? 0 : 1;
      break;
    }
  }

  return { active, outgoing, flashAlpha, blackOverlay };
}
