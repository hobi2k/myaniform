import type { ColorPreset, EditOverlay, EditRenderSettings, EditTransitionStyle, Scene, SceneType } from "../types";

import type { EditTransitionStyle as Trans, ColorPreset as Preset } from "../types";

/** Per-scene clip data the composer needs. Derived from Scene. */
export interface ComposerClip {
  id: string;
  index: number;
  type: SceneType;
  bg_prompt: string | null;
  dialogue: string | null;
  /** Absolute or root-relative URL. The composer resolves these directly. */
  clip_url: string | null;
  image_url: string | null;
  voice_url: string | null;
  /** Real (ffprobe) duration of the source clip. Falls back to FALLBACK_CLIP_SEC if null. */
  duration_sec: number;
  /** Trim in-point inside the source clip (seconds). 0 = clip start. */
  clip_in_offset_sec: number;
  /** Trim out-point inside the source clip (seconds). Defaults to duration_sec. */
  clip_out_offset_sec: number;
  clip_stale: boolean;
  // ── M3 per-clip 효과 ──
  speed: number;             // 1.0 = normal
  voice_volume: number;      // 1.0 = full
  sfx_volume: number;        // 1.0 = full
  /** Per-clip color overlay applied on top of global color_preset. null = none. */
  color_overlay: Preset | null;
  /** Override transition for the *outgoing* boundary into the next clip. null = use global. */
  out_transition_style: Trans | null;
  /** Override transition_sec for the outgoing boundary. null = use global. */
  out_transition_sec: number | null;
}

/** How long the clip is rendered on the timeline (after trim, ignoring speed). */
export function effectiveSourceDurationSec(clip: ComposerClip): number {
  const len = clip.clip_out_offset_sec - clip.clip_in_offset_sec;
  return Math.max(0.1, len);
}

/** Final timeline duration after speed scaling (faster = shorter on the timeline). */
export function effectiveDurationSec(clip: ComposerClip): number {
  return effectiveSourceDurationSec(clip) / Math.max(0.1, clip.speed);
}

export interface TimelineComposition {
  clips: ComposerClip[];
  settings: EditRenderSettings;
  /** In-flight overlay drafts from the editor (not yet persisted on scene). */
  overlays: EditOverlay[];
}

/** Default duration when a scene clip hasn't been rendered or probed yet. */
export const FALLBACK_CLIP_SEC = 7.23;

/** Resolved time slot for a single clip on the master timeline. */
export interface ClipSlot {
  clip: ComposerClip;
  /** Inclusive start, exclusive end (seconds). */
  start: number;
  end: number;
  /** Outgoing transition starts at `transitionOutStart`. NaN if last/no transition. */
  transitionOutStart: number;
  /** Incoming transition ends at `transitionInEnd`. NaN if first/no transition. */
  transitionInEnd: number;
}

/** State of the player at a given currentTime. */
export interface PlaybackState {
  currentTime: number;
  duration: number;
  playing: boolean;
  activeIndex: number;
  /** Set when overlapping with the next clip during a transition. */
  outgoingClipIndex: number | null;
  /** 0..1 — where we are inside the outgoing transition. */
  outgoingProgress: number;
  /** 0..1 — where we are inside the incoming transition (for activeIndex). */
  incomingProgress: number;
}

export type { ColorPreset, EditOverlay, EditRenderSettings, EditTransitionStyle, Scene };
