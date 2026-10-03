"""Rooms A: aviary, armorer, barracks, blacksmith (top-down interior tiles)."""
import math
import random

from bastion_lib import *

specs = {}


# ---- local drawing helpers ---------------------------------------------------
def P(d, fill="none", sw=1.6, ex=""):
    return f'    <path d="{d}" fill="{fill}" stroke-width="{sw}"{(" " + ex) if ex else ""}/>\n'


def R(x, y, w, h, fill, sw=1.8, rx=0, ex=""):
    return f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke-width="{sw}"{(" " + ex) if ex else ""}/>\n'


def C(cx, cy, r, fill, sw=1.6, ex=""):
    return f'    <circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke-width="{sw}"{(" " + ex) if ex else ""}/>\n'


def E(cx, cy, rx, ry, fill, sw=1.6, ex=""):
    return f'    <ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}" stroke-width="{sw}"{(" " + ex) if ex else ""}/>\n'


def G(x, y, rot, inner, s=1):
    sc = f" scale({s})" if s != 1 else ""
    return f'    <g transform="translate({x} {y}) rotate({rot}){sc}">\n{inner}    </g>\n'


def overlay(d, pat):
    return P(d, f"url(#{pat})", 0, 'stroke="none"')


def straws(seed, cx, cy, n=10, spread=24, col="#9C7F32"):
    r = random.Random(seed)
    d = ""
    for _ in range(n):
        x = cx + r.uniform(-spread, spread)
        y = cy + r.uniform(-spread * 0.6, spread * 0.6)
        a = r.uniform(0, math.pi)
        l = r.uniform(7, 13)
        d += f"M{x:.1f} {y:.1f} l{l * math.cos(a):.1f} {l * math.sin(a):.1f} "
    return P(d, "none", 1.3, f'stroke="{col}" opacity="0.85"')


def feather(x, y, rot=0, fill="#F3EEE0"):
    return G(x, y, rot, P("M0 0 C3 -4 7 -4 11 -1 C7 1.5 3 2 0 0 Z", fill, 0.8) + P("M0 0 L10 -1", "none", 0.6, 'opacity="0.6"'))


def soot(seed, cx, cy, n, spread, op=0.13):
    r = random.Random(seed)
    out = ""
    for _ in range(n):
        x = cx + r.uniform(-spread, spread)
        y = cy + r.uniform(-spread, spread)
        out += E(f"{x:.0f}", f"{y:.0f}", f"{r.uniform(8, 22):.0f}", f"{r.uniform(6, 14):.0f}", "#2c2622", 0, f'stroke="none" opacity="{op}" transform="rotate({r.randint(0, 170)} {x:.0f} {y:.0f})"')
    return out


STEEL, STEEL_D = "#B9BFC1", "#868D90"
IRON = "#4D4B47"
PARCH = "#E6D9B5"
COAL = "#26211f"


# ==============================================================================
# AVIARY
# ==============================================================================
def pigeon(x, y, rot=0, col="#8C93A0", dark="#6A7080", s=1.0):
    inner = (
        P("M-3.5 8 L-5.5 17 L0 14.5 L5.5 17 L3.5 8 Z", dark, 1.1)
        + E(0, 1, 6.8, 9.2, col, 1.3)
        + P("M-6.3 -2 C-9 4 -7.5 11 -2.5 13 L-1.5 -1 Z M6.3 -2 C9 4 7.5 11 2.5 13 L1.5 -1 Z", dark, 1)
        + C(0, -9.5, 3.7, col, 1.2)
        + P("M-3.6 -6.2 Q0 -3.5 3.6 -6.2", "none", 1.6, 'stroke="#6C5B8C"')
        + P("M-1.3 -12.8 L0 -16.5 L1.3 -12.8 Z", "#E0A64A", 0.9)
        + C(-1.8, -10, 0.7, INK, 0, 'stroke="none"')
        + C(1.8, -10, 0.7, INK, 0, 'stroke="none"')
    )
    return G(x, y, rot, inner, s)


def nestbox(x, y, side, content, s=26):
    cx, cy = x + s / 2, y + s / 2
    o = R(x, y, s, s, "#876A56", 1.8)
    o += R(x + 4, y + 4, s - 8, s - 8, "#33261e", 1)
    if content in ("straw", "eggs"):
        o += C(cx, cy, 6, STRAW, 1.1) + C(cx, cy, 2.6, "#A8873A", 0.6)
    if content == "eggs":
        o += E(cx - 2, cy, 2.4, 3.2, "#F4EEDC", 0.8) + E(cx + 2.6, cy + 0.5, 2.4, 3.2, "#F4EEDC", 0.8)
    if content == "bird":
        o += C(cx, cy, 6.5, STRAW, 0.8) + pigeon(cx, cy + 1, 0, "#A39C95", "#7A7068", 0.58)
    if side == "top":
        o += R(x + 2, y + s, s - 4, 3.5, "#BD9D86", 1.2)
    elif side == "left":
        o += R(x + s, y + 2, 3.5, s - 4, "#BD9D86", 1.2)
    else:
        o += R(x - 3.5, y + 2, 3.5, s - 4, "#BD9D86", 1.2)
    return o


def perch(x1, x2, y):
    o = R(x1 - 5, y - 15, 10, 30, "#745846", 1.6, 2) + R(x2 - 5, y - 15, 10, 30, "#745846", 1.6, 2)
    o += R(x1, y - 3.5, x2 - x1, 7, "#A9856E", 1.6, 3)
    o += P(f"M{x1 + 40} {y} H{x1 + 52} M{x2 - 70} {y} H{x2 - 60}", "none", 1, 'opacity="0.5"')
    return o


def sack(x, y, rot=0, fill="#C9B58F"):
    inner = (
        P("M-20 14 C-25 -2 -18 -18 -6 -22 L-5 -27 L5 -27 L6 -22 C18 -18 25 -2 20 14 C14 22 -14 22 -20 14 Z", fill, 2)
        + P("M-6 -22 Q0 -18 6 -22", "none", 1.8, 'stroke="#745846"')
        + P("M-10 -8 Q-4 0 -12 8 M8 -6 Q14 0 10 10 M-2 -4 Q2 4 -2 12", "none", 0.9, 'opacity="0.5"')
    )
    return G(x, y, rot, inner)


def grain(seed, cx, cy, n, spread):
    r = random.Random(seed)
    o = ""
    for _ in range(n):
        o += C(f"{cx + r.uniform(-spread, spread):.1f}", f"{cy + r.uniform(-spread * 0.7, spread * 0.7):.1f}", 1.1, "#E0C25A", 0.4)
    return o


def scroll_tube(x, y, rot=0, fill="#8A5F3E", l=44):
    inner = (
        R(-l / 2, -5, l, 10, fill, 1.6, 4)
        + P(f"M{-l / 2 + 6} -5 V5 M{l / 2 - 6} -5 V5", "none", 1.2)
        + C(l / 2 - 2, 0, 3.2, "#D7C39A", 1)
    )
    return G(x, y, rot, inner)


av = room_shell(FLOOR_WOOD, "#745846", "logHatch")

# floor litter first: straw drifts, feathers, droppings under the perches
av += "    <!-- straw drifts and feathers -->\n"
for sd, (sx, sy, n, sp) in enumerate([(120, 260, 14, 30), (300, 340, 12, 34), (430, 160, 10, 24), (170, 100, 12, 26), (70, 190, 10, 22), (330, 120, 8, 22), (90, 380, 10, 20)]):
    av += straws(sd + 3, sx, sy, n, sp)
