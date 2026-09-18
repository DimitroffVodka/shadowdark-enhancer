/**
 * Shadowdark Enhancer — bitmap operations for hex cell classification (pure).
 *
 * A bitmap is `{ w, h, data: Uint8Array }` of 0/1 ink, the cell's bounding box
 * squashed to w×h by the sampler. Masks are precomputed once per (w, h) in the
 * cell's normalised frame: x' in [-1, 1] across the width, y' in [-1, 1] down
 * the height, flat-top hexagon. Phase 3 of docs/plans/hex-map-dataset.md.
 */

export function makeBitmap(w, h) { return { w, h, data: new Uint8Array(w * h) }; }

/** 8-neighbour dilation, `n` passes. */
export function dilate(bm, n = 1) {
  let cur = bm.data;
  const { w, h } = bm;
  for (let pass = 0; pass < n; pass++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!cur[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 1;
      }
    }
    cur = out;
  }
  return { w, h, data: cur };
}

/** 8-connected components. Labels are 1-based; sizes[k-1] is component k's pixel count. */
export function components(bm) {
  const { w, h, data } = bm;
  const labels = new Int32Array(w * h);
  const sizes = [];
  const stack = [];
  let next = 0;
  for (let p = 0; p < w * h; p++) {
    if (!data[p] || labels[p]) continue;
    next++; labels[p] = next; stack.push(p); let size = 0;
    while (stack.length) {
      const q = stack.pop(); size++;
      const y = (q / w) | 0, x = q - y * w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        const r = yy * w + xx;
        if (data[r] && !labels[r]) { labels[r] = next; stack.push(r); }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Pixel-majority stamp over bitmaps of one stamped glyph, then dilated. */
export function majorityStamp(bitmaps, { threshold = 0.4, dilateBy = 1 } = {}) {
  const { w, h } = bitmaps[0];
  const acc = new Float32Array(w * h);
  for (const b of bitmaps) for (let p = 0; p < w * h; p++) acc[p] += b.data[p];
  const out = makeBitmap(w, h);
  for (let p = 0; p < w * h; p++) out.data[p] = acc[p] / bitmaps.length > threshold ? 1 : 0;
  return dilateBy > 0 ? dilate(out, dilateBy) : out;
}

export function unionStamp(stamps) {
  const { w, h } = stamps[0];
  const out = makeBitmap(w, h);
  for (const s of stamps) for (let p = 0; p < w * h; p++) if (s.data[p]) out.data[p] = 1;
  return out;
}

/** bm AND NOT mask. */
export function subtract(bm, mask) {
  const out = makeBitmap(bm.w, bm.h);
  for (let p = 0; p < bm.data.length; p++) out.data[p] = bm.data[p] && !(mask?.data[p]) ? 1 : 0;
  return out;
}

/** bm AND mask (mask may be a Uint8Array or a bitmap). */
export function and(bm, mask) {
  const m = mask?.data ?? mask;
  const out = makeBitmap(bm.w, bm.h);
  for (let p = 0; p < bm.data.length; p++) out.data[p] = bm.data[p] && m[p] ? 1 : 0;
  return out;
}

export function inkCount(bm) { let n = 0; for (const v of bm.data) n += v; return n; }

/** Fraction of `bm`'s ink that lies inside `stamp` (how well a stamp explains a cell). */
export function coverage(bm, stamp) {
  let ink = 0, inside = 0;
  for (let p = 0; p < bm.data.length; p++) if (bm.data[p]) { ink++; if (stamp.data[p]) inside++; }
  return ink ? inside / ink : 0;
}

/**
 * Masks in the cell frame. `shrink` keeps the hex border lines and the
 * neighbours out; `ringFrom` is where the outer ring starts (edge sectors are
 * counted there); `bottom` marks the lower part where a printed label may sit.
 */
export function cellMasks(w, h, { shrink = 0.86, ringFrom = 0.62, bottom = 0.45 } = {}) {
  const inhex = new Uint8Array(w * h), outer = new Uint8Array(w * h), bottomHalf = new Uint8Array(w * h);
  const sector = new Int8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xn = ((x + 0.5) / w) * 2 - 1, yn = ((y + 0.5) / h) * 2 - 1;     // x' right, y' down
    const p = y * w + x;
    inhex[p] = (Math.abs(xn) + Math.abs(yn) / 2 <= shrink && Math.abs(yn) <= shrink) ? 1 : 0;
    const d = Math.hypot(xn, yn * 0.87);
    outer[p] = d > ringFrom ? 1 : 0;
    bottomHalf[p] = yn > bottom ? 1 : 0;
    const ang = (Math.atan2(-yn, xn) * 180 / Math.PI + 360) % 360;
    sector[p] = Math.floor(ang / 60) % 6;
  }
  return { w, h, inhex, outer, sector, bottomHalf };
}

/**
 * The map's fixed furniture in the lower part of the cell (a printed
 * coordinate label): pixels inked in more than `threshold` of the cells.
 */
export function labelZone(bitmaps, masks, { threshold = 0.30 } = {}) {
  const { w, h, inhex, bottomHalf } = masks;
  const acc = new Float32Array(w * h);
  for (const b of bitmaps) for (let p = 0; p < w * h; p++) acc[p] += b.data[p];
  const out = makeBitmap(w, h);
  for (let p = 0; p < w * h; p++) out.data[p] = (inhex[p] && bottomHalf[p] && acc[p] / bitmaps.length > threshold) ? 1 : 0;
  return out;
}

/**
 * Residual features: total ink, largest piece, number of distinct edge
 * sectors touched by pieces of at least `minPiece` pixels in the outer ring.
 */
export function features(residual, masks, { minPiece = 3 } = {}) {
  const { labels, sizes } = components(residual);
  const sectors = new Set();
  const big = new Set();
  sizes.forEach((s, k) => { if (s >= minPiece) big.add(k + 1); });
  const { w, h, outer, sector } = masks;
  for (let p = 0; p < w * h; p++) {
    const k = labels[p];
    if (k && big.has(k) && outer[p]) sectors.add(sector[p]);
  }
  return { ink: inkCount(residual), biggest: sizes.length ? Math.max(...sizes) : 0, sectors: sectors.size, pieces: sizes };
}
