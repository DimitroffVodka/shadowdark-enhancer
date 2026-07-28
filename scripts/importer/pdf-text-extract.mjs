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
 * We detect the gutter as the emptiest vertical slice of the page's ink
 * (see detectGutter), split into columns, and read each column fully before
 * the next. Verified live against CS1 two-column spell pages.
 *
 * Exports:
 *   extractPdfText(filePath, opts) — { text, warnings,
 *                                      pages: [{page, gutter, lines, warnings, empty}] }
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

/** Sampled x-positions per page used by the ink-coverage profile. */
const COVER_SAMPLES = 200;

/** Ink coverage at or below this share of the busiest slice reads as gutter. */
const GUTTER_LEVEL = 0.20;

/**
 * Ink-coverage profile: how many item BODIES cross each of N sampled x-slices.
 *
 * An item covers every slice its [x, x+width] box overlaps, so a slice's count
 * is "how many lines of text run through this x". Unlike an x-CENTER
 * histogram, a column's ragged right edge stays covered here — the long lines
 * above and below the short one still run through it.
 *
 * @param {Array} its  text items (already filtered to non-empty str)
 * @param {number} W   page width in PDF units
 * @param {number} [n] slice count
 * @returns {{cover:number[], step:number}}
 */
function _coverProfile(its, W, n = COVER_SAMPLES) {
  const step = W / n;
  const cover = new Array(n).fill(0);
  for (const it of its) {
    const x1 = it.transform[4];
    const a = Math.max(0, Math.min(n - 1, Math.floor(x1 / step)));
    const b = Math.max(a, Math.min(n - 1, Math.floor((x1 + (it.width || 0)) / step)));
    for (let s = a; s <= b; s++) cover[s]++;
  }
  return { cover, step };
}

/**
 * Detect a two-column gutter x-position, or null for single column.
 *
 * Reads the INK-COVERAGE profile (above), not an x-center histogram, and takes
 * the widest lightly-inked run in the central 30–70% band.
 *
 * Centers were the original signal and they are ambiguous in a way that fails
 * silently. A column's ragged right edge empties the last few center bins
 * exactly the way a gutter does, so on a page whose left column is short or
 * ragged the widest empty center run lands INSIDE that column and steals its
 * trailing words. CS6 p26 is the reproduction: cut at x=172 (the left column's
 * ragged edge) against a true gutter at ~x=205, moving one trailing word into
 * a right-column bullet — a 25/25 zero-warning parse that stored wrong text.
 * Ink coverage has no such ambiguity: only the gutter is (nearly) ink-free.
 *
 * Checked over all seven Shadowdark books (642 text pages) against an
 * independent gap-voting detector: this agrees on 343 pages where the centre
 * histogram agreed on 210, and splits a page that detector calls single-column
 * 249 times against 364. Those totals flatter neither side — the check itself
 * misreads multi-column TABLES (it votes for a table's own column gap) and
 * two-column spreads whose columns sit on independent baselines. The pages the
 * two still disagree on are nearly all tables, where no split is the right
 * answer and the callers pin "1" or "layout" anyway.
 *
 * @param {Array} its   text items (already filtered to non-empty str)
 * @param {number} W    page width in PDF units
 * @param {"auto"|"1"|"2"|"2mid"|"layout"} mode
 * @returns {number|null} gutter x, or null
 */
