"""Interior tiles D: stable, tavern, temple, trading post (top-down floor plans)."""
import math
import random

from bastion_lib import *

specs = {}

LEATHER, LEATHER_D = "#8A5A3A", "#5E3B24"
BRASS, GOLD = "#C9A24E", "#E0BF5A"
CLOTH = "#E6D9B5"


# ---- shared helpers --------------------------------------------------------

def blob(cx, cy, rx, ry, seed, j=0.16, n=9):
    """Smooth irregular closed path (Catmull-Rom through jittered points)."""
    r = random.Random(seed)
    pts = [(cx + rx * (1 + r.uniform(-j, j)) * math.cos(2 * math.pi * i / n),
            cy + ry * (1 + r.uniform(-j, j)) * math.sin(2 * math.pi * i / n)) for i in range(n)]
    d = f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return d + " Z"


def strokes(cx, cy, rx, ry, n, seed, col="#8E7430", op=0.8, L=9, w=1.1):
    """Scatter of short straw/rush strokes inside an ellipse."""
    r = random.Random(seed)
    out = []
    for _ in range(n):
        a = r.uniform(0, 6.283)
        rr = math.sqrt(r.random())
        x, y = cx + rx * rr * math.cos(a), cy + ry * rr * math.sin(a)
        t = r.uniform(0, 3.14)
        ln = r.uniform(0.5, 1) * L
        out.append(f"M{x:.0f} {y:.0f} l{ln * math.cos(t):.0f} {ln * math.sin(t):.0f}")
    return f'    <path d="{" ".join(out)}" fill="none" stroke="{col}" stroke-width="{w}" opacity="{op}"/>\n'


def flame(x, y, s=1.0):
    return (f'<path d="M{x} {y-10*s:.1f} C{x+7*s:.1f} {y-3*s:.1f} {x+6*s:.1f} {y+6*s:.1f} {x} {y+8*s:.1f} '
            f'C{x-6*s:.1f} {y+6*s:.1f} {x-7*s:.1f} {y-3*s:.1f} {x} {y-10*s:.1f} Z" fill="#E08A33" stroke-width="1.1"/>'
            f'<path d="M{x} {y-4*s:.1f} C{x+3*s:.1f} {y} {x+3*s:.1f} {y+4*s:.1f} {x} {y+5*s:.1f} '
            f'C{x-3*s:.1f} {y+4*s:.1f} {x-3*s:.1f} {y} {x} {y-4*s:.1f} Z" fill="#F2D060" stroke="none"/>\n')


def mug(x, y, beer="#D9A93F"):
    return (f'    <path d="M{x+4} {y-2} q6 0 6 4 q0 4 -6 4" fill="none" stroke-width="1.5"/>'
            f'<circle cx="{x}" cy="{y}" r="5.5" fill="#B9B2A2" stroke-width="1.4"/>'
            f'<circle cx="{x}" cy="{y}" r="3.6" fill="{beer}" stroke-width="0.8"/>'
            f'<circle cx="{x-1}" cy="{y-1}" r="1.6" fill="#F4EBCB" stroke="none"/>\n')


def coil(cx, cy, r, col="#B79A62"):
    """Top-down coil of rope: concentric rings."""
    out = f'    <circle cx="{cx}" cy="{cy}" r="{r}" fill="{col}" stroke-width="1.6"/>\n'
    k = r - 3.5
    while k > 2:
        out += f'    <circle cx="{cx}" cy="{cy}" r="{k:.1f}" fill="none" stroke="#6E5A32" stroke-width="1.3" opacity="0.8"/>\n'
        k -= 3.2
    return out


def rrect(x, y, w, h, fill, sw=1.6, r=3, extra=""):
    return f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke-width="{sw}" {extra}/>\n'


def circ(cx, cy, r, fill, sw=1.6, extra=""):
    return f'    <circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke-width="{sw}" {extra}/>\n'


def sack(cx, cy, rx, ry, seed, fill="#CDB98A"):
    """Tied grain sack: lumpy body with a knotted neck."""
    return (f'    <path d="{blob(cx, cy, rx, ry, seed, 0.10, 8)}" fill="{fill}" stroke-width="1.7"/>\n'
            f'    <path d="M{cx-rx*0.5:.0f} {cy-ry*0.2:.0f} Q{cx} {cy+ry*0.35:.0f} {cx+rx*0.5:.0f} {cy-ry*0.2:.0f}" fill="none" stroke-width="1" opacity="0.5"/>\n'
            f'    <path d="M{cx-4} {cy-ry+1:.0f} q4 -7 8 0 q-4 5 -8 0 Z" fill="{fill}" stroke-width="1.3"/>\n'
            f'    <path d="M{cx-5} {cy-ry+3:.0f} h10" fill="none" stroke="#6E5A32" stroke-width="1.6"/>\n')


def animal(cx, cy, rot=0, s=0.78, coat="#9A5B34", dark="#4A2C1A", ears=7, muzzle="#3A2A22", pack=False):
    """Horse/mule seen from above, head toward -y in local space (length ~163)."""
    w1, w2 = 1.7 / s, 1.2 / s
    o = f'''
    <g transform="translate({cx} {cy}) rotate({rot}) scale({s})" stroke-width="{w1:.2f}">
      <!-- legs peeking out from under the barrel -->
      <g fill="{dark}" stroke-width="{w2:.2f}">
        <ellipse cx="-22" cy="-22" rx="5" ry="9"/><ellipse cx="22" cy="-22" rx="5" ry="9"/>
        <ellipse cx="-23" cy="32" rx="5" ry="9"/><ellipse cx="23" cy="32" rx="5" ry="9"/>
      </g>
      <!-- tail -->
      <path d="M-3 50 C-9 64 5 72 -3 92 C9 82 13 66 6 50 Z" fill="{dark}"/>
      <!-- barrel and croup -->
      <path d="M-16 -32 C-25 -20 -24 20 -22 40 C-18 57 18 57 22 40 C24 20 25 -20 16 -32 Z" fill="{coat}"/>
      <path d="M0 -30 V50" fill="none" stroke-width="1" opacity="0.28"/>
      <path d="M-15 28 Q0 38 15 28" fill="none" stroke-width="1" opacity="0.3"/>
'''
    if pack:
        o += f'''      <!-- pack saddle, blanket and strapped panniers -->
      <path d="M-22 -10 H22 V24 H-22 Z" fill="#B0553F" stroke-width="{w2:.2f}"/>
      <path d="M-22 -2 H22 M-22 6 H22 M-22 14 H22" fill="none" stroke="#E6D9B5" stroke-width="{1.4/s:.2f}" opacity="0.8"/>
      <ellipse cx="-29" cy="7" rx="11" ry="17" fill="#CDB98A"/><ellipse cx="29" cy="7" rx="11" ry="17" fill="#B8A173"/>
      <path d="M-22 -3 V17 M22 -3 V17" fill="none" stroke="{LEATHER_D}" stroke-width="{2.4/s:.2f}"/>
'''
    o += f'''      <!-- neck, mane, head -->
      <path d="M-14 -30 C-12 -42 -11 -52 -9 -58 H9 C11 -52 12 -42 14 -30 Z" fill="{coat}"/>
      <path d="M-8 -58 H8 V-54 H-8 Z" fill="none" stroke-width="{w2:.2f}" opacity="0"/>
      <path d="M-9 -58 C-12 -68 -8 -82 0 -84 C8 -82 12 -68 9 -58 Z" fill="{coat}"/>
      <ellipse cx="0" cy="-79" rx="5.5" ry="4.5" fill="{muzzle}" stroke-width="{w2:.2f}"/>
      <path d="M-2 -80 v2 M2 -80 v2" fill="none" stroke="#000" stroke-width="{1/s:.2f}" opacity="0.7"/>
      <path d="M-7 -67 l2.5 1 M7 -67 l-2.5 1" fill="none" stroke-width="{1.5/s:.2f}"/>
      <ellipse cx="-6" cy="-62" rx="2.8" ry="{ears}" fill="{coat}" stroke-width="{w2:.2f}"/>
      <ellipse cx="6" cy="-62" rx="2.8" ry="{ears}" fill="{coat}" stroke-width="{w2:.2f}"/>
      <path d="M-2 -54 L-6 -48 L-1 -43 L-6 -38 L-1 -33 L-5 -28 L5 -28 L1 -33 L6 -38 L1 -43 L6 -48 L2 -54 Z" fill="{dark}" stroke-width="{w2:.2f}"/>
    </g>
'''
    return o


