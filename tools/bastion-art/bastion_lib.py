"""Shared primitives for the Shadowdark bastion art set.

Same technique and palette as the Crows institution set
(crows_design/institutions/generate_institution_set.py): native vector, 512x512,
near-orthographic (roof plane over a short wall strip), ink #010206, separate
cast shadow at village shadowAngle 30 / #9699AE, 2-4 fills per piece.
"""
from __future__ import annotations

import re
from pathlib import Path

INK = "#010206"
SHADOW = "#9699AE"

# Palette, taken from the institution set so the pieces sit in one village.
WOOD_L, WOOD_M, WOOD_D = "#BD9D86", "#9F7D68", "#745846"
ROOF_L, ROOF_D = "#C4A68F", "#B58F78"
STONE, STONE_D, STONE_L = "#8E8B83", "#6F6D68", "#A8A59B"
SLATE = "#95A5A5"
STRAW = "#D4B76A"
DIRT = "#B8AB8E"
WATER, WATER_D = "#5B99A6", "#4C8699"

DEFS = """
  <defs>
    <pattern id="roofHatch" width="12" height="12" patternUnits="userSpaceOnUse">
      <path d="M2 0 V12 M8 0 V12" fill="none" stroke="#010206" stroke-width="0.75" opacity="0.17"/>
    </pattern>
    <pattern id="leanHatch" width="10" height="10" patternUnits="userSpaceOnUse">
      <path d="M2 0 V10" fill="none" stroke="#010206" stroke-width="0.65" opacity="0.18"/>
    </pattern>
    <pattern id="stoneHatch" width="16" height="13" patternUnits="userSpaceOnUse">
      <path d="M0 6 H16 M5 0 V6 M12 6 V13" fill="none" stroke="#010206" stroke-width="0.55" opacity="0.16"/>
    </pattern>
    <pattern id="shingleHatch" width="14" height="9" patternUnits="userSpaceOnUse">
      <path d="M0 8 H14 M0 4 Q3.5 8 7 4 Q10.5 8 14 4" fill="none" stroke="#010206" stroke-width="0.6" opacity="0.2"/>
    </pattern>
    <pattern id="logHatch" width="9" height="9" patternUnits="userSpaceOnUse">
      <path d="M4.5 0 V9" fill="none" stroke="#010206" stroke-width="0.7" opacity="0.2"/>
    </pattern>
    <pattern id="plankHatch" width="64" height="22" patternUnits="userSpaceOnUse">
      <path d="M0 0.5 H64 M0 11.5 H64 M20 0 V11 M50 11 V22" fill="none" stroke="#010206" stroke-width="0.8" opacity="0.22"/>
    </pattern>
    <pattern id="flagHatch" width="48" height="40" patternUnits="userSpaceOnUse">
      <path d="M0 0.5 H48 M0 20.5 H48 M16 0 V20 M40 20 V40" fill="none" stroke="#010206" stroke-width="0.8" opacity="0.2"/>
    </pattern>
    <pattern id="waterHatch" width="22" height="10" patternUnits="userSpaceOnUse">
      <path d="M2 5 Q7 1 12 5 T22 5" fill="none" stroke="#A3C9CC" stroke-width="1.1" opacity="0.7"/>
    </pattern>
  </defs>
"""


def svg(title: str, desc: str, body: str) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"
     role="img" aria-labelledby="title desc">
  <title id="title">{title}</title>
  <desc id="desc">{desc}</desc>
  <!-- Native vector artwork only: no embedded or linked raster content. -->
{DEFS}
  <g id="building" stroke="{INK}" stroke-linecap="round" stroke-linejoin="round">
{body}
  </g>
</svg>
'''


def shadow_svg(title: str, body: str) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"
     role="img" aria-labelledby="title desc">
  <title id="title">{title} shadow</title>
  <desc id="desc">Separate native-vector cast shadow aligned to the {title} SVG.</desc>
  <g id="shadow" transform="translate(28 16)" fill="{SHADOW}" opacity="0.46">
{body}
  </g>
</svg>
'''


# ---- primitives -----------------------------------------------------------

