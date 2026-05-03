import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Image as ImageIcon, Mic, Network, Settings2, Trash2, Upload, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { DEFAULT_IMAGE_PARAMS, DEFAULT_VIDEO_PARAMS } from "../../constants/modelCatalog";
import { parseCharIds, parseJson, parseLoras } from "../../lib/json";
import type {
  Character,
  FrameSourceMode,
  ImageParams,
  Scene,
  SceneType,
  VideoParams,
} from "../../types";
import { DiffusionModelPicker } from "../model/ModelPickers";
import ImageParamsEditor from "../shared/ImageParamsEditor";
import LoraPicker from "../shared/LoraPicker";
import StepCard, { type StepState } from "../shared/StepCard";
import VideoParamsEditor from "../shared/VideoParamsEditor";
import Button from "../ui/Button";
import CharacterMultiPicker from "./CharacterMultiPicker";

const SCENE_TYPE_LABEL: Record<SceneType, string> = {
  lipsync: "💬 립싱크 (S2V)",
  basic: "🎬 기본 (I2V)",
  loop: "🔄 루프 (I2V)",
  effect: "✨ 이펙트 (I2V)",
};

interface Props {
  projectId: string;
  scene: Scene;
  sceneIndex: number;
  characters: Character[];
  onUpdated: (s: Scene) => void;
  onDelete: () => void;
}

