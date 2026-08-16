#!/usr/bin/env python3
"""
Build the Thraxis Arena battle map (Cursed Scroll 2, pg. 23).

CS2 describes the arena and prints no map, so this draws one from the
description rather than reproducing anything: a broad slab of striated granite
raised out of desert sand, its surface worn smooth and bloodstained, ringed by
torches plunged haphazardly into the sand, with the dark beyond where the crowd
watches.

Two artefacts come out, and they must agree:

  assets/scenes/thraxis-arena.webp          the painted map
  scripts/pit-fighting/arena-layout.mjs     where the torches are

The module builds the scene's AmbientLights from the second, so a light lands on
every torch that was painted. Emitting both from one run is the only way to keep
them in step — hand-placed lights drift the moment the map is regenerated.

The layout is deterministic: SEED fixes the "haphazard" torch ring, so
regenerating produces the same map and the same lights.

Run:  python3 tools/arena/build-thraxis-arena.py
"""

import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# ── Geometry, in pixels ──────────────────────────────────────────────────────
# 100 px per grid square, 5 ft per square: a 2000 px map is 100 ft across, and
# the ring is 65 ft — big enough that a Shadowdark "near" move (30 ft) crosses
# less than half of it, so position on the slab actually matters.
SIZE = 2000
GRID = 100
FEET_PER_SQUARE = 5
CENTRE = SIZE // 2
SLAB_RADIUS = 650
SEED = 20260730

REPO = Path(__file__).resolve().parents[2]
IMAGE_OUT = REPO / "assets" / "scenes" / "thraxis-arena.webp"
LAYOUT_OUT = REPO / "scripts" / "pit-fighting" / "arena-layout.mjs"

# ── Palette ──────────────────────────────────────────────────────────────────
SAND_BASE = (156, 128, 88)
SAND_DARK = (108, 88, 60)
GRANITE_BASE = (128, 124, 118)
GRANITE_BAND_LIGHT = (152, 148, 141)
GRANITE_BAND_DARK = (104, 100, 95)
BLOOD = (78, 34, 30)
TORCH_GLOW = (232, 150, 62)


def _grain(size, rng, amount=30, scale=2):
    """
    A grain overlay, so nothing reads as a flat digital fill.

    Built small and scaled up: per-pixel randomness at 2000x2000 is both slow and
    too fine to survive WebP, whereas grain generated at 1/scale and enlarged
    lands at a size the eye reads as grit.
    """
    small = Image.new("L", (size // scale, size // scale))
    small.putdata([rng.randint(128 - amount, 128 + amount)
                   for _ in range(small.width * small.height)])
    grain = small.resize((size, size), Image.NEAREST)
    layer = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    # Deviation from mid-grey becomes alpha; sign becomes light or dark.
    layer.putdata([
        ((255, 250, 240, (v - 128) // 2) if v > 128 else (24, 18, 10, (128 - v) // 2))
        for v in grain.getdata()
    ])
    return layer


def _draw_sand(img, rng):
    """Desert floor: base tone, wind ripples, drift shadows, then grit."""
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, SIZE, SIZE], fill=SAND_BASE)

    # Broad tonal drift, so the sand is not one flat colour under the vignette.
    drift = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ddraw = ImageDraw.Draw(drift)
    for _ in range(40):
        r = rng.randint(300, 800)
        cx, cy = rng.randint(0, SIZE), rng.randint(0, SIZE)
        tone = SAND_DARK if rng.random() < 0.5 else (196, 168, 120)
        ddraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*tone, 14))
    img.alpha_composite(drift.filter(ImageFilter.GaussianBlur(120)))

    # Wind ripples — long shallow arcs all running the same way, as dunes do.
    # Drawn as light/dark pairs so each ripple has a lit face and a shadow,
    # which is what actually makes sand read as sand from above.
    ripple = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(ripple)
    for _ in range(320):
        y = rng.randint(-300, SIZE + 300)
        x = rng.randint(-500, SIZE)
        length = rng.randint(400, 1100)
        sag = rng.randint(30, 90)
        w = rng.randint(4, 11)
        box = [x, y, x + length, y + sag * 2]
        rdraw.arc(box, start=200, end=340, fill=(*SAND_DARK, rng.randint(26, 52)), width=w)
        rdraw.arc([box[0], box[1] - w, box[2], box[3] - w], start=200, end=340,
                  fill=(214, 190, 142, rng.randint(18, 38)), width=max(2, w - 2))
    img.alpha_composite(ripple.filter(ImageFilter.GaussianBlur(2.5)))

    img.alpha_composite(_grain(SIZE, rng, amount=34, scale=2))


