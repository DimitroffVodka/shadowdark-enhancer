"""Bastion upgrades B: casino, dungeon, granary, idol, infirmary."""
import math

from bastion_lib import *  # noqa: F401,F403

specs: dict[str, dict[str, str]] = {}

GOLD, GOLD_L, GOLD_D = "#D9A83F", "#EAC862", "#A97E2A"
RED, RED_D = "#A8423C", "#7D2F2B"
CREAM = "#E6D9B5"
IRON, IRON_L = "#4D4B47", "#6C6C74"
DARK = "#1d1a18"


def coin(x, y, rx=9, ry=4, fill=GOLD_L):
    return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{fill}" stroke-width="1.2"/>'


def coin_stack(x, y, n, fill=GOLD_L, rx=9, ry=4):
    return "".join(coin(x, y - 3 * i, rx, ry, fill) for i in range(n))


def sack(x, y, w=34, h=36, fill="#D8C9A3"):
    """A grain sack: bulging body, tied neck, stitched seam."""
    return f'''
    <path d="M{x-w/2:.1f} {y+h} Q{x-w/2-5:.1f} {y+h*0.5:.1f} {x-w*0.28:.1f} {y+h*0.28:.1f} L{x-w*0.13:.1f} {y+h*0.1:.1f} Q{x} {y+h*0.02:.1f} {x+w*0.13:.1f} {y+h*0.1:.1f} L{x+w*0.28:.1f} {y+h*0.28:.1f} Q{x+w/2+5:.1f} {y+h*0.5:.1f} {x+w/2:.1f} {y+h} Q{x} {y+h+7} {x-w/2:.1f} {y+h} Z" fill="{fill}" stroke-width="1.7"/>
    <path d="M{x-w*0.13:.1f} {y+h*0.18:.1f} Q{x} {y+h*0.26:.1f} {x+w*0.13:.1f} {y+h*0.18:.1f}" fill="none" stroke-width="1.8"/>
    <path d="M{x-w*0.12:.1f} {y+h*0.1:.1f} L{x-w*0.2:.1f} {y-2:.1f} L{x} {y+h*0.04:.1f} L{x+w*0.2:.1f} {y-2:.1f} L{x+w*0.12:.1f} {y+h*0.1:.1f}" fill="{fill}" stroke-width="1.5"/>
    <path d="M{x-w*0.2:.1f} {y+h*0.62:.1f} Q{x} {y+h*0.72:.1f} {x+w*0.2:.1f} {y+h*0.6:.1f}" fill="none" stroke-width="0.9" opacity="0.55"/>
'''


def lantern(x, y, fill="#E8B64B"):
    return f'''
    <path d="M{x} {y-12} V{y-8}" fill="none" stroke-width="1.3"/>
    <path d="M{x-4} {y-8} H{x+4} L{x+2} {y-11} H{x-2} Z" fill="{IRON}" stroke-width="1.2"/>
    <ellipse cx="{x}" cy="{y}" rx="6.5" ry="8" fill="{fill}" stroke-width="1.4"/>
    <path d="M{x-3} {y-6} Q{x-4} {y} {x-2} {y+5}" fill="none" stroke="#FFF1B8" stroke-width="1.4" opacity="0.8"/>
    <path d="M{x-3} {y+8} H{x+3} V{y+10} H{x-3} Z" fill="{IRON}" stroke-width="1"/>
'''


def menhir(x, y, h, w=34, fill=STONE_L):
    """A rough standing stone with a shaded flank and a moss patch."""
    pts = [(-w/2, 0), (-w*0.56, -h*0.42), (-w*0.4, -h*0.86), (-w*0.08, -h), (w*0.3, -h*0.9), (w*0.5, -h*0.5), (w/2, 0)]
    d = "M" + " L".join(f"{x+px:.1f} {y+py:.1f}" for px, py in pts) + " Z"
    shade = f"M{x+w*0.1:.1f} {y-h*0.97:.1f} L{x+w*0.3:.1f} {y-h*0.9:.1f} L{x+w*0.5:.1f} {y-h*0.5:.1f} L{x+w/2:.1f} {y:.1f} H{x+w*0.12:.1f} L{x+w*0.2:.1f} {y-h*0.5:.1f} Z"
    return f'''
    <path d="{d}" fill="{fill}" stroke-width="2"/>
    <path d="{d}" fill="url(#leanHatch)" stroke="none"/>
    <path d="{shade}" fill="{STONE_D}" stroke="none" opacity="0.55"/>
    <path d="M{x-w*0.5:.1f} {y-h*0.06:.1f} Q{x-w*0.2:.1f} {y-h*0.2:.1f} {x+w*0.1:.1f} {y-h*0.08:.1f} L{x+w*0.3:.1f} {y:.1f} H{x-w/2:.1f} Z" fill="#6F8A5F" stroke="none" opacity="0.8"/>
    <path d="M{x-w*0.12:.1f} {y-h*0.7:.1f} v{h*0.16:.1f} m{-5} {-h*0.08:.1f} h10" fill="none" stroke-width="1.2" opacity="0.6"/>
'''


# ====================================================================== CASINO
# Gaudy gambling hall: striped red/cream roof carrying a giant die and a
# roulette wheel, scalloped awning over an open front that shows a green-felt
# card table, a lantern string with a coin-sign, and a heap of gold out front.
def stripes(x0, x1, y0, y1, n, a=RED, b=CREAM):
    w = (x1 - x0) / n
    return "".join(
        f'    <path d="M{x0+i*w:.1f} {y0} H{x0+(i+1)*w:.1f} V{y1} H{x0+i*w:.1f} Z" fill="{a if i % 2 == 0 else b}" stroke="none"/>\n'
        for i in range(n)
    )


def wheel(cx, cy, r):
    out = [f'    <g transform="translate({cx} {cy}) scale(1 0.8)">',
           f'      <circle cx="0" cy="7" r="{r}" fill="{WOOD_D}" stroke-width="2"/>',
           f'      <circle cx="0" cy="0" r="{r}" fill="{WOOD_M}" stroke-width="2.2"/>',
           f'      <circle cx="0" cy="0" r="{r-6}" fill="#2a2226" stroke-width="1.4"/>']
    n = 12
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        rr = r - 8
        col = "#4F8A5B" if i == 0 else (RED if i % 2 else "#2a2226")
        out.append(f'      <path d="M0 0 L{rr*math.cos(a0):.1f} {rr*math.sin(a0):.1f} A{rr} {rr} 0 0 1 {rr*math.cos(a1):.1f} {rr*math.sin(a1):.1f} Z" fill="{col}" stroke-width="0.9"/>')
    out += [f'      <circle cx="0" cy="0" r="{r*0.42:.1f}" fill="{GOLD}" stroke-width="1.6"/>',
            f'      <circle cx="0" cy="0" r="{r*0.2:.1f}" fill="{GOLD_L}" stroke-width="1.3"/>',
            f'      <path d="M0 {-r*0.42:.1f} V{r*0.42:.1f} M{-r*0.42:.1f} 0 H{r*0.42:.1f}" fill="none" stroke-width="1.6"/>',
            f'      <circle cx="{r*0.66:.1f}" cy="{-r*0.34:.1f}" r="3" fill="#F4EEDC" stroke-width="1"/>',
            '    </g>']
    return "\n".join(out) + "\n"


