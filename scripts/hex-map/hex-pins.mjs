/**
 * Shadowdark Enhancer — keyed hexes as map notes on the tagged scene.
 *
 * The GM who uses the print as the map wants the book's keyed locations on
 * it, each opening its journal page. Foundry notes can only point at world
 * journals, so the crawl's JournalEntry (filed in the Journals pack by the hex
 * importer) is deployed into the world once with its ids kept, its
 * cross-links rewritten from the pack to the world copy, and one Note per
 * keyed page is placed at the hex's centre on the active scene. Re-running
 * moves existing pins instead of adding more: each carries the hex number on
 * its flag. Phase 6 of docs/plans/hex-map-dataset.md; the deployment is the
 * June "pinned crawl scenes" code brought back.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { HEX_FLAG } from "../importer/hex/hex-commit.mjs";
import { hexNum } from "../importer/hex/hex-dataset.mjs";
import { sceneCells } from "./sampler.mjs";
import { cellNumber } from "./geometry.mjs";

/** Flag key on a Note: { num } of the keyed hex it pins. */
export const PIN_FLAG = "hexPin";

/** Note icon by the summary row's feature (Foundry's own icons). */
export const PIN_ICONS = {
  village: "icons/svg/village.svg",
  town: "icons/svg/house.svg",
  city: "icons/svg/city.svg",
  city_state: "icons/svg/castle.svg",
  keyed_location: "icons/svg/book.svg",
};

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Point same-crawl page links at the deployed world entry; other UUIDs stay. */
export function rewriteCrawlLinksForWorld(content, packEntryUuid, worldEntryId) {
  const source = `${packEntryUuid}.JournalEntryPage.`;
  const target = `JournalEntry.${worldEntryId}.JournalEntryPage.`;
  return String(content ?? "").replace(new RegExp(`@UUID\\[${escapeRe(source)}`, "g"), `@UUID[${target}`);
}

/**
 * Pure planner: the notes to create and the existing ones to move.
 * @param {Array<{id:string, num:string|number, name:string, feature?:string}>} pages  keyed pages of the world entry
 * @param {Map<number, {x:number, y:number}>} numbered  published number → scene point
 * @param {Array<{id:string, num:number}>} [existing]  pins already on the scene (by flag)
 * @param {{entryId:string, iconSize?:number}} opts
 * @returns {{create:object[], update:object[], missing:number[]}}
 */
export function planPins(pages, numbered, existing = [], { entryId, iconSize = 40 } = {}) {
  const byNum = new Map(existing.map((n) => [n.num, n.id]));
  const create = [], update = [], missing = [];
  for (const p of pages) {
    const num = hexNum(p.num);
    if (num === null) continue;
    const at = numbered.get(num);
    if (!at) { missing.push(num); continue; }
    const data = {
      entryId, pageId: p.id, x: Math.round(at.x), y: Math.round(at.y), text: p.name, iconSize,
      texture: { src: PIN_ICONS[p.feature] ?? PIN_ICONS.keyed_location },
      flags: { [MODULE_ID]: { [PIN_FLAG]: { num } } },
    };
    const id = byNum.get(num);
    if (id) update.push({ _id: id, ...data }); else create.push(data);
  }
  return { create, update, missing };
}

/**
 * Deploy the crawl's pack entry into the world, ids kept so notes can point
 * at its pages; a re-deploy updates matching pages and adds missing ones.
 * @returns {Promise<JournalEntry>}
 */
export async function deployCrawlJournal(packEntry) {
  if (!packEntry?.getFlag?.(MODULE_ID, HEX_FLAG)?.crawl) throw new TypeError("A crawl entry filed by the hex importer is required");
  const data = packEntry.toObject();
  data.folder = null;
  data.pages = packEntry.pages.contents.map((page) => {
    const d = page.toObject();
    if (d.text?.content) d.text.content = rewriteCrawlLinksForWorld(d.text.content, packEntry.uuid, packEntry.id);
    return d;
  });
  let world = game.journal.get(packEntry.id);
  if (!world) return JournalEntry.create(data, { keepId: true });
  if (!world.getFlag(MODULE_ID, HEX_FLAG)?.crawl) throw new Error(`World journal entry ${packEntry.id} is not this crawl`);
  await world.update({ name: data.name, flags: data.flags });
  const updates = data.pages.filter((p) => world.pages.has(p._id)), creates = data.pages.filter((p) => !world.pages.has(p._id));
  if (updates.length) await world.updateEmbeddedDocuments("JournalEntryPage", updates);
  if (creates.length) await world.createEmbeddedDocuments("JournalEntryPage", creates, { keepId: true });
  return world;
}

/**
 * Pin the crawl's keyed hexes on the ACTIVE scene (numbered from its tag
 * flag's anchor). GM only.
 * @param {JournalEntry} packEntry  the crawl entry in the Journals pack
 * @returns {Promise<{created:number, moved:number, missing:number[], journal:JournalEntry}|null>}
 */
export async function pinCrawlOnActiveScene(packEntry, { iconSize } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can pin keyed hexes."); return null; }
  const scene = canvas?.scene;
  const origin = scene?.getFlag(MODULE_ID, "hexTags")?.origin;
  if (!origin) { ui.notifications?.warn("This scene has no hex numbering yet: set it up with Hex map from image, or sample it in the tagger and set the anchor."); return null; }
  const geom = sceneCells(canvas);
  if (geom.error) { ui.notifications?.warn(geom.error); return null; }
  const numbered = new Map();
  const o = { cube: { q: origin.q, r: origin.r }, num: origin.num, shifted: origin.shifted ?? "odd", bounds: origin.bounds };
  for (const c of geom.cells) { const n = cellNumber(c.cube, o); if (n.num !== null) numbered.set(n.num, { x: c.x, y: c.y }); }
  const journal = await deployCrawlJournal(packEntry);
  const keyedRows = new Map((packEntry.getFlag(MODULE_ID, HEX_FLAG)?.keyed ?? []).map((r) => [hexNum(r.num), r]));
  const pages = journal.pages.contents
    .map((p) => ({ id: p.id, num: p.getFlag(MODULE_ID, HEX_FLAG)?.num, name: p.name, feature: keyedRows.get(hexNum(p.getFlag(MODULE_ID, HEX_FLAG)?.num))?.feature }))
    .filter((p) => p.num !== undefined && p.num !== null && p.num !== "");
  const existing = scene.notes.contents.map((n) => ({ id: n.id, num: n.getFlag(MODULE_ID, PIN_FLAG)?.num })).filter((n) => Number.isInteger(n.num));
  const plan = planPins(pages, numbered, existing, { entryId: journal.id, iconSize: iconSize ?? Math.max(24, Math.round((scene.grid?.size ?? 100) * 0.3)) });
  if (plan.update.length) await scene.updateEmbeddedDocuments("Note", plan.update);
  if (plan.create.length) await scene.createEmbeddedDocuments("Note", plan.create);
  return { created: plan.create.length, moved: plan.update.length, missing: plan.missing, journal };
}
