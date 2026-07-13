/**
 * Shadowdark Enhancer — Source PDF Registry.
 *
 * Maps each content source (Western Reaches, Cursed Scroll 1–6, Core) to the
 * user's own uploaded PDF of that book, so the Importer Hub can deep-link the
 * paste box straight to the page a section lives on.
 *
 * The mapping is backed by a JournalEntry ("Shadowdark Source PDFs"): one
 * native `pdf`-type page per book, tagged with a `sourceKey` flag. That gives
 * the user a visible, double-clickable library AND a durable record we resolve
 * links from. `SOURCE_PDFS` in char-content-manifest.mjs remains a static
 * fallback (pre-seeded defaults) for anything the journal doesn't cover.
 *
 * COPYRIGHT: the PDFs are the user's own local uploads — this module bundles no
 * book content and ships no files. It only records where the user put them.
 *
 * Exports:
 *   sourcePdfHref(src, pages)   — viewer.html?file=…#page=N, or null
 *   resolveSourcePdf(src)       — the file path for a source, or null
 *   listSourcePdfs()            — async; one row per known source with origin
 *                                 (journal upload vs static fallback) + verified
 *                                 link status (fallback paths are HEAD-checked)
 *   uploadSourcePdf(src, file)  — upload a File and register it for a source
 *   registerSourcePdf(src, path)— link an already-uploaded path to a source
 *   ensureLibraryJournal()      — find/create the library JournalEntry
 */
import { MODULE_ID } from "../module-id.mjs";
import { CHAR_SOURCES, SOURCE_PDFS } from "./char-content-manifest.mjs";

const JOURNAL_NAME = "Shadowdark Source PDFs";
const LIB_FLAG = "sourcePdfLibrary";   // marks the library JournalEntry
const KEY_FLAG = "sourceKey";          // marks a page as belonging to a source

/**
 * Book-page → PDF-page offset per source. A cite records the PRINTED page a
 * section lives on, but the PDF's front matter (covers, credits, ToC) shifts
 * the file's page count ahead of the printed numbers. The Core Rulebook PDF
 * runs +4 (printed page 92 is PDF page 96). Sources not listed are 1:1.
 */
const PAGE_OFFSETS = { CORE: 4 };

/**
 * Western Reaches class-TITLES page per class. Titles live in a separate
 * appendix (book pg 82-89), NOT on the class writeup page — so the Class
 * Importer's "Open PDF · titles" button jumps straight to the right table.
 * Extracted from the WR PDF's "<CLASS> TITLES" headings (WR is 1:1 book↔PDF).
 */
export const WR_TITLE_PAGES = {
  "Bard": 82, "Basilisk Warrior": 82, "Delver": 82,
  "Desert Rider": 83, "Duelist": 83, "Green Knight": 83,
  "Knight of St. Ydris": 84, "Kyzian Archer": 84, "Monk of Yag-Kesh": 84,
  "Necromancer": 85, "Paladin": 85,
  "Pit Fighter": 86,
  "Ranger": 87, "Ras-Godai": 87, "Roustabout": 87,
  "Sea Wolf": 88, "Seer": 88, "Warlock": 88,
  "Witch": 89, "Wyrdling": 89,
};

/** The WR titles-appendix page for a class name (case/space-insensitive), or null. */
export function titlePageFor(className) {
  const want = String(className ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const [name, page] of Object.entries(WR_TITLE_PAGES))
    if (name.toLowerCase() === want) return page;
  return null;
}

/** Per-world upload target — packaged module dirs are read-only. */
function uploadDir() {
  return `worlds/${game.world.id}/source-pdfs`;
}

/** The active v13+ FilePicker implementation (falls back to the classic global). */
function filePicker() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

