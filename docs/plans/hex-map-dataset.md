# Hex map dataset emitter — implementation plan

Tracking issue: [#169](https://github.com/DimitroffVodka/shadowdark-enhancer/issues/169).
Consumer side: [shadowdark-extras#141](https://github.com/DimitroffVodka/shadowdark-extras/issues/141)
(stable `buildHexcrawl(dataset)` entry point, `networks` block) and
[shadowdark-extras#142](https://github.com/DimitroffVodka/shadowdark-extras/issues/142)
(Hexer JSON as a second producer). Probe numbers and dead ends are in the project
worklog entries of 2026-09-17.

Status: Phase 0 implemented and live-checked 2026-09-17 (branch hex-map/phase-0); Phases 1 to 4 not started. Written 2026-09-17.

---

## 1. Purpose and scope

Give a GM who owns a published Shadowdark hex map (the Western Reaches GM Guide,
the six Cursed Scroll maps) a way to get that map into Shadowdark Extras' hexcrawl
runtime without this module shipping any of the map. The Enhancer extracts from the
GM's own book and image; Extras builds and runs the scene.

In scope:

1. Commit the hexcrawl parser's drafts as journal pages (the parser exists; the
   commit step does not).
2. Emit the Extras dataset from the text importer and hand it over, or download it.
3. Tag terrain and overlays for unkeyed hexes by hand on a contact sheet.
4. Classify stamped maps automatically and queue the uncertain cells for review.
5. CSV and JSON side doors, and a reference tile on hand-off.

Out of scope, owned by Extras once records exist there: encounter roller following
terrain, hex-day movement budget, reveal on arrival. Deferred: region membership
from the drawn borders; coast detection; hand-drawn (non-stamped) map classification.

---

## 2. Constraints and the numbers that shape the design

**Ships nothing from a book.** No stamps, no region names, no fixtures with real
text or real pixels. Same rule as the hexcrawl parser's fixtures (D1). Terrain names
are generic words and may be seeded; the Western Reaches terrain cost table reaches a
world through the table importer like every other WR table.

**Useful without Extras.** Every phase produces something on its own: pages, a JSON
file, tags on a scene. Extras is detected by namespace, mirroring the renown
delegation in the other direction. No `relationships.requires` change.

**Hex numbers only at the boundary.** `hexIdKey` reads `1403` as column 14, row 03.
The Extras builder reads the digits the other way and transposes with
`grid.landscape`. Same cell, opposite names. The dataset carries `num`; it never
carries a column and row pair.

**Measured on the Western Reaches A0 map** (9933×14043 JPG, 64×75 hexes, 4768 cells,
against a hand-verified table, unkeyed cells, column-parity split):

| Step | Precision | Recall |
|---|---|---|
| Terrain glyph, 1-NN on a 30×30 binarised cell | 94.5% accuracy | |
| Any overlay present (residual ink after stamp subtraction) | 86% | 87% |
| River (largest residual piece ≥ 60 px at half res, ≥ 2 edge sectors) | 80% | 90% |
| Path (overlay without a big piece) | 71% | 83% |
| Coast | not detectable | |

Review queue (1-NN margin < 1.3, or residual ink in the ambiguous band, or a stroke
piece of ambiguous size): 12.5% of cells, catching about half the glyph errors and
60% of the river/path errors. After review roughly 4.5% of cells stay wrong.

**Map families.** Western Reaches: stamped icons, exact to about 2 px, printed hexes
5.7% taller than regular (H/W = 0.916 vs 0.866). Cursed Scrolls: hand-drawn
continuous art, 150 to 260 cells each; hand-tagging is minutes, classification is
not attempted.

**Keyed text is already text.** The keyed table on GM Guide pp. 68 to 70 gives
number, region, terrain and name for all 270 keyed hexes; the per-region entries
from about p. 136 give the descriptions. A raw text dump through the existing
recognizer recovers 267 of 270 (189 with a body). The three misses are two-column
merges that pdf.js column extraction should avoid; verify in Phase 1.

---

## 3. Data contract

### 3.1 The dataset (owned by Extras, produced here)

```js
{
  name: "Western Reaches",
  source: "WR",                       // Enhancer source key, informational
  grid: { cols: 64, rows: 75, distance: 6, units: "mi",
          landscape: false, flipX: false, flipY: false },
  terrain: {
    default: "forest",                // biome key; Extras maps our terrain words to its biomes
    regions: [ { biome: "mountain", hexes: [1341, 1041, ...] }, ... ]
  },
  hexes: [
    { num: 4541, name: "Serengal", terrain: "ocean", desc: "<p>...</p>",
      zone: "Kyzian Steppes", icon: "", feature: "keyed_location" },   // feature: keyed_location|village|town|city|city_state
    ...
  ],
  networks: { river: [1246, 1247, ...], road: [4649, 4749, ...] }
}
```

`terrain.regions` lists every tagged or classified cell by terrain word. `hexes` is
the keyed set. `networks` are hex-number lists; the book's `path` tag maps to
`road`. `icon` is left empty; Extras picks by `feature` when it wants to.

### 3.2 Terrain vocabulary

Sixteen generic words, lower snake case, seeded into the tagger's select and
accepted by the parser: `arctic_sea ocean lake coast river mountain volcano lava
canyon forest jungle grassland swamp desert salt_flat path`. Free text is allowed.
Overlays are `river`, `path`, `coast`; everything else is a primary. Water family
for stamp subtraction: `ocean lake arctic_sea`.

### 3.3 The tagger's working store (scene flag, this module)

```js
flags["shadowdark-enhancer"].hexTags = {
  version: 1,
  origin: { i: 0, j: 0, num: 0 },     // grid offset of the cell carrying hex number `num`
  cells: { "1403": "forest;river|gm", "1404": "forest|auto:1.42" }   // tags|source[:margin]
}
```

Compact strings, one `setFlag` per sheet, never per cell. About 120 KB for the
Western Reaches. `ponytail:` a flag re-sends the whole object on every write;
move to a flagged JournalEntry page like Extras' `hexData` if a map ever exceeds
about 10 000 cells.

### 3.4 Side-door CSV

```csv
hex_id,tags,source
1403,forest;river,gm
```

`hex_id` is the published number; `tags` semicolon-separated; `source` optional.
The author's private table has more columns; only these three are read.

---

## 4. Architecture

```
scripts/importer/
  tables/hex-parser.mjs        existing: claim, parse, buildHexPageHtml, linkify
  hex/hex-summary.mjs          NEW pure: keyed summary-table rows
  hex/hex-dataset.mjs          NEW pure: drafts + rows + tags -> dataset
  hex/hex-commit.mjs           NEW Foundry: pages into the journals pack, two-pass links
  hex/hex-handoff.mjs          NEW Foundry: Extras call or JSON download
scripts/hex-map/
  geometry.mjs                 NEW pure: masks, sectors, cell<->num, tile placement maths
  bitmap.mjs                   NEW pure: Uint8Array bitmaps, dilate, components, features
  classify.mjs                 NEW pure: exemplars, stamps, residual rules, review queue
  tag-store.mjs                NEW pure: encode/decode the scene flag, merge into dataset
  sampler.mjs                  NEW Foundry: scene + image -> cell bitmaps and thumbnails
  hex-tagger-app.mjs           NEW Foundry AppV2: contact sheet
  reference-tile.mjs           NEW Foundry: place the hidden tile on the Extras scene
templates/hex-tagger.hbs, templates/partials/hex-sheet-cell.hbs
styles/shadowdark-enhancer.css (one block; bump STYLESHEET_REV)
languages/en.json ("SDE.hexMaps.*")
test/hex-*.test.mjs
```

Pure modules import nothing from Foundry and take plain data. Foundry modules are
thin: they fetch documents, call the pure code, write documents. That is what keeps
the whole classifier under `node --test`.

Public surface: `game.shadowdarkEnhancer.hexMaps = { buildDataset, handoff,
openTagger }` for macros. Documented in `docs/API.md`.

---

## 5. Phase 0 — commit hex drafts as journal pages (1 day)

### Why first
`segmentDump` already returns `result.hexes` and the hub drops it. The journals pack
(`sde-journal`, suite key `journal`) exists and no importer writes to it. Nothing
downstream has anything to hand over until this exists.

### Changes
- `importer-hub-app.mjs`: state field `_importHexes = []`; context
  `hasHexes`, `hexes: { count, crawlTitle, cards: [{ num, name, warnings }] }`;
  action `hubCommitHexes` in the actions map; reset in `hubClear` and in the
  downtime bail-out branch alongside the other `_import*` resets.
- `importer-hub-paste.mjs`, parse action: `hexes = seg.hexes ?? []` in the auto
  branch, `this._importHexes = hexes`, and `detectCrawlTitle(effectiveText)` for the
  entry name prefill.
- `templates/importer-hub.hbs`: a "Hex key" section modelled on the Downtime strip:
  title with count, a text input for the crawl title, the commit button, and a
  compact list of `num  name` rows with the parser's warnings highlighted.
- `importer-hub-commit.mjs`: `_onHubCommitHexes()` delegates to `hex-commit.mjs`.
- `scripts/importer/hex/hex-commit.mjs`:

```js
// pure
export function planHexCommit(drafts, existingByKey)
  // -> { create: [draft], update: [{ draft, pageId }], collisions: [key] }
export function rewriteHexPlaceholders(html, keyToUuid)
  // "@@HEX[14,3]{1403}@@" -> "@UUID[JournalEntryPage.xxx]{1403}"; unknown keys -> plain "1403"
// Foundry
export async function commitHexDrafts(drafts, { sourceKey, crawlTitle })
  // -> { entryUuid, pages: Map<key, uuid>, created, updated }
```

  Flow: `ensureSuite()`, `findSuitePack("journal")`, `ensureSourceFolder(pack,
  sourceKey)`; one JournalEntry per crawl title inside the source folder, flagged
  `hex: { source, crawl }`; one `JournalEntryPage` (type text) per draft, named
  `"1403 Serengal"`, flagged `hex: { num, key }`, HTML from
  `buildHexPageHtml(draft, hexKeySet)` through `cleanImportHtml`. Pass 2: with the
  created page uuids, rewrite every page's HTML once with `rewriteHexPlaceholders`.
  Re-import: `planHexCommit` matches on the `hex.key` flag and updates in place;
  collisions (the parser's duplicate-key warning) are listed and skipped.
- Manage tree: a "Hex keys" branch under the source, listing entries with page
  counts and a delete action. If `manage-tree.mjs` needs more than a leaf type for
  journals, defer the branch to Phase 1 and note it.

### Edge cases
- A page whose body is empty (summary-table rows claimed as anchors) still gets a
  page; Phase 1 enriches it. Do not drop it.
- Hex references to numbers outside the imported set stay plain text (D9).
- Re-running commit after deleting a page recreates it; flags, not names, are the
  identity.

### Tests
`test/hex-commit.test.mjs`: plan over invented drafts with and without an existing
index; placeholder rewrite with known, unknown and repeated keys; HTML stays
escaped (extend `html-safety.test.mjs` if the page builder changes).

### Docs
`docs/wiki/Importer-Hub.md` (new strip), `docs/wiki/Compendium-Packs.md` (journals
pack now used), CHANGELOG `[Unreleased]`, `tools/inventory/data.json` entry for the
new file, `npm run inventory`.

---

## 6. Phase 1 — summary rows, dataset emitter, hand-off (1 day)

### 6.1 `hex/hex-summary.mjs` (pure)

```js
export function parseHexSummaryRows(text)
  // -> [{ num, zone, terrain: ["arctic_sea"], name, feature, markers: ["*","†"], line }]
```

Row grammar, ported from the author's `parse_master_key_text`:
`^\s*(\d{3,4})\s+(.+?)\s+(<terrain>(?:\s*,\s*<terrain>)?)\s+(.+?)\s*$` where
`<terrain>` is the vocabulary from 3.2 matched case-insensitively, longest first.
The zone is whatever sits between the number and the terrain, so no region list is
needed. A trailing digit 1 to 4 on the name, before any `*`/`†`, is the settlement
size (`village town city city_state`); the markers are stripped into `markers`. Rows
outside 3 to 4 digits or without a terrain word are ignored, not errors.

Registered in the segmenter? No. The hub parse action runs it over the same text
after `segmentDump` and keeps the rows in `_importHexSummary`. Summary rows do not
claim text, so nothing changes for the other recognizers.

### 6.2 `hex/hex-dataset.mjs` (pure)

```js
export function buildHexDataset({ name, source, drafts, summaryRows, tags, gridHint })
  // -> dataset (section 3.1)
export const DATASET_VERSION = 1;
```

Rules: index drafts and rows by `num`; a hex present in either becomes a `hexes`
entry (name from the row when present, else the draft; `desc` from the draft body
via the page HTML builder; `zone` and `terrain` from the row). `grid.cols/rows` =
max column and row seen across drafts, rows and tags, plus one, unless `gridHint`
is given. `terrain.regions` from tagged cells (3.3) and from keyed rows;
`networks` from overlay tags. `terrain.default` = most frequent terrain word.
Validation: `validateHexDataset(ds)` returns `{ ok, errors }`, checking numbers only,
no duplicate `num`, terrain words non-empty.

### 6.3 `hex/hex-handoff.mjs` (Foundry)

```js
export function extrasHexApi()          // game.shadowdarkExtras?.hex?.buildHexcrawl ? api : null
export async function handoffDataset(dataset, { referenceTile } = {})
  // -> { via: "extras", sceneId } | { via: "download", filename }
```

Download uses `foundry.utils.saveDataToFile` exactly as `exportBundle` does, GM
gated, filename `<name>-hexcrawl.json`. With Extras present, call the entry point
and, if `referenceTile` is set, place it (Phase 4). The hub gets a "Send to Extras"
button when the API exists and "Download dataset" otherwise; both appear on the Hex
key strip after commit and in the tagger app.

### Tests
`test/hex-summary.test.mjs`: rows with one and two terrains, settlement digits,
markers, non-rows, invented names only. `test/hex-dataset.test.mjs`: merge
precedence, grid sizing, numbers-only assertion (`1403` appears as `1403`, never as
`{ col: 14, row: 3 }`), validation errors.

### Live check
Grab pp. 68 to 70 through the hub's "Grab text" with the WR PDF registered and
confirm the row count is 270 and the three previously merged entries (1246, 3472,
4649) parse. Record the result in the worklog either way.

### Release point A
Hex pages plus dataset download. Useful with or without Extras.

---

## 7. Phase 2 — sampler and contact-sheet tagger (2 days)

### 7.1 Geometry (`hex-map/geometry.mjs`, pure)

```js
export function cellMasks(w, h)          // { inhex, band, sectors, dist, labelZone: null } for a flat-top cell of w×h
export function offsetToNum(i, j, origin) / numToOffset(num, origin)
export function neighbours(col, row)     // flat-top, odd columns shifted down
export function hexPolygon(cx, cy, w, h) // 6 vertices, flat-top
```

Grid type is the scene's; Phase 2 supports flat-top columns (`HEXODDQ`/`HEXEVENQ`)
and pointy rows by transposing the offset before numbering. The `origin` is the grid
offset of the cell whose printed number the GM types into the app ("Top-left hex is
number: 000"). Parity mistakes show up immediately as a half-cell shift on the
sheet, and the keyed hexes from Phase 1 give an automatic check: cells that should
carry a keyed marker are sampled first and shown as a "does this look keyed?" row.

### 7.2 Sampler (`hex-map/sampler.mjs`, Foundry)

```js
export async function loadSceneImage(scene)      // HTMLImageElement from scene.background.src (same origin)
export function sceneToImage(scene, img)          // (x, y) scene -> (u, v) image, using scene dimensions and background scale/offset
export async function* sampleCells(scene, img, { size: 32, origin, onlyNums })
  // yields { num, i, j, bitmap: { w, h, data: Uint8Array } }
export function thumbnail(img, scene, num, px = 96)  // data URL, rendered on demand for the visible sheet only
```

Per cell: `drawImage(img, u0, v0, cw, ch, 0, 0, size, size)` into one reused
offscreen canvas, `getImageData`, threshold at 110 on the grey value, pack to 0/1.
Never a full-map canvas: 140 megapixels exceeds browser limits. Yield to the event
loop every 200 cells and report progress. Tainted canvas (image not same-origin)
is detected on the first `getImageData` and reported as "put the file in your
Foundry data directory".

**Verify in v13 and v14:** the exact background transform (`scene.dimensions`,
`background.scaleX/scaleY/offsetX/offsetY`) so `sceneToImage` is right; the grid
calls `getCenterPoint`, `getOffset`, `getVertices`. Fallback if the transform proves
brittle: the app owns alignment with four numbers (origin x, y, hex width, hex
height) and a preview overlay. Keep the fallback out unless needed.

### 7.3 Tag store (`hex-map/tag-store.mjs`, pure)

```js
export function decodeTags(flag) / encodeTags(state)
export function nextSheet(state, { size: 40, mode: "random" | "review" | "keyed" })
export function applySheet(state, answers)        // answers: { num: { terrain, overlays } }
export function tagsToDataset(state, base)        // fills terrain.regions and networks
```

### 7.4 Tagger app (`hex-map/hex-tagger-app.mjs`, AppV2 + Handlebars)

Opened from the hub (Tools row is wrong for this; it is a workflow, so it gets its
own button on the Hex key strip and a macro entry point). Layout:

- Header: scene name, cell count, tagged count, "Top-left hex is number", grid type
  detected, buttons: Sample, Next sheet, Build dataset, Send/Download, Import CSV.
- Sheet: 40 cells, each a 96 px thumbnail, a terrain `<select>` seeded from the
  vocabulary plus "other…", three checkboxes river / path / coast, and a "keyed"
  badge when the number is in the dataset's `hexes`.
- Footer: Apply sheet (writes one flag), Skip.
- Keyboard: Tab through selects, number keys pick the first ten terrains.

Modes: random (fresh map), keyed first (alignment check), review (Phase 3).
State outside the flag: sampled bitmaps in memory only, re-sampled on reopen.

### Performance and limits
4768 cells: sampling under 2 s, thumbnails on demand (40 at a time), memory about
5 MB of bitmaps. `ponytail:` no Worker; add one if a map over 20 000 cells appears.

### Tests
`test/hex-geometry.test.mjs` (masks, neighbours, num round trip, transposition),
`test/hex-tag-store.test.mjs` (encode/decode, sheet selection determinism with a
seeded RNG, dataset merge).

### Docs
New `docs/wiki/Hex-Maps.md`: the workflow end to end, the alignment steps including
setting background scale Y for stretched prints, the "hidden is not private" note
for Phase 4, what the dataset is and where it goes.

### Release point B
All six Cursed Scroll maps taggable and hand-off working.

---

## 8. Phase 3 — classifier and residual parser (3 days)

### 8.1 Bitmaps (`hex-map/bitmap.mjs`, pure)

```js
export function dilate(bm, n)
export function components(bm)             // 8-connected, returns { labels: Int32Array, sizes: number[] }
export function majorityStamp(bitmaps, t = 0.4, dilateBy = 2)
export function subtract(bm, stamp)
export function features(residual, masks)  // { ink, biggest, sectors, pieces }
```

`sectors`: number of distinct edge sectors touched by residual pieces of at least
`minPiece` pixels beyond 0.62 of the circumradius. `biggest`: largest piece.

### 8.2 Classifier (`hex-map/classify.mjs`, pure)

```js
export function featureVector(bm, ds = 30)          // block-mean downsample, Float32Array
export function nearestExemplar(vec, exemplars)     // { tag, distance, margin }  margin = d(other tag) / d(best)
export function buildStamps(cellsByTag, { waterFamily })
export function classifyOverlay(feat, T)            // { overlay: "none"|"path"|"stroke", ambiguous }
export function classifyMap(cells, exemplars, stamps, T)
  // -> { results: { num: { terrain, overlays, margin, source: "auto" } }, review: num[] }
export const DEFAULT_THRESHOLDS = { ... }           // fractions of cell area, see 8.3
```

Rules, in order per cell:
1. `terrain` = nearest exemplar's tag; `margin` recorded.
2. Stamp = the stamp of that tag, or the union of the water family's stamps when
   the tag is water. No stamp for a bare river or coast tag.
3. Residual = cell ∧ inhex ∧ ¬labelZone ∧ ¬stamp. The label zone is found once per
   map as the region of the mean-ink image above 0.30 in the bottom half.
4. `overlay` from residual features: ink ≥ T.ink → present; present ∧ sectors ≥ 2 ∧
   biggest ≥ T.stroke → `stroke`; present otherwise → `path`.
5. Stroke → `river`. Coast is never produced; it stays a checkbox.
6. Review if margin < T.margin, or T.inkLow ≤ ink < T.inkHigh, or stroke with
   T.strokeLow ≤ biggest < T.strokeHigh.
7. Keyed hexes (from the dataset) are skipped entirely.

Adjacency filtering ("needs a same-kind neighbour") is a checkbox, off by default;
Extras renders networks by adjacency anyway.

### 8.3 Calibration
The probe thresholds were in half-resolution pixels on a 95×87 cell: ink 45,
stroke 60, minPiece 6, ambiguous ink 20 to 60, ambiguous stroke 40 to 100, margin
1.3, downsample 30, sector radius 0.62. Store them as fractions of cell area and of
the circumradius so a different export scales. One object, one `ponytail:` comment
naming the calibration image. The app exposes only "sensitivity" as a single slider
that scales `ink` and `stroke` together; everything else stays fixed.

### 8.4 Exemplars
The GM's tagged cells are the exemplars. Minimum to run: three cells per terrain
seen. The app says which terrains are under-represented before classifying. The
review queue is served through the same sheet in "review" mode, and each answer
becomes an exemplar, so the loop is tag, classify, review, classify.

### 8.5 Tests
`test/hex-bitmap.test.mjs`: dilate, components on hand-drawn arrays, features on a
synthetic stroke and a synthetic dot chain. `test/hex-classify.test.mjs`: three
invented glyphs (blob, chevron, dots) stamped on a synthetic 96×88 cell with and
without a synthetic river and path; assert terrain, overlay, margin ordering, and
that the review queue contains the ambiguous constructions. No real map pixels.

### 8.6 Acceptance check (dev only, no repo data)
A "Compare with CSV" action in the tagger, hidden behind a client setting
`hexMapsDevTools`, imports a truth CSV (3.4) and prints precision and recall per
tag to the console. Bar: river ≥ 80% precision and ≥ 90% recall, glyph ≥ 94% on the
Western Reaches map. Result goes in the worklog, not the repo.

---

## 9. Phase 4 — side doors and reference tile (1 day)

### 9.1 Side doors
- Import CSV (3.4) and JSON (3.1 or the tag flag) into the tag store; same
  `<input type="file">` and `FileReader` pattern as `importBundleFromFile`.
- Export: the dataset JSON (Phase 1) and the raw tag flag as JSON.

### 9.2 Reference tile (`hex-map/reference-tile.mjs`)

```js
export function referenceTilePlacement(imageRect, cellBoxImage, cellBoxScene)
  // pure: { x, y, width, height } so the image's hex-field rectangle maps onto the scene's cell box
export async function placeReferenceTile(scene, src, placement)
  // TileDocument: texture.src, hidden: true, locked: true, alpha: 0.5, sort: -1
```

`cellBoxImage` comes from the sampler's geometry (the pixel rectangle covering
columns 0..N and rows 0..M); `cellBoxScene` from the Extras scene's grid. Non-uniform
scale falls out of the two rectangles, so the stretched Western Reaches print lands
on the regular grid. Documented: hidden tiles are still sent to player clients with
their file URL; delete the tile when tracing is done.

---

## 10. Cross-cutting

- **Settings.** None in Phases 0 to 2. Phase 3 adds one client setting
  `hexMapsDevTools` (boolean, default false). No new settings group; if a menu is
  ever needed it joins `encountersMenu`.
- **i18n.** All strings under `SDE.hexMaps.*` in `languages/en.json`.
- **Styles.** One block in `styles/shadowdark-enhancer.css`; bump `STYLESHEET_REV`
  in `scripts/shadowdark-enhancer.mjs` (the cache-buster test names the value).
- **Inventory.** Every new file needs a description in `tools/inventory/data.json`,
  then `npm run inventory`; `npm run inventory:check` is a gate.
- **Namespace.** `game.shadowdarkEnhancer.hexMaps` as in section 4; `docs/API.md`.
- **CHANGELOG.** `[Unreleased]` entries per phase; the next release cut decides the
  version.
- **Docs.** `Importer-Hub.md`, `Compendium-Packs.md`, new `Hex-Maps.md`,
  `Settings-Reference.md` (Phase 3), `API.md`.

---

## 11. Verification

Per phase: `npm run lint`, `npm test`, `npm run inventory:check`. Live checks on a
Shadowdark world through the Bridge user, never the GM's own tab:

| Phase | Live check |
|---|---|
| 0 | Paste an invented three-hex dump, commit, open the pages, follow a cross-link, re-commit and confirm no duplicates |
| 1 | Grab WR pp. 68 to 70, count 270 rows; download the dataset; with Extras present, hand off and confirm the scene builds with 270 records |
| 2 | Gloaming map as a scene background, align, sample, tag two sheets, build dataset, hand off; confirm painted tiles match the art |
| 3 | WR A0 map, tag 40 random cells, classify, review two sheets, run the CSV comparison, meet the bar |
| 4 | Import the author's CSV, hand off with the reference tile, check the tile lines up at the map corners, delete it |

---

## 12. Risks and open questions

| Risk | Mitigation |
|---|---|
| Extras entry point not ready or renamed | JSON download is the default path; the API name lives in one function |
| Background transform differs between v13 and v14 | Verify first thing in Phase 2; fallback alignment fields kept in reserve |
| Tainted canvas from a remote image URL | Detect and explain; only data-directory files are supported |
| Scene flag size on very large maps | Compact encoding, per-sheet writes, journal-page store noted as the upgrade |
| Parity or origin mistakes on numbering | Keyed-first sheet as an alignment check; the Extras num-only boundary makes a mistake visible as a transposed map, not silent |
| pdf.js column extraction merges summary rows | Measured on Phase 1's live check; the row parser tolerates a merged trailing name |
| Hand-drawn maps classified by mistake | The app warns when stamps are inconsistent (majority stamp under a density floor) and suggests hand tagging |

Open questions for Patrick:

1. Should this file be tracked? `docs/` is ignored except `docs/wiki/` and
   `docs/API.md`; tracking it means `!docs/plans/` in `.gitignore` plus an
   inventory bump.
2. Manage tree branch for hex keys in Phase 0, or defer to Phase 1?
3. One JournalEntry per crawl title, or one per region as the book is organised?
4. Keep `coast` in the vocabulary at all, given it is never produced automatically
   and the WR cost table treats it as normal terrain?

---

## 13. Schedule

| Phase | Days | Cumulative | Ships alone |
|---|---|---|---|
| 0 Commit hex pages | 1 | 1 | yes |
| 1 Summary rows, emitter, hand-off | 1 | 2 | yes, release point A |
| 2 Sampler and tagger | 2 | 4 | yes, release point B |
| 3 Classifier and review | 3 | 7 | needs Phase 2 |
| 4 Side doors and reference tile | 1 | 8 | needs Phase 1 |

Phases 0 and 1 are one pull request each. Phase 2 is one PR for the pure modules
and one for the app. Phase 3 is one PR for bitmap and classify with tests, one for
the app integration. Phase 4 is one PR.
