# PDF Parser and Importer Code Review

**Module:** Shadowdark Enhancer  
**Review date:** 2026-07-11  
**Reviewed environment:** Foundry VTT 14.364, Shadowdark 4.0.6, Shadowdark Enhancer 0.9.5  
**Scope:** PDF text parsing, recognizer routing, importer previews, Foundry document creation, relevant module integration, tests, and runtime compatibility.

## Executive summary

The module has developed into a substantial Foundry content-import system rather than a basic PDF parser. Its strongest architectural decisions are:

- Mostly pure, Foundry-independent parser modules.
- An ordered recognizer registry for mixed PDF dumps.
- Human-in-the-loop previews with editable fields and warnings.
- Managed compendium packs and source folders.
- GM-gated write operations.
- Non-fatal parsing with unclaimed material surfaced for review.
- Explicit Foundry v14 and Shadowdark 4.x data-shape handling.

The review found several issues that should be addressed before relying on the importer for large or difficult sourcebooks. The most important are stored unsafe HTML, destructive replacement behavior, false-positive hexcrawl classification, and silent content loss in several parsers.

## Recommended priority order

1. Sanitize or safely construct all persisted HTML.
2. Make replacement operations transactional or update documents in place.
3. Bound and strengthen hexcrawl recognition.
4. Preserve ALL-CAPS monster features.
5. Fix inline gear and magic-item rider parsing.
6. Preserve interleaved spell prose and warn for missing metadata.
7. Make corrected class re-imports update stale content.
8. Preserve or warn about table instructions before the first row.
9. Add regression tests for every parser and recognizer interaction.
10. Split the importer hub and centralize shared PDF-text utilities.

---

## High-priority findings

### 1. Persisted descriptions can contain unsafe HTML

**Relevant locations:**

- `scripts/encounter/item-parser.mjs:66-70,187-199`
- `scripts/encounter/spell-parser.mjs:40-45,138-160`
- `scripts/encounter/class-parser.mjs:374-385,440-450`
- `scripts/encounter/hex-parser.mjs:235-239`
- `scripts/encounter/item-importer.mjs:57-74,153-193`
- `scripts/encounter/class-unit-importer.mjs:72-85,276-315`
- `scripts/encounter/importer-hub-app.mjs:814-825,1087-1118`

Pasted text is directly interpolated into HTML and subsequently persisted in Foundry document descriptions. Several helpers treat any string beginning with `<` as trusted HTML.

Reproduction input:

```text
CURSED MIRROR
Benefit. <img src=x onerror=alert(1)>
```

Observed parser output:

```html
<p><strong>Benefit.</strong> <img src=x onerror=alert(1)></p>
```

The live Foundry environment provides `foundry.utils.cleanHTML()`. Testing showed that `cleanHTML()` removed `onerror` and `<script>`, while `TextEditor.enrichHTML()` did not sanitize those elements by itself.

The preview template uses escaped Handlebars interpolation, which protects the preview, but it does not sanitize content later rendered from the stored document. Imports are GM-gated, reducing exploitability, but imported descriptions can subsequently be displayed to players.

**Recommendation:**

- Treat PDF input as plain text by default and HTML-escape it before adding module markup.
- If reviewed HTML input is intentionally supported, sanitize the final HTML at a shared Foundry-bound commit choke point with the supported Foundry sanitizer.
- Do not use `startsWith("<")` as a trust decision.
- Add tests for event attributes, script elements, malformed tags, and normal Foundry inline syntax.

### 2. Replace operations delete the existing document before replacement succeeds

**Relevant locations:**

- `scripts/encounter/item-importer.mjs:224-250`
- `scripts/encounter/monster-importer.mjs:155-180`
- `scripts/encounter/table-importer.mjs:729-776`

The replace path permanently deletes the existing compendium document and only then attempts to create the replacement. A schema rejection, hook failure, pack write failure, or malformed imported payload can leave the user with neither version.

Deleting and recreating also changes the UUID, potentially breaking journal links, roll-table links, and other references.

**Recommendation:**

- Prefer updating the existing document in place when practical.
- Otherwise create and validate a temporary uniquely named replacement first, then remove the old document only after successful creation.
- Preserve the original document until the full operation succeeds.
- Report whether each result was reused, updated, replaced, created, or skipped.

