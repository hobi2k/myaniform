import type { VoiceGenParams } from "../../types";
import NumberParam from "./NumberParam";

interface Props {
  value: VoiceGenParams;
  onChange: (p: VoiceGenParams) => void;
}

export default function VoiceParamsEditor({ value, onChange }: Props) {
  const set = (k: keyof VoiceGenParams, v: number | undefined) => {
    const next: Record<string, unknown> = { ...value };
    if (v === undefined || Number.isNaN(v)) {
      delete next[k as string];
    } else {
      next[k as string] = v;
    }
    onChange(next as VoiceGenParams);
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      <NumberParam label="top_k" placeholder="50" value={value.top_k} onChange={(v) => set("top_k", v)} />
      <NumberParam label="top_p" placeholder="1.0" step="0.01" value={value.top_p} onChange={(v) => set("top_p", v)} />
      <NumberParam label="temperature" placeholder="0.9" step="0.05" value={value.temperature} onChange={(v) => set("temperature", v)} />
      <NumberParam label="repetition_penalty" placeholder="1.05" step="0.01" value={value.repetition_penalty} onChange={(v) => set("repetition_penalty", v)} />
      <NumberParam label="max_new_tokens" placeholder="2048" value={value.max_new_tokens} onChange={(v) => set("max_new_tokens", v)} />
      <NumberParam label="seed" placeholder="-1" value={value.seed} onChange={(v) => set("seed", v)} />
    </div>
  );
}
