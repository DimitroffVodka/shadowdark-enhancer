"""Interior tiles B: brewery, casino, dungeon, granary."""
import math
import random

from bastion_lib import *

specs = {}


# ---- local drawing helpers --------------------------------------------------
def P(d, fill="none", sw=1.6, st=None, op=None, extra=""):
    s = f' stroke="{st}"' if st else ""
    o = f' opacity="{op}"' if op is not None else ""
    return f'    <path d="{d}" fill="{fill}" stroke-width="{sw}"{s}{o} {extra}/>\n'


def C(cx, cy, r, fill="none", sw=1.6, st=None, op=None, extra=""):
    s = f' stroke="{st}"' if st else ""
    o = f' opacity="{op}"' if op is not None else ""
    return f'    <circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke-width="{sw}"{s}{o} {extra}/>\n'


def E(cx, cy, rx, ry, fill="none", sw=1.6, rot=0, st=None, op=None):
    s = f' stroke="{st}"' if st else ""
    o = f' opacity="{op}"' if op is not None else ""
    t = f' transform="rotate({rot} {cx} {cy})"' if rot else ""
    return f'    <ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}" stroke-width="{sw}"{s}{o}{t}/>\n'


def R(x, y, w, h, fill="none", sw=1.8, rx=0, st=None, op=None, rot=0):
    s = f' stroke="{st}"' if st else ""
    o = f' opacity="{op}"' if op is not None else ""
    t = f' transform="rotate({rot} {x + w / 2} {y + h / 2})"' if rot else ""
    return f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke-width="{sw}"{s}{o}{t}/>\n'


def G(inner, tf):
    return f'    <g transform="{tf}">\n{inner}    </g>\n'


def hatch(d, name, op=None):
    o = f' opacity="{op}"' if op is not None else ""
    return f'    <path d="{d}" fill="url(#{name})" stroke="none"{o}/>\n'


def pipe(pts, w=5, col="#C98A4E"):
    d = "M" + " L".join(f"{x} {y}" for x, y in pts)
    return P(d, sw=w + 3.5, st=INK) + P(d, sw=w, st=col) + P(d, sw=1, st="#F0C890", op=0.6)


def circle_chords(cx, cy, r, offs, sw=0.9, op=0.5):
    out = ""
    for dx in offs:
        h = math.sqrt(max(r * r - dx * dx, 0)) - 2
        out += P(f"M{cx + dx} {cy - h:.1f} V{cy + h:.1f}", sw=sw, op=op)
    return out


def kernels(cx, cy, r, n, seed, fill="#E0B94A", rr=1.4):
    rnd = random.Random(seed)
    out = ""
    for _ in range(n):
        a = rnd.random() * 6.283
        d = r * math.sqrt(rnd.random())
        out += E(round(cx + d * math.cos(a), 1), round(cy + d * math.sin(a), 1), rr * 1.5, rr, fill, 0.5, rot=rnd.randint(0, 170))
    return out


def sack(x, y, w=44, h=30, fill="#D9C79A", rot=0):
    cx, cy = x + w / 2, y + h / 2
    d = (f"M{x + 7} {y} C{x + w * .35} {y - 3} {x + w * .65} {y - 3} {x + w - 7} {y} Q{x + w + 2} {cy} {x + w - 7} {y + h} "
         f"C{x + w * .65} {y + h + 3} {x + w * .35} {y + h + 3} {x + 7} {y + h} Q{x - 2} {cy} {x + 7} {y} Z")
    inner = P(d, fill, 1.8)
    inner += P(f"M{x + w * .3} {y + 5} Q{x + w * .45} {cy} {x + w * .3} {y + h - 5}", sw=0.9, op=0.45)
    inner += P(f"M{x + w * .6} {y + 4} Q{x + w * .72} {cy} {x + w * .6} {y + h - 4}", sw=0.9, op=0.45)
    inner += P(f"M{x + w - 8} {y + 3} L{x + w + 4} {y + 1} M{x + w - 8} {y + h - 3} L{x + w + 4} {y + h - 1} M{x + w - 5} {y + 8} V{y + h - 8}", sw=1.3, st="#6A5236")
    return G(inner, f"rotate({rot} {cx} {cy})") if rot else inner


def cask(x, y, w=108, h=32, wood="#A17A5C"):
    d = f"M{x} {y + 4} Q{x + w / 2} {y - 5} {x + w} {y + 4} V{y + h - 4} Q{x + w / 2} {y + h + 5} {x} {y + h - 4} Z"
    out = P(d, wood, 1.9)
    for t in (0.14, 0.32, 0.68, 0.86):
        k = 18 * t * (1 - t)
        xx = x + w * t
        out += P(f"M{xx:.1f} {y + 4 - k:.1f} V{y + h - 4 + k:.1f}", sw=2.4, st="#4D4B47")
    out += E(x + w / 2, y + h / 2, 3.4, 2.6, "#3a2a1e", 1.0)
    out += P(f"M{x + 3} {y + 9} Q{x + w / 2} {y + 4} {x + w - 3} {y + 9}", sw=0.8, op=0.4)
    return out


def chain(x1, y1, x2, y2, n=6, col="#8A8D90"):
    ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
    out = ""
    for i in range(n):
        t = (i + 0.5) / n
        out += E(round(x1 + (x2 - x1) * t, 1), round(y1 + (y2 - y1) * t, 1), 5.2 if i % 2 == 0 else 3.6, 2.8, col if i % 2 == 0 else "none", 1.1, rot=ang)
    return out


def flame(x, y, s=1.0):
    return (P(f"M{x} {y - 15 * s} C{x + 8 * s} {y - 6 * s} {x + 8 * s} {y + 4 * s} {x} {y + 8 * s} C{x - 8 * s} {y + 4 * s} {x - 8 * s} {y - 6 * s} {x} {y - 15 * s} Z", "#E08A33", 1.1)
            + P(f"M{x} {y - 6 * s} C{x + 4 * s} {y - 1 * s} {x + 4 * s} {y + 3 * s} {x} {y + 6 * s} C{x - 4 * s} {y + 3 * s} {x - 4 * s} {y - 1 * s} {x} {y - 6 * s} Z", "#F6D34E", 0.8))


def chip(cx, cy, col):
    return C(cx, cy, 5.2, col, 1.1) + C(cx, cy, 3, "none", 0.7, st="#F1E9D2")


def chips(cx, cy, cols):
    out = ""
    for i, c in enumerate(cols):
        out += chip(cx, cy - i * 2.2, c)
    return out


def card(x, y, rot=0, red=True):
    inner = R(x, y, 12, 17, "#F1E9D2", 0.9, rx=1.5)
    inner += C(x + 6, y + 8.5, 2.3, "#8E2F36" if red else "#1d1a18", 0.4)
    return G(inner, f"rotate({rot} {x + 6} {y + 8.5})")


