"""Upgrades set C: kennels, library, moat, stable, tavern."""
import math

from bastion_lib import *  # noqa: F401,F403

specs = {}

GLOW, GLOW_L = "#F0CB6A", "#FAE9AE"
PAGE = "#EDE3CC"


# ---------------------------------------------------------------- helpers
def _chain(x1, y1, x2, y2, n=8, rx=4.6, ry=2.6, fill="#9C9A94"):
    """A chain of alternating long and end-on links between two points."""
    ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
    out = [f'    <g fill="{fill}" stroke-width="1.15">']
    for i in range(n + 1):
        t = i / n
        x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
        if i % 2 == 0:
            out.append(f'      <ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{rx}" ry="{ry}" transform="rotate({ang:.0f} {x:.1f} {y:.1f})"/>')
        else:
            out.append(f'      <ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{rx*0.5:.1f}" ry="{ry*1.25:.1f}" transform="rotate({ang:.0f} {x:.1f} {y:.1f})"/>')
    out.append("    </g>\n")
    return "\n".join(out)


def _paw(x, y, s=1.0):
    return f'''    <g fill="#8A7B60" stroke="none" opacity="0.8" transform="translate({x} {y}) scale({s})">
      <ellipse cx="0" cy="2" rx="3.6" ry="3"/><circle cx="-4.6" cy="-2.4" r="1.6"/><circle cx="-1.6" cy="-4.8" r="1.6"/><circle cx="1.6" cy="-4.8" r="1.6"/><circle cx="4.6" cy="-2.4" r="1.6"/>
    </g>
'''


def _hound(x, y, s=1.0, fill="#B98A5A", dark="#7A5436", flip=False, collar="#9C3F3A"):
    """A standing hound in profile: tail, four legs, deep chest, hanging ear. Faces right unless flipped."""
    sx = -s if flip else s
    return f'''
    <g transform="translate({x} {y}) scale({sx:.2f} {s:.2f})" stroke-width="1.5">
      <!-- far legs -->
      <path d="M-6 -22 L-5 0 H3 L3 -22 Z M21 -22 L22 0 H30 L29 -22 Z" fill="{dark}"/>
      <!-- tail, body, darker saddle (lifted above the legs) -->
      <g transform="translate(0 -9)">
        <path d="M-25 -23 C-33 -27 -39 -37 -36 -45 C-31 -36 -27 -32 -20 -28 Z" fill="{dark}"/>
        <path d="M-26 -22 C-26 -31 -10 -33 4 -32 C14 -32 20 -31 23 -27 L23 -14 C8 -9 -12 -9 -24 -12 Z" fill="{fill}"/>
        <path d="M-14 -31 C-2 -33 11 -32 19 -29 L18 -22 C8 -24 -6 -24 -14 -21 Z" fill="{dark}" stroke="none" opacity="0.8"/>
      </g>
      <!-- near legs -->
      <path d="M-24 -24 L-21 0 H-12 L-11 -13 L-5 -15 L-7 -28 Z" fill="{fill}"/>
      <path d="M9 -24 L10 0 H19 L19 -24 Z" fill="{fill}"/>
      <path d="M-21 -4 H-12 M10 -4 H19" fill="none" stroke-width="1" opacity="0.6"/>
      <g transform="translate(0 -9)">
        <!-- neck, head, snout -->
        <path d="M14 -31 L23 -44 L36 -46 L47 -37 L48 -31 L39 -29 L34 -30 L27 -24 L22 -14 Z" fill="{fill}"/>
        <path d="M38 -34 L47 -37 L48 -31 L39 -29 Z" fill="#E3C79A" stroke-width="1.1"/>
        <!-- floppy ear, collar, eye, nose -->
        <path d="M27 -45 Q20 -36 27 -29 L35 -37 Z" fill="{dark}"/>
        <path d="M17 -32 L26 -27" fill="none" stroke="{collar}" stroke-width="3.4"/>
        <circle cx="36" cy="-40" r="1.5" fill="#010206" stroke="none"/>
        <circle cx="47.5" cy="-35" r="2.2" fill="#010206" stroke="none"/>
      </g>
    </g>
'''


def _hound_down(x, y, s=1.0, fill="#8C7561", dark="#5D4A3B"):
    """A hound lying curled with its chin on its front paws."""
    return f'''
    <g transform="translate({x} {y}) scale({s:.2f})" stroke-width="1.5">
      <path d="M-26 -4 C-38 -6 -42 -18 -34 -22 C-34 -14 -30 -10 -22 -9 Z" fill="{dark}"/>
      <path d="M-26 -2 C-28 -17 -10 -22 6 -20 C17 -19 23 -12 22 -2 Z" fill="{fill}"/>
      <path d="M-16 -20 C-4 -22 8 -21 15 -18 L13 -11 C4 -13 -6 -13 -12 -9 Z" fill="{dark}" stroke="none" opacity="0.75"/>
      <path d="M-24 -4 C-22 -10 -14 -10 -10 -4 Z" fill="{fill}"/>
      <path d="M14 -18 C18 -27 30 -27 36 -20 L45 -10 L44 -3 L22 -3 Z" fill="{fill}"/>
      <path d="M36 -12 L45 -10 L44 -3 L34 -3 Z" fill="#E3C79A" stroke-width="1.1"/>
      <path d="M20 -26 Q13 -18 19 -9 L28 -17 Z" fill="{dark}"/>
      <path d="M20 -4 H42" fill="none" stroke-width="1" opacity="0.6"/>
      <circle cx="31" cy="-18" r="1.4" fill="#010206" stroke="none"/>
      <circle cx="44" cy="-9" r="2" fill="#010206" stroke="none"/>
    </g>
'''


def _horse(x, y, s=1.0, body="#8A5A3A", dark="#3F2A20", flip=False):
    """A horse in profile: far legs, barrel, neck, head, mane, tail. Faces right unless flipped."""
    sx = -s if flip else s
    return f'''
    <g transform="translate({x} {y}) scale({sx:.3f} {s:.3f})" stroke-width="{1.7/s:.2f}">
      <!-- tail and far legs -->
      <path d="M-37 -58 C-51 -54 -53 -36 -48 -16 C-44 -31 -40 -42 -33 -48 Z" fill="{dark}"/>
      <path d="M26 -38 L28 -18 L27 -5 H35 L35 -18 L34 -40 Z M-22 -38 L-14 -24 L-12 -18 L-14 -5 H-6 L-5 -18 L-2 -28 L-2 -40 Z" fill="{dark}"/>
      <!-- barrel -->
      <path d="M-38 -50 C-38 -64 -16 -66 2 -64 C14 -63 22 -64 30 -68 L36 -48 C36 -40 32 -36 28 -34 C10 -30 -14 -30 -32 -34 C-36 -38 -38 -44 -38 -50 Z" fill="{body}"/>
      <path d="M-30 -62 C-14 -66 6 -64 20 -66 L18 -56 C4 -58 -16 -56 -32 -54 Z" fill="{dark}" stroke="none" opacity="0.28"/>
      <!-- near legs -->
      <path d="M14 -38 L17 -19 L16 -5 H25 L25 -19 L28 -40 Z" fill="{body}"/>
      <path d="M-32 -40 L-26 -26 L-22 -18 L-24 -5 H-15 L-14 -18 L-9 -28 L-8 -42 Z" fill="{body}"/>
      <path d="M16 -5 H25 V0 H15 Z M-24 -5 H-15 V0 H-25 Z M27 -5 H35 V0 H26 Z M-14 -5 H-6 V0 H-15 Z" fill="#1d1a18" stroke-width="1"/>
      <!-- neck, head -->
      <path d="M28 -68 C34 -80 40 -90 46 -94 L58 -90 C56 -78 52 -62 42 -44 L34 -42 Z" fill="{body}"/>
      <path d="M44 -94 L52 -101 C60 -99 72 -83 75 -76 L73 -70 C67 -70 62 -74 58 -78 L51 -74 C48 -80 46 -86 44 -94 Z" fill="{body}"/>
      <path d="M52 -97 L69 -79" fill="none" stroke="#E6D3B8" stroke-width="2.6" opacity="0.85"/>
      <!-- mane, forelock, ear -->
      <path d="M30 -68 C32 -82 40 -94 48 -99 L50 -92 C44 -88 40 -78 38 -66 Z" fill="{dark}"/>
      <path d="M50 -101 L52 -110 L57 -100 Z" fill="{dark}"/>
      <circle cx="58" cy="-90" r="1.6" fill="#010206" stroke="none"/>
      <circle cx="73" cy="-75" r="1.3" fill="#010206" stroke="none"/>
    </g>
'''