for fx, fy, fr in [(150, 230, 30), (300, 300, 160), (250, 120, 70), (410, 200, 200), (120, 340, 100), (360, 370, 20), (210, 190, 250), (60, 220, 310)]:
    av += feather(fx, fy, fr)

# perch poles with droppings beneath (drawn before the poles)
av += "    <!-- droppings -->\n"
rr = random.Random(9)
for py in (140, 196):
    for _ in range(14):
        dx = rr.uniform(120, 395)
        av += E(f"{dx:.0f}", f"{py + rr.uniform(8, 20):.0f}", f"{rr.uniform(1.5, 3.2):.1f}", f"{rr.uniform(1.2, 2.4):.1f}", "#EDE8DA", 0.5)
        av += C(f"{dx + 2:.0f}", f"{py + rr.uniform(10, 22):.0f}", 1, "#6B6458", 0, 'stroke="none"')

# ring of nesting boxes: top wall, left wall, right wall
av += "    <!-- nesting boxes along three walls -->\n"
cycle = ["straw", "bird", "eggs", "empty", "straw", "bird", "empty", "eggs", "bird", "straw"]
for i in range(13):
    av += nestbox(44 + i * 34, 30, "top", cycle[(i * 3) % 10])
for i in range(9):
    av += nestbox(30, 72 + i * 34, "left", cycle[(i * 3 + 1) % 10])
    av += nestbox(458, 72 + i * 34, "right", cycle[(i * 3 + 2) % 10])

# perches
av += "    <!-- two perch poles -->\n"
av += perch(110, 400, 140) + perch(130, 380, 196)
for px, pr, pc in [(150, 90, "#8C93A0"), (190, 100, "#B9B2A8"), (232, 85, "#74798A"), (300, 95, "#8C93A0"), (350, 88, "#A39C95")]:
    av += pigeon(px, 140, pr, pc, "#5F6574" if pc != "#B9B2A8" else "#8A8378")
for px, pr, pc in [(170, 80, "#A39C95"), (225, 95, "#8C93A0"), (290, 92, "#B9B2A8"), (335, 85, "#74798A")]:
    av += pigeon(px, 196, pr, pc, "#5F6574" if pc != "#B9B2A8" else "#8A8378")

# bird-bath basin
av += "    <!-- bird bath: stone rim, water, splashes -->\n"
av += C(250, 268, 30, STONE_L, 2.2) + overlay("M220 268 a30 30 0 1 0 60 0 a30 30 0 1 0 -60 0 Z", "stoneHatch")
av += C(250, 268, 22, WATER, 1.6) + C(250, 268, 22, "url(#waterHatch)", 0, 'stroke="none"')
av += C(244, 262, 6, "none", 0.9, 'stroke="#A3C9CC" opacity="0.9"') + C(244, 262, 11, "none", 0.7, 'stroke="#A3C9CC" opacity="0.7"')
av += pigeon(250, 238, 180, "#8C93A0", "#6A7080", 0.9)
for dx, dy in [(266, 258), (270, 276), (232, 280)]:
    av += C(dx, dy, 1.5, "#A3C9CC", 0.6)

# ladder hatch with its open lid
av += "    <!-- ladder hatch in floor and its open lid -->\n"
av += R(78, 252, 58, 68, "#745846", 2) + R(86, 260, 42, 52, "#1d1a18", 1.4)
av += R(92, 256, 5, 60, "#BD9D86", 1.2) + R(118, 256, 5, 60, "#BD9D86", 1.2)
for ry in (268, 282, 296, 310):
    av += R(92, ry, 31, 4, "#A9856E", 1)
av += R(142, 252, 52, 68, "#876A56", 2) + overlay("M142 252 H194 V320 H142 Z", "plankHatch")
av += P("M142 270 H194 M142 302 H194", "none", 1.2) + C(182, 286, 4, "none", 1.5) + R(145, 262, 6, 10, "#4D4B47", 1) + R(145, 300, 6, 10, "#4D4B47", 1)

# message desk
av += "    <!-- message desk: parchment, scroll tubes, inkwell, quill, candle, band bowl -->\n"
av += table(338, 224, 108, 70, "#876A56")
av += G(368, 252, -8, R(-18, -13, 36, 26, PARCH, 1.2) + P("M-12 -6 H12 M-12 0 H10 M-12 6 H6", "none", 0.9, 'opacity="0.65"'))
av += scroll_tube(402, 241, 6, "#8A5F3E") + scroll_tube(406, 254, -4, "#745846") + scroll_tube(400, 267, 3, "#9C3F3A", 40)
av += C(354, 276, 6, "#33261e", 1.3) + C(354, 276, 3, "#1d1a18", 0.5)
av += P("M356 274 C368 262 376 266 382 258", "none", 1.3) + P("M382 258 L387 252 L384 262 Z", "#F3EEE0", 0.9)
av += C(430, 236, 5, "#F1ECDD", 1.4) + C(430, 236, 2, "#F2B544", 0.6) + C(430, 236, 9, "#F2B544", 0, 'stroke="none" opacity="0.18"')
av += C(430, 280, 8, "#A9856E", 1.4) + C(430, 280, 5, "#6B4A36", 0.7) + C(428, 279, 1.4, "#C9A24E", 0.4) + C(432, 281, 1.4, "#C9A24E", 0.4)
av += pigeon(434, 258, 270, "#A39C95", "#7A7068", 0.7)
av += stool(394, 312, 12)

# feed trough, carrier cage, sacks
av += "    <!-- grain trough, wicker carrier cage, sacks of grain -->\n"
av += P("M160 340 H250 L244 366 H166 Z", "#876A56", 2) + P("M168 346 H242 L238 360 H170 Z", "#E0C25A", 1)
av += grain(5, 205, 353, 22, 28)
for gx in (176, 200, 224):
    av += pigeon(gx, 330, 180, "#A39C95", "#7A7068", 0.8)
av += R(104, 384, 56, 44, "#BD9D86", 2, 5) + overlay("M104 384 H160 V428 H104 Z", "leanHatch")
av += P("M114 384 V428 M126 384 V428 M138 384 V428 M150 384 V428", "none", 1.2, 'opacity="0.6"') + R(104, 384, 56, 8, "#876A56", 1.4, 3)
av += pigeon(132, 404, 15, "#B9B2A8", "#8A8378", 0.7)
av += sack(66, 410, -10) + grain(2, 62, 440, 10, 20) + sack(452, 418, 14, "#D2BE96") + sack(414, 452, -22)
av += grain(8, 440, 452, 14, 24)
av += P("M70 380 L84 360", "none", 2.2, 'stroke="#745846"') + C(86, 358, 4, "#A9856E", 1.2)
av += pigeon(300, 350, -20, "#8C93A0", "#6A7080", 0.8) + pigeon(86, 220, 130, "#B9B2A8", "#8A8378", 0.8) + pigeon(420, 345, 200, "#74798A", "#555B6A", 0.8)

