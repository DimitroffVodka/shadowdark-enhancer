/**
 * Baked hex maps, the pure parts (baked-map.mjs draws them, bake-map.mjs makes them).
 *
 * A bake is an image pyramid: the map cut into square pieces at full size (level 0) and at every halving below it,
 * down to one piece, as KTX2 files in the world's folder. The scene keeps the pieces' folder and `meta` in a flag,
 * and the keyed locations as sprites by hex offset, so each shows only when the fog discloses its hex.
 * meta = { tile, sceneRect: {x, y, width, height}, levels: [{width, height, cols, rows}] }.
 *
 * The Enhancer bakes its own drawn maps into its own namespace; a map Shadowdark Extras baked keeps its flags in
 * Extras' namespace, and is drawn the same way, without Extras installed.
 *
 * pyramidLevels, padPiece and mipChain come from Shadowdark Extras' hex-bake-core.mjs (MIT, (c) 2025 gmdima; see
 * CREDITS.md), as do the drawing helpers below.
 */

/** Where a bake's flags live: the Enhancer's own first, then a bake Shadowdark Extras made. */
export const BAKED_NAMESPACES = ["shadowdark-enhancer", "shadowdark-extras"];
export const PYRAMID_FLAG = "bakedPyramid";
export const KEYED_FLAG = "bakedKeyed";
/** The flag block holding a scene's bake, off `scene.flags`: never getFlag, which throws for a module that is not active. */
const bakedFlags = scene => BAKED_NAMESPACES.map(n => scene?.flags?.[n]).find(f => f?.[PYRAMID_FLAG]?.meta);
export const pyramidOf = scene => bakedFlags(scene)?.[PYRAMID_FLAG];
/** A baked hex map, whoever baked it and whether or not Extras is installed. */
export const isBakedMap = scene => !!scene?.grid?.isHexagonal && !!pyramidOf(scene)?.meta;
/** The keyed sprites a bake left: from the namespace holding its pyramid, else the first that has any. */
export const keyedOf = scene => (bakedFlags(scene) ?? BAKED_NAMESPACES.map(n => scene?.flags?.[n]).find(f => f?.[KEYED_FLAG]))?.[KEYED_FLAG];

/**
 * The levels of a pyramid over a `width` × `height` picture: full size, then halved (rounding up) until a level fits
 * in one piece.
 * @returns {Array<{width:number, height:number, cols:number, rows:number}>}
 */
export function pyramidLevels(width, height, tile) {
  const levels = [];
  for (;;) {
    const cols = Math.ceil(width / tile), rows = Math.ceil(height / tile);
    levels.push({ width, height, cols, rows });
    if (cols === 1 && rows === 1) return levels;
    width = Math.ceil(width / 2);
    height = Math.ceil(height / 2);
  }
}

/**
 * Fills a square piece's padding in place: the picture sits top-left, `width` × `height` of `size` × `size` RGBA
 * pixels, and the rest repeats its last column and row, so filtering at the picture's edge never reaches past it.
 * Compressed formats want whole squares, so edge pieces are padded.
 * @returns {Uint8Array} the same pixels
 */
export function padPiece(pixels, size, width, height) {
  const row = size * 4;
  for (let y = 0; y < height; y++) {
    const edge = (y * row) + ((width - 1) * 4);
    for (let x = width; x < size; x++) pixels.copyWithin((y * row) + (x * 4), edge, edge + 4);
  }
  const last = (height - 1) * row;
  for (let y = height; y < size; y++) pixels.copyWithin(y * row, last, last + row);
  return pixels;
}

/**
 * A square RGBA picture and its mip levels down to 1 px, each averaging 2 × 2 pixels of the last, as WebGL's
 * generateMipmap does: on the stored values (Foundry draws in gamma space) and on premultiplied pixels (so edges don't
 * darken).
 * @returns {Uint8Array[]} level 0 first
 */
export function mipChain(pixels, size) {
  const out = [pixels];
  for (let s = size >> 1, src = pixels; s >= 1; s >>= 1) {
    const dst = new Uint8Array(s * s * 4), stride = s * 8;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const a = (y * 2 * stride) + (x * 8), b = a + stride, o = ((y * s) + x) * 4;
        for (let c = 0; c < 4; c++) dst[o + c] = (src[a + c] + src[a + 4 + c] + src[b + c] + src[b + 4 + c] + 2) >> 2;
      }
    }
    out.push(dst);
    src = dst;
  }
  return out;
}

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
