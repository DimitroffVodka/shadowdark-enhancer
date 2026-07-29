#!/usr/bin/env python3
"""
Generate the crawl-strip artwork used in README.md and the wiki.

    python3 tools/demo/build-strip-svg.py

Emits three things:

  docs/wiki/images/crawl-strip-animated.svg   the animated hero (SMIL loop)
  docs/wiki/images/strip/card-<id>.svg        one clickable card, x6
  docs/wiki/images/strip/menu-<id>.svg        that card's dropdown panel, x5
  (and prints the markdown block that wires the cards together)

WHY THE SEPARATE CARDS: GitHub filters <script>, <style> and <iframe> out of
markdown (GFM spec 6.11), so the strip's real hover menu cannot run in a
README. `<details>`/`<summary>` survives though, which buys a genuine click.
Putting a card SVG in the summary and its panel SVG in the body gives you the
real interaction — click a portrait, its weapons open underneath — drawn to
look like the module instead of like a markdown table.

  <details>
    <summary><picture><img src="…/card-eliara.svg" width="110"></picture></summary>
    <picture><img src="…/menu-eliara.svg" width="190"></picture>
  </details>

THE <picture> WRAPPER IS LOAD-BEARING. GitHub auto-wraps a bare <img> in an
<a href> pointing at the file, so clicking the card would navigate away instead
of expanding it. An <img> inside <picture> is left unlinked — verified against
GitHub's own /markdown API, which applies the same filters as the site.

THREE CONSTRAINTS on <img>-loaded SVG, all worked around here:
  1. No JavaScript. Nothing needs it.
  2. No external references — portraits and fonts are inlined as data URIs.
  3. Animation uses SMIL, not CSS @keyframes. CSS keyframes *do* animate in a
     browser (measured), but every widely deployed GitHub README animation
     emits SMIL and no <style>, and GitHub's image path cannot be tested from
     here. All static styling is written as presentation attributes so the art
     survives even if a renderer drops <style>; <style> holds only @font-face,
     where being stripped costs a font substitution, not a broken picture.

KNOWN LIMIT: SMIL cannot honour prefers-reduced-motion. The hero loop is slow
and fade-based, with no flashing, for that reason.

LOCAL-ONLY. Needs Pillow and fonttools[woff2]; CI never runs this, it only
consumes the committed SVGs.

Geometry and colours come from styles/shadowdark-enhancer.css read at the FINAL
cascade — the override layer at CSS 7231-7466 wins over the earlier block,
which is why the cards are square and flat with no glow.
"""

import base64
import io
from pathlib import Path

from PIL import Image
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
IMAGES = ROOT / "docs" / "wiki" / "images"
STRIP_DIR = IMAGES / "strip"
VENDOR = ROOT / "demo" / "vendor"

# ── Geometry, from the module's CSS ────────────────────────────────────────
CARD_W, CARD_H = 110, 130
GAP, PAD = 2, 4
TURN_W, LABEL_W, SEP = 36, 30, 2
PANEL_W, ROW_H, TABS_H = 190, 26, 22

# ── Colours, from the final cascade ────────────────────────────────────────
BG, BORDER, ACCENT = "#000000", "#362f37", "#c9aa58"
NPC_BORDER, TEXT, MUTED = "#7a3737", "#f0f0f0", "#9f9275"
TAB_BG, OVERLAY = "#111111", "rgba(0,0,0,0.72)"
HP = {"ok": "#3aaa3a", "mid": "#b8a020", "low": "#c86040", "critical": "#8a1010"}
LIGHT = {"lit": "#ffb347", "mid": "#ffd27a", "low": "#ff7a4a", "off": "rgba(255,255,255,0.55)"}
WALK, OVER = "#60d060", "#ff8a8a"

SANS = "M,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
DISP = "D,Georgia,'Times New Roman',serif"
FA_FIRE, FA_WALK, FA_DOWN = "", "", ""

