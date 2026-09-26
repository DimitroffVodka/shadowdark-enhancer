/**
 * Shadowdark Enhancer — any page range of a book as a reflowed journal (#194).
 *
 * The GM picks a registered source PDF and a range of printed pages; the text
 * comes out of their own PDF in their own browser, is split into pages at the
 * book's ALL-CAPS headings (the same two-capitals rule the hex parser uses),
 * and each page is reflowed by reflowBodyLines: lines rejoined into paragraphs,
 * broken words mended, page numbers dropped. A PRESET instead names its own
 * sections by page range — the City-States print every city's name as a large
 * title-case line that no text rule can tell from prose, and OVERVIEW,
 * RESOURCES… recur under each one, so there a section is two pages and its
 * ALL-CAPS headings become sub-headings.
 *
 * Filed in the `shadowdark-enhancer--journals` pack, in the book's folder.
 * Identity is a flag, never the name: `flags.shadowdark-enhancer.chapter =
 * { src, pages, preset }` on the entry (preset id, or "custom") and `{ key }`
 * on each page, so importing the
 * same range again updates those pages in place and leaves any page the GM
 * added alone. A page whose name matches an imported key location (the hex
 * importer's pages) links to it, and the hex page links back.
 *
 * Ships ZERO book content: presets are page numbers and the names the book
 * gives those pages, nothing else.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { escapeHtml } from "./pdf-text-utils.mjs";
import { PAGE_FURNITURE_RE, isHeading, reflowBodyLines } from "./tables/hex-parser.mjs";
import { titleCaseName } from "./monsters/statblock-parser.mjs";
import { HEX_FLAG } from "./hex/hex-commit.mjs";

/** Flag key under `flags.shadowdark-enhancer` on the entry and its pages. */
export const CHAPTER_FLAG = "chapter";

/**
 * Ready-made ranges, one click each. `label` is an i18n key; `pages` is the
 * whole range and the entry's identity; each section is one journal page.
 * Without `sections` the range splits at its headings like a free range, and
 * `lead: false` drops the text before the first heading (a chapter's preamble).
 */
export const CHAPTER_PRESETS = [
  // Cursed Scroll 6 pp.46-47: one page per holiday (holidays/holidays.mjs reads
  // the pages back by key). The two-page spread's preamble is not a holiday.
  {
    id: "cs6-holidays", label: "SDE.importer.chapter.presetCs6Holidays",
    src: "CS6", name: "City of Masks Holidays", pages: "46-47", lead: false,
  },
  {
    id: "gmwr-city-states", label: "SDE.importer.chapter.presetCityStates",
    src: "GMWR", name: "The City-States", pages: "16-27",
    sections: [
      { name: "The City-States", pages: "16-17" },
      { name: "City of Masks", pages: "18-19" },
      { name: "Alkesh", pages: "20-21" },
      { name: "Stonehall", pages: "22-23" },
      { name: "Kyzian Tribes", pages: "24-25" },
      { name: "Lydonia", pages: "26-27" },
    ],
  },
];

