// Regression tests for the CORE d20 × 3-column generator pages (Tavern, Shop,
// Party Name, Adventure, Adventuring Site Name, Magic Item Idea, NPC Qualities).
//
// Three distinct bugs, all fixed 2026-07-25 (follow-up to Traps/Hazards):
//
//   1. Column mode. Every one of these pages prints two PROSE columns above a
//      full-width table, so "auto" gutter detection locks onto the PROSE gutter
//      and cuts the table in half — the word-splitter then wins the best-filled
//      vote by shredding cells ("The | Crimson | Rat High-stakes gambling"
//      instead of "The Crimson | Rat | High-stakes gambling"). Fix: pin
//      extractCols "layout".
//
//   2. Shared pages. Most of these pages stack a SECOND die table below the
//      generator (SHOP GENERATOR over INTERESTING CUSTOMER, NPC QUALITIES over
//      OCCUPATION, PARTY NAME over SIGNATURE TACTICS). Unbound, the parse
//      returned the NEIGHBOUR's rows at a full 60/60 with ZERO warnings — a
//      clean score is not evidence the right table was read. Fix: caption bound.
//
//   3. Page-bottom pull quotes. CORE p123 closes with a designer quote and its
//      attribution printed directly below the last row, no blank line between.
//      Neither carries a die face, so the wrap grouper filed both onto row 20
//      ("Shrine of the “Crypt of the Blighted -Creeg, human wizard"). Fix: the
//      PAGE_TRAILER guard in _groupLayoutRows ends the table there.
//
// Fixtures are SYNTHETIC placeholder text — no book content ships here. The real
// tables are verified live against the user's own PDF.
import test from "node:test";
import assert from "node:assert/strict";
import { parseByShape, stripPageFooterLines } from "../scripts/importer/tables/table-importer.mjs";
import { resolveShape } from "../scripts/importer/tables/table-shapes.mjs";
import { CORE_TABLE_GROUPS } from "../scripts/importer/tables/core-table-groups.mjs";

// The seven generator entries, with the caption each one is bound to.
const GENERATORS = [
  ["Tavern Generator", "TAVERN GENERATOR"],
  ["Shop Generator", "SHOP GENERATOR"],
  ["Party Name", "PARTY NAME"],
  ["Adventure Generator", "ADVENTURE GENERATOR"],
  ["Adventuring Site Name", "ADVENTURING SITE NAME"],
  ["Magic Item Idea Generator", "MAGIC ITEM IDEA GENERATOR"],
  ["NPC Qualities", "NPC QUALITIES"],
];

// Column x-starts as the layout extractor pads them: die, then the 3 columns.
const COLX = [0, 5, 22, 40];
const row = (cells) => {
  let line = "";
  cells.forEach((c, i) => { line = line.padEnd(COLX[i]) + c; });
  return line;
};
const SHAPE = (extra = {}) => ({
  kind: "compound", split: "grid", cols: 3, size: 4,
  labels: ["One", "Two", "Three"], ...extra,
});
const cellsOf = (g, size = 4) => {
  const cols = g.compound?.columns ?? g.columns ?? [];
  return Array.from({ length: size }, (_, i) => cols.map((c) => c.rows?.[i]?.text ?? ""));
};

test("seeded shape input strips only cited bare page-footer lines", () => {
  const text = [
    "MIXING POTIONS",
    "1 First result",
    "“",
    "286",
    "Mixing Potions",
    "NEXT TABLE",
    "d2 Details",
    "2 Result mentioning 286 coins",
    "287",
  ].join("\n");
  assert.equal(
    stripPageFooterLines(text, "286"),
    "MIXING POTIONS\n1 First result\nNEXT TABLE\nd2 Details\n2 Result mentioning 286 coins\n287",
  );
});