# The module gives every label sitting on portrait art a heavy text-shadow.
# SVG has no text-shadow, so paint a dark outline underneath instead.
SHADOW = ('paint-order="stroke" stroke="#000" stroke-width="2.6" '
          'stroke-linejoin="round" stroke-opacity=".92"')

CARDS = [
    dict(id="eliara", name="Eliara", img="human.webp", ac=15, hp=(15, 18), hpc="ok", luck=1,
         move="30/30ft", over=False, init=17, light="lit", npc=False,
         tabs=["Weapons", "Spells", "Abilities"],
         items=[("Staff", "(Close) +1 1d4"), ("Dagger (thrown)", "(Near) +4 1d4"),
                ("Dagger", "(Close) +1 1d4")]),
    dict(id="bazogo", name="Bazogo", img="half-orc.webp", ac=16, hp=(14, 22), hpc="mid", luck=1,
         move="20/30ft", over=False, init=12, light="low", npc=False,
         tabs=["Weapons", "Abilities"],
         items=[("Bastard sword", "(Close) +5 1d10"), ("Javelin", "(Far) +3 1d6")]),
    dict(id="willow", name="Willow", img="halfling.webp", ac=13, hp=(3, 13), hpc="critical", luck=0,
         move="30/30ft", over=False, init=15, light="mid", npc=False,
         tabs=["Weapons", "Abilities"],
         items=[("Shortsword", "(Close) +4 1d6"), ("Shortbow", "(Far) +5 1d4")]),
    dict(id="troana", name="Troana", img="elf.webp", ac=12, hp=(9, 10), hpc="ok", luck=2,
         move="-5/30ft", over=True, init=9, light="off", npc=False,
         tabs=["Weapons", "Spells", "Abilities"],
         items=[("Mace", "(Close) +2 1d6"), ("Cure Wounds", "T1"), ("Turn Undead", "T1")]),
    dict(id="goblin", name="Goblin Scout", img="goblin.webp", ac=12, hp=(3, 7), hpc="low", luck=None,
         move="30/30ft", over=False, init=11, light=None, npc=True,
         tabs=["Actions", "Abilities"],
         items=[("×2 Shortsword", "(Close) +1 1d6"), ("Sling", "(Near) +2 1d4")]),
]
TURN = "7"


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def data_uri(raw, mime):
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def subset_font(path, text=None, unicodes=None):
    font = TTFont(str(path))
    opts = subset.Options()
    opts.layout_features = ["kern", "liga"]
    opts.desubroutinize = True
    opts.notdef_outline = False
    sub = subset.Subsetter(options=opts)
    sub.populate(text=text or "", unicodes=unicodes or [])
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    return buf.getvalue()


def font_style(sans_text="", disp_text="", fa=()):
    """A <style> carrying only @font-face, subset to the glyphs actually drawn."""
    faces = []
    if sans_text:
        faces.append(("M", subset_font(VENDOR / "fonts" / "montserrat-500.woff2", text=sans_text)))
    if disp_text:
        faces.append(("D", subset_font(VENDOR / "fonts" / "imfell-english-400.woff2", text=disp_text)))
    if fa:
        faces.append(("FA", subset_font(VENDOR / "fontawesome" / "webfonts" / "fa-solid-900.woff2",
                                        unicodes=[ord(c) for c in fa])))
    return "<style>" + "".join(
        f"@font-face{{font-family:{n};src:url({data_uri(b, 'font/woff2')}) format('woff2')}}"
        for n, b in faces) + "</style>"


_portraits = {}


def portrait(name):
    """Crop to the card's aspect from the top — matches object-position: top."""
    if name in _portraits:
        return _portraits[name]
    im = Image.open(ROOT / "assets" / "ancestries" / name).convert("RGB")
    target = CARD_W / CARD_H
    w, h = im.size
    if w / h > target:
        nw = int(h * target)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        im = im.crop((0, 0, w, int(w / target)))
    im = im.resize((CARD_W * 2, CARD_H * 2), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=82, method=6)
    _portraits[name] = data_uri(buf.getvalue(), "image/webp")
    return _portraits[name]


