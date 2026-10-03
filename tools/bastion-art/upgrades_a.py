"""Bastion upgrades, set A: aviary, armorer, barracks, blacksmith, brewery."""
from bastion_lib import *  # noqa: F401,F403

specs: dict[str, dict[str, str]] = {}

AMBER, AMBER_L = "#D9922E", "#F0C060"
COPPER, COPPER_L, COPPER_D = "#B8672F", "#DE9A5E", "#8A4A24"
IRON, IRON_L, IRON_D = "#4D4B47", "#7A7873", "#2c2926"
STEEL, STEEL_L = "#A9B0B5", "#D2D8DB"
RED, BLUE, GREEN_G = "#9C3F3A", "#4F6B65", "#6C8F7E"
HOP, HOP_D = "#7FA06B", "#5E7F52"
CLOTH = "#E6D9B5"
CAVE = "#26211f"


def pigeon(x, y, s=1.0, flip=False, col="#8F97A6", wing="#6E7686") -> str:
    """A perched pigeon, feet on (x, y), about 26px wide at s=1."""
    sx = -s if flip else s
    return f'''
    <g transform="translate({x} {y}) scale({sx:.2f} {s:.2f})" stroke-width="{1.3/s:.2f}">
      <path d="M-9 -5 L-19 -1 L-17 -9 Z" fill="{wing}"/>
      <path d="M-11 -6 C-10 -16 4 -18 8 -11 C10 -6 6 0 0 0 H-6 C-10 0 -12 -3 -11 -6 Z" fill="{col}"/>
      <path d="M-7 -8 C-2 -14 5 -11 6 -6 C0 -4 -5 -5 -7 -8 Z" fill="{wing}"/>
      <path d="M4 -11 Q8 -8 10 -11" fill="none" stroke="#5FA39A" stroke-width="{1.6/s:.2f}"/>
      <circle cx="8.5" cy="-14.5" r="4.3" fill="{col}"/>
      <path d="M12 -15.5 L17 -13.8 L12 -12.6 Z" fill="#D9A441"/>
      <circle cx="9.6" cy="-15.4" r="0.9" fill="#010206" stroke="none"/>
      <path d="M-2 0 V3.5 M3 0 V3.5" fill="none" stroke="#B5675A"/>
    </g>
'''


def feather(x, y, rot=0, s=1.0, col="#E8E6EA") -> str:
    return f'''    <path transform="translate({x} {y}) rotate({rot}) scale({s})" d="M-8 0 Q0 -5 8 0 Q0 4 -8 0 Z M-8 0 H8" fill="{col}" stroke-width="0.9"/>
'''


def sword(x, y, s=1.0, blade=STEEL, grip="#5F4434", down=True) -> str:
    """A sword hung by its pommel (x, y = pommel), blade pointing down."""
    k = 1 if down else -1
    return f'''
    <g transform="translate({x} {y}) scale(1 {k})" stroke-width="{1.3}">
      <circle cx="0" cy="0" r="2.6" fill="#8A7A5A"/>
      <path d="M-1.8 2 H1.8 V12 H-1.8 Z" fill="{grip}"/>
      <path d="M-8 12 H8 V15 H-8 Z" fill="#8A7A5A"/>
      <path d="M-3.4 15 H3.4 L2.4 {15+44*s:.0f} L0 {15+50*s:.0f} L-2.4 {15+44*s:.0f} Z" fill="{blade}"/>
      <path d="M0 17 V{15+44*s:.0f}" fill="none" stroke="{STEEL_L}" stroke-width="0.9"/>
    </g>
'''