test("magic-item count grids label each rolled column", () => {
  const text = [
    "QUALITIES",
    "2d6 Benefit Curse",
    "2-3 - 1",
    "4-7 1 1",
    "8-11 1 -",
    "12 2 -",
  ].join("\n");
  const shape = resolveShape({ contentId: "core/magic-item-qualities", name: "Qualities", src: "CORE" });
  const table = parseByShape(text, shape, { name: "Qualities" }).tables[0];
  assert.deepEqual(table.rows.map((r) => r.text), [
    "Benefit: 0; Curse: 1",
    "Benefit: 1; Curse: 1",
    "Benefit: 1; Curse: 0",
    "Benefit: 2; Curse: 0",
  ]);
});

test("potion grids request layout extraction so multi-word cells stay intact", () => {
  for (const contentId of [
    "core/potion-features-1", "core/potion-features-2", "core/potion-features-3",
    "core/mixing-potions-1", "core/mixing-potions-2",
  ]) {
    const shape = resolveShape({ contentId, src: "CORE" });
    assert.equal(shape?.cols, "layout", `${contentId}: must preserve PDF column geometry`);
  }
});

test("section tables stop before a page-bottom quote and attribution", () => {
  const text = [
    "UTILITY FEATURE",
    "d2 Details",
    "1 First feature",
    "2 Final feature",
    "This page-bottom remark is not a result.\"",
    "-Creeg, human wizard",
  ].join("\n");
  const table = parseByShape(text, { kind: "section", caption: "UTILITY FEATURE", size: 2 }, { name: "Utility Feature" }).tables[0];
  assert.deepEqual(table.rows.map((r) => r.text), ["First feature", "Final feature"]);
});

test("every generator pins layout extraction and a caption bound", () => {
  for (const [name, caption] of GENERATORS) {
    const shp = resolveShape({ name, src: "CORE" });
    assert.ok(shp, `${name}: no shape resolved`);
    // Without this, auto's prose gutter halves the table (bug 1).
    assert.equal(shp.extractCols, "layout", `${name}: extraction mode not pinned`);
    // Without this, a page-mate table can be returned instead (bug 2).
    assert.equal(shp.caption, caption, `${name}: caption bound missing or wrong`);
    assert.equal(shp.size, 20, `${name}: expected a d20 generator`);
    assert.equal(shp.cols, 3, `${name}: expected 3 columns`);
  }
});

test("page cites point at the page the table is actually printed on", () => {
  // All three were one page short and grabbed a DIFFERENT table that parsed
  // clean: p122 is Adventure Generator alone, p124 is ANCESTRY/AGE/ALIGNMENT/
  // WEALTH, p126 is the Rival Crawlers RENOWN/SECRET/WEALTH page.
  const pages = new Map();
  for (const g of CORE_TABLE_GROUPS) for (const t of g.tables ?? []) pages.set(t.name, t.page);
  assert.equal(pages.get("Adventure Generator"), 122);
  assert.equal(pages.get("Adventuring Site Name"), 123);
  assert.equal(pages.get("NPC Qualities"), 125);
  assert.equal(pages.get("Party Name"), 127);
  // The Rival Crawlers tables genuinely share p126 — Party Name must not.
  for (const n of ["Renown", "Secret", "Wealth"]) assert.equal(pages.get(n), 126);
});

// A synthetic page mimicking the real stacked layout: a captioned generator with
// a second captioned die table below it.
const STACKED = [
  "ALPHATABLE",
  row(["d4", "One", "Two", "Three"]),
  row(["1", "Anvil", "Ash", "Amber light"]),
  row(["2", "Bramble", "Bell", "Bitter wind"]),
  row(["3", "Cinder", "Cairn", "Copper dust"]),
  row(["4", "Dovetail", "Dram", "Dusty hall"]),
  "BETATABLE",
  row(["d4", "One", "Two", "Three"]),
  row(["1", "Wren", "Wax", "Wet stone"]),
  row(["2", "Yarrow", "Yoke", "Yellow smoke"]),
  row(["3", "Zephyr", "Zinc", "Zealous crowd"]),
  row(["4", "Quill", "Quartz", "Quiet room"]),
].join("\n");

