# Taking play features over from Shadowdark Extras

Status: proposal, 2026-09-30. Nothing here is built.

The goal: the Enhancer owns what happens *at the table*, and Extras keeps what
*makes maps*. A feature moves by being rebuilt in the Enhancer the way Patrick
wants it, not copied line for line.

Other people use both modules, and some use Extras without the Enhancer. So
Extras keeps its versions. See "Living alongside Extras" below.

## Scope

| Feature | Extras today (lines) | Enhancer today | Plan |
|---|---|---|---|
| Hex coordinates | Map Coordinates, `SDXCoordsSD` + settings (980) | The Hex Tagger owns the numbering, but only the GM sees a number, on hover | **Build**: player-facing numbers from the tagger's numbering. Close Extras #195 |
| Hex fog | `SDXHexFogSD` + `hex-visibility` (1370) | Calls `isPositionRevealed`, `revealFrom`, `setFogEnabled` | **Build** the subset travel needs (see below). Copy the stored revealed hexes once |
| Hexplorer | Hex Tooltip: the hex records store, hover tooltip, hex edit dialog (1990) | Tags (terrain, features, regions), keyed hex pages, hex pins; a live read of Extras' records as a fallback | **Build** a tooltip and edit dialog over the Enhancer's own hex data. Copy Extras' records once. Solo Hex Mode is **not** included |
| Party token and sheet | Party actor, token placement and recall, token light, light-tracker exclusion, party from selection (~900); Party sheet with roster, shared inventory, XP, drop transfer, quests and travel tabs (~3000) | Its own party actor (`partyActor`), which joins Extras' party when Extras is there | **Build** both, as ApplicationV2 |
| Quests | `party-quests.mjs` (238): the Party sheet's Quests tab and an optional on-screen quest tracker, both read-only views of the Enhancer's quest log | Owns the quest log (`scripts/quests/`); reads Extras' `isParty`/`members` flags and `api.party` to find the party's quests | **Nothing to move** except the on-screen tracker. The Quests tab comes with the party sheet. `quests.mjs` switches to the Enhancer's party in the party token PR |
| Camping | Camp rest: tasks, rolls, summary (~1900) | Overland runs the camp (clock, lights out, time-lapse, rations fallback) and hands tasks to Extras' `camping.open`/`dawn` | **Build** the tasks and rolls, rolled in one pass (the change Extras #197 asked for) |
| Carousing | Carousing, overlay, tables, expanded tables, importer (~6000) | Session recap reads Extras' `carousingSession`/`carousingDrops`; Extras hands renown to the Enhancer | **Build, last**. Removes both halves of that contract |

**Stays in Extras:** building and painting hex maps (painter, bake, tiles,
art, decor, generators, Solo Hex Mode, `buildHexcrawl`/`adoptHexcrawl`/
`upsertHexRecords`/`repaintHexTiles`) and dungeons.

## Notes per feature

**Hex coordinates.** The numbering already exists in the tagger's flags. This
is a canvas layer that draws those numbers for everyone, with a setting to
switch it on or off. It removes the reason for Extras #195, and Extras #202
(`topRows`) only matters for maps sent to Extras for painting.

**Hex fog.** Travel needs:

- a per-scene revealed set and an on/off switch, in Enhancer flags
- a player-side overlay that covers unrevealed hexes
- reveal around the party token, at dawn and on move
- `isRevealed(scene, point)` for `overland/hex-rules.mjs` and `overland/route.mjs`

Extras' visual fog effects (`hexFogEffect`) don't come across. Extras stores
fog as `hexFogEnabled` and `hexFogRevealed` scene flags in its own namespace.
These are read once and written into Enhancer flags through
`replaceModuleFlag()`. Nothing writes to Extras' flags.

**Hexplorer.** This makes the Enhancer the authority for what is in each hex
during play. It adds a hover tooltip (a GM view and a player view) and an edit
dialog for terrain, features, notes and a journal link, all over the tagger's
tags and the keyed hex pages. It also replaces
`hex-map/extras-records.mjs`, which reads Extras' private
`__sdx_hex_data__` journal.