### 3. Hexcrawl recognition can consume unrelated document content

**Relevant locations:**

- `scripts/encounter/hex-parser.mjs:89-127`
- `scripts/encounter/dump-segmenter.mjs:267-281`

`clusterHexRuns()` begins at a three- or four-digit anchor and scans all remaining blocks without a maximum inter-anchor gap or terminating boundary. Three unrelated numeric blocks later in the dump can therefore satisfy the three-unit hexcrawl threshold.

Reproduction blocks:

```text
101

ordinary prose A

ordinary prose B

202

more unrelated prose

303
```

Observed result:

- All six blocks were claimed by the hexcrawl recognizer.
- Three hex entries were produced.
- The ordinary prose was attached to those entries.
- Nothing remained in the skipped list.

This is especially risky for PDF text containing standalone page numbers. Since the hexcrawl recognizer runs first, a false positive can steal monsters, spells, items, and tables before their recognizers see them.

**Recommendation:**

- Add a strict maximum gap between anchors.
- Terminate a candidate run when the gap is exceeded.
- Reject likely page-number sequences.
- Require additional hexcrawl evidence beyond three numeric anchors.
- Add adversarial tests using page numbers, ordinary numbered sections, statblocks, and tables.

### 4. ALL-CAPS feature headings can be detached from monster statblocks

**Relevant locations:**

- `scripts/encounter/statblock-parser.mjs:50-98`
- `scripts/encounter/dump-segmenter.mjs:145-175`

Every qualifying ALL-CAPS line begins a new candidate block, including uppercase feature captions following a valid AC–LV stat line.

Reproduction:

```text
FROG KING
AC 12, HP 9, ATK 1 bite +2 (1d6), MV near, S +1, D +1, C +0, I -1, W +0, Ch +1, AL C, LV 2
AMPHIBIOUS
Can breathe air and water.
```

Observed behavior:

- Frog King imported without the Amphibious feature.
- `AMPHIBIOUS` became a separate skipped block.
- The monster draft itself carried no warning that its feature had been detached.

**Recommendation:**

- After an AC–LV anchor is found, only treat a later uppercase line as a new monster when another stat anchor follows it.
- Alternatively, associate rejected uppercase continuation blocks with the preceding monster as review text.
- Surface a warning on the affected monster card, not only in the global skipped list.

---

## Medium-priority correctness findings

### 5. Gear descriptions are discarded when cost or slots share the line

**Location:** `scripts/encounter/item-parser.mjs:135-145,221-237`

Reproduction:

```text
Silk Rope
50 feet long, 5 gp, 1 slot
```

Observed output:

```text
description: "<p></p>"
```

The parser removes an entire body line when it contains a cost or slot token, silently losing `50 feet long`.

Inline first-line text is also lost:

```text
Rope, 5 gp, 1 slot, 50 feet of hemp
```

The unused `extraFromName` variable at `item-parser.mjs:232-234` appears to be an unfinished attempt to support this case.

**Recommendation:** remove only recognized cost and slot fragments, then preserve the remaining text as the description.

### 6. Same-line magic-item riders are recognized but not extracted

**Location:** `scripts/encounter/item-parser.mjs:135-202`

Reproduction:

```text
Flame Ring Benefit. You resist fire.
```

Observed behavior:

- Name became `Flame Ring Benefit. You Resist Fire.`
- Benefit list was empty.
- Description was empty.
- The item was no longer considered magical by `buildItemData()` because its rider fields were empty.

**Recommendation:** split inline rider text from the name before title casing, or reject the unsupported form with an explicit warning instead of claiming it incorrectly.

### 7. A heading before a directly parsed spell becomes its name

**Location:** `scripts/encounter/spell-parser.mjs:132-136`

Reproduction:

```text
SPELLS
FIRE BOLT
Tier 1, wizard
Duration: Instant
Range: Near
Deals 1d6 damage.
```

A direct call to `parseSpell()` returned `Spells` as the name without warning because it always uses `rawLines[0]`. The recognizer usually isolates the unit at `FIRE BOLT`, but the public parser and forced-type paths should still be correct independently.

**Recommendation:** use the nearest valid name line before the Tier anchor and preserve earlier lines as remainder or skipped material.

