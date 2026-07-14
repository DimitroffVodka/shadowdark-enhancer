# Technical Review: PDF Import Session Review

**Document reviewed:** [`pdf-import-review.html`](./pdf-import-review.html)  
**Companion source:** [`pdf-import-review.md`](./pdf-import-review.md)  
**Review date:** 2026-07-13  
**Reviewer:** Hermes Agent, with an independent reviewer pass  
**Repository:** `shadowdark-enhancer`  
**Review scope:** factual accuracy, reproducibility, architectural conclusions, working-tree claims, live Foundry state, automated verification, accessibility, and desktop/mobile rendering.

## Executive summary

The session review is visually polished, easy to scan, and directionally useful. Its broad account of the PDF extraction work is consistent with the two cited commits, and several headline facts were confirmed against the live Foundry world:

- Foundry is running version 14.364 with Shadowdark 4.0.6.
- The `Shadowdark Source PDFs` journal contains eight PDF pages: Core Rulebook, Western Reaches, and Cursed Scrolls 1–6.
- The live Manage tree contains 203 entries, of which 184 have page citations and 19 do not.
- Commits `b7253ad` and `ed5fae5` exist and broadly match their descriptions.
- The repository test suite passes 101 tests.

However, the document should not yet be treated as the authoritative technical audit. Its central coverage result—103 of 141 tables clean, with 38 requiring review—cannot be independently reproduced from the repository. Several sections also contradict either the current implementation or another part of the document.

The most important revisions are:

1. Preserve the coverage sweep as a reproducible artifact with per-entry results.
2. Correct the monster coverage description.
3. Resolve the Carousing contradiction and Bucket A shape inconsistencies.
4. Rewrite the router section around the actual data schema and existing dispatch behavior.
5. Add focused regression tests for the uncommitted parser and class-importer changes.

## Verification performed

The review included:

- Reading the complete 483-line HTML document and its Markdown companion.
- Checking current Git status, history, commit contents, and working-tree diffs.
- Comparing claims with the PDF extractor, table shapes, table importer, Importer Hub, class importer, class overlays, Manage tree, and content manifests.
- Running `npm run test` and `npm run lint`.
- Querying the live Foundry world for its version, system version, PDF journal, and Manage-tree counts.
- Rendering the HTML in Chromium at desktop and 390-pixel mobile widths.
- Calculating contrast ratios for the document’s secondary text colors.

### Verification results

- `npm run test`: **101 passed, 0 failed**.
- `npm run lint`: **0 errors, 125 warnings**.
- Live Foundry: **14.364**.
- Live Shadowdark system: **4.0.6**.
- Registered source PDFs: **8**.
- Live Manage entries: **203 total; 184 page-cited; 19 uncited**.
- Desktop/mobile rendering: no material clipping or horizontal overflow found.

## Prioritized findings

### 1. High — The central coverage audit is not reproducible

**Review document references:** HTML lines 201–203, 273, 285, 290, 296–305, 315–348, and 478.

The document presents exact results:

- 184 entries swept.
- 103 of 141 tables clean.
- 38 tables requiring review.
- Zero tables unparseable.

No sweep script, raw result file, dated artifact, per-table failure list, or regression fixture is present in the repository. Searches found these figures only in the HTML and Markdown review documents.

The existing table-shape tests explicitly use synthetic data and state that real PDFs are verified live rather than from retained fixtures. The passing 101-test suite therefore does not independently establish the 103/141 result.

This is especially important because the review correctly warns that extractor changes have a high blast radius and should be checked against the full sweep. Without a durable baseline, a later re-sweep cannot reliably identify which entries improved or regressed.

**Recommended revision:**

- Save a machine-readable result file, such as `docs/pdf-import-sweep-2026-07-13.json` or CSV.
- Record each entry’s stable identity, type, source, page range, parser route, shape or recognizer selected, parse status, warnings, and triage bucket.
- Include the command, script, or exact live procedure used to run the sweep.
- Include the Foundry, system, module, and source-PDF versions.
- Link the artifact from the session review.
- Make preserving this baseline the first recommendation, before changing the parser or router.

