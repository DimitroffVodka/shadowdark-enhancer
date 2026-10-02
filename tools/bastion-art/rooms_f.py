"""Bastion interior tiles, set F: yard fire, gate palisade, stairwell, entrance hall, roof deck, gatehouse."""
from bastion_lib import *
import math
import random

specs = {}

# ---------------------------------------------------------------- helpers

IRON, IRON_D, IRON_L = "#4D4B47", "#2b2927", "#9A9890"
WOOD_X = "#5F4434"
GLOW = "#F2C14E"
FIRE_O, FIRE_Y, FIRE_W = "#E08A33", "#F2B53E", "#FBE9A8"
RED, GOLD, BLUE = "#9C3F3A", "#C9A24E", "#3E5273"
GRASS, GRASS_D = "#85A478", "#6F8A5F"


def P(d, fill="none", sw=1.6, ex=""):
    return f'    <path d="{d}" fill="{fill}" stroke-width="{sw}" {ex}/>\n'


def C(cx, cy, r, fill="none", sw=1.6, ex=""):
    return f'    <circle cx="{cx:g}" cy="{cy:g}" r="{r:g}" fill="{fill}" stroke-width="{sw}" {ex}/>\n'


def R(x, y, w, h, fill="none", sw=1.6, rx=0, ex=""):
    return f'    <rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{rx:g}" fill="{fill}" stroke-width="{sw}" {ex}/>\n'


def E(cx, cy, rx, ry, fill="none", sw=1.4, rot=0, ex=""):
    t = f' transform="rotate({rot:g} {cx:g} {cy:g})"' if rot else ""
    return f'    <ellipse cx="{cx:g}" cy="{cy:g}" rx="{rx:g}" ry="{ry:g}" fill="{fill}" stroke-width="{sw}"{t} {ex}/>\n'


def G(inner, tr):
    return f'    <g transform="{tr}">\n{inner}    </g>\n'


NOSTROKE = 'stroke="none"'


def bg(floor):
    fill, hatch = floor
    d = "M0 0 H512 V512 H0 Z"
    return P(d, fill, 0, NOSTROKE) + P(d, f"url(#{hatch})", 0, NOSTROKE)


def hatch_over(d, hatch, extra=""):
    return P(d, f"url(#{hatch})", 0, NOSTROKE + " " + extra)


def line2(d, col, w, ex=""):
    """A coloured line with an ink edge (rope, rod, shaft, chain)."""
    return P(d, "none", w + 1.8, ex) + P(d, "none", w, f'stroke="{col}" {ex}')


def chain(d):
    return P(d, "none", 4.4, 'stroke-dasharray="6 2.4"') + P(d, "none", 2.2, f'stroke="{IRON_L}" stroke-dasharray="6 2.4"')


def pt(cx, cy, r, a):
    return cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))


def fire(cx, cy, s=1.0, n=7, seed=3):
    """Flame seen from above: three nested star-blobs."""
    rnd = random.Random(seed)
    out = ""
    rot = rnd.uniform(0, 6.28)
    for sc, col, sw in ((1.0, FIRE_O, 1.4), (0.68, FIRE_Y, 0.9), (0.36, FIRE_W, 0.7)):
        pts = []
        for i in range(2 * n):
            a = rot + math.pi * i / n
            r = 22 * s * sc * (rnd.uniform(0.85, 1.2) if i % 2 == 0 else 0.55)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        mid = lambda p, q: ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        m = mid(pts[-1], pts[0])
        d = f"M{m[0]:.1f} {m[1]:.1f}"
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            m = mid(p, q)
            d += f" Q{p[0]:.1f} {p[1]:.1f} {m[0]:.1f} {m[1]:.1f}"
        out += P(d + " Z", col, sw)
    return out


def log(x1, y1, x2, y2, d=16, fill="#A58562", char=False):
    """A log lying between two points, flat top-down silhouette with grain."""
    L = math.hypot(x2 - x1, y2 - y1)
    a = math.degrees(math.atan2(y2 - y1, x2 - x1))
    s = R(0, -d / 2, L, d, fill, 1.6, rx=d / 2.6)
    s += P(f"M5 {-d/5:g} H{L-6:g} M7 {d/5:g} H{L-9:g}", "none", 0.8, 'opacity=".5"')
    s += C(L * 0.42, d * 0.12, d / 8, WOOD_X, 0.8)
    if char:
        s += P(f"M0 {-d/2+2:g} Q-1 0 0 {d/2-2:g} H7 V{-d/2+2:g} Z", IRON_D, 0.8, 'opacity=".75"')
        s += P(f"M{L:g} {-d/2+2:g} Q{L+1:g} 0 {L:g} {d/2-2:g} H{L-7:g} V{-d/2+2:g} Z", IRON_D, 0.8, 'opacity=".75"')
    return G(s, f"translate({x1:g} {y1:g}) rotate({a:.1f})")


def weapon(kind, x0, x1, y):
    s = ""
    if kind == "s":  # spear
        s += line2(f"M{x0:g} {y:g} H{x1-8:g}", "#A58562", 1.8)
        s += P(f"M{x1-14:g} {y-3.6:g} L{x1+3:g} {y:g} L{x1-14:g} {y+3.6:g} Z", "#D5D3CB", 1.1)
    elif kind == "a":  # axe
        s += line2(f"M{x0:g} {y:g} H{x1-6:g}", "#8F6F52", 1.8)
        s += P(f"M{x1-14:g} {y-1:g} Q{x1-10:g} {y-10:g} {x1-2:g} {y-9:g} Q{x1-6:g} {y:g} {x1-2:g} {y+9:g} Q{x1-10:g} {y+10:g} {x1-14:g} {y+1:g} Z", "#D5D3CB", 1.1)
    elif kind == "m":  # mace
        s += line2(f"M{x0:g} {y:g} H{x1-6:g}", "#8F6F52", 1.8)
        s += C(x1 - 4, y, 5, IRON_L, 1.2) + P(f"M{x1-8:g} {y:g} H{x1:g} M{x1-4:g} {y-4:g} V{y+4:g}", "none", 0.8)
    else:  # sword
        s += P(f"M{x0+14:g} {y-2.3:g} H{x1-8:g} L{x1+3:g} {y:g} L{x1-8:g} {y+2.3:g} H{x0+14:g} Z", "#D5D3CB", 1.0)
        s += P(f"M{x0+14:g} {y-5.5:g} V{y+5.5:g}", "none", 2.6)
        s += line2(f"M{x0+5:g} {y:g} H{x0+14:g}", "#745846", 2) + C(x0 + 3, y, 2.8, GOLD, 1)
    return s


def rack(cx, cy, L, W, rot=0, kinds="samsx"):
    """A low weapon rack: board, weapons laid across, two cross rails."""
    n = len(kinds)
    s = R(-L / 2, -W / 2, L, W, "#745846", 2)
    s += hatch_over(f"M{-L/2:g} {-W/2:g} H{L/2:g} V{W/2:g} H{-L/2:g} Z", "logHatch")
    for i, k in enumerate(kinds):
        y = -W / 2 + (i + 0.5) * W / n
        s += weapon(k, -L / 2 + 5, L / 2 - 5, y)
    for rx in (-L / 4, L / 5):
        s += R(rx - 3, -W / 2 - 2, 6, W + 4, WOOD_X, 1.6, rx=1.5)
    return G(s, f"translate({cx:g} {cy:g}) rotate({rot:g})")


def brazier(cx, cy, r=18, s=1.0, seed=5):
    out = ""
    for a in (90, 210, 330):  # feet
        x, y = pt(cx, cy, r + 4, a)
        out += C(x, y, 4, IRON, 1.2)
    out += C(cx, cy, r, IRON, 2) + C(cx, cy, r - 4, "#6F6D68", 1.2) + C(cx, cy, r - 8, "#5A2B22", 1)
    for a in range(0, 360, 45):
        x, y = pt(cx, cy, r - 2, a)
        x2, y2 = pt(cx, cy, r - 7, a)
        out += P(f"M{x:.1f} {y:.1f} L{x2:.1f} {y2:.1f}", "none", 1.4)
    out += fire(cx, cy, s * r / 22 * 1.05, 6, seed)
    return out