def die(cx, cy, s=1.0):
    def p(a, b):
        return f"{cx + a*s:.1f} {cy + b*s:.1f}"
    return f'''
    <path d="M{p(0,-30)} L{p(26,-16)} L{p(0,-2)} L{p(-26,-16)} Z" fill="#C0524B" stroke-width="2"/>
    <path d="M{p(-26,-16)} L{p(0,-2)} L{p(0,30)} L{p(-26,14)} Z" fill="{RED}" stroke-width="2"/>
    <path d="M{p(0,-2)} L{p(26,-16)} L{p(26,14)} L{p(0,30)} Z" fill="{RED_D}" stroke-width="2"/>
    <g fill="#F4EEDC" stroke-width="1">
      <ellipse cx="{cx-6*s:.1f}" cy="{cy-19*s:.1f}" rx="3.2" ry="1.7"/><ellipse cx="{cx+6*s:.1f}" cy="{cy-13*s:.1f}" rx="3.2" ry="1.7"/>
      <ellipse cx="{cx-14*s:.1f}" cy="{cy-1*s:.1f}" rx="2.6" ry="3"/><ellipse cx="{cx-7*s:.1f}" cy="{cy+13*s:.1f}" rx="2.6" ry="3"/>
      <ellipse cx="{cx+8*s:.1f}" cy="{cy+4*s:.1f}" rx="2.6" ry="3"/><ellipse cx="{cx+13*s:.1f}" cy="{cy+9*s:.1f}" rx="2.6" ry="3"/><ellipse cx="{cx+18*s:.1f}" cy="{cy-1*s:.1f}" rx="2.6" ry="3"/>
      <ellipse cx="{cx+10*s:.1f}" cy="{cy+19*s:.1f}" rx="2.6" ry="3"/>
    </g>
'''


def qpt(p0, p1, p2, t):
    return tuple((1 - t) ** 2 * a + 2 * t * (1 - t) * b + t * t * c for a, b, c in zip(p0, p1, p2))


S0, S1, S2 = (62, 76), (256, 126), (450, 76)
lanterns = "".join(
    lantern(round(qpt(S0, S1, S2, t)[0]), round(qpt(S0, S1, S2, t)[1]) + 13, c)
    for t, c in ((0.1, "#E8B64B"), (0.22, "#D9625A"), (0.34, "#7FC4B2"), (0.66, "#7FC4B2"), (0.78, "#D9625A"), (0.9, "#E8B64B"))
)

awning = "".join(
    f'    <path d="M{142+i*28.5:.1f} 246 H{142+(i+1)*28.5:.1f} V268 Q{142+(i+0.5)*28.5:.1f} 286 {142+i*28.5:.1f} 268 Z" fill="{RED if i % 2 == 0 else CREAM}" stroke-width="1.8"/>\n'
    for i in range(8)
)

body = f'''
    <!-- Lantern poles with the string between them. -->
    <path d="M56 70 H68 V346 H56 Z M444 70 H456 V346 H444 Z" fill="{WOOD_D}" stroke-width="2"/>
    <path d="M52 66 H72 V76 H52 Z M440 66 H460 V76 H440 Z" fill="{GOLD}" stroke-width="1.8"/>
    <path d="M{S0[0]} {S0[1]} Q{S1[0]} {S1[1]} {S2[0]} {S2[1]}" fill="none" stroke-width="2"/>
{lanterns}
    <!-- Coin sign hanging from the string. -->
    <path d="M238 102 V112 M274 102 V112" fill="none" stroke-width="1.6"/>
    <path d="M222 112 H290 V142 H222 Z" fill="#7A2F2A" stroke-width="2.2"/>
    <path d="M227 117 H285 V137 H227 Z" fill="none" stroke="{GOLD}" stroke-width="1.6"/>
    <circle cx="256" cy="127" r="8" fill="{GOLD_L}" stroke-width="1.6"/><circle cx="256" cy="127" r="4.2" fill="none" stroke-width="1.2"/>
    <circle cx="238" cy="127" r="4" fill="{GOLD_L}" stroke-width="1.2"/><circle cx="274" cy="127" r="4" fill="{GOLD_L}" stroke-width="1.2"/>
    <!-- Hall: plum-painted wall strip behind everything. -->
    <path d="M110 250 H402 L396 342 H116 Z" fill="#7A4A6A" stroke-width="2.2"/>
    <path d="M110 256 H402" fill="none" stroke="{GOLD}" stroke-width="2.4"/>
    <!-- Open front: dark hall with a felt card table, chips, cards and punters. -->
    <path d="M158 262 H354 V338 H158 Z" fill="#1f171c" stroke-width="2"/>
    <path d="M158 262 H354 V296 H158 Z" fill="#33262e" stroke="none"/>
    <path d="M184 304 Q186 286 200 286 Q214 286 216 304 Z" fill="#46333f" stroke-width="1.4"/><circle cx="200" cy="279" r="8" fill="#B08A68" stroke-width="1.4"/>
    <path d="M296 304 Q298 286 312 286 Q326 286 328 304 Z" fill="#46333f" stroke-width="1.4"/><circle cx="312" cy="279" r="8" fill="#B08A68" stroke-width="1.4"/>
    <path d="M238 298 Q239 281 256 281 Q273 281 274 298 Z" fill="#2d6a5b" stroke-width="1.4"/><circle cx="256" cy="274" r="7" fill="#B08A68" stroke-width="1.4"/>
    <path d="M247 268 H265 V258 H247 Z M243 268 H269" fill="#2a2226" stroke-width="1.4"/>
    <path d="M168 318 Q256 340 344 318 V330 Q256 352 168 330 Z" fill="{WOOD_D}" stroke-width="1.8"/>
    <ellipse cx="256" cy="316" rx="88" ry="16" fill="#4F8A5B" stroke-width="1.9"/>
    <ellipse cx="256" cy="316" rx="66" ry="10.5" fill="none" stroke="#7DB487" stroke-width="1" opacity="0.7"/>
    <g stroke-width="1.1">
      {coin_stack(218, 316, 4, "#C8483F", 7, 2.8)}{coin_stack(232, 320, 5, "#2a2226", 7, 2.8)}{coin_stack(286, 319, 3, "#F4EEDC", 7, 2.8)}{coin_stack(302, 314, 2, "#C8483F", 7, 2.8)}
    </g>
    <path d="M250 308 L264 305 L267 316 L253 319 Z M258 308 L272 311 L268 322 L254 319 Z" fill="#F4EEDC" stroke-width="1.1"/>
    <path d="M150 262 H162 V340 H150 Z M350 262 H362 V340 H350 Z" fill="{GOLD_D}" stroke-width="1.8"/>
    <!-- Scalloped awning over the opening. -->
{awning}
    <path d="M142 244 H370 V250 H142 Z" fill="{GOLD}" stroke-width="1.8"/>
    <!-- Roof: gaudy red/cream stripes with hatch and a darker lower slope. -->
{stripes(98, 414, 140, 250, 8)}
    <path d="M98 195 H414 V250 H98 Z" fill="#010206" opacity="0.1" stroke="none"/>
    <path d="M98 140 H414 V250 H98 Z" fill="url(#roofHatch)" stroke="none"/>
    <path d="M98 140 H414 V250 H98 Z" fill="none" stroke-width="2.8"/>
    <path d="M98 195 C180 192 330 198 414 195" fill="none" stroke-width="3"/>
    <path d="M98 188 H414 V202 H98 Z" fill="{GOLD}" stroke-width="1.8"/>
    <g fill="{GOLD_L}" stroke-width="1.2">
      <circle cx="122" cy="195" r="4"/><circle cx="162" cy="195" r="4"/><circle cx="202" cy="195" r="4"/><circle cx="242" cy="195" r="4"/><circle cx="282" cy="195" r="4"/><circle cx="322" cy="195" r="4"/><circle cx="362" cy="195" r="4"/><circle cx="394" cy="195" r="4"/>
    </g>
{pegs(98, 140, 316, 110)}
    <!-- Giant die and roulette wheel perched on the roof. -->
{die(156, 170, 1.15)}
{wheel(356, 176, 36)}
    <!-- Front: heap of gold left, spilled chest right, dice and cards between. -->
    <g transform="translate(0 14)">
    <path d="M70 420 Q76 384 110 372 Q130 358 152 372 Q196 384 204 420 Z" fill="{GOLD}" stroke-width="2"/>
    <path d="M110 372 Q130 358 152 372 Q172 380 186 398 Q150 388 110 372 Z" fill="{GOLD_L}" stroke="none"/>
    <g stroke-width="1.1">
      {"".join(coin(x, y, 8, 3.6) for x, y in ((98,402),(116,392),(134,382),(150,390),(168,398),(112,410),(130,402),(148,408),(168,412),(186,410),(86,414),(122,420)))}
    </g>
    <g stroke-width="1.1">{coin_stack(60, 424, 4, GOLD_L, 8, 3.4)}{coin_stack(212, 428, 3, GOLD_L, 8, 3.4)}</g>
    <path d="M322 380 L332 360 H410 L420 380 Z" fill="#6D4E3B" stroke-width="2"/>
    <path d="M326 384 H416 V426 H326 Z" fill="#8F6F52" stroke-width="2"/>
    <path d="M326 394 H416 M326 416 H416" fill="none" stroke="{GOLD_D}" stroke-width="3"/>
    <path d="M326 384 H416 V396 H326 Z" fill="#2a1f19" stroke="none" opacity="0.35"/>
    <path d="M338 384 Q346 366 372 366 Q398 366 406 384 Z" fill="{GOLD}" stroke-width="1.8"/>
    <g stroke-width="1.1">{"".join(coin(x, y, 8, 3.6) for x, y in ((350,376),(368,370),(386,374),(358,382),(396,382)))}</g>
    <circle cx="371" cy="404" r="5" fill="{GOLD_D}" stroke-width="1.5"/>
    <path d="M360 440 L378 432 L384 448 L366 454 Z" fill="#F4EEDC" stroke-width="1.5"/>
    <path d="M372 436 l3 8" fill="none" stroke="{RED}" stroke-width="1.8"/>
    <path d="M240 392 L262 388 L266 410 L244 414 Z" fill="#F4EEDC" stroke-width="1.5"/>
    <path d="M262 388 L280 394 L276 414 L266 410 Z" fill="#F4EEDC" stroke-width="1.5"/>
    <path d="M246 396 q4 -6 8 0 q4 -6 8 0 q-4 8 -8 12 q-4 -4 -8 -12 Z" fill="{RED}" stroke-width="1"/>
    <path d="M214 418 L228 410 L242 420 L228 430 Z" fill="#C0524B" stroke-width="1.6"/>
    <path d="M228 430 L242 420 V430 L228 440 Z" fill="{RED_D}" stroke-width="1.6"/>
    <path d="M214 418 L228 430 V440 L214 428 Z" fill="{RED}" stroke-width="1.6"/>
    <g fill="#F4EEDC" stroke-width="0.8"><circle cx="228" cy="420" r="2"/><circle cx="222" cy="431" r="1.7"/><circle cx="235" cy="432" r="1.7"/></g>
    </g>
'''
shadow = '''    <path d="M52 66 H72 V346 H52 Z M440 66 H460 V346 H440 Z"/>
    <path d="M98 140 H414 V250 H402 L396 342 H116 L110 250 H98 Z"/>
    <path d="M70 386 H204 V444 H70 Z"/>
    <path d="M322 374 H420 V440 H322 Z"/>
'''
specs["casino"] = {"title": "Casino", "desc": "Gaudy gambling hall with striped roof, giant die, roulette wheel, card table and coin hoard.", "body": body, "shadow": shadow}

