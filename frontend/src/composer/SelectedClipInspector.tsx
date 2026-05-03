import { Wand2, X } from "lucide-react";
import type { ColorPreset, EditTransitionStyle, Scene } from "../types";
import type { ComposerClip } from "./types";

interface Props {
  clip: ComposerClip;
  /** Patch with partial Scene fields. Caller does the API call + cache update. */
  onPatch: (patch: Partial<Scene>) => void;
  onClose: () => void;
}

const COLOR_PRESETS: Array<{ value: ColorPreset; label: string }> = [
  { value: "reference_soft", label: "기준 소프트" },
  { value: "warm_room", label: "따뜻한 실내" },
  { value: "clean_neutral", label: "클린 뉴트럴" },
  { value: "dream_blush", label: "드림 블러시" },
];

const TRANSITIONS: Array<{ value: EditTransitionStyle; label: string }> = [
  { value: "cut", label: "즉시 컷" },
  { value: "soft", label: "부드러운 연결" },
  { value: "fade", label: "페이드" },
  { value: "dip_to_black", label: "암전" },
  { value: "flash", label: "플래시" },
];

/**
 * Right-side panel shown when a clip on the timeline is selected. Edits
 * persist to the backend via `onPatch` (parent does the network call).
 *
 * Note: trim is set via mouse drag on the clip card; this panel exposes
 * numeric inputs for precision. Reset buttons clear per-clip overrides
 * back to the global defaults.
 */
export default function SelectedClipInspector({ clip, onPatch, onClose }: Props) {
  const reset = (field: keyof Scene) => onPatch({ [field]: null } as Partial<Scene>);

  return (
    <div className="rounded-xl border border-accent/30 bg-surface-overlay/40 p-3 space-y-3">
      <header className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[10px] text-accent uppercase tracking-wider">클립 인스펙터</p>
          <p className="text-sm font-semibold text-white truncate">
            #{clip.index + 1} · {clip.bg_prompt?.slice(0, 28) || "(프롬프트 없음)"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:text-red-400 transition-colors"
          title="선택 해제"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400 font-semibold">트림 (정밀)</span>
          <button
            type="button"
            onClick={() => onPatch({ clip_in_offset_sec: null, clip_out_offset_sec: null })}
            className="text-[10px] text-gray-500 hover:text-accent"
          >
            리셋
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="text-[10px] text-gray-500">시작 (in)</span>
            <input
              type="number"
              step="0.01"
              min={0}
              max={clip.duration_sec - 0.1}
              value={clip.clip_in_offset_sec.toFixed(2)}
              onChange={(e) => {
                const v = Math.max(0, Math.min(Number(e.target.value), clip.clip_out_offset_sec - 0.1));
                onPatch({ clip_in_offset_sec: v });
              }}
              className="input-base w-full"
            />
          </label>
          <label>
            <span className="text-[10px] text-gray-500">끝 (out)</span>
            <input
              type="number"
              step="0.01"
              min={clip.clip_in_offset_sec + 0.1}
              max={clip.duration_sec}
              value={clip.clip_out_offset_sec.toFixed(2)}
              onChange={(e) => {
                const v = Math.max(clip.clip_in_offset_sec + 0.1, Math.min(Number(e.target.value), clip.duration_sec));
                onPatch({ clip_out_offset_sec: v });
              }}
              className="input-base w-full"
            />
          </label>
        </div>
        <p className="text-[10px] text-gray-500">
          소스 길이 {clip.duration_sec.toFixed(2)}s · 사용 {(clip.clip_out_offset_sec - clip.clip_in_offset_sec).toFixed(2)}s · 타임라인 {((clip.clip_out_offset_sec - clip.clip_in_offset_sec) / clip.speed).toFixed(2)}s
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400 font-semibold">속도</span>
          <button type="button" onClick={() => reset("clip_speed")} className="text-[10px] text-gray-500 hover:text-accent">
            리셋
          </button>
        </div>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={clip.speed}
          onChange={(e) => onPatch({ clip_speed: Number(e.target.value) })}
          className="w-full accent-accent"
        />
        <p className="text-[10px] text-gray-500">
          {clip.speed.toFixed(2)}× · 0.25~4× · 정상=1.00
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400 font-semibold">볼륨</span>
          <button
            type="button"
            onClick={() => onPatch({ clip_voice_volume: null, clip_sfx_volume: null })}
            className="text-[10px] text-gray-500 hover:text-accent"
          >
            리셋
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="text-[10px] text-gray-500">목소리</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={clip.voice_volume}
              onChange={(e) => onPatch({ clip_voice_volume: Number(e.target.value) })}
              className="w-full accent-accent"
            />
            <span className="text-[10px] text-gray-500">{clip.voice_volume.toFixed(2)}</span>
          </label>
          <label>
            <span className="text-[10px] text-gray-500">SFX (클립 자체 오디오)</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={clip.sfx_volume}
              onChange={(e) => onPatch({ clip_sfx_volume: Number(e.target.value) })}
              className="w-full accent-accent"
            />
            <span className="text-[10px] text-gray-500">{clip.sfx_volume.toFixed(2)}</span>
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400 font-semibold">색감 오버레이</span>
          <button type="button" onClick={() => reset("clip_color_overlay")} className="text-[10px] text-gray-500 hover:text-accent">
            없음
          </button>
        </div>
        <select
          className="input-base w-full"
          value={clip.color_overlay ?? ""}
          onChange={(e) =>
            onPatch({ clip_color_overlay: (e.target.value || null) as ColorPreset | null })
          }
        >
          <option value="">(글로벌 grade 만 사용)</option>
          {COLOR_PRESETS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <p className="text-[10px] text-gray-500">전역 색감 위에 추가로 chain 됩니다.</p>
      </section>

      <section className="space-y-2 border-t border-white/5 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400 font-semibold flex items-center gap-1">
            <Wand2 className="w-3 h-3" />
            다음 씬으로 트랜지션 (이 클립의 outgoing)
          </span>
          <button
            type="button"
            onClick={() => onPatch({ out_transition_style: null, out_transition_sec: null })}
            className="text-[10px] text-gray-500 hover:text-accent"
          >
            전역값 사용
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input-base w-full"
            value={clip.out_transition_style ?? ""}
            onChange={(e) =>
              onPatch({
                out_transition_style: (e.target.value || null) as EditTransitionStyle | null,
              })
            }
          >
            <option value="">(전역값)</option>
            {TRANSITIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <label>
            <span className="text-[10px] text-gray-500">전환 시간 sec</span>
            <input
              type="number"
              step="0.05"
              min={0}
              max={3}
              value={clip.out_transition_sec ?? ""}
              placeholder="(전역)"
              onChange={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                onPatch({ out_transition_sec: v });
              }}
              className="input-base w-full"
            />
          </label>
        </div>
      </section>
    </div>
  );
}
