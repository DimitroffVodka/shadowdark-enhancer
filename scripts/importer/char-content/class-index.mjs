/**
 * Shadowdark Enhancer — shared Class index.
 *
 * Resolves a plain class name ("Wizard", "Priest") to its system Class item
 * UUID so imported Spells can populate their `system.class` array. Mirrors the
 * SpellIndex data-layer shape (build / resolveByName / invalidate): reads
 * compendium INDICES (not full docs) so it stays fast, and is session-cached.
 *
 * Resolution priority honours the suite convention (prefer system packs):
 * `shadowdark.*` Item packs first, then other Item packs, then world items.
 *
 * Foundry-bound (needs `game`). Kept separate from the pure spell parser so the
 * parser stays node-testable — the parser records the class NAME, this resolves
 * it to a UUID at commit time.
 */

/** @type {Map<string,{uuid:string,name:string}>|null} lowercased name → class */
let _index = null;

export const ClassIndex = {
  /** Build (or reuse) the name→class map across packs + world items. */
  async buildIndex() {
    if (_index) return _index;
    const map = new Map();
    const add = (name, uuid) => {
      const key = String(name ?? "").trim().toLowerCase();
      if (!key || !uuid || map.has(key)) return; // first writer wins (priority order below)
      map.set(key, { uuid, name });
    };

    const itemPacks = [...game.packs].filter((p) => p.metadata.type === "Item");
    const ordered = [
      ...itemPacks.filter((p) => p.collection.startsWith("shadowdark.")),
      ...itemPacks.filter((p) => !p.collection.startsWith("shadowdark.")),
    ];
    for (const pack of ordered) {
      let index;
      try { index = await pack.getIndex(); } catch (_) { continue; }
      for (const entry of index) {
        if (entry.type !== "Class") continue;
        add(entry.name, entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`);
      }
    }
    // World items last (fallback, lowest priority).
    for (const item of game.items) {
      if (item.type === "Class") add(item.name, item.uuid);
    }

    _index = map;
    return map;
  },

  /**
   * Resolve a class name → { uuid, name } or null. Case-insensitive.
   * @param {string} name
   * @returns {Promise<{uuid:string,name:string}|null>}
   */
  async resolveByName(name) {
    const key = String(name ?? "").trim().toLowerCase();
    if (!key) return null;
    const map = await this.buildIndex();
    return map.get(key) ?? null;
  },

  /** Drop the cache (call after creating/importing Class items). */
  invalidate() { _index = null; },
};

/**
 * Resolve a spell draft's `className` (string, from the pure parser) into its
 * `class` UUID array in place. Returns a warning string when the class can't be
 * resolved (the spell still imports, just unlinked — same stance as the WR
 * Necromancer spells), or null on success / when no class name was parsed.
 *
 * @param {{className?:string, class?:string[]}} draft
 * @returns {Promise<string|null>}
 */
export async function resolveSpellClass(draft) {
  if (!Array.isArray(draft.class)) draft.class = [];
  const cls = String(draft.className ?? "").trim();
  if (!cls) return null;
  const hit = await ClassIndex.resolveByName(cls);
  if (hit?.uuid) { draft.class = [hit.uuid]; return null; }
  return `class "${cls}" not found in your packs — spell imported unlinked`;
}
