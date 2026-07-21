/**
 * Magic base-recipe BUNDLE import gate — synthetic fixtures only (NEVER Core
 * book content). Exercises the all-or-nothing persistence contract the Importer
 * Hub relies on: parsed hub-shaped table drafts are adapted to the runtime
 * descriptor shape and matched atomically. A valid full set yields candidate
 * payloads (create everything); any missing / invalid / duplicate child yields
 * NOTHING. The same pure gate backs both Commit Tables and Commit All.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MAGIC_SET_DEFS, matchBundleTables } from "../scripts/magic-forge/magic-table-runtime.mjs";
import { parseStackedTables, blankSeparateTables, dedupExactTables } from "../scripts/importer/tables/table-importer.mjs";

const WB = MAGIC_SET_DEFS["magic-weapon-base"];
const AB = MAGIC_SET_DEFS["magic-armor-base"];
const WBEN = MAGIC_SET_DEFS["magic-weapon-benefit"];
const PERS = MAGIC_SET_DEFS["magic-personality-detail"];

/**
 * Mirror of ImporterHubApp._magicDraftDescriptor: adapt a parsed hub table
 * draft ({name, formula, rows:[{min,max,text}]}) to the runtime descriptor
 * shape, synthesizing stable per-row ids (Foundry assigns real ones at create).
 */
function hubDraftToDescriptor(d) {
  return {
    manifestId: d?.manifestId ?? null,
    formula: d?.formula ?? "",
    results: (Array.isArray(d?.rows) ? d.rows : []).map((r, i) => ({ id: `row-${i}`, range: [r.min, r.max], text: r.text })),
  };
}

/** Partition [lo,hi] into n contiguous ranges (gapless, complete). */
function coverRanges(lo, hi, n) {
  const faces = hi - lo + 1, base = Math.floor(faces / n), rem = faces % n;
  const out = []; let cur = lo;
  for (let i = 0; i < n; i++) { const size = base + (i < rem ? 1 : 0); out.push([cur, cur + size - 1]); cur += size; }
  return out;
}

/** A hub-shaped parsed draft (rows, no ids/manifestId) for a child requirement. */
function hubDraft(child, { textPrefix = "row" } = {}) {
  const rows = coverRanges(child.domain[0], child.domain[1], child.expectedCount)
    .map(([min, max], i) => ({ min, max, text: `${textPrefix} ${child.role} ${i + 1}` }));
  return { name: `parsed ${child.role}`, formula: child.formula, rows };
}

function gate(def, drafts) {
  return matchBundleTables(def, drafts.map(hubDraftToDescriptor));
}

/* -- valid full set → candidate payloads (structural, no ids) -------------- */

test("all children present + valid → ok, payloads map back to their drafts", () => {
  const drafts = WB.children.map((c) => hubDraft(c));
  const res = gate(WB, drafts);
  assert.equal(res.ok, true);
  assert.equal(res.payloads.length, 3);
  // Each payload's sourceIndex points at the draft the hub must stamp.
  for (const p of res.payloads) {
    assert.equal(typeof p.sourceIndex, "number");
    assert.ok(drafts[p.sourceIndex], "sourceIndex resolves to a draft");
    assert.ok(p.manifestId && p.name, "payload carries identity to stamp");
  }
  assert.deepEqual(res.payloads.map((p) => p.manifestId).sort(),
    ["core-weapon-bonus", "core-weapon-feature", "core-weapon-type"]);
});

test("armor base recipe distinguishes 2d6×5 type from 2d6×4 bonus structurally", () => {
  const res = gate(AB, AB.children.map((c) => hubDraft(c)));
  assert.equal(res.ok, true);
  assert.equal(res.payloads.length, 3);
});

/* -- missing / invalid / duplicate → create NOTHING ------------------------ */

test("missing middle child → ok:false, no payloads", () => {
  const res = gate(WB, [hubDraft(WB.children[0]), hubDraft(WB.children[2])]);
  assert.equal(res.ok, false);
  assert.equal(res.payloads.length, 0);
  assert.ok(res.errors.some((e) => e.code === "missing"));
});

