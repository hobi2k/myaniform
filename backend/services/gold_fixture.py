"""Reference-video quality profiling without copying source frames or audio."""

from __future__ import annotations

import json
import re
import statistics
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ProbeVideo:
    width: int
    height: int
    fps: float
    duration_sec: float
    bitrate_kbps: float
    codec: str
    pix_fmt: str | None


@dataclass(frozen=True)
class ProbeAudio:
    codec: str | None
    sample_rate: int | None
    channels: int | None
    bitrate_kbps: float | None
    integrated_lufs: float | None
    loudness_range_lu: float | None


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, check=True)


def _ratio_to_float(raw: str | None) -> float:
    if not raw or raw == "0/0":
        return 0.0
    if "/" not in raw:
        return float(raw)
    num, den = raw.split("/", 1)
    denominator = float(den)
    return float(num) / denominator if denominator else 0.0


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    rank = (len(ordered) - 1) * pct
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def probe_media(path: Path) -> dict[str, Any]:
    result = _run([
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ])
    return json.loads(result.stdout)


def _probe_video_audio(path: Path) -> tuple[ProbeVideo, ProbeAudio]:
    payload = probe_media(path)
    fmt = payload.get("format", {})
    duration = float(fmt.get("duration") or 0)
    total_bitrate = float(fmt.get("bit_rate") or 0) / 1000

    video_stream = next((s for s in payload.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video_stream:
        raise RuntimeError(f"비디오 스트림을 찾을 수 없습니다: {path}")

    audio_stream = next((s for s in payload.get("streams", []) if s.get("codec_type") == "audio"), None)
    video = ProbeVideo(
        width=int(video_stream.get("width") or 0),
        height=int(video_stream.get("height") or 0),
        fps=_ratio_to_float(video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate")),
        duration_sec=float(video_stream.get("duration") or duration),
        bitrate_kbps=float(video_stream.get("bit_rate") or 0) / 1000 or total_bitrate,
        codec=str(video_stream.get("codec_name") or ""),
        pix_fmt=video_stream.get("pix_fmt"),
    )
    audio = ProbeAudio(
        codec=audio_stream.get("codec_name") if audio_stream else None,
        sample_rate=int(audio_stream["sample_rate"]) if audio_stream and audio_stream.get("sample_rate") else None,
        channels=int(audio_stream["channels"]) if audio_stream and audio_stream.get("channels") else None,
        bitrate_kbps=float(audio_stream.get("bit_rate") or 0) / 1000 if audio_stream else None,
        integrated_lufs=None,
        loudness_range_lu=None,
    )
    return video, audio


def detect_scene_cuts(path: Path, threshold: float = 0.32) -> list[float]:
    """Return detected hard-cut timestamps using ffmpeg scene scores."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-filter:v",
            f"select='gt(scene,{threshold})',showinfo",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr)
    cuts = sorted({float(match.group(1)) for match in re.finditer(r"pts_time:([0-9.]+)", result.stderr)})
    return [cut for cut in cuts if cut > 0.15]


def measure_loudness(path: Path) -> tuple[float | None, float | None]:
    """Measure integrated loudness without exporting source audio."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-filter:a",
            "ebur128=peak=true",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    text = result.stderr
    integrated = None
    loudness_range = None
    integrated_matches = re.findall(r"I:\s*(-?[0-9.]+)\s*LUFS", text)
    range_matches = re.findall(r"LRA:\s*([0-9.]+)\s*LU", text)
    if integrated_matches:
        integrated = float(integrated_matches[-1])
    if range_matches:
        loudness_range = float(range_matches[-1])
    return integrated, loudness_range


def build_quality_profile(path: Path, scene_threshold: float = 0.32) -> dict[str, Any]:
    video, audio = _probe_video_audio(path)
    integrated, loudness_range = measure_loudness(path)
    audio = ProbeAudio(
        codec=audio.codec,
        sample_rate=audio.sample_rate,
        channels=audio.channels,
        bitrate_kbps=audio.bitrate_kbps,
        integrated_lufs=integrated,
        loudness_range_lu=loudness_range,
    )

    cut_times = detect_scene_cuts(path, threshold=scene_threshold)
    boundaries = [0.0, *cut_times, video.duration_sec]
    shot_durations = [
        round(max(0.0, end - start), 3)
        for start, end in zip(boundaries, boundaries[1:])
        if end - start > 0.15
    ]
    aspect_ratio = video.width / video.height if video.height else 0

    profile = {
        "source": {
            "path": str(path),
            "profile_kind": "structural_quality_reference",
            "note": (
                "This profile stores technical and editorial structure only. "
                "It does not copy frames, audio, characters, dialogue, or story beats."
            ),
        },
        "video": {
            "width": video.width,
            "height": video.height,
            "aspect_ratio": round(aspect_ratio, 5),
            "fps": round(video.fps, 3),
            "duration_sec": round(video.duration_sec, 3),
            "bitrate_kbps": round(video.bitrate_kbps, 1),
            "codec": video.codec,
            "pix_fmt": video.pix_fmt,
        },
        "audio": {
            "codec": audio.codec,
            "sample_rate": audio.sample_rate,
            "channels": audio.channels,
            "bitrate_kbps": round(audio.bitrate_kbps, 1) if audio.bitrate_kbps is not None else None,
            "integrated_lufs": audio.integrated_lufs,
            "loudness_range_lu": audio.loudness_range_lu,
        },
        "edit": {
            "scene_threshold": scene_threshold,
            "cut_count": len(cut_times),
            "cut_times_sec": [round(c, 3) for c in cut_times],
            "shot_count": len(shot_durations),
            "shot_duration_sec": {
                "min": round(min(shot_durations), 3) if shot_durations else 0,
                "p25": round(_percentile(shot_durations, 0.25), 3),
                "median": round(statistics.median(shot_durations), 3) if shot_durations else 0,
                "p75": round(_percentile(shot_durations, 0.75), 3),
                "max": round(max(shot_durations), 3) if shot_durations else 0,
                "mean": round(statistics.fmean(shot_durations), 3) if shot_durations else 0,
            },
        },
        "quality_contract": {
            "target_aspect_ratio": round(aspect_ratio, 5),
            "target_fps": round(video.fps, 3),
            "target_pix_fmt": video.pix_fmt,
            "target_audio_sample_rate": audio.sample_rate,
            "target_audio_channels": audio.channels,
            "target_lufs": audio.integrated_lufs,
            "target_shot_median_sec": round(statistics.median(shot_durations), 3) if shot_durations else None,
            "target_shot_count_per_min": round(len(shot_durations) / max(video.duration_sec / 60, 0.001), 2),
        },
    }
    profile["render_spec"] = derive_render_spec(profile)
    return profile


def _align(value: int, divisor: int = 16) -> int:
    return max(divisor, round(value / divisor) * divisor)


def derive_render_spec(profile: dict[str, Any], target_width: int = 832) -> dict[str, Any]:
    """Translate a reference profile into generation/render defaults.

    The width defaults to 832 because the current Wan I2V/S2V workflows are tuned
    for 16GB-class GPUs. The aspect ratio, fps, audio format, shot pacing, and
    transition density still come from the reference.
    """
    contract = profile["quality_contract"]
    aspect = float(contract["target_aspect_ratio"])
    width = _align(target_width)
    height = _align(round(width / aspect))
    shot_median = contract.get("target_shot_median_sec") or 6.0
    return {
        "video": {
            "width": width,
            "height": height,
            "aspect_ratio": round(width / height, 5),
            "fps": round(float(contract["target_fps"]), 3),
            "pix_fmt": contract.get("target_pix_fmt") or "yuv420p",
            "format": "video/h264-mp4",
            "crf": 18,
        },
        "audio": {
            "sample_rate": contract.get("target_audio_sample_rate") or 48000,
            "channels": contract.get("target_audio_channels") or 2,
            "target_lufs": contract.get("target_lufs"),
            "loudness_range_lu": profile.get("audio", {}).get("loudness_range_lu"),
        },
        "editing": {
            "target_shot_median_sec": shot_median,
            "target_shot_count_per_min": contract["target_shot_count_per_min"],
            "transition_sec": round(min(0.45, max(0.18, shot_median * 0.05)), 3),
            "recommended_scene_count_for_70s": max(1, round(70 / shot_median)),
        },
        "target_duration_sec": float(profile.get("video", {}).get("duration_sec") or 70.0),
    }


def compare_to_profile(profile: dict[str, Any], candidate_path: Path) -> dict[str, Any]:
    candidate = build_quality_profile(candidate_path, scene_threshold=profile["edit"]["scene_threshold"])
    contract = profile["quality_contract"]

    checks: list[dict[str, Any]] = []

    def add_check(name: str, actual: Any, expected: Any, ok: bool, tolerance: str) -> None:
        checks.append({
            "name": name,
            "actual": actual,
            "expected": expected,
            "tolerance": tolerance,
            "ok": ok,
        })

    aspect = candidate["video"]["aspect_ratio"]
    target_aspect = contract["target_aspect_ratio"]
    add_check(
        "aspect_ratio",
        aspect,
        target_aspect,
        abs(aspect - target_aspect) <= 0.03,
        "+/-0.03",
    )

    fps = candidate["video"]["fps"]
    target_fps = contract["target_fps"]
    add_check("fps", fps, target_fps, abs(fps - target_fps) <= 3.0, "+/-3fps")

    sample_rate = candidate["audio"]["sample_rate"]
    add_check(
        "audio_sample_rate",
        sample_rate,
        contract["target_audio_sample_rate"],
        sample_rate == contract["target_audio_sample_rate"],
        "exact",
    )

    if contract.get("target_lufs") is not None and candidate["audio"].get("integrated_lufs") is not None:
        add_check(
            "integrated_lufs",
            candidate["audio"]["integrated_lufs"],
            contract["target_lufs"],
            abs(candidate["audio"]["integrated_lufs"] - contract["target_lufs"]) <= 4.0,
            "+/-4 LUFS",
        )

    candidate_shots = candidate["quality_contract"]["target_shot_count_per_min"]
    target_shots = contract["target_shot_count_per_min"]
    add_check(
        "shot_count_per_min",
        candidate_shots,
        target_shots,
        target_shots * 0.45 <= candidate_shots <= target_shots * 1.8,
        "45%-180% of reference",
    )

    return {
        "candidate": str(candidate_path),
        "ok": all(check["ok"] for check in checks),
        "checks": checks,
        "candidate_profile": candidate,
    }