# ===================================================================== DUNGEON
# Surface works of an underground prison: a stone bunker gatehouse dug into a
# dirt mound with an iron-bound door and steps down, a barred floor grate, a
# crank winch and bucket, a shackle post with chains, and a collapsed tunnel.
body = f'''
    <!-- Dirt mound the gatehouse is dug into. -->
    <path d="M96 340 C92 230 160 126 256 122 C352 126 420 230 416 340 Z" fill="{DIRT}" stroke-width="2.2"/>
    <path d="M96 340 C92 230 160 126 256 122 C352 126 420 230 416 340 Z" fill="url(#leanHatch)" stroke="none"/>
    <path d="M150 178 C170 150 210 134 256 132 C230 150 190 162 150 178 Z" fill="#C9BDA0" stroke="none"/>
    <g fill="{STONE_D}" stroke-width="1.5"><ellipse cx="128" cy="270" rx="9" ry="6"/><ellipse cx="392" cy="262" rx="11" ry="7"/><ellipse cx="402" cy="296" rx="7" ry="5"/><ellipse cx="116" cy="302" rx="7" ry="5"/></g>
{tuft(176, 160)}{tuft(318, 150)}{tuft(352, 190)}{tuft(150, 214)}
    <!-- Iron air-shaft stack poking out of the mound. -->
    <path d="M300 126 V92 H316 V126 Z" fill="{IRON}" stroke-width="2"/>
    <path d="M294 92 H322 L316 82 H300 Z" fill="{IRON_L}" stroke-width="1.8"/>
    <path d="M300 104 H316 M300 114 H316" fill="none" stroke="{DARK}" stroke-width="1.2" opacity="0.7"/>
    <!-- Gatehouse top: stone slab roof with parapet, a ring-hatch and a crow. -->
    <path d="M146 176 H366 V214 H146 Z" fill="{STONE_L}" stroke-width="2.4"/>
    <path d="M146 176 H366 V214 H146 Z" fill="url(#stoneHatch)" stroke="none"/>
{merlons(146, 162, 220, 8, 14)}
    <path d="M218 186 H252 V206 H218 Z" fill="{IRON}" stroke-width="1.8"/>
    <path d="M222 190 H248 V202 H222 Z" fill="#2a2724" stroke="none"/>
    <circle cx="235" cy="196" r="3.4" fill="none" stroke="{IRON_L}" stroke-width="1.8"/>
    <!-- Gatehouse face. -->
{stone_face(152, 214, 208, 122, STONE, 5)}
    <path d="M152 214 H162 L166 336 H157 Z M350 214 H360 L355 336 H346 Z" fill="{STONE_D}" stroke-width="1.6" opacity="0.8"/>
    <path d="M152 268 H360 M154 306 H358" fill="none" stroke-width="1.5" opacity="0.5"/>
    <!-- Arched doorway: voussoir ring, dark stair-well, swung-open iron-bound leaves. -->
    <path d="M200 336 V274 Q200 238 256 238 Q312 238 312 274 V336 Z" fill="{STONE_L}" stroke-width="2.2"/>
    <path d="M200 336 V274 Q200 238 256 238 Q312 238 312 274 V336 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M207 274 L200 270 M214 258 L208 252 M228 246 L224 238 M256 244 V238 M284 246 L288 238 M298 258 L304 252 M305 274 L312 270" fill="none" stroke-width="1.6"/>
    <path d="M250 232 H262 L260 244 H252 Z" fill="{STONE_D}" stroke-width="1.6"/>
    <path d="M214 336 V278 Q214 254 256 254 Q298 254 298 278 V336 Z" fill="{DARK}" stroke-width="2"/>
    <path d="M222 326 H290 M224 314 H288 M227 303 H285 M230 293 H282" fill="none" stroke="#4a443b" stroke-width="2.6"/>
    <path d="M222 326 H290 V336 H222 Z" fill="#6A655A" stroke-width="1.5"/>
    <path d="M214 264 L184 276 V330 L214 336 Z" fill="{WOOD_M}" stroke-width="2"/>
    <path d="M298 264 L328 276 V330 L298 336 Z" fill="{WOOD_M}" stroke-width="2"/>
    <g fill="none" stroke="{IRON}" stroke-width="5"><path d="M214 274 L184 284 M214 296 L184 304 M214 318 L184 324 M298 274 L328 284 M298 296 L328 304 M298 318 L328 324"/></g>
    <g fill="{IRON_L}" stroke-width="1"><circle cx="196" cy="283" r="2"/><circle cx="206" cy="280" r="2"/><circle cx="196" cy="304" r="2"/><circle cx="206" cy="301" r="2"/><circle cx="316" cy="283" r="2"/><circle cx="306" cy="280" r="2"/><circle cx="316" cy="304" r="2"/><circle cx="306" cy="301" r="2"/></g>
    <circle cx="190" cy="314" r="4" fill="none" stroke="{IRON_L}" stroke-width="2"/><circle cx="322" cy="314" r="4" fill="none" stroke="{IRON_L}" stroke-width="2"/>
    <!-- Carved skull over the arch and torch sconces either side. -->
    <path d="M244 224 Q244 214 256 214 Q268 214 268 224 Q268 230 263 232 V236 H249 V232 Q244 230 244 224 Z" fill="#E6DFCB" stroke-width="1.5"/>
    <path d="M249 223 h4 v4 h-4 Z M259 223 h4 v4 h-4 Z" fill="{DARK}" stroke="none"/>
    <path d="M176 262 V286 M334 262 V286" fill="none" stroke="{IRON}" stroke-width="3"/>
    <path d="M170 262 H182 L180 270 H172 Z M328 262 H340 L338 270 H330 Z" fill="{IRON}" stroke-width="1.4"/>
    <path d="M176 262 C168 256 172 248 176 242 C180 250 186 254 182 260 Z M334 262 C326 256 330 248 334 242 C338 250 344 254 340 260 Z" fill="#E08A33" stroke-width="1.2"/>
    <path d="M176 260 C173 256 175 251 176 248 C178 253 180 256 179 259 Z M334 260 C331 256 333 251 334 248 C336 253 338 256 337 259 Z" fill="#F4D36B" stroke="none"/>
    <!-- Buttresses, wall cracks and a pale stain of old damp. -->
    <path d="M138 214 H152 L156 342 H134 Z M360 214 H374 L378 342 H356 Z" fill="{STONE_D}" stroke-width="2"/>
    <path d="M138 214 H152 L156 342 H134 Z M360 214 H374 L378 342 H356 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M162 222 L168 240 L160 254 L166 270 M346 226 L340 244 L348 258 L342 276" fill="none" stroke-width="1.3" opacity="0.7"/>
    <path d="M168 222 Q176 236 170 250 L186 250 Q192 236 188 222 Z" fill="#6F8A5F" stroke="none" opacity="0.5"/>
    <!-- Threshold. -->
    <path d="M180 336 H332 L342 350 H170 Z" fill="#9A978D" stroke-width="1.8"/>
    <path d="M180 336 H332 L342 350 H170 Z" fill="url(#stoneHatch)" stroke="none"/>
    <!-- Crank winch: A-frame, drum, handle, rope and bucket. -->
    <g transform="translate(-8 24)">
    <path d="M52 374 H160 V384 H52 Z" fill="{WOOD_D}" stroke-width="1.8"/>
    <path d="M60 374 L68 262 H82 L74 374 Z M138 374 L130 262 H144 L152 374 Z" fill="{WOOD_M}" stroke-width="2"/>
    <path d="M72 336 H140" fill="none" stroke-width="3"/>
    <path d="M64 262 H148 V288 H64 Z" fill="{WOOD_L}" stroke-width="2"/>
    <path d="M64 262 H148 V288 H64 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M86 262 V288 M106 262 V288 M126 262 V288" fill="none" stroke="#5F4F40" stroke-width="2" opacity="0.8"/>
    <path d="M148 275 H166 L174 258" fill="none" stroke="{IRON}" stroke-width="4.4"/>
    <path d="M170 248 H180 V268 H170 Z" fill="{WOOD_D}" stroke-width="1.8"/>
    <path d="M106 288 V344" fill="none" stroke="#6A5640" stroke-width="3.2"/>
    <path d="M106 288 V344" fill="none" stroke-width="0.8"/>
    <path d="M94 344 H118 L114 366 H98 Z" fill="{IRON}" stroke-width="1.8"/>
    <path d="M94 344 Q106 330 118 344" fill="none" stroke-width="2"/>
    <path d="M95 352 H117" fill="none" stroke="{IRON_L}" stroke-width="1.3"/>
    </g>
    <!-- Barred floor grate with something pale glimpsed below. -->
    <path d="M190 378 H322 L332 432 H180 Z" fill="{STONE_D}" stroke-width="2.2"/>
    <path d="M190 378 H322 L332 432 H180 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M202 388 H310 L316 422 H196 Z" fill="#0e0c0b" stroke-width="2"/>
    <path d="M214 410 Q236 404 258 410 Q282 404 300 410 V422 H214 Z" fill="#241f1b" stroke="none"/>
    <path d="M240 414 Q240 406 252 406 Q264 406 264 414 Q264 418 260 420 V422 H244 V420 Q240 418 240 414 Z" fill="#CFC8B4" stroke-width="1.2"/>
    <path d="M246 411 h4 v4 h-4 Z M255 411 h4 v4 h-4 Z" fill="{DARK}" stroke="none"/>
    <path d="M220 388 V422 M238 388 V422 M256 388 V422 M274 388 V422 M292 388 V422" fill="none" stroke="{IRON_L}" stroke-width="4"/>
    <path d="M206 404 H312" fill="none" stroke="{IRON_L}" stroke-width="3.4"/>
    <g fill="{IRON}" stroke-width="1"><circle cx="220" cy="404" r="2.4"/><circle cx="256" cy="404" r="2.4"/><circle cx="292" cy="404" r="2.4"/></g>
    <!-- Shackle post with hanging chains and cuffs. -->
    <path d="M350 432 H378 L374 440 H354 Z" fill="{STONE_D}" stroke-width="1.6"/>
    <path d="M356 434 V348 H372 V434 Z" fill="{WOOD_M}" stroke-width="2.2"/>
    <path d="M356 348 H372 V358 H356 Z" fill="{WOOD_D}" stroke-width="1.5"/>
    <circle cx="364" cy="366" r="7" fill="none" stroke="{IRON}" stroke-width="3.6"/>
    <path d="M364 372 Q344 392 346 420 M364 372 Q384 392 388 418" fill="none" stroke="{IRON}" stroke-width="3" stroke-dasharray="5 2.5"/>
    <g fill="{IRON}" stroke-width="1.4"><ellipse cx="346" cy="424" rx="8" ry="5"/><ellipse cx="389" cy="422" rx="8" ry="5"/></g>
    <g fill="none" stroke="{IRON_L}" stroke-width="1.2"><ellipse cx="346" cy="424" rx="3.5" ry="2"/><ellipse cx="389" cy="422" rx="3.5" ry="2"/></g>
    <!-- Collapsed tunnel mouth in its own spoil heap. -->
    <path d="M394 420 C386 366 410 322 436 318 C462 322 486 366 478 420 Z" fill="{DIRT}" stroke-width="2.2"/>
    <path d="M394 420 C386 366 410 322 436 318 C462 322 486 366 478 420 Z" fill="url(#leanHatch)" stroke="none"/>
    <path d="M410 420 V362 L430 358 L462 366 V420 Z" fill="#14110f" stroke-width="2"/>
    <path d="M404 424 V358 H416 V424 Z" fill="{WOOD_M}" stroke-width="2"/>
    <path d="M404 360 L452 340 L458 352 L416 372 Z" fill="{WOOD_D}" stroke-width="2"/>
    <path d="M464 424 L452 372 L462 368 L474 424 Z" fill="{WOOD_M}" stroke-width="2"/>
    <path d="M418 424 L458 380" fill="none" stroke="#5F4434" stroke-width="7"/>
    <path d="M418 424 L458 380" fill="none" stroke="{WOOD_L}" stroke-width="3.4"/>
    <g fill="{STONE_D}" stroke-width="1.6"><ellipse cx="424" cy="418" rx="11" ry="7"/><ellipse cx="446" cy="414" rx="9" ry="6"/><ellipse cx="414" cy="436" rx="8" ry="5"/><ellipse cx="454" cy="430" rx="12" ry="7"/><ellipse cx="478" cy="430" rx="7" ry="5"/></g>
    <path d="M388 440 L430 408 M424 404 Q438 396 446 408" fill="none" stroke="{IRON}" stroke-width="3"/>
    <path d="M388 440 L430 408" fill="none" stroke="{WOOD_L}" stroke-width="1.4"/>
'''
shadow = '''    <path d="M96 340 C92 230 160 126 256 122 C352 126 420 230 416 340 Z"/>
    <path d="M296 82 H322 V130 H296 Z"/>
    <path d="M134 162 H378 V350 H134 Z"/>
    <path d="M44 272 H176 V410 H44 Z"/>
    <path d="M180 350 H342 L332 434 H180 Z"/>
    <path d="M346 348 H380 V442 H346 Z"/>
    <path d="M394 420 C386 366 410 322 436 318 C462 322 486 366 478 420 V440 H394 Z"/>
'''
specs["dungeon"] = {"title": "Dungeon", "desc": "Stone bunker gatehouse in a mound with iron door, barred grate, winch, shackle post and collapsed tunnel.", "body": body, "shadow": shadow}

