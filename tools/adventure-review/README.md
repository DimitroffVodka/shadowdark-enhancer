# Adventure review capture

`capture.mjs` copies the adventure maps as a GM reviewed them in a world into the module's data, so a fresh import on
any machine builds them the same way. It reads the world's scenes (every scene flagged with an adventure site) and
writes positions and mechanics only, as fractions of each map picture; no book text and no art.

What it writes:

- `scripts/importer/adventure/adventure-reviewed.mjs` (generated whole): the walls patch on top of `ADVENTURE_WALLS`,
  every creature on each map, the lights besides the data's own, and the stairs, ladders, shafts and trapdoors
  (paired teleport regions).
- `ADVENTURE_TRAPS` in `adventure-traps.mjs`, from each scene's Trap regions. A trap the old data read from a book
  line (the Halls' areas 2, 3, 13, 20 and 28) keeps that line, so its effect text still comes from the GM's book.
- The pins of `ADVENTURE_LAYOUTS` in `adventure-layouts.mjs`, from each scene's pin notes.

The headers and helpers of those two files stay as they are; only the data blocks are replaced.

## Re-running it after more edits

The world's LevelDB must not be read in place: copy it first, and never write under the Foundry data folder.

    rm -rf /tmp/wr-copy && mkdir -p /tmp/wr-copy
    cp -r ~/FoundryV14/Data/worlds/fresh-wr/data/scenes ~/FoundryV14/Data/worlds/fresh-wr/data/actors /tmp/wr-copy/
    rm -f /tmp/wr-copy/*/LOCK

    node tools/adventure-review/capture.mjs /tmp/wr-copy --foundry ~/FoundryV14
    node tools/adventure-review/capture.mjs /tmp/wr-copy --foundry ~/FoundryV14 --verify

`--foundry` (or `$FOUNDRY_DIR`) is the Foundry install; the LevelDB reader is its own `classic-level`. Then run the
gates (`npm run lint`, `npm test`, `npm run inventory`, `npm run inventory:check`) and commit.

`--verify` rebuilds every site from the shipped data through the importer's own planners, at the captured scene's
size, and compares it with the scene: walls (within 2 px, same door, state and senses), creatures (monster, name,
within a pixel), traps (name, area within 2 px, mechanics), link ends and which ends each pair joins, lights (place,
radii, colour), darkness and pins. It exits 1 on any difference and prints what differs.

## What it does not keep

- A wall's direction, threshold, door sound or animation (the reviewed maps have none; the capture warns if one does).
- Which Level a wall, light, region or token is on, and a region's elevation range (a fresh scene has one Level).
- A creature's hidden state (every creature is built hidden), its size (it comes from the monster) and items or
  effects added to it; a token whose nameplate and sheet name differ is built with the sheet name.
- A teleport's placement and transition (the defaults are used), and regions with no behavior.
- The Iron Fortress "(Levels)" copy is read only for the ends of its links to the Mines, which belong to the Iron
  Fortress (`SCENE_ALIASES`).
