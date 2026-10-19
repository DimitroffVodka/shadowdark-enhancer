#!/usr/bin/env python3
"""Arena fight overlay art: assets/scenes/arena-fight/rings.webp (1600x1600, three gold range rings) and
480 px thumbs of the three arena pictures in assets/scenes/arena-fight/thumbs/. Deterministic, no randomness.

    python3 -I tools/arena-art/build-assets.py [--preview DIR]

The rings are placed as a Tile of S x S map pixels centred on the picture, so the ring centre radii here are
exactly 150 / 400 / 700 px of 1600 (Close 15 ft, Near 40 ft, Far 70 ft). No text is baked in; the game draws
the labels. The thumbs are reduced copies of the shipped arena pictures in assets/scenes/arena/.
Dev tooling only: nothing at runtime runs this.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "scenes" / "arena-fight"
SRC = ROOT / "assets" / "scenes" / "arena"
SIZE = 1600
RADII = {"Close": 150, "Near": 400, "Far": 700}
GOLD = (240, 150, 30)
HILITE = (255, 225, 140)
KEYCOL = (30, 12, 0)
CORE = 9
HI = 3
KEY_PAD = 5  # keyline reaches this many px beyond the core on each side
BLUR = 24
GLOW_ALPHA = 120  # additive-feel glow strength, 0-255
CORE_ALPHA = 255
KEY_ALPHA = 210
DISC_ALPHA = 24  # faint Close disc, under 0.12
THUMBS = {"arena-pit": "greybanner-arena", "arena-coliseum": "greybanner-coliseum-day", "arena-ring": "tournament-ring-tourney-day"}
THUMB_EDGE = 480


def ring_mask(radius: int, dashed: bool, width: int) -> Image.Image:
    """Antialiased ring (L mask) via 4x supersampling; dashed = 60 px dash, 40 px gap, round caps."""
    k = 4
    m = Image.new("L", (SIZE * k, SIZE * k), 0)
    d = ImageDraw.Draw(m)
    c = SIZE * k / 2
    r = radius * k
    box = [c - r, c - r, c + r, c + r]
    if not dashed:
        d.ellipse(box, outline=255, width=width * k)
    else:
        period = 100.0
        n = round(2 * math.pi * radius / period)
        step = 360.0 / n
        dash_deg = math.degrees(60.0 / radius)
        for i in range(n):
            a0 = i * step
            d.arc(box, a0, a0 + dash_deg, fill=255, width=width * k)
            for a in (a0, a0 + dash_deg):  # round caps
                x = c + r * math.cos(math.radians(a))
                y = c + r * math.sin(math.radians(a))
                h = width * k / 2
                d.ellipse([x - h, y - h, x + h, y + h], fill=255)
    return m.resize((SIZE, SIZE), Image.LANCZOS)


def build_rings() -> Image.Image:
    core = Image.new("L", (SIZE, SIZE), 0)
    glow = Image.new("L", (SIZE, SIZE), 0)
    for name, r in RADII.items():
        dashed = name == "Far"
        core = ImageChops.lighter(core, ring_mask(r, dashed, CORE))
        glow = ImageChops.lighter(glow, ring_mask(r, dashed, CORE * 3).filter(ImageFilter.GaussianBlur(BLUR)))
    glow = glow.point(lambda v: min(255, v * GLOW_ALPHA // 255 * 3))
    disc = Image.new("L", (SIZE * 4, SIZE * 4), 0)
    c, r = SIZE * 2, RADII["Close"] * 4
    ImageDraw.Draw(disc).ellipse([c - r, c - r, c + r, c + r], fill=DISC_ALPHA)
    disc = disc.resize((SIZE, SIZE), Image.LANCZOS)
    alpha = ImageChops.lighter(ImageChops.lighter(glow, disc), core.point(lambda v: v * CORE_ALPHA // 255))
    # keep the whole glow inside radius 800 so nothing touches the edge
    edge = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(edge).ellipse([0, 0, SIZE - 1, SIZE - 1], fill=255)
    alpha = ImageChops.multiply(alpha, edge)
    # thin dark keyline under the core so the gold still reads on sand and parchment
    key = Image.new("L", (SIZE, SIZE), 0)
    for n, r in RADII.items():
        key = ImageChops.lighter(key, ring_mask(r, n == "Far", CORE + 2 * KEY_PAD))
    hi = Image.new("L", (SIZE, SIZE), 0)
    for n, r in RADII.items():
        hi = ImageChops.lighter(hi, ring_mask(r, n == "Far", HI))
    im = Image.new("RGBA", (SIZE, SIZE), KEYCOL + (0,))
    im.putalpha(key.point(lambda v: v * KEY_ALPHA // 255))
    top = Image.new("RGBA", (SIZE, SIZE), GOLD + (0,))
    top.putalpha(alpha)
    im.alpha_composite(top)
    inner = Image.new("RGBA", (SIZE, SIZE), HILITE + (0,))
    inner.putalpha(hi)
    im.alpha_composite(inner)
    return im


def preview(rings: Image.Image, pic: Path, dest: Path) -> None:
    with Image.open(pic) as p:
        bg = p.convert("RGBA")
    s = min(bg.size)
    bg.alpha_composite(rings.resize((s, s), Image.LANCZOS), ((bg.width - s) // 2, (bg.height - s) // 2))
    d = ImageDraw.Draw(bg)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", max(14, s // 40))
    except OSError:
        font = ImageFont.load_default()
    cx, cy, k = bg.width / 2, bg.height / 2, s / SIZE
    tok = s // 32
    for i, (name, r) in enumerate(RADII.items()):
        d.text((cx, cy - r * k - tok), name, fill=(255, 201, 77), font=font, anchor="mb", stroke_width=2, stroke_fill=(0, 0, 0))
        for a in (60 + 70 * i, 200 + 50 * i, 300):
            x, y = cx + r * k * math.cos(math.radians(a)), cy + r * k * math.sin(math.radians(a))
            d.ellipse([x - tok, y - tok, x + tok, y + tok], fill=(60, 90, 160), outline=(255, 255, 255), width=3)
    dest.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").resize((bg.width * 900 // max(bg.size), bg.height * 900 // max(bg.size))).save(dest)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", type=Path, help="directory for the preview composites (outside the repo)")
    args = ap.parse_args()
    (OUT / "thumbs").mkdir(parents=True, exist_ok=True)
    rings = build_rings()
    rings.save(OUT / "rings.webp", "WEBP", quality=80, method=6, exact=True)
    for name, src in THUMBS.items():
        with Image.open(SRC / f"{src}.webp") as im:
            im = im.convert("RGB")
            t = THUMB_EDGE / max(im.size)
            im.resize((round(im.width * t), round(im.height * t)), Image.LANCZOS).save(OUT / "thumbs" / f"{name}.webp", "WEBP", quality=80, method=6)
    if args.preview:
        r = Image.open(OUT / "rings.webp").convert("RGBA")
        pl = ROOT / "assets" / "scenes" / "places"
        for n, f in (("pit", SRC / "greybanner-arena.webp"), ("coliseum", SRC / "greybanner-coliseum-day.webp"), ("ring", SRC / "tournament-ring-tourney-day.webp"),
                     ("tavern", pl / "tavern.webp"), ("town", pl / "town.webp"), ("market", pl / "market.webp")):
            preview(r, f, args.preview / f"{n}.png")
    for f in sorted(OUT.rglob("*.webp")):
        print(f.relative_to(ROOT), f.stat().st_size // 1024, "KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
