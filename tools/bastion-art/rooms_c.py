"""Interior tiles, set C: idol shrine, infirmary, kennels, library."""
import math
import random

from bastion_lib import *

specs = {}


# ---- local helpers ----------------------------------------------------------

def P(d, f="none", sw=1.6, op=None, s=None):
    a = f'    <path d="{d}" fill="{f}" stroke-width="{sw}"'
    if op is not None:
        a += f' opacity="{op}"'
    if s:
        a += f' stroke="{s}"'
    return a + "/>\n"


def R(x, y, w, h, f, sw=1.6, op=None):
    return P(f"M{x} {y} H{x+w} V{y+h} H{x} Z", f, sw, op)


def C(cx, cy, r, f, sw=1.6, op=None, s=None):
    a = f'    <circle cx="{cx}" cy="{cy}" r="{r}" fill="{f}" stroke-width="{sw}"'
    if op is not None:
        a += f' opacity="{op}"'
    if s:
        a += f' stroke="{s}"'
    return a + "/>\n"


def E(cx, cy, rx, ry, f, sw=1.6, rot=0, op=None):
    t = f' transform="rotate({rot} {cx} {cy})"' if rot else ""
    o = f' opacity="{op}"' if op is not None else ""
    return f'    <ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{f}" stroke-width="{sw}"{o}{t}/>\n'


def G(inner, x=0, y=0, rot=0):
    return f'  <g transform="translate({x} {y}) rotate({rot})">\n{inner}  </g>\n'


def flame(cx, cy, s=1.0):
    return (
        P(f"M{cx} {cy-11*s:.1f} C{cx+7*s:.1f} {cy-4*s:.1f} {cx+8*s:.1f} {cy+3*s:.1f} {cx} {cy+8*s:.1f} C{cx-8*s:.1f} {cy+3*s:.1f} {cx-7*s:.1f} {cy-4*s:.1f} {cx} {cy-11*s:.1f} Z", "#E08A33", 1.2)
        + P(f"M{cx} {cy-4*s:.1f} C{cx+3*s:.1f} {cy-1*s:.1f} {cx+3*s:.1f} {cy+3*s:.1f} {cx} {cy+5*s:.1f} C{cx-3*s:.1f} {cy+3*s:.1f} {cx-3*s:.1f} {cy-1*s:.1f} {cx} {cy-4*s:.1f} Z", "#F1D25A", 0.8)
    )


def candle(cx, cy, s=1.0):
    return C(cx, cy, 4.5 * s, "#EFE4C4", 1.2) + flame(cx, cy - 1, 0.55 * s)


def bone(cx, cy, rot=0, s=1.0):
    d = (f"M-9 -2 C-12 -6 -6 -7 -5 -3 H5 C6 -7 12 -6 9 -2 C12 2 6 6 5 3 H-5 C-6 6 -12 2 -9 -2 Z")
    return f'  <g transform="translate({cx} {cy}) rotate({rot}) scale({s})">\n' + P(d, "#E6D9B5", 1.3) + "  </g>\n"


def poly_blob(cx, cy, r, rng, n=7, jit=0.25):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.15, 0.15)
        rr = r * (1 + rng.uniform(-jit, jit))
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z", pts


# =============================================================================
# room-idol : shrine chamber, +1 CHA casting
# =============================================================================
rng = random.Random(11)
CX, CY = 256, 226
b = room_shell(FLOOR_FLAG, "#6F6D68", "stoneHatch")

# floor inlay: radiating sun symbol (ring + ten long rays + ten short rays)
b += C(CX, CY, 112, "none", 3, 0.55, "#C9A24E")
for k in range(10):
    a = math.radians(36 * k)
    L = 172
    pts = []
    for da, rr in ((-9, 100), (0, L), (9, 100)):
        pts.append((CX + rr * math.cos(a + math.radians(da)), CY + rr * math.sin(a + math.radians(da))))
    b += P("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z", "#C9A24E", 1.2, 0.75)
    a2 = a + math.radians(18)
    pts = []
    for da, rr in ((-6, 100), (0, 140), (6, 100)):
        pts.append((CX + rr * math.cos(a2 + math.radians(da)), CY + rr * math.sin(a2 + math.radians(da))))
    b += P("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z", "#9C3F3A", 1.0, 0.55)

# stepped round plinth
b += C(CX, CY, 96, "#A8A59B", 2.4) + C(CX, CY, 96, "url(#stoneHatch)", 0, s="none")
b += C(CX, CY, 76, "#8E8B83", 2.2) + C(CX, CY, 76, "url(#stoneHatch)", 0, s="none")
b += C(CX, CY, 54, "#6F6D68", 2.2) + C(CX, CY, 46, "none", 0.9, 0.5)
for k in range(12):  # step notches
    a = math.radians(30 * k + 15)
    b += P(f"M{CX+77*math.cos(a):.1f} {CY+77*math.sin(a):.1f} L{CX+95*math.cos(a):.1f} {CY+95*math.sin(a):.1f}", "none", 0.9, 0.45)