# ---------------------------------------------------------------- Aviary
# A timber pigeon loft on stilts: hip roof with a cupola and weathervane,
# four rows of cubbies with perch ledges and pigeons, a ladder, a message
# tube on a post and a feed sack.
body = '''
    <!-- Ground: scattered grain, droppings and feathers. -->
    <g fill="#E9E4D6" stroke-width="0.9">
      <ellipse cx="206" cy="428" rx="7" ry="3"/><ellipse cx="318" cy="424" rx="5" ry="2.4"/><ellipse cx="270" cy="434" rx="4" ry="2"/>
    </g>
''' + feather(150, 432, -20) + feather(340, 438, 25, 0.9) + feather(236, 440, 70, 0.8, "#BFC4CE") + '''
    <!-- Feed sack, slumped against the stilts, with spilled grain. -->
    <path d="M96 424 C88 400 92 380 104 374 C110 368 130 368 136 374 C148 380 150 402 142 424 Q120 432 96 424 Z" fill="#CDBB92" stroke-width="2"/>
    <path d="M104 374 Q120 386 136 374 M100 392 Q120 400 140 392" fill="none" stroke-width="1.2" opacity="0.7"/>
    <path d="M102 374 Q108 362 114 374 M126 374 Q132 362 138 374" fill="#CDBB92" stroke-width="1.6"/>
    <g fill="#E5C468" stroke-width="0.9">
      <circle cx="152" cy="428" r="2.4"/><circle cx="160" cy="432" r="2.4"/><circle cx="146" cy="436" r="2.4"/><circle cx="168" cy="426" r="2.4"/><circle cx="158" cy="440" r="2.4"/>
    </g>
    <!-- Stilts: three posts on foot stones with cross bracing and a ladder. -->
    <path d="M170 366 L254 416 M254 366 L170 416 M258 366 L342 416 M342 366 L258 416" fill="none" stroke="#5F4434" stroke-width="3.4"/>
    <g fill="#8E8B83" stroke-width="1.8">
      <path d="M156 414 H188 L184 428 H160 Z"/><path d="M240 414 H272 L268 428 H244 Z"/><path d="M324 414 H356 L352 428 H328 Z"/>
    </g>
    <g fill="#8F6F52" stroke-width="2">
      <path d="M162 364 H178 V418 H162 Z"/><path d="M248 364 H264 V418 H248 Z"/><path d="M334 364 H350 V418 H334 Z"/>
    </g>
    <path d="M164 366 V416 M250 366 V416 M336 366 V416" fill="none" stroke-width="1" opacity="0.6"/>
    <path d="M286 366 L300 424 M314 366 L328 424" fill="none" stroke="#5F4434" stroke-width="3"/>
    <path d="M290 384 H318 M293 398 H322 M296 412 H325" fill="none" stroke="#745846" stroke-width="3"/>
    <!-- Loft floor beam. -->
    <path d="M148 358 H364 V370 H148 Z" fill="#745846" stroke-width="2.2"/>
    <!-- Cubby wall: timber frame with a lattice backing. -->
    <path d="M154 200 H358 V360 H154 Z" fill="#9F7D68" stroke-width="2.4"/>
    <path d="M154 200 H358 V360 H154 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M154 200 H358 V360 H154 Z" fill="none" stroke-width="2.6"/>
    <path d="M154 242 H358 M154 282 H358 M154 322 H358 M205 202 V358 M256 202 V358 M307 202 V358" fill="none" stroke="#5F4434" stroke-width="3.2"/>
    <g fill="#26211f" stroke-width="1.6">
''' + "".join(
    f'      <path d="M{x} {y+22} V{y+8} Q{x} {y} {x+9} {y} Q{x+18} {y} {x+18} {y+8} V{y+22} Z"/>\n'
    for y in (210, 250, 290, 330) for x in (170, 221, 272, 323)
) + '''    </g>
    <g fill="#C7A06E" stroke-width="1.5">
''' + "".join(
    f'      <path d="M{x-3} {y+22} H{x+21} V{y+28} H{x-3} Z"/>\n'
    for y in (210, 250, 290, 330) for x in (170, 221, 272, 323)
) + '''    </g>
    <!-- Landing ledge across the loft, wider than the wall, with perching pigeons. -->
    <path d="M136 296 H376 L372 308 H140 Z" fill="#B58F6A" stroke-width="2"/>
    <path d="M150 296 L147 308 M200 296 L198 308 M300 296 L302 308 M350 296 L353 308" fill="none" stroke-width="1" opacity="0.5"/>
''' + pigeon(176, 296, 1.15) + pigeon(250, 296, 1.15, True) + pigeon(332, 296, 1.15) + pigeon(240, 250, 1.0, True) + pigeon(188, 336, 1.0) + pigeon(343, 336, 1.0, True, "#B9B5A8", "#8F8B7E") + pigeon(300, 336, 0.9, False, "#A4A0B4", "#7A7690") + '''
    <g fill="#E9E4D6" stroke-width="0.8">
      <ellipse cx="206" cy="306" rx="4" ry="2"/><ellipse cx="288" cy="307" rx="3" ry="1.6"/><ellipse cx="356" cy="307" rx="3" ry="1.6"/><ellipse cx="324" cy="357" rx="4" ry="1.8"/><ellipse cx="206" cy="357" rx="3" ry="1.6"/>
    </g>
    <!-- Hip roof: upper plane, lower plane, shingle courses and a ridge beam. -->
    <path d="M128 204 L180 112 H332 L384 204 Z" fill="#C4A68F" stroke="none"/>
    <path d="M150 164 H362 L384 204 H128 Z" fill="#AB8670" stroke="none"/>
    <path d="M128 204 L180 112 H332 L384 204 Z" fill="url(#shingleHatch)" stroke="none"/>
    <path d="M128 204 L180 112 H332 L384 204 Z" fill="none" stroke-width="2.8"/>
    <path d="M150 164 H362 M213 112 L196 164 M299 112 L316 164" fill="none" stroke-width="2"/>
    <path d="M172 117 H340" fill="none" stroke="#5F4434" stroke-width="5"/>
    <g fill="#A9856E" stroke-width="1.6">
      <rect x="120" y="198" width="14" height="14" rx="2"/><rect x="378" y="198" width="14" height="14" rx="2"/>
    </g>
    <path d="M198 178 L210 170 H250 L244 192 H194 Z" fill="#8F715E" stroke-width="1.5"/>
    <path d="M196 184 H246" fill="none" stroke-width="1" opacity="0.6"/>
    <!-- Cupola with its own cubby holes, pointed roof and a weathervane. -->
    <path d="M226 74 H286 V122 H226 Z" fill="#9F7D68" stroke-width="2.2"/>
    <path d="M226 74 H286 V122 H226 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M236 86 V96 Q236 92 241 92 Q246 92 246 96 V104 H236 Z M266 86 V96 Q266 92 271 92 Q276 92 276 96 V104 H266 Z" fill="#26211f" stroke-width="1.5"/>
    <path d="M250 80 H262 V104 H250 Z" fill="#26211f" stroke-width="1.5"/>
    <path d="M244 104 H268 V109 H244 Z" fill="#C7A06E" stroke-width="1.4"/>
    <path d="M216 76 L256 36 L296 76 Z" fill="#A57F68" stroke-width="2.4"/>
    <path d="M216 76 L256 36 L296 76 Z" fill="url(#shingleHatch)" stroke="none"/>
    <path d="M256 36 V16 M240 22 L272 22 M256 36 L250 56 M256 36 L262 56" fill="none" stroke="#4B352B" stroke-width="2.2"/>
    <path d="M244 12 C250 8 262 8 266 14 C262 12 258 14 256 16 C252 14 248 14 244 12 Z" fill="#4B352B" stroke-width="1.2"/>
    <path d="M256 36 L258 20" fill="none" stroke-width="0" />
    <!-- Message post: pole, tiny roof, and a scroll tube with a wax seal. -->
    <path d="M410 292 V428" fill="none" stroke="#5F4434" stroke-width="6"/>
    <path d="M412 292 V428" fill="none" stroke="#9F7D68" stroke-width="2"/>
    <path d="M394 296 H426 V316 H394 Z" fill="#B58F6A" stroke-width="2"/>
    <path d="M388 296 L410 276 L432 296 Z" fill="#A57F68" stroke-width="2"/>
    <path d="M404 304 H416 V316 H404 Z" fill="#26211f" stroke-width="1.3"/>
    <path d="M410 318 V338" fill="none" stroke-width="1.5"/>
    <path d="M398 336 H422 Q426 336 426 340 V368 Q426 372 422 372 H398 Q394 372 394 368 V340 Q394 336 398 336 Z" fill="#C7A06E" stroke-width="2"/>
    <path d="M394 346 H426 M394 362 H426" fill="none" stroke="#7A5C3F" stroke-width="2"/>
    <path d="M398 372 H422 V378 H398 Z" fill="#8A7A5A" stroke-width="1.6"/>
    <path d="M400 336 L404 326 H418 L422 336 Z" fill="#E6D9B5" stroke-width="1.5"/>
    <circle cx="410" cy="354" r="4.2" fill="#9C3F3A" stroke-width="1.3"/>
    <path d="M410 372 Q404 388 412 396 M410 372 Q418 386 410 396" fill="none" stroke="#9C3F3A" stroke-width="2"/>
''' + pigeon(424, 292, 0.7, True)
shadow = '''    <path d="M114 202 L180 112 H226 V74 L256 36 L286 74 V112 H332 L398 202 V362 H364 V424 H148 V362 H114 Z"/>
    <path d="M388 276 H432 V296 V428 H394 V296 Z"/>
    <path d="M90 372 H146 V430 H90 Z"/>
'''
specs["aviary"] = {"title": "Aviary", "desc": "Stilted timber pigeon loft with cubbies, perch ledge, cupola and message-tube post.", "body": body, "shadow": shadow}


