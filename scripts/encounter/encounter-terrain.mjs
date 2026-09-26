/**
 * Shadowdark Enhancer — terrain for encounter checks.
 *
 * With a hex map tagged (scripts/hex-map), the scene knows what every hex is.
 * This turns that into the one thing a wandering-monster check wants: the
 * table the book intends for the party's hex. Where the book's per-region
 * encounter grids are imported, that is the region's printed column for the
 * hex's terrain, with its day/night, moon and north/south splits resolved
 * (#197). Otherwise the GM maps terrain to roll tables once (Encounter menu →
 * Tables by terrain), and the check falls back to the single active table
 * whenever the scene has no tags, the party is off the map, or that terrain
 * has no table of its own.
 *
 * The party's hex is the controlled token's when the GM has one selected —
 * that is an explicit "here" — and otherwise the hex most of the player
 * characters' tokens stand in, so a party spread over two hexes still answers.
 * Phase 6 of docs/plans/hex-map-dataset.md.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { cellNumber, foundryOffsetToCube } from "../hex-map/geometry.mjs";
import { decodeTags, readCell } from "../hex-map/tag-store.mjs";

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

/**
 * Terrain keys that ARE water, for a "Water" or "Land" column. Terrain alone
 * decides it (#196): a river feature is a line through land, and a coast is
 * land beside the water.
 */
export const WATERY = new Set(["ocean", "arctic_sea", "lake", "river", "sea", "water"]);

/**
 * What else a printed column is split by: a time of day ("Swamp, Night"), a
 * compass half ("N. Ocean") or a moon phase ("New Moon", which is all of it).
 * @returns {{time:"day"|"night"|null, half:"north"|"south"|null, moon:string|null}}
 */
export function columnSplit(label) {
  const s = String(label ?? "").trim().toLowerCase();
  const half = s.match(/^([ns])\.\s*/)?.[1];
  return {
    time: s.match(/,\s*(day|night)$/)?.[1] ?? null,
    half: half ? (half === "n" ? "north" : "south") : null,
    moon: s.match(/^(\w+)\s+moon$/)?.[1] ?? null,
  };
}

/** A hex's features as keys, from the tag store ("coast") or an Extras record ({ type: "coast" }). */
const featureKeys = (features) => (features ?? []).map((f) => terrainKey(typeof f === "string" ? f : f?.type));

/**
 * Which of a region's columns this hex could roll on, by terrain alone.
 *
 * Terrain picks the column; a feature never does (#196), with one exception:
 * a coastal hex rolls on the region's Coast column when the region prints
 * one. So a forest with a river through it rolls Forest, and a river tile
 * rolls River. Two tiers after that: a column naming the terrain beats a
 * catch-all "Water" or "Land". A moon column is never a terrain match; it
 * takes over on its night (pickZoneTable).
 *
 * More than one match is not resolved here: it means the book split that
 * terrain by the time of day or by the region's halves, which pickZoneTable
 * reads off the clock and the rows.
 * @param {string} terrain            the hex's terrain tag
 * @param {Array<string|{type:string}>} features  its features; only coast counts
 * @param {Array<{column:string}>} columns  that region's imported columns
 * @returns {Array<object>} the columns that fit, best tier only
 */
export function zoneCandidates(terrain, features, columns) {
  const key = terrainKey(terrain);
  const wet = WATERY.has(key);
  const cols = (columns ?? []).filter((c) => !columnSplit(c.column).moon);
  if (!wet && featureKeys(features).includes("coast")) {
    const coast = cols.filter((c) => zoneColumnKeys(c.column).includes("coast"));
    if (coast.length) return coast;
  }
  const exact = [], category = [];
  for (const col of cols) {
    const keys = zoneColumnKeys(col.column);
    if (!keys.length) continue;
    if (key && keys.includes(key)) { exact.push(col); continue; }
    if (keys.some((ck) => ck === "water" || ck === "ocean") && wet) category.push(col);
    else if (keys.includes("land") && key && !wet) category.push(col);
  }
  return exact.length ? exact : category;
}

/**
 * The encounter table for a hex, by region and terrain, with the columns the
 * book splits by time or by half resolved.
 *
 * `at` says when and where: night or day, the moon phase, and whether the hex
 * is in its region's northern half. Anything left out stays undecided, and a
 * split it would have decided comes back ambiguous rather than guessed.
 *
 * A moon column ("New Moon", "Full Moon") takes over the region's hexes on its
 * night. Until the world clock knows the moon (Overland, #192) that is the one
 * thing still ambiguous: the verdict names the moon column beside the
 * ordinary one, and `column` is the ordinary one, which is what a roll uses.
 * @param {{night?:boolean, moon?:string|null, north?:boolean}} [at]
 * @returns {{status:"ok", column:object}|{status:"ambiguous", columns:object[], column?:object, moon?:true}|{status:"none"}}
 */
