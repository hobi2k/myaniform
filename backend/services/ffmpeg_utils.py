"""FFmpeg-based scene assembly and visual-novel finishing."""

import hashlib
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


# ── M6: 색감 프리셋 → ffmpeg 필터 매핑 (글로벌과 per-clip 둘 다 사용) ──

_COLOR_FILTERS: dict[str, list[str]] = {
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


def color_filter_chain(preset: str) -> list[str]:
    """Public: returns ffmpeg filter chain for a color preset name."""
    return list(_COLOR_FILTERS.get(preset, _COLOR_FILTERS["reference_soft"]))


def add_bgm_track(
    main: Path,
    bgm: Path,
    *,
    output: Path,
    main_duration_sec: float,
    bgm_volume: float = 0.5,
    fade_in: float = 0.0,
    fade_out: float = 0.0,
    loop: bool = True,
) -> Path:
    """Mix a BGM stream into a finished video. BGM is gain-scaled, optionally
    looped to cover the entire main length, and faded in/out.

    The main stream's existing audio (voice/sfx mix) is preserved at unity gain.
    `amix` averages two streams by default — we restore loudness with a +6dB
    bump on the dry main signal so it doesn't drop when BGM joins.
    """
    output.parent.mkdir(parents=True, exist_ok=True)
    bgm_chain: list[str] = []
    if loop:
        # `aloop=loop=-1:size=2e9` repeats the input indefinitely; `atrim` then
        # cuts to main duration.
        bgm_chain.append("aloop=loop=-1:size=2e9")
    bgm_chain.append(f"volume={bgm_volume:.4f}")
    if fade_in > 0:
        bgm_chain.append(f"afade=t=in:st=0:d={fade_in:.3f}")
    if fade_out > 0:
        st = max(0.0, main_duration_sec - fade_out)
        bgm_chain.append(f"afade=t=out:st={st:.3f}:d={fade_out:.3f}")
    bgm_chain.append(f"atrim=duration={main_duration_sec:.3f}")
    bgm_chain.append("asetpts=PTS-STARTPTS")
    fc = (
        f"[1:a]{','.join(bgm_chain)}[bgm];"
        f"[0:a]volume=2.0[main];"  # +6dB to compensate amix averaging
        f"[main][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]"
    )
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(main),
            "-i", str(bgm),
            "-filter_complex", fc,
            "-map", "0:v",
            "-map", "[aout]",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            str(output),
        ],
        check=True,
    )
    return output


def _atempo_chain(speed: float) -> list[str]:
    """ffmpeg `atempo` accepts only 0.5..2.0. Chain multiple to support 0.25..4.0+.

    Composer M3 allows 0.25..4.0; we cap defensively here.
    """
    s = max(0.25, min(4.0, speed))
    parts: list[str] = []
    # Decompose into factors in [0.5, 2.0].
    while s > 2.0:
        parts.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        parts.append("atempo=0.5")
        s *= 2.0
    if abs(s - 1.0) > 1e-6:
        parts.append(f"atempo={s:.4f}")
    return parts or ["atempo=1.0"]