### 8. Interleaved spell metadata silently drops prose

**Location:** `scripts/encounter/spell-parser.mjs:111-140`

Reproduction:

```text
ARC LIGHT
Tier 1, Wizard
Range: Near
This sentence is between metadata.
Duration: 3 rounds
Final sentence.
```

Only `Final sentence.` survives because the parser defines the description as everything after the last metadata line.

**Recommendation:** identify and remove metadata lines individually, then preserve every other post-name line in source order.

### 9. Missing spell duration or range defaults silently

**Location:** `scripts/encounter/spell-parser.mjs:76-93,129-165`

A spell qualifies with Tier plus either Duration or Range. If one is absent:

- Missing duration becomes `instant`.
- Missing range becomes `close`.

These defaults can change spell mechanics without producing a review warning.

**Recommendation:** keep permissive recognition, but warn explicitly whenever required metadata is missing or defaulted.

### 10. Table instructions before the first row are silently discarded

**Location:** `scripts/encounter/table-importer.mjs:101-121`

Reproduction:

```text
d6 Weather
Roll once each morning
1 Rain
2 Sun
```

`Roll once each morning` is dropped as a pre-row crumb without warning.

**Recommendation:** preserve such text as a table description, expose it separately in the preview, or emit a warning containing the discarded text.

### 11. `Weapons: none` becomes a weapon lookup for “none”

**Relevant locations:**

- `scripts/encounter/class-parser.mjs:428-447`
- `scripts/encounter/class-unit-importer.mjs:263-270`

Armor parsing removes `none`, but weapon parsing does not. The resulting data contains:

```js
weaponNames: ["none"]
```

The importer then attempts to resolve a weapon named “none” and emits a misleading missing-gear warning.

**Recommendation:** normalize and remove `none` symmetrically from both weapon and armor grants.

### 12. Corrected class imports can retain stale prior content

**Location:** `scripts/encounter/class-unit-importer.mjs:56-69,218-259,316-328`

Same-name/type documents are reused without comparing or updating several important fields, including descriptions, effects, talent options, table rows, titles, and spell progression. Re-importing corrected PDF text can therefore report success while retaining old content.

**Recommendation:** distinguish among identical reuse, in-place update, explicit replace, and skip. Provide a diff or summary before overwriting reviewed class content.

---

## Compatibility and quality observations

### 13. Foundry v15 compatibility warning from the module

**Location:** `scripts/monster-art/monster-token-art.mjs:175`

The live console reported use of the deprecated global `FilePicker`. Foundry states that backward-compatible access will be removed in v15.

Use the namespaced implementation appropriate to the supported Foundry version:

```js
foundry.applications.apps.FilePicker.implementation
```

The other live compatibility warnings observed during review came from the Shadowdark system and Token Magic, not this module.

### 14. Parser test coverage is far below subsystem complexity

The current suite contains seven test files and 43 passing tests. Only four basic tests in `test/statblock-parser.test.mjs` cover the parser subsystem.

No active tests were found for:

- `dump-segmenter.mjs`
- `item-parser.mjs`
- `spell-parser.mjs`
- `class-parser.mjs`
- `table-importer.mjs`
- `hex-parser.mjs`
- `buildItemData()`
- recognizer-order interactions
- conflict and replacement behavior
- HTML safety
- Shadowdark 4.x creation payload contracts

Recommended regression fixtures include:

- False-positive hexcrawls formed by page numbers.
- Mixed monster/item/spell/table dumps.
- ALL-CAPS monster features.
- Inline gear descriptions and inline magic riders.
- Glued spell blocks and interleaved spell metadata.
- Missing spell duration/range warnings.
- d100 `00` ranges and malformed ranges.
- Table instructions before rows.
- Two-column and column-major table copies.
- Class talent-table mismatches.
- `Weapons: none`.
- Malicious and malformed HTML.
- Failed replacement writes.

Pure parser fixtures should use fast `node:test` tests. Foundry-bound payloads and persistence behavior should also receive live or Quench tests against Foundry 14.364 and Shadowdark 4.0.6.

### 15. Lint passes with substantial warning debt

`npm run lint` completed with:

```text
124 problems (0 errors, 124 warnings)
```

