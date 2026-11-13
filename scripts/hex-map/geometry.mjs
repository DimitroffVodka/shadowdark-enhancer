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

/** The origin `cellNumber` takes, from the one stored on a scene (flags.shadowdark-enhancer.hexTags.origin). */
export function originFromFlag(o) {
  return { cube: { q: o.q, r: o.r }, num: o.num, shifted: o.shifted ?? "odd", bounds: o.bounds };
}

/**
 * The origin with its anchor cell given a different printed number. The cell stays the cell.
 *
 * Two things follow the number. When the anchor was the map's first hex its counts start from
 * the new number (bounds.base). And the print's lowered columns are physical, so moving the
 * anchor an odd number of columns swaps which printed parity `shifted` names.
 * @param {{num:string|number, shifted?:"odd"|"even", bounds?:object|null}} origin  not modified
 * @param {string} num  the new printed number, 3 or 4 digits
 * @returns {object|null} null when either number is not a hex number
 */
export function withAnchorNumber(origin, num) {
  const was = originOffset(origin), now = originOffset({ num });
  if (!was || !now) return null;
  let bounds = origin.bounds;
  if (bounds && was.col === (bounds.base?.col ?? 0) && was.row === (bounds.base?.row ?? 0)) {
    bounds = { ...bounds };
    delete bounds.base;
    if (now.col || now.row) bounds.base = now;
  }
  const shifted = origin.shifted ?? "odd";
  return { ...origin, num, bounds, shifted: (now.col - was.col) % 2 ? (shifted === "odd" ? "even" : "odd") : shifted };
}

/**
 * Number a cell from its Foundry cube and the origin.
 * @param {{q:number, r:number}} cube          Foundry cube of the cell
 * @param {{cube:{q:number,r:number}, num:string|number, shifted?:"odd"|"even", bounds?:{cols:number, rows:number, rowsLowered?:number, firstRow?:number, base?:{col:number,row:number}}}} origin
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
 * @param {{cols?:number, rows?:number, rowsLowered?:number, firstRow?:number, base?:{col:number,row:number}}} [bounds]  no bounds = every cell counts.
 *   base: the printed (col, row) the counts start from — the map's first number (0001 gives {col:0, row:1}). Absent
 *   is 0000; the Western Reaches and every map anchored by hand keep it that way.
 * @returns {boolean}
 */
export function onMap(col, row, bounds, shifted = "odd") {
  if (numberFor(col, row) === null) return false;
  if (!bounds) return true;
  // Counts run from the map's first printed number. Which columns are lowered
  // is still the PRINTED column's parity, since that is what `shifted` names.
  const c = col - (bounds.base?.col ?? 0), r = row - (bounds.base?.row ?? 0);
  const lowered = shifted === "odd" ? col % 2 === 1 : col % 2 === 0;
  const rows = (lowered && bounds.rowsLowered) || bounds.rows;
  const first = lowered ? 0 : (bounds.firstRow ?? 0);
  return !(c < 0 || (bounds.cols && c >= bounds.cols) || (rows && r >= rows) || r < first);
}

/**
 * The map's first and last hexes, padded as printed ("0001", "1014"), for telling a GM where the map ends: the first
 * hex of its first column and the last of its last, whichever rows those columns really have (onMap).
 * Null without bounds: such a map has no edge.
 */
