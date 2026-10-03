#!/usr/bin/env python3
"""Build the bastion art: assets/bastion/art/*.svg and assets/bastion/sprites.svg.

    python3 tools/bastion-art/build.py

The art is hand-authored vector, written as Python so every piece shares the
same primitives and palette (bastion_lib.py), in the style of the Crows village
set. Exterior pieces (house, outpost, keep, castle and the 20 upgrades) are
oblique and come with a separate cast shadow; `room-*` pieces are top-down floor
plan tiles (512x512, a door gap on the bottom edge) for the Plan tab's interior.

sprites.svg is every piece as a <symbol> plus the shared hatch patterns, loaded
once into the page so the plan can <use> them. An SVG used as an <img> cannot
share patterns, so the per-piece files serve actor and token art only.
"""
from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "assets" / "bastion"
MODULES = [
    "bastions",
    "upgrades_a", "upgrades_b", "upgrades_c", "upgrades_d",
    "rooms_a", "rooms_b", "rooms_c", "rooms_d", "rooms_e", "rooms_f",
]

sys.path.insert(0, str(HERE))
from bastion_lib import DEFS, FORBIDDEN, svg, shadow_svg  # noqa: E402

STROKE = 'stroke="#010206" stroke-linecap="round" stroke-linejoin="round"'


def load() -> dict[str, dict]:
    specs: dict[str, dict] = {}
    for name in MODULES:
        specs.update(importlib.import_module(name).specs)
    return specs


def check(slug: str, text: str, errors: list[str]) -> None:
    if FORBIDDEN.search(text):
        errors.append(f"{slug}: raster or foreignObject")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as err:
        errors.append(f"{slug}: {err}")
        return
    if root.get("viewBox") != "0 0 512 512":
        errors.append(f"{slug}: viewBox {root.get('viewBox')}")


def main() -> int:
    specs = load()
    art = OUT / "art"
    art.mkdir(parents=True, exist_ok=True)
    for stale in art.glob("*.svg"):
        stale.unlink()
    errors: list[str] = []
    symbols: list[str] = []
    for slug, spec in sorted(specs.items()):
        building = svg(spec["title"], spec.get("desc", f"{spec['title']} bastion art."), spec["body"])
        check(slug, building, errors)
        (art / f"{slug}.svg").write_text(building)
        if slug.startswith("room-"):
            symbols.append(f'<symbol id="r-{slug[5:]}" viewBox="0 0 512 512"><g {STROKE}>{spec["body"]}</g></symbol>')
            continue
        shadow = shadow_svg(spec["title"], spec["shadow"])
        check(f"{slug}.shadow", shadow, errors)
        (art / f"{slug}.shadow.svg").write_text(shadow)
        symbols.append(f'<symbol id="b-{slug}" viewBox="0 0 512 512"><g {STROKE}>{spec["body"]}</g></symbol>')
        symbols.append(f'<symbol id="s-{slug}" viewBox="0 0 512 512"><g transform="translate(28 16)" fill="#9699AE" opacity="0.46">{spec["shadow"]}</g></symbol>')
    defs = re.sub(r"^\s*<defs>|</defs>\s*$", "", DEFS.strip())
    tuft = '<symbol id="tuft" viewBox="0 0 14 10"><path d="M1 9 Q3 0 6 9 Q8 2 10 9 Q11 4 13 9 Z" fill="#687F64" stroke="#010206" stroke-width=".5"/></symbol>'
    sprites = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">'
        f"<defs>{defs}{tuft}{''.join(symbols)}</defs></svg>\n"
    )
    check("sprites", sprites.replace('width="0" height="0"', 'viewBox="0 0 512 512"'), errors)
    (OUT / "sprites.svg").write_text(sprites)
    print(f"{len(specs)} pieces, sprites.svg {len(sprites) // 1024} KB, {len(errors)} errors")
    for e in errors:
        print(" ", e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
