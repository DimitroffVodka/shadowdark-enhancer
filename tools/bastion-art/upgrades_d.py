"""Bastion upgrades, set D: temple, trading post, trophy room, vault, wizard tower."""
import math

from bastion_lib import *  # noqa: F401,F403

specs = {}


# ---- local helpers ---------------------------------------------------------

def _flame(x, y, s=1.0):
    """Orange teardrop flame with a yellow core, base centre x,y."""
    return f'''
    <path d="M{x} {y} C{x-11*s:.1f} {y-5*s:.1f} {x-6*s:.1f} {y-19*s:.1f} {x+1*s:.1f} {y-30*s:.1f} C{x+3*s:.1f} {y-18*s:.1f} {x+14*s:.1f} {y-14*s:.1f} {x+10*s:.1f} {y-4*s:.1f} C{x+8*s:.1f} {y+1*s:.1f} {x+3*s:.1f} {y+2*s:.1f} {x} {y} Z" fill="#E08A33" stroke-width="1.4"/>
    <path d="M{x+1*s:.1f} {y-2*s:.1f} C{x-4*s:.1f} {y-6*s:.1f} {x-1*s:.1f} {y-13*s:.1f} {x+2*s:.1f} {y-18*s:.1f} C{x+3*s:.1f} {y-12*s:.1f} {x+8*s:.1f} {y-9*s:.1f} {x+6*s:.1f} {y-4*s:.1f} Z" fill="#F4D36B" stroke="none"/>
'''


def _star(x, y, r=7, fill="#F4E9A8"):
    """Four-point spark."""
    k = r * 0.28
    return f'    <path d="M{x} {y-r} L{x+k:.1f} {y-k:.1f} L{x+r} {y} L{x+k:.1f} {y+k:.1f} L{x} {y+r} L{x-k:.1f} {y+k:.1f} L{x-r} {y} L{x-k:.1f} {y-k:.1f} Z" fill="{fill}" stroke-width="0.9"/>\n'


def _chain(x0, y0, cx, cy, x1, y1, n=9, fill="#6A6C70"):
    """Chain links along a quadratic curve, alternating flat and edge-on."""
    out = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1
        dx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx)
        dy = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy)
        ang = math.degrees(math.atan2(dy, dx))
        ry = 3.2 if i % 2 == 0 else 1.5
        out.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="4.6" ry="{ry}" transform="rotate({ang:.0f} {x:.1f} {y:.1f})" fill="{fill}" stroke-width="1.1"/>')
    return "    " + "\n    ".join(out) + "\n"


# ---------------------------------------------------------------- Temple
# Stone chapel: slate roof with vertical ridge, front gable facade with round
# rose window and pointed door, bell cote and standing-stone finial behind the
# ridge, stepped porch, two flame braziers.
rose = ""
for i in range(8):
    a = math.radians(i * 45 + 22.5)
    px, py = 256 + 21 * math.cos(a), 298 + 21 * math.sin(a)
    rose += f'<circle cx="{px:.1f}" cy="{py:.1f}" r="7" fill="{["#C97B5A", "#6C8F9E"][i % 2]}" stroke-width="1.2"/>'
    rose += f'<path d="M{256+10*math.cos(a):.1f} {298+10*math.sin(a):.1f} L{256+32*math.cos(a):.1f} {298+32*math.sin(a):.1f}" fill="none" stroke-width="1.6"/>'


def _brazier(x, y):
    return f'''
    <path d="M{x-11} {y+10} L{x-17} {y+36} M{x+11} {y+10} L{x+17} {y+36} M{x} {y+12} V{y+38}" fill="none" stroke="#2c2622" stroke-width="3"/>
    <path d="M{x-17} {y+36} H{x+17}" fill="none" stroke="#2c2622" stroke-width="2.4"/>
    <path d="M{x-19} {y-2} H{x+19} L{x+12} {y+14} H{x-12} Z" fill="#4D4B47" stroke-width="2"/>
    <path d="M{x-19} {y-2} H{x+19} L{x+18} {y+3} H{x-18} Z" fill="#6F6D68" stroke-width="1.3"/>
''' + _flame(x - 3, y - 2, 1.5)


