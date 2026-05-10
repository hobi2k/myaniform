import { useEffect, useMemo } from "react";
import {
  QWEN3_CUSTOM_VOICE_SPEAKERS,
  VOICE_MODE_OPTIONS,
  type VoiceMode,
  type VoiceParams,
} from "../../types";
import NumberParam from "./NumberParam";
import PromptParam from "./PromptParam";

const LANGUAGES = [
  "Auto", "Korean", "English", "Japanese", "Chinese",
  "German", "French", "Russian", "Portuguese", "Spanish", "Italian",
] as const;

const VOICEBOX_STRATEGIES = [
  "embedded_encoder_with_ref_code",
  "encoder_only_with_audio_token",
  "audio_token_only",
  "ref_code_only",
] as const;

interface Props {
  /** Voice generation parameters (JSON-serialized in `Scene.voice_params`). */
  value: VoiceParams;
  onChange: (next: VoiceParams) => void;
  /** Whether the selected character has a voice sample uploaded — drives a
   *  warning when the chosen mode requires ref audio but none is available. */
  hasReferenceAudio: boolean;
  /** Default mode picked when value.mode is empty (legacy migration). */
  defaultMode?: VoiceMode;
}

/**
 * Inspector for the rich Qwen3-TTS / S2-Pro mode catalog (per-scene).
 *
 * Renders one mode dropdown plus a mode-aware parameter form. Fields the
 * current mode doesn't touch are hidden so the panel stays focused.
 *
 * Distinct from `VoiceParamsEditor` which sets character-level voice
 * generation hyperparameters (top_k/top_p/temperature) for the character's
 * voice *sample* — that one is unrelated to the scene-level mode catalog.
 */
