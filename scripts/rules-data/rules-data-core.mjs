/**
 * Shadowdark Enhancer — rules data (#195), pure and Foundry-free.
 *
 * The tables a hexcrawl book consults rather than rolls: what a hex costs to
 * enter, how many hexes a day a party covers, how far it sees, the climate of
 * a region in a season, and a settlement's carousing and warband-recruiting
 * limits. Overland, carousing and hex visibility all read them from here.
 *
 * NO VALUE SHIPS. Every table starts empty. The GM fills it from their own PDF
 * (Rules data window → Import from GM Guide, through the table importer's
 * `reference` recipes, table-shapes.mjs RULES_TABLES) or types it in. Only the
 * structure lives here: the tagger's terrain words, the travel methods, the
 * visibility conditions, the seasons and the settlement kinds.
 *
 * Stored as one world setting, `rulesData`. `rulesFrom()` lays whatever is
 * stored over the empty structure, so a world that never opened the window
 * still answers: null for a value nobody has given, no limit for a limit.
 */

import { TERRAIN_TAGS, SETTLEMENTS } from "../importer/hex/hex-summary.mjs";

/** The hex tagger's terrain tags ("salt_flat"), one row each in the terrain table. */
export const TERRAIN_KEYS = Object.values(TERRAIN_TAGS);
export const TERRAIN_TYPES = ["normal", "difficult", "impassable"];
/** Terrain types with a cost of their own; impassable has none. */
export const COSTED_TYPES = ["normal", "difficult"];
export const TRAVEL_METHODS = ["walking", "mounted", "sailing"];
export const VISIBILITY_KEYS = ["darkness", "stormy", "excellent", "slight", "high"];
export const ELEVATIONS = ["slight", "high"];
/** Climate columns, in the order the book prints them. */
export const SEASONS = ["spring_fall", "summer", "winter"];
/** A climate cell's harsh marker: "storm" harsh in stormy weather only, "always" at all times. */
export const HARSH = ["storm", "always"];
export const SETTLEMENT_KINDS = Object.values(SETTLEMENTS);

/**
 * Mountain counts as HIGH elevation until the GM says otherwise, and nothing
 * counts as slight: the Western Reaches has no hills (#195, a decision, not a
 * table value). A GM who clears it stores "", which is not put back.
 */
const DEFAULT_ELEVATION = { mountain: "high" };

/** Season words a caller may pass, as the column that answers them. */
const SEASON_OF = {
  spring: "spring_fall", fall: "spring_fall", autumn: "spring_fall", spring_fall: "spring_fall",
  summer: "summer", winter: "winter",
};

/**
 * A word as the tables key it: "Salt Flat" → "salt_flat", "City-State" →
 * "city_state". Gives every hex-tagger terrain word its own tag.
 */
export const ruleKey = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * A region name folded for matching. The climate table prints "Bastion Mtns"
 * and "Gloaming, The" where the chapter headings, and so the module's own
 * spelling (hex-region.mjs knownRegions), say "Bastion Mountains" and "The
 * Gloaming". Both fold to one key.
 */