body = '''
    <!-- Bell cote: stone pier with an arched bell opening, gabled cap, sun disc. -->
    <path d="M214 66 H298 V134 H214 Z" fill="#8E8B83" stroke="none"/>
    <path d="M214 66 H298 V134 H214 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M214 66 H298 V134 H214 Z" fill="none" stroke-width="2.3"/>
    <path d="M232 128 V92 Q232 74 256 74 Q280 74 280 92 V128 Z" fill="#26211f" stroke-width="2"/>
    <path d="M243 106 Q243 94 256 94 Q269 94 269 106 L272 118 H240 Z" fill="#C9A24A" stroke-width="1.6"/>
    <path d="M256 82 V94" fill="none" stroke-width="1.8"/>
    <circle cx="256" cy="120" r="3.3" fill="#7E6A2C" stroke-width="1.1"/>
    <path d="M206 68 L256 34 L306 68 Z" fill="#A8A59B" stroke-width="2.3"/>
    <path d="M256 34 L306 68 H256 Z" fill="#8E8B83" stroke="none"/>
    <circle cx="256" cy="55" r="6.5" fill="#E5B861" stroke-width="1.4"/>
    <path d="M256 45 V49 M256 61 V65 M246 55 H250 M262 55 H266" fill="none" stroke-width="1.3"/>
    <!-- Standing-stone finial: a tapered monolith with a carved sun ring. -->
    <path d="M249 36 L251 14 Q256 4 261 14 L263 36 Z" fill="#B7B4A9" stroke-width="2"/>
    <path d="M256 4 L263 36 H257 Z" fill="#8E8B83" stroke="none"/>
    <circle cx="256" cy="20" r="3.2" fill="none" stroke-width="1.1"/>
    <path d="M251 28 H261" fill="none" stroke-width="1.1"/>
    <!-- Slate roof: vertical ridge, two slopes, tile courses, diamond tile band, stone ridge cap. -->
    <path d="M112 120 H256 V252 H112 Z" fill="#9DAAAE" stroke="none"/>
    <path d="M256 120 H400 V252 H256 Z" fill="#7F8F95" stroke="none"/>
    <path d="M112 120 H400 V252 H112 Z" fill="url(#shingleHatch)" stroke="none"/>
    <path d="M112 146 H256 M112 172 H256 M112 198 H256 M112 224 H256 M256 146 H400 M256 172 H400 M256 198 H400 M256 224 H400" fill="none" stroke-width="1" opacity="0.3"/>
    <g fill="#C9A24A" stroke-width="1.2" opacity="0.95">
      <path d="M136 186 L148 177 L160 186 L148 195 Z M172 186 L184 177 L196 186 L184 195 Z M208 186 L220 177 L232 186 L220 195 Z"/>
      <path d="M280 186 L292 177 L304 186 L292 195 Z M316 186 L328 177 L340 186 L328 195 Z M352 186 L364 177 L376 186 L364 195 Z"/>
    </g>
    <path d="M112 120 H400 V252 H112 Z" fill="none" stroke-width="2.8"/>
    <path d="M249 114 H263 V250 H249 Z" fill="#A8A59B" stroke-width="2"/>
    <path d="M249 146 H263 M249 172 H263 M249 198 H263 M249 224 H263" fill="none" stroke-width="1.1" opacity="0.6"/>
    <path d="M112 246 H400 V260 H112 Z" fill="#6F7F85" stroke-width="2"/>
    <circle cx="150" cy="150" r="10" fill="#2c2622" stroke-width="2"/>
    <circle cx="150" cy="150" r="5.8" fill="#6C8F9E" stroke-width="1.2"/>
    <circle cx="362" cy="150" r="10" fill="#2c2622" stroke-width="2"/>
    <circle cx="362" cy="150" r="5.8" fill="#6C8F9E" stroke-width="1.2"/>
    <!-- Front gable wall: stone with buttresses, lancets, rose window and door. -->
''' + stone_face(130, 260, 252, 136, STONE, 5) + '''
    <path d="M118 256 H138 V396 H118 Z M374 256 H394 V396 H374 Z" fill="#A8A59B" stroke-width="2.1"/>
    <path d="M118 256 H138 V396 H118 Z M374 256 H394 V396 H374 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M116 256 L128 242 L140 256 Z M372 256 L384 242 L396 256 Z" fill="#8E8B83" stroke-width="1.8"/>
    <path d="M176 350 V318 Q176 304 188 304 Q200 304 200 318 V350 Z M312 350 V318 Q312 304 324 304 Q336 304 336 318 V350 Z" fill="#6C8F9E" stroke-width="1.8"/>
    <path d="M188 305 V350 M176 330 H200 M324 305 V350 M312 330 H336" fill="none" stroke-width="1.1" opacity="0.7"/>
    <circle cx="256" cy="298" r="38" fill="#A8A59B" stroke-width="2.3"/>
    <circle cx="256" cy="298" r="33" fill="#4C6C7A" stroke-width="1.6"/>
    ''' + rose + '''
    <circle cx="256" cy="298" r="8.5" fill="#E5B861" stroke-width="1.4"/>
    <circle cx="256" cy="298" r="33" fill="none" stroke-width="1.2" opacity="0.8"/>
    <path d="M230 396 V368 Q230 346 256 346 Q282 346 282 368 V396 Z" fill="#A8A59B" stroke-width="2.2"/>
    <path d="M237 396 V370 Q237 354 256 354 Q275 354 275 370 V396 Z" fill="#745846" stroke-width="1.8"/>
    <path d="M256 354 V396 M237 372 H275 M237 384 H275" fill="none" stroke-width="1.2" opacity="0.7"/>
    <circle cx="251" cy="380" r="1.8" fill="#D7C39A" stroke="none"/><circle cx="261" cy="380" r="1.8" fill="#D7C39A" stroke="none"/>
    <!-- Stepped porch. -->
    <path d="M204 396 H308 L318 414 H194 Z" fill="#9A978D" stroke-width="1.9"/>
    <path d="M190 414 H322 L334 434 H178 Z" fill="#A8A59B" stroke-width="1.9"/>
    <path d="M204 396 H308 L318 414 H194 Z M190 414 H322 L334 434 H178 Z" fill="url(#stoneHatch)" stroke="none"/>
''' + _brazier(142, 380) + _brazier(370, 380) + '''
    <!-- Grass tufts at the foot of the steps. -->
''' + tuft(150, 432) + tuft(352, 434) + tuft(110, 408)
shadow = '''    <path d="M118 116 H400 V272 L396 286 V396 H334 L346 434 H166 L178 396 H118 V286 Z"/>
    <path d="M206 34 L256 4 L306 34 V134 H206 Z"/>
    <path d="M118 380 H166 V420 H118 Z M346 380 H394 V420 H346 Z"/>
'''
specs["temple"] = {"title": "Temple", "desc": "Small stone chapel with bell cote, rose window and flame braziers.", "body": body, "shadow": shadow}


# ---------------------------------------------------------------- Trading Post
# Timber shop: shingled roof, open counter under a striped awning with
# hanging wares, crates and sacks, coin signpost and a laden pack mule.
stripes = ""
for i in range(9):
    x0 = 124 + i * 22.0
    fill = "#B5483F" if i % 2 == 0 else "#E6D9B5"
    stripes += f'<path d="M{x0+ (i*0):.0f} 264 H{x0+22:.0f} L{x0+24:.0f} 300 Q{x0+12:.0f} 312 {x0-2:.0f} 300 Z" fill="{fill}" stroke-width="1.4"/>'
hang = f'''
    <path d="M160 308 V318 M200 308 V316 M240 308 V316 M278 308 V318" fill="none" stroke-width="1.3"/>
    <!-- Hanging lantern. -->
    <path d="M152 322 H168 L166 340 H154 Z" fill="#C9A24A" stroke-width="1.5"/>
    <path d="M156 326 H164 V336 H156 Z" fill="#F4D36B" stroke="none"/>
    <path d="M155 322 Q160 314 165 322" fill="none" stroke-width="1.4"/>
    <!-- Hanging pan with a handle. -->
    <circle cx="200" cy="328" r="12" fill="#5F6266" stroke-width="1.7"/>
    <circle cx="200" cy="328" r="8" fill="#7E8286" stroke-width="1"/>
    <path d="M200 316 V306" fill="none" stroke-width="2.2"/>
    <!-- Coil of rope. -->
    <ellipse cx="240" cy="326" rx="13" ry="11" fill="#C7A06E" stroke-width="1.6"/>
    <ellipse cx="240" cy="326" rx="8" ry="6.5" fill="none" stroke-width="1.1"/>
    <ellipse cx="240" cy="326" rx="3.4" ry="2.6" fill="#745846" stroke-width="0.9"/>
    <!-- Second lantern. -->
    <path d="M270 322 H286 L284 340 H272 Z" fill="#C9A24A" stroke-width="1.5"/>
    <path d="M274 326 H282 V336 H274 Z" fill="#F4D36B" stroke="none"/>
    <path d="M273 322 Q278 314 283 322" fill="none" stroke-width="1.4"/>
'''


def _sack(x, y, s=1.0, fill="#C9B79A"):
    def p(v):
        return f"{v*s:.1f}"
    return f'''
    <path d="M{x+(-16*s):.1f} {y} C{x-22*s:.1f} {y-24*s:.1f} {x-8*s:.1f} {y-34*s:.1f} {x-5*s:.1f} {y-38*s:.1f} L{x-9*s:.1f} {y-46*s:.1f} L{x+0*s:.1f} {y-42*s:.1f} L{x+9*s:.1f} {y-46*s:.1f} L{x+5*s:.1f} {y-38*s:.1f} C{x+8*s:.1f} {y-34*s:.1f} {x+22*s:.1f} {y-24*s:.1f} {x+16*s:.1f} {y} Q{x} {y+5*s:.1f} {x-16*s:.1f} {y} Z" fill="{fill}" stroke-width="1.7"/>
    <path d="M{x-6*s:.1f} {y-38*s:.1f} Q{x} {y-34*s:.1f} {x+6*s:.1f} {y-38*s:.1f}" fill="none" stroke="#745846" stroke-width="{2.2*s:.1f}"/>
    <path d="M{x-8*s:.1f} {y-16*s:.1f} Q{x-3*s:.1f} {y-8*s:.1f} {x-8*s:.1f} {y-3*s:.1f}" fill="none" stroke-width="0.9" opacity="0.5"/>
'''