def die(x, y, n=5, rot=0):
    pips = {1: [(0, 0)], 2: [(-2.4, -2.4), (2.4, 2.4)], 3: [(-2.4, -2.4), (0, 0), (2.4, 2.4)], 4: [(-2.4, -2.4), (2.4, -2.4), (-2.4, 2.4), (2.4, 2.4)],
            5: [(-2.4, -2.4), (2.4, -2.4), (0, 0), (-2.4, 2.4), (2.4, 2.4)], 6: [(-2.4, -2.8), (2.4, -2.8), (-2.4, 0), (2.4, 0), (-2.4, 2.8), (2.4, 2.8)]}[n]
    inner = R(x - 5.5, y - 5.5, 11, 11, "#F1E9D2", 1.1, rx=2)
    for dx, dy in pips:
        inner += C(x + dx, y + dy, 0.95, INK, 0.2, st=INK)
    return G(inner, f"rotate({rot} {x} {y})")


def tankard(cx, cy, fill="#A8A59B", beer="#D9A441", hdl=0):
    h = f'    <path d="M{cx + 5.5} {cy - 2.5} q5 0 5 3 t-5 3" fill="none" stroke-width="1.5" transform="rotate({hdl} {cx} {cy})"/>\n'
    return h + C(cx, cy, 5.8, fill, 1.4) + C(cx, cy, 3.9, beer, 0.7)


def coin_stack(cx, cy, n=3, r=6):
    out = ""
    for i in range(n):
        out += C(cx, cy - i * 2.4, r, "#D4AE48", 1.2)
    out += C(cx, cy - (n - 1) * 2.4, r - 2.4, "none", 0.7)
    out += P(f"M{cx - 1.5} {cy - (n - 1) * 2.4 - 2} V{cy - (n - 1) * 2.4 + 2}", sw=0.7)
    return out


def torch(x, y, rot=0, pool=0):
    """Bracketed wall torch; bracket at (x, y) on the wall, torch angled out along rot."""
    inner = P(f"M{x - 4} {y - 6} H{x + 4} V{y + 6} H{x - 4} Z", "#4D4B47", 1.4)
    inner += P(f"M{x} {y} H{x + 14}", sw=2.6, st="#4B352B")
    inner += E(x + 18, y, 7, 4, "#745846", 1.4)
    inner += C(x + 24, y, 7.5, "#E08A33", 1.2) + C(x + 24, y, 4, "#F6D34E", 0.8)
    return G(inner, f"rotate({rot} {x} {y})")


def skull(cx, cy, s=1.0, rot=0):
    inner = P(f"M{cx - 8 * s} {cy} C{cx - 8 * s} {cy - 10 * s} {cx + 8 * s} {cy - 10 * s} {cx + 8 * s} {cy} C{cx + 8 * s} {cy + 4 * s} {cx + 5 * s} {cy + 5 * s} {cx + 5 * s} {cy + 9 * s} H{cx - 5 * s} C{cx - 5 * s} {cy + 5 * s} {cx - 8 * s} {cy + 4 * s} {cx - 8 * s} {cy} Z", "#E3DAC4", 1.2)
    inner += C(cx - 3.2 * s, cy + 0.5 * s, 2 * s, INK, 0.3) + C(cx + 3.2 * s, cy + 0.5 * s, 2 * s, INK, 0.3)
    inner += P(f"M{cx} {cy + 3 * s} L{cx - 1 * s} {cy + 5.5 * s} H{cx + 1 * s} Z", INK, 0.4)
    inner += P(f"M{cx - 2.5 * s} {cy + 9 * s} V{cy + 6.5 * s} M{cx} {cy + 9 * s} V{cy + 6.5 * s} M{cx + 2.5 * s} {cy + 9 * s} V{cy + 6.5 * s}", sw=0.6)
    return G(inner, f"rotate({rot} {cx} {cy})") if rot else inner


def bone(x1, y1, x2, y2):
    ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
    L = math.hypot(x2 - x1, y2 - y1)
    inner = P(f"M{x1} {y1} H{x1 + L}", sw=3.6, st=INK)
    inner += P(f"M{x1} {y1} H{x1 + L}", sw=2.2, st="#E3DAC4")
    for ex in (x1, x1 + L):
        inner += C(ex, y1 - 2.2, 2.4, "#E3DAC4", 0.9) + C(ex, y1 + 2.2, 2.4, "#E3DAC4", 0.9)
    return G(inner, f"rotate({ang:.1f} {x1} {y1})")


def lantern_pool(cx, cy, r=48, col="#F7D774", op=0.2):
    return C(cx, cy, r, col, 0, st="none", op=op) + C(cx, cy, r * 0.62, col, 0, st="none", op=op)


# ============================================================================
# BREWERY
# ============================================================================
b = room_shell(FLOOR_FLAG, "#6F6D68", "stoneHatch")

# spilled wort puddles on the flags
b += P("M200 268 C216 254 244 256 252 272 C262 290 232 304 214 296 C198 290 192 278 200 268 Z", "#C9964A", 0.8, op=0.55)
b += P("M296 392 C312 384 336 388 338 400 C338 410 314 414 300 410 C290 406 288 398 296 392 Z", "#C9964A", 0.8, op=0.5)

# stone firebox plinth under the kettle, with stoking door and ember glow
b += P("M42 42 H194 V194 H42 Z", STONE, 2.2) + hatch("M42 42 H194 V194 H42 Z", "stoneHatch")
b += P("M98 192 H138 V202 H98 Z", "#26211f", 1.6) + P("M104 202 Q118 190 132 202 Z", "#E08A33", 1.0)
b += P("M54 54 H182 V182 H54 Z", "none", 0.8, op=0.4)

# big copper brewing kettle (top view: rim, wort, foam, hops, rivets)
kx, ky = 118, 118
b += C(kx, ky, 68, "#A8602F", 3)
b += C(kx, ky, 61, "#C98A4E", 1.6)
for i in range(16):
    a = i * math.tau / 16
    b += C(round(kx + 64.5 * math.cos(a), 1), round(ky + 64.5 * math.sin(a), 1), 1.7, "#7A4624", 0.8)
b += C(kx, ky, 52, "#8F5530", 2)
b += C(kx, ky, 46, "#6B3A1E", 1.2)
for fx, fy, fr in [(100, 92, 9), (126, 86, 7), (146, 112, 10), (90, 128, 8), (130, 144, 9), (108, 108, 6), (150, 140, 5)]:
    b += C(fx, fy, fr, "#E9D9A8", 1.0)
for hx, hy, ha in [(80, 108, 20), (118, 130, 70), (140, 96, 140), (108, 74, 100), (96, 150, 10)]:
    b += E(hx, hy, 5, 3, "#7C9A4F", 0.9, rot=ha)
# lug handles on the rim
b += R(44, 108, 14, 20, "#7A4624", 1.8, rx=3) + R(178, 108, 14, 20, "#7A4624", 1.8, rx=3)
# long wooden stirring paddle laid across the kettle
b += G(R(36, 114.5, 150, 7, "#9F7D68", 1.6, rx=3) + R(40, 106, 14, 24, "#9F7D68", 1.6, rx=5) + P("M64 117 H176", sw=0.7, op=0.5) + R(170, 110, 6, 15, "#745846", 1.4), f"rotate(-34 {kx} {ky})")