Extras' painter keeps its own records as the input for painting. Data flows
one way, Enhancer to Extras, through the existing hand-off. If the two ever
disagree, the Enhancer wins and the GM sends the map again. There is no
two-way sync.

Migration: the store is read once and fills in tags and notes the Enhancer
doesn't already have. This runs automatically, like the other migrations below.

**Party token and sheet.** The Enhancer already has its own party actor and
token. `joinExtras` turns it into an Extras party to get Extras' sheet,
members and token light. This lands as two PRs.

1. **Token:**
   - members
   - deploying and recalling the members' tokens
   - the token's light, from its brightest member
   - keeping the party out of the system's light tracker

   After this, the `joinExtras` and `api.party` calls go away. That includes
   `overland/hex-rules.mjs`, `overland/overland.mjs`,
   `encounter/encounter-terrain.mjs`, `quests/quests.mjs` and the tagger.
2. **Sheet:** an ApplicationV2 sheet for the party actor with these tabs:
   - Roster
   - Shared inventory, with drag and drop transfer to and from members
   - XP
   - Quests: the Enhancer's own quest log, which Extras' tab only mirrored.
     The optional on-screen quest tracker comes in this PR too.
   - Travel: opens the overland bar, which Extras' travel tab already defers
     to

   Weather settings are not moved, since the Enhancer's overland weather
   already covers them.

Extras' sheet is still an ApplicationV1 `ActorSheet`, and Foundry v16 removes
that class. Extras users without the Enhancer still need it, so Extras #199
still has to be done. When both modules are active, the Enhancer's sheet is
the default for the party actor, and Extras' sheet stays selectable.

Migration: existing Extras parties keep their members (`members` flag) and
shared inventory, which is the items owned by the party actor. The party
actor is reused, not recreated. Its items stay where they are, and the
Enhancer reads the member list once into its own flag.

**Camping.** The Enhancer already runs everything around the camp. What moves
is the task list, the rolls and the rest summary, rolled in one pass. The
`camping.open`/`dawn` hand-off and its "Extras before #186" fallback go away.

**Carousing.** This is the largest piece and has no link to hexes or the
Western Reaches. It comes last, after the Western Reaches release. Moving it
removes the carousing and renown contract in CLAUDE.md's "Standing on its
own" section, so that section gets rewritten when this lands. Existing
carousing logs are copied once from Extras' flags.

## Order

1. Hex coordinates: small, and useful on the Western Reaches map straight
   away.
2. Hex fog.
3. Party token, then the party sheet. Fog reveals around the token, so it
   goes next.
4. Hexplorer: tooltip, edit dialog, then the records copy. After that,
   `extras-records.mjs` is deleted.
5. Camping.
6. Carousing, after the Western Reaches release.

Each lands as its own PR.

## Living alongside Extras

Some users run Extras alone, some run the Enhancer alone, some run both, and
their versions won't always match.

- **Extras keeps its versions.** Nothing is removed from Extras, so Extras
  users without the Enhancer lose nothing.
- **With both active, one version runs per feature: the Enhancer's.** Extras'
  version steps aside when `game.shadowdarkEnhancer.<feature>` is there. This
  is the same feature check Extras already uses to hand renown to the
  Enhancer. It takes one complete Extras issue per feature: the contract, an
  acceptance check, and a not-needed list.
- **Mismatched versions.** A new Enhancer with an old Extras would run both
  versions. `module.json` raises its recommended Extras version to the one
  that steps aside, in the same release as the Enhancer feature.
- **Migrations are automatic.** Another GM's world holds Extras data they
  won't know to copy. So each feature's migration runs once per world on the
  active GM's first load. It can be run again safely, reads Extras' flags
  without writing them, and writes the Enhancer's own flags through
  `replaceModuleFlag()`.
- **The Enhancer stands on its own, as before.** Every feature here works
  with Extras absent.

## Decided

- **Party scope (2026-09-30):** the token and the sheet. At the time, part of
  the reason was that it made Extras #199 unnecessary. It doesn't, because
  Extras keeps its sheet (see above).
