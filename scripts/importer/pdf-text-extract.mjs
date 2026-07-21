/**
 * Shadowdark Enhancer — PDF text extraction.
 *
 * Pulls clean, reading-ordered text out of a PDF using the SAME PDF.js library
 * Foundry already bundles for its native `pdf`-page viewer — no external tool,
 * nothing for players to install, nothing uploaded. This is the programmatic
 * `getTextContent()` API, which the viewer's drag-to-select text layer never
 * exposes: it hands us positioned glyph runs directly, so we can reconstruct
 * lines and columns ourselves instead of fighting a misaligned selection.
 *
 * COPYRIGHT: reads only the user's own locally-uploaded book PDFs (see
 * source-pdf-registry.mjs). This module bundles no book content.
 *
 * The hard case is two-column pages (every Cursed Scroll spell list, etc.).
 * Naive top-to-bottom-by-y ordering interleaves the columns into gibberish.
 * We detect the gutter via a density valley in the item-x-center histogram
 * (robust to the occasional word that bridges the gutter and would collapse a
 * simpler projection-gap test), split into columns, and read each column fully
 * before the next. Verified live against CS1 two-column spell pages.
 *
 * Exports:
 *   extractPdfText(filePath, opts) — { text, pages: [{page, gutter, lines, empty}] }
 *   parsePageRange(spec, max)      — "12", "12-14", "12,16,20-22" → [numbers]
 */

/** Cached ESM import of Foundry's bundled PDF.js (loaded once per session). */
let _pdfjs = null;
/** path → Promise<PDFDocumentProxy>, so a 100 MB book is parsed once per session. */
const _docCache = new Map();

/** Load (and cache) Foundry's bundled PDF.js, wiring its worker. */
async function _lib() {
  if (_pdfjs) return _pdfjs;
  const base = "scripts/pdfjs/build/pdf.mjs";
  const pdfjs = await import(foundry.utils.getRoute(base));
  pdfjs.GlobalWorkerOptions.workerSrc = foundry.utils.getRoute("scripts/pdfjs/build/pdf.worker.mjs");
  _pdfjs = pdfjs;
  return pdfjs;
}

/** Open (and cache) a PDF document for a served file path. */
async function _openDoc(filePath) {
  const route = foundry.utils.getRoute(filePath);
  if (_docCache.has(route)) return _docCache.get(route);
  const p = _lib().then((pdfjs) => pdfjs.getDocument(route).promise);
  _docCache.set(route, p);
  try {
    return await p;
  } catch (err) {
    _docCache.delete(route);   // don't cache a failed open
    throw err;
  }
}

/**
 * Detect a two-column gutter x-position, or null for single column.
 *
 * Bins item x-centers across the page width and looks for a low-density valley
 * in the central band with a populated cluster on either side. A single word
 * straddling the gutter drops one center into the valley bin — not enough to
 * fill it — so this survives the bridging that defeats a projection-gap test.
 *
 * @param {Array} its   text items (already filtered to non-empty str)
 * @param {number} W    page width in PDF units
 * @param {"auto"|"1"|"2"} mode
 * @returns {number|null} gutter x, or null
 */
function detectGutter(its, W, mode = "auto") {
  if (mode === "1" || mode === "layout") return null;
  if (its.length < 12) return mode === "2" ? W / 2 : null;

  const centers = its.map((i) => i.transform[4] + i.width / 2);
  const NB = 50;
  const bins = new Array(NB).fill(0);
  for (const c of centers) {
    const b = Math.min(NB - 1, Math.max(0, Math.floor((c / W) * NB)));
    bins[b]++;
  }
  // Candidate gutter = the WIDEST run of lowest-density bins in the central
  // 30–70% band, split at its middle. A real column gap is several bins wide;
  // taking the first minimum instead picked accidental one-bin gaps inside a
  // column (WR p107 descriptions: x=138 between the bold item-name runs and
  // their continuation lines, vs the true ~210 gutter — beheaded every entry).
  const lo = Math.floor(NB * 0.3);
  const hi = Math.ceil(NB * 0.7);
  let valleyCount = Infinity;
  for (let b = lo; b <= hi; b++) valleyCount = Math.min(valleyCount, bins[b]);
  let best = null;
  let run = null;
  for (let b = lo; b <= hi + 1; b++) {
    if (b <= hi && bins[b] === valleyCount) {
      run = run ?? { start: b, end: b };
      run.end = b;
    } else if (run) {
      if (!best || run.end - run.start > best.end - best.start) best = run;
      run = null;
    }
  }
  const valley = best ? Math.round((best.start + best.end) / 2) : lo;
  const splitX = ((valley + 0.5) / NB) * W;

  if (mode === "2") return splitX;   // forced: trust the valley, no guard

  // auto: only accept if the valley is a real trough between two populated
  // columns — otherwise it's a single column and we'd corrupt the order.
  const leftPeak = Math.max(0, ...bins.slice(0, valley));
  const rightPeak = Math.max(0, ...bins.slice(valley + 1));
  const leftN = centers.filter((c) => c < splitX).length;
  const rightN = centers.length - leftN;
  const ok = valleyCount <= 0.3 * Math.min(leftPeak, rightPeak)
    && leftN >= 0.25 * centers.length
    && rightN >= 0.25 * centers.length;
  return ok ? splitX : null;
}

