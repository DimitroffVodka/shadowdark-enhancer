/**
 * Shadowdark Enhancer — riding a mount on the map (#326), the pure half.
 *
 * A rider is a normal token standing in its mount's bottom-left square, drawn
 * above it. The pair is one flag on the rider (`mountedOn`: the mount token's
 * id); the mount carries nothing. Positions are token documents' top-left
 * pixels, sizes are grid squares, as Foundry stores them.
 *
 * ponytail: square grids only; on a hex grid the "bottom-left square" of a 2x2
 * token is not a square, so the corner is approximate there.
 */

/** Where the rider stands when its mount's top-left is at `mount`. */
export function riderCorner(mount, rider, gridSize) {
  return { x: mount.x, y: mount.y + (mount.height - rider.height) * gridSize };
}

/** Is `point` the rider's corner of `mount` (to the pixel)? */
export function isAtCorner(point, mount, rider, gridSize) {
  if (!point || !mount || !rider) return false;
  const c = riderCorner(mount, rider, gridSize);
  return Math.abs(point.x - c.x) < 1 && Math.abs(point.y - c.y) < 1;
}

/**
 * Where a movement ends: the last pending waypoint while it is paused part way
 * (a region split it), else this update's destination.
 */
export function finalPoint(move) {
  return move?.pending?.waypoints?.at(-1) ?? move?.destination ?? null;
}

/**
 * Is this rider movement the carry (its mount moving it), or the rider moving
 * on its own? Decided by where it ends, not by an update option: a carry a
 * region pauses part way is continued by core without the options it started
 * with, and must still count as a carry. A carry spends no movement and keeps
 * the pair; any other move of the rider splits it.
 *
 * @param {object} move   the rider's movement (TokenMovementData or the pre-update operation)
 * @param {?object} mount the mount's stored position and size, null when it is gone
 * @param {object} rider  the rider's stored size
 */
export function isCarried(move, mount, rider, gridSize) {
  return !!mount && isAtCorner(finalPoint(move), mount, rider, gridSize);
}

/**
 * The rider's path when its mount moves through `waypoints`: each mount
 * waypoint shifted to its corner, same elevation, level and movement action
 * (a displaced mount displaces its rider too).
 */
export function followPath(waypoints, rider, gridSize) {
  return waypoints.map((w) => ({
    ...riderCorner(w, rider, gridSize),
    elevation: w.elevation,
    ...(w.level ? { level: w.level } : {}),
    ...(w.action ? { action: w.action } : {}),
  }));
}

/** Squares between two token rectangles (0 when they touch or overlap, diagonals count as 1 per square). */
export function gapSquares(a, b, gridSize) {
  const gx = Math.max(0, b.x - (a.x + a.width * gridSize), a.x - (b.x + b.width * gridSize));
  const gy = Math.max(0, b.y - (a.y + a.height * gridSize), a.y - (b.y + b.height * gridSize));
  return Math.max(gx, gy) / gridSize;
}

/** How far a mount may be from its rider: one square, Shadowdark's close. */
export const REACH_SQUARES = 1;

/**
 * Pick the mount a rider climbs onto, or null.
 *
 * A mount is a bigger token than the rider in both directions, with no rider
 * and not riding anything itself, within reach. A targeted one wins; else the
 * nearest. A rider that carries a rider of its own mounts nothing (no chains).
 *
 * @param {{id, x, y, width, height, busy?: boolean}} rider  busy: someone rides it
 * @param {Array<{id, x, y, width, height, busy?: boolean}>} candidates  busy: ridden or riding
 * @param {{targets?: Set<string>|string[], gridSize: number}} options
 * @returns {string|null} the mount's id
 */
export function pickMount(rider, candidates, { targets = [], gridSize }) {
  if (rider.busy) return null;
  const targeted = new Set(targets);
  const fits = candidates
    .filter((m) => m.id !== rider.id && !m.busy && m.width > rider.width && m.height > rider.height)
    .map((m) => ({ id: m.id, gap: gapSquares(rider, m, gridSize), targeted: targeted.has(m.id) }))
    .filter((m) => m.gap <= REACH_SQUARES)
    .sort((a, b) => (b.targeted - a.targeted) || (a.gap - b.gap));
  return fits[0]?.id ?? null;
}
