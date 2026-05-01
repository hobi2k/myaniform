import type { ReactNode } from "react";

interface Tab<T extends string> {
  value: T;
  label: ReactNode;
  hint?: string;
}

interface Props<T extends string> {
  tabs: Tab<T>[];
  value: T;
  onChange: (v: T) => void;
}

export default function MiniTabs<T extends string>({ tabs, value, onChange }: Props<T>) {
  return (
    <div className="flex gap-0.5 border-b border-white/10 mb-3">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          title={t.hint}
          onClick={() => onChange(t.value)}
          className={`px-3 py-1.5 text-[11px] font-medium border-b-2 -mb-px transition-all ${
            value === t.value
              ? "border-accent text-accent"
              : "border-transparent text-gray-400 hover:text-white"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