def _rr(x0, y0, x1, y1, r):
    """Rounded-rectangle path data."""
    return (f"M{x0+r} {y0} H{x1-r} A{r} {r} 0 0 1 {x1} {y0+r} V{y1-r} A{r} {r} 0 0 1 {x1-r} {y1} "
            f"H{x0+r} A{r} {r} 0 0 1 {x0} {y1-r} V{y0+r} A{r} {r} 0 0 1 {x0+r} {y0} Z")


# ================================================================ KENNELS
# A dog run: plank kennel house with arched doghouse doors, a wire-mesh pen with
# a gate, a chained hound, a sleeper, a prowler, bone and water bowl.
body = '''
    <defs>
      <pattern id="meshHatch" width="9" height="9" patternUnits="userSpaceOnUse">
        <path d="M0 0 L9 9 M9 0 L0 9" fill="none" stroke="#2c2a27" stroke-width="0.8" opacity="0.55"/>
      </pattern>
    </defs>
    <!-- Pen floor: trampled dirt, scuffs and paw prints. -->
    <path d="M70 258 H442 L456 398 H56 Z" fill="#B8AB8E" stroke-width="1.8"/>
    <path d="M70 258 H442 L456 398 H56 Z" fill="url(#leanHatch)" stroke="none"/>
    <path d="M110 300 Q130 292 150 300 M300 392 Q330 384 360 392 M392 292 Q410 286 424 294" fill="none" stroke="#7A6C52" stroke-width="1.3" opacity="0.6"/>
''' + _paw(214, 308, 0.9) + _paw(226, 318, 0.9) + _paw(300, 322, 0.9) + _paw(312, 332, 0.9) + '''
    <!-- Side fences: post tops marching toward the viewer, joined by rails. -->
    <path d="M70 270 L56 396 M442 270 L456 396" fill="none" stroke="#5F4434" stroke-width="3.2"/>
''' + "".join(
    f'    <circle cx="{70 - 14 * (y - 262) / 136:.1f}" cy="{y}" r="5.4" fill="#A58562" stroke-width="1.6"/>\n'
    f'    <circle cx="{442 + 14 * (y - 262) / 136:.1f}" cy="{y}" r="5.4" fill="#A58562" stroke-width="1.6"/>\n'
    for y in range(274, 400, 25)
) + '''
    <!-- Kennel house: plank roof over a long wall strip with three arched doors. -->
''' + roof(104, 108, 304, 102, "#B79B83", "#A38268", "leanHatch") + '''
    <path d="M104 134 H408 M104 180 H408 M104 195 H408" fill="none" stroke-width="0.9" opacity="0.4"/>
    <!-- Roof: a mended patch, a ventilation hatch with a bone nailed up, ridge cap. -->
    <path d="M132 118 H196 V152 H132 Z" fill="#8F715E" stroke-width="1.5"/>
    <path d="M132 118 H196 V152 H132 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M132 135 H196" fill="none" stroke-width="1" opacity="0.6"/>
    <path d="M308 148 H356 V180 H308 Z" fill="#5F4F44" stroke-width="1.8"/>
    <path d="M314 154 H350 V174 H314 Z M314 160 H350 M314 167 H350" fill="none" stroke-width="1.1" opacity="0.7"/>
    <path d="M112 210 H400 L394 262 H118 Z" fill="#8F715E" stroke-width="2.1"/>
    <path d="M112 210 H400 L394 262 H118 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M118 210 L124 262 M156 210 L158 262 M200 210 L201 262 M312 210 L311 262 M356 210 L354 262 M394 210 L388 262" fill="none" stroke="#5F4434" stroke-width="2.4"/>
    <path d="M112 210 H400 V219 H112 Z" fill="#745846" stroke-width="1.8"/>
    <!-- Three arched doghouse openings: trim, dark hollow, shaped step. -->
    <g stroke-width="1.9">
      <path d="M143 262 V236 Q143 212 168 212 Q193 212 193 236 V262 Z" fill="#745846"/>
      <path d="M231 262 V236 Q231 212 256 212 Q281 212 281 236 V262 Z" fill="#745846"/>
      <path d="M319 262 V236 Q319 212 344 212 Q369 212 369 236 V262 Z" fill="#745846"/>
    </g>
    <g stroke-width="1.5" fill="#241c19">
      <path d="M149 262 V237 Q149 219 168 219 Q187 219 187 237 V262 Z"/>
      <path d="M237 262 V237 Q237 219 256 219 Q275 219 275 237 V262 Z"/>
      <path d="M325 262 V237 Q325 219 344 219 Q363 219 363 237 V262 Z"/>
    </g>
    <path d="M139 262 H197 L199 270 H137 Z M227 262 H285 L287 270 H225 Z M315 262 H373 L375 270 H313 Z" fill="#85827A" stroke-width="1.5"/>
    <!-- A hound looking out of the middle door. -->
    <path d="M241 262 C240 242 247 234 256 234 C265 234 272 242 271 262 Z" fill="#B07D52" stroke-width="1.6"/>
    <path d="M247 262 C247 254 251 250 256 250 C261 250 265 254 265 262 Z" fill="#E3C79A" stroke-width="1.2"/>
    <path d="M243 241 Q233 242 236 257 Q242 255 246 247 Z M269 241 Q279 242 276 257 Q270 255 266 247 Z" fill="#6F4A30" stroke-width="1.4"/>
    <ellipse cx="256" cy="251" rx="3.6" ry="2.6" fill="#010206" stroke="none"/>
    <circle cx="250" cy="241" r="1.7" fill="#010206" stroke="none"/><circle cx="262" cy="241" r="1.7" fill="#010206" stroke="none"/>
    <path d="M256 255 V260" fill="none" stroke-width="1.1"/>
    <!-- Glowing eyes in the dark right-hand door, and a water-stained plank. -->
    <circle cx="338" cy="244" r="2" fill="#F4D36B" stroke="none"/><circle cx="350" cy="244" r="2" fill="#F4D36B" stroke="none"/>
    <path d="M118 226 H138 V252 H118 Z" fill="#A58562" stroke-width="1.5"/>
    <g transform="rotate(-50 128 239)" fill="#EDE3CC" stroke-width="1.1"><path d="M121 237.5 H135 V240.5 H121 Z"/><circle cx="121" cy="237" r="2.6"/><circle cx="121" cy="241" r="2.6"/><circle cx="135" cy="237" r="2.6"/><circle cx="135" cy="241" r="2.6"/></g>
    <!-- Chain stake with its ring, bowl and bone. -->
    <ellipse cx="90" cy="342" rx="10" ry="4.5" fill="#8A7C60" stroke="none" opacity="0.6"/>
    <path d="M85 322 H95 L96 342 H84 Z" fill="#A58562" stroke-width="1.7"/>
    <circle cx="90" cy="328" r="4.4" fill="none" stroke-width="2"/>
''' + _chain(93, 329, 176, 309, 11) + '''
    <ellipse cx="262" cy="322" rx="19" ry="8.5" fill="#8E8B83" stroke-width="1.8"/>
    <ellipse cx="262" cy="321" rx="14" ry="5.6" fill="#5B99A6" stroke-width="1.2"/>
    <path d="M253 320 Q259 317 265 320" fill="none" stroke="#A3C9CC" stroke-width="1.1"/>
    <g transform="rotate(-14 262 368)" fill="#EDE3CC" stroke-width="1.4">
      <path d="M248 366 H276 V371 H248 Z"/>
      <circle cx="247" cy="365" r="4.2"/><circle cx="247" cy="372" r="4.2"/><circle cx="277" cy="365" r="4.2"/><circle cx="277" cy="372" r="4.2"/>
    </g>
''' + _hound(142, 362, 1.55, "#B98A5A", "#74502F") + _hound_down(352, 384, 1.5) + _hound(404, 322, 1.4, "#8D8A85", "#4D4B47", True, "#4B7A8F") + '''
    <!-- Front fence: wire mesh between two rails, posts and a gate. -->
    <path d="M56 396 H456 V424 H56 Z" fill="#B8AB8E" stroke="none" opacity="0.4"/>
    <path d="M62 404 H450 V420 H62 Z" fill="url(#meshHatch)" stroke="none"/>
    <path d="M62 400 H450 M62 422 H450" fill="none" stroke="#5F4434" stroke-width="5"/>
    <path d="M62 400 H450 M62 422 H450" fill="none" stroke="#A58562" stroke-width="2.6"/>
    <g fill="#8F6F52" stroke-width="1.8">
''' + "".join(
    f'      <path d="M{x} 428 V390 L{x+5} 384 L{x+10} 390 V428 Z"/>\n'
    for x in (56, 98, 140, 182, 296, 338, 380, 422, 446)
) + '''    </g>
    <path d="M196 428 V380 L203 372 L210 380 V428 Z M282 428 V380 L289 372 L296 380 V428 Z" fill="#745846" stroke-width="2"/>
    <path d="M210 386 H282 V424 H210 Z" fill="#A58562" stroke-width="2"/>
    <path d="M210 386 H282 V424 H210 Z" fill="url(#meshHatch)" stroke="none"/>
    <path d="M210 386 L282 424 M210 424 L282 386" fill="none" stroke="#5F4434" stroke-width="2.6" opacity="0.8"/>
    <path d="M210 386 H282 V424 H210 Z" fill="none" stroke-width="2.2"/>
    <circle cx="276" cy="404" r="2.6" fill="#D7C39A" stroke-width="1"/>
'''
shadow = '''    <path d="M104 104 H408 V210 H400 L394 262 H118 L112 210 H104 Z"/>
    <path d="M70 262 H442 L456 428 H56 L70 262 Z"/>
    <path d="M196 372 H296 V386 H196 Z"/>
'''
specs["kennels"] = {"title": "Kennels", "desc": "Plank kennel house with arched doghouse doors and a wire-mesh dog run with three hounds.", "body": body, "shadow": shadow}


