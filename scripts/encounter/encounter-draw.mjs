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
import { partyContext } from "./battle-maps/battle-actions.mjs";
import { canBattle, cardStash } from "./battle-maps/battle-actions-core.mjs";

// Read at call time, not import time: the module is imported by Node tests (and by
// hex-fog, whose neighbours hex-explorer.mjs's tests load) where `foundry` is absent.
const renderTemplate = (...args) => foundry.applications.handlebars.renderTemplate(...args);

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
  const picked = doc ? await drawPointOfInterest(doc) : null;
  if (!picked) return missing;
  // The row's own face, not a d20: the pool skips the rows the party already found.
  chain.push({ name: shortName(doc.name), formula: doc.formula || null, roll: picked.result.range?.[0] ?? null });
  return { poi: true, result: picked.result, via: game.i18n.format("SDE.encounter.roller.viaPoi", { category, table: poi.name }) };
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

/**
 * Every creature a row names that carries its own dice, in the order it names
 * them: "2d4 beastmen close in a circle around 1d4 dwarf soldiers" gives two
 * groups, while "2d6 beastmen thralls haul a troll to their aboleth overlord"
 * gives one (the troll and the aboleth have no dice of their own, so they are
 * the row's scene, not its foes). Links separated only by spaces are one group —
 * "dwarf @UUID{soldiers}" is a group of soldiers — so the run's last link is the
 * creature and the run's start is where its dice sit.
 * @param {TableResult} result
 * @returns {{uuid:string, label:string, countFormula:string|null}[]}
 */
export function rowCreatures(result) {
  const text = resultBody(result);
  const links = [...text.matchAll(/@UUID\[([^\]]+)\]\{([^}]*)\}/g)]
    .map((m) => ({ uuid: m[1], label: m[2], start: m.index, end: m.index + m[0].length }));
  const groups = [];
  for (const link of links) {
    const last = groups[groups.length - 1];
    if (last && /^\s+$/.test(text.slice(last.head.end, link.start))) last.head = link;
    else groups.push({ start: link.start, head: link });
  }
  return groups.map((g, i) => {
    const from = i ? groups[i - 1].head.end : 0;
    const formula = [...text.slice(from, g.start).matchAll(/\[\[\/r\s+([^\]]+)\]\]/g)].pop()?.[1] ?? null;
    return { uuid: g.head.uuid, label: g.head.label, countFormula: formula };
  });
}

/**
 * What the encounter is made of, in the order the row names it: the row's
 * counted groups, plus the creature the card names when the row gave it no dice
 * ("The Wandering Merchant flees a group of 2d4 beastmen" is both of them), each
 * with the count its OWN dice gave — a row's dice belong to the creature they
 * sit before, never to whichever creature the row named first. The `appearing`
 * flag (Build Table) overrides the card's creature's count.
 * @param {TableResult} result
 * @param {{uuid:string, name:string}} monster  the card's creature
 * @returns {Promise<{uuid:string, label:string, countFormula:string|null, count:number}[]>}
 */
async function placementOf(result, monster) {
  const flag = result.getFlag?.(MODULE_ID, "appearing");
  const named = rowCreatures(result);
  const primaryNamed = named.find((c) => c.uuid === monster.uuid);
  const primary = {
    uuid: monster.uuid,
    label: primaryNamed?.label ?? monster.name,
    countFormula: (flag ? String(flag) : null) ?? primaryNamed?.countFormula ?? null,
  };
  // Walk the row in order so the map's groups come out in the order it named
  // them; the card's creature sits where the row first named it.
  const list = [];
  let primaryAdded = false;
  for (const c of named) {
    if (c.uuid === monster.uuid) {
      if (!primaryAdded) { list.push(primary); primaryAdded = true; }
      continue;
    }
    if (c.countFormula) list.push(c);
  }
  if (!primaryAdded) list.unshift(primary);
  const out = [];
  for (const c of list) out.push({ ...c, count: c.countFormula ? await roll(c.countFormula) : 1 });
  return out;
}

const roll = async (formula) => (await new Roll(formula).evaluate()).total;

/** A table's rows, whether they come as a Collection (`.contents`) or a plain list. */
const poiRows = (table) => [...(table?.results?.contents ?? table?.results ?? [])];

/**
 * A point of interest the party has not found yet. The books' tables are d20
 * lists of one-off places, and a repeat wastes the hex, so the rows already
 * drawn are kept in the `poiUsed` world setting and the next draw picks only
 * from what is left, weighted by the faces each row covers (Foundry's own
 * weighting). Once every row is found the list starts again: the book has
 * nothing past the twentieth.
 * @param {RollTable} table
 * @returns {Promise<{result: TableResult, remaining: number, restarted: boolean}|null>}
 */
