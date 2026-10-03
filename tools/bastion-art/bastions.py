"""The four bastion types: House, Outpost, Keep, Castle."""
from bastion_lib import *  # noqa: F401,F403

specs: dict[str, dict[str, str]] = {}

# ---------------------------------------------------------------- House
# A sturdy cob-and-timber cabin: plaster wall strip, shingled gable, stone
# chimney, woodpile, rain barrel and a cabbage patch.
body = '''
    <!-- Cabbage patch: tilled bed with furrows and heads. -->
    <path d="M60 372 H176 L182 424 H54 Z" fill="#8A7660" stroke-width="2"/>
    <path d="M66 386 H172 M63 399 H176 M60 412 H179" fill="none" stroke="#5F4F40" stroke-width="1.2" opacity="0.75"/>
    <g fill="#7FA06B" stroke-width="1.3">
      <circle cx="82" cy="380" r="7"/><circle cx="108" cy="381" r="7"/><circle cx="134" cy="380" r="7"/><circle cx="160" cy="381" r="7"/>
      <circle cx="76" cy="406" r="7"/><circle cx="104" cy="406" r="7"/><circle cx="132" cy="407" r="7"/><circle cx="162" cy="406" r="7"/>
    </g>
    <path d="M79 380 Q82 376 85 380 M105 381 Q108 377 111 381 M131 380 Q134 376 137 380 M157 381 Q160 377 163 381 M73 406 Q76 402 79 406 M101 406 Q104 402 107 406 M129 407 Q132 403 135 407 M159 406 Q162 402 165 406" fill="none" stroke-width="0.9" opacity="0.7"/>
    <!-- Chimney: stone stack rising behind the ridge. -->
    <path d="M340 92 H384 V176 H340 Z" fill="#8E8B83" stroke="none"/>
    <path d="M340 92 H384 V176 H340 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M340 92 H384 V176 H340 Z" fill="none" stroke-width="2.2"/>
    <path d="M335 84 H389 V98 H335 Z" fill="#A8A59B" stroke-width="2"/>
    <path d="M346 87 H378 V95 H346 Z" fill="#26211f" stroke="none"/>
''' + wall(88, 318, 288, 34, "#C9B79A") + roof(82, 140, 300, 180, ROOF_L, ROOF_D, "shingleHatch") + pegs(82, 140, 300, 180) + '''
    <!-- Cob wall strip: timber studs, shuttered window, door and step. -->
    <path d="M118 319 V351 M170 319 V351 M300 319 V351 M344 319 V351" fill="none" stroke="#5F4434" stroke-width="3"/>
    <path d="M196 326 H228 V346 H196 Z" fill="#E6D9B5" stroke-width="1.8"/>
    <path d="M212 326 V346 M196 336 H228" fill="none" stroke-width="1.2"/>
    <path d="M188 324 H196 V348 H188 Z M228 324 H236 V348 H228 Z" fill="#6C8F7E" stroke-width="1.4"/>
    <path d="M246 319 H284 L281 351 H249 Z" fill="#745846" stroke-width="1.9"/>
    <path d="M251 329 H279 M252 339 H279" fill="none" stroke-width="1.05" opacity="0.7"/>
    <circle cx="274" cy="337" r="1.8" fill="#D7C39A" stroke="none"/>
    <path d="M242 352 H290 L294 362 H238 Z" fill="#85827A" stroke-width="1.8"/>
    <!-- Roof: a mended patch, and a loft hatch under the ridge. -->
    <path d="M150 190 H214 V222 H150 Z" fill="#A8856F" stroke-width="1.4"/>
    <path d="M150 190 H214 V222 H150 Z" fill="url(#shingleHatch)" stroke="none"/>
    <path d="M276 204 H316 V230 H276 Z" fill="#5F4F44" stroke-width="1.8"/>
    <path d="M276 217 H316 M296 204 V230" fill="none" stroke-width="1.1" opacity="0.7"/>
    <!-- Woodpile: ends of stacked split logs under a plank. -->
    <path d="M318 372 H398 L402 380 H314 Z" fill="#745846" stroke-width="1.8"/>
    <g fill="#C7A06E" stroke-width="1.3">
      <circle cx="328" cy="394" r="8"/><circle cx="346" cy="394" r="8"/><circle cx="364" cy="394" r="8"/><circle cx="382" cy="394" r="8"/>
      <circle cx="337" cy="410" r="8"/><circle cx="355" cy="410" r="8"/><circle cx="373" cy="410" r="8"/>
    </g>
    <g fill="none" stroke-width="0.8" opacity="0.65">
      <circle cx="328" cy="394" r="3.5"/><circle cx="346" cy="394" r="3.5"/><circle cx="364" cy="394" r="3.5"/><circle cx="382" cy="394" r="3.5"/>
      <circle cx="337" cy="410" r="3.5"/><circle cx="355" cy="410" r="3.5"/><circle cx="373" cy="410" r="3.5"/>
    </g>
''' + barrel(224, 380, 13, 8, 28) + '''
    <!-- Hanging key-and-hearth sign by the door. -->
    <path d="M400 330 V372 M400 334 H430" fill="none" stroke="#4B352B" stroke-width="2.6"/>
    <path d="M410 336 H430 V356 H410 Z" fill="#B97755" stroke-width="1.7"/>
    <path d="M414 352 Q420 340 426 352 Z" fill="#E5B861" stroke-width="1.2"/>
'''
shadow = '''    <path d="M82 140 H382 V318 H376 L370 352 H94 L88 318 H82 Z"/>
    <path d="M335 84 H389 V176 H335 Z"/>
    <path d="M314 372 H402 V418 H314 Z"/>
    <path d="M211 372 H237 V410 H211 Z"/>
'''
specs["house"] = {"title": "House", "desc": "Cob-and-timber cabin bastion with chimney, woodpile and garden.", "body": body, "shadow": shadow}