/** First page number in a "72" / "72-73" / "p146" cite, or null. */
function firstPage(pages) {
  const m = String(pages ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** The library JournalEntry, or null if it doesn't exist yet. */
export function findLibraryJournal() {
  return game.journal?.find((j) => j.getFlag(MODULE_ID, LIB_FLAG))
    ?? game.journal?.getName(JOURNAL_NAME)
    ?? null;
}

/** The library JournalEntry, creating it (flagged) if absent. */
export async function ensureLibraryJournal() {
  const existing = findLibraryJournal();
  if (existing) return existing;
  return JournalEntry.create({
    name: JOURNAL_NAME,
    flags: { [MODULE_ID]: { [LIB_FLAG]: true } },
  });
}

/**
 * The uploaded PDF path for a source: the journal's flagged pdf page first,
 * then the static SOURCE_PDFS default. Null when neither exists.
 * @param {string} src CHAR_SOURCES key (e.g. "WR")
 * @returns {string|null}
 */
export function resolveSourcePdf(src) {
  const j = findLibraryJournal();
  if (j) {
    for (const p of j.pages) {
      if (p.type === "pdf" && p.src && p.getFlag(MODULE_ID, KEY_FLAG) === src) return p.src;
    }
  }
  return SOURCE_PDFS[src] ?? null;
}

/**
 * Deep-link into Foundry's core PDF.js viewer for a source's uploaded PDF,
 * opened at the cited page: `viewer.html?file=<route>#page=N`. Returns null
 * when the source has no resolvable PDF or the entry carries no page cite.
 */
export function sourcePdfHref(src, pages) {
  const file = resolveSourcePdf(src);
  const page = firstPage(pages);
  if (!file || !page) return null;
  // Shift the printed cite to the PDF's own page numbering (see PAGE_OFFSETS).
  const pdfPage = page + (PAGE_OFFSETS[src] ?? 0);
  const viewer = foundry.utils.getRoute("scripts/pdfjs/web/viewer.html");
  return `${viewer}?file=${encodeURIComponent(foundry.utils.getRoute(file))}#page=${pdfPage}`;
}

/**
 * Resolve a source + printed-page cite to the actual PDF file and its own page
 * number (offset-corrected — see PAGE_OFFSETS). Feeds the Importer Hub's
 * "Grab text" extractor. Returns null when the source has no resolvable PDF or
 * the cite carries no page number.
 * @param {string} src   CHAR_SOURCES key (e.g. "WR")
 * @param {string|number} pages  a page cite ("72", "72-73", "p146")
 * @returns {{file:string, page:number}|null}
 */
export function sourcePdfTarget(src, pages) {
  const file = resolveSourcePdf(src);
  const page = firstPage(pages);
  if (!file || !page) return null;
  return { file, page: page + (PAGE_OFFSETS[src] ?? 0) };
}

/** Does a served file actually exist? HEAD against its route; false on any error. */
async function _fileExists(path) {
  try {
    const r = await fetch(foundry.utils.getRoute(path), { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * One row per known source, with its current link status — for the manager UI.
 * `origin` distinguishes a verified journal UPLOAD from the static FALLBACK
 * path: fallbacks are deployment-local (never bundled), so on a clean install
 * they can point at nothing — each is HEAD-verified before being reported as
 * linked, instead of trusting the configured path. (review 2026-07-12 #5)
 * @returns {Promise<Array<{src,label,book,file,origin,linked}>>}
 *   origin: "journal" (uploaded + registered) | "fallback" (static default) | null
 */
export async function listSourcePdfs() {
  const j = findLibraryJournal();
  const rows = [];
  for (const [src, meta] of Object.entries(CHAR_SOURCES)) {
    const page = j?.pages.find((p) => p.type === "pdf" && p.src && p.getFlag(MODULE_ID, KEY_FLAG) === src);
    const file = page?.src ?? SOURCE_PDFS[src] ?? null;
    const origin = page ? "journal" : (SOURCE_PDFS[src] ? "fallback" : null);
    // Journal registrations were verified at upload time; fallbacks are checked live.
    const linked = origin === "journal" ? true
      : origin === "fallback" ? await _fileExists(file)
      : false;
    rows.push({ src, label: meta.label, book: meta.book, file, origin, linked });
  }
  return rows;
}

/** Create/update the library's pdf page for a source, pointing at `filePath`. */
export async function registerSourcePdf(src, filePath) {
  const journal = await ensureLibraryJournal();
  const label = CHAR_SOURCES[src]?.label ?? src;
  const existing = journal.pages.find((p) => p.getFlag(MODULE_ID, KEY_FLAG) === src);
  if (existing) {
    await existing.update({ src: filePath, name: label });
    return existing;
  }
  const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
    name: label,
    type: "pdf",
    src: filePath,
    flags: { [MODULE_ID]: { [KEY_FLAG]: src } },
  }]);
  return page;
}

/**
 * Upload a user-picked PDF File to the per-world source-pdfs folder and link it
 * to `src` in the library journal. Returns the stored path.
 * @param {string} src  CHAR_SOURCES key
 * @param {File} file   the picked PDF
 * @returns {Promise<string>} stored path
 */
export async function uploadSourcePdf(src, file) {
  const dir = uploadDir();
  const FP = filePicker();
  try { await FP.createDirectory("data", dir); } catch (_e) { /* already exists */ }
  const result = await FP.upload("data", dir, file, {}, { notify: false });
  const path = result?.path ?? `${dir}/${file.name}`;
  await registerSourcePdf(src, path);
  return path;
}
