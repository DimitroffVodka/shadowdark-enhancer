/**
 * Shadowdark Enhancer — the master Key Locations journal of a book.
 *
 * importKeyLocations files one journal entry per region, which keeps each region's
 * write-ups together and the sidebar short, but leaves no single place to look a
 * location up. This builds that place from what the import already filed: ONE
 * entry per book, one page per region, a table row per keyed hex — the hex number
 * (a "go to this hex" link, hex-goto.mjs), the location's name (a link to its
 * write-up) and its terrain.
 *
 * It ships no book text. Every word in it was read from the GM's own PDF by the
 * import that came first, and a re-import rebuilds it in place. It is filed in the
 * Journals pack beside the regions, so the Importer Hub's Manage tree imports it
 * into a world like any other entry.
 *
 * Identity is its own flag (`keyIndex`), never the crawl flag: crawlEntries(), the
 * pin deployer, the tagger's hex-key picker and the legacy reflow all treat an
 * entry carrying `hex.crawl` as a region, and this one is not.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { ensureSuite, ensureSourceFolder, cleanImportHtml, sourceFolderName } from "../../shared/compendium-suite.mjs";
import { KEY_LOCATION_PAGES, CHAR_SOURCES } from "../char-content/char-content-manifest.mjs";
import { escapeHtml } from "../pdf-text-utils.mjs";
import { HEX_FLAG } from "./hex-commit.mjs";
import { hexNum } from "./hex-dataset.mjs";
import { L as t } from "../../shared/i18n.mjs";

/** Flag key under `flags.shadowdark-enhancer`: `{ src }` on the entry, `{ key }` (the region) on each page. */
export const KEY_INDEX_FLAG = "keyIndex";

/**
 * Pure: the hexes of one region, sorted by number. A hex counts when the region has
 * a write-up page for it or a summary row (a Cursed Scroll prints only write-ups,
 * and a region can have a table row for a hex whose page could not be read).
 * @param {{keyed?:Array<{num:string, name?:string, terrain?:string[]}>, pages?:Array<{num:string, name:string, uuid:string}>}} crawl
 * @returns {Array<{num:number, shown:string, name:string, terrain:string, uuid:string|null}>}
 */
export function indexRows({ keyed = [], pages = [] } = {}) {
  const byNum = (list) => new Map(list.map((x) => [hexNum(x.num), x]).filter(([n]) => n !== null));
  const page = byNum(pages), row = byNum(keyed);
  return [...new Set([...page.keys(), ...row.keys()])].sort((a, b) => a - b).map((num) => {
    const p = page.get(num), r = row.get(num);
    const name = (p?.name ?? "").replace(/^\d+\s*/, "") || r?.name || String(num);
    const terrain = (r?.terrain ?? []).map((w) => String(w).replace(/_/g, " ")).join(", ");
    return { num, shown: String(p?.num ?? r?.num), name, terrain, uuid: p?.uuid ?? null };
  });
}

/**
 * Pure: one region's page as HTML.
 * @param {ReturnType<typeof indexRows>} rows
 * @param {{src:string, hex:string, location:string, terrain:string, goto:string}} o  `src` rides on each
 *   link so a click on another book's map does not pan to a hex of the same number; the rest are the
 *   already-localised column heads and link tooltip
 */
