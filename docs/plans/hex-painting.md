# Hex art: a clean rebuild in the Enhancer

Status: in progress on `experimental/hex-painting`. Steps 1 to 3 are built.

This replaces the first version of this file, which moved Extras' painter
across and adapted it. Step 2 of that plan showed it doesn't work as a move.
Extras' painter is tied into its tray UI, dungeon painter, Dungeondraft packs,
tooltip and generators. The map builder alone pulls in 25,097 lines through
one import. Patrick doesn't want that system back: the UI is clunky and
cluttered. So the structure is rebuilt, and the few pieces of Extras that hold
real, hard-won knowledge are kept.

It still replaces the line of [hex-ownership.md](hex-ownership.md) that left
painting and hex art in Extras. Those stayed there only because of Foundry's
AI Content Policy for listed packages, which no longer applies.

## The idea: the hex data is the map

Extras paints by creating one Foundry Tile per hex: hundreds of documents on
a small map, thousands on a large one. Every change is a repaint that edits
those Tiles, and around that sit clamping, sort order, texture residency, a
separate bake, and a record store in a hidden journal.

The Enhancer already stores what every hex is, in the tag store
(`flags.shadowdark-enhancer.hexTags`, `tag-store.mjs`): a terrain and its
features (river, path, coast). So it doesn't paint. **It draws the art from
that data.**

- Each hex wears a picture from its terrain's tile set. The variant is picked
  from the hex number, so the same map always looks the same and nothing
  needs storing.
- Rivers, roads and coasts are drawn over the ground from the features.
- A keyed hex wears its own art, from the resolver that already exists
  (`keyed-art.mjs`).
- Change a hex's terrain with the hex brush or in the Hex Data window, and it
  redraws. There is no paint step and no Tile documents.
- A new picture dropped into a terrain's folder joins that terrain's set with
  no code change.

The cost: the art shows only while the Enhancer is active. A Tile outlives its
module; a drawn layer doesn't. The bake (step 7) covers that. It writes plain
images that keep showing, and can export one picture of the whole map.

## No more grid errors

Users keep hitting "Hex dataset failed its contract check: N hexes outside
the grid", and it is hard to explain how to fix. The rebuild must make it
impossible, not just rarer.

**Why it happens.** Before handing a map to Extras, the Enhancer converts its
hex numbers into Extras' grid format and checks Extras will take them
(`validateHexDataset` in `hex-dataset.mjs`). Extras counts columns and rows
from the same start, both from 0 or both from 1. A map numbered from 0001
(columns from 0, rows from 1, as on the Cursed Scroll maps) can't be written
that way, so the converted grid sits one off from the numbers and nearly every
hex lands "outside" it. Renumbering would break the match with the book, so
there is no fix the GM can make.

**The rule.** One description of the map, and nothing translates it.

1. **No conversion.** The drawer reads the tag store with the same numbering
   the tagger wrote it with (`cellNumber`, `onMap` in `geometry.mjs`), so a
   map numbered from any start draws. When step 6 removes the hand-off to
   Extras, `validateHexDataset`'s grid check and the "datasetInvalid"
   messages go with it, from the Hex Data window and the importer both.
2. **Off-map numbers are stopped at the door.** A tag can arrive by number
   rather than by clicking a hex: a CSV, a tag file, the importer, or an
   adopted Extras map. Each number is checked with `onMap` when it arrives.
   Numbers that aren't on the map are refused and named, with the reason
   ("the map ends at column 10"), in the window where the GM can fix them.
   Nothing off the map is ever stored.
3. **Moving the map's edges can't strand a tag.** When the GM changes the
   anchor or bounds, tags that fall off the map are listed in the Hex Data
   window with a button to remove them, instead of silently not drawing.

Tested: a map numbered from 0001 draws every tagged hex
(`test/hex-art-core.test.mjs`). Steps 5 and 6 add tests for 2 and 3.

## What the Enhancer already has

| Piece | File | Role in the rebuild |
|---|---|---|
| What every hex is | `tag-store.mjs` | The only input. Unchanged |
| Hex maths (offsets, cubes, numbers, neighbours, bounds) | `geometry.mjs` | Layout of every drawn hex |
| Editing hexes in patches | `hex-brush-app.mjs` | Becomes the hand-painting tool for free |
| Keyed hex art by number | `keyed-art.mjs`, `wr-keyed-art.mjs` | Art for keyed hexes |
| Drawing on the canvas, piece by piece, with zoom levels | `baked-map.mjs` (`SceneManager`, `PrimaryCanvasContainer`) | The pattern the new drawer follows |
| Fog that hides hexes and keyed sprites | `hex-fog*.mjs` | Unchanged; drawn keyed art hides the way baked sprites do |
| Reading an Extras map's hex data | `hex-adoption.mjs`, `extras-records.mjs` | Brings old maps over (step 6) |
| Window design rules | `docs/design-contract.md` | Every control the rebuild adds follows it |