def prepare_clip(
    *,
    src: Path,
    work_dir: Path,
    scene_id: str,
    clip_in_offset_sec: float | None = None,
    clip_out_offset_sec: float | None = None,
    clip_speed: float | None = None,
    clip_voice_volume: float | None = None,
    clip_sfx_volume: float | None = None,
    clip_color_overlay: str | None = None,
) -> Path:
    """Pre-process a single clip applying Composer M3 per-clip settings.

    If no overrides are set, returns `src` directly to avoid a useless re-encode.
    Otherwise produces `work_dir/prepared_<scene_id>.mp4` and returns that path.

    Note on audio: we don't track separate voice/sfx streams in the rendered
    clip — they're already mixed by the per-scene generation. We use the
    multiplicative product of voice_volume * sfx_volume as the single audio
    gain applied to the baked stream. This is documented behavior; full
    per-track volume needs the audio split refactor in M6+.
    """
    has_trim = clip_in_offset_sec is not None or clip_out_offset_sec is not None
    has_speed = clip_speed is not None and abs(clip_speed - 1.0) > 1e-6
    voice = clip_voice_volume if clip_voice_volume is not None else 1.0
    sfx = clip_sfx_volume if clip_sfx_volume is not None else 1.0
    has_volume = abs(voice - 1.0) > 1e-6 or abs(sfx - 1.0) > 1e-6
    has_color = bool(clip_color_overlay)
    if not (has_trim or has_speed or has_volume or has_color):
        return src

    work_dir.mkdir(parents=True, exist_ok=True)

    # ── Cache key: src mtime + size + override params ──
    # If a previously prepared file exists with the same key, reuse it instead
    # of re-encoding. The key is stored in a sidecar `.cache_key` file next to
    # the output, so we can detect override changes across runs.
    try:
        src_stat = src.stat()
        cache_payload = json.dumps(
            {
                "src": str(src),
                "src_size": src_stat.st_size,
                "src_mtime_ns": src_stat.st_mtime_ns,
                "in": clip_in_offset_sec,
                "out": clip_out_offset_sec,
                "speed": clip_speed,
                "voice": clip_voice_volume,
                "sfx": clip_sfx_volume,
                "color": clip_color_overlay,
            },
            sort_keys=True,
        )
        cache_key = hashlib.sha1(cache_payload.encode()).hexdigest()[:16]
    except OSError:
        cache_key = None

    out = work_dir / f"prepared_{scene_id}.mp4"
    cache_marker = work_dir / f"prepared_{scene_id}.cache_key"
    if cache_key and out.exists() and cache_marker.exists():
        try:
            if cache_marker.read_text(encoding="utf-8").strip() == cache_key:
                # Cache hit — reuse without re-encoding.
                return out
        except OSError:
            pass

    in_args: list[str] = []
    if clip_in_offset_sec is not None and clip_in_offset_sec > 0:
        in_args += ["-ss", f"{clip_in_offset_sec:.4f}"]
    if clip_out_offset_sec is not None and clip_out_offset_sec > 0:
        in_args += ["-to", f"{clip_out_offset_sec:.4f}"]
    in_args += ["-i", str(src)]

    vfilters: list[str] = []
    afilters: list[str] = []
    if has_speed:
        vfilters.append(f"setpts=PTS/{clip_speed:.4f}")
        afilters.extend(_atempo_chain(clip_speed))  # type: ignore[arg-type]
    if has_color:
        vfilters.extend(color_filter_chain(clip_color_overlay))  # type: ignore[arg-type]
    if has_volume:
        afilters.append(f"volume={voice * sfx:.4f}")

    cmd = ["ffmpeg", "-y"] + in_args
    if vfilters:
        cmd += ["-vf", ",".join(vfilters)]
    if afilters:
        cmd += ["-af", ",".join(afilters)]
    cmd += [
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        str(out),
    ]
    subprocess.run(cmd, check=True)
    if cache_key:
        try:
            cache_marker.write_text(cache_key, encoding="utf-8")
        except OSError:
            pass
    return out


