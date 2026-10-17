/**
 * Shadowdark Enhancer — haggling at a town shop (pure): the DC ladder and what a character has already done.
 *
 * A haggle is one d20 + the character's CHA modifier against a ladder that runs from a quarter off to being thrown
 * out for good. One attempt per character per merchant per restock (a restock is a new negotiation); a ban is permanent
 * until the GM pardons it. Both live on the character's own flags, like the stock ledger, so no GM has to be connected:
 *
 *   flags[MODULE_ID].shopHaggle[merchantId] = { rev, pct, tier }   valid while rev is the merchant's current rev
 *   flags[MODULE_ID].shopBan[merchantId]    = true
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { keyOk, revOf } from "./shop-core.mjs";

export const HAGGLE_FLAG = "shopHaggle";
export const BAN_FLAG = "shopBan";

/** The words for each step, every key written out (the scanner does not follow keys built from pieces). */
export const TIER_KEYS = {
  masterful: "SDE.town.haggle.tier.masterful", sharp: "SDE.town.haggle.tier.sharp", good: "SDE.town.haggle.tier.good", fair: "SDE.town.haggle.tier.fair",
  flat: "SDE.town.haggle.tier.flat", shaky: "SDE.town.haggle.tier.shaky", poor: "SDE.town.haggle.tier.poor", banned: "SDE.town.haggle.tier.banned",
};

/** Highest first. `min` is the lowest total (d20 + CHA modifier) of the step; `pct` is the change to every price. */
export const LADDER = [
  { min: 20, tier: "masterful", pct: -25 },
  { min: 17, tier: "sharp", pct: -15 },
  { min: 14, tier: "good", pct: -10 },
  { min: 11, tier: "fair", pct: -5 },
  { min: 8, tier: "flat", pct: 0 },
  { min: 5, tier: "shaky", pct: 10 },
  { min: 2, tier: "poor", pct: 25 },
];

/** The result of a roll: a natural 20 is always the top step, a natural 1 (or a total of 1 or less) is a ban. */
export function haggleResult(d20, chaMod = 0) {
  const total = d20 + (Number(chaMod) || 0);
  if (d20 === 1) return { tier: "banned", pct: 0, banned: true, total };
  if (d20 === 20) return { tier: "masterful", pct: -25, banned: false, total };
  const step = LADDER.find((s) => total >= s.min);
  return step ? { tier: step.tier, pct: step.pct, banned: false, total } : { tier: "banned", pct: 0, banned: true, total };
}

/** The dotted update paths of a character's haggle and ban on a merchant. Throws on an id that cannot be a key. */
export function haggleFlagPaths(merchant) {
  if (!keyOk(merchant?.id)) throw new Error(`haggle: unusable merchant id (${merchant?.id})`);
  return { haggle: `flags.${MODULE_ID}.${HAGGLE_FLAG}.${merchant.id}`, ban: `flags.${MODULE_ID}.${BAN_FLAG}.${merchant.id}`, banKey: `${BAN_FLAG}.${merchant.id}` };
}

/**
 * Where a character stands with a merchant now: banned, the percent in force (0 when none or after a restock), the tier
 * word of the haggle in force, and whether an attempt is still open (`canHaggle`: not banned, not yet tried since the
 * last restock, and the merchant lets buyers bargain).
 */
export function haggleState(actor, merchant) {
  const flags = actor?.flags?.[MODULE_ID] ?? {};
  const banned = flags[BAN_FLAG]?.[merchant?.id] === true;
  const mine = flags[HAGGLE_FLAG]?.[merchant?.id];
  const done = !!mine && mine.rev === revOf(merchant);
  return {
    banned, rev: revOf(merchant), haggled: done,
    pct: done ? Number(mine.pct) || 0 : 0, tier: done ? mine.tier ?? "" : "",
    canHaggle: !banned && !done && merchant?.haggle !== false,
  };
}
