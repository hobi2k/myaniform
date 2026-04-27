import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../../api";
import type { DiffusionModelEntry, ImageWorkflowKind } from "../../types";

type ModelEntry = DiffusionModelEntry;

function InstalledModelSelect({
  label,
  models,
  value,
  onChange,
}: {
  label: string;
  models: ModelEntry[];
  value: string;
  onChange: (v: string) => void;
}) {
  useEffect(() => {
    if (!value && models.length > 0) {
      onChange(models[0].name);
    }
  }, [models, onChange, value]);

  if (models.length === 0) {
    return (
      <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-300">
        설치된 모델이 없습니다: {label}
      </div>
    );
  }

  return (
    <div className="mb-3">
      <label className="text-xs text-gray-400 mb-1 block">{label}</label>
      <select className="input-base w-full" value={value || models[0].name} onChange={(e) => onChange(e.target.value)}>
        {models.map((model) => (
          <option key={model.name} value={model.name}>
            {model.filename} ({model.size_gb} GB)
          </option>
        ))}
      </select>
    </div>
  );
}

export function ImageModelPicker({
  workflow,
  value,
  onChange,
}: {
  workflow: ImageWorkflowKind;
  value: string;
  onChange: (v: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["image-models"],
    queryFn: () => api.imageModels.list(),
    staleTime: 60_000,
  });

  const models = workflow === "qwen_edit" ? (data?.qwen_edit ?? []) : (data?.checkpoints ?? []);
  const label = workflow === "qwen_edit" ? "이미지 모델 (Qwen Edit UNet)" : "이미지 모델 (Checkpoint)";

  return <InstalledModelSelect label={label} models={models} value={value} onChange={onChange} />;
}

export function DiffusionModelPicker({
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

  const models = category === "s2v" ? (data?.s2v ?? []) : [...(data?.i2v_high ?? []), ...(data?.i2v_low ?? [])];
  const label = category === "s2v" ? "디퓨전 모델 (S2V)" : "디퓨전 모델 (I2V)";

  return <InstalledModelSelect label={label} models={models} value={value} onChange={onChange} />;
}