def concat(
    clips: list[Path],
    transition: str = "fade",
    duration_frames: int = 8,
    fps: int = 24,
    project_id: str = "final",
    audio_sample_rate: int = 48000,
    *,
    transitions: list[tuple[str, float]] | None = None,
) -> Path:
    if len(clips) == 1:
        return clips[0]

    durations = [get_duration(c) for c in clips]
    target_w, target_h = get_video_size(clips[0])

    input_args = [arg for c in clips for arg in ("-i", str(c))]
    output = Path(f"output/{project_id}.mp4")
    output.parent.mkdir(exist_ok=True)

    # Resolve per-boundary transitions. If `transitions` provided (list of
    # (style, sec) for each boundary, len = N-1), use it. Otherwise fall back
    # to the single global pair.
    n_bound = len(clips) - 1
    if transitions is None:
        global_sec = duration_frames / fps if duration_frames > 0 else 0.0
        boundaries = [(transition, global_sec) for _ in range(n_bound)]
    else:
        boundaries = list(transitions[:n_bound])
        while len(boundaries) < n_bound:
            boundaries.append(("cut", 0.0))

    # If every boundary is 'cut' or zero-duration, take the simple concat path.
    all_cut = all(s == "cut" or sec <= 0 for s, sec in boundaries)
    if all_cut:
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

    # 비디오 per-boundary xfade 체인
    prep_parts = [
        (
            f"[{i}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1[vprep{i}]"
        )
        for i in range(len(clips))
    ]
    prev = "[vprep0]"
    v_parts: list[str] = []
    offset = 0.0
    cumulative_offset = 0.0
    for i in range(n_bound):
        b_style, b_sec = boundaries[i]
        if b_style == "cut" or b_sec <= 0:
            # No xfade; clip i+1 starts exactly when clip i ends. Use a 1-frame
            # zero-duration xfade trick won't work cleanly; instead we fall back
            # to the global average offset and a tiny duration. For "cut" mid-
            # chain we synthesize an instant fade (1-frame).
            b_style = "fade"
            b_sec = 1.0 / max(1, fps)
        offset = durations[i] - b_sec
        cumulative_offset += offset
        is_last = i == n_bound - 1
        out = "[vout]" if is_last else f"[v{i}]"
        v_parts.append(
            f"{prev}[vprep{i+1}]xfade=transition={b_style}:duration={b_sec:.4f}:offset={round(cumulative_offset,4)}{out}"
        )
        prev = f"[v{i}]"

    # 오디오: per-boundary acrossfade chain (same lengths as video boundaries
    # so audio stays in sync). Falls back to plain concat for cuts.
    if all(b[0] == "cut" or b[1] <= 0 for b in boundaries):
        a_in = "".join(f"[{i}:a]" for i in range(len(clips)))
        a_filter = f"{a_in}concat=n={len(clips)}:v=0:a=1[aout]"
    else:
        a_prev = "[0:a]"
        a_parts: list[str] = []
        for i in range(n_bound):
            b_style, b_sec = boundaries[i]
            if b_style == "cut" or b_sec <= 0:
                b_sec = 1.0 / max(1, fps)
            is_last = i == n_bound - 1
            out = "[aout]" if is_last else f"[a{i}]"
            a_parts.append(
                f"{a_prev}[{i+1}:a]acrossfade=d={b_sec:.4f}:c1=tri:c2=tri{out}"
            )
            a_prev = f"[a{i}]"
        a_filter = ";".join(a_parts)

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
    boundary_secs: list[float] | None = None,
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
    # Per-boundary transition seconds drive scene placement on the master
    # timeline. If `boundary_secs` provided (len = len(subtitles) - 1) it
    # overrides the global `transition_sec` for each boundary independently.
    def _trans_after(i: int) -> float:
        if i >= len(subtitles) - 1:
            return 0.0
        if boundary_secs is not None and i < len(boundary_secs):
            return max(0.0, float(boundary_secs[i]))
        return max(0.0, float(transition_sec))

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
        cursor += max(0.0, duration - _trans_after(i))

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
            # Compose inline ASS override codes for M5 fields.
            override = _ass_override_for_overlay(overlay, width=width, height=height)
            body = f"{override}{_ass_safe_text(text)}" if override else _ass_safe_text(text)
            lines.append(
                f"Dialogue: 1,{_ass_timestamp(start)},{_ass_timestamp(start + duration)},{style_name},,0,0,0,,{body}"
            )
        except (TypeError, ValueError):
            continue
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output


def _ass_color_from_css(css: str | None) -> str | None:
    """Convert a CSS color (#rrggbb / rgba(r,g,b,a) / 'white') to ASS &Hbbggrr&.

    ASS uses BGR (not RGB) and an opacity-prefixed form for transparency
    (&HAABBGGRR) — we only emit RGB form for simplicity. Returns None if
    parsing fails (caller leaves color unchanged).
    """
    if not css:
        return None
    s = css.strip().lower()
    named = {
        "white": (255, 255, 255), "black": (0, 0, 0),
        "red": (255, 0, 0), "green": (0, 255, 0), "blue": (0, 0, 255),
    }
    if s in named:
        r, g, b = named[s]
    elif s.startswith("#"):
        hexstr = s[1:]
        if len(hexstr) == 3:
            hexstr = "".join(c + c for c in hexstr)
        if len(hexstr) != 6:
            return None
        try:
            r = int(hexstr[0:2], 16)
            g = int(hexstr[2:4], 16)
            b = int(hexstr[4:6], 16)
        except ValueError:
            return None
    elif s.startswith("rgb"):
        # rgb(r,g,b) or rgba(r,g,b,a)
        inside = s[s.find("(") + 1: s.rfind(")")]
        parts = [p.strip() for p in inside.split(",")]
        if len(parts) < 3:
            return None
        try:
            r = int(float(parts[0]))
            g = int(float(parts[1]))
            b = int(float(parts[2]))
        except ValueError:
            return None
    else:
        return None
    return f"&H{b:02X}{g:02X}{r:02X}&"


