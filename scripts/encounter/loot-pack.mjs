/**
 * Shadowdark Enhancer — Loot compendium helpers.
 *
 * Pure classification/fabrication for treasure entries (node-testable) plus
 * the Foundry pack ops that create/dedup a world "Loot" compendium. Reuses
 * the loot-linker to detect entries that already exist as compendium items.
 */

import { MODULE_ID } from "../module-id.mjs";
import { LootLinker } from "./loot-linker.mjs";

// Foundry core treasure icon (verified to exist; the prior gems path did not).
const GENERIC_TREASURE_ICON = "icons/commodities/treasure/box-jade-tassel.webp";
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

/** Build a Shadowdark "Basic" treasure Item from a name + parsed value. */
export function fabricateTreasureItem({ name, value, needsRefinement = false }) {
  const sde = { fromTreasureTable: true };
  if (needsRefinement) sde.needsRefinement = true;
  return {
    name,
    type: "Basic",
    img: GENERIC_TREASURE_ICON,
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

/** Find-or-create our world "Loot" Item compendium; unlock if locked. */
export async function ensureLootPack() {
  let pack = game.packs.find(p =>
    p.documentName === "Item" &&
    p.metadata.packageType === "world" &&
    (p.getFlag?.(MODULE_ID, "lootPack") === true || p.metadata.label === LOOT_PACK_LABEL)
  );
  if (!pack) {
    pack = await CompendiumCollection.createCompendium({ label: LOOT_PACK_LABEL, type: "Item", packageType: "world" });
    try { await pack.setFlag(MODULE_ID, "lootPack", true); } catch (_) {}
  }
  if (pack.locked) { try { await pack.configure({ locked: false }); } catch (_) {} }
  return pack;
}

/** Dedup-by-name create into the pack. Returns {uuid,name,created}. */
export async function ensureItemInPack(pack, itemData) {
  const index = await pack.getIndex();
  const existing = [...index].find(e => (e.name ?? "").toLowerCase() === itemData.name.toLowerCase());
  if (existing) {
    const uuid = existing.uuid ?? `Compendium.${pack.collection}.Item.${existing._id}`;
    return { uuid, name: existing.name, created: false };
  }
  const doc = await Item.create(itemData, { pack: pack.collection });
  return { uuid: doc.uuid, name: doc.name, created: true };
}
