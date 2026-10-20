#!/usr/bin/env python3
"""Convert the ready-place pictures to WebP: assets/scenes/places/<id>.webp (longest side at most 2048 px,
quality 82) and a 480 px preview at assets/scenes/places/thumbs/<id>.webp. Nothing uses them yet: they are kept
as ready backgrounds for a later landing-page plan.

    python3 tools/places-art/build-assets.py [--src DIR]

DIR (default ~/Downloads/two-minute) holds the owned packs. Each source zip is unpacked by hand into its own
empty directory first (they are untrusted archives), and DIR here is where those unpacked folders sit; the
paths below are relative to it. CREDITS.md credits each picture.
Dev tooling only: nothing at runtime runs this.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "scenes" / "places"
THUMBS = OUT / "thumbs"
MAX_EDGE = 2048
QUALITY = 82
THUMB_EDGE = 480
THUMB_QUALITY = 75

# id -> source picture, relative to --src (each pack unpacked into its own folder named as here).
SOURCES = {
    "tavern": "volume-9/Twilight Tavern/Twilight Tavern - Everyday - Light - Floor 1 - 22x16.jpg",
    "town": "town-center/Town Center - Clear - Day - 44x32.jpg",
    "market": "market-festival/MarketFestival.jpg",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=Path.home() / "Downloads" / "two-minute")
    args = ap.parse_args()
    missing = [str(args.src / p) for p in SOURCES.values() if not (args.src / p).exists()]
    if missing:
        print("missing sources:\n  " + "\n  ".join(missing), file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    THUMBS.mkdir(parents=True, exist_ok=True)
    for name, rel in SOURCES.items():
        with Image.open(args.src / rel) as im:
            im = im.convert("RGB")
            k = min(1.0, MAX_EDGE / max(im.size))
            full = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) if k < 1 else im
            full.save(OUT / f"{name}.webp", "WEBP", quality=QUALITY, method=6)
            t = THUMB_EDGE / max(full.size)
            full.resize((round(full.width * t), round(full.height * t)), Image.LANCZOS).save(THUMBS / f"{name}.webp", "WEBP", quality=THUMB_QUALITY, method=6)
        print(f"{name}: {(OUT / f'{name}.webp').stat().st_size // 1024} KB, thumb {(THUMBS / f'{name}.webp').stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
