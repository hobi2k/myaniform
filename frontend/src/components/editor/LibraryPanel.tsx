import { CheckCircle2, GripVertical, Image as ImageIcon, Mic, Plus, Trash2, User, Video } from "lucide-react";
import { useRef, useState } from "react";
import type { Character, Scene, SceneType } from "../../types";
import { assetUrl } from "../../lib/json";

const SCENE_TYPE_ICON: Record<SceneType, string> = {
  lipsync: "💬",
  basic: "🎬",
  loop: "🔄",
  effect: "✨",
};

const SCENE_TYPE_LABEL: Record<SceneType, string> = {
  lipsync: "립싱크 추가",
  basic: "기본 컷 추가",
  loop: "루프 추가",
  effect: "이펙트 추가",
};

const SCENE_TYPE_COLOR: Record<SceneType, string> = {
  lipsync: "text-lipsync",
  basic: "text-cyan-300",
  loop: "text-loop",
  effect: "text-effect",
};

export type Selection = { kind: "character"; id: string } | { kind: "scene"; id: string } | null;

interface Props {
  characters: Character[];
  scenes: Scene[];
  selection: Selection;
  assetVersion: number;
  onSelect: (sel: Selection) => void;
  onCreateCharacter: (name: string) => void;
  onDeleteCharacter: (id: string) => void;
  onCreateScene: (type: SceneType) => void;
  onDeleteScene: (id: string) => void;
  onReorderScenes: (order: string[]) => void;
}

function sceneDone(s: Scene) {
  const needsVoice = !!s.dialogue;
  const voice = needsVoice ? !!s.voice_path : true;
  return voice && !!s.image_path && !!s.clip_path && !s.clip_stale;
}

