import type { ClipSlot, PlaybackState } from "./types";

/**
 * For a given timeline `currentTime`, decide which clip is primary (active),
 * which is outgoing (cross-fading), and the 0..1 progress for both transition
 * windows. Returns a partial PlaybackState (caller fills currentTime/duration/playing).
 *
 * Edge cases:
 * - currentTime before first clip starts: clamps to clip 0, both progresses = 0.
 * - currentTime past final clip: clamps to last clip, no outgoing.
 * - In overlap zone: activeIndex is the *incoming* clip (the new one taking over),
 *   outgoingClipIndex is the *previous* clip still tailing off. This matches how
 *   most NLEs render — the new clip is "on top" during the cross-fade.
 */
export function resolveActiveSlot(
  slots: ClipSlot[],
  currentTime: number,
): Pick<PlaybackState, "activeIndex" | "outgoingClipIndex" | "outgoingProgress" | "incomingProgress"> {
  if (slots.length === 0) {
    return { activeIndex: 0, outgoingClipIndex: null, outgoingProgress: 0, incomingProgress: 0 };
  }

  // Find the latest slot that starts at or before currentTime.
  let activeIndex = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].start <= currentTime) activeIndex = i;
    else break;
  }

  const active = slots[activeIndex];
  // Past the very end of the last clip → still hold last clip.
  if (activeIndex === slots.length - 1 && currentTime >= active.end) {
    return { activeIndex, outgoingClipIndex: null, outgoingProgress: 0, incomingProgress: 0 };
  }

  // Incoming progress: how far into our own incoming-transition window.
  // transitionInEnd = active.start + t (for non-first clips).
  let incomingProgress = 0;
  if (!Number.isNaN(active.transitionInEnd)) {
    const t = active.transitionInEnd - active.start;
    if (t > 0 && currentTime < active.transitionInEnd) {
      incomingProgress = clamp01((currentTime - active.start) / t);
    }
  }

  // Outgoing: if currentTime is inside [transitionOutStart, end] of the *previous*
  // slot, the previous slot is still tailing off. That happens when active is
  // not 0 AND we're still within the previous slot's end.
  let outgoingClipIndex: number | null = null;
  let outgoingProgress = 0;
  if (activeIndex > 0) {
    const prev = slots[activeIndex - 1];
    if (currentTime < prev.end && !Number.isNaN(prev.transitionOutStart)) {
      const t = prev.end - prev.transitionOutStart;
      if (t > 0) {
        outgoingClipIndex = activeIndex - 1;
        outgoingProgress = clamp01((currentTime - prev.transitionOutStart) / t);
      }
    }
  }

  return { activeIndex, outgoingClipIndex, outgoingProgress, incomingProgress };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
