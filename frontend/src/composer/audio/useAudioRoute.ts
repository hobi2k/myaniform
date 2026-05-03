import { useEffect, useState } from "react";
import { audioGraph, type TrackKind, type TrackState } from "./AudioGraph";

/**
 * Route an HTMLMediaElement through the AudioGraph for the given track.
 *
 * Returns `routed` so callers can decide to fall back to element.volume when
 * the routing failed (some browsers / cross-origin states reject
 * createMediaElementSource).
 */
export function useAudioRoute(
  ref: React.RefObject<HTMLMediaElement | null>,
  kind: TrackKind,
  enabled: boolean,
): { routed: boolean } {
  const [routed, setRouted] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    try {
      audioGraph.routeElement(el, kind);
      setRouted(true);
    } catch {
      setRouted(false);
    }
    return () => {
      // Don't unroute on unmount: an element's MediaElementAudioSourceNode
      // can never be re-created. Keep the route alive for the element's
      // lifetime. Closing the page tears the AudioContext down.
    };
  }, [ref, kind, enabled]);
  return { routed };
}

/**
 * Subscribe to a track's state (volume / mute / solo) for UI rendering.
 * Re-renders the consumer when any track field changes.
 */
export function useTrackState(kind: TrackKind): TrackState {
  const [state, setState] = useState<TrackState>(audioGraph.getTrackState(kind));
  useEffect(() => {
    return audioGraph.subscribe(() => {
      setState(audioGraph.getTrackState(kind));
    });
  }, [kind]);
  return state;
}