function detectGutter(its, W, mode = "auto") {
  if (mode === "1" || mode === "layout") return null;
  // "2mid": split at the page MIDLINE, detection skipped entirely. An opt-in
  // pin for pages whose boundary is known to be the midline; the Downtime
  // spread pins it. It predates the ink-coverage detector below, which now
  // reads those same pages correctly, but the pin stays exact and honoured —
  // a pinned caller asked for the midline, not for our best guess.
  if (mode === "2mid") return W / 2;
  if (its.length < 12) return mode === "2" ? W / 2 : null;

  const { cover, step } = _coverProfile(its, W);
  const NS = cover.length;
  const lo = Math.floor(NS * 0.3);
  const hi = Math.ceil(NS * 0.7);
  let valley = Infinity;
  let peak = 0;
  for (let s = lo; s <= hi; s++) {
    valley = Math.min(valley, cover[s]);
    peak = Math.max(peak, cover[s]);
  }

  // Widest run at or below GUTTER_LEVEL of the busiest slice — NOT the widest
  // run at the exact minimum. A gutter is rarely the emptiest place on the
  // page: full-width headings and rules cross it, while a one-slice sliver of
  // accidental whitespace inside a column is emptier still and would win on a
  // strict minimum (Core p129: a width-1 zero at x=154 beating the real gutter
  // at x=235). Taking a level instead of a minimum merges the gutter's
  // heading-crossed slices into one wide run that outranks any sliver.
  const level = Math.max(valley, Math.round(peak * GUTTER_LEVEL));
  // Ties go to the run nearest the page midline: a two-column gutter is
  // near-centred, and an equally empty run further out is more likely to be a
  // margin, a figure's whitespace, or a table's inter-column gap.
  const midS = (NS - 1) / 2;
  const wins = (r, b) => {
    if (!b) return true;
    const rw = r.end - r.start;
    const bw = b.end - b.start;
    if (rw !== bw) return rw > bw;
    return Math.abs((r.start + r.end) / 2 - midS) < Math.abs((b.start + b.end) / 2 - midS);
  };
  let best = null;
  let run = null;
  for (let s = lo; s <= hi + 1; s++) {
    if (s <= hi && cover[s] <= level) {
      run = run ?? { start: s, end: s };
      run.end = s;
    } else if (run) {
      if (wins(run, best)) best = run;
      run = null;
    }
  }
  const cut = best ? (best.start + best.end) / 2 : lo;
  const splitX = (cut + 0.5) * step;

  if (mode === "2") return splitX;   // forced two-column: trust the cut, no guard

  // auto: accept only if the cut actually behaves like a gutter, or we'd slice
  // a single column of prose down the middle and interleave it. The test is
  // structural rather than a density ratio: count text ROWS the cut divides
  // cleanly (ink both sides, nothing straddling) against rows it cuts THROUGH.
  // A two-column page is nearly all the former; single-column prose is nearly
  // all the latter. A density threshold can't tell them apart here, because on
  // an ink profile the gutter's residual coverage is full-width headings and
  // rules — legitimate on a two-column page, and enough of them to look
  // "dense" (CS1 p10: 7 spanning rows against 12 cleanly split ones).
  // Rows confined to one side count too: plenty of two-column spreads set
  // their columns on independent baselines, so no row holds ink from both and
  // `paired` alone would read them as single-column (Core p44: 23 left-only
  // and 22 right-only rows against exactly one paired row).
  const { paired, crossed, leftOnly, rightOnly } = _rowSplit(its, splitX);
  const separated = paired + Math.min(leftOnly, rightOnly);
  const centers = its.map((i) => i.transform[4] + i.width / 2);
  const leftN = centers.filter((c) => c < splitX).length;
  const rightN = centers.length - leftN;
  const ok = separated >= 3 && separated >= crossed
    && leftN >= 0.25 * centers.length
    && rightN >= 0.25 * centers.length;
  return ok ? splitX : null;
}

/**
 * How a candidate cut divides the page's text rows.
 *
 * `paired` — rows with ink on both sides and nothing crossing: the signature
 * of a gutter. `crossed` — rows an item straddles: the signature of a cut
 * running through body text. `leftOnly`/`rightOnly` — rows confined to one
 * side, which two-column layouts on independent baselines produce instead of
 * paired ones.
 *
 * @param {Array} its
 * @param {number} cut
 * @returns {{paired:number, crossed:number, leftOnly:number, rightOnly:number, rows:number}}
 */
function _rowSplit(its, cut) {
  const rows = new Map();
  for (const i of its) {
    // Quantise the baseline so a row survives the sub-point y jitter of
    // superscripts and mixed font sizes.
    const k = Math.round(i.transform[5] / 4);
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push(i);
  }
  let paired = 0;
  let crossed = 0;
  let leftOnly = 0;
  let rightOnly = 0;
  for (const parts of rows.values()) {
    const l = parts.some((i) => i.transform[4] + (i.width || 0) <= cut);
    const r = parts.some((i) => i.transform[4] >= cut);
    if (parts.some((i) => i.transform[4] < cut && i.transform[4] + (i.width || 0) > cut)) crossed++;
    else if (l && r) paired++;
    else if (l) leftOnly++;
    else if (r) rightOnly++;
  }
  return { paired, crossed, leftOnly, rightOnly, rows: rows.size };
}

/** An item this wide is a full-width element (heading, rule, spread caption)
 *  and is EXPECTED to cross a gutter; anything narrower is body text. */
const FULL_WIDTH_FRAC = 0.25;

