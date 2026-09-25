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
  const num = numberFor(col, row);
  return { col, row, num: onMap(col, row, origin.bounds, shifted) ? num : null };
}

/**
 * Is this printed cell on the map, or in the frame around it?
 *
 * The lowered columns run from row 0 and may end a row short; the raised ones
 * may START a row late, because a frame that clips the field at one parity's
 * bottom clips it at the other's top — and that top half-cell is where a print
 * writes its column labels (framesTopRow).
 *
 * Extracted from cellNumber because the answer is needed away from a cube as
 * well: a tag can arrive by number, from a CSV or a tag file, for a cell the
 * map does not have. Shadowdark Extras bakes this same shape into a built
 * scene's layout and will not take a record outside it, so a margin cell that
 * reaches a hand-off is rejected there rather than here — after the scene has
 * been built.
 * @param {{cols?:number, rows?:number, rowsLowered?:number, firstRow?:number}} [bounds]  no bounds = every cell counts
 * @returns {boolean}
 */
export function onMap(col, row, bounds, shifted = "odd") {
  if (numberFor(col, row) === null) return false;
  if (!bounds) return true;
  const lowered = shifted === "odd" ? col % 2 === 1 : col % 2 === 0;
  const rows = (lowered && bounds.rowsLowered) || bounds.rows;
  const first = lowered ? 0 : (bounds.firstRow ?? 0);
  return !((bounds.cols && col >= bounds.cols) || (rows && row >= rows) || row < first);
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

/** Hexes between two cubes — the usual cube distance. */
export const hexDistance = (a, b) =>
  (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

/**
 * Should the "top row is frame" box start ticked?
 *
 * The tell is the lowered columns ending EXACTLY one row short: a frame that
 * clips the field at the bottom of one parity clips it at the top of the other,
 * and on a print like the Western Reaches that top half-cell is where the
 * column labels are written — margin, not map. `alignedSceneData` already
 * assumes this when the image flow builds a scene; a map anchored by hand got
 * the opposite default and numbered a row of margin, which is how 32 label
 * cells ended up painted as regions.
 *
 * Only a DEFAULT. A stored firstRow of 0 on a map with that shape means the GM
 * unticked it, and is left alone.
 */
export function framesTopRow(bounds) {
  if (!bounds) return false;
  if (bounds.firstRow !== undefined) return bounds.firstRow === 1;
  return Number.isInteger(bounds.rowsLowered) && Number.isInteger(bounds.rows) && bounds.rowsLowered === bounds.rows - 1;
}
