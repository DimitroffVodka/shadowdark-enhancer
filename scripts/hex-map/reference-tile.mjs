/**
 * Shadowdark Enhancer — the hidden reference tile (Phase 4 of
 * docs/plans/hex-map-dataset.md §9.2).
 *
 * After the dataset becomes a painted Extras scene, the GM still needs the
 * original print to trace rivers and roads. This puts the tagged scene's
 * background on the target scene as one Tile, placed so the print's hex field
 * (columns 0..cols-1, rows 0..rows-1 as numbered by the tagger) lands on the
 * target's first cols × rows cells. The two rectangles absorb a stretched
 * print (the Western Reaches hexes are 5.7% taller than regular): the tile's
 * width and height scale independently.
 *
 * The tile is hidden, locked, half transparent and sorted above the painted
 * tiles (Extras sorts those by their centre y, so a large constant wins);
 * the plan's `sort: -1` would have put it under the opaque terrain where it
 * could not be traced. Hidden tiles are still sent to player clients with the
 * image's URL: the GM deletes the tile when tracing is done (documented).
 *
 * The print's margin means the image's top-left lands above and left of the
 * scene, and Foundry 14 clamps a tile's x and y to the scene in
 * TileDocument#prepareDerivedData (measured: -235 came back 0). So the tile
 * sits at the origin and the texture anchor carries the negative part: the
 * mesh is positioned at (x, y) with its anchor at (anchorX, anchorY) of its
 * own size, so anchor = (x - ideal.x) / width puts the image's corner where
 * the placement asked. Verified on the Western Reaches print 2026-09-18.
 *
 * Everything here takes the scene as an argument; no globals.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** Tile flag marking the reference tile, so a second placement updates it. */
export const REFERENCE_FLAG = "hexReference";
export const REFERENCE_SORT = 1_000_000;

/**
 * Bounding box of cells given their centres and one cell's box size.
 * @param {{x:number,y:number}[]} centres
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function cellBoxOf(centres, cellW, cellH) {
  if (!centres?.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of centres) { minX = Math.min(minX, c.x); minY = Math.min(minY, c.y); maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y); }
  return { x: minX - cellW / 2, y: minY - cellH / 2, w: maxX - minX + cellW, h: maxY - minY + cellH };
}

/**
 * Tile rectangle so that `cellBoxImage` (image pixels) lands on `cellBoxScene`
 * (scene pixels), with the whole image scaled the same way.
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function referenceTilePlacement(imageRect, cellBoxImage, cellBoxScene) {
  const sx = cellBoxScene.w / cellBoxImage.w, sy = cellBoxScene.h / cellBoxImage.h;
  return {
    x: cellBoxScene.x - (cellBoxImage.x - imageRect.x) * sx,
    y: cellBoxScene.y - (cellBoxImage.y - imageRect.y) * sy,
    width: imageRect.w * sx,
    height: imageRect.h * sy,
  };
}

/**
 * Scene-pixel box of the target scene's first cols × rows cells, from its
 * grid. The corner cells of both parities are taken, so the box is the same
 * whether the odd or the even columns are the lowered ones. Null when the
 * scene has no flat-top column grid.
 */
export function gridCellBox(scene, cols, rows) {
  const grid = scene?.grid;
  if (!grid?.isHexagonal || !grid.columns || !(cols > 0 && rows > 0)) return null;
  // Foundry centres a column grid's row 0 on the scene rect's top edge (its
  // top half lies in the padding), so the first cell's centre is at
  // (left + sizeX/2, top): an unambiguous point for getOffset.
  const r = scene.dimensions.sceneRect;
  const tl = grid.getOffset({ x: r.x + grid.sizeX / 2, y: r.y });
  const corners = [[0, 0], [0, 1], [rows - 1, cols - 1], [rows - 1, cols - 2]]
    .filter(([, j]) => j >= 0 && j < cols)
    .map(([i, j]) => grid.getCenterPoint({ i: tl.i + i, j: tl.j + j }));
  return cellBoxOf(corners, grid.sizeX, grid.sizeY);
}

/** "odd" or "even": which columns the scene's grid lowers. */
export function loweredColumns(scene) {
  return scene?.grid?.even ? "even" : "odd";
}

/**
 * Tile fields for an ideal rectangle that may start above or left of the
 * scene: position clamped to the origin, the texture anchor carrying the rest.
 * @returns {{x:number,y:number,width:number,height:number,texture:{anchorX:number,anchorY:number}}}
 */
export function tileData(placement) {
  const x = Math.max(0, placement.x), y = Math.max(0, placement.y);
  return {
    x, y, width: placement.width, height: placement.height,
    texture: { anchorX: (x - placement.x) / placement.width, anchorY: (y - placement.y) / placement.height },
  };
}

/**
 * Create the reference tile on `scene`, or move the one already there.
 * @param {Scene} scene
 * @param {string} src   image path
 * @param {{x:number,y:number,width:number,height:number}} placement
 * @returns {Promise<TileDocument>}
 */
export async function placeReferenceTile(scene, src, placement) {
  const t = tileData(placement);
  const data = {
    ...t, texture: { src, fit: "fill", scaleX: 1, scaleY: 1, ...t.texture },
    hidden: true, locked: true, alpha: 0.5, sort: REFERENCE_SORT,
    flags: { [MODULE_ID]: { [REFERENCE_FLAG]: true } },
  };
  const existing = scene.tiles?.find?.((t) => t.getFlag?.(MODULE_ID, REFERENCE_FLAG));
  if (existing) { await existing.update(data); return existing; }
  const [tile] = await scene.createEmbeddedDocuments("Tile", [data]);
  return tile;
}