def lying_horse(cx, cy, s=0.62, coat="#5A3A26", dark="#241710"):
    """A horse lying down with legs folded, head turned to rest on the straw."""
    w1, w2 = 1.7 / s, 1.2 / s
    return f'''
    <g transform="translate({cx} {cy}) scale({s})" stroke-width="{w1:.2f}">
      <!-- folded legs -->
      <g fill="{dark}" stroke-width="{w2:.2f}">
        <ellipse cx="-24" cy="21" rx="14" ry="6"/><ellipse cx="2" cy="24" rx="14" ry="6"/>
        <ellipse cx="26" cy="18" rx="13" ry="6"/><ellipse cx="-30" cy="-23" rx="12" ry="5"/>
      </g>
      <!-- tail curled along the flank -->
      <path d="M40 -2 C58 -8 64 6 52 18 C60 6 52 2 42 6 Z" fill="{dark}"/>
      <!-- body -->
      <ellipse cx="0" cy="0" rx="43" ry="22" fill="{coat}"/>
      <path d="M-30 -2 Q0 -12 36 -2" fill="none" stroke-width="1" opacity="0.3"/>
      <!-- neck curving round to the head -->
      <path d="M-34 -14 C-52 -22 -64 -22 -70 -10 L-66 8 C-56 2 -46 8 -34 12 Z" fill="{coat}"/>
      <path d="M-34 -16 C-50 -26 -62 -26 -68 -14" fill="none" stroke="{dark}" stroke-width="{5/s:.2f}"/>
      <ellipse cx="-80" cy="-2" rx="16" ry="8.5" transform="rotate(-18 -80 -2)" fill="{coat}"/>
      <ellipse cx="-93" cy="-6" rx="5" ry="4.2" fill="#3A2A22" stroke-width="{w2:.2f}"/>
      <ellipse cx="-68" cy="-8" rx="2.6" ry="6" transform="rotate(-20 -68 -8)" fill="{coat}" stroke-width="{w2:.2f}"/>
      <path d="M-82 -6 l3 1.5" fill="none" stroke-width="{1.5/s:.2f}"/>
    </g>
'''


# =============================================================================
# STABLE: four stalls, tack, hay, trough, tethered horse
# =============================================================================

