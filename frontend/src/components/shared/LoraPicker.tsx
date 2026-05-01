import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../api";
import type { LoraSelection } from "../../types";

interface Props {
  value: LoraSelection[];
  onChange: (v: LoraSelection[]) => void;
}

export default function LoraPicker({ value, onChange }: Props) {
  const { data: available = [] } = useQuery({
    queryKey: ["loras"],
    queryFn: () => api.loras.list(),
    staleTime: 60_000,
  });
  const remaining = available.filter((e) => !value.some((v) => v.name === e.name));
  const [customName, setCustomName] = useState("");

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || value.some((v) => v.name === trimmed)) return;
    onChange([...value, { name: trimmed, strength: 1.0 }]);
  };
  const update = (idx: number, patch: Partial<LoraSelection>) =>
    onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">LoRA 추가 (선택)</label>
      <div className="space-y-1.5">
        {value.map((l, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate input-base py-1">{l.name}</span>
            <input
              type="number"
              step="0.05"
              min="-2"
              max="2"
              value={l.strength}
              onChange={(e) => update(idx, { strength: parseFloat(e.target.value) })}
              className="input-base w-16 py-1"
            />
            <button
              onClick={() => remove(idx)}
              className="p-1 hover:text-red-400 transition-colors"
              title="제거"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <select
          className="input-base w-full"
          value=""
          onChange={(e) => {
            add(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">+ 목록에서 선택... ({remaining.length}개)</option>
          {remaining.map((e) => (
            <option key={e.name} value={e.name}>
              {e.group ? `[${e.group}] ` : ""}
              {e.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <input
            type="text"
            placeholder="직접 입력: my_lora.safetensors"
            className="input-base flex-1 py-1 text-xs"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(customName);
                setCustomName("");
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              add(customName);
              setCustomName("");
            }}
            disabled={!customName.trim()}
            className="px-2 py-1 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs"
            title="추가"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