test("an invalid child (short by a row) → ok:false, no payloads", () => {
  const drafts = WB.children.map((c) => hubDraft(c));
  drafts[1].rows = drafts[1].rows.slice(0, drafts[1].rows.length - 1); // bonus incomplete
  const res = gate(WB, drafts);
  assert.equal(res.ok, false);
  assert.equal(res.payloads.length, 0);
});

test("a duplicate-fitting child → ok:false, no payloads", () => {
  // two feature-shaped drafts + a bonus; the type slot goes unfilled.
  const drafts = [hubDraft(WB.children[2]), hubDraft(WB.children[2]), hubDraft(WB.children[1])];
  const res = gate(WB, drafts);
  assert.equal(res.ok, false);
  assert.equal(res.payloads.length, 0);
});

/* -- metamorphic parser probes --------------------------------------------- */

test("each single table alone never satisfies the whole set", () => {
  for (const c of WB.children) assert.equal(gate(WB, [hubDraft(c)]).ok, false);
});

test("two of three present still fails (all-or-nothing)", () => {
  assert.equal(gate(WB, [hubDraft(WB.children[0]), hubDraft(WB.children[1])]).ok, false);
});

test("blank/noise drafts interleaved are ignored when the three real ones match", () => {
  const noise = { name: "d100 Details", formula: "1d6", rows: [{ min: 1, max: 3, text: "a" }, { min: 4, max: 6, text: "b" }] };
  const blank = { name: "", formula: "", rows: [] };
  const drafts = [noise, WB.children[0], blank, WB.children[1], WB.children[2]].map((x) => x.rows ? x : hubDraft(x));
  const res = gate(WB, drafts);
  assert.equal(res.ok, true);
  assert.equal(res.payloads.length, 3);
});

test("draft order does not matter — cardinality/coverage drive the match", () => {
  const shuffled = [WB.children[2], WB.children[0], WB.children[1]].map((c) => hubDraft(c));
  const res = gate(WB, shuffled);
  assert.equal(res.ok, true);
  assert.deepEqual(res.payloads.map((p) => p.manifestId).sort(),
    ["core-weapon-bonus", "core-weapon-feature", "core-weapon-type"]);
});

test("a wrong-formula draft fails the set closed (never persists garbage)", () => {
  const drafts = WB.children.map((c) => hubDraft(c));
  drafts[0].formula = "1d10"; // weapon-type must be 1d20
  const res = gate(WB, drafts);
  assert.equal(res.ok, false);
  assert.equal(res.payloads.length, 0);
});

/* -- bundle isolation: only matched children are committed ------------------ */

test("isolation: extraneous page tables are excluded from the committed set", () => {
  // A page that also carries two unrelated tables alongside the 3 bundle children.
  const extra1 = { name: "Unrelated A", formula: "1d8", rows: [{ min: 1, max: 4, text: "x" }, { min: 5, max: 8, text: "y" }] };
  const extra2 = { name: "Unrelated B", formula: "1d4", rows: [{ min: 1, max: 2, text: "p" }, { min: 3, max: 4, text: "q" }] };
  const drafts = [extra1, WB.children[0], WB.children[1], extra2, WB.children[2]].map((x) => x.rows ? x : hubDraft(x));
  const res = gate(WB, drafts);
  assert.equal(res.ok, true);
  assert.equal(res.payloads.length, 3);
  // The hub keeps ONLY these matched drafts (by sourceIndex); the extras (indices
  // 0 and 3) are never in the committed set.
  const matchedIdx = res.payloads.map((p) => p.sourceIndex).sort();
  assert.ok(!matchedIdx.includes(0), "extra1 excluded");
  assert.ok(!matchedIdx.includes(3), "extra2 excluded");
  const committed = matchedIdx.map((i) => drafts[i].name ?? drafts[i]);
  assert.ok(!committed.includes("Unrelated A") && !committed.includes("Unrelated B"), "no extraneous table committed");
});

/* -- full-page PARSE ADAPTER (the live-Foundry bug) ------------------------- */
/* A grabbed Core page stacks several sections with NO blank lines between them;
 * the parse adapter must split the WHOLE page into all child drafts + extras,
 * not just the first section. Synthetic fixtures only — invented result text. */