mule = '''
    <g transform="translate(0 4)">
      <!-- Tail, back legs and front legs. -->
      <path d="M376 366 Q364 372 366 394" fill="none" stroke="#5F4434" stroke-width="4"/>
      <path d="M388 388 V412 H398 V388 Z M404 388 V410 H414 V388 Z M436 388 V410 H446 V388 Z M450 388 V412 H460 V388 Z" fill="#6E5443" stroke-width="1.5"/>
      <path d="M388 408 H398 V414 H388 Z M450 408 H460 V414 H450 Z M404 406 H414 V412 H404 Z M436 406 H446 V412 H436 Z" fill="#2c2622" stroke="none"/>
      <!-- Body, neck and head. -->
      <path d="M378 366 Q378 350 396 348 H446 Q464 350 466 366 V382 Q464 392 452 392 H392 Q378 392 378 378 Z" fill="#8A6B55" stroke-width="2"/>
      <path d="M378 380 Q420 392 466 380 V382 Q464 392 452 392 H392 Q378 392 378 378 Z" fill="#A9916F" stroke="none"/>
      <path d="M452 356 L468 332 L486 340 L490 360 L478 372 L458 372 Z" fill="#8A6B55" stroke-width="2"/>
      <path d="M476 356 Q490 358 490 366 Q486 374 474 372 Z" fill="#C9B79A" stroke-width="1.5"/>
      <path d="M468 334 L464 314 L474 328 Z M476 338 L486 320 L486 342 Z" fill="#6E5443" stroke-width="1.5"/>
      <circle cx="474" cy="352" r="2.2" fill="#010206" stroke="none"/>
      <path d="M458 340 Q452 354 450 360" fill="none" stroke="#5F4434" stroke-width="3.2"/>
      <!-- Pack: blanket, panniers, bedroll and rope. -->
      <path d="M398 348 H440 L444 372 H394 Z" fill="#9C3F3A" stroke-width="1.8"/>
      <path d="M402 356 H440 M400 364 H442" fill="none" stroke="#E6D9B5" stroke-width="1.4"/>
      <path d="M398 336 Q420 322 442 336 V350 H398 Z" fill="#C9B79A" stroke-width="1.8"/>
      <path d="M408 340 V350 M420 334 V350 M432 340 V350" fill="none" stroke-width="1.1" opacity="0.7"/>
      <path d="M394 372 H444 M410 348 V374 M428 348 V374" fill="none" stroke="#4B352B" stroke-width="1.6"/>
    </g>
'''

body = '''
    <!-- Chimney stack behind the ridge. -->
    <path d="M132 76 H168 V150 H132 Z" fill="#8E8B83" stroke="none"/>
    <path d="M132 76 H168 V150 H132 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M132 76 H168 V150 H132 Z" fill="none" stroke-width="2.2"/>
    <path d="M127 68 H173 V80 H127 Z" fill="#A8A59B" stroke-width="2"/>
    <path d="M136 71 H164 V77 H136 Z" fill="#26211f" stroke="none"/>
    <!-- Shop roof, wall strip and the open front. -->
''' + roof(110, 100, 230, 150, "#C09A7E", "#A9806A", "shingleHatch") + pegs(110, 100, 230, 150) + '''
    <path d="M200 134 H248 V170 H200 Z" fill="#5F4F44" stroke-width="1.8"/>
    <path d="M200 152 H248 M224 134 V170" fill="none" stroke-width="1.1" opacity="0.7"/>
    <path d="M192 128 H256 V136 H192 Z" fill="#745846" stroke-width="1.6"/>
    <path d="M142 190 H182 V222 H142 Z" fill="#A8856F" stroke-width="1.4"/>
    <path d="M142 190 H182 V222 H142 Z" fill="url(#shingleHatch)" stroke="none"/>
    <path d="M300 96 V58" fill="none" stroke="#4B352B" stroke-width="2.6"/>
    <path d="M301 60 H336 L328 72 L336 84 H301 Z" fill="#B5483F" stroke-width="1.6"/>
    <circle cx="316" cy="72" r="6" fill="#E5B861" stroke-width="1.2"/>
    <path d="M114 250 H336 L330 306 H120 Z" fill="#8F715E" stroke-width="2.1"/>
    <path d="M114 250 H336 L330 306 H120 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M142 262 H308 V330 H142 Z" fill="#3A2E27" stroke-width="2"/>
    <path d="M150 284 H300 M150 306 H300" fill="none" stroke="#745846" stroke-width="3"/>
    <path d="M158 270 H172 V284 H158 Z M178 272 H190 V284 H178 Z M262 268 H280 V284 H262 Z M286 273 H296 V284 H286 Z" fill="#B97755" stroke-width="1.2"/>
    <path d="M160 294 H174 V306 H160 Z M268 291 H284 V306 H268 Z" fill="#7C9A82" stroke-width="1.2"/>
    <!-- Awning poles, then the striped awning with its scalloped edge. -->
    <path d="M128 262 V362 M322 262 V362" fill="none" stroke="#5F4434" stroke-width="5"/>
    ''' + stripes + '''
    <path d="M120 262 H334" fill="none" stroke-width="3"/>
''' + hang + '''
    <!-- Counter: plank top, planked front, goods standing on it. -->
    <path d="M134 336 H316 L322 346 H128 Z" fill="#C7A06E" stroke-width="1.8"/>
    <path d="M128 346 H322 V372 H128 Z" fill="#8F6F52" stroke-width="2"/>
    <path d="M128 346 H322 V372 H128 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M168 346 V372 M208 346 V372 M248 346 V372 M288 346 V372" fill="none" stroke-width="1.2" opacity="0.6"/>
    <path d="M296 322 Q304 312 312 322 V336 H296 Z" fill="#6C8F9E" stroke-width="1.5"/>
    <path d="M290 326 H294 V336 H290 Z" fill="#E5B861" stroke-width="1.1"/>
    <!-- Crates and sacks stacked left of the shop. -->
''' + crate(62, 380, 46, 32) + crate(66, 346, 40, 30) + _sack(46, 412, 0.8) + _sack(104, 416, 0.9, "#D8C7A4") + barrel(142, 392, 12, 7, 22) + '''
    <!-- Signpost with a hanging coin board. -->
    <path d="M352 292 V382" fill="none" stroke="#4B352B" stroke-width="4"/>
    <path d="M350 300 H392" fill="none" stroke="#4B352B" stroke-width="3"/>
    <path d="M358 300 V308 M388 300 V308" fill="none" stroke-width="1.3"/>
    <path d="M354 308 H394 V336 H354 Z" fill="#B97755" stroke-width="1.8"/>
    <circle cx="374" cy="322" r="10" fill="#E5B861" stroke-width="1.6"/>
    <circle cx="374" cy="322" r="6" fill="none" stroke-width="1.1"/>
    <path d="M374 318 V326" fill="none" stroke-width="1.2"/>
''' + mule + tuft(340, 420) + tuft(124, 428)
shadow = '''    <path d="M110 100 H340 V250 L336 262 V372 H128 V250 H114 L110 250 Z"/>
    <path d="M127 68 H173 V100 H127 Z"/>
    <path d="M299 58 H338 V100 H299 Z"/>
    <path d="M40 330 H156 V424 H40 Z"/>
    <path d="M346 292 H398 V340 H360 V418 H346 Z"/>
    <path d="M376 314 L470 314 L492 330 V374 L482 392 V418 H388 V392 L376 380 Z"/>
'''
specs["trading-post"] = {"title": "Trading Post", "desc": "Timber shop with an open counter, striped awning, wares, signpost and pack mule.", "body": body, "shadow": shadow}