/** Names compared as the reader sees them: case, punctuation and a hex number ignored. */
export const nameKey = (s) => String(s ?? "").toLowerCase()
  .replace(/^\s*\d{3,4}\.?\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

const slug = (s) => nameKey(s).replace(/ /g, "-") || "page";

/**
 * A page title: capitalised, one to four words, no sentence punctuation. Four
 * words covers every running title measured ("Holidays", "City of Masks", "The
 * City-States"); a line of prose that happens to start a column is longer.
 */
const TITLE_LIKE = /^[A-Z][^\s.,;:!?]*(?:\s+[^\s.,;:!?]+){0,3}$/;

/**
 * One page's lines without its furniture. The column split files the foot of
 * the LEFT column mid-page, so the page's own number is dropped wherever it
 * lands, not only at the ends. The page's big title is filed at the top of the
 * right column, so it comes straight after that number, where it would read
 * as the last words of a paragraph: a short title-like line there goes too,
 * and nowhere else. Every line dropped that way is pushed onto `dropped`, so
 * the preview can say what went.
 * @param {string[]} lines
 * @param {number} [printed]  the page's printed number
 * @param {string[]} [dropped]  collects the title lines removed
 * @returns {string[]}
 */
export function stripPageFurniture(lines, printed, dropped = []) {
  const all = (lines ?? []).map((l) => String(l ?? "").trim()).filter(Boolean);
  const own = (l) => l === String(printed);
  const title = (l, i) => !isHeading(l) && TITLE_LIKE.test(l) && own(all[i - 1] ?? "");
  const kept = all.filter((l, i) => {
    if (own(l)) return false;
    if (!title(l, i)) return true;
    dropped.push(l);
    return false;
  });
  while (kept.length && PAGE_FURNITURE_RE.test(kept[0])) kept.shift();
  while (kept.length && PAGE_FURNITURE_RE.test(kept.at(-1))) kept.pop();
  return kept;
}

/** A line that opens a run-in entry: "Montmar Castle. A white-walled…". */
const RUN_IN = /^[A-Z][^.!?]{0,30}\.\s+[A-Z]/;

/**
 * Mark each paragraph's end with the blank line reflowBodyLines splits on. A
 * PDF gives printed lines and no blank lines, so what is left is a sentence
 * that ends well short of the column's width, or one followed by the next
 * run-in entry's bold name.
 * ponytail: text heuristics — a paragraph whose last line runs nearly full
 * width, with no run-in name after it, joins the next one; font and indent
 * data from the extractor would fix it.
 */
function markParagraphEnds(lines) {
  const widths = lines.filter((l) => !isHeading(l)).map((l) => l.length).sort((a, b) => a - b);
  const short = (widths[Math.floor(widths.length / 2)] ?? 0) * 0.8;
  return lines.flatMap((l, i) => (!isHeading(l) && /[.!?]["”’')]?$/.test(l)
    && (l.length < short || RUN_IN.test(lines[i + 1] ?? "")) ? [l, ""] : [l]));
}

/**
 * One section's lines → page HTML. The section's own printed title, when it
 * opens the text, is the page name already and is dropped; ALL-CAPS headings
 * inside become sub-headings.
 * @param {string} name
 * @param {string[]} lines
 * @returns {string}
 */
export function sectionHtml(name, lines) {
  const body = lines.length && nameKey(lines[0]) === nameKey(name) ? lines.slice(1) : lines;
  return reflowBodyLines(markParagraphEnds(body))
    .map((p) => (isHeading(p) ? `<h3>${escapeHtml(titleCaseName(p))}</h3>` : `<p>${escapeHtml(p)}</p>`))
    .join("\n");
}

/**
 * Lines → sections, a new one at every ALL-CAPS heading. Text before the first
 * is named `leadName` but keyed "lead", so re-importing under another journal
 * name updates that page instead of adding a second one.
 */
function splitAtHeadings(lines, leadName) {
  const out = [{ name: leadName, key: "lead", lines: [] }];
  for (const l of lines) {
    if (isHeading(l)) out.push({ name: titleCaseName(l), lines: [] });
    else out.at(-1).lines.push(l);
  }
  return out;
}

/**
 * Pure: extracted pages → journal pages.
 * @param {Array<{page:number, lines:string[]}>} pages  extractPdfText's `pages`,
 *   numbered by PRINTED page
 * @param {{name?:string, sections?:Array<{name:string, pages:number[]}>|null, lead?:boolean, dropped?:string[]}} [opts]
 *   `sections` (printed pages) makes each section one page; without it the
 *   text is split at its ALL-CAPS headings, and `lead: false` drops the text
 *   before the first one. `dropped` collects the lines removed as page
 *   titles, for the preview to show.
 * @returns {Array<{key:string, name:string, html:string}>}
 */
export function buildChapterPages(pages, { name = "", sections = null, lead = true, dropped = [] } = {}) {
  const linesOf = (nums) => (pages ?? []).filter((p) => !nums || nums.includes(p.page))
    .flatMap((p) => stripPageFurniture(p.lines, p.page, dropped));
  const parts = sections?.length
    ? sections.map((s) => ({ name: s.name, lines: linesOf(s.pages) }))
    : splitAtHeadings(linesOf(null), name).slice(lead ? 0 : 1);
  const seen = new Map();
  const out = [];
  for (const part of parts) {
    const html = sectionHtml(part.name, part.lines);
    if (!html) continue;
    // Headings repeat (OVERVIEW under every city), and the key is identity.
    const base = part.key ?? slug(part.name);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ key: n > 1 ? `${base}-${n}` : base, name: part.name, html });
  }
  return out;
}

