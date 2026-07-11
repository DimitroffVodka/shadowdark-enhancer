/**
 * Shadowdark Enhancer — shared PDF-text helpers (pure, Foundry-free,
 * node-testable).
 *
 * HTML safety contract (PDF-parser review 2026-07-11 #1): pasted PDF text is
 * PLAIN TEXT. Every parser that wraps pasted text in module markup escapes it
 * first via these helpers — `startsWith("<")` is never a trust decision. A
 * second, Foundry-bound sanitize pass (`cleanImportHtml` in
 * compendium-suite.mjs) runs at the commit choke points as defense in depth
 * for preview-edited HTML.
 */

/** Escape HTML metacharacters so pasted text can be embedded in markup. */
export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Plain pasted text → one `<p>…</p>` paragraph: whitespace collapsed, HTML
 * escaped, never trusted as markup.
 * @param {string} body
 * @returns {string}
 */
export function textToHtml(body) {
  const s = String(body ?? "").replace(/\s+/g, " ").trim();
  return s ? `<p>${escapeHtml(s)}</p>` : "<p></p>";
}