# ---------------------------------------------------------------- Trophy Room
# Low log lodge: shingled roof, a wall of mounted heads under the eave, huge
# horned skull over the door, crossed antlers on the gable ends, drying frame
# with a stretched pelt, spear-and-banner rack and a bone pile.
def _plaque(x, y):
    return f'''    <circle cx="{x}" cy="{y}" r="17" fill="#745846" stroke-width="1.8"/>
    <circle cx="{x}" cy="{y}" r="17" fill="url(#logHatch)" stroke="none"/>
'''


def _big(x, y, fn, k=1.3):
    return f'<g transform="translate({x} {y}) scale({k}) translate({-x} {-y})">{fn(x, y)}</g>\n'


def _antlers(x, y, flip=1):
    s = flip
    return f'''
    <path d="M{x} {y} C{x+10*s} {y-8} {x+14*s} {y-24} {x+10*s} {y-40} M{x+9*s} {y-16} L{x+22*s} {y-24} M{x+12*s} {y-28} L{x+24*s} {y-40} M{x+11*s} {y-34} L{x+4*s} {y-48}" fill="none" stroke="#E0D4B0" stroke-width="5"/>
    <path d="M{x} {y} C{x+10*s} {y-8} {x+14*s} {y-24} {x+10*s} {y-40} M{x+9*s} {y-16} L{x+22*s} {y-24} M{x+12*s} {y-28} L{x+24*s} {y-40} M{x+11*s} {y-34} L{x+4*s} {y-48}" fill="none" stroke="#B5A57B" stroke-width="1.4"/>
'''


def _deer(x, y):
    return _plaque(x, y) + f'''
    <path d="M{x-12} {y-6} C{x-18} {y-16} {x-24} {y-20} {x-22} {y-30} M{x-17} {y-14} L{x-26} {y-14} M{x+12} {y-6} C{x+18} {y-16} {x+24} {y-20} {x+22} {y-30} M{x+17} {y-14} L{x+26} {y-14}" fill="none" stroke="#E0D4B0" stroke-width="3.4"/>
    <path d="M{x-8} {y-8} H{x+8} L{x+6} {y+8} Q{x} {y+15} {x-6} {y+8} Z" fill="#9F7D68" stroke-width="1.5"/>
    <path d="M{x-9} {y-8} L{x-15} {y-13} L{x-6} {y-12} Z M{x+9} {y-8} L{x+15} {y-13} L{x+6} {y-12} Z" fill="#8A6B55" stroke-width="1.2"/>
    <circle cx="{x-3.5}" cy="{y-1}" r="1.5" fill="#010206" stroke="none"/><circle cx="{x+3.5}" cy="{y-1}" r="1.5" fill="#010206" stroke="none"/>
    <circle cx="{x}" cy="{y+8}" r="2" fill="#2c2622" stroke="none"/>
'''


def _boar(x, y):
    return _plaque(x, y) + f'''
    <path d="M{x-12} {y-7} Q{x} {y-14} {x+12} {y-7} L{x+14} {y+5} Q{x} {y+16} {x-14} {y+5} Z" fill="#6E5443" stroke-width="1.6"/>
    <path d="M{x-12} {y-7} L{x-16} {y-14} L{x-6} {y-10} Z M{x+12} {y-7} L{x+16} {y-14} L{x+6} {y-10} Z" fill="#5F4434" stroke-width="1.2"/>
    <path d="M{x-7} {y+4} H{x+7} L{x+6} {y+10} H{x-6} Z" fill="#C9B79A" stroke-width="1.2"/>
    <path d="M{x-8} {y+8} Q{x-15} {y+8} {x-14} {y-1} M{x+8} {y+8} Q{x+15} {y+8} {x+14} {y-1}" fill="none" stroke="#F0E8D0" stroke-width="3"/>
    <circle cx="{x-5}" cy="{y-2}" r="1.5" fill="#010206" stroke="none"/><circle cx="{x+5}" cy="{y-2}" r="1.5" fill="#010206" stroke="none"/>
'''


def _ram(x, y):
    return _plaque(x, y) + f'''
    <path d="M{x-6} {y-6} C{x-22} {y-10} {x-24} {y+10} {x-14} {y+12} C{x-10} {y+12} {x-10} {y+6} {x-13} {y+5} M{x+6} {y-6} C{x+22} {y-10} {x+24} {y+10} {x+14} {y+12} C{x+10} {y+12} {x+10} {y+6} {x+13} {y+5}" fill="none" stroke="#D9CBA3" stroke-width="5"/>
    <path d="M{x-6} {y-8} H{x+6} L{x+5} {y+9} Q{x} {y+14} {x-5} {y+9} Z" fill="#C9B79A" stroke-width="1.5"/>
    <circle cx="{x-2.6}" cy="{y-1}" r="1.4" fill="#010206" stroke="none"/><circle cx="{x+2.6}" cy="{y-1}" r="1.4" fill="#010206" stroke="none"/>
'''


bones = '''
    <!-- Bone pile: femurs, ribs and a small skull. -->
    <path d="M326 420 L396 396 M334 404 L412 418 M346 428 L420 410" fill="none" stroke="#E8DEC4" stroke-width="7"/>
    <path d="M326 420 L396 396 M334 404 L412 418 M346 428 L420 410" fill="none" stroke="#B5A57B" stroke-width="1.3"/>
    <g fill="#E8DEC4" stroke-width="1.4">
      <circle cx="326" cy="420" r="5"/><circle cx="396" cy="396" r="5"/><circle cx="334" cy="404" r="5"/><circle cx="412" cy="418" r="5"/><circle cx="346" cy="428" r="5"/><circle cx="420" cy="410" r="5"/>
    </g>
    <path d="M348 394 Q364 376 380 394 M352 400 Q366 384 378 400 M356 406 Q366 392 376 406" fill="none" stroke="#E8DEC4" stroke-width="3.6"/>
    <path d="M370 424 Q370 410 384 410 Q398 410 398 424 L394 432 H374 Z" fill="#E8DEC4" stroke-width="1.6"/>
    <circle cx="378" cy="421" r="2.6" fill="#26211f" stroke="none"/><circle cx="390" cy="421" r="2.6" fill="#26211f" stroke="none"/>
'''