# fermenting vats (wooden lids, iron hoops, bungs, airlock, foam, open vat with paddle)
for i, vx in enumerate((252, 340, 428)):
    vy = 92
    b += C(vx, vy, 38, "#8F6F52", 2.4)
    if i < 2:
        b += C(vx, vy, 33, "#A9856E", 1.4) + circle_chords(vx, vy, 33, (-22, -11, 0, 11, 22))
        b += C(vx, vy, 36, "none", 3, st="#4D4B47") if False else ""
        b += C(vx, vy, 27, "none", 2.4, st="#4D4B47", op=0.9)
        b += C(vx + 9, vy - 8, 4.5, "#26211f", 1.4)
        if i == 0:
            b += C(vx - 14, vy + 10, 6, "#C9B889", 1.2) + C(vx - 14, vy + 10, 2.4, "#E9D9A8", 0.8) + P(f"M{vx - 14} {vy + 4} V{vy - 8}", sw=1.2)
        else:
            # foam bubbling out under the lid
            b += P(f"M{vx + 28} {vy + 26} C{vx + 40} {vy + 22} {vx + 46} {vy + 34} {vx + 36} {vy + 40} C{vx + 28} {vy + 46} {vx + 20} {vy + 38} {vx + 28} {vy + 26} Z", "#F2E6B8", 1.1)
    else:
        b += C(vx, vy, 31, "#D9A441", 1.4) + C(vx, vy, 24, "none", 0.8, op=0.4)
        for fx, fy, fr in [(-10, -12, 7), (8, -16, 5), (14, 0, 8), (-14, 6, 6), (2, 12, 8), (-2, -2, 5)]:
            b += C(vx + fx, vy + fy, fr, "#F2E6B8", 0.9)
        b += G(R(vx - 46, vy - 3, 92, 6, "#9F7D68", 1.4, rx=3) + R(vx - 49, vy - 8, 10, 16, "#9F7D68", 1.4, rx=3), f"rotate(24 {vx} {vy})")

# copper pipework: manifold under the vats, drops, valve wheels, feed to the mash tun and kettle
b += pipe([(184, 112), (200, 112), (200, 148), (440, 148), (440, 186)])
for vx in (252, 340, 428):
    b += pipe([(vx, 128), (vx, 148)], 4)
for vx in (296, 384):
    b += C(vx, 148, 7, "#C9A24E", 1.4) + P(f"M{vx - 6} {vy if False else 148} H{vx + 6} M{vx} 142 V154", sw=1.2)
b += R(194, 140, 12, 16, "#8A8D90", 1.5, rx=2)

# mash tun: open wooden tun full of grain mash with a long rake
mx, my = 440, 224
b += C(mx, my, 38, "#8F6F52", 2.4) + C(mx, my, 31, "#B9955B", 1.4)
b += C(mx, my, 34, "none", 2.6, st="#4D4B47", op=0.9)
b += kernels(mx, my, 27, 26, 3, "#D8BE80", 1.5)
b += G(R(mx - 54, my - 2.5, 104, 5, "#9F7D68", 1.4, rx=2) + R(mx - 58, my - 9, 6, 18, "#9F7D68", 1.4, rx=2), f"rotate(-32 {mx} {my})")

# cask racks: four casks on their sides on a timber cradle
b += R(36, 208, 12, 156, "#745846", 1.8) + R(124, 208, 12, 156, "#745846", 1.8) + hatch("M36 208 H48 V364 H36 Z M124 208 H136 V364 H124 Z", "logHatch")
for i in range(4):
    b += cask(34, 214 + i * 36, 108, 32)
b += E(150, 360, 7, 6, "#D9A441", 0.8, op=0.7)  # drip
# second rack: casks end-on, stacked in a pyramid
for cx, cy in [(186, 222), (224, 222), (205, 255)]:
    b += barrel_top(cx, cy, 18)
b += P("M168 242 H242 M168 242 L172 206", sw=0.1, op=0.0)

# big cask being rolled, with chocks, tap and drip tray
b += G(cask(262, 288, 104, 36, "#9F7552"), "rotate(-18 314 306)")
b += P("M268 340 L282 332 V346 Z", "#745846", 1.4) + P("M352 270 L368 276 L360 286 Z", "#745846", 1.4)
b += P("M292 316 H278 V322 H292 Z", "#A8A59B", 1.2) + C(272, 322, 5, "#C9A24E", 1.2)

# floor drain grate
b += C(238, 372, 14, "#4D4B47", 1.8) + C(238, 372, 9, "none", 1.0) + P("M229 372 H247 M238 363 V381 M232 366 L244 378 M244 366 L232 378", sw=1.0)

# tasting table with tankards, bread, cheese; stools
b += table(332, 348, 134, 52, "#8F6F52")
for i, tx in enumerate((350, 372, 394)):
    b += tankard(tx, 366 + (i % 2) * 14, hdl=i * 40)
b += tankard(420, 372, "#C9A24E", "#C9893D", 150) + E(446, 372, 9, 6, "#D9B26A", 1.2) + P("M440 372 H452", sw=0.7, op=0.5)
b += P("M410 386 L428 390 L410 394 Z", "#E8C96E", 1.1) + C(394, 389, 3, "#E8C96E", 0.9)
b += stool(354, 424) + stool(396, 424) + stool(438, 424)

# hop sacks in the corner, one spilled with green cones, plus a hanging-bundle drying rack on the floor
b += sack(428, 436, 50, 32, "#D9C79A", -10) + sack(434, 464, 46, 18, "#CBB988", 4)
b += P("M410 450 C400 440 392 452 396 460 C400 470 414 468 418 460 Z", "#8DAA5A", 1.0)
for hx, hy, ha in [(402, 454, 20), (410, 462, 80), (397, 462, 140), (413, 452, 40)]:
    b += E(hx, hy, 4, 2.6, "#9DBA64", 0.7, rot=ha)
b += sack(344, 458, 38, 22, "#D9C79A", 8) + E(332, 454, 8, 5, "#8DAA5A", 0.9) + E(364, 454, 4, 2.6, "#9DBA64", 0.7, rot=40)

# cellar hatch with iron bands, ring and hinges
b += R(46, 396, 90, 72, "#876A56", 2.2) + hatch("M46 396 H136 V468 H46 Z", "plankHatch")
for xx in (68, 91, 114):
    b += P(f"M{xx} 397 V467", sw=1.0, op=0.5)
b += P("M46 414 H136 M46 450 H136", sw=3.4, st="#4D4B47") + C(91, 432, 7.5, "none", 2.2, st="#4D4B47") + C(91, 432, 3, "#4D4B47", 1.0)
b += R(40, 408, 10, 12, "#4D4B47", 1.2) + R(40, 444, 10, 12, "#4D4B47", 1.2)

# bucket and mop
b += C(176, 440, 10, "#876A56", 1.8) + C(176, 440, 6.5, "#5B99A6", 0.8) + P("M166 436 A10 10 0 0 1 186 436", sw=1.4, st="#4D4B47")
b += P("M154 478 L196 462", sw=3.2, st=INK) + P("M154 478 L196 462", sw=1.8, st="#BD9D86") + P("M150 470 Q142 478 150 486 Q158 484 160 476 Z", "#C9B889", 1.0)

specs["room-brewery"] = {"title": "Brewery", "desc": "Top-down brewery floor plan: copper kettle, fermenting vats, mash tun, cask racks, tasting table and cellar hatch.", "body": b, "shadow": ""}

# ============================================================================
# CASINO
# ============================================================================
c = room_shell(FLOOR_WOOD, "#745846", "logHatch")

