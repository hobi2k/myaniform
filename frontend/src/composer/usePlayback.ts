import { useCallback, useEffect, useRef, useState } from "react";
import { resolveActiveSlot } from "./resolveActiveSlot";
import type { ClipSlot, PlaybackState } from "./types";

/**
 * Master playhead. Drives currentTime via requestAnimationFrame while playing,
 * resolves activeIndex / outgoing / progress windows, and exposes seek/play/
 * pause/toggle imperatives.
 *
 * Time stays in seconds (float). The composer doesn't quantize to fps because
 * each video element advances at its own decode pace and the active-slot
 * resolver handles fractional positions perfectly.
 */
export function usePlayback(slots: ClipSlot[], totalDuration: number) {
  const [state, setState] = useState<PlaybackState>({
    currentTime: 0,
    duration: totalDuration,
    playing: false,
    activeIndex: 0,
    outgoingClipIndex: null,
    outgoingProgress: 0,
    incomingProgress: 0,
  });

  // Refs for tight RAF loop without re-render thrash.
  const playingRef = useRef(false);
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const slotsRef = useRef(slots);
  const durationRef = useRef(totalDuration);
  const currentTimeRef = useRef(0);

  // Keep refs synced with prop changes.
  useEffect(() => {
    slotsRef.current = slots;
    durationRef.current = totalDuration;
    setState((p) => ({
      ...p,
      duration: totalDuration,
      ...resolveActiveSlot(slots, p.currentTime),
    }));
  }, [slots, totalDuration]);

  const apply = useCallback((nextTime: number) => {
    const dur = durationRef.current;
    let t = nextTime;
    if (t < 0) t = 0;
    if (t > dur) {
      t = dur;
      // Reaching the end auto-pauses.
      playingRef.current = false;
    }
    currentTimeRef.current = t;
    setState({
      currentTime: t,
      duration: dur,
      playing: playingRef.current,
      ...resolveActiveSlot(slotsRef.current, t),
    });
  }, []);

  const tick = useCallback(
    (now: number) => {
      if (!playingRef.current) return;
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      apply(currentTimeRef.current + dt);
      rafRef.current = requestAnimationFrame(tick);
    },
    [apply],
  );

  const play = useCallback(() => {
    if (playingRef.current) return;
    // If at the end, rewind first.
    if (currentTimeRef.current >= durationRef.current - 0.01) {
      currentTimeRef.current = 0;
    }
    playingRef.current = true;
    lastTickRef.current = performance.now();
    apply(currentTimeRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [apply, tick]);

  const pause = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    apply(currentTimeRef.current);
  }, [apply]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);

  const seek = useCallback(
    (t: number) => {
      apply(t);
    },
    [apply],
  );

  const seekRelative = useCallback(
    (delta: number) => {
      apply(currentTimeRef.current + delta);
    },
    [apply],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { state, play, pause, toggle, seek, seekRelative };
}