shamrock = data_uri((ROOT / "icons" / "shamrock.svg").read_bytes(), "image/svg+xml")
# No colour filter on the hood: the class emblems already have gold (#c9a54a)
# baked into their fill. Running the module's .sde-game-icon filter over an
# already-gold source rotates the hue past gold and lands on blue.
hood = data_uri((ROOT / "icons" / "game-icons" / "classes" / "hood.svg").read_bytes(), "image/svg+xml")


def card_glyphs(c):
    """Every character drawn on one card, for a tight font subset."""
    sans = f"{c['name']}AC {c['ac']}{c['hp'][0]}/{c['hp'][1]}{c['move']}{c['luck'] or ''}"
    return sans, str(c["init"]), (FA_FIRE, FA_WALK)


def card_body(c, clip_id):
    """The inside of one card, in card-local coordinates (0,0 to 110,130)."""
    p = [f'<clipPath id="{clip_id}"><rect width="{CARD_W}" height="{CARD_H}"/></clipPath>',
         f'<g clip-path="url(#{clip_id})">',
         f'<image href="{portrait(c["img"])}" width="{CARD_W}" height="{CARD_H}" '
         f'preserveAspectRatio="xMidYMin slice"/>',
         f'<rect width="{CARD_W}" height="18" fill="{OVERLAY}"/>',
         f'<text x="{CARD_W/2}" y="13" font-family="{SANS}" font-size="12" font-weight="700" '
         f'fill="{TEXT}" text-anchor="middle">{esc(c["name"])}</text>',
         f'<rect x="{CARD_W/2-20}" y="20" width="40" height="13" fill="{OVERLAY}" rx="3"/>',
         f'<text x="{CARD_W/2}" y="30" font-family="{SANS}" font-size="10" font-weight="700" '
         f'fill="{TEXT}" text-anchor="middle">AC {c["ac"]}</text>']

    hp, hpmax = c["hp"]
    bar_y = CARD_H - 29
    p += [f'<rect y="{bar_y}" width="{CARD_W}" height="14" fill="rgba(0,0,0,0.65)"/>',
          f'<rect y="{bar_y}" width="{CARD_W*max(0,min(1,hp/hpmax)):.1f}" height="14" fill="{HP[c["hpc"]]}"/>',
          f'<text x="{CARD_W/2}" y="{bar_y+10}" font-family="{SANS}" font-size="10" font-weight="700" '
          f'fill="#fff" text-anchor="middle" {SHADOW}>{hp}/{hpmax}</text>']

    py = CARD_H - 6
    if c["luck"] is not None:
        op = 0.35 if c["luck"] == 0 else 1
        p += [f'<image href="{shamrock}" x="6" y="{py-11}" width="11" height="11" opacity="{op}"/>',
              f'<text x="19" y="{py}" font-family="{SANS}" font-size="11" font-weight="700" '
              f'fill="#fff" opacity="{op}" {SHADOW}>{c["luck"]}</text>']
        mx = CARD_W / 2 + 2
    else:
        mx = 22
    col = OVER if c["over"] else "#fff"
    p += [f'<text x="{mx}" y="{py}" font-family="FA" font-size="10" '
          f'fill="{OVER if c["over"] else WALK}" {SHADOW}>{FA_WALK}</text>',
          f'<text x="{mx+12}" y="{py}" font-family="{SANS}" font-size="11" font-weight="700" '
          f'fill="{col}" {SHADOW}>{esc(c["move"])}</text>']

    if c["light"]:
        p.append(f'<text x="5" y="46" font-family="FA" font-size="13" '
                 f'fill="{LIGHT[c["light"]]}" {SHADOW}>{FA_FIRE}</text>')
    p += [f'<text x="{CARD_W-4}" y="46" font-family="{DISP}" font-size="13" fill="{ACCENT}" '
          f'text-anchor="end" {SHADOW}>{c["init"]}</text>', "</g>"]
    return "".join(p)


