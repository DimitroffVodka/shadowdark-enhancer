/**
 * Shadowdark Enhancer — hex cell sampler (Foundry-bound).
 *
 * Reads the ACTIVE scene's background image one cell at a time for the tagger
 * and the classifier: the cell's source rectangle goes through one drawImage
 * into a small reused canvas. Never a full-map canvas — the Western Reaches
 * print is 140 megapixels and exceeds browser canvas limits.
 *
 * Where the image sits is read off the drawn background sprite
 * (canvas.primary.background: position, size, anchor, texture size), which is
 * the truth of what Foundry rendered, whatever the scene's fit, scale and
 * offset fields say. Measured on the Western Reaches scene 2026-09-17: image
 * cell (0,0) lands on grid offset (0,0) within 3 px.
 *
 * Flat-top column grids only in this pass; a pointy-row scene is refused with
 * a message (the numbering rule for those is unverified).
 */

import { foundryOffsetToCube } from "./geometry.mjs";

/** Scene → image transform from the drawn background sprite, or null. */
export function backgroundTransform(canvasRef = globalThis.canvas) {
  const bg = canvasRef?.primary?.background;
  const tex = bg?.texture;
  if (!bg || !tex?.width || !tex?.height) return null;
  const ax = bg.anchor?.x ?? 0, ay = bg.anchor?.y ?? 0;
  const rect = { x: bg.x - bg.width * ax, y: bg.y - bg.height * ay, w: bg.width, h: bg.height };
  const texW = tex.width, texH = tex.height;
  return {
    rect, texW, texH,
    scaleU: texW / rect.w, scaleV: texH / rect.h,
    toImage: (x, y) => ({ u: (x - rect.x) / rect.w * texW, v: (y - rect.y) / rect.h * texH }),
  };
}

/**
 * Every grid cell whose centre lies inside the background image.
 * @returns {{error:string}|{cells:object[], transform:object, cellW:number, cellH:number, even:boolean}}
 */
export function sceneCells(canvasRef = globalThis.canvas) {
  const grid = canvasRef?.grid, scene = canvasRef?.scene;
  if (!scene || !grid?.isHexagonal) return { error: "The active scene does not use a hexagonal grid." };
  if (!grid.columns) return { error: "Only flat-top column hex grids are supported in this version; this scene uses pointy-top rows." };
  const transform = backgroundTransform(canvasRef);
  if (!transform) return { error: "The active scene has no background image, or it has not finished loading." };
  const r = scene.dimensions.sceneRect;
  const tl = grid.getOffset({ x: r.x, y: r.y });
  const br = grid.getOffset({ x: r.x + r.width, y: r.y + r.height });
  const even = !!grid.even;
  const cells = [];
  for (let i = tl.i - 1; i <= br.i + 1; i++) {
    for (let j = tl.j - 1; j <= br.j + 1; j++) {
      const c = grid.getCenterPoint({ i, j });
      const { u, v } = transform.toImage(c.x, c.y);
      if (u < 0 || v < 0 || u >= transform.texW || v >= transform.texH) continue;
      cells.push({ i, j, x: c.x, y: c.y, u, v, cube: foundryOffsetToCube({ i, j }, even), num: null });
    }
  }
  return { cells, transform, cellW: grid.sizeX * transform.scaleU, cellH: grid.sizeY * transform.scaleV, even };
}

/**
 * The decoded background image Foundry already holds, else a fresh load of the
 * scene's background source. Both draw with drawImage.
 * @returns {Promise<CanvasImageSource>}
 */
export async function sourceImage(canvasRef = globalThis.canvas) {
  const src = canvasRef?.primary?.background?.texture?.baseTexture?.resource?.source;
  if (src && (src instanceof HTMLImageElement || (globalThis.ImageBitmap && src instanceof ImageBitmap) || src instanceof HTMLCanvasElement)) return src;
  const path = canvasRef?.scene?.background?.src;
  if (!path) throw new Error("The scene has no background image.");
  const img = new Image();
  img.decoding = "async";
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error(`Could not load ${path}`)); img.src = path; });
  return img;
}

/**
 * Per-cell reads off one reused canvas.
 */
export class CellSampler {
  /**
   * @param {CanvasImageSource} image
   * @param {{cellW:number, cellH:number}} geom
   * @param {{size?:number, threshold?:number}} [opts]  size = classification bitmap WIDTH (the height keeps
   *   the cell's aspect, so the classifier's area-based calibration holds), threshold = grey level below which a pixel is ink
   */
  constructor(image, geom, { size = 96, threshold = 110 } = {}) {
    this.image = image; this.geom = geom; this.threshold = threshold;
    this.w = size;
    this.h = Math.max(8, Math.round(size * geom.cellH / geom.cellW));
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  /** 0/1 ink bitmap of the cell's bounding box, w × h with the cell's aspect. Throws on a tainted (cross-origin) image. */
  bitmap(cell) {
    const { cellW, cellH } = this.geom, w = this.w, h = this.h, ctx = this.ctx;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.image, cell.u - cellW / 2, cell.v - cellH / 2, cellW, cellH, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const g = (data[p * 4] * 299 + data[p * 4 + 1] * 587 + data[p * 4 + 2] * 114) / 1000;
      out[p] = g < this.threshold ? 1 : 0;
    }
    return { w, h, data: out };
  }

  /** PNG data URL of the cell plus a margin of its neighbours, for the contact sheet. */
  /**
   * The cell as a picture, clipped to the hexagon the classifier reads.
   *
   * It used to draw a 20% margin of the surrounding map, which put the
   * neighbours' glyphs and their printed numbers in every picture. Patrick,
   * looking at a legend card: "we didn't change the 4 boxes." He names a card
   * from these four pictures and the classifier groups cells by what is inside
   * the hexagon; showing him more than that asks him to judge one thing while
   * the module judges another, and a card named from a neighbour's tree is
   * exactly how a core ends up mislabelled.
   *
   * `shrink` matches classify.mjs's FEATURE_SHRINK: the same hexagon, drawn a
   * little inside the printed outline because the outline is shared.
   */
  thumbnail(cell, px = 96, { margin = 0, shrink = 0.88 } = {}) {
    const { cellW, cellH } = this.geom;
    const c = document.createElement("canvas"); c.width = px; c.height = px;
    const ctx = c.getContext("2d");
    const w = cellW * (1 + 2 * margin), h = cellH * (1 + 2 * margin);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, px, px);
    if (shrink) {
      // the flat-top hexagon of cellMasks(..., { shrink }).inhex, as a path:
      // vertices at (±s, 0) and (±s/2, ±s) in the cell's own -1..1 frame
      const s = shrink, half = px / 2;
      const at = (x, y) => [half * (1 + x / (1 + 2 * margin)), half * (1 + y / (1 + 2 * margin))];
      ctx.beginPath();
      [[s, 0], [s / 2, -s], [-s / 2, -s], [-s, 0], [-s / 2, s], [s / 2, s]]
        .forEach(([x, y], i) => { const [px2, py] = at(x, y); i ? ctx.lineTo(px2, py) : ctx.moveTo(px2, py); });
      ctx.closePath(); ctx.clip();
    }
    ctx.drawImage(this.image, cell.u - w / 2, cell.v - h / 2, w, h, 0, 0, px, px);
    return c.toDataURL("image/png");
  }
}
