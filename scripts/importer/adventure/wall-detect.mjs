/**
 * Shadowdark Enhancer — walls and doors found on a dungeon map, pure (pixels in, grid edges out).
 *
 * An adventure's site map is drawn on a square grid whose size the book prints ("68 wide x 44 high"), and the scene is
 * built on that grid, so the map's straight walls lie along grid edges. Each edge of the grid is asked one question:
 * is there a wall stroke along it? Walls are the heavy strokes (about 5 px or more at 53 px a square); the floor-tile
 * lines (2 to 3 px) and the stipple dots around the rock are thinner than that and drop out. A door in this art is a
 * small closed rounded rectangle lying along a wall line with the wall continuing on both sides: two parallel strokes
 * about 17 px apart over an open middle, on an edge that is not itself a wall.
 *
 * Only walls drawn as clean heavy lines along the grid, and doors drawn as small rounded rectangles, are found. Cave
 * outlines, 45 degree cut corners, walls drawn as a band of stones, doors drawn as solid black bars and any wall that
 * is not on a grid edge are left to the GM (the preview window can add them edge by edge). Tried on the Cursed Scroll
 * maps (2026-10-06): The Hideous Halls of Mugdulblub (68 x 44; 437 walls, 16 doors), The Basilisk Cult and The Black
 * Ziggurat trace their rooms and corridors cleanly with their doors mostly found (a round pillar is sometimes taken for a
 * door, a few real doors are missed); Library of Leng gets its rooms but not its caves; The Iron Fortress and The Mines
 * (stone-band walls outside the grid, solid-bar doors) get only their inner partitions; pure cave maps get nothing.
 * So the result is a first draft for the GM to correct, never something to apply unseen.
 *
 * Every pixel constant is written for a 52.94 px square and scaled by the map's own square size.
 */

/** An edge's state: nothing, a wall, a door. */
export const EDGE = Object.freeze({ NONE: 0, WALL: 1, DOOR: 2 });

const REFERENCE_PITCH = 52.94;

/** A box of side k (odd) that survives only where the whole box is set: `erode`; where any of it is set: `dilate`. */
function boxFilter(src, W, H, k, all) {
  const r = k >> 1;
  const pass = (a, outer, inner, stride, step) => {
    const out = new Uint8Array(a.length), prefix = new Int32Array(inner + 1);
    for (let o = 0; o < outer; o++) {
      const base = o * stride;
      for (let i = 0; i < inner; i++) prefix[i + 1] = prefix[i] + a[base + i * step];
      for (let i = 0; i < inner; i++) {
        const lo = Math.max(0, i - r), hi = Math.min(inner - 1, i + r), sum = prefix[hi + 1] - prefix[lo];
        out[base + i * step] = all ? (hi - lo + 1 === k && sum === k ? 1 : 0) : (sum > 0 ? 1 : 0);
      }
    }
    return out;
  };
  return pass(pass(src, H, W, W, 1), W, H, 1, W);
}
const erode = (a, W, H, k) => boxFilter(a, W, H, k, true);
const dilate = (a, W, H, k) => boxFilter(a, W, H, k, false);

/** Where the strokes pile up when a profile is folded on the grid pitch: the offset of the first grid line, near 0. */
function foldOffset(profile, pitch) {
  const bins = 106, fold = new Float64Array(bins);
  for (let i = 0; i < profile.length; i++) fold[Math.floor(((i % pitch) / pitch) * bins) % bins] += profile[i];
  let best = 0, total = 0;
  for (let b = 0; b < bins; b++) { total += fold[b]; if (fold[b] > fold[best]) best = b; }
  const raw = ((best + 0.5) * pitch) / bins;
  return { offset: raw > pitch / 2 ? raw - pitch : raw, peak: fold[best] / (total / bins || 1) };
}

/** The share of positions along a band that have a set pixel somewhere across it. */
function bandShare(mask, W, H, x0, x1, y0, y1, along) {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(W, Math.round(x1)); y1 = Math.min(H, Math.round(y1));
  if (x1 <= x0 || y1 <= y0) return 0;
  let hits = 0;
  if (along === "y") {
    for (let y = y0; y < y1; y++) { for (let x = x0; x < x1; x++) if (mask[y * W + x]) { hits++; break; } }
    return hits / (y1 - y0);
  }
  for (let x = x0; x < x1; x++) { for (let y = y0; y < y1; y++) if (mask[y * W + x]) { hits++; break; } }
  return hits / (x1 - x0);
}

/**
 * Find the straight walls and the doors on a map image.
 * @param {{gray:ArrayLike<number>, width:number, height:number, cols:number, rows:number, dark?:number, wallShare?:number}} map
 *   gray: one luminance byte (0 black .. 255 white) per pixel, row by row; cols and rows: the printed grid.
 * @returns {{cols:number, rows:number, pitchX:number, pitchY:number, offsetX:number, offsetY:number, confident:boolean,
 *   vertical:Uint8Array, horizontal:Uint8Array, walls:number, doors:number}}
 *   vertical[j * (cols + 1) + k] is the state of the edge on grid line k between rows j and j+1; horizontal[j * cols + k]
 *   the edge on grid line j between columns k and k+1. Grid line k lies at x = offsetX + k * pitchX.
 */