def stable():
    o = room_shell(FLOOR_DIRT, "#745846", "logHatch")
    # --- straw bedding across the floor and droppings
    o += strokes(256, 240, 210, 120, 60, 11, "#8E7430", 0.55, 10)
    for i, (px, py) in enumerate([(210, 262), (232, 300), (290, 250), (330, 380), (180, 380)]):
        o += f'    <path d="{blob(px, py, 4.5, 3.5, 200+i, 0.2, 6)}" fill="#6A5238" stroke-width="1"/>\n'

    # --- stall bedding patches, mangers, buckets
    for k in range(4):
        x0 = 28 + k * 114
        o += f'    <path d="{blob(x0+57, 124, 48, 76, 30+k, 0.12, 10)}" fill="#D4B76A" stroke="none" opacity="0.85"/>\n'
        o += strokes(x0 + 57, 124, 46, 74, 65, 40 + k, "#8E7430", 0.8, 11)
    # --- horses first (under the rails)
    o += animal(85, 126, 0, 0.88, "#A5612F", "#4A2412")                    # chestnut
    o += animal(199, 126, 0, 0.88, "#C9C2B2", "#6B655A", muzzle="#8D8478")  # grey
    o += lying_horse(322, 128, 0.6, "#7A4B2E")                                        # bay lying down
    # --- empty stall 4: heaped hay and a bucket
    o += f'    <path d="{blob(428, 138, 38, 30, 77, 0.2, 10)}" fill="#D9BC64" stroke-width="1.8"/>\n'
    o += strokes(428, 138, 34, 26, 40, 78, "#8E7430", 0.9, 12)
    o += circ(464, 192, 9, "#8F6F52", 1.8) + circ(464, 192, 6, WATER_D, 1) + circ(464, 192, 2.5, "url(#waterHatch)", 0)

    # --- mangers along the top wall of every stall
    for k in range(4):
        x0 = 28 + k * 114
        o += (f'    <path d="M{x0+20} 30 H{x0+94} V48 H{x0+20} Z" fill="{WOOD_D}" stroke-width="1.9"/>\n'
              f'    <path d="M{x0+25} 34 H{x0+89} V44 H{x0+25} Z" fill="#D4B76A" stroke-width="1.1"/>\n'
              f'    <path d="M{x0+30} 36 l6 4 M{x0+44} 35 l5 5 M{x0+60} 37 l6 3 M{x0+76} 35 l6 5" fill="none" stroke="#8E7430" stroke-width="1"/>\n')
    # --- dividing rails with posts (low timber rails seen from above)
    for x in (142, 256, 370):
        o += (f'    <path d="M{x-3} 38 H{x+3} V210 H{x-3} Z" fill="{WOOD_M}" stroke-width="1.8"/>\n'
              f'    <path d="M{x} 40 V208" fill="none" stroke-width="0.8" opacity="0.5"/>\n')
        for py in (40, 126, 210):
            o += circ(x, py, 5.5, WOOD_D, 1.7)
    # --- front rails with a gate opening per stall
    for k in range(4):
        x0 = 28 + k * 114
        for xa, xb in ((x0 + 4, x0 + 26), (x0 + 88, x0 + 110)):
            o += (f'    <path d="M{xa} 211 H{xb} V217 H{xa} Z" fill="{WOOD_M}" stroke-width="1.7"/>\n')
        o += circ(x0 + 26, 214, 4, WOOD_D, 1.4) + circ(x0 + 88, 214, 4, WOOD_D, 1.4)
    # gate of stall 4 swung wide open into the aisle
    o += (f'    <path d="M458 216 L482 262 L476 265 L452 219 Z" fill="{WOOD_M}" stroke-width="1.7"/>\n'
          f'    <path d="M464 225 L470 256" fill="none" stroke-width="1.1" opacity="0.7"/>\n')

    # --- saddle rack with three saddles, blankets and bridles (left)
    o += '    <g transform="translate(0 20)">\n'
    o += f'    <path d="M44 236 H168 V244 H44 Z" fill="{WOOD_D}" stroke-width="1.9"/>\n'
    for sx, bc in ((66, "#9C3F3A"), (106, "#4F6B65"), (146, "#C9A24E")):
        o += (f'    <path d="M{sx-13} 232 Q{sx} 224 {sx+13} 232 V250 Q{sx} 258 {sx-13} 250 Z" fill="{bc}" stroke-width="1.6"/>\n'
              f'    <path d="M{sx-9} 227 C{sx-17} 222 {sx-17} 258 {sx-9} 253 Q{sx} 258 {sx+9} 253 C{sx+17} 258 {sx+17} 222 {sx+9} 227 Q{sx} 222 {sx-9} 227 Z" fill="{LEATHER}" stroke-width="1.7"/>\n'
              f'    <path d="M{sx-5} 234 Q{sx} 230 {sx+5} 234 V248 Q{sx} 252 {sx-5} 248 Z" fill="#A9754A" stroke-width="1.1"/>\n'
              f'    <path d="M{sx-2} 223 V230 M{sx+5} 253 q3 6 0 10" fill="none" stroke-width="1.3"/>\n')
    o += circ(52, 240, 3.5, "#4D4B47", 1.2) + circ(160, 240, 3.5, "#4D4B47", 1.2)
    # bridles hung on pegs below the rack
    for bx in (60, 90, 122, 152):
        o += (f'    <circle cx="{bx}" cy="272" r="7" fill="none" stroke="{LEATHER_D}" stroke-width="2.2"/>\n'
              f'    <path d="M{bx} 279 v8 M{bx-3} 287 h6" fill="none" stroke="#7F7C74" stroke-width="2"/>\n'
              f'    <circle cx="{bx}" cy="266" r="2.2" fill="#C9A24E" stroke-width="0.9"/>\n')

    o += '    </g>\n'
    # --- hay bales stacked (left, below)
    for bx, by in ((40, 336), (94, 338), (66, 364)):
        o += (f'    <path d="M{bx} {by} H{bx+50} V{by+28} H{bx} Z" fill="#D4B76A" stroke-width="1.9"/>\n'
              f'    <path d="M{bx+14} {by} V{by+28} M{bx+36} {by} V{by+28}" fill="none" stroke="#6E5A32" stroke-width="1.8"/>\n')
        o += strokes(bx + 25, by + 14, 22, 11, 14, bx + by, "#8E7430", 0.9, 8)

    # --- pitchfork lying on the floor
    o += ('    <g transform="translate(212 372) rotate(-38)" stroke-width="1.6">\n'
          f'      <path d="M-62 0 H34" fill="none" stroke="{WOOD_D}" stroke-width="5"/>\n'
          '      <path d="M-62 0 H34" fill="none" stroke="#BD9D86" stroke-width="2"/>\n'
          '      <path d="M34 -9 V9 M34 -9 L58 -9 M34 0 L60 0 M34 9 L58 9" fill="none" stroke="#7F7C74" stroke-width="2.6"/>\n'
          '      <path d="M34 -9 V9" fill="none" stroke="#4D4B47" stroke-width="3"/>\n'
          '    </g>\n')
    # --- feed bin with open lid and oats, plus scoop
    o += (f'    <path d="M318 340 H388 V386 H318 Z" fill="{WOOD_M}" stroke-width="2"/>\n'
          f'    <path d="M324 346 H382 V380 H324 Z" fill="#C7A25A" stroke-width="1.4"/>\n'
          f'    <path d="M{324} 358 Q340 350 352 358 T382 356" fill="none" stroke="#8E7430" stroke-width="1.1"/>\n'
          f'    <path d="M318 340 L388 340 L384 318 L322 318 Z" fill="{WOOD_D}" stroke-width="1.7"/>\n'
          f'    <path d="M330 326 H376" fill="none" stroke-width="1" opacity="0.6"/>\n'
          f'    <path d="M396 364 H416 L422 356 H402 Z" fill="#9C9A92" stroke-width="1.4"/>\n'
          f'    <path d="M418 358 L440 346" fill="none" stroke="{WOOD_D}" stroke-width="3"/>\n')
    o += strokes(353, 366, 24, 10, 14, 5, "#8E7430", 0.9, 5)
    # --- spilled grain and a second hay pile by the door side
    o += f'    <path d="{blob(262, 366, 34, 22, 9, 0.2, 9)}" fill="#D9BC64" stroke-width="1.7"/>\n'
    o += strokes(262, 366, 32, 20, 34, 10, "#8E7430", 0.9, 11)

    # --- water trough along the right wall with a bucket
    o += '    <g transform="translate(0 12)">\n'
    o += (f'    <path d="M446 232 H480 V344 H446 Z" fill="{WOOD_D}" stroke-width="2.1"/>\n'
          f'    <path d="M452 238 H474 V338 H452 Z" fill="{WATER}" stroke-width="1.4"/>\n'
          f'    <path d="M452 238 H474 V338 H452 Z" fill="url(#waterHatch)" stroke="none"/>\n'
          f'    <path d="M456 250 q8 -4 14 0 M456 296 q8 -4 14 0" fill="none" stroke="#C9E4E6" stroke-width="1.1"/>\n')
    o += circ(428, 352, 10, "#8F6F52", 1.9) + circ(428, 352, 6.5, WATER_D, 1.1) + f'    <path d="M418 352 Q428 340 438 352" fill="none" stroke-width="1.4"/>\n'

    o += '    </g>\n'
    # --- tethered horse at the hitching ring, head toward the trough
    o += animal(358, 292, 90, 0.88, "#7C5330", "#2E1C10", muzzle="#4A3626")
    o += (f'    <path d="M462 366 m-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0" fill="{WOOD_M}" stroke-width="1.9"/>\n'
          f'    <circle cx="462" cy="366" r="4.5" fill="none" stroke="#4D4B47" stroke-width="2.6"/>\n'
          f'    <path d="M458 364 C440 346 436 330 434 296" fill="none" stroke="{LEATHER_D}" stroke-width="2.6"/>\n'
          f'    <path d="M458 364 C440 346 436 330 434 296" fill="none" stroke="#C7A25A" stroke-width="0.9"/>\n')
    # second ring on a post by the stalls
    o += circ(36, 300, 6, WOOD_M, 1.6) + circ(36, 300, 3, "none", 2.2, 'stroke="#4D4B47"')
    # a heap of horse feed sacks in the lower right corner
    o += sack(452, 424, 17, 14, 71) + sack(430, 448, 15, 13, 72, "#B8A173") + sack(462, 457, 15, 12, 73)
    # grooming brush and hoof pick on the floor
    o += (f'    <path d="M184 270 H202 V280 H184 Z" fill="{WOOD_M}" stroke-width="1.6"/>\n'
          f'    <path d="M186 272 V278 M189 272 V278 M192 272 V278 M195 272 V278 M198 272 V278" fill="none" stroke="#3A2A22" stroke-width="1.1"/>\n')
    return o


specs["room-stable"] = {"title": "Stable",
                        "desc": "Top-down stable floor plan: four stalls with horses, hay, trough, tack rack, hitching ring.",
                        "body": stable(), "shadow": ""}


# =============================================================================
# TAVERN
# =============================================================================

def keg_side(x, y, w, h):
    """Keg lying on a rack seen from above: bulging staves, hoops, front spigot."""
    b = h * 0.12
    return (f'    <path d="M{x} {y+b:.1f} Q{x+w/2} {y-b:.1f} {x+w} {y+b:.1f} V{y+h-b:.1f} Q{x+w/2} {y+h+b:.1f} {x} {y+h-b:.1f} Z" fill="#A17A5C" stroke-width="1.7"/>\n'
            f'    <path d="M{x+w*0.22:.0f} {y} V{y+h} M{x+w*0.78:.0f} {y} V{y+h}" fill="none" stroke="#4D4B47" stroke-width="1.6"/>\n'
            f'    <path d="M{x+w*0.5:.0f} {y+h-1} v5" fill="none" stroke="{BRASS}" stroke-width="2.4"/>\n')


def lute(cx, cy, rot):
    return f'''
    <g transform="translate({cx} {cy}) rotate({rot})" stroke-width="1.6">
      <path d="M-3 -12 H3 V-46 H-3 Z" fill="{WOOD_D}"/>
      <path d="M-5 -46 H5 L6 -56 H-6 Z" fill="{WOOD_D}"/>
      <path d="M0 0 C-17 -4 -19 18 -12 26 C-6 32 6 32 12 26 C19 18 17 -4 0 0 Z" fill="#C79A5E"/>
      <circle cx="0" cy="14" r="5.5" fill="#26211f" stroke-width="1.2"/>
      <path d="M-1.5 -8 V24 M1.5 -8 V24" fill="none" stroke-width="0.7"/>
      <path d="M-8 28 H8" fill="none" stroke-width="1.6"/>
    </g>
'''


def drum(cx, cy):
    return (circ(cx, cy, 11, "#8F6F52", 1.8) + circ(cx, cy, 8.5, "#E6D9B5", 1.2) + circ(cx, cy, 8.5, "none", 0.7, 'opacity="0.5"')
            + f'    <path d="M{cx-14} {cy+12} L{cx-6} {cy+6} M{cx-12} {cy+14} L{cx-4} {cy+8}" fill="none" stroke="{WOOD_D}" stroke-width="2.4"/>\n')