### 2. High — The monster coverage row materially misstates the live census

**Review document references:** HTML lines 245, 303, and 406.

The coverage table says:

> 5 gaps, no page cite

The live Manage tree does not contain five individual missing-monster rows. It contains five bestiary bundle import rows generated for CS1–CS5:

| Source | Catalogued monsters | Currently present | Currently missing |
|---|---:|---:|---:|
| CS1 | 14 | 0 | 14 |
| CS2 | 14 | 0 | 14 |
| CS3 | 12 | 0 | 12 |
| CS4 | 19 | 4 | 15 |
| CS5 | 5 | 0 | 5 |
| **Total** | **64** | **4** | **60** |

Calling these “5 gaps” can be read as only five missing monsters, materially understating the remaining content. The five rows are bulk-import routes, not five monster records.

**Recommended wording:**

> Five bestiary bundle rows cover 64 catalogued monsters; 60 are currently missing. These bundles have no fixed page citation and use source-aware manual page-range extraction.

The document should also distinguish bestiary bundle rows from any named monster-census gaps, because they are different workflows.

### 3. High — The document contradicts itself about Carousing Outcome

**Review document references:** HTML lines 335–336 and 366.

The triage section says Carousing Outcome has a shape but still warns and needs tuning. The technical-findings section says carousing only looks broken under the generic parser and its deterministic shape handles it cleanly.

Both statements cannot describe the same audited state. The current implementation does contain Carousing shapes in `scripts/encounter/table-shapes.mjs`, but the report does not identify which Carousing table, source, or warning remains problematic.

**Recommended revision:**

List each relevant table explicitly—for example, Core Carousing Outcome, Core Carousing Event, Western Reaches Carousing Benefit, or Cursed Scroll 6 Carousing Outcome—and state whether each one:

- Has a shape.
- Parses without warnings.
- Parses with non-blocking warnings.
- Still needs shape or extraction tuning.

### 4. High — Bucket A conflicts with shape recipes already present in the code

**Review document references:** HTML lines 327–330.

Bucket A includes shop, party, magic-item, and NPC generators under the root cause “No shape recipe.” Current code already defines shapes for:

- `Shop Generator`
- `Party Name`
- `Magic Item Idea Generator`
- `NPC Qualities`

See `scripts/encounter/table-shapes.mjs:64-70`.

The bucket might mean differently named sub-generators, but those names are not given. As written, the root-cause classification conflicts with the implementation and does not support the approximate count of 20.

**Recommended revision:**

Replace the prose bucket with an exact per-table list. For every table, record its current shape resolution, inferred formula, warnings, and actual failure cause. Do not classify a table as lacking a shape unless `shapeForName()` fails for the exact seeded name used by the real import path.

### 5. High — The router proposal uses the wrong entry schema and overstates the missing architecture

**Review document references:** HTML lines 381–390 and 428–434.

The document says Manage entries carry:

```text
{type, name, source, page}
```

Actual Manage entries use fields equivalent to:

```text
{name, type, src, pages}
```

See:

- `scripts/encounter/manage-tree.mjs:10-14`
- `scripts/encounter/manage-tree.mjs:72-80`
- `scripts/encounter/importer-hub-app.mjs:2412-2475`

The importer also already performs substantial explicit routing:

- Seed types map to specific importer modes.
- Classes and spell lists open dedicated workspaces.
- Shape lookup runs before generic parsing.
- The competing segmenter runs only when the mode is `auto`.

A registry could still improve maintainability and remove name-based shape resolution, but it would mainly consolidate existing dispatch. It would not newly demote the segmenter to a freeform-only fallback; that is already largely its role.

The proposed “stable identity” is also undefined. A tuple containing display name and page citation is not necessarily stable: names can be corrected, pages can change between printings, and the same name can appear in multiple sources.

**Recommended revision:**

