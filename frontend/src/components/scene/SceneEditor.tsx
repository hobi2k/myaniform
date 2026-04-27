import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GripVertical, Image as ImageIcon, Mic, Network, Plus, Settings2, Trash2, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import {
  DEFAULT_AUDIO_PRECISION,
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_IMAGE_SAMPLER,
  DEFAULT_IMAGE_SCHEDULER,
  DEFAULT_MMAUDIO_MODEL,
  DEFAULT_PIX_FMT,
  DEFAULT_VIDEO_FORMAT,
  DEFAULT_VIDEO_PARAMS,
  DEFAULT_VIDEO_SAMPLER,
  DEFAULT_VIDEO_SCHEDULER,
  IMAGE_SCHEDULER_OPTIONS,
  MMAUDIO_MODELS,
  PIX_FMT_OPTIONS,
  PRECISION_OPTIONS,
  SAMPLER_OPTIONS,
  VIDEO_FORMAT_OPTIONS,
  VIDEO_SCHEDULER_OPTIONS,
} from "../../constants/modelCatalog";
import type { Character, FrameSourceMode, ImageParams, LoraSelection, Scene, SceneType, VideoParams } from "../../types";
import { DiffusionModelPicker, ImageModelPicker } from "../model/ModelPickers";
import Button from "../ui/Button";

function parseJson<T>(s: string | null | undefined, defaultValue: T): T {
  if (!s) return defaultValue;
  try {
    return { ...defaultValue, ...JSON.parse(s) };
  } catch {
    return defaultValue;
  }
}