# carved horned idol seen from above
b += P(f"M{CX-40} {CY+22} C{CX-44} {CY+2} {CX-26} {CY-4} {CX} {CY-4} C{CX+26} {CY-4} {CX+44} {CY+2} {CX+40} {CY+22} C{CX+20} {CY+34} {CX-20} {CY+34} {CX-40} {CY+22} Z", "#7A5C3E", 2)  # shoulders
b += E(CX - 34, CY + 20, 8, 5, "#7A5C3E", 1.4, 20) + E(CX + 34, CY + 20, 8, 5, "#7A5C3E", 1.4, -20)  # hands
b += P(f"M{CX-10} {CY+22} Q{CX} {CY+14} {CX+10} {CY+22}", "none", 1.1, 0.7)  # clasped arms
b += P(f"M{CX-14} {CY-6} C{CX-52} {CY-2} {CX-60} {CY-34} {CX-44} {CY-52} C{CX-46} {CY-34} {CX-34} {CY-26} {CX-20} {CY-22} Z", "#E6D9B5", 1.8)  # left horn
b += P(f"M{CX+14} {CY-6} C{CX+52} {CY-2} {CX+60} {CY-34} {CX+44} {CY-52} C{CX+46} {CY-34} {CX+34} {CY-26} {CX+20} {CY-22} Z", "#E6D9B5", 1.8)  # right horn
b += P(f"M{CX-36} {CY-14} Q{CX-44} {CY-28} {CX-40} {CY-40} M{CX+36} {CY-14} Q{CX+44} {CY-28} {CX+40} {CY-40}", "none", 0.9, 0.55)  # horn ridges
b += C(CX, CY + 2, 19, "#8F6F52", 2) + P(f"M{CX-12} {CY-8} Q{CX} {CY-16} {CX+12} {CY-8}", "none", 1.2, 0.6)  # head + brow
b += P(f"M{CX} {CY-6} L{CX-4} {CY+8} H{CX+4} Z", "#7A5C3E", 1)  # nose ridge
b += C(CX, CY + 2, 3.2, "#9C3F3A", 1.1)  # forehead gem

# ring of ten standing stones with a ribbon / bead string between each pair
R_RING = 150
stones = []
for k in range(10):
    a = math.radians(18 + 36 * k)
    stones.append((CX + R_RING * math.cos(a), CY + R_RING * math.sin(a), a))
