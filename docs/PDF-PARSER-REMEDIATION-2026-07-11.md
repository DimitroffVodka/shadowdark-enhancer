# PDF Parser Review — Remediation Report

**Module:** Shadowdark Enhancer
**Date:** 2026-07-11
**Responds to:** [PDF-PARSER-CODE-REVIEW-2026-07-11.md](PDF-PARSER-CODE-REVIEW-2026-07-11.md)
**Status:** All 13 correctness findings fixed and verified; all 3 maintainability items addressed.

Before any fix landed, every review finding was independently re-verified:
the 9 pure-parser reproductions were re-run in Node against the actual
parsers, and the delete-before-create / FilePicker claims were confirmed
statically at the cited lines. Nothing in the review turned out to be
overstated.

| Work | Commit | Verification |
|---|---|---|
| Findings #1–#11 | `1e1dfdc` | 64 tests, live MCP probes |
| Finding #13 (FilePicker) | `2d65b37`, merged `1832348` | live, no deprecation warning |
| Finding #12 (class re-import) | `52cd6cc` | 69 tests, 3-run live probe |
| Maintainability items | *uncommitted (this working tree)* | 69 tests, live hub probe |

Test suite grew **43 → 69** (all passing). Lint debt **124 → 121** warnings,
0 errors. Each fix's regression tests use the review's own reproduction
inputs as fixtures (all invented text — no book content).

---

## High-priority findings

### #3 — Hexcrawl recognition bounded (`hex-parser.mjs`)

The recognizer ran first and had no gap limit, so three bare page numbers
anywhere in a dump could chain into a "run" and steal statblocks, items, and
tables from every later recognizer.

- **`MAX_ANCHOR_GAP = 2`** — consecutive anchors more than 2 non-anchored
  blocks apart terminate the run; the scan resumes at the breaking anchor so
  a real hex dump after stray numbers still claims.
- **Anchor evidence** (`anchorHasEvidence`) — a bare 3–4 digit block is a
  page number, not a hex. Evidence = same-line title or body lines inside the
  anchor block. A run claims only when ≥ half its anchors carry evidence.
- The review's repro (`101 / prose / 202 / prose / 303`) now claims
  **nothing**; a statblock sandwiched between page numbers reaches the
  monster recognizer intact.
- Tests: `test/hex-parser.test.mjs` (6) — repro, segmenter theft guard, gap
  split, evidence thresholds, MIN_RUN_UNITS.

### #2 — Non-destructive replace (`compendium-suite.mjs` + 3 importers)

All three importers deleted the existing document *before* attempting the
replacement create — a failed create lost both copies, and the UUID churn
broke every inbound `@UUID` link (the reason relink-tables exists).

- New **`replaceDocument(oldDoc, payload, pack)`**: same-type conflicts are
  updated **in place** (`recursive: false`, so the result matches a fresh
  create) with embedded rows swapped (Actor items / RollTable results / Item
  effects) — **UUID and inbound links survive**. Type mismatch or update
  failure falls back to create-first-then-delete; the original is never
  deleted until the replacement exists.
- Wired into `item-importer.mjs`, `monster-importer.mjs`,
  `table-importer.mjs`. Per-doc results carry `mode: "updated" | "recreated"`.
- Inverse check: no `delete()`-before-create pattern remains in
  `scripts/encounter/`.
- **Live-verified** (Foundry 14.364 / SD 4.0.6): item and table replace both
  returned the *same UUID* with content updated and results swapped
  (`[Rain, Sun] → [Snow, Hail, Fog]`).

### #1 — HTML safety at parse + commit

Pasted text was interpolated raw into markup, and `startsWith("<")` was a
trust decision. `<img src=x onerror=alert(1)>` persisted verbatim.

- **Parse-time (primary):** new pure `pdf-text-utils.mjs` —
  `escapeHtml` / `textToHtml`. Every parser (item, spell, class, hex) escapes
  pasted text before wrapping it; a leading `<` is content, never markup.