def _ass_override_for_overlay(overlay: dict, *, width: int, height: int) -> str:
    """Build the ASS override block (`{\\...}`) for the M5 overlay fields.

    Supported:
      - x, y (0..1) → \\pos(x_px, y_px) + \\an5 (centered)
      - rotation → \\frz<deg>
      - font_size → \\fs<n>
      - color → \\1c<color>&
      - outline / outline_width → \\3c + \\bord
      - font_weight ≥ 600 → \\b1
      - animation_in/out (fade only) → \\fad(in_ms, out_ms)
        slide_*/scale → not directly supported by ASS without prerendered PNGs;
        we approximate slide_up with \\move; scale and slide_left/right are
        ignored (fall back to no-op).
    """
    parts: list[str] = []
    x = overlay.get("x")
    y = overlay.get("y")
    rotation = overlay.get("rotation")
    font_size = overlay.get("font_size")
    font_weight = overlay.get("font_weight")
    color = overlay.get("color")
    outline = overlay.get("outline")
    outline_width = overlay.get("outline_width")
    anim_in = overlay.get("animation_in")
    anim_out = overlay.get("animation_out")
    anim_dur = overlay.get("animation_duration") or 0.4

    # Position (centered) when x/y given.
    if isinstance(x, (int, float)) and isinstance(y, (int, float)):
        px = int(round(float(x) * width))
        py = int(round(float(y) * height))
        parts.append("\\an5")  # alignment 5 = center middle (so \pos centers the box)
        if anim_in == "slide_up":
            from_y = py + 80
            parts.append(f"\\move({px},{from_y},{px},{py},0,{int(anim_dur * 1000)})")
        elif anim_in == "slide_left":
            from_x = px - 80
            parts.append(f"\\move({from_x},{py},{px},{py},0,{int(anim_dur * 1000)})")
        else:
            parts.append(f"\\pos({px},{py})")

    if isinstance(rotation, (int, float)) and abs(float(rotation)) > 0.01:
        parts.append(f"\\frz{float(rotation):.1f}")

    if isinstance(font_size, (int, float)) and font_size > 0:
        parts.append(f"\\fs{int(font_size)}")

    if isinstance(font_weight, (int, float)) and font_weight >= 600:
        parts.append("\\b1")

    c = _ass_color_from_css(color if isinstance(color, str) else None)
    if c:
        parts.append(f"\\1c{c}")

    o = _ass_color_from_css(outline if isinstance(outline, str) else None)
    if o:
        parts.append(f"\\3c{o}")

    if isinstance(outline_width, (int, float)):
        parts.append(f"\\bord{max(0.0, float(outline_width)):.1f}")

    # Fade in/out — only when at least one is "fade". Otherwise skip.
    fade_in_ms = int(anim_dur * 1000) if anim_in == "fade" else 0
    fade_out_ms = int(anim_dur * 1000) if anim_out == "fade" else 0
    if fade_in_ms > 0 or fade_out_ms > 0:
        parts.append(f"\\fad({fade_in_ms},{fade_out_ms})")

    if not parts:
        return ""
    return "{" + "".join(parts) + "}"


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
    boundary_secs: list[float] | None = None,
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
        boundary_secs=boundary_secs,
    )
    fonts_dir = _subtitle_fonts_dir(output)
    subtitle_filter = f"subtitles={ass_path}"
    if fonts_dir:
        subtitle_filter += f":fontsdir={fonts_dir}"
    vf_parts = color_filter_chain(color_preset)
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