def _draw_slab(img, rng):
    """The granite ring: raised edge, striations, polish, bloodstain."""
    # The six-foot rise, as a drop shadow cast outward onto the sand.
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.ellipse(_box(SLAB_RADIUS + 26), fill=(20, 14, 8, 150))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(22)))

    # Slab body.
    slab = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(slab).ellipse(_box(SLAB_RADIUS), fill=(*GRANITE_BASE, 255))

    # Striations — the book's word. Parallel bands of varying width and tone,
    # drawn across the whole slab and clipped to it.
    bands = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(bands)
    y = -SIZE
    while y < SIZE * 2:
        width = rng.randint(6, 34)
        tone = GRANITE_BAND_LIGHT if rng.random() < 0.5 else GRANITE_BAND_DARK
        bdraw.rectangle([-SIZE, y, SIZE * 2, y + width], fill=(*tone, rng.randint(30, 70)))
        y += width + rng.randint(4, 26)
    bands = bands.rotate(24, resample=Image.BICUBIC)
    bands = bands.filter(ImageFilter.GaussianBlur(0.6))
    slab.alpha_composite(bands)

    # Fractures. A few long dark splits following the grain, plus hairlines —
    # granite worked this hard does not stay whole.
    fdraw = ImageDraw.Draw(slab)
    for _ in range(9):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0, SLAB_RADIUS * 0.8)
        x, y = CENTRE + math.cos(a) * d, CENTRE + math.sin(a) * d
        heading = math.radians(24) + rng.uniform(-0.5, 0.5)
        for _ in range(rng.randint(6, 14)):
            length = rng.randint(30, 90)
            nx, ny = x + math.cos(heading) * length, y + math.sin(heading) * length
            if math.hypot(nx - CENTRE, ny - CENTRE) > SLAB_RADIUS - 12:
                break
            fdraw.line([x, y, nx, ny], fill=(64, 60, 57, rng.randint(70, 130)),
                       width=rng.randint(1, 4))
            x, y = nx, ny
            heading += rng.uniform(-0.35, 0.35)

    # Worn smooth by the crush of countless feet: a broad highlight where the
    # traffic is. Kept subtle — at full strength it bleaches the stone and the
    # bloodstains underneath vanish.
    polish = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(polish)
    for i in range(12):
        r = int(SLAB_RADIUS * (0.66 - i * 0.05))
        if r <= 0:
            break
        pdraw.ellipse(_box(r), fill=(255, 250, 240, 4))
    slab.alpha_composite(polish.filter(ImageFilter.GaussianBlur(50)))

    # Bloodsoaked. Painted AFTER the polish: soaked-in blood sits on the worn
    # surface, and putting it underneath washed it out to pink.
    blood = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    bl = ImageDraw.Draw(blood)
    for _ in range(30):
        r = rng.randint(50, 230)
        d = rng.uniform(0, SLAB_RADIUS * 0.7)
        a = rng.uniform(0, math.tau)
        cx, cy = CENTRE + math.cos(a) * d, CENTRE + math.sin(a) * d
        bl.ellipse([cx - r, cy - r * rng.uniform(0.6, 1.0),
                    cx + r * rng.uniform(0.6, 1.0), cy + r],
                   fill=(*BLOOD, rng.randint(46, 92)))
    blood = blood.filter(ImageFilter.GaussianBlur(28))

    # Spatter goes on sharp, over the soaked-in pooling. Cast in BURSTS rather
    # than scattered evenly: blood arrives from a blow at one spot, so each
    # burst throws droplets outward along one heading, stretched in the
    # direction they flew and thinning with distance. Evenly-spread circles of
    # one size read as polka dots, which is exactly what the first pass looked
    # like.
    sp = ImageDraw.Draw(blood)
    for _ in range(22):
        ba = rng.uniform(0, math.tau)
        bd = rng.uniform(0, SLAB_RADIUS * 0.8)
        bx, by = CENTRE + math.cos(ba) * bd, CENTRE + math.sin(ba) * bd
        heading = rng.uniform(0, math.tau)
        spread = rng.uniform(0.35, 1.1)
        for _ in range(rng.randint(14, 40)):
            fly = heading + rng.uniform(-spread, spread)
            dist = rng.uniform(6, 190) ** rng.uniform(0.85, 1.0)
            dx, dy = bx + math.cos(fly) * dist, by + math.sin(fly) * dist
            if math.hypot(dx - CENTRE, dy - CENTRE) > SLAB_RADIUS - 8:
                continue
            # Farther droplets are smaller and fainter, and elongate along
            # their flight path.
            fade = 1 - min(dist / 200, 0.82)
            r = max(1.4, rng.uniform(1.5, 8.5) * fade)
            stretch = 1 + rng.uniform(0.2, 2.4) * (1 - fade)
            ex, ey = math.cos(fly) * r * stretch, math.sin(fly) * r * stretch
            sp.ellipse([dx - abs(ex) - r * 0.4, dy - abs(ey) - r * 0.4,
                        dx + abs(ex) + r * 0.4, dy + abs(ey) + r * 0.4],
                       fill=(*BLOOD, int(rng.randint(80, 170) * (0.45 + fade * 0.55))))

    # Drag marks: something was hauled off the stone. Broken into segments that
    # thin and fade along the way, because one straight line at full opacity
    # read as a pink stick lying on the slab.
    for _ in range(11):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(SLAB_RADIUS * 0.15, SLAB_RADIUS * 0.7)
        x, y = CENTRE + math.cos(a) * d, CENTRE + math.sin(a) * d
        drag = rng.uniform(0, math.tau)
        width = rng.uniform(10, 22)
        alpha = rng.randint(70, 120)
        for step in range(rng.randint(5, 11)):
            length = rng.uniform(18, 46)
            nx, ny = x + math.cos(drag) * length, y + math.sin(drag) * length
            if math.hypot(nx - CENTRE, ny - CENTRE) > SLAB_RADIUS - 10:
                break
            sp.line([x, y, nx, ny], fill=(*BLOOD, max(12, int(alpha))),
                    width=max(2, int(width)))
            x, y = nx, ny
            width *= rng.uniform(0.72, 0.92)
            alpha *= rng.uniform(0.68, 0.88)
            drag += rng.uniform(-0.18, 0.18)

    slab.alpha_composite(blood)
    slab.alpha_composite(_grain(SIZE, rng, amount=26, scale=2))

    # Clip everything to the slab, once, at the end. Compositing through a
    # paste-with-mask on each step softened the edges into a grey halo.
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).ellipse(_box(SLAB_RADIUS), fill=255)
    slab.putalpha(Image.composite(slab.getchannel("A"), Image.new("L", (SIZE, SIZE), 0), mask))

    # A lip of lighter stone at the rim, so the edge reads as a cut face rather
    # than a circle drawn on sand.
    rim = ImageDraw.Draw(slab)
    rim.ellipse(_box(SLAB_RADIUS - 3), outline=(178, 172, 163, 210), width=8)
    rim.ellipse(_box(SLAB_RADIUS - 13), outline=(84, 80, 76, 140), width=6)

    img.alpha_composite(slab)