rib = ["#9C3F3A", "#C9A24E", "#4F6B65", "#6C5B8C"]
for k in range(10):
    x1, y1, _ = stones[k]
    x2, y2, _ = stones[(k + 1) % 10]
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    qx, qy = mx + (CX - mx) * 0.22, my + (CY - my) * 0.22
    d = f"M{x1:.1f} {y1:.1f} Q{qx:.1f} {qy:.1f} {x2:.1f} {y2:.1f}"
    if k % 2 == 0:
        b += P(d, "none", 8, None, INK) + P(d, "none", 5, None, rib[(k // 2) % 4])
        b += P(f"M{qx:.1f} {qy:.1f} l-3 14 M{qx:.1f} {qy:.1f} l5 13", "none", 3.2, None, rib[(k // 2 + 1) % 4])
    else:  # bead string
        for t in [i / 8 for i in range(1, 8)]:
            px = (1 - t) ** 2 * x1 + 2 * t * (1 - t) * qx + t * t * x2
            py = (1 - t) ** 2 * y1 + 2 * t * (1 - t) * qy + t * t * y2
            b += C(round(px, 1), round(py, 1), 3.4, ["#C9A24E", "#9C3F3A", "#4F6B65"][int(t * 8) % 3], 0.9)
for k, (x, y, a) in enumerate(stones):
    d, pts = poly_blob(x, y, 15, rng, 7, 0.22)
    b += P(d, "#8E8B83", 2.2)
    d2, _ = poly_blob(x - 2, y - 2, 8, rng, 6, 0.2)
    b += P(d2, "#A8A59B", 1.1)
    b += P(f"M{x-3:.1f} {y-2:.1f} l3 -3 l3 3 l-3 3 Z", "none", 0.8, 0.6)  # rune

# offering slab, bowl with flame, and offerings
b += R(228, 354, 56, 36, "#8E8B83", 2.2) + R(228, 354, 56, 36, "url(#stoneHatch)", 0)
b += C(256, 372, 14, "#9F7D4A", 2) + C(256, 372, 9, "#26211F", 1.2) + flame(256, 371, 1.0)
b += C(238, 366, 3.4, "#9C3F3A", 1) + C(240, 379, 3.4, "#C9A24E", 1) + C(274, 380, 3.4, "#6C8F7E", 1) + C(273, 363, 3, "#E6D9B5", 1)

# kneeling mats (two, front corners)
for mx, my, rot, col in ((46, 420, -8, "#9C3F3A"), (400, 420, 8, "#4F6B65")):
    g = R(0, 0, 68, 54, col, 1.8) + R(6, 6, 56, 42, "none", 2.4) + P("M12 27 H56 M34 12 V42", "none", 1.2, 0.8)
    b += G(g, mx, my, rot).replace('stroke-width="2.4"/>', 'stroke-width="2.4" stroke="#D7C39A"/>', 1)
    b += P(f"M{mx+8} {my+56} v8 M{mx+22} {my+57} v8 M{mx+36} {my+57} v8 M{mx+50} {my+56} v8", "none", 1.6, 0.9, "#D7C39A")

# corner braziers
for bx, by in ((64, 64), (448, 64)):
    b += C(bx, by, 20, "#6F6D68", 2.2) + C(bx, by, 14, "#26211F", 1.4) + flame(bx, by, 1.3)
    for k in range(3):
        a = math.radians(120 * k + 30)
        b += P(f"M{bx+14*math.cos(a):.1f} {by+14*math.sin(a):.1f} L{bx+24*math.cos(a):.1f} {by+24*math.sin(a):.1f}", "none", 2.4)
# offering table (right), with fruit, coin dish and candles
b += table(432, 244, 44, 84)
b += C(454, 262, 8, "#C9A24E", 1.4) + C(454, 262, 4, "none", 0.8) + C(444, 292, 5, "#9C3F3A", 1.2) + C(458, 296, 5, "#6C8F7E", 1.2) + C(450, 310, 5, "#C9A24E", 1.2)
b += candle(464, 278, 0.9) + candle(442, 318, 0.9)
# offering chest (left) and flower garland
b += chest(40, 244, 34, 62).replace(f"M40 {244+62*0.38:.0f} H74", f"M40 {244+62*0.38:.0f} H74")
for k in range(7):
    b += C(88 + (k % 2) * 6, 256 + k * 9, 4, ["#C9A24E", "#9C3F3A", "#E6D9B5"][k % 3], 1)
specs["room-idol"] = {"title": "Idol shrine", "desc": "Top-down shrine chamber: a horned idol on a stepped plinth ringed by ten standing stones and a sun inlay.", "body": b, "shadow": ""}


# =============================================================================
# room-infirmary : ward, patients ADV on CON
# =============================================================================
INF_FLOOR = ("#DCCFB8", "plankHatch")
b = room_shell(INF_FLOOR, "#6F6D68", "stoneHatch")


def cot(x, y, head="L", blanket="#6C8F7E", kind="plain", skin="#E2B79A", hair="#5B4636"):
    w, h = 104, 58
    s = 1 if head == "L" else -1
    hx = x + 18 if head == "L" else x + w - 18  # head centre
    out = R(x, y, w, h, "#876A56", 2)
    out += R(x + 4, y + 4, w - 8, h - 8, "#E6D9B5", 1)  # mattress
    px = x + 5 if head == "L" else x + w - 33
    out += P(f"M{px} {y+8} H{px+28} V{y+h-8} H{px} Z", "#F4EEDC", 1.5)  # pillow
    out += P(f"M{px+3} {y+14} H{px+25}", "none", 0.8, 0.4)
    bx = x + 34 if head == "L" else x + 6
    out += P(f"M{bx} {y+8} H{bx+64} V{y+h-8} H{bx} Z", blanket, 1.6)  # blanket
    out += P(f"M{bx+(0 if head=='L' else 64)} {y+22} H{bx+(10 if head=='L' else 54)} M{bx+(0 if head=='L' else 64)} {y+h-22} H{bx+(10 if head=='L' else 54)}", "none", 0.9, 0.5)
    fx = bx + 64 if head == "L" else bx
    out += P(f"M{bx+(34 if head=='L' else 30)} {y+8} V{y+h-8}", "none", 0.9, 0.5)  # fold
    out += E(fx - 8 * s, y + h / 2, 7, 12, blanket, 1.2)  # feet bump
    out += E(hx, y + h / 2, 11, 12, skin, 1.6)  # head
    if kind == "bandaged":
        out += E(hx, y + h / 2, 12, 13, "#F4EEDC", 1.6)
        out += P(f"M{hx-10} {y+h/2-4} L{hx+10} {y+h/2-8} M{hx-11} {y+h/2+2} L{hx+11} {y+h/2-2} M{hx-10} {y+h/2+8} L{hx+10} {y+h/2+4}", "none", 0.9, 0.55)
        out += C(hx + 3 * s, y + h / 2 + 3, 3.4, "#9C3F3A", 0.8)
        out += E(bx + 20 * (1 if head == "L" else 1) + (0 if head == "L" else 24), y + 12, 20, 6, "#F4EEDC", 1.4)  # arm in a sling
        out += P(f"M{hx} {y+h/2-12} L{bx+(30 if head=='L' else 30)} {y+14}", "none", 1.3, 0.6)
    else:
        out += P(f"M{hx-10*s} {y+h/2-9} C{hx-4*s} {y+h/2-16} {hx+10*s} {y+h/2-14} {hx+11*s} {y+h/2-4} C{hx+4*s} {y+h/2-8} {hx-4*s} {y+h/2-7} {hx-10*s} {y+h/2-9} Z", hair, 1)
    if kind == "armout":
        out += E(bx + 22 + (0 if head == "L" else 20), y + 12, 14, 5, skin, 1.3) + C(bx + 38 + (0 if head == "L" else 20), y + 12, 4, skin, 1.1)
    if kind == "sick":
        out += C(bx + 40 + (0 if head == "L" else 0), y + h - 12, 4.5, "#4C8699", 1.1)  # damp cloth bowl
    return out


b += cot(28, 48, "L", "#6C8F7E", "plain") + cot(28, 122, "L", "#C9A24E", "bandaged", "#D9A98A", "#3B3633")
b += cot(380, 48, "R", "#9C3F3A", "armout", "#C99A7B", "#8A6A3E") + cot(380, 122, "R", "#6C5B8C", "sick", "#E8C4A8", "#A07A4A")
# bedside stools, with a candle and a cup
b += stool(147, 76, 9) + stool(147, 150, 9) + stool(365, 76, 9) + stool(365, 150, 9)
b += candle(147, 76, 0.7) + C(365, 150, 4, "#C9A24E", 1) + C(147, 150, 4, "#4C8699", 1)

# surgeon's table with instruments
b += table(184, 48, 144, 84, "#9F7D68")
b += R(192, 56, 128, 68, "#6B5340", 1.2, 0.35)  # leather mat
# bone saw: handle, frame, serrated blade
b += P("M200 74 H216 V80 H200 Z", "#745846", 1.3) + P("M216 77 H300", "none", 1.6)
b += P("M216 82 H300 L296 87 L290 82 L284 87 L278 82 L272 87 L266 82 L260 87 L254 82 L248 87 L242 82 L236 87 L230 82 L224 87 L218 82 Z", "#C9CBCB", 1.1)
# scalpels and forceps
b += P("M204 96 L246 92 M204 100 L252 98", "none", 1.2) + P("M246 91 L256 90 L246 94 Z", "#C9CBCB", 0.9) + P("M252 97 L264 98 L252 101 Z", "#C9CBCB", 0.9)
# bottles
for i, (bx, by, col) in enumerate(((270, 104, "#6C8F7E"), (284, 110, "#9C3F3A"), (298, 104, "#C9A24E"), (310, 112, "#6C5B8C"))):
    b += C(bx, by, 6, col, 1.3) + C(bx, by, 2.6, "#E6D9B5", 0.9)
# bloody basin and rolled bandage
b += C(214, 112, 9, "#8A8A86", 1.6) + C(214, 112, 6, "#9C3F3A", 0.9) + C(244, 112, 6, "#F4EEDC", 1.2) + C(244, 112, 2.5, "none", 0.7)
b += stool(256, 154, 10, "#A9856E")

# herb-drying rack
b += P("M38 194 H150 V220 H38 Z", "#876A56", 2) + P("M54 194 V220 M74 194 V220 M94 194 V220 M114 194 V220 M134 194 V220", "none", 1.2)
for i, col in enumerate(["#6F8A5F", "#8FA66E", "#6C5B8C", "#6F8A5F", "#B8A15A", "#8FA66E"]):
    bxx = 44 + i * 18
    b += E(bxx, 207, 8, 5, col, 1.1, 25 * (-1) ** i) + E(bxx + 4, 204, 5, 3, "#A8BE86", 0.8, -30) + P(f"M{bxx-2} {207} h4", "none", 1.6, None, "#9C3F3A")
# washbasin on a stand + bucket + towel
b += R(64, 326, 52, 48, "#876A56", 2) + C(90, 350, 17, "#C9CBCB", 1.8) + C(90, 350, 12, "#5B99A6", 1) + C(90, 350, 12, "url(#waterHatch)", 0)
b += P("M72 377 H108 V390 H72 Z", "#F4EEDC", 1.3) + P("M72 383 H108", "none", 0.8, 0.4)  # hanging towel
b += C(148, 358, 12, "#8F6F52", 1.8) + C(148, 358, 8, "#5B99A6", 1) + P("M138 350 Q148 334 158 350", "none", 1.3)  # bucket
# mortar and pestle on a small stool-table
b += R(36, 244, 60, 46, "#9F7D68", 1.8) + C(56, 267, 11, "#C9CBCB", 1.5) + C(56, 267, 6, "#6B5B4B", 1) + P("M58 264 L74 250", "none", 3.4) + P("M58 264 L74 250", "none", 1.8, None, "#E6D9B5") + C(80, 276, 4, "#6F8A5F", 1) + C(86, 266, 3.4, "#8FA66E", 1)

# bandage shelf, right wall
b += R(396, 212, 88, 32, "#745846", 2)
for i in range(5):
    b += C(412 + i * 17, 228, 7, "#F4EEDC", 1.3) + C(412 + i * 17, 228, 3, "none", 0.7)
# boiling cauldron
b += C(436, 318, 34, "#3B3633", 2.2) + C(436, 318, 28, "#6B6560", 1.2) + C(436, 318, 23, "#6F9C8C", 1.4) + C(436, 318, 23, "url(#waterHatch)", 0)
for bx, by, r in ((426, 310, 4), (444, 322, 5), (434, 330, 3), (448, 308, 3), (424, 326, 2.5)):
    b += C(bx, by, r, "#C8E3DB", 0.9)
b += P("M404 312 C396 312 396 324 404 324 M468 312 C476 312 476 324 468 324", "none", 2.6)  # lugs
b += P("M418 296 Q430 286 440 294 T462 292", "none", 1, 0.5)  # steam
# stack of firewood + tongs
b += E(456, 366, 16, 6, "#8F6F52", 1.6, -20) + E(450, 380, 17, 6, "#745846", 1.6, 10)

# red-cross rug
b += rug(196, 226, 120, 120, "#F4EEDC", "#C9B791")
b += P("M244 244 H268 V262 H286 V286 H268 V304 H244 V286 H226 V262 H244 Z", "#9C3F3A", 2.2)

# water barrel, crate of linen and a small candle table beside the rug
b += barrel_top(160, 300, 16) + barrel_top(168, 334, 13)
b += R(334, 256, 34, 28, "#A58562", 1.8) + P("M334 270 H368 M351 256 V284", "none", 1, 0.5) + P("M338 262 L362 262 L362 266 L338 266 Z", "#F4EEDC", 0.9)
b += round_table(344, 306, 14) + candle(344, 306, 1)
# medicine cabinet (bottom-left, left of the door path)
b += R(40, 448, 138, 34, "#745846", 2.2) + P("M109 448 V482", "none", 1.4)
for i, col in enumerate(["#6C8F7E", "#9C3F3A", "#C9A24E", "#6C5B8C", "#4C8699", "#9C3F3A"]):
    b += C(54 + i * 24, 465, 7, col, 1.3) + C(54 + i * 24, 465, 2.5, "#E6D9B5", 0.8)
b += R(120, 446, 4, 38, "#C9A24E", 1)  # key plate
# stretcher near the door, right side
b += P("M334 412 H474 V440 H334 Z", "#C9B791", 1.6) + P("M334 408 H474 M334 444 H474", "none", 3.4) + P("M326 408 H334 M474 408 H482 M326 444 H334 M474 444 H482", "none", 3.4)
b += P("M350 412 V440 M410 412 V440", "none", 0.8, 0.5)
b += R(338, 416, 24, 20, "#F4EEDC", 1.2)
specs["room-infirmary"] = {"title": "Infirmary", "desc": "Top-down ward: four patient cots, a surgeon's table, herb rack, cauldron and red-cross rug.", "body": b, "shadow": ""}


# =============================================================================
# room-kennels : dog run, DISADV to sneak in
# =============================================================================
KEN_FLOOR = ("#B3A07A", "leanHatch")
b = room_shell(KEN_FLOOR, "#745846", "logHatch")
rng = random.Random(5)

# mud puddles and scattered straw on the floor
for px, py, rx, ry, r in ((300, 190, 34, 16, 8), (180, 300, 40, 18, -12), (420, 360, 30, 14, 20), (140, 220, 22, 10, 0)):
    b += E(px, py, rx, ry, "#8B7B5E", 1, r, 0.8)
for _ in range(34):
    sx, sy = rng.randint(130, 470), rng.randint(140, 395)
    a = rng.uniform(0, 180)
    b += P(f"M{sx} {sy} l{12*math.cos(math.radians(a)):.1f} {12*math.sin(math.radians(a)):.1f}", "none", 1.3, 0.8, "#C9A24E")


def hound_curled(cx, cy, rot, fur, patch):
    g = P("M-20 3 C-36 6 -34 24 -14 21", "none", 6.4, None, INK) + P("M-20 3 C-36 6 -34 24 -14 21", "none", 3.8, None, fur)  # tail
    g += E(0, 0, 23, 14, fur, 1.8) + E(-6, -3, 9, 6, patch, 0.9, 20)  # body, saddle patch
    g += E(14, 14, 7, 3.4, fur, 1.2, 40) + E(-12, 12, 7, 3.4, fur, 1.2, -20)  # paws tucked
    g += E(19, 4, 10, 9, fur, 1.7) + E(29, 7, 6.5, 4.6, patch, 1.4, 15) + C(34, 8, 1.8, INK, 0.5)  # head, snout, nose
    g += E(14, -3, 7, 3.6, patch, 1.3, 40) + E(14, 11, 7, 3.6, patch, 1.3, -40)  # ears
    g += C(22, 1, 1, INK, 0.5)
    return G(g, cx, cy, rot)


def hound_stand(cx, cy, rot, fur, patch):
    g = P("M-26 0 C-34 -4 -36 -12 -42 -16", "none", 6.4, None, INK) + P("M-26 0 C-34 -4 -36 -12 -42 -16", "none", 3.8, None, fur)
    for lx, ly in ((14, -11), (14, 11), (-14, -11), (-14, 11)):
        g += E(lx, ly, 6, 3.2, patch, 1.2)
    g += E(0, 0, 26, 11, fur, 1.8) + E(-4, -1, 11, 6, patch, 0.9)
    g += E(30, 0, 9, 8, fur, 1.7) + E(40, 0, 7, 4.5, patch, 1.4) + C(46, 0, 1.8, INK, 0.5)
    g += E(27, -8, 6, 3.2, patch, 1.2, -40) + E(27, 8, 6, 3.2, patch, 1.2, 40)
    return G(g, cx, cy, rot)


def kennel_box(x, y, w, h, front="B"):
    out = R(x, y, w, h, "#D4B76A", 2.4)
    for _ in range(14):
        sx, sy = x + rng.uniform(5, w - 5), y + rng.uniform(5, h - 5)
        a = rng.uniform(0, math.pi)
        out += P(f"M{sx:.1f} {sy:.1f} l{9*math.cos(a):.1f} {9*math.sin(a):.1f}", "none", 1.2, 0.7, "#A58562")
    return out


fur = ["#8F6F52", "#6B5340", "#9A9486", "#C29A6B", "#3B3633"]
patch = ["#E6D9B5", "#C29A6B", "#6B5340", "#E6D9B5", "#6B6560"]
# top row: five boxes, hounds curled in
for i in range(5):
    x = 36 + i * 88
    b += kennel_box(x, 28, 88, 80)
for i, (hx, rot, fi) in enumerate(((78, 15, 0), (166, -160, 1), (342, 170, 3), (428, 20, 4))):
    if i == 1:
        b += hound_curled(hx, 66, rot, fur[fi], patch[fi])
    elif i == 0:
        b += hound_curled(hx, 70, rot, fur[fi], patch[fi])
    else:
        b += hound_curled(hx, 68, rot, fur[fi], patch[fi])
# box 3 (centre): bone, bowl and a chewed slipper
b += bone(250, 64, 25) + C(278, 90, 8, "#8A8A86", 1.4) + C(278, 90, 5, "#5B99A6", 0.8) + P("M220 80 q8 -8 18 -2 q-4 8 -18 2 Z", "#8F6F52", 1.2)
# divider planks and front rails with gate gaps
for i in range(6):
    b += R(33 + i * 88, 28, 7, 84, "#745846", 2) + P(f"M{36+i*88} 34 V106", "none", 0.8, 0.4)
for i in range(5):
    x = 36 + i * 88
    b += R(x, 104, 24, 8, "#745846", 1.8) + R(x + 64, 104, 24, 8, "#745846", 1.8)
# left column: three boxes
for j in range(3):
    y = 124 + j * 76
    b += kennel_box(28, y, 80, 76)
b += hound_curled(70, 164, -85, "#9A9486", "#E6D9B5") + hound_curled(62, 316, 100, "#C29A6B", "#6B5340")
b += bone(60, 238, -30) + C(88, 266 - 40, 7, "#8A8A86", 1.4) + C(88, 226, 4.5, "#5B99A6", 0.8)
for j in range(4):
    b += R(28, 120 + j * 76, 84, 7, "#745846", 2)
for j in range(3):
    y = 124 + j * 76
    b += R(104, y, 8, 22, "#745846", 1.8) + R(104, y + 54, 8, 22, "#745846", 1.8)

# feed troughs (right wall) with slop and chunks, water bowl
b += P("M446 130 H480 V268 H446 Z", "#876A56", 2.2) + P("M452 136 H474 V262 H452 Z", "#4B3A2C", 1.4)
b += P("M455 150 Q464 144 471 154 Q466 168 455 164 Z M455 190 Q463 182 471 194 Q463 206 455 198 Z M456 226 Q464 220 471 230 Q464 246 456 240 Z", "#9C6B4A", 1.2)
b += C(462, 300, 15, "#8A8A86", 1.8) + C(462, 300, 11, "#5B99A6", 1) + C(462, 300, 11, "url(#waterHatch)", 0)
b += bone(430, 214, 70, 0.9) + bone(380, 160, -10, 0.8) + bone(150, 400, 40, 0.8)

# chain stakes with a chained hound
b += P("M326 250 C340 262 346 272 356 276 C368 282 372 286 384 284", "none", 3.2, None, INK) + P("M326 250 C340 262 346 272 356 276 C368 282 372 286 384 284", "none", 1.6, None, "#C9CBCB")
b += C(326, 250, 8, "#6B6560", 1.8) + C(326, 250, 3, "#C9CBCB", 1)
b += hound_stand(402, 288, 15, "#3B3633", "#6B6560")
b += C(236, 340, 7, "#6B6560", 1.8) + C(236, 340, 2.6, "#C9CBCB", 1) + P("M236 340 C250 350 258 356 268 358", "none", 1.6, None, "#C9CBCB")
b += C(366, 360, 7, "#6B6560", 1.8) + C(366, 360, 2.6, "#C9CBCB", 1) + P("M366 360 C352 350 346 346 330 346", "none", 1.6, None, "#C9CBCB")
b += hound_stand(210, 352, 190, "#9A9486", "#E6D9B5")
b += hound_curled(320, 180, 70, "#8F6F52", "#E6D9B5")

# handler's bench, whistle and leashes (bottom right)
b += R(332, 444, 142, 32, "#876A56", 2.2) + P("M332 460 H474", "none", 1, 0.5)
b += P("M350 444 C340 424 366 424 360 444 M376 444 C368 420 398 420 390 444", "none", 3, None, INK) + P("M350 444 C340 424 366 424 360 444 M376 444 C368 420 398 420 390 444", "none", 1.6, None, "#8F6F52")
b += C(414, 458, 6, "#C9CBCB", 1.4) + P("M414 458 L426 452 L430 458 L420 462 Z", "#C9CBCB", 1.1) + P("M414 458 C404 450 396 450 392 460", "none", 1, 0.8)  # whistle + cord
b += C(448, 460, 9, "#8F6F52", 1.5) + C(448, 460, 5, "none", 0.9, 0.7) + C(448, 460, 11, "none", 0.9, 0.5)  # coiled lead
b += R(336, 438, 6, 8, "#C9CBCB", 1) + R(466, 438, 6, 8, "#C9CBCB", 1)
# feed sack and a pail of water by the door side
b += P("M312 360 C300 380 304 404 330 400 C348 392 346 370 336 358 Z", "#C9B791", 1.8) + P("M322 366 Q328 362 334 366", "none", 1.2) + C(329, 384, 7, "none", 0.8, 0.5)
b += C(66, 436, 14, "#8F6F52", 1.8) + C(66, 436, 10, "#5B99A6", 1) + P("M54 430 Q66 414 78 430", "none", 1.4)
b += C(110, 446, 10, "#8F6F52", 1.8) + C(110, 446, 6, "#5B99A6", 1) + bone(150, 440, -20, 0.8)
specs["room-kennels"] = {"title": "Kennels", "desc": "Top-down dog run: straw kennel boxes with sleeping hounds, feed troughs, chain stakes and a handler's bench.", "body": b, "shadow": ""}


# =============================================================================
# room-library : tall shelves, +1 downtime learning
# =============================================================================
LIB_FLOOR = ("#8E7058", "plankHatch")
b = room_shell(LIB_FLOOR, "#5E4637", "logHatch")
rng = random.Random(21)

# large patterned rug
b += R(122, 108, 268, 270, "#7B2E2C", 2.4)
b += R(134, 120, 244, 246, "none", 3, 0.9).replace('stroke-width="3" opacity="0.9"', 'stroke-width="3" opacity="0.9" stroke="#D7C39A"')
b += R(144, 130, 224, 226, "#3F5A66", 1.4)
b += R(152, 138, 208, 210, "none", 1.6, 0.9).replace('opacity="0.9"', 'opacity="0.9" stroke="#C9A24E"')
b += P("M256 146 L352 243 L256 340 L160 243 Z", "#7B2E2C", 1.6)
b += P("M256 164 L334 243 L256 322 L178 243 Z", "none", 1.4, 0.9).replace('opacity="0.9"', 'opacity="0.9" stroke="#C9A24E"')
b += P("M256 202 L298 243 L256 284 L214 243 Z", "#C9A24E", 1.4)
b += C(256, 243, 10, "#3F5A66", 1.2) + C(256, 243, 4, "#D7C39A", 0.8)
for (cx_, cy_) in ((166, 154), (346, 154), (166, 332), (346, 332)):  # corner medallions
    b += P(f"M{cx_} {cy_-9} L{cx_+9} {cy_} L{cx_} {cy_+9} L{cx_-9} {cy_} Z", "#C9A24E", 1.1)
for xx in range(130, 388, 8):  # fringes
    b += P(f"M{xx} 108 v-5 M{xx} 378 v5", "none", 1.1, 0.8, "#D7C39A")
for k in range(10):  # border dashes
    b += P(f"M{150+k*21} 126 h10 M{150+k*21} 360 h10", "none", 1.4, 0.8, "#D7C39A")

# bookshelves around the walls (spines via shelf())
for i in range(4):
    b += shelf(28 + i * 114, 28, 108, 32)
for j in range(3):
    b += shelf(28, 64 + j * 78, 32, 74)
b += shelf(40, 450, 80, 32) + shelf(124, 450, 76, 32) + shelf(322, 450, 76, 32) + shelf(402, 450, 74, 32)
# a few books leaning / lying askew on the shelves
b += P("M118 32 L126 30 L128 58 L120 59 Z", "#6C5B8C", 1) + P("M276 33 L283 31 L286 57 L278 58 Z", "#9C3F3A", 1)
b += P("M36 126 L58 120 L59 128 L37 134 Z", "#C9A24E", 1) + P("M38 214 L58 210 L58 217 L38 221 Z", "#4F6B65", 1)

# scroll cubbies (right wall): 2 columns x 6 rows of squares with scroll ends
b += R(432, 64, 52, 168, "#745846", 2.2)
for r_ in range(6):
    for c_ in range(2):
        x, y = 436 + c_ * 24, 68 + r_ * 27
        b += R(x, y, 22, 24, "#4B3A2C", 1.1)
        if (r_ + c_) % 3 != 2:
            b += C(x + 11, y + 12, 7.5, ["#E6D9B5", "#D7C39A", "#F4EEDC"][(r_ * 2 + c_) % 3], 1.2) + C(x + 11, y + 12, 3, "none", 0.7) + (P(f"M{x+4} {y+12} h-3", "none", 1.2) if c_ == 0 else "")

# lectern with an open book (top right)
b += P("M374 76 H412 L408 118 H378 Z", "#876A56", 2) + R(380, 80, 28, 32, "#6B5340", 1.1, 0.5)
b += P("M380 84 H394 V108 H380 Z M394 84 H408 V108 H394 Z", "#F4EEDC", 1.3) + P("M383 90 H391 M383 95 H391 M383 100 H391 M397 90 H405 M397 95 H405 M397 100 H405", "none", 0.8, 0.6)
b += P("M378 120 H408 V128 H378 Z", "#745846", 1.6)

# rolling ladder along the left shelves, rail on the floor
b += P("M64 64 V290", "none", 2.6, None, "#C9A24E") + P("M64 64 V290", "none", 0.8, 0.8, "#745846")
lad = R(0, 0, 100, 22, "#A9856E", 1.8) + P("M0 6 H100 M0 16 H100", "none", 1.2)
for k in range(1, 8):
    lad += P(f"M{k*12.5} 2 V20", "none", 2.2)
b += G(lad, 68, 150, 62) + C(64, 150, 4, "#6B6560", 1.4)

# central reading table: open books, candles, inkwell, quill, scroll; chairs
for cx_, cy_, rot in ((256, 182, 180), (256, 308, 0), (170, 244, 90), (342, 244, -90)):
    ch = P("M-15 -12 H15 V12 H-15 Z", "#A9856E", 1.8) + P("M-15 12 H15 V19 H-15 Z", "#745846", 1.8) + P("M-9 -6 H9 V6 H-9 Z", "#9C3F3A", 1)
    b += G(ch, cx_, cy_, rot)
b += table(194, 204, 124, 78, "#876A56")
b += P("M208 214 H236 V248 H208 Z M236 214 H264 V248 H236 Z", "#F4EEDC", 1.5) + P("M213 222 H231 M213 228 H231 M213 234 H231 M241 222 H259 M241 228 H259 M241 234 H259", "none", 0.8, 0.55)  # open book 1
b += P("M276 232 L292 228 L296 246 L280 250 Z M292 228 L308 232 L304 250 L296 246 Z", "#F4EEDC", 1.4) + P("M281 235 L290 233 M282 240 L291 238", "none", 0.8, 0.5)  # open book 2
b += R(244, 256, 26, 8, "#4F6B65", 1.3) + R(247, 264, 20, 7, "#9C3F3A", 1.3) + R(246, 271, 24, 6, "#C9A24E", 1.2)  # stack
b += candle(210, 266, 1) + candle(300, 214, 1) + candle(228, 262, 0.8)
b += C(318 - 14, 272, 5, "#26211F", 1.3) + P("M300 270 C310 262 322 258 330 252 L322 262 C316 268 308 272 302 272 Z", "#E6D9B5", 1)  # inkwell + quill
b += P("M250 217 H282 V225 H250 Z", "#D7C39A", 1.2) + C(250, 221, 4, "#D7C39A", 1.2)  # rolled scroll

# orrery on a tripod stand (lower left)
OX, OY = 132, 392
for a in (90, 210, 330):
    ar = math.radians(a)
    b += P(f"M{OX} {OY} L{OX+46*math.cos(ar):.1f} {OY+46*math.sin(ar):.1f}", "none", 4.6, None, INK) + P(f"M{OX} {OY} L{OX+46*math.cos(ar):.1f} {OY+46*math.sin(ar):.1f}", "none", 2.6, None, "#745846")
b += C(OX, OY, 40, "#745846", 1.8) + C(OX, OY, 36, "#D7C39A", 1.2)
for rr, pr, col, ang in ((13, 3.6, "#9C3F3A", 40), (22, 4.8, "#4C8699", 150), (31, 5.8, "#6C5B8C", 250)):
    b += C(OX, OY, rr, "none", 2, 0.95, "#8F6F52")
    pa = math.radians(ang)
    b += C(round(OX + rr * math.cos(pa), 1), round(OY + rr * math.sin(pa), 1), pr, col, 1.3)
b += P(f"M{OX-38} {OY+7} L{OX+38} {OY-7}", "none", 1.4, 0.8, "#8F6F52") + C(OX, OY, 6.5, "#E08A33", 1.6) + C(OX, OY, 2.5, "#F1D25A", 0.7)

# standing globe (left)
b += C(70, 330, 26, "none", 2, 0.9, "#C9A24E") + C(70, 330, 20, "#4C8699", 1.8) + P("M60 318 C66 312 74 316 72 324 C68 330 60 328 60 318 Z M72 336 C78 334 82 340 78 346 C74 346 70 342 72 336 Z", "#8FA66E", 1) + P("M70 310 V350 M50 330 H90", "none", 0.8, 0.5) + P("M52 322 Q70 314 88 322", "none", 0.8, 0.4)
b += C(70, 330, 3, "#C9A24E", 1)
# reading armchair on a small round rug, with a candle side-table
b += C(414, 360, 52, "#4F6B65", 1.8) + C(414, 360, 42, "none", 2.4, 0.9, "#D7C39A") + C(414, 360, 28, "none", 1, 0.7, "#D7C39A")
arm = P("M-28 -26 H28 V12 H-28 Z", "#6C5B8C", 2.2) + P("M-28 -26 H28 V-14 H-28 Z", "#4B3F66", 1.6) + P("M-38 -22 H-26 V16 H-38 Z M26 -22 H38 V16 H26 Z", "#4B3F66", 1.8) + P("M-24 -12 H24 V10 H-24 Z", "#8D7BB0", 1.4) + P("M-8 -10 H8 V4 H-8 Z", "none", 0.9, 0.5) + P("M-30 14 H30 V24 H-30 Z", "#4B3F66", 1.6)
b += G(arm, 414, 366, 8)
b += C(466, 330, 14, "#876A56", 2) + C(466, 330, 9, "none", 0.9, 0.5) + candle(466, 330, 1) + P("M458 340 l10 6 l8 -2 l-6 -8 Z", "#9C3F3A", 1)  # book beside the candle
specs["room-library"] = {"title": "Library", "desc": "Top-down library: shelved walls, a patterned rug, reading table with open books, orrery, lectern and scroll cubbies.", "body": b, "shadow": ""}
