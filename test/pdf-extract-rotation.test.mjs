/**
 * Regressions for sideways pages and for the "2layout" column mode.
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
 * "2layout" covers the other half of the same books: a page printing two GRIDS
 * side by side needs the gutter split of "auto" AND the padded emitter of
 * "layout". Neither alone works — "auto" collapses each column's cell gaps to a
 * single space, "layout" never splits and welds the two grids' rows together.
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
 * Two grids side by side: a "d8 A B" table in the left column and a "d8 C D"
 * table in the right, each with a wide gap between its own cells. This is the
 * Western Reaches region-page layout (ENCOUNTER ZONE beside ENCOUNTERS).
 * Four printed rows, which is what detectGutter needs before it will accept a
 * cut at all (three cleanly separated rows).
 */
const SIDE_BY_SIDE = [];
for (const [r, y] of [[0, 500], [1, 480], [2, 460], [3, 440]]) {
  const head = r === 0;
  // left grid, cells at x = 40 / 90 / 150
  SIDE_BY_SIDE.push([40, y, head ? "d8" : `${r}`], [90, y, head ? "A" : `a${r}`], [150, y, head ? "B" : `b${r}`]);
  // right grid, across the gutter, at x = 240 / 290 / 350
  SIDE_BY_SIDE.push([240, y, head ? "d8" : `${r}`], [290, y, head ? "C" : `c${r}`], [350, y, head ? "D" : `d${r}`]);
}

/** The fixture's rows, per grid, as the cells they are meant to split into. */
const LEFT_ROWS = [["d8", "A", "B"], ["1", "a1", "b1"], ["2", "a2", "b2"], ["3", "a3", "b3"]];
const RIGHT_ROWS = [["d8", "C", "D"], ["1", "c1", "d1"], ["2", "c2", "d2"], ["3", "c3", "d3"]];

const sideBySide = () => SIDE_BY_SIDE.map(([x, y, s]) => upright(x, y, s, s.length * 5));

test("2layout splits the columns AND keeps each column's cell alignment", () => {
  const { gutter, lines } = layoutPageItems(sideBySide(), W, "2layout");
  assert.ok(gutter != null, "the two grids are separated by a gutter");
  assert.equal(lines.length, 8, "four rows per grid, the grids not welded together");
  // Each line is one grid's row with its cells still 2+ spaces apart — which is
  // exactly what the grid parsers split on.
  for (const ln of lines) assert.match(ln, /\S {2,}\S/);
  assert.deepEqual(lines.map((l) => l.trim().split(/\s{2,}/)), [...LEFT_ROWS, ...RIGHT_ROWS]);
});

test("2layout is the mode that does it — neither auto nor layout can", () => {
  // "auto" splits the columns but collapses every cell gap to one space.
  const auto = layoutPageItems(sideBySide(), W, "auto").lines;
  assert.equal(auto.length, 8);
  assert.ok(auto.every((l) => !/\S {2,}\S/.test(l)), "auto keeps no cell alignment");
  // "layout" keeps the alignment but never splits, so the two grids' rows weld.
  const layout = layoutPageItems(sideBySide(), W, "layout").lines;
  assert.equal(layout.length, 4, "one line per printed row, both grids on it");
  assert.match(layout[0], /d8.*A.*B.*d8.*C.*D/);
});

test("2layout on a single-column page behaves like layout", () => {
  const its = [
    upright(40, 500, "only-a"), upright(40, 480, "only-b"), upright(40, 460, "only-c"),
  ];
  const { gutter, lines } = layoutPageItems(its, W, "2layout");
  assert.equal(gutter, null, "no gutter to find, so nothing is split");
  assert.deepEqual(lines, ["only-a", "only-b", "only-c"]);
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

/**
 * A centred section title printed ACROSS both columns, with its lore paragraph
 * below it in the left column and the group's first statted entry on the right
 * — the GM Guide's "SISTERS OF ST. SOFIA" (p302) and "VOID CREATURES" spreads.
 *
 * Geometry measured off the book: page 419.5 wide, the title spanning x
 * 135.3–282.0, so it CENTRES at 208.6 against a gutter near 207. Split by
 * centre, the title files with the right column and sorts below the entire left
 * column — which orphans the lore under it, and splitStatblocks then welds that
 * paragraph onto the last monster of the previous page (Siruul came out of the
 * live import carrying the Sisters' lore; Valkyrie carried the Void Creatures').
 */
const LORE_ROWS = [520, 505, 490, 475, 460, 445];
test("a full-width centred title stays above its own column, not under it", () => {
  const its = [
    { str: "SISTERS OF ST. SOFIA", width: 146.7, height: 16, transform: [16, 0, 0, 16, 135.3, 540] },
    ...LORE_ROWS.map((y, i) => upright(36.1, y, `lore-${i}`, 158)),
    ...LORE_ROWS.map((y, i) => upright(218, y, `entry-${i}`, 158)),
  ];
  const { gutter, lines } = layoutPageItems(its, W, "auto");
  assert.ok(gutter != null && gutter < 208.6,
    `the title's centre must fall on the far side of the gutter (got ${gutter})`);
  assert.equal(lines[0], "SISTERS OF ST. SOFIA");
  assert.equal(lines[1], "lore-0", "the lore follows its own title, not the columns");
  assert.equal(lines[LORE_ROWS.length + 1], "entry-0");
});