def tavern():
    o = room_shell(FLOOR_WOOD, "#745846", "logHatch")
    # --- beer stains and rushes on the planks
    for i, (sx, sy, rx, ry) in enumerate([(236, 262, 26, 18), (150, 300, 18, 12), (330, 168, 22, 14),
                                          (420, 360, 28, 16), (250, 420, 20, 12), (180, 160, 14, 10)]):
        o += f'    <path d="{blob(sx, sy, rx, ry, 300+i, 0.25, 8)}" fill="#5A3E26" stroke="none" opacity="0.2"/>\n'
    o += strokes(256, 300, 190, 150, 70, 3, "#8C8A48", 0.7, 10)
    o += strokes(120, 440, 60, 30, 20, 4, "#8C8A48", 0.7, 9)

    # --- stage corner, top left (raised platform with lute, stool, tip hat)
    o += (f'    <path d="M28 28 H134 V150 H28 Z" fill="#9F7D68" stroke-width="2.4"/>\n'
          '    <path d="M28 52 H134 M28 76 H134 M28 100 H134 M28 124 H134" fill="none" stroke-width="1" opacity="0.35"/>\n'
          '    <path d="M30 148 H134" fill="none" stroke-width="4.5"/>\n'
          f'    <path d="M52 150 H90 V160 H52 Z" fill="{WOOD_M}" stroke-width="1.7"/>\n'
          '    <path d="M52 155 H90" fill="none" stroke-width="0.9" opacity="0.5"/>\n'
          f'    <path d="M40 48 H80 V92 H40 Z" fill="#6D3B3B" stroke-width="1.6" opacity="0.9"/>\n'
          '    <path d="M44 52 H76 V88 H44 Z" fill="none" stroke="#C9A24E" stroke-width="1.8"/>\n')
    o += stool(104, 74, 11) + lute(74, 116, -38) + drum(112, 118)
    # footlight candles and a tip hat
    o += circ(46, 142, 3, "#F2D060", 1.1) + circ(116, 142, 3, "#F2D060", 1.1)
    o += (f'    <ellipse cx="120" cy="171" rx="11" ry="9" fill="#6C5B8C" stroke-width="1.7"/>\n'
          f'    <ellipse cx="120" cy="171" rx="6.5" ry="5.5" fill="#3F3358" stroke-width="1.1"/>\n'
          f'    <circle cx="118" cy="170" r="2" fill="{GOLD}" stroke-width="0.7"/><circle cx="123" cy="172" r="2" fill="{GOLD}" stroke-width="0.7"/>\n')

    # --- bar counter along the top wall, taps, mugs, barrels and bottles behind
    o += (f'    <path d="M150 28 H484 V60 H150 Z" fill="#8C6B52" stroke="none"/>\n'
          '    <path d="M152 30 H482 V58 H152 Z" fill="url(#plankHatch)" stroke="none"/>\n')
    for i in range(6):                                  # kegs on a rack behind the bar
        o += keg_side(160 + i * 53, 34, 44, 24)
    o += (f'    <path d="M150 66 H484 V100 H150 Z" fill="#7A5A42" stroke-width="2.4"/>\n'
          f'    <path d="M156 71 H484 V94 H156 Z" fill="#9F7D68" stroke-width="1.2"/>\n'
          '    <path d="M156 71 H484 V94 H156 Z" fill="url(#plankHatch)" stroke="none" opacity="0.7"/>\n'
          f'    <path d="M150 66 Q138 83 150 100" fill="#7A5A42" stroke-width="2.4"/>\n')
    for tx in (228, 268, 308):                          # beer taps
        o += (f'    <rect x="{tx-3}" y="68" width="6" height="12" rx="2" fill="{BRASS}" stroke-width="1.5"/>\n'
              f'    <path d="M{tx} 80 V90" fill="none" stroke="{BRASS}" stroke-width="2.6"/>\n'
              f'    <circle cx="{tx}" cy="72" r="2.2" fill="#6B2F2F" stroke-width="1"/>\n')
    for mx, my in ((200, 82), (250, 84), (290, 82), (346, 84), (386, 82), (430, 84)):
        o += mug(mx, my)
    for bx in (400, 412, 424, 436, 448):                # bottles lined along the back edge
        o += circ(bx, 62, 3.4, "#3D6B4F", 1.2)
    o += circ(468, 80, 7, "#C9B99A", 1.6) + circ(468, 80, 3.5, "#E6D9B5", 1)   # plate of bread
    # bar stools
    for sx in range(188, 470, 46):
        o += stool(sx, 118, 9)

    # --- hearth on the left wall with a roasting spit
    o += (f'    <path d="M28 196 H92 V302 H28 Z" fill="{STONE}" stroke-width="2.2"/>\n'
          '    <path d="M28 196 H92 V302 H28 Z" fill="url(#stoneHatch)" stroke="none"/>\n'
          '    <path d="M28 208 H74 V290 H28 Z" fill="#26211f" stroke-width="1.7"/>\n')
    for cx, cy in ((40, 220), (60, 224), (46, 270), (62, 268), (38, 250), (66, 246)):
        o += circ(cx, cy, 4, "#D1642B", 0.8)
    o += flame(40, 236, 1.2) + flame(62, 238, 1.2) + flame(48, 272, 1.0)
    o += (f'    <path d="M52 202 V298" fill="none" stroke="#4D4B47" stroke-width="3.2"/>\n'
          f'    <path d="M52 203 V297" fill="none" stroke="#9C9A92" stroke-width="1"/>\n'
          f'    <path d="{blob(52, 250, 12, 30, 90, 0.07, 10)}" fill="#A5612F" stroke-width="1.8"/>\n'
          '    <path d="M46 232 Q52 238 58 232 M46 250 Q52 256 58 250 M46 268 Q52 274 58 268" fill="none" stroke="#6E3B1A" stroke-width="1.2"/>\n'
          '    <path d="M52 296 H66 V306" fill="none" stroke="#4D4B47" stroke-width="3"/>\n'
          '    <circle cx="66" cy="306" r="3.4" fill="#4D4B47" stroke-width="1.1"/>\n')
    o += rug(98, 216, 36, 70, "#6D3B3B")
    # firewood stack and fire irons beside the hearth
    for i in range(3):
        o += f'    <circle cx="{44+i*14}" cy="322" r="6" fill="#A17A5C" stroke-width="1.5"/><circle cx="{44+i*14}" cy="322" r="2.5" fill="none" stroke-width="0.8" opacity="0.6"/>\n'
    o += '    <path d="M38 340 H92" fill="none" stroke="#4D4B47" stroke-width="2.8"/><path d="M84 336 l12 4 l-12 4" fill="none" stroke="#4D4B47" stroke-width="2"/>\n'

    # --- round tables with stools and mugs
    def rtable(cx, cy, r, mugs, d=None, seeds=1):
        d = d or r + 12
        s = round_table(cx, cy, r)
        for a in (0, 90, 180, 270):
            ax = math.radians(a + seeds * 20)
            s = stool(round(cx + d * math.cos(ax)), round(cy + d * math.sin(ax)), 9) + s
        for (dx, dy) in mugs:
            s += mug(cx + dx, cy + dy)
        return s
    o += rtable(196, 256, 28, [(-8, -6), (10, 8), (4, -12)], seeds=0)
    o += rtable(312, 206, 28, [(-10, 4), (8, -8)], seeds=1)
    o += rtable(150, 382, 26, [(-6, 6), (10, -4)], seeds=2)
    o += rtable(402, 424, 28, [(0, -10), (-10, 8), (10, 6)], seeds=0)
    o += (f'    <path d="M{196-9} {256+12} h18 v5 h-18 Z" fill="#C9B99A" stroke-width="1.2"/>\n')  # cheese board slice

    # --- long table with benches, platters, candles
    o += (f'    <path d="M342 280 H476 V294 H342 Z" fill="{WOOD_L}" stroke-width="1.9"/>\n'
          f'    <path d="M342 336 H476 V350 H342 Z" fill="{WOOD_L}" stroke-width="1.9"/>\n'
          f'    <path d="M346 300 H472 V332 H346 Z" fill="#876A56" stroke-width="2.2"/>\n'
          '    <path d="M350 304 H468 V328 H350 Z" fill="none" stroke-width="0.9" opacity="0.5"/>\n'
          '    <path d="M346 316 H472" fill="none" stroke-width="0.8" opacity="0.4"/>\n')
    for px, py, bread in ((366, 311, True), (440, 322, False)):
        o += circ(px, py, 8, "#C9B99A", 1.5)
        o += (f'    <ellipse cx="{px}" cy="{py}" rx="5.5" ry="3.5" fill="#C98A4E" stroke-width="1"/>\n' if bread
              else f'    <circle cx="{px}" cy="{py}" r="4.5" fill="#B8453A" stroke-width="1"/>\n')
    for mx, my in ((392, 308), (404, 322), (420, 310), (454, 308), (388, 324), (462, 324)):
        o += mug(mx, my)
    o += circ(414, 316, 2.8, "#F2D060", 1.2) + circ(414, 316, 5.2, "none", 0.8, 'opacity="0.5"')

    # --- barrel-top table for dice and cards, two stools
    o += stool(396, 166, 9) + stool(448, 166, 9) + barrel_top(422, 168, 18) + mug(414, 166) + mug(430, 172)
    o += (f'    <path d="M418 160 h7 v9 h-7 Z" fill="#F1ECDD" stroke-width="1"/>'
          f'<rect x="420" y="174" width="4" height="4" fill="#F1ECDD" stroke-width="0.8"/><rect x="426" y="172" width="4" height="4" fill="#F1ECDD" stroke-width="0.8"/>\n')
    # --- dart board with an oche line (right wall)
    o += (f'    <circle cx="460" cy="212" r="21" fill="#26211f" stroke-width="2.2"/>\n'
          f'    <circle cx="460" cy="212" r="16" fill="#E6D9B5" stroke-width="1.2"/>\n'
          f'    <circle cx="460" cy="212" r="11" fill="#9C3F3A" stroke-width="1"/>\n'
          f'    <circle cx="460" cy="212" r="7.5" fill="#4F6B65" stroke-width="1"/>\n'
          f'    <circle cx="460" cy="212" r="3.8" fill="#E6D9B5" stroke-width="1"/>\n'
          f'    <circle cx="460" cy="212" r="1.6" fill="#9C3F3A" stroke="none"/>\n'
          '    <path d="M460 191 V233 M439 212 H481 M445 197 L475 227 M475 197 L445 227" fill="none" stroke-width="0.6" opacity="0.45"/>\n'
          f'    <path d="M468 206 l8 -8 M452 220 l-6 8 M462 204 l3 -12" fill="none" stroke="{BRASS}" stroke-width="1.6"/>\n'
          '    <path d="M380 192 V234" fill="none" stroke="#F1E7C8" stroke-width="3.5" opacity="0.8"/>\n'
          '    <path d="M380 192 V234" fill="none" stroke-width="1.1" stroke-dasharray="6 5"/>\n')
    # --- barrels and a broom in the lower-left corner
    o += barrel_top(54, 438, 18) + barrel_top(92, 452, 15)
    o += (f'    <path d="M44 462 L160 440" fill="none" stroke="{WOOD_D}" stroke-width="4"/>\n'
          '    <path d="M150 432 l22 -4 l-2 22 l-24 4 Z" fill="#C7A25A" stroke-width="1.5"/>\n'
          '    <path d="M155 434 l-3 16 M162 432 l-3 16 M168 430 l-3 16" fill="none" stroke="#8E7430" stroke-width="1"/>\n')
    o += (circ(190, 458, 11, "#8F6F52", 1.8) + circ(190, 458, 7.5, WATER_D, 1.1) + circ(190, 458, 3, "url(#waterHatch)", 0)
          + f'    <path d="M179 458 Q190 444 201 458" fill="none" stroke-width="1.4"/>\n')
    o += rrect(150, 466, 28, 14, "#876A56", 1.7, 1) + "".join(circ(157 + i * 7, 473, 2.6, "#3D6B4F", 1) for i in range(3))   # crate of bottles
    return o


