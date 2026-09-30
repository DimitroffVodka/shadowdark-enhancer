import test from "node:test";
import assert from "node:assert/strict";
import { offsetToCube, cubeToOffset, numberFor, cellNumber, onMap, withAnchorNumber, boundsFromRow, framesTopRow, neighbours, foundryOffsetToCube, extrasNumbersAlike } from "../scripts/hex-map/geometry.mjs";

test("cube round trip under both shift rules", () => {
  for (const shifted of ["odd", "even"]) for (let col = 0; col < 5; col++) for (let row = 0; row < 5; row++) {
    const back = cubeToOffset(offsetToCube(col, row, shifted), shifted);
    assert.deepEqual(back, { col, row }, `${shifted} ${col},${row}`);
  }
});

test("numberFor follows the column-major rule and refuses rows past 99", () => {
  assert.equal(numberFor(14, 3), 1403);
  assert.equal(numberFor(0, 0), 0);
  assert.equal(numberFor(1, 100), null);
  assert.equal(numberFor(-1, 0), null);
});

test("cellNumber: anchor at Foundry (0,0) printed 000 on an even-column scene numbers an odd-column cell by its printed row", () => {
  // The scene is HEXEVENQ (even columns lowered) while the map lowers odd columns:
  // image cell (1,0) sits at Foundry offset {i:1, j:1} (measured live 2026-09-17).
  const even = true;
  const origin = { cube: foundryOffsetToCube({ i: 0, j: 0 }, even), num: "000", shifted: "odd" };
  assert.deepEqual(cellNumber(foundryOffsetToCube({ i: 1, j: 1 }, even), origin), { col: 1, row: 0, num: 100 });
  assert.deepEqual(cellNumber(foundryOffsetToCube({ i: 1, j: 0 }, even), origin), { col: 0, row: 1, num: 1 });
  assert.deepEqual(cellNumber(foundryOffsetToCube({ i: 46, j: 12 }, even), origin), { col: 12, row: 46, num: 1246 });
});

test("cellNumber: an anchor whose Foundry column parity differs from its printed column parity", () => {
  // HEXODDQ scene (odd Foundry columns lowered). The anchor sits in Foundry column 7
  // (lowered) but is printed as column 14 (an even column, NOT lowered on the map).
  // The next Foundry column (8, not lowered) is half a cell above the anchor, and the
  // next printed column (15, lowered) is half a cell below its neighbour, so the cell
  // at the same Foundry row is printed one row EARLIER. Offsets get this wrong; cubes do not.
  const even = false;
  const origin = { cube: foundryOffsetToCube({ i: 5, j: 7 }, even), num: "1403", shifted: "odd" };
  assert.equal(cellNumber(foundryOffsetToCube({ i: 5, j: 7 }, even), origin).num, 1403);
  assert.equal(cellNumber(foundryOffsetToCube({ i: 5, j: 8 }, even), origin).num, 1502);
  assert.equal(cellNumber(foundryOffsetToCube({ i: 6, j: 7 }, even), origin).num, 1404);   // same column, next row
});

test("cellNumber: bounds drop cells past the map's columns or rows, negative cells are null", () => {
  const origin = { cube: { q: 0, r: 0 }, num: "000", shifted: "odd", bounds: { cols: 2, rows: 2 } };
  assert.equal(cellNumber({ q: 1, r: 0 }, origin).num, 100);
  assert.equal(cellNumber({ q: 2, r: 0 }, origin).num, null);
  assert.equal(cellNumber({ q: 0, r: 2 }, origin).num, null);
  assert.equal(cellNumber({ q: -1, r: 0 }, origin).num, null);
});

test("cellNumber: rowsLowered ends the lowered columns one row short, the other parity keeps its last row", () => {
  for (const shifted of ["odd", "even"]) {
    const origin = { cube: { q: 0, r: 0 }, num: "000", shifted, bounds: { cols: 4, rows: 3, rowsLowered: 2 } };
    const at = (col, row) => cellNumber(offsetToCube(col, row, shifted), origin).num;
    const lowered = shifted === "odd" ? 1 : 0, raised = 1 - lowered;
    assert.equal(at(raised, 2), raised * 100 + 2, `${shifted}: raised column keeps row 2`);
    assert.equal(at(lowered, 2), null, `${shifted}: lowered column has no row 2`);
    assert.equal(at(lowered, 1), lowered * 100 + 1);
  }
});

test("neighbours: six cells, odd columns lowered", () => {
  const n = neighbours(1, 1, "odd").map((c) => `${c.col},${c.row}`).sort();
  assert.deepEqual(n, ["0,1", "0,2", "1,0", "1,2", "2,1", "2,2"]);
  const m = neighbours(2, 1, "odd").map((c) => `${c.col},${c.row}`).sort();
  assert.deepEqual(m, ["1,0", "1,1", "2,0", "2,2", "3,0", "3,1"]);
});

