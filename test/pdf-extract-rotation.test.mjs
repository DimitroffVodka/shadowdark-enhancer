/**
 * Regressions for sideways pages.
 *
 * Some books DRAW a page's text rotated in page space rather than rotating the
 * page: PDF.js then reports every item with a rotated transform ([0, s, -s, 0,
 * e, f] for +90), and the y-ordered layout reads each printed line as its own
 * column — the page extracts as stacked gibberish. The Western Reaches GM Guide
 * does this on 39 pages (every region's Rumors/Encounter-grid page and its
 * Points of Interest page); the Cursed Scrolls do it on their map and
 * adventure-site spreads. _readingSpace maps those items upright and hands the
 * layout the page HEIGHT as its width.
 *
 * The decision is per PAGE, on a majority of its items: a lone sideways caption
 * on an upright page must not flip the page, and an upright page must come out
 * exactly as it does today.
 *
 * Only geometry is reproduced here; every string is a placeholder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { _internals } from "../scripts/importer/pdf-text-extract.mjs";

const { _readingSpace, layoutPageItems } = _internals;

/** A portrait page, as a rotation:0 viewport reports it. */
const W = 419.5;
const H = 595.3;

/** An upright PDF.js text item: transform [s,0,0,s,x,y]. */
const upright = (x, y, str, w = str.length * 5, s = 10) =>
  ({ str, width: w, height: s, transform: [s, 0, 0, s, x, y] });

/**
 * The same run drawn sideways, as the GM Guide draws it.
 *
 * `dir` +1 is +90 (the text advances UP the page, transform [0,s,-s,0,e,f]);
 * -1 is -90 (it advances DOWN, [0,-s,s,0,e,f]). `rx`/`ry` are where the run
 * should land once read upright, so each fixture below states the answer it
 * expects and the mapping has to reproduce it.
 */
const sideways = (rx, ry, str, dir = 1, w = str.length * 5, s = 10) => {
  const [e, f] = dir > 0 ? [W - ry, rx] : [ry, H - rx];
  return { str, width: w, height: s, transform: [0, dir * s, -dir * s, 0, e, f] };
};

/**
 * Two sideways columns of six lines each, in the coordinates they must land on
 * once read upright. Six rows because detectGutter wants a dozen items and
 * three cleanly separated rows before it will accept any cut — fewer, and the
 * page reads as one column and the two columns interleave, which is the very
 * failure this fixture is here to rule out.
 */
const ROWS = [500, 480, 460, 440, 420, 400];
const TWO_COLUMNS = [
  ...ROWS.map((y, i) => [40, y, `left-${i}`]),
  ...ROWS.map((y, i) => [340, y, `right-${i}`]),
];
/** The reading order those items must come back in. */
const IN_ORDER = [...ROWS.map((_, i) => `left-${i}`), ...ROWS.map((_, i) => `right-${i}`)];

test("+90: a page drawn sideways reads in order, in the page-height frame", () => {
  const its = TWO_COLUMNS.map(([x, y, s]) => sideways(x, y, s, +1));
  const { items, width } = _readingSpace(its, W, H);
  assert.equal(width, H, "the reading frame is as wide as the page is tall");
  assert.notEqual(items, its, "a rotated-majority page is remapped");
  // Every mapped item is upright again, and landed where the fixture said.
  items.forEach((it, k) => {
    assert.deepEqual(it.transform.slice(0, 4), [10, 0, 0, 10]);
    assert.ok(Math.abs(it.transform[4] - TWO_COLUMNS[k][0]) < 0.01, `x of ${it.str}`);
    assert.ok(Math.abs(it.transform[5] - TWO_COLUMNS[k][1]) < 0.01, `y of ${it.str}`);
  });
  const { lines } = layoutPageItems(items, width, "auto");
  assert.deepEqual(lines, IN_ORDER);
});

test("-90: the mirrored drawing direction reads the same text", () => {
  const its = TWO_COLUMNS.map(([x, y, s]) => sideways(x, y, s, -1));
  const { items, width } = _readingSpace(its, W, H);
  assert.equal(width, H);
  items.forEach((it, k) => {
    assert.deepEqual(it.transform.slice(0, 4), [10, 0, 0, 10]);
    assert.ok(Math.abs(it.transform[4] - TWO_COLUMNS[k][0]) < 0.01, `x of ${it.str}`);
    assert.ok(Math.abs(it.transform[5] - TWO_COLUMNS[k][1]) < 0.01, `y of ${it.str}`);
  });
  const { lines } = layoutPageItems(items, width, "auto");
  assert.deepEqual(lines, IN_ORDER);
});

