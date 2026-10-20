/**
 * Shadowdark Enhancer — what a generated merchant stocks (pure).
 *
 * A kind of shop carries some types of ordinary gear. Every ware it could carry is rolled once against the chance for
 * its rarity at the settlement's size (the Western Reaches' four sizes, Player's Guide p. 249), so common goods are
 * always there, and rare ones turn up now and then even in a village ("a bandit sold it there"). The pool is whatever
 * rows the caller gives it (the gear packs' index, already narrowed to non-magic Catalog gear), so nothing here touches
 * Foundry.
 */

import { bundleOf } from "./shop-core.mjs";

/** The shop kinds, in the order the editor lists them. `types` are the Item types the shop carries. */
export const KINDS = [
  { id: "general", types: ["Basic"], labelKey: "SDE.town.editor.kindGeneral" },
  { id: "weaponsmith", types: ["Weapon"], labelKey: "SDE.town.editor.kindWeaponsmith" },
  { id: "armorer", types: ["Armor"], labelKey: "SDE.town.editor.kindArmorer" },
  { id: "outfitter", types: ["Basic", "Weapon", "Armor"], labelKey: "SDE.town.editor.kindOutfitter" },
];

/**
 * Settlement sizes, smallest first; the ids are the hex data's own settlement words. `plenty` is the most bundles of a
 * common ware, and `chance` the % that a ware of each rarity is on the shelf at a restock.
 */
export const SIZES = [
  { id: "village", plenty: 3, chance: { common: 100, uncommon: 30, rare: 5, veryRare: 1 }, labelKey: "SDE.town.editor.sizeVillage" },
  { id: "town", plenty: 5, chance: { common: 100, uncommon: 75, rare: 20, veryRare: 3 }, labelKey: "SDE.town.editor.sizeTown" },
  { id: "city", plenty: 8, chance: { common: 100, uncommon: 95, rare: 50, veryRare: 10 }, labelKey: "SDE.town.editor.sizeCity" },
  { id: "city_state", plenty: 12, chance: { common: 100, uncommon: 100, rare: 80, veryRare: 30 }, labelKey: "SDE.town.editor.sizeCityState" },
];

const key = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The Shadowdark gear list's rarities, by name. */
const RARITY_NAMES = {
  common: [
    "Torch", "Rations", "Rope, 60'", "Flask", "Bottle", "Oil, flask", "Flint and Steel", "Backpack", "Pole", "Crowbar", "Iron Spikes", "Arrows", "Crossbow Bolts",
    "Club", "Dagger", "Staff", "Spear", "Sling", "Handaxe", "Javelin", "Shortbow", "Leather Armor", "Shield",
  ],
  uncommon: [
    "Lantern", "Grappling Hook", "Caltrops", "Crawling Kit", "Mirror",
    "Mace", "Morningstar", "Scimitar", "Shortsword", "Longsword", "Longbow", "Crossbow", "Chainmail", "Round Shield",
  ],
  rare: [
    "Greatsword", "Bastard Sword", "Greataxe", "Warhammer", "Pike", "Whip", "Club (Obsidian)", "Dagger (Obsidian)", "Spear (Obsidian)",
    "Boomerang", "Blowgun", "Bolas", "Shuriken", "Spear-thrower", "Stave", "Razor Chain", "Plate Mail",
  ],
  veryRare: ["Mithral Chainmail", "Mithral Plate Mail"],
};
const RARITY_BY_NAME = new Map(Object.entries(RARITY_NAMES).flatMap(([rarity, names]) => names.map((n) => [key(n), rarity])));

/**
 * Never stocked (Patrick's word): the Light spell entries, the Basilisk Egg, the five potions, the two the system gives
 * no price, and siege ammunition (the siege engines themselves are left out by their own flag, `siege` on a row).
 */
const LEFT_OUT = new Set([
  "Light Spell", "Light Spell (Double Range)", "Light Spell (Double Time)", "Basilisk Egg",
  "Curative", "Foebane", "Restorative", "Salve", "Stimulant", "Holy Symbol", "Thieves' Tools", "Siege Weapon Ammunition",
].map(key));

/** A ware's rarity: the gear list's own, else from its price (1 gp or less common, to 10 gp uncommon, to 100 gp rare, above that very rare). */
export function rarityOf({ name, costCp }) {
  const named = RARITY_BY_NAME.get(key(name));
  if (named) return named;
  const cp = Number(costCp) || 0;
  return cp <= 100 ? "common" : cp <= 1000 ? "uncommon" : cp <= 10000 ? "rare" : "veryRare";
}

/** Bundles of a ware on the shelf: common goods in plenty (weapons and armor half as many), uncommon a few, rare and very rare one. */
function bundlesFor(size, rarity, type, rand) {
  if (rarity === "rare" || rarity === "veryRare") return 1;
  if (rarity === "uncommon") return 2 + Math.floor(rand() * 2);
  const most = type === "Basic" ? size.plenty : Math.max(1, Math.floor(size.plenty / 2));
  const least = Math.ceil(most / 2);
  return least + Math.floor(rand() * (most - least + 1));
}

/** An item's data ready to embed in the merchant: no `_id`, and `bundles` bundles counted in units (stock is units; a bundle is `per_slot` of them). */
export function stockItem(data, bundles) {
  const { _id, ...rest } = data;
  return { ...rest, system: { ...rest.system, quantity: bundles * bundleOf(data) } };
}

/**
 * Roll the stock. `pool` rows are `{ uuid, name, type, costCp, siege }`; `rand` is a 0..1 source (Math.random in play).
 * Returns `[{ uuid, bundles, rarity }]`: no ware twice (the first row of a name wins, so the system's gear beats a copy),
 * nothing free or left out, each ware kept when its roll falls under its rarity's chance at this size.
 */
export function pickStock(pool, { kind, size }, rand = Math.random) {
  const k = KINDS.find((x) => x.id === kind), s = SIZES.find((x) => x.id === size);
  if (!k || !s) return [];
  const seen = new Set(), out = [];
  for (const r of pool) {
    const name = key(r?.name ?? r?.uuid);
    if (!r || r.siege || seen.has(r.uuid) || seen.has(name) || !k.types.includes(r.type) || !(r.costCp > 0) || LEFT_OUT.has(name)) continue;
    seen.add(r.uuid); seen.add(name);
    const rarity = rarityOf(r);
    if (rand() * 100 >= s.chance[rarity]) continue;
    out.push({ uuid: r.uuid, bundles: bundlesFor(s, rarity, r.type, rand), rarity });
  }
  return out;
}