export async function drawPointOfInterest(table) {
  const all = poiRows(table);
  if (!all.length) return null;
  const store = game.settings.get(MODULE_ID, "poiUsed") ?? {};
  let used = Array.isArray(store[table.uuid]) ? store[table.uuid].filter((id) => all.some((r) => r.id === id)) : [];
  let pool = all.filter((r) => !used.includes(r.id));
  let restarted = false;
  if (!pool.length) {
    used = [];
    pool = [...all];
    restarted = true;
  }
  const weight = (r) => ((r.range?.[1] ?? 0) - (r.range?.[0] ?? 0) + 1) * (r.weight ?? 1);
  let ticket = Math.random() * pool.reduce((sum, r) => sum + weight(r), 0);
  let pick = pool[pool.length - 1];
  for (const r of pool) {
    ticket -= weight(r);
    if (ticket < 0) { pick = r; break; }
  }
  const next = { ...store, [table.uuid]: [...used, pick.id] };
  await game.settings.set(MODULE_ID, "poiUsed", next);
  return { result: pick, remaining: all.length - next[table.uuid].length, restarted };
}

/**
 * The points-of-interest table a region's book prints, when it is imported: one
 * d20 list per region ("Myre Swamp Points of Interest"), filed in the module's
 * tables pack. A region the book files as several lists (Cursed Scroll 4's
 * Location / Feature / Descriptor) has no single table and answers null.
 * @param {string} regionName
 * @returns {Promise<RollTable|null>}
 */
export async function poiTableFor(regionName) {
  const want = String(regionName ?? "").trim();
  if (!want) return null;
  const suffix = `${want} Points of Interest`;
  const world = game.tables.find((t) => t.name.endsWith(suffix));
  if (world) return world;
  for (const pack of game.packs) {
    if (pack.documentName !== "RollTable") continue;
    const entry = pack.index.find((e) => e.name.endsWith(suffix));
    if (entry) return pack.getDocument(entry._id);
  }
  return null;
}

/** How many of a point-of-interest table's rows are still to be found, and its size. */
export function poiRemaining(table) {
  const store = game.settings.get(MODULE_ID, "poiUsed") ?? {};
  const all = poiRows(table).map((r) => r.id);
  const used = Array.isArray(store[table?.uuid]) ? store[table.uuid].filter((id) => all.includes(id)) : [];
  return { remaining: all.length - used.length, total: all.length };
}

/**
 * A flavor row's text as HTML, so a row's own dice ("[[/r 1d4]]", a check
 * request) show as the rollable links they are instead of their source. The
 * panel and the chat card show this where they have it, the plain text where
 * they don't — a row that fails to enrich still reads.
 * @param {string} text
 * @returns {Promise<string|null>}
 */
export async function flavorHtml(text) {
  try {
    return await foundry.applications.ux.TextEditor.implementation.enrichHTML(text);
  } catch (err) {
    console.warn(`${MODULE_ID} | enriching a row's text failed`, err);
    return null;
  }
}


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
    return text ? { kind: "flavor", text, html: await flavorHtml(text) } : { kind: "empty" };
  }
  // A world copy of a compendium creature whose art is a placeholder shows the compendium's art.
  const art = await _bestArtForActor(monster);
  const creatures = await placementOf(result, monster);
  const primary = creatures.find((c) => c.uuid === monster.uuid) ?? { count: 1, countFormula: null };
  return {
    kind: "monster", uuid: monster.uuid, name: monster.name, img: art.img || "icons/svg/mystery-man.svg",
    count: primary.count, countFormula: primary.countFormula,
    creatures,
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
 * text. To the GMs only when `gmOnly` (default: the encounter roll's GM-only setting).
 * A GM's creature card keeps what its Battle map button needs (the creature, the hex's terrain and number, the
 * scene to come back to) in its flags: the card is clicked later, when the party may stand somewhere else.
 * @param {object} res  an entry with its facet words (the roller's result, or the HUD's)
 * @param {{gmOnly?:boolean}} [opts]
 */
export async function postEncounter(res, { gmOnly = game.settings.get(MODULE_ID, "encounterRollGMOnly") } = {}) {
  if (!res || res.kind === "empty") return;
  const template = res.kind === "flavor"
    ? "modules/shadowdark-enhancer/templates/chat/encounter-flavor.hbs"
    : "modules/shadowdark-enhancer/templates/chat/encounter-result.hbs";
  const battle = game.user.isGM && canBattle(res) ? cardStash({ res, ...partyContext() }) : null;
  const content = await renderTemplate(template, battle ? { ...res, battleMap: true } : res);
  await ChatMessage.create({
    user: game.user.id,
    content,
    whisper: gmOnly ? ChatMessage.getWhisperRecipients("GM") : [],
    ...(battle ? { flags: { [MODULE_ID]: { encounterCard: battle } } } : {}),
  });
}