# ---------------------------------------------------------------- Armorer
# Workshop with a slate lean-to smithy corner (bellows, quench barrel), a mail
# shirt and helm on a stand, a shield rack and a hanging breastplate sign.
body = '''
    <defs>
      <pattern id="mailHatch" width="6" height="6" patternUnits="userSpaceOnUse">
        <path d="M0 3 H6 M3 0 V6" fill="none" stroke="#010206" stroke-width="0.6" opacity="0.28"/>
        <circle cx="3" cy="3" r="2" fill="none" stroke="#010206" stroke-width="0.5" opacity="0.2"/>
      </pattern>
    </defs>
    <!-- Chimney of the smithy corner. -->
    <path d="M370 74 H406 V150 H370 Z" fill="#8E8B83" stroke="none"/>
    <path d="M370 74 H406 V150 H370 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M370 74 H406 V150 H370 Z" fill="none" stroke-width="2.2"/>
    <path d="M365 66 H411 V78 H365 Z" fill="#A8A59B" stroke-width="2"/>
    <path d="M374 69 H402 V75 H374 Z" fill="#26211f" stroke="none"/>
    <!-- Lean-to smithy: slate roof, posts and a dark open front. -->
    <path d="M326 192 H440 V248 H326 Z" fill="#26211f" stroke-width="2.2"/>
    <path d="M338 232 H434 L438 248 H334 Z" fill="#6F6D68" stroke-width="1.8"/>
    <path d="M356 204 H388 L394 232 H350 Z" fill="#8A7A5A" stroke-width="1.6"/>
    <path d="M366 224 L374 206 L382 224 Z" fill="#E08A33" stroke-width="1.2"/>
    <path d="M410 212 L424 208 L430 236 L416 238 Z" fill="#7A5C3F" stroke-width="1.6"/>
    <path d="M410 212 L420 196 L430 208 Z" fill="#A58562" stroke-width="1.5"/>
    <path d="M334 192 V248 M432 192 V248" fill="none" stroke="#5F4434" stroke-width="5"/>
''' + roof(318, 118, 128, 82, "#A3B1B1", "#8F9EA0", "leanHatch") + '''
    <path d="M330 168 H436 M330 150 H436" fill="none" stroke-width="1" opacity="0.4"/>
    <!-- Main workshop: shingled roof, wall strip, shop hatch and door. -->
''' + wall(72, 198, 252, 38, "#8F715E") + roof(64, 92, 268, 108, "#B69A83", "#A57F68", "shingleHatch") + pegs(64, 92, 268, 108) + '''
    <path d="M84 198 V234 M130 198 V234 M232 198 V234 M300 198 V234" fill="none" stroke="#5F4434" stroke-width="3"/>
''' + door(150, 204, 34, 30) + '''
    <path d="M200 206 H290 V228 H200 Z" fill="#26211f" stroke-width="2"/>
    <path d="M196 226 H294 V232 H196 Z" fill="#B58F6A" stroke-width="1.8"/>
    <path d="M206 224 Q214 208 224 216 Q232 208 240 224 Z" fill="#A9B0B5" stroke-width="1.4"/>
    <path d="M196 204 H294 L302 198 H188 Z" fill="#9C3F3A" stroke-width="1.6"/>
    <path d="M206 204 L202 198 M226 204 L224 198 M246 204 L246 198 M266 204 L268 198 M286 204 L290 198" fill="none" stroke-width="1" opacity="0.6"/>
    <path d="M110 128 H178 V160 H110 Z" fill="#8F715E" stroke-width="1.8"/>
    <path d="M110 128 H178 V160 H110 Z" fill="url(#shingleHatch)" stroke="none"/>
    <circle cx="228" cy="142" r="18" fill="#A9B0B5" stroke-width="2"/>
    <circle cx="228" cy="142" r="11" fill="none" stroke-width="1.3"/>
    <path d="M228 124 V160 M210 142 H246" fill="none" stroke-width="1.3" opacity="0.7"/>
    <!-- Hanging breastplate sign on an iron bracket. -->
    <path d="M462 254 V420" fill="none" stroke="#5F4434" stroke-width="6"/>
    <path d="M462 266 H410" fill="none" stroke="#4B352B" stroke-width="4"/>
    <path d="M462 280 L440 266" fill="none" stroke="#4B352B" stroke-width="2.6"/>
    <path d="M416 266 V280 M436 266 V280" fill="none" stroke="#2c2926" stroke-width="1.4"/>
    <path d="M404 280 H448 C452 296 448 318 440 334 Q426 344 412 334 C404 318 400 296 404 280 Z" fill="#A9B0B5" stroke-width="2.2"/>
    <path d="M410 300 Q426 312 442 300 M412 316 Q426 326 440 316" fill="none" stroke="#7A8388" stroke-width="1.4"/>
    <g fill="#7A8388" stroke="none"><circle cx="410" cy="288" r="1.6"/><circle cx="442" cy="288" r="1.6"/><circle cx="426" cy="296" r="1.6"/></g>
    <path d="M426 284 V338 M408 300 Q426 310 444 300" fill="none" stroke="#7A8388" stroke-width="1.6"/>
    <path d="M412 282 Q426 292 440 282" fill="none" stroke="#D2D8DB" stroke-width="1.8"/>
    <!-- Armor stand: pole, shoulder bar, mail shirt, helm with a plume. -->
    <path d="M122 370 L96 408 M122 370 L148 408 M122 370 V408" fill="none" stroke="#5F4434" stroke-width="4.4"/>
    <path d="M122 270 V374" fill="none" stroke="#745846" stroke-width="5.6"/>
    <path d="M86 292 H158" fill="none" stroke="#745846" stroke-width="5"/>
    <path d="M90 288 L106 282 H138 L154 288 L172 320 L156 328 L148 316 V352 H96 V316 L88 328 L72 320 Z" fill="#A9B0B5" stroke-width="2.2"/>
    <path d="M90 288 L106 282 H138 L154 288 L172 320 L156 328 L148 316 V352 H96 V316 L88 328 L72 320 Z" fill="url(#mailHatch)" stroke="none"/>
    <path d="M96 346 H148 L152 358 H92 Z" fill="#8A929A" stroke-width="1.8"/>
    <path d="M122 284 Q112 288 108 296 H136 Q132 288 122 284 Z" fill="#26211f" stroke-width="1.2"/>
    <path d="M102 272 C102 248 112 238 122 238 C132 238 142 248 142 272 Z" fill="#B7BEC2" stroke-width="2.2"/>
    <path d="M108 262 H136 V270 H108 Z" fill="#7A8388" stroke-width="1.3"/>
    <path d="M122 262 V276" fill="none" stroke-width="2.4"/>
    <path d="M122 238 C118 226 128 216 138 224 C132 226 130 232 130 238" fill="#9C3F3A" stroke-width="1.6"/>
    <!-- Shield rack: frame with a round, a heater and a kite shield. -->
    <path d="M196 302 V408 M308 302 V408 M190 304 H314 M190 394 H314" fill="none" stroke="#5F4434" stroke-width="5"/>
    <path d="M196 394 H308 V404 H196 Z" fill="#745846" stroke-width="2"/>
    <circle cx="224" cy="352" r="26" fill="#B58F6A" stroke-width="2.4"/>
    <circle cx="224" cy="352" r="26" fill="url(#logHatch)" stroke="none"/>
    <circle cx="224" cy="352" r="20" fill="none" stroke="#7A5C3F" stroke-width="2.4"/>
    <circle cx="224" cy="352" r="7" fill="#8A929A" stroke-width="1.8"/>
    <path d="M254 326 H290 V352 Q290 376 272 390 Q254 376 254 352 Z" fill="#4F6B65" stroke-width="2.3"/>
    <path d="M254 340 H290 M272 326 V390" fill="none" stroke="#E6D9B5" stroke-width="3"/>
    <path d="M254 326 H290 V352 Q290 376 272 390 Q254 376 254 352 Z" fill="none" stroke-width="2.3"/>
    <path d="M266 394 V380 M278 394 V380" fill="none" stroke-width="0.8" opacity="0"/>
    <path d="M298 312 L318 332 L300 386 L284 366 Z" fill="#9C3F3A" stroke-width="2.2"/>
    <path d="M300 322 L304 372" fill="none" stroke="#E6D9B5" stroke-width="2.2"/>
    <!-- Anvil-top helmet crate with pauldrons and gauntlets. -->
    <path d="M318 384 H386 L390 424 H314 Z" fill="#876A56" stroke-width="2"/>
    <path d="M326 394 L378 416 M378 394 L326 416" fill="none" stroke="#5F4434" stroke-width="1.2" opacity="0.7"/>
    <path d="M326 384 C326 360 334 352 346 352 C358 352 366 360 366 384 Z" fill="#B7BEC2" stroke-width="2"/>
    <path d="M332 372 H360 V378 H332 Z" fill="#7A8388" stroke-width="1.2"/>
    <path d="M374 384 C374 368 380 364 388 364 C392 372 392 378 392 384 Z" fill="#A9B0B5" stroke-width="1.8"/>
    <!-- Quench barrel with steam. -->
''' + barrel(424, 380, 15, 8, 30) + '''
    <path d="M418 372 C412 362 422 356 418 346 M430 374 C424 364 434 358 430 350" fill="none" stroke="#E9E4D6" stroke-width="3" opacity="0.7"/>
'''
shadow = '''    <path d="M64 92 H318 V118 H446 V248 H440 V250 H332 V236 H324 L318 236 H72 Z"/>
    <path d="M365 66 H411 V118 H365 Z"/>
    <path d="M72 238 H172 V410 H72 Z"/>
    <path d="M190 302 H314 V408 H190 Z"/>
    <path d="M314 352 H392 V424 H314 Z"/>
    <path d="M400 266 H464 V420 H400 Z"/>
'''
specs["armorer"] = {"title": "Armorer", "desc": "Armor workshop with lean-to smithy, mail-shirt stand, shield rack and breastplate sign.", "body": body, "shadow": shadow}