- Describe this as registry consolidation rather than a completely new router.
- Define a persistent `contentId` or similarly stable key.
- Specify how existing manifest entries receive IDs.
- Specify compatibility behavior for old entries without IDs.
- Use exact lookup for known seeded content.
- Retain the current type-specific and freeform fallback behavior.

### 6. Medium — The “fuzzy-suffix” description overstates the matcher’s ambiguity

**Review document references:** HTML lines 386, 389, and 428–429.

`shapeForName()` does not perform general fuzzy matching. It accepts:

- Exact normalized equality.
- A name ending with `- <shape name>`.
- A name ending with `: <shape name>`.

See `scripts/encounter/table-shapes.mjs:73-81`.

Collision risk exists, especially if generic shape names are later added, but “fuzzy” implies a broader similarity matcher than the code actually uses. The `Type` example is hypothetical; no current `Type` shape exists.

**Recommended wording:**

> The current matcher supports exact names plus delimiter-aware source prefixes. A future generic shape name could still collide with unrelated prefixed names, so known content should ultimately use stable IDs.

### 7. Medium — Two page-number failure modes are described as one

**Review document references:** HTML lines 251–252, 327–330, 347–349, and 421–425.

“What we built” says the empty-row filter now drops page numbers misread as rows. The recommendations then identify stopping page numbers from being read as row ranges as the next highest-priority task.

These appear to be different failures:

1. A bare page number becomes a parsed row with no text.
2. A page number contaminates formula or range inference, producing formulas such as `1d284`.

The document does not explain that distinction, making the same problem appear both fixed and unresolved.

**Recommended revision:**

Name the two bugs separately and state exactly which one the current empty-row filter fixes. Include before/after examples and identify the parser stage responsible for each.

### 8. Medium — The range auto-repair is broader and less tested than the review implies

**Review document references:** HTML lines 251–252, 363, 403, and 423–424.

The Dwarf Trinket source typo may have been manually confirmed, but the implementation is not specific to that table. `repairSharedStartRanges()` rewrites every adjacent pair where the second range shares the first range’s lower bound and has a greater upper bound.

That is a general heuristic affecting arbitrary imported tables. No dedicated regression tests currently cover:

- The intended `21-22`, `21-24` repair.
- Legitimate or malformed shared-start ranges that must remain unchanged.
- Cases where the inferred new lower bound would exceed the current upper bound.
- Preservation of formulas and visible repair notes.

The phrase “confirmed independently” also has no retained citation or evidence in the repository.

**Recommended revision:**

Distinguish clearly between:

- The observed source-book typo.
- The generalized repair heuristic.
- Its potential false positives.
- The absent automated coverage.

Add focused positive and negative tests before committing the heuristic.

### 9. Medium — The uncommitted work lacks focused automated coverage

**Review document references:** HTML lines 251–266 and 478.

The full repository suite passes, but there are no focused tests for several new paths described as completed:

- Shared-start range repair.
- Empty-row cleanup.
- Auto-extract render ordering.
- Class title-page slicing.
- Editable talent, extra-table, and spells-known grids.
- Title-warning-to-row matching.
- PDF rotation equivalence.
- The full 184-entry sweep.

Live verification is valuable, but it should not be presented as equivalent to retained regression coverage.

**Recommended revision:**

Add a verification block that clearly separates:

- Automated repository tests.
- Manual live Foundry checks.
- Coverage-sweep results.
- Known paths that remain untested.

Add targeted tests before committing the proposed logical batches.

### 10. Medium — “2 + 6 commits + open changesets” is ambiguous

**Review document references:** HTML lines 204, 443–445, and 454–470.

The “2 + 6” statistic is not mapped to Git objects or clearly defined work units. Current repository state includes:

- Two relevant landed commits.
- Ten modified tracked files.
- Three untracked files, including the two session-review documents.
- Seven files containing changes attributed in the review to this session.
- Three proposed logical commit batches.

The “ours” versus “not ours” attribution may reflect the session history, but Git status alone cannot verify that ownership without a baseline commit, patch, stash, or timestamp.