- **Commit-time (defense in depth):** `cleanImportHtml()` in
  compendium-suite (Foundry's `cleanHTML`) runs at the create/replace choke
  points in all four importers — this also covers preview-*edited* HTML.
- **Live-verified:** an `onerror` payload committed through the real importer
  stored as `<img src="x">` — handler stripped, safe markup kept.
- Tests: `test/html-safety.test.mjs` (5) — event attrs, script tags, leading
  `<`, per-parser payloads, hex linkify-after-escape.

### #4 — ALL-CAPS monster features (`statblock-parser.mjs`)

`AMPHIBIOUS` after a stat line became a detached skipped block; the monster
imported silently featureless.

- A no-stat block directly following a monster reattaches as that monster's
  feature caption — **guarded**: blocks carrying another recognizer's anchor
  (item cost/rider, spell tier, table rows) are never absorbed, and the
  caption must be short (≤ 4 words, no digits, ≤ 6 lines).
- `parseFeatures` turns a standalone caps line into a named feature
  (`Amphibious`) and puts a **review warning on the monster card**, since the
  reattach is heuristic.
- Frog King now imports with the Amphibious feature; a magic item after a
  monster still goes to the item recognizer (tested both ways).

---

## Medium-priority findings

### #5 — Gear descriptions on shared lines (`item-parser.mjs`)
Only the recognized cost/slot tokens are stripped from a line;
`"50 feet long, 5 gp, 1 slot"` keeps `50 feet long`. Name-line remainder text
(`"Rope, 5 gp, 1 slot, 50 feet of hemp"`) joins the description. The dead
`extraFromName` fragment was removed.

### #6 — Inline magic riders (`item-parser.mjs`)
`"Flame Ring Benefit. You resist fire."` splits at the rider keyword before
title-casing: name `Flame Ring`, benefit populated, item is magical again.

### #7 — Heading above a spell name (`spell-parser.mjs`)
The name is the *nearest* line above the Tier anchor, not `rawLines[0]`.
Ignored lead lines (`SPELLS`) are surfaced in a warning, never silently eaten.

### #8 — Interleaved spell prose (`spell-parser.mjs`)
Metadata lines are identified individually by index; the description is every
non-meta line after the Tier anchor **in source order** — prose between
`Range:` and `Duration:` survives.

### #9 — Defaulted spell metadata warns (`spell-parser.mjs`)
Missing duration/range still default (instant/close) but now emit explicit
`"…line missing — defaulted…; verify"` warnings on the preview card.

### #10 — Table pre-row instructions (`table-importer.mjs`)
Text before the first row (`"Roll once each morning"`) becomes the
RollTable's **description** (persisted via `buildTableData`) plus a warning
quoting the kept text. Live-verified on the created document.

### #11 — `Weapons: none` (`class-parser.mjs`)
`none` is stripped from the weapon list exactly as it always was from armor —
no more literal weapon lookup for "none".

### #12 — Class re-imports update stale content (`class-unit-importer.mjs`, commit `52cd6cc`)

Same-name/type documents were reused without comparison — corrected re-imports
reported success while keeping old content.

- Every match is **diffed against the corrected import** (`_staleFields`):
  identical → `reused`; differing → **updated in place** via
  `replaceDocument` (UUIDs and talent-table links survive).
- The comparison is one-sided and recursive (`_subsetEq`): only fields the
  import *defines* count, so schema-filled defaults (e.g.
  `spellcasting.spellsknown` on a non-caster) and user refoldering never
  false-positive. *(The false positive was caught live in probe run 2 and is
  pinned by a regression test.)*
- The talent RollTable is diffed row-by-row instead of reused on name match;
  the `classTalentTable` persistence repair now runs on every path (was gated
  on `!reused`).
- The report gains an **`updated`** bucket with per-doc changed-field labels;
  the hub prints `N created, N updated, N reused` plus a console summary of
  exactly what changed.
- **Live 3-run probe:** fresh import → 5 created; identical re-import →
  5 reused / 0 updated; corrected re-import → 3 updated with exact field
  labels, UUIDs stable, content verified corrected, table rewired. Probe
  content cleaned up.
- Tests: `test/class-reimport-diff.test.mjs` (5).

### #13 — Deprecated `FilePicker` (commit `2d65b37`, spawned session)

The review cited one file; the fix found **seven call sites across both
monster-art files** (`monster-token-art.mjs`, `token-art-catalog.mjs`) and
routed them through a shared `FilePickerCls` getter
(`foundry.applications.apps.FilePicker.implementation` with fallback, same
pattern as the existing `CompendiumCollection` namespacing). Live-verified:
mapping loads (494 entries) with no deprecation warning.

---

## Maintainability items (uncommitted in this working tree)

### Shared PDF-text helpers
- `splitRawBlocks` now lives **once** in `pdf-text-utils.mjs`; the five
  duplicate copies (dump-segmenter, item-parser, spell-parser, hex-parser,
  table-importer) are deleted. table-importer keeps its line-array shape as a
  one-line wrapper.
- Anchor regexes are exported from their **owning parsers** and imported by
  the segmenter: `RIDER_KW`/`COST_RE` (item-parser), `STAT_AC`/`STAT_LV`
  (statblock-parser). The segmenter's dead `ALL_CAPS_NAME_RE` and
  `blockHasStatLine` were deleted.
- Stale recognizer-order comments corrected to the real order:
  hex → spell → monster → item → table.

### Textarea preview fields
Item and spell description fields in `templates/importer-hub.hbs` are
multi-line `<textarea>`s (vertical-resize CSS), matching the class flavor
field's existing pattern. The change-event wiring needed no JS changes.

### Hub decoupling (bounded)
- The eight self-contained maintenance action bodies (~500 lines: migrate
  tables, bundle export/import, source PDFs, relink, fold legacy loot,
  backfill, migrate suite) moved **verbatim** to a new
  `importer-hub-maintenance.mjs`; the hub keeps one-line `_on*` delegates so
  the action map is unchanged. **Hub: 2761 → 2328 lines.**
- Six copy-pasted commit-report blocks → one `_commitSummary()` (which also
  reports #12's `updated` bucket); two duplicate HTML-wrap sites →
  one `_wrapEditedHtml()`.
- Deliberately stopped short of the review's full per-content-controller
  split: that would churn hundreds of working preview-state lines for
  structure alone. This captures the coupling wins at low regression risk.
- CLAUDE.md's hub section updated (line count, extraction note, drift
  warning on inline line numbers).

---

## Verification summary

Per the module's verification discipline, every claim above was backed by
tool output at the time it was made (session transcript); highlights:

- **Unit tests:** `npm test` → 69 pass / 0 fail (was 43). New suites:
  `hex-parser` (6), `parser-review-regressions` (10), `html-safety` (5),
  `class-reimport-diff` (5).
- **Repo checks:** `./verify.sh` → `verify: OK`; `node --check` clean on all
  touched files; `npm run lint` → 0 errors, 121 warnings (down from 124, no
  new warnings introduced).
- **Live (Foundry 14.364, Shadowdark 4.0.6, via MCP bridge):**
  - Item + table replace preserve UUID (`mode: "updated"`), content updated,
    embedded results swapped.
  - XSS payload sanitized at commit (`onerror` stripped).
  - Class 3-run probe: create / identical-reuse / corrected-update all
    behave correctly with stable UUIDs.
  - Hub opens post-refactor; real paste→parse renders textareas; a change
    event through the actual wiring updates the draft; `segmentDump` claims
    identically after the splitter centralization (1 monster / 1 item /
    1 spell / 0 skipped); all 8 maintenance delegates resolve.
  - **0 console errors** after every phase; all probe documents and folders
    deleted afterward.

## Not done / open

- The review's full **per-content preview-controller split** of the hub
  (judged high regression risk for structural benefit — the bounded
  extraction above addresses the worst of the coupling).
- Pre-existing lint debt (~121 warnings, mostly unused `_` catches and
  `no-await-in-loop` disables) — untouched except where my changes brushed it.
- `_descHtml` in `encounter-creator.mjs` still passes through `<`-prefixed
  strings, but the monster commit choke point (`cleanImportHtml`) now
  sanitizes everything it feeds.