# ===================================================================== GRANARY
# Raised grain store on mushroom staddle stones: deep thatch with a bundled
# ridge and eave scallops, ladder to a raised door, sacks, spilt wheat, cart.
def thatch_eave(x0, x1, y, bumps, depth=9):
    w = (x1 - x0) / bumps
    d = f"M{x1} {y}"
    for i in range(bumps):
        xa = x1 - i * w
        d += f" Q{xa - w/2:.1f} {y + depth*2:.1f} {xa - w:.1f} {y}"
    return d


def thatch_rows(x0, x1, ys, amp=3):
    out = []
    for k, y in enumerate(ys):
        d = f"M{x0} {y}"
        n = 12
        w = (x1 - x0) / n
        for i in range(n):
            d += f" Q{x0 + w*(i+0.5):.1f} {y + (amp if (i + k) % 2 else -amp)} {x0 + w*(i+1):.1f} {y}"
        out.append(f'<path d="{d}" fill="none" stroke-width="1" opacity="0.4"/>')
    return "\n    ".join(out)


def eave_segments(x0, x1, y, bumps, depth):
    w = (x1 - x0) / bumps
    return " ".join(f"Q{x1 - i*w - w/2:.1f} {y + depth*2:.1f} {x1 - (i+1)*w:.1f} {y}" for i in range(bumps))