/** Group one column's items into reading-ordered text lines. */
function columnLines(col, pad = false) {
  // `pad` (layout mode): reconstruct column x-positions as runs of spaces so a
  // multi-column sub-table (e.g. a "d6 Detail 1 Detail 2 Detail 3" prayer
  // generator) survives as 2+-space-delimited columns the layout parser reads,
  // instead of collapsing every gap to one space. A page-average glyph width
  // converts an x-gap to a space count; only gaps wider than a normal word
  // space are padded, so inter-word spacing inside a cell stays single.
  let cw = 5;
  if (pad) {
    const ws = col.map((i) => i.width / Math.max(1, i.str.length)).filter((w) => w > 0);
    if (ws.length) cw = ws.reduce((a, b) => a + b, 0) / ws.length || 5;
  }
  // Top-to-bottom (PDF y grows upward, so descending), then left-to-right.
  const sorted = [...col].sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  );
  const lines = [];
  let cur = null;
  let lastY = null;
  for (const it of sorted) {
    const y = it.transform[5];
    // A y-jump greater than ~half the glyph height starts a new line.
    if (lastY === null || Math.abs(y - lastY) > (it.height || 8) * 0.5) {
      if (cur) lines.push(cur);
      cur = { parts: [{ x: it.transform[4], w: it.width, s: it.str }] };
      lastY = y;
    } else {
      cur.parts.push({ x: it.transform[4], w: it.width, s: it.str });
    }
  }
  if (cur) lines.push(cur);

  return lines.map((ln) => {
    ln.parts.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd = null;
    for (const p of ln.parts) {
      if (prevEnd !== null) {
        const gap = p.x - prevEnd;
        if (pad) {
          // Wide gap (> ~1.8 glyphs) = a column boundary → pad proportionally so
          // char-index tracks x; normal word gaps stay a single space.
          const n = gap > cw * 1.8 ? Math.min(40, Math.max(2, Math.round(gap / cw))) : (gap > 1.5 ? 1 : 0);
          if (n) text += " ".repeat(n);
        } else if (gap > 1.5 && !text.endsWith(" ")) {
          text += " ";
        }
      }
      text += p.s;
      prevEnd = p.x + p.w;
    }
    return text.replace(/\s+$/, "");
  });
}

/** A gear price-table row: "Name … 5 sp 1" — or a wrapped row whose cost
 *  starts the line ("240 gp 1 13 + DEX mod M" under "Chainmail,"). */
const PRICED_ROW_RE = /(?:^|\s)\d+\s*(?:gp|sp|cp)\b/i;

/** Group items into visual lines (columns merged), top→bottom, with y kept. */
function _yLineGroups(its) {
  const sorted = [...its].sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  );
  const groups = [];
  let cur = null;
  let lastY = null;
  for (const it of sorted) {
    const y = it.transform[5];
    if (lastY === null || Math.abs(y - lastY) > (it.height || 8) * 0.5) {
      cur = { y, parts: [] };
      groups.push(cur);
      lastY = y;
    }
    cur.parts.push(it);
  }
  for (const g of groups) {
    g.text = g.parts.sort((a, b) => a.transform[4] - b.transform[4]).map((p) => p.str).join(" ");
  }
  return groups;
}

/**
 * Shared-page crop: a gear page can open with the full-width price table
 * ("Oil, flask 5 sp 1") and continue into two-column descriptions. Those
 * full-width rows drag the gutter valley off-center (verified on WR p107:
 * forced-2 split at x=138 vs the true ~centre gutter), beheading the first
 * description column. Drop every item at or above the table's last priced
 * row so column detection sees only the true two-column region. A page whose
 * top cluster has fewer than 3 contiguous priced rows (i.e. no real table
 * prefix — a plain descriptions page) passes through untouched.
 */