specs["room-tavern"] = {"title": "Tavern",
                        "desc": "Top-down tavern floor plan: bar with taps and kegs, round tables, hearth with spit, stage with lute, darts.",
                        "body": tavern(), "shadow": ""}


# =============================================================================
# TEMPLE
# =============================================================================

def pew(x, y, w=140, h=18, seed=0):
    r = random.Random(seed)
    o = (f'    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="#8F6F52" stroke-width="2"/>\n'
         f'    <path d="M{x} {y+h-5} H{x+w} V{y+h} H{x} Z" fill="{WOOD_D}" stroke-width="1.4"/>\n'
         f'    <path d="M{x+3} {y+5} H{x+w-3}" fill="none" stroke-width="0.8" opacity="0.4"/>\n'
         f'    <path d="M{x-4} {y-2} H{x+4} V{y+h+2} H{x-4} Z" fill="{WOOD_D}" stroke-width="1.6"/>\n'
         f'    <path d="M{x+w-4} {y-2} H{x+w+4} V{y+h+2} H{x+w-4} Z" fill="{WOOD_D}" stroke-width="1.6"/>\n')
    for _ in range(r.randint(1, 2)):                    # hymnals left on the seat
        bx = x + r.randint(14, w - 30)
        o += f'    <path d="M{bx} {y+3} H{bx+10} V{y+11} H{bx} Z" fill="{r.choice(["#9C3F3A", "#4F6B65", "#6C5B8C"])}" stroke-width="0.9"/>\n'
    return o


def brazier(cx, cy):
    o = ""
    for a in (90, 210, 330):
        ax = math.radians(a)
        o += f'    <path d="M{cx} {cy} L{cx+19*math.cos(ax):.1f} {cy+19*math.sin(ax):.1f}" fill="none" stroke="#2E2C2A" stroke-width="3.4"/>\n'
    o += (circ(cx, cy, 14, "#4B4B4B", 2) + circ(cx, cy, 10.5, "#26211f", 1.2)
          + circ(cx - 3, cy + 2, 3.5, "#D1642B", 0.8) + circ(cx + 4, cy + 3, 3, "#D1642B", 0.8)
          + flame(cx, cy - 1, 1.1))
    return o


