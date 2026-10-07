/**
 * Shadowdark Enhancer — adventure commit: the pure planner plus the
 * Foundry-bound filing of parsed locations into the managed `sde-journal` pack.
 *
 * Shape: one JournalEntry per site inside the source folder, one text page per
 * numbered location. Two passes, because a compendium page's uuid cannot be
 * known before the page exists: pass 1 writes pages carrying `@@LOC[n]{n}@@`
 * placeholders for "Area n" references, pass 2 rewrites them to `@UUID[...]`
 * links (an unknown number degrades to plain text, never a broken link).
 *
 * Identity is the flag, never the name: `flags.shadowdark-enhancer.adventure =
 * { site, source }` on the entry, `{ num }` on each page, `{ intro: true }` on the
 * one Introduction page a site may carry (text printed before its first location).
 * Filing a site again updates its pages in place, and a page for a number the new read did not find
 * is left alone: a partial re-read must never delete work. Same contract as
 * hex-commit.mjs, with a flag of its own so the hex tagger, which lists every
 * entry carrying the hex flag as a crawl, never offers a dungeon.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { ensureSuite, ensureSourceFolder, cleanImportHtml, sourceFolderName, findSuitePack } from "../../shared/compendium-suite.mjs";
import { buildLocationHtml, locationPageName, rewriteLocPlaceholders } from "./adventure-parser.mjs";

/** Flag key under `flags.shadowdark-enhancer` on the entry and its pages. */
export const ADVENTURE_FLAG = "adventure";

/**
 * Pure planner: which locations create pages, which update existing ones.
 * A number seen twice in one read is a collision and only the first is filed.
 * @param {Array<{num:number}>} locations
 * @param {Map<number,string>} [existingByNum]  number → page id already filed
 * @returns {{create:object[], update:Array<{loc:object,pageId:string}>, collisions:number[]}}
 */
export function planAdventureCommit(locations, existingByNum = new Map()) {
  const create = [], update = [], collisions = [], seen = new Set();
  for (const loc of locations ?? []) {
    if (!Number.isInteger(loc?.num)) continue;
    if (seen.has(loc.num)) { collisions.push(loc.num); continue; }
    seen.add(loc.num);
    const pageId = existingByNum.get(loc.num);
    if (pageId) update.push({ loc, pageId }); else create.push(loc);
  }
  return { create, update, collisions };
}

const t = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** An Introduction page sorts ahead of the numbered pages, whenever it is filed. */
const INTRO_SORT = -1;

/** The numbered pages sort by their number from here on, so a page filed later still lands in its place. */
const LOCATION_SORT = 1000;

/** Pass-1 payload for the Introduction page (placeholders still inside). */
export function introPagePayload(lines, known, { boldLines, resolve, items } = {}) {
  return {
    name: t("SDE.importer.adventure.introPage"),
    type: "text",
    title: { show: true, level: 1 },
    sort: INTRO_SORT,
    text: {
      content: buildLocationHtml({ bodyLines: lines, boldLines }, known, { resolve, items }),
      format: globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1,
    },
    flags: { [MODULE_ID]: { [ADVENTURE_FLAG]: { intro: true } } },
  };
}

/** The overview pages sort ahead of the Introduction, and in the order the book prints them. */
const OVERVIEW_SORT = -100000;

/**
 * Pure: one overview page (the adventure's background, rumors, random encounters...) as journal page data.
 * @param {{key:string, name:string, html:string}} part  a buildChapterPages page
 * @param {number} i  its place among the overview pages
 */
export function overviewPagePayload(part, i) {
  return {
    name: part.name,
    type: "text",
    title: { show: true, level: 1 },
    sort: OVERVIEW_SORT + i * 100,
    text: { content: part.html, format: globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 },
    flags: { [MODULE_ID]: { [ADVENTURE_FLAG]: { overview: part.key } } },
  };
}

/** The overview key a page carries, or null. Works on documents and plain index rows. */
export const overviewKey = (page) =>
  page?.getFlag?.(MODULE_ID, ADVENTURE_FLAG)?.overview ?? page?.flags?.[MODULE_ID]?.[ADVENTURE_FLAG]?.overview ?? null;

/**
 * Give a site's world copy (the journal deployed from the pack, whose pages keep the pack's ids) the overview pages it
 * does not have yet. Pages it has are left as they are, edited or not.
 * @param {JournalEntry} packEntry  the entry in the Journals pack
 * @returns {Promise<number>} how many pages were added
 */
