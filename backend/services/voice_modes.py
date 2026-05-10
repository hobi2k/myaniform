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


VOICE_MODE_CATALOG: list[VoiceModeSpec] = [
    VoiceModeSpec(
        id="qwen3_voice_design",
        label="Voice Design (텍스트 묘사로 합성)",
        family="qwen3_native",
        needs_ref_audio=False,
        needs_speaker_preset=False,
        needs_design_text=True,
        description="레퍼런스 음성 없이 instruct 텍스트(예: 'warm intimate Korean female') 만으로 합성.",
    ),
    VoiceModeSpec(
        id="qwen3_custom_voice",
        label="Custom Voice (프리셋 화자 + instruct)",
        family="qwen3_native",
        needs_ref_audio=False,
        needs_speaker_preset=True,
        needs_design_text=False,
        description="Vivian/Serena/Sohee 등 9개 빌트인 화자 중 선택, instruct 로 톤 조절.",
    ),
    VoiceModeSpec(
        id="qwen3_voice_clone",
        label="Voice Clone (레퍼런스 음성)",
        family="qwen3_native",
        needs_ref_audio=True,
        needs_speaker_preset=False,
        needs_design_text=False,
        description="캐릭터 보이스 샘플 한 개로 클론. ref_text 주면 더 정확.",
    ),
    VoiceModeSpec(
        id="qwen3_base_custom_voice_clone_instruct",
        label="Base + CustomVoice Clone + Instruct",
        family="qwen3_native",
        needs_ref_audio=True,
        needs_speaker_preset=False,
        needs_design_text=False,
        description="Base + CustomVoice 두 모델 동시 사용. 클론 + instruct + (옵션) x_vector_only_mode 까지 모두 켤 수 있는 풀 옵션.",
    ),
    VoiceModeSpec(
        id="qwen3_directed_clone_from_voice_design",
        label="Directed Clone from Voice Design (3-model)",
        family="qwen3_native",
        needs_ref_audio=False,
        needs_speaker_preset=False,
        needs_design_text=True,
        description="VoiceDesign + Base + CustomVoice 세 모델 체인. 디자인 instruct 로 시드 보이스 만들고 그것을 그대로 클론 — 레퍼런스 오디오 불필요.",
    ),
    VoiceModeSpec(
        id="qwen3_hybrid_clone_instruct_preset",
        label="Hybrid Clone + Instruct + Preset (auto-anchor)",
        family="qwen3_native",
        needs_ref_audio=False,  # optional
        needs_speaker_preset=False,
        needs_design_text=False,
        description="레퍼런스/프리셋 화자/저장된 prompt 중 사용 가능한 것을 자동 선택. 가장 유연.",
    ),
    VoiceModeSpec(
        id="qwen3_voicebox_instruct",
        label="VoiceBox + Instruct (named speaker)",
        family="qwen3_voicebox",
        needs_ref_audio=False,
        needs_speaker_preset=True,
        needs_design_text=False,
        description="사전 학습된 voicebox 안의 named speaker(예: 'mai') + instruct. 화자 이름 직접 입력.",
    ),
    VoiceModeSpec(
        id="qwen3_voicebox_clone_instruct",
        label="VoiceBox Clone + Instruct",
        family="qwen3_voicebox",
        needs_ref_audio=True,
        needs_speaker_preset=False,
        needs_design_text=False,
        description="Voicebox 모델로 ref audio 클론 + instruct 동시. strategy 선택 가능.",
    ),
    VoiceModeSpec(
        id="s2pro_voice_design",
        label="S2 Pro · Voice Design",
        family="s2pro",
        needs_ref_audio=False,
        needs_speaker_preset=False,
        needs_design_text=True,
        description="Fish S2-Pro 의 텍스트 기반 voice design.",
    ),
    VoiceModeSpec(
        id="s2pro_voice_clone",
        label="S2 Pro · Voice Clone",
        family="s2pro",
        needs_ref_audio=True,
        needs_speaker_preset=False,
        needs_design_text=False,
        description="Fish S2-Pro 의 zero-shot 보이스 클론.",
    ),
]

VOICE_MODE_INDEX = {spec.id: spec for spec in VOICE_MODE_CATALOG}


# ── Helpers ────────────────────────────────────────────────────────────────


def _loader(repo_id: str, *, attention: str = DEFAULT_ATTENTION, precision: str = DEFAULT_PRECISION) -> dict:
    return {
        "class_type": "Qwen3Loader",
        "inputs": {
            "repo_id": repo_id,
            "source": "HuggingFace",
            "precision": precision,
            "attention": attention,
            "local_model_path": "",
        },
        "_meta": {"title": f"Loader · {repo_id.split('/')[-1]}"},
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
    """Built-in speaker + optional instruct."""
    common = _common_qwen3_kwargs(p)
    return {
        "1": _loader(REPO_CUSTOM_VOICE),
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
        "5": _save_audio(["4", 0], prefix=prefix),
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
    nodes["5"] = _save_audio(["4", 0], prefix=prefix)
    return nodes


def _build_qwen3_voicebox_instruct(text: str, ref: Optional[str], p: dict, prefix: str) -> dict:
    common = _common_qwen3_kwargs(p)
    return {
        "1": _loader(REPO_CUSTOM_VOICE),
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
    nodes: dict = {"1": _loader(REPO_CUSTOM_VOICE)}
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
    "qwen3_voice_design": _build_qwen3_voice_design,
    "qwen3_custom_voice": _build_qwen3_custom_voice,
    "qwen3_voice_clone": _build_qwen3_voice_clone,
    "qwen3_base_custom_voice_clone_instruct": _build_qwen3_base_cv_clone_instruct,
    "qwen3_directed_clone_from_voice_design": _build_qwen3_voice_design,  # alias
    "qwen3_hybrid_clone_instruct_preset": _build_qwen3_hybrid,
    "qwen3_voicebox_instruct": _build_qwen3_voicebox_instruct,
    "qwen3_voicebox_clone_instruct": _build_qwen3_voicebox_clone_instruct,
    "s2pro_voice_design": _legacy_s2pro,
    "s2pro_voice_clone": _legacy_s2pro,
}


def infer_default_mode(tts_engine: str, has_ref_audio: bool) -> VoiceMode:
    """Pick a sensible default mode for callers that didn't set one (legacy DB rows)."""
    engine = (tts_engine or "qwen3").lower()
    if engine == "s2pro":
        return "s2pro_voice_clone" if has_ref_audio else "s2pro_voice_design"
    return "qwen3_voice_clone" if has_ref_audio else "qwen3_voice_design"