function _cropTablePrefix(its) {
  const groups = _yLineGroups(its);
  let lastPriced = null;
  let count = 0;
  let dry = 0;
  for (const g of groups) {
    if (PRICED_ROW_RE.test(g.text)) { lastPriced = g.y; count++; dry = 0; }
    else if (count && ++dry >= 2) break;   // two non-priced lines = table over
  }
  if (count < 3 || lastPriced == null) return its;
  return its.filter((i) => i.transform[5] < lastPriced - ((i.height || 8) * 0.5));
}

/** Extract one already-loaded page to an ordered array of text lines. */
async function extractPageLines(page, mode, { cropTablePrefix = false } = {}) {
  // Force rotation:0 so page width matches the text items' coordinate space.
  // getTextContent() returns item transforms in UNROTATED page space, but a
  // viewport's default width reflects the page's /Rotate (e.g. a Rotate-90 page
  // reports 595 instead of 419) — that swap would corrupt gutter detection on
  // rotated pages (the "Horizontal Pages" printings of some Cursed Scrolls
  // rotate their map/spread pages). Pinning rotation:0 keeps both in sync.
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  const tc = await page.getTextContent();
  let its = tc.items.filter((i) => i.str && i.str.trim().length);
  if (cropTablePrefix) its = _cropTablePrefix(its);
  const gutter = detectGutter(its, vp.width, mode);
  // Assign each item to a column by its CENTER (robust to the gutter estimate
  // being off-center within the true gap). Reading order: whole left column,
  // then whole right column. NOTE: a full-width banner/header that sits between
  // two-column content (e.g. a "BASILISK CULTISTS" section banner) folds onto
  // the end of a column here and can be mis-read as the preceding block's
  // feature — an attempted horizontal-banding fix was reverted because the
  // gutter estimate isn't precise enough to place band separators without
  // corrupting normal pages. The preview's row-level review flag catches those.
  const cols = gutter == null
    ? [its]
    : [
        its.filter((i) => i.transform[4] + i.width / 2 < gutter),
        its.filter((i) => i.transform[4] + i.width / 2 >= gutter),
      ];
  const lines = cols.flatMap((c) => columnLines(c, mode === "layout"));
  return { gutter: gutter == null ? null : Math.round(gutter), lines };
}

/**
 * Extract text from one or more pages of a PDF.
 *
 * @param {string} filePath  served path to the user's PDF (data-relative)
 * @param {object} [opts]
 * @param {number[]} [opts.pages]     1-based PDF page numbers (default: [1])
 * @param {"auto"|"1"|"2"} [opts.columns="auto"]  column handling
 * @param {boolean} [opts.cropTablePrefix=false]  drop a leading full-width
 *        price-table block before column detection (shared gear pages)
 * @returns {Promise<{text:string, numPages:number,
 *   pages: Array<{page:number, gutter:number|null, lines:string[], empty:boolean}>}>}
 */
export async function extractPdfText(filePath, { pages = [1], columns = "auto", cropTablePrefix = false } = {}) {
  const doc = await _openDoc(filePath);
  const wanted = pages
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= doc.numPages)
    .sort((a, b) => a - b);
  const results = [];
  for (const n of wanted) {
    const page = await doc.getPage(n);
    const { gutter, lines } = await extractPageLines(page, columns, { cropTablePrefix });
    results.push({ page: n, gutter, lines, empty: lines.length === 0 });
  }
  const text = results.map((r) => r.lines.join("\n")).join("\n\n").trim();
  return { text, numPages: doc.numPages, pages: results };
}

// Node-testable internals (no Foundry globals at module level).
export const _internals = { detectGutter, columnLines, _yLineGroups, _cropTablePrefix, PRICED_ROW_RE };

/**
 * Parse a page-range spec into a sorted, de-duped list of page numbers.
 * Accepts "12", "12-14", "12,16,20-22" (spaces ignored). Clamps to [1, max].
 * @param {string} spec
 * @param {number} max  document page count (0 = no upper clamp)
 * @returns {number[]}
 */
export function parsePageRange(spec, max = 0) {
  const out = new Set();
  for (const part of String(spec ?? "").split(",")) {
    const s = part.trim();
    if (!s) continue;
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      if (a > b) [a, b] = [b, a];
      for (let n = a; n <= b; n++) out.add(n);
    } else if (/^\d+$/.test(s)) {
      out.add(Number(s));
    }
  }
  let list = [...out].filter((n) => n >= 1);
  if (max > 0) list = list.filter((n) => n <= max);
  return list.sort((a, b) => a - b);
}