export function regionKey(name) {
  return String(name ?? "").trim().toLowerCase()
    .replace(/^(.+?),\s*the$/, "the $1")
    .replace(/\bmtns\b\.?/g, "mountains")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The module's spelling of a printed region name: the known name it folds to
 * (pass hex-region.mjs knownRegions()), else the name as printed. One spelling
 * per region, the same rule regionSeeds follows.
 */
export function canonicalRegion(name, known = []) {
  const k = regionKey(name);
  return [...known].find((r) => regionKey(r) === k) ?? String(name ?? "").trim();
}

/** A stored or typed value as a number, or null when there is none. */
const num = (v) => (v === null || v === undefined || String(v).trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** The first whole number printed in a cell ("2,500 gp" → 2500, "13*" → 13, "−2" → -2), else null. */
export function cellNumber(cell) {
  const m = String(cell ?? "").replace(/[−–]/g, "-").replace(/(\d),(?=\d{3}\b)/g, "$1").match(/[+-]?\d+/);
  return m ? Number(m[0]) : null;
}

const climateCell = (c) => ({ label: String(c?.label ?? "").trim(), harsh: HARSH.includes(c?.harsh) ? c.harsh : "" });
const climateRow = (r) => ({
  region: String(r?.region ?? "").trim(),
  ...Object.fromEntries(SEASONS.map((s) => [s, climateCell(r?.[s])])),
});
const flat = (keys, from) => Object.fromEntries(keys.map((k) => [k, num(from?.[k])]));

/**
 * The whole rules data: what is stored, over the empty structure. Also the
 * sanitiser for a submitted form, so both reach the setting in one shape.
 * @param {object} [stored]  the `rulesData` setting (sparse, possibly `{}`)
 */
export function rulesFrom(stored) {
  const s = stored && typeof stored === "object" ? stored : {};
  const rows = Object.fromEntries(Object.entries(s.terrain ?? {}).map(([k, v]) => [ruleKey(k), v]).filter(([k]) => k));
  const terrain = {};
  for (const k of new Set([...TERRAIN_KEYS, ...Object.keys(rows)])) {
    const row = { type: "", cost: null, boat: null, elevation: DEFAULT_ELEVATION[k] ?? "", ...(rows[k] ?? {}) };
    terrain[k] = {
      type: TERRAIN_TYPES.includes(row.type) ? row.type : "",
      cost: num(row.cost),
      boat: num(row.boat),
      elevation: ELEVATIONS.includes(row.elevation) ? row.elevation : "",
    };
  }
  // A form posts its rows as { 0: …, 1: … }; the setting stores an array.
  const climate = Array.isArray(s.climate) ? s.climate : Object.values(s.climate ?? {});
  return {
    terrain,
    terrainTypes: flat(COSTED_TYPES, s.terrainTypes),
    travel: flat(TRAVEL_METHODS, s.travel),
    visibility: flat(VISIBILITY_KEYS, s.visibility),
    climate: climate.map(climateRow).filter((r) => r.region),
    carousing: flat(SETTLEMENT_KINDS, s.carousing),
    recruiting: flat(SETTLEMENT_KINDS, s.recruiting),
  };
}

/**
 * Hexes of movement a terrain costs to enter, for `rules` from rulesFrom().
 *
 * A row's own cost wins; a row with a type and no cost costs its type's
 * (the Terrain types table). A boat uses the row's boat cost where it has one.
 * Stormy weather makes normal terrain cost as difficult, and in a harsh
 * climate (`harsh`, from climate()) makes every terrain impassable that day.
 *
 * @param {object} rules
 * @param {string} terrain                 a tagger terrain word
 * @param {{boat?:boolean, weather?:string, harsh?:boolean}} [opts]
 * @returns {number|null} Infinity when impassable, null when unknown or unfilled
 */
export function terrainCost(rules, terrain, { boat = false, weather = "", harsh = false } = {}) {
  const row = rules?.terrain?.[ruleKey(terrain)];
  if (!row) return null;
  const stormy = ruleKey(weather) === "stormy";
  if (stormy && harsh) return Infinity;
  if (boat && row.boat !== null) return row.boat;
  if (row.type === "impassable") return Infinity;
  if (stormy && row.type === "normal") return rules.terrainTypes.difficult ?? row.cost;
  return row.cost ?? rules.terrainTypes[row.type] ?? null;
}

/**
 * Climate of a region in a season. `season` is spring, summer, fall (or
 * autumn) or winter; the region may be spelled either way the book does.
 * @returns {{region:string, season:string, label:string, harsh:""|"storm"|"always"}|null}
 */
export function climate(rules, region, season) {
  const col = SEASON_OF[ruleKey(season)];
  const k = regionKey(region);
  const row = k && rules?.climate?.find((r) => regionKey(r.region) === k);
  if (!col || !row?.[col]?.label) return null;
  return { region: row.region, season: col, ...row[col] };
}

/** A settlement limit: the number, Infinity for no limit, null for a kind the table does not know. */
function limitOf(table, kind) {
  const k = ruleKey(kind);
  if (!table || !(k in table)) return null;
  return table[k] ?? Infinity;
}

/**
 * The `game.shadowdarkEnhancer.rules` namespace over a reader of the stored
 * setting. The setting is read on every call, so an edit is seen at once.
 * @param {() => object} read  returns the stored `rulesData`
 */
export function rulesApi(read) {
  const rules = () => rulesFrom(read());
  return {
    terrainCost: (terrain, opts) => terrainCost(rules(), terrain, opts),
    hexesPerDay: (method) => rules().travel[ruleKey(method)] ?? null,
    visibility: () => {
      const r = rules();
      const elevation = Object.fromEntries(Object.entries(r.terrain).filter(([, t]) => t.elevation).map(([k, t]) => [k, t.elevation]));
      return { ...r.visibility, elevation };
    },
    climate: (region, season) => climate(rules(), region, season),
    carousingLimit: (kind) => limitOf(rules().carousing, kind),
    recruitingLimit: (kind) => limitOf(rules().recruiting, kind),
  };
}

// ── Import: printed rows → rules data ────────────────────────────────────────

/** A two-cell table read into the keys it knows; `keyOf` reads the key cell. */
function flatReader(keys, keyOf = ruleKey, ignore = []) {
  return (rows, skipped) => {
    const out = {};
    for (const [label, value] of rows) {
      const k = keyOf(label);
      if (keys.includes(k)) out[k] = cellNumber(value);
      else if (!ignore.includes(k)) skipped.push(label);
    }
    return out;
  };
}

/** A terrain row's type cell, by its first word ("Difficult going" → difficult). */
const typeOf = (cell) => {
  const w = ruleKey(String(cell ?? "").split(/\s+/)[0]);
  return TERRAIN_TYPES.includes(w) ? w : "";
};

/**
 * A terrain row's cost cell. "4 (2 with boat)" costs 4, or 2 by boat; "3 with
 * boat" is by boat only; a dash is no cost.
 */
function costOf(cell) {
  const s = String(cell ?? "");
  const boat = /(\d+)\s*with\s+boat/i.exec(s);
  const cost = /^\s*(\d+)\b(?!\s*with\b)/i.exec(s);
  return { cost: cost ? Number(cost[1]) : null, boat: boat ? Number(boat[1]) : null };
}

/** A climate cell: the label, with the book's † (always harsh) and * (harsh in storms) read off it. */
function climateOf(cell) {
  const s = String(cell ?? "");
  return { label: s.replace(/[†‡*]/g, "").trim(), harsh: s.includes("†") ? "always" : s.includes("*") ? "storm" : "" };
}

/**
 * One reader per RULES_TABLES id: (rows, skipped, opts) → that table's data.
 * Rows naming something this module does not key go to `skipped`, never
 * guessed at.
 */
export const READERS = {
  travel: flatReader(TRAVEL_METHODS),
  terrainTypes: flatReader(COSTED_TYPES, ruleKey, ["impassable"]),
  // "Stormy weather", "High elevation": the first word is the condition.
  visibility: flatReader(VISIBILITY_KEYS, (c) => ruleKey(String(c).split(/\s+/)[0])),
  carousing: flatReader(SETTLEMENT_KINDS),
  recruiting: flatReader(SETTLEMENT_KINDS),
  terrain: (rows, skipped) => {
    const out = {};
    for (const [word, type, cost] of rows) {
      const k = ruleKey(word);
      if (!TERRAIN_KEYS.includes(k)) { skipped.push(word); continue; }
      out[k] = { type: typeOf(type), ...costOf(cost) };
    }
    return out;
  },
  climate: (rows, _skipped, { canonical }) => rows.map(([region, ...cells]) => ({
    region: canonical(region),
    ...Object.fromEntries(SEASONS.map((s, i) => [s, climateOf(cells[i])])),
  })),
};

/**
 * Every table the import read, as partial rules data.
 * @param {Object<string, string[][]>} found  RULES_TABLES id → rows as cut
 * @param {{canonical?: (region:string) => string}} [opts]  region spelling (canonicalRegion)
 * @returns {{data: object, skipped: string[]}}
 */
export function readReferenceTables(found, { canonical = (r) => String(r ?? "").trim() } = {}) {
  const data = {};
  const skipped = [];
  for (const [id, rows] of Object.entries(found ?? {})) {
    if (READERS[id] && rows?.length) data[id] = READERS[id](rows, skipped, { canonical });
  }
  return { data, skipped };
}

/** A climate cell the way the book prints it, for the preview. */
const cellText = (c) => (c?.label ? `${c.label}${c.harsh === "always" ? "†" : c.harsh === "storm" ? "*" : ""}` : "");
const filled = (v) => v !== null && v !== undefined && v !== "";

/**
 * What an import would OVERWRITE: every value already filled in that the
 * import changes. Empty values it fills are not listed; they lose nothing.
 * @returns {Array<{table:string, row:string, field:string, from:*, to:*}>}
 */
export function importOverwrites(current, imported) {
  const cur = rulesFrom(current);
  const out = [];
  const check = (table, row, field, from, to) => { if (filled(from) && from !== to) out.push({ table, row, field, from, to }); };
  for (const [table, value] of Object.entries(imported ?? {})) {
    if (table === "climate") {
      for (const row of value) {
        const old = cur.climate.find((r) => regionKey(r.region) === regionKey(row.region));
        for (const s of SEASONS) check(table, row.region, s, cellText(old?.[s]), cellText(row[s]));
      }
    } else if (table === "terrain") {
      for (const [k, row] of Object.entries(value)) {
        for (const f of ["type", "cost", "boat"]) check(table, k, f, cur.terrain[k]?.[f] ?? null, row[f]);
      }
    } else if (cur[table]) {
      for (const [k, v] of Object.entries(value)) check(table, k, "", cur[table][k] ?? null, v);
    }
  }
  return out;
}

/**
 * Current rules with the imported tables laid over them. A terrain row keeps
 * its elevation (the book does not print one); a climate row replaces the row
 * for the same region, whichever way it was spelled.
 */
export function applyImport(current, imported) {
  const next = rulesFrom(current);
  for (const [table, value] of Object.entries(imported ?? {})) {
    if (table === "climate") {
      for (const row of value) {
        const i = next.climate.findIndex((r) => regionKey(r.region) === regionKey(row.region));
        if (i >= 0) next.climate[i] = row;
        else next.climate.push(row);
      }
    } else if (table === "terrain") {
      for (const [k, row] of Object.entries(value)) next.terrain[k] = { ...next.terrain[k], ...row };
    } else if (next[table]) {
      Object.assign(next[table], value);
    }
  }
  return rulesFrom(next);
}