def panel_body(c):
    """The dropdown panel, in panel-local coordinates."""
    h = TABS_H + len(c["items"]) * ROW_H + 4
    p = [f'<rect width="{PANEL_W}" height="{h}" fill="{BG}" stroke="{BORDER}"/>',
         f'<rect width="{PANEL_W}" height="{TABS_H}" fill="{TAB_BG}"/>']
    tw = PANEL_W / len(c["tabs"])
    for t, label in enumerate(c["tabs"]):
        p.append(f'<text x="{tw*(t+0.5):.1f}" y="{TABS_H-8}" font-family="{SANS}" font-size="9" '
                 f'letter-spacing=".5" text-anchor="middle" '
                 f'fill="{ACCENT if t == 0 else MUTED}">{esc(label.upper())}</text>')
        if t == 0:
            p.append(f'<rect y="{TABS_H-2}" width="{tw:.1f}" height="2" fill="{ACCENT}"/>')
        else:
            p.append(f'<line x1="{tw*t:.1f}" y1="0" x2="{tw*t:.1f}" y2="{TABS_H}" stroke="{BORDER}"/>')
    for r, (nm, dmg) in enumerate(c["items"]):
        ry = TABS_H + r * ROW_H + 17
        p.append(f'<text x="10" y="{ry}" font-family="{SANS}" font-size="12" fill="{TEXT}">{esc(nm)}</text>')
        p.append(f'<text x="{PANEL_W-10}" y="{ry}" font-family="{SANS}" font-size="11" '
                 f'fill="{ACCENT}" text-anchor="end">{esc(dmg)}</text>')
    return "".join(p), h


# ══ 1. Standalone card SVGs ════════════════════════════════════════════════
STRIP_DIR.mkdir(parents=True, exist_ok=True)
written = []

for c in CARDS:
    sans, disp, fa = card_glyphs(c)
    stroke = NPC_BORDER if c["npc"] else ACCENT
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CARD_W+2} {CARD_H+2}" '
           f'width="{CARD_W+2}" height="{CARD_H+2}" role="img" '
           f'aria-label="{esc(c["name"])}, AC {c["ac"]}, {c["hp"][0]} of {c["hp"][1]} hit points">'
           + font_style(sans, disp, fa)
           + f'<g transform="translate(1,1)">{card_body(c, "k")}'
           + f'<rect width="{CARD_W}" height="{CARD_H}" fill="none" stroke="{stroke}" stroke-width="1"/>'
           + "</g></svg>")
    (STRIP_DIR / f"card-{c['id']}.svg").write_text(svg, encoding="utf-8")
    written.append((f"card-{c['id']}.svg", len(svg.encode())))

# The GM card, for the end of the row
gm = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CARD_W+2} {CARD_H+2}" '
      f'width="{CARD_W+2}" height="{CARD_H+2}" role="img" aria-label="Game Master">'
      + font_style("Game Master")
      + f'<g transform="translate(1,1)">'
      + f'<rect width="{CARD_W}" height="{CARD_H}" fill="{BG}" stroke="{ACCENT}"/>'
      + f'<rect width="{CARD_W}" height="18" fill="{OVERLAY}"/>'
      + f'<text x="{CARD_W/2}" y="13" font-family="{SANS}" font-size="12" font-weight="700" '
      f'fill="{TEXT}" text-anchor="middle">Game Master</text>'
      + f'<image href="{hood}" x="20" y="30" width="70" height="70"/></g></svg>')
(STRIP_DIR / "card-gm.svg").write_text(gm, encoding="utf-8")
written.append(("card-gm.svg", len(gm.encode())))

