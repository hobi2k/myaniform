"""Central model filename catalog for ComfyUI workflow patching."""

ANIMAGINE_XL_CKPT_NAME = "animagineXLV31_v31.safetensors"
IL_FLAT_MIX_CKPT_NAME = "Illustrious/ILFlatMix.safetensors"
ANIMAGINE_XL_CHECKPOINT = f"checkpoints/{ANIMAGINE_XL_CKPT_NAME}"
IL_FLAT_MIX_CHECKPOINT = f"checkpoints/{IL_FLAT_MIX_CKPT_NAME}"
VN_CHARACTER_SHEET_LORA = "loras/vn_character_sheet_v4.safetensors"
DMD2_SDXL_LORA = "loras/DMD2/dmd2_sdxl_4step_lora_fp16.safetensors"
MIMIMETER_LORA = "loras/IL/mimimeter.safetensors"
ILLUSTRIOUS_OPENPOSE_CONTROLNET = "controlnet/SDXL/IllustriousXL_openpose.safetensors"

QWEN_IMAGE_EDIT_UNET = "qwen-image-edit-2511-Q5_0.gguf"
QWEN_IMAGE_TEXT_ENCODER = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
QWEN_IMAGE_VAE = "qwen_image_vae.safetensors"
QWEN_IMAGE_LIGHTNING_LORA = "qwen/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"
QWEN_VNCCS_POSE_LORA = "qwen/VNCCS/poser_helper_v2_000004200.safetensors"
QWEN_VNCCS_CLOTHES_LORA = "qwen/VNCCS/ClothesHelperUltimateV1_000005100.safetensors"

SAM_VIT_B = "sams/sam_vit_b_01ec64.pth"
APISR_UPSCALER = "upscale_models/4x_APISR_GRL_GAN_generator.pth"
SEEDVR2_DIT = "SEEDVR2/seedvr2_ema_3b_fp16.safetensors"
SEEDVR2_VAE = "SEEDVR2/ema_vae_fp16.safetensors"
ULTRALYTICS_FACE_BBOX = "ultralytics/bbox/face_yolov8m.pt"
ULTRALYTICS_HAND_BBOX = "ultralytics/bbox/hand_yolov8s.pt"
ULTRALYTICS_PERSON_SEGM = "ultralytics/segm/person_yolov8m-seg.pt"

S2V_FASTFIDELITY_MODEL = "wan_s2v/DasiwaWan2214BS2V_littledemonV2.safetensors"

MMAUDIO_SFW_MODEL = "mmaudio_large_44k_v2_fp16.safetensors"
MMAUDIO_NSFW_MODEL = "mmaudio_large_44k_nsfw_gold_8.5k_final_fp16.safetensors"

CHARACTER_IMAGE_REQUIRED_MODEL_PATHS = [
    ANIMAGINE_XL_CHECKPOINT,
    IL_FLAT_MIX_CHECKPOINT,
    VN_CHARACTER_SHEET_LORA,
    DMD2_SDXL_LORA,
    MIMIMETER_LORA,
    ILLUSTRIOUS_OPENPOSE_CONTROLNET,
    f"unet/{QWEN_IMAGE_EDIT_UNET}",
    f"text_encoders/{QWEN_IMAGE_TEXT_ENCODER}",
    f"vae/{QWEN_IMAGE_VAE}",
    f"loras/{QWEN_IMAGE_LIGHTNING_LORA}",
    f"loras/{QWEN_VNCCS_POSE_LORA}",
    f"loras/{QWEN_VNCCS_CLOTHES_LORA}",
    SAM_VIT_B,
    APISR_UPSCALER,
    SEEDVR2_DIT,
    SEEDVR2_VAE,
    ULTRALYTICS_FACE_BBOX,
    ULTRALYTICS_HAND_BBOX,
    ULTRALYTICS_PERSON_SEGM,
]
