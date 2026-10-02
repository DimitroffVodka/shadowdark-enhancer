from bastion_lib import *
import math
import random

specs = {}

# ---- local drawing helpers --------------------------------------------------

def P(d, fill="none", sw=1.6, op=None, stroke=None, dash=None):
    a = f' fill="{fill}" stroke-width="{sw}"'
    if stroke:
        a += f' stroke="{stroke}"' if stroke != "none" else ' stroke="none"'
    if op is not None:
        a += f' opacity="{op}"'
    if dash:
        a += f' stroke-dasharray="{dash}"'
    return f'    <path d="{d}"{a}/>\n'


def C(cx, cy, r, fill, sw=1.6, op=None, stroke=None):
    a = f' stroke="{stroke}"' if stroke else ""
    o = f' opacity="{op}"' if op is not None else ""
    return f'    <circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke-width="{sw}"{a}{o}/>\n'


def E(cx, cy, rx, ry, fill, sw=1.6, rot=0, op=None):
    t = f' transform="rotate({rot} {cx} {cy})"' if rot else ""
    o = f' opacity="{op}"' if op is not None else ""
    return f'    <ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}" stroke-width="{sw}"{t}{o}/>\n'


def R(x, y, w, h, fill, sw=1.6, rx=0, op=None):
    o = f' opacity="{op}"' if op is not None else ""
    return f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke-width="{sw}"{o}/>\n'


def L(d, col, w=2.0, op=None, ink=True):
    """A coloured stroke with an ink edge (bones, spear shafts, rods)."""
    o = f' opacity="{op}"' if op is not None else ""
    out = ""
    if ink:
        out += f'    <path d="{d}" fill="none" stroke-width="{w+2.4}"{o}/>\n'
    out += f'    <path d="{d}" fill="none" stroke="{col}" stroke-width="{w}"{o}/>\n'
    return out


def T(x, y, inner, rot=0, s=1.0):
    t = f"translate({x} {y})"
    if rot:
        t += f" rotate({rot})"
    if s != 1.0:
        t += f" scale({s})"
    return f'    <g transform="{t}">\n{inner}    </g>\n'


def mirror(inner):
    return inner + f'    <g transform="scale(-1 1)">\n{inner}    </g>\n'


def star(cx, cy, r, fill="#F2D77A", sw=0.7):
    d = f"M{cx} {cy-r} L{cx+r*0.28:.1f} {cy-r*0.28:.1f} L{cx+r} {cy} L{cx+r*0.28:.1f} {cy+r*0.28:.1f} L{cx} {cy+r} L{cx-r*0.28:.1f} {cy+r*0.28:.1f} L{cx-r} {cy} L{cx-r*0.28:.1f} {cy-r*0.28:.1f} Z"
    return P(d, fill, sw)


def ring_pt(cx, cy, r, ang):
    a = math.radians(ang)
    return cx + r * math.cos(a), cy + r * math.sin(a)


BONE, BONE_D = "#E6D9B5", "#C9B98E"

# ============================================================================
# TROPHY ROOM
# ============================================================================

def mounted_head(kind):
    """Mounted head seen from above; wall at local y=0, head points +y."""
    fur = {"stag": "#9A7452", "boar": "#5E4A3C", "wolf": "#8B8E91", "ram": "#D4C7A6",
           "bear": "#5B4232", "drake": "#5F7F63"}[kind]
    dark = "#2b2220"
    s = P("M-15 -3 H15 V7 Q0 11 -15 7 Z", "#5B4434", 1.6)  # wall plaque
    if kind == "stag":
        s += mirror(L("M4 14 Q12 10 18 2 M11 9 Q17 11 21 9 M15 5 Q20 4 23 -1 M7 12 Q9 19 17 20", BONE, 3.2))
        s += E(0, 12, 8, 9, fur)
        s += P("M-6 14 Q-7 28 -3 38 Q0 41 3 38 Q7 28 6 14 Z", fur)
        s += mirror(E(8, 17, 5, 2.4, fur, 1.2, rot=-20))
        s += C(0, 38, 2.4, dark, 0.8)
    elif kind == "boar":
        s += mirror(P("M7 10 L15 7 L11 17 Z", fur, 1.2))
        s += P("M-9 8 Q-12 22 -7 32 Q-5 40 0 40 Q5 40 7 32 Q12 22 9 8 Z", fur)
        s += E(0, 37, 5.5, 3.6, "#8E6E66", 1.2)
        s += mirror(L("M5 34 Q11 36 11 27", BONE, 2.2))
        s += mirror(C(5, 20, 1.2, dark, 0.5))
    elif kind == "wolf":
        s += mirror(P("M3 12 L10 2 L9 17 Z", "#5E6063", 1.2))
        s += P("M-7 10 Q-9 24 -3 36 Q0 40 3 36 Q9 24 7 10 Z", fur)
        s += E(0, 31, 3.6, 6.5, "#BBBDBF", 0.8)
        s += C(0, 37, 2.2, dark, 0.8)
        s += P("M-3 38 L-2 41 L-1 38 M1 38 L2 41 L3 38", "none", 0.9)
    elif kind == "ram":
        s += mirror(L("M7 10 C23 3 27 22 18 24 C12 25 12 18 16 18", BONE, 4.6))
        s += P("M-7 12 Q-8 26 -3 36 H3 Q8 26 7 12 Z", fur)
        s += mirror(E(8, 15, 4.5, 2.2, fur, 1.0, rot=15))
        s += C(0, 35, 2.4, dark, 0.8)
    elif kind == "bear":
        s += mirror(C(9, 13, 4.8, fur, 1.4))
        s += C(0, 22, 11.5, fur)
        s += E(0, 32, 5.5, 5, "#8B6B52", 1.2)
        s += C(0, 34, 2.1, dark, 0.8)
        s += mirror(C(5, 18, 1.2, "#e8d9a0", 0.4))
    else:  # drake
        s += mirror(L("M7 10 Q23 14 31 3", BONE, 4.2))
        s += mirror(L("M5 20 Q16 26 25 21", BONE, 3.0))
        s += P("M-9 8 Q-13 24 -7 44 Q0 54 7 44 Q13 24 9 8 Z", fur)
        s += P("M0 10 V44", "none", 1.2, op=0.55)
        s += mirror(P("M5 16 L9 18 L5 21 Z", "#E0B84A", 0.6))
        s += mirror(C(2.5, 50, 1.2, dark, 0.5))
    return s


def plinth(x, y, kind):
    s = R(x, y, 50, 50, "#6B5A4C", 2)
    s += R(x + 5, y + 5, 40, 40, "#CFE2E0", 1.2)
    if kind == "sword":
        s += L(f"M{x+11} {y+39} L{x+38} {y+12}", "#C9CED2", 3.2)
        s += L(f"M{x+12} {y+30} L{x+20} {y+38}", "#B58F40", 2.4)
        s += C(x + 9, y + 41, 2.6, "#B58F40", 1)
    else:  # axe
        s += L(f"M{x+11} {y+40} L{x+34} {y+14}", "#8A6A4E", 3.0)
        s += P(f"M{x+26} {y+10} Q{x+42} {y+12} {x+40} {y+28} Q{x+34} {y+22} {x+30} {y+24} Z", "#C9CED2", 1.5)
    s += P(f"M{x+8} {y+22} L{x+22} {y+8} M{x+8} {y+31} L{x+31} {y+8}", "none", 1.6, op=0.55, stroke="#FFFFFF")
    return s


