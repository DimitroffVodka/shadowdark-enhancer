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

/**
 * The reconciliation after a carry: where the rider must be put, or null.
 *
 * A carry can be lost: core resumes a carry a Region paused, and a carry sent
 * while that resumed update is in flight can be silently dropped (lane, 14.369:
 * rider left at the mount's previous corner, still mounted). So when the
 * mount has stopped moving, a rider not in its corner is put there. Nothing
 * while the mount still has segments to go (their carries follow), and
 * nothing for a rider that is in its corner or no longer on that mount.
 *
 * @param {object} p
 * @param {?object} p.mount   the mount's stored position and size; null when the rider is not on one (dismounted, mount gone)
 * @param {object}  p.rider   the rider's stored position and size
 * @param {boolean} p.mountMoving  the mount's movement still has pending segments
 * @returns {?{x: number, y: number}}
 */
export function snapPoint({ mount, rider, gridSize, mountMoving = false }) {
  if (!mount || !rider || mountMoving) return null;
  const c = riderCorner(mount, rider, gridSize);
  return Math.abs(rider.x - c.x) < 1 && Math.abs(rider.y - c.y) < 1 ? null : c;
}

/**
 * Every carry is started with a movement id that says so: Foundry movement ids
 * are 16 letters and digits, and a carry's begin with these 8.
 */
export const CARRY_PREFIX = "sdeCarry";

/** A carry's movement id, from 8 random letters/digits (foundry.utils.randomID(8)). */
export const carryMovementId = (random8) => `${CARRY_PREFIX}${random8}`;

/**
 * Is this rider movement a carry (its mount moving it), or the rider moving
 * on its own? Decided by the movement's id, which survives what v14 does to a
 * carry a Region pauses part way: core resumes it as a NEW movement with a new
 * id whose `chain` starts with the original one, and without the update
 * options it began with. Position can't decide it either: a resumed carry
 * still heads for the corner the mount had when it started, which is not the
 * mount's corner any more once the mount's next segment has moved it.
 * A carry spends no movement, is never locked out of turn, and keeps the pair;
 * any other move of the rider splits it.
 *
 * @param {object} move  the rider's TokenMovementData, or the pre-update movement operation
 */
export function isCarryMovement(move) {
  const first = move?.chain?.[0] ?? move?.id;
  return typeof first === "string" && first.startsWith(CARRY_PREFIX);
}

/**
 * Is the rider still part way through a carry (paused, the rest pending)?
 * The next carry waits for the last one to land; if it is still paused after
 * that wait (a behaviour paused it), it is stopped so only one is in flight.
 */
export function carryInFlight(move) {
  return isCarryMovement(move) && move.state !== "stopped" && move.state !== "completed";
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

/** A mount's token is 2x2 (#326). */
export const MOUNT_SQUARES = 2;

/** The size a mount's token grows to, or null when it is 2x2 or bigger already. Never shrinks. */
export function grownSize({ width = 1, height = 1 } = {}) {
  if (width >= MOUNT_SQUARES && height >= MOUNT_SQUARES) return null;
  return { width: Math.max(MOUNT_SQUARES, width), height: Math.max(MOUNT_SQUARES, height) };
}

/**
 * Pick the mount a rider climbs onto, or null.
 *
 * Candidates are mount tokens (the caller decides that from the actor type);
 * one with no rider and not riding anything itself, within reach, qualifies.
 * A targeted one wins; else the nearest. A rider that carries a rider of its
 * own mounts nothing (no chains).
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
    .filter((m) => m.id !== rider.id && !m.busy)
    .map((m) => ({ id: m.id, gap: gapSquares(rider, m, gridSize), targeted: targeted.has(m.id) }))
    .filter((m) => m.gap <= REACH_SQUARES)
    .sort((a, b) => (b.targeted - a.targeted) || (a.gap - b.gap));
  return fits[0]?.id ?? null;
}
