# E2E Importer Test — "Import Everything via the Automatic Route" (2026-07-13)

## 00 · What this test was

A full real-world exercise of the Importer, done the way a user does it and
**with no hand-fixes anywhere**: for every locked row in the Manage tree, click
**Import → Parse → Create** (or the sub-app equivalent) and commit whatever the
automatic route produces. Then an adversarial accuracy re-review of every
created document against independent ground truth.

- **World**: `FinalFresh` (fresh; FVTT 14.364, Shadowdark 4.0.6, module at working-tree state).
- **Driver**: real DOM button clicks via MCP (`dev/e2e-driver.mjs`) — the same
  handlers, debounces, dialogs, and re-renders a human hits. Not internal parser calls.
- **Ground truth, in order of independence**: `pdftotext` extractions of the
  actual source PDFs (all 8 books, 118 cited pages), the hand-curated
  `.planning/wr-scrape/*` + `.planning/wr-titles.json` oracles, the CS3–6
  roll-table census, and live use-time checks (rolling tables, resolving links).
- **Artifacts**: `dev/e2e-import-run.json` (226 per-row records),
  `dev/e2e-world-dump.json` (every created doc), `dev/e2e-findings-2026-07-13.json`
  (245 raw comparator findings), `dev/e2e-driver.mjs` / `e2e-dump.mjs` /
  `e2e-livechecks.mjs` (reusable harness).

## 01 · Headline numbers

| | |
|---|---|
| Tree rows attempted | 226 (every unlock button; 17 min) |
| Committed end-to-end | **150 rows** → 139 roll tables + 275 items (92 spells, 92 backgrounds, 43 talents, 9 classes, 1 ancestry, 38 gear) |
| Couldn't complete (no page cite → no auto-grab) | 7 rows |
| No automatic route at all | 69 rows (5 CS bestiary bundles + 64 monster-census gap rows) |
| Console errors during the whole run | **0** |
| Broken document links in created tables | **0** (all `@UUID` results resolve) |
| Roll test (20-table sample) | all roll without errors |

**Bottom line: the pipeline is mechanically solid — nothing crashed, everything
links, everything rolls — but a material slice of the committed *content* is
wrong, and the route commits it without friction.** The worst failures are
silent: no warning, or a warning that Create happily ignores.

## 02 · What PASSED accuracy review (verified, not assumed)

- **Spells: 91/91 field-accurate.** Every imported WR spell matched the oracle
  on tier, range, duration, and ≥85% description text (the 1 absent spell,
  Witch *Shapechange*, is correctly not on any imported list). Folders follow
  `Spells / <Class> (<Variant>)`; source stamps + alignment flags correct
  (Necromancer spells correctly unaligned).
- **Names tables: 8/8 perfect.** Each `Character Names: …` 1d100 is exactly the
  book's Part 1 × Part 2 cross-product (100/100 valid combos each; verified
  against the book pages, including Elf/Half-Elf where the scrape oracle itself
  is lossy).
- **Trinket tables: row-perfect, and the auto-repair is right.** All 8 ancestry
  trinket pages repeat the book's own `21-24` misprint; `repairSharedStartRanges`
  corrected it to `23-24` on every one, with a visible note. Verified against
  the PDFs — the created tables are *more* correct than the book.
- **The 21 CORE encounter d100 tables are faithful.** Row text matches the cited
  pages once their (intended) enrichment is accounted for — monster names became
  resolving `@UUID` links, dice became `[[/r]]` inline rollers. Full weighted
  range coverage, correct 1d100.
- **WR Backgrounds**: 92 background items + a full-coverage 1d100/96-row table.
- **Hygiene**: every char-content doc carries the right `system.source.title`
  slug; nothing was filed at pack root; suite packs/folders as designed.

## 03 · DEFECTS — ranked, all verified against the book

### D1 (CRITICAL) · All 11 WR Boons tables are prose garbage
`Freya/Krraktanamak/Loki/Molek/Oatali/Obe-Ixx/Odin/Oros/Rathgamnon/Saint Ydris/Yag-Kesh Boons`
committed as `2d6` tables with **~37 rows of god-lore prose chopped into fake
sequential ranges** (27–29 rows per table sit outside 2..12; one row is
literally the text "2d6"). Book (e.g. Oatali p214): a clean 5-band 2d6.
Live roll test returns mid-sentence fragments ("labyrinth below a temple in the").
Root cause: the 8 `… Prayers` pages have layout-shape recipes; the 11 `… Boons`
pages have none, and the generic parser eats the surrounding prose. *No warning
prevented the commit.*

