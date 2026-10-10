/**
 * Shadowdark Enhancer — the symbols a book's key map prints that its clean map leaves out.
 *
 * The keyed map of a Cursed Scroll shows what the clean picture hides: an S for a secret door, an L in a triangle for a locked
 * one, a B in a triangle for a barricade. A GM reviewing the clean map sees none of them. They are live text on the key map, so
 * their places are read out of the GM's own book (map-labels.mjs stitchMapLabels) and nothing ships but our own SVGs, drawn to
 * the book's own look (tools/adventure-pins/make-pins.py). Each becomes a hidden Tile: the GM sees it, the players never do.
 * (Foundry draws any hidden tile or drawing at half strength for the GM; there is no way to keep one GM-only and opaque.)
 */
import { MODULE_ID } from "../../shared/module-id.mjs";

/** Flag on every tile this module made from a key map, so a run can tell its own marks from the GM's. */
export const MARK_FLAG = "adventureMark";

/**
 * How each kind is drawn: its SVG and its size in grid squares, which is the book's own (the SVGs are in the book's points,
 * 12.34 to a square on the Cursed Scroll 1 map: the S 12.5 pt across, the L 14.6, the B 16.8). `y` is how far down the tile the
 * letter sits, so the mark's place, which is the letter's, lands on it (the middle of the square, a little above the middle of
 * a triangle, whose wide part is its upper part).
 */
export const MARK_LOOKS = {
  secret: { icon: "mark-secret", w: 1.013, h: 1.013, y: 0.5 },
  locked: { icon: "mark-locked", w: 1.183, h: 1.151, y: 0.4 },
  barricaded: { icon: "mark-barricaded", w: 1.361, h: 1.305, y: 0.43 },
};

/** The art, drawn by tools/adventure-pins/make-pins.py. */
export const markIcon = (kind) => `modules/${MODULE_ID}/icons/adventure-pins/${MARK_LOOKS[kind].icon}.svg`;

/** A mark's identity: its kind and place, so a re-run finds it again whatever order the book is read in. */
export const markKey = (m) => `${m.kind}@${Math.round(m.x * 1000)},${Math.round(m.y * 1000)}`;

/**
 * Pure: the tiles for a map's symbols, leaving out the ones already on the scene.
 * @param {{marks:Array<{kind:string,x:number,y:number}>, rect:{x:number,y:number,width:number,height:number}, gridSize:number,
 *   siteId:string, placed?:Iterable<string>}} args  marks: fractions of the map
 * @returns {{key:string, data:object}[]}
 */
export function planMarks({ marks, rect, gridSize, siteId, placed = [] }) {
  const done = new Set(placed), out = [];
  for (const m of marks ?? []) {
    const look = MARK_LOOKS[m.kind], key = markKey(m);
    if (!look || done.has(key)) continue;
    done.add(key);   // the book prints one symbol per place, but a seam can read it from both pages
    const width = Math.round(gridSize * look.w), height = Math.round(gridSize * look.h);
    out.push({
      key,
      data: {
        x: Math.round(rect.x + m.x * rect.width - width / 2), y: Math.round(rect.y + m.y * rect.height - height * look.y), width, height,
        texture: { src: markIcon(m.kind) }, hidden: true,
        flags: { [MODULE_ID]: { [MARK_FLAG]: { site: siteId, key } } },
      },
    });
  }
  return out;
}