/**
 * Pure: which chapter pages name an imported key location. Hex pages are
 * named "<number> <name>" and may carry the book's footnote marker.
 * @param {Array<{name:string}>} chapterPages
 * @param {Array<{name:string}>} hexPages
 * @returns {Array<[object, object]>} [chapterPage, hexPage] pairs
 */
export function matchKeyedHexes(chapterPages, hexPages) {
  const byName = new Map((hexPages ?? []).map((h) => [nameKey(h.name), h]));
  return (chapterPages ?? []).map((c) => [c, byName.get(nameKey(c.name))]).filter(([, h]) => h);
}

/** Pure: `content` with a link paragraph appended, unless it already links `uuid`. */
export function withLink(content, uuid, paragraph) {
  const html = String(content ?? "");
  return html.includes(uuid) ? html : `${html}\n<p>${paragraph}</p>`;
}

// ── Foundry-bound ─────────────────────────────────────────────────────────────

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/**
 * Read a chapter out of the GM's own PDF. Printed pages are offset to PDF
 * pages the way every grab does it (sourcePdfTarget).
 * @param {{src:string, pages:string, name:string, sections?:Array<{name:string,pages:string}>, lead?:boolean}} req
 * @returns {Promise<{pages:Array<{key,name,html}>, warnings:string[], dropped:string[]}|null>}
 *   null when the book has no PDF; `dropped` = lines removed as page titles
 */
export async function readChapter({ src, pages, name, sections = null, lead = true }) {
  const { resolveSourcePdf, sourcePdfTarget } = await import("./source-pdf-registry.mjs");
  const { extractPdfText, parsePageRange, notifyGutterWarnings } = await import("./pdf-text-extract.mjs");
  const file = resolveSourcePdf(src);
  if (!file) return null;
  // Work in printed pages: the ones the GM typed, and the ones the book prints.
  const offset = (sourcePdfTarget(src, "1")?.page ?? 1) - 1;
  const result = await extractPdfText(file, { pages: parsePageRange(pages).map((p) => p + offset), columns: "auto" });
  // The extractor names PDF pages ("p98: …"); the GM typed printed ones.
  result.warnings = printedPageWarnings(result.warnings, offset);
  notifyGutterWarnings(result);
  const printed = (result.pages ?? []).map((p) => ({ ...p, page: p.page - offset }));
  const secs = sections?.map((s) => ({ name: s.name, pages: parsePageRange(s.pages) })) ?? null;
  const dropped = [];
  return { pages: buildChapterPages(printed, { name, sections: secs, lead, dropped }), warnings: result.warnings, dropped };
}

/** Pure: extractor warnings ("p98: …") renumbered to the printed page ("p94: …"). */
export function printedPageWarnings(warnings, offset = 0) {
  return (warnings ?? []).map((w) => String(w).replace(/^p(\d+):/, (_, n) => `p${Number(n) - offset}:`));
}

/**
 * Pure: is this entry flag the journal a request files into? A preset and a
 * free range over the same pages are different journals (the preset splits by
 * section, the free range by heading), so the preset id, or "custom", is part
 * of the identity alongside the book and the range.
 * @param {{src?:string, pages?:string, preset?:string}|null} flag
 * @param {{src:string, pages:string, preset?:string}} req
 */
export function isSameChapter(flag, { src, pages, preset = "custom" }) {
  return !!flag && flag.src === src && flag.pages === pages && (flag.preset ?? "custom") === preset;
}

/**
 * File a read chapter as one JournalEntry, then link its pages to the key
 * locations they name. GM-gated like every other commit.
 * @param {{src:string, pages:string, name:string, preset?:string}} req  `preset` is the preset id, or "custom"
 * @param {Array<{key,name,html}>} built  readChapter's pages
 * @returns {Promise<{uuid:string|null, created:number, updated:number, linked:number}>}
 */
