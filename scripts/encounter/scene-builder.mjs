/**
 * Shadowdark Enhancer - Hexcrawl scene builder (Phase 17, REQ-37).
 *
 * Pure geometry helpers stay at the top of this module so it can be imported
 * directly by node:test. Foundry-bound deployment functions are added below
 * and must not touch Foundry globals at module evaluation time.
 */

export const DEFAULT_CALIBRATION = Object.freeze({
  x0: 110.8,
  dx: 126.9,
  yOdd0: 98,
  yEven0: 171.25,
  dy: 146.5,
  rowOffset: 0,
});

function parseHexKey(key) {
  const match = /^(\d+),(\d+)$/.exec(String(key ?? "").trim());
  if (!match) throw new TypeError(`Invalid hex key "${key}"`);
  return { col: Number(match[1]), row: Number(match[2]) };
}

/**
 * Compute a keyed hex center using the flat-top Cursed Scroll lattice.
 * @param {string} key - normalized "col,row" key from hexIdKey()
 * @param {object} [calib]
 * @returns {{x:number,y:number}}
 */
export function hexCenter(key, calib = DEFAULT_CALIBRATION) {
  const { col, row } = parseHexKey(key);
  const effectiveRow = row - Number(calib.rowOffset ?? 0);
  if (effectiveRow < 1) {
    throw new RangeError(`Hex key "${key}" has effective row ${effectiveRow}`);
  }
  const y0 = col % 2 === 0 ? Number(calib.yEven0) : Number(calib.yOdd0);
  return {
    x: Number(calib.x0) + Number(calib.dx) * col,
    y: y0 + Number(calib.dy) * (effectiveRow - 1),
  };
}

/**
 * Partition normalized keys for a standard 11-row north map and optional
 * rows 12-22 south map. Keys are not rewritten.
 * @param {string[]} keys
 * @returns {{north:string[],south:string[]}}
 */
export function splitNorthSouth(keys) {
  const north = [];
  const south = [];
  for (const key of keys ?? []) {
    const { row } = parseHexKey(key);
    (row > 11 ? south : north).push(key);
  }
  return { north, south };
}

/**
 * Solve an axis-aligned affine transform from two clicked points while
 * preserving the template lattice proportions and stagger.
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @param {string} ref1
 * @param {string} ref2
 * @returns {object}
 */
export function solveCalibration(p1, p2, ref1, ref2) {
  const d1 = hexCenter(ref1, DEFAULT_CALIBRATION);
  const d2 = hexCenter(ref2, DEFAULT_CALIBRATION);
  const refDx = d2.x - d1.x;
  const refDy = d2.y - d1.y;
  if (refDx === 0 || refDy === 0) {
    throw new RangeError("Reference hexes must differ on both axes");
  }

  const sx = (Number(p2.x) - Number(p1.x)) / refDx;
  const sy = (Number(p2.y) - Number(p1.y)) / refDy;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) {
    throw new RangeError("Reference clicks do not produce a usable calibration");
  }

  const ox = Number(p1.x) - d1.x * sx;
  const oy = Number(p1.y) - d1.y * sy;
  return {
    x0: ox + DEFAULT_CALIBRATION.x0 * sx,
    dx: DEFAULT_CALIBRATION.dx * sx,
    yOdd0: oy + DEFAULT_CALIBRATION.yOdd0 * sy,
    yEven0: oy + DEFAULT_CALIBRATION.yEven0 * sy,
    dy: DEFAULT_CALIBRATION.dy * sy,
    rowOffset: 0,
  };
}

/**
 * Build a Foundry Note payload from a deployed world JournalEntryPage.
 * @param {object} page
 * @param {string} key
 * @param {object} [calib]
 * @returns {{entryId:string,pageId:string,x:number,y:number}}
 */
export function buildNoteData(page, key, calib = DEFAULT_CALIBRATION) {
  const entryId = page?.parent?.id;
  const pageId = page?.id;
  if (!entryId || !pageId) throw new TypeError("A deployed world journal page is required");
  return { entryId, pageId, ...hexCenter(key, calib) };
}