ROOFD = f"M126 112 H386 Q406 114 408 134 Q416 184 406 238 L402 250 {eave_segments(110, 402, 250, 12, 7)} L106 238 Q96 184 104 134 Q106 114 126 112 Z"

stones = "".join(
    f'''
    <path d="M{x-9} 324 L{x-12} 358 H{x+12} L{x+9} 324 Z" fill="{STONE}" stroke-width="1.8"/>
    <path d="M{x+3} 324 L{x+5} 358 H{x+12} L{x+9} 324 Z" fill="{STONE_D}" stroke="none" opacity="0.6"/>
    <ellipse cx="{x}" cy="358" rx="16" ry="4.5" fill="{STONE_D}" stroke-width="1.6"/>
    <path d="M{x-28} 327 C{x-28} 311 {x-14} 311 {x} 311 C{x+14} 311 {x+28} 311 {x+28} 327 Z" fill="{STONE_L}" stroke-width="2"/>
    <path d="M{x+6} 311 C{x+18} 312 {x+28} 314 {x+28} 327 H{x+12} C{x+14} 320 {x+12} 314 {x+6} 311 Z" fill="{STONE_D}" stroke="none" opacity="0.5"/>
    <path d="M{x-18} 316 Q{x-8} 313 {x} 313" fill="none" stroke="#D5D2C6" stroke-width="1.6" opacity="0.8"/>
'''
    for x in (142, 199, 256, 313, 370)
)

body = f'''
    <!-- Dark gap under the raised floor, then the staddle stones. -->
    <path d="M120 312 H392 V356 H120 Z" fill="#4c4234" opacity="0.55" stroke="none"/>
{stones}
    <!-- Floor beam on top of the caps. -->
    <path d="M112 300 H400 V314 H112 Z" fill="{WOOD_D}" stroke-width="2"/>
    <path d="M112 300 H400 V314 H112 Z" fill="url(#logHatch)" stroke="none"/>
    <!-- Plank wall strip with raised door and hay-hatch. -->
    <path d="M118 250 H394 L388 300 H124 Z" fill="{WOOD_M}" stroke-width="2.1"/>
    <path d="M118 250 H394 L388 300 H124 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M150 250 L148 300 M182 250 L181 300 M330 250 L331 300 M362 250 L363 300" fill="none" stroke-width="1.2" opacity="0.6"/>
    <path d="M232 258 H282 V300 H232 Z" fill="{WOOD_D}" stroke-width="2"/>
    <path d="M257 258 V300 M232 270 H282 M232 288 H282" fill="none" stroke-width="1.2" opacity="0.7"/>
    <path d="M232 258 L257 270 M282 258 L257 270" fill="none" stroke-width="1.1" opacity="0.55"/>
    <circle cx="251" cy="282" r="1.9" fill="#D7C39A" stroke="none"/><circle cx="263" cy="282" r="1.9" fill="#D7C39A" stroke="none"/>
    <path d="M222 300 H292 V308 H222 Z" fill="{WOOD_L}" stroke-width="1.8"/>
    <path d="M154 262 H186 V284 H154 Z M326 262 H358 V284 H326 Z" fill="#2c2420" stroke-width="1.8"/>
    <path d="M154 262 H186 V284 H154 Z M326 262 H358 V284 H326 Z" fill="none" stroke="{WOOD_D}" stroke-width="3"/>
    <path d="M162 262 V284 M170 262 V284 M178 262 V284 M334 262 V284 M342 262 V284 M350 262 V284" fill="none" stroke-width="1.1" opacity="0.8"/>
    <!-- Thatched roof: bulging skep-like silhouette, two slopes, bundle rows, scalloped eave, ridge roll. -->
    <clipPath id="thatchClip"><path d="{ROOFD}"/></clipPath>
    <g clip-path="url(#thatchClip)">
      <path d="M96 96 H416 V250 H96 Z" fill="#DCC47F" stroke="none"/>
      <path d="M96 176 H416 V260 H96 Z" fill="#C7A95E" stroke="none"/>
      <path d="M96 96 H416 V260 H96 Z" fill="url(#roofHatch)" stroke="none"/>
      {thatch_rows(96, 416, (128, 146, 162, 198, 216, 234))}
      <path d="M96 236 H416" fill="none" stroke="#8B6B30" stroke-width="1" opacity="0.5"/>
    </g>
    <path d="{ROOFD}" fill="none" stroke-width="2.8"/>
    <path d="M104 168 H408 L412 186 H100 Z" fill="#B8964A" stroke-width="2.4"/>
    <path d="M104 168 H408 L410 177 H102 Z" fill="#CFAE5E" stroke="none"/>
    <path d="M134 168 L140 186 M170 168 L176 186 M206 168 L212 186 M300 168 L306 186 M336 168 L342 186 M372 168 L378 186" fill="none" stroke-width="1.6" opacity="0.75"/>
    <path d="M98 160 L110 192 M110 160 L98 192 M402 160 L414 192 M414 160 L402 192" fill="none" stroke="#745846" stroke-width="3.6"/>
    <path d="M110 192 q-6 8 -4 16 M406 192 q6 8 4 16" fill="none" stroke="#B8964A" stroke-width="2" opacity="0.8"/>
    <path d="M222 168 L234 134 H278 L290 168 Z" fill="#C2A456" stroke-width="2"/>
    <path d="M222 168 L234 134 H278 L290 168 Z" fill="url(#roofHatch)" stroke="none"/>
    <path d="M239 148 H273 V164 H239 Z" fill="#2c2420" stroke-width="1.8"/>
    <path d="M239 153 H273 M239 158.5 H273" fill="none" stroke="{WOOD_M}" stroke-width="2"/>
    <path d="M228 134 H284 L280 126 H232 Z" fill="#B8964A" stroke-width="1.6"/>
    <!-- Ladder from the door landing to the ground. -->
    <path d="M274 308 L312 380 M290 308 L328 380" fill="none" stroke-width="7.5"/>
    <path d="M274 308 L312 380 M290 308 L328 380" fill="none" stroke="{WOOD_L}" stroke-width="3.8"/>
    <path d="M281 322 L297 322 M286 334 L302 334 M292 346 L308 346 M298 358 L314 358 M304 370 L320 370" fill="none" stroke-width="2.6"/>
    <!-- Stacked sacks at the ladder foot. -->
{sack(364, 376, 36, 38)}{sack(402, 380, 34, 36, "#CDBE98")}{sack(384, 346, 34, 36, "#E1D3AC")}
    <!-- Spilled heap of wheat with a few stalks. -->
    <path d="M186 436 C196 410 214 394 242 392 C270 394 286 414 296 436 Q242 446 186 436 Z" fill="#E6C867" stroke-width="2"/>
    <path d="M214 400 C224 394 238 392 250 394 C240 402 226 408 214 416 Z" fill="#F2DB8C" stroke="none"/>
    <g fill="none" stroke="#A98630" stroke-width="1.1" opacity="0.9"><path d="M204 428 l10 -6 M222 420 l11 -3 M240 428 l-9 -7 M258 416 l10 -5 M272 428 l-9 -6 M236 408 l8 -2 M214 412 l8 -4 M252 428 l9 -2"/></g>
    <g fill="#E6C867" stroke-width="1.2">
      <path d="M170 438 Q168 418 164 404" fill="none" stroke-width="1.8"/><ellipse cx="163" cy="400" rx="3" ry="7" transform="rotate(-8 163 400)"/>
      <path d="M180 440 Q182 420 188 404" fill="none" stroke-width="1.8"/><ellipse cx="189" cy="400" rx="3" ry="7" transform="rotate(10 189 400)"/>
      <path d="M306 440 Q310 424 306 410" fill="none" stroke-width="1.8"/><ellipse cx="306" cy="406" rx="3" ry="7"/>
    </g>
    <!-- Handcart loaded with grain. -->
    <path d="M128 392 L172 404 L176 410" fill="none" stroke="#5F4434" stroke-width="5"/>
    <path d="M128 392 L172 404" fill="none" stroke="{WOOD_L}" stroke-width="2.4"/>
    <path d="M48 372 H134 L128 404 H54 Z" fill="#876A56" stroke-width="2"/>
    <path d="M58 372 L60 404 M72 372 L72 404 M86 372 L86 404 M100 372 L100 404 M114 372 L114 404 M126 372 L122 404" fill="none" stroke-width="1" opacity="0.6"/>
    <path d="M50 374 Q66 352 90 356 Q112 352 132 374 Z" fill="#E6C867" stroke-width="1.8"/>
    <path d="M62 370 Q76 358 92 360" fill="none" stroke="#F2DB8C" stroke-width="2.2"/>
    <circle cx="94" cy="410" r="19" fill="{WOOD_D}" stroke-width="2.2"/>
    <circle cx="94" cy="410" r="12" fill="none" stroke-width="1.6"/>
    <path d="M94 391 V429 M75 410 H113 M80 396 L108 424 M108 396 L80 424" fill="none" stroke-width="1.2"/>
    <circle cx="94" cy="410" r="3.4" fill="{IRON}" stroke-width="1.2"/>
'''
shadow = '''    <path d="M104 112 H408 V190 H402 V250 H400 V300 H112 V250 H112 V190 H104 Z"/>
    <path d="M118 300 H394 V358 H118 Z"/>
    <path d="M274 308 H328 L336 384 H312 Z"/>
    <path d="M326 346 H420 V420 H326 Z"/>
    <path d="M186 392 H296 V440 H186 Z"/>
    <path d="M48 356 H176 V428 H48 Z"/>
'''
specs["granary"] = {"title": "Granary", "desc": "Raised thatched grain store on staddle stones with ladder, sacks, spilled wheat and handcart.", "body": body, "shadow": shadow}