test("cellNumber: the raised columns' frame-cut first row is not numbered", () => {
  // The Western Reaches: odd columns lowered, 64 × 75, the lowered ones one row
  // short at the bottom, and the raised ones' row 0 is the half cell in the top
  // frame where the print writes its column labels.
  const origin = { cube: { q: 0, r: 0 }, num: "0001", shifted: "odd", bounds: { cols: 64, rows: 75, rowsLowered: 74, firstRow: 1 } };
  const at = (col, row) => cellNumber(offsetToCube(col, row, "odd"), { ...origin, cube: offsetToCube(0, 1, "odd") }).num;
  assert.equal(at(0, 0), null, "column 0 is raised: its row 0 is frame, not map");
  assert.equal(at(2, 0), null);
  assert.equal(at(0, 1), 1, "and its first real hex is row 1");
  assert.equal(at(1, 0), 100, "the lowered columns keep their row 0 — the frame takes their other end");
  assert.equal(at(1, 73), 173);
  assert.equal(at(1, 74), null, "rowsLowered still cuts the lowered columns at the bottom");
  assert.equal(at(0, 74), 74, "the raised columns still reach the last row");
});

test("cellNumber: firstRow defaults to 0, so a print without a cut row is unchanged", () => {
  const origin = { cube: { q: 0, r: 0 }, num: "0000", shifted: "odd", bounds: { cols: 4, rows: 4 } };
  assert.equal(cellNumber(offsetToCube(0, 0, "odd"), origin).num, 0);
  assert.equal(cellNumber(offsetToCube(2, 0, "odd"), origin).num, 200);
});

test("cellNumber: a map numbered from 0001 keeps its last printed row — bounds count from the first number, not from zero", () => {
  // The Gloaming (Cursed Scroll 1): 17 columns, even ones lowered and one row short, printed rows 1 to 11
  // with the first hex 0001. Comparing the printed row with `rows` as if numbering began at 0 dropped row 11
  // and the lowered columns' row 10: 170 numbered cells of 178.
  const bounds = { cols: 17, rows: 11, rowsLowered: 10, firstRow: 0, base: { col: 0, row: 1 } };
  const origin = { cube: offsetToCube(0, 1, "even"), num: "0001", shifted: "even", bounds };
  let numbered = 0;
  for (let col = -1; col < 19; col++) for (let row = -1; row < 14; row++) {
    if (cellNumber(offsetToCube(col, row, "even"), origin).num !== null) numbered++;
  }
  assert.equal(numbered, 178, "9 lowered columns of 10 and 8 raised ones of 11");
  const at = (col, row) => cellNumber(offsetToCube(col, row, "even"), origin).num;
  assert.equal(at(12, 10), 1210, "a lowered column's last row");
  assert.equal(at(1, 11), 111, "a raised column's last row");
  assert.equal(at(12, 11), null, "a lowered column has no row 11");
  assert.equal(at(1, 0), null, "row 0 is above the first number");
  assert.equal(at(17, 1), null, "column 17 is past the 17 columns");
});

test("cellNumber: a map numbered from 0000, or with no base, is unchanged", () => {
  const plain = { cube: { q: 0, r: 0 }, num: "0000", shifted: "odd", bounds: { cols: 2, rows: 2 } };
  const based = { ...plain, bounds: { cols: 2, rows: 2, base: { col: 0, row: 0 } } };
  for (const origin of [plain, based]) {
    assert.equal(cellNumber({ q: 1, r: 1 }, origin).num, 101);
    assert.equal(cellNumber({ q: 1, r: 2 }, origin).num, null);
    assert.equal(cellNumber({ q: 2, r: 0 }, origin).num, null);
  }
});

test("onMap: the base moves every bound, and cells left of it are frame", () => {
  const bounds = { cols: 3, rows: 2, base: { col: 2, row: 5 } };
  assert.equal(onMap(2, 5, bounds), true);
  assert.equal(onMap(4, 6, bounds), true);
  assert.equal(onMap(1, 5, bounds), false, "left of the first column");
  assert.equal(onMap(2, 4, bounds), false, "above the first row");
  assert.equal(onMap(5, 5, bounds), false, "three columns from column 2 ends at column 4");
  assert.equal(onMap(2, 7, bounds), false);
});

test("withAnchorNumber: renumbering the first hex moves where the counts start, and keeps the cell", () => {
  // The Gloaming was made with the dialog's default 0000; its first hex is 0001. The anchor cell
  // stays the same cell, so every other hex follows it.
  const cube = offsetToCube(0, 1, "even");
  const made = { i: 1, j: 0, ...cube, cube, num: "0000", shifted: "even", bounds: { cols: 17, rows: 11, rowsLowered: 10, firstRow: 0 } };
  const moved = withAnchorNumber(made, "0001");
  assert.equal(moved.num, "0001");
  assert.deepEqual(moved.bounds, { cols: 17, rows: 11, rowsLowered: 10, firstRow: 0, base: { col: 0, row: 1 } });
  assert.equal(moved.shifted, "even", "the first column is still 0: parity unchanged");
  let numbered = 0;
  for (let col = -1; col < 19; col++) for (let row = -1; row < 14; row++) {
    if (cellNumber(offsetToCube(col, row, "even"), moved).num !== null) numbered++;
  }
  assert.equal(numbered, 178);
  assert.equal(cellNumber(offsetToCube(1, 2, "even"), moved).num, 102, "the castle hex of The Gloaming");
  assert.equal(made.num, "0000", "the origin it was given is left alone");
  assert.equal("base" in made.bounds, false);
});

