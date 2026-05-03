import { useCallback, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import PlayheadCursor from "./PlayheadCursor";
import TimelineClip from "./TimelineClip";
import TimelineRuler from "./TimelineRuler";
import TransitionHandle from "./TransitionHandle";
import { usePlayback } from "./usePlayback";
import type { ClipSlot, TimelineComposition } from "./types";

interface Props {
  slots: ClipSlot[];
  composition: TimelineComposition;
  playback: ReturnType<typeof usePlayback>;
  onReorder?: (orderedIds: string[]) => void;
  onTrim?: (clipId: string, inSec: number, outSec: number) => void;
  onTransitionSecChange?: (sec: number) => void;
  selectedClipId?: string | null;
  onSelectClip?: (id: string | null) => void;
}

const DEFAULT_PX_PER_SEC = 60;
const MIN_PX_PER_SEC = 12;
const MAX_PX_PER_SEC = 240;
const TRACK_HEIGHT = 84;

/**
 * Drag-edit timeline. Sits below the Player and shares its `playback` state.
 *
 * Layout: a horizontally scrollable track. Clips are positioned at
 * `slot.start * pxPerSec` with width `(slot.end - slot.start) * pxPerSec`.
 * Trim handles on each clip's left/right edges adjust source in/out.
 * Transition handles between adjacent clips drag-adjust the global
 * `transition_sec`. A playhead cursor shows the current time and can be
 * dragged to seek.
 */
export default function Timeline({
  slots,
  composition,
  playback,
  onReorder,
  onTrim,
  onTransitionSecChange,
  selectedClipId = null,
  onSelectClip,
}: Props) {
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const totalDuration = playback.state.duration;
  const trackWidthPx = Math.max(800, totalDuration * pxPerSec + 80);

  const zoom = (delta: number) =>
    setPxPerSec((p) => Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, p * Math.exp(delta))));

  // Wheel zoom (Ctrl/Cmd + wheel) inside the track.
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setPxPerSec((p) => {
      const next = p * Math.exp(-e.deltaY * 0.002);
      return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, next));
    });
  }, []);

  // Click on empty track area → clear selection + seek.
  const onTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (!trackRef.current) return;
      // Ignore if click landed on a clip (TimelineClip stops propagation).
      if ((e.target as HTMLElement).closest("[data-clip-card]")) return;
      if ((e.target as HTMLElement).closest("[data-transition-handle]")) return;
      if ((e.target as HTMLElement).closest("[data-playhead]")) return;
      onSelectClip?.(null);
      const rect = trackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + trackRef.current.scrollLeft;
      const t = x / pxPerSec;
      playback.seek(Math.max(0, Math.min(t, totalDuration)));
    },
    [pxPerSec, totalDuration, playback, onSelectClip],
  );

  const reorderToIndex = useCallback(
    (sourceId: string, targetIndex: number) => {
      const ids = slots.map((s) => s.clip.id);
      const sourceIndex = ids.indexOf(sourceId);
      if (sourceIndex < 0 || sourceIndex === targetIndex) return;
      const [moved] = ids.splice(sourceIndex, 1);
      ids.splice(Math.max(0, Math.min(ids.length, targetIndex)), 0, moved);
      onReorder?.(ids);
    },
    [slots, onReorder],
  );

  const transitionHandles = useMemo(() => {
    if (composition.settings.transition_sec <= 0) return [];
    return slots
      .slice(0, -1)
      .map((slot, i) => ({
        leftSlot: slot,
        rightSlot: slots[i + 1],
        // Boundary X is the *outgoing* clip's end (which equals next clip's start
        // + transition_sec). We anchor the handle there.
        boundaryT: slot.end,
      }));
  }, [slots, composition.settings.transition_sec]);

  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-[12px] text-gray-500 text-center">
        타임라인에 표시할 씬이 없습니다.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-surface-overlay/30">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 text-[11px] text-gray-400">
        <span>타임라인</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoom(-0.4)}
            title="축소 (Ctrl + 휠 ↓)"
            className="p-1 hover:bg-white/10 rounded-md"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono text-gray-500 w-12 text-center">
            {Math.round(pxPerSec)} px/s
          </span>
          <button
            type="button"
            onClick={() => zoom(0.4)}
            title="확대 (Ctrl + 휠 ↑)"
            className="p-1 hover:bg-white/10 rounded-md"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        onWheel={onWheel}
        onClick={onTrackClick}
        className="relative overflow-x-auto overflow-y-hidden bg-surface-sunken"
        style={{ height: TRACK_HEIGHT + 28 /* ruler */ }}
      >
        <div style={{ width: trackWidthPx, position: "relative", height: "100%" }}>
          <TimelineRuler totalDuration={totalDuration} pxPerSec={pxPerSec} />
          <div
            className="absolute left-0 right-0"
            style={{ top: 28, height: TRACK_HEIGHT }}
          >
            {slots.map((slot, idx) => (
              <TimelineClip
                key={slot.clip.id}
                slot={slot}
                index={idx}
                pxPerSec={pxPerSec}
                trackHeight={TRACK_HEIGHT}
                isPlaying={playback.state.playing}
                isSelected={selectedClipId === slot.clip.id}
                onSelect={() => {
                  onSelectClip?.(slot.clip.id);
                  playback.seek(slot.start);
                }}
                onTrim={onTrim}
                onReorderToIndex={(targetIdx) => reorderToIndex(slot.clip.id, targetIdx)}
                onDragStateChange={(dragging) => setDraggingClipId(dragging ? slot.clip.id : null)}
                slotsCount={slots.length}
                ghostMode={draggingClipId === slot.clip.id}
              />
            ))}

            {transitionHandles.map((th, i) => (
              <TransitionHandle
                key={`th-${i}`}
                boundaryT={th.boundaryT}
                pxPerSec={pxPerSec}
                trackHeight={TRACK_HEIGHT}
                transitionSec={composition.settings.transition_sec}
                onChange={onTransitionSecChange}
              />
            ))}
          </div>

          <PlayheadCursor
            currentTime={playback.state.currentTime}
            pxPerSec={pxPerSec}
            trackHeight={TRACK_HEIGHT + 28}
            onSeek={playback.seek}
            duration={totalDuration}
          />
        </div>
      </div>

      <div className="px-3 py-1.5 border-t border-white/5 text-[10px] text-gray-500 flex flex-wrap gap-3">
        <span>드래그: 클립 순서 변경</span>
        <span>좌/우 가장자리: 트림</span>
        <span>◇ 사이 핸들: 트랜지션 시간</span>
        <span>플레이헤드 드래그: 시점 이동</span>
        <span>Ctrl + 휠: 줌</span>
      </div>
    </div>
  );
}
