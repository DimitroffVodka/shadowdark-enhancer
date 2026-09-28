/**
 * Shadowdark Enhancer — Encounter Result
 * Lookups and helpers for Distance, Activity, and Reaction RAW results.
 */

import { isDoubleOnes } from "../renown/renown-core.mjs";

/** The distance d6, by roll: its word's key. */
export const DISTANCE = {
  1: "SDE.encounter.distance.close",
  2: "SDE.encounter.distance.near", 3: "SDE.encounter.distance.near", 4: "SDE.encounter.distance.near",
  5: "SDE.encounter.distance.far", 6: "SDE.encounter.distance.far",
};

/** The activity 2d6, by roll: its word's key. */
export const ACTIVITY = {
  2: "SDE.encounter.activity.hunting", 3: "SDE.encounter.activity.hunting", 4: "SDE.encounter.activity.hunting",
  5: "SDE.encounter.activity.eating", 6: "SDE.encounter.activity.eating",
  7: "SDE.encounter.activity.building", 8: "SDE.encounter.activity.building",
  9: "SDE.encounter.activity.socializing", 10: "SDE.encounter.activity.socializing",
  11: "SDE.encounter.activity.guarding",
  12: "SDE.encounter.activity.sleeping",
};

/** A reaction band (reactionBand's answer, also a CSS class suffix): its word's key. */
export const REACTION = {
  Hostile: "SDE.encounter.reaction.hostile", Suspicious: "SDE.encounter.reaction.suspicious",
  Neutral: "SDE.encounter.reaction.neutral", Curious: "SDE.encounter.reaction.curious",
  Friendly: "SDE.encounter.reaction.friendly",
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

/**
 * An encounter's facets in words, for its card and panel: the distance and the
 * activity by their rolls, and the reaction band for `reactionTotal` (double
 * 1s on the raw roll are hostile whatever the total).
 * @param {{distanceRoll:number, activityRoll:number, reactionRoll:number, reactionTotal:number}} res
 * @returns {{distanceText:string, activityText:string, reactionDoubleOnes:boolean, reactionBand:string, reactionText:string}}
 */
export function facetWords({ distanceRoll, activityRoll, reactionRoll, reactionTotal }) {
  const loc = (key) => (key ? game.i18n.localize(key) : "");
  const reactionDoubleOnes = isDoubleOnes(reactionRoll);
  const band = reactionBand(reactionTotal, { doubleOnes: reactionDoubleOnes });
  return {
    distanceText: loc(DISTANCE[distanceRoll]), activityText: loc(ACTIVITY[activityRoll]),
    reactionDoubleOnes, reactionBand: band, reactionText: loc(REACTION[band]),
  };
}
