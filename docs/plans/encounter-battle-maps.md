# Encounter battle maps

Status: design agreed with Patrick 2026-10-08; built 2026-10-09 and independently reviewed; not yet run in a live world.
The contracts below are the design as agreed; "As built" at the end records where the build, and the review that followed,
changed them. Nothing here is released; keep CHANGELOG `[Unreleased]` current.

When a hex-travel encounter is rolled there has been no way to switch to combat: the party is one token on a
6-mile hex. This feature gives every encounter terrain a battle map, one click away, with the monsters from the roll
already on it.

## What the GM sees

1. A travel encounter is held (the clock HUD's Encounter panel) or posted to chat. A GM-only **Battle map** button
   opens the default map for the party's hex terrain. Next to it, **Choose map…** opens a picker.
2. **Set up** (the first click) makes or reuses the scene, places the party's PCs and the rolled monsters on it, and
   *views* it for the GM only. It starts **preloading** the scene's art on every player's client and shows a
   per-player readout (waiting / loading n of N / ready / failed). It never pulls the players over.
3. **Bring the table** (second click) activates the scene for everyone and makes a Combat holding the placed tokens
   (not started). The button reads "Ready 3/4" and turns green at 4/4; it can be pressed early after a confirm that
   names who is still loading.
4. **Return to travel** activates the hex scene again, removes the tokens this battle placed (exact ids, never a
   sweep) and ends this battle's combat. A **Keep this battle** checkbox first copies the scene, tokens and all, into
   the "Saved encounters" folder. Return only switches scenes: Overland's held encounter and its Continue button are
   untouched, so the GM resumes the clock the way they already do.
5. **Change map** works until the table is brought: the battle's own tokens move to the new scene.

## Decisions (Patrick's, 2026-10-08)

- One **persistent scene per map**, made the first time it is used and reused after. Same pattern as the pit-fighting
  arena (`scripts/pit-fighting/arena-scene.mjs`): idempotent, found by flag first, the scene is *viewed* never
  activated by setup, v14 levels, thumbnail made by hand. Not a throwaway scene.
- Which map: the terrain's default, or the GM's pick. The picker lists, in order: maps for this terrain (default
  marked), every other shipped map (terrain filter chips), and **any scene already in the world** (used as is).
- Day/night/camp: night is scene darkness (0.75, like the arena); a camp is separate art, chosen when the party is
  camping or the GM toggles it. Water terrains have no camp art (the boat is the camp).
- Water terrains (river, lake, ocean, arctic_sea): the party is in a boat, so the PCs start on the boat's deck.
- Per-terrain world setting: pin a default, or random among enabled; each map can be disabled. A terrain with every
  map disabled still opens the picker.
- Preload is on by default (world setting, can be turned off). The readout is the module's own, because Foundry has
  none: `game.scenes.preload(id, {broadcast:true})` is fire-and-forget and each client's loading bar is private.
- No hard dependency on Shadowdark Extras, Calendaria or Simple Calendar. Foundry v14 only.
- Maps are CC BY-NC 4.0 art by 2-Minute Tabletop; every shipped map is credited in `CREDITS.md`.

## Shared names

`scripts/encounter/battle-maps/constants.mjs` (written; do not rename its exports): flag keys, setting keys, socket
actions, folder names, the 100 px grid, night darkness, `BATTLE_STATUS`, `TERRAINS`, `WATER_TERRAINS`.
Hex terrain keys are the module's own (`encounter-terrain.mjs` `terrainKey`): forest, path, grassland, jungle, swamp,
river, lake, ocean, arctic_sea, desert, salt_flat, canyon, mountain, coast, volcano, lava, deep_tunnels.

## Parts and files

All new code lives in `scripts/encounter/battle-maps/`. Pure logic goes in `*-core.mjs` files that import cleanly in
Node (no Foundry globals at import time); Foundry-bound files import the cores. Tests: `test/encounter-maps-*.test.mjs`.

| Part | Files | Contract |
|---|---|---|
| **A. Library and art** | `encounter-maps.mjs`, `tools/encounter-maps/build-assets.py`, `assets/scenes/encounter/*.webp`, `CREDITS.md` rows | below |
| **B. Scene and battle** | `encounter-scene.mjs`, `encounter-battle-core.mjs`, `encounter-battle.mjs` | below |
| **C. Preload readout** | `encounter-preload-core.mjs`, `encounter-preload.mjs` | below |
| **D. Windows and wiring** | `battle-map-picker.mjs` (+ core), `battle-actions.mjs` (+ core), `templates/encounter-maps/*.hbs`, settings, HUD panel + chat-card buttons, API namespace, `API.md`, wiki page, CHANGELOG | below |

Every user-facing string comes from `languages/en.json` (#169) under `SDE.encounterMaps.*`, including map labels (`labelKey`).

### A. `encounter-maps.mjs` (library; pure data + pure functions, imports only constants.mjs)

```js
/** @typedef {object} EncounterMap
 * id           stable slug, the scene flag and the file name stem            "forest-woods"
 * labelKey     en.json key for the picker label                              "SDE.encounterMaps.map.forest-woods"
 * terrains     hex terrain keys this map suits (TERRAINS)
 * variant      "day" | "camp"
 * variantOf?   for a camp map: the day map's id
 * image        module-relative path under ASSET_DIR, ends ".webp"
 * width, height  px of that image                          grid: 100   feetPerSquare: 5
 * party?       [x0,y0,x1,y1] px zone the party starts in (default: central 30% of the map, see partyZone())
 * campLight?   {x,y} px, a camp map's fire: B adds an ambient light there
 * boat?        true on a water map: `party` is the boat's deck
 * sources      [{name, url}]  products it is made from (credits)
 * kind         "built" | "pack"   (built = assembled here from asset packs; pack = a pack's own map, rescaled)
 */
export const ENCOUNTER_MAPS
export function getEncounterMap(id)                       // EncounterMap | null
export function mapsForTerrain(terrain)                   // day maps tagged for it, library order (first = shipped default)
export function otherMaps(terrain)                        // every other day map
export function campVariantOf(map)                        // camp EncounterMap | null
export function normalizePrefs(raw)                       // → {[terrain]: {pinned: string|null, disabled: string[]}}, junk dropped
export function enabledMapsFor(terrain, prefs)            // mapsForTerrain minus disabled
export function resolveDefaultMap(terrain, prefs, { rng = Math.random } = {})  // pinned if enabled | random enabled | null
export function pickVariant(map, { night = false, camping = false })  // → { map, darkness, camp }  (camp only if the map has one)
export function partyZone(map)                            // [x0,y0,x1,y1]
```

Catalog source (draft set of 44 maps, ids/terrains/sizes): `~/Downloads/two-minute/encounter-maps/catalog.json`;
source PNGs beside it in `built/`, `camp/`, `packmaps/` (all 100 px per square). Built-scene recipes, party zones and camp
fires:

| Built map | Made from | party zone (px) |
|---|---|---|
| forest-woods, grassland-open, jungle-dense, swamp-bog, desert-dunes, salt-flat | Forest Floor + Forest Treetop (V7), Tiling Grass (V6), River and Water (V5), Desert Map Assets (V6) | [1250,900,2750,2100] |
| forest-road (road across the middle) | Tiling Grass (V6), Forest Floor + Treetop (V7) | [1250,900,2750,2100] |
| lake-calm (rowboat) | River and Water Assets (V5), Rowboat (V5), Ocean Surface Assets (V5) | [1480,1400,2520,1620] |
| ocean-open-sea (galleon) | Ocean Water Textures (V5), Ocean Surface (V5), Galleon (V3) | [900,1300,3100,1700] |
| arctic-sea-ice-floes (longship) | Ocean Water Textures (V5), Snowy Winter (V6), Viking Longship (V5) | [1150,1380,2850,1620] |
| river-rowboat (4400x1600) | Endless River (V11), Rowboat (V5) | [1700,740,2700,900] |
| every `*-camp` | the day scene plus Camp Tokens (V3) | camp: [1400,1100,2600,1900]; fire at (2000,1500). `forest-road-camp`: [1300,1700,2700,2600], fire (2000,2150) |

Pack maps (kind `pack`) carry `sources` from their `catalog.json` `src` (zip name → the product page; the audit CSV
`~/Downloads/two-minute/encounter-maps/tools/volume-license-audit.csv` has the product URLs) and use the default
central party zone. Water maps get `boat: true`.

### B. Scene and battle

`encounter-scene.mjs` (Foundry-bound; model: `scripts/pit-fighting/arena-scene.mjs`, read it first):

```js
export function encounterSceneName(map)                                  // "Encounter: " + localized label
export function findEncounterScene(mapId)                                // flag first, then name; Scene | null
export async function ensureEncounterScene(map, { night = false, view = false } = {})  // → { scene, created }
export async function copyAsSaved(scene, { label })                      // duplicate scene + tokens into FOLDERS.saved, flag FLAGS.saved
```

Scene: image on a v14 level (not `background`), grid `{size: 100, distance: 5, units: "ft"}` faint like the arena,
`environment.darknessLevel` from `night`, `navigation: false`, in the FOLDERS.maps scene folder (found by flag, then
name), thumbnail created by hand, a camp map adds one AmbientLight at `campLight`.

`encounter-battle-core.mjs` (pure): token layout and bookkeeping.

```js
export function layoutTokens({ zone, count, size = 1, grid = 100, occupied = [] })     // → [{x,y}] top-left px, grid-snapped, packed rows, no overlap with `occupied`
export function foeZone({ map, partyZone, distanceRoll })                              // strip outside the party zone: close 1 / near 5 / far 11 empty squares past it, so the nearest foe is 2 / 6 / 12 squares (10 / 30 / 60 ft) from the front character, on the side with most room, clamped to the map
export function newBattleRecord({ encounter, terrain, map, variant, originSceneId, hex, now })
export function tokensToRemove(record, tokenDocs)                                      // exact ids: in record.tokenIds AND still carrying FLAGS.token === record.id
```

`encounter-battle.mjs` (Foundry-bound), `export const BattleMaps`:

```js
setUp({ encounter, terrain, mapId = null, sceneId = null, variant = null, night = false, camping = false,
        originSceneId = canvas.scene?.id, hex = null, view = true })
  → { battle, scene, map, created } | null        // null = refused (not a GM, unknown map); says why via ui.notifications
changeMap(battleId, { mapId, sceneId })           // only while status "staged"; same return as setUp
bringTable(battleId)                              // scene.activate(); Combat with {flags:{[MODULE_ID]:{noAutoEnroll:true}}} (see crawl-bar _startCombat), enrol the tokens, do NOT start; status "live"
returnToTravel(battleId, { keep = false, label })  // see the GM flow; world scenes: keep = leave tokens, no copy
current()                                         // the one battle whose status isn't "done" | null (scan game.scenes flags)
get(battleId)                                     // { battle, scene } | null
```

BattleRecord (Scene flag `FLAGS.battle`, written ONLY with `replaceModuleFlag`):
`{ id, at, status, originSceneId, mapId|null, sceneId, variant, terrain, hex|null, tokenIds[], combatId|null, encounter:{name, uuid, count} }`.
`encounter` is the held encounter (`drawEncounter`'s monster entry: `uuid`, `name`, `count`, `distanceRoll`).
Tokens: foes from `encounter.uuid` via `worldActorFor`/`tokenSourceFor` (`scripts/shared/token-placement.mjs`), PCs from
the module's `Party` members (find the accessor in `scripts/party/`); each token created with
`flags[MODULE_ID].battleToken = battle.id`. `setUp` calls C's `startPreload(scene)` AFTER tokens exist (token art is
part of what Foundry preloads) when the preload setting is on.

### C. Preload readout

`encounter-preload-core.mjs` (pure):

```js
export function sceneSources(sceneLike)                      // every image URL the scene needs: level backgrounds/foregrounds/fog, tile textures, token textures (+ring subject), de-duplicated
export function makeTracker({ expected, now, stallMs = 90000 })   // expected: [{userId, name}]
  // .update(userId, {loaded, total, weightLoaded, weightTotal, failed, done}) ; .snapshot(now) ; .allReady()
  // row state: "waiting" | "loading" | "ready" | "failed" | "stalled"; pct from weights when known else counts
```

`encounter-preload.mjs` (Foundry-bound):

```js
export function registerPreloadSocket()          // once, at `setup` (see "As built"), on EVERY client (SOCKET, SOCKET_ACTIONS)
export async function startPreload(scene)        // GM: no-op unless the setting is on; returns {requestId, expected} ; players = active non-GM users
export function stopPreload(sceneId)
export function preloadSnapshot(sceneId)         // {sceneId, rows:[{userId,name,state,loaded,total,pct}], ready, expected, allReady, startedAt} | null
export function onPreloadChange(fn)              // → unsubscribe; fired on every progress message
```

Player side: on `SOCKET_ACTIONS.preload` (non-GM clients, setting on) build `sceneSources`, HEAD each for
Content-Length (weights; fall back to equal weights), load each with `foundry.canvas.TextureLoader.loader.loadTexture`,
send `SOCKET_ACTIONS.progress` back to the starting GM only (`{recipients:[gmId]}`) and finish with a `done` message
(not with `game.scenes.preload`: see "As built"). GM side ignores unknown
`requestId`s. The payload's `userId` is cosmetic (the readout only), not trusted for anything else: read the header of
`scripts/downtime/downtime-session.mjs` for how this module treats socket identity.

### D. Windows and wiring (two halves)

**The picker half**: `settings.mjs`, `battle-map-picker.mjs` + `battle-map-picker-core.mjs`, `templates/encounter-maps/picker.hbs`,
`styles/encounter-maps.css` (with its `module.json` `styles` entry), `scripts/shadowdark-enhancer.mjs` (the API namespace and
the `setup`/`ready` wiring), `docs/API.md`, the wiki page and `CHANGELOG.md`.
**The buttons half**: `scripts/encounter/battle-maps/battle-actions.mjs` + `battle-actions-core.mjs`,
`scripts/overland/encounter-panel.mjs`, `scripts/overland/overland-bar.mjs`, `scripts/overland/hud-core.mjs`,
`scripts/encounter/encounter-draw.mjs` (`postEncounter` only), `templates/chat/encounter-result.hbs` and the HUD panel's
rules in `styles/shadowdark-enhancer.css`.

The two halves meet at:

```js
// D1: scripts/encounter/battle-maps/battle-map-picker.mjs
export class BattleMapPicker                       // ApplicationV2
BattleMapPicker.pick({ terrain, night, camping })   // → Promise<{mapId, variant}|{sceneId}|null>   (variant "day"|"night"|"camp")
// D2: scripts/encounter/battle-maps/battle-actions.mjs
export async function openBattleMap({ enc, terrain, hex, choose = false })   // the one flow both the HUD button and the chat button run: picker when `choose` (or no default map), then BattleMaps.setUp
export function registerBattleChatButtons()         // GM-only click handling for the posted encounter card
// The entry point wires registerPreloadSocket() at `setup` and registerBattleChatButtons() at `ready`, by dynamic import
// so one missing file cannot break module load.
```

Both D agents import A, B and C lazily or statically per the contracts above and test against injected fakes.

- Settings (`scripts/shared/settings.mjs`): `SETTINGS.prefs` (world, config false, Object, default {}) and
  `SETTINGS.preload` (world, config true, Boolean, default true).
- `battle-map-picker.mjs` + core: ApplicationV2 window modelled on the pit-fighting picker; resolves a promise with
  `{mapId, variant}` | `{sceneId}` | null. Order: this terrain's maps (default marked), other maps with terrain filter
  chips, world scenes (search). Day / night / camp toggles seeded from the arguments. Credits as hover text.
- The HUD Encounter panel (`scripts/overland/encounter-panel.mjs` + `overland-bar.mjs` actions): **Battle map**,
  **Choose map…**, then, once staged, the readout, **Bring the table** (Ready n/N), **Change map**, **Return to
  travel** with **Keep this battle**. Chat card: a GM-only Battle map button on the posted encounter card.
- `game.shadowdarkEnhancer.encounterMaps` API (`scripts/shadowdark-enhancer.mjs`, `docs/API.md`): `open(opts)`, `pick(opts)`,
  `current()`, `bringTable()`, `returnToTravel(opts)`.
- Docs: a wiki page under `docs/wiki/`, a CHANGELOG `[Unreleased]` entry. Window design: `docs/design-contract.md`.

## As built (2026-10-09)

Where the build, and the independent review that followed it, changed the contracts above.

**Library.** 43 maps: 11 assembled here, 25 rescaled pack maps and 7 camp variants. `labelKey` is camelCase and written out
whole (`SDE.encounterMaps.map.forestWoods`), because `test/i18n-keys.test.mjs` finds keys by scanning for them; a key derived
from an id is invisible to it. Every entry also has a `thumb` (a 480 px preview, so the picker does not decode 4400x3200
images) and may have a `foes` zone. `resolveDefaultMap`: nothing saved for the terrain gives the first enabled map; a saved
pin that is still on gives the pin; a saved entry with no enabled pin picks at random. So a window that writes an entry
writes the pin the GM sees, and `pinned: null` only for "Pick at random". The jungle wetland was dropped (its canoe holds a
quarter of a party, the rest is pond). Twelve maps have explicit party zones, after rendering the real layout over every
map: the default centre was water, lava or a chasm on those. Eight maps also name where the foes start (`foes`), because
the strip at the rolled distance runs through water or lava on them: both swamp bogs, Rocky Coast, Driftwood Cove, Rock
Pools and Pooling Caverns, beside the Stone Bridge and Scattered Islands that had one from the start. A second render, of
the foes at close, near and far over every map, found the rest of them on ground. Nine pack maps state no grid in their file name and were
scaled as 23x16 squares at 140 DPI (Highland Pass, Beach Dunes, Rocky Coast, Jagged Cave, Luminescent Cave, Cobblestone
Highway, WildRoad, Haunted Marsh; the ninth, Roadside Wilderness, as 22x17 at 70 px): judged by eye against the art, not
measured.

**Scene and battle.** `BattleMaps.current()` and `get()` answer `{battle, scene}`. One battle per scene at a time: a second
Set up returns the open one (`existing: true`) and places nothing. The record gains `presentTokenIds`: party tokens already
on the scene, enrolled in the combat and never deleted. Return to travel ends the combat first and then removes the tokens:
in v14 a combat tied to a scene keeps its combatants when their tokens go, and `Combatant#actor` then falls back to the
base actor, which the Hunter XP, loot drop and session recap hooks read when a combat ends. Removal re-reads the scene,
and if a token will not go it stops and keeps the record so Return can be pressed again. Day scenes have global light on
while darkness is 0.5 or less (the arena's "off" suits a night-only map); a scene made earlier is repaired once, marked by
the `encounterMapLight` flag. At night the characters see by their torches: the system lights a torch on the actor's
prototype token and on the one token it finds on the canvas being looked at, so a torch lit or put out on the hex map
while the battle was staged never reached the tokens set down for it, and Bring the table refreshes the light of the
characters' tokens the battle placed from their actors' prototypes (`syncPartyLight`; foes, and characters already on the
scene, are left alone). Token positions snap to the scene's own grid. The two folders have localized names and are
found by flag, then by localized name, then by the old English name. Foes are numbered one by one when their prototype
token numbers its tokens, and a prototype token that picks its picture at random is asked for its list (`getTokenImages`),
from which each foe is dealt one (`dealPictures`) instead of all wearing the first. A camp map's fire is an AmbientLight
(30 ft, flagged `campfire`) at the art's fire, which sits on every shipped camp at its `campLight` point (checked against the
seven pictures). It follows the party's own camp: while Overland has tonight's camp made, the camping window's record on
that party says (`phase` not `complete` and `fire.lit`); a fire not lit yet or gone out puts the light out (`hidden`, kept so
the GM can light it), and with no camp or no record the fire is lit, as the art shows. `settle` sets it on every setUp and
changeMap, like the darkness; the light is found by its flag, else by its point. The foe distances are the nearest
foe's centre to the front character's: the build first took "close 2 / near 6 / far 12" as the empty squares between them,
which put near foes 35 ft away, just outside a torch's light (6.5 squares with the token's own half), and far foes 65 ft,
just outside a lantern's (12.5). `FOE_GAP_SQUARES` is now 1 / 5 / 11, so the foes stand 2 / 6 / 12 squares (10 / 30 / 60 ft)
off. Seen live at night on a player's own client (forest woods, four wolves in two ranks): a torch shows close foes (2 and
3 squares) and the front rank of near ones (6; the rear rank at 7 is dark), and no far ones; a lantern shows far ones. A
strip that does not fit past the party is pushed back to the map's edge, nearer than asked, and is the same as before: that
is every far roll on 26 of the 35 maps that place their foes by the roll (the 40-square land maps and their camps: the
zone's edge plus 11 squares plus the strip's 4 runs off the map, so the foes stand 10 and 11 squares off) and every near roll
on 12 of them. The lantern still reaches those far foes and the torch does not. Every map that places its foes by the roll
was drawn again, old distances beside new, and the foes stood on the same kind of ground.

