/**
 * Shadowdark Enhancer — Encounter Browse data layer
 * Slice 1d: source listing, NPC loading + caching, filter/sort helpers.
 *
 * Pure data module — no DOM, no Application logic. The Browse NPCs tab
 * inside EncounterRollerApp calls into this module for its data needs.
 */

import { createNpcIndexRow, filterNpcIndexRows, sortNpcIndexRows } from "./npc-index.mjs";

// In-memory cache: sourceId → array<row>. Cleared on browser refresh.
const _cache = new Map();

// Keep the world/scene caches live: when NPC actors are created (e.g. the
// Monster Creator saves, or a bulk import commits), updated, or deleted, drop
// those caches so the Browse tab and Bestiary Loader don't show a stale list
// until a page reload. Compendium packs don't change during play and stay
// session-cached. Registered once at module load (ES modules are singletons).
for (const hook of ["createActor", "updateActor", "deleteActor"]) {
  Hooks.on(hook, (doc) => {
    if (doc?.type !== "NPC") return;
    _cache.delete("world");
    _cache.delete("scene");
  });
}

export const EncounterBrowse = {

  /**
   * Lists every source the Browse tab can read NPCs from.
   * Always includes the virtual `world` and `scene` entries plus every
   * installed compendium pack whose metadata.type === "Actor".
   *
   * @returns {Array<{id: string, label: string, type: "virtual" | "pack"}>}
   */
  listAvailableSources() {
    // Use localized labels for the virtual sources so the UI follows
    // the active language.
    const t = (k, fallback) => game.i18n?.localize?.(k) ?? fallback;
    const sources = [
      { id: "world", label: t("SDE.encounter.browse.source.world", "World Actors"), type: "virtual" },
      { id: "scene", label: t("SDE.encounter.browse.source.scene", "Current Scene"), type: "virtual" },
    ];
    for (const pack of game.packs) {
      if (pack.metadata.type !== "Actor") continue;
      sources.push({
        id: pack.collection,           // e.g. "shadowdark.monsters"
        label: pack.metadata.label,    // e.g. "Shadowdark Monsters"
        type: "pack",
      });
    }
    return sources;
  },

  /**
   * Load NPC rows from the given source IDs. Results are cached per
   * source for the session, so re-renders don't re-read compendium
   * indices.
   *
   * @param {Array<string>} sourceIds
   * @returns {Promise<Array<object>>} flattened rows
   */
  async loadNPCs(sourceIds = []) {
    const out = [];
    for (const id of sourceIds) {
      if (_cache.has(id)) {
        out.push(..._cache.get(id));
        continue;
      }
      const rows = await this._loadFromSource(id);
      _cache.set(id, rows);
      out.push(...rows);
    }
    return out;
  },

  /**
   * Drop the cache for one source (or all). Useful when the world
   * actors collection changes — call this from a createActor /
   * deleteActor hook in the orchestrating tab if you want live updates.
   * For Slice 1d we don't wire that hook; the cache lives until reload.
   *
   * @param {string|null} sourceId
   */
  invalidateCache(sourceId = null) {
    if (sourceId) _cache.delete(sourceId);
    else _cache.clear();
  },

  /**
   * Filter rows by all supported dimensions. All filters AND-combined.
   * Empty/falsy filter values are skipped.
   *
   * @param {Array<object>} rows
   * @param {object} opts
   * @param {string} [opts.search]            — case-insensitive substring on name
   * @param {Array<string>} [opts.alignment]  — e.g. ["L", "N"] (empty = all)
   * @param {number} [opts.levelMin]
   * @param {number} [opts.levelMax]
   * @param {number} [opts.hpMin]
   * @param {number} [opts.hpMax]
   * @param {number} [opts.acMin]
   * @param {number} [opts.acMax]
   * @param {Array<string>} [opts.moves]      — e.g. ["close", "near"] (empty = all)
   * @param {boolean} [opts.darkAdapted]      — true to require dark-adapted
   * @param {boolean} [opts.hasSpellcasting]  — true to require spellcaster
   * @param {string} [opts.abilitySearch]     — text-match against featureNames
   * @returns {Array<object>}
   */
  applyFilters(rows, {
    search = "",
    alignment = [],
    levelMin = null,
    levelMax = null,
    hpMin = null,
    hpMax = null,
    acMin = null,
    acMax = null,
    moves = [],
    darkAdapted = false,
    hasSpellcasting = false,
    abilitySearch = "",
    attackKinds = [],
  } = {}) {
    return filterNpcIndexRows(rows, {
      search,
      alignment,
      levelMin,
      levelMax,
      hpMin,
      hpMax,
      acMin,
      acMax,
      moves,
      darkAdapted,
      hasSpellcasting,
      abilitySearch,
      attackKinds,
    });
  },

  /**
   * Sort rows in place by the given column ascending/descending.
   * Numeric columns (level, hp, ac) use numeric comparison; everything
   * else uses string comparison.
   *
   * NaN handling: rows whose numeric column value is NaN (e.g. NPCs
   * with no level set, or `level: "--"`) always sort to the END of the
   * list regardless of ascending/descending — keeps "unknown" entries
   * from cluttering the top when sorting by Level.
   *
   * @param {Array<object>} rows
   * @param {object} opts
   * @param {string} opts.column      — one of: name, level, alignment, hp, ac, move, sourceLabel
   * @param {boolean} opts.ascending
   * @returns {Array<object>} returns the same array, sorted
   */
  applySort(rows, { column = "name", ascending = true } = {}) {
    return sortNpcIndexRows(rows, { column, ascending });
  },

  // ───── Internal ────────────────────────────────────────────────────

  /**
   * Load NPC rows from a single source.
   * @private
   */
  async _loadFromSource(id) {
    if (id === "world")  return this._loadFromWorld();
    if (id === "scene")  return this._loadFromScene();
    return this._loadFromPack(id);
  },

  _loadFromWorld() {
    const rows = [];
    for (const actor of game.actors) {
      if (actor.type !== "NPC") continue;
      rows.push(createNpcIndexRow(actor, { sourceId: "world", sourceLabel: "World Actors" }));
    }
    return rows;
  },

  _loadFromScene() {
    const scene = canvas.scene;
    if (!scene) return [];
    const seen = new Set();
    const rows = [];
    for (const tok of scene.tokens) {
      const actor = tok.actor;
      if (!actor || actor.type !== "NPC") continue;
      if (seen.has(actor.uuid)) continue;
      seen.add(actor.uuid);
      rows.push(createNpcIndexRow(actor, { sourceId: "scene", sourceLabel: "Current Scene" }));
    }
    return rows;
  },

  async _loadFromPack(packId) {
    const pack = game.packs.get(packId);
    if (!pack) return [];
    if (pack.documentName !== "Actor") return [];

    const label = pack.metadata.label;
    // Deep load: getDocuments fetches all actors with their embedded
    // items, so we can compute featureNames + attack counts +
    // spellcasting state per row. Slow on first call (a 250-NPC
    // bestiary takes ~2-5 seconds) but session-cached so it only
    // happens once per source.
    const docs = await pack.getDocuments();
    const rows = [];
    for (const actor of docs) {
      if (actor.type !== "NPC") continue;
      rows.push(createNpcIndexRow(actor, { sourceId: packId, sourceLabel: label }));
    }
    return rows;
  },
};