# plush red carpet: runner from the door plus a central rug with gold trim, lattice and a medallion
carpet = "M198 206 H356 V352 H294 V512 H218 V352 H198 Z"
inset = "M208 216 H346 V342 H284 V512 H228 V342 H208 Z"
c += P(carpet, "#8E2F36", 2.2) + P(inset, "none", 3, st="#D7B857")
c += P(inset, "none", 0.8, st="#D7B857", op=0.0)
for i in range(5):
    xx = 228 + i * 26
    c += P(f"M{xx} 224 L{xx + 13} 238 L{xx} 252 L{xx - 13} 238 Z", "#A8454B", 0.8, op=0.9)
for xx in (306, 332):
    c += P(f"M{xx} 306 L{xx + 13} 320 L{xx} 334 L{xx - 13} 320 Z", "#A8454B", 0.8, op=0.9)
c += P("M236 352 V500 M276 352 V500", sw=0.9, st="#D7B857", op=0.7)
c += C(277, 280, 38, "#6E2229", 1.6) + C(277, 280, 32, "none", 2.6, st="#D7B857")
star = "".join(f"{'M' if i == 0 else 'L'}{277 + (24 if i % 2 == 0 else 11) * math.cos(i * math.pi / 8 - math.pi / 2):.1f} {280 + (24 if i % 2 == 0 else 11) * math.sin(i * math.pi / 8 - math.pi / 2):.1f} " for i in range(16)) + "Z"
c += P(star, "#D7B857", 1.2) + C(277, 280, 4, "#8E2F36", 0.8)

# pools of lantern light on the boards
for lx, ly in [(130, 120), (372, 124), (112, 296), (436, 276), (424, 420), (118, 424)]:
    c += lantern_pool(lx, ly, 52)

# card table: half-round table, green felt, fan of cards, chip stacks, dealer's shoe
c += P("M50 56 H210 A80 80 0 0 1 50 56 Z", "#5E3B2B", 2.4)
c += P("M60 62 H200 A70 70 0 0 1 60 62 Z", "#2F6B45", 1.6)
c += P("M76 66 A54 54 0 0 0 184 66", "none", 0.8, st="#D7C39A", op=0.6)
c += P("M96 66 A34 34 0 0 0 164 66", "none", 0.8, st="#D7C39A", op=0.6)
for i, (cxx, cyy, ra) in enumerate([(104, 104, -25), (122, 112, -5), (140, 112, 10), (156, 104, 30)]):
    c += card(cxx - 6, cyy - 8, ra, i % 2 == 0)
c += R(118, 66, 24, 14, "#26211f", 1.4, rx=2) + R(121, 69, 18, 8, "#E6D9B5", 0.8)
c += chips(84, 100, ["#8E2F36", "#26211f", "#D4AE48"]) + chips(176, 100, ["#4F6B65", "#8E2F36"]) + chips(130, 140, ["#D4AE48", "#26211f", "#26211f", "#8E2F36"])
for ang in (22, 52, 78, 102, 128, 158):
    sxx = 130 + 94 * math.cos(math.radians(ang))
    syy = 56 + 94 * math.sin(math.radians(ang))
    c += C(round(sxx, 1), round(syy, 1), 10, "#7B2D3A", 1.7) + C(round(sxx, 1), round(syy, 1), 5, "none", 0.7, op=0.5)

# roulette table: wheel with dashed red/black pockets, gold ring, spokes and ball; betting layout beside it
c += R(272, 46, 206, 148, "#5E3B2B", 2.4, rx=6) + R(281, 55, 188, 130, "#2F6B45", 1.5, rx=3)
wx, wy = 332, 120
c += C(wx, wy, 47, "#4B2D1E", 2.2) + C(wx, wy, 42, "#8F6F52", 1.2)
c += C(wx, wy, 35, "none", 9, st="#8E2F36") + C(wx, wy, 35, "none", 9, st="#1d1a18", extra='stroke-dasharray="5.5 5.5"')
c += C(wx, wy, 40.5, "none", 0.8) + C(wx, wy, 29.5, "none", 0.8)
c += C(wx, wy, 27, "#D7B857", 1.6) + C(wx, wy, 21, "#6E4A33", 1.2)
for i in range(4):
    a = i * math.pi / 4 + 0.4
    c += P(f"M{wx - 20 * math.cos(a):.1f} {wy - 20 * math.sin(a):.1f} L{wx + 20 * math.cos(a):.1f} {wy + 20 * math.sin(a):.1f}", sw=2.2, st="#D7B857")
c += C(wx, wy, 8, "#D7B857", 1.4) + C(wx, wy, 3, "#8E2F36", 0.8) + C(wx + 29, wy - 12, 2.8, "#F1E9D2", 0.8)
c += R(388, 62, 76, 22, "#2a2623", 1.1) + P("M401 62 V84 M414 62 V84", sw=0.8, st="#F1E9D2", op=0.5) if False else ""
c += R(390, 64, 72, 15, "#2F6B45", 1.2) + C(426, 71.5, 4, "none", 1.0, st="#F1E9D2")
for r_ in range(5):
    for c_ in range(3):
        c += R(390 + c_ * 24, 82 + r_ * 20, 24, 20, "#8E2F36" if (r_ + c_) % 2 == 0 else "#2a2623", 1.0)
c += chips(402, 112, ["#D4AE48", "#D4AE48"]) + chips(450, 134, ["#4F6B65"]) + chips(426, 92, ["#8E2F36", "#F1E9D2"]) + chips(404, 172, ["#26211f"])
c += P("M292 172 H350", sw=3.4, st=INK) + P("M292 172 H350", sw=1.8, st="#BD9D86") + R(344, 166, 6, 12, "#BD9D86", 1.2)
for sx in (326, 372, 418, 464):
    c += stool(sx, 214, 10, "#7B2D3A")

# dice table: wooden rail, felt, tilted dice, pass-line and chips
c += R(40, 252, 150, 92, "#5E3B2B", 2.4, rx=6) + R(49, 261, 132, 74, "#2F6B45", 1.5, rx=3)
c += P("M62 275 H168 V322 H62 Z", "none", 0.9, st="#D7C39A", op=0.7) + P("M62 292 H168", sw=0.8, st="#D7C39A", op=0.6)
c += C(115, 307, 9, "none", 0.9, st="#D7C39A", op=0.7)
c += die(108, 300, 5, 24) + die(124, 308, 3, -14) + die(96, 318, 6, 40)
c += chips(70, 284, ["#8E2F36", "#D4AE48"]) + chips(156, 284, ["#26211f", "#26211f", "#4F6B65"]) + chips(160, 326, ["#D4AE48"])
c += E(78, 322, 9, 4, "#8F6F52", 1.2) + P("M70 322 H86", sw=0.6)  # dice stick
for sx in (70, 115, 160):
    c += stool(sx, 236, 10, "#7B2D3A")

# round side table for private games
c += round_table(436, 276, 34, "#5E3B2B") + C(436, 276, 28, "#2F6B45", 1.2)
for i, (cxx, cyy, ra) in enumerate([(424, 268, -30), (440, 262, 10), (430, 284, 40)]):
    c += card(cxx - 6, cyy - 8, ra, i == 1)
