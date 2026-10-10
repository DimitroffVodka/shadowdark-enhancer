/**
 * Shadowdark Enhancer — where the book puts each room number on its own map.
 *
 * Pure. A Cursed Scroll's keyed map is one picture per page with the room numbers
 * as text over it (pdf-text-extract.mjs readPageMap), a two-page spread for the
 * big dungeons. This turns those reads into one point per number as a fraction of
 * the whole map (0..1 across and down), which is what a scene of the same map
 * needs, whatever size the GM's copy of the image is. The module reads the GM's
 * own PDF in their own browser and ships no coordinates.
 */

/** How far (as a fraction) the GM's image may differ in shape from the book's map. */
export const ASPECT_TOLERANCE = 0.03;

/** Pages of one map may differ in height by this much and still be one map. */
const HEIGHT_TOLERANCE = 0.02;

/** What the letter in a symbol on a keyed map means (the book's legend: S secret door, L locked, B barricaded). */
export const MARK_KINDS = { S: "secret", L: "locked", B: "barricaded" };

/**
 * Stitch the page reads of one map, left to right, into one set of points.
 * @param {Array<{box:{x:number,y:number,w:number,h:number}|null, upright:boolean, labels:Array<{num:number,cx:number,cy:number}>, marks?:Array<{letter:string,cx:number,cy:number}>, legend?:string[]}>} reads
 * @returns {{points:Map<number,{x:number,y:number}>, aspect:number, marks:Array<{kind:string,x:number,y:number}>}|null}
 *   marks: the map's symbols (secret doors, locked doors, barricades) as fractions of the whole map; a letter counts only when
 *   a legend somewhere on the spread explains it, so a creature's letter on another book's map is never taken for a door
 *   null when a page has no picture, one is turned or flipped, or the pages are not one height
 */
export function stitchMapLabels(reads) {
  if (!reads?.length || reads.some((r) => !r?.box || !r.upright)) return null;
  const height = reads[0].box.h;
  if (reads.some((r) => Math.abs(r.box.h - height) / height > HEIGHT_TOLERANCE)) return null;
  const width = reads.reduce((sum, r) => sum + r.box.w, 0);
  const points = new Map();
  const legend = new Set(reads.flatMap((r) => r.legend ?? []));
  const marks = [];
  let left = 0;
  for (const { box, labels, marks: found = [] } of reads) {
    for (const { num, cx, cy } of labels) {
      if (points.has(num)) continue;   // a label the book repeats across the seam: the first one stands
      points.set(num, { x: (left + (cx - box.x)) / width, y: (box.y + box.h - cy) / box.h });
    }
    for (const { letter, cx, cy } of found) {
      if (legend.has(letter)) marks.push({ kind: MARK_KINDS[letter], x: (left + (cx - box.x)) / width, y: (box.y + box.h - cy) / box.h });
    }
    left += box.w;
  }
  return { points, aspect: width / height, marks };
}

/**
 * Is the GM's scene the same shape as the book's map?
 * @param {number} bookAspect  width / height of the book's map
 * @param {number} width       the scene's image width
 * @param {number} height      the scene's image height
 */
export const mapFits = (bookAspect, width, height) =>
  width > 0 && height > 0 && Math.abs(width / height / bookAspect - 1) <= ASPECT_TOLERANCE;

/**
 * A key map picture is not always the clean map: the book may crop it, or lay a legend over its edge, so the clean map spans a
 * different rectangle of the picture. Pure: marks re-expressed as fractions of the clean map, those outside it dropped.
 * @param {{marks:Array<{kind:string,x:number,y:number}>, aspect:number}} map  stitchMapLabels of the key map
 * @param {[number,number,number,number]} [frame]  [x, y, width, height] of the clean map as fractions of the key map picture;
 *   absent: the two are the same rectangle
 * @returns {{marks:Array<{kind:string,x:number,y:number}>, aspect:number}}
 */
export function clipToFrame(map, frame) {
  if (!frame) return map;
  const [fx, fy, fw, fh] = frame;
  const marks = map.marks.map((m) => ({ ...m, x: (m.x - fx) / fw, y: (m.y - fy) / fh })).filter((m) => m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1);
  return { ...map, marks, aspect: (map.aspect * fw) / fh };
}