def _torch_positions(rng):
    """
    A haphazard ring of torches plunged into the sand.

    Haphazard, not random: each torch is jittered off an even spacing, which
    keeps the ring readable while stopping it looking surveyed. They sit in the
    SAND, just outside the slab, which is where the book puts them.
    """
    count = 11
    positions = []
    for i in range(count):
        angle = (math.tau / count) * i + rng.uniform(-0.16, 0.16)
        radius = SLAB_RADIUS + rng.randint(46, 104)
        positions.append({
            "x": round(CENTRE + math.cos(angle) * radius),
            "y": round(CENTRE + math.sin(angle) * radius),
        })
    return positions


def _draw_torches(img, torches, rng):
    """
    Paint each torch and the pool of light it throws.

    The glow is painted as well as lit in Foundry: a GM who turns lighting off,
    or looks at the thumbnail, should still see a torchlit ring rather than a
    grey slab in a black square.

    Returns the FLAME position of each torch. The entry in `torches` is where
    the stake was driven into the sand; the fire burns at the top of it, a leant
    stake's length away. Foundry's light belongs at the flame, not at the base —
    they are about 3 ft apart, which is most of a grid square.

    The lean and height are rolled HERE rather than in `_torch_positions` on
    purpose: moving those two rng draws earlier would shift every later draw and
    regenerate a different map.
    """
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    for t in torches:
        for r, a in ((260, 20), (180, 26), (110, 38), (56, 58)):
            gdraw.ellipse([t["x"] - r, t["y"] - r, t["x"] + r, t["y"] + r],
                          fill=(*TORCH_GLOW, a))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(34)))

    flames = []
    for t in torches:
        x, y = t["x"], t["y"]
        # Each torch leans its own way — they were shoved into sand, not set.
        lean = rng.uniform(-0.30, 0.30)
        height = rng.randint(52, 68)
        tipx, tipy = x + math.sin(lean) * height, y - math.cos(lean) * height
        flames.append({"x": round(tipx), "y": round(tipy)})

        # The shadow it throws back onto the sand, opposite the flame.
        shade = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        ImageDraw.Draw(shade).line(
            [x, y, x - math.sin(lean) * 46, y + math.cos(lean) * 46],
            fill=(18, 12, 6, 120), width=16)
        img.alpha_composite(shade.filter(ImageFilter.GaussianBlur(9)))

        tdraw = ImageDraw.Draw(img)
        # Sand heaped where it was driven in.
        tdraw.ellipse([x - 20, y - 9, x + 20, y + 11], fill=(132, 108, 74, 190))
        # The shaft, tapering toward the head.
        tdraw.line([x, y, tipx, tipy], fill=(52, 36, 22, 255), width=11)
        tdraw.line([x, y, tipx, tipy], fill=(78, 56, 34, 200), width=5)
        # Pitch-soaked wrapping at the head.
        tdraw.ellipse([tipx - 15, tipy - 15, tipx + 15, tipy + 15], fill=(40, 26, 16, 255))
        # The flame: outer body, then a hot core, offset a little so it reads
        # as burning upward rather than as a bead on a stick.
        tdraw.ellipse([tipx - 21, tipy - 30, tipx + 21, tipy + 14], fill=(*TORCH_GLOW, 245))
        tdraw.ellipse([tipx - 13, tipy - 24, tipx + 13, tipy + 6], fill=(255, 206, 116, 250))
        tdraw.ellipse([tipx - 6, tipy - 17, tipx + 6, tipy + 1], fill=(255, 246, 214, 255))

    return flames


