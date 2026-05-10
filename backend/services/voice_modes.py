"""Voice generation mode catalog.

Each mode owns a small ComfyUI workflow graph built inline (a few Qwen3 /
S2-Pro nodes). The mode is the discriminator stored in
``Scene.voice_params["mode"]`` and selected from the inspector dropdown.

Why inline graphs (vs. JSON payload files):
- Each graph is 4-6 nodes — file overhead would dwarf code.
- Field defaults stay close to the dispatch logic so missing/optional fields
  are handled in one place.
- Changing the Qwen3 node signature only requires editing one Python builder
  instead of hunting through JSON.

The builders return a ComfyUI ``prompt`` dict (the inner workflow object,
not the API envelope). ``patch_voice`` wraps it with ``_apply_filename_prefixes``
just like the legacy templates.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

VoiceMode = str

# ── Model repo IDs (mirror what Qwen3Loader expects). ──────────────────────
REPO_BASE = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
REPO_CUSTOM_VOICE = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
REPO_VOICE_DESIGN = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"

DEFAULT_LANGUAGE = "Korean"
DEFAULT_PRECISION = "bf16"
DEFAULT_ATTENTION = "sdpa"

# Speakers built into Qwen3CustomVoice. Source: nodes.py INPUT_TYPES.
QWEN3_CUSTOM_VOICE_SPEAKERS = (
    "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric",
    "Ryan", "Aiden", "Ono_Anna", "Sohee",
)


@dataclass
class VoiceModeSpec:
    """Static metadata for the mode catalog (used by frontend/UI builders)."""

    id: VoiceMode
    label: str
    family: str  # "qwen3_native" | "qwen3_voicebox" | "s2pro"
    needs_ref_audio: bool
    needs_speaker_preset: bool
    needs_design_text: bool
    description: str


# Scene-level catalog. Modes that *create* a fresh voice (voice_design,
# directed_clone) belong on the character inspector, not here — once the
# character has a voice_sample_path, scenes just consume it.
VOICE_MODE_CATALOG: list[VoiceModeSpec] = [
    VoiceModeSpec(
        id="qwen3_base_custom_voice_clone_instruct",
        label="Clone + Instruct (Base + CustomVoice · 풀 옵션)",
        family="qwen3_native",
        needs_ref_audio=True,
        needs_speaker_preset=False,
        needs_design_text=False,
        description="기본값. 캐릭터 음성 샘플을 클론 + instruct 로 톤/감정 지시. x_vector_only_mode 까지 켤 수 있는 풀 파워 모드.",
    ),
    VoiceModeSpec(
        id="qwen3_voice_clone",
        label="Clone only (가벼움)",
        family="qwen3_native",
        needs_ref_audio=True,
        needs_speaker_preset=False,
        needs_design_text=False,
        description="instruct 없이 캐릭터 보이스 샘플을 그대로 클론. 가장 빠름.",
    ),
    VoiceModeSpec(
        id="qwen3_hybrid_clone_instruct_preset",
        label="Hybrid (auto-anchor)",
        family="qwen3_native",
        needs_ref_audio=False,
        needs_speaker_preset=False,
        needs_design_text=False,
        description="ref audio / 빌트인 화자 / 저장된 prompt 중 가능한 것을 자동 선택 — 캐릭터가 voice_sample 없이 빌트인 화자만 가진 경우에도 동작.",
    ),
    VoiceModeSpec(
        id="qwen3_custom_voice",
        label="Built-in Speaker (Vivian / Sohee 등)",
        family="qwen3_native",
        needs_ref_audio=False,
        needs_speaker_preset=True,
        needs_design_text=False,
        description="캐릭터 음성 대신 Qwen3 빌트인 화자 9종 중 하나를 사용. 캐릭터가 빌트인 화자로 등록된 경우 자동 선택.",
    ),
    VoiceModeSpec(
        id="qwen3_voicebox_clone_instruct",
        label="VoiceBox · Clone + Instruct",
        family="qwen3_voicebox",
        needs_ref_audio=True,
        needs_speaker_preset=False,
        needs_design_text=False,
        description="VoiceBox 추론 strategy 로 ref audio 클론 + instruct. embedded_encoder_with_ref_code 가 가장 안정.",
    ),
    VoiceModeSpec(
        id="qwen3_voicebox_instruct",
        label="VoiceBox · Named Speaker (사전 등록)",
        family="qwen3_voicebox",
        needs_ref_audio=False,
        needs_speaker_preset=True,
        needs_design_text=False,
        description="VoiceBox 체크포인트 안에 등록된 named speaker(예: 'mai') 호출. 캐릭터에 voicebox 등록이 되어 있어야 의미가 있음.",
    ),
    VoiceModeSpec(
        id="s2pro_voice_clone",
        label="Fish S2-Pro · Voice Clone",
        family="s2pro",
        needs_ref_audio=True,
        needs_speaker_preset=False,
        needs_design_text=False,
        description="Fish S2-Pro 의 zero-shot 보이스 클론. 캐릭터 tts_engine 이 s2pro 일 때 권장.",
    ),
]

VOICE_MODE_INDEX = {spec.id: spec for spec in VOICE_MODE_CATALOG}


# ── Helpers ────────────────────────────────────────────────────────────────


def _loader(
    repo_id: str,
    *,
    attention: str = DEFAULT_ATTENTION,
    precision: str = DEFAULT_PRECISION,
    local_model_path: str = "",
) -> dict:
    """Qwen3Loader. ``local_model_path`` 가 지정되면 해당 디렉터리에서 로드 —
    voicebox 등록된 캐릭터 ckpt 를 가리킬 때 사용."""
    title_suffix = (
        f" (local: …/{local_model_path.rstrip('/').split('/')[-1]})"
        if local_model_path else ""
    )
    return {
        "class_type": "Qwen3Loader",
        "inputs": {
            "repo_id": repo_id,
            "source": "HuggingFace",
            "precision": precision,
            "attention": attention,
            "local_model_path": local_model_path,
        },
        "_meta": {"title": f"Loader · {repo_id.split('/')[-1]}{title_suffix}"},
    }


def _save_audio(audio_link: list, *, prefix: str) -> dict:
    return {
        "class_type": "SaveAudio",
        "inputs": {
            "audio": audio_link,
            "filename_prefix": prefix,
        },
        "_meta": {"title": "음성 저장"},
    }


def _load_audio(filename: str) -> dict:
    return {
        "class_type": "LoadAudio",
        "inputs": {"audio": filename, "upload": "audio"},
        "_meta": {"title": "레퍼런스 오디오"},
    }


def _common_qwen3_kwargs(p: dict) -> dict:
    """Pluck the universal Qwen3 hyperparameters with sensible defaults."""
    return {
        "language": p.get("language", DEFAULT_LANGUAGE),
        "max_new_tokens": int(p.get("max_new_tokens", 2048)),
        "temperature": float(p.get("temperature", 0.9)),
        "top_p": float(p.get("top_p", 0.9)),
    }


# ── Per-mode builders ──────────────────────────────────────────────────────
# Each builder returns the workflow ``prompt`` dict (node_id → node).


def _build_qwen3_voice_design(text: str, ref: Optional[str], p: dict, prefix: str) -> dict:
    """3-model directed-clone from a textual voice description (no ref audio)."""
    common = _common_qwen3_kwargs(p)
    design_instruct = p.get("instruct") or p.get("voice_design_text") or ""
    design_text = p.get("design_text") or text  # seed utterance for the design pass
    return {
        "1": _loader(REPO_VOICE_DESIGN),
        "2": _loader(REPO_BASE),
        "3": _loader(REPO_CUSTOM_VOICE),
        "4": {
            "class_type": "Qwen3DirectedCloneFromVoiceDesign",
            "inputs": {
                "voice_design_model": ["1", 0],
                "base_model": ["2", 0],
                "custom_voice_model": ["3", 0],
                "design_text": design_text,
                "design_instruct": design_instruct,
                "target_text": text,
                "seed": int(p.get("seed", 42)),
                "language": common["language"],
                "clone_instruct": p.get("clone_instruct", ""),
                "ref_audio_max_seconds": float(p.get("ref_audio_max_seconds", 30.0)),
                "x_vector_only_mode": bool(p.get("x_vector_only_mode", True)),
                "max_new_tokens": common["max_new_tokens"],
                "temperature": common["temperature"],
                "top_p": common["top_p"],
            },
            "_meta": {"title": "Voice Design → Directed Clone"},
        },
        "5": _save_audio(["4", 2], prefix=prefix),
    }


def _build_qwen3_custom_voice(text: str, ref: Optional[str], p: dict, prefix: str) -> dict:
    """Built-in speaker + optional instruct.
    voicebox_checkpoint 가 들어오면 등록된 캐릭터 화자도 같은 ckpt 안에서 호출 가능."""
    common = _common_qwen3_kwargs(p)
    ckpt = (p.get("voicebox_checkpoint") or "").strip()
    return {
        "1": _loader(REPO_CUSTOM_VOICE, local_model_path=ckpt),
        "2": {
            "class_type": "Qwen3CustomVoice",
            "inputs": {
                "model": ["1", 0],
                "text": text,
                "language": common["language"],
                "speaker": p.get("speaker", QWEN3_CUSTOM_VOICE_SPEAKERS[0]),
                "seed": int(p.get("seed", 42)),
                "instruct": p.get("instruct", ""),
                "custom_speaker_name": p.get("custom_speaker_name", ""),
                "max_new_tokens": common["max_new_tokens"],
                "temperature": common["temperature"],
                "top_p": common["top_p"],
            },
            "_meta": {"title": "Custom Voice 합성"},
        },
        "3": _save_audio(["2", 0], prefix=prefix),
    }


def _build_qwen3_voice_clone(text: str, ref: Optional[str], p: dict, prefix: str) -> dict:
    common = _common_qwen3_kwargs(p)
    inputs = {
        "model": ["1", 0],
        "text": text,
        "seed": int(p.get("seed", 42)),
        "language": common["language"],
        "max_new_tokens": common["max_new_tokens"],
        "temperature": common["temperature"],
        "top_p": common["top_p"],
        "ref_audio_max_seconds": float(p.get("ref_audio_max_seconds", 30.0)),
        "ref_text": p.get("ref_text", ""),
    }
    nodes: dict = {"1": _loader(REPO_CUSTOM_VOICE)}
    if ref:
        nodes["2"] = _load_audio(ref)
        inputs["ref_audio"] = ["2", 0]
    nodes["3"] = {
        "class_type": "Qwen3VoiceClone",
        "inputs": inputs,
        "_meta": {"title": "Voice Clone"},
    }
    nodes["4"] = _save_audio(["3", 0], prefix=prefix)
    return nodes


def _build_qwen3_base_cv_clone_instruct(text: str, ref: Optional[str], p: dict, prefix: str) -> dict:
    """The user-requested 'base + custom voice clone + instruct' mode.

    Loads BOTH Base and CustomVoice models and feeds them with a reference
    audio + instruct in a single node — Qwen3BaseCustomVoiceCloneInstruct.
    The reference audio is **required** by this node.
    """
    if not ref:
        raise ValueError("Base+CustomVoice Clone+Instruct 모드는 캐릭터 보이스 샘플(ref_audio)이 필요합니다.")
    common = _common_qwen3_kwargs(p)
    return {
        "1": _loader(REPO_BASE),
        "2": _loader(REPO_CUSTOM_VOICE),
        "3": _load_audio(ref),
        "4": {
            "class_type": "Qwen3BaseCustomVoiceCloneInstruct",
            "inputs": {
                "base_model": ["1", 0],
                "custom_voice_model": ["2", 0],
                "ref_audio": ["3", 0],
                "ref_text": p.get("ref_text", ""),
                "text": text,
                "seed": int(p.get("seed", 42)),
                "language": common["language"],
                "instruct": p.get("instruct", ""),
                "ref_audio_max_seconds": float(p.get("ref_audio_max_seconds", 30.0)),
                "x_vector_only_mode": bool(p.get("x_vector_only_mode", False)),
                "max_new_tokens": common["max_new_tokens"],
                "temperature": common["temperature"],
                "top_p": common["top_p"],
            },
            "_meta": {"title": "Base + CustomVoice · Clone + Instruct"},
        },
        # Qwen3BaseCustomVoiceCloneInstruct outputs (clone_prompt=0, audio=1).
        "5": _save_audio(["4", 1], prefix=prefix),
    }


def _build_qwen3_hybrid(text: str, ref: Optional[str], p: dict, prefix: str) -> dict:
    common = _common_qwen3_kwargs(p)
    inputs = {
        "base_model": ["1", 0],
        "custom_voice_model": ["2", 0],
        "text": text,
        "seed": int(p.get("seed", 42)),
        "language": common["language"],
        "instruct": p.get("instruct", ""),
        "speaker_anchor": p.get("speaker_anchor", "auto"),
        "customvoice_speaker": p.get("customvoice_speaker", ""),
        "x_vector_only_mode": bool(p.get("x_vector_only_mode", False)),
        "max_new_tokens": int(p.get("max_new_tokens", 1024)),
        "temperature": float(p.get("temperature", 0.8)),
        "top_p": float(p.get("top_p", 0.95)),
        "non_streaming_mode": bool(p.get("non_streaming_mode", False)),
        "ref_text": p.get("ref_text", ""),
    }
    nodes: dict = {"1": _loader(REPO_BASE), "2": _loader(REPO_CUSTOM_VOICE)}
    if ref:
        nodes["3"] = _load_audio(ref)
        inputs["ref_audio"] = ["3", 0]
    nodes["4"] = {
        "class_type": "Qwen3HybridCloneInstructPreset",
        "inputs": inputs,
        "_meta": {"title": "Hybrid Clone + Instruct (auto-anchor)"},
    }
    # Outputs: clone_prompt=0, audio=1, strategy=2, anchor_speaker=3.
    nodes["5"] = _save_audio(["4", 1], prefix=prefix)
    return nodes


def _build_qwen3_voicebox_instruct(text: str, ref: Optional[str], p: dict, prefix: str) -> dict:
    common = _common_qwen3_kwargs(p)
    ckpt = (p.get("voicebox_checkpoint") or "").strip()
    return {
        "1": _loader(REPO_CUSTOM_VOICE, local_model_path=ckpt),
        "2": {
            "class_type": "Qwen3VoiceBoxInstruct",
            "inputs": {
                "model": ["1", 0],
                "speaker": p.get("speaker", "mai"),
                "text": text,
                "seed": int(p.get("seed", 42)),
                "language": common["language"],
                "instruct": p.get("instruct", ""),
                "max_new_tokens": common["max_new_tokens"],
                "temperature": common["temperature"],
                "top_p": common["top_p"],
            },
            "_meta": {"title": "VoiceBox · Instruct"},
        },
        "3": _save_audio(["2", 0], prefix=prefix),
    }


def _build_qwen3_voicebox_clone_instruct(text: str, ref: Optional[str], p: dict, prefix: str) -> dict:
    common = _common_qwen3_kwargs(p)
    inputs = {
        "model": ["1", 0],
        "text": text,
        "instruct": p.get("instruct", "Speak softly, with restrained exhaustion but clear diction."),
        "seed": int(p.get("seed", 42)),
        "language": common["language"],
        "speaker": p.get("speaker", "auto"),
        "strategy": p.get("strategy", "embedded_encoder_with_ref_code"),
        "max_new_tokens": int(p.get("max_new_tokens", 1024)),
        "temperature": float(p.get("temperature", 0.8)),
        "top_p": float(p.get("top_p", 0.95)),
        "non_streaming_mode": bool(p.get("non_streaming_mode", False)),
        "ref_text": p.get("ref_text", ""),
    }
    ckpt = (p.get("voicebox_checkpoint") or "").strip()
    nodes: dict = {"1": _loader(REPO_CUSTOM_VOICE, local_model_path=ckpt)}
    if ref:
        nodes["2"] = _load_audio(ref)
        inputs["ref_audio"] = ["2", 0]
    nodes["3"] = {
        "class_type": "Qwen3VoiceBoxCloneInstruct",
        "inputs": inputs,
        "_meta": {"title": "VoiceBox · Clone + Instruct"},
    }
    nodes["4"] = _save_audio(["3", 0], prefix=prefix)
    return nodes


# S2 Pro modes use the existing legacy templates rather than rebuilding —
# they're returned by the builder as None and patch_voice falls back.
def _legacy_s2pro(text: str, ref: Optional[str], p: dict, prefix: str) -> None:
    return None


VoiceModeBuilder = Callable[[str, Optional[str], dict, str], Optional[dict]]

VOICE_MODE_BUILDERS: dict[VoiceMode, VoiceModeBuilder] = {
    "qwen3_custom_voice": _build_qwen3_custom_voice,
    "qwen3_voice_clone": _build_qwen3_voice_clone,
    "qwen3_base_custom_voice_clone_instruct": _build_qwen3_base_cv_clone_instruct,
    "qwen3_hybrid_clone_instruct_preset": _build_qwen3_hybrid,
    "qwen3_voicebox_instruct": _build_qwen3_voicebox_instruct,
    "qwen3_voicebox_clone_instruct": _build_qwen3_voicebox_clone_instruct,
    "s2pro_voice_clone": _legacy_s2pro,
    # Character-only voice creation modes — kept here so that
    # ``patch_voice_design`` / character voicebox registration can re-use the
    # same dispatch logic without duplicating wiring. They should NOT be
    # surfaced in the scene-level mode picker.
    "qwen3_voice_design": _build_qwen3_voice_design,
    "qwen3_directed_clone_from_voice_design": _build_qwen3_voice_design,  # alias
}


def infer_default_mode(tts_engine: str, has_ref_audio: bool) -> VoiceMode:
    """Pick a sensible default scene-level mode for legacy rows.

    Scenes always consume a character's pre-prepared voice — so we never
    default to a *creation* mode (voice_design). If the character has no
    sample at all we fall back to hybrid (which can still synthesize via
    instruct / built-in anchor).
    """
    engine = (tts_engine or "qwen3").lower()
    if engine == "s2pro":
        # No s2pro_voice_design at scene level — if no ref audio, hybrid
        # qwen3 path is still better than failing.
        return "s2pro_voice_clone" if has_ref_audio else "qwen3_hybrid_clone_instruct_preset"
    if has_ref_audio:
        return "qwen3_base_custom_voice_clone_instruct"
    return "qwen3_hybrid_clone_instruct_preset"