# ================================================================ LIBRARY
# Slate-roofed stone-and-timber reading hall with glowing arched windows, a
# skylight, an open bay of shelves with a book wheel, a cart of tomes, a lantern.
SL_L, SL_D = "#A8B5B2", "#8A9A97"
_books = ["#9C3F3A", "#3F6C8A", "#5C7F4F", "#C8A25B", "#6D4F82", "#8A5A3A", "#3E4F5F"]


def _shelf_books(x0, x1, y_base, seed):
    out = []
    x = x0
    i = seed
    while x < x1 - 6:
        w = 5 + (i * 3) % 5
        h = 14 + (i * 7) % 9
        col = _books[i % len(_books)]
        out.append(f'      <path d="M{x} {y_base} V{y_base-h} H{x+w} V{y_base} Z" fill="{col}"/>')
        x += w
        i += 1
    return "\n".join(out)


body = '''
    <!-- Open reading bay on the right: dark interior, timber posts, shelves of books. -->
''' + roof(316, 172, 136, 88, SL_L, SL_D, "shingleHatch") + '''
    <path d="M324 260 H446 V366 H324 Z" fill="#33292A" stroke-width="2"/>
    <path d="M324 260 H446 V366 H324 Z" fill="url(#logHatch)" stroke="none" opacity="0.6"/>
    <g fill="#9F7D68" stroke-width="1.6">
      <path d="M330 292 H440 V298 H330 Z"/><path d="M330 326 H440 V332 H330 Z"/><path d="M330 358 H440 V364 H330 Z"/>
    </g>
    <g stroke-width="1.1">
''' + _shelf_books(334, 436, 292, 0) + "\n" + _shelf_books(334, 436, 326, 3) + "\n" + _shelf_books(334, 436, 358, 5) + '''
    </g>
    <!-- Book wheel lectern: a turning frame of open tomes on a trestle. -->
    <path d="M356 366 L366 338 L376 366 M366 338 V348" fill="none" stroke="#4B352B" stroke-width="3"/>
    <circle cx="366" cy="326" r="19" fill="#9F7D68" stroke-width="2"/>
    <circle cx="366" cy="326" r="19" fill="url(#logHatch)" stroke="none"/>
    <path d="M366 307 V345 M347 326 H385 M352.5 312.5 L379.5 339.5 M379.5 312.5 L352.5 339.5" fill="none" stroke-width="1.5" opacity="0.8"/>
    <g fill="#EDE3CC" stroke-width="1.4">
      <path d="M358 300 H374 V310 H358 Z"/><path d="M378 318 H388 V334 H378 Z"/><path d="M344 318 H354 V334 H344 Z"/><path d="M358 342 H374 V352 H358 Z"/>
    </g>
    <path d="M366 300 V310 M383 318 V334 M349 318 V334 M366 342 V352" fill="none" stroke-width="1" opacity="0.7"/>
    <circle cx="366" cy="326" r="4.5" fill="#745846" stroke-width="1.6"/>
    <!-- Ladder against the shelves. -->
    <path d="M414 270 L424 366 M430 270 L440 366" fill="none" stroke="#C7A06E" stroke-width="3.2"/>
    <path d="M416 290 H432 M418 312 H434 M420 334 H436 M422 354 H438" fill="none" stroke="#C7A06E" stroke-width="2.6"/>
    <g fill="#8F6F52" stroke-width="2">
      <path d="M318 254 H332 V368 H318 Z"/><path d="M440 254 H454 V368 H440 Z"/>
    </g>
    <path d="M318 254 H454 V268 H318 Z" fill="#745846" stroke-width="2"/>
    <path d="M324 366 H450 V374 H324 Z" fill="#A8A59B" stroke-width="1.8"/>
    <path d="M96 56 H132 V136 H96 Z" fill="#8E8B83" stroke="none"/>
    <path d="M96 56 H132 V136 H96 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M96 56 H132 V136 H96 Z" fill="none" stroke-width="2.2"/>
    <path d="M91 48 H137 V60 H91 Z" fill="#A8A59B" stroke-width="2"/>
    <path d="M99 51 H129 V57 H99 Z" fill="#26211f" stroke="none"/>
    <!-- Main hall roof: slate, a stone chimney behind the ridge, a glazed skylight on the slope. -->
''' + roof(66, 90, 268, 142, SL_L, SL_D, "shingleHatch") + '''
    <path d="M150 112 H236 L242 164 H144 Z" fill="#745846" stroke-width="2.2"/>
    <path d="M158 120 H228 L232 156 H154 Z" fill="#CFE8E4" stroke-width="1.6"/>
    <path d="M158 120 H228 L232 156 H154 Z" fill="none" stroke-width="1.1"/>
    <path d="M193 120 V156 M156 138 H230" fill="none" stroke-width="1.6"/>
    <path d="M163 124 L178 124 L168 152 L160 152 Z" fill="#F5FBFA" stroke="none" opacity="0.8"/>
    <path d="M142 170 H244 V178 H142 Z" fill="#5F4434" stroke-width="1.6"/>
    <!-- Weathervane: a little open book over the gable end. -->
    <path d="M300 92 V66" fill="none" stroke="#4B352B" stroke-width="2.4"/>
    <path d="M300 68 Q310 62 320 68 V80 Q310 74 300 80 Z" fill="#EDE3CC" stroke-width="1.5"/>
    <path d="M310 64 V77" fill="none" stroke-width="1"/>
    <!-- Hall front: stone below a timber eave beam, string course, tall glowing windows. -->
''' + stone_face(72, 232, 260, 134, STONE, 4) + '''
    <path d="M66 226 H340 V240 H66 Z" fill="#5F4434" stroke-width="2.2"/>
    <path d="M66 226 H340 V240 H66 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M74 248 V366 M330 248 V366" fill="none" stroke="#5F4434" stroke-width="6"/>
    <path d="M72 338 H332 L331 346 H73 Z" fill="#6F6D68" stroke-width="1.5"/>
    <g stroke-width="1.8">
      <path d="M91 332 V284 Q91 260 107 260 Q123 260 123 284 V332 Z" fill="#745846"/>
      <path d="M131 332 V284 Q131 260 147 260 Q163 260 163 284 V332 Z" fill="#745846"/>
      <path d="M245 332 V284 Q245 260 261 260 Q277 260 277 284 V332 Z" fill="#745846"/>
      <path d="M285 332 V284 Q285 260 301 260 Q317 260 317 284 V332 Z" fill="#745846"/>
    </g>
    <g stroke-width="1.3" fill="#F0CB6A">
      <path d="M96 332 V285 Q96 266 107 266 Q118 266 118 285 V332 Z"/>
      <path d="M136 332 V285 Q136 266 147 266 Q158 266 158 285 V332 Z"/>
      <path d="M250 332 V285 Q250 266 261 266 Q272 266 272 285 V332 Z"/>
      <path d="M290 332 V285 Q290 266 301 266 Q312 266 312 285 V332 Z"/>
    </g>
    <g fill="#FAE9AE" stroke="none">
      <path d="M96 332 V285 Q96 266 107 266 V332 Z"/><path d="M136 332 V285 Q136 266 147 266 V332 Z"/>
      <path d="M250 332 V285 Q250 266 261 266 V332 Z"/><path d="M290 332 V285 Q290 266 301 266 V332 Z"/>
    </g>
    <g fill="none" stroke-width="1.3">
      <path d="M107 266 V332 M96 296 H118 M96 316 H118"/><path d="M147 266 V332 M136 296 H158 M136 316 H158"/>
      <path d="M261 266 V332 M250 296 H272 M250 316 H272"/><path d="M301 266 V332 M290 296 H312 M290 316 H312"/>
    </g>
    <path d="M87 332 H127 V338 H87 Z M127 332 H167 V338 H127 Z M241 332 H281 V338 H241 Z M281 332 H321 V338 H281 Z" fill="#A8A59B" stroke-width="1.4"/>
    <!-- Double door under a stone arch, with a carved book plaque and steps. -->
    <path d="M176 366 V312 Q176 284 202 284 Q228 284 228 312 V366 Z" fill="#A8A59B" stroke-width="2.2"/>
    <path d="M183 366 V314 Q183 292 202 292 Q221 292 221 314 V366 Z" fill="#745846" stroke-width="1.9"/>
    <path d="M202 292 V366 M184 318 H220 M184 342 H220" fill="none" stroke-width="1.3" opacity="0.8"/>
    <path d="M186 318 H198 M206 318 H218 M186 342 H198 M206 342 H218" fill="none" stroke="#2c2c2c" stroke-width="3" opacity="0.7"/>
    <circle cx="198" cy="332" r="2" fill="#D7C39A" stroke-width="1"/><circle cx="206" cy="332" r="2" fill="#D7C39A" stroke-width="1"/>
    <path d="M202 272 Q212 266 222 270 V250 Q212 246 202 252 Q192 246 182 250 V270 Q192 266 202 272 Z" fill="#EDE3CC" stroke-width="1.5"/>
    <path d="M202 252 V272 M188 256 H198 M188 262 H198 M206 256 H216 M206 262 H216" fill="none" stroke-width="0.9" opacity="0.8"/>
    <path d="M170 366 H234 L242 378 H162 Z" fill="#9A978D" stroke-width="1.8"/>
    <path d="M162 378 H242 L248 388 H156 Z" fill="#85827A" stroke-width="1.8"/>
    <!-- Cart of tomes and scrolls. -->
    <path d="M60 424 L92 410 M60 428 L92 414" fill="none" stroke="#5F4434" stroke-width="3"/>
    <path d="M90 408 H206 L200 428 H96 Z" fill="#876A56" stroke-width="1.9"/>
    <path d="M92 408 H204 V413 H92 Z" fill="#A9856E" stroke-width="1.4"/>
    <path d="M110 414 V426 M130 414 V426 M150 414 V426 M170 414 V426 M190 414 V426" fill="none" stroke-width="1" opacity="0.6"/>
    <g stroke-width="1.2">
''' + _shelf_books(98, 156, 408, 2) + "\n" + _shelf_books(104, 170, 394, 6) + '''
    </g>
    <path d="M168 408 L196 396" fill="none" stroke="#5F4434" stroke-width="2.6"/>
    <g fill="#EDE3CC" stroke-width="1.4">
      <path d="M160 404 L196 386 L199 392 L163 410 Z"/><path d="M172 402 L198 396 L199 402 L174 408 Z" fill="#D9C79F"/>
    </g>
    <ellipse cx="196" cy="389" rx="3" ry="4" fill="#C8A25B" stroke-width="1.2" transform="rotate(-25 196 389)"/>
    <g fill="#9F7D68" stroke-width="2">
      <circle cx="122" cy="430" r="15"/><circle cx="184" cy="430" r="15"/>
    </g>
    <g fill="#745846" stroke-width="1.5"><circle cx="122" cy="430" r="4.5"/><circle cx="184" cy="430" r="4.5"/></g>
    <path d="M122 415 V445 M107 430 H137 M111.4 419.4 L132.6 440.6 M132.6 419.4 L111.4 440.6 M184 415 V445 M169 430 H199 M173.4 419.4 L194.6 440.6 M194.6 419.4 L173.4 440.6" fill="none" stroke-width="1.2" opacity="0.75"/>
    <!-- Candle lantern on a post. -->
    <path d="M398 438 V382 H414" fill="none" stroke="#4B352B" stroke-width="3.4"/>
    <path d="M414 382 V388" fill="none" stroke-width="1.6"/>
    <circle cx="414" cy="405" r="20" fill="#F7E08F" stroke="none" opacity="0.28"/>
    <path d="M406 390 H422 L424 396 H404 Z" fill="#4D4B47" stroke-width="1.5"/>
    <path d="M405 396 H423 V414 H405 Z" fill="#F0CB6A" stroke-width="1.6"/>
    <path d="M414 396 V414 M405 405 H423" fill="none" stroke-width="1.1"/>
    <path d="M404 414 H424 L421 419 H407 Z" fill="#4D4B47" stroke-width="1.5"/>
    <path d="M414 408 C410 404 413 400 414 398 C416 401 418 404 414 408 Z" fill="#E08A33" stroke="none"/>
    <ellipse cx="398" cy="440" rx="9" ry="3.5" fill="#85827A" stroke-width="1.5"/>
'''
shadow = '''    <path d="M66 90 H334 V226 H340 V366 H316 V172 H452 V374 H324 V366 H66 Z"/>
    <path d="M316 172 H452 V374 H316 Z"/>
    <path d="M156 366 H248 V388 H156 Z"/>
    <path d="M90 380 H206 V445 H90 Z"/>
    <path d="M395 382 H424 V440 H395 Z"/>
'''
specs["library"] = {"title": "Library", "desc": "Stone-and-timber reading hall with glowing windows, skylight, shelf bay with book wheel, and a cart of tomes.", "body": body, "shadow": shadow}


