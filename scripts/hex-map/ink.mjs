/**
 * Shadowdark Enhancer — whole-image ink bitmap (browser-bound).
 *
 * Turns a map image into the 0/1 ink array lattice.mjs reads, at a reduced
 * scale, drawn in horizontal strips through one small canvas so a 140-megapixel
 * print never needs a full-size canvas. Same-origin images only (a data-dir
 * file or a File the GM picked); a cross-origin image taints the canvas and
 * getImageData throws.
 */

/**
 * Ink threshold from the grey histogram: the paper's bright mode minus a
 * margin. The Western Reaches print draws its hex outlines in light grey
 * (median 191 of 255 at half scale, the paper at 240 and up), so a fixed
 * glyph threshold of 110 kept the glyphs and lost the grid.
 */
export function autoThreshold(hist) {
  let paper = 255, best = -1;
  for (let g = 128; g < 256; g++) if (hist[g] > best) { best = hist[g]; paper = g; }
  return Math.min(235, Math.max(100, paper - 28));
}

/**
 * @param {CanvasImageSource} image  decoded image (HTMLImageElement, ImageBitmap, canvas)
 * @param {object} [opts]
 * @param {number} [opts.scale=0.5]      working scale; the caller divides the detected lattice by it
 * @param {number|"auto"} [opts.threshold="auto"]  grey level below which a pixel is ink; "auto" reads the paper
 * @param {number} [opts.strip=256]      rows per strip at working scale
 * @param {(done:number, total:number)=>Promise<void>|void} [opts.onProgress]
 * @returns {Promise<{ink:Uint8Array, w:number, h:number, scale:number, threshold:number}>}
 */
export async function imageInk(image, { scale = 0.5, threshold = "auto", strip = 256, onProgress } = {}) {
  const srcW = image.naturalWidth ?? image.width, srcH = image.naturalHeight ?? image.height;
  const w = Math.max(1, Math.round(srcW * scale)), h = Math.max(1, Math.round(srcH * scale));
  const ink = new Uint8Array(w * h);            // grey first, thresholded in place at the end
  const hist = new Uint32Array(256);
  // One resize through the browser's image pipeline, then cheap strip copies:
  // drawImage scaling a 140-megapixel source strip by strip took 65 s without
  // a GPU; the resized bitmap takes a few seconds once.
  const small = typeof createImageBitmap === "function" && scale !== 1
    ? await createImageBitmap(image, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" }).catch(() => null)
    : null;
  const src = small ?? image, sw = small ? w : srcW, k = small ? 1 : scale;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = strip;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  for (let y0 = 0; y0 < h; y0 += strip) {
    const rows = Math.min(strip, h - y0);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, rows);
    ctx.drawImage(src, 0, y0 / k, sw, rows / k, 0, 0, w, rows);
    const data = ctx.getImageData(0, 0, w, rows).data;
    for (let p = 0, n = w * rows; p < n; p++) {
      const g = Math.round((data[p * 4] * 299 + data[p * 4 + 1] * 587 + data[p * 4 + 2] * 114) / 1000);
      ink[y0 * w + p] = g; hist[g]++;
    }
    if (onProgress) await onProgress(y0 + rows, h);
  }
  small?.close?.();
  const t = threshold === "auto" ? autoThreshold(hist) : threshold;
  for (let i = 0; i < ink.length; i++) ink[i] = ink[i] < t ? 1 : 0;
  return { ink, w, h, scale, threshold: t };
}