# ══ 2. Standalone menu SVGs ════════════════════════════════════════════════
for c in CARDS:
    body, h = panel_body(c)
    glyphs = "".join(t + t.upper() for t in c["tabs"]) + "".join(n + d for n, d in c["items"])
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {PANEL_W+2} {h+2}" '
           f'width="{PANEL_W+2}" height="{h+2}" role="img" '
           f'aria-label="{esc(c["name"])} action menu: '
           f'{esc(", ".join(n + " " + d for n, d in c["items"]))}">'
           + font_style(glyphs)
           + f'<g transform="translate(1,1)">{body}</g></svg>')
    (STRIP_DIR / f"menu-{c['id']}.svg").write_text(svg, encoding="utf-8")
    written.append((f"menu-{c['id']}.svg", len(svg.encode())))

# ══ 3. The animated hero ═══════════════════════════════════════════════════
members_x = TURN_W + SEP + LABEL_W + SEP
SLOTS = len(CARDS) + 1          # the GM card occupies a slot too
strip_w = members_x + PAD + SLOTS * CARD_W + (SLOTS - 1) * GAP + PAD
strip_h = PAD + CARD_H + PAD
N = len(CARDS)
menu_h = TABS_H + max(len(c["items"]) for c in CARDS) * ROW_H + 4
svg_w, svg_h = strip_w + 2, strip_h + 4 + menu_h + 6
DUR = 2.6 * N
FADE = 0.012


def card_x(i):
    return members_x + PAD + i * (CARD_W + GAP)


def slice_times(i):
    a, b = i / N, (i + 1) / N
    t = [0.0, a, min(a + FADE, b), max(b - FADE, a), b, 1.0]
    for k in range(1, len(t)):
        t[k] = max(t[k], t[k - 1])
    return ";".join(f"{v:.4f}" for v in t)


def smil(attr, values, i):
    return (f'<animate attributeName="{attr}" values="{values}" keyTimes="{slice_times(i)}" '
            f'dur="{DUR}s" repeatCount="indefinite" calcMode="linear"/>')


all_sans = TURN + "PARTYGame Master0123456789"
all_disp = "PARTY" + TURN
for c in CARDS:
    s, d, _ = card_glyphs(c)
    all_sans += s + "".join(t + t.upper() for t in c["tabs"]) + "".join(n + x for n, x in c["items"])
    all_disp += d

parts = [
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" width="{svg_w}" '
    f'height="{svg_h}" role="img" aria-label="The Shadowdark Enhancer crawl strip: a party of '
    f'five plus the Game Master, each card showing hit points, armour class, Luck and movement, '
    f'with the weapon menu opening under each portrait in turn.">',
    font_style(all_sans, all_disp, (FA_FIRE, FA_WALK, FA_DOWN)),
    '<g transform="translate(1,1)">',
    f'<rect width="{strip_w}" height="{strip_h}" fill="{BG}" stroke="{BORDER}"/>',
    f'<line x1="{TURN_W}" y1="0" x2="{TURN_W}" y2="{strip_h}" stroke="{BORDER}" stroke-width="{SEP}"/>',
    f'<text x="{TURN_W/2}" y="{strip_h/2-4}" font-family="{DISP}" font-size="18" fill="{ACCENT}" '
    f'text-anchor="middle">{TURN}</text>',
    f'<text x="{TURN_W/2}" y="{strip_h/2+16}" font-family="FA" font-size="11" fill="{ACCENT}" '
    f'text-anchor="middle">{FA_DOWN}</text>',
    f'<line x1="{TURN_W+SEP+LABEL_W}" y1="0" x2="{TURN_W+SEP+LABEL_W}" y2="{strip_h}" '
    f'stroke="{BORDER}" stroke-width="{SEP}"/>',
    f'<text transform="translate({TURN_W+SEP+LABEL_W/2+6},{strip_h/2}) rotate(-90)" '
    f'font-family="{DISP}" font-size="17" fill="{ACCENT}" letter-spacing="1.2" '
    f'text-anchor="middle">PARTY</text>',
]

