#!/usr/bin/env python3
"""Convert the encounter battle map sources to WebP: assets/scenes/encounter/<id>.webp, and a small
preview of each at assets/scenes/encounter/thumbs/<id>.webp for the picker.

    python3 tools/encounter-maps/build-assets.py [--src DIR] [id ...]

DIR (default ~/Downloads/two-minute/encounter-maps) holds catalog.json beside built/, camp/ and
packmaps/, every PNG already at 100 px per square. scripts/encounter/battle-maps/encounter-maps.mjs
is the library that names the same maps for the module; test/encounter-maps-library.test.mjs checks
the two agree, down to the size each WebP really has.

Every PNG is checked against the catalog BEFORE any file is written. A pack map whose file name
states no grid (Highland Pass, Beach Dunes, Rocky Coast, Jagged Cave, Luminescent Cave, Cobblestone
Highway, Wild Road, Haunted Marsh, Roadside Wilderness) was rescaled on an assumed square count; if
the catalog and the file ever disagree about a size, the build must stop rather than ship a map whose
tokens are the wrong size.

Full pictures are quality 80 with the slowest encoder method (smallest file); previews are 480 px on
the long side at quality 75. A source whose alpha is fully opaque is saved as RGB. The .webp files
stay out of git until the set has been reviewed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "scenes" / "encounter"
THUMBS = OUT / "thumbs"
DEFAULT_SRC = Path.home() / "Downloads" / "two-minute" / "encounter-maps"
FOLDER = {"Built": "built", "Camp": "camp", "Pack map": "packmaps"}  # catalog "kind" -> folder
GRID = 100
QUALITY = 80
THUMB_LONG_SIDE = 480
THUMB_QUALITY = 75

# In catalog.json but not shipped: a map whose art leaves the party nowhere to start. The library
# (encounter-maps.mjs) does not list it, and its test fails if a file for it turns up.
DROPPED = {
    "jungle-jungle-wetland": "a lily pond with a canoe 1.4 x 4.8 squares: no dry ground and no deck that holds a party",
}


def problems_with(entry: dict, path: Path) -> list[str]:
    """Why this source cannot be converted: missing, not the catalog's size, or off the 100 px grid."""
    name = entry["id"]
    if not path.exists():
        return [f"{name}: {path} is missing"]
    with Image.open(path) as im:
        size = list(im.size)
    found = []
    if size != entry["px"]:
        found.append(f"{name}: the PNG is {size[0]}x{size[1]} but catalog.json says {entry['px'][0]}x{entry['px'][1]}")
    if [n * GRID for n in entry["squares"]] != entry["px"]:
        found.append(f"{name}: catalog.json squares {entry['squares']} do not make px {entry['px']} at {GRID} px a square")
    if any(n % GRID for n in size):
        found.append(f"{name}: {size[0]}x{size[1]} is not a whole number of {GRID} px squares")
    return found


def convert(src: Path, dst: Path, thumb: Path) -> str:
    """Write dst as WebP and thumb as its preview; returns a note when the picture keeps real transparency."""
    with Image.open(src) as im:
        note = ""
        if im.mode == "RGBA" and im.getchannel("A").getextrema()[0] == 255:
            im = im.convert("RGB")
        elif im.mode == "RGBA":
            note = "  (keeps transparency)"
        im.save(dst, "WEBP", quality=QUALITY, method=6)
        k = THUMB_LONG_SIDE / max(im.size)
        small = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        small.save(thumb, "WEBP", quality=THUMB_QUALITY, method=6)
    return note


def main() -> int:
    ap = argparse.ArgumentParser(description="Convert the encounter battle map PNGs to WebP, with previews.")
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC, help="folder holding catalog.json, built/, camp/, packmaps/")
    ap.add_argument("ids", nargs="*", help="only these map ids (default: all)")
    args = ap.parse_args()

    everything = json.loads((args.src / "catalog.json").read_text())
    catalog = [e for e in everything if e["id"] not in DROPPED]
    unknown = set(args.ids) - {e["id"] for e in catalog}
    if unknown:
        print(f"not in catalog.json, or dropped: {', '.join(sorted(unknown))}", file=sys.stderr)
        return 1
    todo = [e for e in catalog if not args.ids or e["id"] in args.ids]

    sources = {e["id"]: args.src / FOLDER[e["kind"]] / f"{e['id']}.png" for e in todo}
    problems = [p for e in todo for p in problems_with(e, sources[e["id"]])]
    if problems:
        print("\n".join(problems), file=sys.stderr)
        print(f"\n{len(problems)} problem(s); nothing was written.", file=sys.stderr)
        return 1

    THUMBS.mkdir(parents=True, exist_ok=True)
    total = thumbs = 0
    for e in todo:
        dst, thumb = OUT / f"{e['id']}.webp", THUMBS / f"{e['id']}.webp"
        note = convert(sources[e["id"]], dst, thumb)
        total += dst.stat().st_size
        thumbs += thumb.stat().st_size
        print(f"{e['id']:30} {e['px'][0]}x{e['px'][1]:<5} {dst.stat().st_size / 1024:8.0f} KB {thumb.stat().st_size / 1024:6.0f} KB thumb{note}")
    print(f"{len(todo)} maps, {total / 1024 / 1024:.1f} MB + {thumbs / 1024 / 1024:.1f} MB of previews in {OUT.relative_to(ROOT)}")

    if not args.ids:
        shipped = {e["id"] for e in catalog}
        for folder in (OUT, THUMBS):
            for f in sorted(folder.glob("*.webp")):
                if f.stem not in shipped:
                    why = f" ({DROPPED[f.stem]})" if f.stem in DROPPED else ""
                    print(f"not shipped (left in place): {f.relative_to(OUT)}{why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
