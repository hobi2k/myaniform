#!/usr/bin/env python3
"""Analyze and compare reference-video quality profiles."""

from __future__ import annotations

import argparse
import os
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.gold_fixture import build_quality_profile, compare_to_profile

DEFAULT_PROFILE = ROOT / "goldfixtures" / "heeheart_reference.profile.json"
SOURCE_ENV = "MYANIFORM_GOLD_FIXTURE_VIDEO"


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cmd_analyze(args: argparse.Namespace) -> None:
    raw_source = args.source or os.environ.get(SOURCE_ENV)
    if not raw_source:
        raise SystemExit(f"--source 또는 {SOURCE_ENV} 환경변수로 reference video 경로를 지정하세요.")
    source = Path(raw_source).expanduser()
    if not source.exists():
        raise FileNotFoundError(source)
    profile = build_quality_profile(source, scene_threshold=args.scene_threshold)
    profile["source"]["path"] = args.source_label
    profile["source"]["local_path_stored"] = False
    write_json(Path(args.output), profile)
    print(f"wrote {args.output}")
    print(
        "summary: "
        f"{profile['video']['width']}x{profile['video']['height']} "
        f"{profile['video']['fps']}fps, "
        f"{profile['video']['duration_sec']}s, "
        f"{profile['edit']['cut_count']} cuts"
    )


def cmd_compare(args: argparse.Namespace) -> None:
    profile = json.loads(Path(args.profile).read_text(encoding="utf-8"))
    result = compare_to_profile(profile, Path(args.candidate))
    if args.output:
        write_json(Path(args.output), result)
    print(json.dumps({"ok": result["ok"], "checks": result["checks"]}, ensure_ascii=False, indent=2))
    if not result["ok"]:
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(required=True)

    analyze = sub.add_parser("analyze", help="Create a structural quality profile from a reference video.")
    analyze.add_argument("--source")
    analyze.add_argument("--output", default=str(DEFAULT_PROFILE))
    analyze.add_argument("--scene-threshold", type=float, default=0.10)
    analyze.add_argument("--source-label", default="heeheart_reference")
    analyze.set_defaults(func=cmd_analyze)

    compare = sub.add_parser("compare", help="Compare a generated video against a saved quality profile.")
    compare.add_argument("--profile", default=str(DEFAULT_PROFILE))
    compare.add_argument("--candidate", required=True)
    compare.add_argument("--output")
    compare.set_defaults(func=cmd_compare)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
