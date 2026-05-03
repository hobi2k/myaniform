import { useMemo } from "react";
import BgmPlayer from "./audio/BgmPlayer";
import TrackStack from "./audio/TrackStack";
import OverlayCanvas from "./overlay/OverlayCanvas";
import { layoutClips } from "./buildComposition";
import Player from "./Player";
import Timeline from "./Timeline";
import { usePlayback } from "./usePlayback";
import type { TimelineComposition } from "./types";
import type { EditOverlay } from "../types";

interface Props {
  composition: TimelineComposition;
  /** Reorder callback — receives the new order of scene IDs (after a drag swap). */
  onReorder?: (orderedIds: string[]) => void;
  /** Trim callback — emits new in/out (in source-clip seconds) for a given clip ID. */
  onTrim?: (clipId: string, inSec: number, outSec: number) => void;
  /** Transition_sec drag — global value. */
  onTransitionSecChange?: (sec: number) => void;
  /** Currently-selected clip id (for inspector). */
  selectedClipId?: string | null;
  /** User clicked a clip → ask parent to select it. null = clear selection. */
  onSelectClip?: (id: string | null) => void;
  /** Currently-selected overlay id (mutually exclusive with clip selection). */
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  /** Persist a full overlay list update (parent calls api.projects.updateOverlays). */
  onOverlaysChange?: (next: EditOverlay[]) => void;
  /** Project BGM URL (already resolved to a fetchable path). */
  bgmUrl?: string | null;
  aspect?: number;
}

/**
 * Composer is the top-level NLE — Player on top, Timeline (drag-edit) below.
 *
 * Owns the master playback state via `usePlayback` and the layout via
 * `layoutClips`, then shares both with Player and Timeline. This keeps the
 * playhead in lockstep across visual preview and timeline scrubber.
 */
export default function Composer({
  composition,
  onReorder,
  onTrim,
  onTransitionSecChange,
  selectedClipId = null,
  onSelectClip,
  selectedOverlayId = null,
  onSelectOverlay,
  onOverlaysChange,
  bgmUrl = null,
  aspect,
}: Props) {
  const layout = useMemo(() => layoutClips(composition), [composition]);
  const playback = usePlayback(layout.slots, layout.totalDuration);

  // Overlay editing UI is only rendered when the consumer wired callbacks.
  const overlayEditor = onOverlaysChange ? (
    <OverlayCanvas
      slots={layout.slots}
      globalTime={playback.state.currentTime}
      overlays={composition.overlays}
      selectedId={selectedOverlayId}
      onSelect={(id) => {
        onSelectOverlay?.(id);
        if (id) onSelectClip?.(null); // clip ↔ overlay 선택 배타
      }}
      onChange={onOverlaysChange}
    />
  ) : undefined;

  return (
    <div className="space-y-3">
      <Player
        composition={composition}
        slots={layout.slots}
        playback={playback}
        overlayEditor={overlayEditor}
        aspect={aspect}
      />
      <Timeline
        slots={layout.slots}
        composition={composition}
        playback={playback}
        onReorder={onReorder}
        onTrim={onTrim}
        onTransitionSecChange={onTransitionSecChange}
        selectedClipId={selectedClipId}
        onSelectClip={onSelectClip}
      />
      <BgmPlayer
        bgmUrl={bgmUrl}
        totalDuration={layout.totalDuration}
        state={playback.state}
        volume={composition.settings.bgm_volume ?? 0.5}
        loop={composition.settings.bgm_loop ?? true}
        fadeInSec={composition.settings.bgm_fade_in ?? 0}
        fadeOutSec={composition.settings.bgm_fade_out ?? 0}
      />
      <TrackStack active={playback.state.playing} />
    </div>
  );
}
