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
import { ensureSuite, ensureSourceFolder, ensureFolderPath, cleanImportHtml, sourceFolderName, findSuitePack } from "../../shared/compendium-suite.mjs";
import { buildLocationHtml, locationPageName, rewriteLocPlaceholders } from "./adventure-parser.mjs";
import { creatureVocabulary } from "./adventure-creatures.mjs";
import { linkItems } from "./adventure-journal.mjs";
import { findTreasure, findScrolls, treasureItemData, scrollItemData } from "./adventure-treasure.mjs";

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
export function introPagePayload(lines, known, { boldLines, resolve, items, creatures } = {}) {
  return {
    name: t("SDE.importer.adventure.introPage"),
    type: "text",
    title: { show: true, level: 1 },
    sort: INTRO_SORT,
    text: {
      content: buildLocationHtml({ bodyLines: lines, boldLines }, known, { resolve, items, creatures }),
      format: globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1,
    },
    flags: { [MODULE_ID]: { [ADVENTURE_FLAG]: { intro: true } } },
  };
}

/**
 * The keys of the overview pages from before the quickstart layout: the Overview ("lead"), the room key, the background, the
 * factions, the rumors, the environs, the order of battle and the random encounters, each a slug of the book's own heading.
 * Only these are swept when an import brings the new layout; nothing the new layout files, or the GM adds, is ever on this list.
 */
