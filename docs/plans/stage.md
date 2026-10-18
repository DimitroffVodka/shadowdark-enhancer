# Stage (player-facing name: Backdrop): plan v2, 2026-10-17, after the Opus review

Status now (2026-10-17), replacing the status line below: phase 1a built on `feat/stage-camp-backdrop` (layer and hidden `stage` setting, GM toolbar tool, camp raise and drop, Show camp picture button, hide on Bring the table); phase 1b built on `feat/stage-places` (see `stage-places.md`); phases 3 and 2 not started. The status line below is the plan's original, from before the build.

Status: reviewed, not built. "Stage" is the working and code name (`scripts/stage/`, `SDE.stage.*`); the player-facing word is "Backdrop" because "Staged" already means a battle map only the GM sees (en.json:1154-1156). Patrick has not chosen the name yet.

## What Patrick asked for (his words, 2026-10-17)

- Theater-of-the-mind options inside the Enhancer, as NEW code, "not how Extras does it". For the times the party is in town, in a tavern, or camping. Some kind of combat later ("a lot of people use ToM combat").
- What he dislikes about Extras' ToM: fake tokens with no real combat; the GM tray and scene library; losing the broadcast on reload. He did not object to the full-screen takeover. He does not want video overlays.
- Start: a GM button, plus automatic for camp (the GM can dismiss it).
- Backdrops: the camp pictures exist; for town and tavern he will look for artwork. Do not invent or ship art for those two.

## Rule: nothing copied from Extras' ToM

His own split spec (Obsidian: Shadowdark Extras Split Plan - modules/ToM spec.md, section 0) covers the ToM. The Stage is written fresh: no code, CSS or assets from Extras. Ideas only. Extras keeps its own ToM (some GMs run Extras alone), and the Enhancer must stay useful without Extras.

## Proven in a throwaway lane (phase 0, Foundry 14.369, Shadowdark 4.0.6, Enhancer 0.19.0)

- A fixed backdrop over `#board` and under Foundry's UI works, blocks clicks to the hidden canvas, and survives `scene.activate()`. Measured stacking: `#board` z 0; token HUD `#hud` and the pause banner `#pause` z 1; the Town page `#sde-town` z 25; Foundry's `#ui-left/-middle/-right` z 30; the Crawl Strip z 50; Overland travel z 60; windows and dialogs z 101+. The test used z 2, which the review found would COVER the pause banner (z 1): use z 0 appended to the body after `#board` (later in DOM order paints above) and re-check in the lane.
- A `Combat` with `scene: null` and actor-only combatants works on Shadowdark: initiative, start, turns and rounds, Clockwise Initiative, the Enhancer's dying rule, shown on every scene, no console errors. Two combatants of one actor share its HP, so each foe needs its own cloned actor. The Crawl Strip lists only the PC, not tokenless foes. Core lets an actor's owner write `flags` on their own combatant (read from `common/documents/combatant.mjs:76-92`; not tried with a player login).
- Not measured: GPU cost of the canvas still drawing beneath the backdrop; Steam Deck weight. Never stop `canvas.app.ticker` while the Stage is up (a stopped canvas never finishes the next scene draw).

## Design

**The layer.** One `div#sde-stage` appended to `document.body` after `#board`, `aria-hidden`, `position: fixed; inset: 0; z-index: 0` (use `var(--z-index-canvas)` if it exists), `pointer-events: auto`, the picture as a CSS background. When it goes up, release controlled tokens (arrow keys and Delete otherwise still drive the hidden canvas). The place name is shown as real text on the Town/Camp page, not in the layer. No fade under `prefers-reduced-motion`.

**State.** World setting `stage` (world scope, `config: false`, so docs-contract needs no Settings-Reference row): `{shown, place, image, partyId, campId}`, read only through a pure `normalizeStage` so the shape can change later with no migration (the key itself is permanent). Every client reads it (core runs `onChange` everywhere); only a GM writes it (players cannot). Draw on `ready` and on `onChange`; no canvas hooks (the first `canvasReady` can fire before `game.ready`, and a third-party `canvasReady` handler returning false stops later handlers: the landing page already uses `canvasDraw` and `ready`). A later `stagePlaces` setting holds the places list and stays separate from `stage`, so the GM switch and the editor never overwrite each other. No flags, no `game.shadowdarkEnhancer` entry (both permanent).

