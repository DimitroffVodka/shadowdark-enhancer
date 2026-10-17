/**
 * Shadowdark Enhancer — what a generated merchant stocks (pure).
 *
 * A kind of shop carries some types of ordinary gear; the size of the town sets how many different wares it has, the
 * dearest single item it dares to hold, and how many bundles of each. The pool is whatever rows the caller gives it
 * (the gear packs' index, already narrowed to non-magic Catalog gear), so nothing here touches Foundry.
 */

import { bundleOf } from "./shop-core.mjs";

/** The shop kinds, in the order the editor lists them. `types` are the Item types the shop carries. */
export const KINDS = [
  { id: "general", types: ["Basic"], labelKey: "SDE.town.editor.kindGeneral" },
  { id: "weaponsmith", types: ["Weapon"], labelKey: "SDE.town.editor.kindWeaponsmith" },
  { id: "armorer", types: ["Armor"], labelKey: "SDE.town.editor.kindArmorer" },
  { id: "outfitter", types: ["Basic", "Weapon", "Armor"], labelKey: "SDE.town.editor.kindOutfitter" },
];

/** Town sizes: distinct wares, the dearest item in copper (null = no limit) and the most bundles of one ware. */
export const SIZES = [
  { id: "village", wares: 6, ceilingCp: 2000, maxBundles: 3, labelKey: "SDE.town.editor.sizeVillage" },
  { id: "town", wares: 12, ceilingCp: 7000, maxBundles: 5, labelKey: "SDE.town.editor.sizeTown" },
  { id: "city", wares: 20, ceilingCp: null, maxBundles: 8, labelKey: "SDE.town.editor.sizeCity" },
];

/** An item's data ready to embed in the merchant: no `_id`, and `bundles` bundles counted in units (stock is units; a bundle is `per_slot` of them). */
export function stockItem(data, bundles) {
  const { _id, ...rest } = data;
  return { ...rest, system: { ...rest.system, quantity: bundles * bundleOf(data) } };
}

/** Weapons and armor are rarer on a shelf than rope and torches: half the bundles, at least one. */
const maxFor = (size, type) => (type === "Basic" ? size.maxBundles : Math.max(1, Math.floor(size.maxBundles / 2)));

/**
 * Choose the stock. `pool` rows are `{ uuid, type, costCp }`; `rand` is a 0..1 source (Math.random in play).
 * Returns `[{ uuid, bundles }]`: no ware twice, nothing free or over the size's ceiling, bundles from 1 to the cap.
 */
export function pickStock(pool, { kind, size }, rand = Math.random) {
  const k = KINDS.find((x) => x.id === kind), s = SIZES.find((x) => x.id === size);
  if (!k || !s) return [];
  const seen = new Set();
  const fit = [...pool].filter((r) => {
    if (!r || seen.has(r.uuid) || !k.types.includes(r.type) || !(r.costCp > 0) || (s.ceilingCp !== null && r.costCp > s.ceilingCp)) return false;
    seen.add(r.uuid);
    return true;
  });
  for (let i = fit.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [fit[i], fit[j]] = [fit[j], fit[i]]; }
  return fit.slice(0, s.wares).map((r) => ({ uuid: r.uuid, bundles: 1 + Math.floor(rand() * maxFor(s, r.type)) }));
}
