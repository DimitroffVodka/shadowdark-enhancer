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

/**
 * Stitch the page reads of one map, left to right, into one set of points.
 * @param {Array<{box:{x:number,y:number,w:number,h:number}|null, upright:boolean, labels:Array<{num:number,cx:number,cy:number}>}>} reads
 * @returns {{points:Map<number,{x:number,y:number}>, aspect:number}|null}
 *   null when a page has no picture, one is turned or flipped, or the pages are not one height
 */
export function stitchMapLabels(reads) {
  if (!reads?.length || reads.some((r) => !r?.box || !r.upright)) return null;
  const height = reads[0].box.h;
  if (reads.some((r) => Math.abs(r.box.h - height) / height > HEIGHT_TOLERANCE)) return null;
  const width = reads.reduce((sum, r) => sum + r.box.w, 0);
  const points = new Map();
  let left = 0;
  for (const { box, labels } of reads) {
    for (const { num, cx, cy } of labels) {
      if (points.has(num)) continue;   // a label the book repeats across the seam: the first one stands
      points.set(num, { x: (left + (cx - box.x)) / width, y: (box.y + box.h - cy) / box.h });
    }
    left += box.w;
  }
  return { points, aspect: width / height };
}

/**
 * Is the GM's scene the same shape as the book's map?
 * @param {number} bookAspect  width / height of the book's map
 * @param {number} width       the scene's image width
 * @param {number} height      the scene's image height
 */
export const mapFits = (bookAspect, width, height) =>
  width > 0 && height > 0 && Math.abs(width / height / bookAspect - 1) <= ASPECT_TOLERANCE;
