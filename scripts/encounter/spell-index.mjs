/**
 * Shadowdark Enhancer — shared Spell index
 *
 * Light-weight loader for Shadowdark `Spell` items, used by the Monster
 * Creator's spell picker. Reads compendium indices (not full documents)
 * so searching hundreds of spells stays fast; the full source is only
 * resolved via `fromUuid` at add-time when a spell is actually attached.
 *
 * Mirrors the EncounterBrowse data-layer shape (listSources / loadAll /
 * filter / sort / invalidate) but for Item packs + world items.
 */

const DEFAULT_IMG = "icons/svg/daze.svg";

// In-memory cache: sourceId → array<row>. Cleared on browser refresh.
const _cache = new Map();

export const SpellIndex = {

  /**
   * Every source spells can be read from: the virtual `world` Items
   * collection plus every installed compendium whose type is "Item".
   * @returns {Array<{id: string, label: string, type: "virtual"|"pack"}>}
   */
  listSources() {
    const sources = [
      { id: "world", label: "World Items", type: "virtual" },
    ];
    for (const pack of game.packs) {
      if (pack.metadata.type !== "Item") continue;
      sources.push({
        id: pack.collection,
        label: pack.metadata.label,
        type: "pack",
      });
    }
    return sources;
  },

  /**
   * Load Spell rows from every available source, session-cached per
   * source so repeated searches don't re-read indices.
   * @returns {Promise<Array<object>>}
   */
  async loadAll() {
    const out = [];
    for (const src of this.listSources()) {
      out.push(...await this._loadFromSource(src.id, src.label));
    }
    return out;
  },

  /** Drop the cache for one source (or all). */
  invalidate(sourceId = null) {
    if (sourceId) _cache.delete(sourceId);
    else _cache.clear();
  },

  /**
   * Case-insensitive name substring + optional exact tier filter.
   * @param {Array<object>} rows
   * @param {object} opts
   * @param {string} [opts.search]
   * @param {number|null} [opts.tier]
   * @returns {Array<object>}
   */
  filter(rows, { search = "", tier = null } = {}) {
    const needle = String(search ?? "").trim().toLowerCase();
    return rows.filter(r => {
      if (needle && !String(r.name ?? "").toLowerCase().includes(needle)) return false;
      if (tier != null && Number(r.tier) !== Number(tier)) return false;
      return true;
    });
  },

  /**
   * Sort rows in place. `tier` is numeric (NaN sorts last); everything
   * else uses locale string comparison. A secondary name sort keeps
   * same-tier results stable/alphabetical.
   */
  sort(rows, { column = "name", ascending = true } = {}) {
    rows.sort((a, b) => {
      let cmp;
      if (column === "tier") {
        const av = Number(a.tier);
        const bv = Number(b.tier);
        const aNaN = !Number.isFinite(av);
        const bNaN = !Number.isFinite(bv);
        if (aNaN && bNaN) cmp = 0;
        else if (aNaN) return 1;
        else if (bNaN) return -1;
        else cmp = av - bv;
        if (cmp === 0) cmp = String(a.name ?? "").localeCompare(String(b.name ?? ""));
      } else {
        cmp = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
      }
      return ascending ? cmp : -cmp;
    });
    return rows;
  },

  // ───── Internal ────────────────────────────────────────────────────

  async _loadFromSource(id, label) {
    if (_cache.has(id)) return _cache.get(id);
    const rows = id === "world"
      ? this._loadWorld()
      : await this._loadPack(id, label);
    _cache.set(id, rows);
    return rows;
  },

  _loadWorld() {
    const rows = [];
    for (const item of game.items) {
      if (item.type !== "Spell") continue;
      rows.push(_makeRow({
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        tier: item.system?.tier,
        range: item.system?.range,
        duration: item.system?.duration,
        sourceLabel: "World Items",
      }));
    }
    return rows;
  },

  async _loadPack(packId, label) {
    const pack = game.packs.get(packId);
    if (!pack || pack.documentName !== "Item") return [];
    // Index-only load: pull just the fields the picker shows. `type`,
    // `name`, `img`, and `_id` are always indexed; the system.* fields
    // must be requested explicitly.
    const index = await pack.getIndex({
      fields: ["system.tier", "system.range", "system.duration"],
    });
    const rows = [];
    for (const entry of index) {
      if (entry.type !== "Spell") continue;
      rows.push(_makeRow({
        uuid: entry.uuid ?? pack.getUuid?.(entry._id) ?? `Compendium.${packId}.Item.${entry._id}`,
        name: entry.name,
        img: entry.img,
        tier: entry.system?.tier,
        range: entry.system?.range,
        duration: entry.system?.duration,
        sourceLabel: label ?? pack.metadata.label,
      }));
    }
    return rows;
  },
};

function _makeRow({ uuid, name, img, tier, range, duration, sourceLabel }) {
  const tierNum = Number(tier);
  const rangeLabel = _configLabel("SPELL_RANGES", range);
  const durationLabel = _durationLabel(duration);
  return {
    uuid,
    name: name ?? "Spell",
    img: img || DEFAULT_IMG,
    tier: Number.isFinite(tierNum) ? tierNum : 0,
    tierLabel: Number.isFinite(tierNum) ? `T${tierNum}` : "T?",
    range: range ?? "",
    rangeLabel,
    durationLabel,
    metaLabel: [rangeLabel, durationLabel].filter(Boolean).join(" • "),
    sourceLabel: sourceLabel ?? "",
  };
}

function _configLabel(group, key) {
  if (!key) return "";
  const raw = CONFIG.SHADOWDARK?.[group]?.[key];
  if (!raw) return String(key);
  return game.i18n?.localize?.(raw) ?? String(raw);
}

function _durationLabel(duration) {
  if (!duration) return "";
  const type = duration.type ?? "";
  const value = duration.value ?? "";
  const typeLabel = _configLabel("SPELL_DURATIONS", type);
  // Instantaneous/focus/permanent carry no numeric value; timed
  // durations (rounds/days etc.) read "N rounds".
  if (value && /^\d/.test(String(value))) return `${value} ${typeLabel}`.trim();
  return typeLabel;
}