# ---------------------------------------------------------------- Outpost
# Fortified camp: 15' wooden palisade, gate, watch platform, campfire, tent,
# long lean-to shelter.
body = '''
    <!-- Trampled dirt apron under the whole camp. -->
    <path d="M60 128 Q258 104 458 128 L474 372 Q258 412 44 372 Z" fill="#B8AB8E" stroke-width="1.6"/>
    <path d="M60 128 Q258 104 458 128 L474 372 Q258 412 44 372 Z" fill="url(#leanHatch)" stroke="none"/>
    <!-- Back wall of the palisade: tops of the logs seen over the camp. -->
''' + stakes(76, 442, 96, 40) + '''
    <!-- Side walls: log ends marching toward the viewer. -->
    <g fill="#A58562" stroke-width="1.5">
''' + "".join(
    f'      <path d="M{58} {y} l8 -5 l8 5 v16 h-16 Z"/>\n      <path d="M{442} {y} l8 -5 l8 5 v16 h-16 Z"/>\n'
    for y in range(146, 330, 20)
) + '''    </g>
    <!-- Long lean-to bunkhouse against the back wall. -->
''' + roof(112, 150, 190, 92, "#B69A83", "#A57F68", "shingleHatch") + wall(118, 242, 178, 22, "#8F715E") + door(180, 243, 30, 21) + '''
    <path d="M132 243 V263 M270 243 V263" fill="none" stroke="#5F4434" stroke-width="2.6"/>
    <!-- Canvas tent. -->
    <path d="M338 214 L390 164 L442 214 L430 270 H350 Z" fill="#CFC3A6" stroke-width="2.2"/>
    <path d="M390 164 L378 270 M390 164 L402 270" fill="none" stroke-width="1.5" opacity="0.7"/>
    <path d="M390 164 L442 214 L430 270 H402 Z" fill="#B8AB8E" stroke="none"/>
    <path d="M378 270 L390 214 L402 270 Z" fill="#3A322C" stroke-width="1.8"/>
    <path d="M390 160 V148" fill="none" stroke-width="2"/>
    <path d="M390 148 L404 153 L390 158 Z" fill="#9C3F3A" stroke-width="1.2"/>
    <!-- Campfire ring: stones, crossed logs, flame and spit. -->
    <g fill="#8E8B83" stroke-width="1.4">
      <circle cx="230" cy="302" r="6"/><circle cx="248" cy="296" r="6"/><circle cx="266" cy="302" r="6"/><circle cx="270" cy="320" r="6"/>
      <circle cx="252" cy="328" r="6"/><circle cx="232" cy="322" r="6"/>
    </g>
    <path d="M236 316 L264 304 M236 304 L264 318" fill="none" stroke="#5F4434" stroke-width="5"/>
    <path d="M250 312 C240 306 246 292 252 284 C254 294 266 298 262 308 C260 314 254 316 250 312 Z" fill="#E08A33" stroke-width="1.4"/>
    <path d="M251 310 C246 306 250 298 253 294 C255 300 259 303 256 309 Z" fill="#F4D36B" stroke="none"/>
    <path d="M222 292 V330 M276 292 V330 M222 296 H276" fill="none" stroke="#4B352B" stroke-width="2.2"/>
    <!-- Stores: crates, barrels and a weapon rack. -->
''' + crate(106, 296, 44, 30) + crate(122, 330, 40, 28) + barrel(180, 336, 13, 8, 26) + '''
    <path d="M320 300 H388 L392 310 H316 Z" fill="#745846" stroke-width="1.8"/>
    <path d="M326 308 V344 M382 308 V344 M338 310 V338 M352 310 V342 M366 310 V336" fill="none" stroke-width="2.6"/>
    <path d="M334 318 L342 308 M348 320 L356 308 M362 318 L370 308" fill="none" stroke-width="1.7"/>
    <!-- Front wall, left and right of the gate. -->
''' + stakes(60, 206, 338, 42) + stakes(306, 458, 338, 42) + '''
    <!-- Gate: two tall posts, lintel, and the leaves swung open. -->
    <path d="M206 322 H218 V388 H206 Z M294 322 H306 V388 H294 Z" fill="#8F6F52" stroke-width="2"/>
    <path d="M200 316 H312 V328 H200 Z" fill="#A58562" stroke-width="2.2"/>
    <path d="M218 346 L240 340 V386 L218 388 Z M294 346 L272 340 V386 L294 388 Z" fill="#745846" stroke-width="1.8"/>
    <path d="M222 350 L236 346 M222 364 L236 360 M290 350 L276 346 M290 364 L276 360" fill="none" stroke-width="1.1" opacity="0.7"/>
    <path d="M232 318 H280 V326 H232 Z" fill="#9C3F3A" stroke-width="1.5"/>
    <!-- Watch platform on stilts at the back-left corner. -->
    <path d="M64 168 V232 M120 168 V232 M64 200 L120 232 M120 200 L64 232" fill="none" stroke="#5F4434" stroke-width="3"/>
    <path d="M52 124 H132 L138 172 H46 Z" fill="#A9856E" stroke-width="2.3"/>
    <path d="M52 124 H132 L138 172 H46 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M62 132 H122 V160 H62 Z" fill="#8F715E" stroke-width="1.8"/>
    <path d="M92 132 V160" fill="none" stroke-width="1.2" opacity="0.7"/>
''' + banner(428, 96)
shadow = '''    <path d="M76 96 H442 L458 128 L474 372 L306 338 V388 H206 V338 L44 372 L60 128 Z"/>
    <path d="M338 164 H442 V270 H350 Z"/>
    <path d="M52 124 H138 V232 H46 Z"/>
    <path d="M112 150 H302 V264 H118 Z"/>
'''
specs["outpost"] = {"title": "Outpost", "desc": "Palisaded camp with gate, watch platform, tent and bunkhouse.", "body": body, "shadow": shadow}