# ================================================================ MOAT
# Full-canvas ring: water channel round the edge, mud banks, reeds, lily pads,
# a plank drawbridge across the front channel with chains. Island left clear.
def _reeds(x, y, h=26, n=3, lean=0):
    out = [f'    <g stroke-width="1.2">']
    for i in range(n):
        dx = (i - (n - 1) / 2) * 5.5
        hh = h - 4 * abs(i - (n - 1) / 2) + (i * 3 % 5)
        tx = x + dx + lean * (1 + i * 0.3) + (4 if i % 2 else -4)
        out.append(f'      <path d="M{x+dx:.1f} {y} Q{x+dx+lean*0.4:.1f} {y-hh*0.55:.1f} {tx:.1f} {y-hh:.1f}" fill="none" stroke="#5F7F4F" stroke-width="2.2"/>')
        if i % 2 == 0:
            out.append(f'      <ellipse cx="{tx:.1f}" cy="{y-hh-3:.1f}" rx="2.6" ry="6" fill="#6B4A33" transform="rotate({lean*1.5:.0f} {tx:.1f} {y-hh-3:.1f})"/>')
        else:
            out.append(f'      <path d="M{tx:.1f} {y-hh:.1f} q{3+lean*0.2:.1f} -6 {1+lean*0.3:.1f} -10" fill="none" stroke="#7FA06B" stroke-width="1.8"/>')
    out.append("    </g>\n")
    return "\n".join(out)


def _pad(cx, cy, r=10, a=30, flower=False):
    a0 = math.radians(a)
    a1 = math.radians(a + 330)
    x0, y0 = cx + r * math.cos(a0), cy + r * 0.7 * math.sin(a0)
    x1, y1 = cx + r * math.cos(a1), cy + r * 0.7 * math.sin(a1)
    s = f'''    <path d="M{cx} {cy} L{x0:.1f} {y0:.1f} A{r} {r*0.7:.1f} 0 1 1 {x1:.1f} {y1:.1f} Z" fill="#6F9A5B" stroke-width="1.2"/>
    <path d="M{cx} {cy} L{cx+r*0.6*math.cos(a0+2):.1f} {cy+r*0.4*math.sin(a0+2):.1f}" fill="none" stroke-width="0.8" opacity="0.6"/>
'''
    if flower:
        s += f'    <circle cx="{cx+r*0.15:.1f}" cy="{cy-2}" r="3" fill="#E8B4C0" stroke-width="1"/><circle cx="{cx+r*0.15:.1f}" cy="{cy-2}" r="1.2" fill="#F3D679" stroke="none"/>\n'
    return s


OUT_D = _rr(8, 8, 504, 504, 50)
IN_D = _rr(54, 54, 458, 458, 22)
LIP_D = _rr(0, 0, 512, 512, 54)
BANK_D = _rr(66, 66, 446, 446, 14)