### D2 (CRITICAL) · Class talent tables: 7 of 9 mis-banded, 2 missing
Verified against WR pages and the class oracle:
- **Full one-band shift** (every band holds the previous band's text) —
  Delver, Green Knight, Monk of Yag-Kesh, Duelist. The three former also carry
  an unreachable "Choose 1 of any" block at range **38 / 44 / 50 — exactly the
  class's page number** (the page footer parsed as a range).
  Book Delver: `2=gear slots, 3-6=+1 atk, 7-9=+2 stat, 10-11=Scavenger, 12=choose`.
  Created: `2=Deep Pockets, 3-6=gear slots, 7-9=+1 atk, 10-11=+2 stat, 12=Scavenger, 38=choose`.
- **Partial misplacement** — Kyzian Archer, Roustabout, Wyrdling (2/5 bands each).
- **Missing entirely** — Necromancer and Paladin: parse warned
  *"No TALENTS table found in the paste"* and **Create committed the class anyway**,
  leaving `classTalentTable = null`.
Every char-builder talent roll for these classes returns the wrong (or no) result.
The preview's badges/wiring made these look healthy; nothing in the automatic
route blocks a commit on a shifted or absent table.

### D3 (HIGH) · Known-REVIEW tables commit as garbage with zero friction
The documented hold-outs all imported silently broken (each verified vs page text):
| Table | Committed as | Book |
|---|---|---|
| CORE Carousing Outcome | `1d14`, 4 rows + two rows at 100 | d8, 8 outcomes (p93) |
| CORE Boons: Secrets | `1d144`, 144 rows of generator-column fragments | small boons table (p281) |
| CORE Curses/benefits | `1d84`, incl. "2d6" as a row | d20-family (p288) |
| CORE Weapon Bonus | "2d6" as a row @37-38 | 2d6 (p292) |
| CORE Tier 1 | "2d6" garbage row | d12 spell list |
| CORE Tier 3 / Tier 5 | missing-face gaps (11/12) | d12 |
| CORE W&T Low/Mid/High/Epic Stakes | overlapping duplicate ranges | d4 tables (p95) |
| CORE Unique Feature, TREASURE 4-6 | coverage gaps | — |
| CORE Interesting Customer | 4 EMPTY-text rows committed | d4×d4 matrix (p139) |

These were known REVIEW cases — the finding here is the *behavior*: the
automatic route commits them indistinguishably from clean tables.

### D4 (HIGH) · CS tables mangled three different ways
- **CS2 Enduring Wounds** → named `Cursed Scroll 2 - Cursed Scroll 2 p26: Enduring Wounds`
  (source prefix stacked on the rep-prefix), with a dead out-of-bounds row `26`
  (the page number) on a 1d20 table (book: clean d20, verified p26).
- **CS3 Nord Names** → `Character Names: Cursed Scroll 3 Cursed Scroll 3 P16: Nord`,
  `1d20` with **21 rows** (phantom row; doubled prefix; names-transform applied to
  a non-ancestry names table).
- **CS3 Arctic Sea Encounters** → `1d52`, 26 rows, where **row 1 is the seed line
  itself** ("Cursed Scroll 3 p26: Arctic Sea Encounters"), **row 2 is the column
  header** ("d100 Details"), row 3 the caption — real content starts at row 4,
  all shifted. Also spawned a bogus monster-census gap row named after the table.

### D5 (HIGH) · Class proficiencies/languages quietly dropped
- **Armor**: classes whose book line is a phrase — Green Knight & Paladin
  ("All armor and shields") — committed with **empty armor arrays** (Delver's
  explicit list resolved fine; Monk's "None" is legitimately empty).
- **Languages**: named languages are lost — Green Knight (Sylvan) and Wyrdling
  (Primordial) have `fixed:[]`; count-based ("two additional common") works.
Char-builder consequences are direct (wrong armor proficiency, missing language).

### D6 (MED) · Paladin titles band 5 unsplit — the old symptom, one survivor
`band5.lawful = "Knight of the Cross Blackguard    Knight of the Legion"`,
chaotic/neutral empty. The parse *did* warn ("couldn't split — edit in the
preview") and the automatic route committed it anyway. The other 9 classes' 50
title bands are correct — this is the last survivor of the historic
titles-dumped-into-Lawful bug.

### D7 (MED) · Gear: empty descriptions, name-casing, and unreachable rows
- **19 items committed with empty descriptions** (13 Basic from the known p107
  shared-page limitation + Falchion/Lance/Rapier/Stave + class-authored
  Strike/Pseudopod). Saddle/Wagon/Flask descriptions only partially match the book.
- Weapons otherwise carry real stats (costs, `d12` lance, finesse properties) — better than expected.
- **Name-casing artifacts committed**: `Miner'S Putty, Jar`, `Traveler'S Lamp`, `Flask Or Bottle`.
- **Census never-flip**: after importing *everything*, `Candle` (created as
  "Candle (3)"), `Morzo Silk Rope` (created as "Rope, Morzo Silk"), `Gem`
  (a "Varies"-cost row — never created at all) and `Mithral Round Shield` stay
  locked forever; the loop even re-imported whole tables trying to satisfy them.
- **Tree vs census divergence**: the tree showed Chakram / Sai / Mithral Shield
  as *present* while no such items exist anywhere (fresh manifest census agrees
  they're missing) — three rows a user can never import because their buttons
  don't render.

### D8 (MED) · Route gaps — what "Import, Parse, Create" simply can't reach
- **7 rows have no page cite** → Import seeds only a name; Parse finds nothing:
  CS1 Diabolical Mishap 1-3 / 4-5, CS6 Carousing Outcome (+Benefit/Mishap),
  WR Carousing Benefit / Mishap, CS3 Sea Wolf Plunder. (The scrape oracle holds
  full d100s for the WR pair — content exists, the catalog just can't fetch it.)
- **Monster bestiaries are paste-only** (5 bundles, 64 monsters) — no automatic route.
- After the encounter tables landed, the monster census surfaced **64 "Custom" gap
  rows** with Unlock buttons, including `The PCs`, `Cursed Scroll`, `City Watch`,
  and `Arctic Sea Encounters` (a table name) — flavor-text NPCs and artifacts
  read as missing monsters. Technically "correct" per its matching rules, but
  it buries the 5 real bestiary rows in noise.

### D9 (LOW) · Authoring-quality noise
Sentence-named Talent items ("You gain 2 gear slots and an additional Trusty
Gear", "1/day, step into a tree and exit from another within far") sit beside
properly-named ones (Scavenger, Parry). Functional, but ugly in pack browsing —
and one of them ("Deep Pockets") is what displaced Delver's band 2.

## 04 · The pattern behind the defects

Individually these have different mechanisms (missing shapes, footer page
numbers, header rows, phrase-valued fields), but they share one design gap:
**parse-quality signals never gate Create.** The route warns (sometimes) and
commits (always). A commit gate as simple as "block/confirm when a table has
out-of-bounds ranges, empty rows, die-notation rows, or a `No TALENTS found`
warning" would have stopped every CRITICAL finding in this run except the
armor/language field drops.

## 05 · Scope honesty

- No hand-fixing was done anywhere, per the test's premise; everything above is
  the raw automatic-route output, and it all remains in `FinalFresh` for inspection.
- Not exercised: full char-builder builds (blocked by D2 — talent tables must be
  right first), monster paste flows, the magic-item compound generators beyond
  single rolls, SDX-gated behaviors.
- Structured-oracle comparisons cover WR + CS3–6 content; CORE tables were
  verified structurally plus row-text-vs-page containment (pdftotext), not
  row-by-row against a curated oracle.
- The comparator itself produced false alarms on first pass (UUID enrichment,
  lossy scrape rows, generator parents); everything reported above survived
  re-verification against the actual PDF page text.

## 06 · Re-verification quick refs

- Re-run everything: `dev/e2e-driver.mjs` (`runAll()`), then `dev/e2e-dump.mjs`,
  `dev/e2e-livechecks.mjs`, and the comparator (scratchpad `compare.mjs`, copied
  findings at `dev/e2e-findings-2026-07-13.json`).
- Fast spot checks: `Class Talents: Delver` vs WR p38; `Western Reaches - Oatali
  Boons` vs WR p214; `Boons: Secrets` formula (`1d144`); Paladin
  `system.classTalentTable` (null) and titles band 5.

---

## 07 · REMEDIATION + RE-TEST (2026-07-14)

Every defect above was root-caused to an exact code site and fixed in eight
waves (W0–W7). The plan and the Codex second-opinion deltas are in
`.hermes/plans/` and `~/.claude/plans/`. The design change behind §04 —
**parse-quality signals now gate Create** — landed as `computeBlockers()` in
`table-importer.mjs` enforced at the Foundry-bound commit choke point
(`createTable`, `{allowInvalid:false}` default) plus a `DialogV2` confirm in the
hub ("Commit clean only" / "Commit anyway" / "Cancel") and a class-side gate.

### Fixes by defect

| # | Fix | Where |
|---|---|---|
| D1 | 11 WR Boons get `SECTION("<GOD> BOONS")` recipes | `table-shapes.mjs` |
| D2 | page-footer dropped from the talent range run; `Effect (…)`-header shift removed; `_validateTalentBands` (out-of-bounds drop + tiling blocker); Nec/Paladin overlay pages `52-53`/`54-55` | `class-parser.mjs`, `class-overlays.mjs` |
| D3 | `computeBlockers` + commit gate — known-REVIEW tables are **withheld**, not committed broken; a registered shape that fails to match raises a blocker instead of a silent generic parse | `table-importer.mjs`, `importer-hub-app.mjs` |
| D4 | `stripRepPrefix` (all sources) kills the double-prefix; die-bound stray-row drop; `stripSeedNoise`; CS2 Enduring Wounds → `SECTION`, CS3 Nord Names → own 4-col grid, Arctic Sea → `LONGTABLE 26-27` | `char-content-manifest.mjs`, `table-importer.mjs`, `table-shapes.mjs` |
| D5 | overlay `allArmor` fallback (GK/Paladin); named-language grant capture + shared `resolveLanguageNames()` (name→UUID, ancestry+class) | `class-parser.mjs`, `class-unit-importer.mjs`, `language-resolver.mjs` |
| D6 | titles split at the header's column offsets when a wide cell abuts single-spaced | `class-parser.mjs` |
| D7 | `nameVariants()` (qty-suffix + comma-inversion) unifies tree/manifest presence; `titleCaseName` apostrophe + minor-word fix; `_forceBlocks` keeps "Varies"-cost gear (Gem) | `char-content-manifest.mjs`, `manage-tree.mjs`, `statblock-parser.mjs`, `item-parser.mjs` |
| D8 | page cites + shapes for the 7 cite-less rows; monster-gap filters (possessives, `The PCs`, table self-names) + a collapsed **Unresolved encounter references** bucket | `char-content-manifest.mjs`, `table-shapes.mjs`, `monster-census-live.mjs`, `manage-tree.mjs` |

Plus a language-name bug the fix surfaced: the and/or list splitter cut inside
"Prim·or·dial" → `\b`-gated (`class-parser.mjs`).

### Re-test — clean `FinalFresh`, full automatic route, all fixes in

- **0 console errors**; every created `@UUID` result resolves; every talent
  table rolls (12 rolls each on Delver + Necromancer: **0 blank, 0 broken links**).
- **11/11 Boons** → `2d6`, five bands (`2 / 3-7 | 3-6 / 8-9 | 7-9 / 10-11 / 12`), verified vs the pages.
- **9/9 class talent tables** tile `2..12` with **no phantom page-number band**;
  Necromancer + Paladin now parse a table (were absent); Necromancer spells-known
  grid = 10 levels (`lvl1 = 2 tier-1` … `lvl10 = 3/3/3/2/2`), matching the book.
- **CS tables**: Enduring Wounds `1d20`/20 full-text rows; Nord Names a 4-column
  d20 name grid (Asger/Alva/Carlson/"the Eagle"); Arctic Sea `1d100`; WR & CS6
  Carousing Benefit/Mishap `1d100`/100 (were uncommittable). **Zero doubled names.**
- **Class grants**: GK `Sylvan` / Wyrdling `Primordial` resolve to language UUIDs;
  Paladin `allArmor:true` + band-5 titles split three ways.
- **Census**: `Candle`↔`Candle (3)`, `Rope, Morzo Silk`↔`Morzo Silk Rope` flip
  present; Gem imports; the tree-vs-census phantom rows are gone.
- **Commit gate**: 16 genuinely-broken CORE tables (Carousing Outcome, the four
  W&T Stakes, Traps/Party Name/NPC Qualities/Shop Generator with empty columns,
  Tier 1, Weapon Bonus, Curses/benefits, Unique Feature, Interesting Customer,
  Magic Item Idea Generator) are **withheld with a review dialog** instead of
  committing garbage — the exact §04 behavior change. They stay locked for a
  hand-fix in the preview.
- **Char-build acceptance**: a real `commitCharacter` Delver — rolling **11 →
  "Master Scavenger"** (the correct band-10-11 talent, not a shifted one) — produced
  a level-1 actor with its class, HP, and 4 talents; test actor deleted.

Committed counts (clean world): 149 roll tables · 40 gear · 9 classes · 44
talents · 92 spells · 92 backgrounds · 1 ancestry. Artifacts:
`dev/e2e-import-final.json`, `dev/e2e-world-final.json`.

### Honest residuals (by design or deferred)

- **CS6 Carousing Outcome** (numeric roll-plus-modifier lookup, 1..25 with
  all-numeric cells) imports as REVIEW with visible warnings; the gate blocks a
  silent commit. Hand-fix in the preview.
- The 16 gate-withheld CORE tables need bespoke extraction (empty-column
  generators, prose-interleaved lookups) — the gate makes their brokenness
  honest rather than fixing the extraction.
- **Bestiary auto-import** (5 bundles / ~60 monsters, still paste-only) is a
  scope expansion flagged for a later pass, not an E2E defect fix.
- 19 gear items still commit with empty descriptions (the p107 shared-page limit);
  the "Fill item descriptions" pass covers them.