test("the caption bound selects its own table, not the page-mate below it", () => {
  const first = parseByShape(STACKED, SHAPE({ caption: "ALPHATABLE" }), { name: "Alpha" }).generators[0];
  assert.deepEqual(cellsOf(first), [
    ["Anvil", "Ash", "Amber light"],
    ["Bramble", "Bell", "Bitter wind"],
    ["Cinder", "Cairn", "Copper dust"],
    ["Dovetail", "Dram", "Dusty hall"],
  ]);
  assert.deepEqual(first.warnings ?? [], []);

  // Same page, other bound → the other table. Proves the caption is what
  // selects, so a clean score on the wrong table can't pass unnoticed.
  const second = parseByShape(STACKED, SHAPE({ caption: "BETATABLE" }), { name: "Beta" }).generators[0];
  assert.deepEqual(cellsOf(second), [
    ["Wren", "Wax", "Wet stone"],
    ["Yarrow", "Yoke", "Yellow smoke"],
    ["Zephyr", "Zinc", "Zealous crowd"],
    ["Quill", "Quartz", "Quiet room"],
  ]);
  assert.deepEqual(second.warnings ?? [], []);

  // The two must not bleed into each other.
  const flat = cellsOf(first).flat().join(" ");
  for (const w of ["Wren", "Yarrow", "Zephyr", "Quill"]) {
    assert.ok(!flat.includes(w), `page-mate row leaked into the bound table: ${w}`);
  }
});

test("a page-bottom pull quote is not glued onto the last row", () => {
  // The p123 shape exactly: quote then attribution, no blank line, both below
  // the final row and neither carrying a die face.
  const WITH_TRAILER = [
    "GAMMATABLE",
    row(["d4", "One", "Two", "Three"]),
    row(["1", "Anvil", "Ash", "Amber light"]),
    row(["2", "Bramble", "Bell", "Bitter wind"]),
    row(["3", "Cinder", "Cairn", "Copper dust"]),
    row(["4", "Dovetail", "Dram", "Dusty hall"]),
    "“Dovetail and Dram? Sounds delightful.\"",
    "-Placeholder, synthetic witness",
    "123",
  ].join("\n");
  const g = parseByShape(WITH_TRAILER, SHAPE({ caption: "GAMMATABLE" }), { name: "Gamma" }).generators[0];
  assert.deepEqual(cellsOf(g)[3], ["Dovetail", "Dram", "Dusty hall"]);
  const flat = cellsOf(g).flat().join(" ");
  assert.ok(!flat.includes("delightful"), "pull quote leaked into a cell");
  assert.ok(!flat.includes("Placeholder"), "attribution leaked into a cell");
  assert.deepEqual(g.warnings ?? [], []);
});

test("the trailer guard does not swallow a genuine wrapped cell", () => {
  // The guard must stay narrow: an ordinary continuation line below the last
  // row — no quote marks, no dash attribution — is still the table's, and must
  // survive into the parse. Which COLUMN an unanchored wrap lands in is
  // _sliceCols' business (a line with nothing to its left offers no gap to
  // measure), so this asserts only that the guard let the text through.
  const WRAPPED = [
    "DELTATABLE",
    row(["d4", "One", "Two", "Three"]),
    row(["1", "Anvil", "Ash", "Amber light"]),
    row(["2", "Bramble", "Bell", "Bitter wind"]),
    row(["3", "Cinder", "Cairn", "Copper dust"]),
    row(["4", "Dovetail", "Dram", "Dusty hall with"]),
    row(["", "", "", "a low ceiling"]),
  ].join("\n");
  const g = parseByShape(WRAPPED, SHAPE({ caption: "DELTATABLE" }), { name: "Delta" }).generators[0];
  const lastRow = cellsOf(g)[3].join(" ");
  assert.ok(lastRow.includes("a low ceiling"), `wrapped cell text was dropped: ${lastRow}`);
  for (const w of ["Dovetail", "Dram", "Dusty hall with"]) {
    assert.ok(lastRow.includes(w), `wrapped row lost "${w}": ${lastRow}`);
  }
});
