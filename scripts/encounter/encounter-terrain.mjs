/**
 * Shadowdark Enhancer — terrain for encounter checks.
 *
 * With a hex map tagged (scripts/hex-map), the scene knows what every hex is.
 * This turns that into the one thing a wandering-monster check wants: the
 * party is in a forest, so roll the forest table. The GM maps terrain to roll
 * tables once (Encounter menu → Tables by terrain), and the check picks the
 * table for the hex the party stands in, falling back to the single active
 * table whenever the scene has no tags, the party is off the map, or that
 * terrain has no table of its own.
 *
 * The party's hex is the controlled token's when the GM has one selected —
 * that is an explicit "here" — and otherwise the hex most of the player
 * characters' tokens stand in, so a party spread over two hexes still answers.
 * Phase 6 of docs/plans/hex-map-dataset.md.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { cellNumber, foundryOffsetToCube } from "../hex-map/geometry.mjs";
import { decodeTags } from "../hex-map/tag-store.mjs";

/** Scene flag holding the tag store (hex-tagger-app.mjs owns it). */
const TAGS_FLAG = "hexTags";
/** World setting: { terrainKey: rollTableUuid }. */
export const TERRAIN_TABLES = "encounterTerrainTables";

/**
 * The suite pack every table in this file comes from.
 *
 * A constant because the two readers below asked for it under DIFFERENT names:
 * one said "tables" (right) and one said "roll-tables" (wrong — findSuitePack
 * matches a descriptor's `key` or `id`, and there is no such descriptor). The
 * wrong one returned undefined and the function then returned an empty map, so
 * every hex on a fully tagged map reported "no encounter table" and nothing
 * anywhere said why. Named once so the two cannot drift again.
 */
export const TABLES_PACK = "tables";

