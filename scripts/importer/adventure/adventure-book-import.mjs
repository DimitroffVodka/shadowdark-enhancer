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
import { creatureMentions, creatureResolver } from "./adventure-creatures.mjs";
import { commitAdventure } from "./adventure-commit.mjs";
import { summariseGutter } from "../hex/hex-book-import.mjs";

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

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
  for (const [i, site] of sites.entries()) {
    onSite?.(site.title, i + 1, sites.length);
    try {
      const pages = planSitePages(site, (p) => sourcePdfTarget(src, String(p))?.page ?? null);
      const { locations, warnings, intro, introBold } = await readSite({ ...pdf, notifyGutterWarnings: collect }, file, site, pages);
      const res = await commitAdventure(site, locations, { source: label, intro, introBold, resolve: await creatureLinks(site), keepExisting });
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