# ======================================================================== IDOL
# Open-air shrine: ring of standing stones round a three-step plinth carrying
# a horned stone idol with a radiant sun crown, ribbons, bead strings and an
# offering bowl with a flame.
cx0, cy0 = 256, 336
back = [(a, 82) for a in (192, 222, 252, 288, 318, 348)]
front = [(a, 60) for a in (16, 42, 138, 164)]


def ring_pos(a):
    r = math.radians(a)
    return round(cx0 + 168 * math.cos(r)), round(cy0 + 62 * math.sin(r))


back_stones = "".join(menhir(*ring_pos(a), h, 36 if i % 2 else 32) for i, (a, h) in enumerate(back))
front_stones = "".join(menhir(*ring_pos(a), h, 36) for a, h in front)
rays = "".join(
    f'    <path d="M{256 + 38*math.cos(math.radians(a)):.1f} {104 + 38*math.sin(math.radians(a)):.1f} L{256 + (74 if i % 2 == 0 else 60)*math.cos(math.radians(a+6)):.1f} {104 + (74 if i % 2 == 0 else 60)*math.sin(math.radians(a+6)):.1f} L{256 + 38*math.cos(math.radians(a+12)):.1f} {104 + 38*math.sin(math.radians(a+12)):.1f} Z" fill="{GOLD_L if i % 2 == 0 else GOLD}" stroke-width="1.6"/>\n'
    for i, a in enumerate(range(186, 354, 14))
)
bead_strings = ""
for (x0, y0, x1, y1, sag, cols) in (
    (ring_pos(222)[0], 266, ring_pos(252)[0], 266, 22, ("#C8483F", "#E8B64B", "#7FC4B2")),
    (ring_pos(288)[0], 266, ring_pos(318)[0], 266, 22, ("#7FC4B2", "#C8483F", "#E8B64B")),
):
    p0, p1, p2 = (x0, y0), ((x0 + x1) / 2, y0 + sag * 2), (x1, y1)
    bead_strings += f'    <path d="M{x0} {y0} Q{p1[0]} {p1[1]} {x1} {y1}" fill="none" stroke-width="1.1"/>\n'
    for k in range(1, 9):
        bx, by = qpt(p0, p1, p2, k / 9)
        bead_strings += f'    <circle cx="{bx:.1f}" cy="{by:.1f}" r="3" fill="{cols[k % 3]}" stroke-width="1"/>\n'

