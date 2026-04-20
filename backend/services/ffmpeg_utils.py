"""FFmpeg xfade 장면 연결."""

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


def concat(clips: list[Path], transition: str = "fade", duration_frames: int = 8, fps: int = 24, project_id: str = "final") -> Path:
    if len(clips) == 1:
        return clips[0]

    trans_sec = duration_frames / fps
    durations = [get_duration(c) for c in clips]

    input_args = [arg for c in clips for arg in ("-i", str(c))]

    # 비디오 xfade 체인
    prev = "[0:v]"
    v_parts = []
    offset = 0.0
    for i in range(len(clips) - 1):
        offset += durations[i] - trans_sec
        out = f"[v{i}]" if i < len(clips) - 2 else "[vout]"
        v_parts.append(
            f"{prev}[{i+1}:v]xfade=transition={transition}:duration={trans_sec}:offset={round(offset,4)}{out}"
        )
        prev = f"[v{i}]"

    # 오디오 concat
    a_in = "".join(f"[{i}:a]" for i in range(len(clips)))
    a_filter = f"{a_in}concat=n={len(clips)}:v=0:a=1[aout]"

    fc = ";".join(v_parts) + ";" + a_filter

    output = Path(f"output/{project_id}.mp4")
    output.parent.mkdir(exist_ok=True)

    subprocess.run(
        ["ffmpeg", "-y"] + input_args + [
            "-filter_complex", fc,
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k",
            str(output),
        ],
        check=True,
    )
    return output
