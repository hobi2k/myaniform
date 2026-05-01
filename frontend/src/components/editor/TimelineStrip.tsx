import { CheckCircle2, Image as ImageIcon, Mic, Video } from "lucide-react";
import { useRef } from "react";
import { assetUrl } from "../../lib/json";
import type { Scene, SceneType } from "../../types";
import type { Selection } from "./LibraryPanel";

const SCENE_TYPE_ICON: Record<SceneType, string> = {
  lipsync: "💬",
  basic: "🎬",
  loop: "🔄",
  effect: "✨",
};

interface Props {
  scenes: Scene[];
  selection: Selection;
  assetVersion: number;
  onSelect: (sel: Selection) => void;
  onReorder: (order: string[]) => void;
}

export default function TimelineStrip({ scenes, selection, assetVersion, onSelect, onReorder }: Props) {
  const dragIdx = useRef<number | null>(null);

  const handleDrop = (target: number) => {
    if (dragIdx.current === null || dragIdx.current === target) return;
    const sorted = [...scenes];
    const [item] = sorted.splice(dragIdx.current, 1);
    sorted.splice(target, 0, item);
    onReorder(sorted.map((s) => s.id));
    dragIdx.current = null;
  };

  if (scenes.length === 0) {
    return (
      <div className="px-4 py-3 text-[11px] text-gray-600">
        씬이 없습니다. 왼쪽 라이브러리에서 씬을 추가하세요.
      </div>
    );
  }

  return (
    <div className="flex gap-2 px-3 py-3 min-h-[140px]">
      {scenes.map((s, idx) => {
        const active = selection?.kind === "scene" && selection.id === s.id;
        const needsVoice = !!s.dialogue;
        const voiceOk = needsVoice ? !!s.voice_path : true;
        const imageOk = !!s.image_path;
        const videoOk = !!s.clip_path && !s.clip_stale;
        return (
          <button
            key={s.id}
            type="button"
            draggable
            onDragStart={() => {
              dragIdx.current = idx;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(idx)}
            onClick={() => onSelect({ kind: "scene", id: s.id })}
            className={`flex-shrink-0 w-44 rounded-lg border text-left transition-all overflow-hidden ${
              active
                ? "border-accent/60 bg-accent-muted shadow-card-hover"
                : "border-white/10 bg-black/20 hover:border-white/30"
            }`}
          >
            <div className="aspect-video bg-surface-sunken relative overflow-hidden">
              {s.image_path ? (
                <img src={assetUrl(s.image_path, assetVersion, "/comfy_input/")} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-2xl text-gray-700">
                  {SCENE_TYPE_ICON[s.type]}
                </div>
              )}
              <div className="absolute top-1 left-1 text-[10px] font-mono bg-black/60 text-white px-1 rounded">
                #{idx + 1}
              </div>
              <div className="absolute top-1 right-1 text-sm">
                {SCENE_TYPE_ICON[s.type]}
              </div>
              {videoOk && (
                <div className="absolute bottom-1 right-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 drop-shadow" />
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="text-[11px] text-gray-200 truncate">
                {s.bg_prompt || <span className="text-gray-600">프롬프트 없음</span>}
              </p>
              <div className="flex items-center gap-2 mt-1.5 text-[10px]">
                {needsVoice && (
                  <span className={`flex items-center gap-0.5 ${voiceOk ? "text-emerald-400" : "text-gray-600"}`}>
                    <Mic className="w-2.5 h-2.5" /> 음성
                  </span>
                )}
                <span className={`flex items-center gap-0.5 ${imageOk ? "text-emerald-400" : "text-gray-600"}`}>
                  <ImageIcon className="w-2.5 h-2.5" /> 장면샷
                </span>
                <span
                  className={`flex items-center gap-0.5 ${
                    videoOk ? "text-emerald-400" : s.clip_stale ? "text-yellow-400" : "text-gray-600"
                  }`}
                >
                  <Video className="w-2.5 h-2.5" /> 영상
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
