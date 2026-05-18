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
   * Filter rows by all supported dimensions. All filters AND-combined.
   * Empty/falsy filter values are skipped.
   *
   * @param {Array<object>} rows
   * @param {object} opts
   * @param {string} [opts.search]            — case-insensitive substring on name
   * @param {Array<string>} [opts.alignment]  — e.g. ["L", "N"] (empty = all)
   * @param {number} [opts.levelMin]
   * @param {number} [opts.levelMax]
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
    moves = [],
    darkAdapted = false,
    hasSpellcasting = false,
    abilitySearch = "",
  } = {}) {
    const needle = search.trim().toLowerCase();
    const abilityNeedle = abilitySearch.trim().toLowerCase();
    return rows.filter(r => {
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      if (alignment.length && !alignment.includes(r.alignment)) return false;
      if (levelMin != null && Number.isFinite(r.level) && r.level < levelMin) return false;
      if (levelMax != null && Number.isFinite(r.level) && r.level > levelMax) return false;
      if (moves.length && !moves.includes(r.move)) return false;
      if (darkAdapted && !r.darkAdapted) return false;
      if (hasSpellcasting && !r.hasSpellcasting) return false;
      if (abilityNeedle) {
        const names = r.featureNames ?? [];
        const hit = names.some(n => n.toLowerCase().includes(abilityNeedle));
        if (!hit) return false;
      }
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
      rows.push(this._actorToRow(actor, packId, label));
    }
    return rows;
  },

  _actorToRow(actor, sourceId, sourceLabel) {
    const sys = actor.system ?? {};
    const items = actor.items ?? [];

    // Index features and attacks for filtering / display. Shadowdark's
    // NPC schema doesn't encode immunities/weaknesses/senses as
    // structured fields — those live in NPC Feature item names +
    // descriptions, so feature-name search is the closest analogue to
    // Vagabond's structured filters.
    const featureNames = [];
    let attackCount = 0;
    const attackKinds = { melee: false, ranged: false };
    for (const it of items) {
      if (it.type === "NPC Feature") {
        if (it.name) featureNames.push(it.name);
      } else if (it.type === "NPC Attack" || it.type === "NPC Special Attack") {
        attackCount += Number(it.system?.attack?.num ?? 1);
        const ranges = it.system?.ranges ?? [];
        if (ranges.includes("close")) attackKinds.melee = true;
        if (ranges.includes("near") || ranges.includes("far")) attackKinds.ranged = true;
      }
    }

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
      darkAdapted: !!sys.darkAdapted,
      hasSpellcasting: Number(sys.spellcasting?.attacks ?? 0) > 0,
      spellcastingBonus: Number(sys.spellcasting?.bonus ?? 0),
      featureNames,
      attackCount,
      attackKinds,
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
  // Shadowdark schema (actorFields.level) stores level as a NESTED
  // SchemaField: { value: number, xp: number }. Plain `Number(obj)`
  // gives NaN, which is why pack-index rows previously rendered
  // "NaN" in the Level column even for normal NPCs. Unwrap the .value
  // first; fall through to the legacy plain-number path so any
  // unmigrated data still works.
  let n = raw;
  if (n && typeof n === "object" && "value" in n) n = n.value;
  if (n === null || n === undefined || n === "" || n === "--") return NaN;
  const num = Number(n);
  return Number.isFinite(num) ? num : NaN;
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
