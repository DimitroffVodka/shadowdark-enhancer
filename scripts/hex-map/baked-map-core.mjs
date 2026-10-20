/**
 * Baked hex maps, the pure parts (baked-map.mjs draws them).
 *
 * Shadowdark Extras bakes a painted hex map into an image pyramid: the map cut
 * into square pieces at full size (level 0) and at every halving below it, down
 * to one piece. The scene keeps the pieces' folder and `meta` in a flag in
 * Extras' namespace, and the keyed locations as sprites by hex offset. The
 * Enhancer only reads that flag; nothing here needs Extras to be installed.
 * meta = { tile, sceneRect: {x, y, width, height}, levels: [{width, height, cols, rows}] }.
 */

/** Flags a bake leaves on its scene, in Extras' namespace. */
export const BAKED_NAMESPACE = "shadowdark-extras";
export const PYRAMID_FLAG = "bakedPyramid";
export const KEYED_FLAG = "bakedKeyed";
export const pyramidOf = scene => scene?.flags?.[BAKED_NAMESPACE]?.[PYRAMID_FLAG];
/** A scene Extras baked, whether or not Extras is installed. */
export const isBakedMap = scene => !!scene?.grid?.isHexagonal && !!pyramidOf(scene)?.meta;
/** The keyed sprites a bake left, off `scene.flags` — never getFlag, which throws for a module that is not active. */
export const keyedOf = scene => scene?.flags?.[BAKED_NAMESPACE]?.[KEYED_FLAG];

/**
 * The level whose pixels match the screen best: level 0 at 1 screen px per
 * scene px or more, one level coarser for each halving below that.
 * @param {number} screenPerScene  screen pixels per scene pixel (zoom × resolution)
 * @param {number} levels          how many levels the pyramid has
 */
export function pyramidLevel(screenPerScene, levels) {
  const level = Math.floor(Math.log2(1 / screenPerScene));
  return Math.min(Math.max(level, 0), levels - 1);
}

/** One piece's picture in its level's pixels: `tile` square, cut short on the last column and row. */
export function pieceSize(meta, level, col, row) {
  const { tile } = meta, L = meta.levels[level];
  return { width: Math.min(tile, L.width - (col * tile)), height: Math.min(tile, L.height - (row * tile)) };
}

/** Where one piece sits, in scene pixels. */
export function pieceFrame(meta, level, col, row) {
  const { tile, sceneRect: r } = meta, L = meta.levels[level];
  const sx = r.width / L.width, sy = r.height / L.height, size = pieceSize(meta, level, col, row);
  return { x: r.x + (col * tile * sx), y: r.y + (row * tile * sy), width: size.width * sx, height: size.height * sy };
}

/** The pieces of `level` that overlap `view` (scene pixels), `margin` whole pieces beyond it, nearest its centre first. */
export function piecesInView(meta, level, view, margin = 1) {
  const { tile, sceneRect: r } = meta, L = meta.levels[level];
  const pw = (tile * r.width) / L.width, ph = (tile * r.height) / L.height;
  const c0 = Math.max(0, Math.floor((view.x - r.x) / pw) - margin);
  const c1 = Math.min(L.cols - 1, Math.floor((view.x + view.width - r.x) / pw) + margin);
  const r0 = Math.max(0, Math.floor((view.y - r.y) / ph) - margin);
  const r1 = Math.min(L.rows - 1, Math.floor((view.y + view.height - r.y) / ph) + margin);
  const cx = view.x + (view.width / 2), cy = view.y + (view.height / 2), out = [];
  for (let col = c0; col <= c1; col++) for (let row = r0; row <= r1; row++) out.push({ level, col, row, key: `${level}/${col}_${row}` });
  const dist = p => Math.hypot(r.x + ((p.col + 0.5) * pw) - cx, r.y + ((p.row + 0.5) * ph) - cy);
  return out.sort((a, b) => dist(a) - dist(b));
}

/**
 * The KTX2 transcode target for this GPU: desktop formats first, ASTC after.
 * Foundry's own loader tries ASTC first, but Mesa (Linux, the Steam Deck) reports
 * ASTC on GPUs without it and decodes it in software, which is many times slower.
 * @param {object} extensions  renderer.context.extensions
 * @returns {string|undefined} a libktx TranscodeTarget name; undefined leaves the choice to Foundry
 */
export function transcodeTarget(extensions) {
  if (extensions.bptc) return "BC7_RGBA";
  if (extensions.s3tc) return "BC1_OR_3";
  if (extensions.astc) return "ASTC_4x4_RGBA";
  if (extensions.etc) return "ETC2_RGBA";
  return undefined;
}

/** The offset a keyed-sprite key ("i-j") names, or null for a key that is not one. */
export function keyedOffset(key) {
  const m = /^(-?\d+)-(-?\d+)$/.exec(key);
  return m ? { i: Number(m[1]), j: Number(m[2]) } : null;
}

/**
 * How one keyed sprite shows on this client. A player sees it once the fog
 * discloses the hex's locations. The GM sees every sprite, faded where the
 * players can't, the way Foundry shows the GM a hidden tile.
 */
export function keyedSpriteView({ isGM, seen }) {
  if (isGM) return { visible: true, alpha: seen ? 1 : 0.5 };
  return { visible: seen, alpha: 1 };
}