Parser-relevant examples include:

- `dump-segmenter.mjs:80` — unused `ALL_CAPS_NAME_RE`.
- `dump-segmenter.mjs:101` — unused `blockHasStatLine`.
- `item-parser.mjs:232` — unused `extraFromName`.
- Several unnecessary regular-expression escapes.

The warnings are not execution failures, but dead parser code can indicate incomplete or drifted logic.

---

## Maintainability observations

### Importer hub size and coupling

`scripts/encounter/importer-hub-app.mjs` is approximately 2,755 lines and currently owns:

- Parse-mode selection.
- Preview adaptation and state.
- Field mutation handlers.
- Document commits.
- Duplicate management.
- Bundle import/export.
- Source PDF management.
- Dialog construction.

Per-content preview controllers or adapters would reduce coupling between parser draft shapes and the application class. HTML normalization, validation, and commit reporting should be centralized.

### Duplicated PDF-text helpers and recognizer definitions

Blank-line block splitting is separately implemented in:

- `scripts/encounter/dump-segmenter.mjs:45-58`
- `scripts/encounter/item-parser.mjs:250-263`
- `scripts/encounter/spell-parser.mjs:170-181`
- `scripts/encounter/table-importer.mjs:58-72`

Anchor regexes are also duplicated in the segmenter rather than exported from their owning parser modules. Comments in places such as `item-parser.mjs:275-279` still describe an older recognizer order.

A small pure `pdf-text-utils.mjs` module could centralize newline normalization, block splitting, safe plain-text-to-HTML conversion, and shared predicates without introducing Foundry dependencies.

### Preview fields for long descriptions

Some descriptions are edited through single-line inputs in `templates/importer-hub.hbs`, including item and spell descriptions. Multi-line text areas would better support imported rules text and reduce awkward HTML-string editing.

---

## Notable strengths

- Parser logic is mostly Foundry-free and suitable for deterministic unit testing.
- The recognizer registry makes classification order explicit and extensible.
- Parsing is offline and does not upload sourcebook text.
- Parser uncertainty is generally surfaced as review warnings instead of causing hard failure.
- Unclaimed content is exposed in the skipped-review section rather than intentionally discarded.
- Preview templates use escaped Handlebars interpolation rather than triple braces.
- Conflict dialogs escape document names.
- Import writes are GM-gated.
- Compendium conflict checks correctly target pack indexes rather than unrelated world documents.
- Default conflict behavior is generally non-destructive rename/skip unless replace is explicitly chosen.
- Managed compendium suite and source-folder logic are centralized.
- Table results use Foundry v14’s `TableResult.name` field.
- Spell folders mirror the Shadowdark class/tier hierarchy.
- Class import code contains useful Shadowdark 4.x schema knowledge, including spell progression and borrowed spell lists.
- The module exposes a broad runtime API; live discovery found 61 callable API functions.
- The live module loaded as version 0.9.5 on Foundry 14.364 and Shadowdark 4.0.6.

---

## Verification evidence

The following checks were run against the clean `master` working tree:

### Automated tests

```text
npm run test
43 tests
43 passed
0 failed
```

### Lint

```text
npm run lint
0 errors
124 warnings
```

### Repository verification

```text
./verify.sh
verify: OK
```

### Live Foundry verification

- Foundry VTT: 14.364.
- Shadowdark system: 4.0.6.
- Shadowdark Enhancer: active, version 0.9.5.
- Live module API and `game.shadowdarkEnhancer` were present.
- MCP discovered 61 callable module API functions.
- Live `items.parse` behavior matched direct Node parser behavior for the inline gear-description reproduction.
- `foundry.utils.cleanHTML()` was available and removed tested event-handler/script content.

### Direct parser reproductions

Direct Node executions reproduced:

- False-positive hexcrawl capture across unrelated prose.
- Inline gear-description loss.
- Same-line magic-rider loss.
- Incorrect spell naming when a heading precedes the name.
- Unsafe HTML retention.

The independent reviewer additionally reproduced:

- ALL-CAPS monster-feature loss.
- Interleaved spell-description loss.
- Table pre-row instruction loss.
- `Weapons: none` becoming a literal weapon lookup.
- Unsafe class-feature HTML.

No module source files were modified during the review.