# hay bale, wicker basket stack, lantern, broom
av += "    <!-- hay bale, baskets, lantern, broom -->\n"
av += R(300, 316, 62, 38, STRAW, 2, 3) + overlay("M300 316 H362 V354 H300 Z", "leanHatch") + P("M318 316 V354 M344 316 V354", "none", 1.6, 'stroke="#745846"')
av += straws(14, 330, 336, 8, 26) + C(396, 372, 14, "#BD9D86", 1.8) + C(396, 372, 9, "#876A56", 1.2) + C(396, 372, 14, "url(#leanHatch)", 0, 'stroke="none"') + pigeon(396, 372, 40, "#A39C95", "#7A7068", 0.6)
av += C(176, 306, 10, "#BD9D86", 1.8) + C(176, 306, 6, "#33261e", 1)
av += C(60, 340, 7, "#4D4B47", 1.6) + C(60, 340, 3.5, "#F2B544", 0.8) + C(60, 340, 16, "#F2B544", 0, 'stroke="none" opacity="0.15"')
av += G(172, 394, 70, R(-26, -1.6, 38, 3.2, "#A9856E", 1) + P("M12 -6 L26 -8 L26 8 L12 6 Z", "#C9B58F", 1.4))

specs["room-aviary"] = {
    "title": "Aviary",
    "desc": "Pigeon loft with a ring of nesting boxes, perches, a message desk with scroll tubes, a bird bath and a ladder hatch.",
    "body": av,
    "shadow": "",
}


# ==============================================================================
# ARMORER
# ==============================================================================
RINGS = '''
    <defs><pattern id="raRings" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="2" fill="none" stroke="#010206" stroke-width="0.6" opacity="0.45"/>
    </pattern></defs>
'''
SHOULDERS = "M-32 4 C-35 -9 -20 -15 -8 -11 L8 -11 C20 -15 35 -9 32 4 C30 13 18 15 8 12 L-8 12 C-18 15 -30 13 -32 4 Z"
ARM = {"mail": ("#9AA0A2", "#6F7679"), "plate": ("#CBD0D2", "#8C9396"), "leather": ("#8A5F3E", "#5F4129")}


def armor_stand(x, y, kind, rot=0):
    col, dark = ARM[kind]
    # torso, two pauldrons with lame lines, helm
    s = E(-23, 2, 10, 8, col, 1.8) + E(23, 2, 10, 8, col, 1.8) + E(0, 3, 17, 13, col, 2)
    s += P("M-30 -1 Q-23 -5 -16 -1 M-29 5 Q-23 2 -17 5 M30 -1 Q23 -5 16 -1 M29 5 Q23 2 17 5", "none", 0.9, 'opacity="0.6"')
    if kind == "mail":
        s += P("M-17 3 a17 13 0 1 0 34 0 a17 13 0 1 0 -34 0 Z M-33 2 a10 8 0 1 0 20 0 a10 8 0 1 0 -20 0 Z M13 2 a10 8 0 1 0 20 0 a10 8 0 1 0 -20 0 Z", "url(#raRings)", 0, 'stroke="none"')
        s += C(0, -1, 9, col, 1.8) + C(0, -1, 9, "url(#raRings)", 0, 'stroke="none"') + P("M-5 5 Q0 8 5 5", "none", 1.2)
    elif kind == "plate":
        s += P("M-11 12 Q0 16 11 12 M0 -8 V15 M-10 6 Q0 10 10 6", "none", 1.1, 'opacity="0.6"')
        s += C(0, -1, 9, "#D8DCDD", 1.8) + P("M0 -10 V8 M-7 4 H7", "none", 1.1) + P("M-6 -2 H6", "none", 2.2, f'stroke="{INK}"')
        s += P("M0 -9 Q5 -14 0 -19 Q-5 -14 0 -9 Z", "#9C3F3A", 1)
    else:
        s += P("M-12 4 Q0 -4 12 4", "none", 0.9, 'stroke-dasharray="2 2" opacity="0.8"')
        s += C(0, -1, 8.5, "#6B4A36", 1.8) + P("M-6 -1 H6 M0 -8 V6", "none", 1, 'opacity="0.55"')
    return G(x, y, rot, s, 1.1)


def round_shield(cx, cy, r, fill, rim="#4D4B47"):
    return (
        C(cx, cy, r, fill, 1.9) + C(cx, cy, r - 4, "none", 1.2, 'opacity="0.7"') + C(cx, cy, 5, STEEL, 1.4)
        + P(f"M{cx - r + 3} {cy} H{cx + r - 3} M{cx} {cy - r + 3} V{cy + r - 3}", "none", 1, 'opacity="0.35"')
    )


def hide(x, y, rot, fill, s=1):
    d = "M-22 -10 C-26 -18 -18 -22 -12 -16 C-6 -22 6 -22 12 -16 C18 -22 26 -18 22 -10 C28 -2 26 6 20 12 C24 20 14 24 10 18 C4 22 -4 22 -10 18 C-14 24 -24 20 -20 12 C-26 6 -28 -2 -22 -10 Z"
    return G(x, y, rot, P(d, fill, 1.8) + P("M0 -16 V16", "none", 0.9, 'opacity="0.4"') + P("M-12 -4 Q-6 0 -10 6 M12 -4 Q6 0 10 6", "none", 0.7, 'opacity="0.35"'), s)


def bellows(x, y, rot, s=1):
    inner = (
        R(0, -3, 22, 6, IRON, 1.4, 2)
        + P("M-4 -4 L-44 -19 Q-54 0 -44 19 L-4 4 Z", "#8A5F3E", 2)
        + P("M-14 -8 Q-18 0 -14 8 M-26 -13 Q-32 0 -26 13 M-38 -17 Q-44 0 -38 17", "none", 1.2, 'opacity="0.7"')
        + R(-62, -4, 20, 8, "#745846", 1.6, 3) + C(-62, 0, 4, "#A9856E", 1.2)
    )
    return G(x, y, rot, inner, s)


def anvil(x, y, rot=0, s=1):
    inner = (
        P("M-24 -10 H10 C18 -10 28 -5 38 0 C28 5 18 10 10 10 H-24 Z", "#7D8386", 2)
        + P("M-24 -10 H10 C18 -10 28 -5 38 0 L-24 0 Z", "#A4AAAC", 0, 'stroke="none"')
        + P("M-24 -10 H10 C18 -10 28 -5 38 0 C28 5 18 10 10 10 H-24 Z", "none", 2)
        + R(-19, -4, 6, 6, "#26211f", 1) + C(-5, 0, 2.4, "#26211f", 0.8) + P("M-9 -7 H12", "none", 0.8, 'opacity="0.5"')
    )
    return G(x, y, rot, inner, s)


def counter_top(d):
    return P(d, "#9F7D68", 2.4) + overlay(d, "plankHatch")


ar = room_shell(FLOOR_FLAG, "#6F6D68", "stoneHatch") + RINGS

# customer-side rug in front of the counter gap
ar += "    <!-- rug before the counter -->\n"
ar += rug(204, 340, 104, 54, "#6C5B8C", "#D7C39A")
ar += P("M222 367 L256 350 L290 367 L256 384 Z", "none", 1.6, 'stroke="#D7C39A"') + C(256, 366, 5, "#C9A24E", 1.1)

# workshop: mail-sewing bench
ar += "    <!-- mail-sewing bench: ring heap, half-made hauberk, pliers, wire spool -->\n"
ar += table(40, 36, 140, 52, "#876A56")
ar += C(66, 62, 15, "#9AA0A2", 1.5) + overlay("M51 62 a15 15 0 1 0 30 0 a15 15 0 1 0 -30 0 Z", "raRings")
rr = random.Random(4)
for _ in range(22):
    ar += C(f"{rr.uniform(84, 112):.1f}", f"{rr.uniform(48, 78):.1f}", 2.4, "none", 1.2, 'stroke="#C5CBCD"')