# ---------------------------------------------------------------- Keep
# 60' stone tower, three floors, ballista on the crenellated roof.
body = '''
    <!-- Footing apron and stair. -->
    <path d="M112 392 H400 L412 420 H100 Z" fill="#85827A" stroke-width="2"/>
    <path d="M214 420 H298 L306 438 H206 Z" fill="#9A978D" stroke-width="1.8"/>
    <!-- Roof platform: floor stones inside a crenellated parapet. -->
    <path d="M120 64 H392 V206 H120 Z" fill="#7E7B73" stroke="none"/>
    <path d="M120 64 H392 V206 H120 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M132 82 H380 V192 H132 Z" fill="#9A978D" stroke-width="2"/>
    <path d="M132 82 H380 V192 H132 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M120 64 H392 V206 H120 Z" fill="none" stroke-width="2.8"/>
''' + merlons(120, 56, 272, 9, 14) + merlons(120, 198, 272, 9, 14) + '''
    <g fill="#A8A59B" stroke-width="1.6">
      <path d="M112 84 H124 V96 H112 Z M112 110 H124 V122 H112 Z M112 136 H124 V148 H112 Z M112 162 H124 V174 H112 Z"/>
      <path d="M388 84 H400 V96 H388 Z M388 110 H400 V122 H388 Z M388 136 H400 V148 H388 Z M388 162 H400 V174 H388 Z"/>
    </g>
    <!-- Roof hatch, and the siege ballista bolted to the platform. -->
    <path d="M150 104 H206 V150 H150 Z" fill="#745846" stroke-width="2"/>
    <path d="M150 127 H206 M178 104 V150" fill="none" stroke-width="1.2" opacity="0.7"/>
''' + ballista(290, 138, 2.0) + '''
    <path d="M232 160 L252 150 M232 150 L252 160" fill="none" stroke-width="2.4"/>
    <!-- Tower face: three floors split by string courses. -->
''' + stone_face(126, 206, 260, 186, STONE, 5) + '''
    <path d="M126 268 H386 M127 330 H385" fill="none" stroke-width="3"/>
    <path d="M126 268 H386 L384 276 H128 Z M127 330 H385 L384 338 H128 Z" fill="#6F6D68" stroke-width="1.6"/>
    <path d="M126 206 H134 L139 392 H131 Z M378 206 H386 L381 392 H373 Z" fill="#7E7B73" stroke-width="1.8"/>
''' + slit(180, 226, 26) + slit(332, 226, 26) + slit(180, 288, 26) + slit(332, 288, 26) + '''
    <!-- Timber hoarding balcony on the second floor. -->
    <path d="M222 284 H290 L294 300 H218 Z" fill="#8F6F52" stroke-width="2"/>
    <path d="M222 284 H290 L294 300 H218 Z" fill="url(#logHatch)" stroke="none"/>
    <path d="M232 300 L240 314 M280 300 L272 314" fill="none" stroke="#4B352B" stroke-width="2.4"/>
    <path d="M232 292 H280" fill="none" stroke-width="1.2" opacity="0.7"/>
    <!-- Ground floor: arched door and iron-banded leaves. -->
    <path d="M234 392 V352 Q234 336 256 336 Q278 336 278 352 V392 Z" fill="#3A322C" stroke-width="2.2"/>
    <path d="M240 392 V354 Q240 344 256 344 Q272 344 272 354 V392 Z" fill="#745846" stroke-width="1.6"/>
    <path d="M256 344 V392 M240 360 H272 M240 376 H272" fill="none" stroke-width="1.3" opacity="0.7"/>
''' + banner(160, 344, "#9C3F3A", 30) + banner(332, 344, "#4F6B65", 30) + '''
    <!-- Torch braziers either side of the stair. -->
    <path d="M168 400 H190 L186 418 H172 Z M322 400 H344 L340 418 H326 Z" fill="#4D4B47" stroke-width="1.7"/>
    <path d="M179 400 C170 394 176 384 179 378 C182 386 190 390 185 398 Z M333 400 C324 394 330 384 333 378 C336 386 344 390 339 398 Z" fill="#E08A33" stroke-width="1.2"/>
'''
shadow = '''    <path d="M112 56 H400 V206 H386 L381 392 H412 L420 420 H100 L112 392 H131 L126 206 H112 Z"/>
    <path d="M206 420 H306 L312 440 H200 Z"/>
'''
specs["keep"] = {"title": "Keep", "desc": "Three-floor stone tower keep with crenellated roof and ballista.", "body": body, "shadow": shadow}

