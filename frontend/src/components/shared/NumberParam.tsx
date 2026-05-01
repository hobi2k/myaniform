interface Props {
  label: string;
  placeholder?: string;
  value?: number;
  step?: string;
  min?: number;
  max?: number;
  onChange: (v: number | undefined) => void;
}

export default function NumberParam({ label, placeholder, value, step, min, max, onChange }: Props) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        className="input-base w-full"
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      />
    </div>
  );
}