def roof(x, y, w, h, light=ROOF_L, dark=ROOF_D, hatch="roofHatch") -> str:
    ridge = y + h // 2
    return f'''
    <path d="M{x} {y} H{x+w} V{ridge} H{x} Z" fill="{light}" stroke="none"/>
    <path d="M{x} {ridge} H{x+w} V{y+h} H{x} Z" fill="{dark}" stroke="none"/>
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="url(#{hatch})" stroke="none"/>
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="none" stroke-width="2.8"/>
    <path d="M{x} {ridge} C{x+w//4} {ridge-2}, {x+3*w//4} {ridge+2}, {x+w} {ridge}" fill="none" stroke-width="3.1"/>
'''


def wall(x, y, w, h=26, fill=WOOD_M) -> str:
    return f'    <path d="M{x} {y} H{x+w} L{x+w-6} {y+h} H{x+6} Z" fill="{fill}" stroke-width="2.1"/>\n'


def door(x, y, w=34, h=29, fill=WOOD_D) -> str:
    return f'''
    <path d="M{x} {y} H{x+w} L{x+w-3} {y+h} H{x+3} Z" fill="{fill}" stroke-width="1.8"/>
    <path d="M{x+5} {y+9} H{x+w-5} M{x+6} {y+18} H{x+w-5}" fill="none" stroke-width="1.05" opacity="0.72"/>
'''


def pegs(x, y, w, h) -> str:
    return f'''
    <g fill="#A9856E" stroke-width="1.6">
      <rect x="{x-6}" y="{y-7}" width="14" height="14" rx="2"/>
      <rect x="{x+w-8}" y="{y-7}" width="14" height="14" rx="2"/>
      <rect x="{x-6}" y="{y+h-7}" width="14" height="14" rx="2"/>
      <rect x="{x+w-8}" y="{y+h-7}" width="14" height="14" rx="2"/>
    </g>
'''


def crate(x, y, w=42, h=30) -> str:
    return f'''
    <path d="M{x} {y} H{x+w} L{x+w+3} {y+h} H{x-3} Z" fill="#876A56" stroke-width="1.8"/>
    <path d="M{x+6} {y+5} L{x+w-5} {y+h-5} M{x+w-5} {y+5} L{x+5} {y+h-5}" fill="none" stroke="#5F4434" stroke-width="1" opacity="0.7"/>
'''


def barrel(x, y, rx=14, ry=8, h=28) -> str:
    return f'''
    <ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="#A17A5C" stroke-width="1.7"/>
    <path d="M{x-rx} {y} L{x-rx+2} {y+h} Q{x} {y+h+ry} {x+rx-2} {y+h} L{x+rx} {y} Q{x} {y+ry} {x-rx} {y} Z" fill="#876449" stroke-width="1.7"/>
    <path d="M{x-rx+2} {y+10} Q{x} {y+16} {x+rx-2} {y+10} M{x-rx+2} {y+21} Q{x} {y+27} {x+rx-2} {y+21}" fill="none" stroke="#4D4B47" stroke-width="1.3"/>
'''


# New for bastions: stone, timber and fortification pieces.

def stone_face(x, y, w, h, fill=STONE, lean=5) -> str:
    """Front face of a stone wall: trapezoid with block hatch."""
    d = f"M{x} {y} H{x+w} L{x+w-lean} {y+h} H{x+lean} Z"
    return f'''
    <path d="{d}" fill="{fill}" stroke="none"/>
    <path d="{d}" fill="url(#stoneHatch)" stroke="none"/>
    <path d="{d}" fill="none" stroke-width="2.2"/>
'''


def merlons(x, y, w, n, h=14, fill=STONE_L) -> str:
    """A crenellated parapet edge: n raised blocks spread across width w, top at y."""
    step = w / n
    mw = step * 0.58
    out = [f'    <g fill="{fill}" stroke-width="1.6">']
    for i in range(n):
        mx = x + i * step + (step - mw) / 2
        out.append(f'      <path d="M{mx:.0f} {y+h} V{y} H{mx+mw:.0f} V{y+h} Z"/>')
    out.append("    </g>\n")
    return "\n".join(out)


def stakes(x1, x2, y, h=34, n=None, fill="#A58562") -> str:
    """A row of sharpened palisade logs standing on baseline y+h."""
    n = n or max(2, int((x2 - x1) / 13))
    step = (x2 - x1) / n
    hw = step / 2 - 0.6
    out = [f'    <g fill="{fill}" stroke-width="1.5">']
    for i in range(n):
        cx = x1 + step * (i + 0.5)
        out.append(f'      <path d="M{cx-hw:.1f} {y+h} V{y+9} L{cx:.1f} {y} L{cx+hw:.1f} {y+9} V{y+h} Z"/>')
    out.append("    </g>")
    out.append(f'    <path d="M{x1} {y+h-7} H{x2}" fill="none" stroke-width="1.2" opacity="0.55"/>\n')
    return "\n".join(out)