c += chips(452, 286, ["#D4AE48", "#8E2F36"]) + chips(416, 290, ["#26211f"])
for ang in (200, 250, 20, 90):
    sxx = 436 + 48 * math.cos(math.radians(ang))
    syy = 276 + 48 * math.sin(math.radians(ang))
    if sxx < 478:
        c += C(round(sxx, 1), round(syy, 1), 9, "#7B2D3A", 1.6)

# banker's cage: iron bars on two sides, strongbox, desk with coin stacks and ledger
c += R(376, 360, 104, 124, "#6F5A47", 1.6) + hatch("M376 360 H480 V484 H376 Z", "plankHatch", 0.7)
c += R(396, 396, 84, 40, "#8F6F52", 2) + R(402, 402, 72, 28, "#5E3B2B", 1.0, op=1)
for i in range(5):
    c += coin_stack(412 + i * 12, 420, 2 + (i * 7) % 4, 5)
c += P("M448 412 H470 V426 H448 Z", "#E6D9B5", 1.2) + P("M459 412 V426", sw=0.8) + P("M450 416 H457 M450 420 H457", sw=0.6, op=0.6)
c += chest(442, 448, 36, 24, "#5E4636") + P("M452 448 V472 M468 448 V472", sw=2, st="#4D4B47")
c += C(396, 462, 8, "#7B2D3A", 1.6)
c += P("M392 444 C388 448 390 456 398 456 C406 458 410 450 404 444 Z", "#D4AE48", 1.0)
for i in range(10):
    c += C(380, 368 + i * 12, 2.6, "#4D4B47", 1.0)
for i in range(1, 10):
    c += C(380 + i * 11.5, 364, 2.6, "#4D4B47", 1.0)
c += P("M378 364 V482 M378 364 H478", sw=1.2, st="#4D4B47", op=0.8)
c += P("M378 436 H398", sw=2.0, st=INK) if False else ""
c += R(374, 372, 6, 28, "#7B4A2B", 1.4)  # service window shutter

# bar corner: L-shaped counter, stools, kegs, bottle shelf, bottles and tankards
c += P("M88 350 H120 V404 H198 V438 H88 Z", "#5E3B2B", 2.4)
c += P("M95 357 H113 V411 H191 V431 H95 Z", "#8F6F52", 1.2)
c += R(30, 352, 24, 120, "#745846", 2) + hatch("M30 352 H54 V472 H30 Z", "logHatch")
for i, col in enumerate(["#4F6B65", "#9C3F3A", "#C9A24E", "#6C5B8C", "#4F6B65", "#9C3F3A", "#C9A24E", "#6C5B8C", "#9C3F3A", "#4F6B65"]):
    c += C(42, 362 + i * 11.5, 4.2, col, 0.9)
c += barrel_top(74, 392, 16) + barrel_top(74, 428, 16) + barrel_top(116, 466, 16)
for tx, ty, h_ in [(154, 421, 0), (172, 425, 40)]:
    c += tankard(tx, ty, hdl=h_)
c += C(104, 388, 4, "#6C5B8C", 0.9) + C(110, 372, 4, "#9C3F3A", 0.9) + C(102, 410 - 20, 4, "#4F6B65", 0.9)
c += C(184, 421, 6, "#F2C94C", 1.2) + C(184, 421, 2.6, "#E08A33", 0.6)  # counter lantern
c += stool(144, 372, 9, "#7B2D3A") + stool(148, 392, 9, "#7B2D3A") + stool(178, 394, 9, "#7B2D3A")

# lanterns on tables and bar
for lx, ly in [(212, 76), (468, 62), (178, 262), (456, 258), (398, 474)]:
    c += C(lx, ly, 5.5, "#F2C94C", 1.2) + C(lx, ly, 2.4, "#E08A33", 0.6) + C(lx, ly, 9, "none", 0.8, op=0.5)

specs["room-casino"] = {"title": "Casino", "desc": "Top-down gambling hall: card table, roulette wheel, dice table, banker's cage, bar corner and a red carpet.", "body": c, "shadow": ""}

# ============================================================================
# DUNGEON
# ============================================================================
d = room_shell(("#7E7B73", "flagHatch"), "#55534E", "stoneHatch")

# floor stains and cracks
d += P("M214 330 C228 318 256 320 262 334 C268 348 244 358 228 354 C212 350 206 340 214 330 Z", "#5B7F85", 0.8, op=0.45)
d += P("M310 252 l14 12 l-6 14 l16 10 M180 360 l16 -8 l8 14", sw=0.9, op=0.5)
# pools of torchlight
d += lantern_pool(52, 244, 60, "#E08A33", 0.18) + lantern_pool(172, 476, 52, "#E08A33", 0.18) + lantern_pool(344, 190, 40, "#E08A33", 0.14)

# four cells along the top: dividing walls, bars, gates, pallets, buckets, chains
cell_x = [28, 142, 256, 370]
for i in range(1, 4):
    d += R(cell_x[i] - 5, 28, 10, 140, "#5C5A55", 2) + hatch(f"M{cell_x[i] - 5} 28 h10 v140 h-10 Z", "stoneHatch")
d += R(28, 164, 456, 8, "#5C5A55", 1.0, op=0.0)
for i, x0 in enumerate(cell_x):
    x1 = x0 + 114
    # bars across the cell front, gap for the gate
    d += P(f"M{x0 + 4} 170 H{x1 - 4}", sw=2.2, st="#4D4B47")
    for bx in range(x0 + 10, x1 - 6, 10):
        if x0 + 40 < bx < x0 + 76:
            continue
        d += C(bx, 170, 3.4, "#8A8D90", 1.5) + C(bx - 1, 169, 1.1, "#C9CCCE", 0.0, st="none")
    # gate
    if i == 0:
        d += R(x0 + 76, 136, 5, 36, "#6B6E70", 1.4) + P(f"M{x0 + 78} 140 V168", sw=0.8) + C(x0 + 78, 172, 3, "#4D4B47", 1.0)
    else:
        d += R(x0 + 40, 166, 36, 8, "#5C5E60", 1.4)
        for gx in range(x0 + 46, x0 + 76, 8):
            d += C(gx, 170, 2.2, "#8A8D90", 0.8)
        d += C(x0 + 74, 170, 2.6, "#C9A24E", 0.8)
# cell 1: straw pallet, bucket, wall chain with manacles
d += P("M38 40 H92 Q98 40 98 48 V100 Q98 108 90 108 H40 Q34 108 34 100 V48 Q34 40 38 40 Z", "#D4B76A", 1.8)
for k in range(8):
    d += P(f"M{40 + k * 7} {46 + (k % 3) * 3} l6 {44 + (k % 2) * 8}", sw=0.8, st="#8F6F2F", op=0.6)
