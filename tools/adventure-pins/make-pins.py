#!/usr/bin/env python3
"""Draw the map pins: a black rounded chip with a white number, in the style of the books'
GM key (Montserrat Bold numerals). The numbers are traced to outlines, so the SVGs need no font.

usage: make-pins.py <Montserrat-Bold.ttf> <outdir> [max-number]

Montserrat is SIL Open Font License 1.1 (MONTSERRAT-OFL.txt here). Make the Bold instance from
the variable font with:
    python3 -c "from fontTools.ttLib import TTFont; from fontTools.varLib import instancer; \
instancer.instantiateVariableFont(TTFont('Montserrat[wght].ttf'), {'wght': 700}).save('Montserrat-Bold.ttf')"
"""
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

SIZE = 64            # the chip's viewBox
RASTER = 128         # the size Foundry rasterises it at, so a zoomed-in map stays crisp
DIGIT_H = 28.0       # a digit's height in the chip
MAX_W = 42.0         # widest the number may be

def number_path(font, text):
    gs = font.getGlyphSet(); cmap = font.getBestCmap()
    names = [cmap[ord(c)] for c in text]
    # ink bounds of the whole run, to centre it exactly
    x = 0; boxes = []
    for n in names:
        bp = BoundsPen(gs); gs[n].draw(bp); b = bp.bounds
        boxes.append((x + b[0], b[1], x + b[2], b[3])); x += gs[n].width
    x0 = min(b[0] for b in boxes); x1 = max(b[2] for b in boxes)
    y0 = min(b[1] for b in boxes); y1 = max(b[3] for b in boxes)
    s = min(DIGIT_H / (y1 - y0), MAX_W / (x1 - x0))
    ox = SIZE / 2 - s * (x0 + x1) / 2; oy = SIZE / 2 + s * (y0 + y1) / 2
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    x = 0
    for n in names:
        tp = TransformPen(pen, (s, 0, 0, -s, ox + s * x, oy))
        gs[n].draw(tp); x += gs[n].width
    return pen.getCommands()

def chip(path):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{RASTER}" height="{RASTER}" viewBox="0 0 {SIZE} {SIZE}">'
            f'<rect x="1" y="1" width="62" height="62" rx="9" fill="#ffffff"/>'
            f'<rect x="3.5" y="3.5" width="57" height="57" rx="7" fill="#111111"/>'
            f'<path d="{path}" fill="#ffffff"/></svg>\n')

if __name__ == "__main__":
    font = TTFont(sys.argv[1]); out = sys.argv[2]; top = int(sys.argv[3]) if len(sys.argv) > 3 else 99
    os.makedirs(out, exist_ok=True)
    for n in range(1, top + 1):
        open(f"{out}/pin-{n}.svg", "w").write(chip(number_path(font, str(n))))
    print(f"{top} pins in {out}")
