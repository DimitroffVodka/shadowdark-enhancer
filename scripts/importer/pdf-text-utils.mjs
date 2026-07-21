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

/**
 * Collapse runs of whitespace (including newlines) to a single space and
 * trim — THE canonical collapse helper (previously duplicated identically
 * across statblock-parser, item-parser, gear-parser, and spell-parser;
 * council remediation item 3). Deliberately simple/unchanged from the prior
 * per-file copies so existing parser output is byte-identical.
 * @param {string} s
 * @returns {string}
 */
export function collapse(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

// Explicit ligature expansions. Deliberately NOT done via NFKC (which we
// avoid globally — see normalizeText below) because NFKC's compatibility
// decomposition also collapses characters we must NOT touch, e.g. it turns
// "½" into "1⁄2" and "³" into "3", which would silently merge a footnote
// marker or fraction into an unrelated numeric string ("12³" → "123").
// NFC leaves those alone; only these specific ligature code points are
// folded, by explicit 1:1 mapping.
const LIGATURES = [
  [/ﬀ/g, "ff"],
  [/ﬁ/g, "fi"],
  [/ﬂ/g, "fl"],
  [/ﬃ/g, "ffi"],
  [/ﬄ/g, "ffl"],
  [/ﬅ/g, "st"],  // ſt long-s ligature
  [/ﬆ/g, "st"],  // st ligature
];

/**
 * Conservative Unicode normalization for pasted PDF text (council
 * remediation item 3/4). Idempotent, and deliberately narrow — it must
 * never erase layout information (newlines, inline hyphenated words) or
 * merge distinct numeric/footnote characters that downstream
 * geometry/gutter-aware extraction, line-based block-splitting, or stat
 * parsing relies on:
 *   - NFC (canonical composition only — NOT NFKC) plus explicit ligature
 *     expansion (ff/fi/fl/ffi/ffl/st) — folds the ligatures a copy-pasted
 *     PDF actually produces without NFKC's broader compatibility
 *     decomposition, which would also mangle fractions/superscripts
 *     ("½" → "1⁄2", "³" → "3", silently merging "12³" into "123").
 *   - Non-breaking spaces (U+00A0) → regular spaces.
 *   - Smart/curly quotes → straight ASCII quotes.
 *   - En/em/figure dashes and the Unicode minus sign (U+2212) → ASCII
 *     hyphen-minus (PDF range dashes like "3–4" become parser-matchable
 *     "3-4"; does not touch legitimate same-line hyphenated words, which
 *     already use ASCII "-").
 * Does NOT dehyphenate across a newline — see dehyphenateWrappedWords()
 * below for that, which is opt-in only (a same-line-agnostic regex like
 * this can't tell "Re-\nentry" apart from a genuine PDF column-wrap, so it
 * must not run unconditionally). Does NOT strip newlines or collapse
 * whitespace itself — callers still run collapse()/splitRawBlocks()
 * afterward for that.
 * @param {string} s
 * @returns {string}
 */
export function normalizeText(s) {
  let out = String(s ?? "").normalize("NFC");
  for (const [re, replacement] of LIGATURES) out = out.replace(re, replacement);
  out = out.replace(/\u00A0/g, " ");
  out = out.replace(/[‘’‚′]/g, "'");
  out = out.replace(/[“”„″]/g, "\"");
  out = out.replace(/[‒–—―−]/g, "-");
  return out;
}

/**
 * OPT-IN dehyphenation for a word wrapped across a newline (a genuine PDF
 * column-wrap artifact: lowercase-hyphen-newline-lowercase → joined word,
 * hyphen dropped). NOT applied by normalizeText()/splitRawBlocks() — a
 * legitimate split compound ("Re-\nentry", "Co-\nop", "Self-\naware") is
 * indistinguishable from a genuine wrap by this heuristic alone, so callers
 * must opt in explicitly, only where they know the input is column-wrapped
 * prose rather than tabular/compound-heavy text. Idempotent.
 * @param {string} s
 * @returns {string}
 */
export function dehyphenateWrappedWords(s) {
  return String(s ?? "").replace(/([a-z])-\n([a-z])/g, "$1$2");
}

/**
 * Split raw pasted text into blank-line-separated blocks — THE canonical
 * block splitter (previously duplicated across dump-segmenter, item-parser,
 * spell-parser, hex-parser, and table-importer; review 2026-07-11
 * maintainability). Newlines are normalized, then a conservative Unicode
 * pass runs (normalizeText — see above) before splitting; each returned
 * element is one block's lines joined by "\n"; blank-only regions never
 * produce blocks.
 * @param {string} rawText
 * @returns {string[]}
 */
export function splitRawBlocks(rawText) {
  const lines = normalizeText(String(rawText ?? "").replace(/\r\n?/g, "\n")).split("\n");
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (cur.length) { blocks.push(cur.join("\n")); cur = []; }
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks;
}