/**
 * Risk flags for a chosen gutter, so a silent mis-split becomes a visible one.
 *
 * The CS6 p26 defect scored a perfect parse while storing a wrong word, so the
 * detector fix above ships with a second line of defence: report the cut's
 * geometry when it looks unsafe, and let the paste preview say so.
 *
 * @param {Array} its       text items
 * @param {number} W        page width
 * @param {number|null} splitX  the chosen gutter (null = single column)
 * @returns {string[]} human-readable warnings (empty when the cut looks clean)
 */
function gutterRisks(its, W, splitX) {
  if (splitX == null || !its.length) return [];
  const out = [];
  const wide = W * FULL_WIDTH_FRAC;

  // How many items share each baseline, so we can tell a word inside a LINE of
  // text from page furniture sitting alone on its own row.
  const rowSize = new Map();
  for (const i of its) {
    const k = Math.round(i.transform[5] / 4);
    rowSize.set(k, (rowSize.get(k) ?? 0) + 1);
  }
  /** Body text: narrow enough not to be a full-width element, and part of a
   *  line rather than a lone centred heading, page number or ornament — those
   *  cross a perfectly good gutter all the time and land in one column
   *  harmlessly, so warning about them would only teach the user to ignore
   *  the warning. */
  const isBody = (i) => (i.width || 0) < wide && rowSize.get(Math.round(i.transform[5] / 4)) > 1;

  // A body word whose BOX straddles the cut is a word the split runs through:
  // it lands in one column whole, and it is the wrong one half the time. This
  // is the CS6 p26 signature — at the bad x=172 cut three body words straddle.
  const straddlers = its.filter((i) => {
    const x1 = i.transform[4];
    return isBody(i) && x1 < splitX && x1 + (i.width || 0) > splitX;
  });
  if (straddlers.length) {
    out.push(`gutter at x=${Math.round(splitX)} cuts through ${straddlers.length} `
      + `word${straddlers.length === 1 ? "" : "s"} — one column may have borrowed text from the other`);
  }

  // A body item centred on the cut is a coin-flip assignment even when nothing
  // straddles: a hair's difference in the detected gutter would move it.
  const grazing = Math.max(2, W * 0.01);
  const near = its.filter((i) => isBody(i)
    && Math.abs(i.transform[4] + (i.width || 0) / 2 - splitX) < grazing);
  if (near.length && !straddlers.length) {
    out.push(`gutter at x=${Math.round(splitX)} runs within a glyph of ${near.length} `
      + `item${near.length === 1 ? "" : "s"} — check the column split`);
  }

  // Far off the midline usually means the detector locked onto a margin or a
  // column edge rather than the gutter. Legitimately asymmetric spreads exist,
  // so this is a flag to look, not a rejection.
  const off = Math.abs(splitX - W / 2) / W;
  if (off > 0.15) {
    out.push(`gutter at x=${Math.round(splitX)} sits ${Math.round(off * 100)}% off the page midline`);
  }
  return out;
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

/** True when a PDF item looks like a centered, full-width section title. */
function _isFullWidthHeading(it, W, medianHeight) {
  const text = String(it.str ?? "").trim();
  if (!/^[A-Z][A-Z &/,.'’-]*$/.test(text)) return false;
  if ((text.match(/[A-Z]/g) ?? []).length < 2) return false;
  if (/\b(AC|HP|ATK|MV|AL|LV|DC|ADV|DISADV)\b/.test(text)) return false;
  const x1 = it.transform[4];
  const x2 = x1 + it.width;
  return x1 < W / 2 && x2 > W / 2 && (it.height || 0) >= medianHeight * 1.15;
}

/**
 * Find a full-width lower band on a page whose upper region is two-column.
 * Some bestiary pages switch layout mid-page: two monster columns above, then
 * one full-width monster below. A single page-wide gutter cuts that lower
 * statblock in half. Return the band boundary and the gutter detected from the
 * upper region only, or null when the evidence is insufficient.
 */
function _findFullWidthLowerBand(its, W) {
  if (its.length < 12) return null;
  const heights = its.map((i) => i.height || 0).filter((h) => h > 0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 8;
  const headings = its
    .filter((i) => _isFullWidthHeading(i, W, medianHeight))
    .sort((a, b) => b.transform[5] - a.transform[5]);

  for (const heading of headings) {
    const boundaryY = heading.transform[5] + (heading.height || medianHeight) * 0.5;
    const upper = its.filter((i) => i.transform[5] > boundaryY);
    const lower = its.filter((i) => i.transform[5] <= boundaryY);
    const gutter = detectGutter(upper, W, "auto");
    if (gutter == null) continue;
    // Require at least two lower-band runs (besides the title) to cross the
    // upper gutter. That distinguishes a genuine full-width block from a
    // centered decorative heading followed by ordinary columns.
    const spanning = lower.filter((i) => i !== heading &&
      i.transform[4] < gutter && i.transform[4] + i.width > gutter);
    if (spanning.length >= 2) return { boundaryY, gutter };
  }
  return null;
}

/** Reconstruct reading-order lines from positioned PDF.js text items. */
function layoutPageItems(its, W, mode) {
  if (mode === "auto") {
    const band = _findFullWidthLowerBand(its, W);
    if (band) {
      const upper = its.filter((i) => i.transform[5] > band.boundaryY);
      const lower = its.filter((i) => i.transform[5] <= band.boundaryY);
      const cols = [
        upper.filter((i) => i.transform[4] + i.width / 2 < band.gutter),
        upper.filter((i) => i.transform[4] + i.width / 2 >= band.gutter),
      ];
      return {
        gutter: band.gutter,
        lines: [...cols.flatMap((c) => columnLines(c)), ...columnLines(lower)],
      };
    }
  }

  const gutter = detectGutter(its, W, mode);
  const cols = gutter == null
    ? [its]
    : [
        its.filter((i) => i.transform[4] + i.width / 2 < gutter),
        its.filter((i) => i.transform[4] + i.width / 2 >= gutter),
      ];
  return { gutter, lines: cols.flatMap((c) => columnLines(c, mode === "layout")) };
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
  const { gutter, lines } = layoutPageItems(its, vp.width, mode);
  return {
    gutter: gutter == null ? null : Math.round(gutter),
    lines,
    warnings: gutterRisks(its, vp.width, gutter),
  };
}

/**
 * Extract text from one or more pages of a PDF.
 *
 * @param {string} filePath  served path to the user's PDF (data-relative)
 * @param {object} [opts]
 * @param {number[]} [opts.pages]     1-based PDF page numbers (default: [1])
 * @param {"auto"|"1"|"2"|"2mid"|"layout"} [opts.columns="auto"]  column handling
 * @param {boolean} [opts.cropTablePrefix=false]  drop a leading full-width
 *        price-table block before column detection (shared gear pages)
 * @returns {Promise<{text:string, numPages:number, warnings:string[],
 *   pages: Array<{page:number, gutter:number|null, lines:string[],
 *                 warnings:string[], empty:boolean}>}>}
 *   `warnings` flags a column split that may have moved text between columns —
 *   see gutterRisks. Advisory: the text is still returned.
 */
export async function extractPdfText(filePath, { pages = [1], columns = "auto", cropTablePrefix = false } = {}) {
  const doc = await _openDoc(filePath);
  const wanted = pages
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= doc.numPages)
    .sort((a, b) => a - b);
  const results = [];
  for (const n of wanted) {
    const page = await doc.getPage(n);
    const { gutter, lines, warnings } = await extractPageLines(page, columns, { cropTablePrefix });
    results.push({ page: n, gutter, lines, warnings, empty: lines.length === 0 });
  }
  const text = results.map((r) => r.lines.join("\n")).join("\n\n").trim();
  const warnings = results.flatMap((r) => r.warnings.map((w) => `p${r.page}: ${w}`));
  return { text, numPages: doc.numPages, warnings, pages: results };
}

/**
 * Surface an extraction's column-split warnings to the GM.
 *
 * Every grab path funnels through here so none of them can quietly drop the
 * flags — a warning nobody shows is the same silence this detection exists to
 * break. Advisory only: the text is already in hand either way.
 *
 * Note for pinned callers: "1" and "layout" never detect a gutter, so they
 * never warn; "auto", "2" and "2mid" can.
 *
 * @param {{warnings?:string[]}} result  an extractPdfText result
 */
export function notifyGutterWarnings(result) {
  for (const w of result?.warnings ?? []) {
    ui.notifications?.warn(`Column check — ${w}. Compare the extracted text against the page before importing.`);
  }
}

// Node-testable internals (no Foundry globals at module level).
export const _internals = {
  detectGutter,
  _rowSplit,
  gutterRisks,
  _coverProfile,
  columnLines,
  layoutPageItems,
  _findFullWidthLowerBand,
  _yLineGroups,
  _cropTablePrefix,
  PRICED_ROW_RE,
};

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