test("withAnchorNumber: back to 0000 drops the base, so the stored bounds are what they were", () => {
  const cube = { q: 0, r: 0 };
  const made = { cube, num: "0000", shifted: "odd", bounds: { cols: 64, rows: 75, rowsLowered: 74, firstRow: 1 } };
  const there = withAnchorNumber(made, "0101");
  assert.deepEqual(there.bounds.base, { col: 1, row: 1 });
  assert.deepEqual(withAnchorNumber(there, "0000").bounds, made.bounds);
});

test("withAnchorNumber: an odd first column swaps which printed columns are lowered", () => {
  const made = { cube: { q: 0, r: 0 }, num: "0000", shifted: "even", bounds: { cols: 17, rows: 11 } };
  assert.equal(withAnchorNumber(made, "0100").shifted, "odd");
  assert.equal(withAnchorNumber(made, "0201").shifted, "even", "two columns over is the same parity");
  assert.equal(withAnchorNumber(withAnchorNumber(made, "0100"), "0000").shifted, "even", "and back");
});

test("withAnchorNumber: an anchor that is not the first hex leaves the base alone", () => {
  // Anchored by hand on 1403 of a map that starts at 0000: the number names that cell, not the map's start.
  const made = { cube: { q: 0, r: 0 }, num: "1403", shifted: "odd", bounds: { cols: 64, rows: 75 } };
  assert.equal("base" in withAnchorNumber(made, "1404").bounds, false);
  assert.equal(withAnchorNumber(made, "1503").shifted, "even", "but the parity still follows the cell's column");
  assert.equal(withAnchorNumber({ ...made, bounds: null }, "1404").bounds, null, "no map size yet: nothing to move");
  assert.equal(withAnchorNumber(made, "hex"), null);
  assert.equal(withAnchorNumber(made, ""), null);
});

test("boundsFromRow: an unticked frame box is stored, so the next render does not guess it back on", () => {
  // The Gloaming: lowered columns one row short, but the raised columns' first row is a full hex, so
  // the box is unticked. Stored as "nothing", the next render guesses from the row counts that the frame
  // cut the top row, ticks the box, and the second Apply drops eight hexes (170 numbered of 178).
  const old = { cols: 17, rows: 11, rowsLowered: 10, firstRow: 0, base: { col: 0, row: 1 } };
  const once = boundsFromRow({ cols: 17, rows: 11, skipTop: false, old });
  assert.deepEqual(once, old);
  assert.equal(framesTopRow(once), false, "so a re-render leaves the box unticked");
  assert.deepEqual(boundsFromRow({ cols: 17, rows: 11, skipTop: false, old: once }), old, "and a second Apply changes nothing");
  assert.equal(boundsFromRow({ cols: 17, rows: 11, skipTop: true, old }).firstRow, 1);
  assert.deepEqual(boundsFromRow({ cols: 4, rows: 3, skipTop: false, old: null }), { cols: 4, rows: 3, firstRow: 0 });
  assert.equal(boundsFromRow({ cols: 17, rows: 11, skipTop: false, old: { cols: 17, rows: 11 } }).base, undefined, "no base to carry");
  assert.equal(boundsFromRow({ cols: NaN, rows: 11, skipTop: false, old }), null, "a blank size means no bounds");
  assert.deepEqual(boundsFromRow({ cols: 17, rows: 12, skipTop: false, old }).rowsLowered, 11, "the lowered columns stay one row short");
});

test("extrasNumbersAlike: a print whose first hex is the top-left cell numbers like Extras", () => {
  // The Western Reaches on a HEXODDQ scene: odd columns lowered, numbered from
  // 0000, anchored on 2849, which Extras puts at Foundry offset {i: 49, j: 28}.
  const at = (i, j) => foundryOffsetToCube({ i, j }, false);
  assert.equal(extrasNumbersAlike({ cube: at(49, 28), num: "2849", shifted: "odd" }, 0), true);
  assert.equal(extrasNumbersAlike({ cube: at(49, 29), num: "2849", shifted: "odd" }, 0), false, "anchored a column over");
  assert.equal(extrasNumbersAlike({ cube: at(50, 28), num: "2849", shifted: "odd" }, 0), false, "anchored a row down");
  assert.equal(extrasNumbersAlike({ cube: at(0, 0), num: "0000", shifted: "even" }, 0), false, "the print lowers the other columns");
  assert.equal(extrasNumbersAlike({ cube: at(0, 0), num: "0101", shifted: "even" }, 1), true, "numbered from 0101: printed column 1 is Foundry's even column 0");
  assert.equal(extrasNumbersAlike({ cube: at(0, 0), num: "0101", shifted: "odd" }, 1), false);
  assert.equal(extrasNumbersAlike(null, 0), false);
  assert.equal(extrasNumbersAlike({ num: "0000" }, 0), false, "no anchor cell");
});
