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
 * Maps a modified 2d6 reaction total to a Shadowdark reaction band.
 *
 * `doubleOnes` short-circuits everything: two 1s on the reaction dice are
 * always a hostile reaction, no matter what the CHA modifier and the renown
 * bonus add up to (Western Reaches p233). The caller knows this from the RAW
 * 2d6 total, because 2 on two six-sided dice can only be 1+1 — see
 * `isDoubleOnes` in renown-core.mjs.
 *
 * @param {number} total  the roll plus every modifier
 * @param {{doubleOnes?: boolean}} [opts]
 * @returns {string}
 */
export function reactionBand(total, { doubleOnes = false } = {}) {
  if (doubleOnes) return "Hostile";
  if (total <= 6)  return "Hostile";
  if (total <= 8)  return "Suspicious";
  if (total === 9) return "Neutral";
  if (total <= 11) return "Curious";
  return "Friendly";
}
