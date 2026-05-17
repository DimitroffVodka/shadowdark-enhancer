/**
 * Shadowdark Enhancer — Encounter Result
 * Lookups and helpers for Distance, Activity, and Reaction RAW results.
 */

export const DISTANCE = {
  1: "Close",
  2: "Near", 3: "Near", 4: "Near",
  5: "Far",  6: "Far",
};

export const ACTIVITY = {
  2: "Hunting", 3: "Hunting", 4: "Hunting",
  5: "Eating", 6: "Eating",
  7: "Building/nesting", 8: "Building/nesting",
  9: "Socializing/playing", 10: "Socializing/playing",
  11: "Guarding",
  12: "Sleeping",
};

/**
 * Maps a 2d6+CHA roll total to a Shadowdark reaction band.
 * @param {number} total
 * @returns {string}
 */
export function reactionBand(total) {
  if (total <= 6)  return "Hostile";
  if (total <= 8)  return "Suspicious";
  if (total === 9) return "Neutral";
  if (total <= 11) return "Curious";
  return "Friendly";
}
