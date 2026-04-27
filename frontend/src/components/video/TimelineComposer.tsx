import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Captions, CheckCircle2, Film, Gauge, Layers, Music, Palette, Play, SlidersHorizontal, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../api";
import type { ColorPreset, EditOverlay, EditRenderSettings, EditTransitionStyle } from "../../types";

interface Props {
  projectId: string;
}

type OverlayKind = "title" | "caption" | "sticker";

interface OverlayDraft {
  kind: OverlayKind;
  text: string;
  sceneIndex: number;
  start: number;
  duration: number;
}

const TRANSITIONS: Array<{ value: EditTransitionStyle; label: string; note: string }> = [
  { value: "cut", label: "즉시 컷", note: "VN/웹툰식 장면 전환. 컷 밀도 검증에 가장 안정적입니다." },
  { value: "soft", label: "부드러운 연결", note: "짧은 디졸브로 감정 장면을 이어붙입니다." },
  { value: "fade", label: "페이드", note: "천천히 겹쳐지는 장면 연결입니다." },
  { value: "dip_to_black", label: "암전", note: "시간 경과나 장면 단절을 분명히 보여줍니다." },
  { value: "flash", label: "플래시", note: "강한 감정/충격 컷에 적합합니다." },
];

const COLOR_PRESETS: Array<{ value: ColorPreset; label: string; note: string }> = [
  { value: "reference_soft", label: "기준 영상 소프트", note: "저채도, 낮은 대비, 베이지/블러시 톤" },
  { value: "warm_room", label: "따뜻한 실내", note: "실내 조명과 살짝 따뜻한 피부톤" },
  { value: "clean_neutral", label: "클린 뉴트럴", note: "후보정 약하게, 원본 클립 보존" },
  { value: "dream_blush", label: "드림 블러시", note: "몽환적이고 더 부드러운 성인 VN 톤" },
];

const DEFAULT_SETTINGS: EditRenderSettings = {
  transition_style: "cut",
  transition_sec: 0,
  fps: 30,
  audio_sample_rate: 48000,
  target_lufs: -30.8,
  loudness_range_lu: 9.4,
  color_preset: "reference_soft",
  grain_strength: 2,
  vignette_strength: 7,
  subtitle_style: {
    font_size: 34,
    margin_v: 34,
    outline: 2.4,
    shadow: 0,
  },
};

function assetUrl(path: string | null | undefined, prefix = "/comfy_input/") {
  if (!path) return "";
  return `${prefix}${path}?v=${Date.now()}`;
}

function NumberField({
  label,
  value,
  step = "1",
  onChange,
}: {
  label: string;
  value: number | undefined;
  step?: string;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-gray-500">{label}</span>
      <input
        className="input-base w-full"
        type="number"
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </label>
  );
}