ripples = "".join(
    f'<path d="M{x} {y} q6 -4 12 0 t12 0" />' for (x, y) in [
        (80, 26), (200, 34), (330, 24), (430, 36), (18, 120), (30, 250), (22, 380), (480, 150), (486, 300), (478, 410),
        (90, 480), (160, 494), (360, 486), (420, 494), (240, 28), (140, 22)]
)

pads = "".join([
    _pad(120, 31, 11, 40, True), _pad(144, 38, 8, 200), _pad(398, 30, 10, 120), _pad(420, 40, 7, 300, True),
    _pad(30, 170, 9, 80), _pad(34, 330, 11, 220, True), _pad(480, 200, 9, 330), _pad(484, 360, 11, 150, True),
    _pad(110, 482, 11, 10), _pad(128, 492, 8, 240, True), _pad(390, 482, 10, 200), _pad(412, 494, 8, 70),
    _pad(330, 30, 7, 10),
])

def _duck(x, y, s=1.0, flip=False):
    sx = -s if flip else s
    return f'''    <g transform="translate({x} {y}) scale({sx:.2f} {s:.2f})" stroke-width="1.3">
      <ellipse cx="0" cy="5" rx="17" ry="4" fill="none" stroke="#C2DDE0" stroke-width="1.2" opacity="0.85"/>
      <path d="M-12 -3 L-17 -9 L-9 -6 Z" fill="#6F6D68"/>
      <path d="M-12 -2 C-12 7 10 8 12 -1 C10 -6 -6 -8 -12 -2 Z" fill="#B09A7A"/>
      <path d="M-8 -2 C-2 -6 6 -5 9 -1 C4 2 -4 3 -8 -2 Z" fill="#8A7458" stroke-width="1"/>
      <path d="M9 -3 C9 -9 11 -12 15 -11 C19 -10 18 -4 15 -2 Z" fill="#3F7F5A"/>
      <path d="M9 -2 H14" fill="none" stroke="#F4F0E4" stroke-width="1.6"/>
      <path d="M17 -8 L24 -6 L17 -4 Z" fill="#E3B24E" stroke-width="1"/>
      <circle cx="15" cy="-8" r="1" fill="#010206" stroke="none"/>
    </g>
'''


def _tufts(pts):
    return "".join(tuft(x, y, "#6F8A5F") for x, y in pts)


reeds_all = "".join([
    # top inner bank
    _reeds(92, 68, 34, 4), _reeds(178, 68, 28, 3, -3), _reeds(300, 68, 36, 4, 3), _reeds(392, 68, 28, 3),
    # left inner bank
    _reeds(68, 136, 30, 3, -4), _reeds(68, 250, 36, 4, -3), _reeds(68, 362, 30, 3, -4),
    # right inner bank
    _reeds(444, 116, 32, 3, 4), _reeds(444, 232, 28, 3, 3), _reeds(444, 350, 36, 4, 4),
    # bottom inner bank, either side of the bridge
    _reeds(104, 446, 32, 4), _reeds(160, 446, 26, 3), _reeds(352, 446, 26, 3), _reeds(410, 446, 34, 4),
    # corners and the outer lip
    _reeds(30, 38, 34, 4, -3), _reeds(482, 40, 34, 4, 3), _reeds(28, 478, 34, 4, -3), _reeds(484, 480, 32, 4, 3),
    _reeds(250, 10, 26, 3), _reeds(10, 200, 24, 3, -3), _reeds(502, 270, 24, 3, 3),
])

rocks = "".join(
    f'    <ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="#8E8B83" stroke-width="1.4"/>\n'
    for (x, y, rx, ry) in [(140, 60, 7, 4), (360, 62, 6, 4), (60, 196, 4, 7), (452, 282, 4, 6), (60, 428, 5, 7),
                           (450, 420, 5, 7), (236, 452, 7, 4), (278, 454, 5, 3), (14, 330, 4, 6), (498, 120, 4, 6)]
)

tufts = _tufts([(100, 65), (148, 65), (236, 65), (338, 65), (420, 65), (54, 196), (54, 310), (54, 420), (447, 190), (447, 290),
                (447, 410), (70, 456), (126, 456), (206, 456), (330, 456), (390, 456)])

body = f'''
    <!-- Mud lip on the outer edge and the island bank on the inner edge (island itself left clear). -->
    <path fill-rule="evenodd" d="{LIP_D} {OUT_D}" fill="#9C8B6E" stroke="none"/>
    <path fill-rule="evenodd" d="{IN_D} {BANK_D}" fill="#9C8B6E" stroke="none"/>
    <path fill-rule="evenodd" d="{IN_D} {BANK_D}" fill="url(#leanHatch)" stroke="none"/>
    <!-- Water channel: base, deeper centre, shaded edges, ripple hatch, foam at the banks. -->
    <path fill-rule="evenodd" d="{OUT_D} {IN_D}" fill="{WATER}" stroke="none"/>
    <path d="{_rr(20, 20, 492, 492, 40)}" fill="none" stroke="{WATER_D}" stroke-width="16" opacity="0.55"/>
    <path d="{_rr(31, 31, 481, 481, 32)}" fill="none" stroke="#3E7186" stroke-width="12" opacity="0.28"/>
    <path d="{_rr(46, 46, 466, 466, 22)}" fill="none" stroke="#3E7186" stroke-width="7" opacity="0.5"/>
    <path fill-rule="evenodd" d="{OUT_D} {IN_D}" fill="url(#waterHatch)" stroke="none"/>
    <g fill="none" stroke="#C2DDE0" stroke-width="1.5" opacity="0.8">{ripples}</g>
    <path d="{_rr(13, 13, 499, 499, 46)}" fill="none" stroke="#DDEDEE" stroke-width="2.4" stroke-dasharray="9 7 3 7" opacity="0.7"/>
    <path d="{_rr(49, 49, 463, 463, 26)}" fill="none" stroke="#DDEDEE" stroke-width="2.4" stroke-dasharray="9 7 3 7" opacity="0.7"/>
    <path fill-rule="evenodd" d="{OUT_D} {IN_D}" fill="none" stroke-width="2.6"/>
    <path d="{BANK_D}" fill="none" stroke-width="1" opacity="0.5"/>
    <!-- Mud flats, stones, grass and lily pads. -->
    <g fill="#8A7B5E" stroke="none" opacity="0.8">
      <ellipse cx="200" cy="60" rx="14" ry="3"/><ellipse cx="420" cy="448" rx="14" ry="3"/><ellipse cx="62" cy="300" rx="3" ry="12"/><ellipse cx="452" cy="170" rx="3" ry="12"/>
    </g>
{rocks}{tufts}{pads}
    <!-- A drifting log and two ducks. -->
    <path d="M472 336 Q470 320 474 300 L490 302 Q494 322 490 338 Q480 342 472 336 Z" fill="#745846" stroke-width="1.8"/>
    <path d="M473 302 Q481 298 489 303 Q481 307 473 302 Z" fill="#C7A06E" stroke-width="1.3"/>
    <path d="M477 301 Q481 300 485 302" fill="none" stroke-width="0.8" opacity="0.7"/>
    <path d="M481 322 L496 316 M481 330 L470 326" fill="none" stroke="#5F4434" stroke-width="2.4"/>
    <ellipse cx="481" cy="342" rx="13" ry="3" fill="none" stroke="#C2DDE0" stroke-width="1.2" opacity="0.85"/>
''' + _duck(32, 262, 1.0) + _duck(24, 290, 0.85, True) + '''
    <!-- Reeds and cattails. -->
''' + reeds_all + '''
    <!-- Drawbridge: lowered plank deck across the front channel, side beams, hinge beam, anchor stones. -->
    <g transform="translate(256 0) scale(1.22 1) translate(-256 0)">
    <path d="M204 452 H308 V512 H204 Z" fill="#3E7186" stroke="none" opacity="0.5"/>
    <path d="M198 496 H314 L318 512 H194 Z" fill="#8E8B83" stroke-width="2"/>
    <path d="M198 496 H314 L318 512 H194 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M214 448 H298 V508 H214 Z" fill="#9F7D68" stroke-width="2.2"/>
''' + "".join(
    f'    <path d="M214 {y} H298 V{y+7} H214 Z" fill="{"#BD9D86" if i % 2 else "#A7846C"}" stroke-width="1.1"/>\n'
    for i, y in enumerate(range(452, 506, 7))
) + '''    <path d="M222 452 V506 M240 452 V506 M262 452 V506 M284 452 V506" fill="none" stroke-width="0.7" opacity="0.28"/>
    <path d="M206 442 H218 V510 H206 Z M294 442 H306 V510 H294 Z" fill="#745846" stroke-width="2.2"/>
    <path d="M206 442 H218 V510 H206 Z M294 442 H306 V510 H294 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M200 436 H312 V450 H200 Z" fill="#5F4434" stroke-width="2.2"/>
    <g fill="#4D4B47" stroke-width="1.2">
      <circle cx="212" cy="470" r="2.4"/><circle cx="212" cy="490" r="2.4"/><circle cx="300" cy="470" r="2.4"/><circle cx="300" cy="490" r="2.4"/>
      <circle cx="210" cy="443" r="3"/><circle cx="302" cy="443" r="3"/><circle cx="256" cy="443" r="3"/>
    </g>
    <path d="M222 436 V450 M290 436 V450" fill="none" stroke="#4D4B47" stroke-width="3"/>
    <path d="M202 370 H220 V386 H202 Z M292 370 H310 V386 H292 Z" fill="#A8A59B" stroke-width="1.8"/>
    <path d="M202 370 H220 V386 H202 Z M292 370 H310 V386 H292 Z" fill="url(#stoneHatch)" stroke="none"/>
    </g>
''' + _chain(203, 438, 200, 384, 10) + _chain(309, 438, 312, 384, 10) + '''
    <circle cx="200" cy="381" r="3.4" fill="none" stroke-width="2"/><circle cx="312" cy="381" r="3.4" fill="none" stroke-width="2"/>
'''
shadow = f'''    <path fill-rule="evenodd" d="{OUT_D} {_rr(15, 15, 497, 497, 44)}"/>
    <path d="M196 436 H316 V510 H196 Z"/>
'''
specs["moat"] = {"title": "Moat", "desc": "Water-filled moat ringing the grounds, with reeds, lily pads and a lowered drawbridge on chains.", "body": body, "shadow": shadow}