function parseCharIds(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

interface Props {
  projectId: string;
}

const SCENE_TYPE_LABEL: Record<SceneType, string> = {
  lipsync: "💬 립싱크",
  basic:   "🎬 기본",
  loop:    "🔄 루프",
  effect:  "✨ 이펙트",
};

const SCENE_TYPE_COLOR: Record<SceneType, string> = {
  lipsync: "text-lipsync",
  basic:   "text-cyan-300",
  loop:    "text-loop",
  effect:  "text-effect",
};

const SCENE_TYPE_ICON: Record<SceneType, string> = {
  lipsync: "💬",
  basic: "🎬",
  loop: "🔄",
  effect: "✨",
};

function sceneReadiness(s: Scene) {
  const needsVoice = !!s.dialogue;
  return {
    voice: needsVoice ? !!s.voice_path : true,
    image: !!s.image_path,
    video: !!s.clip_path && !s.clip_stale,
  };
}

function assetUrl(path: string | null | undefined, version: number, prefix = "/") {
  if (!path) return "";
  return `${prefix}${path}?v=${version}`;
}

export default function SceneEditor({ projectId }: Props) {
  const qc = useQueryClient();

  const { data: scenes = [] } = useQuery({
    queryKey: ["scenes", projectId],
    queryFn: () => api.scenes.list(projectId),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", projectId],
    queryFn: () => api.characters.list(projectId),
  });

  const [selected, setSelected] = useState<Scene | null>(null);

  const createMutation = useMutation({
    mutationFn: (type: SceneType) =>
      api.scenes.create(projectId, {
        type,
        order: scenes.length,
        bg_prompt: "",
        sfx_prompt: "",
        frame_source_mode: "new_scene",
      }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      setSelected(s);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.scenes.delete(projectId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      setSelected(null);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => api.scenes.reorder(projectId, order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes", projectId] }),
  });

  // Drag-to-reorder
  const dragIdx = useRef<number | null>(null);

  const handleDragStart = (idx: number) => {
    dragIdx.current = idx;
  };

  const handleDrop = (targetIdx: number) => {
    if (dragIdx.current === null || dragIdx.current === targetIdx) return;
    const sorted = [...scenes];
    const [item] = sorted.splice(dragIdx.current, 1);
    sorted.splice(targetIdx, 0, item);
    reorderMutation.mutate(sorted.map((s) => s.id));
    dragIdx.current = null;
  };

  return (
    <div className="flex gap-4 h-full">
      {/* 씬 목록 */}
      <div className="w-56 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">씬 ({scenes.length})</span>
          <div className="flex gap-0.5">
            {(["lipsync", "basic", "loop", "effect"] as SceneType[]).map((t) => (
              <button
                key={t}
                title={`${SCENE_TYPE_LABEL[t]} 추가`}
                onClick={() => createMutation.mutate(t)}
                className="w-7 h-7 rounded-lg hover:bg-white/10 text-sm transition-colors flex items-center justify-center"
              >
                {SCENE_TYPE_ICON[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          {scenes.map((s, idx) => {
            const rd = sceneReadiness(s);
            const done = rd.voice && rd.image && rd.video;
            return (
              <div
                key={s.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(idx)}
                onClick={() => setSelected(s)}
                className={`w-full text-left px-2 py-2 rounded-lg text-xs transition-all group flex items-center gap-1.5 cursor-pointer border ${
                  selected?.id === s.id
                    ? "bg-accent-muted border-accent/40 text-white"
                    : "border-transparent hover:bg-white/5 hover:border-white/10 text-gray-300"
                }`}
              >
                <GripVertical className="w-3 h-3 opacity-20 cursor-grab flex-shrink-0" />
                <span className={`text-base leading-none ${SCENE_TYPE_COLOR[s.type]}`}>
                  {SCENE_TYPE_ICON[s.type]}
                </span>
                <span className="flex-1 truncate">
                  <span className="text-gray-500">#{idx + 1}</span>{" "}
                  {s.bg_prompt?.slice(0, 16) || <span className="text-gray-600">(미설정)</span>}
                </span>
                {done ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                ) : s.clip_stale ? (
                  <span className="text-[9px] text-yellow-400 flex-shrink-0">stale</span>
                ) : null}
              </div>
            );
          })}

          {scenes.length === 0 && (
            <div className="text-xs text-gray-600 px-2 py-6 text-center border border-dashed border-white/10 rounded-lg">
              오른쪽 위 아이콘으로<br />씬을 추가하세요
            </div>
          )}
        </div>
      </div>

      {/* 씬 상세 편집 */}
      <div className="flex-1 min-w-0">
        {selected ? (
          <SceneForm
            key={selected.id}
            scene={selected}
            projectId={projectId}
            characters={characters}
            sceneIndex={scenes.findIndex((s) => s.id === selected.id)}
            onUpdated={(s) => {
              setSelected(s);
              qc.invalidateQueries({ queryKey: ["scenes", projectId] });
            }}
            onDelete={() => deleteMutation.mutate(selected.id)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            씬을 선택하거나 위 아이콘으로 추가하세요.
          </div>
        )}
      </div>
    </div>
  );
}


function SceneForm({
  scene,
  projectId,
  characters,
  sceneIndex,
  onUpdated,
  onDelete,
}: {
  scene: Scene;
  projectId: string;
  characters: Character[];
  sceneIndex: number;
  onUpdated: (s: Scene) => void;
  onDelete: () => void;
}) {
  const [assetVersion, setAssetVersion] = useState(() => Date.now());
  const [form, setForm] = useState<Partial<Scene>>({
    type: scene.type,
    bg_prompt: scene.bg_prompt ?? "",
    sfx_prompt: scene.sfx_prompt ?? "",
    dialogue: scene.dialogue ?? "",
    effect_prompt: scene.effect_prompt ?? "",
    character_id: scene.character_id ?? "",
    character_b_id: scene.character_b_id ?? "",
    character_ids_json: scene.character_ids_json ?? "",
    image_workflow: scene.image_workflow ?? "qwen_edit",
    resolution_w: scene.resolution_w,
    resolution_h: scene.resolution_h,
    image_params: scene.image_params ?? "",
    frame_source_mode: scene.frame_source_mode ?? "new_scene",
    video_params: scene.video_params ?? "",
    tts_engine: scene.tts_engine,
    diffusion_model: scene.diffusion_model ?? "",
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const charIds = parseCharIds(form.character_ids_json);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Scene>) => api.scenes.update(projectId, scene.id, data),
    onSuccess: onUpdated,
  });

  const set = (key: keyof Scene, val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const sceneDraft = () => ({
      ...form,
      image_workflow: form.image_workflow || "qwen_edit",
      image_params: JSON.stringify(parseJson<ImageParams>(form.image_params, DEFAULT_IMAGE_PARAMS)),
      frame_source_mode: sceneIndex <= 0 ? "new_scene" : form.frame_source_mode ?? "new_scene",
      video_params: JSON.stringify(parseJson<VideoParams>(form.video_params, DEFAULT_VIDEO_PARAMS)),
    });

  const save = () => updateMutation.mutate(sceneDraft());

  const saveBeforeStageRun = async () => {
    const updated = await api.scenes.update(projectId, scene.id, sceneDraft());
    onUpdated(updated);
  };
  useEffect(() => {
    setAssetVersion(Date.now());
  }, [scene]);

  const rd = sceneReadiness(scene);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xl ${SCENE_TYPE_COLOR[scene.type]}`}>
            {SCENE_TYPE_ICON[scene.type]}
          </span>
          <h3 className="font-semibold truncate">{SCENE_TYPE_LABEL[scene.type]}</h3>
          <div className="flex items-center gap-1.5">
            {!!scene.dialogue && <MiniBadge ok={rd.voice} icon={<Mic className="w-3 h-3" />} label="음성" />}
            <MiniBadge ok={rd.image} icon={<ImageIcon className="w-3 h-3" />} label="이미지" />
            <MiniBadge ok={rd.video} icon={<Video className="w-3 h-3" />} label="영상" stale={!!scene.clip_path && scene.clip_stale} />
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Link
            to={`/workflows?type=${scene.type}`}
            target="_blank"
            rel="noreferrer"
            title="이 씬 타입의 ComfyUI 워크플로우 보기"
            className="p-1.5 hover:text-accent transition-colors"
          >
            <Network className="w-4 h-4" />
          </Link>
          <button onClick={onDelete} className="p-1.5 hover:text-red-400 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 캐릭터 멀티선택 (Phase 2: N명 지원) */}
      <CharacterMultiPicker
        available={characters}
        selected={charIds}
        onChange={(ids) => {
          setForm((f) => ({
            ...f,
            character_ids_json: JSON.stringify(ids),
            // 하위 호환: A/B 슬롯도 동기화
            character_id: ids[0] ?? "",
            character_b_id: ids[1] ?? "",
          }));
        }}
      />

      {/* 장면샷 프롬프트 (스프라이트 기반) */}
      <div className="rounded-xl border border-accent/15 bg-accent/5 p-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <label className="text-xs text-accent mb-1 block font-semibold">장면샷 프롬프트</label>
            <p className="text-[11px] text-gray-500">
              선택한 캐릭터의 스프라이트를 레퍼런스로 사용해 영상용 첫 프레임/장면 이미지를 생성합니다. 이미지는 여기서 업로드하지 않습니다.
            </p>
          </div>
          <span className="text-[10px] text-gray-500 whitespace-nowrap">Qwen Image Edit</span>
        </div>
        <textarea
          className="input-base w-full resize-none h-16"
          placeholder="sakura park bench, spring evening, warm lighting, anime style..."
          value={form.bg_prompt ?? ""}
          onChange={(e) => set("bg_prompt", e.target.value)}
        />
      </div>

      <div className="rounded-lg border border-white/5 bg-black/10 p-3">
        <label className="text-xs text-gray-400 mb-1 block">씬 시작 프레임</label>
        <select
          className="input-base w-full"
          value={(sceneIndex <= 0 ? "new_scene" : form.frame_source_mode ?? "new_scene") as FrameSourceMode}
          onChange={(e) => set("frame_source_mode", e.target.value)}
          disabled={sceneIndex <= 0}
        >
          <option value="new_scene">새 장면 이미지 생성/사용</option>
          <option value="previous_last_frame">이전 씬 라스트프레임에서 이어 시작</option>
        </select>
        <p className="mt-1 text-[11px] text-gray-500">
          {sceneIndex <= 0
            ? "첫 씬은 기준이 되는 이전 영상이 없어서 새 장면 이미지로 시작합니다."
            : "이전 라스트프레임을 선택하면 이미지 재생성 시 이전 씬 영상의 마지막 프레임을 뽑아 현재 씬 시작 이미지로 씁니다."}
        </p>
      </div>

      {/* 대사/음성 */}
      <div className="rounded-lg border border-white/5 bg-black/10 p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">TTS 엔진</label>
            <select
              className="input-base w-full"
              value={form.tts_engine ?? "qwen3"}
              onChange={(e) => set("tts_engine", e.target.value)}
            >
              <option value="qwen3">QWEN3 TTS</option>
              <option value="s2pro">Fish S2 Pro</option>
            </select>
          </div>
          <div className="text-[11px] text-gray-500 flex items-end pb-2">
            {scene.type === "lipsync"
              ? "화면 속 발화는 S2V로 입, 시선, 머리, 손, 호흡 연기까지 맞춥니다."
              : "비-S2V 컷의 대사는 voiceover로 MMAudio와 믹스하고 움직임 타이밍에 반영합니다."}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">대사</label>
          <textarea
            className="input-base w-full resize-none h-20"
            placeholder={scene.type === "lipsync" ? "입모양을 맞출 대사" : "선택 사항: 이 컷에 얹을 voiceover 대사"}
            value={form.dialogue ?? ""}
            onChange={(e) => set("dialogue", e.target.value)}
          />
        </div>
      </div>

      {scene.type === "lipsync" && (
        <DiffusionModelPicker
          category="s2v"
          value={form.diffusion_model ?? ""}
          onChange={(v) => set("diffusion_model", v)}
        />
      )}

      {/* 기본 I2V 전용 */}
      {scene.type === "basic" && (
        <>
          <DiffusionModelPicker
            category="i2v"
            value={form.diffusion_model ?? ""}
            onChange={(v) => set("diffusion_model", v)}
          />
          <LoraPicker
            value={parseLoras(form.loras_json ?? "")}
            onChange={(loras) => set("loras_json", JSON.stringify(loras))}
          />
        </>
      )}

      {/* 루프 전용 */}
      {scene.type === "loop" && (
        <>
          <DiffusionModelPicker
            category="i2v"
            value={form.diffusion_model ?? ""}
            onChange={(v) => set("diffusion_model", v)}
          />
          <LoraPicker
            value={parseLoras(form.loras_json ?? "")}
            onChange={(loras) => set("loras_json", JSON.stringify(loras))}
          />
        </>
      )}

      {/* 이펙트 전용 */}
      {scene.type === "effect" && (
        <>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">이펙트 프롬프트</label>
            <textarea
              className="input-base w-full resize-none h-16"
              placeholder="dramatic speed lines, glowing aura, energy particles burst..."
              value={form.effect_prompt ?? ""}
              onChange={(e) => set("effect_prompt", e.target.value)}
            />
          </div>
          <DiffusionModelPicker
            category="i2v"
            value={form.diffusion_model ?? ""}
            onChange={(v) => set("diffusion_model", v)}
          />
          <LoraPicker
            value={parseLoras(form.loras_json ?? "")}
            onChange={(loras) => set("loras_json", JSON.stringify(loras))}
          />
        </>
      )}

      {/* SFX 프롬프트 (공통) */}
      <div>
        <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
          SFX 프롬프트
          <span className="text-gray-600 font-normal">(MMAudio)</span>
        </label>
        <textarea
          className="input-base w-full resize-none h-12"
          placeholder="wind, birds chirping, ambient park sounds..."
          value={form.sfx_prompt ?? ""}
          onChange={(e) => set("sfx_prompt", e.target.value)}
        />
      </div>

      {/* 고급 파라미터 토글 */}
      <div className="border-t border-white/10 pt-3">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-accent transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" />
          고급 파라미터 {showAdvanced ? "▲" : "▼"}
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-3 bg-surface-raised/40 rounded-lg p-3 border border-white/5">
            {/* 장면샷 이미지 워크플로우 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">장면샷 워크플로우</label>
                <select
                  className="input-base w-full"
                  value={form.image_workflow ?? "qwen_edit"}
                  onChange={(e) => set("image_workflow", e.target.value)}
                >
                  <option value="qwen_edit">Qwen Edit + 스프라이트 레퍼런스</option>
                </select>
                <p className="mt-1 text-[10px] text-gray-500">
                  장면 이미지는 스프라이트 일관성 경로만 UI에서 허용합니다.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">너비</label>
                  <input
                    type="number"
                    className="input-base w-full"
                    placeholder="832"
                    value={form.resolution_w ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        resolution_w: e.target.value ? parseInt(e.target.value) : null,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">높이</label>
                  <input
                    type="number"
                    className="input-base w-full"
                    placeholder="1216"
                    value={form.resolution_h ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        resolution_h: e.target.value ? parseInt(e.target.value) : null,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            {/* 장면샷 이미지 파라미터 */}
            <ImageParamsEditor
              workflow={(form.image_workflow as "qwen_edit" | "sdxl" | undefined) ?? "qwen_edit"}
              value={parseJson<ImageParams>(form.image_params, DEFAULT_IMAGE_PARAMS)}
              onChange={(p) => set("image_params", JSON.stringify(p))}
            />

            {/* 비디오 파라미터 (Phase 5) */}
            <VideoParamsEditor
              value={parseJson<VideoParams>(form.video_params, DEFAULT_VIDEO_PARAMS)}
              onChange={(p) => set("video_params", JSON.stringify(p))}
            />
          </div>
        )}
      </div>

      {/* 단계별 재생성 */}
      <StageActions
        scene={scene}
        projectId={projectId}
        onUpdated={onUpdated}
        assetVersion={assetVersion}
        beforeRun={saveBeforeStageRun}
      />

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          loading={updateMutation.isPending}
          onClick={save}
        >
          저장
        </Button>
      </div>
    </div>
  );
}


function CharacterMultiPicker({
  available,
  selected,
  onChange,
}: {
  available: Character[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const remaining = available.filter((c) => !selected.includes(c.id));
  const byId: Record<string, Character> = Object.fromEntries(available.map((c) => [c.id, c]));

  const add = (id: string) => {
    if (!id || selected.includes(id)) return;
    onChange([...selected, id]);
  };
  const remove = (id: string) => onChange(selected.filter((x) => x !== id));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= selected.length) return;
    const arr = [...selected];
    const [it] = arr.splice(from, 1);
    arr.splice(to, 0, it);
    onChange(arr);
  };

  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">
        캐릭터 <span className="text-gray-600">(순서대로 Picture 1, 2, 3… 로 레퍼런스)</span>
      </label>
      <div className="space-y-1">
        {selected.map((id, idx) => {
          const c = byId[id];
          if (!c) return null;
          const hasRef = !!c.sprite_path;
          return (
            <div key={id} className="flex items-center gap-2 text-xs input-base py-1">
              <span className="text-gray-500 font-mono w-14">Picture {idx + 1}</span>
              <span className="flex-1 truncate">{c.name}</span>
              {hasRef ? (
                <span className="text-emerald-400 text-[10px]">ref ✓</span>
              ) : (
                <span className="text-gray-500 text-[10px]">설명만</span>
              )}
              <button onClick={() => move(idx, idx - 1)} className="p-0.5 hover:text-accent" disabled={idx === 0}>
                ↑
              </button>
              <button onClick={() => move(idx, idx + 1)} className="p-0.5 hover:text-accent" disabled={idx === selected.length - 1}>
                ↓
              </button>
              <button onClick={() => remove(id)} className="p-0.5 hover:text-red-400">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        <select
          className="input-base w-full"
          value=""
          onChange={(e) => {
            add(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">+ 캐릭터 추가... ({remaining.length}명 남음)</option>
          {remaining.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.sprite_path ? " (sprite ✓)" : ""}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}


function ImageParamsEditor({
  workflow,
  value,
  onChange,
}: {
  workflow: "qwen_edit" | "sdxl";
  value: ImageParams;
  onChange: (p: ImageParams) => void;
}) {
  const set = (k: keyof ImageParams, v: number | string | boolean | undefined) => {
    const next = { ...value };
    if (v === "" || v === undefined) {
      delete (next as Record<string, unknown>)[k as string];
    } else {
      (next as Record<string, unknown>)[k as string] = v;
    }
    onChange(next);
  };

  return (
    <div className="border-t border-white/5 pt-2">
      <div className="text-[11px] text-gray-400 mb-2 font-semibold">🖼️ 이미지 샘플러</div>
      <ImageModelPicker
        workflow={workflow}
        value={value.model ?? ""}
        onChange={(model) => set("model", model || undefined)}
      />
      <div className="mb-3 rounded-lg border border-white/5 bg-black/10 p-2">
        <div className="text-[10px] text-gray-500 mb-2 font-semibold">사용자 장면 연출 프롬프트</div>
        <p className="text-[10px] text-gray-600 mb-2">
          Qwen Edit은 캐릭터 일관성만 잡고, 의상/포즈/구도/카메라 등은 아래 입력값만 반영합니다. 비워두면 아무것도 강제하지 않습니다.
        </p>
        <label className="mb-2 flex items-start gap-2 rounded-md border border-white/5 bg-black/10 p-2 text-[10px] text-gray-400">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={value.continuity_reference !== false}
            onChange={(e) => set("continuity_reference", e.target.checked ? undefined : false)}
          />
          <span>
            이전 장면 키프레임을 의상/색감/조명 연속성 레퍼런스로 함께 사용합니다.
            장면마다 의상을 완전히 바꿀 때만 끄세요.
          </span>
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <PromptParam
            label="의상 / 소품"
            placeholder="cream cardigan over a floral dress, navy jacket, school uniform, barefoot, or empty..."
            value={value.outfit_prompt ?? value.wardrobe_prompt ?? ""}
            onChange={(v) => {
              set("outfit_prompt", v || undefined);
              if (value.wardrobe_prompt) set("wardrobe_prompt", undefined);
            }}
          />
          <PromptParam
            label="포즈 / 액션"
            placeholder="standing three-quarter view, sitting on bench, holding hands, looking back..."
            value={value.pose_prompt ?? ""}
            onChange={(v) => set("pose_prompt", v || undefined)}
          />
          <PromptParam
            label="구도 / 프레이밍"
            placeholder="full body shot, medium shot, two-shot, close-up, over-the-shoulder..."
            value={value.composition_prompt ?? ""}
            onChange={(v) => set("composition_prompt", v || undefined)}
          />
          <PromptParam
            label="카메라 / 렌즈"
            placeholder="low angle, eye-level, 35mm lens, shallow depth of field..."
            value={value.camera_prompt ?? ""}
            onChange={(v) => set("camera_prompt", v || undefined)}
          />
          <PromptParam
            label="표정 / 감정"
            placeholder="soft smile, embarrassed blush, serious expression, gentle eye contact..."
            value={value.expression_prompt ?? ""}
            onChange={(v) => set("expression_prompt", v || undefined)}
          />
          <PromptParam
            label="조명 / 분위기"
            placeholder="golden hour, soft rim light, rainy neon night, warm indoor lighting..."
            value={value.lighting_prompt ?? ""}
            onChange={(v) => set("lighting_prompt", v || undefined)}
          />
          <div className="md:col-span-2">
            <PromptParam
              label="스타일 추가"
              placeholder="anime key visual, clean lineart, cinematic still, high detail..."
              value={value.style_prompt ?? ""}
              onChange={(v) => set("style_prompt", v || undefined)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
          <div>
            <label className="text-[10px] text-gray-500">의상 관련 네거티브</label>
            <input
              className="input-base w-full"
              placeholder="원할 때만 입력: nude, underwear only, see-through clothing..."
              value={value.clothing_negative_prompt ?? ""}
              onChange={(e) => set("clothing_negative_prompt", e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">이미지 네거티브</label>
            <input
              className="input-base w-full"
              placeholder="watermark, bad anatomy, low quality..."
              value={value.negative_prompt ?? ""}
              onChange={(e) => set("negative_prompt", e.target.value || undefined)}
            />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div>
          <label className="text-[10px] text-gray-500">steps</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="30"
            value={value.steps ?? ""}
            onChange={(e) => set("steps", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">cfg</label>
          <input
            type="number"
            step="0.1"
            className="input-base w-full"
            placeholder="5.0"
            value={value.cfg ?? ""}
            onChange={(e) => set("cfg", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">sampler</label>
          <select
            className="input-base w-full"
            value={value.sampler ?? DEFAULT_IMAGE_SAMPLER}
            onChange={(e) => set("sampler", e.target.value)}
          >
            {SAMPLER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">scheduler</label>
          <select
            className="input-base w-full"
            value={value.scheduler ?? DEFAULT_IMAGE_SCHEDULER}
            onChange={(e) => set("scheduler", e.target.value)}
          >
            {IMAGE_SCHEDULER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-2 text-[11px]">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={value.face_detailer !== false}
            onChange={(e) => set("face_detailer", e.target.checked ? undefined : false)}
          />
          <span>Face Detailer (SDXL)</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={value.hand_detailer !== false}
            onChange={(e) => set("hand_detailer", e.target.checked ? undefined : false)}
          />
          <span>Hand Detailer (SDXL)</span>
        </label>
      </div>
      {workflow === "qwen_edit" && (
        <div className="mt-3 rounded-lg border border-white/5 bg-black/10 p-2">
          <div className="text-[10px] text-gray-500 mb-2 font-semibold">Qwen Image Edit 레퍼런스 브랜치</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <NumberParam label="Lightning LoRA" placeholder="1.0" step="0.05" value={value.qwen_lightning_strength} onChange={(v) => set("qwen_lightning_strength", v)} />
            <NumberParam label="Pose LoRA" placeholder="1.0" step="0.05" value={value.qwen_pose_strength} onChange={(v) => set("qwen_pose_strength", v)} />
            <NumberParam label="Clothes LoRA" placeholder="0.8" step="0.05" value={value.qwen_clothes_strength} onChange={(v) => set("qwen_clothes_strength", v)} />
            <NumberParam label="layers" placeholder="3" value={value.qwen_layers} onChange={(v) => set("qwen_layers", v)} />
            <NumberParam label="start_at_step" placeholder="0" value={value.qwen_start_at_step} onChange={(v) => set("qwen_start_at_step", v)} />
            <NumberParam label="end_at_step" placeholder="10000" value={value.qwen_end_at_step} onChange={(v) => set("qwen_end_at_step", v)} />
          </div>
        </div>
      )}
      <div className="mt-3 rounded-lg border border-white/5 bg-black/10 p-2">
        <div className="text-[10px] text-gray-500 mb-2 font-semibold">Face/Hand Detailer 세부값</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <NumberParam label="detailer_steps" placeholder="10" value={value.detailer_steps} onChange={(v) => set("detailer_steps", v)} />
          <NumberParam label="detailer_cfg" placeholder="4.5" step="0.1" value={value.detailer_cfg} onChange={(v) => set("detailer_cfg", v)} />
          <NumberParam label="detailer_denoise" placeholder="0.25" step="0.05" value={value.detailer_denoise} onChange={(v) => set("detailer_denoise", v)} />
          <NumberParam label="guide_size" placeholder="512" value={value.detailer_guide_size} onChange={(v) => set("detailer_guide_size", v)} />
          <NumberParam label="max_size" placeholder="1536" value={value.detailer_max_size} onChange={(v) => set("detailer_max_size", v)} />
          <NumberParam label="bbox_threshold" placeholder="0.5" step="0.05" value={value.bbox_threshold} onChange={(v) => set("bbox_threshold", v)} />
          <NumberParam label="bbox_dilation" placeholder="10" value={value.bbox_dilation} onChange={(v) => set("bbox_dilation", v)} />
          <NumberParam label="crop_factor" placeholder="3.0" step="0.1" value={value.bbox_crop_factor} onChange={(v) => set("bbox_crop_factor", v)} />
          <NumberParam label="sam_threshold" placeholder="0.7" step="0.01" value={value.sam_threshold} onChange={(v) => set("sam_threshold", v)} />
          <NumberParam label="mask_feather" placeholder="20" value={value.noise_mask_feather} onChange={(v) => set("noise_mask_feather", v)} />
        </div>
      </div>
      <div className="mt-3">
        <LoraPicker
          value={(value.loras as LoraSelection[]) ?? []}
          onChange={(loras) => {
            const next = { ...value };
            if (loras.length) (next as Record<string, unknown>).loras = loras;
            else delete (next as Record<string, unknown>).loras;
            onChange(next);
          }}
        />
      </div>
    </div>
  );
}

function NumberParam({
  label,
  placeholder,
  value,
  step,
  onChange,
}: {
  label: string;
  placeholder: string;
  value?: number;
  step?: string;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <input
        type="number"
        step={step}
        className="input-base w-full"
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      />
    </div>
  );
}

function PromptParam({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <textarea
        className="input-base w-full resize-none h-14"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function VideoParamsEditor({
  value,
  onChange,
}: {
  value: VideoParams;
  onChange: (p: VideoParams) => void;
}) {
  const set = (k: keyof VideoParams, v: number | string | boolean | undefined) => {
    const next = { ...value };
    if (v === "" || v === undefined) {
      delete (next as Record<string, unknown>)[k as string];
    } else {
      (next as Record<string, unknown>)[k as string] = v;
    }
    onChange(next);
  };

  return (
    <div className="border-t border-white/5 pt-2 space-y-3">
      <div>
        <div className="text-[11px] text-gray-400 mb-2 font-semibold">비디오 파라미터</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div>
          <label className="text-[10px] text-gray-500">steps</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="자동"
            value={value.steps ?? ""}
            onChange={(e) => set("steps", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">cfg</label>
          <input
            type="number"
            step="0.1"
            className="input-base w-full"
            placeholder="자동"
            value={value.cfg ?? ""}
            onChange={(e) => set("cfg", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">seed</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="자동"
            value={value.seed ?? ""}
            onChange={(e) => set("seed", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">frames</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="81"
            value={value.frames ?? ""}
            onChange={(e) => set("frames", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">fps</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="16"
            value={value.fps ?? ""}
            onChange={(e) => set("fps", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        <div>
          <label className="text-[10px] text-gray-500">sampler</label>
          <select
            className="input-base w-full"
            value={value.sampler ?? DEFAULT_VIDEO_SAMPLER}
            onChange={(e) => set("sampler", e.target.value)}
          >
            {SAMPLER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">scheduler</label>
          <select
            className="input-base w-full"
            value={value.scheduler ?? DEFAULT_VIDEO_SCHEDULER}
            onChange={(e) => set("scheduler", e.target.value)}
          >
            {VIDEO_SCHEDULER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">shift</label>
          <input
            type="number"
            step="0.1"
            className="input-base w-full"
            placeholder="5"
            value={value.shift ?? ""}
            onChange={(e) => set("shift", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
        <div>
          <label className="text-[10px] text-gray-500">video width</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="832"
            value={value.width ?? ""}
            onChange={(e) => set("width", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">video height</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="480"
            value={value.height ?? ""}
            onChange={(e) => set("height", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">S2V refiner start</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="2"
            value={value.s2v_refiner_start_step ?? ""}
            onChange={(e) => set("s2v_refiner_start_step", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">I2V refiner start</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="3"
            value={value.i2v_refiner_start_step ?? ""}
            onChange={(e) => set("i2v_refiner_start_step", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">audio offset sec</label>
          <input
            type="number"
            step="0.1"
            className="input-base w-full"
            placeholder="0"
            value={value.s2v_audio_offset ?? ""}
            onChange={(e) => set("s2v_audio_offset", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 mt-2">
        <div>
          <label className="text-[10px] text-gray-500">audio crop sec</label>
          <input
            type="number"
            step="0.1"
            className="input-base w-full"
            placeholder="5"
            value={value.s2v_audio_duration ?? ""}
            onChange={(e) => set("s2v_audio_duration", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">audio output sec</label>
          <input
            type="number"
            step="0.1"
            className="input-base w-full"
            placeholder="10"
            value={value.audio_output_duration ?? ""}
            onChange={(e) => set("audio_output_duration", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-cyan-300/10 bg-cyan-950/10 p-2">
        <div className="mb-2">
          <div className="text-[11px] text-cyan-200 font-semibold">동작 / 음성 싱크</div>
          <p className="text-[10px] text-gray-600">
            S2V는 입모양만이 아니라 시선, 머리, 어깨, 손, 호흡까지 음성 박자에 맞춘 연기로 생성합니다. I2V도 보이스오버와 SFX 타이밍에 맞춰 움직임을 줍니다.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">동작 프롬프트</label>
            <textarea
              className="input-base w-full resize-none h-16"
              placeholder="예: 몸을 살짝 돌리고, 손을 문손잡이에서 떼며, 머리카락과 옷자락이 자연스럽게 흔들림"
              value={value.motion_prompt ?? ""}
              onChange={(e) => set("motion_prompt", e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">표정 / 제스처</label>
            <textarea
              className="input-base w-full resize-none h-16"
              placeholder="예: 눈을 피했다가 다시 마주침, 짧은 숨, 어깨 긴장, 손가락 움직임"
              value={value.gesture_prompt ?? ""}
              onChange={(e) => set("gesture_prompt", e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">카메라 움직임</label>
            <textarea
              className="input-base w-full resize-none h-16"
              placeholder="예: slow push-in, subtle handheld sway, rack focus, over-the-shoulder drift"
              value={value.camera_motion_prompt ?? ""}
              onChange={(e) => set("camera_motion_prompt", e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">오디오 싱크 지시</label>
            <textarea
              className="input-base w-full resize-none h-16"
              placeholder="예: 대사의 감정 박자에 맞춰 입, 시선, 고개, 어깨, 손, 호흡이 반응"
              value={value.audio_sync_prompt ?? ""}
              onChange={(e) => set("audio_sync_prompt", e.target.value || undefined)}
            />
          </div>
        </div>
        <div className="mt-2">
          <label className="text-[10px] text-gray-500">motion negative prompt</label>
          <textarea
            className="input-base w-full resize-none h-14"
            placeholder="static body, frozen pose, only lips moving, off-beat gestures..."
            value={value.motion_negative_prompt ?? ""}
            onChange={(e) => set("motion_negative_prompt", e.target.value || undefined)}
          />
        </div>
      </div>
      <div className="mt-2">
        <label className="text-[10px] text-gray-500">video negative prompt</label>
        <textarea
          className="input-base w-full resize-none h-14"
          placeholder="watermark, subtitles, static, blurry..."
          value={value.video_negative_prompt ?? ""}
          onChange={(e) => set("video_negative_prompt", e.target.value || undefined)}
        />
      </div>
      <div className="mt-3 rounded-lg border border-white/5 bg-black/10 p-2">
        <div className="text-[10px] text-gray-500 mb-2 font-semibold">비디오 출력</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">format</label>
            <select
              className="input-base w-full"
              value={value.video_format ?? DEFAULT_VIDEO_FORMAT}
              onChange={(e) => set("video_format", e.target.value)}
            >
              {VIDEO_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">pix_fmt</label>
            <select
              className="input-base w-full"
              value={value.pix_fmt ?? DEFAULT_PIX_FMT}
              onChange={(e) => set("pix_fmt", e.target.value)}
            >
              {PIX_FMT_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <NumberParam label="crf" placeholder="19" value={value.crf} onChange={(v) => set("crf", v)} />
          <NumberParam label="loop_count" placeholder="0" value={value.loop_count} onChange={(v) => set("loop_count", v)} />
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-gray-400">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={value.pingpong === true}
              onChange={(e) => set("pingpong", e.target.checked ? true : undefined)}
            />
            <span>pingpong</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={value.trim_to_audio === true}
              onChange={(e) => set("trim_to_audio", e.target.checked ? true : undefined)}
            />
            <span>trim to audio</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={value.save_output !== false}
              onChange={(e) => set("save_output", e.target.checked ? undefined : false)}
            />
            <span>save output</span>
          </label>
        </div>
      </div>
      </div>

      <div className="rounded-lg border border-white/5 bg-black/10 p-2">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <div className="text-[11px] text-gray-400 font-semibold">MMAudio SFX</div>
            <p className="text-[10px] text-gray-600">
              i2v는 최종 프레임에 SFX를 생성해 비디오 오디오로 붙이고, s2v는 TTS와 SFX를 믹스합니다.
            </p>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <input
              type="checkbox"
              checked={value.mmaudio_enabled !== false}
              onChange={(e) => set("mmaudio_enabled", e.target.checked)}
            />
            사용
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <div>
            <label className="text-[10px] text-gray-500">MMAudio 모델</label>
            <select
              className="input-base w-full"
              value={value.mmaudio_model ?? DEFAULT_MMAUDIO_MODEL}
              onChange={(e) => set("mmaudio_model", e.target.value || undefined)}
            >
              {MMAUDIO_MODELS.map((model) => (
                <option key={model.value} value={model.value}>{model.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">model precision</label>
            <select
              className="input-base w-full"
              value={value.mmaudio_precision ?? DEFAULT_AUDIO_PRECISION}
              onChange={(e) => set("mmaudio_precision", e.target.value)}
            >
              {PRECISION_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">feature precision</label>
            <select
              className="input-base w-full"
              value={value.mmaudio_feature_precision ?? DEFAULT_AUDIO_PRECISION}
              onChange={(e) => set("mmaudio_feature_precision", e.target.value)}
            >
              {PRECISION_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">negative prompt</label>
            <input
              className="input-base w-full"
              placeholder="talking, speech, music..."
              value={value.mmaudio_negative_prompt ?? ""}
              onChange={(e) => set("mmaudio_negative_prompt", e.target.value || undefined)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">sfx duration</label>
            <input
              type="number"
              step="0.1"
              className="input-base w-full"
              placeholder="5.0"
              value={value.mmaudio_duration ?? ""}
              onChange={(e) => set("mmaudio_duration", e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">sfx steps</label>
            <input
              type="number"
              className="input-base w-full"
              placeholder="25"
              value={value.mmaudio_steps ?? ""}
              onChange={(e) => set("mmaudio_steps", e.target.value ? parseInt(e.target.value) : undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">sfx cfg</label>
            <input
              type="number"
              step="0.1"
              className="input-base w-full"
              placeholder="4.5"
              value={value.mmaudio_cfg ?? ""}
              onChange={(e) => set("mmaudio_cfg", e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">sfx seed</label>
            <input
              type="number"
              className="input-base w-full"
              placeholder="자동"
              value={value.mmaudio_seed ?? ""}
              onChange={(e) => set("mmaudio_seed", e.target.value ? parseInt(e.target.value) : undefined)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
          <div>
            <label className="text-[10px] text-gray-500">voice volume</label>
            <input
              type="number"
              step="0.05"
              className="input-base w-full"
              placeholder="1.0"
              value={value.voice_volume ?? ""}
              onChange={(e) => set("voice_volume", e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">sfx volume</label>
            <input
              type="number"
              step="0.05"
              className="input-base w-full"
              placeholder="0.35"
              value={value.sfx_volume ?? ""}
              onChange={(e) => set("sfx_volume", e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">sfx start sec</label>
            <input
              type="number"
              step="0.05"
              className="input-base w-full"
              placeholder="0.0"
              value={value.sfx_start_time ?? ""}
              onChange={(e) => set("sfx_start_time", e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
          <div>
            <label className="text-[10px] text-gray-500">sfx fade in</label>
            <input
              type="number"
              step="0.05"
              className="input-base w-full"
              placeholder="0.1"
              value={value.sfx_fade_in ?? ""}
              onChange={(e) => set("sfx_fade_in", e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">sfx fade out</label>
            <input
              type="number"
              step="0.05"
              className="input-base w-full"
              placeholder="0.2"
              value={value.sfx_fade_out ?? ""}
              onChange={(e) => set("sfx_fade_out", e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-gray-400">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={value.mmaudio_mask_away_clip === true}
              onChange={(e) => set("mmaudio_mask_away_clip", e.target.checked ? true : undefined)}
            />
            <span>mask away CLIP</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={value.mmaudio_force_offload !== false}
              onChange={(e) => set("mmaudio_force_offload", e.target.checked ? undefined : false)}
            />
            <span>force offload</span>
          </label>
        </div>
      </div>
    </div>
  );
}


function MiniBadge({
  ok,
  icon,
  label,
  stale,
}: {
  ok: boolean;
  icon: React.ReactNode;
  label: string;
  stale?: boolean;
}) {
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

function parseLoras(s: string): LoraSelection[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function LoraPicker({
  value,
  onChange,
}: {
  value: LoraSelection[];
  onChange: (v: LoraSelection[]) => void;
}) {
  const { data: available = [] } = useQuery({
    queryKey: ["loras"],
    queryFn: () => api.loras.list(),
    staleTime: 60_000,
  });
  const remaining = available.filter((e) => !value.some((v) => v.name === e.name));
  const [customName, setCustomName] = useState("");

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (value.some((v) => v.name === trimmed)) return;
    onChange([...value, { name: trimmed, strength: 1.0 }]);
  };
  const update = (idx: number, patch: Partial<LoraSelection>) =>
    onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">LoRA 추가 (선택)</label>
      <div className="space-y-1.5">
        {value.map((l, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate input-base py-1">{l.name}</span>
            <input
              type="number"
              step="0.05"
              min="-2"
              max="2"
              value={l.strength}
              onChange={(e) => update(idx, { strength: parseFloat(e.target.value) })}
              className="input-base w-16 py-1"
            />
            <button
              onClick={() => remove(idx)}
              className="p-1 hover:text-red-400 transition-colors"
              title="제거"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <select
          className="input-base w-full"
          value=""
          onChange={(e) => {
            add(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">
            + 목록에서 선택... ({remaining.length}개)
          </option>
          {remaining.map((e) => (
            <option key={e.name} value={e.name}>
              {e.group ? `[${e.group}] ` : ""}
              {e.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <input
            type="text"
            placeholder="직접 입력: my_lora.safetensors"
            className="input-base flex-1 py-1 text-xs"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(customName);
                setCustomName("");
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              add(customName);
              setCustomName("");
            }}
            disabled={!customName.trim()}
            className="px-2 py-1 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs"
            title="추가"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-gray-600">
          목록에 없는 LoRA 는 파일명을 그대로 입력 (ComfyUI/models/loras 기준 경로).
        </p>
      </div>
    </div>
  );
}


function StageActions({
  scene,
  projectId,
  onUpdated,
  assetVersion,
  beforeRun,
}: {
  scene: Scene;
  projectId: string;
  onUpdated: (s: Scene) => void;
  assetVersion: number;
  beforeRun: () => Promise<void>;
}) {
  const voice = useMutation({
    mutationFn: async () => {
      await beforeRun();
      return api.scenes.regenerateVoice(projectId, scene.id);
    },
    onSuccess: onUpdated,
  });
  const image = useMutation({
    mutationFn: async () => {
      await beforeRun();
      return api.scenes.regenerateImage(projectId, scene.id);
    },
    onSuccess: onUpdated,
  });
  const video = useMutation({
    mutationFn: async () => {
      await beforeRun();
      return api.scenes.regenerateVideo(projectId, scene.id);
    },
    onSuccess: onUpdated,
  });

  const showVoice = !!scene.dialogue;

  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          단계별 재생성
        </span>
        {scene.clip_stale && (
          <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded">
            영상 stale
          </span>
        )}
      </div>

      {/* 음성 */}
      {showVoice && (
        <div className="flex items-start gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={voice.isPending}
            onClick={() => voice.mutate()}
          >
            🎤 음성
          </Button>
          <div className="flex-1 min-w-0">
            {scene.voice_path ? (
              <audio
                src={assetUrl(scene.voice_path, assetVersion, "/comfy_input/")}
                controls
                className="w-full h-8"
              />
            ) : (
              <span className="text-[11px] text-gray-500">아직 생성되지 않음</span>
            )}
            {voice.isError && (
              <p className="text-[11px] text-red-400 mt-1">{(voice.error as Error).message}</p>
            )}
          </div>
        </div>
      )}

      {/* 이미지 */}
      <div className="flex items-start gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={image.isPending}
          onClick={() => image.mutate()}
        >
          🖼️ 장면샷
        </Button>
        <div className="flex-1 min-w-0">
          {scene.image_path ? (
            <img
              src={assetUrl(scene.image_path, assetVersion, "/comfy_input/")}
              alt="scene keyframe"
              className="max-h-32 rounded-lg border border-white/10"
            />
          ) : (
            <span className="text-[11px] text-gray-500">아직 생성되지 않음</span>
          )}
          <p className="text-[10px] text-gray-500 mt-1">
            캐릭터 스프라이트와 장면샷 프롬프트로 생성합니다.
          </p>
          {image.isError && (
            <p className="text-[11px] text-red-400 mt-1">{(image.error as Error).message}</p>
          )}
        </div>
      </div>

      {/* 영상 */}
      <div className="flex items-start gap-2">
        <Button
          size="sm"
          variant="primary"
          loading={video.isPending}
          onClick={() => video.mutate()}
        >
          🎬 영상
        </Button>
        <div className="flex-1 min-w-0">
          {scene.clip_path ? (
            <video
              src={assetUrl(scene.clip_path, assetVersion)}
              controls
              className="w-full rounded-lg max-h-40 bg-black"
            />
          ) : (
            <span className="text-[11px] text-gray-500">아직 생성되지 않음</span>
          )}
          {video.isError && (
            <p className="text-[11px] text-red-400 mt-1">{(video.error as Error).message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