ar += G(136, 64, 12, P("M-14 -4 L10 2 M-14 4 L10 -2", "none", 2.4) + C(-14, -4, 2, "#5F4434", 1) + C(-14, 4, 2, "#5F4434", 1) + C(0, 0, 1.6, STEEL, 0.8))
ar += C(162, 52, 8, "#745846", 1.4) + C(162, 52, 4, "#B9BFC1", 1) + C(162, 52, 1.4, INK, 0, 'stroke="none"')
ar += P("M150 78 C158 74 164 80 172 76", "none", 1.3, 'stroke="#C5CBCD"')
ar += stool(108, 106, 11)

# stacked hides
ar += "    <!-- pile of leather hides -->\n"
ar += hide(236, 72, 14, "#B88B5A", 1.15) + hide(252, 76, -30, "#8A5F3E", 1.05) + hide(228, 58, 48, "#C9A66B", 0.95) + hide(246, 58, -8, "#6B4A36", 0.8)

# chest of buckles (open lid above)
ar += "    <!-- open chest of buckles -->\n"
ar += R(300, 34, 52, 16, "#745846", 1.8, 2) + R(305, 38, 42, 8, "#8A5F3E", 1, 1) + R(300, 52, 52, 30, "#8F6F52", 2) + R(304, 56, 44, 22, "#33261e", 1.2)
rr = random.Random(11)
for _ in range(13):
    bx, by = rr.uniform(309, 343), rr.uniform(60, 74)
    ar += R(f"{bx:.1f}", f"{by:.1f}", 6, 5, "none", 1.2, 1, 'stroke="#C9A24E"') + P(f"M{bx + 3:.1f} {by + 0.5:.1f} V{by + 4.5:.1f}", "none", 0.9, 'stroke="#C9A24E"')
ar += R(325, 52, 4, 30, "#4D4B47", 1, 0)

# small forge with bellows
ar += "    <!-- small forge, bellows, anvil, quench barrel -->\n"
ar += R(390, 32, 94, 66, STONE, 2.4, 3) + overlay("M390 32 H484 V98 H390 Z", "stoneHatch")
ar += R(402, 44, 70, 42, COAL, 1.6, 3)
rr = random.Random(21)
for _ in range(20):
    ar += C(f"{rr.uniform(408, 466):.1f}", f"{rr.uniform(50, 80):.1f}", f"{rr.uniform(2.5, 5):.1f}", rr.choice(["#C8502A", "#E08A33", "#7A2E1E", "#E08A33"]), 0.8)
ar += P("M424 80 C418 66 430 62 432 50 C438 60 448 66 444 80 Z", "#E08A33", 1.2) + P("M430 80 C428 70 434 66 436 60 C440 68 442 72 440 80 Z", "#F2B544", 0.8)
ar += bellows(438, 152, -90, 0.9)
ar += C(354, 150, 20, "#9F7D68", 1.8) + C(354, 150, 20, "none", 0.9, 'stroke="#4D4B47" opacity="0.5"')
ar += anvil(342, 150, 0, 0.9)
ar += R(396, 132, 8, 26, "#745846", 1.4, 3, 'transform="rotate(35 400 145)"') + R(392, 128, 14, 8, IRON, 1.4, 2, 'transform="rotate(35 400 145)"')
ar += barrel_top(452, 212, 17) + C(452, 212, 12.5, WATER, 1.2) + C(452, 212, 12.5, "url(#waterHatch)", 0, 'stroke="none"') + C(448, 208, 2.2, "#A3C9CC", 0.5)

# shield rack on left wall
ar += "    <!-- shield rack: round, kite and heater shields -->\n"
ar += R(30, 124, 62, 162, "#745846", 2) + overlay("M30 124 H92 V286 H30 Z", "plankHatch")
ar += round_shield(62, 148, 21, "#9C3F3A") + round_shield(62, 198, 21, "#4F6B65")
ar += P("M44 224 H80 V252 Q80 272 62 282 Q44 272 44 252 Z", "#C9A24E", 2) + P("M62 224 V280 M44 242 H80", "none", 1.2, 'opacity="0.6"') + C(62, 242, 4.5, STEEL, 1.2)
ar += P("M62 150 V190", "none", 0, 'stroke="none"')

# workshop work table with a breastplate and tools
ar += "    <!-- work table: breastplate, hammer, rivet bowl -->\n"
ar += table(122, 160, 128, 54, "#876A56")
ar += P("M140 176 C140 168 156 164 168 170 C180 164 196 168 196 176 C196 192 186 204 168 206 C150 204 140 192 140 176 Z", "#CBD0D2", 1.9)
ar += P("M168 170 V206 M152 182 H184", "none", 1.1, 'opacity="0.6"') + C(150, 176, 1.4, INK, 0, 'stroke="none"') + C(186, 176, 1.4, INK, 0, 'stroke="none"')
ar += G(222, 186, -25, R(-16, -1.5, 32, 3, "#745846", 1.2) + R(8, -6, 10, 12, IRON, 1.6, 1))
ar += C(214, 168, 8, "#A9856E", 1.4) + C(214, 168, 5, "#33261e", 0.8)
for qx, qy in [(212, 167), (216, 169), (214, 166)]:
    ar += C(qx, qy, 1.1, STEEL, 0.3)

# half-finished suit on a frame
ar += armor_stand(318, 222, "plate", 0)

# the counter with a gap
ar += "    <!-- counter across the room with a gap -->\n"
ar += counter_top("M28 292 H214 Q222 292 222 300 V322 Q222 330 214 330 H28 Z")
ar += counter_top("M484 292 H298 Q290 292 290 300 V322 Q290 330 298 330 H484 Z")
ar += P("M34 297 H212 M34 325 H212 M292 297 H478 M292 325 H478", "none", 0.8, 'opacity="0.35"')
# balance scale
ar += C(58, 311, 4, "#745846", 1.2) + P("M36 311 H80", "none", 1.6) + C(38, 311, 7, STEEL, 1.3) + C(78, 311, 7, STEEL, 1.3) + C(77, 311, 3, "#C9A24E", 0.6)
# helm and gauntlet on counter
ar += C(130, 311, 11, "#CBD0D2", 1.8) + P("M130 300 V322 M122 316 H138", "none", 1.1) + P("M130 300 Q135 296 130 292 Q125 296 130 300 Z", "#9C3F3A", 0.9)
ar += P("M160 322 C156 312 158 302 162 298 L170 298 L172 308 L180 306 L182 316 C182 322 174 326 160 322 Z", "#8A5F3E", 1.5)
ar += P("M164 302 V318", "none", 0.8, 'opacity="0.5"')
# ledger and coins
ar += R(316, 298, 28, 22, "#6C5B8C", 1.5, 1) + R(320, 301, 20, 16, PARCH, 0.9) + P("M323 306 H337 M323 311 H334", "none", 0.8, 'opacity="0.6"')
for cx_, cy_ in [(366, 310), (373, 312), (369, 317), (378, 308)]:
    ar += C(cx_, cy_, 4, "#E0C25A", 1)
ar += R(408, 300, 40, 20, "#B9BFC1", 1.5, 3) + overlay("M408 300 H448 V320 H408 Z", "raRings")