**Preload.** A player finishes when the last file has loaded; it never calls `game.scenes.preload`, which waits on the
browser's audio unlock (a freshly reloaded or idle player would stay "not ready" forever) and flashes a loading bar on the
player's screen. Only what the scene's opening level draws is loaded. Players who leave stop counting, and players who join
mid-preload are asked to load. A GM who reloads with a battle staged gets the readout back: its sessions live in the
page, so the record names the GM who set it up (`gmId`) and only that GM's client restarts it, at `ready`
(`resumeBattleReadout`); a second GM tab or the bridge reloading must not take the players' reports, since a player
reports to whoever asked last. A player takes each request once. The listener registers at `setup`, not `ready`: Foundry
replays buffered socket events just before `ready`. `onPreloadChange(fn)` calls `fn(snapshot|null, sceneId)`, also every
10 s while anyone is loading, and rows carry `failed` and states `stalled` (90 s without progress) and `left`.

**Windows and wiring.** The clock HUD hides on a non-hex scene and during combat, which is exactly where Set up and Bring
the table put the GM, so the bar stays up for a GM while a battle exists (`barShown` in `hud-core.mjs`): a slim battle bar
and a battle panel. The panel opens while the battle is staged and folds when it goes live, so it does not cover the Crawl
Strip's combat cards. Return to travel is also offered while staged, as the way to cancel. The picker is select then
confirm, and `pick()` answers `{mapId, variant, night}`, `{sceneId}` or null. The posted card has Battle map only; Choose
map… is in the panel. `openBattleMap` refuses a second battle while one is open.

**Not yet seen in a live world** (everything here was checked against the v14 source and fakes): the real canvas, thumbnails,
activation and Combat tracker; daylight lighting the players and the repair of an existing scene; hex snapping; token delete
vetoes and a rejected `Combat.create`; the sender id arriving as the listener's second argument; players who reload or join
mid-preload; the HUD bar's offset against the Crawl Strip; the confirm dialog and the card's click on a player's client.

## House rules this feature obeys

- Foundry v14 only. No hard dependency on Shadowdark Extras, Calendaria or Simple Calendar.
- Every user-facing string comes from `languages/en.json` (#169), keys written out whole.
- Document flag writes go through `replaceModuleFlag()`; no `recursive: false`; no dot in a flag key; documents are read
  back after a write in state flows.
- Never delete by collection sweep: the only deletions are the exact ids a battle's own record names.
- Pure cores import cleanly in Node; Foundry-bound files stay thin.