export async function addOverviewToWorldCopy(packEntry) {
  const world = game.journal?.get(packEntry?.id);
  if (!world) return 0;
  const missing = packEntry.pages.contents.filter((p) => overviewKey(p) && !world.pages.has(p.id)).map((p) => p.toObject());
  if (missing.length) await world.createEmbeddedDocuments("JournalEntryPage", missing, { keepId: true });
  return missing.length;
}

/** Whether a page is a site's Introduction page. Works on documents and plain index rows. */
export const isIntroPage = (page) =>
  (page?.getFlag?.(MODULE_ID, ADVENTURE_FLAG)?.intro ?? page?.flags?.[MODULE_ID]?.[ADVENTURE_FLAG]?.intro) === true;

/** Pass-1 page payload for one location (placeholders still inside). */
export function locationPagePayload(loc, known, { resolve, noun, level = 2, items } = {}) {
  return {
    name: locationPageName(loc, noun),
    type: "text",
    // Level 2: a location sits under the "Areas" page in the journal's contents, as in the Lost Citadel.
    title: { show: true, level },
    sort: LOCATION_SORT + loc.num * 100,   // by number, whatever order the pages were made in
    text: {
      content: buildLocationHtml({ bodyLines: loc.bodyLines ?? [], boldLines: loc.boldLines }, known, { resolve, items }),
      format: globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1,
    },
    flags: { [MODULE_ID]: { [ADVENTURE_FLAG]: { num: loc.num } } },
  };
}

/** The number a page carries, or null. Works on documents and plain index rows. */
export function pageNum(page) {
  const n = page?.getFlag?.(MODULE_ID, ADVENTURE_FLAG)?.num ?? page?.flags?.[MODULE_ID]?.[ADVENTURE_FLAG]?.num;
  return Number.isInteger(n) ? n : null;
}

/** Find-or-create the site's JournalEntry in the journals pack, matched by flag. */
async function ensureSiteEntry(pack, { site, source, folder }) {
  const sourceName = sourceFolderName(source);
  const docs = await pack.getDocuments();
  const found = docs.find((d) => d.getFlag?.(MODULE_ID, ADVENTURE_FLAG)?.site === site.id);
  if (found) return found;
  return JournalEntry.create({
    name: site.title,
    folder: folder ?? null,
    flags: { [MODULE_ID]: { [ADVENTURE_FLAG]: { site: site.id, source: sourceName } } },
  }, { pack: pack.collection });
}

/** The site's filed entry in the journals pack, or null. */
export async function findSiteEntry(siteId) {
  const pack = findSuitePack("journal");
  if (!pack) return null;
  const docs = await pack.getDocuments();
  return docs.find((d) => d.getFlag?.(MODULE_ID, ADVENTURE_FLAG)?.site === siteId) ?? null;
}

/**
 * File a site's locations as pages. GM-gated like every other commit.
 * @param {{id:string,title:string}} site  manifest row
 * @param {Array<{num:number,name:string,bodyLines:string[]}>} locations
 * @param {{source?:string, intro?:string[], introBold?:string[], resolve?:(phrase:string)=>string|undefined, keepExisting?:boolean}} [opts]
 *   source label, for the folder; intro = the lines printed before the first location, filed
 *   as an Introduction page (introBold: the same lines with bold markers); resolve = a
 *   creature link target for a bold name (adventure-creatures.mjs creatureResolver), so the
 *   bold names the bestiary knows are filed as links; items = the magic items and treasure to link by name (adventure-journal linkableItems); overview = the adventure's overview pages [{key, name, html}]
 *   (chapter-journal buildChapterPages), filed ahead of the locations
 * @returns {Promise<{entryUuid:string|null, created:string[], updated:string[], collisions:number[]}>}
 */
