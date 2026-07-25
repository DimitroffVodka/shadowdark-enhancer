// Regression tests for the CORE Traps / Hazards mix-and-match grids.
//
// The bug (2026-07-25): both pages print two prose columns ABOVE a full-width
// table. "auto" gutter detection found the PROSE gutter and applied it to the
// table as well, so extraction returned the table as two detached blocks — the
// die-numbered first column, then the remaining columns with no die faces. The
// die-led block was all any parser could see, and the generic word-splitter won
// the best-filled vote by shredding each cell into columns ("Hail | of |
// needles"). Fix = pin extractCols "layout" so x-positions keep every column on
// one line for parseGridShape.
//
// Fixtures are SYNTHETIC placeholder text — no book content ships here. The
// real tables are verified live against the user's own PDF.
import test from "node:test";
import assert from "node:assert/strict";
import { parseByShape } from "../scripts/importer/tables/table-importer.mjs";
import { resolveShape } from "../scripts/importer/tables/table-shapes.mjs";

const SHAPE = { kind: "compound", split: "grid", cols: 3, size: 4, labels: ["Alpha", "Beta", "Gamma"] };

// Column x-starts, as the layout extractor pads them: die, then the 3 columns.
// Every cell begins at its own column's x — the extractor pads from the glyph
// positions in the PDF, so a long cell eats its gutter but never shifts its
// neighbour right.
const COLX = [0, 4, 20, 42];
const row = (cells) => {
  let line = "";
  cells.forEach((c, i) => { line = line.padEnd(COLX[i]) + c; });
  return line;
};

const LAYOUT = [
  "GRIDDLE",
  row(["d4", "Alpha", "Beta", "Gamma"]),
  row(["1", "Uno", "Primo", "1d6"]),
  row(["2", "Dos dos", "Secondo due", "1d6/sleep"]),
  // "Terzo tre tre tre tre" runs to x=41, leaving a SINGLE space before the
  // last column at x=42 — the collapsed gutter that defeats splitting on 2+
  // spaces, and precisely why the grid parser slices at x instead.
  row(["3", "Tres", "Terzo tre tre tre tre", "2d8"]),
  row(["4", "Cuatro quatro", "Quarto", "3d10/petrify"]),
].join("\n");

const cellsOf = (g) => {
  const cols = g.compound?.columns ?? g.columns ?? [];
  return Array.from({ length: SHAPE.size }, (_, i) => cols.map((c) => c.rows?.[i]?.text ?? ""));
};

test("the shapes pin layout extraction (auto cuts the table in half)", () => {
  // The fix itself: without these, "Grab text" hands the parser two detached
  // blocks and the word-splitter shreds every cell.
  assert.equal(resolveShape({ name: "Traps", src: "CORE" }).extractCols, "layout");
  assert.equal(resolveShape({ name: "Hazards", src: "CORE" }).extractCols, "layout");
});

test("an aligned full-width grid keeps every cell whole", () => {
  const g = parseByShape(LAYOUT, SHAPE, { name: "Griddle" }).generators[0];
  assert.deepEqual(cellsOf(g), [
    ["Uno", "Primo", "1d6"],
    ["Dos dos", "Secondo due", "1d6/sleep"],
    ["Tres", "Terzo tre tre tre tre", "2d8"],
    ["Cuatro quatro", "Quarto", "3d10/petrify"],
  ]);
  assert.deepEqual(g.warnings ?? [], []);
});

test("the aligned split beats the word-splitter in the candidate vote", () => {
  // parseByShape runs reflow / aligned / generic and keeps the best-filled
  // result. The generic parser fills cells by splitting on whitespace, so it
  // can out-score a correct parse — the reported breakage ("Hail | of |
  // needles") was that vote going the wrong way. Every second column here is a
  // whole phrase, never the second WORD of the first column.
  const g = parseByShape(LAYOUT, SHAPE, { name: "Griddle" }).generators[0];
  for (const [a, b] of cellsOf(g)) {
    const nextWordOfA = a.split(/\s+/)[1] ?? "";
    assert.notEqual(b, nextWordOfA, `column 2 got a word fragment of column 1: ${b}`);
  }
});

test("a column-split extraction is never silently accepted", () => {
  // What "auto" produced: column 1 die-numbered, the rest detached below. The
  // parse cannot recover it — but it must SAY so rather than report clean.
  const SPLIT = [
    "d4 Alpha", "1 Uno", "2 Dos dos", "3 Tres", "4 Cuatro quatro",
    "Beta Gamma",
    "Primo 1d6", "Secondo due 1d6/sleep", "Terzo tre 2d8", "Quarto 3d10/petrify",
  ].join("\n");
  const g = parseByShape(SPLIT, SHAPE, { name: "Griddle" }).generators[0];
  assert.ok((g.warnings ?? []).length > 0, "degraded grid parse reported no warnings");
});