def slit(x, y, h=16) -> str:
    return f'    <path d="M{x-2} {y} H{x+2} V{y+h} H{x-2} Z" fill="#1d1a18" stroke="none"/>\n'


def banner(x, y, fill="#9C3F3A", h=34) -> str:
    return f'''
    <path d="M{x} {y} V{y+h+14}" fill="none" stroke="#4B352B" stroke-width="2.4"/>
    <path d="M{x+1} {y+2} H{x+22} L{x+16} {y+11} L{x+22} {y+20} H{x+1} Z" fill="{fill}" stroke-width="1.6"/>
'''


def ballista(x, y, s=1.0) -> str:
    """Siege bolt-thrower seen from above-front, centre x, base y."""
    def p(v):
        return f"{v*s:.1f}"
    return f'''
    <g transform="translate({x} {y})">
      <path d="M{p(-22)} {p(-6)} Q0 {p(-26)} {p(22)} {p(-6)}" fill="none" stroke="#4B352B" stroke-width="{3.2*s:.1f}"/>
      <path d="M{p(-22)} {p(-6)} L0 {p(-3)} L{p(22)} {p(-6)}" fill="none" stroke="#2c2622" stroke-width="{1.2*s:.1f}"/>
      <path d="M{p(-5)} {p(-3)} H{p(5)} V{p(16)} H{p(-5)} Z" fill="#876A56" stroke-width="{1.6*s:.1f}"/>
      <path d="M0 {p(-3)} V{p(-24)} L{p(-3)} {p(-18)} M0 {p(-24)} L{p(3)} {p(-18)}" fill="none" stroke-width="{1.6*s:.1f}"/>
      <path d="M{p(-14)} {p(16)} H{p(14)} L{p(10)} {p(22)} H{p(-10)} Z" fill="{WOOD_D}" stroke-width="{1.6*s:.1f}"/>
    </g>
'''


def tuft(x, y, fill="#6F8A5F") -> str:
    return f'    <path d="M{x} {y} Q{x+2} {y-9} {x+5} {y} Q{x+8} {y-7} {x+11} {y} Z" fill="{fill}" stroke-width="1"/>\n'


# ---- top-down floor-plan helpers (interior tiles) ---------------------------
# Interior tiles are TRUE top-down plans, 512x512. Every tile has a 28px wall
# band on all four edges and a door gap on the BOTTOM edge (x 216..296); the
# page rotates tiles so the door faces the corridor.

FLOOR_WOOD = ("#BD9D86", "plankHatch")
FLOOR_FLAG = ("#A8A59B", "flagHatch")
FLOOR_DIRT = ("#B8AB8E", "leanHatch")


def room_shell(floor=FLOOR_WOOD, wall="#6F6D68", wall_hatch="stoneHatch", door=(216, 296), t=28) -> str:
    """Floor + 28px wall band + door gap on the bottom. Draw furniture AFTER this."""
    fill, hatch = floor
    x0, x1 = door
    return f'''
    <path d="M0 0 H512 V512 H0 Z" fill="{fill}" stroke="none"/>
    <path d="M0 0 H512 V512 H0 Z" fill="url(#{hatch})" stroke="none"/>
    <path d="M{t} {t} H{512-t} V{512-t} H{t} Z" fill="none" stroke="#010206" stroke-width="1.2" opacity="0.35"/>
    <path d="M0 0 H512 V512 H{x1} V{512-t} H{512-t} V{t} H{t} V{512-t} H{x0} V512 H0 Z" fill="{wall}" fill-rule="evenodd" stroke-width="2.6"/>
    <path d="M0 0 H512 V512 H{x1} V{512-t} H{512-t} V{t} H{t} V{512-t} H{x0} V512 H0 Z" fill="url(#{wall_hatch})" fill-rule="evenodd" stroke="none"/>
    <path d="M{x0} {512-t} V512 M{x1} {512-t} V512" fill="none" stroke-width="3.2"/>
    <path d="M{x0} {512-t+3} H{x1}" fill="none" stroke="#745846" stroke-width="5"/>
'''