# ---------------------------------------------------------------- Barracks
# Long billet: the left half is roofed, the right half is cut open to show
# four cots from above. In front: weapon racks, a clinic cot with a bandage,
# and a carved wooden banner on a pole.
def cot(x, y, blanket, w=34, h=84) -> str:
    return f'''
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="#745846" stroke-width="2"/>
    <path d="M{x+4} {y+4} H{x+w-4} V{y+h-4} H{x+4} Z" fill="#E6D9B5" stroke-width="1.4"/>
    <path d="M{x+4} {y+30} H{x+w-4} V{y+h-4} H{x+4} Z" fill="{blanket}" stroke-width="1.5"/>
    <path d="M{x+4} {y+30} H{x+w-4} V{y+38} H{x+4} Z" fill="#E6D9B5" stroke-width="1.3" opacity="0.8"/>
    <path d="M{x+7} {y+7} H{x+w-7} V{y+20} H{x+7} Z" fill="#F4EDD8" stroke-width="1.4"/>
    <path d="M{x+4} {y+h-4} H{x+w-4}" fill="none" stroke="#010206" stroke-width="1" opacity="0.4"/>
'''


body = '''
    <!-- Cut-away right half: plank floor seen from above, inside timber walls. -->
    <path d="M252 106 H424 V252 H252 Z" fill="#B58F6A" stroke="none"/>
    <path d="M252 106 H424 V252 H252 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M258 124 H418 M258 146 H418 M258 168 H418 M258 190 H418 M258 212 H418 M258 234 H418" fill="none" stroke="#745846" stroke-width="0.9" opacity="0.45"/>
''' + cot(268, 126, RED) + cot(310, 126, GREEN_G) + cot(352, 126, "#C79A3B") + cot(386, 126, BLUE) + '''
    <path d="M270 218 H416 V238 H270 Z" fill="#876A56" stroke-width="2"/>
    <path d="M270 228 H416 M300 218 V238 M340 218 V238 M380 218 V238" fill="none" stroke-width="1.1" opacity="0.7"/>
    <ellipse cx="338" cy="210" rx="13" ry="5" fill="#CDBB92" stroke-width="1.6"/>
    <path d="M252 106 H424 V252 H252 Z" fill="none" stroke-width="2.4"/>
    <!-- Back and right timber wall, thick logs. -->
    <path d="M252 96 H434 V110 H252 Z" fill="#9F7D68" stroke-width="2.2"/>
    <path d="M252 96 H434 V110 H252 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M424 106 H436 V252 H424 Z" fill="#8F715E" stroke-width="2.2"/>
    <path d="M424 106 H436 V252 H424 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M252 246 H436 V262 H252 Z" fill="#8F715E" stroke-width="2.2"/>
    <path d="M262 246 V262 M300 246 V262 M338 246 V262 M376 246 V262 M414 246 V262" fill="none" stroke-width="1.2" opacity="0.65"/>
    <!-- Roofed left half: wall strip, door, barred slits, long shingled roof. -->
''' + wall(60, 252, 192, 34, "#8F715E") + roof(54, 96, 204, 160, "#B69A83", "#A57F68", "shingleHatch") + '''
    <path d="M258 96 L246 256" fill="none" stroke-width="0"/>
    <path d="M66 252 V284 M110 252 V284 M200 252 V284 M246 252 V284" fill="none" stroke="#5F4434" stroke-width="3"/>
''' + door(138, 256, 38, 28) + '''
    <path d="M78 262 H98 V276 H78 Z M212 262 H232 V276 H212 Z" fill="#26211f" stroke-width="1.5"/>
    <path d="M84 262 V276 M92 262 V276 M218 262 V276 M226 262 V276" fill="none" stroke="#6F6D68" stroke-width="1.6"/>
    <g fill="#A9856E" stroke-width="1.6">
      <rect x="48" y="90" width="14" height="14" rx="2"/><rect x="48" y="246" width="14" height="14" rx="2"/><rect x="246" y="246" width="14" height="14" rx="2"/><rect x="246" y="90" width="14" height="14" rx="2"/>
    </g>
    <path d="M92 150 H170 V186 H92 Z" fill="#8F715E" stroke-width="1.8"/>
    <path d="M92 150 H170 V186 H92 Z" fill="url(#shingleHatch)" stroke="none"/>
    <path d="M184 112 H226 V150 H184 Z" fill="#7A5C3F" stroke-width="2"/>
    <path d="M184 122 H226 M184 132 H226 M184 142 H226" fill="none" stroke="#26211f" stroke-width="2.4"/>
    <path d="M180 112 H230 L226 106 H184 Z" fill="#A9856E" stroke-width="1.6"/>
    <path d="M205 100 C198 90 210 84 204 74" fill="none" stroke="#E9E4D6" stroke-width="3" opacity="0.6"/>
    <path d="M60 206 H252 M60 226 H252" fill="none" stroke-width="1" opacity="0.4"/>
    <path d="M80 116 L72 126 M80 116 L88 126" fill="none" stroke-width="0"/>
    <!-- Weapon rack one: a spear rail. -->
    <path d="M60 310 H176 L182 320 H54 Z" fill="#745846" stroke-width="2"/>
    <path d="M62 318 V380 M174 318 V380" fill="none" stroke="#5F4434" stroke-width="5"/>
    <path d="M62 366 H174" fill="none" stroke="#745846" stroke-width="4"/>
''' + "".join(
    f'''    <path d="M{x} 384 V322" fill="none" stroke="#7A5C3F" stroke-width="3"/>
    <path d="M{x} 306 L{x+5} 318 L{x} 324 L{x-5} 318 Z" fill="{STEEL}" stroke-width="1.4"/>
''' for x in (80, 96, 112, 128, 144, 160)
) + '''
    <!-- Weapon rack two: swords, an axe and a mace on pegs. -->
    <path d="M200 306 H296 V382 H200 Z" fill="#8F715E" stroke-width="2.2"/>
    <path d="M200 306 H296 V382 H200 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M208 316 H288 M208 340 H288" fill="none" stroke="#5F4434" stroke-width="3"/>
    <path d="M200 382 H296 V390 H200 Z" fill="#745846" stroke-width="1.8"/>
''' + sword(216, 320, 0.72) + sword(236, 320, 0.72) + '''
    <path d="M262 322 V374" fill="none" stroke="#5F4434" stroke-width="3.4"/>
    <path d="M262 324 C246 322 244 340 252 346 L262 340 Z" fill="#A9B0B5" stroke-width="1.8"/>
    <path d="M262 324 C278 322 280 340 272 346 L262 340 Z" fill="#8A929A" stroke-width="1.8"/>
    <path d="M282 322 V374" fill="none" stroke="#5F4434" stroke-width="3.4"/>
    <circle cx="282" cy="320" r="7" fill="#7A8388" stroke-width="1.8"/>
    <path d="M276 316 L288 324 M288 316 L276 324" fill="none" stroke-width="1.1"/>
    <!-- Clinic cot: patient's bandaged leg on a blanket, pillow, stool with basin. -->
    <path d="M322 330 H416 V404 H322 Z" fill="#745846" stroke-width="2.2"/>
    <path d="M328 336 H410 V398 H328 Z" fill="#E6D9B5" stroke-width="1.6"/>
    <path d="M334 340 H366 V358 H334 Z" fill="#F4EDD8" stroke-width="1.5"/>
    <path d="M328 364 H410 V398 H328 Z" fill="#6C8F7E" stroke-width="1.6"/>
    <path d="M328 364 H410 V374 H328 Z" fill="#E6D9B5" stroke-width="1.3" opacity="0.8"/>
    <path d="M352 372 H400 Q408 372 408 380 Q408 388 400 388 H352 Q344 388 344 380 Q344 372 352 372 Z" fill="#F4EDD8" stroke-width="1.8"/>
    <path d="M356 373 L362 387 M366 373 L372 387 M376 373 L382 387 M386 373 L392 387" fill="none" stroke="#B5A88A" stroke-width="1.4"/>
    <path d="M394 374 Q402 378 398 386" fill="none" stroke="#B5675A" stroke-width="2.2"/>
    <path d="M322 404 V418 M416 404 V418" fill="none" stroke="#5F4434" stroke-width="5"/>
    <path d="M430 372 H450 L448 398 H432 Z" fill="#8E8B83" stroke-width="1.8"/>
    <ellipse cx="440" cy="372" rx="10" ry="3.6" fill="#5B99A6" stroke-width="1.6"/>
    <path d="M428 404 V418 M452 404 V418 M426 400 H454" fill="none" stroke="#5F4434" stroke-width="3"/>
    <path d="M340 408 H352 V424 H340 Z" fill="#F4EDD8" stroke-width="1.4"/>
    <path d="M343 412 H349 M346 410 V422" fill="none" stroke="#9C3F3A" stroke-width="1.6"/>
    <!-- Wooden banner: a carved plank hung from a crossbar, red tails below. -->
    <path d="M458 130 V410" fill="none" stroke="#5F4434" stroke-width="6"/>
    <path d="M436 142 H480" fill="none" stroke="#4B352B" stroke-width="4"/>
    <path d="M440 142 V152 M476 142 V152" fill="none" stroke-width="1.6"/>
    <path d="M438 152 H478 V204 L458 218 L438 204 Z" fill="#B58F6A" stroke-width="2.2"/>
    <path d="M438 152 H478 V204 L458 218 L438 204 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M446 162 L470 192 M470 162 L446 192" fill="none" stroke="#4B352B" stroke-width="3.4"/>
    <circle cx="458" cy="177" r="5" fill="#9C3F3A" stroke-width="1.5"/>
    <path d="M444 205 L440 236 L448 230 L452 238 L452 210 Z M472 205 L476 232 L468 228 L464 238 L464 210 Z" fill="#9C3F3A" stroke-width="1.4"/>
    <path d="M458 122 L466 130 L458 138 L450 130 Z" fill="#8A7A5A" stroke-width="1.6"/>
'''
shadow = '''    <path d="M48 90 H436 V262 H252 V286 H60 V262 H48 Z"/>
    <path d="M54 306 H182 V390 H54 Z"/>
    <path d="M200 306 H296 V392 H200 Z"/>
    <path d="M324 330 H450 V414 H324 Z"/>
    <path d="M436 122 H482 V240 H440 V412 H452 V240 Z"/>
'''
specs["barracks"] = {"title": "Barracks", "desc": "Soldiers' billet cut open to show cots, weapon racks, a clinic cot and a carved banner.", "body": body, "shadow": shadow}


