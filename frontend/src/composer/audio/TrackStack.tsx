import { Headphones, Mic, Music, Volume2, VolumeX } from "lucide-react";
import { audioGraph, type TrackKind } from "./AudioGraph";
import LevelMeter from "./LevelMeter";
import { useTrackState } from "./useAudioRoute";

interface Props {
  /** Player playing — controls whether level meter samples (saves work otherwise). */
  active: boolean;
}

interface TrackDef {
  kind: TrackKind;
  label: string;
  icon: React.ReactNode;
}

const TRACK_DEFS: TrackDef[] = [
  { kind: "voice", label: "Voice (대사)", icon: <Mic className="w-3.5 h-3.5" /> },
  { kind: "sfx", label: "SFX (씬 자체 오디오)", icon: <Headphones className="w-3.5 h-3.5" /> },
  { kind: "bgm", label: "BGM (배경음악)", icon: <Music className="w-3.5 h-3.5" /> },
];

/**
 * Voice / SFX / BGM 3-track mixing console. Sits below the timeline. Each row:
 *   [ icon  label ] [ M S ] [ ━━━━ slider ━━━━ ] [ -X.Xdb ] [ level meter ]
 */
export default function TrackStack({ active }: Props) {
  return (
    <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-3 space-y-1.5">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">오디오 믹서</p>
      {TRACK_DEFS.map((t) => (
        <TrackRow key={t.kind} def={t} active={active} />
      ))}
      <p className="text-[10px] text-gray-600 mt-2">
        M = 음소거, S = 솔로 (한 트랙만 들리게). 모든 트랙은 마스터 → 스피커로 합쳐집니다.
      </p>
    </div>
  );
}

function TrackRow({ def, active }: { def: TrackDef; active: boolean }) {
  const state = useTrackState(def.kind);

  const linearToDb = (v: number) => (v <= 0.001 ? -60 : 20 * Math.log10(v));

  return (
    <div className="flex items-center gap-2 text-[11px] text-gray-300">
      <div className="flex items-center gap-1.5 w-44 flex-shrink-0">
        {def.icon}
        <span className="truncate">{def.label}</span>
      </div>

      <button
        type="button"
        onClick={() => audioGraph.setTrackMute(def.kind, !state.mute)}
        title={state.mute ? "음소거 해제" : "음소거"}
        className={`px-1.5 py-0.5 rounded text-[10px] font-mono w-6 text-center ${
          state.mute ? "bg-red-500/40 text-red-200" : "bg-white/5 text-gray-400 hover:bg-white/10"
        }`}
      >
        M
      </button>
      <button
        type="button"
        onClick={() => audioGraph.setTrackSolo(def.kind, !state.solo)}
        title={state.solo ? "솔로 해제" : "이 트랙만 듣기 (솔로)"}
        className={`px-1.5 py-0.5 rounded text-[10px] font-mono w-6 text-center ${
          state.solo ? "bg-yellow-500/40 text-yellow-100" : "bg-white/5 text-gray-400 hover:bg-white/10"
        }`}
      >
        S
      </button>

      <input
        type="range"
        min={0}
        max={2}
        step={0.01}
        value={state.volume}
        onChange={(e) => audioGraph.setTrackVolume(def.kind, Number(e.target.value))}
        className="flex-1 accent-accent"
        disabled={state.mute}
      />

      <span className="font-mono text-[10px] tabular-nums w-12 text-right text-gray-500">
        {state.mute ? "OFF" : `${linearToDb(state.volume).toFixed(1)}dB`}
      </span>

      <div className="flex items-center gap-1 w-36 flex-shrink-0">
        {state.mute ? <VolumeX className="w-3 h-3 text-gray-600" /> : <Volume2 className="w-3 h-3 text-gray-500" />}
        <LevelMeter kind={def.kind} active={active && !state.mute} />
      </div>
    </div>
  );
}
