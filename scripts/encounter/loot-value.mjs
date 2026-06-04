/**
 * Shadowdark Enhancer — Loot value + XP scoring (pure).
 * Bridges item gp value to Shadowdark's XP quality tiers
 * (Poor 0 / Normal 1 / Fabulous 3 / Legendary 10) via adjustable thresholds.
 */
import { parseValue } from "./loot-pack.mjs";

/** gp-equivalent of an item's system.cost. */
export function itemValueGp(item) {
  const c = item?.system?.cost ?? {};
  return Math.round((Number(c.gp) || 0) + (Number(c.sp) || 0) / 10 + (Number(c.cp) || 0) / 100);
}

/** gp-equivalent parsed from row text like "(15 gp)" / "10 sp". */
export function parseValueGp(text) {
  const v = parseValue(text) ?? { gp: 0, sp: 0, cp: 0 };
  return Math.round((v.gp || 0) + (v.sp || 0) / 10 + (v.cp || 0) / 100);
}

/** Magic bonus (+N) from a name, else 0. */
export function bonusOf(name) {
  const m = String(name || "").match(/\+(\d)/);
  return m ? Number(m[1]) : 0;
}

// Tight magic regex — avoids false positives like "set of slippers".
const MAGIC_RE = /\+\d|potion of|\bscroll\b|\bwand\b|ring of|amulet of|cloak of|boots of|bag of holding|figurine of/i;

/** Is this loot item magic? */
export function isMagicItem({ name, type, needsRefinement, magicPack } = {}) {
  if (needsRefinement) return true;
  if (magicPack) return true;
  if (type && /spell|scroll|wand|potion/i.test(type)) return true;
  return MAGIC_RE.test(name || "");
}

/** Score → {tier, xp} from gp + magic + bonus, using {normal, fabulous} thresholds. */
export function scoreItem({ gp = 0, magic = false, bonus = 0 } = {}, { normal = 10, fabulous = 150 } = {}) {
  if (magic) return bonus >= 3 ? { tier: "Legendary", xp: 10 } : { tier: "Fabulous", xp: 3 };
  if (gp < normal) return { tier: "Poor", xp: 0 };
  if (gp < fabulous) return { tier: "Normal", xp: 1 };
  return { tier: "Fabulous", xp: 3 };
}
