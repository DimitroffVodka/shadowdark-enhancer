/**
 * Shadowdark Enhancer — drawing an encounter from a table, with no window.
 *
 * The roller's Roll and Overland's quiet travel checks (#257, the clock HUD's
 * Encounter panel) draw the same way: the table's row; for an Encounter Zone
 * table, the region's table for the row's category (and its Special table);
 * on the travel draw, a point of interest where the book marks one (#262,
 * #273). Then the entry: the creature, how many, and the distance, activity
 * and reaction rolls. Each table drawn is kept in `chain` for the panel's chips.
 *
 * `quiet` keeps a second category's draw ("Beast + Horror") out of chat: it is
 * kept in `also` for the panel instead of going to the GMs' chat.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { _bestArtForActor } from "../shared/art-utils.mjs";
import {
  categoryTables, isEncounterZoneTable, travelPointOfInterest, zoneCategories,
} from "../importer/tables/table-enrich.mjs";
import { isNight, worldClock } from "./encounter-terrain.mjs";

const { renderTemplate } = foundry.applications.handlebars;

/**
 * A TableResult's body text across Foundry versions: v13 split `text` into
 * `name` and `description`; old tables still carry `text`. `||`, not `??`, so
 * an empty field falls through.
 * @param {TableResult} r
 * @returns {string}
 */
export function resultBody(r) {
  return r?.description || r?.name || r?.text || "";
}

const plain = (r) => resultBody(r).replace(/<[^>]*>/g, "");
/** "Western Reaches GM Guide - Sablewood Beasts" → "Sablewood Beasts". */
const shortName = (name) => String(name ?? "").replace(/^.*?\s-\s/, "");
/** A link in the chain: the table drawn, its dice and what they rolled. */
const link = (table, draw) => ({ name: shortName(table.name), formula: table.formula || null, roll: draw?.roll?.total ?? null });

/** The table named `name` beside `table`: in its pack, or in the world. */
function sibling(table, name) {
  const pack = table.pack ? game.packs.get(table.pack) : null;
  return pack ? pack.getDocument(pack.index.find((e) => e.name === name)?._id) : game.tables.getName(name);
}

/** Every table name beside `table`. */
function siblingNames(table) {
  const pack = table.pack ? game.packs.get(table.pack) : null;
  return pack ? [...(pack.index ?? [])].map((e) => e.name) : game.tables.map((t) => t.name);
}

/**
 * An Encounter Zone (or Type) table's row is a category ("Beast"), and the
 * book sends the GM to that region's table for it: draw it, by day or night
 * where the region splits it by time (Tal-Yool Jungle), on the zone columns'
 * fixed 18:00 to 06:00 night. A second category in the same row ("Beast +
 * Horror") is drawn on its own: to the GMs' chat, or into `also` when quiet.
 * A "Special" row in the category's table (Tal-Yool's give one on a 1) goes on
 * to the region's Special Encounters table. Null when this isn't a zone table
 * or the category's table isn't imported (#262).
 */
async function rollCategory(table, result, { chain, also, quiet }) {
  if (!isEncounterZoneTable(table?.name)) return null;
  const names = siblingNames(table);
  const category = zoneCategories(plain(result)).join(" + ");
  const [first, ...more] = categoryTables(table.name, category, names, { night: isNight(worldClock().hour) });
  if (!first) return null;
  // To the GMs only, whatever the chat mode: the GM posts the encounter, and
  // its second half must not reach the players before the first.
  for (const name of more) {
    const next = await sibling(table, name);
    if (!next) continue;
    if (!quiet) { await next.draw({ messageMode: "gm" }); continue; }
    const draw = await next.draw({ displayChat: false });
    if (draw.results[0]) also.push({ ...link(next, draw), text: plain(draw.results[0]).trim() });
  }
  const drawFrom = async (name) => {
    const next = await sibling(table, name);
    const draw = next ? await next.draw({ displayChat: false }) : null;
    if (!draw?.results[0]) return null;
    chain.push(link(next, draw));
    return { drawn: draw.results[0], table: shortName(next.name) };
  };
  chain.push({ category });
  const hit = await drawFrom(first);
  if (!hit) return null;
  const isSpecial = /^special$/i.test(zoneCategories(plain(hit.drawn)).join(" + "));
  const [special] = isSpecial ? categoryTables(table.name, "Special", names) : [];
  const then = special ? await drawFrom(special) : null;
  if (!then) return { result: hit.drawn, via: game.i18n.format("SDE.encounter.roller.via", { category, table: hit.table }) };
  return { result: then.drawn, via: game.i18n.format("SDE.encounter.roller.viaSpecial", { category, table: hit.table, special: then.table }) };
}

/**
 * What a zone table's row goes on to. On the travel draw, a row the GM Guide
 * marks "Point of Interest if during hex travel" rolls the region's Points of
 * Interest table, and when that isn't imported says which table to import:
 * the book gives no encounter there (#273). Every other row, and every other
 * draw, rolls its category.
 */