def bearskin(cx, cy):
    body = (f"M{cx} {cy-80} C{cx+24} {cy-82} {cx+44} {cy-74} {cx+50} {cy-60} L{cx+84} {cy-74} "
            f"C{cx+96} {cy-78} {cx+104} {cy-66} {cx+96} {cy-54} L{cx+80} {cy-36} "
            f"C{cx+90} {cy-14} {cx+90} {cy+12} {cx+80} {cy+34} L{cx+96} {cy+56} "
            f"C{cx+104} {cy+68} {cx+92} {cy+80} {cx+80} {cy+74} L{cx+50} {cy+56} "
            f"C{cx+40} {cy+72} {cx+20} {cy+80} {cx} {cy+80} C{cx-20} {cy+80} {cx-40} {cy+72} {cx-50} {cy+56} "
            f"L{cx-80} {cy+74} C{cx-92} {cy+80} {cx-104} {cy+68} {cx-96} {cy+56} L{cx-80} {cy+34} "
            f"C{cx-90} {cy+12} {cx-90} {cy-14} {cx-80} {cy-36} L{cx-96} {cy-54} "
            f"C{cx-104} {cy-66} {cx-96} {cy-78} {cx-84} {cy-74} L{cx-50} {cy-60} "
            f"C{cx-44} {cy-74} {cx-24} {cy-82} {cx} {cy-80} Z")
    s = P(body, "#6E4A33", 2.2)
    rnd = random.Random(7)
    fur = ""
    for _ in range(46):
        px = cx + rnd.uniform(-58, 58)
        py = cy + rnd.uniform(-52, 68)
        if (px - cx) ** 2 / 62 ** 2 + (py - cy - 8) ** 2 / 70 ** 2 < 1:
            fur += f"M{px:.0f} {py:.0f} q3 6 0 12 "
    s += P(fur, "none", 1.1, op=0.4)
    for (px, py, sg) in [(-86, -66, -1), (86, -66, 1), (-90, 66, -1), (90, 66, 1)]:
        for k in (-8, 0, 8):
            s += P(f"M{cx+px+k*sg*0.4:.0f} {cy+py-8 if py<0 else cy+py+8:.0f} l{k*0.3:.0f} {-5 if py<0 else 5}", "none", 1.2, op=0.8)
    # head
    s += C(cx - 25, cy - 108, 10, "#6E4A33", 1.8) + C(cx + 25, cy - 108, 10, "#6E4A33", 1.8)
    s += C(cx - 25, cy - 108, 4.5, "#4C3223", 1) + C(cx + 25, cy - 108, 4.5, "#4C3223", 1)
    s += E(cx, cy - 92, 33, 30, "#7B5538", 2)
    s += E(cx, cy - 78, 14, 16, "#A07E5E", 1.6)
    s += E(cx, cy - 70, 6, 4.5, "#1b1512", 1)
    s += P(f"M{cx} {cy-66} V{cy-60} M{cx-6} {cy-58} Q{cx} {cy-55} {cx+6} {cy-58}", "none", 1.2)
    s += C(cx - 15, cy - 98, 2.6, "#e8d9a0", 0.9) + C(cx + 15, cy - 98, 2.6, "#e8d9a0", 0.9)
    return s


def floor_skull(cx, cy, k=1.0):
    s = mirror(L("M-30 -14 C-62 -26 -68 10 -52 28", BONE, 6.5))
    s += P("M-30 -26 Q-34 -48 0 -48 Q34 -48 30 -26 Q34 -6 22 8 L-22 8 Q-34 -6 -30 -26 Z", BONE, 2)
    s += P("M-16 4 L-13 40 Q0 48 13 40 L16 4 Z", BONE, 2)
    s += mirror(E(14, -20, 7.5, 9, "#2a2420", 1.4))
    s += mirror(E(5, 38, 2.6, 3.8, "#2a2420", 0.8))
    for i in range(4):
        y = 12 + i * 8
        s += mirror(P(f"M13 {y} l5 3 l-5 3 Z", "#F7EEDA", 0.9))
    s += P("M0 -48 L-3 -35 L2 -26 L-2 -14", "none", 1.0, op=0.6)
    s += mirror(P("M24 -30 Q14 -37 6 -30", "none", 1.4))
    return T(cx, cy, s, s=k)


def bone(x1, y1, x2, y2, w=5):
    s = L(f"M{x1} {y1} L{x2} {y2}", BONE, w)
    s += C(x1, y1, w * 0.75, BONE, 1.2) + C(x2, y2, w * 0.75, BONE, 1.2)
    return s


def trophy_room():
    b = room_shell(("#9B7A62", "plankHatch"), "#6A5040", "logHatch")
    # --- mounted heads along the wall band (top wall, left wall)
    for x, k in [(78, "stag"), (138, "boar"), (198, "wolf"), (256, "drake"), (330, "ram"), (386, "bear"), (442, "stag")]:
        b += T(x, 28, mounted_head(k), s=1.2)
    for y, k in [(112, "wolf"), (160, "ram"), (208, "boar")]:
        b += T(28, y, mounted_head(k), rot=-90, s=1.2)
    # --- bearskin rug with head, centre of the room
    b += bearskin(256, 262)
    # --- two weapon plinths under display glass
    b += plinth(94, 92, "sword") + plinth(94, 164, "axe")
    # --- giant monster skull on the floor
    b += floor_skull(96, 304, 0.88)
    # --- hide stretched on a frame
    b += R(366, 96, 68, 130, "#745846", 2)
    b += P("M378 112 Q392 106 408 110 Q424 108 424 124 L420 140 Q426 160 420 180 Q424 200 418 214 Q400 220 386 214 Q376 200 380 180 Q374 160 380 140 Q372 124 378 112 Z", "#C79A68", 1.6)
    b += E(396, 134, 7, 5, "#8E6A44", 0.6, rot=20) + E(406, 168, 8, 6, "#8E6A44", 0.6, rot=-20) + E(392, 196, 6, 4, "#8E6A44", 0.6)
    b += P("M380 124 H371 M380 150 H371 M380 176 H371 M382 200 H371 M420 126 H430 M421 152 H430 M421 176 H430 M418 204 H430 M392 108 V99 M408 108 V99 M394 216 V224 M410 216 V224", "none", 1.1)
    # --- trophy shelf on the right wall
    b += R(444, 104, 40, 200, "#745846", 2)
    b += P("M444 144 H484 M444 184 H484 M444 224 H484 M444 264 H484", "none", 1.4)
    b += C(464, 124, 9, BONE, 1.4) + C(460, 122, 2, "#2a2420", 0.5) + C(468, 122, 2, "#2a2420", 0.5) + P("M459 130 H469", "none", 1.2)
    b += L("M452 172 Q468 150 479 168", BONE, 4.4)
    b += L("M455 212 Q462 196 468 210 M463 214 Q471 200 476 212", BONE, 3)
    b += L("M451 246 Q458 232 466 244 M458 238 Q462 228 470 232", "#B58F40", 2.4) + L("M468 248 Q474 238 480 244", "#B58F40", 2.4)
    b += P("M452 276 Q464 298 478 278 L474 276 Q464 288 456 275 Z", BONE, 1.4)
    # --- bone pile
    for a in [(380, 322, 420, 304), (384, 304, 428, 322), (392, 336, 430, 340), (378, 340, 410, 318), (400, 296, 414, 336)]:
        b += bone(*a)
    b += C(404, 318, 8, BONE, 1.4) + C(401, 316, 1.7, "#2a2420", 0.4) + C(407, 316, 1.7, "#2a2420", 0.4)
    # --- leather armchair
    chair = (R(-8, 2, 12, 44, "#6B3A2B", 1.8, 6) + R(50, 2, 12, 44, "#6B3A2B", 1.8, 6) +
             P("M-8 30 Q-8 62 27 62 Q62 62 62 30 L50 30 Q50 50 27 50 Q4 50 4 30 Z", "#6B3A2B", 1.8) +
             R(4, 2, 46, 40, "#8B4B35", 1.6, 6) +
             C(17, 14, 2.2, "#C9A24E", 0.8) + C(37, 14, 2.2, "#C9A24E", 0.8) + C(17, 30, 2.2, "#C9A24E", 0.8) + C(37, 30, 2.2, "#C9A24E", 0.8))
    b += T(386, 398, chair)
    # --- little side table with goblet and candle
    b += round_table(340, 440, 17) + C(333, 436, 4.8, "#D8B24E", 1) + C(333, 436, 2.4, "#8a2f2a", 0.5)
    b += C(348, 445, 3.2, "#F1E6C8", 0.9) + C(348, 445, 1.5, "#E08A33", 0.4)
    # --- spear and banner rack
    b += R(40, 438, 150, 38, "#745846", 2)
    b += R(44, 436, 6, 42, "#5B4434", 1.4) + R(180, 436, 6, 42, "#5B4434", 1.4)
    for yy in (447, 456):
        b += L(f"M48 {yy} H182", "#B58F6B", 3)
        b += P(f"M178 {yy-5} L198 {yy} L178 {yy+5} Z", "#C9CED2", 1.3)
    b += L("M46 467 H186", "#B58F6B", 3)
    b += P("M62 461 H132 L124 468 L132 475 H62 Z", "#9C3F3A", 1.5) + P("M68 468 H116", "none", 1.8, stroke="#D8B24E")
    # --- tusk display stand, left wall
    b += R(40, 232, 64, 22, "#5B4434", 1.8, 3)
    b += L("M46 246 Q58 214 100 238", BONE, 6) + L("M46 250 Q84 226 102 246", BONE_D, 5)
    b += C(48, 244, 4.5, "#B58F40", 1.2)
    # --- wolf pelt by the armchair
    pelt = P("M250 432 C262 420 296 422 308 434 L326 424 C334 430 330 442 322 446 L312 450 C314 460 322 468 320 476 C312 480 304 472 296 468 C286 472 270 472 262 468 C254 474 244 480 238 474 C238 466 246 458 250 452 L236 446 C232 438 240 430 250 432 Z", "#8B8E91", 1.8)
    pelt += P("M258 438 q3 6 0 10 M272 434 q3 6 0 10 M286 436 q3 6 0 10 M270 456 q3 6 0 10 M288 454 q3 6 0 10", "none", 1.0, op=0.45)
    pelt += P("M326 424 L336 414 L338 428 Z", "#8B8E91", 1.4) + C(332, 432, 1.6, "#2a2420", 0.4)
    pelt += L("M236 474 Q226 482 220 476", "#8B8E91", 5)
    b += T(-122, -68, pelt)
    return b