body = '''
    <!-- Crossed antlers on the gable ends. -->
''' + _antlers(124, 154, -1) + _antlers(124, 154, 1) + _antlers(388, 154, 1) + _antlers(388, 154, -1) + '''
    <!-- Lodge roof (hide patch, smoke hole, small skulls on the eaves) and the log wall strip. -->
''' + roof(112, 150, 288, 96, "#A28268", "#8D6D57", "shingleHatch") + pegs(112, 150, 288, 96) + '''
    <path d="M130 166 H196 V190 H130 Z" fill="#7E6A58" stroke-width="1.6"/>
    <path d="M134 170 Q140 178 134 186 M146 170 Q152 178 146 186 M158 170 Q164 178 158 186 M170 170 Q176 178 170 186 M182 170 Q188 178 182 186" fill="none" stroke="#B5A28A" stroke-width="1.2"/>
    <path d="M326 164 H378 V192 H326 Z" fill="#26211f" stroke-width="2"/>
    <path d="M326 178 H378 M352 164 V192" fill="none" stroke="#745846" stroke-width="3"/>
    <path d="M118 246 H394 L390 340 H122 Z" fill="#8F6F52" stroke-width="2.3"/>
    <path d="M118 246 H394 L390 340 H122 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M118 266 H394 M120 288 H392 M121 312 H391" fill="none" stroke-width="1" opacity="0.45"/>
''' + _big(150, 292, _deer) + _big(196, 292, _boar) + _big(316, 292, _ram) + _big(362, 292, _deer) + '''
    <!-- Door: heavy plank leaves under a lintel of bone. -->
    <path d="M230 296 H282 L280 340 H232 Z" fill="#4B352B" stroke-width="2.1"/>
    <path d="M256 296 V340 M234 312 H280 M234 327 H279" fill="none" stroke-width="1.3" opacity="0.7"/>
    <path d="M224 292 H288 V300 H224 Z" fill="#E8DEC4" stroke-width="1.8"/>
    <path d="M224 340 H288 L294 350 H218 Z" fill="#85827A" stroke-width="1.8"/>
    <!-- The great horned skull: horns, cranium, sockets, nose and teeth. -->
    <path d="M234 238 C208 250 184 234 182 202 C182 190 190 184 198 182 C200 206 216 214 236 216 Z" fill="#E8DEC4" stroke-width="2.3"/>
    <path d="M278 238 C304 250 328 234 330 202 C330 190 322 184 314 182 C312 206 296 214 276 216 Z" fill="#E8DEC4" stroke-width="2.3"/>
    <path d="M196 226 L208 218 M190 208 L204 204 M316 226 L304 218 M322 208 L308 204" fill="none" stroke-width="1.3" opacity="0.7"/>
    <path d="M226 240 C226 214 240 202 256 202 C272 202 286 214 286 240 C286 254 280 260 276 266 L274 290 H238 L236 266 C232 260 226 254 226 240 Z" fill="#EDE4CB" stroke-width="2.4"/>
    <path d="M256 202 C272 202 286 214 286 240 C286 254 280 260 276 266 L274 290 H256 Z" fill="#D2C6A2" stroke="none"/>
    <ellipse cx="242" cy="242" rx="8.5" ry="9.5" fill="#26211f" stroke-width="1.5"/>
    <ellipse cx="270" cy="242" rx="8.5" ry="9.5" fill="#26211f" stroke-width="1.5"/>
    <path d="M256 254 L251 268 H261 Z" fill="#26211f" stroke-width="1"/>
    <path d="M244 275 V288 M250 275 V289 M256 275 V289 M262 275 V289 M268 275 V288" fill="none" stroke-width="1.4"/>
    <path d="M256 204 V220 M246 214 Q256 210 266 214" fill="none" stroke-width="1.2" opacity="0.6"/>
    <g transform="translate(24 0)">
    <!-- Drying frame with a stretched pelt, laced at the edges. -->
    <path d="M40 330 V424 M100 330 V424 M34 332 H106 M34 420 H106" fill="none" stroke="#5F4434" stroke-width="4.4"/>
    <path d="M52 342 Q70 336 88 342 Q98 356 92 372 Q100 388 90 400 Q82 414 70 408 Q60 416 50 402 Q42 390 50 374 Q42 356 52 342 Z" fill="#9A7D62" stroke-width="2"/>
    <path d="M60 358 Q68 352 74 360 M56 380 Q66 374 70 384 M72 396 Q80 390 84 398" fill="none" stroke="#5F4434" stroke-width="1.8" opacity="0.8"/>
    <path d="M52 342 L40 336 M88 342 L100 336 M50 374 L40 374 M92 372 L100 372 M50 402 L40 412 M90 400 L100 412 M70 408 L70 420" fill="none" stroke="#C7A06E" stroke-width="1.6"/>
    </g>
    <g transform="translate(-26 0)">
    <!-- Spear-and-banner rack. -->
    <path d="M418 322 H466 L470 334 H414 Z" fill="#745846" stroke-width="1.8"/>
    <path d="M424 334 V404 M460 334 V404 M418 404 H466" fill="none" stroke-width="3"/>
    <path d="M430 332 V250 M442 332 V262 M454 332 V258" fill="none" stroke="#745846" stroke-width="3.2"/>
    <path d="M430 250 L425 262 H435 Z M442 262 L437 274 H447 Z M454 258 L449 270 H459 Z" fill="#B7B4A9" stroke-width="1.5"/>
    <path d="M442 276 H478 L470 288 L478 300 H442 Z" fill="#9C3F3A" stroke-width="1.7"/>
    <path d="M452 282 L458 288 L452 294 M464 284 L464 292" fill="none" stroke="#E8DEC4" stroke-width="1.6"/>
    </g>
    <g transform="translate(-14 4)">''' + bones + '''</g>''' + tuft(112, 436) + tuft(430, 430)
shadow = '''    <path d="M112 136 H400 V264 L394 264 L390 342 H292 L296 352 H216 L222 342 H122 L118 264 H112 Z"/>
    <path d="M190 194 H322 V290 H190 Z"/>
    <path d="M58 330 H130 V424 H58 Z"/>
    <path d="M388 250 H452 V300 H444 V404 H388 Z"/>
    <path d="M306 380 H410 V438 H306 Z"/>
'''
specs["trophy-room"] = {"title": "Trophy Room", "desc": "Log lodge hung with mounted heads and a horned skull, with a pelt frame, spear rack and bone pile.", "body": body, "shadow": shadow}


# ---------------------------------------------------------------- Vault
# Squat windowless stone strongroom: crenellated roof with a locked trapdoor,
# a massive round iron door with wheel lock, riveted bands, and a canopy
# sheltering two chained armoured chests.
rivets_ring = ""
for i in range(16):
    a = math.radians(i * 22.5)
    rivets_ring += f'<circle cx="{222+46*math.cos(a):.1f}" cy="{330+46*math.sin(a):.1f}" r="2.6" fill="#8D9296" stroke-width="0.9"/>'
