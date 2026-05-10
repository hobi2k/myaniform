import { useEffect, useMemo } from "react";
import { Mic } from "lucide-react";
import {
  QWEN3_CUSTOM_VOICE_SPEAKERS,
  VOICE_MODE_OPTIONS,
  type Character,
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
  /** The character whose prepared voice will be the source for this scene.
   *  Used to (a) render the source banner and (b) pre-fill speaker / voicebox
   *  fields when the chosen mode needs them. */
  character: Character | null;
}

/**
 * Inspector for *consuming* a character's prepared voice in a scene. The
 * character has already done the voice creation work (design / upload /
 * preset / voicebox); this editor only chooses HOW to use that source for
 * the scene's dialogue line.
 *
 * Voice *creation* modes (qwen3_voice_design, directed_clone) are not
 * surfaced here — they live on the character inspector.
 */
export default function SceneVoiceParamsEditor({ value, onChange, character }: Props) {
  const sourceInfo = describeVoiceSource(character);
  const defaultMode = pickDefaultMode(character);
  const mode = (value.mode ?? defaultMode) as VoiceMode;
  const spec = useMemo(
    () => VOICE_MODE_OPTIONS.find((o) => o.id === mode) ?? VOICE_MODE_OPTIONS[0],
    [mode],
  );

  // Sync mode to default once on first render so legacy rows pick up the
  // character-aware default without forcing a click.
  useEffect(() => {
    if (!value.mode) onChange({ ...value, mode: defaultMode });
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

  const refAudioMissing = spec.needsRefAudio && !character?.voice_sample_path;
  const voiceboxMissing =
    spec.id === "qwen3_voicebox_instruct" &&
    !character?.voicebox_speaker &&
    !value.speaker;

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

  // Effective speaker for preset modes: scene override → character preset →
  // first speaker. Used as the dropdown value so the UI reflects what the
  // backend will actually use.
  const effectivePresetSpeaker =
    value.speaker ??
    character?.voice_preset_speaker ??
    QWEN3_CUSTOM_VOICE_SPEAKERS[0];

  return (
    <div className="space-y-3">
      {/* Source banner — makes it explicit that voice already comes from the character. */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-2 text-[11px] text-gray-300 flex items-start gap-2">
        <Mic className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
        <div>
          <div className="text-gray-400">소스 (캐릭터에서 상속)</div>
          <div className="text-white">{sourceInfo.title}</div>
          {sourceInfo.detail && (
            <div className="text-[10px] text-gray-500 mt-0.5">{sourceInfo.detail}</div>
          )}
        </div>
      </div>

      <div>
        <label className="text-[11px] text-gray-400 mb-1 block">씬 합성 모드</label>
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
            ⚠ 이 모드는 캐릭터 음성 샘플(WAV) 이 필요합니다. 캐릭터 인스펙터에서 음성을 디자인하거나 WAV 를 업로드하세요.
          </p>
        )}
        {voiceboxMissing && (
          <p className="mt-1 text-[10px] text-amber-300">
            ⚠ 이 모드는 캐릭터에 등록된 voicebox speaker 가 필요합니다. 캐릭터 인스펙터의 VoiceBox 섹션에서 ckpt + speaker 이름을 설정하거나, 아래 speaker 필드에 직접 입력하세요.
          </p>
        )}
      </div>

      {/* Instruct (톤/감정 지시) — 거의 모든 씬 모드에 있음. clone-only 만 제외. */}
      {spec.id !== "qwen3_voice_clone" && spec.id !== "s2pro_voice_clone" && (
        <PromptParam
          label="Instruct (톤/감정/연기 지시)"
          placeholder="Speak softly with restrained sadness, steady pace, soft breath at end of phrases..."
          rows={2}
          value={value.instruct ?? ""}
          onChange={(v) => set("instruct", v || undefined)}
        />
      )}

      {/* Built-in Qwen3 speaker preset (qwen3_custom_voice) */}
      {spec.id === "qwen3_custom_voice" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">Speaker (preset)</label>
            <select
              className="input-base w-full"
              value={effectivePresetSpeaker}
              onChange={(e) => set("speaker", e.target.value)}
            >
              {QWEN3_CUSTOM_VOICE_SPEAKERS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {character?.voice_preset_speaker && !value.speaker && (
              <p className="text-[10px] text-gray-500 mt-1">
                캐릭터 기본값: {character.voice_preset_speaker}
              </p>
            )}
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

      {/* VoiceBox named speaker — pulled from character.voicebox_speaker by default. */}
      {spec.id === "qwen3_voicebox_instruct" && (
        <div>
          <label className="text-[10px] text-gray-500">VoiceBox speaker name</label>
          <input
            className="input-base w-full"
            placeholder={character?.voicebox_speaker ?? "예: mai"}
            value={value.speaker ?? character?.voicebox_speaker ?? ""}
            onChange={(e) => set("speaker", e.target.value || undefined)}
          />
          {character?.voicebox_speaker && !value.speaker && (
            <p className="text-[10px] text-gray-500 mt-1">
              캐릭터 등록 speaker: <span className="text-gray-300">{character.voicebox_speaker}</span>
              {character.voicebox_checkpoint && (
                <> · ckpt: <span className="text-gray-400">{character.voicebox_checkpoint}</span></>
              )}
            </p>
          )}
        </div>
      )}

      {/* Reference text — clone modes. Optional but improves accuracy. */}
      {spec.needsRefAudio && (
        <PromptParam
          label="Reference text (보이스 샘플의 실제 발화 — 선택)"
          placeholder={character?.voice_sample_text ?? "비워두면 자동 추정"}
          rows={1}
          value={value.ref_text ?? character?.voice_sample_text ?? ""}
          onChange={(v) => set("ref_text", v || undefined)}
        />
      )}

      {/* Hybrid auto-anchor knobs */}
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
              placeholder={character?.voice_preset_speaker ?? "저장된 CustomVoice 화자"}
              value={value.customvoice_speaker ?? character?.voice_preset_speaker ?? ""}
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
              value={value.language ?? character?.voice_language ?? "Korean"}
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

// ── Helpers ───────────────────────────────────────────────────────────────

function describeVoiceSource(c: Character | null): { title: string; detail?: string } {
  if (!c) {
    return { title: "캐릭터 없음", detail: "이 씬에 캐릭터를 먼저 배정하세요." };
  }
  const registered = c.voicebox_speaker && c.voicebox_checkpoint;
  const baselineLabel =
    c.voice_source === "upload"
      ? "WAV 업로드"
      : c.voice_source === "design"
        ? "Voice Design"
        : c.voice_sample_path
          ? (c.voice_design ? "Voice Design" : "WAV 업로드")
          : "미설정";

  if (registered) {
    return {
      title: `${c.name} · ${baselineLabel} → 모델 등록됨`,
      detail: `speaker = ${c.voicebox_speaker} (ref audio 불필요, 일관 음색)`,
    };
  }
  if (c.voice_sample_path) {
    return {
      title: `${c.name} · ${baselineLabel} (clone baseline)`,
      detail: c.voice_design ?? c.voice_sample_path,
    };
  }
  return {
    title: `${c.name} · 음성 미설정`,
    detail: "캐릭터 인스펙터에서 baseline WAV 를 먼저 만드세요.",
  };
}

function pickDefaultMode(c: Character | null): VoiceMode {
  if (!c) return "qwen3_hybrid_clone_instruct_preset";
  // 등록된 캐릭터가 최우선 — ref 없이 즉시 호출.
  if (c.voicebox_speaker && c.voicebox_checkpoint) return "qwen3_voicebox_instruct";
  // 엔진 기본 페어링.
  if (c.tts_engine === "s2pro" && c.voice_sample_path) return "s2pro_voice_clone";
  if (c.voice_sample_path) return "qwen3_base_custom_voice_clone_instruct";
  return "qwen3_hybrid_clone_instruct_preset";
}
