import type { ReactNode } from "react";

interface Props {
  ok: boolean;
  icon: ReactNode;
  label: string;
  stale?: boolean;
}

export default function MiniBadge({ ok, icon, label, stale }: Props) {
  const cls = stale
    ? "bg-yellow-500/20 text-yellow-300"
    : ok
      ? "bg-emerald-500/15 text-emerald-300"
      : "bg-white/5 text-gray-500";
  return (
    <span className={`badge ${cls}`} title={stale ? `${label} stale` : ok ? `${label} 준비됨` : `${label} 미생성`}>
      {icon}
      {label}
    </span>
  );
}