# display: armor stands on the customer side
ar += "    <!-- armor stands (mail, plate, leather) -->\n"
ar += armor_stand(74, 384, "mail", 180) + armor_stand(158, 384, "plate", 180) + armor_stand(354, 384, "leather", 180) + armor_stand(436, 384, "mail", 180)
ar += armor_stand(74, 456, "leather", 180)
# helm table
ar += table(124, 436, 82, 38, "#876A56")
for hx_, hr in [(144, "#CBD0D2"), (166, "#9AA0A2"), (188, "#CBD0D2")]:
    ar += C(hx_, 455, 9, hr, 1.6) + P(f"M{hx_} 446 V464", "none", 1)
ar += P("M132 470 H198", "none", 0.8, 'opacity="0.4"')
# spare rack: leather straps and boots table on right
ar += table(334, 440, 84, 36, "#876A56")
ar += P("M344 450 C350 446 356 454 362 450 C368 446 374 454 380 450 L380 458 C374 462 368 454 362 458 C356 462 350 454 344 458 Z", "#8A5F3E", 1.2)
ar += P("M388 446 C392 444 398 446 400 452 L412 454 L410 466 L388 468 Z", "#6B4A36", 1.5)
ar += barrel_top(454, 454, 17) + barrel_top(430, 470, 12)
ar += P("M446 440 L452 420 M458 440 L462 422", "none", 2.4, 'stroke="#745846"')

# quench-oil / water drip puddle
ar += E(430, 236, 22, 10, "#5B99A6", 0, 'stroke="none" opacity="0.35"')

# a second stand and a leather strop
ar += armor_stand(206, 266, "leather", 0) + armor_stand(380, 262, "mail", 0)
ar += G(272, 240, -20, R(-22, -5, 44, 10, "#8A5F3E", 1.6, 3) + P("M-14 -5 V5 M-4 -5 V5 M6 -5 V5 M16 -5 V5", "none", 0.8, 'opacity="0.5"'))

# stool at the work table
ar += stool(138, 232, 10)

specs["room-armorer"] = {
    "title": "Armorer",
    "desc": "Armorer's shop: a counter with a gap, armor stands in mail, plate and leather, a mail-sewing bench, shield rack, small forge, quench barrel, hides and a chest of buckles.",
    "body": ar,
    "shadow": "",
}


# ==============================================================================
# BARRACKS
# ==============================================================================
def bunk(x, y, blanket, sleeper=None, w=58, h=96):
    o = R(x, y, w, h, "#745846", 2)
    o += R(x + 4, y + 4, w - 8, h - 8, "#C9B58F", 1)
    o += R(x + 8, y + 7, w - 16, 19, PARCH, 1.4, 6)
    if sleeper:
        o += C(x + w / 2, y + 17, 8, "#D8B28F", 1.4) + P(f"M{x + w / 2 - 8} {y + 15} C{x + w / 2 - 8} {y + 7} {x + w / 2 + 8} {y + 7} {x + w / 2 + 8} {y + 15} C{x + w / 2 + 3} {y + 12} {x + w / 2 - 3} {y + 12} {x + w / 2 - 8} {y + 15} Z", sleeper, 1)
    o += P(f"M{x + 4} {y + 32} H{x + w - 4} V{y + h - 4} H{x + 4} Z", blanket, 1.5)
    o += P(f"M{x + 4} {y + 32} H{x + w - 4} V{y + 44} H{x + 4} Z", "#D7C39A", 1.2, 'opacity="0.55"')
    o += P(f"M{x + 4} {y + 62} H{x + w - 4} M{x + 4} {y + 70} H{x + w - 4}", "none", 1, 'opacity="0.45"')
    if sleeper:
        o += P(f"M{x + 12} {y + 48} Q{x + w / 2} {y + 40} {x + w - 12} {y + 50} L{x + w - 14} {y + h - 12} Q{x + w / 2} {y + h - 4} {x + 14} {y + h - 12} Z", "none", 0.9, 'opacity="0.45"')
    for px, py in [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]:
        o += C(px, py, 3.6, "#5F4434", 1.3)
    return o


def boot(x, y, rot, fill="#6B4A36"):
    return G(x, y, rot, P("M-4.5 -10 C-4.5 -17 4.5 -17 4.5 -10 L4 4 C4 8 -4 8 -4 4 Z", fill, 1.4) + E(0, 2.5, 3, 2.8, "#33261e", 0.8) + P("M-4 -4 H4", "none", 0.7, 'opacity="0.5"'))


def locker(x, y, w=38, h=15):
    return R(x, y, w, h, "#8F6F52", 1.8) + P(f"M{x} {y + 5} H{x + w}", "none", 1.2) + R(x + w / 2 - 3, y + 3, 6, 5, "#D7C39A", 0.9)


def h_weapon(kind, x, y):
    if kind == "sword":
        inner = P("M-9 -2.4 H-34 L-43 0 L-34 2.4 H-9 Z", STEEL, 1.3) + R(-12, -6.5, 3.4, 13, "#4D4B47", 1.2) + R(-8, -1.5, 8, 3, "#5F4129", 1) + C(0.5, 0, 2.6, "#C9A24E", 0.9)
    elif kind == "spear":
        inner = R(-50, -1.4, 52, 2.8, "#A9856E", 1) + P("M-50 -4.5 L-60 0 L-50 4.5 Q-47 0 -50 -4.5 Z", STEEL, 1.2)
    elif kind == "axe":
        inner = R(-36, -1.5, 38, 3, "#A9856E", 1) + P("M-36 -1 C-38 -12 -26 -14 -22 -5 L-22 5 C-26 14 -38 12 -36 1 Z", STEEL, 1.5)
    elif kind == "mace":
        inner = R(-32, -1.5, 34, 3, "#A9856E", 1) + C(-35, 0, 6, "#6F7679", 1.5) + P("M-35 -9 V9 M-44 0 H-26 M-41 -6 L-29 6 M-41 6 L-29 -6", "none", 1)
    else:
        inner = C(-18, 0, 15, "#9C3F3A", 1.8) + C(-18, 0, 4, STEEL, 1.2) + P("M-18 -11 V11", "none", 0.9, 'opacity="0.5"')
    return G(x, y, 0, inner)


def banner_flag(y, fill):
    return (
        R(28, y - 4, 6, 8, "#5F4434", 1.2, 3) + R(34, y - 2.5, 20, 5, "#4B352B", 1)
        + P(f"M34 {y - 12} L56 {y - 9} L49 {y} L56 {y + 9} L34 {y + 12} Z", fill, 1.5)
        + P(f"M38 {y - 7} L48 {y - 6} M38 {y + 7} L48 {y + 6}", "none", 0.9, 'stroke="#D7C39A"') + C(43, y, 2.8, "#D7C39A", 0.8)
    )


bk = room_shell(FLOOR_WOOD, "#745846", "logHatch")

# banners on left wall
bk += "    <!-- wall banners on the left wall -->\n"
for by, bc in [(66, "#9C3F3A"), (120, "#C9A24E"), (174, "#4F6B65"), (230, "#9C3F3A")]:
    bk += banner_flag(by, bc)

# rug under table
bk += "    <!-- rug under the table -->\n"
bk += rug(136, 296, 240, 98, "#4F6B65", "#D7C39A")

