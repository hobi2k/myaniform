import { useRef } from "react";
import type { CSSProperties } from "react";
import { useAudioRoute } from "./audio/useAudioRoute";
import { colorGradeFilter } from "./colorGrade";
import { useClipSync } from "./useClipSync";
import type { ClipSlot } from "./types";
import type { ColorPreset } from "../types";
import LUTVideo from "./webgl/LUTVideo";
import { lutUrlForPreset } from "./webgl/lutCache";

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
  /** Global color preset from composition.settings — passed in so it can be
   *  applied as a 3D LUT in the WebGL pipeline (Strategy A pixel match). */
  globalPreset?: ColorPreset | null;
}

/**
 * Renders one scene's primary visual (video if available + not stale, else
 * keyframe image). Voice (when stored separately from clip) layers as audio.
 *
 * The component remains MOUNTED across the full timeline play so that
 * transitions can blend two clips simultaneously without re-loading.
 * `nearWindow` controls whether we're actively decoding vs. paused/parked.
 */
export default function ClipLayer({ slot, globalTime, playing, active, nearWindow, style, globalPreset }: Props) {
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

  // Strategy A: per-clip + global presets are applied as stacked 3D LUTs in
  // the WebGL pipeline (LUTVideo). Same .cube files the ffmpeg final render
  // uses — so the preview matches the export pixel-for-pixel. The CSS
  // `filter` chain is kept as a fallback for the WebGL-disabled path and for
  // the still-image branch (no <video>, no shader stage).
  const clipLutUrl = clip.color_overlay ? lutUrlForPreset(clip.color_overlay) : null;
  const globalLutUrl = globalPreset ? lutUrlForPreset(globalPreset) : null;
  const fallbackClipFilter = clip.color_overlay ? colorGradeFilter(clip.color_overlay) : "none";
  const fallbackGlobalFilter = globalPreset ? colorGradeFilter(globalPreset) : "none";
  const fallbackFilter = [fallbackClipFilter, fallbackGlobalFilter]
    .filter((f) => f && f !== "none")
    .join(" ") || "none";
  // For the static-image branch (no <video> stage), keep CSS filters so the
  // image still gets graded in the preview.
  const stillImageFilter = fallbackFilter === "none" ? undefined : fallbackFilter;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      {usingVideo ? (
        <LUTVideo
          ref={videoRef}
          src={clip.clip_url!}
          lutClipUrl={clipLutUrl}
          lutGlobalUrl={globalLutUrl}
          fallbackFilter={fallbackFilter === "none" ? undefined : fallbackFilter}
          muted={!active}
          playsInline
          preload="auto"
          style={{ width: "100%", height: "100%" }}
        />
      ) : clip.image_url ? (
        <img
          src={clip.image_url}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "#000",
            filter: stillImageFilter,
          }}
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
