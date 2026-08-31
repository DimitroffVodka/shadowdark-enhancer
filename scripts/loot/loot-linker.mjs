/**
 * Shadowdark Enhancer — Loot item linker.
 *
 * Used by the Roll Table Importer to link a Loot row's result text to an
 * existing compendium Item when a confident name match exists. `findLink`
 * is pure (node-testable); `buildItemIndex` loads compendium indices
 * (Foundry) and is session-cached like SpellIndex.
 *
 * System-first ordering (D3, A-06): `buildItemIndex` visits system Item packs
 * before world/module packs (including sde-items). Because `byName` deduplication
 * keeps the FIRST occurrence, a system item beats an sde-items import of the same
 * name — imports fill gaps, system wins on clash.
 *
 * The MATCH itself lives in `loot-resolution.mjs` (A7). It used to be a
 * containment regex here, which is how "Unopened bottle of … Murgazi wine"
 * resolved to the plain system `Bottle` (#58). `findLink` keeps its shape for
 * the six call sites that read `{uuid,name,matched}`; callers that need to tell
 * an ambiguous row from an unmatched one call `resolveLootItem` directly.
 */

import { resolveLootItem, isResolvedLootMatch } from "./loot-resolution.mjs";

const LOOT_TYPES = new Set(["Weapon", "Armor", "Potion", "Basic"]);
// Candidate-set floor, unchanged by A7. It was load-bearing for the old
// containment matcher (a three-letter name matched half the table); it is now
// only a decision about which items are candidates at all, so it stays where it
// was rather than quietly widening the index this ticket does not own.
const MIN_NAME_LEN = 4;

// Session cache for the prepared item list (longest-name-first).
let _itemCache = null;

/**
 * Partition an iterable of pack-like objects so system packs come first,
 * preserving relative order within each partition. Pure, Foundry-free.
 *
 * A pack is "system" when its `packageType === "system"`. Everything else
 * (world, module, etc.) follows in second position.
 *
 * This implements the D3 system-first contract for `buildItemIndex`: because
 * the dedup map honours first-seen, a system item beats an sde-items import of
 * the same name — imports fill gaps.
 *
 * @param {Iterable<{packageType:string, collection:string}>} packsLike
 * @returns {Array<{packageType:string, collection:string}>}
 */
export function orderPacksSystemFirst(packsLike) {
  const system = [];
  const rest   = [];
  for (const p of packsLike) {
    if (p.packageType === "system") system.push(p);
    else rest.push(p);
  }
  return [...system, ...rest];
}

/**
 * Find a confident compendium-item link for a result entry.
 *
 * Confident means exact or alias (`loot-resolution.mjs`). An ambiguous row —
 * two distinct items answering to the same folded name — is NOT a link and
 * returns null, same as no match at all.
 *
 * @param {string} text   the row's result text (book wording + price)
 * @param {Array<{uuid,name,nameLower}>} items  candidate items
 * @returns {{uuid:string,name:string,matched:string}|null}
 */
export function findLink(text, items) {
  const hit = resolveLootItem(text, items);
  if (!isResolvedLootMatch(hit)) return null;
  return { uuid: hit.uuid, name: hit.name, matched: hit.matched };
}

/**
 * Load + prepare the candidate item list from every installed Item pack,
 * filtered to loot types and min length, deduped by name (system packs first,
 * then world/module packs including sde-items), longest-first.
 * Session-cached.
 *
 * System-first ordering (D3 / A-06): `orderPacksSystemFirst` puts packs with
 * `packageType === "system"` before world/module packs. Because `byName.has()`
 * skips later duplicates, a system item wins over a same-named sde-items import.
 *
 * @returns {Promise<Array<{uuid,name,nameLower}>>}
 */
export async function buildItemIndex() {
  if (_itemCache) return _itemCache;
  const byName = new Map(); // nameLower -> {uuid,name,nameLower}
  // System packs first (D3 / A-06 system-first dedup)
  const itemPacks = [...game.packs].filter((p) => p.documentName === "Item");
  for (const pack of orderPacksSystemFirst(itemPacks)) {
    let index;
    try {
      index = await pack.getIndex({ fields: ["type"] });
    } catch (_) {
      continue; // unreadable pack — skip
    }
    for (const entry of index) {
      if (!LOOT_TYPES.has(entry.type)) continue;
      const name = entry.name ?? "";
      if (name.length < MIN_NAME_LEN) continue;
      const nameLower = name.toLowerCase();
      if (byName.has(nameLower)) continue; // first pack wins (system beats sde-items)
      const uuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
      byName.set(nameLower, { uuid, name, nameLower });
    }
  }
  _itemCache = [...byName.values()].sort((a, b) => b.nameLower.length - a.nameLower.length);
  return _itemCache;
}

/** Clear the session cache (e.g. after compendium changes). */
export function invalidate() {
  _itemCache = null;
}

export const LootLinker = {
  buildItemIndex, findLink, invalidate, orderPacksSystemFirst, resolveLootItem,
};