export default function SceneVoiceParamsEditor({
  value,
  onChange,
  hasReferenceAudio,
  defaultMode = "qwen3_voice_design",
}: Props) {
  const mode = (value.mode ?? defaultMode) as VoiceMode;
  const spec = useMemo(
    () => VOICE_MODE_OPTIONS.find((o) => o.id === mode) ?? VOICE_MODE_OPTIONS[0],
    [mode],
  );

  // Keep value.mode in sync if it was missing — saves a click on legacy rows.
  useEffect(() => {
    if (!value.mode) onChange({ ...value, mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof VoiceParams>(key: K, v: VoiceParams[K] | undefined) => {
    const next: VoiceParams = { ...value };
    if (v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v))) {
      delete next[key];
    } else {
      next[key] = v;
    }
    onChange(next);
  };

  const refAudioMissing = spec.needsRefAudio && !hasReferenceAudio;

  // Group dropdown by family for visual scan.
  type ModeOption = (typeof VOICE_MODE_OPTIONS)[number];
  const grouped = useMemo(() => {
    const out: Record<string, ModeOption[]> = {
      qwen3_native: [],
      qwen3_voicebox: [],
      s2pro: [],
    };
    for (const o of VOICE_MODE_OPTIONS) out[o.family].push(o);
    return out;
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] text-gray-400 mb-1 block">합성 모드</label>
        <select
          className="input-base w-full"
          value={mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as VoiceMode })}
        >
          <optgroup label="Qwen3 — Native">
            {grouped.qwen3_native.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </optgroup>
          <optgroup label="Qwen3 — VoiceBox">
            {grouped.qwen3_voicebox.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </optgroup>
          <optgroup label="Fish S2-Pro">
            {grouped.s2pro.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </optgroup>
        </select>
        <p className="mt-1 text-[10px] text-gray-500">{spec.description}</p>
        {refAudioMissing && (
          <p className="mt-1 text-[10px] text-amber-300">
            ⚠ 이 모드는 캐릭터 보이스 샘플(ref audio) 이 필요합니다. 캐릭터 인스펙터에서 음성 샘플을 업로드하세요.
          </p>
        )}
      </div>

      {/* Instruct — used by every mode that has an instruct slot.
          For voice_design family the user's voice_design_text is also surfaced
          here as the "instruct" so editing in one place updates both calls. */}
      {(spec.needsDesignText || spec.id !== "qwen3_voice_clone") && (
        <PromptParam
          label={spec.needsDesignText ? "Voice Design instruct" : "Instruct (톤/감정/연기 지시)"}
          placeholder={spec.needsDesignText
            ? "Warm intimate Korean female voice, soft breath..."
            : "Speak softly with restrained sadness, steady pace..."}
          rows={2}
          value={value.instruct ?? ""}
          onChange={(v) => set("instruct", v || undefined)}
        />
      )}

      {/* Built-in speaker preset (Qwen3CustomVoice / VoiceBoxInstruct) */}
      {spec.needsSpeakerPreset && spec.family === "qwen3_native" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">Speaker (preset)</label>
            <select
              className="input-base w-full"
              value={value.speaker ?? QWEN3_CUSTOM_VOICE_SPEAKERS[0]}
              onChange={(e) => set("speaker", e.target.value)}
            >
              {QWEN3_CUSTOM_VOICE_SPEAKERS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Custom speaker name (선택)</label>
            <input
              className="input-base w-full"
              placeholder="비워두면 preset 그대로"
              value={value.custom_speaker_name ?? ""}
              onChange={(e) => set("custom_speaker_name", e.target.value || undefined)}
            />
          </div>
        </div>
      )}

      {/* VoiceBoxInstruct uses a free-form speaker name (no preset list) */}
      {spec.needsSpeakerPreset && spec.family === "qwen3_voicebox" && (
        <div>
          <label className="text-[10px] text-gray-500">VoiceBox speaker name</label>
          <input
            className="input-base w-full"
            placeholder="mai / auto / 등록한 화자 이름"
            value={value.speaker ?? "mai"}
            onChange={(e) => set("speaker", e.target.value)}
          />
        </div>
      )}

      {/* Reference text — used by clone modes. Optional but recommended. */}
      {spec.needsRefAudio && (
        <PromptParam
          label="Reference text (보이스 샘플의 실제 발화)"
          placeholder="비워두면 자동 추정. 정확히 입력하면 클론 정확도 ↑"
          rows={1}
          value={value.ref_text ?? ""}
          onChange={(v) => set("ref_text", v || undefined)}
        />
      )}

      {/* Hybrid-only knobs (auto-anchor + saved customvoice speaker) */}
      {spec.id === "qwen3_hybrid_clone_instruct_preset" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">speaker_anchor</label>
            <input
              className="input-base w-full"
              placeholder="auto"
              value={value.speaker_anchor ?? "auto"}
              onChange={(e) => set("speaker_anchor", e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">customvoice_speaker</label>
            <input
              className="input-base w-full"
              placeholder="저장된 CustomVoice 화자 이름"
              value={value.customvoice_speaker ?? ""}
              onChange={(e) => set("customvoice_speaker", e.target.value || undefined)}
            />
          </div>
        </div>
      )}

      {/* VoiceBox clone strategy */}
      {spec.id === "qwen3_voicebox_clone_instruct" && (
        <div>
          <label className="text-[10px] text-gray-500">strategy</label>
          <select
            className="input-base w-full"
            value={value.strategy ?? VOICEBOX_STRATEGIES[0]}
            onChange={(e) => set("strategy", e.target.value)}
          >
            {VOICEBOX_STRATEGIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      <details className="rounded-lg border border-white/5 bg-black/10 p-2">
        <summary className="text-[10px] text-gray-500 font-semibold cursor-pointer">고급 옵션</summary>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
          <div>
            <label className="text-[10px] text-gray-500">language</label>
            <select
              className="input-base w-full"
              value={value.language ?? "Korean"}
              onChange={(e) => set("language", e.target.value)}
            >
              {LANGUAGES.map((l) => (<option key={l} value={l}>{l}</option>))}
            </select>
          </div>
          <NumberParam label="seed" placeholder="42" value={value.seed} onChange={(v) => set("seed", v as number | undefined)} />
          <NumberParam label="temperature" placeholder="0.9" step="0.05" value={value.temperature} onChange={(v) => set("temperature", v as number | undefined)} />
          <NumberParam label="top_p" placeholder="0.9" step="0.05" value={value.top_p} onChange={(v) => set("top_p", v as number | undefined)} />
          <NumberParam label="max_new_tokens" placeholder="2048" value={value.max_new_tokens} onChange={(v) => set("max_new_tokens", v as number | undefined)} />
          {spec.needsRefAudio && (
            <NumberParam label="ref_audio_max_sec" placeholder="30" value={value.ref_audio_max_seconds} onChange={(v) => set("ref_audio_max_seconds", v as number | undefined)} />
          )}
          {(spec.id === "qwen3_base_custom_voice_clone_instruct"
            || spec.id === "qwen3_directed_clone_from_voice_design"
            || spec.id === "qwen3_hybrid_clone_instruct_preset") && (
            <label className="flex items-center gap-1 text-[11px] text-gray-300 col-span-2">
              <input
                type="checkbox"
                checked={!!value.x_vector_only_mode}
                onChange={(e) => set("x_vector_only_mode", e.target.checked)}
              />
              <span>x_vector_only_mode (음색만 — 발화 스타일은 instruct 가 주도)</span>
            </label>
          )}
          {(spec.id === "qwen3_hybrid_clone_instruct_preset"
            || spec.id === "qwen3_voicebox_clone_instruct") && (
            <label className="flex items-center gap-1 text-[11px] text-gray-300 col-span-2">
              <input
                type="checkbox"
                checked={!!value.non_streaming_mode}
                onChange={(e) => set("non_streaming_mode", e.target.checked)}
              />
              <span>non_streaming_mode (전체 한 번에 합성 — 긴 문장 안정)</span>
            </label>
          )}
        </div>
      </details>
    </div>
  );
}
