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
  bgm_path: string | null;
  measured_lufs: number | null;
  overlays_json: string | null;
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
  /** Primary model — qwen_edit 모드에선 Qwen Edit UNet, sdxl 모드에선 SDXL 체크포인트. */
  model?: string;
  /** qwen_edit 모드 전용: SDXL 베이스 체크포인트 (animagineXL/aMix/JAKNU/...).
   *  workflow 내 CheckpointLoaderSimple 슬롯들에 라우팅. sdxl 모드에선 무시. */
  checkpoint?: string;
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

/**
 * VoiceParams — per-scene TTS settings, stored in `Scene.voice_params` JSON.
 * The `mode` discriminates which Qwen3 / S2-Pro node graph the backend builds.
 * Other fields are mode-specific; backend builders read what they need and
 * ignore the rest, so the editor can keep all knobs in one flat object.
 */
export type VoiceMode =
  | "qwen3_voice_design"
  | "qwen3_custom_voice"
  | "qwen3_voice_clone"
  | "qwen3_base_custom_voice_clone_instruct"
  | "qwen3_directed_clone_from_voice_design"
  | "qwen3_hybrid_clone_instruct_preset"
  | "qwen3_voicebox_instruct"
  | "qwen3_voicebox_clone_instruct"
  | "s2pro_voice_design"
  | "s2pro_voice_clone";

export const QWEN3_CUSTOM_VOICE_SPEAKERS = [
  "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric",
  "Ryan", "Aiden", "Ono_Anna", "Sohee",
] as const;

export const VOICE_MODE_OPTIONS: ReadonlyArray<{
  id: VoiceMode;
  label: string;
  family: "qwen3_native" | "qwen3_voicebox" | "s2pro";
  needsRefAudio: boolean;
  needsSpeakerPreset: boolean;
  needsDesignText: boolean;
  description: string;
}> = [
  {
    id: "qwen3_voice_design",
    label: "Voice Design (텍스트 묘사)",
    family: "qwen3_native",
    needsRefAudio: false, needsSpeakerPreset: false, needsDesignText: true,
    description: "레퍼런스 음성 없이 instruct 만으로 음색 합성.",
  },
  {
    id: "qwen3_custom_voice",
    label: "Custom Voice (프리셋 화자 + instruct)",
    family: "qwen3_native",
    needsRefAudio: false, needsSpeakerPreset: true, needsDesignText: false,
    description: "Vivian/Serena/Sohee 등 9개 빌트인 화자 선택, instruct 로 톤 조절.",
  },
  {
    id: "qwen3_voice_clone",
    label: "Voice Clone (레퍼런스 음성)",
    family: "qwen3_native",
    needsRefAudio: true, needsSpeakerPreset: false, needsDesignText: false,
    description: "캐릭터 보이스 샘플 한 개로 클론. ref_text 주면 더 정확.",
  },
  {
    id: "qwen3_base_custom_voice_clone_instruct",
    label: "Base + CustomVoice · Clone + Instruct",
    family: "qwen3_native",
    needsRefAudio: true, needsSpeakerPreset: false, needsDesignText: false,
    description: "Base + CustomVoice 두 모델 + 클론 + instruct + (옵션) x_vector_only_mode 풀 옵션.",
  },
  {
    id: "qwen3_directed_clone_from_voice_design",
    label: "Directed Clone from Voice Design (3-model)",
    family: "qwen3_native",
    needsRefAudio: false, needsSpeakerPreset: false, needsDesignText: true,
    description: "VoiceDesign + Base + CustomVoice 3-model. instruct 만으로 시드 보이스 → 클론 — ref 불필요.",
  },
  {
    id: "qwen3_hybrid_clone_instruct_preset",
    label: "Hybrid Clone + Instruct + Preset (auto-anchor)",
    family: "qwen3_native",
    needsRefAudio: false, needsSpeakerPreset: false, needsDesignText: false,
    description: "ref / 프리셋 화자 / 저장된 prompt 중 가용한 것을 자동 선택 — 가장 유연.",
  },
  {
    id: "qwen3_voicebox_instruct",
    label: "VoiceBox + Instruct (named speaker)",
    family: "qwen3_voicebox",
    needsRefAudio: false, needsSpeakerPreset: true, needsDesignText: false,
    description: "사전학습 voicebox 의 named speaker(예: 'mai') + instruct.",
  },
  {
    id: "qwen3_voicebox_clone_instruct",
    label: "VoiceBox · Clone + Instruct",
    family: "qwen3_voicebox",
    needsRefAudio: true, needsSpeakerPreset: false, needsDesignText: false,
    description: "Voicebox 모델로 ref audio 클론 + instruct. strategy 선택 가능.",
  },
  {
    id: "s2pro_voice_design",
    label: "S2 Pro · Voice Design",
    family: "s2pro",
    needsRefAudio: false, needsSpeakerPreset: false, needsDesignText: true,
    description: "Fish S2-Pro 텍스트 기반 voice design.",
  },
  {
    id: "s2pro_voice_clone",
    label: "S2 Pro · Voice Clone",
    family: "s2pro",
    needsRefAudio: true, needsSpeakerPreset: false, needsDesignText: false,
    description: "Fish S2-Pro 의 zero-shot 보이스 클론.",
  },
];

