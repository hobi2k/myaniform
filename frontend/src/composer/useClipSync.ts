import { useEffect } from "react";
import { audioGraph } from "./audio/AudioGraph";
import type { ClipSlot } from "./types";

interface SyncOptions {
  /** 1.0 = normal speed. The element plays at this rate; the master timeline
      rate is unchanged. Local time mapping accounts for the speed factor. */
  playbackRate?: number;
  /** 0..1 volume on the element. Only applied when `active` is true; otherwise
      muted entirely. */
  volume?: number;
}

/**
 * Sync an individual <video> or <audio> element to the master timeline.
 *
 * The element corresponds to clip at `slot.start..slot.end` on the global
 * timeline. We translate global currentTime → local element currentTime
 * (= globalTime - slot.start, then * speed, then + clip_in_offset) and
 * play/pause the element to mirror master playback while the clip is in
 * or near its window.
 *
 * `active` controls whether the element should be audible (others muted).
 * `nearWindow` controls whether the element should be loaded/decoding at all
 * (we keep adjacent clips warm to make transitions seamless).
 */
export function useClipSync(
  ref: React.RefObject<HTMLMediaElement | null>,
  slot: ClipSlot | null,
  globalTime: number,
  playing: boolean,
  active: boolean,
  nearWindow: boolean,
  options?: SyncOptions,
) {
  const playbackRate = options?.playbackRate ?? 1.0;
  const volume = options?.volume ?? 1.0;
  // Drive currentTime / play / pause based on global state.
  useEffect(() => {
    const el = ref.current;
    if (!el || !slot) return;
    const localT = globalTime - slot.start;

    // If we're outside the window-of-interest, hard-pause and bail.
    if (!nearWindow) {
      if (!el.paused) el.pause();
      return;
    }

    // Convert global timeline position to source-clip position. The element
    // plays at `playbackRate`, so its decoder frame index is scaled. The
    // *source* time we ask for = inOffset + (localT * playbackRate).
    const inOffset = slot.clip.clip_in_offset_sec;
    const clipLen = slot.end - slot.start;
    const target = inOffset + Math.max(0, Math.min(localT, clipLen)) * playbackRate;
    // Jump if drifted noticeably (>120ms) — prevents tiny correction storms.
    if (Math.abs(el.currentTime - target) > 0.12) {
      try {
        el.currentTime = target;
      } catch {
        // Some browsers throw if metadata isn't loaded yet — try again on
        // loadedmetadata via the second effect below.
      }
    }
    // Speed + volume sync. Elements use playbackRate property; we restore to
    // 1 if it drifted (e.g. some elements default-reset on src change).
    if (Math.abs(el.playbackRate - playbackRate) > 0.001) {
      el.playbackRate = playbackRate;
    }
    // Volume: if the element is routed through the AudioGraph, control its
    // clip-level gain there (element.volume is bypassed by Web Audio).
    // Otherwise fall back to el.volume.
    const targetVolume = active ? Math.max(0, volume) : 0;
    if (audioGraph.isRouted(el)) {
      audioGraph.setElementGain(el, targetVolume, 0.04);
      // Keep el.volume at 1 — irrelevant for routed elements but defensive.
      if (el.volume !== 1) el.volume = 1;
    } else {
      const clamped = Math.max(0, Math.min(1, targetVolume));
      if (Math.abs(el.volume - clamped) > 0.005) {
        el.volume = clamped;
      }
    }

    if (playing && active) {
      if (el.paused) {
        const p = el.play();
        if (p && typeof p.catch === "function") {
          // Autoplay may reject if muted policy isn't met; ignore — user gesture
          // will resume.
          p.catch(() => undefined);
        }
      }
    } else {
      if (!el.paused) el.pause();
    }
  }, [ref, slot, globalTime, playing, active, nearWindow, playbackRate, volume]);

  // When metadata becomes available, force one re-sync to push the correct
  // currentTime in (some browsers reset to 0 on `loadedmetadata`).
  useEffect(() => {
    const el = ref.current;
    if (!el || !slot) return;
    const onMeta = () => {
      const localT = globalTime - slot.start;
      const target =
        slot.clip.clip_in_offset_sec +
        Math.max(0, Math.min(localT, slot.end - slot.start)) * playbackRate;
      try {
        el.currentTime = target;
      } catch {
        /* swallow */
      }
    };
    el.addEventListener("loadedmetadata", onMeta);
    return () => el.removeEventListener("loadedmetadata", onMeta);
  }, [ref, slot, globalTime, playbackRate]);
}