def table(x, y, w, h, fill="#876A56") -> str:
    return f'''
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="{fill}" stroke-width="2"/>
    <path d="M{x+4} {y+4} H{x+w-4} V{y+h-4} H{x+4} Z" fill="none" stroke-width="0.9" opacity="0.5"/>
'''


def round_table(cx, cy, r, fill="#876A56") -> str:
    return f'''
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke-width="2"/>
    <circle cx="{cx}" cy="{cy}" r="{r-5}" fill="none" stroke-width="0.9" opacity="0.5"/>
'''


def stool(cx, cy, r=9, fill="#A9856E") -> str:
    return f'    <circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke-width="1.7"/>\n'


def bed(x, y, w=60, h=100, blanket="#6C8F7E") -> str:
    return f'''
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="#876A56" stroke-width="2"/>
    <path d="M{x+5} {y+5} H{x+w-5} V{y+22} H{x+5} Z" fill="#E6D9B5" stroke-width="1.5"/>
    <path d="M{x+5} {y+26} H{x+w-5} V{y+h-6} H{x+5} Z" fill="{blanket}" stroke-width="1.5"/>
    <path d="M{x+5} {y+44} H{x+w-5}" fill="none" stroke-width="0.9" opacity="0.5"/>
'''


def chest(x, y, w=44, h=28, fill="#8F6F52") -> str:
    return f'''
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="{fill}" stroke-width="2"/>
    <path d="M{x} {y+h*0.38:.0f} H{x+w}" fill="none" stroke-width="1.4"/>
    <path d="M{x+w/2-4:.0f} {y+h*0.38-3:.0f} H{x+w/2+4:.0f} V{y+h*0.38+5:.0f} H{x+w/2-4:.0f} Z" fill="#D7C39A" stroke-width="1.1"/>
'''


def shelf(x, y, w, h, books=True) -> str:
    out = f'    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="#745846" stroke-width="2"/>\n'
    if books:
        cols = ["#9C3F3A", "#4F6B65", "#C9A24E", "#6C5B8C", "#8F6F52"]
        n = int(w // 9) if w >= h else int(h // 9)
        for i in range(max(n, 1)):
            c = cols[i % 5]
            if w >= h:
                out += f'    <path d="M{x+3+i*9} {y+3} H{x+10+i*9} V{y+h-3} H{x+3+i*9} Z" fill="{c}" stroke-width="0.9"/>\n'
            else:
                out += f'    <path d="M{x+3} {y+3+i*9} H{x+w-3} V{y+10+i*9} H{x+3} Z" fill="{c}" stroke-width="0.9"/>\n'
    return out


def rug(x, y, w, h, fill="#9C3F3A", trim="#D7C39A") -> str:
    return f'''
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="{fill}" stroke-width="1.8"/>
    <path d="M{x+8} {y+8} H{x+w-8} V{y+h-8} H{x+8} Z" fill="none" stroke="{trim}" stroke-width="3"/>
'''


def barrel_top(cx, cy, r=14) -> str:
    return f'''
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="#A17A5C" stroke-width="1.8"/>
    <circle cx="{cx}" cy="{cy}" r="{r-5}" fill="none" stroke-width="1" opacity="0.6"/>
    <path d="M{cx-r+3} {cy} H{cx+r-3}" fill="none" stroke="#4D4B47" stroke-width="1.2" opacity="0.7"/>
'''


def hearth(x, y, w=90, h=36) -> str:
    return f'''
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="#8E8B83" stroke-width="2.2"/>
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M{x+10} {y+8} H{x+w-10} V{y+h} H{x+10} Z" fill="#26211f" stroke-width="1.6"/>
    <path d="M{x+w/2-8:.0f} {y+h} C{x+w/2-14:.0f} {y+22} {x+w/2-2:.0f} {y+14} {x+w/2:.0f} {y+8} C{x+w/2+4:.0f} {y+16} {x+w/2+14:.0f} {y+24} {x+w/2+8:.0f} {y+h} Z" fill="#E08A33" stroke-width="1.2"/>
'''


# ---- emit ------------------------------------------------------------------

def emit(specs: dict, outdir: Path) -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    for slug, spec in specs.items():
        (outdir / f"{slug}.svg").write_text(svg(spec["title"], spec.get("desc", f"{spec['title']} bastion art."), spec["body"]))
        (outdir / f"{slug}.shadow.svg").write_text(shadow_svg(spec["title"], spec["shadow"]))


FORBIDDEN = re.compile(r"<(?:image|foreignObject)\b|data:image|base64", re.I)