specs["room-trophy-room"] = {
    "title": "Trophy room",
    "desc": "A lodge trophy room: mounted heads, bearskin rug, giant skull, weapon plinths and a hide frame.",
    "body": trophy_room(), "shadow": "",
}


# ============================================================================
# VAULT
# ============================================================================
IRON, IRON_D, IRON_L = "#5D636A", "#3C4147", "#7A828A"
GOLD, SILVER = "#E0B84A", "#C9CED2"


def chain(d):
    return P(d, "none", 5.4) + P(d, "none", 3, stroke="#A9AFB4", dash="4 2.2")


def iron_chest(x, y, w=60, h=34, wood="#6B4F3A", ch=True):
    s = R(x, y, w, h, wood, 2, 3)
    s += R(x + 3, y + 3, w - 6, h - 6, "#7B5C43", 1.0, 2)
    for bx in (x + 8, x + w - 13):  # iron bands
        s += R(bx, y - 1, 5, h + 2, IRON, 1.4)
    s += P(f"M{x+3} {y+h*0.5:.0f} H{x+w-3}", "none", 1.0, op=0.45)
    for cx, cy in ((x + 4, y + 4), (x + w - 4, y + 4), (x + 4, y + h - 4), (x + w - 4, y + h - 4)):
        s += C(cx, cy, 1.6, IRON_L, 0.7)
    s += R(x + w / 2 - 6, y + h / 2 - 5, 12, 10, "#C9A24E", 1.2, 2) + C(x + w / 2, y + h / 2, 1.5, "#2a2420", 0.5)
    if ch:
        s += chain(f"M{x-3} {y+6} Q{x+w/2} {y+h+4} {x+w+3} {y+6}")
    return s


def strongbox(x, y, w=40, h=30):
    s = R(x, y, w, h, IRON, 2, 2)
    s += R(x + 4, y + 4, w - 8, h - 8, IRON_L, 1.0, 1)
    s += P(f"M{x+4} {y+h/2:.0f} H{x+w-4}", "none", 1.0, op=0.5)
    s += C(x + w / 2, y + h / 2, 3.6, "#C9A24E", 1.1) + C(x + w / 2, y + h / 2, 1.1, "#2a2420", 0.4)
    for cx, cy in ((x + 5, y + 5), (x + w - 5, y + 5), (x + 5, y + h - 5), (x + w - 5, y + h - 5)):
        s += C(cx, cy, 1.4, IRON_D, 0.6)
    return s


def lantern(cx, cy):
    s = C(cx, cy, 20, "#F2D77A", 0, op=0.28, stroke="none")
    s += C(cx, cy, 9, IRON, 1.7) + C(cx, cy, 5.2, "#F2D77A", 1.0) + C(cx, cy, 2, "#E08A33", 0.5)
    s += P(f"M{cx-9} {cy} H{cx+9} M{cx} {cy-9} V{cy+9}", "none", 1.0, op=0.7)
    return s


def coin_stack(cx, cy, col=GOLD, n=3):
    s = ""
    for i in range(n):
        s += C(cx + i * 1.5, cy - i * 1.5, 5.6, col, 1.2)
    s += C(cx + (n - 1) * 1.5, cy - (n - 1) * 1.5, 2.8, "none", 0.7, op=0.6)
    return s


def coin_sack(cx, cy, r=15):
    s = P(f"M{cx-r} {cy+4} C{cx-r-3} {cy-r} {cx+r+3} {cy-r} {cx+r} {cy+4} C{cx+r-2} {cy+r+2} {cx-r+2} {cy+r+2} {cx-r} {cy+4} Z", "#B79A6A", 1.8)
    s += P(f"M{cx-5} {cy-7} Q{cx} {cy-14} {cx+5} {cy-7}", "none", 1.4)
    s += C(cx, cy - 3, 3.2, "none", 1.4) + star(cx, cy + 5, 4.5, GOLD, 0.6)
    return s


def vault_walls():
    s = ""
    for (x, y, w, h) in [(28, 28, 456, 12), (28, 40, 12, 432), (472, 40, 12, 432), (28, 472, 188, 12), (296, 472, 188, 12)]:
        s += R(x, y, w, h, "#55524E", 2)
        s += R(x, y, w, h, "url(#stoneHatch)", 0, op=1)
    for i in range(30, 484, 38):
        s += P(f"M{i} 28 V40", "none", 1.0, op=0.5)
    for j in range(46, 472, 36):
        s += P(f"M28 {j} H40 M472 {j} H484", "none", 1.0, op=0.5)
    return s