# bunks: two rows with different blanket colours
bk += "    <!-- two rows of bunks with posts, pillows and blankets -->\n"
rowA = ["#9C3F3A", "#6C8F7E", "#C9A24E", "#4F5F8C", "#8C93A0"]
rowB = ["#6C8F7E", "#9C3F3A", "#8A5F3E", "#C9A24E", "#6C5B8C"]
sleepA = [None, "#5F4129", None, None, "#C9A24E"]
sleepB = ["#33261e", None, None, "#8A5F3E", None]
for i in range(5):
    bk += bunk(62 + i * 74, 34, rowA[i], sleepA[i])
    bk += bunk(62 + i * 74, 168, rowB[i], sleepB[i])
bk += "    <!-- footlockers and boots under the beds -->\n"
for i in range(5):
    bk += locker(72 + i * 74, 133) + locker(72 + i * 74, 267)
for i, (bx_, rot_) in enumerate([(124, 8), (198, -6), (272, 4), (346, -10), (420, 6)]):
    bk += boot(bx_ - 4, 120, rot_, "#6B4A36") + boot(bx_ + 5, 123, rot_ + 14, "#5F4129")
for i, (bx_, rot_) in enumerate([(130, 4), (278, -8), (352, 10)]):
    bk += boot(bx_, 254, rot_, "#6B4A36") + boot(bx_ + 9, 257, rot_ + 10, "#8A5F3E")

# weapon rack on right wall
bk += "    <!-- weapon rack on the right wall -->\n"
bk += R(468, 40, 16, 252, "#5F4434", 2, 2) + overlay("M468 40 H484 V292 H468 Z", "logHatch")
for i, kind in enumerate(["sword", "spear", "axe", "mace", "sword", "shield", "spear"]):
    wy = 54 + i * 36
    bk += R(465, wy - 3, 6, 6, "#4D4B47", 1.2, 3) + h_weapon(kind, 466, wy)

# central table
bk += "    <!-- central table: dice, mugs, cards, candle; benches -->\n"
bk += R(166, 298, 168, 13, "#745846", 1.8, 3) + R(166, 380, 168, 13, "#745846", 1.8, 3)
bk += table(160, 316, 180, 58, "#876A56") + overlay("M160 316 H340 V374 H160 Z", "plankHatch")
for mx_, my_ in [(190, 332), (226, 360), (276, 330), (318, 352), (250, 345)]:
    bk += C(mx_, my_, 6.2, "#C9A24E", 1.4) + C(mx_, my_, 3.8, "#E0C25A" if mx_ != 226 else "#7A4F2A", 0.7) + P(f"M{mx_ + 6} {my_ - 2} q5 2 0 5", "none", 1.4)
for dx_, dy_, drot in [(212, 346, 20), (222, 340, -15)]:
    bk += G(dx_, dy_, drot, R(-4, -4, 8, 8, "#F1ECDD", 1.1, 1) + C(-1.5, -1.5, 0.8, INK, 0, 'stroke="none"') + C(1.5, 1.5, 0.8, INK, 0, 'stroke="none"'))
bk += G(292, 344, 12, R(-9, -6, 12, 17, "#F1ECDD", 0.9, 1)) + G(300, 340, -18, R(-9, -6, 12, 17, "#F1ECDD", 0.9, 1) + C(-3, 2, 2, "#9C3F3A", 0.4))
bk += C(264, 336, 5, "#F1ECDD", 1.4) + C(264, 336, 2, "#F2B544", 0.6) + C(264, 336, 11, "#F2B544", 0, 'stroke="none" opacity="0.18"')
bk += P("M168 360 L192 366 L170 368 Z", "#B9BFC1", 1)
for cx_, cy_ in [(238, 366), (244, 363), (241, 369)]:
    bk += C(cx_, cy_, 3.2, "#E0C25A", 0.8)
bk += stool(144, 345, 9) + stool(358, 345, 9)

# supply crates and sacks right side
bk += "    <!-- crates and a sack of oats -->\n"
bk += R(380, 312, 38, 32, "#876A56", 1.8) + P("M386 318 L412 338 M412 318 L386 338", "none", 1, 'stroke="#5F4434" opacity="0.7"')
bk += R(392, 348, 30, 26, "#8F6F52", 1.8) + P("M396 352 L418 370 M418 352 L396 370", "none", 1, 'stroke="#5F4434" opacity="0.7"')
bk += sack(468, 380, -8, "#C9B58F")

# the sick bay cot
bk += "    <!-- cot with bandaged patient, basin, bloody cloths -->\n"
bk += R(40, 320, 54, 106, "#745846", 2) + R(44, 324, 46, 98, "#C9B58F", 1)
bk += R(48, 328, 38, 20, PARCH, 1.4, 6) + C(67, 340, 9, "#D8B28F", 1.5)
bk += R(57, 332, 20, 7, "#F1ECDD", 1.3) + C(72, 335, 2, "#9C3F3A", 0.4) + P("M62 345 Q67 349 72 345", "none", 1)
bk += P("M44 354 H90 V422 H44 Z", "#8C93A0", 1.5) + P("M44 362 H90", "none", 1, 'opacity="0.5"')
bk += R(48, 360, 11, 42, "#F1ECDD", 1.4, 5) + P("M49 372 H58 M49 382 H58 M49 392 H58", "none", 0.9, 'opacity="0.55"') + C(54, 384, 3.2, "#9C3F3A", 0, 'stroke="none" opacity="0.8"')
for px, py in [(40, 320), (94, 320), (40, 426), (94, 426)]:
    bk += C(px, py, 3.4, "#5F4434", 1.2)
bk += stool(118, 352, 11) + C(118, 352, 9, "#B9BFC1", 1.3) + C(118, 352, 6, "#C98F8A", 0.8) + P("M114 350 Q118 346 122 350", "none", 0.8, 'stroke="#F1ECDD"')
bk += G(118, 382, 20, R(-8, -5, 16, 10, "#F1ECDD", 1.1, 3) + C(-2, 0, 2.4, "#9C3F3A", 0, 'stroke="none" opacity="0.8"'))
bk += R(106, 400, 26, 20, "#8F6F52", 1.6) + R(112, 396, 14, 6, "#C9A24E", 1.2) + P("M109 408 H129 M119 400 V420", "none", 1.1)

# stove in the corner with pipe and firewood
bk += "    <!-- iron stove, pipe, firewood, water barrel -->\n"
bk += C(436, 436, 28, "#4D4B47", 2.2) + C(436, 436, 20, "#6F6D68", 1.6) + C(436, 436, 7, COAL, 1.2) + P("M416 436 H456 M436 416 V456", "none", 1.1, 'opacity="0.45"')
bk += R(454, 424, 30, 24, "#6F6D68", 1.8, 1) + C(471, 436, 8, COAL, 1.4)
bk += P("M428 440 C426 432 432 430 434 424 C438 430 444 434 442 440 Z", "#E08A33", 0.9)
for lx, ly in [(394, 470), (408, 468), (400, 454), (416, 464)]:
    bk += C(lx, ly, 6, "#A58562", 1.3) + C(lx, ly, 2.4, "none", 0.7, 'opacity="0.6"')
bk += barrel_top(462, 330, 17) + C(462, 330, 11, WATER, 1, ) + C(462, 330, 11, "url(#waterHatch)", 0, 'stroke="none"') + C(436, 358, 8, "#A9856E", 1.4) + C(436, 358, 5, WATER, 0.8)
bk += P("M404 322 L420 322 L424 346 L400 346 Z", "#9F7D68", 1.5) + P("M406 328 H418", "none", 0.8, 'opacity="0.5"')