async function zoneRow(table, result, { travel, chain, also, quiet }) {
  if (!isEncounterZoneTable(table?.name)) return null;
  const poi = travelPointOfInterest(table.name, plain(result), siblingNames(table), { travel });
  if (!poi) return rollCategory(table, result, { chain, also, quiet });
  const category = zoneCategories(plain(result)).join(" + ");
  const missing = { poi: true, missing: game.i18n.format("SDE.encounter.roller.poiMissing", { category, table: poi.name }) };
  if (!poi.found) return missing;
  const doc = await sibling(table, poi.found);
  const draw = doc ? await doc.draw({ displayChat: false }) : null;
  if (!draw?.results[0]) return missing;
  chain.push(link(doc, draw));
  return { poi: true, result: draw.results[0], via: game.i18n.format("SDE.encounter.roller.viaPoi", { category, table: poi.name }) };
}

/** The NPC a row names: its linked document, or the first @UUID in its text. */
async function monsterOf(result) {
  if (result.uuid) {
    const doc = await fromUuid(result.uuid).catch(() => null);
    if (doc instanceof Actor && doc.type === "NPC") return doc;
  }
  const uuid = resultBody(result).match(/@UUID\[([^\]]+)\]/)?.[1];
  const doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
  return doc && doc instanceof Actor ? doc : null;
}

/** How many appear: the row's `appearing` flag (Build Table), else an inline [[/r X]], else 1. */
async function countOf(result) {
  const flag = result.getFlag?.(MODULE_ID, "appearing");
  const formula = (flag ? String(flag) : null) ?? resultBody(result).match(/\[\[\/r\s+([^\]]+)\]\]/)?.[1] ?? null;
  if (!formula) return { formula: null, total: 1 };
  return { formula, total: (await new Roll(formula).evaluate()).total };
}

const roll = async (formula) => (await new Roll(formula).evaluate()).total;

/**
 * The encounter a row gives. A creature: its name, art, how many, and the
 * distance (1d6), activity (2d6) and reaction (2d6) rolls. Else the row's
 * text, or nothing.
 * @param {TableResult} result
 * @returns {Promise<{kind:"monster"|"flavor"|"empty"}>}
 */
export async function rollEntry(result) {
  const monster = await monsterOf(result);
  if (!monster) {
    const text = resultBody(result).trim();
    return text ? { kind: "flavor", text } : { kind: "empty" };
  }
  // A world copy of a compendium creature whose art is a placeholder shows the compendium's art.
  const art = await _bestArtForActor(monster);
  const count = await countOf(result);
  return {
    kind: "monster", uuid: monster.uuid, name: monster.name, img: art.img || "icons/svg/mystery-man.svg",
    count: count.total, countFormula: count.formula,
    distanceRoll: await roll("1d6"), activityRoll: await roll("2d6"), reactionRoll: await roll("2d6"),
  };
}

/**
 * Draw an encounter from `table`: the row, the chain it leads to, the entry.
 * Nothing is posted (a quiet draw posts nothing at all).
 * @param {RollTable} table
 * @param {{travel?:boolean, quiet?:boolean}} [opts]  travel: the travel draw (#273)
 * @returns {Promise<object>} rollEntry's entry, plus `via` (the tables a category
 *   went to), `chain` (each table drawn: {name, formula, roll}, and the category
 *   between: {category}) and `also` (a second category's draw, when quiet)
 */
export async function drawEncounter(table, { travel = false, quiet = false } = {}) {
  const draw = await table.draw({ displayChat: false });
  const chain = [link(table, draw)];
  const also = [];
  const result = draw.results[0];
  if (!result) return { kind: "empty", via: null, chain, also };
  // If the chain fails, the zone's own row still shows.
  const chained = await zoneRow(table, result, { travel, chain, also, quiet }).catch((err) => {
    console.warn(`${MODULE_ID} | rolling the category's table failed`, err);
    return null;
  });
  // A point of interest is found instead of an encounter: its row's text, even
  // where it names a creature, never an encounter with counts and reactions.
  if (chained?.poi) {
    return { kind: "flavor", poi: true, text: chained.missing ?? resultBody(chained.result).trim(), via: chained.via ?? null, chain, also };
  }
  return { ...(await rollEntry(chained?.result ?? result)), via: chained?.via ?? null, chain, also };
}

/**
 * Post an encounter to chat: a creature's card with its facets, or a row's
 * text. To the GMs only when the encounter roll is GM-only.
 * @param {object} res  an entry with its facet words (the roller's result, or the HUD's)
 */
export async function postEncounter(res) {
  if (!res || res.kind === "empty") return;
  const template = res.kind === "flavor"
    ? "modules/shadowdark-enhancer/templates/chat/encounter-flavor.hbs"
    : "modules/shadowdark-enhancer/templates/chat/encounter-result.hbs";
  const content = await renderTemplate(template, res);
  const gmOnly = game.settings.get(MODULE_ID, "encounterRollGMOnly");
  await ChatMessage.create({
    user: game.user.id,
    content,
    whisper: gmOnly ? ChatMessage.getWhisperRecipients("GM") : [],
  });
}