body = f'''
    <!-- Trampled ritual ground. -->
    <ellipse cx="{cx0}" cy="{cy0}" rx="204" ry="90" fill="{DIRT}" stroke-width="1.8"/>
    <ellipse cx="{cx0}" cy="{cy0}" rx="204" ry="90" fill="url(#leanHatch)" stroke="none"/>
    <ellipse cx="{cx0}" cy="{cy0+4}" rx="124" ry="48" fill="#A99C80" stroke="none" opacity="0.7"/>
    <!-- Back arc of standing stones. -->
{back_stones}
{bead_strings}
    <!-- Sun crown behind the idol's head. -->
    <circle cx="256" cy="104" r="40" fill="{GOLD}" stroke-width="2.4"/>
{rays}
    <circle cx="256" cy="104" r="40" fill="none" stroke="{GOLD_L}" stroke-width="3" opacity="0.8"/>
    <!-- Stepped plinth. -->
    <path d="M168 372 H344 L338 336 H174 Z" fill="{STONE}" stroke-width="2.2"/>
    <path d="M168 372 H344 L338 336 H174 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M174 336 H338 L330 322 H182 Z" fill="{STONE_L}" stroke-width="2"/>
    <path d="M194 322 H318 L312 296 H200 Z" fill="{STONE}" stroke-width="2.2"/>
    <path d="M194 322 H318 L312 296 H200 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M200 296 H312 L306 284 H206 Z" fill="{STONE_L}" stroke-width="2"/>
    <!-- Idol body: tapering carved column with folded arms and a belt of runes. -->
    <path d="M226 286 L236 196 H276 L286 286 Z" fill="{STONE_L}" stroke-width="2.4"/>
    <path d="M262 196 H276 L286 286 H268 Z" fill="{STONE_D}" stroke="none" opacity="0.5"/>
    <path d="M226 286 L236 196 H276 L286 286 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M238 214 Q256 238 274 214 M240 238 Q256 256 272 238" fill="none" stroke-width="2.2"/>
    <path d="M232 262 H280" fill="none" stroke="{GOLD_D}" stroke-width="3"/>
    <path d="M240 270 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4" fill="none" stroke-width="1.3"/>
    <!-- Idol head: blocky face with brow, glowing eyes, nose and fanged mouth. -->
    <path d="M228 198 Q224 140 232 118 Q256 104 280 118 Q288 140 284 198 Z" fill="{STONE_L}" stroke-width="2.4"/>
    <path d="M268 120 Q280 128 284 198 H266 Q272 150 268 120 Z" fill="{STONE_D}" stroke="none" opacity="0.5"/>
    <path d="M230 142 L256 150 L282 142" fill="none" stroke-width="3.2"/>
    <path d="M234 158 H250 L246 168 H236 Z M262 158 H278 L276 168 H266 Z" fill="{GOLD_L}" stroke-width="1.8"/>
    <path d="M256 150 V176 L250 182 H262 Z" fill="{STONE_D}" stroke-width="1.8"/>
    <path d="M238 188 Q256 178 274 188 L270 198 H242 Z" fill="{DARK}" stroke-width="1.8"/>
    <path d="M246 188 L249 195 L252 188 M260 188 L263 195 L266 188" fill="#E6DFCB" stroke-width="1"/>
    <!-- Horns sweeping out and up from the brow. -->
    <path d="M232 134 C210 136 192 124 188 96 C187 86 190 78 194 72 C196 88 206 104 234 114 Z" fill="#CBC3A4" stroke-width="2.2"/>
    <path d="M280 134 C302 136 320 124 324 96 C325 86 322 78 318 72 C316 88 306 104 278 114 Z" fill="#CBC3A4" stroke-width="2.2"/>
    <path d="M200 112 L210 116 M193 98 L203 102 M312 112 L302 116 M319 98 L309 102" fill="none" stroke-width="1.2" opacity="0.7"/>
    <!-- Ribbons knotted to the horn tips. -->
    <path d="M192 74 C166 100 176 150 164 196 L177 198 C190 150 184 106 200 78 Z" fill="#C8483F" stroke-width="1.6"/>
    <path d="M320 74 C346 100 336 150 348 196 L335 198 C322 150 328 106 312 78 Z" fill="#4F8A92" stroke-width="1.6"/>
    <path d="M172 130 L181 133 M170 164 L178 167 M340 130 L331 133 M342 164 L334 167" fill="none" stroke-width="1" opacity="0.6"/>
    <!-- Offerings on the plinth: fruit, candle stub. -->
    <g stroke-width="1.5"><circle cx="196" cy="330" r="6" fill="#C8483F"/><circle cx="208" cy="332" r="5.4" fill="#D9A83F"/><circle cx="316" cy="330" r="5.6" fill="#7FA06B"/></g>
    <path d="M306 316 V304 H312 V316 Z" fill="#F0E6C8" stroke-width="1.4"/>
    <path d="M309 304 C305 300 308 296 309 293 C311 297 313 300 311 304 Z" fill="#E08A33" stroke-width="1"/>
    <!-- Offering bowl on a stand with a living flame, in the gap of the ring. -->
    <path d="M232 424 L244 400 H268 L280 424 Z" fill="{IRON}" stroke-width="2"/>
    <ellipse cx="256" cy="398" rx="30" ry="10" fill="{STONE_D}" stroke-width="2.2"/>
    <ellipse cx="256" cy="397" rx="22" ry="6.5" fill="#26211f" stroke-width="1.4"/>
    <path d="M256 396 C238 392 244 372 256 360 C258 372 280 378 272 392 C270 398 262 399 256 396 Z" fill="#E08A33" stroke-width="1.8"/>
    <path d="M256 394 C247 390 252 378 257 372 C259 380 267 384 263 392 C262 396 259 396 256 394 Z" fill="#F4D36B" stroke="none"/>
    <path d="M232 408 Q238 402 244 408 M268 408 Q274 402 280 408" fill="none" stroke="{GOLD}" stroke-width="2"/>
    <g fill="#E8B64B" stroke-width="1"><circle cx="222" cy="408" r="3"/><circle cx="214" cy="414" r="3" fill="#C8483F"/><circle cx="292" cy="408" r="3" fill="#7FC4B2"/><circle cx="300" cy="414" r="3"/></g>
    <!-- Front standing stones left and right of the approach. -->
{front_stones}
'''
menhir_shadow = "".join(
    f'    <path d="M{x-17} {y} L{x-19} {y-h*0.45:.0f} L{x-13} {y-h*0.9:.0f} L{x} {y-h} L{x+11} {y-h*0.9:.0f} L{x+18} {y-h*0.5:.0f} L{x+17} {y} Z"/>\n'
    for x, y, h in [(*ring_pos(a), hh) for a, hh in back + front]
)
shadow = f'''    <path d="M168 372 H344 L330 322 L312 296 L306 284 L286 196 L284 118 L322 80 L316 62 H196 L190 80 L228 118 L226 196 L206 284 L200 296 L182 322 Z"/>
    <path d="M232 424 L244 396 H268 L280 424 Z"/>
{menhir_shadow}'''
specs["idol"] = {"title": "Idol", "desc": "Open-air shrine: horned sun-crowned stone idol on a stepped plinth in a ring of standing stones.", "body": body, "shadow": shadow}

# =================================================================== INFIRMARY
# Plain ward house: shingled roof with a red-cross shield, plaster wall strip
# with an open window onto two cots, drying bandage line, herb bed, a tray of
# bottles and a bone saw, and a well with bucket.
def herb(x, y, fill="#7FA06B"):
    return f'''
    <path d="M{x} {y} Q{x-12} {y-10} {x-14} {y-24} Q{x-4} {y-16} {x} {y-6} Q{x+4} {y-18} {x+14} {y-26} Q{x+12} {y-10} {x} {y} Z" fill="{fill}" stroke-width="1.3"/>
    <path d="M{x} {y} V{y-18}" fill="none" stroke-width="0.9" opacity="0.7"/>
'''


herbs = "".join(herb(x, y, c) for x, y, c in (
    (84, 408, "#7FA06B"), (112, 404, "#6C9A78"), (140, 408, "#8FAE6A"), (168, 404, "#7FA06B"),
    (98, 430, "#8FAE6A"), (126, 430, "#7FA06B"), (154, 430, "#6C9A78"),
))
flowers = "".join(
    f'<circle cx="{x}" cy="{y}" r="3.6" fill="{c}" stroke-width="1.1"/>'
    for x, y, c in ((72, 384, "#C98BB0"), (104, 378, "#E8C65A"), (132, 384, "#C98BB0"), (160, 378, "#E8C65A"), (176, 392, "#F0E6C8"))
)
strips = "".join(
    f'''
    <path d="M{x} 246 L{x-1} {246+h} L{x+8} {246+h-3} L{x+12} 246 Z" fill="#F0EADA" stroke-width="1.3"/>
    <path d="M{x+2} {246+h*0.55:.0f} l8 -1" fill="none" stroke="#B8564A" stroke-width="1.6" opacity="0.75"/>
    <rect x="{x+3}" y="241" width="4" height="9" rx="1" fill="{WOOD_L}" stroke-width="1"/>
'''
    for x, h in ((62, 52), (79, 42), (95, 58), (110, 46))
)
cot = lambda x, y: f'''
    <path d="M{x} {y} H{x+58} V{y+22} H{x} Z" fill="#E9E4D4" stroke-width="1.6"/>
    <path d="M{x+2} {y+2} H{x+16} V{y+12} H{x+2} Z" fill="#F7F3E6" stroke-width="1.2"/>
    <path d="M{x+18} {y+4} H{x+58} V{y+22} H{x+18} Z" fill="#6C8F7E" stroke-width="1.4"/>
    <path d="M{x+4} {y+22} V{y+28} M{x+54} {y+22} V{y+28}" fill="none" stroke="{WOOD_D}" stroke-width="2.2"/>
'''

