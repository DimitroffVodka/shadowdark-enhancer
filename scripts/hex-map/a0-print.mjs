/**
 * Shadowdark Enhancer — the Western Reaches A0 print, pure (#257, "Make this
 * map playable").
 *
 * The book's A0 map is one known image: its hex lattice is measured once, here,
 * as numbers (where the first hex centre sits, and the pitch between hexes).
 * Nothing from the book ships: no text, no pixels, no terrain (D1,
 * docs/plans/hex-map-dataset.md). With those numbers a scene showing the print
 * is numbered without asking the GM anything, however it was laid out; and the
 * steps that make it playable are planned from what the scene already has, so
 * running them again changes nothing.
 */

import { foundryOffsetToCube, cellNumber, onMap } from "./geometry.mjs";

const HEXODDQ = 4, HEXEVENQ = 5;

/** The print: its size in pixels, its lattice (image pixels), and the numbered field. */
export const A0_PRINT = Object.freeze({
  width: 9933, height: 14043, firstNum: "0000",
  lat: Object.freeze({ x0: 486.658065, y0: 196.438748, pitchX: 142.869556, pitchY: 174.427767, cols: 64, rows: 75, rowsLowered: 74, lowered: "odd" }),
  bounds: Object.freeze({ cols: 64, rows: 75, rowsLowered: 74, firstRow: 1 }),
});

/**
 * Whether an image of this size is the A0 print. By the texture's size:
 * ponytail: a GPU whose largest texture is under 14043 px gets the print
 * scaled down and isn't recognised; read the file's own size if one turns up.
 */
export const isA0 = (w, h) => w === A0_PRINT.width && h === A0_PRINT.height;

/** How many hexes the print numbers: 4736. */
export const A0_TOTAL = (() => {
  let n = 0;
  for (let col = 0; col < A0_PRINT.bounds.cols; col++) {
    for (let row = 0; row < A0_PRINT.bounds.rows; row++) if (onMap(col, row, A0_PRINT.bounds, "odd")) n++;
  }
  return n;
})();

/**
 * The A0's printed 0000 on this scene's grid, read from where the image lies.
 * Accepted only when the four corner hexes each number back to themselves and
 * none is more than a fifth of a hex off its cell's centre.
 * @param {{x:number, y:number, w:number, h:number}} rect  the image on the canvas (sampler.mjs backgroundTransform)
 * @param {{type:number, size:number}} grid
 * @returns {{origin:object, residual:number}|{reason:"notColumnHex"|"offLattice", residual?:number}}
 */
export function a0Origin(rect, grid) {
  if (grid?.type !== HEXODDQ && grid?.type !== HEXEVENQ) return { reason: "notColumnHex" };
  const kx = rect.w / A0_PRINT.width, ky = rect.h / A0_PRINT.height;
  const S = grid.size, sX = 2 * S / Math.sqrt(3), even = grid.type === HEXEVENQ;
  const { x0, y0, pitchX, pitchY } = A0_PRINT.lat;
  // Printed (col, row) → the Foundry cell under its centre, and how far off that cell's centre it is (in cells).
  const land = (col, row) => {
    const x = rect.x + (x0 + col * pitchX) * kx, y = rect.y + (y0 + (row + (col & 1) / 2) * pitchY) * ky;
    const j = Math.round((x - sX / 2) / (0.75 * sX)) + 0;
    const low = ((j & 1) === 1) !== even;
    const i = Math.round(y / S - (low ? 0.5 : 0)) + 0;
    return { i, j, off: Math.hypot(x - sX * (0.75 * j + 0.5), y - (i + (low ? 0.5 : 0)) * S) / S };
  };
  const a = land(0, 0);
  const origin = { i: a.i, j: a.j, ...foundryOffsetToCube(a, even), num: A0_PRINT.firstNum, shifted: "odd", bounds: { ...A0_PRINT.bounds } };
  const geo = { cube: { q: origin.q, r: origin.r }, num: origin.num, shifted: "odd", bounds: origin.bounds };
  let residual = 0;
  for (const [col, row] of [[0, 0], [63, 1], [0, 74], [63, 73]]) {
    const c = land(col, row), n = cellNumber(foundryOffsetToCube(c, even), geo);
    residual = Math.max(residual, c.off);
    if (n.col !== col || n.row !== row) return { reason: "offLattice", residual };
  }
  // ponytail: a fifth of a hex; the scenes measured so far sit within 0.03.
  return residual > 0.2 ? { reason: "offLattice", residual } : { origin, residual };
}