# ---------------------------------------------------------------- Castle
# 30' crenellated curtain wall round an inner keep and courtyard, gatehouse,
# four drum towers, eight ballista emplacements.
body = '''
    <!-- Courtyard: packed earth, cobbled apron, flagstone path to the keep. -->
    <path d="M76 132 H436 V396 H76 Z" fill="#B8AB8E" stroke="none"/>
    <path d="M76 132 H436 V396 H76 Z" fill="url(#leanHatch)" stroke="none"/>
    <path d="M226 396 H286 L292 330 H220 Z" fill="#A9A38F" stroke-width="1.6"/>
    <path d="M226 396 H286 L292 330 H220 Z" fill="url(#stoneHatch)" stroke="none"/>
    <!-- Back curtain: inner face, then the walkway on top. -->
    <path d="M76 100 H436 V138 H76 Z" fill="#7E7B73" stroke-width="2.2"/>
    <path d="M76 100 H436 V138 H76 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M60 64 H452 V102 H60 Z" fill="#A8A59B" stroke-width="2.6"/>
    <path d="M60 64 H452 V102 H60 Z" fill="url(#stoneHatch)" stroke="none"/>
''' + merlons(60, 52, 392, 21, 13) + slit(120, 110, 16) + slit(176, 110, 16) + slit(336, 110, 16) + slit(392, 110, 16) + '''
    <!-- Side curtains: wall-walks running toward the viewer. -->
    <path d="M40 100 H76 V420 H40 Z" fill="#A8A59B" stroke-width="2.6"/>
    <path d="M436 100 H472 V420 H436 Z" fill="#A8A59B" stroke-width="2.6"/>
    <path d="M40 100 H76 V420 H40 Z M436 100 H472 V420 H436 Z" fill="url(#stoneHatch)" stroke="none"/>
    <g fill="#A8A59B" stroke-width="1.5">
''' + "".join(
    f'      <path d="M32 {y} H44 V{y+12} H32 Z"/>\n      <path d="M468 {y} H480 V{y+12} H468 Z"/>\n'
    for y in range(124, 400, 32)
) + '''    </g>
    <!-- Inner keep: squat stone block, crenellated roof, banners. -->
    <path d="M192 166 H320 V236 H192 Z" fill="#7E7B73" stroke-width="2.2"/>
    <path d="M192 166 H320 V236 H192 Z" fill="url(#stoneHatch)" stroke="none"/>
    <path d="M202 176 H310 V226 H202 Z" fill="#9A978D" stroke-width="1.6"/>
''' + merlons(192, 160, 128, 7, 11) + merlons(192, 230, 128, 7, 11) + stone_face(192, 242, 128, 70, STONE, 4) + '''
    <path d="M242 312 V286 Q242 274 256 274 Q270 274 270 286 V312 Z" fill="#3A322C" stroke-width="1.9"/>
    <path d="M247 312 V288 Q247 280 256 280 Q265 280 265 288 V312 Z" fill="#745846" stroke-width="1.4"/>
''' + slit(214, 256, 18) + slit(298, 256, 18) + banner(200, 238, "#9C3F3A", 26) + banner(298, 238, "#9C3F3A", 26) + '''
    <!-- Courtyard well, handcart and training dummy. -->
    <ellipse cx="128" cy="266" rx="22" ry="12" fill="#8E8B83" stroke-width="2"/>
    <ellipse cx="128" cy="266" rx="14" ry="7" fill="#4C8699" stroke-width="1.4"/>
    <path d="M110 262 V240 H146 V262 M106 240 H150" fill="none" stroke="#5F4434" stroke-width="2.6"/>
    <path d="M360 262 H412 L416 282 H356 Z" fill="#876A56" stroke-width="1.8"/>
    <circle cx="372" cy="288" r="8" fill="#5F4434" stroke-width="1.6"/><circle cx="402" cy="288" r="8" fill="#5F4434" stroke-width="1.6"/>
    <path d="M412 266 L440 256" fill="none" stroke-width="2.4"/>
    <g id="dummy" stroke-width="1.8">
      <circle cx="136" cy="344" r="8" fill="#B08A68"/>
      <path d="M136 352 V384 M118 362 H154 M126 384 L136 372 L146 384" fill="none" stroke="#745846" stroke-width="3"/>
    </g>
    <path d="M360 340 H400 L404 356 H356 Z" fill="#745846" stroke-width="1.7"/>
    <path d="M366 354 V386 M394 354 V386 M376 356 V380 M386 356 V380" fill="none" stroke-width="2.4"/>
    <!-- Front curtain: wall-walk, outer face, gate flanked by drum towers. -->
    <path d="M40 396 H472 V424 H40 Z" fill="#A8A59B" stroke-width="2.6"/>
    <path d="M40 396 H472 V424 H40 Z" fill="url(#stoneHatch)" stroke="none"/>
''' + merlons(40, 384, 432, 23, 13) + stone_face(40, 424, 432, 36, STONE, 4) + '''
    <!-- Gatehouse: raised block, arch, portcullis, flanking banners. -->
    <path d="M196 372 H316 V424 H196 Z" fill="#8E8B83" stroke-width="2.4"/>
    <path d="M196 372 H316 V424 H196 Z" fill="url(#stoneHatch)" stroke="none"/>
''' + merlons(196, 360, 120, 6, 13) + '''
    <path d="M218 460 V440 Q218 420 256 420 Q294 420 294 440 V460 Z" fill="#26211f" stroke-width="2.2"/>
    <path d="M226 456 V442 Q226 428 256 428 Q286 428 286 442 V456 M240 424 V458 M256 422 V458 M272 424 V458 M226 440 H286" fill="none" stroke="#6F6D68" stroke-width="2.2"/>
    <path d="M205 384 V402 M307 384 V402" fill="none" stroke="#4B352B" stroke-width="2.2"/>
    <path d="M206 386 H218 V402 H206 Z M294 386 H306 V402 H294 Z" fill="#9C3F3A" stroke-width="1.3"/>
    <!-- Four drum towers, one per corner, with crenellated caps. -->
''' + "".join(
    f'''    <path d="M{cx-38} {cy} V{cy+54} Q{cx} {cy+80} {cx+38} {cy+54} V{cy} Z" fill="#8E8B83" stroke-width="2.4"/>
    <path d="M{cx-38} {cy} V{cy+54} Q{cx} {cy+80} {cx+38} {cy+54} V{cy} Z" fill="url(#stoneHatch)" stroke="none"/>
    <ellipse cx="{cx}" cy="{cy}" rx="38" ry="30" fill="#A8A59B" stroke-width="2.6"/>
    <ellipse cx="{cx}" cy="{cy}" rx="38" ry="30" fill="url(#stoneHatch)" stroke="none"/>
    <ellipse cx="{cx}" cy="{cy}" rx="38" ry="30" fill="none" stroke-width="9" stroke-dasharray="9 6" stroke="#A8A59B"/>
    <ellipse cx="{cx}" cy="{cy}" rx="38" ry="30" fill="none" stroke-width="2.4"/>
    <ellipse cx="{cx}" cy="{cy}" rx="27" ry="20" fill="#7E7B73" stroke-width="1.6"/>
''' for cx, cy in ((58, 74), (454, 74), (58, 392), (454, 392))
) + "".join(ballista(x, y, 0.62) for x, y in (
    (58, 70), (454, 70), (58, 388), (454, 388), (256, 76), (58, 232), (454, 232), (356, 392)
)) + banner(256, 24, "#9C3F3A", 26)
shadow = '''    <path d="M20 44 H492 V456 H20 Z"/>
'''
shadow = '''    <path d="M20 42 H492 V120 H472 V440 H316 V372 H196 V440 H40 V120 H20 Z"/>
    <path d="M192 160 H320 V312 H192 Z"/>
'''
specs["castle"] = {"title": "Castle", "desc": "Walled castle: curtain wall, gatehouse, four drum towers and an inner keep.", "body": body, "shadow": shadow}