test("an upright page is handed back untouched — the same array, the same width", () => {
  const its = TWO_COLUMNS.map(([x, y, s]) => upright(x, y, s));
  const out = _readingSpace(its, W, H);
  // Reference identity, not deep equality: nothing downstream can behave
  // differently on an upright page because nothing downstream sees a new object.
  assert.equal(out.items, its);
  assert.equal(out.width, W);
});

test("a few sideways items do NOT flip an upright page", () => {
  const its = [
    ...TWO_COLUMNS.map(([x, y, s]) => upright(x, y, s)),
    // A sideways caption up the outer margin — real, and a minority.
    sideways(200, 30, "margin-note", +1),
    sideways(200, 20, "margin-note-2", +1),
  ];
  const before = layoutPageItems(its, W, "auto").lines;
  const out = _readingSpace(its, W, H);
  assert.equal(out.items, its, "the page stays in its own frame");
  assert.equal(out.width, W);
  assert.deepEqual(layoutPageItems(out.items, out.width, "auto").lines, before);
});

test("an empty page is not treated as rotated", () => {
  const out = _readingSpace([], W, H);
  assert.deepEqual(out.items, []);
  assert.equal(out.width, W);
});

/**
 * Cell boundaries in a padded grid row, and the footnote markers hung off them.
 *
 * Both defects were invisible to every count-based check: the row split into
 * the right NUMBER of cells and covered every die face, so the importer
 * reported a clean table while the cells held their neighbours' text. They were
 * found by reading the GM Guide's own pages back against the book.
 *
 * The figures below are the real ones, in points. p102's ENCOUNTERS grid sets
 * "Purple worm" and "The Scourge*" 8.5pt apart with a ~5.3pt glyph — 1.6
 * glyphs, under the old 1.8 bar — so a column boundary came out as an ordinary
 * word space and the two cells welded into one.
 */

/** One PDF text item as columnLines wants it: a grid cell is always exactly one
 *  of these, which is why an inter-item gap can be read as a boundary at all —
 *  spacing WITHIN a cell lives inside the item's own string. */
const cell = (x, w, str, h = 9) => ({ transform: [1, 0, 0, 1, x, 0], width: w, str, height: h });
const padded = (items) => _internals.columnLines(items, true)[0];

test("a padded row splits cells a hair over a word-space apart (GM Guide p102 face 1)", () => {
  const line = padded([
    cell(278.1, 3.9, "1", 10),
    cell(295.0, 59.6, "Purple worm"),
    cell(363.1, 60.6, "The Scourge*"),
    cell(432.2, 67.9, "1d8 Ras-Godai*"),
    cell(523.9, 43.2, "Rakshasa"),
  ]);
  assert.deepEqual(line.split(/\s{2,}/).filter(Boolean),
    ["1", "Purple worm", "The Scourge*", "1d8 Ras-Godai*", "Rakshasa"]);
});

test("a padded row keeps a real word space single", () => {
  // 2.7pt apart: a styling run split mid-sentence, not a column boundary.
  assert.equal(padded([cell(8.5, 42.3, "death of"), cell(53.5, 65.5, "The Scourge")]),
    "death of The Scourge");
});

test("a footnote marker set SMALLER than its cell is dropped (p102)", () => {
  assert.equal(padded([cell(60.0, 31.6, "Digger", 9), cell(91.6, 3.4, "1", 8)]), "Digger");
});

test("a footnote marker set LARGER than its cell is dropped (p228)", () => {
  // Tal-Yool hangs the same marker off the other side of the text size, which
  // is why the test is a difference in height and not "smaller".
  assert.equal(padded([cell(85.1, 23.0, "Land", 9), cell(108.2, 4.3, "1", 10)]), "Land");
});

test("a settlement size digit set in the cell's own size survives (Master Hex Key)", () => {
  // Structurally identical to a marker — bare digit, abutting — and it is data
  // the hex import reads. Matching its text's height is what saves it.
  assert.equal(padded([cell(280.8, 51.1, "Low Town", 10), cell(331.9, 4.3, "2", 10)]), "Low Town2");
});

test("a die face is a bare digit too, and stands clear of the first cell", () => {
  assert.equal(padded([cell(18.7, 5.9, "2", 10), cell(85.1, 23.0, "Land", 9)]).split(/\s{2,}/)[0], "2");
});
