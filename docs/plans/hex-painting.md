# Taking hex painting over from Shadowdark Extras

Status: proposal, 2026-11-12. Nothing here is built.

This replaces one line of [hex-ownership.md](hex-ownership.md): "Stays in
Extras: building and painting hex maps ... and dungeons." Painting and the hex
art stayed in Extras only because Foundry's AI Content Policy covers packages
in the official listing, and the hex art is AI-generated. The Enhancer is no
longer headed for the listing, so the art and the painter can come here.

Dungeons are a separate plan (see "Not in this plan").

## Where things stand

The Enhancer already owns hex play: the tagger, keyed hex pages, pins, fog
(`hex-fog*.mjs`), the coordinate overlay, the explorer and the keyed art for
the Western Reaches (`wr-keyed-art.mjs`). It cannot put a single tile on a
map without Extras. These are the calls it still makes into Extras' hex API:

| Call | Where | What for |
|---|---|---|
| `getTilePool`, `repaintHexTiles` | `hex-map/hex-tile-chooser.mjs` | Pick and set one hex's tile |
| `buildHexcrawl` | `importer/hex/hex-handoff.mjs` | Paint a new map from the dataset |
| `adoptHexcrawl`, `upsertHexRecords` | `importer/hex/hex-handoff.mjs` | Take over an existing scene, write hex records |
| `bakeMap` | `hex-map/bake-map.mjs` | Bake a painted map for play |
| `getZoneColors` | `hex-map/tag-overlay.mjs` | Zone colours, with a local fallback |

`wr-keyed-art.mjs` also names tile files by Extras' path
(`assets/Hexes/Specials/NNN_Name.webp`).

## The art

`shadowdark-extras/assets/Hexes`: 631 files, 28 MB, all WebP. The terrain
tiles are Patrick's own renders (the seed and batch numbers are still in the
original names, see `Archive/RENAME-MAP-*.json`).

| Folder | Files |
|---|---|
| Specials (numbered keyed-hex tiles, `NNN_Name.webp`) | 383 |
| Terrain folders (Snow, Vegetation, Salt Flats, Autumn, Swamp, Badlands, Water x4, Mountains, Desert, Canyons, Lava Fields, Jungle) | 178 |
| Archive (unreferenced, see its MANIFEST) | 70 |

The Archive does not move.

**Where it ships (decided 2026-11-12): inside the Enhancer**, at
`assets/hexes/` with the same sub-paths as Extras' `assets/Hexes/` so the
path migration is a prefix swap. The painter always has its art; there is
no second module to install or keep in step.

The cost is size. The Enhancer's release zip is 55.5 MB and this adds about
23 MB (WebP, so the zip barely compresses it). Extras' 101.9 MB zip already hits The Forge's 30-second setup timeout,
so the Enhancer gets closer to that line with every AI set. Each art PR
states the zip size before and after, and a set that pushes the zip past
90 MB is re-encoded or trimmed before it ships.

## Scope

Lines are Extras' `scripts/hex/` today.

| Extras code | Lines | Plan |
|---|---|---|
| Tile pool and painting: `HexPainterSD`, `hex-paint-session`, `hex-tile-selection`, `hex-colored-tiles`, `hex-custom-tiles`, `hex-special-tiles`, `hex-tile-clamp`, `hex-tile-labels`, `hex-water-terrain`, `hex-scene-format`, `hex-decor`, `hex-art-residency`, `hex-map-effects` | ~2,850 | **Move.** Reads `assets/hexes/` |
| Map building: `HexcrawlBuilderSD` (`buildHexcrawl`, `adoptHexcrawl`, `upsertHexRecords`, `getTilePool`), `hex-record-prune` | ~1,680 | **Move.** `hex-handoff.mjs` calls it in-process; the dataset contract stays as written in hex-map-dataset.md |
| Bake: `hex-bake`, `hex-bake-core`, `hex-bake-worker.js`, `hex-baked-scene` | ~935 | **Move**, and merge with the Enhancer's `bake-map.mjs` / `baked-map*.mjs` so one bake exists |
| Zone colours (`getZoneColors`) | small | **Move**; the fallback in `tag-overlay.mjs` becomes the only copy |
| Already replaced here: `SDXCoordsSD`, `SDXCoordsSettingsSD`, `SDXHexFogSD`, `hex-visibility`, `HexTooltipSD` | ~4,400 | **Nothing to move** |
| Generators: `HexGeneratorSD` (noise map), `HexContentGenerator`, `SettlementGenerator`, `HexDungeonBridgeSD`, `ContentRegistry` | ~2,900 | **Not here.** They belong to the generator plan |
| `SoloHexMode`, `HexerImporterSD`/`hexer-data`, `hex-poi-preview`/`hex-poi-history` | ~1,200 | **Decide** (see "Open decisions") |

About 5,500 lines move.