**Recommended revision:**

Replace the tile with something directly verifiable, such as:

> 2 commits landed · 3 proposed commit batches pending

If preserving file ownership notes, identify the baseline used to separate pre-existing changes from session changes.

### 11. Medium — The privacy wording is literally inaccurate

**Review document references:** HTML lines 224 and 362.

The document says “nothing uploaded.” In the actual workflow, PDFs are uploaded or otherwise placed in the local Foundry data environment, registered in a journal, and served to the browser.

The intended privacy claim is that the documents are not sent to an external extraction service.

**Recommended wording:**

> Extraction runs locally using Foundry’s bundled PDF.js. Nothing is sent to an external service, and the module bundles no book content.

### 12. Medium — Verification status should be reported explicitly

**Review document references:** HTML lines 273 and 478.

The footer says the work was “verified live,” but the document does not record test commands, test counts, lint status, console status, timestamp, or which features were checked manually.

Current checks found:

- 101 automated tests passing.
- Lint completing with zero errors and 125 warnings.
- Relevant uncommitted changes without direct regression tests.
- Foundry 14.364 and Shadowdark 4.0.6 live.

**Recommended revision:**

Add a verification section containing exact commands and outcomes, plus a checklist of live workflows exercised. Avoid using “verified” as a blanket description when some claims depend on unretained manual checks.

### 13. Low — Wyrdling’s page range is a code change, not world state

**Review document references:** HTML lines 454–455 and 471–474.

“All eight source PDFs registered” is genuine world state and was confirmed in the live `Shadowdark Source PDFs` journal.

“Wyrdling overlay page range set to 72–73” is an uncommitted source-code edit in `scripts/encounter/class-overlays.mjs`, not a Foundry-world mutation.

**Recommended revision:**

Move the Wyrdling item into the “Uncommitted” code card and leave the PDF journal registration under “World changes.”

### 14. Low — Small secondary text fails WCAG AA contrast

**Review document references:** CSS around HTML lines 13–14, 37–38, 97–98, 114, and 170–174.

The `--faint` color is used for small metadata, tile subtitles, recommendation tags, and the footer. Calculated contrast ratios are:

| Theme and background | Contrast ratio |
|---|---:|
| Light, page background | 2.75:1 |
| Light, card surface | 3.06:1 |
| Dark, page background | 4.03:1 |
| Dark, card surface | 3.67:1 |

These are below the WCAG AA requirement of 4.5:1 for normal-sized text.

**Recommended revision:**

Use `--muted` for this text or strengthen `--faint` until it reaches at least 4.5:1 against every background on which it appears.

### 15. Low — Tables and page landmarks need better accessible semantics

**Review document references:** HTML lines 184–186, 293–306, 320–346, and 480–482.

The page has no `<main>` landmark. The two tables lack captions and their header cells omit `scope="col"`. The horizontal-scroll wrappers also have no accessible name or keyboard focus.

**Recommended revision:**

- Wrap the primary content in `<main>`.
- Add a descriptive `<caption>` to each table.
- Add `scope="col"` to column headers.
- Give scrollable table wrappers `tabindex="0"` and an accessible label.

## Presentation assessment

The presentation is one of the document’s strongest aspects:

- Clear hierarchy and section numbering.
- Strong visual distinction between committed, uncommitted, clean, warning, and neutral states.
- Good use of cards and tables to make a long technical review scannable.
- No material desktop or mobile overflow found in Chromium rendering.
- Responsive cards stack correctly at mobile width.
- The page works in both light and dark themes.

The accessibility issues above are fixable without changing the overall design.

## Proposed revision order