export function mapRange(bounds, shifted = "odd") {
  if (!bounds?.cols || !bounds?.rows) return null;
  const col = bounds.base?.col ?? 0, row = bounds.base?.row ?? 0, end = col + bounds.cols - 1;
  const rows = [...Array(Math.max(bounds.rows, bounds.rowsLowered ?? 0)).keys()].map((k) => row + k);
  const first = rows.find((r) => onMap(col, r, bounds, shifted)), last = rows.findLast((r) => onMap(end, r, bounds, shifted));
  if (first === undefined || last === undefined) return null;
  const pad = (n) => String(n).padStart(4, "0");
  return { first: pad(numberFor(col, first)), last: pad(numberFor(end, last)) };
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

/**
 * Does Shadowdark Extras number this scene's cells the way the tagger does?
 *
 * Extras adopts a scene (adoptHexcrawl, shadowdark-extras#147) on a fixed rule:
 * printed (col, row) is Foundry offset {i: row - base, j: col - base} on a
 * HEXODDQ grid, so the map's first hex has to be the scene's top-left cell and
 * the columns the print lowers have to be the ones Foundry lowers. The tagger
 * numbers from wherever the GM anchored, so the two can disagree, and Extras
 * cannot tell: every record would land on a real cell, the wrong one. The first
 * hex fixes the position and its neighbours in the next column and row fix the
 * parity, so three cells decide the whole lattice.
 * @param {{cube:{q:number,r:number}, num:string|number, shifted?:"odd"|"even"}} origin  the tagger's anchor
 * @param {0|1} base  the map's numbering origin (grid.origin; 1 when absent)
 * @returns {boolean}
 */
export function extrasNumbersAlike(origin, base) {
  const a = originOffset(origin);
  if (!a || !origin?.cube) return false;
  const shifted = origin.shifted ?? "odd";
  const at = offsetToCube(a.col, a.row, shifted);
  return [[base, base], [base + 1, base], [base, base + 1]].every(([col, row]) => {
    const c = offsetToCube(col, row, shifted);
    // The tagger's cubes are Foundry's (foundryOffsetToCube, odd parity on a
    // HEXODDQ scene), so the odd rule turns one back into its Foundry offset.
    const f = cubeToOffset({ q: c.q - at.q + origin.cube.q, r: c.r - at.r + origin.cube.r }, "odd");
    return f.col === col - base && f.row === row - base;
  });
}

/**
 * The tag anchor (flags.shadowdark-enhancer.hexTags.origin) for a scene Shadowdark Extras built, read from its layout:
 * Extras puts its first hex at Foundry offset {0, 0} of a HEXODDQ grid, numbered from `origin` (0000 or 0101). The
 * lowered columns are whichever parity makes the Enhancer number every cell as Extras does (extrasNumbersAlike).
 * Null for a layout it can't number the same way: flipped, landscape, or without a size.
 * @param {{cols:number, rows:number, origin?:0|1, firstRow?:number, rowsLowered?:number}} layout  Extras' hexcrawl grid
 * @returns {object|null}
 */
export function extrasOrigin(layout) {
  if (!(layout?.cols > 0) || !(layout?.rows > 0) || layout.flipX || layout.flipY || layout.landscape) return null;
  const base = layout.origin ?? 1, { q, r } = foundryOffsetToCube({ i: 0, j: 0 }, false);
  const bounds = { cols: layout.cols, rows: layout.rows };
  if (base) bounds.base = { col: base, row: base };
  if (Number.isInteger(layout.rowsLowered) && layout.rowsLowered !== layout.rows) bounds.rowsLowered = layout.rowsLowered;
  // Extras gives the first row as printed; the bounds count from the map's first number.
  if (Number.isInteger(layout.firstRow) && layout.firstRow !== base) bounds.firstRow = layout.firstRow - base;
  for (const shifted of ["odd", "even"]) {
    const flag = { i: 0, j: 0, q, r, num: base ? "0101" : "0000", shifted, bounds };
    if (extrasNumbersAlike(originFromFlag(flag), base)) return flag;
  }
  return null;
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

/**
 * The bounds the tagger's "Map size" row stores when Apply is pressed.
 *
 * The frame box is stored either way. Left out when unticked, the next render guesses it back
 * from the row counts (framesTopRow) and ticks it, and the second Apply drops the whole top row
 * of a print like The Gloaming, whose first row is full hexes.
 * @param {{cols:number, rows:number, skipTop:boolean, old?:object|null}} row
 *   old: the bounds so far. The lowered columns keep ending the same number of rows short, and the base
 *   (where the numbers start) is not on this row, so both carry over.
 * @returns {object|null} null when the size is blank
 */
export function boundsFromRow({ cols, rows, skipTop, old }) {
  if (!(cols > 0 && rows > 0)) return null;
  const short = old?.rowsLowered && old.rows ? old.rows - old.rowsLowered : 0;
  return {
    cols, rows,
    ...(short > 0 && rows > short ? { rowsLowered: rows - short } : {}),
    firstRow: skipTop ? 1 : 0,
    ...(old?.base ? { base: old.base } : {}),
  };
}
