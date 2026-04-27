"""FFmpeg-based scene assembly and visual-novel finishing."""

import json
import subprocess
from pathlib import Path


def get_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", str(path)],
        capture_output=True, text=True, check=True,
    )
    for s in json.loads(result.stdout).get("streams", []):
        if s.get("codec_type") == "video":
            return float(s.get("duration", 0))
    return 0.0


def get_video_size(path: Path) -> tuple[int, int]:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", str(path)],
        capture_output=True, text=True, check=True,
    )
    for stream in json.loads(result.stdout).get("streams", []):
        if stream.get("codec_type") == "video":
            return int(stream["width"]), int(stream["height"])
    raise RuntimeError(f"비디오 스트림을 찾을 수 없습니다: {path}")


def extract_last_frame(video_path: Path, output_path: Path) -> Path:
    """Extract the final video frame as an image for chained scene starts."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    last_error = ""
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-sseof",
            "-5",
            "-i",
            str(video_path),
            "-vf",
            "reverse",
            "-frames:v",
            "1",
            "-update",
            "1",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    last_error = result.stderr
    if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
        return output_path

    seek = max(0.0, get_duration(video_path) - 0.2)
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{seek:.3f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-update",
            "1",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    last_error = result.stderr or last_error
    if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError(f"라스트프레임 추출 실패: {video_path}\n{last_error}")
    return output_path


def concat(
    clips: list[Path],
    transition: str = "fade",
    duration_frames: int = 8,
    fps: int = 24,
    project_id: str = "final",
    audio_sample_rate: int = 48000,
) -> Path:
    if len(clips) == 1:
        return clips[0]

    durations = [get_duration(c) for c in clips]
    target_w, target_h = get_video_size(clips[0])

    input_args = [arg for c in clips for arg in ("-i", str(c))]
    output = Path(f"output/{project_id}.mp4")
    output.parent.mkdir(exist_ok=True)

    if transition == "cut" or duration_frames <= 0:
        prep_parts = [
            (
                f"[{i}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
                f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1[vprep{i}]"
            )
            for i in range(len(clips))
        ]
        concat_inputs = "".join(f"[vprep{i}][{i}:a]" for i in range(len(clips)))
        fc = ";".join(prep_parts + [f"{concat_inputs}concat=n={len(clips)}:v=1:a=1[vout][aout]"])
        subprocess.run(
            ["ffmpeg", "-y"] + input_args + [
                "-filter_complex", fc,
                "-map", "[vout]", "-map", "[aout]",
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-ar", str(audio_sample_rate),
                str(output),
            ],
            check=True,
        )
        return output

    # 비디오 xfade 체인
    trans_sec = duration_frames / fps
    prep_parts = [
        (
            f"[{i}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1[vprep{i}]"
        )
        for i in range(len(clips))
    ]
    prev = "[vprep0]"
    v_parts = []
    offset = 0.0
    for i in range(len(clips) - 1):
        offset += durations[i] - trans_sec
        out = f"[v{i}]" if i < len(clips) - 2 else "[vout]"
        v_parts.append(
            f"{prev}[vprep{i+1}]xfade=transition={transition}:duration={trans_sec}:offset={round(offset,4)}{out}"
        )
        prev = f"[v{i}]"

    # 오디오 concat
    a_in = "".join(f"[{i}:a]" for i in range(len(clips)))
    a_filter = f"{a_in}concat=n={len(clips)}:v=0:a=1[aout]"

    fc = ";".join(prep_parts + v_parts) + ";" + a_filter

    subprocess.run(
        ["ffmpeg", "-y"] + input_args + [
            "-filter_complex", fc,
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", str(audio_sample_rate),
            str(output),
        ],
        check=True,
    )
    return output


def _ass_timestamp(seconds: float) -> str:
    centiseconds = int(round(max(0.0, seconds) * 100))
    cs = centiseconds % 100
    total_seconds = centiseconds // 100
    s = total_seconds % 60
    total_minutes = total_seconds // 60
    m = total_minutes % 60
    h = total_minutes // 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def write_ass_subtitles(
    subtitles: list[str],
    durations: list[float],
    *,
    output: Path,
    transition_sec: float,
    width: int,
    height: int,
    overlays: list[dict] | None = None,
    font_size: int = 34,
    margin_v: int = 34,
    outline: float = 2.4,
    shadow: float = 0.0,
) -> Path:
    """Write Korean VN-style subtitles timed to the generated scene clips."""
    output.parent.mkdir(parents=True, exist_ok=True)
    dialogue_style = (
        f"Style: Default,Malgun Gothic,{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H99000000,"
        f"0,0,0,0,100,100,0,0,1,{outline},{shadow},2,64,64,{margin_v},1"
    )
    title_style = (
        f"Style: Title,Malgun Gothic,{max(font_size + 10, 36)},&H00FFFFFF,&H000000FF,&H00201818,&H99000000,"
        "1,0,0,0,100,100,0,0,1,3.2,0,8,64,64,52,1"
    )
    sticker_style = (
        f"Style: Sticker,Malgun Gothic,{max(font_size - 2, 24)},&H00F8E6CE,&H000000FF,&H00241410,&HAA000000,"
        "1,0,0,0,100,100,0,0,1,2.6,0,9,48,56,48,1"
    )
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        (
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
            "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
            "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
        ),
        dialogue_style,
        title_style,
        sticker_style,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    scene_starts: list[float] = []
    cursor = 0.0
    for i, text in enumerate(subtitles):
        scene_starts.append(cursor)
        duration = durations[i] if i < len(durations) else 4.0
        if text:
            start = cursor + 0.45
            end = max(start + 1.0, cursor + duration - 0.45)
            safe_text = _ass_safe_text(text)
            lines.append(
                f"Dialogue: 0,{_ass_timestamp(start)},{_ass_timestamp(end)},Default,,0,0,0,,{safe_text}"
            )
        cursor += max(0.0, duration - transition_sec)

    for overlay in overlays or []:
        try:
            scene_index = int(overlay.get("scene_index", overlay.get("sceneIndex", 0)))
            if scene_index < 0 or scene_index >= len(scene_starts):
                continue
            text = str(overlay.get("text") or "").strip()
            if not text:
                continue
            start = scene_starts[scene_index] + max(0.0, float(overlay.get("start", 0.0) or 0.0))
            duration = max(0.25, float(overlay.get("duration", 3.0) or 3.0))
            kind = str(overlay.get("kind") or "caption")
            style_name = "Title" if kind == "title" else "Sticker" if kind == "sticker" else "Default"
            lines.append(
                f"Dialogue: 1,{_ass_timestamp(start)},{_ass_timestamp(start + duration)},{style_name},,0,0,0,,{_ass_safe_text(text)}"
            )
        except (TypeError, ValueError):
            continue
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output


def _ass_safe_text(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("\n", "\\N")
        .replace(",", "，")
        .replace("{", "(")
        .replace("}", ")")
    )


def _subtitle_fonts_dir(output: Path) -> Path | None:
    """Use a tiny fontsdir so libass does not scan the whole Windows Fonts tree."""
    candidates = [
        Path("/mnt/c/Windows/Fonts/malgun.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    font = next((path for path in candidates if path.exists()), None)
    if not font:
        return None

    fonts_dir = output.parent / "_subtitle_fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    target = fonts_dir / font.name
    if not target.exists():
        try:
            target.symlink_to(font)
        except OSError:
            target.write_bytes(font.read_bytes())
    return fonts_dir


def finish_visual_novel_episode(
    source: Path,
    *,
    output: Path,
    subtitles: list[str],
    scene_durations: list[float],
    transition_sec: float,
    width: int,
    height: int,
    audio_sample_rate: int = 48000,
    target_lufs: float | None = None,
    loudness_range_lu: float | None = None,
    color_preset: str = "reference_soft",
    grain_strength: int = 2,
    vignette_strength: float = 7.0,
    overlays: list[dict] | None = None,
    subtitle_style: dict | None = None,
) -> Path:
    """Apply a single VN finish pass: color grade, vignette, grain, subtitles."""
    output.parent.mkdir(parents=True, exist_ok=True)
    ass_path = output.with_suffix(".ass")
    write_ass_subtitles(
        subtitles,
        scene_durations,
        output=ass_path,
        transition_sec=transition_sec,
        width=width,
        height=height,
        overlays=overlays,
        font_size=int((subtitle_style or {}).get("font_size", 34)),
        margin_v=int((subtitle_style or {}).get("margin_v", 34)),
        outline=float((subtitle_style or {}).get("outline", 2.4)),
        shadow=float((subtitle_style or {}).get("shadow", 0.0)),
    )
    fonts_dir = _subtitle_fonts_dir(output)
    subtitle_filter = f"subtitles={ass_path}"
    if fonts_dir:
        subtitle_filter += f":fontsdir={fonts_dir}"
    color_filters = {
        "reference_soft": [
            "eq=contrast=0.88:saturation=0.78:brightness=0.035",
            "colorbalance=rs=0.04:gs=-0.015:bs=-0.035:rm=0.035:gm=-0.01:bm=-0.025",
            "curves=preset=lighter",
        ],
        "warm_room": [
            "eq=contrast=0.92:saturation=0.86:brightness=0.025",
            "colorbalance=rs=0.055:gs=0.005:bs=-0.045:rm=0.04:gm=0.0:bm=-0.03",
            "curves=preset=lighter",
        ],
        "clean_neutral": [
            "eq=contrast=0.98:saturation=0.92:brightness=0.01",
            "colorbalance=rs=0.015:gs=0.0:bs=-0.015",
        ],
        "dream_blush": [
            "eq=contrast=0.84:saturation=0.74:brightness=0.045",
            "colorbalance=rs=0.07:gs=-0.02:bs=-0.045:rm=0.055:gm=-0.012:bm=-0.03",
            "curves=preset=lighter",
        ],
    }
    vf_parts = list(color_filters.get(color_preset, color_filters["reference_soft"]))
    if vignette_strength > 0:
        vf_parts.append(f"vignette=PI/{max(1.0, vignette_strength)}")
    if grain_strength > 0:
        vf_parts.append(f"noise=alls={max(0, grain_strength)}:allf=t+u")
    vf_parts.append(subtitle_filter)
    vf = ",".join(vf_parts)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-vf",
        vf,
    ]
    if target_lufs is not None:
        lra = loudness_range_lu if loudness_range_lu is not None else 9.0
        cmd.extend(["-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA={lra}:linear=true"])
    cmd.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "17",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            str(audio_sample_rate),
            str(output),
        ]
    )
    subprocess.run(cmd, check=True)
    return output
