import {
  DEFAULT_IMAGE_SAMPLER,
  DEFAULT_IMAGE_SCHEDULER,
  IMAGE_SCHEDULER_OPTIONS,
  SAMPLER_OPTIONS,
} from "../../constants/modelCatalog";
import type { ImageParams, ImageWorkflowKind, LoraSelection } from "../../types";
import { ImageModelPicker } from "../model/ModelPickers";
import LoraPicker from "./LoraPicker";
import NumberParam from "./NumberParam";
import PromptParam from "./PromptParam";

interface Props {
  workflow: ImageWorkflowKind;
  value: ImageParams;
  onChange: (p: ImageParams) => void;
  /** 씬용에서만 켜는 장면 연출 프롬프트 블럭 */
  showSceneDirection?: boolean;
}

export default function ImageParamsEditor({ workflow, value, onChange, showSceneDirection = false }: Props) {
  const set = (k: keyof ImageParams, v: number | string | boolean | undefined) => {
    const next: Record<string, unknown> = { ...value };
    if (v === "" || v === undefined) {
      delete next[k as string];
    } else {
      next[k as string] = v;
    }
    onChange(next as ImageParams);
  };

  return (
    <div className="space-y-3">
      <ImageModelPicker
        workflow={workflow}
        value={value.model ?? ""}
        onChange={(model) => set("model", model || undefined)}
      />

      {showSceneDirection && (
        <div className="rounded-lg border border-white/5 bg-black/10 p-2">
          <div className="text-[10px] text-gray-500 mb-2 font-semibold">사용자 장면 연출 프롬프트</div>
          <p className="text-[10px] text-gray-600 mb-2">
            Qwen Edit은 캐릭터 일관성만 잡고, 의상/포즈/구도/카메라 등은 아래 입력값만 반영합니다. 비워두면 강제하지 않습니다.
          </p>
          <label className="mb-2 flex items-start gap-2 rounded-md border border-white/5 bg-black/10 p-2 text-[10px] text-gray-400">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={value.continuity_reference !== false}
              onChange={(e) => set("continuity_reference", e.target.checked ? undefined : false)}
            />
            <span>이전 장면 키프레임을 의상/색감/조명 연속성 레퍼런스로 함께 사용합니다. 의상을 완전히 바꿀 때만 끄세요.</span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <PromptParam
              label="의상 / 소품"
              placeholder="cream cardigan over a floral dress, navy jacket..."
              rows={2}
              value={value.outfit_prompt ?? value.wardrobe_prompt ?? ""}
              onChange={(v) => {
                set("outfit_prompt", v || undefined);
                if (value.wardrobe_prompt) set("wardrobe_prompt", undefined);
              }}
            />
            <PromptParam
              label="포즈 / 액션"
              placeholder="standing three-quarter view, sitting on bench..."
              rows={2}
              value={value.pose_prompt ?? ""}
              onChange={(v) => set("pose_prompt", v || undefined)}
            />
            <PromptParam
              label="구도 / 프레이밍"
              placeholder="full body shot, medium shot, two-shot, close-up..."
              rows={2}
              value={value.composition_prompt ?? ""}
              onChange={(v) => set("composition_prompt", v || undefined)}
            />
            <PromptParam
              label="카메라 / 렌즈"
              placeholder="low angle, eye-level, 35mm lens, shallow DoF..."
              rows={2}
              value={value.camera_prompt ?? ""}
              onChange={(v) => set("camera_prompt", v || undefined)}
            />
            <PromptParam
              label="표정 / 감정"
              placeholder="soft smile, embarrassed blush, gentle eye contact..."
              rows={2}
              value={value.expression_prompt ?? ""}
              onChange={(v) => set("expression_prompt", v || undefined)}
            />
            <PromptParam
              label="조명 / 분위기"
              placeholder="golden hour, soft rim light, rainy neon night..."
              rows={2}
              value={value.lighting_prompt ?? ""}
              onChange={(v) => set("lighting_prompt", v || undefined)}
            />
            <div className="md:col-span-2">
              <PromptParam
                label="스타일 추가"
                placeholder="anime key visual, clean lineart, cinematic still..."
                rows={2}
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
                placeholder="원할 때만: nude, underwear only, see-through..."
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
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <NumberParam label="steps" placeholder="30" value={value.steps} onChange={(v) => set("steps", v)} />
        <NumberParam label="cfg" placeholder="5.0" step="0.1" value={value.cfg} onChange={(v) => set("cfg", v)} />
        <NumberParam label="seed" placeholder="0" value={value.seed} onChange={(v) => set("seed", v)} />
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
        <NumberParam label="denoise" placeholder="1.0" step="0.05" value={value.denoise} onChange={(v) => set("denoise", v)} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11px]">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={value.face_detailer !== false}
            onChange={(e) => set("face_detailer", e.target.checked ? undefined : false)}
          />
          <span>Face Detailer</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={value.hand_detailer !== false}
            onChange={(e) => set("hand_detailer", e.target.checked ? undefined : false)}
          />
          <span>Hand Detailer</span>
        </label>
      </div>

      {workflow === "qwen_edit" && (
        <details className="rounded-lg border border-white/5 bg-black/10 p-2">
          <summary className="text-[10px] text-gray-500 font-semibold cursor-pointer">Qwen Image Edit 레퍼런스 브랜치</summary>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
            <NumberParam label="Lightning LoRA" placeholder="1.0" step="0.05" value={value.qwen_lightning_strength} onChange={(v) => set("qwen_lightning_strength", v)} />
            <NumberParam label="Pose LoRA" placeholder="1.0" step="0.05" value={value.qwen_pose_strength} onChange={(v) => set("qwen_pose_strength", v)} />
            <NumberParam label="Clothes LoRA" placeholder="0.8" step="0.05" value={value.qwen_clothes_strength} onChange={(v) => set("qwen_clothes_strength", v)} />
            <NumberParam label="layers" placeholder="3" value={value.qwen_layers} onChange={(v) => set("qwen_layers", v)} />
            <NumberParam label="start_at_step" placeholder="0" value={value.qwen_start_at_step} onChange={(v) => set("qwen_start_at_step", v)} />
            <NumberParam label="end_at_step" placeholder="10000" value={value.qwen_end_at_step} onChange={(v) => set("qwen_end_at_step", v)} />
          </div>
        </details>
      )}

      <details className="rounded-lg border border-white/5 bg-black/10 p-2">
        <summary className="text-[10px] text-gray-500 font-semibold cursor-pointer">Face/Hand Detailer 세부값</summary>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
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
      </details>

      <LoraPicker
        value={(value.loras as LoraSelection[]) ?? []}
        onChange={(loras) => {
          const next: Record<string, unknown> = { ...value };
          if (loras.length) next.loras = loras;
          else delete next.loras;
          onChange(next as ImageParams);
        }}
      />
    </div>
  );
}