specs["room-barracks"] = {
    "title": "Barracks",
    "desc": "Barracks with two rows of bunks in different blanket colours, footlockers, boots, a dice table, a weapon rack, banners, a stove and a cot with a bandaged patient.",
    "body": bk,
    "shadow": "",
}


# ==============================================================================
# BLACKSMITH
# ==============================================================================
def v_weapon(kind, x, y):
    if kind == "sword":
        inner = P("M-2.6 12 V52 L0 62 L2.6 52 V12 Z", STEEL, 1.3) + R(-8, 8, 16, 3.6, "#4D4B47", 1.2) + R(-1.6, -2, 3.2, 10, "#5F4129", 1) + C(0, -4, 2.6, "#C9A24E", 0.9) + P("M0 14 V52", "none", 0.6, 'opacity="0.5"')
    elif kind == "axe":
        inner = R(-1.8, -4, 3.6, 66, "#A9856E", 1) + P("M1 6 C18 0 22 26 1 24 Z", STEEL, 1.6) + P("M-1 12 L-8 14 L-1 18 Z", STEEL_D, 1)
    elif kind == "mace":
        inner = R(-1.8, 4, 3.6, 58, "#A9856E", 1) + C(0, 10, 7.5, "#6F7679", 1.6) + P("M0 0 V20 M-10 10 H10 M-7 3 L7 17 M-7 17 L7 3", "none", 1)
    else:  # warhammer
        inner = R(-1.8, 0, 3.6, 62, "#A9856E", 1) + R(-7, 4, 14, 8, IRON, 1.5, 1) + P("M7 6 L13 8 L7 10 Z", IRON, 1)
    return G(x, y, 0, inner)


def ingot(x, y, rot=0, fill="#7D8386"):
    return G(x, y, rot, P("M-11 3 L-8 -3 H8 L11 3 Z", fill, 1.4) + P("M-8 -3 L-6 0 H6 L8 -3", "none", 0.7, 'opacity="0.6"'))


def tongs(x, y, rot=0):
    return G(x, y, rot, P("M-16 -3 L9 1.2 M-16 3 L9 -1.2", "none", 2.6) + P("M9 1 L17 3.5 M9 -1 L17 -3.5", "none", 2.2) + C(-17, -3.5, 2.6, "none", 1.3) + C(-17, 3.5, 2.6, "none", 1.3) + C(-1, 0, 1.6, STEEL, 0.8))


def hammer(x, y, rot=0):
    return G(x, y, rot, R(-16, -1.6, 32, 3.2, "#745846", 1.2) + R(9, -6.5, 9, 13, IRON, 1.6, 1) + R(-18, -2.5, 4, 5, "#A9856E", 0.8))


def coal_lump(cx, cy, r, rot=0):
    pts = [(-1, -0.8), (0.2, -1), (1, -0.3), (0.8, 0.8), (-0.4, 1), (-1, 0.3)]
    d = "M" + " L".join(f"{cx + a * r:.1f} {cy + b * r:.1f}" for a, b in pts) + " Z"
    return P(d, "#2c2622", 1)


bs = room_shell(FLOOR_FLAG, "#6F6D68", "stoneHatch")

# soot on the flagstones
bs += "    <!-- soot smudges radiating from the forge -->\n"
bs += soot(7, 256, 215, 12, 120, 0.12) + soot(3, 256, 215, 8, 70, 0.14)
bs += E(256, 292, 70, 22, "#2c2622", 0, 'stroke="none" opacity="0.1"')

# wall rack of weapons (top wall)
bs += "    <!-- wall weapon rack: swords, axes, maces, hammers hung from the top wall -->\n"
bs += R(40, 28, 432, 12, "#745846", 1.8) + overlay("M40 28 H472 V40 H40 Z", "logHatch")
kinds = ["sword", "axe", "mace", "sword", "hammer", "axe", "sword", "mace", "axe", "sword", "hammer", "mace", "sword"]
for i, k in enumerate(kinds):
    wx = 58 + i * 33
    bs += R(wx - 3, 31, 6, 7, "#4D4B47", 1.2, 3) + v_weapon(k, wx, 40)

# coal bin
bs += "    <!-- coal bin with shovel -->\n"
bs += R(32, 390, 84, 76, "#745846", 2.2) + overlay("M32 390 H116 V466 H32 Z", "plankHatch") + R(40, 398, 68, 60, "#1d1a18", 1.4)
rr = random.Random(5)
for _ in range(26):
    bs += coal_lump(rr.uniform(48, 100), rr.uniform(406, 450), rr.uniform(4, 7))
bs += G(90, 432, -35, R(-22, -1.6, 34, 3.2, "#A9856E", 1) + P("M12 -6 L26 -4 L26 4 L12 6 Z", STEEL_D, 1.4))

# ingot stack and sacks (left wall)
bs += "    <!-- ingot stack and spare iron -->\n"
bs += ingot(52, 160) + ingot(76, 160) + ingot(64, 148, 0, "#868D90") + ingot(52, 172) + ingot(76, 172) + ingot(64, 135, 0, "#7D8386")
bs += G(92, 192, 70, R(-20, -2.2, 40, 4.4, "#868D90", 1.4) + P("M-20 -2 L-26 0 L-20 2 Z", "#868D90", 1))
bs += G(48, 210, 100, R(-20, -2.2, 40, 4.4, "#7D8386", 1.4))

# bellows feeding the forge
bs += "    <!-- bellows into the forge -->\n"
bs += bellows(190, 208, 0, 1.15)

# central forge
bs += "    <!-- central forge: stone block, chimney, coal bed, flames -->\n"
bs += R(186, 156, 140, 112, STONE, 2.6, 4) + overlay("M186 156 H326 V268 H186 Z", "stoneHatch")
bs += R(236, 160, 40, 24, STONE_D, 2, 2) + R(244, 165, 24, 14, COAL, 1.2)
bs += R(204, 188, 104, 66, COAL, 1.6, 6)
rr = random.Random(31)
for _ in range(30):
    bs += C(f"{rr.uniform(212, 300):.1f}", f"{rr.uniform(194, 248):.1f}", f"{rr.uniform(3, 6.5):.1f}", rr.choice(["#C8502A", "#E08A33", "#7A2E1E", "#26211f", "#E08A33"]), 0.8)
bs += P("M232 240 C220 220 240 212 242 192 C252 206 262 214 256 240 Z", "#E08A33", 1.4) + P("M262 240 C252 224 268 218 270 202 C280 216 290 224 284 240 Z", "#E08A33", 1.4)
bs += P("M243 240 C238 228 246 224 248 212 C254 222 258 228 254 240 Z", "#F2B544", 0.9) + P("M271 240 C268 232 274 228 276 220 C280 228 282 234 280 240 Z", "#F2B544", 0.9)
bs += R(186, 156, 140, 112, "none", 2.6, 4)
bs += tongs(204, 270, 8) + G(310, 272, -10, R(-18, -1.4, 36, 2.8, IRON, 1) + C(-19, 0, 3, "none", 1.2))
for sx, sy in [(332, 200), (338, 190), (342, 212), (180, 262), (174, 176), (330, 240)]:
    bs += C(sx, sy, 1.6, "#F2B544", 0.3)

