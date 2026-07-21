/**
 * Shadowdark Enhancer — Party XP core (pure, node-testable).
 *
 * No Foundry globals: just the XP math + item-XP resolution shared by the
 * Foundry-coupled party-xp.mjs (logic + ApplicationV2 tool). Kept separate so
 * it can be unit-tested in node, the same way loot-value.mjs is.
 */
import { scoreItem } from "../loot/loot-value.mjs";

/** Flag key the assigned per-item XP is stored under. */
export const XP_FLAG = "partyXp";

/** Shadowdark RAW: 10 XP earns one level. Used only for the "ready" hint. */
export const XP_PER_LEVEL = 10;

/**
 * Coerce to a non-negative integer XP, or null when not a usable number.
 * null/undefined/"" are treated as "no value" (→ null), NOT as 0 — otherwise a
 * missing item flag (or empty input) would read as a tagged 0 XP and shadow the
 * loot-score fallback. `Number(null)`/`Number("")` are 0 in JS, hence the guard.
 */
export function normalizeXp(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Decide an item's party-XP value. A tagged value wins (when it's a usable
 * number ≥ 0); otherwise fall back to the loot-quality score. Pure — the caller
 * supplies the already-extracted inputs.
 *
 * @returns {{ xp:number, source:"flag"|"score" }}
 */
export function pickItemXp({ flagXp, gp = 0, magic = false, bonus = 0 } = {}, thresholds) {
  const tagged = normalizeXp(flagXp);
  if (tagged != null) return { xp: tagged, source: "flag" };
  const { xp } = scoreItem({ gp, magic, bonus }, thresholds ?? {});
  return { xp: normalizeXp(xp) ?? 0, source: "score" };
}

/**
 * Per-actor award math (pure): old → new xp, and whether the new total reaches
 * the next level threshold.
 */
export function planAward(currentXp, amount) {
  const before = normalizeXp(currentXp) ?? 0;
  const added = normalizeXp(amount) ?? 0;
  const after = before + added;
  return { before, added, after, readyToLevel: after >= XP_PER_LEVEL };
}