spokes = ""
for i in range(6):
    a = math.radians(i * 60 + 15)
    ex, ey = 222 + 23 * math.cos(a), 330 + 23 * math.sin(a)
    spokes += f'<path d="M222 330 L{ex:.1f} {ey:.1f}" fill="none" stroke="#2c2f33" stroke-width="3.6"/><circle cx="{ex:.1f}" cy="{ey:.1f}" r="4.4" fill="#6A6C70" stroke-width="1.4"/>'


def _chest(x, y, w=50):
    return f'''
    <path d="M{x} {y+14} Q{x} {y} {x+w/2} {y} Q{x+w} {y} {x+w} {y+14} Z" fill="#8F6F52" stroke-width="1.9"/>
    <path d="M{x-1} {y+14} H{x+w+1} V{y+40} H{x-1} Z" fill="#745846" stroke-width="1.9"/>
    <path d="M{x+9} {y+1} V{y+40} M{x+w-9} {y+1} V{y+40}" fill="none" stroke="#4D4B47" stroke-width="5"/>
    <path d="M{x-1} {y+14} H{x+w+1}" fill="none" stroke="#4D4B47" stroke-width="4"/>
    <path d="M{x+w/2-6} {y+10} H{x+w/2+6} V{y+24} H{x+w/2-6} Z" fill="#C9A24A" stroke-width="1.5"/>
    <circle cx="{x+w/2}" cy="{y+17}" r="1.8" fill="#26211f" stroke="none"/>
    <path d="M{x+9} {y+4} V{y+8} M{x+9} {y+30} V{y+34} M{x+w-9} {y+4} V{y+8} M{x+w-9} {y+30} V{y+34}" fill="none" stroke="#B5B3AA" stroke-width="2.2"/>
'''


body = '''
    <!-- Roof deck: flagstones inside a plain crenellated parapet. -->
    <path d="M100 100 H340 V252 H100 Z" fill="#7E7B73" stroke="none"/>
    <path d="M100 100 H340 V252 H100 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M114 116 H326 V238 H114 Z" fill="#9A978D" stroke-width="2"/>
    <path d="M114 116 H326 V238 H114 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M100 100 H340 V252 H100 Z" fill="none" stroke-width="2.8"/>
''' + merlons(100, 88, 240, 8, 14) + merlons(100, 244, 240, 8, 14) + '''
    <g fill="#A8A59B" stroke-width="1.5">
      <path d="M92 118 H104 V130 H92 Z M92 146 H104 V158 H92 Z M92 174 H104 V186 H92 Z M92 202 H104 V214 H92 Z"/>
      <path d="M336 118 H348 V130 H336 Z M336 146 H348 V158 H336 Z M336 174 H348 V186 H336 Z M336 202 H348 V214 H336 Z"/>
    </g>
    <!-- Locked trapdoor: plank hatch, iron straps, ring and padlock. -->
    <path d="M168 134 H276 V222 H168 Z" fill="#745846" stroke-width="2.4"/>
    <path d="M168 134 H276 V222 H168 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M168 150 H276 M168 206 H276" fill="none" stroke="#4D4B47" stroke-width="7"/>
    <path d="M168 150 H276 M168 206 H276" fill="none" stroke="#6F6D68" stroke-width="2"/>
    <path d="M168 134 H276 V222 H168 Z" fill="none" stroke-width="2.4"/>
    <circle cx="190" cy="178" r="7" fill="none" stroke="#4D4B47" stroke-width="3.2"/>
    <path d="M232 168 V176 M232 170 Q232 162 240 162 Q248 162 248 170 V176" fill="none" stroke="#8D9296" stroke-width="3"/>
    <path d="M228 176 H252 V194 H228 Z" fill="#C9A24A" stroke-width="1.7"/>
    <circle cx="240" cy="184" r="2.2" fill="#26211f" stroke="none"/>
    <path d="M130 130 H152 V148 H130 Z M290 130 H312 V148 H290 Z" fill="#4D4B47" stroke-width="1.6"/>
    <path d="M134 134 V144 M140 134 V144 M146 134 V144 M294 134 V144 M300 134 V144 M306 134 V144" fill="none" stroke="#8D9296" stroke-width="1.2"/>
    <!-- Front wall of the strongroom with iron bands. -->
''' + stone_face(106, 254, 228, 134, STONE, 6) + '''
    <path d="M110 256 H330 V268 H110 Z" fill="#4D4B47" stroke-width="1.8"/>
    <path d="M112 384 H328 V388 H112 Z" fill="#4D4B47" stroke-width="1.4"/>
    <path d="M108 256 H122 L128 388 H114 Z M318 256 H332 L326 388 H312 Z" fill="#5C5E62" stroke-width="1.8"/>
    <g fill="#8D9296" stroke-width="0.9">
      <circle cx="128" cy="262" r="2.4"/><circle cx="154" cy="262" r="2.4"/><circle cx="188" cy="262" r="2.4"/><circle cx="256" cy="262" r="2.4"/><circle cx="288" cy="262" r="2.4"/><circle cx="314" cy="262" r="2.4"/>
      <circle cx="115" cy="290" r="2.4"/><circle cx="116" cy="324" r="2.4"/><circle cx="117" cy="358" r="2.4"/>
      <circle cx="325" cy="290" r="2.4"/><circle cx="324" cy="324" r="2.4"/><circle cx="323" cy="358" r="2.4"/>
    </g>
    <!-- The round door: bolts into the frame, hinges, ring of rivets, wheel lock. -->
    <path d="M148 312 H176 V322 H148 Z M148 338 H176 V348 H148 Z M268 312 H296 V322 H268 Z M268 338 H296 V348 H268 Z" fill="#6A6C70" stroke-width="1.8"/>
    <circle cx="222" cy="330" r="56" fill="#3F4146" stroke-width="2.6"/>
    <circle cx="222" cy="330" r="50" fill="#5C5E62" stroke-width="1.8"/>
    ''' + rivets_ring + '''
    <circle cx="222" cy="330" r="40" fill="#6F7378" stroke-width="2"/>
    <circle cx="222" cy="330" r="33" fill="none" stroke="#3F4146" stroke-width="2.4"/>
    <path d="M178 306 H190 V318 H178 Z M178 342 H190 V354 H178 Z" fill="#4D4B47" stroke-width="1.5"/>
    ''' + spokes + '''
    <circle cx="222" cy="330" r="8.5" fill="#C9A24A" stroke-width="1.8"/>
    <circle cx="222" cy="330" r="2.6" fill="#26211f" stroke="none"/>
    <path d="M200 300 Q222 292 244 300" fill="none" stroke="#A9ADB1" stroke-width="2.2" opacity="0.7"/>
    <path d="M112 388 H332 L340 404 H104 Z" fill="#85827A" stroke-width="1.9"/>
    <path d="M112 388 H332 L340 404 H104 Z" fill="url(#stoneHatch)" stroke="none"/>
    <!-- Canopy: slanted cloth shelter on two posts over the chained chests. -->
    <path d="M364 290 V404 M468 290 V404" fill="none" stroke="#5F4434" stroke-width="5"/>
    <path d="M350 276 H482 L490 316 H342 Z" fill="#6C7C8E" stroke-width="2.2"/>
    <path d="M350 276 H482 L490 316 H342 Z" fill="url(#roofHatch)" stroke="none"/>
    <path d="M372 276 L368 316 M394 276 L392 316 M416 276 L416 316 M438 276 L440 316 M460 276 L464 316" fill="none" stroke="#4F5B6A" stroke-width="2.4" opacity="0.8"/>
    <path d="M342 316 Q352 324 362 316 Q372 324 382 316 Q392 324 402 316 Q412 324 422 316 Q432 324 442 316 Q452 324 462 316 Q472 324 482 316 L490 316" fill="none" stroke-width="1.8"/>
''' + _chest(356, 348, 54) + _chest(416, 352, 54) + _chain(366, 356, 380, 340, 392, 352) + _chain(452, 358, 432, 346, 416, 356) + _chain(380, 390, 392, 404, 408, 398, 4) + _chain(440, 394, 428, 404, 410, 398, 4) + '''
    <path d="M364 392 H470 V398 H364 Z" fill="#5F4434" stroke-width="1.5"/>
    <circle cx="408" cy="398" r="6" fill="none" stroke="#4D4B47" stroke-width="3"/>
''' + tuft(330, 420) + tuft(480, 414)
shadow = '''    <path d="M92 88 H348 V252 L340 404 H104 L106 254 H92 Z"/>
    <path d="M342 276 H490 V404 H342 Z"/>
'''
specs["vault"] = {"title": "Vault", "desc": "Windowless stone strongroom with a round iron wheel-lock door, trapdoor roof and chained chests.", "body": body, "shadow": shadow}