export async function commitChapterJournal({ src, pages, name, preset = "custom" }, built) {
  const report = { uuid: null, created: 0, updated: 0, linked: 0 };
  if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.importer.chapter.gmOnly")); return report; }
  const { ensureSuite, ensureSourceFolder, cleanImportHtml, sourceFolderName } = await import("../shared/compendium-suite.mjs");
  const { sourceLabel } = await import("./source-pdf-registry.mjs");
  const pack = (await ensureSuite())?.journal;
  if (!pack) { ui.notifications?.error(t("SDE.importer.chapter.noPack")); return report; }

  const flagOf = (doc) => doc?.getFlag?.(MODULE_ID, CHAPTER_FLAG) ?? null;
  let entry = (await pack.getDocuments()).find((d) => isSameChapter(flagOf(d), { src, pages, preset }));
  entry ??= await JournalEntry.create({
    name, folder: await ensureSourceFolder(pack, sourceLabel(src)),
    flags: { [MODULE_ID]: { [CHAPTER_FLAG]: { src, pages, preset } } },
  }, { pack: pack.collection });

  const mine = new Map(entry.pages.filter((p) => flagOf(p)?.key).map((p) => [flagOf(p).key, p.id]));
  const payload = (pg, i) => ({
    name: pg.name, type: "text", sort: (i + 1) * 100000,
    text: { content: cleanImportHtml(pg.html), format: globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 },
    flags: { [MODULE_ID]: { [CHAPTER_FLAG]: { key: pg.key } } },
  });
  const all = built.map(payload);
  const create = all.filter((p) => !mine.has(p.flags[MODULE_ID][CHAPTER_FLAG].key));
  const update = all.filter((p) => mine.has(p.flags[MODULE_ID][CHAPTER_FLAG].key))
    .map((p) => ({ _id: mine.get(p.flags[MODULE_ID][CHAPTER_FLAG].key), ...p }));
  if (create.length) await entry.createEmbeddedDocuments("JournalEntryPage", create);
  if (update.length) await entry.updateEmbeddedDocuments("JournalEntryPage", update);
  report.created = create.length;
  report.updated = update.length;

  // Fresh from the database: a pack created moments ago hands back an entry
  // instance that never receives its new pages (hex-commit.mjs, 2026-09-17).
  const docs = await pack.getDocuments();
  const fresh = docs.find((d) => d.id === entry.id) ?? entry;
  report.linked = await linkKeyedHexes(fresh, docs, sourceFolderName(sourceLabel(src)));
  report.uuid = fresh.uuid;
  return report;
}

/**
 * Link each chapter page to the key location it names, and back. The hex page
 * linked is the crawl's WORLD copy when it has been deployed (hex-pins.mjs keeps
 * the pack's ids), because that is the page the map pins open — core's "Jump to
 * Pin" then works from it — else the pack page. Both copies get the link back.
 * Only the same book's crawls: another book's "City of Masks" is another place.
 * @param {string} folder  the book's folder name, which the hex import stamps as `source`
 * @returns {Promise<number>} pages linked
 */
async function linkKeyedHexes(entry, docs, folder) {
  const hexPages = docs.filter((d) => d.getFlag(MODULE_ID, HEX_FLAG)?.crawl && d.getFlag(MODULE_ID, HEX_FLAG).source === folder)
    .flatMap((d) => d.pages.filter((p) => p.getFlag(MODULE_ID, HEX_FLAG)?.num));
  const ours = entry.pages.filter((p) => p.getFlag(MODULE_ID, CHAPTER_FLAG));
  let linked = 0;
  for (const [page, hex] of matchKeyedHexes(ours, hexPages)) {
    const world = game.journal?.get(hex.parent.id)?.pages.get(hex.id) ?? null;
    const target = world ?? hex;
    const to = t("SDE.importer.chapter.keyLocation", { link: `@UUID[${target.uuid}]{${escapeHtml(hex.name)}}` });
    const back = t("SDE.importer.chapter.seeAlso", { link: `@UUID[${page.uuid}]{${escapeHtml(page.name)}}` });
    for (const [doc, uuid, paragraph] of [[page, target.uuid, to], [hex, page.uuid, back], [world, page.uuid, back]]) {
      const next = doc && withLink(doc.text?.content, uuid, paragraph);
      if (next && next !== doc.text?.content) await doc.update({ "text.content": next });
    }
    linked++;
  }
  return linked;
}
