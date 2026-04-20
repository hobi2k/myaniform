export type GenerationStatus = "idle" | "running" | "completed" | "failed";
export type SceneType = "lipsync" | "loop" | "effect";
export type TTSEngine = "qwen3" | "s2pro";

export interface Project {
  id: string;
  title: string;
  episode: string | null;
  created_at: string;
  status: GenerationStatus;
  output_path: string | null;
}

export interface Character {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  sheet_path: string | null;   // VNCCS 캐릭터 시트 (Phase 4)
  sprite_path: string | null;  // VNCCS 스프라이트 (Phase 4)
  voice_design: string | null;
  voice_sample_path: string | null;
  tts_engine: TTSEngine;
}

export interface LoraSelection {
  name: string;
  strength: number;
}

export type ImageWorkflowKind = "qwen_edit" | "sdxl" | "vnccs_sheet";

export interface ImageParams {
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  denoise?: number;
  loras?: LoraSelection[];
  face_detailer?: boolean;
  hand_detailer?: boolean;
}

export interface VideoParams {
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  shift?: number;
  frames?: number;
  fps?: number;
}

export interface Scene {
  id: string;
  project_id: string;
  order: number;
  type: SceneType;
  bg_prompt: string | null;
  sfx_prompt: string | null;
  // 캐릭터 (Phase 2: N-char)
  character_id: string | null;
  character_b_id: string | null;
  character_ids_json: string | null;   // JSON ["id1","id2",...]
  // 이미지 파라미터 (Phase 3)
  image_workflow: string | null;        // "qwen_edit" | "sdxl" | "vnccs_sheet"
  resolution_w: number | null;
  resolution_h: number | null;
  image_params: string | null;          // JSON ImageParams
  video_params: string | null;          // JSON VideoParams (Phase 5)
  // 기타
  dialogue: string | null;
  tts_engine: TTSEngine;
  effect_prompt: string | null;
  loras_json: string | null;
  diffusion_model: string | null;
  voice_path: string | null;
  image_path: string | null;
  clip_path: string | null;
  clip_stale: boolean;
}

export interface LoraEntry {
  name: string;
  group: string;
}

export interface DiffusionModelEntry {
  name: string;
  filename: string;
  size_gb: number;
}

export interface DiffusionModelList {
  i2v_high: DiffusionModelEntry[];
  i2v_low: DiffusionModelEntry[];
  s2v: DiffusionModelEntry[];
}

export interface GenerationEvent {
  type: "progress" | "scene_done" | "complete" | "error";
  stage?: "voice" | "image" | "video" | "concat";
  scene_index?: number;
  total?: number;
  message: string;
  output_path?: string;
  clip_path?: string;
}