# ---------------------------------------------------------------- Wizard Tower
# Tall round tower: blue-grey tiled conical roof with crescent finial,
# observatory balcony with a brass telescope, glowing arcane window, a crooked
# timber stair wrapping the shaft, a crystal on a pedestal, floating books.
def _stair(x0, y0, x1, y1, n, depth=13, wob=1.6):
    """Timber flight climbing from (x0,y0) to (x1,y1): zig-zag treads over a stringer."""
    dx, dy = (x1 - x0) / n, (y1 - y0) / n
    pts = [f"M{x0} {y0}"]
    x, y = x0, y0
    for i in range(n):
        w = wob * math.sin(i * 1.7)
        y += dy
        pts.append(f"L{x:.1f} {y+w:.1f}")
        x += dx
        pts.append(f"L{x:.1f} {y+w:.1f}")
    path = " ".join(pts) + f" L{x1} {y1+depth} L{x0} {y0+depth} Z"
    return f'''
    <path d="{path}" fill="#9F7D68" stroke-width="1.8"/>
    <path d="{path}" fill="url(#logHatch)" stroke="none"/>
'''


def _book(x, y, rot, cover="#7D4F8C"):
    return f'''
    <g transform="translate({x} {y}) rotate({rot})">
      <path d="M-18 4 L0 9 L18 4 L18 8 L0 13 L-18 8 Z" fill="{cover}" stroke-width="1.5"/>
      <path d="M-18 4 L-17 -9 Q-8 -12 0 -5 Q8 -12 17 -9 L18 4 L0 9 Z" fill="#EDE4CB" stroke-width="1.5"/>
      <path d="M0 -5 V9 M-12 -4 Q-8 -6 -4 -3 M-12 0 Q-8 -2 -4 1 M4 -3 Q8 -6 12 -4 M4 1 Q8 -2 12 0" fill="none" stroke-width="0.8" opacity="0.6"/>
    </g>
'''


tile_rows = ""
for yy in (78, 100, 122, 144, 166):
    t = (yy - 52) / 126
    hw = 98 * t ** 1.5
    tile_rows += f'<path d="M{256-hw:.0f} {yy} Q256 {yy+11} {256+hw:.0f} {yy}" fill="none" stroke-width="1.1" opacity="0.5"/>'
shaft_courses = ""
for yy in (278, 312, 346, 380, 408):
    k = (yy - 244) / 176
    x1, x2 = 196 - 8 * k, 316 + 8 * k
    shaft_courses += f'<path d="M{x1:.0f} {yy} Q256 {yy+9} {x2:.0f} {yy}" fill="none" stroke-width="1.2" opacity="0.45"/>'
rails = ""
for i in range(9):
    xx = 170 + i * 22.5
    rails += f'<path d="M{xx:.0f} 230 V210" fill="none" stroke="#5F4434" stroke-width="2.6"/>'