export default function SceneInspector({
  projectId,
  scene,
  sceneIndex,
  characters,
  onUpdated,
  onDelete,
}: Props) {
  const qc = useQueryClient();

  const [form, setForm] = useState<Partial<Scene>>(() => ({
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
    loras_json: scene.loras_json ?? "",
  }));
  const [openStep, setOpenStep] = useState<number | null>(0);
  const charIds = parseCharIds(form.character_ids_json);
  const imageReplaceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm({
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
      loras_json: scene.loras_json ?? "",
    });
  }, [scene.id]);

  const sceneDraft = (): Partial<Scene> => ({
    ...form,
    image_workflow: form.image_workflow || "qwen_edit",
    image_params: JSON.stringify(parseJson<ImageParams>(form.image_params, DEFAULT_IMAGE_PARAMS)),
    frame_source_mode: sceneIndex <= 0 ? "new_scene" : (form.frame_source_mode as FrameSourceMode | undefined) ?? "new_scene",
    video_params: JSON.stringify(parseJson<VideoParams>(form.video_params, DEFAULT_VIDEO_PARAMS)),
  });

  const update = useMutation({
    mutationFn: (data: Partial<Scene>) => api.scenes.update(projectId, scene.id, data),
    onSuccess: onUpdated,
  });

  const persistThenRun = async <T,>(thunk: () => Promise<T>): Promise<T> => {
    const updated = await api.scenes.update(projectId, scene.id, sceneDraft());
    onUpdated(updated);
    return thunk();
  };

  const regenVoice = useMutation({
    mutationFn: () => persistThenRun(() => api.scenes.regenerateVoice(projectId, scene.id)),
    onSuccess: (s) => {
      onUpdated(s);
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
    },
  });
  const regenImage = useMutation({
    mutationFn: () => persistThenRun(() => api.scenes.regenerateImage(projectId, scene.id)),
    onSuccess: (s) => {
      onUpdated(s);
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
    },
  });
  const regenVideo = useMutation({
    mutationFn: () => persistThenRun(() => api.scenes.regenerateVideo(projectId, scene.id)),
    onSuccess: (s) => {
      onUpdated(s);
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
    },
  });

  const uploadImage = useMutation({
    mutationFn: (file: File) => api.scenes.uploadImage(projectId, scene.id, file),
    onSuccess: (s) => {
      onUpdated(s);
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
    },
  });

  const set = <K extends keyof Scene>(key: K, val: Scene[K]) => setForm((f) => ({ ...f, [key]: val }));
  const save = () => update.mutate(sceneDraft());

  const setupState: StepState = charIds.length > 0 && (form.bg_prompt ?? "").trim() ? "ready" : "todo";
  const voiceState: StepState =
    !form.dialogue?.trim()
      ? "blocked"
      : regenVoice.isPending
        ? "running"
        : scene.voice_path
          ? "done"
          : "ready";
  const imageState: StepState = regenImage.isPending
    ? "running"
    : scene.image_path
      ? "done"
      : (form.bg_prompt ?? "").trim() && charIds.length > 0
        ? "ready"
        : "blocked";
  const videoState: StepState = regenVideo.isPending
    ? "running"
    : scene.clip_path && !scene.clip_stale
      ? "done"
      : scene.clip_stale
        ? "stale"
        : scene.image_path
          ? "ready"
          : "blocked";

  const imageParams = parseJson<ImageParams>(form.image_params, DEFAULT_IMAGE_PARAMS);
  const videoParams = parseJson<VideoParams>(form.video_params, DEFAULT_VIDEO_PARAMS);

  return (
    <div className="p-3 space-y-3">
      <header className="px-1 mb-1 flex items-center gap-2">
        <Clapperboard className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-semibold text-white truncate">
          씬 #{sceneIndex + 1} · {SCENE_TYPE_LABEL[scene.type]}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Link
            to={`/workflows?type=${scene.type}`}
            target="_blank"
            rel="noreferrer"
            title="ComfyUI 워크플로우 보기"
            className="p-1.5 hover:text-accent transition-colors"
          >
            <Network className="w-3.5 h-3.5" />
          </Link>
          <button onClick={onDelete} className="p-1.5 hover:text-red-400 transition-colors" title="삭제">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <p className="text-[11px] text-gray-500 px-1">
        흐름: 캐릭터 + 장면 프롬프트 → 음성 → 장면샷 → 영상.
      </p>

      <StepCard
        index={0}
        title="캐릭터 & 장면 프롬프트"
        subtitle={
          charIds.length > 0
            ? `캐릭터 ${charIds.length}명 / ${(form.bg_prompt ?? "").length}자`
            : "캐릭터를 먼저 선택하세요"
        }
        state={setupState}
        open={openStep === 0}
        onToggle={() => setOpenStep(openStep === 0 ? null : 0)}
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={update.isPending}
            onClick={(e) => {
              e.stopPropagation();
              save();
            }}
          >
            저장
          </Button>
        }
      >
        <div className="space-y-3">
          <CharacterMultiPicker
            available={characters}
            selected={charIds}
            onChange={(ids) => {
              setForm((f) => ({
                ...f,
                character_ids_json: JSON.stringify(ids),
                character_id: ids[0] ?? "",
                character_b_id: ids[1] ?? "",
              }));
            }}
          />
          <div className="rounded-lg border border-accent/15 bg-accent/5 p-2">
            <label className="text-[11px] text-accent mb-1 block font-semibold">장면샷 프롬프트</label>
            <p className="text-[10px] text-gray-500 mb-2">
              선택한 캐릭터의 스프라이트를 레퍼런스로 영상용 첫 프레임/장면 이미지를 생성합니다.
            </p>
            <textarea
              className="input-base w-full resize-none h-16"
              placeholder="sakura park bench, spring evening, warm lighting, anime style..."
              value={form.bg_prompt ?? ""}
              onChange={(e) => set("bg_prompt", e.target.value)}
            />
          </div>
          <div className="rounded-lg border border-white/5 bg-black/10 p-2">
            <label className="text-[11px] text-gray-400 mb-1 block">씬 시작 프레임</label>
            <select
              className="input-base w-full"
              value={(sceneIndex <= 0 ? "new_scene" : form.frame_source_mode ?? "new_scene") as FrameSourceMode}
              onChange={(e) => set("frame_source_mode", e.target.value as FrameSourceMode)}
              disabled={sceneIndex <= 0}
            >
              <option value="new_scene">새 장면 이미지 생성/사용</option>
              <option value="previous_last_frame">이전 씬 라스트프레임에서 이어 시작</option>
            </select>
            <p className="mt-1 text-[10px] text-gray-500">
              {sceneIndex <= 0
                ? "첫 씬은 이전 영상이 없어서 새 장면 이미지로 시작합니다."
                : "이전 씬 라스트프레임을 현재 씬 시작 이미지로 사용합니다."}
            </p>
          </div>
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block flex items-center gap-1">
              SFX 프롬프트 <span className="text-gray-600 font-normal">(MMAudio)</span>
            </label>
            <textarea
              className="input-base w-full resize-none h-12"
              placeholder="wind, birds chirping, ambient park sounds..."
              value={form.sfx_prompt ?? ""}
              onChange={(e) => set("sfx_prompt", e.target.value)}
            />
          </div>
        </div>
      </StepCard>

      <StepCard
        index={1}
        title="음성 (대사)"
        subtitle={form.dialogue?.trim() ? `대사 ${(form.dialogue ?? "").length}자` : "대사가 없으면 음성 단계 생략"}
        state={voiceState}
        open={openStep === 1}
        onToggle={() => setOpenStep(openStep === 1 ? null : 1)}
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={regenVoice.isPending}
            disabled={!form.dialogue?.trim()}
            onClick={(e) => {
              e.stopPropagation();
              regenVoice.mutate();
            }}
          >
            <Mic className="w-3 h-3" /> 음성 생성
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">TTS 엔진</label>
              <select
                className="input-base w-full"
                value={form.tts_engine ?? "qwen3"}
                onChange={(e) => set("tts_engine", e.target.value as "qwen3" | "s2pro")}
              >
                <option value="qwen3">QWEN3 TTS</option>
                <option value="s2pro">Fish S2 Pro</option>
              </select>
            </div>
            <div className="text-[11px] text-gray-500 flex items-end pb-2">
              {scene.type === "lipsync"
                ? "S2V로 입/시선/머리/손/호흡까지 음성에 맞춤"
                : "비-S2V는 voiceover로 MMAudio와 믹스"}
            </div>
          </div>
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">대사</label>
            <textarea
              className="input-base w-full resize-none h-20"
              placeholder={scene.type === "lipsync" ? "입모양을 맞출 대사" : "선택 사항: 이 컷에 얹을 voiceover 대사"}
              value={form.dialogue ?? ""}
              onChange={(e) => set("dialogue", e.target.value)}
            />
          </div>
          {regenVoice.isError && (
            <p className="text-[11px] text-red-300">{(regenVoice.error as Error).message}</p>
          )}
        </div>
      </StepCard>

      <StepCard
        index={2}
        title="장면샷"
        subtitle={
          scene.image_path
            ? "생성됨 (영상의 첫 프레임으로 사용)"
            : "캐릭터 스프라이트 + 프롬프트로 생성"
        }
        state={imageState}
        open={openStep === 2}
        onToggle={() => setOpenStep(openStep === 2 ? null : 2)}
        action={
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              title="외부 편집본 업로드 — AI 결과 교체"
              disabled={uploadImage.isPending}
              loading={uploadImage.isPending}
              onClick={(e) => {
                e.stopPropagation();
                imageReplaceRef.current?.click();
              }}
            >
              <Upload className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={regenImage.isPending}
              disabled={!(form.bg_prompt ?? "").trim() || charIds.length === 0}
              onClick={(e) => {
                e.stopPropagation();
                regenImage.mutate();
              }}
            >
              <ImageIcon className="w-3 h-3" /> 장면샷 생성
            </Button>
          </div>
        }
      >
        <input
          ref={imageReplaceRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadImage.mutate(file);
            e.target.value = "";
          }}
        />
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">장면샷 워크플로우</label>
              <select
                className="input-base w-full"
                value={form.image_workflow ?? "qwen_edit"}
                onChange={(e) => set("image_workflow", e.target.value)}
              >
                <option value="qwen_edit">Qwen Edit + 스프라이트 레퍼런스 (캐릭터 일관성)</option>
                <option value="sdxl">SDXL only (캐릭터 락 없음, 배경/무드샷)</option>
              </select>
              <p className="mt-1 text-[10px] text-gray-500">
                {form.image_workflow === "sdxl"
                  ? "순수 SDXL 텍스트→이미지. 캐릭터 스프라이트는 무시되고 프롬프트만 반영됩니다."
                  : "SDXL 본체 + Qwen Edit 레퍼런스 브랜치. 선택 캐릭터의 스프라이트로 얼굴/체형 락."}
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
          <details className="rounded-lg border border-white/5 bg-black/10 p-2">
            <summary className="text-[11px] text-gray-400 font-semibold cursor-pointer flex items-center gap-1.5">
              <Settings2 className="w-3 h-3" /> 이미지 파라미터
            </summary>
            <div className="mt-2">
              <ImageParamsEditor
                workflow={(form.image_workflow as "qwen_edit" | "sdxl" | undefined) ?? "qwen_edit"}
                value={imageParams}
                onChange={(p) => set("image_params", JSON.stringify(p))}
                showSceneDirection
              />
            </div>
          </details>
          {regenImage.isError && (
            <p className="text-[11px] text-red-300">{(regenImage.error as Error).message}</p>
          )}
        </div>
      </StepCard>

      <StepCard
        index={3}
        title="영상"
        subtitle={
          scene.clip_path && !scene.clip_stale
            ? "렌더 완료"
            : scene.clip_stale
              ? "stale: 다시 렌더 필요"
              : scene.image_path
                ? "장면샷 기반으로 영상 생성"
                : "장면샷 먼저 생성"
        }
        state={videoState}
        open={openStep === 3}
        onToggle={() => setOpenStep(openStep === 3 ? null : 3)}
        action={
          <Button
            size="sm"
            variant="primary"
            loading={regenVideo.isPending}
            disabled={!scene.image_path}
            onClick={(e) => {
              e.stopPropagation();
              regenVideo.mutate();
            }}
          >
            <Video className="w-3 h-3" /> 영상 생성
          </Button>
        }
      >
        <div className="space-y-3">
          {scene.type === "lipsync" && (
            <DiffusionModelPicker
              category="s2v"
              value={form.diffusion_model ?? ""}
              onChange={(v) => set("diffusion_model", v)}
            />
          )}
          {scene.type !== "lipsync" && (
            <>
              <DiffusionModelPicker
                category="i2v"
                value={form.diffusion_model ?? ""}
                onChange={(v) => set("diffusion_model", v)}
              />
              {scene.type === "effect" && (
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">이펙트 프롬프트</label>
                  <textarea
                    className="input-base w-full resize-none h-14"
                    placeholder="dramatic speed lines, glowing aura..."
                    value={form.effect_prompt ?? ""}
                    onChange={(e) => set("effect_prompt", e.target.value)}
                  />
                </div>
              )}
              <LoraPicker
                value={parseLoras(form.loras_json ?? "")}
                onChange={(loras) => set("loras_json", JSON.stringify(loras))}
              />
            </>
          )}
          <details className="rounded-lg border border-white/5 bg-black/10 p-2">
            <summary className="text-[11px] text-gray-400 font-semibold cursor-pointer flex items-center gap-1.5">
              <Settings2 className="w-3 h-3" /> 비디오 파라미터
            </summary>
            <div className="mt-2">
              <VideoParamsEditor
                value={videoParams}
                onChange={(p) => set("video_params", JSON.stringify(p))}
              />
            </div>
          </details>
          {regenVideo.isError && (
            <p className="text-[11px] text-red-300">{(regenVideo.error as Error).message}</p>
          )}
        </div>
      </StepCard>
    </div>
  );
}