/**
 * Copy another scene's tags of the same print into this one: every tag with a
 * terrain, the classifier's as the classifier's (source, margin and review
 * kept), never over a hand tag here, never off the map. Mutates `into`.
 * @param {{cells:Map<string, object>}} into
 * @param {{cells:Map<string, object>}} from
 * @returns {number} cells added
 */
export function copyTags(into, from, bounds = A0_PRINT.bounds) {
  let added = 0;
  for (const [num, c] of from.cells) {
    const n = Number(num);
    if (!c?.terrain || !onMap(Math.floor(n / 100), n % 100, bounds, "odd")) continue;
    const mine = into.cells.get(num);
    if (mine?.terrain && mine.source !== "auto") continue;
    into.cells.set(num, { ...c, features: [...(c.features ?? [])] });
    added++;
  }
  return added;
}

/**
 * The scene to copy terrain from: another scene showing the same file with
 * the A0's numbering. The most hand tags wins, then the most tags.
 * @param {{id:string, file:string}} here
 * @param {Array<{id:string, file:string, tags:{origin:object|null, cells:Map}}>} others
 */
export function copySource(here, others) {
  const same = (s) => s.tags.origin?.num === A0_PRINT.firstNum && s.file === here.file
    && JSON.stringify(s.tags.origin?.bounds) === JSON.stringify(A0_PRINT.bounds);
  const score = (s) => {
    let gm = 0, all = 0;
    for (const c of s.tags.cells.values()) if (c.terrain) { all++; if (c.source !== "auto") gm++; }
    return [gm, all];
  };
  return others.filter((s) => s.id !== here.id && same(s))
    .map((s) => ({ s, k: score(s) })).filter((x) => x.k[1] > 0)
    .sort((a, b) => b.k[0] - a.k[0] || b.k[1] - a.k[1])[0]?.s ?? null;
}

/**
 * What "Make this map playable" runs, from what the scene has. Each step is
 * gated on its own "done", so a second run runs nothing.
 *
 * - anchor: number the print (keep the grid, or rebuild it to fit the print)
 * - copy: terrain and regions from another scene of the same print
 * - pins: the book's keyed hexes as map notes
 * - handoff: the hex records to Shadowdark Extras, once every hex has terrain
 * - fog: Extras' hex fog on, when Extras can be asked to
 * - legend: name the print's pictures, while hexes still have no terrain (last:
 *   it opens the tagger, and a second press after it does the rest)
 *
 * @param {{anchored:boolean, anchor:"keep"|"rebuild", placed:number, terrain:number, total:number,
 *   copyFrom:number, wrEntries:number, pins:number, extras:{hex:boolean, adopted:boolean, fogApi:boolean, fogOn:boolean}}} f
 * @returns {{run:string[], confirm:boolean}}  confirm: the rebuild moves the map under what is placed on it
 */
export function playablePlan(f) {
  const run = [];
  if (!f.anchored) run.push("anchor");
  const copy = f.terrain === 0 && f.copyFrom > 0;
  if (copy) run.push("copy");
  if (f.wrEntries > 0 && f.pins === 0) run.push("pins");
  const terrain = copy ? f.copyFrom : f.terrain;
  if (f.extras.hex && terrain >= f.total && !f.extras.adopted) run.push("handoff");
  if (f.extras.hex && f.extras.fogApi && !f.extras.fogOn) run.push("fog");
  if (terrain < f.total) run.push("legend");
  return { run, confirm: !f.anchored && f.anchor === "rebuild" && f.placed > 0 };
}