export default function TimelineComposer({ projectId }: Props) {
  const qc = useQueryClient();
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId),
  });
  const { data: scenes = [] } = useQuery({
    queryKey: ["scenes", projectId],
    queryFn: () => api.scenes.list(projectId),
  });

  const [settings, setSettings] = useState<EditRenderSettings>(DEFAULT_SETTINGS);
  const [overlays, setOverlays] = useState<OverlayDraft[]>([]);
  const [draft, setDraft] = useState<OverlayDraft>({
    kind: "caption",
    text: "",
    sceneIndex: 0,
    start: 0,
    duration: 3,
  });

  const renderMutation = useMutation({
    mutationFn: () =>
      api.generation.renderEdit(projectId, {
        ...settings,
        overlays: overlays.map<EditOverlay>((overlay) => ({
          kind: overlay.kind,
          text: overlay.text,
          scene_index: overlay.sceneIndex,
          start: overlay.start,
          duration: overlay.duration,
        })),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const readyScenes = scenes.filter((s) => s.clip_path && !s.clip_stale);
  const blockedScenes = scenes.filter((s) => !s.clip_path || s.clip_stale);
  const estimatedClipSeconds = 7.23;
  const totalSeconds = useMemo(() => {
    const transitionSeconds = Math.max(0, scenes.length - 1) * settings.transition_sec;
    return scenes.length * estimatedClipSeconds + transitionSeconds;
  }, [scenes.length, settings.transition_sec]);

  const selectedTransition = TRANSITIONS.find((item) => item.value === settings.transition_style) ?? TRANSITIONS[0];
  const selectedColor = COLOR_PRESETS.find((item) => item.value === settings.color_preset) ?? COLOR_PRESETS[0];

  const addOverlay = () => {
    if (!draft.text.trim()) return;
    setOverlays((prev) => [...prev, { ...draft, text: draft.text.trim() }]);
    setDraft((prev) => ({ ...prev, text: "" }));
  };

  const compositionJson = useMemo(
    () => ({
      project_id: projectId,
      title: project?.title ?? "",
      render_settings: settings,
      tracks: {
        video: scenes.map((s, index) => ({
          scene_id: s.id,
          index,
          clip_path: s.clip_path,
          image_path: s.image_path,
          ready: Boolean(s.clip_path && !s.clip_stale),
        })),
        voice: scenes.filter((s) => s.voice_path).map((s, index) => ({ scene_id: s.id, index, voice_path: s.voice_path })),
        sfx: scenes.map((s, index) => ({ scene_id: s.id, index, prompt: s.sfx_prompt })),
        overlays,
      },
    }),
    [overlays, project?.title, projectId, scenes, settings],
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="rounded-2xl border border-accent/20 bg-[radial-gradient(circle_at_top_left,rgba(242,177,112,0.16),transparent_34%),linear-gradient(135deg,rgba(22,22,28,0.96),rgba(8,8,12,0.98))] p-4 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs text-accent font-semibold uppercase tracking-wider">Edit Studio</p>
            <h2 className="text-xl font-semibold text-white mt-1">장면, 음성, 효과음을 최종 영상으로 편집</h2>
            <p className="text-sm text-gray-400 mt-1 max-w-3xl">
              여기서는 ComfyUI 생성물을 다시 만들지 않고, 이미 생성된 씬 클립을 컷 편집, 색보정, 자막, 라우드니스 기준으로 최종 mp4로 합성합니다.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-gray-500">씬</p>
              <p className="text-white font-semibold">{readyScenes.length}/{scenes.length}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-gray-500">길이</p>
              <p className="text-white font-semibold">{totalSeconds.toFixed(1)}s</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-gray-500">프레임</p>
              <p className="text-white font-semibold">{Math.round(totalSeconds * settings.fps)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" />
              Video Track
            </p>
            <span className="text-[10px] text-gray-500">{selectedTransition.label}</span>
          </div>

          <div className="space-y-2">
            {scenes.map((scene, index) => (
              <div key={scene.id} className="grid grid-cols-[72px_1fr] gap-3 rounded-lg border border-white/5 bg-black/15 p-2">
                <div className="aspect-video rounded bg-surface-sunken overflow-hidden grid place-items-center">
                  {scene.image_path ? (
                    <img src={assetUrl(scene.image_path)} className="w-full h-full object-cover" />
                  ) : (
                    <Film className="w-5 h-5 text-gray-600" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-white truncate">#{index + 1} {scene.bg_prompt || "(프롬프트 없음)"}</p>
                    {scene.clip_path && !scene.clip_stale ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <span className="text-[10px] text-yellow-400">렌더 필요</span>
                    )}
                  </div>
                  <div className="mt-2 h-8 rounded bg-gradient-to-r from-accent/50 via-loop/30 to-effect/40 border border-white/10 relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 w-1 bg-white/50" />
                    {index > 0 && <div className="absolute -left-1 top-1/2 h-4 w-4 -translate-y-1/2 rotate-45 border border-accent/40 bg-black/40" />}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-500">
                    <span>{scene.clip_path ? "video" : "no video"}</span>
                    <span>{scene.voice_path ? "voice" : "no voice"}</span>
                    <span>{scene.sfx_prompt ? "sfx prompt" : "no sfx"}</span>
                    <span>{scene.type}</span>
                  </div>
                </div>
              </div>
            ))}
            {scenes.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/10 py-10 text-center text-sm text-gray-500">
                씬을 먼저 추가하면 타임라인이 여기에 나타납니다.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              컷 편집
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label>
                <span className="text-[10px] text-gray-500">장면 전환</span>
                <select
                  className="input-base w-full"
                  value={settings.transition_style}
                  onChange={(e) => {
                    const style = e.target.value as EditTransitionStyle;
                    setSettings((prev) => ({
                      ...prev,
                      transition_style: style,
                      transition_sec: style === "cut" ? 0 : Math.max(prev.transition_sec || 0.35, 0.18),
                    }));
                  }}
                >
                  {TRANSITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <NumberField
                label="전환 시간 sec"
                step="0.01"
                value={settings.transition_sec}
                onChange={(v) => setSettings((prev) => ({ ...prev, transition_sec: Math.max(0, v ?? 0) }))}
              />
            </div>
            <p className="rounded-lg border border-white/5 bg-black/20 px-2 py-2 text-[11px] text-gray-400">{selectedTransition.note}</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              색보정
            </p>
            <select
              className="input-base w-full"
              value={settings.color_preset}
              onChange={(e) => setSettings((prev) => ({ ...prev, color_preset: e.target.value as ColorPreset }))}
            >
              {COLOR_PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <p className="text-[11px] text-gray-500">{selectedColor.note}</p>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="필름 그레인" value={settings.grain_strength} onChange={(v) => setSettings((prev) => ({ ...prev, grain_strength: v ?? 0 }))} />
              <NumberField label="비네트" step="0.1" value={settings.vignette_strength} onChange={(v) => setSettings((prev) => ({ ...prev, vignette_strength: v ?? 0 }))} />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Captions className="w-3.5 h-3.5" />
              자막
            </p>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="글자 크기" value={settings.subtitle_style.font_size} onChange={(v) => setSettings((prev) => ({ ...prev, subtitle_style: { ...prev.subtitle_style, font_size: v ?? 34 } }))} />
              <NumberField label="아래 여백" value={settings.subtitle_style.margin_v} onChange={(v) => setSettings((prev) => ({ ...prev, subtitle_style: { ...prev.subtitle_style, margin_v: v ?? 34 } }))} />
              <NumberField label="외곽선" step="0.1" value={settings.subtitle_style.outline} onChange={(v) => setSettings((prev) => ({ ...prev, subtitle_style: { ...prev.subtitle_style, outline: v ?? 2.4 } }))} />
              <NumberField label="그림자" step="0.1" value={settings.subtitle_style.shadow} onChange={(v) => setSettings((prev) => ({ ...prev, subtitle_style: { ...prev.subtitle_style, shadow: v ?? 0 } }))} />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5" />
              출력/오디오
            </p>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="fps" value={settings.fps} onChange={(v) => setSettings((prev) => ({ ...prev, fps: v ?? 30 }))} />
              <NumberField label="sample rate" value={settings.audio_sample_rate} onChange={(v) => setSettings((prev) => ({ ...prev, audio_sample_rate: v ?? 48000 }))} />
              <NumberField label="목표 LUFS" step="0.1" value={settings.target_lufs} onChange={(v) => setSettings((prev) => ({ ...prev, target_lufs: v }))} />
              <NumberField label="LRA" step="0.1" value={settings.loudness_range_lu} onChange={(v) => setSettings((prev) => ({ ...prev, loudness_range_lu: v }))} />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              화면 오버레이
            </p>
            <div className="grid grid-cols-2 gap-2">
              <select className="input-base w-full" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as OverlayKind })}>
                <option value="caption">추가 자막</option>
                <option value="title">상단 타이틀</option>
                <option value="sticker">우상단 효과 텍스트</option>
              </select>
              <select className="input-base w-full" value={draft.sceneIndex} onChange={(e) => setDraft({ ...draft, sceneIndex: Number(e.target.value) })}>
                {scenes.map((_, i) => <option key={i} value={i}>scene #{i + 1}</option>)}
              </select>
              <NumberField label="씬 시작 후 sec" step="0.1" value={draft.start} onChange={(v) => setDraft({ ...draft, start: Math.max(0, v ?? 0) })} />
              <NumberField label="표시 시간 sec" step="0.1" value={draft.duration} onChange={(v) => setDraft({ ...draft, duration: Math.max(0.25, v ?? 3) })} />
            </div>
            <textarea
              className="input-base w-full h-16 resize-none"
              placeholder="렌더 결과 화면에 실제로 들어갈 타이틀, 추가 자막, 효과 텍스트..."
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
            <button type="button" className="w-full rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium py-2 disabled:opacity-40" disabled={!draft.text.trim()} onClick={addOverlay}>
              오버레이 추가
            </button>
            <div className="space-y-1">
              {overlays.map((o, i) => (
                <div key={`${o.kind}-${i}`} className="rounded-lg border border-white/5 bg-black/20 px-2 py-1 text-xs flex items-center gap-2">
                  <span className="text-accent">{o.kind}</span>
                  <span className="text-gray-500">S{o.sceneIndex + 1} +{o.start}s/{o.duration}s</span>
                  <span className="flex-1 truncate">{o.text}</span>
                  <button className="text-gray-500 hover:text-red-300" onClick={() => setOverlays((prev) => prev.filter((_, idx) => idx !== i))}>
                    remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
          <p className="text-xs font-semibold text-accent uppercase tracking-wider flex items-center gap-1.5 mb-2">
            <Wand2 className="w-3.5 h-3.5" />
            최종 편집 렌더
          </p>
          {blockedScenes.length > 0 ? (
            <p className="text-xs text-yellow-300">
              아직 생성되지 않았거나 stale 상태인 씬이 {blockedScenes.length}개 있습니다. 모든 씬 비디오가 준비되어야 최종 편집본을 만들 수 있습니다.
            </p>
          ) : (
            <p className="text-xs text-gray-300">
              준비된 씬 클립을 현재 편집 설정으로 다시 합성합니다. 결과는 프로젝트 output_path로 저장됩니다.
            </p>
          )}
          <button
            type="button"
            disabled={blockedScenes.length > 0 || renderMutation.isPending}
            onClick={() => renderMutation.mutate()}
            className="mt-3 w-full rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold py-3 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4" />
            {renderMutation.isPending ? "편집본 렌더 중..." : "최종 편집본 렌더"}
          </button>
          {renderMutation.error && <p className="mt-2 text-xs text-red-300">{renderMutation.error.message}</p>}
          {renderMutation.data?.output_path && (
            <a className="mt-2 block text-xs text-accent hover:underline" href={`/${renderMutation.data.output_path}`} target="_blank" rel="noreferrer">
              렌더 결과 열기
            </a>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
            <Music className="w-3.5 h-3.5" />
            Render Handoff JSON
          </p>
          <pre className="max-h-72 overflow-auto rounded-lg bg-black/30 border border-white/5 p-2 text-[10px] text-gray-300">
            {JSON.stringify(compositionJson, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