def _draw_night(img):
    """
    Spectators watch from the edge of darkness. A vignette carries the eye to
    the ring and leaves the rim of the map dark, where the crowd is.
    """
    vignette = Image.new("L", (SIZE, SIZE), 0)
    vdraw = ImageDraw.Draw(vignette)
    steps = 90
    for i in range(steps):
        r = int(SIZE * 0.78 * (1 - i / steps)) + SLAB_RADIUS // 2
        vdraw.ellipse(_box(r), fill=int(215 * (i / steps)))
    vignette = vignette.filter(ImageFilter.GaussianBlur(90))
    dark = Image.new("RGBA", (SIZE, SIZE), (6, 8, 16, 255))
    dark.putalpha(Image.eval(vignette, lambda v: 255 - v))
    img.alpha_composite(dark)


def _box(radius):
    return [CENTRE - radius, CENTRE - radius, CENTRE + radius, CENTRE + radius]


def _write_layout(torches, flames):
    merged = [
        {"x": t["x"], "y": t["y"], "flameX": f["x"], "flameY": f["y"]}
        for t, f in zip(torches, flames)
    ]
    lights = (json.dumps(merged, indent=2)
              .replace('"x"', "x").replace('"y"', "y")
              .replace('"flameX"', "flameX").replace('"flameY"', "flameY"))
    LAYOUT_OUT.parent.mkdir(parents=True, exist_ok=True)
    LAYOUT_OUT.write_text(f'''/**
 * Thraxis Arena — where the map's torches are (Cursed Scroll 2, pg. 23).
 *
 * GENERATED by tools/arena/build-thraxis-arena.py. Do not hand-edit: the
 * coordinates here are the ones the map was PAINTED with, and the scene builder
 * puts an AmbientLight on each. Editing one side alone puts lights where there
 * are no torches.
 *
 * Regenerate with:  python3 tools/arena/build-thraxis-arena.py
 */

/** Map size in pixels; square, and a multiple of the grid. */
export const ARENA_SIZE = {SIZE};

/** Pixels per grid square, and what one square means in feet. */
export const ARENA_GRID = {GRID};
export const ARENA_FEET_PER_SQUARE = {FEET_PER_SQUARE};

/** Radius of the granite slab in pixels — the fighting surface. */
export const ARENA_SLAB_RADIUS = {SLAB_RADIUS};

/**
 * Where each torch stands, in map pixels.
 *
 * `x`/`y` is the base, where the stake was driven into the sand — that is what
 * was painted. `flameX`/`flameY` is the fire at the top of the leaning stake,
 * about 3 ft away, and is where the scene's light belongs: a light at the base
 * emits from the wrong end of the torch.
 */
export const ARENA_TORCHES = {lights};
''')


def main():
    rng = random.Random(SEED)
    img = Image.new("RGBA", (SIZE, SIZE), SAND_BASE)

    _draw_sand(img, rng)
    _draw_slab(img, rng)

    torches = _torch_positions(rng)
    flames = _draw_torches(img, torches, rng)
    _draw_night(img)

    IMAGE_OUT.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(IMAGE_OUT, "WEBP", quality=86, method=6)
    _write_layout(torches, flames)

    kb = IMAGE_OUT.stat().st_size / 1024
    print(f"wrote {IMAGE_OUT.relative_to(REPO)}  {SIZE}x{SIZE}  {kb:.0f} KB")
    print(f"wrote {LAYOUT_OUT.relative_to(REPO)}  {len(torches)} torches")


if __name__ == "__main__":
    main()