d += chain(30, 124, 56, 134, 5) + C(62, 136, 6, "none", 2.4, st="#6B6E70") + C(62, 136, 3.4, "none", 1.2, st="#8A8D90")
d += C(126, 152, 9, "#745846", 1.8) + C(126, 152, 6, "#3a3733", 0.8) + P("M117 148 A9 9 0 0 1 135 148", sw=1.2, st="#4D4B47")
# cell 2: bones, skull and a collapsed pallet
d += P("M168 60 L196 48 L236 62 L228 100 L184 106 L166 88 Z", "#D4B76A", 1.6) + P("M176 66 L224 70 M174 84 L222 90", sw=0.8, op=0.5)
d += bone(184, 124, 218, 134) + bone(190, 140, 226, 128) + skull(206, 118, 1.4, -20)
d += C(154, 152, 8, "#745846", 1.8) + C(154, 152, 5.2, "#3a3733", 0.8)
# cell 3: sleeping straw, ring bolt, shackles
d += P("M282 42 H340 Q348 42 348 50 V84 Q348 92 340 92 H282 Q274 92 274 84 V50 Q274 42 282 42 Z", "#D4B76A", 1.8)
for k in range(8):
    d += P(f"M{282 + k * 8} 46 l5 {38 + (k % 2) * 4}", sw=0.8, st="#8F6F2F", op=0.6)
d += C(282, 120, 4.5, "#4D4B47", 1.4) + chain(286, 122, 316, 138, 5) + C(322, 140, 6, "none", 2.4, st="#6B6E70") + C(332, 130, 6, "none", 2.4, st="#6B6E70")
d += C(346, 152, 9, "#745846", 1.8) + C(346, 152, 6, "#3a3733", 0.8)
d += bone(300, 100, 322, 108) + C(306, 150, 3, "#8E8B83", 1.0) + C(316, 156, 2.4, "#8E8B83", 1.0)
# cell 4: rotted straw, rat, overturned bucket
d += P("M396 100 L378 64 L418 46 L464 54 L470 96 L436 112 Z", "#D4B76A", 1.6) + P("M392 88 L446 66 M404 98 L460 78", sw=0.8, op=0.5)
d += E(404, 144, 9, 7, "#745846", 1.8, rot=20) + E(410, 150, 5, 3, "#3a3733", 0.8, rot=20)
d += E(452, 138, 8, 4, "#5B5855", 1.0, rot=-20) + C(459, 135, 2.2, "#5B5855", 0.8) + P("M444 140 Q436 146 430 142", sw=0.9)

# guard table with key ring, tankard, dice, candle, ledger; two stools
d += table(176, 212, 124, 54, "#876A56")
d += C(204, 238, 9, "none", 2.2, st="#C9A24E")
for k, ang in enumerate((-10, 30, 70)):
    d += G(P("M214 238 H238 M231 238 V245 M236 238 V244", sw=1.6, st="#C9A24E"), f"rotate({ang} 204 238)")
d += tankard(260, 226, hdl=0) + die(280, 232, 4, 18) + die(272, 248, 2, -20)
d += C(238, 252, 5, "#4D4B47", 1.2) + C(238, 252, 2.8, "#E3DAC4", 0.8) + flame(238, 251, 0.35)
d += R(218, 220, 24, 12, "#E6D9B5", 1.2) + P("M230 220 V232", sw=0.8)
d += stool(204, 286, 10) + stool(262, 286, 10)

# rack of chains and shackles on the right wall
d += R(450, 208, 30, 130, "#745846", 2.2) + hatch("M450 208 h30 v130 h-30 Z", "logHatch")
for i in range(5):
    yy = 222 + i * 26
    d += chain(446, yy, 414 - (i % 2) * 8, yy + (i % 3 - 1) * 5, 5)
    d += C(404 - (i % 2) * 8, yy + (i % 3 - 1) * 5, 6, "none", 2.4, st="#6B6E70") + C(396 - (i % 2) * 8, yy + (i % 3 - 1) * 5, 6, "none", 2.4, st="#6B6E70")
    d += C(458, yy, 3, "#4D4B47", 1.2)
# coil of chain and loose shackles on the floor
d += C(414, 362, 15, "none", 6, st=INK) + C(414, 362, 15, "none", 4, st="#8A8D90", extra='stroke-dasharray="6 3"') + C(414, 362, 8, "none", 3.5, st="#8A8D90", extra='stroke-dasharray="5 3"')
d += C(372, 316, 6, "none", 2.4, st="#6B6E70") + C(384, 322, 6, "none", 2.4, st="#6B6E70") + chain(372, 316, 384, 322, 2)

# spiral stair going down: stone rim, wedge steps getting darker, newel
sx, sy = 108, 328
d += C(sx, sy, 64, "#6F6D68", 2.6) + hatch(f"M{sx - 64} {sy} a64 64 0 1 0 128 0 a64 64 0 1 0 -128 0 Z", "stoneHatch")
d += C(sx, sy, 54, "#1b1a18", 2)
shades = ["#7A776F", "#716E67", "#67645E", "#5D5A55", "#53504C", "#494642", "#3F3D39", "#363431", "#2D2B29", "#252321", "#1E1D1B", "#1B1A18"]
for i in range(12):
    a0 = math.radians(i * 30 - 90)
    a1 = math.radians(i * 30 + 28 - 90)
    r0, r1 = 12, 52 - i * 0.8
    d += P(f"M{sx + r0 * math.cos(a0):.1f} {sy + r0 * math.sin(a0):.1f} L{sx + r1 * math.cos(a0):.1f} {sy + r1 * math.sin(a0):.1f} A{r1:.1f} {r1:.1f} 0 0 1 {sx + r1 * math.cos(a1):.1f} {sy + r1 * math.sin(a1):.1f} L{sx + r0 * math.cos(a1):.1f} {sy + r0 * math.sin(a1):.1f} A{r0} {r0} 0 0 0 {sx + r0 * math.cos(a0):.1f} {sy + r0 * math.sin(a0):.1f} Z", shades[i], 1.0)
d += C(sx, sy, 11, "#5C5A55", 1.8) + C(sx, sy, 5, "#3a3733", 1.0)
d += P(f"M{sx - 52} {sy} A52 52 0 0 1 {sx} {sy - 52}", "none", 3, st="#4B352B", op=0.0)
d += R(sx - 12, sy + 58, 24, 10, "#745846", 1.6, rx=2) if False else ""
d += P(f"M{sx - 36} {sy + 50} L{sx - 56} {sy + 58} M{sx + 36} {sy + 50} L{sx + 56} {sy + 58}", sw=0.1, op=0.0)

# collapsed tunnel mouth: dark opening, timber props, big fallen beam, rubble heap, bones
d += P("M418 356 L484 348 V466 L426 462 L412 410 Z", "#141211", 2.4)
d += R(416, 346, 68, 12, "#745846", 1.8) + R(420, 458, 64, 12, "#745846", 1.8)
d += R(410, 346, 12, 124, "#745846", 1.8) + hatch("M410 346 h12 v124 h-12 Z", "logHatch")
d += P("M392 348 L478 392 L472 404 L386 360 Z", "#745846", 1.8) + P("M392 348 L382 356 L388 364 L396 354 Z", "#B58F78", 1.0)
rubble = [("M436 410 L458 404 L466 424 L450 436 L430 426 Z", "#6F6D68"),
          ("M400 380 L420 374 L428 392 L412 402 L396 394 Z", "#A8A59B"), ("M418 408 L440 412 L440 432 L420 438 L410 424 Z", "#8E8B83"),
          ("M452 436 L476 440 L474 460 L452 462 Z", "#A8A59B"), ("M380 400 L396 408 L388 420 L376 414 Z", "#6F6D68"),
          ("M396 424 L414 430 L408 446 L392 440 Z", "#A8A59B")]