# ================================================================ STABLE
# Open-fronted stable block: three stalls (peeking horse behind a Dutch door,
# a standing horse, a hay stall), a hay-loft dormer with hoist and bale,
# horseshoe over the aisle, trough, saddle rack and hitching rail.
body = '''
    <!-- Roof, and the hay-loft dormer with hoist beam, pulley and bale. -->
''' + roof(80, 98, 344, 114, ROOF_L, ROOF_D, "shingleHatch") + '''
    <!-- Roof: a mended patch and a rooftop weathervane arrow. -->
    <path d="M110 126 H168 V170 H110 Z" fill="#A8856F" stroke-width="1.5"/>
    <path d="M110 126 H168 V170 H110 Z" fill="url(#shingleHatch)" stroke="none"/>
    <path d="M136 100 V70" fill="none" stroke="#4B352B" stroke-width="2.6"/>
    <path d="M122 84 H152 M146 79 L154 84 L146 89" fill="none" stroke="#4B352B" stroke-width="2.2"/>
    <path d="M132 76 L136 68 L140 76 Z" fill="#4B352B" stroke-width="1.2"/>
    <path d="M316 146 V116 H358" fill="none" stroke="#4B352B" stroke-width="3.4"/>
    <path d="M316 124 L330 116" fill="none" stroke="#4B352B" stroke-width="2.4"/>
    <circle cx="358" cy="119" r="5" fill="#6F6D68" stroke-width="1.5"/>
    <path d="M358 124 V158" fill="none" stroke-width="1.2"/>
    <path d="M355 158 H361 V165 Q358 169 355 165 Z" fill="#6F6D68" stroke-width="1.2"/>
    <path d="M272 176 L316 140 L360 176 Z" fill="#745846" stroke-width="2.2"/>
    <path d="M278 212 V178 L316 150 L354 178 V212 Z" fill="#9F7D68" stroke-width="2.2"/>
    <path d="M278 212 V178 L316 150 L354 178 V212 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M290 212 V182 L316 162 L342 182 V212 Z" fill="#241c19" stroke-width="1.8"/>
    <path d="M290 182 L278 186 V212 L290 212 Z M342 182 L354 186 V212 L342 212 Z" fill="#745846" stroke-width="1.6"/>
    <path d="M297 212 V194 H335 V212 Z" fill="#D4B76A" stroke-width="1.7"/>
    <path d="M297 200 H335 M297 206 H335 M305 194 V212 M327 194 V212" fill="none" stroke="#A8893C" stroke-width="1.1"/>
    <path d="M300 194 l-3 -5 M310 194 l-1 -7 M322 194 l2 -6 M332 194 l4 -5" fill="none" stroke="#D4B76A" stroke-width="1.7"/>
    <path d="M272 176 L316 140 L360 176" fill="none" stroke="#5F4434" stroke-width="3.4"/>
    <!-- Aisle: dark stalls under the fascia beam. -->
    <path d="M88 216 H418 V346 H88 Z" fill="#3B2F28" stroke-width="2.2"/>
    <path d="M118 230 V346 M148 230 V346 M176 230 V346 M224 230 V346 M254 230 V346 M282 230 V346 M330 230 V346 M360 230 V346 M388 230 V346" fill="none" stroke="#2a211c" stroke-width="1.4" opacity="0.8"/>
    <path d="M88 338 H418 V346 H88 Z" fill="#C7A06E" stroke="none"/>
    <path d="M100 342 l7 -3 M150 343 l8 -3 M214 342 l8 -3 M280 343 l7 -3 M340 342 l8 -3" fill="none" stroke="#A8893C" stroke-width="1.2"/>
    <!-- Right stall: a heap of hay, bucket and pitchfork. -->
    <path d="M314 346 C318 318 338 306 354 310 C366 304 386 314 398 328 L402 346 Z" fill="#D4B76A" stroke-width="1.8"/>
    <path d="M324 334 l8 -8 M342 330 l10 -10 M360 330 l8 -12 M378 334 l8 -8 M332 342 l12 -6 M358 342 l12 -8" fill="none" stroke="#A8893C" stroke-width="1.2"/>
    <path d="M380 346 V272 M374 272 H388 M374 272 V286 M381 272 V286 M388 272 V286" fill="none" stroke="#4B352B" stroke-width="2.4"/>
    <path d="M320 330 H336 L334 346 H322 Z" fill="#876A56" stroke-width="1.5"/>
    <path d="M320 334 H336" fill="none" stroke-width="1.1"/>
''' + _horse(244, 342, 0.78, "#8A5A3A") + _horse(170, 342, 0.76, "#C9B79A", "#8A7C68", True) + '''
    <!-- Left stall: the half door shut under the grey mare's head. -->
    <path d="M100 346 V304 H194 V346 Z" fill="#9F7D68" stroke-width="2"/>
    <path d="M100 346 V304 H194 V346 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M100 304 H194 M100 346 L194 304 M100 304 L194 346" fill="none" stroke="#5F4434" stroke-width="2.6"/>
    <circle cx="184" cy="318" r="2.6" fill="#4D4B47" stroke-width="1"/>
    <path d="M98 302 H196 V308 H98 Z" fill="#745846" stroke-width="1.8"/>
    <!-- Posts and the fascia beam over the stalls. -->
    <g fill="#8F6F52" stroke-width="2">
      <path d="M88 216 H100 V350 H88 Z"/><path d="M194 216 H206 V350 H194 Z"/><path d="M300 216 H312 V350 H300 Z"/><path d="M406 216 H418 V350 H406 Z"/>
    </g>
    <path d="M88 216 H100 V350 H88 Z M194 216 H206 V350 H194 Z M300 216 H312 V350 H300 Z M406 216 H418 V350 H406 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M86 216 H420 V232 H86 Z" fill="#745846" stroke-width="2.2"/>
    <path d="M86 216 H420 V232 H86 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M82 350 H424 L418 360 H88 Z" fill="#85827A" stroke-width="1.8"/>
    <!-- Horseshoe nailed up over the aisle. -->
    <path d="M241 236 C233 246 235 260 249 260 C263 260 265 246 257 236" fill="none" stroke="#2c2c2c" stroke-width="5.6"/>
    <path d="M241 236 C233 246 235 260 249 260 C263 260 265 246 257 236" fill="none" stroke="#B9B7B0" stroke-width="3.2"/>
    <circle cx="240" cy="243" r="1.2" fill="#2c2c2c" stroke="none"/><circle cx="238" cy="252" r="1.2" fill="#2c2c2c" stroke="none"/><circle cx="259" cy="243" r="1.2" fill="#2c2c2c" stroke="none"/><circle cx="260" cy="252" r="1.2" fill="#2c2c2c" stroke="none"/>
    <g transform="translate(0 6)">
    <!-- Water trough on a frame. -->
    <path d="M100 382 L108 410 M190 382 L182 410 M118 384 L124 410 M172 384 L166 410" fill="none" stroke="#5F4434" stroke-width="3.4"/>
    <path d="M94 366 H198 L192 388 H100 Z" fill="#876A56" stroke-width="2"/>
    <path d="M94 366 H198 L192 388 H100 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M102 369 H190 L188 378 H104 Z" fill="#5B99A6" stroke-width="1.4"/>
    <path d="M114 374 q6 -3 12 0 t12 0 M150 372 q6 -3 12 0" fill="none" stroke="#A3C9CC" stroke-width="1.1"/>
    <path d="M94 366 H198" fill="none" stroke="#A9856E" stroke-width="2.4"/>
    <!-- Saddle on a rack. -->
    <path d="M226 416 L238 376 M290 416 L278 376 M226 416 L290 416 M232 396 H284" fill="none" stroke="#5F4434" stroke-width="3.4"/>
    <path d="M228 378 H288" fill="none" stroke="#745846" stroke-width="6"/>
    <path d="M236 378 C236 364 244 360 250 366 C256 372 270 372 276 364 C282 358 290 364 288 378 Z" fill="#8A5A3C" stroke-width="1.9"/>
    <path d="M238 376 C246 374 278 374 286 376" fill="none" stroke="#C99A6B" stroke-width="1.3"/>
    <path d="M246 378 H282 L280 400 H248 Z" fill="#A66F48" stroke-width="1.8"/>
    <path d="M251 382 H277 M251 396 H277" fill="none" stroke="#E3C79A" stroke-width="0.9" stroke-dasharray="3 2"/>
    <path d="M288 378 V396" fill="none" stroke-width="2"/>
    <path d="M284 396 H292 V406 H284 Z" fill="none" stroke="#9C9A94" stroke-width="2.4"/>
    <!-- Hitching rail with ring, rope and a bucket. -->
    <path d="M326 424 V370 M418 424 V370" fill="none" stroke="#5F4434" stroke-width="9"/>
    <path d="M326 424 V370 M418 424 V370" fill="none" stroke="#8F6F52" stroke-width="5.4"/>
    <path d="M320 376 H424 M320 394 H424" fill="none" stroke="#5F4434" stroke-width="6.2"/>
    <path d="M320 376 H424 M320 394 H424" fill="none" stroke="#A58562" stroke-width="3.4"/>
    <circle cx="326" cy="386" r="4.4" fill="none" stroke-width="2.4"/>
    <path d="M372 378 C376 392 366 396 366 408 M372 378 C368 386 374 388 372 396" fill="none" stroke="#C7A06E" stroke-width="2.6"/>
    <path d="M398 408 H416 L414 424 H400 Z" fill="#876A56" stroke-width="1.6"/>
    <path d="M398 410 H416" fill="none" stroke="#4D4B47" stroke-width="1.6"/>
    <path d="M400 408 Q407 398 414 408" fill="none" stroke-width="1.4"/>
    </g>
'''
shadow = '''    <path d="M80 98 H424 V216 H418 V360 H88 V216 H80 Z"/>
    <path d="M272 120 H362 V212 H272 Z"/>
    <path d="M94 372 H198 L192 416 H100 Z"/>
    <path d="M226 366 H292 V422 H226 Z"/>
    <path d="M320 376 H424 V430 H320 Z"/>
'''
specs["stable"] = {"title": "Stable", "desc": "Open-fronted stable block with horses in the stalls, hay-loft dormer, trough, saddle rack and hitching rail.", "body": body, "shadow": shadow}