1. **Create and retain the sweep artifact.** Do this before further parser work so the current 103/141 claim becomes a durable baseline.
2. **Correct factual inconsistencies.** Fix monster coverage, Carousing status, Bucket A shape claims, privacy wording, and the Wyrdling classification.
3. **Clarify parser defects.** Separate empty page-number rows from formula/range pollution and document exactly what remains unresolved.
4. **Add focused tests.** Cover range repair, page-number filtering, class title slicing, auto-extract ordering, and editable preview behavior.
5. **Reframe the router recommendation.** Define a stable `contentId` and describe registry consolidation around the routing already present.
6. **Make verification explicit.** Record automated, live, and sweep checks separately.
7. **Address accessibility.** Improve faint-text contrast and add semantic landmarks and table metadata.

## Recommended disposition

**Presentation:** approve.  
**Technical direction:** approve with revisions.  
**Use as authoritative audit:** not yet.

The document will be suitable as the authoritative PDF-import review once its exact coverage results are backed by a retained per-entry artifact and the factual contradictions above are resolved.

---

## Follow-up review of the revised document

**Follow-up date:** 2026-07-13  
**Revised document checked:** `docs/pdf-import-review.html`, modified 2026-07-13 11:43 CDT

### Follow-up disposition

The revision addresses nearly all of the original review:

- A sweep probe and retained JSON artifact now exist.
- Monster bundle coverage is accurately explained as 64 catalogued / 60 missing.
- Carousing Event and Carousing Outcome are distinguished consistently.
- Bucket A now distinguishes existing generator-level shapes from separately named unshaped columns.
- The router section uses the real `{ name, type, src, pages }` schema and correctly frames the proposal as registry consolidation.
- The matcher is accurately described as exact plus delimiter-aware prefixes, not generally fuzzy.
- The two page-number defects are separated.
- Privacy wording now says nothing is sent to an external service.
- Three focused parser regressions were added; the suite now passes 104 tests.
- Verification results, Wyrdling ownership, contrast, table semantics, and the `<main>` landmark were corrected.
- Revised desktop and 390-pixel mobile renders show no material layout regressions.

The revised document is substantially stronger. Five data-integrity corrections remain before it should be called the authoritative audit.

### Follow-up finding A — Source scope for the 38 review tables is still incorrect

**Revised HTML:** line 223.

The section says all 38 review tables come from Core Rulebook / Western Reaches. The retained JSON reports:

| Source | Review tables |
|---|---:|
| CORE | 35 |
| WR | 1 |
| CS2 | 1 |
| CS3 | 1 |

The two Cursed Scroll records are:

- `CS2::Cursed Scroll 2 p26: Enduring Wounds`
- `CS3::Cursed Scroll 3 p16: Nord Names`

The Bucket B prose already mentions Nord Names, so this is a heading/subtitle error rather than an artifact error.

**Recommended correction:**

> 35 from Core Rulebook, 1 from Western Reaches, 1 from Cursed Scroll 2, and 1 from Cursed Scroll 3. Of the 38, 37 have no matching shape; CORE Carousing Outcome has a shape but still warns.

### Follow-up finding B — The retained JSON contains 203 records, not 184

**Revised HTML:** lines 315 and 346; related wording appears in the Markdown companion.

`docs/pdf-import-sweep-2026-07-13.json` contains:

- 203 total `records[]` entries.
- 184 page-cited entries that were extracted/parsed or routed.
- 19 `skip-no-page` entries.

Describing the file as “per-entry JSON (184 entries)” is therefore inaccurate. The artifact is better than that wording suggests because it retains the complete 203-entry census.

**Recommended wording:**

> Retained per-entry JSON: 203 Manage records, including 184 page-cited entries swept and 19 uncited entries recorded as skipped.

### Follow-up finding C — Artifact record IDs are not unique

**Probe:** `dev/probes/manage-coverage-sweep.mjs:62`.

The probe currently builds IDs as `${src}::${name}`. The retained artifact contains two records with the same ID, `WR::Necromancer`:

- A `Class` record on page 52.
- A `SpellList` record on page 122.

Duplicate IDs make record-by-record diffs ambiguous and prevent the field from serving as the stable comparison key the audit needs.

**Recommended correction:**

Use an existing persistent `contentId` when one becomes available. Until then, use a unique audit key containing at least type, source, name, and page/list identity, for example:

