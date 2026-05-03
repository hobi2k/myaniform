import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Captions, Gauge, Music, Palette, Play, RefreshCw, SlidersHorizontal, Trash2, Type, Upload, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { buildComposition } from "../../composer/buildComposition";
import Composer from "../../composer/Composer";
import OverlayInspector from "../../composer/overlay/OverlayInspector";
import SelectedClipInspector from "../../composer/SelectedClipInspector";
import { useGenerationStream } from "../../hooks/useGenerationStream";
import TaskProgress from "../shared/TaskProgress";
import type { ColorPreset, EditOverlay, EditRenderSettings, EditTransitionStyle, Project, Scene } from "../../types";

interface Props {
  projectId: string;
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
  bgm_volume: 0.5,
  bgm_loop: true,
  bgm_fade_in: 1.5,
  bgm_fade_out: 2.5,
};

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
  const bgmInputRef = useRef<HTMLInputElement | null>(null);
  const bgmUploadMutation = useMutation({
    mutationFn: (file: File) => api.projects.uploadBgm(projectId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });
  const bgmDeleteMutation = useMutation({
    mutationFn: () => api.projects.deleteBgm(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const [settings, setSettings] = useState<EditRenderSettings>(DEFAULT_SETTINGS);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  // Throttle trim PATCH so dragging doesn't spam the backend; flushes on
  // pointerup naturally because mutation dedup happens on the next call.
  const lastTrimRef = useRef<{ id: string; t: number } | null>(null);
  const lastOverlaysSyncRef = useRef<{ json: string; t: number } | null>(null);

  // Backend-origin overlays. Parsed from project.overlays_json.
  const overlays = useMemo<EditOverlay[]>(() => parseOverlays(project?.overlays_json), [project?.overlays_json]);

  // Cache-bust version: bumped whenever the scenes array reference changes
  // (React Query gives us a new array on each invalidate, so any scene
  // regeneration or image upload triggers a bump). Composer URLs append
  // `?v=<version>` so video/audio elements re-fetch the regen'd file even
  // though the path is stable.
  const [assetVersion, setAssetVersion] = useState(0);
  useEffect(() => {
    setAssetVersion((v) => v + 1);
  }, [scenes]);

  const composition = useMemo(
    () => buildComposition(scenes, settings, overlays, assetVersion),
    [scenes, settings, overlays, assetVersion],
  );

  const selectedClip = useMemo(
    () => composition.clips.find((c) => c.id === selectedClipId) ?? null,
    [composition.clips, selectedClipId],
  );
  const selectedOverlay = useMemo(
    () => overlays.find((o) => o.id === selectedOverlayId) ?? null,
    [overlays, selectedOverlayId],
  );

  const renderStream = useGenerationStream<{ output_path: string }>();
  const renderResult = useRef<{ output_path: string } | null>(null);

  const startRender = () => {
    renderResult.current = null;
    renderStream.run({
      kind: "render",
      label: "최종 편집본 렌더",
      url: `/api/projects/${projectId}/generate/render_edit/stream`,
      body: { ...settings, overlays },
      payloadField: "output_path",
      onComplete: (output_path) => {
        // Backend uses {"type":"complete","output_path":"..."} so the helper
        // resolves output_path as the entity payload.
        renderResult.current = { output_path: output_path as unknown as string };
        qc.invalidateQueries({ queryKey: ["project", projectId] });
      },
    });
  };

  // Persist overlays to backend (PUT). Throttled like trim — every 250ms while
  // dragging, plus a final sync on pointerup naturally caught by setTimeout.
  const overlaysUpdateMutation = useMutation({
    mutationFn: (next: EditOverlay[]) => api.projects.updateOverlays(projectId, next),
    onError: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const handleOverlaysChange = (next: EditOverlay[]) => {
    // Optimistic cache update so Player reflects edits next frame.
    qc.setQueryData<Project>(["project", projectId], (prev) =>
      prev ? { ...prev, overlays_json: JSON.stringify(next) } : prev,
    );
    const json = JSON.stringify(next);
    const now = performance.now();
    if (
      lastOverlaysSyncRef.current &&
      lastOverlaysSyncRef.current.json === json &&
      now - lastOverlaysSyncRef.current.t < 250
    ) {
      return;
    }
    lastOverlaysSyncRef.current = { json, t: now };
    overlaysUpdateMutation.mutate(next);
  };

  // Final flush: when component unmounts (route change) ensure last edit landed.
  useEffect(() => {
    return () => {
      if (lastOverlaysSyncRef.current) {
        // Fire-and-forget — no await on unmount.
        api.projects.updateOverlays(projectId, parseOverlays(lastOverlaysSyncRef.current.json)).catch(() => undefined);
      }
    };
  }, [projectId]);

  const addOverlayManual = (kind: EditOverlay["kind"]) => {
    const id = `ov-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(16)}`;
    const next: EditOverlay = {
      id,
      kind,
      text: kind === "title" ? "타이틀" : kind === "sticker" ? "스티커" : "자막",
      scene_index: 0,
      start: 0,
      duration: 3,
      x: kind === "title" ? 0.5 : kind === "sticker" ? 0.92 : 0.5,
      y: kind === "title" ? 0.07 : kind === "sticker" ? 0.12 : 0.83,
      rotation: 0,
      font_size: kind === "title" ? 38 : kind === "sticker" ? 24 : 22,
      color: "white",
      shadow: "0 2px 6px rgba(0,0,0,0.7)",
      outline: "rgba(0,0,0,0.85)",
      outline_width: 1,
      animation_in: "fade",
      animation_out: "fade",
      animation_duration: 0.4,
    };
    handleOverlaysChange([...overlays, next]);
    setSelectedOverlayId(id);
    setSelectedClipId(null);
  };

  const probeMutation = useMutation({
    mutationFn: () => api.scenes.probeDurations(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes", projectId] }),
  });

  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => api.scenes.reorder(projectId, order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes", projectId] }),
  });

  // Per-scene field PATCH — used by the trim drag (Timeline) and by the
  // SelectedClipInspector. Optimistically updates the cache so the preview
  // reacts instantly without waiting for round-trip.
  const patchScene = (sceneId: string, patch: Partial<Scene>) => {
    qc.setQueryData<Scene[]>(["scenes", projectId], (prev) =>
      prev ? prev.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)) : prev,
    );
    return api.scenes.update(projectId, sceneId, patch).catch((err) => {
      // On failure, refetch from server to recover.
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      throw err;
    });
  };

  const handleTrim = (clipId: string, inSec: number, outSec: number) => {
    // Throttle: at most one PATCH per ~120ms while dragging. The optimistic
    // cache update keeps the preview smooth at every frame.
    qc.setQueryData<Scene[]>(["scenes", projectId], (prev) =>
      prev
        ? prev.map((s) =>
            s.id === clipId
              ? { ...s, clip_in_offset_sec: inSec, clip_out_offset_sec: outSec }
              : s,
          )
        : prev,
    );
    const now = performance.now();
    if (lastTrimRef.current && lastTrimRef.current.id === clipId && now - lastTrimRef.current.t < 120) {
      return;
    }
    lastTrimRef.current = { id: clipId, t: now };
    api.scenes
      .update(projectId, clipId, { clip_in_offset_sec: inSec, clip_out_offset_sec: outSec })
      .catch(() => qc.invalidateQueries({ queryKey: ["scenes", projectId] }));
  };

  const readyScenes = scenes.filter((s) => s.clip_path && !s.clip_stale);
  const blockedScenes = scenes.filter((s) => !s.clip_path || s.clip_stale);
  const scenesMissingDuration = scenes.filter((s) => s.clip_path && !s.clip_duration_sec);

  const selectedTransition = TRANSITIONS.find((item) => item.value === settings.transition_style) ?? TRANSITIONS[0];
  const selectedColor = COLOR_PRESETS.find((item) => item.value === settings.color_preset) ?? COLOR_PRESETS[0];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="rounded-2xl border border-accent/20 bg-[radial-gradient(circle_at_top_left,rgba(242,177,112,0.16),transparent_34%),linear-gradient(135deg,rgba(22,22,28,0.96),rgba(8,8,12,0.98))] p-4 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs text-accent font-semibold uppercase tracking-wider">Edit Studio</p>
            <h2 className="text-xl font-semibold text-white mt-1">씬을 한 영상으로 — 실시간 프리뷰</h2>
            <p className="text-sm text-gray-400 mt-1 max-w-3xl">
              생성된 씬 클립을 자체 NLE 엔진으로 실시간 합성합니다. 트랜지션/색감/자막을 바꾸면 우측 플레이어가 즉시 반영합니다. 최종 mp4 는 ffmpeg 백엔드가 동일 설정으로 렌더합니다.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-gray-500">씬</p>
              <p className="text-white font-semibold">{readyScenes.length}/{scenes.length}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-gray-500">길이</p>
              <p className="text-white font-semibold">~{Math.round(composition.clips.reduce((acc, c) => acc + c.duration_sec, 0))}s</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-gray-500">프레임</p>
              <p className="text-white font-semibold">~{Math.round(composition.clips.reduce((acc, c) => acc + c.duration_sec, 0) * settings.fps)}</p>
            </div>
          </div>
        </div>
      </div>

      {scenesMissingDuration.length > 0 && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-950/20 p-3 flex items-center gap-3">
          <RefreshCw className="w-4 h-4 text-yellow-300 flex-shrink-0" />
          <p className="text-[12px] text-yellow-200 flex-1">
            {scenesMissingDuration.length}개 씬의 클립 길이 메타가 비어있습니다. 백필하면 프리뷰의 시간 배치가 정확해집니다.
          </p>
          <button
            type="button"
            onClick={() => probeMutation.mutate()}
            disabled={probeMutation.isPending}
            className="text-[11px] px-2 py-1 rounded-md bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-100 disabled:opacity-50"
          >
            {probeMutation.isPending ? "백필 중..." : "ffprobe 로 백필"}
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-4">
          <Composer
            composition={composition}
            aspect={16 / 9}
            bgmUrl={project?.bgm_path ? `/${project.bgm_path}` : null}
            selectedClipId={selectedClipId}
            onSelectClip={(id) => {
              setSelectedClipId(id);
              if (id) setSelectedOverlayId(null);
            }}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={(id) => {
              setSelectedOverlayId(id);
              if (id) setSelectedClipId(null);
            }}
            onOverlaysChange={handleOverlaysChange}
            onReorder={(ids) => reorderMutation.mutate(ids)}
            onTrim={handleTrim}
            onTransitionSecChange={(sec) =>
              setSettings((prev) => ({ ...prev, transition_sec: Math.max(0, sec) }))
            }
          />

          {selectedClip && (
            <SelectedClipInspector
              clip={selectedClip}
              onPatch={(patch) => patchScene(selectedClip.id, patch)}
              onClose={() => setSelectedClipId(null)}
            />
          )}

          {selectedOverlay && (
            <OverlayInspector
              overlay={selectedOverlay}
              onChange={(patch) => {
                const next = overlays.map((o) =>
                  o.id === selectedOverlay.id ? { ...o, ...patch } : o,
                );
                handleOverlaysChange(next);
              }}
              onDelete={() => {
                handleOverlaysChange(overlays.filter((o) => o.id !== selectedOverlay.id));
                setSelectedOverlayId(null);
              }}
              onClose={() => setSelectedOverlayId(null)}
            />
          )}

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
                준비된 씬 클립을 현재 편집 설정으로 ffmpeg 렌더합니다. 결과는 프로젝트 output_path 로 저장됩니다.
              </p>
            )}
            <button
              type="button"
              disabled={blockedScenes.length > 0 || renderStream.task.running}
              onClick={startRender}
              className="mt-3 w-full rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold py-3 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              {renderStream.task.running ? "편집본 렌더 중..." : "최종 편집본 렌더"}
            </button>
            {renderStream.task.stage !== "idle" && (
              <div className="mt-3">
                <TaskProgress task={renderStream.task} />
              </div>
            )}
            {renderStream.task.stage === "complete" && renderResult.current && (
              <a
                className="mt-2 block text-xs text-accent hover:underline"
                href={`/${renderResult.current.output_path}`}
                target="_blank"
                rel="noreferrer"
              >
                렌더 결과 열기
              </a>
            )}
          </div>
        </div>

        <div className="space-y-3">
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
              <Music className="w-3.5 h-3.5" />
              BGM (배경음악)
            </p>
            <div className="rounded-lg border border-white/5 bg-black/20 p-2 flex items-center gap-2">
              {project?.bgm_path ? (
                <>
                  <span className="text-[11px] text-emerald-300 truncate flex-1">
                    {project.bgm_path.split("/").pop()}
                  </span>
                  <button
                    type="button"
                    title="BGM 교체"
                    disabled={bgmUploadMutation.isPending}
                    onClick={() => bgmInputRef.current?.click()}
                    className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[10px] text-gray-300 disabled:opacity-50"
                  >
                    <Upload className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title="BGM 제거"
                    disabled={bgmDeleteMutation.isPending}
                    onClick={() => bgmDeleteMutation.mutate()}
                    className="px-2 py-1 rounded-md bg-white/5 hover:bg-red-500/20 hover:text-red-300 text-[10px] text-gray-300 disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[11px] text-gray-500 flex-1">BGM 없음</span>
                  <button
                    type="button"
                    disabled={bgmUploadMutation.isPending}
                    onClick={() => bgmInputRef.current?.click()}
                    className="px-2 py-1 rounded-md bg-accent/30 hover:bg-accent/50 text-[10px] text-white disabled:opacity-50 flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" /> {bgmUploadMutation.isPending ? "업로드 중..." : "업로드"}
                  </button>
                </>
              )}
              <input
                ref={bgmInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) bgmUploadMutation.mutate(f);
                  e.target.value = "";
                }}
              />
            </div>
            {bgmUploadMutation.error && (
              <p className="text-[11px] text-red-300">{(bgmUploadMutation.error as Error).message}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="볼륨 (0..2)"
                step="0.05"
                value={settings.bgm_volume}
                onChange={(v) => setSettings((prev) => ({ ...prev, bgm_volume: v ?? 0.5 }))}
              />
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-5">
                <input
                  type="checkbox"
                  checked={settings.bgm_loop !== false}
                  onChange={(e) => setSettings((prev) => ({ ...prev, bgm_loop: e.target.checked }))}
                />
                루프 (BGM 짧으면 반복)
              </label>
              <NumberField
                label="페이드 인 sec"
                step="0.1"
                value={settings.bgm_fade_in}
                onChange={(v) => setSettings((prev) => ({ ...prev, bgm_fade_in: v ?? 0 }))}
              />
              <NumberField
                label="페이드 아웃 sec"
                step="0.1"
                value={settings.bgm_fade_out}
                onChange={(v) => setSettings((prev) => ({ ...prev, bgm_fade_out: v ?? 0 }))}
              />
            </div>
            <p className="text-[10px] text-gray-500">
              프리뷰는 BGM 트랙 (TrackStack) 의 mute/solo/볼륨이 추가로 적용됩니다.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5" />
              오버레이 ({overlays.length})
            </p>
            <p className="text-[11px] text-gray-400">
              플레이어 위 빈 영역을 <span className="text-accent">더블클릭</span>해 그 위치에 새 오버레이를 박을 수 있습니다.
              아래 빠른 추가 버튼으로 정형화 위치 (타이틀/스티커/자막) 도 가능.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => addOverlayManual("title")}
                className="text-[11px] py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-200"
              >
                + 타이틀
              </button>
              <button
                type="button"
                onClick={() => addOverlayManual("caption")}
                className="text-[11px] py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-200"
              >
                + 자막
              </button>
              <button
                type="button"
                onClick={() => addOverlayManual("sticker")}
                className="text-[11px] py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-200"
              >
                + 스티커
              </button>
            </div>
            {overlays.length === 0 ? (
              <p className="text-[11px] text-gray-600 text-center py-4 border border-dashed border-white/10 rounded-lg">
                아직 없음
              </p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {overlays.map((o) => {
                  const isSel = o.id === selectedOverlayId;
                  return (
                    <li
                      key={o.id}
                      onClick={() => {
                        setSelectedOverlayId(o.id ?? null);
                        setSelectedClipId(null);
                      }}
                      className={`rounded-lg border px-2 py-1 text-xs flex items-center gap-2 cursor-pointer ${
                        isSel
                          ? "bg-accent/10 border-accent/40"
                          : "border-white/5 bg-black/20 hover:border-white/15"
                      }`}
                    >
                      <span className="text-accent w-12 truncate">{o.kind}</span>
                      <span className="text-gray-500 w-16 truncate">S{o.scene_index + 1} +{o.start.toFixed(1)}s</span>
                      <span className="flex-1 truncate text-gray-300">{o.text || "(빈 텍스트)"}</span>
                      <button
                        className="text-gray-500 hover:text-red-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOverlaysChange(overlays.filter((x) => x.id !== o.id));
                          if (isSel) setSelectedOverlayId(null);
                        }}
                        title="삭제"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Parse Project.overlays_json into typed EditOverlay[]. Defensive — invalid
 *  JSON or non-array returns empty list. Stamps an id when missing so
 *  selection works on legacy data. */
function parseOverlays(json: string | null | undefined): EditOverlay[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((raw, i): EditOverlay => {
      const ov = raw as EditOverlay;
      return {
        id: ov.id ?? `ov-legacy-${i}`,
        kind: ov.kind ?? "caption",
        text: ov.text ?? "",
        image_url: ov.image_url,
        scene_index: ov.scene_index ?? 0,
        start: ov.start ?? 0,
        duration: ov.duration ?? 3,
        x: ov.x,
        y: ov.y,
        width: ov.width,
        height: ov.height,
        rotation: ov.rotation,
        font_family: ov.font_family,
        font_size: ov.font_size,
        font_weight: ov.font_weight,
        color: ov.color,
        shadow: ov.shadow,
        outline: ov.outline,
        outline_width: ov.outline_width,
        background: ov.background,
        padding: ov.padding,
        animation_in: ov.animation_in,
        animation_out: ov.animation_out,
        animation_duration: ov.animation_duration,
      };
    });
  } catch {
    return [];
  }
}
