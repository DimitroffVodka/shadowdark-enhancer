/**
 * Shadowdark Enhancer — a book's adventures in one pass (Foundry-bound).
 *
 * Reads each adventure site's pages out of the GM's own PDF, parses the numbered
 * locations (adventure-parser.mjs) and files one journal entry per site with a
 * page per location (adventure-commit.mjs). The page map is adventure-manifest:
 * page numbers only, so this ships none of the book.
 *
 * A site that throws is reported and the rest still run: one unreadable spread
 * must not cost the other twenty-three.
 */

import { CHAR_SOURCES } from "../char-content/char-content-manifest.mjs";
import { resolveSourcePdf, sourcePdfTarget } from "../source-pdf-registry.mjs";
import { parsePageRange } from "../pdf-text-extract.mjs";
import { allSites } from "./adventure-manifest.mjs";
import { MODULE_ID } from "../../shared/module-id.mjs";
import { parseAdventurePages, bodyBlocks } from "./adventure-parser.mjs";
import { trapCandidates } from "./adventure-traps.mjs";
import { creatureMentions, creatureResolver, creatureVocabulary } from "./adventure-creatures.mjs";
import { commitAdventure, addOverviewToWorldCopy } from "./adventure-commit.mjs";
import { assembleOverview, linkableItems } from "./adventure-journal.mjs";
import { findSuitePack } from "../../shared/compendium-suite.mjs";
import { summariseGutter } from "../hex/hex-book-import.mjs";
import { L as t } from "../../shared/i18n.mjs";


/**
 * Pure: a site's printed page cite → the PDF pages to read.
 * @param {{pages:string}} site
 * @param {(page:number)=>number|null} [pageOf]  printed page → PDF page; the
 *   Foundry caller passes the registry's per-book offset, tests pass identity
 * @returns {number[]}
 */
export function planSitePages(site, pageOf = (p) => p) {
  return parsePageRange(site.pages).map(pageOf).filter((p) => Number.isInteger(p));
}

/** Pure: the manifest's skip source → the RegExp the parser takes. */
const skipOf = (site) => (site.skip ? new RegExp(site.skip) : undefined);

/**
 * Read one site out of the book.
 * @returns {Promise<{locations:object[], warnings:string[], intro:string[], introBold:string[]}>}
 */
async function readSite({ extractPdfText, notifyGutterWarnings }, file, site, pages) {
  const result = await extractPdfText(file, { pages, columns: "auto", markBold: true });
  notifyGutterWarnings(result);
  return parseAdventurePages(
    (result.pages ?? []).map((p) => p.lines ?? []),
    { style: site.style, range: site.range, skip: skipOf(site), intro: !!site.intro });
}

/**
 * Pure: the overview of a one-page adventure (the Cursed Scroll 4 and Western Reaches mini adventures) as one page. Their
 * intro page is a blurb, a Random Encounters table and the map with its legend, and cutting it at the headings leaves a
 * page per map-label scrap ("M M", "S S P P"). The blurb and the table stay, the Random Encounters heading is kept, and
 * the paragraphs left from the map's labels (numbers and single letters) go.
 * @param {Array<{key:string, name:string, html:string}>} parts  chapter-journal buildChapterPages pages
 * @returns {Array<{key:string, name:string, html:string}>}
 */