export async function commitAdventure(site, locations, { source = "", intro = [], introBold, resolve, items, keepExisting = false, overview = [] } = {}) {
  const report = { entryUuid: null, created: [], updated: [], kept: [], collisions: [] };
  if (!game.user?.isGM) { ui.notifications?.warn(game.i18n.localize("SDE.importer.gm.adventure")); return report; }
  if (!locations?.length) return report;

  const packs = await ensureSuite();
  const pack = packs?.journal;
  if (!pack) { ui.notifications?.error(game.i18n.localize("SDE.importer.adventure.notify.noPack")); return report; }
  const folder = await ensureSourceFolder(pack, source);
  const entry = await ensureSiteEntry(pack, { site, source, folder });
  if (!entry) { ui.notifications?.error(game.i18n.localize("SDE.importer.adventure.notify.noEntry")); return report; }

  const existing = new Map();
  for (const p of entry.pages) { const n = pageNum(p); if (n !== null) existing.set(n, p.id); }
  const plan = planAdventureCommit(locations, existing);
  report.collisions = plan.collisions;
  const known = new Set([...existing.keys(), ...locations.map((l) => l.num)]);
  // The locations sit under the page for the areas (level 2) when the book has one; without it they stand on their own.
  const level = overview.some((o) => o.key === "areas") ? 2 : 1;
  const payload = (loc) => {
    const p = locationPagePayload(loc, known, { resolve, noun: site.noun, level, items });
    p.text.content = cleanImportHtml(p.text.content);
    return p;
  };

  // The Introduction is one more page, found by its flag and kept up to date like the rest.
  const introDoc = intro.length ? entry.pages.find(isIntroPage) : null;
  const introPayload = () => {
    const p = introPagePayload(intro, known, { boldLines: introBold, resolve, items });
    p.text.content = cleanImportHtml(p.text.content);
    return p;
  };
  // The adventure's overview (its background, rumors, random encounters): pages ahead of the locations, found by their key.
  const overviewDocs = new Map(entry.pages.map((p) => [overviewKey(p), p]).filter(([k]) => k));
  const overviewPayload = (part, i) => ({ ...overviewPagePayload(part, i), text: { content: cleanImportHtml(part.html), format: globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 } });
  const overviewNew = overview.map((part, i) => [part, i]).filter(([part]) => !overviewDocs.has(part.key));
  const overviewOld = overview.map((part, i) => [part, i]).filter(([part]) => overviewDocs.has(part.key));
  const creates = [...overviewNew.map(([part, i]) => overviewPayload(part, i)), ...(intro.length && !introDoc ? [introPayload()] : []), ...plan.create.map(payload)];
  if (creates.length) {
    const made = await entry.createEmbeddedDocuments("JournalEntryPage", creates);
    report.created.push(...made.map((p) => p.name));
  }
  // keepExisting: a page that is already there is the GM's now (they may have edited it), so it is left exactly as it is.
  if (keepExisting) report.kept.push(...overviewOld.map(([part]) => overviewDocs.get(part.key).id), ...(introDoc ? [introDoc.id] : []), ...plan.update.map(({ pageId }) => pageId));
  // The overview this site was filed with before it had the quickstart's layout (a page for the background, one for the
  // factions...) is replaced by it: the module's own pages that the new read no longer has go, unless the GM's copies are to be kept.
  const staleOverview = keepExisting || !overview.length ? [] : entry.pages.filter((p) => overviewKey(p) && !overview.some((o) => o.key === overviewKey(p))).map((p) => p.id);
  if (staleOverview.length) await entry.deleteEmbeddedDocuments("JournalEntryPage", staleOverview);
  const updates = keepExisting ? [] : [...overviewOld.map(([part, i]) => ({ _id: overviewDocs.get(part.key).id, ...overviewPayload(part, i) })), ...(introDoc ? [{ _id: introDoc.id, ...introPayload() }] : []),
    ...plan.update.map(({ loc, pageId }) => ({ _id: pageId, ...payload(loc) }))];
  if (updates.length) {
    await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
    report.updated.push(...updates.map((u) => u.name));
  }

  // Pass 2, from a fresh read: an entry created a moment ago in a world's first
  // commit never receives its embedded pages on the instance create() returned
  // (live check 2026-09-17, hex-commit.mjs).
  const dbEntry = (await pack.getDocuments()).find((d) => d.id === entry.id) ?? entry;
  const uuidByNum = new Map();
  for (const p of dbEntry.pages) { const n = pageNum(p); if (n !== null) uuidByNum.set(n, p.uuid); }
  const rewrites = [];
  for (const p of dbEntry.pages) {
    const content = p.text?.content ?? "";
    const next = rewriteLocPlaceholders(content, uuidByNum);
    if (next !== content) rewrites.push({ _id: p.id, "text.content": next });
  }
  if (rewrites.length) await dbEntry.updateEmbeddedDocuments("JournalEntryPage", rewrites);

  report.entryUuid = dbEntry.uuid;
  return report;
}