const dieOf = (formula) => formula.replace(/^1(d\d+)$/, "$1"); // 1d20→d20, 2d6→2d6
function sectionText(title, formula, lo, hi, n) {
  return [title, `${dieOf(formula)} Result`,
    ...coverRanges(lo, hi, n).map(([a, b], i) => `${a === b ? a : `${a}-${b}`} ${title.replace(/\s+/g, "")}_${i + 1}`)].join("\n");
}
function stackedPage(def, { extras = true } = {}) {
  const parts = ["PAGE HEADER 292", ...def.children.map((c) => sectionText(c.label, c.formula, c.domain[0], c.domain[1], c.expectedCount))];
  if (extras) {
    parts.push("Some trailing narrative prose that is not a table row.");
    parts.push(sectionText("Unrelated Widget List", "1d6", 1, 6, 3));
    parts.push("292"); // page footer number
  }
  return parts.join("\n");
}
const parseAdapter = (def, page) => matchBundleTables(def, parseStackedTables(page).map(hubDraftToDescriptor));

test("parse adapter: full stacked page (no blank lines) → all 3 weapon children", () => {
  const drafts = parseStackedTables(stackedPage(WB));
  // Type/Bonus/Feature + the unrelated extra all become separate drafts.
  assert.ok(drafts.length >= 3, `expected ≥3 drafts, got ${drafts.length}`);
  const res = matchBundleTables(WB, drafts.map(hubDraftToDescriptor));
  assert.equal(res.ok, true, `bundle should match: ${JSON.stringify(res.errors)}`);
  assert.deepEqual(res.payloads.map((p) => p.manifestId).sort(),
    ["core-weapon-bonus", "core-weapon-feature", "core-weapon-type"]);
  // The extra widget table is present in the drafts but NOT in the matched set.
  assert.ok(drafts.some((d) => /widget/i.test(d.name ?? "")), "extra table stays in the preview");
  assert.equal(res.payloads.length, 3, "only the 3 children commit");
});

test("parse adapter: full stacked page → all 3 armor children (2d6 type/bonus disambiguated)", () => {
  const res = parseAdapter(AB, stackedPage(AB));
  assert.equal(res.ok, true, `armor bundle should match: ${JSON.stringify(res.errors)}`);
  assert.deepEqual(res.payloads.map((p) => p.manifestId).sort(),
    ["core-armor-bonus", "core-armor-feature", "core-armor-type"]);
});

test("parse adapter: a MISSING child section stays blocked (fail-closed)", () => {
  // Drop the Bonus section from the page entirely.
  const page = ["HDR",
    sectionText(WB.children[0].label, WB.children[0].formula, 1, 20, 16),
    sectionText(WB.children[2].label, WB.children[2].formula, 1, 20, 20)].join("\n");
  const res = parseAdapter(WB, page);
  assert.equal(res.ok, false);
  assert.equal(res.payloads.length, 0);
  assert.ok(res.errors.some((e) => e.code === "missing"));
});

test("parse adapter: a MALFORMED child (wrong row count) stays blocked", () => {
  const page = ["HDR",
    sectionText(WB.children[0].label, WB.children[0].formula, 1, 20, 16),
    sectionText(WB.children[1].label, WB.children[1].formula, 2, 12, 3), // bonus 3 rows, expected 4
    sectionText(WB.children[2].label, WB.children[2].formula, 1, 20, 20)].join("\n");
  const res = parseAdapter(WB, page);
  assert.equal(res.ok, false);
  assert.equal(res.payloads.length, 0);
});

test("blankSeparateTables inserts a break before each new table title; idempotent", () => {
  const raw = "Weapon Type\nd20 Result\n1 a\n2 b\nWeapon Bonus\n2d6 Result\n2-12 c";
  const once = blankSeparateTables(raw);
  assert.match(once, /1 a\n2 b\n\nWeapon Bonus/, "break inserted before the 2nd table's title");
  assert.equal(blankSeparateTables(once), once, "idempotent on already-separated text");
});

/* -- routing invariant: riders & personality are NOT bundles ---------------- */

