/**
 * Shadowdark Enhancer — Loot compendium helpers.
 *
 * Pure classification/fabrication for treasure entries (node-testable) plus
 * the Foundry pack ops that create/dedup a world "Loot" compendium. Reuses
 * the loot-linker to detect entries that already exist as compendium items.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { LootLinker } from "./loot-linker.mjs";
import { findSuitePack, ensureSuite, ensureSourceFolder } from "../shared/compendium-suite.mjs";
import { pickShikashiIcon, shikashiIcon } from "../importer/items/shikashi-icons.mjs";

// Foundry core icons (all verified to exist) for treasure categories.
const ICONS = {
  box:     "icons/commodities/treasure/box-jade-tassel.webp",
  gem:     "icons/commodities/gems/gem-faceted-asscher-blue.webp",
  jewelry: "icons/commodities/treasure/brooch-gold-ruby.webp",
  scroll:  "icons/sundries/scrolls/scroll-bound-blue-tan.webp",
  wand:    "icons/weapons/wands/wand-gem-blue.webp",
  potion:  "icons/consumables/potions/bottle-bulb-corked-labeled-blue.webp",
  armor:   "icons/equipment/chest/breastplate-banded-blue.webp",
  shield:  "icons/equipment/shield/buckler-wooden-round-hole.webp",
  sword:   "icons/weapons/swords/greatsword-blue.webp",
  axe:     "icons/weapons/axes/axe-battle-black.webp",
  hammer:  "icons/weapons/hammers/hammer-double-bronze.webp",
  bow:     "icons/weapons/bows/bow-recurve-black.webp",
  dagger:  "icons/weapons/daggers/dagger-blue.webp",
  staff:   "icons/weapons/staves/staff-animal-bird.webp",
  ring:    "icons/equipment/finger/ring-ball-gold-pink.webp",
  vessel:  "icons/containers/kitchenware/bowl-clay-brown.webp",
  book:    "icons/sundries/books/book-backed-blue-gold.webp",
};
const LOOT_PACK_LABEL = "Loot";

/** Sum every `N gp/sp/cp` occurrence into a coin object. */
export function parseValue(text) {
  const out = { gp: 0, sp: 0, cp: 0 };
  const re = /(\d+)\s*(gp|sp|cp)/gi;
  let m;
  while ((m = re.exec(String(text ?? "")))) out[m[2].toLowerCase()] += Number(m[1]);
  return out;
}

/** True when the entry is currency, not a priced object (no trailing `(N gp)`). */
export function isCoinEntry(text) {
  const s = String(text ?? "");
  const hasPriceSuffix = /\([^)]*\b\d+\s*(?:gp|sp|cp)\b[^)]*\)\s*$/i.test(s);
  if (hasPriceSuffix) return false;
  return /\b\d+\s*(?:gp|sp|cp)\b/i.test(s);
}

/** True for the needs-refinement bucket (scrolls/wands/+N magic). */
export function isDeferredType(text) {
  return /spell scroll|magic wand|\bwand\b|\+\d|magic\s+(?:armor|weapon)/i.test(String(text ?? ""));
}

/** Remove the trailing `(… gp …)` price suffix and a trailing "each". */
export function stripPrice(text) {
  return String(text ?? "")
    .replace(/\s*\([^)]*\b\d+\s*(?:gp|sp|cp)\b[^)]*\)\s*$/i, "")
    .replace(/\s+each$/i, "")
    .trim();
}

/**
 * Best-guess icon for a treasure item by keyword in its name. The bundled
 * Shikashi set (shikashi-icons.mjs) is tried first; the Foundry-core
 * category chain below remains as the safety net for names it misses,
 * with a Shikashi generic fallback at the end.
 */