def vault():
    b = room_shell(("#6E6C68", "flagHatch"), "#4E4C49", "stoneHatch") + vault_walls()
    # --- round iron door-frame inlay and riveted jambs at the entrance
    b += P("M212 512 A44 44 0 0 1 300 512", "none", 11) + P("M212 512 A44 44 0 0 1 300 512", "none", 6.4, stroke=IRON)
    for a in range(200, 345, 18):
        x, y = ring_pt(256, 512, 44, a)
        b += C(f"{x:.1f}", f"{y:.1f}", 1.6, IRON_L, 0.6)
    for jx in (204, 296):
        b += R(jx, 474, 12, 38, IRON_D, 1.6)
        b += C(jx + 6, 482, 1.6, IRON_L, 0.5) + C(jx + 6, 492, 1.6, IRON_L, 0.5) + C(jx + 6, 502, 1.6, IRON_L, 0.5)
    # --- deposit cubbies along the top wall
    b += R(48, 44, 416, 44, IRON_D, 2)
    for i in range(8):
        for r in range(2):
            x, y = 52 + i * 51, 48 + r * 20
            b += R(x, y, 45, 17, IRON, 1.2)
            b += R(x + 4, y + 5, 9, 7, "#C9A24E", 0.8) + C(x + 33, y + 8.5, 2.2, "#2a2420", 0.5) + P(f"M{x+19} {y+8} H{x+27}", "none", 1.0, op=0.7)
    # --- deposit cubbies down the right wall
    b += R(426, 98, 44, 200, IRON_D, 2)
    for c in range(2):
        for r in range(5):
            x, y = 430 + c * 20, 102 + r * 39
            b += R(x, y, 17, 35, IRON, 1.2) + R(x + 3, y + 4, 11, 6, "#C9A24E", 0.8) + C(x + 8.5, y + 24, 2, "#2a2420", 0.5)
    # --- iron-banded chests in rows (left column) with strongboxes beside
    for y in (104, 148, 192):
        b += iron_chest(48, y)
    for y in (104, 140, 176):
        b += strongbox(120, y)
    b += chain("M108 122 Q114 135 120 120") + chain("M108 166 Q114 182 120 158")
    # --- right-hand chest row
    for y in (110, 154):
        b += iron_chest(352, y)
    b += strongbox(352, 202) + strongbox(396, 202, 22, 30)
    for y in (300, 342, 384):
        b += iron_chest(352, y)
    # --- floor safe hatch with wheel lock
    b += R(56, 272, 68, 68, IRON_D, 2) + R(62, 278, 56, 56, IRON, 1.6)
    for cx, cy in ((66, 282), (114, 282), (66, 330), (114, 330)):
        b += C(cx, cy, 2, IRON_L, 0.7)
    b += R(52, 290, 8, 12, IRON_L, 1.2) + R(52, 312, 8, 12, IRON_L, 1.2)  # hinges
    b += C(90, 306, 19, IRON_L, 2)
    for a in range(0, 360, 60):
        x, y = ring_pt(90, 306, 17, a)
        b += P(f"M90 306 L{x:.1f} {y:.1f}", "none", 2.0)
        x2, y2 = ring_pt(90, 306, 21, a)
        b += C(f"{x2:.1f}", f"{y2:.1f}", 2.6, "#B58F40", 1.0)
    b += C(90, 306, 5, "#B58F40", 1.4)
    # --- counting table with coin stacks, scale, ledger
    b += R(192, 140, 128, 66, "#7B5C43", 2)
    b += R(196, 144, 120, 58, "none", 0.9, op=0.5)
    b += P("M192 160 H320 M192 176 H320 M192 192 H320", "none", 0.8, op=0.25)
    for i, (cx, cy, col, n) in enumerate([(210, 158, GOLD, 4), (224, 160, GOLD, 3), (210, 175, SILVER, 3), (224, 177, SILVER, 4), (238, 160, GOLD, 2)]):
        b += coin_stack(cx, cy, col, n)
    # balance scale
    b += P("M262 172 H306", "none", 2.4) + C(284, 172, 3.2, "#B58F40", 1.2)
    b += C(264, 172, 10, "#C9A24E", 1.4) + C(304, 172, 10, "#C9A24E", 1.4) + C(264, 172, 4, GOLD, 0.8) + C(304, 172, 3, "#8A8F94", 0.8)
    b += P("M284 160 V184", "none", 1.6)
    # ledger and quill
    b += P("M262 190 H292 V204 H262 Z", "#E6D9B5", 1.4) + P("M277 190 V204", "none", 1.0)
    b += L("M296 202 Q308 192 312 184", "#F1E6C8", 1.6) + C(296, 202, 1.2, INK, 0.4)
    b += coin_stack(246, 192, GOLD, 2)
    # --- guard stool + lamp on table side
    b += stool(256, 240, 12, "#8F6F52") + C(256, 240, 6, "#6B4F3A", 1.0)
    b += lantern(176, 112)
    b += lantern(334, 112)
    # --- key board
    b += R(142, 232, 54, 14, "#745846", 1.6)
    for i in range(4):
        x = 150 + i * 11
        b += C(x, 239, 2.8, "none", 1.4) + P(f"M{x} 242 V247 M{x} 245 H{x+3}", "none", 1.2)
    # --- coin sacks (lower left), gold ingots (lower right)
    b += coin_sack(66, 420) + coin_sack(98, 438, 13) + coin_sack(70, 456, 12)
    ingot = lambda x, y, w=26, h=12: P(f"M{x+4} {y} H{x+w-4} L{x+w} {y+h} H{x} Z", GOLD, 1.4) + P(f"M{x+8} {y+4} H{x+w-8}", "none", 1.0, op=0.6, stroke="#FFF2B3")
    b += ingot(372, 452) + ingot(400, 452) + ingot(386, 438, 26) + ingot(414, 438) + ingot(400, 424)
    # --- lanterns by the door
    b += lantern(170, 432) + lantern(338, 432)
    # --- iron drain grate in the floor
    b += C(250, 330, 20, IRON_D, 2) + C(250, 330, 15, "#26211f", 1.2)
    b += P("M238 322 H262 M236 330 H264 M238 338 H262 M244 316 V344 M250 315 V345 M256 316 V344", "none", 1.6, stroke=IRON_L)
    # --- heavy locked strongbox against the left, lower
    b += iron_chest(48, 344, 60, 34) + strongbox(120, 350)
    return b


specs["room-vault"] = {
    "title": "Vault",
    "desc": "A dark-stone strongroom: iron-banded chests with chains, deposit cubbies, counting table, floor safe and round iron door frame.",
    "body": vault(), "shadow": "",
}


# ============================================================================
# WIZARD TOWER
# ============================================================================
RUNE = "#D8B85A"
GLYPHS = [
    "M-3 -5 V5 M-3 0 L3 -4", "M-4 4 L0 -5 L4 4 M-3 1 H3", "M0 -5 V5 M-4 -2 L4 2", "M-4 -4 H4 L-4 4 H4",
    "M-4 0 L0 -5 L4 0 L0 5 Z", "M-3 -5 L3 5 M3 -5 L-3 5", "M-4 5 V-5 L4 5 V-5", "M0 -5 C6 -5 6 5 0 5 C-6 5 -6 -5 0 -5 M0 -1 V1",
]


def poly_pts(cx, cy, r, n, a0=-90):
    return [ring_pt(cx, cy, r, a0 + i * 360 / n) for i in range(n)]


