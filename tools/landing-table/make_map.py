"""
The framed map's picture: a hand-inked campaign map on aged parchment, drawn from scratch (no outside art).

A coastline with ripple lines and hatching off the shore, mountain and forest glyphs, a winding river, a road between
town dots, a compass rose, stains and burnt edges. Seeded, so every run draws the same map. build_table.py lays it on
the map's paper.

    python3 tools/landing-table/make_map.py        writes tools/landing-table/out/map.png
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "map.png")
W, H = 2048, 1365
INK = (44, 22, 8)
FILL = (206, 176, 124)                                    # the parchment under a glyph
# The map lies flat and is seen from a seat at the table, so its height shows about a third as much as its width.
# Glyphs are drawn taller by SY to look upright from there; lines across are drawn thicker for the same reason.
SY = 2.0
rng = random.Random(1348)
np_rng = np.random.default_rng(1348)


def noise(octaves=6, base=4, persistence=0.55):
    """Fractal value noise in 0..1, W x H: random grids blown up smoothly and summed."""
    out, amp, total = np.zeros((H, W), np.float32), 1.0, 0.0
    for o in range(octaves):
        n = base * 2 ** o
        grid = Image.fromarray((np_rng.random((max(2, round(n * H / W)) + 1, n + 1)) * 255).astype(np.uint8))
        out += amp * np.asarray(grid.resize((W, H), Image.BICUBIC), np.float32) / 255
        total += amp
        amp *= persistence
    return out / total


def blur(mask, radius):
    """A boolean mask blurred to 0..1: its smooth contours are rounded, not stepped."""
    img = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(img, np.float32) / 255


def contour(field, level, width):
    """Where a smooth 0..1 field crosses `level`, as a line about `width` pixels wide."""
    gy, gx = np.gradient(field)
    slope = np.hypot(gx, gy) + 1e-6
    return np.abs(field - level) / slope < width / 2


# ── the land: noise pushed up in the middle and to the right, so the sea wraps the west and the south ───────────
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
bias = 0.62 * (xx / W) + 0.25 * (1 - yy / H) - 0.55 * (((xx / W - 0.62) ** 2) * 1.2 + ((yy / H - 0.45) ** 2) * 1.6)
field = noise(8, 3) * 0.75 + bias
land = blur(field > 0.58, 3) > 0.5
coast = blur(land, 2.5)                                   # the coast as a smooth field: its 0.5 line is the shore
sea = coast < 0.5


def on_land(x, y, margin=40):
    x, y = int(x), int(y)
    if not (margin <= x < W - margin and margin <= y < H - margin):
        return False
    return bool(land[max(0, y - margin):y + margin, max(0, x - margin):x + margin].all())


# ── parchment ─────────────────────────────────────────────────────────────────────────────────────────────────────
tone = noise(6, 3)
fibre = np.asarray(Image.fromarray((np_rng.random((H, W // 6)) * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), np.float32) / 255
paper = np.stack([206 - 34 * tone - 8 * fibre, 176 - 40 * tone - 8 * fibre, 124 - 40 * tone - 6 * fibre], -1)
paper[sea] *= np.array([0.93, 0.95, 0.97])               # the sea a shade cooler and darker than the land
img = Image.fromarray(np.clip(paper, 0, 255).astype(np.uint8))
d = ImageDraw.Draw(img)


def ink(mask, colour=INK, alpha=1.0):
    a = np.asarray(img, np.float32)
    a[mask] = a[mask] * (1 - alpha) + np.array(colour) * alpha
    img.paste(Image.fromarray(a.astype(np.uint8)))


# The sea: three ripple lines following the coast, and short hatching strokes right along the shore.
for radius, level, alpha in ((16, 0.12, 0.7), (30, 0.1, 0.55), (50, 0.08, 0.4)):
    ink(contour(blur(land, radius), level, 7) & sea, alpha=alpha)
near = blur(land, 12)
hatch = ((xx * 2 - yy) % 14) < 5
ink((near > 0.14) & sea & hatch, alpha=0.85)
ink(contour(coast, 0.5, 14), alpha=1.0)                    # the coastline itself
d = ImageDraw.Draw(img)

# ── mountains: a range of peaks along a ridge, each shaded on its east side ──────────────────────────────────────
peaks = []
x0, y0 = W * 0.58, H * 0.2
for i in range(14):
    x, y = x0 + i * 46 + rng.uniform(-10, 10), y0 + i * 30 + math.sin(i * 0.8) * 40
    if on_land(x, y, 50):
        peaks.append((x, y))
for i in range(6):                                        # a small second range in the north-east
    x, y = W * 0.78 + i * 40, H * 0.12 + rng.uniform(-14, 14) + i * 8
    if on_land(x, y, 50):
        peaks.append((x, y))
for x, y in sorted(peaks, key=lambda p: p[1]):
    s = rng.uniform(58, 78)
    top = (x, y - s * SY)
    d.polygon([top, (x + s * 0.75, y), (x - s * 0.75, y)], fill=FILL)
    d.polygon([top, (x + s * 0.75, y), (x + s * 0.05, y)], fill=(150, 116, 72))
    d.line([(x - s * 0.75, y), top, (x + s * 0.75, y)], fill=INK, width=8, joint="curve")
    for k in range(3):                                    # shading strokes on the east face
        f = 0.3 + k * 0.2
        d.line([(x + s * 0.12 * (k + 1), y - s * SY * (1 - f) + 4), (x + s * 0.12 * (k + 1) + s * 0.18, y - 2)], fill=INK, width=4)

# ── hills: little arcs around the foot of the range ──────────────────────────────────────────────────────────────
for _ in range(60):
    px, py = rng.choice(peaks)
    x, y = px + rng.gauss(0, 110), py + rng.gauss(40, 70)
    if on_land(x, y, 30) and all(math.hypot(x - a, y - b) > 55 for a, b in peaks):
        d.arc([x - 26, y - 17 * SY, x + 26, y + 17 * SY], 200, 340, fill=INK, width=8)

# ── forests: clusters of little round trees ──────────────────────────────────────────────────────────────────────
for cx, cy, n in ((W * 0.5, H * 0.62, 26), (W * 0.82, H * 0.55, 22), (W * 0.66, H * 0.84, 14)):
    for _ in range(n):
        x, y = cx + rng.gauss(0, 70), cy + rng.gauss(0, 46)
        if not on_land(x, y, 26) or any(abs(x - px) < 60 and abs(y - py) < 60 for px, py in peaks):
            continue
        r = rng.uniform(15, 20)
        d.line([(x, y + r * 0.6 * SY), (x, y + r * 1.6 * SY)], fill=INK, width=5)
        d.ellipse([x - r, y - r * SY, x + r, y + r * SY], fill=(110, 112, 50), outline=INK, width=7)

# ── the river: from the foot of the range, winding south-west to the sea ─────────────────────────────────────────
x, y = peaks[len(peaks) // 3][0] - 30, peaks[len(peaks) // 3][1] + 60
river, heading = [(x, y)], math.radians(150)
for i in range(400):
    heading += math.radians(rng.uniform(-14, 14)) + 0.06 * math.sin(i * 0.35)
    heading = heading * 0.9 + math.radians(140) * 0.1     # it keeps heading to the south-west coast
    x, y = x + 9 * math.cos(heading), y + 9 * math.sin(heading)
    river.append((x, y))
    if not (0 < x < W and 0 < y < H) or sea[int(y), int(x)]:
        break
for i in range(len(river) - 1):
    d.line([river[i], river[i + 1]], fill=INK, width=10 + int(8 * i / len(river)))

# ── towns and the road between them ──────────────────────────────────────────────────────────────────────────────
towns, tries = [], 0
while len(towns) < 6 and tries < 4000:
    tries += 1
    x, y = rng.uniform(W * 0.25, W * 0.95), rng.uniform(H * 0.15, H * 0.9)
    if on_land(x, y, 34) and all(math.hypot(x - a, y - b) > 260 for a, b in towns) and all(not (abs(x - a) < 100 and b - 80 * SY - 30 < y < b + 40) for a, b in peaks):   # clear of the tall peaks
        towns.append((x, y))
links, joined = [], {0}
while len(joined) < len(towns):                           # each town joins the nearest town already on the roads
    a, b = min(((i, j) for i in joined for j in range(len(towns)) if j not in joined), key=lambda ij: math.dist(towns[ij[0]], towns[ij[1]]))
    links.append((towns[a], towns[b]))
    joined.add(b)
for (ax, ay), (bx, by) in links:
    bend = rng.uniform(-0.25, 0.25) * math.dist((ax, ay), (bx, by))
    mx, my = (ax + bx) / 2 - (by - ay) / math.dist((ax, ay), (bx, by)) * bend, (ay + by) / 2 + (bx - ax) / math.dist((ax, ay), (bx, by)) * bend
    pts = [((1 - t) ** 2 * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * my + t * t * by) for t in np.linspace(0, 1, 60)]
    for k in range(0, len(pts) - 1, 2):
        d.line([pts[k], pts[k + 1]], fill=(120, 30, 20), width=10)
for i, (x, y) in enumerate(towns):
    if i == len(towns) // 2:                              # the capital: a little walled square with a tower
        d.rectangle([x - 26, y - 20 * SY, x + 26, y + 20 * SY], fill=(150, 40, 25), outline=INK, width=8)
        d.rectangle([x - 9, y - 44 * SY, x + 9, y - 20 * SY], fill=INK)
    else:
        d.ellipse([x - 22, y - 22 * SY, x + 22, y + 22 * SY], outline=INK, width=8)
        d.ellipse([x - 11, y - 11 * SY, x + 11, y + 11 * SY], fill=(150, 40, 25))

# ── a compass rose out in the south-west sea ─────────────────────────────────────────────────────────────────────
cx, cy, R = W * 0.14, H * 0.8, 130
d.ellipse([cx - R * 0.72, cy - R * 0.72 * SY, cx + R * 0.72, cy + R * 0.72 * SY], outline=INK, width=8)
d.ellipse([cx - R * 0.6, cy - R * 0.6 * SY, cx + R * 0.6, cy + R * 0.6 * SY], outline=INK, width=4)
for k in range(8):
    a = math.radians(k * 45 - 90)
    long = R if k % 2 == 0 else R * 0.6
    tip = (cx + long * math.cos(a), cy + long * math.sin(a) * SY)
    l = (cx + 22 * math.cos(a - math.pi / 2), cy + 22 * math.sin(a - math.pi / 2) * SY)
    r = (cx + 22 * math.cos(a + math.pi / 2), cy + 22 * math.sin(a + math.pi / 2) * SY)
    d.polygon([tip, l, (cx, cy)], fill=INK)
    d.polygon([tip, r, (cx, cy)], fill=FILL, outline=INK, width=3)
n = (cx, cy - R * SY - 50)                                     # the N above the north point
d.line([(n[0] - 18, n[1] + 40), (n[0] - 18, n[1] - 40), (n[0] + 18, n[1] + 40), (n[0] + 18, n[1] - 40)], fill=INK, width=9)

# ── age: blotchy stains, two cup rings, and edges burnt in an uneven line ────────────────────────────────────────
a = np.asarray(img, np.float32)
stain = np.clip((noise(5, 2) - 0.5) * 3, 0, 1)[..., None]
a *= 1 - 0.28 * stain * np.array([0.6, 0.85, 1.0])
for cx, cy, r in ((W * 0.72, H * 0.3, 150), (W * 0.32, H * 0.28, 110)):
    dist = np.hypot(xx - cx, yy - cy)
    ring = np.exp(-((dist - r) / 7) ** 2)[..., None]
    a *= 1 - 0.32 * ring * np.array([0.5, 0.8, 1.0])
edge = np.minimum.reduce([xx, W - 1 - xx, yy, H - 1 - yy]) / 60 + (noise(6, 6) - 0.5) * 1.6
char = np.clip(1 - edge, 0, 1)[..., None]                 # 1 at the burnt rim, fading inward
a = a * (1 - 0.55 * np.clip(char * 1.6, 0, 1)) + np.array([30, 16, 6]) * np.clip((char - 0.6) * 3, 0, 1)
img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT)
print("map:", OUT, img.size, "peaks", len(peaks), "towns", len(towns), "river", len(river))
