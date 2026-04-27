export const MMAUDIO_MODELS = [
  { value: "mmaudio_large_44k_v2_fp16.safetensors", label: "SFW large 44k v2" },
  { value: "mmaudio_large_44k_nsfw_gold_8.5k_final_fp16.safetensors", label: "NSFW gold 8.5k" },
] as const;

export const DEFAULT_MMAUDIO_MODEL = MMAUDIO_MODELS[1].value;

export const SAMPLER_OPTIONS = [
  "euler",
  "euler_ancestral",
  "dpmpp_2m",
  "dpmpp_2m_sde",
  "unipc",
] as const;

export const IMAGE_SCHEDULER_OPTIONS = ["sgm_uniform", "simple", "karras", "normal"] as const;
export const VIDEO_SCHEDULER_OPTIONS = ["simple", "sgm_uniform", "karras", "normal"] as const;

export const VIDEO_FORMAT_OPTIONS = [
  { value: "video/h264-mp4", label: "h264 mp4" },
  { value: "video/h265-mp4", label: "h265 mp4" },
  { value: "video/webm", label: "webm" },
] as const;

export const PIX_FMT_OPTIONS = ["yuv420p", "yuv444p", "rgb24"] as const;
export const PRECISION_OPTIONS = ["fp16", "bf16", "fp32"] as const;

export const DEFAULT_IMAGE_SAMPLER = "euler";
export const DEFAULT_IMAGE_SCHEDULER = "sgm_uniform";
export const DEFAULT_VIDEO_SAMPLER = "euler";
export const DEFAULT_VIDEO_SCHEDULER = "simple";
export const DEFAULT_VIDEO_FORMAT = VIDEO_FORMAT_OPTIONS[0].value;
export const DEFAULT_PIX_FMT = PIX_FMT_OPTIONS[0];
export const DEFAULT_AUDIO_PRECISION = PRECISION_OPTIONS[0];

export const DEFAULT_IMAGE_PARAMS = {
  sampler: DEFAULT_IMAGE_SAMPLER,
  scheduler: DEFAULT_IMAGE_SCHEDULER,
} as const;

export const DEFAULT_VIDEO_PARAMS = {
  sampler: DEFAULT_VIDEO_SAMPLER,
  scheduler: DEFAULT_VIDEO_SCHEDULER,
  video_format: DEFAULT_VIDEO_FORMAT,
  pix_fmt: DEFAULT_PIX_FMT,
  mmaudio_model: DEFAULT_MMAUDIO_MODEL,
  mmaudio_precision: DEFAULT_AUDIO_PRECISION,
  mmaudio_feature_precision: DEFAULT_AUDIO_PRECISION,
  audio_sync_prompt:
    "Audio-driven performance: mouth, gaze, head, shoulders, hands, breathing and posture follow the spoken line and sound-effect timing.",
  motion_negative_prompt:
    "static body, frozen pose, only lips moving, disconnected voice, off-beat gestures, dead eyes",
} as const;
