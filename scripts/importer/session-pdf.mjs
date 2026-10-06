/**
 * Shadowdark Enhancer — session-only source PDFs.
 *
 * A host can refuse a book-sized upload (The Forge allows 50 MB a file on the
 * Game Master plan; the Player's Guide is 145 MB). Nothing needs the book to be
 * on the server: every read happens in this browser. So the GM can hand the
 * importer the file straight from their own computer, and it is kept here, in
 * this page's memory, only until the import is done with it. It is never
 * uploaded and never written to the world — no journal page, no setting, no
 * flag. A reload drops it too.
 *
 * A session book resolves to the pseudo-path `session-pdf:<src>` rather than a
 * URL, so nothing can mistake it for a file on the server (HEAD it, route it,
 * or open it in the PDF viewer, which takes a URL). pdf-text-extract.mjs is the
 * one place that knows how to open that path.
 *
 * No Foundry globals at module level, so Node tests it.
 */

const PREFIX = "session-pdf:";

/** src → the File the GM picked. A File is read from disk on demand, not held in RAM. */
const _files = new Map();

/** Is this resolved path a session book rather than a file on the server? */
export const isSessionPdf = (path) => typeof path === "string" && path.startsWith(PREFIX);

/** The pseudo-path a session book resolves to. */
export const sessionPdfPath = (src) => `${PREFIX}${src}`;

/** Hand the importer a book from this computer for the rest of the session. */
export function useSessionPdf(src, file) {
  _files.set(src, file);
}

/** Has the GM given the importer this book from their computer? */
export const hasSessionPdf = (src) => _files.has(src);

/** The picked File behind a session path, or null once it has been released. */
export const sessionPdfFile = (path) => (isSessionPdf(path) ? _files.get(path.slice(PREFIX.length)) ?? null : null);

/** The picked File for a source (for its name in the library list). */
export const sessionPdfName = (src) => _files.get(src)?.name ?? "";

/** Forget every session book. pdf-text-extract's releaseLocalPdfs() also frees the opened copies. */
export function forgetSessionPdfs() {
  _files.clear();
}

/**
 * Is this world running on The Forge? Its address is forge-vtt.com (or a
 * subdomain), which holds whatever Forge's scripts do, so it is read from the
 * address first and from Forge's own global second.
 */
export function onTheForge(g = globalThis) {
  const host = String(g.location?.hostname ?? "").toLowerCase();
  return host === "forge-vtt.com" || host.endsWith(".forge-vtt.com") || g.ForgeVTT?.usingTheForge === true;
}

/** Per-file upload limit (MB) of the Forge plan a GM is likely on. Higher plans allow more; this is only the warning threshold. */
export const FORGE_UPLOAD_LIMIT_MB = 50;
