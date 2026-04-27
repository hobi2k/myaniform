export type GenerationStatus = "idle" | "running" | "completed" | "failed";
export type SceneType = "lipsync" | "basic" | "loop" | "effect";
export type TTSEngine = "qwen3" | "s2pro";
export type FrameSourceMode = "new_scene" | "previous_last_frame";

export interface VoiceGenParams {
  top_k?: number;
  top_p?: number;
  temperature?: number;
  repetition_penalty?: number;
  max_new_tokens?: number;
  seed?: number;
}

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
  background_color: string | null;
  aesthetics: string | null;
  nsfw: boolean | null;
  sex: string | null;
  age: number | null;
  race: string | null;
  eyes: string | null;
  hair: string | null;
  face: string | null;
  body: string | null;
  skin_color: string | null;
  lora_prompt: string | null;
  negative_prompt: string | null;
  resolution_w: number | null;
  resolution_h: number | null;
  image_params: string | null;
  sprite_params: string | null;
  image_path: string | null;
  sprite_path: string | null;  // VNCCS 스프라이트 (Phase 4)
  voice_design: string | null;
  voice_sample_path: string | null;
  voice_sample_text: string | null;
  voice_language: string | null;
  voice_params: string | null;
  tts_engine: TTSEngine;
}

export interface LoraSelection {
  name: string;
  strength: number;
}

export type ImageWorkflowKind = "qwen_edit" | "sdxl";

export interface ImageParams {
  model?: string;
  wardrobe_prompt?: string;
  outfit_prompt?: string;
  pose_prompt?: string;
  composition_prompt?: string;
  camera_prompt?: string;
  expression_prompt?: string;
  lighting_prompt?: string;
  style_prompt?: string;
  continuity_reference?: boolean;
  clothing_negative_prompt?: string;
  negative_prompt?: string;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  denoise?: number;
  loras?: LoraSelection[];
  face_detailer?: boolean;
  hand_detailer?: boolean;
  detailer_steps?: number;
  detailer_cfg?: number;
  detailer_denoise?: number;
  detailer_guide_size?: number;
  detailer_max_size?: number;
  bbox_threshold?: number;
  bbox_dilation?: number;
  bbox_crop_factor?: number;
  sam_threshold?: number;
  noise_mask_feather?: number;
  qwen_lightning_strength?: number;
  qwen_pose_strength?: number;
  qwen_clothes_strength?: number;
  qwen_layers?: number;
  qwen_start_at_step?: number;
  qwen_end_at_step?: number;
}

export interface VideoParams {
  steps?: number;
  cfg?: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  shift?: number;
  frames?: number;
  fps?: number;
  width?: number;
  height?: number;
  motion_prompt?: string;
  gesture_prompt?: string;
  camera_motion_prompt?: string;
  audio_sync_prompt?: string;
  motion_negative_prompt?: string;
  video_negative_prompt?: string;
  i2v_refiner_start_step?: number;
  s2v_refiner_start_step?: number;
  s2v_audio_offset?: number;
  s2v_audio_duration?: number;
  video_format?: string;
  pix_fmt?: string;
  crf?: number;
  loop_count?: number;
  pingpong?: boolean;
  trim_to_audio?: boolean;
  save_output?: boolean;
  mmaudio_enabled?: boolean;
  mmaudio_model?: string;
  mmaudio_precision?: string;
  mmaudio_feature_precision?: string;
  mmaudio_negative_prompt?: string;
  mmaudio_duration?: number;
  mmaudio_steps?: number;
  mmaudio_cfg?: number;
  mmaudio_seed?: number;
  mmaudio_mask_away_clip?: boolean;
  mmaudio_force_offload?: boolean;
  voice_volume?: number;
  sfx_volume?: number;
  sfx_start_time?: number;
  sfx_fade_in?: number;
  sfx_fade_out?: number;
  audio_output_duration?: number;
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
  image_workflow: string | null;        // "qwen_edit" | "sdxl"
  resolution_w: number | null;
  resolution_h: number | null;
  image_params: string | null;          // JSON ImageParams
  frame_source_mode: FrameSourceMode | null;
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

export interface ImageModelList {
  checkpoints: DiffusionModelEntry[];
  qwen_edit: DiffusionModelEntry[];
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

export type EditTransitionStyle = "cut" | "soft" | "fade" | "dip_to_black" | "flash";
export type ColorPreset = "reference_soft" | "warm_room" | "clean_neutral" | "dream_blush";

export interface EditOverlay {
  kind: "title" | "caption" | "sticker";
  text: string;
  scene_index: number;
  start: number;
  duration: number;
}

export interface EditRenderSettings {
  transition_style: EditTransitionStyle;
  transition_sec: number;
  fps: number;
  width?: number;
  height?: number;
  audio_sample_rate: number;
  target_lufs?: number;
  loudness_range_lu?: number;
  color_preset: ColorPreset;
  grain_strength: number;
  vignette_strength: number;
  subtitle_style: {
    font_size: number;
    margin_v: number;
    outline: number;
    shadow: number;
  };
  overlays?: EditOverlay[];
}