body = f'''
    <!-- Herb bed. -->
    <path d="M62 372 H186 L192 438 H56 Z" fill="#8A7660" stroke-width="2"/>
    <path d="M66 388 H184 M62 402 H188 M59 416 H190" fill="none" stroke="#5F4F40" stroke-width="1.1" opacity="0.7"/>
{herbs}
    {flowers}
    <!-- Bandage line between two poles. -->
    <path d="M56 232 V352 M122 232 V352" fill="none" stroke="#4B352B" stroke-width="5"/>
    <path d="M56 232 V352 M122 232 V352" fill="none" stroke="{WOOD_L}" stroke-width="2.2"/>
    <path d="M56 246 Q89 262 122 246" fill="none" stroke-width="1.8"/>
{strips}
    <!-- Chimney and its herb-smoke stack. -->
    <path d="M356 92 H388 V160 H356 Z" fill="{STONE}" stroke="none"/>
    <path d="M356 92 H388 V160 H356 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M356 92 H388 V160 H356 Z" fill="none" stroke-width="2.2"/>
    <path d="M352 84 H392 V96 H352 Z" fill="{STONE_L}" stroke-width="2"/>
    <path d="M360 87 H384 V93 H360 Z" fill="#26211f" stroke="none"/>
    <!-- Whitewashed wall strip with door, open ward window, shutters and sign. -->
    <path d="M156 262 H408 L402 336 H162 Z" fill="#E6DCC3" stroke-width="2.2"/>
    <path d="M172 262 V336 M392 262 V336" fill="none" stroke="#5F4434" stroke-width="3"/>
    <path d="M178 272 H214 L211 336 H181 Z" fill="{WOOD_D}" stroke-width="1.9"/>
    <path d="M184 284 H208 M185 298 H208 M185 312 H209" fill="none" stroke-width="1.05" opacity="0.7"/>
    <circle cx="205" cy="306" r="1.8" fill="#D7C39A" stroke="none"/>
    <path d="M174 336 H220 L224 346 H170 Z" fill="#85827A" stroke-width="1.8"/>
    <path d="M234 276 H384 V326 H234 Z" fill="#2a2420" stroke-width="2"/>
    <path d="M234 276 H384 V292 H234 Z" fill="#3a322C" stroke="none"/>
{cot(244, 294)}{cot(316, 294)}
    <path d="M226 272 H234 V330 H226 Z M384 272 H392 V330 H384 Z" fill="#6C8F7E" stroke-width="1.6"/>
    <path d="M230 276 V326 M388 276 V326" fill="none" stroke-width="0.8" opacity="0.7"/>
    <path d="M232 326 H386 V334 H232 Z" fill="{WOOD_L}" stroke-width="1.6"/>
    <!-- Hung herb bundles under the eave. -->
    <path d="M186 264 V272 M196 264 V272 M206 264 V272" fill="none" stroke-width="1.2"/>
    <path d="M181 272 H191 L186 288 Z M191 272 H201 L196 292 Z M201 272 H211 L206 286 Z" fill="#7FA06B" stroke-width="1.2" transform="translate(0 -2)"/>
    <!-- Shingled roof with a mended patch and the red-cross shield. -->
{roof(150, 120, 270, 142, ROOF_L, ROOF_D, "shingleHatch")}
{pegs(150, 120, 270, 142)}
    <path d="M178 196 H232 V236 H178 Z" fill="#A8856F" stroke-width="1.4"/>
    <path d="M178 196 H232 V236 H178 Z" fill="url(#shingleHatch)" stroke="none"/>
    <path d="M178 196 H232 V236 H178 Z" fill="none" stroke="#5F4434" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>
    <path d="M364 206 H402 V234 H364 Z" fill="#5F4F44" stroke-width="1.8"/>
    <path d="M364 220 H402 M383 206 V234" fill="none" stroke-width="1.1" opacity="0.7"/>
    <path d="M254 238 Q262 226 276 232 Q292 222 306 236 L300 244 H258 Z" fill="#6F8A5F" stroke="none" opacity="0.55"/>
    <path d="M278 138 H346 V196 Q346 220 312 232 Q278 220 278 196 Z" fill="#F4F0E4" stroke-width="2.4"/>
    <path d="M306 150 H318 V172 H340 V184 H318 V214 H306 V184 H284 V172 H306 Z" fill="#B53A34" stroke-width="1.8"/>
    <!-- Stretcher left on the grass: canvas between two carrying poles. -->
    <path d="M326 424 H416 M330 408 H412" fill="none" stroke-width="6.5"/>
    <path d="M326 424 H416 M330 408 H412" fill="none" stroke="{WOOD_L}" stroke-width="3"/>
    <path d="M336 410 H404 L408 424 H332 Z" fill="#D8CBA6" stroke-width="1.8"/>
    <path d="M346 414 H396" fill="none" stroke-width="0.9" opacity="0.5"/>
    <path d="M370 414 q6 1 8 6 q-6 3 -12 0 q0 -4 4 -6 Z" fill="#B53A34" stroke="none" opacity="0.65"/>
    <!-- Surgery tray: table with bottles, a bone saw and a roll of bandage. -->
    <path d="M222 384 H320 L324 392 H218 Z" fill="{WOOD_L}" stroke-width="1.9"/>
    <path d="M226 392 V430 M316 392 V430 M226 410 H316" fill="none" stroke="#745846" stroke-width="3"/>
    <path d="M236 384 V372 H244 V384 Z" fill="#6AA37E" stroke-width="1.4"/><path d="M236 372 L238 366 H242 L244 372" fill="#6AA37E" stroke-width="1.2"/><path d="M238 366 H242 V362 H238 Z" fill="#B8956F" stroke-width="1"/>
    <path d="M248 384 V366 Q248 362 254 362 Q260 362 260 366 V384 Z" fill="#5B8FB0" stroke-width="1.4"/><path d="M252 362 V357 H256 V362 Z" fill="#B8956F" stroke-width="1"/>
    <path d="M264 384 V376 H274 V384 Z" fill="#C2884E" stroke-width="1.4"/><path d="M266 376 V372 H272 V376 Z" fill="#B8956F" stroke-width="1"/>
    <path d="M280 382 L316 376 L316 382 L280 387 Z" fill="#C9CDD1" stroke-width="1.4"/>
    <path d="M282 387 l3 3 l3 -3 l3 3 l3 -3 l3 3 l3 -3 l3 3 l3 -3 l3 3 l3 -3 l3 3" fill="none" stroke-width="1" transform="translate(0 -2)"/>
    <path d="M316 374 H328 V384 H316 Z" fill="{WOOD_D}" stroke-width="1.5"/>
    <ellipse cx="304" cy="372" rx="7" ry="3" fill="#F0EADA" stroke-width="1.2"/>
    <!-- Well with bucket. -->
    <ellipse cx="440" cy="392" rx="30" ry="14" fill="#8E8B83" stroke-width="2"/>
    <path d="M410 392 V412 Q440 432 470 412 V392 Q440 408 410 392 Z" fill="{STONE}" stroke-width="2"/>
    <path d="M410 392 V412 Q440 432 470 412 V392 Q440 408 410 392 Z" fill="url(#stoneHatch)" stroke="none"/>
    <ellipse cx="440" cy="391" rx="21" ry="9" fill="{WATER_D}" stroke-width="1.5"/>
    <path d="M414 392 V348 M466 392 V348 M410 348 H470" fill="none" stroke="#4B352B" stroke-width="3.2"/>
    <path d="M440 348 V372" fill="none" stroke-width="1.4"/>
    <path d="M430 372 H450 L447 388 H433 Z" fill="#876A56" stroke-width="1.6"/>
    <path d="M430 378 H450" fill="none" stroke="{IRON}" stroke-width="1.4"/>
'''
shadow = '''    <path d="M150 84 H392 V120 H420 V262 H408 L402 346 H220 V340 H162 V262 H150 Z"/>
    <path d="M56 232 H126 V352 H56 Z"/>
    <path d="M56 372 H192 V438 H56 Z"/>
    <path d="M218 362 H328 V430 H218 Z"/>
    <path d="M408 348 H472 V420 H408 Z"/>
'''
specs["infirmary"] = {"title": "Infirmary", "desc": "Ward house with red-cross shield, cots, herb bed, bandage line, surgery tray and well.", "body": body, "shadow": shadow}