# ---------------------------------------------------------------- Blacksmith
# Stone forge: hip roof with a tall glowing chimney, stone wall with an arched
# hearth, bellows, anvil on a stump, quench trough, hanging blades, coal heap.
def smoke(x, y) -> str:
    return f'''
    <g fill="#CFCBC4" stroke-width="1.2" opacity="0.55">
      <ellipse cx="{x}" cy="{y}" rx="16" ry="10"/><ellipse cx="{x+10}" cy="{y-18}" rx="14" ry="9"/><ellipse cx="{x-4}" cy="{y-34}" rx="12" ry="8"/>
    </g>
'''


body = '''
    <!-- Coal heap and spilled coals on the ground. -->
    <path d="M60 424 C58 404 76 388 98 392 C106 380 130 380 140 394 C158 396 168 412 164 424 Q112 436 60 424 Z" fill="#26211f" stroke-width="2"/>
    <path d="M78 408 L88 400 L96 410 Z M106 398 L116 392 L122 402 Z M128 410 L138 404 L144 414 Z M92 418 L102 412 L108 422 Z" fill="#4D4B47" stroke-width="1.2"/>
    <path d="M110 412 L116 408 L118 416 Z" fill="#E08A33" stroke="none"/>
    <!-- Chimney: tall tapered stone stack with a glowing mouth and smoke. -->
''' + smoke(398, 24) + '''
    <path d="M366 60 H430 L424 200 H372 Z" fill="#8E8B83" stroke="none"/>
    <path d="M366 60 H430 L424 200 H372 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M366 60 L372 200 M430 60 L424 200" fill="none" stroke-width="0"/>
    <path d="M366 60 H430 L424 200 H372 Z" fill="none" stroke-width="2.4"/>
    <path d="M366 60 H378 L383 200 H372 Z M430 60 H418 L413 200 H424 Z" fill="#6F6D68" stroke="none" opacity="0.5"/>
    <path d="M358 50 H438 V66 H358 Z" fill="#A8A59B" stroke-width="2.2"/>
    <path d="M370 53 H426 V63 H370 Z" fill="#26211f" stroke="none"/>
    <path d="M382 63 Q390 46 398 56 Q404 40 410 58 Q418 52 420 63 Z" fill="#E08A33" stroke-width="1.3"/>
    <path d="M392 63 Q398 52 402 60 Q406 52 410 63 Z" fill="#F4D36B" stroke="none"/>
    <!-- Forge hall: stone wall, hearth hood, hip roof. -->
''' + stone_face(78, 190, 300, 62, STONE, 6) + '''
    <path d="M78 190 H378" fill="none" stroke-width="3"/>
    <path d="M90 190 V252 M210 190 V252 M340 190 V252" fill="none" stroke="#5F4434" stroke-width="4"/>
    <!-- Forge mouth: hood, arch, coals and glowing fire. -->
    <path d="M232 252 V208 Q232 196 252 196 Q272 196 272 208 V252 Z" fill="#3A322C" stroke-width="2.2"/>
    <path d="M239 252 V212 Q239 204 252 204 Q265 204 265 212 V252 Z" fill="#E08A33" stroke-width="1.6"/>
    <path d="M244 252 V220 Q244 212 252 212 Q260 212 260 220 V252 Z" fill="#F4D36B" stroke="none"/>
    <path d="M238 252 Q245 242 252 248 Q259 240 266 252 Z" fill="#8A4A24" stroke="none"/>
    <path d="M228 252 H276 L280 258 H224 Z" fill="#6F6D68" stroke-width="1.8"/>
    <circle cx="252" cy="224" r="40" fill="#F0A040" stroke="none" opacity="0.22"/>
    <circle cx="398" cy="58" r="30" fill="#F0A040" stroke="none" opacity="0.2"/>
    <!-- Horseshoe nailed above a stone sill, and the bellows beside the hearth. -->
    <path d="M122 206 V224 Q122 238 134 238 Q146 238 146 224 V206" fill="none" stroke="#2c2926" stroke-width="6"/>
    <path d="M122 206 V224 Q122 238 134 238 Q146 238 146 224 V206" fill="none" stroke="#7A7873" stroke-width="2.4"/>
    <g fill="#2c2926" stroke="none"><circle cx="124" cy="212" r="1.4"/><circle cx="144" cy="212" r="1.4"/><circle cx="125" cy="226" r="1.4"/><circle cx="143" cy="226" r="1.4"/></g>
    <path d="M296 214 L326 204 L326 238 L296 232 Z" fill="#7A5C3F" stroke-width="2"/>
    <path d="M300 218 V230 M308 215 V232 M316 213 V235" fill="none" stroke-width="1.2" opacity="0.8"/>
    <path d="M296 224 H282 L276 230" fill="none" stroke="#4D4B47" stroke-width="3.4"/>
    <path d="M326 216 L346 208 M326 228 L346 238" fill="none" stroke="#5F4434" stroke-width="3"/>
''' + roof(66, 90, 324, 104, "#9A8878", "#7F6E60", "shingleHatch") + pegs(66, 90, 324, 104) + '''
    <path d="M110 142 V190 M346 142 V190" fill="none" stroke-width="0"/>
    <path d="M96 110 H156 V128 H96 Z M284 110 H344 V128 H284 Z" fill="#6A5B4F" stroke-width="1.4" opacity="0.8"/>
    <path d="M300 96 Q326 120 350 100 M310 130 Q330 150 366 128" fill="none" stroke="#2c2926" stroke-width="7" opacity="0.14"/>
    <path d="M168 142 H240 V170 H168 Z" fill="#3A322C" stroke-width="2"/>
    <path d="M178 148 H230 M178 156 H230" fill="none" stroke="#6F6D68" stroke-width="2.4"/>
    <!-- Hanging weapon rack: two posts, a rail, swords and an axe. -->
    <path d="M392 262 V404 M474 262 V404 M384 266 H482" fill="none" stroke="#5F4434" stroke-width="5.4"/>
    <path d="M392 306 H474" fill="none" stroke="#745846" stroke-width="3"/>
''' + sword(410, 276, 0.78) + sword(428, 276, 0.9) + sword(446, 276, 0.7, "#C7CCCF") + '''
    <path d="M462 276 V340" fill="none" stroke="#7A5C3F" stroke-width="3.4"/>
    <path d="M462 280 C452 282 448 296 456 306 L462 298 Z" fill="#A9B0B5" stroke-width="1.8"/>
    <path d="M462 280 C474 282 478 296 470 306 L462 298 Z" fill="#8A929A" stroke-width="1.8"/>
    <path d="M400 372 V398 M414 372 V398 M428 372 V398 M442 372 V398 M456 372 V398" fill="none" stroke="#7A5C3F" stroke-width="3.4"/>
    <path d="M400 372 L404 368 H398 Z M414 372 L418 368 H412 Z M428 372 L432 368 H426 Z M442 372 L446 368 H440 Z M456 372 L460 368 H454 Z" fill="#A9B0B5" stroke-width="1.4"/>
    <path d="M396 398 H474 L478 410 H392 Z" fill="#745846" stroke-width="1.8"/>
    <!-- Anvil on a stump: trunk, ring top, then the anvil, hot bar and hammer. -->
    <path d="M158 342 L162 402 Q190 416 218 402 L222 342 Z" fill="#7A5C3F" stroke-width="2.2"/>
    <path d="M164 364 Q190 374 216 364 M165 384 Q190 394 215 384" fill="none" stroke="#4B352B" stroke-width="1.2" opacity="0.7"/>
    <path d="M170 350 V398 M190 354 V408 M208 350 V398" fill="none" stroke-width="0.8" opacity="0.35"/>
    <ellipse cx="190" cy="342" rx="32" ry="12" fill="#C7A06E" stroke-width="2.2"/>
    <ellipse cx="190" cy="342" rx="21" ry="7.5" fill="none" stroke="#8A6A45" stroke-width="1.2"/>
    <ellipse cx="190" cy="342" rx="10" ry="3.4" fill="none" stroke="#8A6A45" stroke-width="1"/>
    <g transform="translate(190 340)">
      <path d="M-8 -2 H8 L12 -12 H-12 Z" fill="#2c2926" stroke-width="1.8"/>
      <path d="M-30 -38 H20 Q34 -38 44 -46 Q40 -30 26 -26 H16 Q18 -16 22 -10 H-22 Q-16 -18 -16 -26 H-26 Q-34 -26 -30 -38 Z" fill="#4D4B47" stroke-width="2.2"/>
      <path d="M-28 -37 H20 Q30 -37 38 -43" fill="none" stroke="#9AA0A4" stroke-width="2"/>
      <path d="M-16 -26 H16" fill="none" stroke="#2c2926" stroke-width="1.2"/>
      <path d="M-22 -39 H-6 V-44 H-22 Z" fill="#E08A33" stroke-width="1.4"/>
      <path d="M-20 -41 H-10 V-43 H-20 Z" fill="#F4D36B" stroke="none"/>
      <circle cx="-14" cy="-48" r="2" fill="#F4D36B" stroke="none"/><circle cx="-6" cy="-54" r="1.5" fill="#E08A33" stroke="none"/><circle cx="-24" cy="-52" r="1.5" fill="#E08A33" stroke="none"/>
    </g>
    <path d="M214 344 L242 332" fill="none" stroke="#7A5C3F" stroke-width="4.4"/>
    <path d="M236 322 L252 334 L246 342 L230 330 Z" fill="#6E7376" stroke-width="1.8"/>
    <path d="M162 350 L136 334 M162 354 L134 346" fill="none" stroke="#4D4B47" stroke-width="2.8"/>
    <!-- Quench trough: plank box on legs with water, a blade cooling, steam. -->
    <path d="M254 408 V424 M346 408 V424" fill="none" stroke="#5F4434" stroke-width="5"/>
    <path d="M250 352 H350 L344 410 H256 Z" fill="#745846" stroke-width="2.2"/>
    <path d="M250 352 H350 L344 410 H256 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M250 352 H350 L346 372 H254 Z" fill="#5B99A6" stroke-width="2"/>
    <path d="M250 352 H350 L346 372 H254 Z" fill="url(#waterHatch)" stroke="none"/>
    <path d="M254 372 H346" fill="none" stroke-width="1.6"/>
    <path d="M262 352 L326 368" fill="none" stroke="#C7CCCF" stroke-width="5.4"/>
    <path d="M262 352 L326 368" fill="none" stroke="#A9B0B5" stroke-width="3"/>
    <path d="M254 388 H346" fill="none" stroke="#4D4B47" stroke-width="2.2"/>
    <path d="M280 346 C272 334 284 326 278 314 M300 346 C292 334 304 326 298 314 M320 346 C312 334 324 326 318 314" fill="none" stroke="#E9E4D6" stroke-width="3.2" opacity="0.6"/>
'''
shadow = '''    <path d="M66 90 H358 V50 H438 V90 H390 V252 H78 V190 H66 Z"/>
    <path d="M392 262 H482 V410 H392 Z"/>
    <path d="M158 296 H222 V404 H158 Z"/>
    <path d="M250 352 H350 V424 H250 Z"/>
    <path d="M60 380 H168 V428 H60 Z"/>
'''
specs["blacksmith"] = {"title": "Blacksmith", "desc": "Stone forge with a glowing chimney, anvil on a stump, quench trough, bellows and a hanging weapon rack.", "body": body, "shadow": shadow}


