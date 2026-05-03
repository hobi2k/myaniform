import { useRef } from "react";
import type { CSSProperties } from "react";
import { useAudioRoute } from "./audio/useAudioRoute";
import { colorGradeFilter } from "./colorGrade";
import { useClipSync } from "./useClipSync";
import type { ClipSlot } from "./types";

interface Props {
  slot: ClipSlot;
  globalTime: number;
  playing: boolean;
  /** Audible + driving playback (the topmost layer). */
  active: boolean;
  /** Within preload window — keep video element mounted & decoding. */
  nearWindow: boolean;
  /** Layer-specific transform/opacity from transitions or grade. */
  style?: CSSProperties;
}

/**
 * Renders one scene's primary visual (video if available + not stale, else
 * keyframe image). Voice (when stored separately from clip) layers as audio.
 *
 * The component remains MOUNTED across the full timeline play so that
 * transitions can blend two clips simultaneously without re-loading.
 * `nearWindow` controls whether we're actively decoding vs. paused/parked.
 */
export default function ClipLayer({ slot, globalTime, playing, active, nearWindow, style }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { clip } = slot;

  const usingVideo = !!clip.clip_url && !clip.clip_stale;

  // Route through AudioGraph for proper track-level mixing. Video carries
  // SFX/baked-voice → 'sfx' track. Voice element → 'voice' track.
  useAudioRoute(videoRef, "sfx", usingVideo);
  useAudioRoute(audioRef, "voice", !!clip.voice_url);

  useClipSync(videoRef, usingVideo ? slot : null, globalTime, playing, active, nearWindow, {
    playbackRate: clip.speed,
    volume: clip.sfx_volume,
  });
  // Voice element drives the dedicated voice track when present. Plays at the
  // same speed as the clip (scientific pitch shift would need Web Audio; M4).
  useClipSync(audioRef, clip.voice_url ? slot : null, globalTime, playing, active, nearWindow, {
    playbackRate: clip.speed,
    volume: clip.voice_volume,
  });

  // Per-clip color overlay chains AFTER the global grade. The Player's
  // top-level filter wrapper applies the global preset; this layer adds another.
  const overlayFilter = clip.color_overlay ? colorGradeFilter(clip.color_overlay) : "none";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        ...style,
        filter:
          overlayFilter !== "none"
            ? `${overlayFilter}${style?.filter ? ` ${style.filter}` : ""}`
            : style?.filter,
      }}
    >
      {usingVideo ? (
        <video
          ref={videoRef}
          src={clip.clip_url!}
          muted={!active}
          playsInline
          preload="auto"
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />
      ) : clip.image_url ? (
        <img
          src={clip.image_url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "grid",
            placeItems: "center",
            color: "#777",
            fontSize: 12,
            fontFamily: "monospace",
            background: "#0d1117",
          }}
        >
          (scene #{clip.index + 1} — no asset)
        </div>
      )}

      {clip.voice_url && (
        <audio ref={audioRef} src={clip.voice_url} muted={!active} preload="auto" />
      )}

      {clip.clip_stale && clip.image_url && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            padding: "3px 8px",
            background: "rgba(255,193,7,0.9)",
            color: "#1a1a1a",
            fontSize: 10,
            fontFamily: "monospace",
            borderRadius: 4,
          }}
        >
          STALE — re-render needed
        </div>
      )}
    </div>
  );
}