test("rider and perTable sets are single-shape (not routed through the bundle parser)", () => {
  // _isMagicBundleSeed() keys off exactly these def properties.
  assert.equal(WBEN.children.length, 1, "weapon-benefit is a single-table rider");
  assert.equal(WBEN.perTable ?? false, false);
  assert.equal(PERS.perTable, true, "personality is per-table (never bundled)");
  // A perTable set is refused by the bundle matcher regardless of drafts.
  assert.equal(matchBundleTables(PERS, PERS.children.map((c) => hubDraft(c)).map(hubDraftToDescriptor)).ok, false);
});

/* -- duplicate PDF layout passes (2nd live failure) ------------------------ */
/* The extractor emits the same page twice, so every section repeats verbatim.
 * The bundle adapter collapses EXACT duplicates only; near-duplicates stay
 * ambiguous. Mirror of the hub: dedupExactTables(parseStackedTables(text)). */

const oneSet = (def) => def.children.map((c) => sectionText(c.label, c.formula, c.domain[0], c.domain[1], c.expectedCount)).join("\n");
const bundleAdapter = (text) => dedupExactTables(parseStackedTables(text));

test("doubled whole stacked page → exactly 3 child drafts and match ok", () => {
  const doubled = "HEADER 292\n" + oneSet(WB) + "\n" + oneSet(WB);
  const rawDrafts = parseStackedTables(doubled);
  assert.equal(rawDrafts.length, 6, "extractor doubles each of the 3 sections");
  const drafts = bundleAdapter(doubled);
  assert.equal(drafts.length, 3, "exact duplicates collapsed to one each");
  const res = matchBundleTables(WB, drafts.map(hubDraftToDescriptor));
  assert.equal(res.ok, true, `deduped bundle should match: ${JSON.stringify(res.errors)}`);
  assert.deepEqual(res.payloads.map((p) => p.manifestId).sort(),
    ["core-weapon-bonus", "core-weapon-feature", "core-weapon-type"]);
  // Without the collapse the same page is ambiguous (regression guard).
  assert.equal(matchBundleTables(WB, rawDrafts.map(hubDraftToDescriptor)).ok, false);
});

test("near-duplicate (one changed row) is NOT collapsed → stays ambiguous/blocked", () => {
  const second = oneSet(WB).replace("WeaponType_1", "WeaponType_CHANGED");
  const near = "HDR\n" + oneSet(WB) + "\n" + second;
  const drafts = bundleAdapter(near);
  // Weapon Type differs by one row between passes → both kept (4 total drafts).
  assert.equal(drafts.length, 4);
  assert.equal(drafts.filter((d) => /weapon type/i.test(d.name ?? "")).length, 2, "differing Type passes both preserved");
  const res = matchBundleTables(WB, drafts.map(hubDraftToDescriptor));
  assert.equal(res.ok, false, "a genuine duplicate-with-difference must stay blocked");
  assert.equal(res.payloads.length, 0);
});

test("dedupExactTables keeps the first occurrence verbatim and injects no content", () => {
  const a = { name: "X", formula: "1d4", rows: [{ min: 1, max: 2, text: "aa" }, { min: 3, max: 4, text: "bb" }] };
  const dupWhitespace = { name: " X ", formula: "1D4", rows: [{ min: 1, max: 2, text: "  aa " }, { min: 3, max: 4, text: "bb" }] };
  const different = { name: "X", formula: "1d4", rows: [{ min: 1, max: 2, text: "aa" }, { min: 3, max: 4, text: "cc" }] };
  const out = dedupExactTables([a, dupWhitespace, different]);
  assert.equal(out.length, 2, "case/whitespace-only repeat folded; a real difference kept");
  assert.strictEqual(out[0], a, "first occurrence preserved by reference (verbatim, nothing injected)");
  assert.strictEqual(out[1], different);
  // No shipped prose: output text is only the caller's own invented rows.
  const blob = JSON.stringify(out);
  assert.ok(!/shadowdark|core rulebook|copyright/i.test(blob));
});

test("dedupExactTables is a no-op on already-unique drafts and tolerates junk", () => {
  const uniq = WB.children.map((c) => hubDraft(c));
  assert.equal(dedupExactTables(uniq).length, 3);
  assert.deepEqual(dedupExactTables(null), []);
  assert.deepEqual(dedupExactTables(undefined), []);
});
