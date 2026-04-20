import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GripVertical, Image as ImageIcon, Mic, Network, Plus, Settings2, Trash2, Video, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { Character, DiffusionModelEntry, ImageParams, LoraSelection, Scene, SceneType, VideoParams } from "../../types";
import Button from "../ui/Button";

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return { ...fallback, ...JSON.parse(s) };
  } catch {
    return fallback;
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
  loop:    "🔄 루프",
  effect:  "✨ 이펙트",
};

const SCENE_TYPE_COLOR: Record<SceneType, string> = {
  lipsync: "text-lipsync",
  loop:    "text-loop",
  effect:  "text-effect",
};

function sceneReadiness(s: Scene) {
  const needsVoice = s.type === "lipsync";
  return {
    voice: needsVoice ? !!s.voice_path : true,
    image: !!s.image_path,
    video: !!s.clip_path && !s.clip_stale,
  };
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
            {(["lipsync", "loop", "effect"] as SceneType[]).map((t) => (
              <button
                key={t}
                title={`${SCENE_TYPE_LABEL[t]} 추가`}
                onClick={() => createMutation.mutate(t)}
                className="w-7 h-7 rounded-lg hover:bg-white/10 text-sm transition-colors flex items-center justify-center"
              >
                {t === "lipsync" ? "💬" : t === "loop" ? "🔄" : "✨"}
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
                  {s.type === "lipsync" ? "💬" : s.type === "loop" ? "🔄" : "✨"}
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
  onUpdated,
  onDelete,
}: {
  scene: Scene;
  projectId: string;
  characters: Character[];
  onUpdated: (s: Scene) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState<Partial<Scene>>({
    type: scene.type,
    bg_prompt: scene.bg_prompt ?? "",
    sfx_prompt: scene.sfx_prompt ?? "",
    dialogue: scene.dialogue ?? "",
    effect_prompt: scene.effect_prompt ?? "",
    character_id: scene.character_id ?? "",
    character_b_id: scene.character_b_id ?? "",
    character_ids_json: scene.character_ids_json ?? "",
    image_workflow: scene.image_workflow ?? "",
    resolution_w: scene.resolution_w,
    resolution_h: scene.resolution_h,
    image_params: scene.image_params ?? "",
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

  const save = () => updateMutation.mutate(form);

  const rd = sceneReadiness(scene);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xl ${SCENE_TYPE_COLOR[scene.type]}`}>
            {scene.type === "lipsync" ? "💬" : scene.type === "loop" ? "🔄" : "✨"}
          </span>
          <h3 className="font-semibold truncate">{SCENE_TYPE_LABEL[scene.type]}</h3>
          <div className="flex items-center gap-1.5">
            {scene.type === "lipsync" && <MiniBadge ok={rd.voice} icon={<Mic className="w-3 h-3" />} label="음성" />}
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

      {/* 배경 프롬프트 (공통) */}
      <div>
        <label className="text-xs text-gray-400 mb-1 block">배경 / 장면 프롬프트</label>
        <textarea
          className="input-base w-full resize-none h-16"
          placeholder="sakura park bench, spring evening, warm lighting, anime style..."
          value={form.bg_prompt ?? ""}
          onChange={(e) => set("bg_prompt", e.target.value)}
        />
      </div>

      {/* 립싱크 전용 */}
      {scene.type === "lipsync" && (
        <>
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

          <div>
            <label className="text-xs text-gray-400 mb-1 block">대사</label>
            <textarea
              className="input-base w-full resize-none h-20"
              placeholder="안녕하세요, 오늘 날씨 정말 좋죠?"
              value={form.dialogue ?? ""}
              onChange={(e) => set("dialogue", e.target.value)}
            />
          </div>

          <DiffusionModelPicker
            category="s2v"
            value={form.diffusion_model ?? ""}
            onChange={(v) => set("diffusion_model", v)}
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
            {/* 이미지 워크플로우 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">이미지 워크플로우</label>
                <select
                  className="input-base w-full"
                  value={form.image_workflow ?? ""}
                  onChange={(e) => set("image_workflow", e.target.value)}
                >
                  <option value="">기본 (Qwen Edit, 레퍼런스 있음) / SDXL (없음)</option>
                  <option value="qwen_edit">Qwen Edit (일관성)</option>
                  <option value="sdxl">SDXL 고품질 (FaceDetailer)</option>
                  <option value="vnccs_sheet">VNCCS 캐릭터 시트</option>
                </select>
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

            {/* 이미지 샘플러 파라미터 */}
            <ImageParamsEditor
              value={parseJson<ImageParams>(form.image_params, {})}
              onChange={(p) => set("image_params", JSON.stringify(p))}
            />

            {/* 비디오 파라미터 (Phase 5) */}
            <VideoParamsEditor
              value={parseJson<VideoParams>(form.video_params, {})}
              onChange={(p) => set("video_params", JSON.stringify(p))}
            />
          </div>
        )}
      </div>

      {/* 단계별 재생성 */}
      <StageActions scene={scene} projectId={projectId} onUpdated={onUpdated} />

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
          const hasRef = !!(c.sprite_path || c.sheet_path || c.image_path);
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
              {c.sprite_path ? " (sprite ✓)" : c.image_path ? " ✓" : ""}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}


function ImageParamsEditor({
  value,
  onChange,
}: {
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
      <div className="grid grid-cols-4 gap-2">
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
            value={value.sampler ?? ""}
            onChange={(e) => set("sampler", e.target.value || undefined)}
          >
            <option value="">기본</option>
            <option value="euler">euler</option>
            <option value="euler_ancestral">euler_ancestral</option>
            <option value="dpmpp_2m">dpmpp_2m</option>
            <option value="dpmpp_2m_sde">dpmpp_2m_sde</option>
            <option value="unipc">unipc</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">scheduler</label>
          <select
            className="input-base w-full"
            value={value.scheduler ?? ""}
            onChange={(e) => set("scheduler", e.target.value || undefined)}
          >
            <option value="">기본</option>
            <option value="sgm_uniform">sgm_uniform</option>
            <option value="simple">simple</option>
            <option value="karras">karras</option>
            <option value="normal">normal</option>
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


function VideoParamsEditor({
  value,
  onChange,
}: {
  value: VideoParams;
  onChange: (p: VideoParams) => void;
}) {
  const set = (k: keyof VideoParams, v: number | string | undefined) => {
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
      <div className="text-[11px] text-gray-400 mb-2 font-semibold">🎬 비디오 파라미터</div>
      <div className="grid grid-cols-4 gap-2">
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


function DiffusionModelPicker({
  category,
  value,
  onChange,
}: {
  category: "s2v" | "i2v";
  value: string;
  onChange: (v: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["diffusion-models"],
    queryFn: () => api.diffusionModels.list(),
    staleTime: 60_000,
  });

  const models: DiffusionModelEntry[] = [];
  if (data) {
    if (category === "s2v") {
      models.push(...data.s2v);
    } else {
      models.push(...data.i2v_high, ...data.i2v_low);
    }
  }

  if (models.length === 0) return null;

  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">
        디퓨전 모델 {category === "s2v" ? "(S2V)" : "(I2V)"}
      </label>
      <select
        className="input-base w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">기본값 자동 선택</option>
        {models.map((m) => (
          <option key={m.name} value={m.name}>
            {m.filename} ({m.size_gb} GB)
          </option>
        ))}
      </select>
    </div>
  );
}


function StageActions({
  scene,
  projectId,
  onUpdated,
}: {
  scene: Scene;
  projectId: string;
  onUpdated: (s: Scene) => void;
}) {
  const voice = useMutation({
    mutationFn: () => api.scenes.regenerateVoice(projectId, scene.id),
    onSuccess: onUpdated,
  });
  const image = useMutation({
    mutationFn: () => api.scenes.regenerateImage(projectId, scene.id),
    onSuccess: onUpdated,
  });
  const video = useMutation({
    mutationFn: () => api.scenes.regenerateVideo(projectId, scene.id),
    onSuccess: onUpdated,
  });

  const showVoice = scene.type === "lipsync";

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
                src={`/comfy_input/${scene.voice_path}`}
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
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant="secondary"
            loading={image.isPending}
            onClick={() => image.mutate()}
          >
            🖼️ 생성
          </Button>
          <label className="cursor-pointer">
            <span className="inline-flex items-center justify-center text-xs px-2.5 py-1.5 rounded-lg bg-surface border border-white/10 hover:border-white/20 text-gray-300 transition-colors">
              📁 업로드
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  api.scenes.uploadImage(projectId, scene.id, file).then(onUpdated);
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="flex-1 min-w-0">
          {scene.image_path ? (
            <img
              src={`/comfy_input/${scene.image_path}`}
              alt="scene keyframe"
              className="max-h-32 rounded-lg border border-white/10"
            />
          ) : (
            <span className="text-[11px] text-gray-500">아직 생성되지 않음</span>
          )}
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
              src={`/${scene.clip_path}`}
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