```text
Class::WR::Necromancer::52
SpellList::WR::Necromancer::122
```

Add a probe assertion that fails if any generated IDs are duplicated.

### Follow-up finding D — The current probe does not reproduce the artifact metadata exactly

**Probe:** `dev/probes/manage-coverage-sweep.mjs:34-40`.  
**Artifact:** `docs/pdf-import-sweep-2026-07-13.json:2-18`.

The retained JSON includes `meta.method`, but the current probe's `meta` object does not assign that field. A re-run followed by a direct JSON diff would therefore remove the method description even when parser behavior is unchanged.

The probe header also says it “produces” the file, while the implementation returns an object that must be saved manually from the browser/MCP result. That workflow is valid, but the instructions should state the manual serialization step precisely.

**Recommended correction:**

- Add the same `method` value to the probe's `meta` object.
- Document the exact command or MCP/save procedure used to serialize the returned object.
- Optionally add a small wrapper that writes canonical, consistently ordered JSON.

### Follow-up finding E — The sweep probe is locally excluded from Git

The document describes `dev/probes/manage-coverage-sweep.mjs` as a newly retained file. It currently does not appear in `git status` because this repository's local `.git/info/exclude` contains:

```text
dev/
```

The probe is also not already tracked. Unless it is force-added or moved to a tracked location, the HTML and Markdown will link to a file that exists only in this checkout and will not be included in a normal commit.

**Recommended correction:**

- Move the durable probe to a tracked project location such as `scripts/dev/`, `tools/`, or another agreed directory; or explicitly force-add it after confirming that `dev/` is intentionally local-only.
- Verify the probe appears in `git status` and the final commit before calling the audit reproducible.

### Follow-up verification

- `npm run test`: **104 passed, 0 failed**.
- `npm run lint`: **0 errors, 125 warnings**.
- `./verify.sh`: **OK**.
- Sweep JSON parses successfully and its aggregate block matches all 203 records.
- Table status counts match the review: 103 clean, 38 review, 8 uncited.
- Of the 38 review tables, 37 are unshaped and CORE Carousing Outcome is the sole shaped warning case.
- Updated faint-text contrast ratios range from **5.15:1 to 6.39:1**, passing WCAG AA for normal text.
- Revised desktop and mobile Chromium renders show no clipping or horizontal overflow.

### Updated recommendation

**Presentation:** approve.  
**Technical direction:** approve.  
**Use as authoritative audit:** approve after findings A–E are corrected and the sweep artifact is regenerated from the corrected, tracked probe.

---

## Final errata verification

**Verified:** 2026-07-13  
**Source reviewed:** `docs/pdf-import-review.md` and its synchronized HTML companion

Claude's same-day errata pass resolves follow-up findings A–E:

- **A resolved:** §03 now reports 35 CORE, 1 WR, 1 CS2, and 1 CS3 review table.
- **B resolved:** verification now describes the artifact as 203 records: 184 page-cited swept and 19 uncited skipped.
- **C resolved:** audit IDs now include type, source, name, and pages. The regenerated artifact has no duplicates; the two Necromancer records are `Class::WR::Necromancer::52` and `SpellList::WR::Necromancer::122`.
- **D resolved:** the tracked probe now emits `meta.method`, documents an exact console/MCP procedure, supports `{ save: true }`, and serializes the artifact itself.
- **E resolved:** the probe moved from the locally excluded `dev/` tree to `docs/manage-coverage-sweep.mjs`; it now appears as an ordinary untracked file ready to add.

Additional checks:

- The regenerated JSON has `pass: true` and `meta.duplicateIds: []`.
- All local HTML links resolve to existing files.
- `node --check docs/manage-coverage-sweep.mjs` passes.
- Final desktop and 390-pixel mobile Chromium renders complete successfully.

### Final disposition

**Presentation:** approved.  
**Technical direction:** approved.  
**Use as authoritative audit:** approved, provided the review Markdown/HTML, sweep JSON, and tracked probe are committed together.