# ---------------------------------------------------------------- Brewery
# A hall whose whole roof is a barrel on its side: staves and copper hoops,
# a copper still with a swan-neck pipe, stacked casks, a hop trellis and a
# tankard sign over the door.
def cask_end(cx, cy, r=24) -> str:
    return f'''
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="#A17A5C" stroke-width="2.2"/>
    <circle cx="{cx}" cy="{cy}" r="{r-4}" fill="#B98F68" stroke-width="1.2"/>
    <path d="M{cx-r+6} {cy-6} H{cx+r-6} M{cx-r+4} {cy+6} H{cx+r-4} M{cx} {cy-r+4} V{cy+r-4}" fill="none" stroke="#6A4A32" stroke-width="1" opacity="0.7"/>
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{COPPER_D}" stroke-width="2"/>
    <circle cx="{cx}" cy="{cy}" r="{r-9}" fill="none" stroke="{COPPER}" stroke-width="2.4"/>
    <circle cx="{cx+r*0.3:.0f}" cy="{cy+r*0.28:.0f}" r="3" fill="#4B352B" stroke-width="1"/>
'''


body = '''
    <!-- Hop trellis: poles, a wire frame and climbing bines with cones. -->
    <path d="M318 424 V268 M370 424 V268 M424 424 V268 M318 276 H424 M318 330 H424" fill="none" stroke="#5F4434" stroke-width="4"/>
    <path d="M324 424 Q310 380 330 350 Q344 330 334 300 Q326 284 340 272 M366 424 Q380 392 360 360 Q348 334 366 308 Q372 288 358 274 M418 424 Q404 392 420 360 Q434 330 418 304 Q408 286 420 272" fill="none" stroke="#5E7F52" stroke-width="3"/>
    <g fill="#7FA06B" stroke-width="1.3">
      <path d="M322 300 Q308 296 308 286 Q322 286 330 296 Z M342 340 Q356 336 358 324 Q344 326 338 338 Z M374 296 Q388 292 388 282 Q374 282 368 292 Z M356 346 Q342 346 340 356 Q354 358 360 348 Z M426 300 Q440 296 440 286 Q426 286 420 296 Z M410 346 Q396 346 394 356 Q408 358 414 348 Z M336 392 Q322 392 320 402 Q334 404 340 394 Z M400 380 Q414 376 416 366 Q402 368 396 378 Z"/>
    </g>
    <g fill="#C7D27A" stroke-width="1.2">
      <path d="M332 312 Q326 318 332 326 Q338 318 332 312 Z M348 364 Q342 370 348 378 Q354 370 348 364 Z M366 322 Q360 328 366 336 Q372 328 366 322 Z M412 316 Q406 322 412 330 Q418 322 412 316 Z M426 372 Q420 378 426 386 Q432 378 426 372 Z M376 372 Q370 378 376 386 Q382 378 376 372 Z"/>
    </g>
    <!-- Copper still on a stone firebox: kettle, rivets, swan-neck pipe. -->
    <path d="M410 296 H488 V348 H410 Z" fill="#8E8B83" stroke-width="2.2"/>
    <path d="M410 296 H488 V348 H410 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M428 348 V328 Q428 316 449 316 Q470 316 470 328 V348 Z" fill="#26211f" stroke-width="2"/>
    <path d="M436 348 V332 Q436 324 449 324 Q462 324 462 332 V348 Z" fill="#E08A33" stroke-width="1.4"/>
    <path d="M442 348 V336 Q442 330 449 330 Q456 330 456 336 V348 Z" fill="#F4D36B" stroke="none"/>
''' + "" + '''
    <path d="M414 300 C396 270 398 224 424 206 C440 196 458 196 474 206 C500 224 502 270 484 300 Z" fill="#B8672F" stroke-width="2.4"/>
    <path d="M424 300 C410 270 412 230 430 214 C424 236 428 270 438 300 Z" fill="#DE9A5E" stroke="none"/>
    <path d="M414 300 C396 270 398 224 424 206 C440 196 458 196 474 206 C500 224 502 270 484 300 Z" fill="none" stroke-width="2.4"/>
    <path d="M404 262 Q449 276 494 262" fill="none" stroke="#8A4A24" stroke-width="2.6"/>
    <g fill="#8A4A24" stroke="none">
      <circle cx="412" cy="268" r="2"/><circle cx="426" cy="272" r="2"/><circle cx="441" cy="274" r="2"/><circle cx="456" cy="274" r="2"/><circle cx="472" cy="272" r="2"/><circle cx="486" cy="268" r="2"/>
    </g>
    <path d="M426 210 C432 188 466 188 472 210 Z" fill="#B8672F" stroke-width="2.2"/>
    <path d="M430 206 C436 194 450 192 456 198" fill="none" stroke="#DE9A5E" stroke-width="2.2"/>
    <path d="M449 192 V164 C449 140 420 134 392 142 C378 146 370 154 366 164" fill="none" stroke="#8A4A24" stroke-width="9"/>
    <path d="M449 192 V164 C449 140 420 134 392 142 C378 146 370 154 366 164" fill="none" stroke="#B8672F" stroke-width="5.4"/>
    <path d="M449 192 V164 C449 140 420 134 392 142" fill="none" stroke="#DE9A5E" stroke-width="1.6"/>
    <path d="M358 160 H376 V172 H358 Z" fill="#8A4A24" stroke-width="1.6"/>
    <path d="M443 188 H455 V198 H443 Z" fill="#8A4A24" stroke-width="1.6"/>
    <path d="M488 198 C490 188 482 182 484 172" fill="none" stroke="#E9E4D6" stroke-width="3" opacity="0.6"/>
    <!-- Hall walls under the barrel roof. -->
''' + wall(62, 228, 300, 52, "#C9B79A") + '''
    <path d="M62 228 H362" fill="none" stroke-width="2.4"/>
    <path d="M86 228 V278 M340 228 V278 M138 228 V278 M286 228 V278" fill="none" stroke="#5F4434" stroke-width="3.2"/>
    <path d="M150 238 H174 V262 H150 Z M246 238 H270 V262 H246 Z" fill="#F0C060" stroke-width="1.8"/>
    <path d="M162 238 V262 M150 250 H174 M258 238 V262 M246 250 H270" fill="none" stroke-width="1.2"/>
    <path d="M142 236 H150 V264 H142 Z M174 236 H182 V264 H174 Z M238 236 H246 V264 H238 Z M270 236 H278 V264 H270 Z" fill="#6C8F7E" stroke-width="1.3"/>
    <!-- Double doors with iron straps, the lintel and a step. -->
    <path d="M190 232 H234 V278 H190 Z" fill="#26211f" stroke-width="2"/>
    <path d="M194 236 H211 V278 H194 Z M213 236 H230 V278 H213 Z" fill="#745846" stroke-width="1.6"/>
    <path d="M194 246 H211 M194 262 H211 M213 246 H230 M213 262 H230" fill="none" stroke="#2c2926" stroke-width="2"/>
    <path d="M184 278 H240 L244 288 H180 Z" fill="#85827A" stroke-width="1.8"/>
    <!-- Barrel roof: bulged outline, staves, copper hoops, bung vent. -->
    <path d="M52 134 C96 98 322 98 372 134 V216 C322 252 96 252 52 216 Z" fill="#B58F6A" stroke="none"/>
    <path d="M52 134 C96 98 322 98 372 134 L372 150 C322 118 96 118 52 150 Z" fill="#CDA67E" stroke="none"/>
    <path d="M52 200 C96 232 322 232 372 200 V216 C322 252 96 252 52 216 Z" fill="#8F6A4C" stroke="none"/>
    <path d="M52 134 C96 98 322 98 372 134 V216 C322 252 96 252 52 216 Z" fill="url(#roofHatch)" stroke="none" transform="rotate(90 212 175) translate(0 0)" opacity="0"/>
    <path d="M52 150 C96 122 322 122 372 150 M52 166 C96 142 322 142 372 166 M52 182 C96 160 322 160 372 182 M52 198 C96 178 322 178 372 198" fill="none" stroke-width="1" opacity="0.4"/>
    <path d="M52 134 C96 98 322 98 372 134 V216 C322 252 96 252 52 216 Z" fill="none" stroke-width="2.8"/>
    <g fill="none" stroke="#8A4A24" stroke-width="7">
      <path d="M92 116 C90 150 90 200 92 238"/><path d="M148 107 C146 150 146 204 148 246"/><path d="M212 104 C212 150 212 204 212 250"/><path d="M276 107 C278 150 278 204 276 246"/><path d="M332 116 C334 150 334 200 332 238"/>
    </g>
    <g fill="none" stroke="#DE9A5E" stroke-width="2.4">
      <path d="M92 116 C90 150 90 200 92 238"/><path d="M148 107 C146 150 146 204 148 246"/><path d="M212 104 C212 150 212 204 212 250"/><path d="M276 107 C278 150 278 204 276 246"/><path d="M332 116 C334 150 334 200 332 238"/>
    </g>
    <path d="M52 134 C96 98 322 98 372 134 V216 C322 252 96 252 52 216 Z" fill="none" stroke-width="2.8"/>
    <ellipse cx="244" cy="152" rx="17" ry="12" fill="#6A4A32" stroke-width="2"/>
    <ellipse cx="244" cy="152" rx="9" ry="6" fill="#26211f" stroke-width="1.4"/>
    <path d="M232 144 Q244 136 256 144" fill="none" stroke="#DE9A5E" stroke-width="1.6"/>
    <!-- Stacked casks on their sides, a tapped one on top, plus a mug. -->
''' + cask_end(96, 400, 26) + cask_end(150, 400, 26) + cask_end(202, 400, 26) + cask_end(123, 352, 26) + cask_end(176, 352, 26) + '''
    <path d="M118 308 C118 300 128 296 150 296 C172 296 182 300 182 308 V324 C182 328 172 330 150 330 C128 330 118 328 118 324 Z" fill="#A17A5C" stroke-width="2"/>
    <path d="M132 297 V329 M168 297 V329" fill="none" stroke="#8A4A24" stroke-width="5"/>
    <path d="M118 316 H182" fill="none" stroke-width="0.8" opacity="0.5"/>
    <path d="M182 314 H196 V320 H182 Z" fill="#B8672F" stroke-width="1.6"/>
    <path d="M194 320 V332" fill="none" stroke-width="1.8"/>
    <path d="M232 396 H246 L244 424 H234 Z" fill="#D9922E" stroke-width="1.8"/>
    <path d="M232 400 Q239 394 246 400" fill="none" stroke="#F4EDD8" stroke-width="4"/>
    <path d="M246 404 Q256 406 254 416 Q252 420 245 418" fill="none" stroke-width="1.8"/>
    <!-- Amber lantern on a bracket between the posts. -->
    <path d="M322 232 V244 M314 244 H330" fill="none" stroke="#4B352B" stroke-width="2.4"/>
    <path d="M318 244 H326 V260 H318 Z" fill="#F0C060" stroke-width="1.4"/>
    <path d="M316 244 L322 239 L328 244" fill="#8A4A24" stroke-width="1.4"/>
    <circle cx="322" cy="252" r="16" fill="#F0C060" stroke="none" opacity="0.28"/>
    <!-- Hanging tankard sign by the door. -->
    <path d="M296 262 V420" fill="none" stroke="#5F4434" stroke-width="5"/>
    <path d="M296 270 H306" fill="none" stroke="#4B352B" stroke-width="4"/>
    <path d="M296 320 H322 M296 330 L312 320" fill="none" stroke="#4B352B" stroke-width="3.2"/>
    <path d="M298 322 V334 M320 322 V334" fill="none" stroke="#2c2926" stroke-width="1.2"/>
    <path d="M292 334 H330 V366 H292 Z" fill="#F0C060" stroke-width="2"/>
    <path d="M296 338 H326 M296 362 H326" fill="none" stroke="#B8672F" stroke-width="1.2"/>
    <path d="M299 344 H317 V361 H299 Z" fill="#D9922E" stroke-width="1.6"/>
    <path d="M298 344 Q305 337 313 340 Q320 336 318 344 Z" fill="#F4EDD8" stroke-width="1.4"/>
    <path d="M317 348 H322 Q325 350 324 356 Q322 360 317 358" fill="none" stroke-width="1.8"/>
    <path d="M298 330 L290 340 L298 342" fill="none" stroke-width="0"/>
'''
shadow = '''    <path d="M52 134 C96 98 322 98 372 134 V228 H362 L356 280 H68 L62 228 H52 Z"/>
    <path d="M404 142 C420 134 449 140 449 164 V190 C500 190 504 250 494 300 V348 H410 V300 C396 270 396 224 416 206 C422 196 440 190 449 190 L392 142 Z"/>
    <path d="M92 296 H230 V428 H92 Z"/>
    <path d="M286 262 H336 V424 H286 Z"/>
    <path d="M314 268 H430 V428 H314 Z"/>
'''
specs["brewery"] = {"title": "Brewery", "desc": "Barrel-roofed brewing hall with copper still, stacked casks, hop trellis and tankard sign.", "body": body, "shadow": shadow}


# ---- fit each piece to ~390px and centre it on the canvas ----------------
def _fit(slug, k, x0, y0, x1, y1):
    t = f'translate(256 256) scale({k}) translate({-(x0+x1)/2:.0f} {-(y0+y1)/2:.0f})'
    for key in ("body", "shadow"):
        specs[slug][key] = f'    <g transform="{t}">\n{specs[slug][key]}\n    </g>\n'


_fit("aviary", 0.9, 72, 8, 436, 440)
_fit("armorer", 0.94, 64, 66, 474, 424)
_fit("barracks", 0.9, 48, 74, 482, 424)
_fit("blacksmith", 0.9, 48, 10, 482, 436)
_fit("brewery", 0.86, 52, 98, 502, 432)