# ================================================================ TAVERN
# Two-gable inn around a cobbled yard: tall left gable, low right gable, rear
# hall with chimney and smoke, tankard lantern sign, outdoor table, cellar hatch.
def _vroof(x, y, w, h, light, dark, hatch):
    """Roof with a vertical ridge (a gabled wing running front-to-back)."""
    mid = x + w // 2
    return f'''
    <path d="M{x} {y} H{mid} V{y+h} H{x} Z" fill="{light}" stroke="none"/>
    <path d="M{mid} {y} H{x+w} V{y+h} H{mid} Z" fill="{dark}" stroke="none"/>
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="url(#{hatch})" stroke="none"/>
    <path d="M{x} {y} H{x+w} V{y+h} H{x} Z" fill="none" stroke-width="2.8"/>
    <path d="M{mid} {y} C{mid-2} {y+h//3}, {mid+2} {y+2*h//3}, {mid} {y+h}" fill="none" stroke-width="3.1"/>
'''


PLASTER = "#D9C9A8"
body = '''
    <!-- Chimney of the rear hall, with a smoke curl. -->
    <path d="M372 52 H410 V140 H372 Z" fill="#8E8B83" stroke="none"/>
    <path d="M372 52 H410 V140 H372 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M372 52 H410 V140 H372 Z" fill="none" stroke-width="2.2"/>
    <path d="M367 44 H415 V56 H367 Z" fill="#A8A59B" stroke-width="2"/>
    <path d="M375 47 H407 V53 H375 Z" fill="#26211f" stroke="none"/>
    <g fill="#E4E2DE" stroke-width="1.3">
      <circle cx="392" cy="34" r="7"/><circle cx="400" cy="22" r="9"/><circle cx="415" cy="14" r="9"/><circle cx="433" cy="12" r="7"/>
    </g>
    <path d="M390 38 Q384 28 396 26 M404 18 Q400 10 412 9" fill="none" stroke-width="1" opacity="0.55"/>
    <!-- Rear hall: long roof and the wall strip facing the yard, with the inn door. -->
''' + roof(84, 90, 348, 90, ROOF_L, ROOF_D, "shingleHatch") + '''
    <!-- Rear roof: a mended patch and a loft hatch. -->
    <path d="M232 104 H292 V132 H232 Z" fill="#A8856F" stroke-width="1.4"/>
    <path d="M232 104 H292 V132 H232 Z" fill="url(#shingleHatch)" stroke="none"/>
    <path d="M300 146 H336 V170 H300 Z" fill="#5F4F44" stroke-width="1.8"/>
    <path d="M318 146 V170 M300 158 H336" fill="none" stroke-width="1.1" opacity="0.7"/>
    <path d="M92 180 H424 L420 214 H96 Z" fill="#D9C9A8" stroke-width="2.1"/>
    <path d="M122 180 L123 214 M200 180 L201 214 M338 180 L337 214 M400 180 L399 214" fill="none" stroke="#5F4434" stroke-width="2.6"/>
    <path d="M254 214 V192 Q254 182 268 182 Q282 182 282 192 V214 Z" fill="#745846" stroke-width="2"/>
    <path d="M268 183 V214 M256 198 H280" fill="none" stroke-width="1.1" opacity="0.7"/>
    <circle cx="276" cy="202" r="1.6" fill="#D7C39A" stroke="none"/>
    <path d="M222 188 H242 V206 H222 Z M298 188 H318 V206 H298 Z" fill="#F0CB6A" stroke-width="1.6"/>
    <path d="M232 188 V206 M222 197 H242 M308 188 V206 M298 197 H318" fill="none" stroke-width="1.1"/>
    <!-- Cobbled yard between the wings. -->
    <path d="M214 214 H330 V344 H214 Z" fill="#A8A59B" stroke="none"/>
    <path d="M214 214 H330 V344 H214 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M214 214 H330 V344" fill="none" stroke-width="1.6" opacity="0.6"/>
    <!-- Left wing: tall gable, long roof, timber-framed gable face, lit windows. -->
''' + _vroof(84, 150, 130, 100, ROOF_L, ROOF_D, "shingleHatch") + '''
    <path d="M88 250 L149 192 L210 250 Z" fill="#D9C9A8" stroke-width="2.2"/>
    <path d="M149 192 V250 M112 250 L149 212 L186 250 M120 238 H178" fill="none" stroke="#5F4434" stroke-width="2.4"/>
    <circle cx="149" cy="232" r="8.5" fill="#F0CB6A" stroke-width="1.8"/>
    <path d="M149 223 V241 M140 232 H158" fill="none" stroke-width="1.1"/>
    <path d="M84 250 L149 188 L214 250" fill="none" stroke="#5F4434" stroke-width="4"/>
    <path d="M90 250 H208 L204 340 H94 Z" fill="#D9C9A8" stroke-width="2.1"/>
    <path d="M90 250 H208 V260 H90 Z" fill="#745846" stroke-width="1.6"/>
    <path d="M94 260 V340 M149 260 V340 M204 260 V340 M94 296 H204" fill="none" stroke="#5F4434" stroke-width="2.6"/>
    <path d="M104 268 H138 V292 H104 Z M160 268 H194 V292 H160 Z" fill="#F0CB6A" stroke-width="1.7"/>
    <path d="M121 268 V292 M104 280 H138 M177 268 V292 M160 280 H194" fill="none" stroke-width="1.1"/>
    <path d="M100 292 H142 V300 H100 Z M156 292 H198 V300 H156 Z" fill="#745846" stroke-width="1.5"/>
    <g fill="#C94F5C" stroke="none"><circle cx="108" cy="293" r="2.2"/><circle cx="118" cy="292" r="2.2"/><circle cx="130" cy="293" r="2.2"/><circle cx="164" cy="293" r="2.2"/><circle cx="176" cy="292" r="2.2"/><circle cx="188" cy="293" r="2.2"/></g>
    <path d="M118 306 H180 V340 H118 Z" fill="#745846" stroke-width="1.9"/>
    <path d="M118 320 H180 M149 306 V340" fill="none" stroke-width="1.1" opacity="0.7"/>
    <circle cx="144" cy="324" r="1.8" fill="#D7C39A" stroke="none"/><circle cx="154" cy="324" r="1.8" fill="#D7C39A" stroke="none"/>
    <!-- Right wing: lower gable. -->
''' + _vroof(336, 176, 96, 70, ROOF_L, ROOF_D, "shingleHatch") + '''
    <path d="M340 246 L384 204 L428 246 Z" fill="#D9C9A8" stroke-width="2.2"/>
    <path d="M384 204 V246 M362 246 L384 224 L406 246" fill="none" stroke="#5F4434" stroke-width="2.2"/>
    <path d="M336 246 L384 200 L432 246" fill="none" stroke="#5F4434" stroke-width="3.8"/>
    <path d="M342 246 H426 L422 340 H346 Z" fill="#D9C9A8" stroke-width="2.1"/>
    <path d="M342 246 H426 V256 H342 Z" fill="#745846" stroke-width="1.6"/>
    <path d="M346 256 V340 M384 256 V340 M422 256 V340" fill="none" stroke="#5F4434" stroke-width="2.6"/>
    <path d="M354 266 H376 V290 H354 Z M392 266 H414 V290 H392 Z" fill="#F0CB6A" stroke-width="1.7"/>
    <path d="M365 266 V290 M354 278 H376 M403 266 V290 M392 278 H414" fill="none" stroke-width="1.1"/>
    <path d="M360 306 H408 V340 H360 Z" fill="#745846" stroke-width="1.9"/>
    <path d="M360 318 H408 M360 330 H408" fill="none" stroke-width="1.1" opacity="0.7"/>
    <path d="M338 340 H430 L436 348 H332 Z" fill="#85827A" stroke-width="1.8"/>
    <path d="M90 340 H208 L214 348 H84 Z" fill="#85827A" stroke-width="1.8"/>
    <!-- Yard: round table with mugs, four stools. -->
    <g fill="#A58562" stroke-width="1.7">
      <circle cx="238" cy="270" r="9"/><circle cx="306" cy="268" r="9"/><circle cx="246" cy="314" r="9"/><circle cx="298" cy="316" r="9"/>
    </g>
    <circle cx="272" cy="292" r="25" fill="#9F7D68" stroke-width="2"/>
    <circle cx="272" cy="292" r="25" fill="url(#logHatch)" stroke="none"/>
    <path d="M254 280 H290 M248 292 H296 M254 304 H290" fill="none" stroke-width="0.9" opacity="0.5"/>
    <g fill="#C7A06E" stroke-width="1.4">
      <circle cx="259" cy="288" r="5"/><circle cx="285" cy="286" r="5"/><circle cx="272" cy="304" r="5"/>
    </g>
    <g fill="none" stroke-width="1.5"><path d="M264 287 q4 0 0 5 M290 285 q4 0 0 5 M277 303 q4 0 0 5"/></g>
    <g fill="#F3EAD2" stroke="none"><circle cx="259" cy="286" r="2.8"/><circle cx="285" cy="284" r="2.8"/><circle cx="272" cy="302" r="2.8"/></g>
    <!-- Lute leaning against the right wing porch. -->
    <g transform="translate(206 6) rotate(-11 222 320)">
      <path d="M222 318 V270" fill="none" stroke="#4B352B" stroke-width="3.6"/>
      <path d="M216 270 H228 V262 H216 Z" fill="#745846" stroke-width="1.5"/>
      <path d="M222 318 C210 318 207 342 216 349 C222 354 232 354 237 347 C242 338 238 318 222 318 Z" fill="#B9884F" stroke-width="1.8"/>
      <circle cx="223" cy="334" r="4.4" fill="#2c211b" stroke-width="1.2"/>
      <path d="M220 262 V338 M224 262 V338" fill="none" stroke-width="0.7" opacity="0.7"/>
    </g>
    <!-- Cellar hatch (one leaf thrown open onto the steps). -->
    <path d="M86 364 H176 V410 H86 Z" fill="#8E8B83" stroke-width="2"/>
    <path d="M86 364 H176 V410 H86 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M92 370 H126 V404 H92 Z" fill="#745846" stroke-width="1.8"/>
    <path d="M92 380 H126 M92 392 H126 M109 370 V404" fill="none" stroke-width="1" opacity="0.7"/>
    <circle cx="109" cy="387" r="3.2" fill="none" stroke-width="1.8"/>
    <path d="M130 370 H170 V404 H130 Z" fill="#1d1a18" stroke-width="1.5"/>
    <path d="M132 380 H168 M132 389 H168 M132 398 H168" fill="none" stroke="#6F6D68" stroke-width="2"/>
    <path d="M170 370 L186 360 V396 L170 404 Z" fill="#8F6F52" stroke-width="1.8"/>
    <path d="M174 378 L182 373 M174 390 L182 385" fill="none" stroke-width="1" opacity="0.7"/>
    <!-- Barrels and a stack of kegs. -->
''' + barrel(204, 366, 14, 8, 28) + barrel(231, 374, 14, 8, 28) + barrel(218, 404, 14, 8, 22) + '''
    <!-- Tankard lantern sign on a post and arm. -->
    <path d="M326 436 V370 H354" fill="none" stroke="#4B352B" stroke-width="3.6"/>
    <path d="M326 370 L338 370 M326 380 L338 370" fill="none" stroke="#4B352B" stroke-width="2"/>
    <path d="M346 370 V380" fill="none" stroke-width="1.6"/>
    <circle cx="346" cy="396" r="24" fill="#FAE9AE" stroke="none" opacity="0.32"/>
    <path d="M334 380 H358 L362 386 H330 Z" fill="#4D4B47" stroke-width="1.6"/>
    <path d="M332 386 H360 V412 H332 Z" fill="#F0CB6A" stroke-width="1.8"/>
    <path d="M342 392 H352 V406 H342 Z" fill="#B9884F" stroke-width="1.3"/>
    <path d="M352 394 H357 V402 H352" fill="none" stroke-width="1.5"/>
    <path d="M341 392 Q343 388 346 390 Q349 387 353 392 Z" fill="#F7F1DE" stroke-width="1"/>
    <path d="M330 412 H362 L358 418 H334 Z" fill="#4D4B47" stroke-width="1.6"/>
    <ellipse cx="326" cy="438" rx="9" ry="3.5" fill="#85827A" stroke-width="1.5"/>
    <!-- Front yard: second table, more kegs. -->
    <circle cx="396" cy="396" r="22" fill="#9F7D68" stroke-width="2"/>
    <circle cx="396" cy="396" r="22" fill="url(#logHatch)" stroke="none"/>
    <g fill="#C7A06E" stroke-width="1.4"><circle cx="388" cy="392" r="5"/><circle cx="404" cy="400" r="5"/></g>
    <g fill="#F3EAD2" stroke="none"><circle cx="388" cy="390" r="2.8"/><circle cx="404" cy="398" r="2.8"/></g>
    <g fill="#A58562" stroke-width="1.7"><circle cx="368" cy="420" r="9"/><circle cx="426" cy="424" r="9"/></g>
'''
shadow = '''    <path d="M84 90 H432 V150 L420 214 H330 V340 H436 L432 250 H214 L208 340 H84 L90 250 L84 150 Z"/>
    <path d="M84 150 H214 V250 H84 Z"/>
    <path d="M336 176 H432 V348 H336 Z"/>
    <path d="M367 24 H415 V140 H367 Z"/>
    <path d="M86 364 H186 V410 H86 Z"/>
    <path d="M190 358 H245 V420 H190 Z"/>
    <path d="M322 370 H362 V438 H322 Z"/>
    <path d="M374 374 H418 V418 H374 Z"/>
'''
specs["tavern"] = {"title": "Tavern", "desc": "Two-gable inn around a cobbled yard with lantern sign, outdoor table, cellar hatch, lute and kegs.", "body": body, "shadow": shadow}