export function indexPageHtml(rows, { src, hex, location, terrain, goto }) {
  const body = rows.map((r) => `<tr>`
    + `<td><a class="sde-hex-goto" href="#" role="button" data-sde-hex="${r.num}" data-sde-src="${escapeHtml(src)}" title="${escapeHtml(goto)}">${escapeHtml(r.shown)}</a></td>`
    + `<td>${r.uuid ? `@UUID[${r.uuid}]{${escapeHtml(r.name)}}` : escapeHtml(r.name)}</td>`
    + `<td>${escapeHtml(r.terrain)}</td></tr>`).join("");
  return `<table><thead><tr><th>${escapeHtml(hex)}</th><th>${escapeHtml(location)}</th><th>${escapeHtml(terrain)}</th></tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Pure: the master entry's pages, in the book's own region order (regions the page map does not
 * name follow, alphabetical).
 * @param {string} src
 * @param {Array<{title:string, keyed?:object[], pages?:object[]}>} crawls  the book's region entries
 * @param {{hex:string, location:string, terrain:string, goto:string}} labels
 * @returns {Array<{key:string, name:string, html:string, rows:number}>}
 */
export function planKeyIndex(src, crawls, labels) {
  const order = Object.keys(KEY_LOCATION_PAGES[src] ?? {});
  const at = (title) => { const i = order.indexOf(title); return i < 0 ? order.length : i; };
  return [...crawls].sort((a, b) => at(a.title) - at(b.title) || a.title.localeCompare(b.title))
    .map((c) => ({ c, rows: indexRows(c) })).filter(({ rows }) => rows.length)
    .map(({ c, rows }) => ({ key: c.title, name: c.title, html: indexPageHtml(rows, { src, ...labels }), rows: rows.length }));
}

/**
 * File (or refresh) a book's master Key Locations journal from its filed regions. GM only; a book
 * with no regions filed yet makes nothing.
 * @param {string} src  source key ("GMWR")
 * @returns {Promise<{uuid:string|null, regions:number, rows:number}>}
 */
export async function buildKeyLocationIndex(src) {
  const report = { uuid: null, regions: 0, rows: 0 };
  if (!game.user?.isGM) return report;
  const pack = (await ensureSuite())?.journal;
  if (!pack) return report;
  const label = CHAR_SOURCES[src]?.label ?? src;
  const folderName = sourceFolderName(label);
  const docs = await pack.getDocuments();

  const crawls = docs.filter((d) => { const f = d.getFlag(MODULE_ID, HEX_FLAG); return f?.crawl && f.source === folderName; }).map((d) => ({
    title: d.getFlag(MODULE_ID, HEX_FLAG).crawl,
    keyed: d.getFlag(MODULE_ID, HEX_FLAG).keyed ?? [],
    // The world copy when the crawl has been pinned (it is the page the map's notes open), else the pack's.
    pages: d.pages.filter((p) => p.getFlag(MODULE_ID, HEX_FLAG)?.num)
      .map((p) => ({ num: p.getFlag(MODULE_ID, HEX_FLAG).num, name: p.name, uuid: (game.journal?.get(d.id)?.pages.get(p.id) ?? p).uuid })),
  }));
  const built = planKeyIndex(src, crawls, {
    hex: t("SDE.importer.hex.index.colHex"), location: t("SDE.importer.hex.index.colLocation"),
    terrain: t("SDE.importer.hex.index.colTerrain"), goto: t("SDE.importer.hex.index.goto"),
  });
  if (!built.length) return report;

  const flagOf = (doc) => doc?.getFlag?.(MODULE_ID, KEY_INDEX_FLAG) ?? null;
  let entry = docs.find((d) => flagOf(d)?.src === src);
  entry ??= await JournalEntry.create({
    name: t("SDE.importer.hex.index.title", { book: label }), folder: await ensureSourceFolder(pack, label),
    flags: { [MODULE_ID]: { [KEY_INDEX_FLAG]: { src } } },
  }, { pack: pack.collection });

  const mine = new Map(entry.pages.filter((p) => flagOf(p)?.key).map((p) => [flagOf(p).key, p.id]));
  const payload = (pg, i) => ({
    name: pg.name, type: "text", sort: (i + 1) * 100000,
    text: { content: cleanImportHtml(pg.html), format: globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 },
    flags: { [MODULE_ID]: { [KEY_INDEX_FLAG]: { key: pg.key } } },
  });
  const all = built.map(payload);
  const create = all.filter((p) => !mine.has(p.flags[MODULE_ID][KEY_INDEX_FLAG].key));
  const update = all.filter((p) => mine.has(p.flags[MODULE_ID][KEY_INDEX_FLAG].key))
    .map((p) => ({ _id: mine.get(p.flags[MODULE_ID][KEY_INDEX_FLAG].key), ...p }));
  if (create.length) await entry.createEmbeddedDocuments("JournalEntryPage", create);
  if (update.length) await entry.updateEmbeddedDocuments("JournalEntryPage", update);

  report.uuid = entry.uuid;
  report.regions = built.length;
  report.rows = built.reduce((n, p) => n + p.rows, 0);
  return report;
}
