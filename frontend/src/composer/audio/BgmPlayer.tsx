import { useEffect, useMemo, useRef } from "react";
import { audioGraph } from "./AudioGraph";
import { useAudioRoute } from "./useAudioRoute";
import type { PlaybackState } from "../types";

interface Props {
  bgmUrl: string | null;
  /** Total timeline duration. Used to schedule fade-out. */
  totalDuration: number;
  state: PlaybackState;
  /** Render-settings derived. */
  volume: number;       // base volume (0..2)
  loop: boolean;
  fadeInSec: number;
  fadeOutSec: number;
}

/**
 * Project-level background music track. Synced to the master timeline so the
 * BGM scrubs with the playhead, fades in at the start, fades out at the end.
 *
 * Routes through AudioGraph 'bgm' track — track-level mute/solo/volume
 * applies on top of this clip-level gain via the gain chain.
 */
export default function BgmPlayer({
  bgmUrl,
  totalDuration,
  state,
  volume,
  loop,
  fadeInSec,
  fadeOutSec,
}: Props) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const { routed } = useAudioRoute(ref, "bgm", !!bgmUrl);

  // Drive currentTime / play / pause to mirror master playhead.
  useEffect(() => {
    const el = ref.current;
    if (!el || !bgmUrl) return;
    // Convert global time to BGM-local time. If looping and BGM is shorter
    // than the master timeline, wrap. If not looping and we've passed BGM
    // end, hold silence.
    const bgmLen = el.duration && Number.isFinite(el.duration) ? el.duration : 0;
    let localT = state.currentTime;
    if (loop && bgmLen > 0) {
      localT = state.currentTime % bgmLen;
    } else if (bgmLen > 0 && state.currentTime > bgmLen) {
      // Past BGM end: park at end (paused, gain to 0).
      if (!el.paused) el.pause();
      if (routed) audioGraph.setElementGain(el, 0, 0.05);
      return;
    }
    if (Math.abs(el.currentTime - localT) > 0.18) {
      try {
        el.currentTime = localT;
      } catch {
        /* swallow until metadata loads */
      }
    }
    if (state.playing) {
      if (el.paused) {
        const p = el.play();
        if (p && typeof p.catch === "function") p.catch(() => undefined);
      }
    } else {
      if (!el.paused) el.pause();
    }
  }, [state.currentTime, state.playing, bgmUrl, loop, routed]);

  // Compute clip-level gain with fade-in / fade-out envelope.
  const fadeMultiplier = useMemo(() => {
    const t = state.currentTime;
    if (totalDuration <= 0) return 0;
    let mul = 1;
    if (fadeInSec > 0 && t < fadeInSec) {
      mul = Math.max(0, t / fadeInSec);
    }
    if (fadeOutSec > 0 && t > totalDuration - fadeOutSec) {
      const remaining = Math.max(0, totalDuration - t);
      mul = Math.min(mul, remaining / fadeOutSec);
    }
    return mul;
  }, [state.currentTime, totalDuration, fadeInSec, fadeOutSec]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !routed) return;
    audioGraph.setElementGain(el, volume * fadeMultiplier, 0.04);
  }, [volume, fadeMultiplier, routed]);

  if (!bgmUrl) return null;

  return (
    <audio
      ref={ref}
      src={bgmUrl}
      preload="auto"
      loop={false /* we handle looping manually for fades to apply */}
      style={{ display: "none" }}
    />
  );
}
