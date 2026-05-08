"""
Bake the per-preset ffmpeg filter chains in
``backend/services/ffmpeg_utils.py::_COLOR_FILTERS`` into 3D LUT (.cube) files.

Why this exists
---------------
Strategy A pixel-perfect color match: the timeline preview renders in the
browser (WebGL2) and the final episode renders through ffmpeg. To guarantee
they look identical we bake ffmpeg's exact pipeline (eq → colorbalance →
curves) into a 33³ 3D LUT. ffmpeg renders apply the same LUT via
``lut3d=...cube`` and the WebGL2 LUTRenderer samples the same texture.

How it works
------------
1. Build a 33³ identity image: a 1089×33 PNG where pixel ``(b*33+r, g)`` has
   color ``(r/32, g/32, b/32)`` in [0..255]. Every grid point of the LUT cube
   appears once.
2. Run ffmpeg with the preset's filter chain on that PNG.
3. Read pixels back, write a Resolve-style .cube file (R varies fastest).

Outputs are written to ``assets/luts/<preset>.cube``. Re-running is
idempotent — files are overwritten.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from services.ffmpeg_utils import _COLOR_FILTERS  # noqa: E402

LUT_SIZE = 33  # 33 grid points per axis (35,937 entries total)
OUT_DIR = REPO_ROOT / "assets" / "luts"
BUILD_DIR = REPO_ROOT / "assets" / "lut_build"


def build_identity_image(n: int) -> np.ndarray:
    """Return an (n, n*n, 3) uint8 identity LUT image.

    Layout: ``image[g, b*n + r] = (r, g, b) * 255 / (n-1)``. Reading back the
    same coordinates after a per-pixel filter gives the LUT entry for that
    input color.
    """
    rs = np.arange(n, dtype=np.float32)
    gs = np.arange(n, dtype=np.float32)
    bs = np.arange(n, dtype=np.float32)
    R, G, B = np.meshgrid(rs, gs, bs, indexing="xy")
    # R,G,B shape: (n, n, n) with axes (g, r, b). Rearrange to (g, b*n + r).
    img = np.zeros((n, n * n, 3), dtype=np.float32)
    for b in range(n):
        for r in range(n):
            img[:, b * n + r, 0] = r
            img[:, b * n + r, 1] = np.arange(n)
            img[:, b * n + r, 2] = b
    img = (img / (n - 1)) * 255.0
    return img.round().clip(0, 255).astype(np.uint8)


def run_ffmpeg(src: Path, dst: Path, vfilters: list[str]) -> None:
    """Apply the filter chain to ``src`` and write ``dst`` (PNG, 8-bit RGB)."""
    chain = ",".join(vfilters) if vfilters else "null"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-vf",
        chain,
        "-pix_fmt",
        "rgb24",
        "-frames:v",
        "1",
        str(dst),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed for {dst.name}\nchain: {chain}\nstderr:\n{proc.stderr}"
        )


def write_cube(out_path: Path, preset: str, processed: np.ndarray, n: int) -> None:
    """Serialize processed pixels as a .cube file (R fastest, then G, then B)."""
    lines: list[str] = [
        f'TITLE "myaniform/{preset}"',
        f"LUT_3D_SIZE {n}",
        "DOMAIN_MIN 0.0 0.0 0.0",
        "DOMAIN_MAX 1.0 1.0 1.0",
        "",
    ]
    # processed shape: (n, n*n, 3) where row=g, col=b*n + r.
    # .cube ordering: for b in 0..n-1: for g in 0..n-1: for r in 0..n-1
    arr = processed.astype(np.float32) / 255.0
    for b in range(n):
        for g in range(n):
            for r in range(n):
                px = arr[g, b * n + r]
                lines.append(f"{px[0]:.6f} {px[1]:.6f} {px[2]:.6f}")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def bake_preset(preset: str, vfilters: list[str], identity_png: Path) -> Path:
    """Bake one preset and return the resulting .cube path."""
    out_png = BUILD_DIR / f"{preset}.png"
    run_ffmpeg(identity_png, out_png, vfilters)
    with Image.open(out_png) as im:
        rgb = np.asarray(im.convert("RGB"))
    if rgb.shape != (LUT_SIZE, LUT_SIZE * LUT_SIZE, 3):
        raise RuntimeError(
            f"unexpected processed image shape for {preset}: {rgb.shape}, "
            f"expected ({LUT_SIZE}, {LUT_SIZE * LUT_SIZE}, 3)"
        )
    out_cube = OUT_DIR / f"{preset}.cube"
    write_cube(out_cube, preset, rgb, LUT_SIZE)
    return out_cube


def main() -> int:
    parser = argparse.ArgumentParser(description="Bake color presets into 3D LUTs.")
    parser.add_argument(
        "--keep-build",
        action="store_true",
        help="Keep intermediate identity/processed PNGs in assets/lut_build.",
    )
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    identity = build_identity_image(LUT_SIZE)
    identity_png = BUILD_DIR / "identity.png"
    Image.fromarray(identity, mode="RGB").save(identity_png)

    presets = sorted(_COLOR_FILTERS.keys())
    print(f"Baking {len(presets)} preset(s) at LUT_3D_SIZE={LUT_SIZE} → {OUT_DIR}")
    for preset in presets:
        chain = _COLOR_FILTERS[preset]
        out = bake_preset(preset, chain, identity_png)
        size_kb = out.stat().st_size / 1024
        print(f"  ✓ {preset:18s} → {out.name}  ({size_kb:.1f} KB, {len(chain)} filters)")

    if not args.keep_build:
        shutil.rmtree(BUILD_DIR, ignore_errors=True)
    else:
        print(f"  (intermediate PNGs kept in {BUILD_DIR})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