def torch_w(x, y, side):
    """Wall torch bracket projecting from a vertical wall; side L or R."""
    dx = 1 if side == "L" else -1
    out = C(x + dx * 18, y, 26, GLOW, 0, 'opacity=".13" stroke="none"')
    out += R(min(x, x + dx * 8), y - 4, 8, 8, IRON, 1.5)
    out += C(x + dx * 15, y, 6.2, "#745846", 1.6)
    out += fire(x + dx * 15, y, 0.5, 5, int(y))
    return out


def stones_ring(cx, cy, r, n, rx=9, ry=7, seed=2, cols=("#8E8B83", "#A8A59B", "#6F6D68")):
    rnd = random.Random(seed)
    out = ""
    for i in range(n):
        a = 360 * i / n + rnd.uniform(-4, 4)
        x, y = pt(cx, cy, r, a)
        out += E(x, y, rx * rnd.uniform(0.85, 1.15), ry * rnd.uniform(0.85, 1.15), cols[i % len(cols)], 1.3, a + 90)
    return out


def wedge(cx, cy, r0, r1, a0, a1, fill, sw=1.2):
    x0, y0 = pt(cx, cy, r0, a0)
    x1, y1 = pt(cx, cy, r1, a0)
    x2, y2 = pt(cx, cy, r1, a1)
    x3, y3 = pt(cx, cy, r0, a1)
    d = (f"M{x0:.1f} {y0:.1f} L{x1:.1f} {y1:.1f} A{r1:g} {r1:g} 0 0 1 {x2:.1f} {y2:.1f} "
         f"L{x3:.1f} {y3:.1f} A{r0:g} {r0:g} 0 0 0 {x0:.1f} {y0:.1f} Z")
    return P(d, fill, sw)


def mix(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(a[i] + (b[i] - a[i]) * t):02X}" for i in range(3))


def spiral(cx, cy, r0, r1, n, a_start, sweep, c_light, c_dark, sw=1.2):
    out = ""
    step = sweep / n
    for i in range(n):
        out += wedge(cx, cy, r0, r1, a_start + i * step, a_start + (i + 1) * step, mix(c_light, c_dark, i / max(n - 1, 1)), sw)
    return out


def logend(cx, cy, r, tone):
    out = C(cx, cy, r, tone, 1.5)
    out += C(cx + r * 0.1, cy - r * 0.05, r * 0.58, "none", 0.8, 'opacity=".5"')
    out += C(cx + r * 0.08, cy - r * 0.04, r * 0.18, WOOD_X, 0.7)
    return out


def coil(cx, cy, r, col="#C9A97A"):
    return C(cx, cy, r, col, 1.4) + C(cx, cy, r * 0.66, "none", 1.1) + C(cx, cy, r * 0.3, WOOD_X, 1)


def sack(cx, cy, w=26, h=30, fill="#C9B88A"):
    d = (f"M{cx-w/2:g} {cy+h/2:g} Q{cx-w/2-5:g} {cy:g} {cx-w/4:g} {cy-h/3:g} L{cx-5:g} {cy-h/2:g} "
         f"L{cx+5:g} {cy-h/2:g} L{cx+w/4:g} {cy-h/3:g} Q{cx+w/2+5:g} {cy:g} {cx+w/2:g} {cy+h/2:g} Q{cx:g} {cy+h/2+5:g} {cx-w/2:g} {cy+h/2:g} Z")
    return P(d, fill, 1.6) + P(f"M{cx-6:g} {cy-h/2+4:g} H{cx+6:g}", "none", 1.4) + P(f"M{cx-5:g} {cy-h/4:g} Q{cx:g} {cy+4:g} {cx+7:g} {cy:g}", "none", 0.8, 'opacity=".5"')


def tuft_g(x, y):
    return tuft(x, y, GRASS_D)


def stone_blocks_h(x, y, w, h, fill=STONE_L):
    """Raised coping block (merlon) in plan: block, inner coping line."""
    return (P(f"M{x:g} {y:g} H{x+w:g} V{y+h:g} H{x:g} Z", fill, 1.8)
            + P(f"M{x+4:g} {y+4:g} H{x+w-4:g} V{y+h-4:g} H{x+4:g} Z", "none", 0.8, 'opacity=".45"'))


