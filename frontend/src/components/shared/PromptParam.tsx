interface Props {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}

export default function PromptParam({ label, placeholder, value, onChange, rows = 3 }: Props) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <textarea
        className="input-base w-full resize-none"
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