export default function LibraryPanel({
  characters,
  scenes,
  selection,
  assetVersion,
  onSelect,
  onCreateCharacter,
  onDeleteCharacter,
  onCreateScene,
  onDeleteScene,
  onReorderScenes,
}: Props) {
  const [showNewChar, setShowNewChar] = useState(false);
  const [newName, setNewName] = useState("");
  const dragIdx = useRef<number | null>(null);

  const submitChar = () => {
    if (!newName.trim()) return;
    onCreateCharacter(newName.trim());
    setNewName("");
    setShowNewChar(false);
  };

  const handleDrop = (targetIdx: number) => {
    if (dragIdx.current === null || dragIdx.current === targetIdx) return;
    const sorted = [...scenes];
    const [item] = sorted.splice(dragIdx.current, 1);
    sorted.splice(targetIdx, 0, item);
    onReorderScenes(sorted.map((s) => s.id));
    dragIdx.current = null;
  };

  return (
    <div className="p-3 space-y-4">
      <section>
        <header className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            캐릭터 ({characters.length})
          </span>
          <button
            onClick={() => setShowNewChar(true)}
            className="w-6 h-6 rounded-md hover:bg-white/10 text-gray-300 hover:text-accent transition-colors flex items-center justify-center"
            title="캐릭터 추가"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </header>

        {showNewChar && (
          <input
            autoFocus
            className="input-base w-full mb-2"
            placeholder="이름"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitChar();
              if (e.key === "Escape") {
                setShowNewChar(false);
                setNewName("");
              }
            }}
            onBlur={() => {
              if (!newName.trim()) setShowNewChar(false);
            }}
          />
        )}

        <ul className="space-y-1">
          {characters.map((c) => {
            const active = selection?.kind === "character" && selection.id === c.id;
            return (
              <li key={c.id}>
                <button
                  onClick={() => onSelect({ kind: "character", id: c.id })}
                  className={`group w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all flex items-center gap-2 border ${
                    active
                      ? "bg-accent-muted border-accent/40 text-white"
                      : "border-transparent hover:bg-white/5 hover:border-white/10 text-gray-300"
                  }`}
                >
                  {c.sprite_path ? (
                    <img src={assetUrl(c.sprite_path, assetVersion)} className="w-7 h-7 rounded-md object-cover ring-1 ring-white/10 flex-shrink-0 bg-surface-sunken" />
                  ) : c.image_path ? (
                    <img src={assetUrl(c.image_path, assetVersion)} className="w-7 h-7 rounded-md object-cover ring-1 ring-white/10 flex-shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-md bg-surface-overlay grid place-items-center flex-shrink-0">
                      <User className="w-3.5 h-3.5 opacity-50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{c.name}</p>
                    <div className="flex items-center gap-1 text-[9px] text-gray-500">
                      <span className={c.sprite_path ? "text-emerald-400" : ""}>스프라이트</span>
                      {c.voice_sample_path && <span className="text-emerald-400">· 보이스</span>}
                    </div>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`'${c.name}' 캐릭터를 삭제할까요?`)) onDeleteCharacter(c.id);
                    }}
                    title="삭제"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </button>
              </li>
            );
          })}
          {characters.length === 0 && !showNewChar && (
            <li className="text-[11px] text-gray-600 px-2 py-4 text-center border border-dashed border-white/10 rounded-lg">
              캐릭터를 추가하세요
            </li>
          )}
        </ul>
      </section>

      <section>
        <header className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            씬 ({scenes.length})
          </span>
          <div className="flex gap-0.5">
            {(["lipsync", "basic", "loop", "effect"] as SceneType[]).map((t) => (
              <button
                key={t}
                title={SCENE_TYPE_LABEL[t]}
                onClick={() => onCreateScene(t)}
                className="w-6 h-6 rounded-md hover:bg-white/10 text-sm transition-colors flex items-center justify-center"
              >
                {SCENE_TYPE_ICON[t]}
              </button>
            ))}
          </div>
        </header>

        <ul className="space-y-1">
          {scenes.map((s, idx) => {
            const active = selection?.kind === "scene" && selection.id === s.id;
            const done = sceneDone(s);
            return (
              <li
                key={s.id}
                draggable
                onDragStart={() => {
                  dragIdx.current = idx;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(idx)}
              >
                <button
                  onClick={() => onSelect({ kind: "scene", id: s.id })}
                  className={`group w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all flex items-center gap-2 border ${
                    active
                      ? "bg-accent-muted border-accent/40 text-white"
                      : "border-transparent hover:bg-white/5 hover:border-white/10 text-gray-300"
                  }`}
                >
                  <GripVertical className="w-3 h-3 opacity-20 cursor-grab flex-shrink-0" />
                  {s.image_path ? (
                    <img src={assetUrl(s.image_path, assetVersion, "/comfy_input/")} className="w-9 h-9 rounded-md object-cover ring-1 ring-white/10 flex-shrink-0" />
                  ) : (
                    <div className={`w-9 h-9 rounded-md bg-surface-overlay grid place-items-center flex-shrink-0 ${SCENE_TYPE_COLOR[s.type]}`}>
                      <span className="text-base leading-none">{SCENE_TYPE_ICON[s.type]}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate">
                      <span className="text-gray-500">#{idx + 1}</span>{" "}
                      {s.bg_prompt?.slice(0, 18) || <span className="text-gray-600">(미설정)</span>}
                    </p>
                    <div className="flex items-center gap-1 text-[9px] text-gray-500">
                      {!!s.dialogue && (
                        <span className={s.voice_path ? "text-emerald-400" : ""}>
                          <Mic className="w-2.5 h-2.5 inline" />
                        </span>
                      )}
                      <span className={s.image_path ? "text-emerald-400" : ""}>
                        <ImageIcon className="w-2.5 h-2.5 inline" />
                      </span>
                      <span
                        className={
                          s.clip_path && !s.clip_stale
                            ? "text-emerald-400"
                            : s.clip_stale
                              ? "text-yellow-400"
                              : ""
                        }
                      >
                        <Video className="w-2.5 h-2.5 inline" />
                      </span>
                    </div>
                  </div>
                  {done ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  ) : s.clip_stale ? (
                    <span className="text-[9px] text-yellow-400 flex-shrink-0">stale</span>
                  ) : null}
                  <button
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`씬 #${idx + 1}을 삭제할까요?`)) onDeleteScene(s.id);
                    }}
                    title="삭제"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </button>
              </li>
            );
          })}
          {scenes.length === 0 && (
            <li className="text-[11px] text-gray-600 px-2 py-4 text-center border border-dashed border-white/10 rounded-lg">
              위 아이콘으로 씬을 추가하세요
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