# ================================================================ 1. yard fire
def yard_fire():
    b = bg(FLOOR_DIRT)
    # trampled earth: darker worn ground round the fire, a path in from the south, dry pale patches
    b += E(256, 262, 176, 164, "#A99D80", 0, ex='opacity=".45" ' + NOSTROKE)
    b += E(256, 262, 122, 116, "#9C9072", 0, ex='opacity=".4" ' + NOSTROKE)
    b += P("M228 512 C234 462 240 420 244 372 L276 372 C282 420 286 462 292 512 Z", "#A99D80", 0, 'opacity=".42" ' + NOSTROKE)
    for x, y, rx, ry in ((440, 200, 30, 16), (60, 250, 26, 14), (150, 430, 28, 15), (300, 470, 26, 12), (470, 330, 22, 12)):
        b += E(x, y, rx, ry, "#C7BB9D", 0, 8, 'opacity=".5" ' + NOSTROKE)
    # pebbles
    for x, y, r in ((40, 160, 5), (46, 172, 3.4), (210, 90, 4), (452, 262, 5), (470, 150, 3.6), (298, 462, 4.2), (186, 486, 3.4), (30, 330, 4)):
        b += E(x, y, r, r * 0.75, "#8E8B83", 1, 20)
    # boot-prints: a trail in from the south, then a few round the fire
    def boot(x, y, a):
        return G(E(0, 0, 3.8, 6.4, "#8F8366", 0.7, ex='opacity=".9"') + E(0, 9.4, 3.2, 3.3, "#8F8366", 0.7, ex='opacity=".9"'), f"translate({x:g} {y:g}) rotate({a:g})")
    for k in range(6):
        b += boot(256 + (-8 if k % 2 else 8), 492 - k * 19, (-4 if k % 2 else 5))
    for x, y, a in ((178, 232, 70), (186, 244, 80), (338, 214, -60), (330, 226, -50), (300, 392, 160), (310, 402, 170)):
        b += boot(x, y, a)
    # grass tufts
    for x, y in ((24, 200), (62, 330), (436, 238), (466, 322), (166, 52), (332, 62), (228, 484), (404, 480), (30, 36), (480, 410)):
        b += tuft_g(x, y)
    # tent (partial, SW) with its peg line
    tent = R(16, 392, 106, 82, "#C7B78A", 2)
    tent += P("M16 392 H122 V433 H16 Z", "#D8CBA4", 1.4)
    tent += P("M16 433 H122", "none", 2.4)
    for x in (36, 56, 76, 96, 116):
        tent += P(f"M{x} 392 V474", "none", 0.8, 'opacity=".4"')
    tent += P("M16 392 L40 433 L16 474", "none", 1.8) + P("M16 412 L28 433 L16 454", "#B8A878", 1.2)
    tent += C(30, 433, 2.4, WOOD_X, 1)
    b += G(tent, "rotate(-5 70 433)")
    b += line2("M10 392 L26 405 M132 386 L112 404 M14 480 L26 470 M134 484 L118 470", "#C9A97A", 1.3)
    b += line2("M134 492 H260", "#C9A97A", 1.2)
    for i in range(8):
        x = 24 + i * 18 if i < 1 else 134 + (i - 1) * 18
        b += C(x, 492, 3.2, "#745846", 1.2) + P(f"M{x-2:g} 490 L{x+2:g} 494", "none", 0.8)
    # firewood pile (SE) with a chopping stump and axe
    for i, (dx, ln) in enumerate(((0, 90), (6, 84), (-2, 92), (8, 86), (2, 90), (-4, 88))):
        b += log(384 + dx, 400 + i * 13, 384 + dx + ln, 400 + i * 13, 12, ("#A58562", "#8F6F52", "#B38F6A")[i % 3])
    for x in (402, 428, 454):
        b += log(x, 392, x + 4, 470, 11, "#9F7D68")
    b += E(446, 480, 12, 6, "#8F6F52", 1.2) + log(414, 480, 440, 478, 8, "#B38F6A")
    b += C(350, 444, 17, "#A58562", 1.8) + C(350, 444, 12, "none", 0.9, 'opacity=".5"') + C(350, 444, 6, "none", 0.9, 'opacity=".5"')
    b += line2("M350 444 L376 424", "#8F6F52", 3) + P("M370 416 Q382 414 384 424 Q378 432 370 432 Z", "#D5D3CB", 1.2)
    # a dog curled up by the fire
    b += E(186, 292, 15, 9, "#B5855A", 1.6, -20) + C(201, 283, 6.4, "#B5855A", 1.5) + E(198, 278, 2.6, 4, "#8F5E38", 1, -30) + E(205, 279, 2.6, 4, "#8F5E38", 1, 20)
    b += P("M173 297 Q166 305 174 308", "none", 2.4) + C(204, 284, 0.9, IRON_D, 0.3) + P("M180 286 Q186 292 190 296", "none", 0.8, 'opacity=".5"')
    # supplies by the rack: crates, sacks, a bedroll; hide drying frame (W)
    b += R(398, 128, 36, 30, "#876A56", 1.8) + P("M404 134 L428 152 M428 134 L404 152", "none", 1, 'opacity=".6"')
    b += R(440, 134, 30, 26, "#8F6F52", 1.8) + P("M446 140 L464 154 M464 140 L446 154", "none", 1, 'opacity=".6"')
    b += R(412, 160, 28, 24, "#9F7D68", 1.8) + P("M412 172 H440", "none", 1, 'opacity=".6"')
    b += sack(462, 186) + sack(444, 204, 24, 26, "#B8A878")
    b += R(414, 222, 62, 24, "#6C8F7E", 1.8, rx=11) + P("M424 222 V246 M466 222 V246", "none", 1.2) + P("M430 230 H460", "none", 0.8, 'opacity=".5"')
    b += R(30, 222, 6, 6, "#745846", 1.4) + R(30, 292, 6, 6, "#745846", 1.4)
    b += P("M33 225 V295", "none", 3.2) + P("M33 225 V295", "none", 1.6, 'stroke="#A58562"')
    b += P("M40 230 L74 238 L70 280 L38 288 Z", "#B58F78", 1.6) + P("M46 240 L66 244 M46 254 L68 258 M44 268 L66 272", "none", 0.8, 'opacity=".5"')
    # weapon rack (NE)
    b += rack(436, 72, 100, 58, 0, "samsx")
    # log benches round the fire and tree-stump seats
    for a, bb in ((((198, 152), (314, 152)), 0), (((198, 364), (300, 364)), 1), (((150, 202), (150, 314)), 2), (((364, 190), (364, 290)), 3)):
        (x1, y1), (x2, y2) = a
        b += log(x1, y1, x2, y2, 20, ("#9F7D68", "#A58562", "#8F6F52", "#9F7D68")[bb])
    for x, y in ((176, 176), (338, 338), (178, 340)):
        b += C(x, y, 11, "#A58562", 1.7) + C(x, y, 6.5, "none", 0.9, 'opacity=".5"')
    # well (NW): stone ring, water, windlass with crank, bucket
    wx, wy = 88, 96
    b += C(wx, wy, 37, STONE, 2.2) + hatch_over(f"M{wx-37} {wy} a37 37 0 1 0 74 0 a37 37 0 1 0 -74 0 Z", "stoneHatch")
    for a in range(0, 360, 30):
        x1, y1 = pt(wx, wy, 25, a)
        x2, y2 = pt(wx, wy, 37, a)
        b += P(f"M{x1:.1f} {y1:.1f} L{x2:.1f} {y2:.1f}", "none", 1)
    b += C(wx, wy, 25, STONE_D, 1.6) + C(wx, wy, 22, WATER_D, 1.2) + C(wx, wy, 14, "none", 1.4, 'stroke="#A3C9CC" opacity=".8"') + C(wx, wy, 7, "none", 1.2, 'stroke="#A3C9CC" opacity=".7"')
    b += R(wx - 52, wy - 14, 8, 8, "#745846", 1.6) + R(wx + 44, wy - 14, 8, 8, "#745846", 1.6)
    b += R(wx - 46, wy - 9, 92, 14, "#A58562", 1.8, rx=3)
    for k in range(-3, 4):
        b += P(f"M{wx+k*3.4:g} {wy-9} V{wy+5}", "none", 0.8, 'opacity=".55"')
    b += P(f"M{wx+46} {wy-2} H{wx+60} L{wx+60} {wy+18}", "none", 2.6) + C(wx + 60, wy + 20, 4, "#745846", 1.5)
    b += C(wx, wy + 16, 7, "#876449", 1.5) + C(wx, wy + 16, 4, WATER_D, 1) + line2(f"M{wx} {wy+9} V{wy+4}", "#C9A97A", 1.1)
    b += C(wx + 45, wy + 40, 8, "#876449", 1.6) + C(wx + 45, wy + 40, 5, "#4C8699", 1) + P(f"M{wx+37} {wy+40} Q{wx+45} {wy+28} {wx+53} {wy+40}", "none", 1)
    # campfire: soot, ring of stones, crossed logs, flame
    b += C(256, 260, 46, "#3A3532", 1.4) + C(256, 260, 34, "#5A2B22", 1) + stones_ring(256, 260, 52, 15, 11, 8, 7)
    b += log(224, 288, 288, 238, 14, "#8F6F52", True) + log(224, 236, 290, 286, 14, "#9F7D68", True)
    b += fire(256, 262, 1.5, 8, 11)
    for a in range(0, 360, 51):
        x, y = pt(256, 260, 40, a + 14)
        b += C(x, y, 1.5, FIRE_Y, 0.4)
    # cooking spit: two forks, a rod, a joint of meat, a crank
    b += line2("M186 238 H326", IRON_L, 2.4)
    b += E(256, 238, 27, 8.5, "#B5653A", 1.6) + P("M236 236 Q256 230 276 237", "none", 1, 'opacity=".5"') + C(244, 240, 2, "#7A3A22", 0.5) + C(268, 240, 2, "#7A3A22", 0.5)
    for x in (186, 322):
        b += C(x, 238, 6.5, "#745846", 1.6) + P(f"M{x-4:g} {238-9:g} L{x:g} 238 L{x+4:g} {238-9:g}", "none", 1.4)
    b += P("M326 238 L338 246", "none", 3.4) + P("M326 238 L338 246", "none", 1.8, f'stroke="{IRON_L}"') + C(340, 248, 3.4, "#745846", 1.2)
    # cooking pot on a tripod over its own coals (SE of the fire)
    px, py = 336, 336
    b += C(px, py, 24, "#5A2B22", 1.2) + stones_ring(px, py, 24, 8, 5, 4, 3)
    for a in (100, 220, 340):
        x, y = pt(px, py, 30, a)
        b += line2(f"M{px} {py} L{x:.1f} {y:.1f}", "#8F6F52", 2.2)
    b += C(px, py, 16, IRON, 2) + C(px, py, 12.4, "#9A6B34", 1.2) + C(px - 3, py - 2, 2.2, "#C9A24E", 0.6) + C(px + 4, py + 3, 1.7, "#C9A24E", 0.6)
    b += P(f"M{px-15} {py} Q{px} {py-24} {px+15} {py}", "none", 1.4)
    b += line2(f"M{px+3} {py-2} L{px+24} {py-22}", "#8F6F52", 1.8) + C(px + 25, py - 23, 4.4, IRON_L, 1.2)
    return b


specs["room-yard-fire"] = {
    "title": "Outpost yard",
    "desc": "Open-air trampled dirt yard with a stone-ringed campfire, log benches, spit and pot, well, weapon rack, woodpile, tent and peg line.",
    "body": yard_fire(), "shadow": "",
}