def rune_circle(cx, cy):
    s = C(cx, cy, 112, "#4A5470", 2.4)
    s += C(cx, cy, 84, "#363E58", 1.8)
    s += C(cx, cy, 108, "none", 1.6, stroke=RUNE, op=0.9) + C(cx, cy, 89, "none", 1.6, stroke=RUNE, op=0.9)
    s += C(cx, cy, 54, "none", 1.6, stroke=RUNE, op=0.9)
    for i in range(16):
        a = i * 22.5 + 11.25
        x, y = ring_pt(cx, cy, 98.5, a)
        s += f'    <g transform="translate({x:.1f} {y:.1f}) rotate({a+90:.1f})">{P(GLYPHS[i % 8], "none", 1.5, stroke=RUNE)}    </g>\n'
    for k in range(2):  # hexagram from two triangles
        pts = poly_pts(cx, cy, 80, 3, -90 + k * 60)
        s += P("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z", "none", 1.8, stroke=RUNE)
    for i in range(6):
        x, y = ring_pt(cx, cy, 80, -90 + i * 60)
        s += C(f"{x:.1f}", f"{y:.1f}", 3.2, "#7FD3E0", 1.0)
    s += C(cx, cy, 44, "#2A3048", 1.6)
    # crystal pedestal
    s += C(cx, cy, 36, "#7FD3E0", 0, op=0.25, stroke="none")
    oct = poly_pts(cx, cy, 26, 8, -67.5)
    s += P("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in oct) + " Z", "#8A93A6", 2)
    hexa = poly_pts(cx, cy, 16, 6, -90)
    s += P("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in hexa) + " Z", "#7FD3E0", 1.8)
    for x, y in hexa[::2]:
        s += P(f"M{cx} {cy} L{x:.1f} {y:.1f}", "none", 1.2)
    s += P(f"M{cx-6} {cy-6} L{cx} {cy-11}", "none", 1.6, stroke="#FFFFFF", op=0.8)
    return s


def curved_shelf(cx, cy, r0, r1, a0, a1):
    """Bookshelf bent around the tower wall; books are radial wedges."""
    def pt(r, a):
        x, y = ring_pt(cx, cy, r, a)
        return f"{x:.1f} {y:.1f}"
    s = P(f"M{pt(r1,a0)} A{r1} {r1} 0 0 1 {pt(r1,a1)} L{pt(r0,a1)} A{r0} {r0} 0 0 0 {pt(r0,a0)} Z", "#5B4434", 2)
    cols = ["#9C3F3A", "#4F6B65", "#C9A24E", "#6C5B8C", "#8F6F52", "#3F5F8C"]
    n = int((a1 - a0) / 3.2)
    rnd = random.Random(3)
    for i in range(n):
        aa, bb = a0 + 1.2 + i * 3.2, a0 + 1.2 + i * 3.2 + 2.8
        ri = r0 + 2.5 + rnd.uniform(0, 1.5)
        ro = r1 - 2 - rnd.uniform(0, 3)
        s += P(f"M{pt(ri,aa)} L{pt(ro,aa)} L{pt(ro,bb)} L{pt(ri,bb)} Z", cols[i % 6], 0.9)
    return s


def desk(x, y, rot):
    d = R(-44, -22, 88, 44, "#7B5C43", 2) + R(-40, -18, 80, 36, "none", 0.9, op=0.4)
    d += L("M-36 -12 H-14", "#E6D9B5", 5) + L("M-36 -4 H-18", "#E6D9B5", 4.5) + C(-14, -12, 2.6, "#C9B98E", 0.8)
    d += P("M-4 -4 H8 V14 H-4 Z", "#E6D9B5", 1.4) + P("M8 -4 H20 V14 H8 Z", "#F1E6C8", 1.4) + P("M-2 2 H6 M-2 6 H6 M10 2 H18 M10 6 H18", "none", 0.8, op=0.6)
    d += C(26, -10, 5.5, "#2a3140", 1.4) + L("M26 -10 L38 -20", "#F1E6C8", 1.8)
    d += C(30, 10, 8, BONE, 1.4) + C(27, 8, 1.9, "#2a2420", 0.4) + C(33, 8, 1.9, "#2a2420", 0.4) + P("M27 15 H33", "none", 1.0)
    d += C(-36, 12, 4.4, "#F1E6C8", 1.2) + C(-36, 12, 1.8, "#E08A33", 0.4)
    d += P("M-26 8 H-12 V16 H-26 Z", "#F1E6C8", 1.0)
    d += stool(0, 38, 11, "#8F6F52")
    return T(x, y, d, rot=rot)


def alch_table(x, y, rot):
    d = R(-46, -24, 92, 48, "#7B5C43", 2) + R(-42, -20, 84, 40, "none", 0.9, op=0.4)
    flasks = [(-34, -10, "#9C3F7A"), (-22, 8, "#5FAE5A"), (-6, -10, "#4F8FD0"), (6, 8, "#E0B84A")]
    for fx, fy, col in flasks:
        d += C(fx, fy, 7, col, 1.5) + C(fx, fy, 3, "#F1E6C8", 1.0)
    d += C(-12, 8, 4.5, "#C9CED2", 1.3) + C(-12, 8, 2, "#7a5b40", 0.8)  # mortar
    d += C(8, -4, 3.5, "#6FB7E8", 0.9)  # burner flame
    # orrery
    d += C(28, 0, 17, "none", 1.6, stroke="#B58F40") + E(28, 0, 17, 7, "none", 1.4, rot=30) + E(28, 0, 11, 11, "none", 1.2)
    d += C(28, 0, 4, "#E0B84A", 1.2) + C(41, 2, 2.6, "#4F8FD0", 0.9) + C(19, -7, 2.2, "#C0503F", 0.9) + C(33, -13, 1.8, "#C9CED2", 0.8)
    d += stool(0, -38, 11, "#8F6F52")
    return T(x, y, d, rot=rot)


def telescope(x, y):
    s = ""
    for a in (-90, 30, 150):
        lx, ly = ring_pt(0, 0, 26, a)
        s += L(f"M0 0 L{lx:.1f} {ly:.1f}", "#8A6A4E", 2.4)
    s += C(0, 0, 5.5, "#B58F40", 1.4)
    tube = R(-66, -5.5, 70, 11, "#B58F40", 1.8, 2) + R(-66, -7.5, 7, 15, "#8a6a2a", 1.5, 1) + R(2, -3.5, 12, 7, "#6B5A4C", 1.4)
    tube += P("M-48 -5.5 V5.5 M-28 -5.5 V5.5 M-10 -5.5 V5.5", "none", 1.1, op=0.7) + C(-62, 0, 3, "#9FD8E0", 0.8)
    s += T(0, 0, tube, rot=-33)
    return T(x, y, s)


def cauldron(x, y):
    s = C(0, 0, 33, "#E08A33", 0, op=0.28, stroke="none")
    for a in (60, 180, 300):
        fx, fy = ring_pt(0, 0, 25, a)
        s += C(f"{fx:.1f}", f"{fy:.1f}", 5, "#2B2F36", 1.4)
    s += C(0, 0, 26, "#2B2F36", 2.2) + C(0, 0, 21, "#4B515C", 1.2) + C(0, 0, 18, "#62B85A", 1.2)
    s += C(-6, -4, 4, "#A7E19B", 0.9) + C(7, 3, 3, "#A7E19B", 0.9) + C(1, 9, 2.2, "#A7E19B", 0.8) + C(8, -9, 2, "#A7E19B", 0.8)
    s += P("M-26 0 Q0 -42 26 0", "none", 1.6, op=0.85)
    s += L("M2 0 L26 -22", "#8A6A4E", 2.6)
    return T(x, y, s)


def cat_cushion(x, y):
    s = R(-30, -28, 60, 56, "#6C5B8C", 2, 22) + R(-24, -22, 48, 44, "none", 1.2, 18, op=0.5)
    for tx, ty in ((-30, -28), (30, -28), (-30, 28), (30, 28)):
        s += C(tx, ty, 3.4, "#D8B24E", 1.1)
    s += C(0, 0, 2, "#D8B24E", 0.8)
    s += L("M12 12 C26 14 30 -6 14 -16", "#B87A48", 5.5)  # tail
    s += E(3, 3, 19, 13, "#C98A55", 1.8, rot=20)  # body
    s += P("M-8 -2 Q-4 4 -8 10 M0 -4 Q4 2 0 9 M8 0 Q12 6 8 12", "none", 1.3, op=0.55)
    s += C(-15, -5, 9.5, "#C98A55", 1.8)  # head
    s += P("M-23 -10 L-21 -19 L-14 -13 Z M-12 -13 L-9 -20 L-5 -11 Z", "#C98A55", 1.3)
    s += P("M-19 -6 Q-17 -4 -15 -6 M-12 -7 Q-10 -5 -8 -7", "none", 1.0) + C(-14, -1, 1.2, "#8a4a3a", 0.4)
    s += E(-4, 14, 5, 3, "#F1E6C8", 1.2)
    return T(x, y, s)


def float_book(x, y, rot, cover):
    s = P("M-16 -9 Q-8 -13 0 -9 Q8 -13 16 -9 V12 Q8 8 0 12 Q-8 8 -16 12 Z", "#1c2236", 0, op=0.28, stroke="none")
    s = T(7, 13, s)
    b = P("M-17 -11 H17 V13 H-17 Z", cover, 1.6)
    b += P("M-14 -9 Q-7 -12 0 -8 V10 Q-7 6 -14 9 Z", "#F1E6C8", 1.2) + P("M14 -9 Q7 -12 0 -8 V10 Q7 6 14 9 Z", "#E9DCB8", 1.2)
    b += P("M-11 -4 H-4 M-11 0 H-4 M-11 4 H-4 M4 -4 H11 M4 0 H11 M4 4 H11", "none", 0.7, op=0.5)
    return T(x, y, s + b, rot=rot)


def wizard_tower():
    b = room_shell(("#66718A", "flagHatch"), "#4B5366", "stoneHatch")
    # --- curved stone wall corners make the room read as round
    for d in ("M28 28 H256 A228 228 0 0 0 28 256 Z", "M484 28 H256 A228 228 0 0 1 484 256 Z",
              "M28 484 V256 A228 228 0 0 0 216 480.5 V484 Z", "M484 484 V256 A228 228 0 0 1 296 480.5 V484 Z"):
        b += P(d, "#4B5366", 2.6) + P(d, "url(#stoneHatch)", 0, stroke="none")
    b += C(256, 256, 218, "none", 1.0, op=0.3, stroke="#9AA6C0")
    # --- the great rune circle with crystal pedestal
    b += rune_circle(256, 232)
    # --- curved bookshelf along the left wall
    b += curved_shelf(256, 256, 206, 226, 148, 212)
    # --- cluttered desk and alchemical table
    b += desk(150, 126, -38)
    b += alch_table(364, 126, 38)
    # --- telescope, cauldron, cat
    b += telescope(436, 298)
    b += cauldron(120, 376)
    b += cat_cushion(392, 380)
    # --- floating books and sparks
    b += float_book(188, 296, -20, "#9C3F3A") + float_book(326, 292, 24, "#3F5F8C") + float_book(256, 116, 8, "#6C5B8C")
    for (sx, sy, sr, col) in [(204, 270, 4.5, "#F2D77A"), (172, 318, 3.2, "#7FD3E0"), (344, 270, 3.8, "#F2D77A"), (350, 318, 3, "#7FD3E0"),
                              (232, 92, 3.6, "#F2D77A"), (284, 100, 3.0, "#7FD3E0"), (216, 128, 2.4, "#F2D77A"), (298, 136, 2.8, "#F2D77A"),
                              (206, 310, 2.4, "#F2D77A"), (306, 312, 2.4, "#F2D77A")]:
        b += star(sx, sy, sr * 1.7, col)
    return b


specs["room-wizard-tower"] = {
    "title": "Wizard tower",
    "desc": "A round arcane study: inlaid rune circle with crystal pedestal, desk, alchemy table with orrery, telescope, cauldron, floating books and a cat.",
    "body": wizard_tower(), "shadow": "",
}


# ============================================================================
# HALL (the House's common room)
# ============================================================================
CREAM, CLAY = "#E6D9B5", "#B8744A"
FLAME, FLAME_L = "#E08A33", "#F2C14E"


def flame(cx, cy, s=1.0):
    d = (f"M{cx-8*s:.1f} {cy+10*s:.1f} C{cx-14*s:.1f} {cy+2*s:.1f} {cx-3*s:.1f} {cy-4*s:.1f} {cx:.1f} {cy-14*s:.1f} "
         f"C{cx+4*s:.1f} {cy-4*s:.1f} {cx+14*s:.1f} {cy+2*s:.1f} {cx+8*s:.1f} {cy+10*s:.1f} Z")
    return P(d, FLAME, 1.2) + P(f"M{cx-4*s:.1f} {cy+10*s:.1f} C{cx-6*s:.1f} {cy+4*s:.1f} {cx:.1f} {cy+2*s:.1f} {cx:.1f} {cy-4*s:.1f} C{cx+3*s:.1f} {cy+2*s:.1f} {cx+6*s:.1f} {cy+5*s:.1f} {cx+4*s:.1f} {cy+10*s:.1f} Z", FLAME_L, 0.8)


def plate(cx, cy, r=9, col=CREAM):
    return C(cx, cy, r, col, 1.3) + C(cx, cy, r * 0.62, "none", 0.8, op=0.5)


def jug(cx, cy):
    return C(cx, cy, 7, "#9C6A4A", 1.4) + C(cx, cy, 3.4, "#3a2a22", 0.9) + C(cx + 8, cy, 3, "none", 1.4)


def herb_bundle(x, y, col, col2):
    s = P(f"M{x} {y-3} V{y+2}", "none", 1.0)
    s += E(x - 4, y + 9, 3, 8.5, col, 1.0, rot=22) + E(x + 4, y + 9, 3, 8.5, col2, 1.0, rot=-22) + E(x, y + 10, 3, 9.5, col, 1.0)
    s += C(x, y + 2, 2.2, "#B58F6B", 0.9)
    return s


def hall():
    b = room_shell(FLOOR_WOOD, "#745846", "logHatch")
    # --- braided rug under the table
    for rx, ry, col in [(120, 82, "#8E3F3A"), (110, 72, CREAM), (101, 64, "#4F6B65"), (88, 52, "#C9A24E"), (76, 42, "#8E3F3A"), (62, 30, "#6C8F7E")]:
        b += E(268, 198, rx, ry, col, 1.2)
    # --- big stone hearth with cooking pot (top left)
    b += R(40, 28, 138, 58, STONE, 2.2) + R(40, 28, 138, 58, "url(#stoneHatch)", 0, op=1)
    b += R(58, 36, 102, 46, "#26211f", 1.8)
    b += L("M70 76 H146", "#6B4F3A", 7) + L("M78 68 L138 80", "#7B5C43", 6)
    b += flame(80, 62, 1.1) + flame(140, 62, 1.1) + flame(110, 70, 0.8)
    b += L("M58 42 L108 58", "#4D4B47", 2.6)
    b += C(110, 58, 15, "#2B2F36", 2) + C(110, 58, 11, "#7A5236", 1.0) + C(104, 54, 2.2, "#B99466", 0.6) + C(116, 62, 1.8, "#B99466", 0.6)
    b += P("M95 58 Q110 38 125 58", "none", 1.6)
    b += R(48, 86, 122, 14, "#A8A59B", 2) + R(48, 86, 122, 14, "url(#stoneHatch)", 0, op=1)  # hearthstone apron
    # --- firewood stack
    for i in range(4):
        b += R(184, 32 + i * 10, 32, 9, "#8A6A4E", 1.3, 4) + C(188, 36.5 + i * 10, 2, "none", 0.7, op=0.6)
    # --- kitchen shelf with crockery
    b += R(226, 30, 246, 28, "#745846", 2)
    for i in range(5):
        b += plate(246 + i * 26, 44, 9)
    b += C(378, 44, 7, CLAY, 1.4) + C(378, 44, 3.6, "#7A4A2C", 0.8) + C(395, 44, 7, CLAY, 1.4) + C(395, 44, 3.6, "#7A4A2C", 0.8)
    b += jug(417, 44) + jug(441, 44) + C(459, 40, 3.6, CREAM, 1.0) + C(459, 51, 3.6, CREAM, 1.0)
    # --- herb rail with hanging bundles
    b += R(300, 64, 172, 5, "#5B4434", 1.4)
    for i, (c1, c2) in enumerate([("#6FA05A", "#8DBB6A"), ("#7B5B8C", "#9A7BAA"), ("#6FA05A", "#C9A24E"), ("#B8442F", "#B8442F"), ("#8DBB6A", "#6FA05A"), ("#7B5B8C", "#6FA05A"), ("#C9A24E", "#8DBB6A")]):
        b += herb_bundle(314 + i * 24, 70, c1, c2)
    # --- trestle table with benches and supper
    b += R(214, 168, 112, 50, "#876A56", 2) + P("M214 185 H326 M214 201 H326", "none", 0.8, op=0.3)
    b += R(216, 146, 106, 17, "#9F7D68", 1.7) + R(216, 224, 106, 17, "#9F7D68", 1.7)
    b += P("M232 146 V163 M262 146 V163 M296 224 V241 M252 224 V241", "none", 0.9, op=0.35)
    b += stool(204, 193, 9) + stool(336, 193, 9)
    b += plate(238, 180, 7) + plate(238, 206, 7) + plate(300, 180, 7) + plate(300, 206, 7)
    b += E(270, 192, 12, 7, "#C79A5A", 1.4) + P("M262 192 H278 M266 188 L270 196 M272 188 L276 196", "none", 0.8, op=0.5)
    b += jug(290, 192) + C(256, 176, 3, CREAM, 1.0) + C(256, 176, 1.2, FLAME, 0.4)
    b += C(250, 210, 4.5, CLAY, 1.2) + L("M310 214 L322 208", "#C9CED2", 1.6)
    # --- rocking chair by the fire
    rk = E(-24, 0, 4.5, 30, "#745846", 1.6) + E(24, 0, 4.5, 30, "#745846", 1.6)
    rk += R(-20, -18, 40, 36, "#8F6F52", 1.8, 4) + R(-16, -14, 32, 28, "#9C3F3A", 1.3, 6)
    rk += R(-21, 18, 42, 8, "#745846", 1.6, 2) + P("M-12 18 V26 M-4 18 V26 M4 18 V26 M12 18 V26", "none", 1.0)
    rk += R(-23, -16, 5, 28, "#745846", 1.2)+ R(18, -16, 5, 28, "#745846", 1.2)
    b += T(98, 150, rk)
    # --- storage chest on the left wall
    b += R(38, 226, 38, 60, "#8F6F52", 2, 3) + P("M57 226 V286", "none", 1.4)
    b += R(38, 238, 38, 5, IRON, 1.0) + R(38, 268, 38, 5, IRON, 1.0)
    b += R(53, 252, 8, 8, "#D7C39A", 1.1)
    # --- cradle
    cr = R(-18, -26, 36, 52, "#876A56", 2, 8) + R(-13, -10, 26, 33, "#6C8F7E", 1.3, 5)
    cr += P("M-13 -4 H13 M-13 4 H13 M-13 12 H13", "none", 0.8, op=0.4)
    cr += P("M-18 -26 Q0 -40 18 -26 V-14 Q0 -22 -18 -14 Z", "#745846", 1.6)
    cr += E(-24, 0, 3.5, 28, "#745846", 1.4) + E(24, 0, 3.5, 28, "#745846", 1.4)
    b += T(176, 296, cr)
    # --- spinning wheel with seat and wool basket
    b += R(106, 330, 54, 20, "#876A56", 1.8) + L("M160 340 L184 340", "#8A6A4E", 2.4) + C(184, 340, 3, "#E6D9B5", 1)
    b += C(82, 340, 27, "none", 2.4) + C(82, 340, 27, "none", 1.0, op=0.2)
    b += C(82, 340, 22, "none", 1.4) + C(82, 340, 5, "#745846", 1.5)
    for a in range(0, 360, 45):
        x, y = ring_pt(82, 340, 22, a)
        b += P(f"M82 340 L{x:.1f} {y:.1f}", "none", 1.3)
    b += C(116, 340, 3.4, "#E6D9B5", 1.0) + L("M82 340 L116 340", "#8A6A4E", 1.6, op=0.8)
    b += stool(132, 384, 10)
    b += C(60, 400, 17, "#B79A6A", 2) + C(60, 400, 13, "#8F7550", 1.0)
    for (wx, wy, col) in [(55, 396, CREAM), (65, 402, "#9C3F3A"), (58, 406, "#6C8F7E")]:
        b += C(wx, wy, 5, col, 1.0)
    # --- bed with patchwork quilt
    b += R(410, 300, 66, 116, "#876A56", 2) + R(406, 294, 74, 12, "#745846", 1.8) + R(406, 412, 74, 8, "#745846", 1.6)
    b += R(414, 312, 28, 18, CREAM, 1.5, 6) + R(444, 312, 28, 18, CREAM, 1.5, 6)
    pal = ["#9C3F3A", "#C9A24E", "#4F6B65", "#6C5B8C", "#B8744A", "#6C8F7E", "#D8C9A0"]
    k = 0
    for r in range(4):
        for c in range(3):
            b += R(414 + c * 19.3, 336 + r * 19.2, 19.3, 19.2, pal[(k * 3 + r) % 7], 0.9)
            k += 1
    b += P("M414 334 H472", "none", 1.6)
    b += chest(414, 440, 56, 28)
    # --- ladder to the loft, barrel, side table
    b += L("M455 150 V282 M478 150 V282", "#8A6A4E", 3.2) + P("".join(f"M455 {160+i*15} H478 " for i in range(9)), "none", 2.2)
    b += barrel_top(432, 122, 16) + barrel_top(412, 150, 12)
    b += round_table(352, 296, 18) + C(352, 296, 8, "#5B99A6", 1.2) + C(352, 296, 8, "none", 1.0)
    # --- sleeping hound on a rag mat
    b += E(118, 232, 26, 19, "#6C8F7E", 1.4)
    dog = E(0, 0, 15, 9, "#B88B5A", 1.6, rot=15) + C(-14, -3, 6.2, "#B88B5A", 1.5) + E(-18, -8, 2.6, 4.4, "#7A5636", 1.0, rot=-30) + L("M12 5 Q20 8 18 -1", "#B88B5A", 3.4)
    b += T(118, 232, dog)
    # --- laundry tub and a broom in the corner
    b += E(106, 446, 24, 17, "#876A56", 2) + E(106, 446, 19, 12, "#5B99A6", 1.2) + E(102, 444, 8, 4, CREAM, 1.0, rot=-15)
    b += L("M44 464 L40 424", "#8A6A4E", 2.6) + P("M34 462 H54 L56 478 H32 Z", "#D4B76A", 1.4) + P("M38 466 V477 M44 466 V477 M50 466 V477", "none", 0.8, op=0.5)
    # --- boots, water bucket by the door
    b += E(176, 428, 6, 11, "#5B4434", 1.5, rot=15) + E(190, 428, 6, 11, "#5B4434", 1.5, rot=-10)
    b += C(176, 462, 13, "#876A56", 1.9) + C(176, 462, 10, "#5B99A6", 1.2) + C(172, 459, 1.8, "#A3C9CC", 0.5)
    b += P("M163 462 Q176 444 189 462", "none", 1.6)
    return b


specs["room-hall"] = {
    "title": "Hall (House common room)",
    "desc": "The heart of a cob cabin: stone hearth with cooking pot, trestle table, patchwork bed, kitchen shelf, spinning wheel and rocking chair.",
    "body": hall(), "shadow": "",
}


# ============================================================================
# GREAT HALL (the Castle's inner keep)
# ============================================================================

def goblet(cx, cy):
    return C(cx, cy, 3.8, "#D8B24E", 1.1) + C(cx, cy, 1.8, "#7A2F2F", 0.5)


def banner_strip(x, y, col, rot=0):
    s = P("M0 0 H18 V26 L9 19 L0 26 Z", col, 1.5) + P("M2 4 H16", "none", 1.4, stroke="#D8B24E") + C(9, 11, 3, "#D8B24E", 0.9)
    return T(x, y, s, rot=rot)


def brazier(cx, cy):
    s = C(cx, cy, 18, "#F2D77A", 0, op=0.26, stroke="none")
    s += C(cx, cy, 11, "#4D4B47", 1.8) + C(cx, cy, 8, "#2a1a14", 0.8)
    s += flame(cx, cy + 1, 0.8)
    s += P(f"M{cx-11} {cy} H{cx-15} M{cx+11} {cy} H{cx+15} M{cx} {cy-11} V{cy-15} M{cx} {cy+11} V{cy+15}", "none", 2.0)
    return s


def great_hall():
    b = room_shell(FLOOR_FLAG, "#6F6D68", "stoneHatch")
    # --- banners as strips along the wall band
    for x, col in [(40, "#9C3F3A"), (66, "#3F5F8C"), (428, "#3F5F8C"), (454, "#9C3F3A")]:
        b += banner_strip(x, 1, col)
    for y, col in [(60, "#9C3F3A"), (110, "#3F5F8C"), (310, "#9C3F3A"), (440, "#3F5F8C")]:
        b += banner_strip(2, y + 18, col, rot=-90)  # left wall strips
    for y, col in [(60, "#3F5F8C"), (370, "#9C3F3A"), (430, "#3F5F8C")]:
        b += banner_strip(510, y, col, rot=90)
    # --- raised dais with high table and high seat
    b += R(96, 28, 320, 76, "#9F7D68", 2) + R(96, 28, 320, 76, "url(#plankHatch)", 0)
    b += R(96, 96, 320, 10, "#745846", 2) + P("M96 92 H416", "none", 1.0, op=0.4)
    b += R(150, 66, 212, 24, "#876A56", 2) + R(154, 70, 204, 16, "none", 0.9, op=0.4)
    for gx in range(168, 350, 22):
        b += goblet(gx, 78 + (4 if (gx // 22) % 2 else -4))
    b += plate(256, 78, 8) + E(208, 78, 11, 6, "#C79A5A", 1.3) + E(304, 78, 11, 6, "#C79A5A", 1.3)
    for cx, sz in [(190, 0.7), (322, 0.7)]:
        c = R(-14, -4, 28, 28, "#7B4B3A", 1.6, 4) + R(-12, -8, 24, 8, "#5B3A2B", 1.5, 2) + R(-8, 2, 16, 16, "#9C3F3A", 1.0, 4)
        b += T(cx, 34, c)
    seat = R(-16, -4, 32, 30, "#6B3A2B", 1.8, 4) + R(-12, 0, 24, 22, "#9C3F3A", 1.2, 5)
    seat += R(-22, 4, 7, 22, "#5B3A2B", 1.6, 3) + R(15, 4, 7, 22, "#5B3A2B", 1.6, 3)
    seat += R(-24, -14, 48, 12, "#5B3A2B", 1.8, 3) + C(-18, -8, 3.2, "#D8B24E", 1.0) + C(18, -8, 3.2, "#D8B24E", 1.0) + C(0, -8, 3.6, "#D8B24E", 1.0)
    b += T(256, 34, seat)
    # --- long rug runner from door to dais
    b += R(232, 106, 48, 402, "#8E3F3A", 1.8) + R(238, 112, 36, 390, "none", 3, op=1, ).replace('fill="none"', 'fill="none" stroke="#D7C39A"')
    for y in (150, 232, 314, 396, 460):
        b += P(f"M256 {y-17} L270 {y} L256 {y+17} L242 {y} Z", "#C9A24E", 1.3) + C(256, y, 3, "#8E3F3A", 0.8)
    b += P("M232 506 h48 M236 506 v4 M244 506 v4 M252 506 v4 M260 506 v4 M268 506 v4 M276 506 v4", "none", 1.0, op=0.6)
    # --- huge hearth with a roasting spit (left wall)
    b += R(28, 146, 84, 150, "#8E8B83", 2.4) + R(28, 146, 84, 150, "url(#stoneHatch)", 0)
    b += R(38, 160, 56, 122, "#26211f", 2)
    b += L("M52 190 L82 170", "#6B4F3A", 8) + L("M52 250 L82 272", "#6B4F3A", 8) + L("M50 220 H84", "#7B5C43", 8)
    b += flame(58, 184, 1.3) + flame(58, 262, 1.3) + flame(66, 223, 1.1)
    b += L("M64 164 V278", "#4D4B47", 2.4) + E(64, 222, 10, 28, "#A86B44", 1.8) + P("M60 200 q4 8 0 14 M68 232 q-4 8 0 14", "none", 1.0, op=0.5, stroke="#F2C58A")
    b += C(64, 164, 3.4, "#B58F40", 1.2) + C(64, 278, 3.4, "#B58F40", 1.2)
    b += R(96, 140, 26, 162, "#A8A59B", 2) + R(96, 140, 26, 162, "url(#stoneHatch)", 0)  # hearthstone slab
    # --- long feasting table with benches and goblets
    b += R(144, 160, 40, 226, "#876A56", 2) + P("M164 160 V386", "none", 0.9, op=0.4)
    b += R(126, 162, 16, 222, "#9F7D68", 1.7) + R(186, 162, 16, 222, "#9F7D68", 1.7)
    b += P("M126 220 H142 M126 290 H142 M126 340 H142 M186 200 H202 M186 270 H202 M186 330 H202", "none", 0.9, op=0.4)
    for i, y in enumerate(range(176, 380, 24)):
        b += goblet(152, y) + goblet(176, y + 12)
    b += E(164, 200, 14, 9, "#C79A5A", 1.4) + E(164, 260, 14, 9, "#C79A5A", 1.4) + E(164, 320, 14, 9, "#C79A5A", 1.4)
    b += P("M156 200 H172 M156 196 L160 204 M164 196 L168 204", "none", 0.8, op=0.5)
    b += C(164, 228, 4, CREAM, 1.0) + C(164, 228, 1.5, FLAME, 0.4) + C(164, 290, 4, CREAM, 1.0) + C(164, 290, 1.5, FLAME, 0.4) + C(164, 352, 4, CREAM, 1.0) + C(164, 352, 1.5, FLAME, 0.4)
    b += plate(164, 176, 6) + plate(164, 374, 6)
    # --- round map table with markers
    b += C(386, 236, 42, "#876A56", 2.2) + C(386, 236, 36, "#D8C9A0", 1.4)
    b += P("M362 222 Q372 208 386 214 Q398 206 408 222 Q414 236 404 246 Q394 260 380 252 Q366 250 362 238 Z", "#8FB07A", 1.1)
    b += P("M392 258 Q404 262 408 252 Q410 262 400 268 Z", "#8FB07A", 1.0)
    b += P("M366 232 Q378 226 384 236 M390 222 Q398 230 404 228", "none", 0.8, op=0.5)
    b += P("M356 236 H416 M386 206 V266", "none", 0.8, op=0.3)
    b += C(374, 224, 3.4, "#9C3F3A", 1.0) + C(396, 232, 3.4, "#3F5F8C", 1.0) + C(384, 246, 3.4, "#9C3F3A", 1.0) + C(402, 214, 3.4, "#C9A24E", 1.0)
    b += P("M372 240 V228 L380 232 L372 236", "#3F5F8C", 0.9)
    b += L("M404 258 L418 270", "#C9CED2", 2.2) + C(402, 256, 2.2, "#745846", 0.8)
    b += stool(330, 282, 10) + stool(386, 296, 10) + stool(340, 188, 10)
    # --- weapon racks (right wall): spears, then round shields
    b += R(448, 108, 32, 118, "#745846", 2)
    for i, x in enumerate((455, 462, 469, 476)):
        b += L(f"M{x} 218 V116", "#B58F6B", 2.0, ink=False) + P(f"M{x-3} 118 L{x} 106 L{x+3} 118 Z", "#C9CED2", 1.0)
    b += P("M448 150 H480 M448 190 H480", "none", 1.6)
    b += R(448, 242, 32, 120, "#745846", 2)
    for y, col in [(260, "#9C3F3A"), (302, "#3F5F8C"), (344, "#C9A24E")]:
        b += C(464, y, 13, col, 1.6) + C(464, y, 4.5, "#C9CED2", 1.2) + C(464, y, 9.5, "none", 0.8, op=0.6)
    # --- ale barrels and a sideboard
    b += barrel_top(452, 396, 15) + barrel_top(428, 418, 13) + barrel_top(456, 438, 14)
    b += R(330, 446, 84, 28, "#745846", 2) + R(334, 450, 76, 20, "none", 0.9, op=0.4)
    b += C(346, 460, 7, "#A17A5C", 1.3) + C(364, 460, 7, "#A17A5C", 1.3) + goblet(382, 456) + goblet(394, 464) + plate(404, 458, 5)
    # --- armour stands / sleeping hound on the left
    st = E(0, 0, 22, 12, "#7B828A", 1.8) + C(-17, 0, 6, "#6B7078", 1.4) + C(17, 0, 6, "#6B7078", 1.4) + C(0, 0, 8.5, "#A5ACB3", 1.5) + P("M-6 -2 H6 M0 -8 V4", "none", 0.9) + P("M-2 -8 Q0 -20 2 -8", "#9C3F3A", 1.0)
    b += T(56, 360, st, rot=90) + T(56, 408, st, rot=90)
    dog = E(0, 0, 18, 11, "#8F6F52", 1.7, rot=20) + C(-17, -4, 7, "#8F6F52", 1.5) + E(-22, -10, 3, 5, "#6B4F3A", 1.0, rot=-30)
    dog += L("M14 6 Q24 8 22 -2", "#8F6F52", 4) + C(-19, -4, 1, "#2a2420", 0.3)
    b += T(84, 320, dog)
    # --- reading lectern with the war ledger, and a wine cask on its cradle
    b += R(134, 418, 42, 30, "#745846", 2) + P("M155 422 V444", "none", 1.0) + P("M138 424 Q146 421 155 425 V441 Q146 438 138 441 Z", CREAM, 1.2) + P("M172 424 Q164 421 155 425 V441 Q164 438 172 441 Z", "#F1E6C8", 1.2)
    b += C(168, 436, 3, CREAM, 0.9) + C(168, 436, 1.2, FLAME, 0.4)
    b += R(84, 440, 50, 28, "#A17A5C", 2, 8) + P("M96 440 V468 M110 440 V468 M122 440 V468", "none", 2.2, stroke="#4D4B47") + C(87, 454, 4, "#876449", 1.2)
    # --- braziers flanking the aisle
    for (cx, cy) in [(212, 126), (300, 126), (190, 408), (322, 408)]:
        b += brazier(cx, cy)
    return b


specs["room-great-hall"] = {
    "title": "Great hall (Castle keep)",
    "desc": "The keep's hall: raised dais with high seat, long feasting table, huge hearth with spit, map table, weapon racks, banners and a rug runner.",
    "body": great_hall(), "shadow": "",
}