export const LEGACY_OVERVIEW_KEYS = new Set(["lead", "room-key", "background", "factions", "rumors", "environs-and-entrances", "order-of-battle", "random-encounters"]);

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
export function locationPagePayload(loc, known, { resolve, noun, level = 2, items, creatures } = {}) {
  return {
    name: locationPageName(loc, noun),
    type: "text",
    // Level 2: a location sits under the "Areas" page in the journal's contents, as in the Lost Citadel.
    title: { show: true, level },
    sort: LOCATION_SORT + loc.num * 100,   // by number, whatever order the pages were made in
    text: {
      content: buildLocationHtml({ bodyLines: loc.bodyLines ?? [], boldLines: loc.boldLines }, known, { resolve, items, creatures }),
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
 * The adventure's treasure as items, the way the Lost Citadel quickstart has them: each priced thing the key names ("a blue
 * pearl (40 gp)") is an item worth that, each spell scroll is a scroll that points at its spell, in a folder per area. An item
 * the importer made on an earlier run is found by its flag and reused as it is (the GM may have changed it), never made twice.
 * @param {CompendiumCollection} pack  the importer's items pack
 * @param {{site:{id:string,title:string}, source:string, pages:Array<{loc:{num:number,name:string}, html:string}>, items?:Array<{name:string}>, spells?:Array<{name:string,uuid:string}>}} opts
 * @returns {Promise<Map<number, Array<{name:string, uuid:string}>>>}  per area number, the links to put in its text (name = the words as the page has them)
 */
export async function fileTreasure(pack, { site, source, pages, items = [], spells = [] }) {
  const links = new Map();
  if (!pack?.getIndex) return links;
  try {
    const have = new Set(items.map((i) => i.name.toLowerCase()));
    const flagPath = `flags.${MODULE_ID}.adventureTreasure`;
    const index = await pack.getIndex({ fields: [flagPath] });
    const filed = new Map(index.contents.map((e) => [e.flags?.[MODULE_ID]?.adventureTreasure?.key, e.uuid]).filter(([k]) => k));
    for (const { loc, html } of pages) {
      const wanted = [
        ...findTreasure(html).map((found) => ({ phrase: found.phrase, key: `${site.id}|${loc.num}|${found.name}|${JSON.stringify(found.cost)}`, data: treasureItemData(found, { source }) })),
        ...findScrolls(html, spells, have).map((sc) => ({ phrase: sc.phrase, key: `${site.id}|${loc.num}|${sc.name}`, data: scrollItemData(sc, { source }) })),
      ];
      if (!wanted.length) continue;
      const folder = await ensureFolderPath(pack, [sourceFolderName(source), site.title, locationPageName(loc, site.noun)]);
      for (const w of wanted) {
        let uuid = filed.get(w.key);
        if (!uuid) {
          const [made] = await Item.createDocuments([{ ...w.data, folder, flags: { [MODULE_ID]: { adventureTreasure: { site: site.id, num: loc.num, key: w.key } } } }], { pack: pack.collection });
          uuid = made?.uuid;
          if (uuid) filed.set(w.key, uuid);
        }
        if (uuid) links.set(loc.num, [...(links.get(loc.num) ?? []), { name: w.phrase, uuid }]);
      }
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | adventures: ${site.title} treasure is filed without items`, err);
  }
  return links;
}

/**
 * File a site's locations as pages. GM-gated like every other commit.
 * @param {{id:string,title:string}} site  manifest row
 * @param {Array<{num:number,name:string,bodyLines:string[]}>} locations
 * @param {{source?:string, intro?:string[], introBold?:string[], resolve?:(phrase:string)=>string|undefined, keepExisting?:boolean}} [opts]
 *   source label, for the folder; intro = the lines printed before the first location, filed
 *   as an Introduction page (introBold: the same lines with bold markers); resolve = a
 *   creature link target for a bold name (adventure-creatures.mjs creatureResolver), so the
 *   bold names the bestiary knows are filed as links; items = the magic items and treasure to link by name (adventure-journal linkableItems); spells = the system's spells ({name, uuid}), for the scrolls the key names; phraseLinks = words of the book that link to a roll table ({name: words, uuid}); overview = the adventure's overview pages [{key, name, html}]
 *   (chapter-journal buildChapterPages), filed ahead of the locations
 * @returns {Promise<{entryUuid:string|null, created:string[], updated:string[], collisions:number[]}>}
 */
export async function commitAdventure(site, locations, { source = "", intro = [], introBold, resolve, items, spells, phraseLinks = [], keepExisting = false, overview = [] } = {}) {
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
  // Every way this adventure's text names its creatures, so a mention printed plain is linked like one printed bold.
  const creatures = creatureVocabulary(locations, resolve);
  // The locations sit under the page for the areas (level 2) when the book has one; without it they stand on their own.
  const level = overview.some((o) => o.key === "areas") ? 2 : 1;
  const basePayload = (loc) => {
    const p = locationPagePayload(loc, known, { resolve, noun: site.noun, level, items, creatures });
    p.text.content = cleanImportHtml(p.text.content);
    return p;
  };
  // The treasure the key prices becomes items first (the page's text is read for it), then each page links them.
  const treasure = await fileTreasure(packs.items, { site: { ...site, noun: site.noun }, source, items, spells,
    pages: [...plan.create, ...plan.update.map((u) => u.loc)].map((loc) => ({ loc, html: basePayload(loc).text.content })) });
  const payload = (loc) => {
    const p = basePayload(loc);
    p.text.content = linkItems(p.text.content, [...(treasure.get(loc.num) ?? []), ...phraseLinks]);
    return p;
  };

  // The Introduction is one more page, found by its flag and kept up to date like the rest.
  const introDoc = intro.length ? entry.pages.find(isIntroPage) : null;
  const introPayload = () => {
    const p = introPagePayload(intro, known, { boldLines: introBold, resolve, items, creatures });
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
  // factions...) is replaced by it: those pages, and only those, go once this read brings the new layout (an Overview or an Areas
  // page), unless the GM's copies are to be kept. A page of the current layout the read lacks is left alone, as a location is.
  const newLayout = overview.some((o) => o.key === "overview" || o.key === "areas");
  const staleOverview = keepExisting || !newLayout ? [] : entry.pages.filter((p) => LEGACY_OVERVIEW_KEYS.has(overviewKey(p)) && !overview.some((o) => o.key === overviewKey(p))).map((p) => p.id);
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
