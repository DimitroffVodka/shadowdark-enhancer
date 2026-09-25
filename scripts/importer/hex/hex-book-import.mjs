/**
 * Shadowdark Enhancer — a book's key locations in one pass (Foundry-bound).
 *
 * A hexcrawl book prints its keyed locations twice: a summary TABLE per region
 * (number, region, terrain, name — the one-line blurb) and, two pages later,
 * the full write-up of each one under its own "643. ROCK EATERS" heading. The
 * paste box can already take either; this walks a book's whole page map and
 * files both, region by region, so the GM does not repeat fifteen grabs.
 *
 * One JournalEntry per REGION, one page per keyed hex inside it (hex-commit),
 * which is what the existing pins want: a note carries `pageId`, so every keyed
 * hex opens its own write-up and the sidebar stays fifteen lines instead of
 * three hundred.
 *
 * Two extraction modes per region, because the book prints the two halves
 * differently: the summary table is full width and needs ONE column (the
 * two-column gutter split cuts every row in half), the write-ups are two
 * columns and need "auto".
 *
 * Ships ZERO book content — page numbers only (char-content-manifest.mjs), and
 * the text comes out of the GM's own PDF in their own browser.
 */

import { KEY_LOCATION_PAGES, CHAR_SOURCES } from "../char-content/char-content-manifest.mjs";
import { resolveSourcePdf, sourcePdfTarget } from "../source-pdf-registry.mjs";
import { parsePageRange } from "../pdf-text-extract.mjs";
import { hexcrawlRecognizer } from "../tables/hex-parser.mjs";
import { splitSummaryRows } from "./hex-summary.mjs";
import { commitHexDrafts } from "./hex-commit.mjs";

/** One string from `languages/en.json`; the key when no i18n is mounted. */
const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

/** Books this can import key locations from, newest map first. */
export const keyLocationBooks = () => Object.keys(KEY_LOCATION_PAGES);

/**
 * Pure planner: the regions of a book's key-location map, with printed page
 * cites expanded to the pages a reader would open.
 * @param {string} src  source key ("GMWR")
 * @param {(page:number)=>number|null} [pageOf]  printed page → PDF page; the
 *   Foundry caller passes the registry's per-book offset, tests pass identity.
 * @returns {Array<{region:string, hexPages:number[], keyPages:number[]}>}
 */
export function planKeyLocationRegions(src, pageOf = (p) => p) {
  const map = KEY_LOCATION_PAGES[src];
  if (!map) return [];
  const pages = (spec) => parsePageRange(spec).map(pageOf).filter((p) => Number.isInteger(p));
  return Object.entries(map).map(([region, r]) => ({
    region,
    hexPages: pages(r.hexes),
    keyPages: pages(r.keys),
  }));
}

/**
 * Read one region out of the book: its summary rows and its write-up drafts.
 * Split out so the page-mode decision has one home and the loop stays flat.
 * The write-up pass splits columns, so its gutter warnings are surfaced here
 * the way every other grab surfaces them.
 * @returns {Promise<{rows:object[], drafts:object[]}>}
 */
async function readRegion({ extractPdfText, notifyGutterWarnings }, file, { hexPages, keyPages }) {
  const textOf = async (pages, columns) => {
    if (!pages.length) return "";
    const result = await extractPdfText(file, { pages, columns });
    notifyGutterWarnings(result);
    return result.text ?? "";
  };
  const { rows } = splitSummaryRows(await textOf(hexPages, "1"));
  const { claimed } = hexcrawlRecognizer.claim(await textOf(keyPages, "auto"));
  return { rows, drafts: hexcrawlRecognizer.parse(claimed) };
}

/**
 * Import every keyed location of a book. GM-gated like every other commit.
 *
 * A region that throws is reported and the rest still run: one unreadable
 * spread must not cost the other fourteen.
 * @param {string} src  source key ("GMWR")
 * @param {{onRegion?: (region:string, i:number, total:number) => void}} [opts]
 * @returns {Promise<{label:string, regions:Array<{region:string, hexes:number, keyed:number, uuid:string|null}>, hexes:number, keyed:number, failed:Array<{region:string, error:string}>}>}
 */
export async function importKeyLocations(src, { onRegion } = {}) {
  const label = CHAR_SOURCES[src]?.label ?? src;
  const report = { label, regions: [], hexes: 0, keyed: 0, failed: [] };
  if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.importer.hex.book.gmOnly")); return report; }

  const file = resolveSourcePdf(src);
  if (!file) { ui.notifications?.warn(t("SDE.importer.pdf.bookNotLinked")); return report; }

  const pdf = await import("../pdf-text-extract.mjs");
  const plan = planKeyLocationRegions(src, (p) => sourcePdfTarget(src, String(p))?.page ?? null);

  // Fifteen regions, forty-odd pages: warning per page turns one repeated piece
  // of page furniture into a wall of notifications, and a wall of warnings is
  // read as no warning at all. The GM Guide's key spreads all carry the same
  // footnote across the gutter, so they are collected and said ONCE, by cause.
  // A single grab still warns page by page (importer-hub-manage.mjs).
  const gutter = [];
  const collect = (result) => { for (const w of result?.warnings ?? []) gutter.push(w); };

  for (const [i, region] of plan.entries()) {
    onRegion?.(region.region, i + 1, plan.length);
    try {
      const { rows, drafts } = await readRegion({ ...pdf, notifyGutterWarnings: collect }, file, region);
      const res = await commitHexDrafts(drafts, { source: label, crawlTitle: region.region, keyed: rows });
      const hexes = res.created.length + res.updated.length;
      report.regions.push({ region: region.region, hexes, keyed: res.keyed, uuid: res.entryUuid });
      report.hexes += hexes;
      report.keyed += res.keyed;
    } catch (err) {
      console.error(`Shadowdark Enhancer | key locations: ${region.region} failed`, err);
      report.failed.push({ region: region.region, error: String(err?.message ?? err) });
    }
  }
  report.gutter = summariseGutter(gutter);
  if (report.gutter) {
    console.warn(`Shadowdark Enhancer | key locations: text crossed the column gutter`, gutter);
    ui.notifications?.warn(t("SDE.importer.hex.book.gutter", report.gutter));
  }
  return report;
}

/**
 * Many gutter warnings as one sentence: how many pages, what the commonest
 * culprit was, and which pages to look at.
 *
 * Grouped by the word that crossed, because that is the CAUSE — the same
 * footnote on forty pages is one thing to check, not forty.
 * @param {string[]} warnings  raw strings from extractPdfText
 * @returns {{pages:number, what:string, list:string}|null}
 */
export function summariseGutter(warnings) {
  if (!warnings?.length) return null;
  const pages = new Set(), byWord = new Map();
  for (const w of warnings) {
    const page = String(w).match(/^p(\d+)/)?.[1];
    if (page) pages.add(Number(page));
    const word = String(w).match(/\("([^"]*)"\)/)?.[1];
    if (word) byWord.set(word, (byWord.get(word) ?? 0) + 1);
  }
  const top = [...byWord].sort((a, b) => b[1] - a[1])[0];
  const list = [...pages].sort((a, b) => a - b);
  return {
    pages: pages.size || warnings.length,
    what: top ? `"${top[0]}"` : "",
    list: list.slice(0, 8).join(", ") + (list.length > 8 ? "…" : ""),
  };
}
