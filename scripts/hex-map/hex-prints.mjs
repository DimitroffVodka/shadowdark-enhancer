/**
 * Shadowdark Enhancer — what is known about each book's hex map, pure (no book content).
 *
 * The import wizard sets up a hex map without asking, so for each print it needs the few facts a GM would
 * otherwise type into the confirm window: which book's key locations pin onto it and where that book's crawls are
 * filed, the number printed on its first hex, and for the prints whose grid the finder cannot read, the grid itself.
 * Each is a number or a name, never a pixel of the print or a line of text.
 *
 *   keySrc    the source key whose key locations (importKeyLocations) belong on this map
 *   folder    the folder name (sourceFolderName) its crawl entries are filed under
 *   firstNum  the printed number of the top-left hex, when it is not 0000. The Gloaming, The Djurum and the Isles
 *             of Andrik are 0001 (columns count from 0, rows from 1); on all 62 keyed hexes of those three books
 *             each number lands on the hex the map outlines (docs/wiki/Hex-Maps.md, Numbering the map to match).
 *   grid      a measured lattice, for a print the finder cannot read (a black ground, or white lines on black), in
 *             the same terms as the A0's (a0-print.mjs): the centre of the first cell and the two pitches, in pixels
 *             of a print of `size`, with the field's shape. A file of any other size is not this print, and the
 *             wizard says "needs a look" instead of trusting numbers measured on another one.
 *   join      a print that ships as two files: both are `width` by `height`, and the second sits `dy` pixels below the
 *             first so the two lattices are one (dy is whole rows of the grid, and the halves' own margins overlap).
 *             `size` is then the joined image's.
 *
 * Measured 2026-10-06 from the Arcane Library downloads (CS4 V1-4, CS5 V1-3) with the module's own outline-support
 * score: each pitch is the same on both CS4 halves to 0.1 px and on CS5's VTT and full-resolution files to 0.5 px, the
 * hexes are regular (pitchX / pitchY = 0.8660 within 0.3%), and every cell of the field scores 0.9 or better. The
 * numbering was settled against the books' own key: the 23 keyed hexes of Morzomotha are exactly the 23 cells whose
 * outline is 11 px or wider (the rest are 4 to 6), and with this numbering every one of them is one of the 23; on the
 * Black River all 36 keyed hexes land on outlined art hexes, in both halves and across the join.
 * The Western Reaches A0 is not here: its lattice is a0-print.mjs.
 */

export const HEX_PRINTS = Object.freeze({
  "hex-wr":  { keySrc: "GMWR", folder: "Western Reaches" },
  "hex-cs1": { keySrc: "CS1", folder: "CS1", firstNum: "0001" },
  "hex-cs2": { keySrc: "CS2", folder: "CS2", firstNum: "0001" },
  "hex-cs3": { keySrc: "CS3", folder: "CS3", firstNum: "0001" },
  // The Black River: two 2250 x 1674 halves of 11 rows each; the south half's lowered columns end one row short.
  // Like The Gloaming, its first column is the lowered one and its key starts at column 0, row 1.
  "hex-cs4": {
    keySrc: "CS4", folder: "CS4", firstNum: "0001",
    size: Object.freeze([2250, 3169]),
    join: Object.freeze({ width: 2250, height: 1674, dy: 1495 }),
    grid: Object.freeze({
      lat: Object.freeze({ x0: 185.82, y0: 210.6, pitchX: 117.53, pitchY: 135.93, lowered: "even" }),
      cols: 17, rows: 22, rowsLowered: 21, frameCut: false,
    }),
  },
  // Morzomotha: black with white paths. It has The Gloaming's shape and numbering: the first visible hex of every column
  // is row 1, the even columns sit half a row lower, 11 rows with the lowered columns one short, nothing cut by the
  // frame. (The finder's own reading puts the first cell half a hex above the field, as on the A0, and a number
  // counted from there lands every keyed hex a row under its outlined hex.)
  "hex-cs5": {
    keySrc: "CS5", folder: "CS5", firstNum: "0001",
    size: Object.freeze([4500, 3348]),
    grid: Object.freeze({
      lat: Object.freeze({ x0: 290.0, y0: 402.1, pitchX: 244.15, pitchY: 282.1, lowered: "even" }),
      cols: 17, rows: 11, rowsLowered: 10, frameCut: false,
    }),
  },
});

/** The facts for a hex map id, or null for a map this module knows nothing about. */
export const hexPrint = (id) => HEX_PRINTS[String(id).split(":")[0]] ?? null;

/** Which known-grid print is an image of this size (two pixels either way), or null. */
export function printBySize(w, h) {
  const near = (a, b) => Math.abs(a - b) <= 2;
  for (const [id, p] of Object.entries(HEX_PRINTS)) if (p.grid && !p.join && near(w, p.size[0]) && near(h, p.size[1])) return { id, ...p };
  return null;
}

/**
 * The answer the confirm window would have given for a print with a measured grid: what sceneDataFromAnswer reads.
 * @param {string} id  a hex map id (hex-prints.mjs)
 * @returns {{lat:object, cols:number, rows:number, rowsLowered:number, lowered:"odd"|"even", firstNum:string}|null}
 */
export function knownAnswer(id) {
  const p = hexPrint(id);
  if (!p?.grid) return null;
  const { lat, cols, rows, rowsLowered, frameCut } = p.grid;
  return { lat: { ...lat, cols, rows, rowsLowered, frameCut }, cols, rows, rowsLowered: rowsLowered !== rows ? rowsLowered : undefined, lowered: lat.lowered, firstNum: p.firstNum ?? "0000" };
}
