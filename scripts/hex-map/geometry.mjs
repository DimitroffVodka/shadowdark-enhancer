/**
 * Shadowdark Enhancer — hex map geometry (pure, Foundry-free, node-testable).
 *
 * Numbering. A published hex map numbers cells column-first ("1403" is column
 * 14, row 03 — hexIdKey) with every other column shifted half a cell; on the
 * Western Reaches map the odd columns sit lower. Foundry's grid offsets {i, j}
 * use their own parity setting, which need not match the map's, so a cell's
 * printed row is NOT its Foundry row in general. Cube coordinates are parity
 * free, so the tagger anchors on ONE cell whose printed number the GM reads
 * off its thumbnail and numbers every other cell by cube difference:
 *
 *   cube(cell) - cube(anchor) + cube(printedAnchor)  →  printed (col, row)
 *
 * with the map's own shift rule ("odd" or "even" columns lowered) applied when
 * converting cubes to printed offsets. Phase 2 of docs/plans/hex-map-dataset.md.
 */

import { hexIdKey } from "../importer/tables/hex-parser.mjs";

/** Printed (col, row) → cube {q, r} under the map's shift rule (flat-top columns). */
export function offsetToCube(col, row, shifted = "odd") {
  const q = col;
  const r = shifted === "even" ? row - (q + (q & 1)) / 2 : row - (q - (q & 1)) / 2;
  return { q, r };
}

/** Cube {q, r} → printed (col, row) under the map's shift rule. */
export function cubeToOffset({ q, r }, shifted = "odd") {
  const col = q;
  const row = shifted === "even" ? r + (q + (q & 1)) / 2 : r + (q - (q & 1)) / 2;
  return { col, row };
}

/** Published hex number for a printed (col, row): col*100 + row, or null when out of range. */
export function numberFor(col, row) {
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || row > 99) return null;
  return col * 100 + row;
}

/**
 * Printed (col, row) of the origin's number. `origin.num` is the GM-typed
 * printed number; hexIdKey reads its digits.
 */
export function originOffset(origin) {
  const key = hexIdKey(String(origin?.num ?? ""));
  if (key === null) return null;
  const [col, row] = key.split(",").map(Number);
  return { col, row };
}

/**
 * Number a cell from its Foundry cube and the origin.
 * @param {{q:number, r:number}} cube          Foundry cube of the cell
 * @param {{cube:{q:number,r:number}, num:string|number, shifted?:"odd"|"even", bounds?:{cols:number, rows:number, rowsLowered?:number, firstRow?:number}}} origin
 *   bounds.rowsLowered: the lowered columns' own row count when it differs (one short on a
 *   print whose frame cuts them off at the bottom, like the Western Reaches)
 *   bounds.firstRow: the first row the RAISED columns actually have. Those columns sit half
 *   a cell higher, so a frame that cuts the field cuts their first row in half — on the
 *   Western Reaches that half cell is where the print writes its column labels, all margin
 *   and no map. Numbering it asks the GM to tag the frame. Default 0; the lowered columns
 *   always start at 0, since it is the other end of them the frame takes.
 * @returns {{ col:number, row:number, num:number|null }} num is null outside the map's bounds
 */
export function cellNumber(cube, origin) {
  const o = originOffset(origin);
  if (!o || !origin?.cube) return { col: NaN, row: NaN, num: null };
  const shifted = origin.shifted ?? "odd";
  const a = offsetToCube(o.col, o.row, shifted);
  const c = { q: cube.q - origin.cube.q + a.q, r: cube.r - origin.cube.r + a.r };
  const { col, row } = cubeToOffset(c, shifted);
  let num = numberFor(col, row);
  const b = origin.bounds;
  if (num !== null && b) {
    const lowered = shifted === "odd" ? col % 2 === 1 : col % 2 === 0;
    const rows = (lowered && b.rowsLowered) || b.rows;
    const first = lowered ? 0 : (b.firstRow ?? 0);
    if ((b.cols && col >= b.cols) || (rows && row >= rows) || row < first) num = null;
  }
  return { col, row, num };
}

/** The six neighbours of a printed cell, same shift rule. */
export function neighbours(col, row, shifted = "odd") {
  const c = offsetToCube(col, row, shifted);
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  return dirs.map(([dq, dr]) => cubeToOffset({ q: c.q + dq, r: c.r + dr }, shifted));
}

/** Foundry offset → cube for a flat-top column grid with the given parity (mirrors HexagonalGrid#getCube). */
export function foundryOffsetToCube({ i, j }, even) {
  const q = j;
  const r = even ? i - (q + (q & 1)) / 2 : i - (q - (q & 1)) / 2;
  return { q, r };
}