body = '''
    <!-- Cast glow of the crystal behind the pedestal. -->
    <circle cx="124" cy="372" r="40" fill="#8FD8E8" stroke="none" opacity="0.22"/>
    <!-- Crescent-moon finial on a staff. -->
    <path d="M256 54 V34" fill="none" stroke-width="2.4"/>
    <path d="M262 4 A15 15 0 1 0 262 36 A11 11 0 1 1 262 4 Z" fill="#E5B861" stroke-width="1.8"/>
    <circle cx="259" cy="20" r="2.2" fill="#F4E9A8" stroke="none"/>
    <!-- Conical tiled roof: two shaded halves, tile courses, flared brim. -->
    <path d="M256 52 C252 86 204 128 158 178 Q206 192 256 192 Z" fill="#7D8CA3" stroke="none"/>
    <path d="M256 52 C260 86 308 128 354 178 Q306 192 256 192 Z" fill="#66758C" stroke="none"/>
    <path d="M256 52 C252 86 204 128 158 178 Q256 200 354 178 C308 128 260 86 256 52 Z" fill="url(#shingleHatch)" stroke="none"/>
    ''' + tile_rows + '''
    <path d="M256 52 C252 86 204 128 158 178 Q256 200 354 178 C308 128 260 86 256 52 Z" fill="none" stroke-width="2.6"/>
    <path d="M158 178 Q256 200 354 178 Q364 188 352 194 Q256 216 160 194 Q148 188 158 178 Z" fill="#4F5A6E" stroke-width="2.2"/>
    <path d="M190 108 Q182 132 172 156 M322 108 Q330 132 340 156" fill="none" stroke="#A9B6C8" stroke-width="1.2" opacity="0.55"/>
    <!-- Roof dormer: a small round window in the cone. -->
    <circle cx="256" cy="124" r="11" fill="#3A4254" stroke-width="2"/>
    <circle cx="256" cy="124" r="6.4" fill="#9EE6F2" stroke-width="1.3"/>
    <!-- Observatory chamber under the brim with two arched slits. -->
    <path d="M196 196 H316 V232 H196 Z" fill="#8E8B83" stroke-width="2.2"/>
    <path d="M196 196 H316 V232 H196 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M214 232 V214 Q214 204 224 204 Q234 204 234 214 V232 Z M278 232 V214 Q278 204 288 204 Q298 204 298 214 V232 Z" fill="#26211f" stroke-width="1.8"/>
    <path d="M240 232 V212 Q240 204 256 204 Q272 204 272 212 V232 Z" fill="#7C6BC0" stroke-width="1.6"/>
    <!-- Brass telescope on a tripod, aimed over the rail. -->
    <path d="M304 230 L292 254 M318 230 L330 254 M311 230 V254" fill="none" stroke="#5F4434" stroke-width="2.4"/>
    <g transform="translate(300 224) rotate(-20)">
      <path d="M-6 -7 H58 V7 H-6 Z" fill="#C9A24A" stroke-width="1.8"/>
      <path d="M58 -11 H84 L84 11 H58 Z" fill="#B58C36" stroke-width="1.8"/>
      <path d="M-14 -4 H-6 V4 H-14 Z" fill="#7E6A2C" stroke-width="1.5"/>
      <path d="M8 -7 V7 M26 -7 V7 M62 -9 V9" fill="none" stroke-width="1.1" opacity="0.7"/>
    </g>
    <!-- Observatory balcony: plank deck, brackets and a railing. -->
    <path d="M156 230 H356 L346 250 H166 Z" fill="#9F7D68" stroke-width="2.1"/>
    <path d="M156 230 H356 L346 250 H166 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M200 250 L212 266 M312 250 L300 266" fill="none" stroke="#4B352B" stroke-width="3"/>
    ''' + rails + '''
    <path d="M162 210 H350" fill="none" stroke="#5F4434" stroke-width="3"/>
    <!-- Tower shaft: round stone, shaded on the right, tile-stone courses. -->
    <path d="M200 250 H312 L324 420 H188 Z" fill="#8C8E94" stroke="none"/>
    <path d="M200 250 H312 L324 420 H188 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M200 250 H220 L212 420 H188 Z" fill="#A9ACB2" stroke="none" opacity="0.7"/>
    <path d="M286 250 H312 L324 420 H292 Z" fill="#010206" stroke="none" opacity="0.2"/>
    ''' + shaft_courses + '''
    <path d="M200 250 H312 L324 420 H188 Z" fill="none" stroke-width="2.6"/>
    <!-- Faintly glowing rune band around the shaft. -->
    <path d="M208 322 l5 -8 l5 8 M222 314 v14 M216 321 h12 M296 316 l-8 14 M288 316 l8 14 M302 322 h-18" fill="none" stroke="#9EE6F2" stroke-width="1.8"/>
    <!-- Glowing arcane window with a rune star. -->
    <circle cx="256" cy="330" r="34" fill="#9EE6F2" stroke="none" opacity="0.26"/>
    <path d="M238 358 V330 Q238 308 256 308 Q274 308 274 330 V358 Z" fill="#A9ACB2" stroke-width="2.2"/>
    <path d="M243 358 V331 Q243 314 256 314 Q269 314 269 331 V358 Z" fill="#9EE6F2" stroke-width="1.6"/>
    <path d="M243 344 Q256 338 269 344 V358 H243 Z" fill="#7C6BC0" stroke="none" opacity="0.6"/>
''' + _star(256, 336, 8, "#FFFFFF") + '''
    <path d="M256 314 V358 M243 336 H269" fill="none" stroke-width="1" opacity="0.5"/>
    <!-- Plinth, door under the stair and porch step. -->
    <path d="M178 420 H334 L346 446 H166 Z" fill="#85827A" stroke-width="2.2"/>
    <path d="M178 420 H334 L346 446 H166 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M280 420 V400 Q280 388 294 388 Q308 388 308 400 V420 Z" fill="#745846" stroke-width="2"/>
    <path d="M294 388 V420 M280 404 H308" fill="none" stroke-width="1.2" opacity="0.7"/>
    <circle cx="289" cy="408" r="1.8" fill="#E5B861" stroke="none"/>
    <path d="M270 446 H318 L322 458 H266 Z" fill="#9A978D" stroke-width="1.8"/>
    <!-- Crooked timber stair: lower flight up the front, landing, wraps behind, upper flight to the balcony. -->
    <path d="M342 372 V446 M352 372 V446" fill="none" stroke="#5F4434" stroke-width="4"/>
    <path d="M150 340 V420 M160 340 V420" fill="none" stroke="#5F4434" stroke-width="4"/>
''' + _stair(172, 424, 338, 370, 9) + '''
    <path d="M172 410 L338 356 M172 424 L172 408 M338 370 L338 354" fill="none" stroke="#5F4434" stroke-width="2.4"/>
    <path d="M326 366 H358 V376 H326 Z" fill="#B08A68" stroke-width="1.9"/>
    <path d="M146 336 H182 V346 H146 Z" fill="#B08A68" stroke-width="1.9"/>
''' + _stair(182, 332, 322, 266, 8) + '''
    <path d="M182 318 L322 252 M182 332 L182 316 M322 266 L322 250" fill="none" stroke="#5F4434" stroke-width="2.4"/>
    <!-- Crystal on a stone pedestal. -->
    <path d="M98 452 H150 L146 440 H102 Z" fill="#8E8B83" stroke-width="1.9"/>
    <path d="M108 440 V414 H140 V440 Z" fill="#A8A59B" stroke-width="2"/>
    <path d="M108 440 V414 H140 V440 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M102 414 H146 L142 404 H106 Z" fill="#B7B4A9" stroke-width="1.9"/>
    <path d="M124 330 L142 362 L138 402 H110 L106 362 Z" fill="#7FD3E6" stroke-width="2"/>
    <path d="M124 330 L142 362 L138 402 H124 Z" fill="#4EA7C4" stroke="none"/>
    <path d="M124 330 L118 362 L124 402 M106 362 H142" fill="none" stroke-width="1.2" opacity="0.7"/>
    <path d="M112 364 L118 358" fill="none" stroke="#FFFFFF" stroke-width="2" opacity="0.8"/>
    <path d="M148 392 L156 372 L162 394 Z M96 394 L90 378 L86 396 Z" fill="#7FD3E6" stroke-width="1.5"/>
    <!-- Floating books and sparks. -->
''' + _book(96, 196, -18) + _book(414, 258, 14, "#3F6F72") + _book(88, 280, 24, "#9C3F3A") + _star(60, 232, 7) + _star(430, 196, 8) + _star(396, 112, 6) + _star(126, 128, 6) + _star(440, 300, 5) + _star(396, 170, 5) + '''
    <circle cx="70" cy="166" r="3" fill="#F4E9A8" stroke-width="0.9"/><circle cx="438" cy="236" r="2.6" fill="#F4E9A8" stroke-width="0.9"/><circle cx="104" cy="248" r="2.4" fill="#F4E9A8" stroke-width="0.9"/><circle cx="410" cy="150" r="2.4" fill="#F4E9A8" stroke-width="0.9"/>
''' + tuft(214, 452) + tuft(346, 454)
shadow = '''    <path d="M256 4 L270 36 L262 52 L354 178 L364 190 L352 194 L356 230 L346 250 H324 L346 446 H166 L188 250 H166 L156 230 L160 194 L148 188 L158 178 L250 52 L248 36 Z"/>
    <path d="M98 330 H152 V452 H98 Z"/>
'''
specs["wizard-tower"] = {"title": "Wizard Tower", "desc": "Slender round tower with blue-grey tiled cone, observatory balcony, telescope, glowing window and crystal.", "body": body, "shadow": shadow}
