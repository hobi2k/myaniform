import type { EditOverlay, EditRenderSettings, Scene } from "../types";
import type { ClipSlot, ComposerClip, TimelineComposition } from "./types";
import { effectiveDurationSec, FALLBACK_CLIP_SEC } from "./types";

/**
 * Resolve scene path fields to URLs the browser can fetch.
 *
 * Backend stores paths in different roots:
 *   - clip_path: project-root relative (`output/scene_xxx.mp4`) → served at `/output/...`
 *     but FastAPI exposes `output/`, `uploads/`, `voices/` from project root, so the
 *     frontend dev proxy already mounts them at `/`.
 *   - image_path: ComfyUI/input/ filename only (`scene_image_xxx.png`) → `/comfy_input/...`
 *   - voice_path: ComfyUI/input/ filename → `/comfy_input/...`
 */
function resolveClipUrl(path: string | null, version?: number): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const base = path.startsWith("/") ? path : `/${path}`;
  return version != null ? `${base}?v=${version}` : base;
}

function resolveInputUrl(path: string | null, version?: number): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const base = path.startsWith("/") ? path : `/comfy_input/${path}`;
  return version != null ? `${base}?v=${version}` : base;
}

export function clipFromScene(s: Scene, index: number, version?: number): ComposerClip {
  const duration = s.clip_duration_sec ?? FALLBACK_CLIP_SEC;
  // Backend trim values are authoritative if set. Clamp defensively.
  const inSec = Math.max(0, Math.min(s.clip_in_offset_sec ?? 0, duration - 0.1));
  const outSec = Math.max(inSec + 0.1, Math.min(s.clip_out_offset_sec ?? duration, duration));
  return {
    id: s.id,
    index,
    type: s.type,
    bg_prompt: s.bg_prompt,
    dialogue: s.dialogue,
    clip_url: resolveClipUrl(s.clip_path, version),
    image_url: resolveInputUrl(s.image_path, version),
    voice_url: resolveInputUrl(s.voice_path, version),
    duration_sec: duration,
    clip_in_offset_sec: inSec,
    clip_out_offset_sec: outSec,
    clip_stale: s.clip_stale,
    speed: s.clip_speed ?? 1.0,
    voice_volume: s.clip_voice_volume ?? 1.0,
    sfx_volume: s.clip_sfx_volume ?? 1.0,
    color_overlay: s.clip_color_overlay,
    out_transition_style: s.out_transition_style,
    out_transition_sec: s.out_transition_sec,
  };
}

export function buildComposition(
  scenes: Scene[],
  settings: EditRenderSettings,
  overlays: EditOverlay[],
  /** Cache-bust version. Bump after a scene's clip/image/voice is regenerated
   *  or replaced so video/audio elements re-fetch the new file. */
  version?: number,
): TimelineComposition {
  return {
    clips: scenes.map((s, i) => clipFromScene(s, i, version)),
    settings,
    overlays,
  };
}

/**
 * Given clip durations and the global transition_sec, lay out clips on a single
 * timeline. Each clip occupies a [start, end] window. If transition_sec > 0,
 * adjacent clips overlap by transition_sec at the boundary so the outgoing tail
 * and incoming head can be cross-modulated.
 */
export function layoutClips(comp: TimelineComposition): {
  slots: ClipSlot[];
  totalDuration: number;
} {
  const globalT = Math.max(0, comp.settings.transition_sec);
  const slots: ClipSlot[] = [];
  let cursor = 0;
  // Per-boundary transition: outgoing clip's `out_transition_sec` (else global).
  const tBefore = (i: number): number => {
    if (i <= 0) return 0;
    const prev = comp.clips[i - 1];
    return Math.max(0, prev.out_transition_sec ?? globalT);
  };
  const tAfter = (i: number): number => {
    if (i >= comp.clips.length - 1) return 0;
    const cur = comp.clips[i];
    return Math.max(0, cur.out_transition_sec ?? globalT);
  };
  comp.clips.forEach((clip, i) => {
    const isFirst = i === 0;
    const isLast = i === comp.clips.length - 1;
    const len = effectiveDurationSec(clip);
    const start = cursor;
    const end = start + len;
    const inT = tBefore(i);
    const outT = tAfter(i);
    slots.push({
      clip,
      start,
      end,
      transitionOutStart: !isLast && outT > 0 ? Math.max(start, end - outT) : Number.NaN,
      transitionInEnd: !isFirst && inT > 0 ? Math.min(end, start + inT) : Number.NaN,
    });
    // Next clip's start = this clip's end - outgoing transition.
    cursor = end - (isLast ? 0 : outT);
  });
  const last = slots.length > 0 ? slots[slots.length - 1] : undefined;
  return {
    slots,
    totalDuration: last ? last.end : 0,
  };
}
