import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { audioGraph } from "./audio/AudioGraph";
import ClipLayer from "./ClipLayer";
import OverlayLayer from "./OverlayLayer";
import { colorGradeFilter, grainStyle, vignetteStyle } from "./colorGrade";
import { transitionLayerStyles } from "./transitions";
import type { ClipSlot, TimelineComposition, PlaybackState } from "./types";

/**
 * Native NLE preview player.
 *
 * Architecture:
 *   1. `layoutClips()` turns the composition into a flat list of time slots.
 *   2. `usePlayback()` runs the master playhead via RAF.
 *   3. Each clip is rendered as its own <ClipLayer> mounted across the full
 *      run; the active and outgoing layers are revealed via opacity/transform
 *      driven by `transitionLayerStyles()`.
 *   4. Color grade filter + vignette + grain wrap the canvas. Subtitles and
 *      user overlays sit on top.
 *   5. A timeline scrubber + transport controls drive `seek/toggle`.
 *
 * No external video framework — purely HTML5 video + CSS + RAF.
 */
interface Props {
  composition: TimelineComposition;
  /** Layout result (shared with Timeline). Caller computes via layoutClips(). */
  slots: ClipSlot[];
  /** Master playback (shared with Timeline). Caller drives via usePlayback(). */
  playback: {
    state: PlaybackState;
    play: () => void;
    pause: () => void;
    toggle: () => void;
    seek: (t: number) => void;
    seekRelative: (delta: number) => void;
  };
  /** Optional overlay editing layer rendered above the rendering stage.
   *  Caller supplies <OverlayCanvas .../> when editing mode is on. */
  overlayEditor?: React.ReactNode;
  /** Optional: forces aspect ratio. Defaults to 16:9. */
  aspect?: number;
}

const PRELOAD_NEIGHBOR_COUNT = 1;

export default function Player({ composition, slots, playback, overlayEditor, aspect = 16 / 9 }: Props) {
  const { state, play, pause, toggle, seek, seekRelative } = playback;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Keyboard shortcuts (focus must be inside container).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!containerRef.current) return;
      if (!containerRef.current.contains(document.activeElement) && document.activeElement !== document.body) return;

      if (e.key === " ") {
        e.preventDefault();
        audioGraph.ensureRunning();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekRelative(e.shiftKey ? -5 : -1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekRelative(e.shiftKey ? 5 : 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        seek(0);
      } else if (e.key === "End") {
        e.preventDefault();
        seek(state.duration);
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, seekRelative, state.duration]);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => undefined);
    } else {
      document.exitFullscreen?.().then(() => setFullscreen(false)).catch(() => undefined);
    }
  };

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Compute layer styles for active + outgoing clips.
  const activeSlot = slots[state.activeIndex];
  const outgoingSlot = state.outgoingClipIndex !== null ? slots[state.outgoingClipIndex] : null;
  // Per-boundary transition style: outgoing clip's `out_transition_style` wins,
  // else fall back to the global setting. Lets users dial in per-cut effects.
  const activeTransitionStyle =
    outgoingSlot?.clip.out_transition_style ?? composition.settings.transition_style;
  const tStyles = transitionLayerStyles(
    activeTransitionStyle,
    state.incomingProgress,
    state.outgoingProgress,
  );

  const activeDialogue = activeSlot?.clip.dialogue ?? null;

  // Color grade is applied as a wrapper filter so it composites all layers
  // (clips + subtitles + overlays) uniformly.
  const gradeFilter = colorGradeFilter(composition.settings.color_preset);

  // Empty state.
  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-12 text-center text-gray-500 text-sm">
        씬이 아직 없습니다. 좌측에서 씬을 추가하세요.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="relative bg-black rounded-xl overflow-hidden border border-white/10 outline-none focus:ring-2 focus:ring-accent/40"
    >
      <div
        className="relative w-full"
        style={{ aspectRatio: String(aspect) }}
      >
        {/* Filter wrapper covers the entire stage uniformly. */}
        <div style={{ position: "absolute", inset: 0, filter: gradeFilter }}>
          {/* Outgoing clip (lower z) */}
          {outgoingSlot && (
            <ClipLayer
              slot={outgoingSlot}
              globalTime={state.currentTime}
              playing={state.playing}
              active={false /* outgoing is muted; active layer drives audio */}
              nearWindow
              style={tStyles.outgoing}
            />
          )}

          {/* Active clip (upper z) */}
          <ClipLayer
            slot={activeSlot}
            globalTime={state.currentTime}
            playing={state.playing}
            active
            nearWindow
            style={tStyles.active}
          />

          {/* Preload neighbors (mounted but not visible). Browsers will warm up
              the decoder so transitions don't stutter. */}
          {slots.map((slot, i) => {
            if (i === state.activeIndex) return null;
            if (state.outgoingClipIndex === i) return null;
            const dist = Math.min(Math.abs(i - state.activeIndex), Math.abs(i - (state.outgoingClipIndex ?? -1)));
            if (dist > PRELOAD_NEIGHBOR_COUNT) return null;
            return (
              <ClipLayer
                key={slot.clip.id}
                slot={slot}
                globalTime={state.currentTime}
                playing={false}
                active={false}
                nearWindow
                style={{ opacity: 0, pointerEvents: "none" }}
              />
            );
          })}

          {/* Vignette + grain overlays sit above clips, below subtitles. */}
          <div style={vignetteStyle(composition.settings.vignette_strength)} />
          <div style={grainStyle(composition.settings.grain_strength)} />

          {/* Subtitles + user overlays. */}
          <OverlayLayer
            slots={slots}
            globalTime={state.currentTime}
            overlays={composition.overlays}
            subtitleStyle={composition.settings.subtitle_style}
            activeDialogue={activeDialogue}
          />

          {/* Transition flash / black overlays sit on top of everything. */}
          {tStyles.flashAlpha > 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "white",
                opacity: tStyles.flashAlpha,
                pointerEvents: "none",
              }}
            />
          )}
          {tStyles.blackOverlay > 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "black",
                opacity: tStyles.blackOverlay,
                pointerEvents: "none",
              }}
            />
          )}
        </div>
        {/* Editor overlay sits above the graded stage so it isn't color-treated. */}
        {overlayEditor}
      </div>

      <Transport
        state={state}
        slots={slots}
        play={play}
        pause={pause}
        toggle={toggle}
        seek={seek}
        seekRelative={seekRelative}
        toggleFullscreen={toggleFullscreen}
        fullscreen={fullscreen}
      />
    </div>
  );
}

