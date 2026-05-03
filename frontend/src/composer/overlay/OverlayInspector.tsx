import { Trash2, X } from "lucide-react";
import type { EditOverlay, OverlayAnimationIn, OverlayAnimationOut } from "../../types";

interface Props {
  overlay: EditOverlay;
  onChange: (patch: Partial<EditOverlay>) => void;
  onDelete: () => void;
  onClose: () => void;
}

const KIND_LABELS: Record<EditOverlay["kind"], string> = {
  caption: "자막",
  title: "타이틀",
  sticker: "스티커",
  shape: "도형",
  image: "이미지",
};

const ANIM_IN_LABELS: Record<OverlayAnimationIn, string> = {
  none: "없음",
  fade: "페이드",
  slide_up: "위로 슬라이드",
  slide_left: "왼쪽으로 슬라이드",
  scale: "확대",
};

const ANIM_OUT_LABELS: Record<OverlayAnimationOut, string> = {
  none: "없음",
  fade: "페이드",
  slide_down: "아래로 슬라이드",
  slide_right: "오른쪽으로 슬라이드",
  scale: "축소",
};

/**
 * Right-side panel for the selected overlay. Edits flow up through `onChange`
 * and the parent persists the full overlays array via PUT /projects/.../overlays.
 */
export default function OverlayInspector({ overlay, onChange, onDelete, onClose }: Props) {
  const ov = overlay;
  return (
    <div className="rounded-xl border border-accent/30 bg-surface-overlay/40 p-3 space-y-3">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] text-accent uppercase tracking-wider">오버레이 인스펙터</p>
          <p className="text-sm font-semibold text-white truncate">
            {KIND_LABELS[ov.kind]} · {ov.text?.slice(0, 24) || "(빈 텍스트)"}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onDelete}
            className="p-1 hover:text-red-400 transition-colors"
            title="삭제 (Delete)"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:text-red-400 transition-colors"
            title="선택 해제 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <section className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">종류</label>
            <select
              className="input-base w-full"
              value={ov.kind}
              onChange={(e) => onChange({ kind: e.target.value as EditOverlay["kind"] })}
            >
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">씬</label>
            <input
              type="number"
              className="input-base w-full"
              min={0}
              value={ov.scene_index}
              onChange={(e) => onChange({ scene_index: Math.max(0, Math.floor(Number(e.target.value))) })}
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">텍스트</label>
          <textarea
            className="input-base w-full resize-none h-16"
            value={ov.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        </div>
      </section>

      <section className="space-y-2">
        <span className="text-[11px] text-gray-400 font-semibold">시간</span>
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="씬 시작 후 sec"
            step={0.1}
            min={0}
            value={ov.start}
            onChange={(v) => onChange({ start: Math.max(0, v) })}
          />
          <NumberField
            label="표시 시간 sec"
            step={0.1}
            min={0.1}
            value={ov.duration}
            onChange={(v) => onChange({ duration: Math.max(0.1, v) })}
          />
          <NumberField
            label="애니 sec"
            step={0.05}
            min={0}
            value={ov.animation_duration ?? 0.4}
            onChange={(v) => onChange({ animation_duration: Math.max(0, v) })}
          />
        </div>
      </section>

      <section className="space-y-2">
        <span className="text-[11px] text-gray-400 font-semibold">위치 / 회전</span>
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="x (0..1)"
            step={0.01}
            value={ov.x ?? 0.5}
            onChange={(v) => onChange({ x: clamp01(v) })}
          />
          <NumberField
            label="y (0..1)"
            step={0.01}
            value={ov.y ?? 0.5}
            onChange={(v) => onChange({ y: clamp01(v) })}
          />
          <NumberField
            label="회전 °"
            step={1}
            value={ov.rotation ?? 0}
            onChange={(v) => onChange({ rotation: v })}
          />
        </div>
      </section>

      <section className="space-y-2">
        <span className="text-[11px] text-gray-400 font-semibold">스타일</span>
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="font size px"
            step={1}
            min={8}
            value={ov.font_size ?? 22}
            onChange={(v) => onChange({ font_size: Math.max(8, v) })}
          />
          <NumberField
            label="font weight"
            step={100}
            min={100}
            max={900}
            value={ov.font_weight ?? 600}
            onChange={(v) => onChange({ font_weight: Math.max(100, Math.min(900, v)) })}
          />
          <div>
            <label className="text-[10px] text-gray-500">색</label>
            <input
              type="color"
              className="w-full h-8 rounded-md cursor-pointer bg-surface"
              value={normalizeColor(ov.color ?? "#ffffff")}
              onChange={(e) => onChange({ color: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">박스 배경 (CSS, optional)</label>
          <input
            className="input-base w-full"
            placeholder="rgba(0,0,0,0.45) 또는 비움"
            value={ov.background ?? ""}
            onChange={(e) => onChange({ background: e.target.value || undefined })}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">외곽선 색</label>
            <input
              type="color"
              className="w-full h-8 rounded-md cursor-pointer bg-surface"
              value={normalizeColor(ov.outline ?? "#000000")}
              onChange={(e) => onChange({ outline: e.target.value })}
            />
          </div>
          <NumberField
            label="외곽선 두께 px"
            step={0.5}
            min={0}
            value={ov.outline_width ?? 1}
            onChange={(v) => onChange({ outline_width: Math.max(0, v) })}
          />
          <NumberField
            label="여백 padding px"
            step={1}
            min={0}
            value={ov.padding ?? 0}
            onChange={(v) => onChange({ padding: Math.max(0, v) })}
          />
        </div>
      </section>

      <section className="space-y-2">
        <span className="text-[11px] text-gray-400 font-semibold">애니메이션</span>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">진입</label>
            <select
              className="input-base w-full"
              value={ov.animation_in ?? "fade"}
              onChange={(e) => onChange({ animation_in: e.target.value as OverlayAnimationIn })}
            >
              {Object.entries(ANIM_IN_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">이탈</label>
            <select
              className="input-base w-full"
              value={ov.animation_out ?? "fade"}
              onChange={(e) => onChange({ animation_out: e.target.value as OverlayAnimationOut })}
            >
              {Object.entries(ANIM_OUT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <p className="text-[10px] text-gray-500">
        화면 위 마우스 더블클릭 = 새 오버레이. 드래그 = 이동, 모서리 핸들 = 크기, 위쪽 핸들 = 회전. Delete 키 = 삭제.
      </p>
    </div>
  );
}

function NumberField({
  label,
  value,
  step = 1,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-gray-500">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-base w-full"
      />
    </label>
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Color inputs require #rrggbb. Coerce rgba/named values defensively. */
function normalizeColor(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return "#" + c.slice(1).split("").map((d) => d + d).join("");
  }
  // Fallback to white for unknown formats.
  return "#ffffff";
}
