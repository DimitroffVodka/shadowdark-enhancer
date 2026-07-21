/**
 * Shadowdark Enhancer — movement math (pure, Foundry-free, node-testable).
 *
 * Extracted from movement-tracker.mjs's preUpdateToken/updateToken handlers,
 * which compute one segment's feet-moved per token-position-change hook call
 * (grid-to-feet Chebyshev distance, rounded to the nearest 5ft) and deduct it
 * from the token's remaining budget immediately. A multi-waypoint move is
 * therefore several individually-rounded segment deductions, not one
 * cumulative-then-rounded deduction — see sumCommittedSegments below.
 */

export const GRID_DIAGONAL_RULES = Object.freeze({
  EQUIDISTANT: 0,
  EXACT: 1,
  APPROXIMATE: 2,
  RECTILINEAR: 3,
  ALTERNATING_1: 4,
  ALTERNATING_2: 5,
  ILLEGAL: 6,
});

/**
 * Feet moved for one grid-position change. The optional `diagonals` value
 * mirrors Foundry v14's CONST.GRID_DIAGONALS numeric values while keeping
 * EQUIDISTANT as the backward-compatible default. Results remain rounded to
 * the module's 5ft movement-budget granularity.
 */
export function segmentFeet({
  oldX,
  oldY,
  newX,
  newY,
  gridSize = 100,
  gridDistance = 5,
  diagonals = GRID_DIAGONAL_RULES.EQUIDISTANT,
}) {
  const dx = Math.abs((newX - oldX) / gridSize);
  const dy = Math.abs((newY - oldY) / gridSize);
  const major = Math.max(dx, dy);
  const minor = Math.min(dx, dy);

  let spaces;
  switch (diagonals) {
    case GRID_DIAGONAL_RULES.EXACT:
      spaces = major + ((Math.SQRT2 - 1) * minor);
      break;
    case GRID_DIAGONAL_RULES.APPROXIMATE:
      spaces = major + (0.5 * minor);
      break;
    case GRID_DIAGONAL_RULES.RECTILINEAR:
    case GRID_DIAGONAL_RULES.ILLEGAL:
      spaces = major + minor;
      break;
    case GRID_DIAGONAL_RULES.ALTERNATING_1:
      spaces = major + Math.floor(minor / 2);
      break;
    case GRID_DIAGONAL_RULES.ALTERNATING_2:
      spaces = major + Math.floor((1.5 + minor) / 2);
      break;
    case GRID_DIAGONAL_RULES.EQUIDISTANT:
    default:
      spaces = major;
      break;
  }

  return Math.round((spaces * gridDistance) / 5) * 5;
}

/**
 * Sum of several ALREADY-ROUNDED committed segments (the module's actual
 * runtime behavior: each preUpdateToken/updateToken pair deducts its own
 * segment independently). NOT the same as rounding the sum of raw distances.
 */
export function sumCommittedSegments(segments) {
  return segments.reduce((total, seg) => total + segmentFeet(seg), 0);
}

/**
 * Comparison seam for item 5: how far apart is Foundry's own TokenRuler
 * waypoint.cost from our independently-calculated committed segment cost?
 * Read-only diagnostic — callers must NOT use this to alter deductions.
 */
export function compareWaypointCost(calculatedFt, waypointCost) {
  const cost = Number.isFinite(waypointCost) ? waypointCost : null;
  if (cost === null) return { calculatedFt, waypointCost: null, diff: null, match: null };
  const diff = calculatedFt - cost;
  return { calculatedFt, waypointCost: cost, diff, match: diff === 0 };
}
