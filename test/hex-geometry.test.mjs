import test from "node:test";
import assert from "node:assert/strict";
import { offsetToCube, cubeToOffset, numberFor, cellNumber, neighbours, foundryOffsetToCube } from "../scripts/hex-map/geometry.mjs";

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