## What comes from Extras

Kept, adapted and put under test. These four files import nothing and barely
touch Foundry. They hold the logic that took the longest to get right.

| Extras file | Lines | What it knows |
|---|---|---|
| `canvas/drawing-geometry.mjs` | 692 | Building the river and road network across hexes |
| `canvas/map-network-art.mjs` | 300 | Where coast and beach art goes |
| `hex/hex-bake-core.mjs` | 244 | Cutting a map into the image pyramid the Enhancer already draws |
| `hex/hex-water-terrain.mjs` | 89 | Which terrains count as water or arctic |

Two smaller things come as knowledge, not as code:

- **The terrain-to-tile-set map** (`BIOME_TILES` / `TERRAIN_BIOMES`, and the
  settlement rules `FEATURE_COLORED_RULES`) in `HexcrawlBuilderSD.mjs`.
- **Texture residency** (#178, `hex-art-residency.mjs`): the 400 ms freeze
  when PIXI unloaded hundreds of map textures at once. The drawer is built so
  this can't happen (see "Drawing").

**License.** Extras is a fork of gmdima/shadowdark-extras, MIT licensed
(© 2025 gmdima). Its `LICENSE.txt` (AGPL-3.0, added in the commit "hexroll
licence") covers the Hexroll data in the generators, none of which comes here.
Ported code gets gmdima's MIT notice in CREDITS.md, the way the Calendaria
code is credited.

**Left behind:** the tray and painter UI, Tile-per-hex painting and repaint,
the journal record store, the tooltip, decor, Dungeondraft packs, POI
preview/history, Solo Hex Mode, Hexer import, the noise-map generator and all
dungeon and settlement generators. Extras keeps all of it for people who run
Extras alone.

## Design

### Data

- **Input:** the tag store, nothing else.
- **Tile sets:** a manifest, `assets/hexes/manifest.json`, maps each terrain
  in the tagger's vocabulary (hex-map-dataset.md §3.2) to a folder and lists
  its files. A script regenerates it from the folders, so adding art means
  adding files and running the script. Settlement features map to Specials
  tiles the way Extras' rules do.
- **Variant pick:** a stable hash of (hex number, terrain) chooses a file
  from the terrain's set. Pure, tested, never stored.
- **Overrides:** a GM who wants a particular picture on a hex sets one. It is
  kept in `flags.shadowdark-enhancer.hexArt` as `{ "1403": "<path>" }`, one
  write per change. This replaces the Extras calls in
  `hex-tile-chooser.mjs`.

### Drawing

The tiles are 932×810 pixels. The Western Reaches is 64×75, about 4,800
hexes. Drawn at full size, that's gigabytes of GPU memory, so the drawer
never does that:

- The map is split into chunks of hexes. Each chunk is rendered once into its
  own texture, at the resolution the zoom needs, and only chunks on screen
  are kept. The same idea as `baked-map.mjs`'s pyramid, built live.
- Tile pictures are drawn from a reduced copy (a quarter size, 233×203, made
  once per picture when it is first needed). Full size is used only by the
  bake.
- After a chunk is rendered, the drawer holds the chunk texture, not the
  hundreds of tile textures that went into it. That makes the #178 freeze
  impossible by design.
- A tag change redraws only the chunks holding the changed hexes.
- One drawer per scene: if a scene holds a bake, Extras' painted Tiles, or an
  Extras bake that another module draws, the Enhancer doesn't draw over it.
  It is never drawn twice.

The numbers are checked on the Western Reaches in step 2 before anything else
is built on top: frame time while panning, GPU memory, and the time from a
brush stroke to the redraw.

### Overlays

Rivers and roads come from `drawing-geometry`, coasts from `map-network-art`,
drawn into the same chunks above the ground. Keyed hex art is drawn as
separate sprites, so the fog can hide a location exactly as it hides a baked
keyed sprite today.

### Editing

There is no paint button and no tray. The hex brush and the Hex Data window
change tags, and the map follows. The Hex Data window gains the per-hex
picture override.

### Bake

The bake is optional, for two jobs:

1. Play on very large maps without live drawing: `hex-bake-core` writes the
   pyramid into the world's folder under Enhancer flags, and `baked-map.mjs`
   draws it.
2. Export the whole map as one image that works without the Enhancer.

It replaces the call to Extras' `bakeMap` in `bake-map.mjs`.

### Old maps

A map Extras painted keeps its Tiles and keeps working while Extras is
installed. "Draw with the Enhancer" in the Hex Data window:

1. adopts the map's hex data (`hex-adoption.mjs`, already built)
2. hides Extras' painted Tiles with a flag, which can be undone, without
   deleting them
3. draws the map from the tags

Turning it back off shows the Tiles again. Nothing of Extras' is ever
written or deleted. Extras bakes keep being drawn by `baked-map.mjs` as
today.

### New maps

The importer's hex flow stops handing the dataset to Extras' `buildHexcrawl`.
It makes the scene (background, grid, tags) itself, and the drawer does the
rest. `hex-handoff.mjs`'s Extras calls (`buildHexcrawl`, `adoptHexcrawl`,
`upsertHexRecords`) go once step 6 works.

## The art

The 561 files copied into `assets/hexes/` (commit 4592479a) are a starting
point, not the final set.

- **Keep:** Patrick's own renders, whose seed and batch numbers are still in
  the original names (`Archive/RENAME-MAP-*.json` in Extras), such as the
  `lora` canyons and the `gen` salt flats.
- **Keep, credited:** `Water/` from 2-Minute Tabletop (CC BY-NC 4.0) and its
  colour adaptations in `Water-*`. Already in CREDITS.md.
- **Unconfirmed:** several terrain folders use 2-Minute Tabletop's
  `Hex - <Terrain> (<variant>)` naming (Badlands, Desert, snow, swamp,
  Vegetation, Mountains), and the 383 numbered Specials are unchecked.
  Anything not confirmed is replaced with new AI sets rather than traced.
- **New sets:** made offline with the same pipeline, at 932×810, named
  `Hex - <Terrain> <n>.webp` in the terrain's folder. Each set is checked on
  a real map at play zoom before it ships, because a tile that looks fine
  alone can repeat badly across 200 hexes.
- **Size:** each art commit states the release zip before and after.
  Currently 52.9 MiB on master, 73.3 MiB with the 561 files. The ceiling is
  90 MiB.

## Living alongside Extras

- Extras keeps its painter and art for people who run it alone.
- With both active, each scene has one drawer (see "Drawing"). An Extras
  painted map is Extras' until the GM chooses "Draw with the Enhancer".
- Extras needs no change for this to work. An issue asking Extras to step
  aside comes later, only if the two get in each other's way in practice.
- The Enhancer still stands on its own: everything here works with Extras
  absent.

## Branch

All of this lives on `experimental/hex-painting`, cut from `master` at
`fd4e6369` (v0.23.1) on 2026-11-12. The release date is open and this is a
big release.

- No PR per step. Each step is committed straight to the branch, one or more
  small commits per step, with `npm test` and `npm run inventory:check`
  passing before each push. Review happens once, on the PR from the branch
  into `master`, as an independent review.
- `master` keeps taking small fixes and releases as usual.
- Merge `master` into the branch often and in small steps, then run the tests
  and `npm run inventory:check`. A large late merge is how PR 567 silently
  dropped the Custom calendar's init call.
- When it is ready: one PR from the branch into `master`, then a minor
  release.
- The branch does not merge until the art provenance above is settled.

## Order

1. **Tile sets.** Manifest, its generator script, the terrain map, the
   variant pick and the override flag. Pure, with tests.
2. **Drawer.** Ground only, from tags, in chunks, live redraw on tag change.
   Measure on the Western Reaches. Nothing else starts until the numbers are
   acceptable.
3. **Overlays.** Port `drawing-geometry`, `map-network-art` and
   `hex-water-terrain`, with tests and the CREDITS.md entry. Draw rivers,
   roads and coasts.
4. **Keyed art and fog.** Keyed hexes as sprites the fog hides.
5. **Per-hex override** in the Hex Data window. `hex-tile-chooser.mjs` stops
   calling Extras. Off-map numbers refused on the way in, and tags stranded
   by an edge change listed for removal (see "No more grid errors").
6. **Old and new maps.** "Draw with the Enhancer" for Extras maps; the
   importer builds its own scenes; the handoff's Extras calls go, and with
   them the contract check and its error message.
7. **Bake.** Port `hex-bake-core`, write Enhancer flags, export one image.
   `bake-map.mjs` stops calling Extras.
8. **Art pass.** Trim `assets/hexes/` to the confirmed set, add new AI sets,
   and update CREDITS.md and FILE-INVENTORY.

## Step 2 measurements

Taken 2026-11-13 on the Western Reaches A0 scene (grid 174, 10,477 × 14,009),
with the 270 real tags plus made-up terrain for the rest, held in memory and
never saved: 4,736 numbered hexes, 4,523 drawn (the 213 `keyed_location` hexes
wait for step 4). Screen 2007 × 1067 at device pixel ratio 1.25, Firefox.

Chunks are 1,024 canvas pixels square. Tiles are shrunk once to the width a
tile covers at zoom 1 (389 px on this grid), so zoom 1 is sharp and closer
zooms are not sharper. Both are constants at the top of `hex-art.mjs`.

| View | Chunks held | Chunk memory | Frame, with art | Frame, without |
|---|---|---|---|---|
| Opening view (zoom 0.29) | 54 | 57 MB | 3.2 ms | 2.6 ms |
| Whole map (zoom 0.08) | 153 | 10 MB | 6.5 ms | 5.1 ms |
| Zoom 0.6 | 25 | 101 MB | | |
| Zoom 1 | 30 | 52 MB | 1.7 ms | 1.5 ms |
| Zoom 3 | 20 | 51 MB | 1.6 ms | 1.4 ms |

- A chunk renders in 0.4 ms on average, 11 ms at worst (223 renders).
- A brush stroke on one hex re-renders 4 chunks, 6 ms from the tag change to
  the redraw.
- The shrunk tiles add about 85 MB of GPU memory (124 pictures).
- The canvas itself took 2.2 s to draw.

The table's frame times are forced renders of the whole canvas, taken in a
hidden tab. Then, in the visible tab (a 144 Hz screen; Foundry's own ticker is
capped at 60), panning diagonally across the map for 3 seconds at each zoom,
with the plain print first and the drawn map second:

| Pan at | Print only: fps, median / 95th % frame | Drawn map: fps, median / 95th % frame |
|---|---|---|
| Zoom 0.29 | 153, 6 / 9 ms | 143, 6 / 14 ms |
| Zoom 1 | 154, 6 / 8 ms | 142, 6 / 14 ms |
| Whole map | 163, 6 / 12 ms | 161, 6 / 11 ms |

- Each pan has one or two frames over 33 ms whether the art is on or off,
  the worst about 120 ms. They aren't the drawer's.
- 308 chunks were rendered during those pans, the slowest in 9 ms.
- The first fill, from the canvas being ready to the screen full of art, takes
  1.6 s, almost all of it loading 124 tiles; the first chunk shows at 1.4 s.
- Re-filling the screen after a zoom from the whole map to zoom 1 takes about
  15 ms once the tiles are loaded.

Accepted: step 3 can build on this.

## Step 3 notes

- `hex-water-terrain.mjs` was not ported: it is a copy of the Enhancer's own
  `COASTAL_WATER` (tag-store.mjs), which is used directly.
- Rivers and roads come from the tag store's `river` and `path` features,
  beaches from terrain plus `coast` marks. `hex-art-overlays.mjs` works in
  printed hex numbers, so none of it needs the canvas grid.
- The pieces are in `assets/hex-overlays/` (2.9 MB). Their provenance is in
  the same state as the unconfirmed terrain folders.
- On the Western Reaches with a made-up river, road and derived coasts, the
  slowest chunk render went from 11 ms to 19 ms (more sprites per chunk).

## Open decisions

- **Specials:** whether the 383 numbered Western Reaches tiles are Patrick's
  renders or need replacing.
- **Overlay pieces:** where the river, road and beach pieces in
  `assets/hex-overlays/` came from.
- **Sharper than zoom 1:** tiles wider than 389 px would make close zooms
  sharper. Each doubling costs about four times the tile and chunk memory.

## Not in this plan

- **One site and dungeon generator.** Extras has the noise map generator, the
  content generator, settlements, the hex-to-dungeon bridge, the dungeon
  layout generator, caves, multi-level and reskin. A later plan picks one
  in-Foundry path from a keyed hex to a playable site. Adventure Studio stays
  a desktop tool whose exported sites can ship as ready-made content.
- **AI at runtime** (text or images generated inside Foundry). The art is
  made offline.