for i, c in enumerate(CARDS):
    base = NPC_BORDER if c["npc"] else ACCENT
    hi = "#c86a6a" if c["npc"] else "#f0d896"
    parts += [f'<g transform="translate({card_x(i)},{PAD})">', card_body(c, f"k{i}"),
              f'<rect width="{CARD_W}" height="{CARD_H}" fill="none" stroke="{base}" stroke-width="1">',
              smil("stroke", f"{base};{base};{hi};{hi};{base};{base}", i),
              smil("stroke-width", "1;1;2;2;1;1", i), "</rect></g>"]

parts += [f'<g transform="translate({card_x(len(CARDS))},{PAD})">',
          f'<rect width="{CARD_W}" height="{CARD_H}" fill="{BG}" stroke="{ACCENT}"/>',
          f'<rect width="{CARD_W}" height="18" fill="{OVERLAY}"/>',
          f'<text x="{CARD_W/2}" y="13" font-family="{SANS}" font-size="12" font-weight="700" '
          f'fill="{TEXT}" text-anchor="middle">Game Master</text>',
          f'<image href="{hood}" x="20" y="30" width="70" height="70"/></g></g>']

for i, c in enumerate(CARDS):
    body, h = panel_body(c)
    parts += [f'<g transform="translate({1+card_x(i)},{1+strip_h+2})" opacity="0">',
              smil("opacity", "0;0;1;1;0;0", i), body, "</g>"]

cy = PAD + CARD_H * 0.55
pts, times = [], []
for i in range(N):
    a, b = i / N, (i + 1) / N
    x = 1 + card_x(i) + CARD_W * 0.5
    pts += [f"{x:.0f},{cy:.0f}", f"{x:.0f},{cy:.0f}"]
    times += [f"{a:.4f}", f"{max(b - 0.35/N, a):.4f}"]
pts.append(f"{1+card_x(0)+CARD_W*0.5:.0f},{cy:.0f}")
times.append("1.0000")
parts.append(f'<path d="M0,0 L0,13 L3.4,10 L5.7,15 L8,14 L5.6,9.3 L10,9 Z" fill="#fff" '
             f'stroke="#000" stroke-width="1.2"><animateTransform attributeName="transform" '
             f'type="translate" values="{";".join(pts)}" keyTimes="{";".join(times)}" '
             f'dur="{DUR}s" repeatCount="indefinite" calcMode="linear"/></path></svg>')

hero = "".join(parts)
(IMAGES / "crawl-strip-animated.svg").write_text(hero, encoding="utf-8")

# ══ 4. The markdown block ══════════════════════════════════════════════════
REL = "docs/wiki/images/strip"
md = ["<table><tr>"]
for c in CARDS:
    md.append(
        f'<td valign="top"><details>'
        f'<summary><picture><img src="{REL}/card-{c["id"]}.svg" width="110" '
        f'alt="{esc(c["name"])} — click to open"></picture></summary>'
        f'<picture><img src="{REL}/menu-{c["id"]}.svg" width="190" '
        f'alt="{esc(c["name"])} action menu"></picture>'
        f'</details></td>')
md.append(f'<td valign="top"><picture><img src="{REL}/card-gm.svg" width="110" '
          f'alt="Game Master"></picture></td>')
md.append("</tr></table>")
(STRIP_DIR / "_snippet.md").write_text("\n".join(md) + "\n", encoding="utf-8")

print(f"hero  crawl-strip-animated.svg  {len(hero.encode())/1024:6.1f} KB  {svg_w}x{svg_h}  {DUR:.0f}s loop")
for name, size in written:
    print(f"      strip/{name:<22} {size/1024:6.1f} KB")
print(f"\nmarkdown snippet -> {(STRIP_DIR / '_snippet.md').relative_to(ROOT)}")