export function detectWallsAndDoors({ gray, width: W, height: H, cols, rows, dark = 110, wallShare = 0.85 }) {
  const pitchX = W / cols, pitchY = H / rows, s = (pitchX + pitchY) / 2 / REFERENCE_PITCH;
  const k = Math.max(3, Math.round(5 * s) | 1);
  const darkMask = new Uint8Array(W * H);
  for (let i = 0; i < darkMask.length; i++) darkMask[i] = gray[i] < dark ? 1 : 0;
  const thick = erode(darkMask, W, H, k);
  const ink = dilate(thick, W, H, k);

  const colSum = new Float64Array(W), rowSum = new Float64Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x]) { colSum[x]++; rowSum[y]++; }
  const fx = foldOffset(colSum, pitchX), fy = foldOffset(rowSum, pitchY);
  const offsetX = fx.offset, offsetY = fy.offset;
  const line = (n, off, pitch) => off + n * pitch;

  const vertical = new Uint8Array(rows * (cols + 1)), horizontal = new Uint8Array((rows + 1) * cols);
  const end = 8 * s, band = 3 * s;
  for (let j = 0; j < rows; j++) for (let c = 0; c <= cols; c++) {
    const x = line(c, offsetX, pitchX);
    if (bandShare(ink, W, H, x - band, x + band + 1, line(j, offsetY, pitchY) + end, line(j + 1, offsetY, pitchY) - end, "y") >= wallShare) vertical[j * (cols + 1) + c] = EDGE.WALL;
  }
  for (let j = 0; j <= rows; j++) for (let c = 0; c < cols; c++) {
    const y = line(j, offsetY, pitchY);
    if (bandShare(ink, W, H, line(c, offsetX, pitchX) + end, line(c + 1, offsetX, pitchX) - end, y - band, y + band + 1, "x") >= wallShare) horizontal[j * cols + c] = EDGE.WALL;
  }

  // Doors: on an edge that is not a wall, two parallel strokes about 17 px apart (6 px thick) with an open middle.
  const a0 = 11 * s, a1 = 5 * s, b0 = 6 * s, b1 = 12 * s, m = 3 * s, reach = 8 * s, trim = 10 * s;
  const ringAt = (vert, c0, c1, centre) => {
    const share = vert
      ? (lo, hi) => bandShare(darkMask, W, H, centre + lo, centre + hi, c0, c1, "y")
      : (lo, hi) => bandShare(darkMask, W, H, c0, c1, centre + lo, centre + hi, "x");
    return share(-a0, -a1) > 0.75 && share(b0, b1) > 0.75 && share(-m, m + 1) < 0.3;
  };
  const isDoor = (vert, c0, c1, centre) => {
    for (let d = -reach; d <= reach; d += Math.max(1, s)) if (ringAt(vert, c0, c1, centre + d)) return true;
    return false;
  };
  for (let j = 0; j < rows; j++) for (let c = 0; c <= cols; c++) {
    const i = j * (cols + 1) + c;
    if (!vertical[i] && isDoor(true, line(j, offsetY, pitchY) + trim, line(j + 1, offsetY, pitchY) - trim, line(c, offsetX, pitchX))) vertical[i] = EDGE.DOOR;
  }
  for (let j = 0; j <= rows; j++) for (let c = 0; c < cols; c++) {
    const i = j * cols + c;
    if (!horizontal[i] && isDoor(false, line(c, offsetX, pitchX) + trim, line(c + 1, offsetX, pitchX) - trim, line(j, offsetY, pitchY))) horizontal[i] = EDGE.DOOR;
  }

  const count = (v) => vertical.reduce((n, e) => n + (e === v), 0) + horizontal.reduce((n, e) => n + (e === v), 0);
  return { cols, rows, pitchX, pitchY, offsetX, offsetY, confident: fx.peak >= 1.3 && fy.peak >= 1.3, vertical, horizontal, walls: count(EDGE.WALL), doors: count(EDGE.DOOR) };
}

/** The edge arrays' index for one edge: `v` on vertical grid line c between rows j and j+1, `h` on horizontal line j between columns c and c+1. */
export const edgeIndex = (grid, kind, j, c) => (kind === "v" ? j * (grid.cols + 1) + c : j * grid.cols + c);

/**
 * The walls to create: straight runs of wall edges joined into one segment each, and every door edge on its own.
 * @param {{cols:number, rows:number, pitchX:number, pitchY:number, offsetX:number, offsetY:number, vertical:Uint8Array, horizontal:Uint8Array}} grid
 * @param {{x:number, y:number, sx:number, sy:number}} [place]  where image pixel (0,0) sits in the scene and the scene pixels per image pixel
 * @returns {Array<{c:number[], door:number}>}  door 0 for a wall, 1 for a door
 */
export function toSegments(grid, { x = 0, y = 0, sx = 1, sy = 1 } = {}) {
  const gx = (c) => x + (grid.offsetX + c * grid.pitchX) * sx, gy = (j) => y + (grid.offsetY + j * grid.pitchY) * sy;
  const out = [];
  const run = (kind, outer, inner) => {
    for (let o = 0; o < outer; o++) {
      let start = -1;
      const flush = (stop) => {
        if (start < 0) return;
        out.push({ c: kind === "v" ? [gx(o), gy(start), gx(o), gy(stop)] : [gx(start), gy(o), gx(stop), gy(o)], door: 0 });
        start = -1;
      };
      for (let i = 0; i < inner; i++) {
        const state = grid[kind === "v" ? "vertical" : "horizontal"][kind === "v" ? i * (grid.cols + 1) + o : o * grid.cols + i];
        if (state === EDGE.WALL) { if (start < 0) start = i; continue; }
        flush(i);
        if (state === EDGE.DOOR) out.push({ c: kind === "v" ? [gx(o), gy(i), gx(o), gy(i + 1)] : [gx(i), gy(o), gx(i + 1), gy(o)], door: 1 });
      }
      flush(inner);
    }
  };
  run("v", grid.cols + 1, grid.rows);
  run("h", grid.rows + 1, grid.cols);
  return out;
}