**Move and adapt, not rebuild (decided 2026-11-12).** hex-ownership.md
rebuilds play features because Patrick wanted them to work differently. The
painter should work exactly as it does: existing maps must repaint and bake
the same after the move, and Extras' fixes (the zoom-out freeze #178, the
coast and beach rules, tile clamping) must stay fixed. A rebuild would have
to reproduce all of that, taking weeks for the same result. Each file is
adapted on the way in, not pasted: module ID and flag namespace, the
Enhancer's settings and i18n, AppV2 where a window is still AppV1, and tests
for the pure parts in the Node harness. Anything that reads badly gets
cleaned up later, one piece at a time, once it is here and under test.

Before step 2, check where Extras was forked from. Any painter code that
came from that project carries its license, and an MIT notice, for example,
has to travel with the code.

## Flags and existing maps

A painted Tile carries `flags.shadowdark-extras.painted` and points at
`modules/shadowdark-extras/assets/Hexes/...`. Worlds are full of these.

- **Reading.** The Enhancer's painter treats a Tile as painted when either
  module's flag says so (`holdsTiles` in `hex-tile-chooser.mjs` already reads
  Extras' flag). New Tiles get the Enhancer's flag.
- **Paths.** A migration, once per world on the active GM's first load,
  rewrites a Tile's texture from `modules/shadowdark-extras/assets/Hexes/` to
  `modules/shadowdark-enhancer/assets/hexes/` only when the Enhancer holds a
  file of the same relative name.
  Nothing else on the Tile changes. It is safe to run again and is logged to
  the console with a count per scene. Without this, a world that later turns
  Extras off loses every tile.
- **Manifests.** `wr-keyed-art.mjs` and any GM-loaded assignment file are
  read with either prefix, so an old manifest keeps working.
- Extras' own flags are read, never written, as hex-ownership.md already
  requires.

## Living alongside Extras

The rules in hex-ownership.md hold:

- Extras keeps its painter and its art for people who run Extras alone.
- With both active, the Enhancer's painter runs. Extras hides its painter
  controls when `game.shadowdarkEnhancer.hexPainting` is there. That needs one
  Extras issue: the contract, an acceptance check and a not-needed list.
- `module.json` raises the recommended Extras version in the same release.
- The Enhancer still stands on its own: with Extras absent, everything here
  works.

## AI art from here on

New tile sets come from the same rendering pipeline and land in
`assets/hexes/` under the existing naming: `Hex - <Terrain> <n>.webp` in the terrain's
folder, numbered keyed tiles as `NNN_Name.webp` in Specials. The tile pool
scans the folders (`loadColoredTileAssets`) but caches the catalogue per
world, so a new file only appears after a rescan. The moved pool rescans when
the Enhancer's version differs from the one the cache was built from.

First additions, in order of what maps lack today: more Jungle (6) and Lava
Fields (8), then terrains with no folder yet. Each set is checked on a real
map at play zoom before it ships, because a tile that looks fine alone can
repeat badly across 200 hexes.

## Branch

All of this lives on `experimental/hex-painting`, cut from `master` at
`fd4e6369` (v0.23.1) on 2026-11-12. The release date is open and this is a
big release.

- No PR per step (decided 2026-11-12, after PR 584). Each step is committed
  straight to `experimental/hex-painting`, one or more commits per step, with
  `npm test` and `npm run inventory:check` passing before each push. Review
  happens once, on the PR from the branch into `master`, as an independent
  review, since it will be large.
- `master` keeps taking small fixes and releases as usual.
- Merge `master` into the branch often and in small steps, then run the tests
  and `npm run inventory:check`. A large late merge is how PR 567 silently
  dropped the Custom calendar's init call.
- When it is ready: one PR from the branch into `master`, then a minor
  release.
- Extras steps aside (step 6) only after that Enhancer release is out, or
  Extras users with an older Enhancer would have no painter at all.

## Order

1. **Art.** 561 live files into `assets/hexes/`, no Archive. Run
   `npm run inventory`; note the zip size before and after.
2. **Tile pool and painter.** `getTilePool`/`repaintHexTiles` become local and
   `hex-tile-chooser.mjs` stops needing Extras.
3. **Map building.** `buildHexcrawl`/`adoptHexcrawl`/`upsertHexRecords` move;
   `hex-handoff.mjs` calls them in-process.
4. **Bake.** One bake. `bake-map.mjs` stops calling `api.bakeMap`.
5. **Path migration and zone colours.** After this, `extras-records.mjs` and
   `extrasHexApi` have no hex callers left; delete what has none.
6. **Extras steps aside** (the Extras issue, then its release).
7. **New AI tile sets.**

## Open decisions

- **Solo Hex Mode, Hexer import, POI preview/history:** move with the
  painter, move later, or leave in Extras.

## Not in this plan

- **One site and dungeon generator.** Extras has the noise map generator, the
  content generator, settlements, the hex-to-dungeon bridge
  (`buildHexDungeonScene`: scene, journal and numbered room pins from a hex),
  the dungeon layout generator, caves, multi-level, reskin and the painter.
  The next plan picks one in-Foundry path, from a keyed hex to a playable
  site, and retires or merges the rest. Adventure Studio stays a desktop tool:
  its exported sites can ship as ready-made content the generator offers
  alongside a fresh roll.
- **AI calls at runtime** (text or images generated in Foundry). Nothing here
  needs them; the art is made offline.