/** A terrain word as the tables are keyed: lower case, underscores ("Salt Flat" → "salt_flat"). */
export function terrainKey(terrain) {
  return String(terrain ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

/** The table for a terrain, else the fallback (the single active table). */
export function pickTable(tables, terrain, fallback = "") {
  const key = terrainKey(terrain);
  return (key && tables?.[key]) || fallback || "";
}

/**
 * A book's per-region encounter grid, as the importer files it.
 *
 * The GM Guide prints one Encounter Zone grid per region and the importer files
 * a table per printed column: "Western Reaches GM Guide - Bastion Mountains
 * Encounter Zone: Coast". So the region and the column are recoverable from the
 * name, and nothing about the book has to ship here — this reads whatever the
 * GM actually imported.
 * @returns {{region:string, column:string}|null}
 */
export function parseZoneTableName(name) {
  // "Encounter Zone" in most regions; Tal-Yool Jungle heads the same grid
  // "Encounter Type by Terrain" (WR p228) and the importer files it as
  // "Encounter Type: Jungle/Path". Same shape, same job: roll the terrain's
  // column to find out what kind of encounter it is.
  const m = String(name ?? "").match(/^(?:.*?\s-\s)?(.+?)\s+Encounter (?:Zone|Type):\s*(.+)$/);
  return m ? { region: m[1].trim(), column: m[2].trim() } : null;
}

/**
 * A printed column label as terrain keys.
 *
 * The books do NOT use one vocabulary for these columns. Most are terrain
 * ("Coast", "Salt Flat"), some are terrain under another name ("Grass",
 * "Fields"), and some are not terrain at all: a compass half ("N. Mountain",
 * "S. Ocean"), a time of day ("Swamp, Night") or a moon phase ("Full Moon").
 * The qualifier is stripped so the terrain underneath can still be matched —
 * which deliberately collapses "N. Mountain" and "S. Mountain" onto one key, so
 * a mountain hex in that region comes back as AMBIGUOUS rather than being given
 * whichever column happened to be checked first.
 */
export function zoneColumnKeys(label) {
  // One column can head two terrains — Tal-Yool prints "Jungle/Path" and
  // "Mountain/Lava" — and a hex matching either rolls it.
  return String(label ?? "").split("/").map((part) => {
    const bare = part.trim().toLowerCase()
      .replace(/^[ns]\.\s*/, "")                 // compass half
      .replace(/,\s*(day|night)$/, "")           // time of day
      .trim();
    const key = terrainKey(bare);
    return ZONE_COLUMN_ALIASES[key] ?? key;
  }).filter(Boolean);
}

/** Column labels that name a terrain the tagger spells differently. */
export const ZONE_COLUMN_ALIASES = { grass: "grassland", fields: "grassland", sea: "ocean", marsh: "swamp", woods: "forest" };

/** Terrain keys a "Water" or "Land" column sorts a hex by. */
export const WATERY = new Set(["ocean", "arctic_sea", "lake", "river", "coast", "sea", "water"]);

/**
 * Which of a region's columns this hex could roll on.
 *
 * Two tiers, and the tiers matter: a column naming the hex's own terrain (or
 * one of its river/path/coast features) beats a catch-all like "Water", so a
 * coast hex in a region printing both Coast and Water takes Coast.
 *
 * More than one match is not resolved here. It means the book split that
 * terrain by something the map does not say — day and night, a moon phase,
 * north and south — and picking one would be inventing the answer.
 * @param {string} terrain            the hex's terrain tag
 * @param {string[]} features         its river/path/coast tags
 * @param {Array<{column:string}>} columns  that region's imported columns
 * @returns {Array<object>} the columns that fit, best tier only
 */
export function zoneCandidates(terrain, features, columns) {
  const key = terrainKey(terrain);
  const marks = (features ?? []).map(terrainKey);
  const exact = [], category = [];
  const wet = WATERY.has(key) || marks.some((m) => WATERY.has(m));
  for (const col of columns ?? []) {
    const keys = zoneColumnKeys(col.column);
    if (!keys.length) continue;
    if (keys.some((ck) => ck === key || marks.includes(ck))) { exact.push(col); continue; }
    if (keys.some((ck) => (ck === "water" || ck === "ocean") && wet)) category.push(col);
    else if (keys.some((ck) => ck === "land") && key && !wet) category.push(col);
  }
  return exact.length ? exact : category;
}

/**
 * The encounter table for a hex, by region and terrain.
 * @returns {{status:"ok", column:object}|{status:"ambiguous", columns:object[]}|{status:"none"}}
 */
export function pickZoneTable(region, terrain, features, byRegion) {
  const columns = byRegion?.get?.(region) ?? byRegion?.[region];
  if (!columns?.length) return { status: "none" };
  const hit = zoneCandidates(terrain, features, columns);
  if (hit.length === 1) return { status: "ok", column: hit[0] };
  if (hit.length > 1) return { status: "ambiguous", columns: hit };
  return { status: "none" };
}

/** Every imported Encounter Zone table, grouped by region. @returns {Promise<Map<string, object[]>>} */
export async function encounterZonesByRegion() {
  const pack = findSuitePack(TABLES_PACK);
  const out = new Map();
  if (!pack) {
    // Distinguishable from "imported no grids": without this the caller cannot
    // tell a missing pack from an empty one, and the map just looks unusable.
    console.warn(`Shadowdark Enhancer | encounter zones: no "${TABLES_PACK}" pack in this world`);
    return out;
  }
  for (const row of pack.index ?? []) {
    const parsed = parseZoneTableName(row.name);
    if (!parsed) continue;
    if (!out.has(parsed.region)) out.set(parsed.region, []);
    out.get(parsed.region).push({ ...parsed, uuid: `Compendium.${pack.collection}.${row._id}`, name: row.name });
  }
  return out;
}

/** Every terrain on a scene's tags, most cells first: { key, label, count }. */
export function sceneTerrains(flag) {
  const byKey = new Map();
  for (const cell of decodeTags(flag).cells.values()) {
    if (!cell.terrain) continue;
    const key = terrainKey(cell.terrain);
    const row = byKey.get(key) ?? { key, label: cell.terrain, count: 0 };
    row.count++;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Scene points of the tokens that stand for the party right now. */
function partyPoints(canvasRef) {
  const controlled = canvasRef?.tokens?.controlled ?? [];
  const tokens = controlled.length
    ? controlled
    : (canvasRef?.tokens?.placeables ?? []).filter((t) => t.actor?.type === "Player" && t.actor?.hasPlayerOwner);
  return tokens.map((t) => t.center).filter((c) => Number.isFinite(c?.x) && Number.isFinite(c?.y));
}

/**
 * The hex the party is in on the active scene.
 * @returns {{num:number, terrain:string|null, features:string[]}|null} null when the
 *   scene is not a numbered hex map or no party token is on it
 */
export function partyHex(canvasRef = globalThis.canvas) {
  const grid = canvasRef?.grid;
  const flag = canvasRef?.scene?.getFlag?.(MODULE_ID, TAGS_FLAG);
  if (!flag?.origin || !grid?.isHexagonal || !grid.columns) return null;
  const o = flag.origin;
  const origin = { cube: { q: o.q, r: o.r }, num: o.num, shifted: o.shifted ?? "odd", bounds: o.bounds };
  const counts = new Map();
  for (const point of partyPoints(canvasRef)) {
    const { num } = cellNumber(foundryOffsetToCube(grid.getOffset(point), !!grid.even), origin);
    if (num !== null) counts.set(num, (counts.get(num) ?? 0) + 1);
  }
  const num = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (num === undefined) return null;
  const cell = decodeTags(flag).cells.get(String(num));
  return { num, terrain: cell?.terrain ?? null, features: cell?.features ?? [] };
}

/** Every roll table the GM could pick: the world's, then this module's pack. */
async function tableChoices() {
  const groups = [{ label: "World", tables: game.tables.contents.map((t) => ({ uuid: t.uuid, name: t.name })) }];
  const pack = findSuitePack(TABLES_PACK);
  if (pack) {
    const index = await pack.getIndex();
    groups.push({ label: pack.title ?? "Compendium", tables: index.map((t) => ({ uuid: `Compendium.${pack.collection}.RollTable.${t._id}`, name: t.name })) });
  }
  return groups.filter((g) => g.tables.length);
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * One dialog for the whole mapping: a row per terrain on the active scene
 * (plus any terrain already mapped), each a select of roll tables. GM only.
 */
export async function openTerrainTables() {
  if (!game.user?.isGM) return null;
  const tables = { ...game.settings.get(MODULE_ID, TERRAIN_TABLES) };
  const rows = sceneTerrains(canvas?.scene?.getFlag(MODULE_ID, TAGS_FLAG));
  for (const key of Object.keys(tables)) if (!rows.some((r) => r.key === key)) rows.push({ key, label: key, count: 0 });
  if (!rows.length) {
    ui.notifications?.warn("No terrain to map yet: tag a hex scene (Importer Hub → Hex tagger), then pick this again while viewing it.");
    return null;
  }
  const groups = await tableChoices();
  const options = (selected) => groups.map((g) =>
    `<optgroup label="${escapeHtml(g.label)}">${g.tables.map((t) =>
      `<option value="${escapeHtml(t.uuid)}" ${t.uuid === selected ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}</optgroup>`).join("");
  const content = `<form class="standard-form">
    <p class="hint">The encounter check rolls the table for the hex the party is in. Terrain left at (none) falls back to the active table.</p>
    ${rows.map((r) => `<div class="form-group"><label>${escapeHtml(r.label)}${r.count ? ` <span class="hint">(${r.count})</span>` : ""}</label><div class="form-fields">
      <select name="${escapeHtml(r.key)}"><option value="">(none)</option>${options(tables[r.key])}</select>
    </div></div>`).join("")}
  </form>`;
  const answer = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Encounter tables by terrain", icon: "fa-solid fa-mountain-sun" },
    position: { width: 520 },
    content,
    ok: { label: "Save", callback: (_event, button) => new FormDataExtended(button.form).object },
    rejectClose: false,
  });
  if (!answer) return null;
  const next = {};
  for (const [key, uuid] of Object.entries(answer)) if (uuid) next[key] = String(uuid);
  await game.settings.set(MODULE_ID, TERRAIN_TABLES, next);
  ui.notifications?.info(`Encounter tables by terrain: ${Object.keys(next).length} mapped.`);
  return next;
}