for rd, rf in rubble:
    d += P(rd, rf, 1.5) + hatch(rd, "stoneHatch")
for px, py, pr in [(374, 430, 3), (388, 452, 4), (404, 460, 3), (464, 470, 3), (414, 468, 2.5), (360, 408, 3), (432, 456, 3)]:
    d += C(px, py, pr, "#8E8B83", 1.0)
d += P("M360 392 C372 384 384 392 380 400 C374 406 362 402 360 392 Z", "#9a9890", 0.8, op=0.6)
d += skull(404, 420, 1.1, 30) + bone(380, 446, 410, 438) + bone(388, 462, 404, 452)

# torches in wall brackets
d += torch(30, 244, 0) + torch(172, 482, -90) + torch(344, 172, 90)

# floor grate, bucket of water and a mop leaning by the guard table
d += C(262, 336, 13, "#3a3733", 1.8) + P("M252 336 H272 M262 326 V346 M255 329 L269 343 M269 329 L255 343", sw=1.0, st="#6B6E70")
d += C(320, 296, 9, "#745846", 1.8) + C(320, 296, 6, "#5B7F85", 0.8) + P("M311 292 A9 9 0 0 1 329 292", sw=1.2, st="#4D4B47")
d += P("M300 340 L350 322", sw=3.4, st=INK) + P("M300 340 L350 322", sw=1.8, st="#BD9D86") + P("M292 336 Q284 346 294 352 Q304 350 306 342 Z", "#C9B889", 1.0)

specs["room-dungeon"] = {"title": "Dungeon", "desc": "Top-down dungeon: four barred cells with pallets, guard table, rack of chains, spiral stair down and a collapsed tunnel.", "body": d, "shadow": ""}

# ============================================================================
# GRANARY
# ============================================================================
g = room_shell(("#D4B76A", "plankHatch"), "#745846", "logHatch")

# loose straw scattered on the planks
for sx_, sy_, sa in [(160, 160, 20), (186, 346, 70), (350, 148, 110), (232, 430, 10), (300, 390, 40), (120, 196, 150), (350, 330, 90)]:
    g += P(f"M{sx_} {sy_} l16 -5 M{sx_ + 4} {sy_ + 5} l14 -6", sw=1.0, st="#A8872F", op=0.7, extra=f'transform="rotate({sa} {sx_} {sy_})"')

# stacked sack piles, top-left (overlapping rows)
for i, sxx in enumerate((38, 84, 130, 176)):
    g += sack(sxx, 40, 46, 30, ["#D9C79A", "#CBB988", "#E2D3A8", "#D9C79A"][i], (i % 2) * 6 - 3)
for i, sxx in enumerate((58, 106, 154)):
    g += sack(sxx, 62, 46, 30, ["#CBB988", "#E2D3A8", "#D9C79A"][i], 4 - i * 4)
for i, sxx in enumerate((82, 130)):
    g += sack(sxx, 84, 44, 28, ["#E2D3A8", "#CBB988"][i], i * 8 - 4)

# round grain hopper and sieve between the sacks and the bins
g += barrel_top(250, 70, 28) + C(250, 70, 18, "#8F6F52", 1.0) + R(244, 64, 12, 12, "#745846", 1.2, rx=2)
g += C(246, 130, 18, "#876A56", 1.8) + C(246, 130, 14, "#D7C39A", 1.0)
for k in range(-2, 3):
    g += P(f"M{246 + k * 5} 118 V142 M234 {130 + k * 5} H258", sw=0.5, op=0.45)

# two grain bins (planked, one full, one half-empty) with spilled wheat and a shovel
g += R(298, 38, 88, 88, "#876A56", 2.4) + hatch("M298 38 h88 v88 h-88 Z", "plankHatch") + R(308, 48, 68, 68, "#E0B94A", 1.6)
for k in range(1, 6):
    g += P(f"M310 {48 + k * 11} H374", sw=0.6, st="#B98B2E", op=0.55, extra='stroke-dasharray="2 4"')
g += E(342, 82, 22, 16, "#EBC95E", 1.0) + kernels(342, 82, 24, 26, 7, "#B98B2E", 1.1)
g += R(396, 38, 88, 88, "#876A56", 2.4) + hatch("M396 38 h88 v88 h-88 Z", "plankHatch") + R(406, 48, 68, 68, "#BD9D86", 1.6)
g += P("M406 116 L430 82 L452 90 L474 116 Z", "#E0B94A", 1.4) + kernels(442, 100, 22, 18, 11, "#B98B2E", 1.1)
for k in range(1, 5):
    g += P(f"M406 {48 + k * 14} H474", sw=0.6, op=0.4)
g += P("M370 126 C382 140 360 150 344 146 C330 142 336 130 350 128 Z", "#E0B94A", 1.2) + kernels(358, 138, 16, 12, 5, "#B98B2E", 1.1)
g += kernels(340, 150, 8, 6, 9, "#E0B94A", 1.2)
g += G(R(384, 78, 78, 4, "#9F7D68", 1.3, rx=2) + P("M458 74 H476 L478 86 H460 Z", "#8A8D90", 1.4), "rotate(28 420 80)")
g += R(300, 40, 8, 20, "#745846", 1.2) + R(300, 104, 8, 20, "#745846", 1.2)

# threshing floor: ring of stones, packed straw disc, sheaves, flail, loose kernels
tx, ty = 266, 262
g += C(tx, ty, 80, "#B8A06A", 2.4) + C(tx, ty, 72, "#C9AE6B", 1.4)
for i in range(30):
    a = i * math.tau / 30
    g += E(round(tx + 80 * math.cos(a), 1), round(ty + 80 * math.sin(a), 1), 7, 5, "#8E8B83" if i % 2 else "#A8A59B", 1.3, rot=round(math.degrees(a)))
for i in range(14):
    a = i * math.tau / 14
    g += P(f"M{tx + 18 * math.cos(a):.1f} {ty + 18 * math.sin(a):.1f} L{tx + 66 * math.cos(a):.1f} {ty + 66 * math.sin(a):.1f}", sw=0.6, st="#8F6F2F", op=0.35)
for ang in (-25, 40, 115, 200):
    sh = P("M-26 0 C-14 -10 14 -10 26 0 C14 10 -14 10 -26 0 Z", "#D9B85A", 1.5) + P("M-20 -3 L22 -3 M-20 3 L22 3 M-12 -6 L16 -6", sw=0.6, op=0.5)
    sh += P("M-6 -9 C-4 -2 -4 2 -6 9 M6 -9 C4 -2 4 2 6 9", sw=2, st="#745846")
    d_ = 40
    g += G(sh, f"translate({tx + d_ * math.cos(math.radians(ang)):.1f} {ty + d_ * math.sin(math.radians(ang)):.1f}) rotate({ang + 90})")
g += G(R(-50, -2.5, 56, 5, "#9F7D68", 1.3, rx=2) + R(8, -3.5, 36, 7, "#745846", 1.3, rx=3) + C(6.5, 0, 2.2, "#4B352B", 0.8), f"translate({tx - 4} {ty + 6}) rotate(-20)")
g += kernels(tx, ty, 62, 40, 21, "#E0B94A", 1.2)