export function inlineOverview(parts) {
  const words = (html) => (String(html).replace(/<[^>]+>/g, " ").match(/[A-Za-z'’]{3,}/g) ?? []).length;
  const html = [];
  for (const p of parts ?? []) {
    const paragraphs = String(p.html).split(/(?<=<\/p>)\s*/).filter(Boolean);
    const kept = p.key === "lead" ? paragraphs : paragraphs.filter((q) => words(q) >= 3);
    if (!kept.length) continue;
    if (p.key === "random-encounters") html.push(`<h3>${p.name}</h3>`);
    html.push(...kept);
  }
  return html.length ? [{ key: "overview", name: parts[0]?.name === "Overview" ? "Overview" : (parts[0]?.name ?? "Overview"), html: html.join("\n") }] : [];
}

/**
 * The adventure's overview pages (its background, rumors, random encounters, what light there is), read from the printed
 * pages the manifest names. A book that cannot be read for them costs the overview and nothing else: the locations are
 * still filed.
 * @returns {Promise<Array<{key:string, name:string, html:string}>>}
 */
async function readOverview(src, site, { tables, items, creatures } = {}) {
  if (!site.overview) return [];
  try {
    const { readChapter } = await import("../chapter-journal.mjs");
    const read = await readChapter({ src, pages: site.overview, name: t("SDE.importer.adventure.overviewPage"), rowNumbers: true });
    const parts = site.style === "inline" ? inlineOverview(read?.pages) : (read?.pages ?? []);
    // A city's gazetteer is not an adventure's overview: it keeps its pages as the book's headings cut them.
    return site.noun === "" ? parts : assembleOverview(parts, { range: site.range, tables, items, creatures });
  } catch (err) {
    console.warn(`Shadowdark Enhancer | adventures: ${site.title} overview could not be read`, err);
    return [];
  }
}

/**
 * The magic items and treasure of the world, to link by name in an adventure's text: the system's magic items and the
 * ones the importer made from the books' treasure. Undefined when there is nothing to look in.
 */
async function itemLinks() {
  try {
    const rows = [];
    for (const pack of [game.packs.get("shadowdark.magic-items"), findSuitePack("items")].filter(Boolean)) {
      const core = /^shadowdark\./.test(pack.collection);
      const idx = await pack.getIndex({ fields: ["type", "system.magicItem", "system.treasure"] });
      // The system's magic items are all worth a link; of the importer's items, only the treasure (its weapon variants are not).
      for (const e of idx.contents) rows.push({ name: e.name, uuid: e.uuid, type: e.type, system: { magicItem: core ? e.system?.magicItem : e.system?.treasure } });
    }
    return linkableItems(rows);
  } catch (err) {
    console.warn("Shadowdark Enhancer | adventures: item names are filed without links", err);
    return undefined;
  }
}

/**
 * The system's spells by name, for the scrolls an adventure's key names. Undefined when there is nothing to look in.
 * @returns {Promise<Array<{name:string, uuid:string}>|undefined>}
 */
async function spellLinks() {
  try {
    const pack = game.packs.get("shadowdark.spells");
    if (!pack) return undefined;
    const seen = new Set();
    return (await pack.getIndex()).contents.filter((e) => e.name && !seen.has(e.name.toLowerCase()) && seen.add(e.name.toLowerCase())).map((e) => ({ name: e.name, uuid: e.uuid }));
  } catch (err) {
    console.warn("Shadowdark Enhancer | adventures: spell scrolls are filed without items", err);
    return undefined;
  }
}

/**
 * The roll tables the table importer made for a site (its manifest row names them), as { rumors, encounters } link targets;
 * empty when the world has not imported them.
 * @param {{tables?:{rumors?:string, encounters?:string}}} site
 */
async function tableLinks(site) {
  if (!site.tables && !site.phraseTables) return {};
  try {
    const pack = findSuitePack("tables") ?? game.packs.find((p) => p.collection.endsWith("--roll-tables"));
    if (!pack) return {};
    const idx = await pack.getIndex({ fields: [`flags.${MODULE_ID}.manifestId`] });
    const byId = new Map(idx.contents.map((e) => [e.flags?.[MODULE_ID]?.manifestId, e]).filter(([k]) => k));
    const link = (id) => { const e = byId.get(id); return e ? { uuid: e.uuid, name: e.name } : undefined; };
    // Words of the key that name a table ("a random diabolical treasure", from the back cover) link to it; the table is found by its name.
    const phrases = Object.entries(site.phraseTables ?? {}).map(([phrase, name]) => ({ phrase, e: idx.contents.find((e) => e.name === name || e.name.endsWith(`: ${name}`)) })).filter((p) => p.e).map((p) => ({ name: p.phrase, uuid: p.e.uuid }));
    return { rumors: link(site.tables?.rumors), encounters: link(site.tables?.encounters), phrases };
  } catch (err) {
    console.warn(`Shadowdark Enhancer | adventures: ${site.title} roll tables are not linked`, err);
    return {};
  }
}

/**
 * Where a bold creature name in this site's text links to: the world's monsters (core
 * first, then the GM's imports), plus the names the book gives a creature that the
 * bestiary calls something else. Undefined when the world has no monsters to look in,
 * so the text is filed plain rather than failing.
 * @param {{creatureAliases?:Record<string,string>}} site
 */
async function creatureLinks(site) {
  try {
    const { MonsterLinker } = await import("../monsters/monster-linker.mjs");
    return creatureResolver(await MonsterLinker.buildIndex(), site.creatureAliases);
  } catch (err) {
    console.warn("Shadowdark Enhancer | adventures: monster names are filed without links", err);
    return undefined;
  }
}

/**
 * Who each location of a site names, read out of the GM's own book: the creatures
 * set in bold with a count beside them (adventure-creatures.mjs), per location
 * number. Read when the tokens are placed, never stored, so the book's text is not
 * kept anywhere the GM did not put it.
 * @param {{id:string, src:string, pages:string, range:[number,number], style:string, skip?:string}} site
 * @returns {Promise<Record<number,Array<{phrase:string, count:number}>>|null>} null when the book is not linked
 */
export async function readSiteCreatures(site) {
  const file = resolveSourcePdf(site.src);
  if (!file) return null;
  const { extractPdfText } = await import("../pdf-text-extract.mjs");
  const pages = planSitePages(site, (p) => sourcePdfTarget(site.src, String(p))?.page ?? null);
  const result = await extractPdfText(file, { pages, columns: "auto", markBold: true });
  const { locations } = parseAdventurePages((result.pages ?? []).map((p) => p.lines ?? []), { style: site.style, range: site.range, skip: skipOf(site) });
  return Object.fromEntries(locations.map((l) => [l.num, creatureMentions(l.boldLines)]));
}

/**
 * The lines of each location of a site that may be its traps, read out of the GM's own book (adventure-traps.mjs
 * trapCandidates), per location number. Read when the traps are placed, never stored.
 * @returns {Promise<Record<number,string[]>|null>} null when the book is not linked
 */
export async function readSiteTraps(site) {
  const file = resolveSourcePdf(site.src);
  if (!file) return null;
  const { extractPdfText } = await import("../pdf-text-extract.mjs");
  const pages = planSitePages(site, (p) => sourcePdfTarget(site.src, String(p))?.page ?? null);
  const result = await extractPdfText(file, { pages, columns: "auto", markBold: true });
  const { locations } = parseAdventurePages((result.pages ?? []).map((p) => p.lines ?? []), { style: site.style, range: site.range, skip: skipOf(site) });
  return Object.fromEntries(locations.map((l) => [l.num, trapCandidates(bodyBlocks(l.bodyLines))]));
}

/**
 * Add a site's traps to its scene and nothing else: no pins, creatures or walls are touched, and a trap already there is
 * left as it is. The safe way to give a scene its traps once its walls have been corrected by hand.
 * @param {Scene} scene
 * @returns {Promise<{status:"built"|"none"|"mismatch"|"no-book"|"not-adventure", placed:number, existing:number, skipped:Array<{pin:number, nth:number, why:string}>}>}
 */
export async function addSiteTraps(scene) {
  const { MAP_FLAG, placeSiteTraps } = await import("./adventure-scene.mjs");
  const site = allSites().find((s) => s.id === scene?.getFlag(MODULE_ID, MAP_FLAG)?.site);
  const out = (status) => ({ status, placed: 0, existing: 0, skipped: [] });
  if (!site) return out("not-adventure");
  const texts = await readSiteTraps(site);
  if (!texts) return out("no-book");
  const rect = scene.dimensions?.sceneRect ?? { x: 0, y: 0, width: scene.width, height: scene.height };
  return placeSiteTraps(scene, site, rect, texts);
}

/**
 * The symbols a site's key map prints, read out of the GM's own book (map-labels.mjs stitchMapLabels): the places of its secret
 * doors, locked doors and barricades. Read when they are placed, never stored.
 * @returns {Promise<{marks:Array<{kind:string,x:number,y:number}>, aspect:number}|null|undefined>} undefined when the book is not linked, null when its key map cannot be read
 */
export async function readSiteMarks(site) {
  const file = resolveSourcePdf(site.src);
  const mapPages = site.markPages ?? site.mapPages;
  if (!file || !mapPages) return undefined;
  const pages = parsePageRange(mapPages).map((p) => sourcePdfTarget(site.src, String(p))?.page).filter(Number.isInteger);
  const { extractMapLabels } = await import("../pdf-text-extract.mjs");
  const { stitchMapLabels, clipToFrame } = await import("./map-labels.mjs");
  const map = stitchMapLabels(await extractMapLabels(file, pages));
  return map && clipToFrame(map, site.markFrame);
}

/**
 * Add a site's key-map symbols to its scene and nothing else: no pins, creatures, traps or walls are touched, and a symbol
 * already there is left as it is. The safe way to give a scene its symbols once its walls have been corrected by hand.
 * @param {Scene} scene
 * @returns {Promise<{status:"built"|"none"|"mismatch"|"no-book"|"unreadable"|"not-adventure", placed:number, existing:number}>}
 */
export async function addSiteMarks(scene) {
  const { MAP_FLAG, placeSiteMarks } = await import("./adventure-scene.mjs");
  const site = allSites().find((s) => s.id === scene?.getFlag(MODULE_ID, MAP_FLAG)?.site);
  const out = (status) => ({ status, placed: 0, existing: 0 });
  if (!site) return out("not-adventure");
  if (!(site.markPages ?? site.mapPages)) return out("none");
  const map = await readSiteMarks(site);
  if (map === undefined) return out("no-book");
  if (!map) return out("unreadable");
  const rect = scene.dimensions?.sceneRect ?? { x: 0, y: 0, width: scene.width, height: scene.height };
  return placeSiteMarks(scene, site, rect, map);
}

/**
 * File every adventure site of one book, or of the listed site ids. GM-gated.
 * @param {string} src  source key ("CS1")
 * @param {{ids?:string[], onSite?:(title:string, i:number, total:number)=>void, keepExisting?:boolean}} [opts]
 *   keepExisting: pages already filed are left as they are (the import wizard, which promises not to overwrite)
 * @returns {Promise<{label:string, sites:Array<{id:string,title:string,locations:number,expected:number,missing:string[],uuid:string|null,created:number,updated:number,kept:number}>, locations:number, failed:Array<{title:string,error:string}>}>}
 */
export async function importAdventures(src, { ids, onSite, keepExisting = false } = {}) {
  const label = CHAR_SOURCES[src]?.label ?? src;
  const report = { label, sites: [], locations: 0, failed: [] };
  if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.importer.gm.adventure")); return report; }

  const file = resolveSourcePdf(src);
  if (!file) { ui.notifications?.warn(t("SDE.importer.pdf.bookNotLinked")); return report; }

  const pdf = await import("../pdf-text-extract.mjs");
  // A warning per page would bury the run's own report; they are collected and
  // said once, by cause (the same way the hex key import does).
  const gutter = [];
  const collect = (result) => { for (const w of result?.warnings ?? []) gutter.push(w); };
  const sites = allSites(src).filter((s) => !ids || ids.includes(s.id));
  const items = await itemLinks();
  const spells = await spellLinks();
  for (const [i, site] of sites.entries()) {
    onSite?.(site.title, i + 1, sites.length);
    try {
      const pages = planSitePages(site, (p) => sourcePdfTarget(src, String(p))?.page ?? null);
      const { locations, warnings, intro, introBold } = await readSite({ ...pdf, notifyGutterWarnings: collect }, file, site, pages);
      const tables = await tableLinks(site);
      const resolve = await creatureLinks(site);
      const overview = await readOverview(src, site, { tables, items, creatures: creatureVocabulary(locations, resolve) });
      const res = await commitAdventure(site, locations, { source: label, intro, introBold, resolve, items, spells, phraseLinks: tables.phrases, keepExisting, overview });
      // The world's copy of the journal (when the scene has deployed one) gets the overview too, without touching its other pages.
      try { if (overview.length) await addOverviewToWorldCopy(await fromUuid(res.entryUuid)); } catch (err) { console.warn(`Shadowdark Enhancer | adventures: ${site.title} overview not added to the world copy`, err); }
      report.sites.push({
        id: site.id, title: site.title, locations: locations.length,
        expected: site.range[1] - site.range[0] + 1, missing: warnings, uuid: res.entryUuid,
        created: res.created.length, updated: res.updated.length, kept: res.kept.length,   // pages added, pages already there that were read again, and pages left as they were
      });
      report.locations += locations.length;
    } catch (err) {
      console.error(`Shadowdark Enhancer | adventures: ${site.title} failed`, err);
      report.failed.push({ title: site.title, error: String(err?.message ?? err) });
    }
  }
  report.gutter = summariseGutter(gutter);
  if (report.gutter) {
    console.warn("Shadowdark Enhancer | adventures: text crossed the column gutter", gutter);
    ui.notifications?.warn(t("SDE.importer.adventure.gutter", report.gutter));
  }
  return report;
}
