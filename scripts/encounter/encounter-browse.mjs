/**
 * Shadowdark Enhancer — Encounter Browse data layer
 * Slice 1d: source listing, NPC loading + caching, filter/sort helpers.
 *
 * Pure data module — no DOM, no Application logic. The Browse NPCs tab
 * inside EncounterRollerApp calls into this module for its data needs.
 */

import { MODULE_ID } from "../module-id.mjs";

// In-memory cache: sourceId → array<row>. Cleared on browser refresh.
const _cache = new Map();

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
        id: pack.collection,           // e.g. "shadowdark.bestiary"
        label: pack.metadata.label,    // e.g. "Shadowdark Bestiary"
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
   * Filter rows by search text, alignment whitelist, and level range.
   * All filters are AND-combined. Empty/falsy filter values are skipped.
   *
   * @param {Array<object>} rows
   * @param {object} opts
   * @param {string} [opts.search]       — case-insensitive substring on name
   * @param {Array<string>} [opts.alignment] — e.g. ["L", "N"] (empty = all)
   * @param {number} [opts.levelMin]
   * @param {number} [opts.levelMax]
   * @returns {Array<object>}
   */
  applyFilters(rows, { search = "", alignment = [], levelMin = null, levelMax = null } = {}) {
    const needle = search.trim().toLowerCase();
    return rows.filter(r => {
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      if (alignment.length && !alignment.includes(r.alignment)) return false;
      if (levelMin != null && Number.isFinite(r.level) && r.level < levelMin) return false;
      if (levelMax != null && Number.isFinite(r.level) && r.level > levelMax) return false;
      return true;
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
    const numeric = ["level", "hp", "ac"].includes(column);
    rows.sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (numeric) {
        const aNaN = !Number.isFinite(av);
        const bNaN = !Number.isFinite(bv);
        if (aNaN && bNaN) return 0;
        if (aNaN) return 1;   // NaN always last
        if (bNaN) return -1;
        const cmp = av - bv;
        return ascending ? cmp : -cmp;
      }
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return ascending ? cmp : -cmp;
    });
    return rows;
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
      rows.push(this._actorToRow(actor, "world", "World Actors"));
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
      rows.push(this._actorToRow(actor, "scene", "Current Scene"));
    }
    return rows;
  },

  async _loadFromPack(packId) {
    const pack = game.packs.get(packId);
    if (!pack) return [];
    // Pack-level type filter handles 95% of cases; the documentName is
    // "Actor" for actor packs and "Item" for item packs.
    if (pack.documentName !== "Actor") return [];

    const label = pack.metadata.label;
    // getIndex with fields keeps memory down — we read the full doc
    // only when needed (which for the table view is never).
    const index = await pack.getIndex({
      fields: [
        "img",
        "type",                            // for the NPC-vs-Player filter below
        "system.level",
        "system.alignment",
        "system.attributes.hp.value",
        "system.attributes.hp.max",
        "system.attributes.ac.value",
        "system.move",
      ],
    });
    const rows = [];
    for (const entry of index) {
      // Shadowdark actor types: "Player" and "NPC". Filter to NPCs.
      // Some packs may not populate `type` in the index — fall back to
      // a shape check (NPCs have system.attributes.hp).
      const isNPC = entry.type === "NPC"
        || (!entry.type && entry.system?.attributes?.hp);
      if (!isNPC) continue;

      rows.push(this._packEntryToRow(entry, packId, label));
    }
    return rows;
  },

  _packEntryToRow(entry, packId, label) {
    const sys = entry.system ?? {};
    // Use the entry image if set and not the system's generic mystery-man.
    const img = entry.img && entry.img !== CONST.DEFAULT_TOKEN
      ? entry.img
      : "icons/svg/mystery-man.svg";
    return {
      uuid: `Compendium.${packId}.Actor.${entry._id}`,
      id: entry._id,
      name: entry.name ?? "Unknown",
      img,
      level: _coerceLevel(sys.level),
      alignment: sys.alignment ?? "",
      hp: _coerceHP(sys.attributes?.hp),
      ac: Number(sys.attributes?.ac?.value ?? 10),
      move: sys.move ?? "near",
      sourceId: packId,
      sourceLabel: label,
    };
  },

  _actorToRow(actor, sourceId, sourceLabel) {
    const sys = actor.system ?? {};
    return {
      uuid: actor.uuid,
      id: actor.id,
      name: actor.name ?? "Unknown",
      img: actor.img ?? "icons/svg/mystery-man.svg",
      level: _coerceLevel(sys.level),
      alignment: sys.alignment ?? "",
      hp: _coerceHP(sys.attributes?.hp),
      ac: Number(sys.attributes?.ac?.value ?? 10),
      move: sys.move ?? "near",
      sourceId,
      sourceLabel,
    };
  },
};

// ───── Helpers ─────────────────────────────────────────────────────

/**
 * Coerce a system.level value to a number. Shadowdark stores Level-0
 * mooks as `0` or sometimes `"--"` (string) for bestiary entries with
 * no formal level. We treat any non-finite value as NaN so the
 * filter/sort code can recognize "unknown" cleanly.
 */
function _coerceLevel(raw) {
  if (raw === null || raw === undefined || raw === "" || raw === "--") return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Coerce a system.attributes.hp object to a single display number.
 * Prefers `value` (current/instance HP) over `max` because:
 * - Static NPC entries have value === max anyway, so it doesn't matter
 * - Instance NPCs that have taken damage are usefully shown at current
 * - If both are missing, returns 0 (renders as "0" rather than blank)
 */
function _coerceHP(hp) {
  if (!hp) return 0;
  const v = Number(hp.value ?? hp.max ?? 0);
  return Number.isFinite(v) ? v : 0;
}
