/**
 * Shadowdark Enhancer — Loot item linker.
 *
 * Used by the Roll Table Importer to link a Loot row's result text to an
 * existing compendium Item when a confident name match exists. `findLink`
 * is pure (node-testable); `buildItemIndex` loads compendium indices
 * (Foundry) and is session-cached like SpellIndex.
 */

const LOOT_TYPES = new Set(["Weapon", "Armor", "Potion", "Basic"]);
const MIN_NAME_LEN = 4;

// Session cache for the prepared item list (longest-name-first).
let _itemCache = null;

/** Escape a string for safe use inside a RegExp. */
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find a confident compendium-item link for a result entry.
 * @param {string} text   the row's result text (book wording + price)
 * @param {Array<{uuid,name,nameLower}>} items  candidate items
 * @returns {{uuid:string,name:string,matched:string}|null}
 */
export function findLink(text, items) {
  const hay = String(text ?? "");
  if (!hay) return null;
  // Longest name first so multi-word names beat their substrings. Copy +
  // sort defensively in case the caller passed an unsorted list.
  const ordered = [...items].sort((a, b) => (b.nameLower?.length ?? 0) - (a.nameLower?.length ?? 0));
  for (const item of ordered) {
    const nl = item.nameLower ?? String(item.name ?? "").toLowerCase();
    if (nl.length < MIN_NAME_LEN) continue;
    const re = new RegExp("\\b" + escapeRegExp(nl) + "s?\\b", "i");
    const m = re.exec(hay);
    if (m) return { uuid: item.uuid, name: item.name, matched: m[0] };
  }
  return null;
}

/**
 * Load + prepare the candidate item list from every installed Item pack,
 * filtered to loot types and min length, deduped by name, longest-first.
 * Session-cached.
 * @returns {Promise<Array<{uuid,name,nameLower}>>}
 */
export async function buildItemIndex() {
  if (_itemCache) return _itemCache;
  const byName = new Map(); // nameLower -> {uuid,name,nameLower}
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
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
      if (byName.has(nameLower)) continue; // first pack wins
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

export const LootLinker = { buildItemIndex, findLink, invalidate };