def temple():
    o = room_shell(FLOOR_FLAG, "#6F6D68", "stoneHatch")
    # --- sanctuary platform with checker tiles
    o += '    <path d="M60 28 H452 V122 H60 Z" fill="#CFC7B0" stroke-width="2.2"/>\n'
    tiles = []
    for ix in range(0, 17):
        for iy in range(0, 4):
            if (ix + iy) % 2 == 0:
                tx, ty = 60 + ix * 24, 28 + iy * 24
                tiles.append(f"M{tx} {ty} h24 v24 h-24 Z")
    o += f'    <path d="{" ".join(tiles)}" fill="#7F7A6E" stroke="none" opacity="0.75"/>\n'
    o += '    <path d="M60 28 H452 V122 H60 Z" fill="none" stroke-width="2.2"/>\n'
    o += (f'    <path d="M60 122 H452 V132 H60 Z" fill="#B9B2A0" stroke-width="1.8"/>\n'
          '    <path d="M60 127 H452" fill="none" stroke-width="0.8" opacity="0.5"/>\n')
    # --- long nave carpet with medallions and fringe
    o += (f'    <path d="M224 100 H288 V484 H224 Z" fill="#8C3A3A" stroke-width="2"/>\n'
          f'    <path d="M231 104 H281 V484 M231 104 V484" fill="none" stroke="{GOLD}" stroke-width="3"/>\n'
          f'    <path d="M238 108 H274 V484 H238 Z" fill="none" stroke="#5F2323" stroke-width="1.4"/>\n')
    o += '    <path d="M228 100 v-6 M234 100 v-6 M240 100 v-6 M246 100 v-6 M252 100 v-6 M258 100 v-6 M264 100 v-6 M270 100 v-6 M276 100 v-6 M282 100 v-6" fill="none" stroke="#D7C39A" stroke-width="1.4"/>\n'
    for my in (200, 290, 380):                          # rose-window medallions on the runner
        o += circ(256, my, 17, "#5F2323", 1.5) + circ(256, my, 13, "none", 1.8, f'stroke="{GOLD}"')
        petals = " ".join(f"M256 {my} L{256+12*math.cos(math.radians(a)):.1f} {my+12*math.sin(math.radians(a)):.1f}" for a in range(0, 360, 45))
        o += f'    <path d="{petals}" fill="none" stroke="{GOLD}" stroke-width="1.4"/>\n' + circ(256, my, 4, GOLD, 1.2)
        o += f'    <path d="M256 {my+22} l5 5 l-5 5 l-5 -5 Z" fill="{GOLD}" stroke-width="1"/>\n'
    # --- pews, six..seven rows each side
    for i in range(7):
        py = 152 + i * 38
        o += pew(62, py, 140, 18, i) + pew(310, py, 140, 18, i + 20)
    # --- altar: stone block, cloth, candles, holy symbol, chalice, book
    o += (f'    <path d="M196 38 H316 V82 H196 Z" fill="{STONE}" stroke-width="2.4"/>\n'
          '    <path d="M196 38 H316 V82 H196 Z" fill="url(#stoneHatch)" stroke="none"/>\n'
          f'    <path d="M204 38 H308 V78 H204 Z" fill="#F1ECDD" stroke-width="1.8"/>\n'
          f'    <path d="M204 72 H308 M204 75 H308" fill="none" stroke="{GOLD}" stroke-width="1.4"/>\n'
          f'    <path d="M214 78 v6 M226 78 v6 M238 78 v6 M250 78 v6 M262 78 v6 M274 78 v6 M286 78 v6 M298 78 v6" fill="none" stroke="{GOLD}" stroke-width="1.5"/>\n')
    # sunburst holy symbol
    rays = " ".join(f"M256 56 L{256+15*math.cos(math.radians(a)):.1f} {56+15*math.sin(math.radians(a)):.1f}" for a in range(0, 360, 30))
    o += f'    <path d="{rays}" fill="none" stroke="{BRASS}" stroke-width="2.4"/>\n' + circ(256, 56, 8.5, GOLD, 1.7) + circ(256, 56, 3.5, "#F6E7A5", 1)
    for cx in (220, 292):                               # tall candles
        o += circ(cx, 54, 6, "#F1ECDD", 1.6) + circ(cx, 54, 2.5, "#F2D060", 0.8) + flame(cx, 54, 0.55)
    o += circ(236, 69, 4.2, BRASS, 1.4) + circ(236, 69, 2, "#8C3A3A", 0.8)  # chalice
    o += f'    <path d="M270 62 H290 V74 H270 Z" fill="#6C5B8C" stroke-width="1.4"/><path d="M274 62 V74" fill="none" stroke-width="0.9"/>\n'
    # --- candelabra stands flank the altar, braziers beyond
    for cx in (166, 346):
        o += circ(cx, 76, 12, "#4B4B4B", 1.8)
        for a in (90, 210, 330):
            ax = math.radians(a)
            o += circ(round(cx + 5.5 * math.cos(ax)), round(76 + 5.5 * math.sin(ax)), 3, "#F1ECDD", 1.1) + flame(round(cx + 5.5 * math.cos(ax)), round(76 + 5.5 * math.sin(ax)) - 1, 0.35)
    o += brazier(112, 56) + brazier(400, 56)
    # --- lectern (angled book stand) and bell-less pulpit step
    o += (f'    <g transform="translate(118 100) rotate(-12)" stroke-width="1.8">\n'
          f'      <path d="M-18 -14 H18 V14 H-18 Z" fill="{WOOD_M}"/>\n'
          f'      <path d="M-14 -10 H14 V10 H-14 Z" fill="{WOOD_D}" stroke-width="1.2"/>\n'
          f'      <path d="M-12 -8 H0 V8 H-12 Z M0 -8 H12 V8 H0 Z" fill="#F1ECDD" stroke-width="1.1"/>\n'
          '      <path d="M-9 -4 H-3 M-9 0 H-3 M-9 4 H-3 M3 -4 H9 M3 0 H9 M3 4 H9" fill="none" stroke-width="0.7" opacity="0.6"/>\n'
          '    </g>\n')
    # offering table with censer at the right of the sanctuary
    o += (f'    <path d="M388 92 H430 V116 H388 Z" fill="{WOOD_M}" stroke-width="1.9"/>\n'
          f'    <circle cx="403" cy="104" r="6" fill="{BRASS}" stroke-width="1.5"/><circle cx="403" cy="104" r="2.6" fill="#26211f" stroke-width="1"/>\n'
          f'    <path d="M417 98 H426 V110 H417 Z" fill="#E6D9B5" stroke-width="1.2"/>\n')
    # --- braziers along the side aisles
    for bx, by in ((44, 164), (44, 296), (468, 164), (468, 296)):
        o += brazier(bx, by)
    # --- saint statue on a plinth, left aisle
    o += (f'    <path d="M30 352 H56 V382 H30 Z" fill="{STONE_L}" stroke-width="2"/>\n'
          f'    <path d="M30 352 H56 V382 H30 Z" fill="url(#stoneHatch)" stroke="none"/>\n'
          f'    <path d="M34 374 Q43 360 52 374 Z" fill="#E6D9B5" stroke-width="1.4"/>\n'
          f'    <circle cx="43" cy="366" r="4.5" fill="#E6D9B5" stroke-width="1.4"/><circle cx="43" cy="366" r="7.5" fill="none" stroke="{GOLD}" stroke-width="1.2"/>\n')
    # --- baptismal font (octagonal) near the door, left
    pts = " ".join(f"{92+27*math.cos(math.radians(22.5+45*i)):.1f},{436+27*math.sin(math.radians(22.5+45*i)):.1f}" for i in range(8))
    pts2 = " ".join(f"{92+20*math.cos(math.radians(22.5+45*i)):.1f},{436+20*math.sin(math.radians(22.5+45*i)):.1f}" for i in range(8))
    o += (f'    <polygon points="{pts}" fill="{STONE_L}" stroke-width="2.2"/>\n'
          f'    <polygon points="{pts}" fill="url(#stoneHatch)" stroke="none"/>\n'
          f'    <polygon points="{pts2}" fill="{STONE_D}" stroke-width="1.5"/>\n'
          f'    <circle cx="92" cy="436" r="13" fill="{WATER}" stroke-width="1.5"/>\n'
          f'    <circle cx="92" cy="436" r="13" fill="url(#waterHatch)" stroke="none"/>\n'
          f'    <path d="M86 436 H98 M92 429 V443" fill="none" stroke="#E6D9B5" stroke-width="1.5"/>\n'
          f'    <path d="M120 458 q10 -6 18 -2 q-2 10 -14 10 Z" fill="#E6D9B5" stroke-width="1.4"/>\n')  # shell dipper
    # --- bell rope coiled below its ceiling drop, right of the door
    o += coil(404, 440, 20, "#B79A62") + circ(404, 440, 6, "#7A5230", 1.5) + circ(404, 440, 2, "#F6E7A5", 0.7)
    o += f'    <path d="M404 460 q12 10 20 4 q-6 -12 -14 -2" fill="none" stroke="#B79A62" stroke-width="3"/>\n'
    # --- votive candle rack and alms box, right wall
    o += (f'    <path d="M458 338 H482 V396 H458 Z" fill="{WOOD_D}" stroke-width="1.9"/>\n')
    for k in range(10):
        o += circ(465 + (k % 2) * 12, 346 + (k // 2) * 11, 3.4, "#F1ECDD", 1.1)
    o += chest(446, 410, 34, 24, "#745846")
    return o


specs["room-temple"] = {"title": "Temple",
                        "desc": "Top-down temple floor plan: pews either side of a carpeted aisle, altar with candles and sunburst, font, braziers.",
                        "body": temple(), "shadow": ""}


# =============================================================================
# TRADING POST
# =============================================================================

def trading_post():
    o = room_shell(FLOOR_WOOD, "#745846", "logHatch")
    o += strokes(256, 300, 180, 150, 40, 12, "#7A6340", 0.35, 9)

    # --- shelf units along the top wall: rope, lanterns, pans, rations
    for x0, x1 in ((34, 152), (160, 274), (282, 400), (408, 476)):
        o += (f'    <path d="M{x0} 30 H{x1} V62 H{x0} Z" fill="{WOOD_M}" stroke-width="2"/>\n'
              f'    <path d="M{x0} 30 H{x1} V62 H{x0} Z" fill="url(#plankHatch)" stroke="none" opacity="0.6"/>\n')
    o += coil(58, 46, 13) + coil(92, 46, 13, "#C4A98A") + coil(126, 46, 12, "#A98E5A")
    for lx in (180, 208, 236, 262):                                  # lanterns: glass square + ring handle
        o += (f'    <circle cx="{lx}" cy="46" r="9" fill="none" stroke="#4D4B47" stroke-width="1.6"/>\n'
              f'    <path d="M{lx-7} 39 H{lx+7} V53 H{lx-7} Z" fill="#4D4B47" stroke-width="1.5"/>\n'
              f'    <path d="M{lx-4} 42 H{lx+4} V50 H{lx-4} Z" fill="#F2D060" stroke-width="1"/>\n')
    for px, pr in ((308, 13), (344, 14), (380, 12)):                 # frying pans and pots
        o += (f'    <circle cx="{px}" cy="46" r="{pr}" fill="#5B5A56" stroke-width="1.8"/>\n'
              f'    <circle cx="{px}" cy="46" r="{pr-4}" fill="#3F3E3B" stroke-width="1"/>\n'
              f'    <path d="M{px+pr} 43 h12 v6 h-12 Z" fill="{WOOD_D}" stroke-width="1.4"/>\n')
    for rx_, ry_ in ((416, 36), (434, 36), (452, 36)):               # ration tins
        o += rrect(rx_, ry_, 14, 12, "#9C9A92", 1.5, 2) + rrect(rx_ + 3, ry_ + 3, 8, 6, "#C9A24E", 0.8, 1)
    o += sack(430, 55, 8, 5, 41, "#CDB98A") + sack(456, 55, 8, 5, 42, "#B8A173") + sack(468, 40, 6, 6, 43, "#CDB98A")

    # --- behind the counter: coin chest (open), strongbox, stool, ledger desk, barrels
    o += (f'    <path d="M38 80 H98 V96 H38 Z" fill="{WOOD_D}" stroke-width="1.9"/>\n'
          f'    <path d="M38 96 H98 V128 H38 Z" fill="#8F6F52" stroke-width="2"/>\n'
          f'    <path d="M42 100 H94 V124 H42 Z" fill="#26211f" stroke-width="1.3"/>\n'
          )
    for k, (cx, cy) in enumerate(((52, 108), (64, 112), (76, 108), (86, 114), (58, 118), (72, 120), (84, 106))):
        o += circ(cx, cy, 4.4, GOLD, 1.1) + circ(cx, cy, 1.8, "none", 0.6, 'opacity="0.6"')
    o += f'    <path d="M62 80 H74 V86 H62 Z" fill="{BRASS}" stroke-width="1.1"/>\n'
    o += chest(112, 94, 34, 26, "#745846")
    o += rug(70, 138, 130, 48, "#4F6B65")
    # potbelly stove: iron body, stove-pipe collar, fuel door
    o += (circ(48, 166, 16, "#4B4B4B", 2) + circ(48, 166, 10, "#34332F", 1.3) + circ(48, 166, 4, "#7F7C74", 1.2)
          + f'    <path d="M62 160 H72 V172 H62 Z" fill="#26211f" stroke-width="1.3"/>\n' + flame(67, 166, 0.45))
    o += stool(142, 166, 11) + stool(180, 152, 10, "#8F6F52")
    o += round_table(106, 162, 16) + mug(102, 160) + circ(112, 166, 3, "#F2D060", 1)
    # ledger desk (right, behind counter) with ink, quill, candle
    o += (f'    <path d="M372 92 H470 V150 H372 Z" fill="{WOOD_M}" stroke-width="2"/>\n'
          '    <path d="M378 98 H464 V144 H378 Z" fill="none" stroke-width="0.9" opacity="0.5"/>\n'
          f'    <path d="M386 104 H414 V132 H386 Z M414 104 H442 V132 H414 Z" fill="#F1ECDD" stroke-width="1.3"/>\n'
          '    <path d="M390 110 H410 M390 116 H410 M390 122 H410 M418 110 H438 M418 116 H438 M418 122 H430" fill="none" stroke-width="0.7" opacity="0.55"/>\n'
          '    <circle cx="454" cy="112" r="5" fill="#2B2A33" stroke-width="1.5"/>\n'
          '    <path d="M450 128 l16 -14" fill="none" stroke="#E6D9B5" stroke-width="2.2"/>\n'
          f'    <circle cx="456" cy="134" r="4" fill="#F1ECDD" stroke-width="1.3"/><circle cx="456" cy="134" r="1.6" fill="#F2D060" stroke="none"/>\n')
    o += stool(420, 166, 11)
    o += barrel_top(232, 108, 16) + barrel_top(266, 118, 14) + barrel_top(246, 140, 13)
    o += sack(310, 112, 17, 14, 51) + sack(332, 140, 15, 13, 52, "#B8A173")

    # --- long shop counter with scale, coins, bell, ledger
    o += (f'    <path d="M28 196 H372 V234 H28 Z" fill="#7A5A42" stroke-width="2.4"/>\n'
          f'    <path d="M34 200 H366 V224 H34 Z" fill="#9F7D68" stroke-width="1.2"/>\n'
          '    <path d="M34 200 H366 V224 H34 Z" fill="url(#plankHatch)" stroke="none" opacity="0.7"/>\n'
          f'    <path d="M372 196 Q384 215 372 234" fill="#7A5A42" stroke-width="2.4"/>\n'
          f'    <path d="M28 228 H372" fill="none" stroke-width="1" opacity="0.5"/>\n')
    # balance scale
    o += (f'    <path d="M118 212 H186" fill="none" stroke="#4D4B47" stroke-width="2.6"/>\n'
          f'    <path d="M118 212 L112 200 M118 212 L112 224 M186 212 L192 200 M186 212 L192 224" fill="none" stroke="#7F7C74" stroke-width="1"/>\n'
          f'    <circle cx="106" cy="212" r="9" fill="#B9B2A2" stroke-width="1.6"/><circle cx="198" cy="212" r="9" fill="#B9B2A2" stroke-width="1.6"/>\n'
          f'    <circle cx="152" cy="212" r="5.5" fill="#4D4B47" stroke-width="1.6"/><circle cx="152" cy="212" r="1.8" fill="{BRASS}" stroke="none"/>\n'
          f'    <circle cx="106" cy="212" r="4" fill="{GOLD}" stroke-width="1"/>\n'
          f'    <rect x="193" y="207" width="9" height="9" rx="2" fill="#4D4B47" stroke-width="1.2"/>\n')
    for cx, cy in ((232, 208), (240, 214), (230, 218), (246, 206), (238, 205)):
        o += circ(cx, cy, 4.2, GOLD, 1.1)
    o += circ(290, 212, 9, BRASS, 1.7) + circ(290, 212, 4, "#E6D9B5", 1.1)       # counter bell
    o += (f'    <path d="M318 202 H342 V222 H318 Z M342 202 H366 V222 H342 Z" fill="#F1ECDD" stroke-width="1.3"/>\n'
          '    <path d="M322 208 H338 M322 213 H338 M346 208 H362 M346 213 H356" fill="none" stroke-width="0.7" opacity="0.55"/>\n'
          '    <path d="M268 200 H278 V224 H268 Z" fill="#CDB98A" stroke-width="1.3"/><path d="M268 206 H278 M268 218 H278" fill="none" stroke-width="1"/>\n')   # rolled map

    # --- cloaks on wall hooks (left wall)
    o += '    <path d="M28 252 H34 V380 H28 Z" fill="#4B352B" stroke-width="1.4"/>\n'
    for i, c in enumerate(("#4F6B65", "#9C3F3A", "#8C8A7E", "#6C5B8C", "#8F6F52")):
        cy = 262 + i * 25
        o += (f'    <path d="M34 {cy-11} C60 {cy-9} 60 {cy+9} 34 {cy+11} Z" fill="{c}" stroke-width="1.7"/>\n'
              f'    <path d="M38 {cy-6} Q52 {cy} 38 {cy+6}" fill="none" stroke-width="0.9" opacity="0.55"/>\n'
              f'    <circle cx="35" cy="{cy}" r="2.5" fill="#4D4B47" stroke-width="1"/>\n')

    # --- display table with trade goods (centre)
    o += (f'    <path d="M120 292 H300 V352 H120 Z" fill="#876A56" stroke-width="2.2"/>\n'
          f'    <path d="M124 296 H296 V348 H124 Z" fill="#C9B99A" stroke-width="1" opacity="0.8"/>\n'
          f'    <path d="M124 296 H296 V348 H124 Z" fill="none" stroke="#745846" stroke-width="2"/>\n')
    # bedrolls (capsules with two straps)
    for by_, c in ((302, "#9C3F3A"), (318, "#4F6B65")):
        o += (f'    <path d="M132 {by_} H176 a7 7 0 0 1 0 14 H132 a7 7 0 0 1 0 -14 Z" fill="{c}" stroke-width="1.7"/>\n'
              f'    <path d="M144 {by_} V{by_+14} M162 {by_} V{by_+14}" fill="none" stroke="{LEATHER_D}" stroke-width="2.2"/>\n')
    # backpack
    o += (f'    <path d="M190 300 H220 Q226 300 226 306 V336 Q226 342 220 342 H190 Q184 342 184 336 V306 Q184 300 190 300 Z" fill="{LEATHER}" stroke-width="1.8"/>\n'
          f'    <path d="M188 302 H222 V320 H188 Z" fill="#A9754A" stroke-width="1.3"/>\n'
          f'    <rect x="202" y="316" width="6" height="8" rx="1" fill="{BRASS}" stroke-width="1"/>\n'
          f'    <path d="M184 312 q-8 10 0 24 M226 312 q8 10 0 24" fill="none" stroke="{LEATHER_D}" stroke-width="2.4"/>\n')
    # torch bundle (parallel shafts with tarred heads)
    for k in range(5):
        o += f'    <path d="M240 {300+k*7} H282" fill="none" stroke="{WOOD_D}" stroke-width="4"/>\n'
        o += circ(284, 300 + k * 7, 4, "#3A2A22", 1.2)
    o += '    <path d="M252 296 V338 M268 296 V338" fill="none" stroke="#B79A62" stroke-width="2.2"/>\n'
    o += coil(140, 338, 8, "#B79A62") + circ(176, 338, 6, "#E6D9B5", 1.4) + circ(176, 338, 2.5, "#F2D060", 0.9)
    o += rrect(240, 338, 22, 8, "#C98A4E", 1.4, 3) + rrect(266, 338, 22, 8, "#C98A4E", 1.4, 3)   # trail-bread loaves

    # --- pickle barrel (open, with pickles) and cracker barrel with leaning lid
    o += (circ(440, 288, 24, "#A17A5C", 2) + circ(440, 288, 19, "#7A6A2E", 1.4) + circ(440, 288, 19, "url(#waterHatch)", 0, 'opacity="0.35"'))
    for px, py, rot in ((432, 282, 20), (446, 280, -30), (438, 296, 70), (450, 294, 10), (428, 292, -10)):
        o += f'    <ellipse cx="{px}" cy="{py}" rx="8" ry="3.4" transform="rotate({rot} {px} {py})" fill="#6B8F3F" stroke-width="1.2"/>\n'
    o += (f'    <circle cx="396" cy="276" r="13" fill="#A17A5C" stroke-width="1.8"/><circle cx="396" cy="276" r="8" fill="none" stroke-width="1" opacity="0.6"/>\n'
          f'    <path d="M388 276 H404" fill="none" stroke="#4D4B47" stroke-width="1.2" opacity="0.7"/>\n')
    o += barrel_top(446, 338, 18)
    o += circ(408, 330, 12, "#8F6F52", 1.8) + circ(408, 330, 8.5, "#B8453A", 1.1)
    for dx, dy in ((405, 327), (411, 328), (408, 333), (403, 332)):
        o += circ(dx, dy, 2.2, "#D9573F", 0.7)

    # --- tool rack on the right wall: shovel, pick and axe laid across rails
    o += '    <g transform="translate(0 12)">\n'
    o += (f'    <path d="M452 352 H482 V404 H452 Z" fill="{WOOD_D}" stroke-width="1.9"/>\n'
          f'    <path d="M456 358 H478 M456 378 H478 M456 398 H478" fill="none" stroke="#4B352B" stroke-width="1.4"/>\n'
          f'    <path d="M466 356 V396" fill="none" stroke="#BD9D86" stroke-width="3"/><path d="M460 396 H472 L466 404 Z" fill="#9C9A92" stroke-width="1.3"/>\n'
          f'    <path d="M458 360 H476 M458 362 Q467 354 476 362" fill="none" stroke="#7F7C74" stroke-width="2.4"/>\n')
    o += '    </g>\n'
    # --- crates and sacks stacked in the lower-left corner
    o += (f'    <path d="M44 410 H100 V466 H44 Z" fill="#876A56" stroke-width="2"/>\n'
          f'    <path d="M50 416 L94 460 M94 416 L50 460" fill="none" stroke="#5F4434" stroke-width="1.4" opacity="0.8"/>\n'
          f'    <path d="M50 416 H94 V460 H50 Z" fill="none" stroke-width="0.9" opacity="0.5"/>\n'
          f'    <path d="M104 424 H152 V466 H104 Z" fill="#9F7D68" stroke-width="2"/>\n'
          f'    <path d="M110 430 L146 460 M146 430 L110 460" fill="none" stroke="#5F4434" stroke-width="1.3" opacity="0.8"/>\n'
          f'    <path d="M62 380 H98 V408 H62 Z" fill="#8F6F52" stroke-width="1.9"/>\n'
          f'    <path d="M66 386 L94 404 M94 386 L66 404" fill="none" stroke="#5F4434" stroke-width="1.2" opacity="0.8"/>\n')
    o += sack(122, 396, 20, 15, 61) + sack(160, 400, 17, 14, 62, "#B8A173") + sack(168, 440, 16, 13, 63)
    # a spilled crate lid and loose rope near the door side
    o += coil(184, 462, 11, "#C4A98A")

    # --- mule hitch near the door (right): loaded mule tied to a post
    o += animal(402, 440, -90, 0.8, "#8C7A66", "#3F342A", ears=11, muzzle="#C9BFAE", pack=True)
    o += (f'    <circle cx="322" cy="466" r="9" fill="{WOOD_M}" stroke-width="1.9"/>\n'
          f'    <circle cx="322" cy="466" r="4.2" fill="none" stroke="#4D4B47" stroke-width="2.6"/>\n'
          f'    <path d="M327 462 C334 454 330 446 338 440" fill="none" stroke="{LEATHER_D}" stroke-width="2.6"/>\n'
          f'    <path d="M327 462 C334 454 330 446 338 440" fill="none" stroke="#C7A25A" stroke-width="0.9"/>\n')
    # feed bag and bucket for the mule
    o += circ(324, 416, 8.5, "#8F6F52", 1.8) + circ(324, 416, 5.5, WATER_D, 1) + circ(324, 416, 2, "url(#waterHatch)", 0)
    return o


specs["room-trading-post"] = {"title": "Trading post",
                              "desc": "Top-down trading post floor plan: shop counter with scale, shelves of gear, cloaks on hooks, crates, pickle barrel, hitched mule.",
                              "body": trading_post(), "shadow": ""}
