import { X } from "lucide-react";
import type { Character } from "../../types";

interface Props {
  available: Character[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export default function CharacterMultiPicker({ available, selected, onChange }: Props) {
  const remaining = available.filter((c) => !selected.includes(c.id));
  const byId: Record<string, Character> = Object.fromEntries(available.map((c) => [c.id, c]));

  const add = (id: string) => {
    if (!id || selected.includes(id)) return;
    onChange([...selected, id]);
  };
  const remove = (id: string) => onChange(selected.filter((x) => x !== id));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= selected.length) return;
    const arr = [...selected];
    const [it] = arr.splice(from, 1);
    arr.splice(to, 0, it);
    onChange(arr);
  };

  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">
        캐릭터 <span className="text-gray-600">(순서대로 Picture 1, 2, 3… 로 레퍼런스)</span>
      </label>
      <div className="space-y-1">
        {selected.map((id, idx) => {
          const c = byId[id];
          if (!c) return null;
          const hasRef = !!c.sprite_path;
          return (
            <div key={id} className="flex items-center gap-2 text-xs input-base py-1">
              <span className="text-gray-500 font-mono w-14">Picture {idx + 1}</span>
              <span className="flex-1 truncate">{c.name}</span>
              {hasRef ? (
                <span className="text-emerald-400 text-[10px]">ref ✓</span>
              ) : (
                <span className="text-gray-500 text-[10px]">설명만</span>
              )}
              <button onClick={() => move(idx, idx - 1)} className="p-0.5 hover:text-accent disabled:opacity-30" disabled={idx === 0}>
                ↑
              </button>
              <button onClick={() => move(idx, idx + 1)} className="p-0.5 hover:text-accent disabled:opacity-30" disabled={idx === selected.length - 1}>
                ↓
              </button>
              <button onClick={() => remove(id)} className="p-0.5 hover:text-red-400">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        <select
          className="input-base w-full"
          value=""
          onChange={(e) => {
            add(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">+ 캐릭터 추가... ({remaining.length}명 남음)</option>
          {remaining.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.sprite_path ? " (sprite ✓)" : ""}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