interface TransportProps {
  state: PlaybackState;
  slots: ClipSlot[];
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  seekRelative: (delta: number) => void;
  toggleFullscreen: () => void;
  fullscreen: boolean;
}

function Transport({ state, slots, toggle, seek, seekRelative, toggleFullscreen, fullscreen }: TransportProps) {
  const seekToScene = (idx: number) => {
    const slot = slots[idx];
    if (slot) seek(slot.start);
  };

  return (
    <div className="px-3 py-2 bg-black/40 border-t border-white/10 flex items-center gap-2 text-white">
      <button
        type="button"
        onClick={() => seekToScene(Math.max(0, state.activeIndex - 1))}
        title="이전 씬"
        className="p-1.5 hover:bg-white/10 rounded-md"
      >
        <SkipBack className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          // First user gesture: resume the suspended AudioContext so the
          // routed elements (voice/sfx/bgm) actually emit sound.
          audioGraph.ensureRunning();
          toggle();
        }}
        title={state.playing ? "일시정지 (Space)" : "재생 (Space)"}
        className="p-1.5 hover:bg-white/10 rounded-md"
      >
        {state.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button
        type="button"
        onClick={() => seekToScene(Math.min(slots.length - 1, state.activeIndex + 1))}
        title="다음 씬"
        className="p-1.5 hover:bg-white/10 rounded-md"
      >
        <SkipForward className="w-4 h-4" />
      </button>

      <span className="text-[11px] font-mono opacity-75 w-12 text-right tabular-nums">
        {fmt(state.currentTime)}
      </span>

      <input
        type="range"
        min={0}
        max={state.duration || 1}
        step={0.01}
        value={state.currentTime}
        onChange={(e) => seek(Number(e.target.value))}
        className="flex-1 accent-accent"
      />

      <span className="text-[11px] font-mono opacity-75 w-12 tabular-nums">
        {fmt(state.duration)}
      </span>

      <span className="text-[10px] text-gray-400 hidden md:inline">
        scene {state.activeIndex + 1}/{slots.length}
      </span>

      <button
        type="button"
        onClick={() => seekRelative(-1)}
        title="−1s (←)"
        className="text-[10px] px-2 py-1 hover:bg-white/10 rounded-md"
      >
        −1s
      </button>
      <button
        type="button"
        onClick={() => seekRelative(1)}
        title="+1s (→)"
        className="text-[10px] px-2 py-1 hover:bg-white/10 rounded-md"
      >
        +1s
      </button>
      <button
        type="button"
        onClick={toggleFullscreen}
        title={fullscreen ? "전체화면 종료 (F)" : "전체화면 (F)"}
        className="p-1.5 hover:bg-white/10 rounded-md"
      >
        {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>
    </div>
  );
}

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t - Math.floor(t)) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}