# anvil on a stump
bs += "    <!-- anvil on a tree stump, hot blade, hammer on the floor -->\n"
bs += C(130, 316, 30, "#9F7D68", 2) + C(130, 316, 24, "none", 1, 'opacity="0.5"') + C(130, 316, 17, "none", 0.9, 'opacity="0.4"') + C(130, 316, 9, "none", 0.8, 'opacity="0.35"')
bs += P("M104 300 L98 296 M154 332 L162 336 M112 340 L108 346", "none", 1.4, 'opacity="0.6"')
bs += anvil(128, 316, -20, 1.1)
bs += G(136, 310, -20, P("M-14 0 H20 L26 -1.5 L20 -3 H-14 Z", "#E08A33", 1) + P("M-4 -1.5 H16", "none", 0.8, 'stroke="#F2B544"'))
bs += hammer(98, 372, 30)
bs += P("M168 296 L174 292 M170 304 L178 304 M166 288 L170 282", "none", 1.5, 'stroke="#E08A33"')

# quench trough
bs += "    <!-- quench trough -->\n"
bs += R(300, 298, 114, 34, "#745846", 2.2, 3) + R(306, 304, 102, 22, WATER, 1.4, 2) + R(306, 304, 102, 22, "url(#waterHatch)", 0, 2, 'stroke="none"')
bs += G(360, 316, -8, P("M-18 -2 H18 L24 0 L18 2 H-18 Z", "#7A2E1E", 1) ) + C(330, 312, 2, "#A3C9CC", 0.5) + C(396, 318, 2.4, "#A3C9CC", 0.5)
bs += P("M300 316 H290 M414 316 H424", "none", 2.2, 'stroke="#4D4B47"')

# tool bench along the right wall
bs += "    <!-- tool bench: tongs, hammers, files, vise -->\n"
bs += R(436, 120, 48, 176, "#876A56", 2.2) + overlay("M436 120 H484 V296 H436 Z", "plankHatch")
bs += R(470, 126, 12, 20, IRON, 1.6, 2) + R(473, 144, 6, 12, STEEL_D, 1.2) + C(476, 160, 4, "none", 1.4)
bs += tongs(458, 150, 90) + tongs(456, 176, 80) + hammer(458, 206, 95) + hammer(454, 232, 85) + G(458, 258, 90, R(-14, -2, 28, 4, STEEL_D, 1.2) + R(-20, -2.5, 6, 5, "#745846", 1) + P("M-12 -1 H12", "none", 0.6, 'opacity="0.5"'))
bs += G(446, 280, 80, P("M-10 -3 L8 -1 L10 0 L8 1 L-10 3 Z", STEEL, 1.1)) + G(462, 282, 100, P("M-10 -3 L8 -1 L10 0 L8 1 L-10 3 Z", STEEL, 1.1))

# grindstone with seat
bs += "    <!-- grindstone wheel in a water trough with treadle seat -->\n"
bs += R(384, 388, 44, 88, "#745846", 2.2, 3) + R(390, 394, 32, 76, WATER, 1.2, 2) + R(390, 394, 32, 76, "url(#waterHatch)", 0, 2, 'stroke="none"')
bs += R(397, 398, 18, 68, "#C9C5B8", 2, 4) + overlay("M397 398 H415 V466 H397 Z", "leanHatch") + P("M402 398 V466 M410 398 V466", "none", 0.9, 'opacity="0.5"')
bs += P("M406 392 V472", "none", 1.8, 'stroke="#4D4B47"') + C(406, 392, 4, "#4D4B47", 1.2)
bs += G(444, 440, 0, P("M-14 -16 H14 L16 8 Q0 16 -16 8 Z", "#A9856E", 1.8) + P("M-9 -8 H9 M-10 0 H10", "none", 0.8, 'opacity="0.5"'))
bs += R(432, 456, 40, 12, "#745846", 1.6, 2) + P("M452 456 L438 428 L408 394", "none", 1.6, 'stroke="#4D4B47"')

# sword barrel, horseshoes, bucket and grinding sparks
bs += "    <!-- barrel of blades, horseshoes, bucket -->\n"
bs += barrel_top(54, 338, 19) + C(54, 338, 13, COAL, 1)
for ang, ln, fc in [(0, 20, STEEL), (50, 17, STEEL_D), (110, 22, STEEL), (170, 16, STEEL_D), (230, 19, STEEL), (290, 21, STEEL_D)]:
    bs += G(54, 338, ang, R(-1.6, -ln, 3.2, ln, fc, 0.9) + R(-4, -ln, 8, 3, IRON, 0.9))
for hx_, hy_, hr in [(184, 312, 30), (198, 308, -40)]:
    bs += G(hx_, hy_ - 4, hr, P("M-6 6 C-10 -4 -4 -9 0 -9 C4 -9 10 -4 6 6 L3 6 C5 -2 3 -5 0 -5 C-3 -5 -5 -2 -3 6 Z", STEEL_D, 1.1))
bs += C(266, 286, 8, "#A9856E", 1.5) + C(266, 286, 5.5, WATER, 0.8) + C(266, 286, 5.5, "url(#waterHatch)", 0, 'stroke="none"')
for sx, sy in [(382, 424), (376, 434), (386, 440), (374, 418), (380, 450)]:
    bs += C(sx, sy, 1.5, "#F2B544", 0.3)
bs += P("M370 430 L362 428 M372 440 L364 444", "none", 1.2, 'stroke="#E08A33"')

# water barrel and slack tub
bs += "    <!-- slack tub and water barrel -->\n"
bs += barrel_top(70, 258, 18) + C(70, 258, 12.5, WATER, 1.1) + C(70, 258, 12.5, "url(#waterHatch)", 0, 'stroke="none"')
bs += barrel_top(46, 300, 14) + P("M32 300 H60", "none", 1, 'opacity="0.5"')

# appraisal table with blades for sale, scale and coin pouch
bs += "    <!-- appraisal table: weapons laid out, balance, coins -->\n"
bs += table(190, 344, 130, 44, "#876A56")
bs += G(220, 366, 90, P("M-22 -2.4 H8 L16 0 L8 2.4 H-22 Z", STEEL, 1.3) + R(-26, -6, 4, 12, IRON, 1.2) + R(-34, -1.5, 8, 3, "#5F4129", 1))
bs += G(254, 360, 80, R(-24, -1.5, 34, 3, "#A9856E", 1) + P("M10 -1 C12 -10 24 -12 26 -3 L26 5 C24 14 12 12 10 1 Z", STEEL, 1.4))
bs += G(280, 368, 100, R(-24, -1.5, 30, 3, "#A9856E", 1) + C(10, 0, 6, "#6F7679", 1.4) + P("M10 -9 V9 M1 0 H19", "none", 0.9))
bs += C(300, 358, 5, "#745846", 1.2) + P("M290 358 H312", "none", 1.5) + C(291, 358, 4, STEEL, 1.1) + C(311, 358, 4, STEEL, 1.1)
bs += P("M298 376 C292 380 294 388 300 388 C306 388 308 380 302 376 Z", "#8A5F3E", 1.4) + C(300, 378, 1.5, "#C9A24E", 0.5)
for cx_, cy_ in [(210, 352), (217, 354), (213, 358)]:
    bs += C(cx_, cy_, 3.4, "#E0C25A", 0.9)

specs["room-blacksmith"] = {
    "title": "Blacksmith",
    "desc": "Smithy with a central coal forge, anvil on a stump, bellows, quench trough, grindstone, coal bin, wall weapon rack and a tool bench, on a sooty flagstone floor.",
    "body": bs,
    "shadow": "",
}