**Camp place.**
- Picture: deterministic, the first camp for the party's terrain among the SEVEN party camps in `scripts/encounter/battle-maps/encounter-maps.mjs` (the `CAMPS` list, `forest-woods-camp`, `forest-road-camp`, `grassland-open-camp`, `jungle-dense-camp`, `swamp-bog-camp`, `desert-dunes-camp`, `salt-flat-camp`). NOT `forest-camp.webp`: that is the "Forest Camp" scenario pack map (an occupied camp, 4400x3200). `resolveDefaultMap` is random: do not use it. Terrain with no camp picture gets `forest-woods-camp`. Water terrain does not auto-raise (the boat is the camp).
- Automatic raise: only when a NEW camp id appears in phase `setup` and (default, Patrick to confirm) NO party token is on the viewed map. With a party token on the hex map the camp keeps its map fire and night time-lapse, and a "Show camp picture" button on the Camping window raises the Stage by hand. Store the `campId` in the setting: a dismissal, Bring the table, a reload or a second GM never re-raises it. Otherwise every later camp write re-raises it (`refreshCampFires` writes on every token move and clock tick, `camping.mjs:268`).
- Drop: when the camp reaches phase `complete` or is cancelled (`null`), only if the Stage is still showing THAT camp (a GM who switched place is not dropped). Most recent camp wins. Extras-run camps write no native flag and do not raise it. It stays up through the night time-lapse and through a GM scene change.
- Who writes: the active GM only (`scripts/shared/gm-relay.mjs:253`), from `updateActor` on the party actor (there is no camp hook); read the actor document, not `changed` (`module-flags.mjs:56-58`).
- CUT from the first slice: darkening the picture when the fire is out. A camp's fire needs a party token on the canvas (`camping.mjs:28-62`; "no canvas: a fire cannot be placed", `lightFire`), so in a no-token camp the fire never lights and the picture would always be dark. Revisit only if Patrick wants it, with a deliberate camping rule change (the existing rule to copy is `campFireLit()` in `encounter-battle.mjs:265-274`).

**Bring the table.** `bringBattleTable` (`encounter-battle.mjs:650-669`) fires no hook and only activates the scene if it is not already active. Add one explicit `hideStage()` (dynamic import) before the activate. Return to travel does not bring the Stage back.

**Town and tavern places (phase 2).** A place points at a scene that already has a landing page: no landing data moves. The work is in `scripts/town/town-entry-points.mjs` (it follows `canvas.scene` and closes the page on `canvasDraw` when the new scene has none, `:83`). Needs PR 524 (and town-shop-upgrades) merged first.

**Zones and combat (phase 3).** Close/Near/Far zones drawn on the backdrop, real actors (a cloned actor per foe, deleted by exact id at the end), one global Combat (`scene: null`), zone as a flag on the Combatant written through `replaceModuleFlag`. Watch: Bring the table makes an active scene combat (`encounter-battle.mjs:680`), so two active combats could exist; the Crawl Strip auto-enrols into new combats (`noAutoEnroll`, `:678-680`); XP, loot and recap read tokenless combatants (`:731-738`).

**Images.** Camp pictures: use the 480 px `thumbs/` for any small preview. Custom pictures (1b): the picker uploads from the GM's computer (needs FILES_UPLOAD, GM always has it) to `worlds/<id>/stage`, never the module folder (the file picker refuses module folders, `file-picker.mjs:290-296`); downscale on upload (pattern: `hex-map-flow.mjs:430-453`; upload pattern: `uploadMapImage`, `adventure-scene.mjs:339-352`); route every path through `fileRoute` (`scripts/shared/file-route.mjs`) for The Forge and S3; test the first-time path with nothing uploaded. The decoded 4000x3000 camp pictures are about 48 MB each: measure on the Steam Deck before adding smaller copies.

## Phases

- **1a Camp backdrop (from `master` now):** the layer, the `stage` setting, a GM toolbar switch (the way `town-entry-points.mjs:46-54` adds its tool), the Camp picture by terrain, the Camp button, automatic raise and drop, Bring the table turns it off.
- **1b Custom places:** `stagePlaces`, a small Places editor, upload with downscaling.
- **2 Town and tavern places:** after PR 524 and town-shop-upgrades merge.
- **3 Zone combat:** after 1a; does not need 524.

## Decided without asking Patrick (simple defaults)

Water does not auto-raise; terrain without a camp picture gets the forest-woods camp; players cannot hide the Stage; Extras camps do not raise it; the most recent camp wins; it stays up through the night time-lapse and through a GM scene change (except Bring the table).

## Confirmed and still open

1. **CONFIRMED by Patrick, 2026-10-17 ("No, use a button"):** with a party token on the hex map, the camp does NOT cover the map automatically; a button on the Camping window raises it. (He had asked for "auto for camp"; the review found that covering a hex-map camp would hide its fire light and time-lapse in existing worlds.) Automatic raise stays for a camp with no party token on the map.
2. Still open, default built: the player-facing name "Backdrop".
<!-- One sentence about the licence of Extras' ToM was left out of the public copy. -->