export function pickZoneTable(region, terrain, features, byRegion, { night, moon, north } = {}) {
  const columns = byRegion?.get?.(region) ?? byRegion?.[region];
  if (!columns?.length) return { status: "none" };
  const hit = zoneCandidates(terrain, features, columns).filter((c) => {
    const { time, half } = columnSplit(c.column);
    if (typeof night === "boolean" && time && time !== (night ? "night" : "day")) return false;
    return !(typeof north === "boolean" && half && half !== (north ? "north" : "south"));
  });
  if (!hit.length) return { status: "none" };
  const moons = night === false ? [] : columns.filter((c) => columnSplit(c.column).moon);
  if (moons.length && !moon) return { status: "ambiguous", columns: [...hit, ...moons], moon: true, ...(hit.length === 1 ? { column: hit[0] } : {}) };
  const tonight = moons.find((c) => columnSplit(c.column).moon === moon);
  if (tonight) return { status: "ok", column: tonight };
  return hit.length === 1 ? { status: "ok", column: hit[0] } : { status: "ambiguous", columns: hit };
}

/** Dusk and dawn. ponytail: fixed 18:00 to 06:00; the real sunrise is Overland's (#192). */
export const DUSK = 18, DAWN = 6;
export const isNight = (hour) => hour >= DUSK || hour < DAWN;

/**
 * The world clock a column is read against: the hour and the moon phase.
 *
 * THE seam for Overland (#192), which replaces this one function. Until it
 * lands the hour is Foundry's own world time and the moon is not known (null),
 * so a moon column stays ambiguous.
 * @returns {{hour:number, moon:string|null}}
 */
export function worldClock(time = globalThis.game?.time) {
  const hour = time?.components?.hour ?? Math.floor(((((time?.worldTime ?? 0) % 86400) + 86400) % 86400) / 3600);
  return { hour, moon: null };
}

/**
 * Each region's published row range: Map<region, {min, max}>.
 * @param {Map<number, string>} regionByNum  published number → region name
 */
export function regionRowRanges(regionByNum) {
  const out = new Map();
  for (const [num, region] of regionByNum ?? []) {
    const row = Number(num) % 100, r = out.get(region);
    if (!r) out.set(region, { min: row, max: row });
    else { r.min = Math.min(r.min, row); r.max = Math.max(r.max, row); }
  }
  return out;
}

/**
 * Is a hex in its region's northern half? The region's own rows split in two,
 * the top half north; with an odd number of rows the middle row counts as
 * north. Undefined without a row range, so the split stays undecided.
 */
export function inNorthHalf(num, range) {
  if (!range || !Number.isFinite(Number(num))) return undefined;
  return Number(num) % 100 - range.min <= Math.floor((range.max - range.min) / 2);
}

/**
 * The table for a hex: its region's column when the imported grid has one
 * that fits, else the table the GM mapped to its terrain, else the active one.
 * Pure: resolveHexTable reads the world for it.
 * @param {{num?:number, terrain?:string, zone?:string, features?:Array<string|{type:string}>}} hex
 * @param {{zonesByRegion?:Map<string,object[]>, rowRange?:{min:number,max:number}, hour?:number,
 *   moon?:string|null, terrainTables?:object, fallback?:string}} [ctx]
 * @returns {{uuid:string, zone:string|null, verdict:object}}
 */
export function hexTableUuid(hex, { zonesByRegion, rowRange, hour, moon = null, terrainTables, fallback = "" } = {}) {
  const zone = hex?.zone || null;
  const at = { night: Number.isFinite(hour) ? isNight(hour) : undefined, moon, north: inNorthHalf(hex?.num, rowRange) };
  const verdict = zone ? pickZoneTable(zone, hex.terrain, hex.features, zonesByRegion, at) : { status: "none" };
  return { uuid: verdict.column?.uuid || pickTable(terrainTables, hex?.terrain, fallback), zone, verdict };
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
  // Read the #196 way, so a legacy "coast" terrain is ground plus a coast feature.
  const cell = readCell(decodeTags(flag), num);
  return { num, terrain: cell?.terrain ?? null, features: cell?.features ?? [] };
}