# hand mill: stone base with groove spokes, running stone, eye, handle peg, flour spill and a catching sack
mx_, my_ = 98, 240
g += P(f"M{mx_ - 26} {my_ + 18} C{mx_ - 40} {my_ + 40} {mx_ + 6} {my_ + 56} {mx_ + 36} {my_ + 40} C{mx_ + 46} {my_ + 30} {mx_ + 28} {my_ + 26} {mx_ + 24} {my_ + 16} Z", "#EFE6CF", 1.0, op=0.9)
g += C(mx_, my_, 38, "#8E8B83", 2.2) + hatch(f"M{mx_ - 38} {my_} a38 38 0 1 0 76 0 a38 38 0 1 0 -76 0 Z", "stoneHatch")
for i in range(8):
    a = i * math.pi / 4 + 0.2
    g += P(f"M{mx_ + 12 * math.cos(a):.1f} {my_ + 12 * math.sin(a):.1f} L{mx_ + 34 * math.cos(a):.1f} {my_ + 34 * math.sin(a):.1f}", sw=0.9, op=0.5)
g += C(mx_, my_, 28, "#A8A59B", 1.8) + C(mx_, my_, 8, "#3a3733", 1.4) + C(mx_ + 17, my_ - 10, 4, "#6F6D68", 1.0)
g += P(f"M{mx_ + 20} {my_ - 12} L{mx_ + 4} {my_ - 6}", sw=0.1, op=0)
g += G(R(mx_ + 20, my_ - 3, 40, 5, "#9F7D68", 1.4, rx=2) + C(mx_ + 22, my_ - 0.5, 4, "#745846", 1.2), f"rotate(-50 {mx_} {my_})")
g += sack(70, 280, 40, 24, "#E8DDBE", 4)

# scales on a small table: balance beam, two pans, weights tray
g += table(394, 224, 88, 70, "#876A56") + R(399, 229, 78, 60, "none", 0.9, op=0.4)
g += C(438, 252, 6, "#4D4B47", 1.3) + P("M410 252 H466", sw=3.2, st=INK) + P("M410 252 H466", sw=1.6, st="#C9A24E")
g += C(410, 252, 14, "#C9A24E", 1.6) + C(410, 252, 10, "#E0B94A", 0.8) + kernels(410, 252, 8, 10, 2, "#B98B2E", 1.0)
g += C(466, 252, 14, "#C9A24E", 1.6) + C(466, 252, 10, "#A8A59B", 0.8)
for wx_, wy_, wr in [(462, 250, 4), (470, 254, 3), (466, 258, 2.6)]:
    g += C(wx_, wy_, wr, "#6F6D68", 0.9)
for i, wr in enumerate((6.5, 5.5, 4.6, 3.8, 3.0)):
    g += C(406 + i * 14, 278, wr, "#8A8D90", 1.1) + C(406 + i * 14, 278, wr * 0.4, "none", 0.5)

# spilled heap of wheat on the floor, scoop and shovel
g += P("M352 358 C340 336 372 322 396 330 C422 336 428 362 410 376 C392 388 360 380 352 358 Z", "#E0B94A", 1.8)
g += P("M368 350 C378 340 396 340 404 350", sw=0.9, op=0.5) + kernels(390, 356, 44, 40, 14, "#B98B2E", 1.2)
g += G(R(384, 352, 66, 4, "#9F7D68", 1.3, rx=2) + P("M446 346 H462 L466 358 H448 Z", "#8A8D90", 1.4), "rotate(48 410 352)")

# loft platform in the corner with posts, a rope coil, two sacks on it; ladder rising to it
g += R(56, 296, 44, 6, "#9F7D68", 1.4, rx=1, rot=0)
for ry in range(304, 388, 11):
    g += P(f"M58 {ry} H98", sw=2.4, st="#876A56") + P(f"M58 {ry} H98", sw=0.9)
g += R(54, 292, 7, 100, "#9F7D68", 1.8) + R(97, 292, 7, 100, "#9F7D68", 1.8)
g += P("M30 388 H184 V484 H30 Z", "#BD9D86", 0.0, op=0.0)
g += R(30, 386, 154, 98, "#8F6F52", 2.6) + hatch("M30 386 H184 V484 H30 Z", "plankHatch")
for xx in range(58, 184, 28):
    g += P(f"M{xx} 387 V483", sw=0.8, op=0.4)
g += R(28, 384, 158, 6, "#745846", 2.0) + R(182, 384, 6, 102, "#745846", 2.0)
g += P("M60 388 H98 V398 H60 Z", "#26211f", 1.4)  # trap opening where the ladder comes through
g += C(36, 392, 6, "#745846", 1.8) + C(180, 392, 6, "#745846", 1.8) + C(180, 478, 6, "#745846", 1.8)
g += C(150, 460, 14, "none", 5, st=INK) + C(150, 460, 14, "none", 3, st="#C9B889") + C(150, 460, 7, "none", 2.5, st="#C9B889") + C(150, 460, 2.5, "#4B352B", 0.8)
g += sack(50, 430, 44, 28, "#D9C79A", -8) + sack(60, 452, 44, 26, "#CBB988", 6) + sack(112, 410, 42, 26, "#E2D3A8", 10)
g += P("M126 412 L136 392", sw=1.2, st="#4B352B")

# wheat sheaf shock and a winnowing basket by the threshing floor
for sx_, sy_ in [(150, 176), (168, 168), (164, 190), (144, 194)]:
    g += C(sx_, sy_, 11, "#D9B85A", 1.6) + C(sx_, sy_, 5, "#E0B94A", 0.8) + P(f"M{sx_ - 9} {sy_} H{sx_ + 9} M{sx_} {sy_ - 9} V{sy_ + 9}", sw=0.6, op=0.5)
g += C(158, 182, 3.4, "#745846", 1.0)
g += C(184, 344, 22, "#9F7D68", 1.8) + C(184, 344, 17, "#D9C79A", 1.0)
for k in range(-3, 4):
    g += P(f"M{184 + k * 5} 330 V358", sw=0.5, op=0.4)
g += kernels(184, 344, 13, 14, 17, "#E0B94A", 1.1)

# pitchfork and broom against the south wall
g += P("M348 470 L412 438", sw=4.0, st=INK) + P("M348 470 L412 438", sw=2.2, st="#BD9D86")
g += P("M348 470 C334 466 322 476 326 486 C334 492 348 488 354 480 Z", "#C9A24E", 1.4) + P("M338 472 L344 482 M332 476 L342 486", sw=0.7, op=0.6)
g += P("M412 438 V424 M402 436 V426 M422 446 V430", sw=1.6, st="#8A8D90")

# bottom-right sack pile
for i, (sxx, syy, rr, col) in enumerate([(414, 436, 8, "#D9C79A"), (440, 428, -6, "#CBB988"), (424, 456, 4, "#E2D3A8"), (452, 458, -4, "#D9C79A")]):
    g += sack(sxx, syy, 44, 28, col, rr)

specs["room-granary"] = {"title": "Granary", "desc": "Top-down granary: sack piles, grain bins, threshing floor, hand mill, scales, loft with ladder and spilled wheat.", "body": g, "shadow": ""}