# ================================================================ 2. gate palisade
def gate_palisade():
    rnd = random.Random(21)
    b = bg((GRASS, "leanHatch"))
    # darker verge grass patches, clover and flowers
    for x, y, rx, ry in ((80, 90, 60, 30), (430, 70, 56, 28), (70, 470, 50, 24), (440, 470, 60, 26), (110, 360, 30, 18)):
        b += E(x, y, rx, ry, GRASS_D, 0, 0, 'opacity=".35" ' + NOSTROKE)
    # dirt road with ragged edges, wheel ruts, a puddle, hoof marks
    left = [(190 + rnd.uniform(-5, 4)) for _ in range(17)]
    right = [(322 + rnd.uniform(-4, 5)) for _ in range(17)]
    d = f"M{left[0]:.1f} 0"
    for i in range(1, 17):
        d += f" L{left[i]:.1f} {i*32}"
    d += f" L{right[16]:.1f} 512"
    for i in range(15, -1, -1):
        d += f" L{right[i]:.1f} {i*32}"
    b += P(d + " Z", DIRT, 1.4) + hatch_over(d + " Z", "leanHatch")
    b += P("M232 0 V512 M284 0 V512", "none", 3, 'stroke="#7E7255" opacity=".6" stroke-dasharray="30 8"')
    b += E(278, 438, 20, 9, WATER_D, 1.4) + E(276, 437, 11, 4, "none", 1, 0, 'stroke="#A3C9CC" opacity=".8"')
    for x, y in ((250, 100), (262, 76), (240, 60), (270, 130), (252, 420), (236, 462)):
        b += P(f"M{x} {y} q4 -7 8 0 q-4 -2 -8 0 Z", "#8F8366", 0.9, 'opacity=".8"')
    for x, y, r in ((200, 120, 4), (310, 160, 5), (206, 340, 4), (304, 300, 4.5), (224, 372, 3.4), (294, 70, 3.6)):
        b += E(x, y, r, r * 0.75, "#8E8B83", 1.1, 15)
    # edging stones along the road verge
    for i in range(14):
        y = 14 + i * 36 + rnd.uniform(-3, 3)
        b += E(left[min(int(y // 32), 16)] - 4, y, 5, 4, "#9A978D", 1.1, 20) + E(right[min(int(y // 32), 16)] + 4, y, 5, 4, "#9A978D", 1.1, 20)
    # grass tufts and flowers on the verges
    for x, y in ((40, 40), (130, 60), (60, 140), (150, 150), (30, 330), (150, 420), (60, 500), (400, 40), (470, 120), (360, 110), (370, 340), (490, 300), (350, 500), (470, 410), (120, 290), (400, 260)):
        b += tuft_g(x, y)
    for x, y, c in ((100, 110, "#E6D9B5"), (70, 76, GOLD), (430, 150, "#E6D9B5"), (380, 70, GOLD), (140, 450, GOLD), (470, 360, "#E6D9B5"), (50, 410, "#E6D9B5")):
        b += C(x, y, 2.4, c, 0.7) + C(x, y, 0.8, RED, 0.3)
    # palisade walls: dark footing, two staggered rows of log-ends
    foot = "M0 196 H174 V238 H0 Z M338 196 H512 V238 H338 Z"
    b += P(foot, "#5F4434", 1.6)
    tones = ("#A58562", "#9F7D68", "#B38F6A", "#8F6F52")
    for xs, xe in ((0, 172), (342, 512)):
        n = int((xe - xs) / 21) + 1
        for row, (yy, off) in enumerate(((206, 10.5), (226, 0))):
            for i in range(n + 1):
                x = xs + off + i * 21 - (0 if xs == 0 else 0)
                if xs == 0 and x > 160:
                    continue
                if xs > 0 and x < xs + 4:
                    continue
                b += logend(x, yy + rnd.uniform(-1, 1), 10.2, tones[rnd.randrange(4)])
    # lashing straps across the log-ends
    b += P("M0 216 H168 M346 216 H512", "none", 1.2, 'opacity=".35"')
    # gate leaves, swung inward and open (hinged on the posts)
    def leaf(hx, hy, ang):
        s = R(0, -5.5, 70, 11, "#8F6F52", 2, rx=1.5)
        s += P("".join(f"M{x} -5.5 V5.5 " for x in range(10, 70, 10)), "none", 0.8, 'opacity=".55"')
        for x in (6, 30, 54):
            s += R(x, -7, 7, 14, IRON, 1.3)
        s += C(66, 0, 2.6, IRON_L, 1) + C(4, 0, 3, IRON_L, 1)
        return G(s, f"translate({hx} {hy}) rotate({ang})")
    b += leaf(188, 236, 72) + leaf(324, 236, 108)
    # gate posts and the lintel beam across the road
    for x in (174, 338):
        b += C(x, 216, 17, "#8F6F52", 2.2) + C(x + 1, 216, 11, "none", 1, 'opacity=".5"') + C(x + 1, 216, 5, IRON, 1.2)
    b += R(166, 208, 180, 16, "#A58562", 2.2, rx=2.5) + P("M174 214 H338 M174 219 H338", "none", 0.8, 'opacity=".45"')
    for x in (190, 256, 322):
        b += R(x - 4, 206, 8, 20, IRON, 1.4)
    b += C(256, 216, 3.4, IRON_L, 1)
    # guard shelter (inside, west): plank deck, half roof, bench, lantern
    b += R(38, 288, 112, 98, "#BD9D86", 2) + hatch_over("M38 288 H150 V386 H38 Z", "plankHatch")
    b += R(52, 352, 82, 17, "#876A56", 1.8) + P("M60 352 V369 M126 352 V369", "none", 1.3)
    b += R(48, 372, 20, 12, "#9F7D68", 1.4) + C(58, 378, 2.4, IRON_L, 0.8)
    b += P("M30 280 H158 V334 H30 Z", "#B58F78", 2.2) + hatch_over("M30 280 H158 V334 H30 Z", "shingleHatch")
    b += P("M30 307 H158", "none", 2.4) + P("M44 280 V334 M72 280 V334 M100 280 V334 M128 280 V334 M146 280 V334", "none", 0.8, 'opacity=".35"')
    for x, y in ((36, 286), (152, 286), (36, 334), (152, 334)):
        b += C(x, y, 5, "#745846", 1.6)
    b += C(150, 358, 18, GLOW, 0, 'opacity=".22" ' + NOSTROKE) + P("M144 352 H156 V364 H144 Z", "#E8C26A", 1.4) + P("M147 352 V364 M153 352 V364", "none", 0.7) + C(150, 358, 2.2, FIRE_O, 0.4)
    b += P("M150 337 V352", "none", 1.4)
    # barrels and a spear rack (inside, by the road)
    b += barrel_top(80, 424, 15) + barrel_top(110, 436, 12) + barrel_top(60, 450, 11)
    b += rack(412, 330, 86, 40, 90, "ssss") + R(386, 296, 52, 8, WOOD_X, 1.6, rx=2) + R(386, 358, 52, 8, WOOD_X, 1.6, rx=2)
    # a coil of rope and a dropped spear in the road
    b += coil(386, 420, 11) + line2("M214 490 L262 466", "#A58562", 1.8) + P("M260 461 L273 465 L261 472 Z", "#D5D3CB", 1)
    return b


specs["room-gate-palisade"] = {
    "title": "Outpost gate",
    "desc": "Open-air gate cell: dirt road between log palisade walls, gate posts with lintel, open leaves, guard shelter, barrels and spear rack.",
    "body": gate_palisade(), "shadow": "",
}


# ================================================================ 3. stairwell
def top_door(floor_fill, floor_hatch):
    """Second door gap on the TOP edge (x 216..296)."""
    s = P("M217 -2 H295 V29.5 H217 Z", floor_fill, 0, NOSTROKE) + P("M217 -2 H295 V29.5 H217 Z", f"url(#{floor_hatch})", 0, NOSTROKE)
    s += P("M216 0 V28 M296 0 V28", "none", 3.2) + P("M216 25 H296", "none", 5, 'stroke="#745846"')
    return s


def stairwell():
    b = room_shell(FLOOR_FLAG) + top_door(*FLOOR_FLAG)
    # mats at both doors, a runner to the foot of the stairs
    b += rug(232, 32, 48, 42, "#4F6B65") + rug(230, 352, 52, 132, "#4F6B65")
    # cracks in the flagstones
    b += P("M120 420 L140 432 L136 450 M390 120 L408 138 L400 150 M70 300 L88 312", "none", 0.9, 'opacity=".45"')
    # arrow slits in the side walls
    for y in (110, 250, 390):
        b += P(f"M6 {y} H26 V{y+7} H6 Z M486 {y} H506 V{y+7} H486 Z", "#1d1a18", 1.2)
    # the spiral stair: outer balustrade wall with an opening at the south, 24 treads clockwise, newel, handrail
    cx, cy = 256, 244
    b += C(cx, cy, 108, STONE_D, 2.4) + hatch_over(f"M{cx-108} {cy} a108 108 0 1 0 216 0 a108 108 0 1 0 -216 0 Z", "stoneHatch")
    b += C(cx, cy, 98, "#8E8B83", 1.4)
    n = 22
    for i in range(n):
        a0 = 110 + i * 320 / n
        tone = mix("#C4C1B6", "#77756D", i / (n - 1))
        if i % 2:
            tone = mix(tone, "#FFFFFF", 0.08)
        b += wedge(cx, cy, 15, 98, a0, a0 + 320 / n, tone, 1.5)
    # entrance landing, flush with the floor, breaking the balustrade wall
    land = wedge(cx, cy, 15, 116, 70, 110, "#CFCCC1", 2)
    b += land
    b += hatch_over(f"M{cx} {cy} L{cx+40} {cy+109} A116 116 0 0 1 {cx-40} {cy+109} Z", "flagHatch")
    # handrail on the outer edge with balusters
    for a in range(118, 430, 14):
        x, y = pt(cx, cy, 90, a)
        b += C(x, y, 2.4, "#745846", 1)
    x0, y0 = pt(cx, cy, 90, 114)
    x1, y1 = pt(cx, cy, 90, 426)
    hr = f"M{x0:.1f} {y0:.1f} A90 90 0 1 1 {x1:.1f} {y1:.1f}"
    b += P(hr, "none", 6.2) + P(hr, "none", 3.6, 'stroke="#9F7D68"')
    # newel post with cap ring
    b += C(cx, cy, 16, STONE_D, 2) + C(cx, cy, 11, STONE_L, 1.3) + C(cx, cy, 4, IRON, 1.2)
    # torch brackets
    for y in (152, 336):
        b += torch_w(28, y, "L") + torch_w(484, y, "R")
    # hoist hole (NW): timber curb, dark shaft, pulley beam, rope, coil, sack
    b += R(48, 52, 72, 70, "#745846", 2.2) + hatch_over("M48 52 H120 V122 H48 Z", "plankHatch")
    b += R(60, 64, 48, 46, "#15110f", 1.8) + P("M60 64 L108 110 M108 64 L60 110", "none", 0.6, 'opacity=".25"')
    b += R(42, 83, 84, 9, "#9F7D68", 1.8, rx=1.5) + C(84, 87.5, 9, IRON, 1.8) + C(84, 87.5, 4, IRON_L, 1) + P("M84 79 V70", "none", 0.8)
    b += line2("M90 88 L130 118", "#C9A97A", 1.5) + C(130, 118, 3, IRON, 1)
    b += line2("M84 92 V104", "#C9A97A", 1.5) + P("M84 104 q-4 4 0 7 q4 -1 3 -5", "none", 1.4)
    b += coil(148, 108, 12) + sack(92, 152, 28, 30) + sack(124, 158, 24, 26, "#B8A878")
    # banner on a floor stand (SE), pennant blown flat
    bx, by = 440, 418
    b += P(f"M{bx} {by-8} C{bx-18} {by-16} {bx-34} {by-2} {bx-60} {by-12} L{bx-50} {by+4} L{bx-62} {by+18} C{bx-36} {by+10} {bx-18} {by+24} {bx} {by+10} Z", RED, 1.8)
    b += P(f"M{bx-20} {by-5} Q{bx-34} {by+2} {bx-42} {by+1}", "none", 0.9, 'opacity=".5"') + C(bx - 30, by + 5, 5, GOLD, 1.2) + C(bx - 30, by + 5, 1.8, RED, 0.5)
    b += C(bx, by, 14, STONE, 2) + C(bx, by, 7.5, IRON, 1.4) + C(bx, by, 4.2, "#9F7D68", 1)
    # stone bench and bucket (SW), brazier-free but a lantern on the floor
    b += R(44, 430, 84, 22, STONE_L, 2) + hatch_over("M44 430 H128 V452 H44 Z", "stoneHatch") + P("M60 430 V452 M112 430 V452", "none", 1)
    b += C(150, 432, 9, "#A17A5C", 1.7) + C(150, 432, 6.2, WATER_D, 1) + P("M142 432 Q150 420 158 432", "none", 1.2)
    # supplies in the NE corner
    b += barrel_top(452, 62, 16) + barrel_top(418, 56, 12) + R(440, 90, 34, 28, "#876A56", 1.8) + P("M446 96 L468 112 M468 96 L446 112", "none", 1, 'opacity=".6"')
    b += chest(406, 80, 24, 16)
    return b


specs["room-stairwell"] = {
    "title": "Keep stairwell",
    "desc": "Stone stair cell with doors top and bottom, a clockwise spiral staircase round a newel with handrail, torches, hoist hole and banner.",
    "body": stairwell(), "shadow": "",
}


# ================================================================ 4. entrance hall
def entrance_hall():
    b = room_shell(FLOOR_FLAG)
    # long runner from the door through the archway to the coat-of-arms rug
    b += rug(224, 236, 64, 250, "#7A2E32", "#C9A24E")
    b += P("M232 484 H280 M232 476 H280", "none", 0.8, 'opacity=".4"')
    # heavy double doors, both leaves swung in against the jambs, with bar brackets
    for x, sgn in ((217, 1), (289, -1)):
        d = R(x, 444, 7, 40, "#745846", 2) + P(f"M{x} 456 H{x+7} M{x} 470 H{x+7}", "none", 1.6, f'stroke="{IRON}"')
        b += d + C(x + 3.5, 452, 1.6, IRON_L, 0.5)
    b += R(204, 446, 9, 16, IRON, 1.4) + R(299, 446, 9, 16, IRON, 1.4)
    # shield-shaped coat-of-arms rug, quartered, with a gold tower
    shield = "M196 92 H316 V170 C316 212 284 236 256 250 C228 236 196 212 196 170 Z"
    b += f'    <clipPath id="rfShield"><path d="{shield}"/></clipPath>\n'
    b += P(shield, RED, 2)
    b += '    <g clip-path="url(#rfShield)">\n'
    b += R(256, 92, 60, 78, BLUE, 1.2) + R(196, 170, 60, 90, BLUE, 1.2)
    b += "    </g>\n"
    b += P("M204 100 H308 V170 C308 206 280 228 256 240 C232 228 204 206 204 170 Z", "none", 2.6, 'stroke="#D7C39A"')
    b += P("M256 92 V250 M196 170 H316", "none", 1, 'opacity=".5"')
    b += P("M236 196 V166 H241 V172 H246 V166 H251 V172 H261 V166 H266 V172 H271 V166 H276 V196 Z", GOLD, 1.6)
    b += P("M251 196 V184 Q256 177 261 184 V196", "#2b2927", 1) + C(256, 134, 9, GOLD, 1.5) + C(256, 134, 3.4, RED, 0.8)
    b += P("M228 122 L236 132 L244 122 M268 122 L276 132 L284 122", "none", 1.6, 'stroke="#D7C39A"')
    # vestibule partition wall with a wide stone archway (x 196..316), thick piers
    for x0, x1 in ((28, 196), (316, 484)):
        b += R(x0, 354, x1 - x0, 24, STONE_D, 2.4) + hatch_over(f"M{x0} 354 H{x1} V378 H{x0} Z", "stoneHatch")
    for x in (184, 316):
        b += R(x, 346, 28, 40, STONE_L, 2.2) + hatch_over(f"M{x} 346 H{x+28} V386 H{x} Z", "stoneHatch") + R(x + 7, 354, 14, 24, "none", 0.9, ex='opacity=".5"')
    # raised portcullis grating in the arch (iron bars tucked up) with its grooves
    b += P("M212 364 H300", "none", 2.2) + "".join(C(x, 364, 2.3, IRON, 1) for x in range(218, 300, 12))
    # portcullis winch (hall, west of the arch): frame, drum, flanges, crank wheel, ratchet
    b += R(60, 300, 12, 50, "#745846", 1.8) + R(150, 300, 12, 50, "#745846", 1.8)
    b += R(70, 313, 82, 24, "#9F7D68", 2, rx=3) + "".join(P(f"M{x} 313 V337", "none", 0.9, 'opacity=".6"') for x in range(78, 150, 6))
    b += R(70, 308, 5, 34, IRON, 1.4) + R(147, 308, 5, 34, IRON, 1.4)
    wx, wy = 54, 325
    b += C(wx, wy, 14, "none", 2.4) + C(wx, wy, 14, "none", 1, 'stroke="#745846" opacity=".4"')
    for a in range(0, 360, 90):
        x, y = pt(wx, wy, 14, a)
        b += P(f"M{wx} {wy} L{x:.1f} {y:.1f}", "none", 2.2)
    b += C(wx, wy, 4.5, IRON, 1.2) + P(f"M{wx-14} {wy} L{wx-26} {wy+16}", "none", 2.6) + C(wx - 27, wy + 18, 4, "#745846", 1.3)
    b += C(166, 325, 9, IRON_L, 1.5) + P("M166 316 L172 322", "none", 2)
    # chains: drum -> pulleys over the arch -> down to the portcullis
    b += chain("M152 318 L196 346 L304 346") + chain("M196 346 V362 M304 346 V362")
    b += C(196, 346, 5, IRON, 1.6) + C(304, 346, 5, IRON, 1.6) + C(196, 346, 1.8, IRON_L, 0.5) + C(304, 346, 1.8, IRON_L, 0.5)
    # murder holes: a row of dark squares in the ceiling line over the vestibule
    b += P("M36 394 H476", "none", 0.9, 'opacity=".28" stroke-dasharray="7 5"')
    for i in range(9):
        x = 64 + 48 * i
        b += R(x - 7, 387, 14, 14, "#15110f", 1.6) + R(x - 10, 384, 20, 20, "none", 0.9, ex='opacity=".4"')
    # braziers flanking the heraldic rug, pillars behind them
    b += brazier(150, 124, 19, 1, 4) + brazier(362, 124, 19, 1, 8)
    for x in (150, 362):
        b += C(x, 214, 17, STONE_L, 2.2) + C(x, 214, 11, "none", 0.9, 'opacity=".5"') + hatch_over(f"M{x-17} 214 a17 17 0 1 0 34 0 a17 17 0 1 0 -34 0 Z", "stoneHatch")
    # guard bench along the west wall, weapon rack along the east wall
    b += R(32, 120, 22, 112, "#876A56", 2) + P("M36 148 H50 M36 176 H50 M36 204 H50", "none", 0.8, 'opacity=".5"') + stool(70, 250, 9)
    b += rack(450, 236, 112, 46, 90, "sasmxs") + R(432, 176, 38, 7, WOOD_X, 1.6, rx=2)
    # wall sconces
    b += torch_w(28, 276, "L") + torch_w(484, 100, "R") + torch_w(484, 330, "R")
    # lobby, west: coat pegs with hanging cloaks, guard bench, boots
    for y, c in ((412, "#6C5B8C"), (434, "#4F6B65"), (456, RED)):
        b += R(28, y - 3, 8, 6, IRON, 1.2) + P(f"M36 {y-8} Q60 {y-12} 56 {y} Q60 {y+12} 36 {y+8} Z", c, 1.6) + P(f"M40 {y} H54", "none", 0.8, 'opacity=".5"')
    b += R(70, 460, 92, 20, "#876A56", 2) + P("M80 460 V480 M152 460 V480", "none", 1.2) + E(176, 470, 8, 4, "#5F4434", 1.2, 10) + E(168, 476, 7, 3.6, "#5F4434", 1.2, -12)
    # lobby, east: iron-bound chest, umbrella-stand barrel full of spears, a stool
    b += chest(420, 438, 52, 34, "#8F6F52") + P("M432 438 V472 M460 438 V472", "none", 2.6) + P("M432 438 V472 M460 438 V472", "none", 1, 'stroke="#9A9890"')
    b += barrel_top(340, 462, 16) + "".join(C(340 + dx, 462 + dy, 3, "#A58562", 1.1) for dx, dy in ((-5, -4), (4, -5), (6, 3), (-3, 5), (0, 0)))
    b += line2("M342 458 L360 436", "#A58562", 1.6) + P("M356 433 L366 431 L360 442 Z", "#D5D3CB", 1) + stool(402, 410, 9)
    # armour stand beside the rack: feet cross, shoulders, helm
    b += P("M388 142 L412 166 M412 142 L388 166", "none", 2.6, f'stroke="{WOOD_X}"') + E(400, 154, 17, 8, IRON_L, 1.8) + E(400, 154, 11, 5, "#6F6D68", 1) + C(400, 154, 6.5, "#B9B8B0", 1.6) + P("M394 154 H406", "none", 1.2)
    return b


specs["room-entrance-hall"] = {
    "title": "Keep entrance hall",
    "desc": "Stone foyer: double doors, vestibule partition with archway, portcullis winch and chains, murder holes, coat-of-arms rug, runner, braziers, guard bench and weapon rack.",
    "body": entrance_hall(), "shadow": "",
}


# ================================================================ 5. roof deck
def roof_deck():
    b = bg(("#BAB7AC", "flagHatch"))
    # moss, bird droppings, a crack
    for x, y, rx, ry in ((150, 450, 24, 10), (300, 90, 20, 9), (460, 300, 12, 20)):
        b += E(x, y, rx, ry, "#8CA07A", 0, 10, 'opacity=".4" ' + NOSTROKE)
    for x, y in ((120, 200), (350, 380), (200, 430), (330, 150), (420, 270)):
        b += E(x, y, 4, 2.6, "#EDE9DC", 0.6, 20) + E(x + 5, y + 2, 1.6, 1.2, "#EDE9DC", 0.4)
    b += P("M370 300 L384 316 L378 330 L392 346", "none", 0.9, 'opacity=".5"')
    # parapet band with crenellations on all four edges
    band = "M0 0 H512 V512 H0 Z M28 28 V484 H484 V28 Z"
    b += P(band, STONE_D, 2.6, 'fill-rule="evenodd"') + hatch_over(band, "stoneHatch", 'fill-rule="evenodd"')
    for i in range(11):
        x = i * 48
        b += stone_blocks_h(x, 0, 32, 28) + stone_blocks_h(x, 484, 32, 28)
    for i in range(1, 10):
        y = i * 48
        b += stone_blocks_h(0, y, 28, 32) + stone_blocks_h(484, y, 28, 32)
    # scuppers (drain notches) in two crenels
    b += R(418, 486, 14, 6, "#15110f", 1.2) + R(486, 226, 6, 14, "#15110f", 1.2)
    # --- ballista, centrepiece, aimed north
    cx = 256
    b += C(cx, 262, 62, "#A8A59B", 2.2) + hatch_over(f"M{cx-62} 262 a62 62 0 1 0 124 0 a62 62 0 1 0 -124 0 Z", "stoneHatch")
    b += C(cx, 262, 54, "none", 1.2, 'stroke-dasharray="9 4" opacity=".7"')
    b += C(cx, 262, 46, "#745846", 2.2) + hatch_over(f"M{cx-46} 262 a46 46 0 1 0 92 0 a46 46 0 1 0 -92 0 Z", "plankHatch")
    b += C(cx, 262, 40, "none", 3.2, f'stroke="{IRON}"') + C(cx, 262, 40, "none", 1, 'stroke="#9A9890" opacity=".8"')
    for a in range(0, 360, 45):
        x, y = pt(cx, 262, 40, a + 22)
        b += C(x, y, 2.2, IRON_L, 0.8)
    # bow arms (tapering, swept forward) with torsion bundles
    b += P("M214 170 C188 168 164 156 142 126 L136 134 C158 164 188 182 216 186 Z", "#8F6F52", 2)
    b += P("M298 170 C324 168 348 156 370 126 L376 134 C354 164 324 182 296 186 Z", "#8F6F52", 2)
    b += R(186, 156, 44, 44, "#745846", 2, rx=3) + R(282, 156, 44, 44, "#745846", 2, rx=3)
    for x in (208, 304):
        b += C(x, 178, 15, "#C9A97A", 2) + C(x, 178, 10, "none", 1, 'opacity=".6" stroke-dasharray="3 2"')
        b += P(f"M{x-14} {178} H{x+14} M{x} 164 V192", "none", 2.4) + C(x, 178, 4, IRON, 1.2)
    b += R(228, 164, 56, 10, "#8F6F52", 1.8)
    # slider stock with groove, nose and tail
    b += P("M248 96 L264 96 L266 110 H246 Z", "#8F6F52", 1.8) + R(246, 110, 20, 214, "#8F6F52", 2.2, rx=2)
    b += R(252, 118, 8, 190, "#5F4434", 1.2)
    b += P("M246 306 H266 L270 330 H242 Z", "#745846", 2) + C(cx, 318, 4, IRON, 1)
    # bow string, cocked back to the claw, bolt in the groove
    b += line2("M139 130 L256 250 L373 130", "#E9DDB8", 1.6)
    b += R(cx - 8, 246, 16, 16, IRON, 1.6, rx=2) + C(cx, 254, 2.4, IRON_L, 0.6)
    b += line2("M256 112 V250", "#A58562", 2.2) + P("M256 94 L263 114 L256 110 L249 114 Z", "#D5D3CB", 1.4)
    b += P("M256 232 L249 222 L249 242 Z M256 232 L263 222 L263 242 Z", "#EDE9DC", 1)
    # winch drum, crank wheel, ratchet and rope to the claw
    b += line2("M256 262 V294", "#C9A97A", 1.6)
    b += R(232, 292, 48, 24, "#9F7D68", 2, rx=3) + "".join(P(f"M{x} 292 V316", "none", 0.9, 'opacity=".6"') for x in range(240, 278, 6))
    b += R(228, 288, 6, 32, IRON, 1.4) + R(278, 288, 6, 32, IRON, 1.4)
    b += C(300, 304, 12, "none", 2.2) + P("M300 292 V316 M288 304 H312", "none", 1.8) + C(300, 304, 3.6, IRON, 1) + P("M312 304 L322 316", "none", 2.4) + C(323, 318, 3.4, "#745846", 1.2)
    b += C(216, 304, 8, IRON_L, 1.4) + P("M212 296 L218 301", "none", 2)
    # --- loose pieces
    # trapdoor hatch with ring, SW
    b += R(66, 386, 80, 66, "#745846", 2.4) + R(74, 394, 64, 50, "#9F7D68", 1.8) + hatch_over("M74 394 H138 V444 H74 Z", "plankHatch")
    b += P("M86 394 V444 M106 394 V444 M126 394 V444", "none", 0.8, 'opacity=".5"')
    for y in (402, 436):
        b += P(f"M74 {y} H112", "none", 2.6) + P(f"M74 {y} H112", "none", 1.1, f'stroke="{IRON_L}"')
    b += C(124, 419, 8, "none", 3.2) + C(124, 419, 8, "none", 1.4, f'stroke="{IRON_L}"') + R(117, 410, 14, 6, IRON, 1.2)
    # stack of spare bolts, tied, SE
    bolts = ""
    for i in range(7):
        y = i * 7.5
        bolts += line2(f"M0 {y:g} H92", "#A58562", 1.8) + P(f"M92 {y-3.4:g} L103 {y:g} L92 {y+3.4:g} Z", "#D5D3CB", 0.9) + P(f"M0 {y:g} l9 -2.6 v5.2 Z", "#EDE9DC", 0.7)
    bolts += P("M30 -4 V50 M62 -4 V50", "none", 2.6, 'stroke="#C9A97A"')
    b += G(bolts, "translate(340 366) rotate(-9)")
    # beacon brazier (NE): stone pad, iron basket, wood and flame, oil jug
    b += P("M392 62 H452 L474 84 V132 L452 154 H392 L370 132 V84 Z", "#A8A59B", 2) + hatch_over("M392 62 H452 L474 84 V132 L452 154 H392 L370 132 V84 Z", "stoneHatch")
    bx, by = 422, 108
    for a in (45, 135, 225, 315):
        x, y = pt(bx, by, 34, a)
        b += C(x, y, 5, IRON, 1.3)
    b += C(bx, by, 30, IRON, 2.2) + C(bx, by, 25, "#6F6D68", 1.2)
    for a in range(0, 360, 30):
        x1, y1 = pt(bx, by, 24, a)
        x2, y2 = pt(bx, by, 30, a)
        b += P(f"M{x1:.1f} {y1:.1f} L{x2:.1f} {y2:.1f}", "none", 1.3)
    b += C(bx, by, 20, "#5A2B22", 1) + log(bx - 20, by + 10, bx + 18, by - 14, 9, "#8F6F52", True) + log(bx - 16, by - 14, bx + 20, by + 12, 9, "#9F7D68", True)
    b += fire(bx, by, 1.6, 8, 9)
    b += C(380, 148, 7, "#3A3836", 1.6) + C(380, 148, 3, IRON_L, 0.8)
    # flagpole base (NW): stone socket, pole, guy ropes, pennant
    fx, fy = 86, 92
    b += line2(f"M{fx} {fy} L50 52 M{fx} {fy} L124 54 M{fx} {fy} L48 128 M{fx} {fy} L126 130", "#C9A97A", 1.2)
    for x, y in ((50, 52), (124, 54), (48, 128), (126, 130)):
        b += C(x, y, 3.6, IRON, 1.2)
    b += R(fx - 22, fy - 22, 44, 44, STONE, 2.2) + hatch_over(f"M{fx-22} {fy-22} h44 v44 h-44 Z", "stoneHatch")
    b += C(fx, fy, 13, IRON, 1.8) + C(fx, fy, 9, "#745846", 1.2)
    b += P(f"M{fx+5} {fy-6} C{fx+30} {fy-14} {fx+50} {fy-4} {fx+86} {fy-12} L{fx+70} {fy+2} L{fx+88} {fy+14} C{fx+50} {fy+8} {fx+30} {fy+16} {fx+5} {fy+6} Z", RED, 1.8)
    b += P(f"M{fx+34} {fy-2} Q{fx+48} {fy+2} {fx+60} {fy-2}", "none", 0.9, 'opacity=".5"') + C(fx + 26, fy + 1, 4.4, GOLD, 1.1)
    b += C(fx, fy, 5.5, "#C9A97A", 1.6) + C(fx, fy, 2, IRON, 0.5)
    # rain barrel with downspout from the scupper (S)
    b += P("M418 484 V452", "none", 6) + P("M418 484 V452", "none", 3.6, f'stroke="{IRON_L}"')
    b += C(425, 436, 24, "#A17A5C", 2) + C(425, 436, 20, "none", 1, 'opacity=".6"') + C(425, 436, 16, WATER_D, 1.6) + C(425, 436, 9, "none", 1.1, 'stroke="#A3C9CC" opacity=".8"')
    b += P("M409 436 H441", "none", 1.1, 'stroke="#4D4B47" opacity=".7"')
    # lookout stool and spyglass (W)
    b += C(94, 300, 13, "#A9856E", 1.8) + C(94, 300, 8, "none", 1, 'opacity=".5"') + P("M84 310 L78 322 M104 310 L110 322 M94 314 V328", "none", 2.2)
    b += P("M110 330 L168 344 L168 352 L110 342 Z", "#8F6F52", 1.6) + P("M142 337 L146 346", "none", 2.2, f'stroke="{GOLD}"') + P("M118 332 L120 341", "none", 2.2, f'stroke="{GOLD}"')
    # coil of rope by the hatch
    b += coil(182, 404, 14)
    return b


specs["room-roof-deck"] = {
    "title": "Keep roof deck",
    "desc": "Open flat roof of pale flagstone ringed by a crenellated parapet: siege ballista, trapdoor, bolts, beacon brazier, flagpole base, rain barrel, lookout stool.",
    "body": roof_deck(), "shadow": "",
}


# ================================================================ 6. gatehouse
def gatehouse():
    rnd = random.Random(33)
    WALL = "#6F6D68"
    d = "M0 0 H512 V512 H0 Z"
    b = P(d, WALL, 0, NOSTROKE) + hatch_over(d, "stoneHatch")
    # extra masonry courses in the wall masses
    for y in range(40, 512, 52):
        b += P(f"M0 {y} H170 M342 {y} H512", "none", 0.7, 'opacity=".22"')
    # cobbled gate tunnel x 190..322 with wheel grooves
    b += R(190, 0, 132, 512, "#A8A59B", 0, ex=NOSTROKE)
    cols = ("#B3AEA0", "#A8A59B", "#9E9A8E", "#BAB5A7")
    row = 0
    for y in range(4, 512, 17):
        off = 11 if row % 2 else 0
        for i in range(-1, 7):
            x = 190 + off + i * 22 + 11
            if x - 10 < 190 or x + 10 > 322:
                continue
            b += E(x + rnd.uniform(-1.4, 1.4), y + rnd.uniform(-1.2, 1.2), rnd.uniform(8.4, 9.8), rnd.uniform(6.2, 7.4), cols[rnd.randrange(4)], 0.8, rnd.uniform(-8, 8))
        row += 1
    b += P("M222 0 V512 M290 0 V512", "none", 2, 'stroke="#6F6D68" opacity=".35" stroke-dasharray="34 10"')
    # tunnel walls (faces), vaulting ribs overhead
    b += P("M190 0 V512 M322 0 V512", "none", 3.4)
    b += R(176, 0, 14, 512, "none", 0, ex=NOSTROKE)
    for y in (66, 182, 330, 450):
        b += P(f"M190 {y} H322", "none", 0.9, 'opacity=".3" stroke-dasharray="8 5"') + R(180, y - 5, 10, 10, STONE_L, 1.4) + R(322, y - 5, 10, 10, STONE_L, 1.4)
    # portcullis grooves and the retracted grating across the passage
    b += R(176, 114, 14, 12, "#15110f", 1.4) + R(322, 114, 14, 12, "#15110f", 1.4)
    b += P("M190 120 H322", "none", 3.2) + P("M190 120 H322", "none", 1.2, f'stroke="{IRON_L}"')
    b += "".join(C(x, 120, 3, IRON, 1.1) for x in range(196, 322, 12))
    b += P("M190 112 H322 M190 128 H322", "none", 0.9, 'opacity=".4" stroke-dasharray="3 6"')
    # murder holes: two rows of dark squares in the vault
    for y in (180, 352):
        for x in (232, 256, 280):
            b += R(x - 8, y - 8, 16, 16, "#15110f", 1.6) + R(x - 11, y - 11, 22, 22, "none", 0.8, ex='opacity=".35"')
    # inner double gate standing open against the tunnel walls
    def leaf(hx, ang):
        s = R(0, -5.5, 64, 11, "#8F6F52", 2, rx=1.5)
        s += P("".join(f"M{x} -5.5 V5.5 " for x in range(11, 64, 11)), "none", 0.8, 'opacity=".55"')
        for x in (6, 28, 50):
            s += R(x, -7, 7, 14, IRON, 1.3)
        return G(s, f"translate({hx} 398) rotate({ang})")
    b += leaf(192, 82) + leaf(320, 98)
    b += C(190, 398, 4.5, IRON, 1.4) + C(322, 398, 4.5, IRON, 1.4)
    # wall torches in the tunnel
    b += torch_w(190, 236, "L") + torch_w(322, 236, "R") + torch_w(190, 492, "L") + torch_w(322, 492, "R")
    # --- guard rooms behind small doors
    for side in ("L", "R"):
        x0 = 38 if side == "L" else 354
        rx0 = 38 if side == "L" else 354
        b += R(rx0, 150, 120, 200, "#BD9D86", 2.2) + hatch_over(f"M{rx0} 150 h120 v200 h-120 Z", "plankHatch")
        # doorway through the tunnel wall and the open leaf
        dx = 158 if side == "L" else 322
        b += R(dx, 270, 32, 30, "#BD9D86", 0, ex=NOSTROKE) + P(f"M{dx} 270 H{dx+32} M{dx} 300 H{dx+32}", "none", 3.2)
        b += P(f"M{dx+4 if side=='L' else dx+28} 285 H{dx+28 if side=='L' else dx+4}", "none", 1.4, 'opacity=".4" stroke-dasharray="3 4"')
        hx = 158 if side == "L" else 354
        s = R(0, -3.5, 30, 7, "#745846", 1.6, rx=1) + R(8, -4.5, 5, 9, IRON, 1) + R(20, -4.5, 5, 9, IRON, 1) + C(27, 0, 1.8, IRON_L, 0.5)
        b += G(s, f"translate({hx} 270) rotate({-112 if side=='L' else -68})")
        b += C(hx, 270, 3, IRON, 1.2)
        # bunks, table with things, stools
        if side == "L":
            b += bed(44, 156, 48, 90, RED) + bed(98, 156, 48, 90, "#6C8F7E")
            b += table(52, 308, 62, 30) + C(70, 322, 5, "#E6D9B5", 1.1) + C(70, 322, 2, "#8F6F52", 0.6) + C(92, 318, 3.4, "#C9A24E", 1) + R(98, 326, 5, 5, "#EDE9DC", 0.8) + R(104, 322, 5, 5, "#EDE9DC", 0.8)
            b += stool(76, 354 - 6, 8) + stool(124, 322, 8)
            b += chest(116, 262, 36, 20)
        else:
            b += bed(366, 156, 48, 90, "#C9A24E") + bed(420, 156, 48, 90, RED)
            b += table(396, 304, 64, 38) + P("M404 312 H448 V334 H404 Z", "#E6D9B5", 0.8, 'opacity=".5"')
            for i in range(4):
                for j in range(2):
                    if (i + j) % 2:
                        b += R(404 + i * 11, 312 + j * 11, 11, 11, "#6F6D68", 0.5, ex='opacity=".8"')
            b += stool(386, 322, 8) + stool(432, 358 - 6, 8)
            b += rack(402, 266, 54, 20, 0, "ss")
    # --- store rooms (bottom corners): barrels and crates west, armoury east
    for side in ("L", "R"):
        rx0 = 38 if side == "L" else 354
        b += R(rx0, 396, 120, 90, "#BD9D86", 2.2) + hatch_over(f"M{rx0} 396 h120 v90 h-120 Z", "plankHatch")
        dx = 158 if side == "L" else 322
        b += R(dx, 424, 32, 28, "#BD9D86", 0, ex=NOSTROKE) + P(f"M{dx} 424 H{dx+32} M{dx} 452 H{dx+32}", "none", 3.2)
        hx = 158 if side == "L" else 354
        s_ = R(0, -3.5, 28, 7, "#745846", 1.6, rx=1) + R(8, -4.5, 5, 9, IRON, 1) + R(19, -4.5, 5, 9, IRON, 1) + C(25, 0, 1.8, IRON_L, 0.5)
        b += G(s_, f"translate({hx} 452) rotate({112 if side=='L' else 68})") + C(hx, 452, 3, IRON, 1.2)
        if side == "L":
            b += barrel_top(62, 424, 14) + barrel_top(92, 420, 12) + barrel_top(58, 456, 12) + barrel_top(84, 460, 14) + barrel_top(118, 466, 11)
            b += R(112, 404, 34, 28, "#876A56", 1.8) + P("M118 410 L140 426 M140 410 L118 426", "none", 1, 'opacity=".6"') + sack(130, 446, 20, 22)
        else:
            b += rack(404, 420, 96, 36, 0, "ssaxm") + chest(436, 452, 34, 22) + R(364, 452, 26, 24, "#876A56", 1.8) + P("M368 456 L386 472 M386 456 L368 472", "none", 1, 'opacity=".6"')
            b += P("M396 470 Q404 460 412 470 Q404 480 396 470 Z", "#B9B8B0", 1.4) + C(404, 468, 3, "#6F6D68", 0.8)
    # --- stair turrets (top corners), spiral steps
    for tx in (62, 450):
        b += C(tx, 62, 46, "#8E8B83", 2.4) + hatch_over(f"M{tx-46} 62 a46 46 0 1 0 92 0 a46 46 0 1 0 -92 0 Z", "stoneHatch")
        b += C(tx, 62, 34, "#A8A59B", 1.6)
        b += spiral(tx, 62, 7, 33, 14, 20, 340, "#C4C1B6", "#8A8880", 1.1)
        b += C(tx, 62, 7, STONE_D, 1.6) + C(tx, 62, 3, IRON, 0.8)
        b += wedge(tx, 62, 7, 33, 0, 20, "#D8D5CA", 1.1)
    # --- drawbridge chain winch drums at the sides (outer end), chains out through the wall
    for cx_, wh in ((134, 160), (378, 352)):
        b += R(cx_ - 8, 0, 16, 11, "#15110f", 1.4)
        b += chain(f"M{cx_} 0 V74")
        b += R(cx_ - 22, 74, 44, 22, "#9F7D68", 2, rx=3) + "".join(P(f"M{x} 74 V96", "none", 0.9, 'opacity=".6"') for x in range(cx_ - 16, cx_ + 20, 6))
        b += R(cx_ - 24, 70, 5, 30, IRON, 1.4) + R(cx_ + 19, 70, 5, 30, IRON, 1.4)
        b += C(wh, 85, 11, "none", 2.2) + P(f"M{wh-11} 85 H{wh+11} M{wh} 74 V96", "none", 1.8) + C(wh, 85, 3.6, IRON, 1) + C(wh + (9 if cx_ < 200 else -9), 94, 2.8, "#745846", 1)
    return b


specs["room-gatehouse"] = {
    "title": "Castle gatehouse",
    "desc": "Gatehouse cell with a cobbled gate tunnel between thick stone walls: portcullis grating, murder holes, inner gate, guard rooms with bunks and tables, stair turrets and drawbridge winches.",
    "body": gatehouse(), "shadow": "",
}