export function pickTreasureIcon(text) {
  const shikashi = pickShikashiIcon(text);
  if (shikashi) return shikashi;
  const s = String(text ?? "").toLowerCase();
  const has = (...kw) => kw.some(k => s.includes(k));
  if (has("scroll")) return ICONS.scroll;
  if (has("wand")) return ICONS.wand;
  if (has("potion")) return ICONS.potion;
  if (has("idol", "statue", "statuette", "sculpture", "figurine")) return ICONS.box;
  if (has("chainmail", "plate mail", "leather armor", "scale mail", "armor")) return ICONS.armor;
  if (has("shield")) return ICONS.shield;
  if (has("greataxe", "axe")) return ICONS.axe;
  if (has("warhammer", "hammer", "mace")) return ICONS.hammer;
  if (has("greatsword", "longsword", "bastard sword", "shortsword", "sword", "blade", "magic weapon")) return ICONS.sword;
  if (/\bbow\b/.test(s) || has("longbow", "crossbow", "shortbow")) return ICONS.bow;
  if (has("dagger")) return ICONS.dagger;
  if (has("staff")) return ICONS.staff;
  if (/\bring\b/.test(s)) return ICONS.ring;
  if (has("necklace", "amulet", "pendant", "torc", "circlet", "brooch", "scarab", "locket", "tiara", "crown")) return ICONS.jewelry;
  if (has("bowl", "cup", "goblet", "tankard", "flask", "vase", "mug", "chalice", "censer", "vial", "bottle", "flagon")) return ICONS.vessel;
  if (has("book", "bestiary", "tome", "grimoire")) return ICONS.book;
  if (has("gem", "emerald", "sapphire", "diamond", "ruby", "pearl", "opal", "amber", "jade", "crystal", "jewel", "topaz", "garnet")) return ICONS.gem;
  return shikashiIcon("treasure-chest");
}

/** Build a Shadowdark "Basic" treasure Item from a name + parsed value. */
export function fabricateTreasureItem({ name, value, needsRefinement = false }) {
  const sde = { fromTreasureTable: true };
  if (needsRefinement) sde.needsRefinement = true;
  return {
    name,
    type: "Basic",
    img: pickTreasureIcon(name),
    system: {
      cost: { gp: value?.gp ?? 0, sp: value?.sp ?? 0, cp: value?.cp ?? 0 },
      slots: { free_carry: 0, per_slot: 1, slots_used: 1 },
      treasure: true,
      quantity: 1,
    },
    flags: { [MODULE_ID]: sde },
  };
}

/**
 * Classify one treasure-entry text.
 * @returns {{action:"coin"}|{action:"link",uuid,name}|{action:"create",itemData}}
 */
export function classifyEntry(text, items) {
  if (isCoinEntry(text)) return { action: "coin" };
  const link = LootLinker.findLink(text, items);
  if (link) return { action: "link", uuid: link.uuid, name: link.name };
  const name = stripPrice(text);
  const value = parseValue(text);
  const itemData = fabricateTreasureItem({ name, value, needsRefinement: isDeferredType(text) });
  return { action: "create", itemData };
}

// ───── Foundry pack ops (live-verified in the catalog build task) ─────

/**
 * Persistence target for fabricated/catalog loot: the managed sde-items suite
 * pack (A-07 / D8 — nothing materializes into the legacy world "Loot" pack).
 * Name kept for callers.
 */
export async function ensureLootPack() {
  let pack = findSuitePack("sde-items");
  if (!pack) pack = (await ensureSuite())?.items;
  if (pack?.locked) { try { await pack.configure({ locked: false }); } catch (_) {} }
  return pack;
}

/** Dedup-by-name create into the pack, filed under the "Custom" source folder. Returns {uuid,name,created}. */
export async function ensureItemInPack(pack, itemData) {
  const index = await pack.getIndex();
  const existing = [...index].find(e => (e.name ?? "").toLowerCase() === itemData.name.toLowerCase());
  if (existing) {
    const uuid = existing.uuid ?? `Compendium.${pack.collection}.Item.${existing._id}`;
    return { uuid, name: existing.name, created: false };
  }
  const data = { ...itemData };
  if (!data.folder) {
    const folderId = await ensureSourceFolder(pack, "");
    if (folderId) data.folder = folderId;
  }
  data.flags = {
    ...(data.flags ?? {}),
    [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), source: "", imported: true },
  };
  const doc = await Item.create(data, { pack: pack.collection });
  return { uuid: doc.uuid, name: doc.name, created: true };
}