/**
 * hexTableUuid with everything read from the world: the imported encounter
 * grids, the hex's region and its region's rows from the print's region scan
 * (hex-region.mjs, the same answer the map overlay and the Extras hand-off
 * give), the world clock, and the GM's terrain tables and active table.
 * @param {{num?:number, terrain?:string, zone?:string, features?:Array<string|{type:string}>}|null} hex
 * @param {{hour?:number, moon?:string|null, scene?:object}} [opts]  hour and moon default to worldClock();
 *   scene is the one whose region scan answers (default: the one being viewed)
 * @returns {Promise<{uuid:string, zone:string|null, verdict:object}>}
 */
export async function resolveHexTable(hex, { hour, moon, scene } = {}) {
  const clock = worldClock();
  const zonesByRegion = hex ? await encounterZonesByRegion() : new Map();
  const num = Number.parseInt(hex?.num, 10);
  let zone = hex?.zone, rowRange;
  // The number finds the region when none was given, and the region's rows.
  if (zonesByRegion.size && Number.isInteger(num)) {
    const { byNum, rowRanges } = await hexZonesFor(scene ?? globalThis.canvas?.scene);
    zone ||= byNum.get(num)?.zone;
    rowRange = rowRanges.get(zone);
  }
  return hexTableUuid({ ...hex, num, zone }, {
    zonesByRegion, rowRange,
    hour: hour ?? clock.hour, moon: moon === undefined ? clock.moon : moon,
    terrainTables: game.settings.get(MODULE_ID, TERRAIN_TABLES),
    fallback: game.settings.get(MODULE_ID, "encounterTableUuid"),
  });
}

/**
 * Every hex's region on the scene whose scan answers for `scene`, with each
 * region's rows, kept between checks. Naming the regions loads every crawl
 * entry in the journals pack (crawlEntries), which is too much to do on every
 * hit and every tableForHex call.
 *
 * ponytail: one cache for the world, dropped whole by any crawl entry or scene
 * change (the hooks below); per-document invalidation if that ever churns.
 */
const hexZonesCache = new Map();
let hexZonesWatched = false;

/** Drop the cache: the regions are read again on the next lookup. */
export function forgetHexZones() {
  hexZonesCache.clear();
}

async function hexZonesFor(scene) {
  if (!hexZonesWatched && globalThis.Hooks?.on) {
    hexZonesWatched = true;
    // Crawl entries name the regions; a scene carries the scan, its fixes and its column shift.
    for (const hook of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry", "createScene", "updateScene", "deleteScene"]) {
      globalThis.Hooks.on(hook, forgetHexZones);
    }
  }
  const { sceneZones, scanSceneFor } = await import("../hex-map/hex-region.mjs");
  const scan = scanSceneFor(scene);
  const key = scan?.id ?? "";
  if (!hexZonesCache.has(key)) {
    const read = sceneZones(scan).then(({ byNum }) => ({
      byNum, rowRanges: regionRowRanges(new Map([...byNum].map(([n, z]) => [n, z.zone]))),
    }));
    // A failed read is not remembered: the next check tries again.
    read.catch(() => hexZonesCache.delete(key));
    hexZonesCache.set(key, read);
  }
  return hexZonesCache.get(key);
}

/** The check's table before region grids: the terrain's mapped table, else the active one. */
export function terrainTable(hex) {
  const uuid = pickTable(game.settings.get(MODULE_ID, TERRAIN_TABLES), hex?.terrain, game.settings.get(MODULE_ID, "encounterTableUuid"));
  return { uuid, zone: null, verdict: { status: "none" } };
}

/**
 * resolveHexTable for the encounter check, which must never lose its chat
 * card to it: if the region lookup throws, the check rolls what it rolled
 * before this lookup existed.
 */
export async function tableForCheck(hex) {
  try {
    return await resolveHexTable(hex);
  } catch (err) {
    console.error(`${MODULE_ID} | the table for the party's hex failed; using the terrain's table`, err);
    return terrainTable(hex);
  }
}

/**
 * The roll table for a hex, as every encounter check rolls it (the public
 * `encounter.tableForHex`, so Shadowdark Extras' hex fog rolls the same one).
 * @returns {Promise<RollTable|null>}
 */
export async function tableForHex(hex, opts) {
  const { uuid } = await resolveHexTable(hex ?? {}, opts);
  return uuid ? fromUuid(uuid) : null;
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