export interface VoiceParams {
  mode?: VoiceMode;
  /** Free-form vocal direction passed to nodes that have an `instruct` slot. */
  instruct?: string;
  /** Built-in speaker name (Qwen3CustomVoice / VoiceBoxInstruct / VoiceBoxClone). */
  speaker?: string;
  /** Custom speaker label saved into the model when registering a new voice. */
  custom_speaker_name?: string;
  /** Reference text matching the ref audio — helps clone fidelity. */
  ref_text?: string;
  /** Seed utterance the design pass uses to compute the voice. */
  design_text?: string;
  /** Override clone instruct (separate from the design pass). */
  clone_instruct?: string;
  /** Auto-anchor preference for HybridCloneInstructPreset. */
  speaker_anchor?: string;
  /** Saved CustomVoice speaker label for hybrid mode. */
  customvoice_speaker?: string;
  /** Voicebox clone strategy (e.g. "embedded_encoder_with_ref_code"). */
  strategy?: string;
  /** Language hint — "Auto" lets the model detect from the text. */
  language?: string;
  /** Sampler knobs — leave undefined to use mode defaults. */
  temperature?: number;
  top_p?: number;
  max_new_tokens?: number;
  seed?: number;
  /** Cap reference clip length sent into the encoder. */
  ref_audio_max_seconds?: number;
  /** Use only x-vector projection from the ref instead of full conditioning. */
  x_vector_only_mode?: boolean;
  /** Disable streaming for hybrid/voicebox-clone modes. */
  non_streaming_mode?: boolean;
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
  voice_params: string | null;          // JSON VoiceParams
  effect_prompt: string | null;
  loras_json: string | null;
  diffusion_model: string | null;
  voice_path: string | null;
  image_path: string | null;
  clip_path: string | null;
  clip_stale: boolean;
  clip_duration_sec: number | null;
  // Composer M3: per-clip 편집 메타
  clip_in_offset_sec: number | null;
  clip_out_offset_sec: number | null;
  clip_speed: number | null;
  clip_voice_volume: number | null;
  clip_sfx_volume: number | null;
  out_transition_style: EditTransitionStyle | null;
  out_transition_sec: number | null;
  clip_color_overlay: ColorPreset | null;
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

export type OverlayAnimationIn = "none" | "fade" | "slide_up" | "slide_left" | "scale";
export type OverlayAnimationOut = "none" | "fade" | "slide_down" | "slide_right" | "scale";

export interface EditOverlay {
  /** 오버레이 ID — 클라이언트에서 부여 (uuid 또는 timestamp). 영구화 후 안정 식별자. */
  id?: string;
  kind: "title" | "caption" | "sticker" | "shape" | "image";
  text?: string;
  image_url?: string;
  scene_index: number;
  start: number;
  duration: number;
  // 위치/크기 — 화면 비율 (0..1) 로 저장. 해상도 무관.
  x?: number;
  y?: number;
  width?: number;       // 0..1, optional
  height?: number;      // 0..1, optional
  rotation?: number;    // degrees
  // 스타일
  font_family?: string;
  font_size?: number;   // px (Player 컨테이너 기준)
  font_weight?: number;
  color?: string;
  shadow?: string;
  outline?: string;
  outline_width?: number;
  background?: string;
  padding?: number;
  // 애니메이션
  animation_in?: OverlayAnimationIn;
  animation_out?: OverlayAnimationOut;
  animation_duration?: number; // sec, default 0.4
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
  // Composer M4 — BGM 트랙 옵션
  bgm_volume?: number;       // 0..2, 기본 0.5
  bgm_loop?: boolean;        // true 면 BGM 길이 < 영상 길이일 때 반복
  bgm_fade_in?: number;      // sec, 시작 페이드인
  bgm_fade_out?: number;     // sec, 끝 페이드아웃
}
