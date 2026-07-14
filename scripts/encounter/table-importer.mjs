/**
 * Shadowdark Enhancer — Roll Table Importer (parser data layer)
 *
 * Pure text→structure parser for tables copied out of Shadowdark books
 * and zines. No Foundry deps in the parse path (node-testable); the only
 * Foundry call lives in `createTable` (added in a later task), invoked
 * from the Encounter Roller's Import tab after the GM reviews/edits the
 * parsed preview.
 *
 * Mirrors the EncounterBuild data-layer shape (pure functions + a thin
 * save path) so it can be unit-tested via `node --test`.
 *
 * ParsedTable shape:
 *   {
 *     name:        string,   // from a title line, else "" (GM fills in)
 *     formula:     string,   // "1d100", inferred from dN header / max range
 *     replacement: boolean,  // default true
 *     bestEffort:  boolean,  // true for auto-split multi-column tables (later task)
 *     rows:        Array<{ min: number, max: number, text: string }>,
 *     warnings:    string[], // non-blocking gap/overlap/formula notes
 *   }
 */

// A leading die token: "N" or "N-M" (hyphen or en/em dash), zero-padding
// allowed. The (?=\s|$) lookahead means "2d6" does NOT match (after the
// "2" comes "d", not whitespace) — so embedded dice in result text are
// never mistaken for a row token.
import { classify, labelFor, CUSTOM_ID } from "./table-categories.mjs";
import { splitRawBlocks } from "./pdf-text-utils.mjs";

// Trailing "+" (e.g. "14+" = the top row of a d14 table) is accepted and
// treated as the plain number — the shape's size caps the die, so "14+" is row 14.
const LEADING_RANGE = /^\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\+?(?=\s|$)/;

// A "dN ..." / "NdM ..." header line. An optional leading count (2d6, 3d12)
// is captured so a bell-curve or generator die spec headers a table with its
// real formula instead of the parser guessing "1d<max-row>" — which used to
// swallow a stray page number ("Freya Boons 208" → 1d208). Trailing words (if
// any) are candidate column labels — used by the Tier-2 matrix path.
const DIE_HEADER = /^(\d{0,2})d(\d{1,3})\b\s*(.*)$/i;

/** Parse a leading die token. Returns {min,max,rest} or null. "00" is the d100
 *  convention for 100 (e.g. "99-00" = 99–100), so it maps to 100, not 0. */
function parseLeadingRange(line) {
  const m = LEADING_RANGE.exec(line);
  if (!m) return null;
  const toN = (v) => (v === "00" ? 100 : Number(v));
  const min = toN(m[1]);
  const max = m[2] != null ? toN(m[2]) : min;
  const rest = line.slice(m[0].length).trim();
  return { min, max, rest };
}

/** Parse a "dN Col Col Col" / "NdM Col…" header.
 *  Returns {count,size,columns,remainder} or null. `count` defaults to 1. */
function parseDieHeader(line) {
  const m = DIE_HEADER.exec(String(line).trim());
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const size = Number(m[2]);
  const remainder = (m[3] ?? "").trim();
  // A remainder ending in "…" / "..." is a SINGLE truncated column label
  // ("Played For…", "Rolled…") — not multiple columns. Real multi-column
  // headers list distinct short labels (Outcome Benefit, Cost Event Bonus).
  // Splitting it on spaces made a 1-column d4 like Wizards & Thieves' stakes
  // ("d4 Played For…") look like a 2-col matrix and truncated every row.
  const columns = !remainder
    ? []
    : /(\.\.\.|…)$/.test(remainder)
      ? [remainder]
      : remainder.split(/\s+/).filter(Boolean);
  return { count, size, columns, remainder };
}

/** Split raw paste text into blocks on blank lines (line-array shape —
 * delegates to the shared splitter in pdf-text-utils). */
function splitBlocks(text) {
  return splitRawBlocks(text).map((b) => b.split("\n"));
}

/** Non-blocking warnings: gaps, overlaps, formula/max-range mismatch. */
function computeWarnings(pt) {
  const warnings = [];
  const sizeMatch = /^\s*(\d*)d(\d{1,3})/i.exec(pt.formula ?? "");
  const count = sizeMatch && sizeMatch[1] ? Number(sizeMatch[1]) : 1;
  const size = sizeMatch ? Number(sizeMatch[2]) : null;
  const maxRange = (pt.rows ?? []).reduce((m, r) => Math.max(m, r.max), 0);

  // Overlap is always meaningful.
  for (let i = 0; i < pt.rows.length; i++) {
    for (let j = i + 1; j < pt.rows.length; j++) {
      const a = pt.rows[i], b = pt.rows[j];
      if (a.max >= b.min && a.min <= b.max) {
        warnings.push(`Rows ${i + 1} and ${j + 1} overlap.`);
      }
    }
  }
  // Flat-die range/gap checks only apply to a uniform 1dN table. An NdM spec
  // (2d6, 3d12) is a bell curve whose rows run min..count*size and aren't one
  // row per face, so those checks would fire spuriously — skip them.
  if (count <= 1) {
    if (size != null && maxRange > size) {
      warnings.push(`Rows reach ${maxRange} but formula is ${pt.formula}.`);
    }
    const top = size ?? maxRange;
    for (let face = 1; face <= top; face++) {
      if (!pt.rows.some(r => face >= r.min && face <= r.max)) {
        warnings.push(`Value ${face} has no row.`);
      }
    }
  }
  return warnings;
}

/**
 * Repair shared-start range typos before warnings run. When a row's low bound
 * equals the PREVIOUS row's low bound and its high bound is greater — e.g.
 * "21-22" then "21-24", where the Western Reaches Dwarf Trinket table means
 * "23-24" — the second row's low almost certainly should be prev.max + 1. This
 * is the common single-digit source/OCR typo. The fix shifts ONLY the low bound
 * (never the high), so it can't create a new overlap or gap and downstream
 * tiling is unchanged, and it's recorded as an `Auto-fixed:` note — never
 * silent. Genuine ambiguous overlaps (different starts, partial, or a row fully
 * inside another) are left untouched for computeWarnings to flag.
 * @param {Array<{min:number,max:number}>} rows  mutated in place
 * @returns {string[]} Auto-fixed messages
 */
function repairSharedStartRanges(rows) {
  const notes = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    if (cur.min === prev.min && cur.max > prev.max) {
      const was = `${cur.min}-${cur.max}`;
      cur.min = prev.max + 1;
      notes.push(`Auto-fixed: row ${i + 1} range ${was} → ${cur.min}-${cur.max} (shared start with row ${i}).`);
    }
  }
  return notes;
}

// Standard die faces a table can legitimately reach. A top row landing on one
// of these (notably d100) is never treated as a stray page number, so real
// dice tables are untouched.
const PLAUSIBLE_DIE_MAX = new Set([2, 3, 4, 6, 8, 10, 12, 20, 30, 36, 66, 100]);

/**
 * Drop a stray "page-number" row that inflates the inferred die. In a shapeless
 * multi-column generator (Renown/Secret/Wealth, the magic-item generator
 * columns, Item Flaw/Virtue…), the source page number is extracted as a lone
 * high leading-range row far above the table's real coverage — producing a
 * bogus formula like `1d284` (p284) and a flood of "Value N has no row"
 * warnings. When the single highest row value is an isolated, above-die-range
 * outlier — more than double the next-highest row's max AND at least 50 above
 * it, over a dense body of ≥3 other rows, and not itself a standard die face —
 * it is almost certainly the page cite: drop it and record a visible note.
 * The outlier MUST be a SINGLETON row (min === max): a page cite is a lone
 * number, never a span, so a legitimate wide range row like "81-200" is left
 * intact (guarding the data-loss case the Codex review caught). Real dN tables
 * tile densely up to a standard face, so they never trip this; the ≤100 /
 * standard-face guard additionally protects legitimate d100 tables.
 * (Deliberately conservative: a page number below 100 is indistinguishable from
 * a real row and is left alone — bug #2 in the PDF-import review §07.)
 * @param {Array<{min:number,max:number,text:string}>} rows mutated in place
 * @returns {string[]} notes (never silent)
 */
function dropStrayPageNumber(rows, { dieMax = null } = {}) {
  const notes = [];
  // With a KNOWN die header the bounds are authoritative: any SINGLETON row
  // beyond them is a page cite or a neighbouring table's row (CS2 Enduring
  // Wounds' dead 26-26 on a d20 — E2E D4). Spans are never touched.
  if (dieMax) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.min === r.max && r.min > dieMax) {
        rows.splice(i, 1);
        const snip = String(r.text ?? "").trim().slice(0, 30);
        notes.push(`Dropped out-of-bounds row ${r.min}${snip ? ` ("${snip}")` : ""} — the die header caps this table at ${dieMax}.`);
      }
    }
  }
  if (rows.length < 4) return notes;
  const byMax = [...rows].sort((a, b) => a.max - b.max);
  const top = byMax[byMax.length - 1];
  const second = byMax[byMax.length - 2];
  const V = top.max, S = second.max;
  if (top.min !== top.max) return notes;   // a page cite is a lone value, not a span
  if (V <= 100 || PLAUSIBLE_DIE_MAX.has(V)) return notes;
  if (!(V > 2 * S && V - S >= 50)) return notes;
  rows.splice(rows.indexOf(top), 1);
  const snip = String(top.text ?? "").trim().slice(0, 30);
  notes.push(`Dropped probable page-number row ${V}${snip ? ` ("${snip}")` : ""} — far above the table's ${S}-value coverage; formula reset from 1d${V}.`);
  return notes;
}

/**
 * Strip seed/header/footer noise from a seeded unlock's paste BEFORE the
 * generic parse: the seed line the unlock wrote into the box, the printed
 * table caption, "dN Details"-style headers, and bare page-footer numbers —
 * all of which otherwise become DATA rows (E2E D4: Arctic Sea rows 1-3 were
 * the seed line, the d100 header, and the caption).
 */
export function stripSeedNoise(text, { name = "", pages = "", size = 100 } = {}) {
  const strip = (s) => String(s).toUpperCase().replace(/\s+/g, " ").trim();
  // A tree entry name may embed its rep prefix ("Cursed Scroll 3 p26: Arctic
  // Sea Encounters") while the page caption prints only the bare name.
  const bare = String(name).replace(/^.*?\bp\.?\s?\d{1,3}\s*:\s*/i, "");
  const wants = new Set([strip(name), strip(bare)].filter(Boolean));
  const footers = new Set(String(pages).split(/[-,]/).map((p) => p.trim()).filter(Boolean));
  const isHdr = (l) => /^\d{0,2}d\d{1,3}\b/i.test(l) && /\b(details?|results?|effects?|outcomes?)\b/i.test(l);
  const out = [];
  let dropped = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.trim();
    if (l && (wants.has(strip(l)) || isHdr(l) || (/^\d{1,3}$/.test(l) && (footers.has(l) || Number(l) > size)))) { dropped++; continue; }
    out.push(raw);
  }
  return { text: out.join("\n"), dropped };
}

/** Build a single-die ParsedTable from a block's data lines. */
function parseSingleDieBlock(title, die, dataLines) {
  const rows = [];
  const preRow = [];
  const anyToken = dataLines.some(l => parseLeadingRange(l));

  if (anyToken) {
    for (const line of dataLines) {
      const r = parseLeadingRange(line);
      if (r) {
        rows.push({ min: r.min, max: r.max, text: r.rest });
      } else if (rows.length) {
        const prev = rows[rows.length - 1];
        prev.text = `${prev.text} ${line.trim()}`.trim();
      } else {
        // Text before the first row is usually a usage instruction ("Roll
        // once each morning") — keep it as the table description instead of
        // silently discarding it (review #10).
        preRow.push(line.trim());
      }
    }
  } else {
    dataLines.forEach((line, i) => {
      rows.push({ min: i + 1, max: i + 1, text: line.trim() });
    });
  }

  // Drop rows left with no text after continuation-merging — a page number,
  // header, or other single-token extraction artifact lands as an empty range
  // row (e.g. a bare "19" page number → [19,19] with no description, which then
  // false-overlaps a real row). A real single-die result always carries text.
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!String(rows[i].text ?? "").trim()) rows.splice(i, 1);
  }

  // Drop a stray page-number row. Without a dN header it otherwise headlines the
  // table as 1d<page> (e.g. 1d284) and floods the coverage check; WITH a header
  // (e.g. a section-sliced "d20 Type" table that swept in its page footer) it
  // adds a phantom face-290 row and a false overlap. The drop's own guards
  // (>100, singleton, isolated outlier) make it safe to run in both cases.
  const strayNotes = dropStrayPageNumber(rows, { dieMax: die ? Math.max(1, die.count ?? 1) * die.size : null });

  // Multi-column prose table (e.g. Carousing Outcome's "d14 Outcome Benefit"):
  // the header carries ≥2 column labels but the block isn't a single-word-cell
  // matrix. Keep ONE table and delimit each row's cells with " | " (user pref —
  // no per-column split). A typed "|" always wins; otherwise the capital-letter
  // boundary split applies. Majority rule: only rewrite when ≥60% of rows split
  // cleanly into the column count, so prose rows under a multi-word TITLE
  // ("d6 Probe Encounters") are never mangled.
  let joinedColumns = false;
  if (die && die.columns.length >= 2 && rows.length) {
    const n = die.columns.length;
    const cellsFor = (text) => {
      if (String(text).includes("|")) {
        const c = String(text).split("|").map(s => s.trim()).filter(Boolean);
        return c.length >= 2 ? c : null;
      }
      return splitByCapitals(text, n);
    };
    const split = rows.map(r => cellsFor(r.text));
    const clean = split.filter(Boolean).length;
    if (clean / rows.length >= 0.6) {
      rows.forEach((r, i) => { if (split[i]) r.text = split[i].join(" | "); });
      joinedColumns = true;
    }
  }

  const maxRange = rows.reduce((m, r) => Math.max(m, r.max), 0);
  // With no separate title line, a dN header's trailing text is the table
  // name (e.g. "d100 Details" → "Details"). Matrix column-label use of the
  // remainder is handled on the Tier-2 path (later task), not here.
  const name = title || (die && !joinedColumns ? die.remainder : "");
  const pt = {
    name: name || "",
    formula: die ? `${die.count > 1 ? die.count : 1}d${die.size}` : `1d${Math.max(1, maxRange)}`,
    replacement: true,
    bestEffort: false,
    category: classify(name),
    customLabel: "",
    ...(preRow.length
      ? { description: preRow.join(" ") }
      : (joinedColumns ? { description: `Columns: ${die.columns.join(" | ")}` } : {})),
    rows,
    warnings: [],
  };
  // Repair shared-start range typos (mutates pt.rows) before the coverage/overlap
  // pass, so the fixed ranges tile cleanly and the Auto-fixed notes lead the list.
  const autoFixes = repairSharedStartRanges(pt.rows);
  pt.warnings = computeWarnings(pt);
  if (autoFixes.length) pt.warnings.unshift(...autoFixes);
  if (strayNotes.length) pt.warnings.unshift(...strayNotes);
  if (preRow.length) {
    pt.warnings.push(`Pre-row text kept as table description: "${preRow.join(" ")}"`);
  }
  return pt;
}

/**
 * Split "cell cell cell" on a capital-word boundary: a new cell begins at
 * token 0 and at every later token that starts with an uppercase letter
 * ("Loose debris Icy water Exhausting runes" → 3 cells). Conservative — only
 * returns cells when the boundary count is EXACTLY n, so a stray internal
 * capital (proper noun) falls back to the caller's other heuristics instead of
 * mis-splitting. Null when it can't line up. (User obs.: new columns capitalise.)
 */
function splitByCapitals(rest, n) {
  const toks = String(rest).trim().split(/\s+/).filter(Boolean);
  if (toks.length < n) return null;
  const starts = [0];
  for (let i = 1; i < toks.length; i++) if (/^[A-Z]/.test(toks[i])) starts.push(i);
  if (starts.length !== n) return null;
  const cells = [];
  for (let s = 0; s < starts.length; s++) {
    cells.push(toks.slice(starts[s], starts[s + 1] ?? toks.length).join(" "));
  }
  return cells;
}

/**
 * Split a row's result text into exactly n cells. Column detection, in order:
 *   1. an explicit "|" delimiter (user pref for multi-column tables),
 *   2. tab / 2+ spaces (aligned PDF columns),
 *   3. one word per column (single-token cells),
 *   4. a capital-letter boundary (multi-word cells; see splitByCapitals),
 *   5. else surplus tokens fold into the last cell.
 */
function splitCells(rest, n) {
  const s = String(rest);
  const pad = (cells) => { const c = cells.slice(0, n); while (c.length < n) c.push(""); return c; };
  if (s.includes("|")) return pad(s.split("|").map((x) => x.trim()));
  const byDelim = s.split(/\t+|\s{2,}/).map((x) => x.trim()).filter(Boolean);
  if (byDelim.length === n) return byDelim;
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === n) return tokens;
  const byCaps = splitByCapitals(s, n);
  if (byCaps) return byCaps;
  if (tokens.length < n) return pad(tokens);
  const cells = [];
  for (let i = 0; i < n - 1; i++) cells.push(tokens[i]);
  cells.push(tokens.slice(n - 1).join(" "));
  return cells;
}

/** Build N best-effort ParsedTables from a multi-column block. */
function parseMatrixBlock(title, die, dataLines) {
  const n = die.columns.length;
  const tables = die.columns.map((label, ci) => {
    const tname = [title, label].filter(Boolean).join(" — ") || label || `Column ${ci + 1}`;
    return {
      name: tname,
      formula: `1d${die.size}`,
      replacement: true,
      bestEffort: true,
      category: classify(tname),
      customLabel: "",
      rows: [],
      warnings: [],
    };
  });

  for (const line of dataLines) {
    const r = parseLeadingRange(line);
    if (!r) continue; // matrix rows must lead with a die value
    const cells = splitCells(r.rest, n);
    for (let ci = 0; ci < n; ci++) {
      tables[ci].rows.push({ min: r.min, max: r.max, text: cells[ci] ?? "" });
    }
  }

  for (const t of tables) t.warnings = computeWarnings(t);
  return tables;
}

/**
 * Decide whether a dN-headed block is a multi-column matrix rather than a
 * single-die table with a multi-word title. A matrix is grid-like: a
 * sufficient fraction of its data rows have a cell-token count equal to the
 * column count. Titled prose tables (e.g. "d6 Probe Encounters" whose rows
 * are sentences) have token counts that rarely match, so they fall through
 * to the single-die path.
 */
function looksLikeMatrix(die, dataLines) {
  // A matrix is a single-die "dN Col Col …" grid. An NdM header (2d6, 3d12) is
  // a bell-curve/generator spec whose trailing words are the title, not column
  // labels — never a per-column pick-one matrix.
  if (!die || (die.count ?? 1) > 1 || die.columns.length < 2) return false;
  const n = die.columns.length;
  let total = 0;
  let exact = 0;
  for (const line of dataLines) {
    const r = parseLeadingRange(line);
    if (!r) continue;
    total++;
    const tokenCount = r.rest.split(/\s+/).filter(Boolean).length;
    if (tokenCount === n) exact++;
  }
  if (!total) return false;
  return (exact / total) >= 0.5;
}

// ── Stacked / transposed columns ─────────────────────────────────────────────
// A PDF copy of a grid table sometimes arrives column-major: the die faces come
// first as a run of bare numbers (1, 2, 3, … each on its own line), then every
// data column is stacked whole — optionally preceded by a short label or an
// ALL-CAPS title crumb. Row-oriented parsing collapses this (every cell after
// the faces reads as a continuation of the last face). We detect the faces run,
// walk the trailing lines column-major, pull label/title crumbs out as we go,
// and recombine each face's cells into one row ("cellA — cellB"). Output is a
// plain single-die ParsedTable, so preview/commit need no changes.

const LABEL_WORDS = new Set([
  "item", "items", "object", "objects", "thing", "things", "feature", "features",
  "effect", "effects", "detail", "details", "result", "results", "name", "names",
  "quirk", "quirks", "trait", "traits", "title", "titles", "property", "properties",
  "boon", "boons", "curse", "curses", "benefit", "benefits", "type", "kind",
]);

/** Split a mashed/camel header like "DIABOLICALItem" → ["DIABOLICAL","Item"]. */
function headerWords(line) {
  return String(line).match(/[A-Z]+(?![a-z])|[A-Z][a-z]+|[a-z]+|\d+/g) ?? [];
}

/**
 * A short label/title crumb sitting between stacked columns: an ALL-CAPS run
 * (DIABOLICAL, TREASURE, or the mash DIABOLICALItem), a stray dN header, or a
 * line whose words are all known column-label nouns (Item, Feature, …). Long
 * prose lines (a real cell) never qualify.
 */
function isHeaderish(line) {
  const t = String(line).trim();
  if (!t) return false;
  if (/^d\d{1,3}\b/i.test(t)) return true;               // stray "d20"
  if (t.split(/\s+/).length > 3) return false;           // prose cell, not a label
  if (/[A-Z]{3,}/.test(t)) return true;                  // ALL-CAPS run / mash
  return headerWords(t).every(w => LABEL_WORDS.has(w.toLowerCase()));
}

/** Pull leftover title words from a group of header crumbs (label word dropped). */
function titleFromCrumbs(crumbs) {
  const out = [];
  let sawLabel = false;
  for (const crumb of crumbs) {
    for (const w of headerWords(crumb)) {
      if (!sawLabel && LABEL_WORDS.has(w.toLowerCase())) { sawLabel = true; continue; }
      if (!/^\d+$/.test(w) && !/^d\d+$/i.test(w)) out.push(w);
    }
  }
  return out;
}

/**
 * Detect + parse a column-major ("transposed") paste into a single combined
 * table: N faces down the first stack, then C data columns of N cells each,
 * each row joining its columns' cells ("cellA — cellB"). Returns a ParsedTable,
 * or null when the block isn't stacked (callers then fall through).
 */
function parseStackedBlock(title, die, dataLines) {
  // 1) Leading run of bare, strictly-sequential faces (1, 2, 3, …).
  let n = 0;
  while (n < dataLines.length) {
    const r = parseLeadingRange(dataLines[n]);
    if (!r || r.rest !== "" || r.min !== n + 1 || r.max !== r.min) break;
    n++;
  }
  if (n < 3) return null;                                 // too short to be a stack
  const tail = dataLines.slice(n);
  if (tail.length < n) return null;                       // need ≥ one full column
  // Stacked columns are prose/labels; a numbered tail line means it's row-form.
  if (tail.some(l => parseLeadingRange(l))) return null;
  // Name-part tables ("Part 1"/"Part 2") are a cartesian d100 expansion owned by
  // expandNamePartTables — never row-combine them here.
  if (tail.some(l => /^part\s*\d+$/i.test(l.trim()))) return null;

  // 2) Walk the tail column-major: gather header crumbs, fill n-cell columns.
  const columns = [];   // string[][] — each inner array is one column's cells
  const titleWords = [];
  let buf = [];
  let crumbs = [];
  for (const line of tail) {
    const t = line.trim();
    if (!buf.length && isHeaderish(t)) { crumbs.push(t); continue; }
    if (!buf.length && crumbs.length) { titleWords.push(...titleFromCrumbs(crumbs)); crumbs = []; }
    buf.push(t);
    if (buf.length === n) { columns.push(buf); buf = []; }
  }
  if (!columns.length) return null;                       // nothing lined up

  const warnings = [];
  if (buf.length) warnings.push(`Last column has ${buf.length} of ${n} cells — trailing lines were dropped; check the grid.`);
  if (crumbs.length) warnings.push(`Ignored trailing text after the last column (“${crumbs.join(" ")}”).`);

  // 3) Recombine each face's cells into one row.
  const rows = [];
  for (let f = 0; f < n; f++) {
    const cells = columns.map(c => (c[f] ?? "").trim()).filter(Boolean);
    rows.push({ min: f + 1, max: f + 1, text: cells.join(" — ") });
  }

  // Prefer an explicit title line, then a dN-header remainder, then the title
  // crumbs recovered from between the columns (e.g. DIABOLICAL + TREASURE).
  const recovered = titleWords
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ").replace(/\s+/g, " ").trim();
  const name = title || (die && die.remainder) || recovered || "";
  const pt = {
    name,
    formula: die ? `1d${die.size}` : `1d${n}`,
    replacement: true,
    bestEffort: true,
    category: classify(name),
    customLabel: "",
    rows,
    warnings: [],
  };
  pt.warnings = warnings.concat(computeWarnings(pt));
  return pt;
}

/** Parse one block → array of ParsedTable (length 1 here; matrix added later). */
function parseBlock(blockLines) {
  const work = blockLines.filter(l => l.trim() !== "");
  if (!work.length) return [];

  let title = "";
  let die = null;
  let idx = 0;

  // Optional title line: first line that is neither a dN header nor a row.
  if (work[0] && !parseDieHeader(work[0]) && !parseLeadingRange(work[0])) {
    title = work[0].trim();
    idx = 1;
  }
  // Optional dN header line.
  if (work[idx] && parseDieHeader(work[idx])) {
    die = parseDieHeader(work[idx]);
    idx++;
  }

  const dataLines = work.slice(idx);
  const stacked = parseStackedBlock(title, die, dataLines);
  if (stacked) return [stacked];
  if (looksLikeMatrix(die, dataLines)) {
    return parseMatrixBlock(title, die, dataLines);
  }
  return [parseSingleDieBlock(title, die, dataLines)];
}

/** Public: parse pasted text into an array of ParsedTable. */
export function parseTables(text) {
  const out = [];
  for (const block of splitBlocks(text)) out.push(...parseBlock(block));
  return out.filter(pt => pt.rows.length);
}

// ── Compound generators ─────────────────────────────────────────────────────
// A "compound generator" is one table rolled N times — once per column — whose
// cells are concatenated in order (a mad-libs / sentence generator, e.g. a
// "PRAYER GENERATOR"). Unlike a matrix (N independent pick-one tables), every
// column is drawn together on a single roll. Stored self-contained: the parsed
// ParsedTable carries `isCompound` + `compound.columns`; buildTableData emits a
// `flags.shadowdark-enhancer.compound` blob and the roll wrap (compound-table.mjs)
// reads it. Column labels look like "Detail 1" / "Col 2" / a capitalised phrase
// ending in a number; cells are prose, so the matrix recognizer never claims them.

const GEN_LABEL = /^(?:detail|col(?:umn)?|part|entry|table|roll|result)\s*\d+$/i;
const BARE_NUM = /^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/;

/** A label-ish line: "Detail 1", "Col 2", or a short Capitalised phrase + number. */
function looksLikeColumnLabel(line) {
  const t = String(line).trim();
  if (GEN_LABEL.test(t)) return true;
  // "Something Something 3" — up to 3 words then a trailing index.
  return /^[A-Z][A-Za-z]*(?:\s+[A-Za-z]+){0,2}\s+\d+$/.test(t) && !BARE_NUM.test(t);
}

/** A bare die marker on its own line, e.g. "3" or "4-5". */
function isBareNumber(line) { return BARE_NUM.test(String(line).trim()); }

/** A numbered data row, e.g. "3 gains a level" (index + non-empty text). */
function isNumberedRow(line) {
  const r = parseLeadingRange(line);
  return !!(r && r.rest !== "");
}

/** Assign a row's fragments to N columns: first N-1 one each, remainder joined. */
function fragmentsToCells(frags, n) {
  const f = frags.filter(s => s !== "");
  if (f.length <= n) {
    const cells = f.slice();
    while (cells.length < n) cells.push("");
    return { cells, over: false, under: f.length < n && f.length > 0 };
  }
  const cells = f.slice(0, n - 1);
  cells.push(f.slice(n - 1).join(" "));
  return { cells, over: true, under: false };
}

/**
 * Parse a dice spec like "3d6" / "2d10" → { columns, die }. The leading count
 * is how many columns/rolls; the die is the per-column size (= row count). A
 * bare "d6" (no leading count) returns null — a generator needs ≥2 columns.
 */
export function parseDiceSpec(str) {
  const m = /(\d+)\s*d\s*(\d+)/i.exec(String(str ?? "").trim());
  if (!m) return null;
  const columns = Number(m[1]);
  const die = Number(m[2]);
  if (!(columns >= 1) || !(die >= 1)) return null;
  return { columns, die };
}

/**
 * Best-effort parse of one pasted block into a compound generator. Handles the
 * two shapes a GM realistically produces:
 *   (clean) one row per line: "1<TAB or 2+ spaces>cell<TAB>cell<TAB>cell"
 *   (messy) column-interleaved PDF copy where bare "N" markers and prose cells
 *           land on separate lines in a scrambled order — grouped by preceding
 *           marker, then split into N cells with warnings for the GM to fix.
 *
 * A dice spec (e.g. 3d6) pins the grid shape with certainty: N columns each on a
 * dX (X rows). It overrides the detected column count/die and, for headerless
 * pastes with no labels, supplies default "Result N" labels — the reliable path
 * the GM opts into when auto-detection can't fully recover a scrambled copy.
 *
 * Returns a ParsedTable{isCompound} or null when the block isn't a generator.
 * @param {string[]} rawLines
 * @param {{columns:number, die:number}|null} [spec]
 */
function parseGeneratorBlock(rawLines, spec) {
  const work = rawLines.map(l => String(l).replace(/\s+$/, "")).filter(l => l.trim() !== "");
  if (!work.length) return null;

  // Locate the dN header (if any) and title.
  const dieIdx = work.findIndex(l => parseDieHeader(l));
  const die = dieIdx >= 0 ? parseDieHeader(work[dieIdx]) : null;

  const genIdx = work.findIndex(l => /generator/i.test(l));
  let title = "";
  if (genIdx >= 0) title = work[genIdx].trim();
  else if (dieIdx > 0 && !BARE_NUM.test(work[0].trim())) title = work[0].trim();

  // Column labels + where the data region begins.
  //   1) header remainder wins:  "d6 A B C"  → labels [A,B,C], data after dN
  //   2) else: leading non-data lines after the header are label candidates.
  //      A strict "Detail N" prefix is trusted even when prose cells follow it
  //      (the scrambled-PDF case); otherwise ALL leading lines are treated as
  //      labels (the clean case, where no cell precedes the first numbered row).
  const headerLabels = (die && die.columns.length >= 2) ? die.columns.slice() : [];
  const labelStart = dieIdx >= 0 ? dieIdx + 1 : (genIdx >= 0 ? genIdx + 1 : 0);
  let labels, dataStart, labelsAreReal;
  if (headerLabels.length >= 2) {
    labels = headerLabels; dataStart = dieIdx + 1; labelsAreReal = true;
  } else {
    const leading = [];
    let i = labelStart;
    while (i < work.length && !isBareNumber(work[i]) && !isNumberedRow(work[i])) { leading.push(work[i]); i++; }
    const strict = [];
    for (const l of leading) { if (looksLikeColumnLabel(l)) strict.push(l.trim()); else break; }
    if (strict.length >= 2) { labels = strict; dataStart = labelStart + strict.length; labelsAreReal = true; }
    else { labels = leading.map(s => s.trim()); dataStart = labelStart + leading.length; labelsAreReal = false; }
  }

  // Dice spec overrides the column count + die. When the paste had no real
  // labels, its "leading" lines were actually cells — don't consume them, and
  // fall back to default labels.
  let n;
  if (spec?.columns >= 2) {
    n = spec.columns;
    if (labelsAreReal) {
      labels = labels.slice(0, n);
      while (labels.length < n) labels.push(`Result ${labels.length + 1}`);
    } else {
      labels = Array.from({ length: n }, (_, i) => `Result ${i + 1}`);
      dataStart = labelStart;
    }
  } else {
    if (!labels || labels.length < 2) return null; // not enough columns → not a generator
    n = labels.length;
  }

  const dataLines = work.slice(dataStart);

  // Clean vs messy: numbered rows ("1 alpha beta gamma") mean each line is one
  // row; bare markers ("1" on its own) mean column-interleaved PDF scramble.
  const numberedRows = dataLines.filter(isNumberedRow);
  const bareMarkers = dataLines.filter(isBareNumber);
  const clean = numberedRows.length >= 2 && numberedRows.length >= bareMarkers.length;

  const cols = labels.map(() => []);
  const warnings = [];
  let size = spec?.die || (die ? die.size : 0);

  if (clean) {
    for (const line of dataLines) {
      const r = parseLeadingRange(line);
      if (!r || r.rest === "") continue;
      size = Math.max(size, r.max);
      // Column detection: an explicit "|" delimiter wins, then tab / 2+ spaces,
      // then one word per column, then a capital-letter boundary; else a
      // best-effort split with a warning.
      const toks = r.rest.trim().split(/\s+/);
      let cells;
      if (r.rest.includes("|")) {
        cells = r.rest.split("|").map(s => s.trim());
        while (cells.length < n) cells.push("");
        cells = cells.slice(0, n);
      } else {
        const byDelim = r.rest.split(/\t+|\s{2,}/).map(s => s.trim()).filter(Boolean);
        const byCaps = splitByCapitals(r.rest, n);
        if (byDelim.length === n) cells = byDelim;
        else if (toks.length === n) cells = toks;
        else if (byCaps) cells = byCaps;
        else {
          const fc = fragmentsToCells(toks, n);
          cells = fc.cells;
          if (fc.over) warnings.push(`Roll ${r.min}: more words than ${n} columns — check the last cell.`);
          else if (fc.under) warnings.push(`Roll ${r.min}: fewer than ${n} columns — some cells are empty.`);
        }
      }
      for (let ci = 0; ci < n; ci++) cols[ci].push({ min: r.min, max: r.max, text: cells[ci] ?? "" });
    }
  } else {
    // Messy: group prose fragments with their preceding "N" marker; fragments
    // before the first marker seed row 1. Then split each group into N cells.
    const groups = new Map();
    let curMin = null;
    const preFirst = [];
    for (const line of dataLines) {
      const t = line.trim();
      const mm = BARE_NUM.exec(t);
      if (mm) {
        curMin = Number(mm[1]);
        const curMax = mm[2] != null ? Number(mm[2]) : curMin;
        size = Math.max(size, curMax);
        if (!groups.has(curMin)) groups.set(curMin, { min: curMin, max: curMax, frags: [] });
        continue;
      }
      if (curMin == null) preFirst.push(t);
      else groups.get(curMin).frags.push(t);
    }
    if (preFirst.length) {
      if (!groups.has(1)) groups.set(1, { min: 1, max: 1, frags: [] });
      groups.get(1).frags.unshift(...preFirst);
    }
    if (!size) size = groups.size || n;
    for (let face = 1; face <= size; face++) {
      const g = groups.get(face);
      const { cells, over, under } = g
        ? fragmentsToCells(g.frags, n)
        : { cells: Array(n).fill(""), over: false, under: false };
      if (over) warnings.push(`Roll ${face}: more fragments than ${n} columns — check the last cell.`);
      else if (under) warnings.push(`Roll ${face}: fewer fragments than ${n} columns — some cells are empty.`);
      else if (!g) warnings.push(`Roll ${face}: no cells found — fill this row in.`);
      for (let ci = 0; ci < n; ci++) cols[ci].push({ min: face, max: face, text: cells[ci] ?? "" });
    }
  }

  if (!size) size = Math.max(1, ...cols.map(c => c.reduce((m, r) => Math.max(m, r.max), 0)));

  // Normalize: every column gets exactly one row per face 1..size (ranges are
  // expanded to per-face, gaps filled empty) so the grid is always complete.
  for (const c of cols) {
    const byFace = new Map();
    for (const r of c) for (let f = r.min; f <= r.max; f++) if (!byFace.has(f)) byFace.set(f, r.text);
    c.length = 0;
    for (let f = 1; f <= size; f++) c.push({ min: f, max: f, text: byFace.get(f) ?? "" });
  }

  // Cell-count sanity vs the spec — tells the GM how much grid fixup remains.
  if (spec) {
    const filled = cols.reduce((a, c) => a + c.filter(r => r.text.trim()).length, 0);
    const expected = n * size;
    if (filled !== expected) {
      warnings.unshift(`${spec.columns}d${spec.die} → a ${n}×${size} grid (${expected} cells); ${filled} came through filled — complete the rest in the grid.`);
    }
  }

  const colFormula = `1d${size}`;
  const columns = labels.map((label, ci) => ({ label, formula: colFormula, rows: cols[ci] }));
  const name = (title || "Compound Generator").replace(/\s+/g, " ").trim();
  return {
    name,
    formula: colFormula,
    replacement: true,
    isCompound: true,
    category: classify(name),
    customLabel: "",
    separator: " ",
    compound: { separator: " ", columns },
    columns, // convenience mirror for the preview layer
    rows: [], // compound tables carry no flat rows
    warnings,
  };
}

/**
 * Public (pure): parse pasted text into compound-generator ParsedTables.
 * @param {string} text
 * @param {string|{columns:number,die:number}|null} [spec]  dice spec ("3d6") or
 *   a pre-parsed { columns, die }. Fixes the grid shape; see parseGeneratorBlock.
 */
export function parseGenerators(text, spec) {
  const parsedSpec = typeof spec === "string" ? parseDiceSpec(spec) : (spec || null);
  const out = [];
  for (const block of splitBlocks(text)) {
    const g = parseGeneratorBlock(block, parsedSpec);
    if (g) out.push(g);
  }
  // Blank-line-free PDF paste = one block; splitBlocks already yields that.
  return out;
}

// ── Shape-directed parse — per-unlock precise structure (table-shapes.mjs) ────
// An importable table ships its exact column recipe rather than relying on a
// formula-only seed, so the
// paste is reconstructed DETERMINISTICALLY instead of guessed. No book text —
// only the structure (column count + split rule). See table-shapes.mjs.

const _CLAUSE = /[,;:]/;
const _CLAUSE_END = /[,;:]\s*$/;
const _BANG_END = /!\s*$/;
const _MODAL = /\b(shall|will|may|must|can|would|should)\b/gi;

/** Split a layout line into {x,text} pieces at runs of 2+ spaces (x = column). */
function _layoutPieces(line) {
  const out = []; let x = 0;
  for (const p of String(line).split(/(\s{2,})/)) {
    if (p && !/^\s+$/.test(p)) out.push({ x, text: p.trim() });
    x += p.length;
  }
  return out;
}

/** Accumulate {line,text} fragments into entries, closing each when the joined
 *  text matches `endRe` (a column's terminal punctuation). */
function _joinUntil(frags, endRe) {
  const out = []; let buf = "", endLine = -1;
  for (const f of frags) {
    buf = buf ? `${buf} ${f.text}` : f.text; endLine = f.line;
    if (endRe.test(buf)) { out.push({ text: buf.trim(), endLine }); buf = ""; }
  }
  if (buf.trim()) out.push({ text: buf.trim(), endLine });
  return out;
}

/** Bin {line,text} fragments into faces bounded by ascending faceEndLines. */
function _binByFaces(frags, faceEndLines) {
  const faces = faceEndLines.map(() => []);
  for (const f of frags) {
    let fi = faceEndLines.findIndex((e) => f.line <= e);
    if (fi < 0) fi = faceEndLines.length - 1;
    faces[fi]?.push(f.text);
  }
  return faces.map((p) => p.join(" ").trim());
}

/**
 * Deterministic parse of a 3-column "PRAYER GENERATOR" compound (WR gods,
 * pp.191-205): Detail 1 always ends in a clause separator (, ; :), Detail 3
 * always ends in "!", Detail 2 is the middle (verified 48/48 rows across all 8
 * generators). Column x-bands come from the header; wrapped fragments re-join
 * by those punctuation terminators, and single-space column merges are peeled
 * apart (Detail1|Detail2 at the first clause sep, Detail2|Detail3 at the last
 * modal). Returns an isCompound ParsedTable (buildTableData cartesian-expands
 * it) or null when the layout doesn't match the shape.
 */
function parsePrayerGenerator(text, { name = "", size = 6, labels } = {}) {
  const raw = String(text).split(/\r?\n/);
  const hi = raw.findIndex((l) =>
    /(^|\s)d\d{1,3}(\s|$)/.test(l) && (/detail/i.test(l) || _layoutPieces(l).length >= 4));
  if (hi < 0) return null;
  const starts = _layoutPieces(raw[hi]).map((p) => p.x);
  if (starts.length < 4) return null;
  const [, x1, x2, x3] = starts;
  const refs = [x1, x2, x3];
  const frag = [[], [], []];
  for (let i = hi + 1; i < raw.length; i++) {
    const l = raw[i];
    if (!l.trim()) { if (frag[0].length || frag[2].length) break; else continue; }
    for (const p of _layoutPieces(l)) {
      if (p.x < x1 - 3) continue;                        // die-number column
      if (/^\d{1,4}$/.test(p.text)) continue;            // stray page number
      let best = 0, bd = Infinity;
      refs.forEach((rx, c) => { const d = Math.abs(p.x - rx); if (d < bd) { bd = d; best = c; } });
      if (best === 0) {                                  // Detail1|Detail2 merge
        const m = _CLAUSE.exec(p.text);
        if (m && m.index < p.text.length - 1) {
          frag[0].push({ line: i, text: p.text.slice(0, m.index + 1) });
          const tail = p.text.slice(m.index + 1).trim();
          if (tail) frag[1].push({ line: i, text: tail });
          continue;
        }
      }
      if (best === 1 && _BANG_END.test(p.text)) {        // Detail2|Detail3 merge
        let m2, last = null; _MODAL.lastIndex = 0;
        while ((m2 = _MODAL.exec(p.text))) last = m2;
        if (last) {
          const cut = last.index + last[0].length;
          frag[1].push({ line: i, text: p.text.slice(0, cut).trim() });
          frag[2].push({ line: i, text: p.text.slice(cut).trim() });
          continue;
        }
      }
      frag[best].push({ line: i, text: p.text });
    }
  }
  const c1 = _joinUntil(frag[0], _CLAUSE_END);
  const c3 = _joinUntil(frag[2], _BANG_END);
  const faceEnds = (c1.length ? c1 : c3).map((e) => e.endLine);
  const c2 = _binByFaces(frag[1], faceEnds);
  const warnings = [];
  if (c1.length !== size) warnings.push(`Prayer parse: ${c1.length} Detail-1 entries, expected ${size}.`);
  if (c3.length !== size) warnings.push(`Prayer parse: ${c3.length} Detail-3 entries, expected ${size}.`);
  const lab = labels && labels.length === 3 ? labels : ["Detail 1", "Detail 2", "Detail 3"];
  const mkRows = (arr) => Array.from({ length: size }, (_, i) => ({
    min: i + 1, max: i + 1, text: (arr[i]?.text ?? arr[i] ?? "").trim(),
  }));
  const columns = [
    { label: lab[0], formula: `1d${size}`, rows: mkRows(c1) },
    { label: lab[1], formula: `1d${size}`, rows: mkRows(c2) },
    { label: lab[2], formula: `1d${size}`, rows: mkRows(c3) },
  ];
  const nm = (name || "Prayer Generator").trim();
  // A prayer rolls one d6 per column (3d6), then cartesian-expands to a flat
  // 6³ = 216-row table at commit. The top-level formula is the human roll
  // (`3d6`), not the per-column `1d6` — the preview shows this verbatim, and
  // `expand:"cartesian"` marks the intent explicitly (buildTableData already
  // auto-expands 216 ≤ cap, so the committed 1d216 table is unchanged).
  return {
    name: nm, formula: `${columns.length}d${size}`, replacement: true, isCompound: true,
    expand: "cartesian",
    category: classify(nm), customLabel: "",
    separator: " ", compound: { separator: " ", columns }, columns,
    rows: [], warnings,
  };
}

/** Slice a line into columns at the header x-positions. For each boundary,
 *  prefer the end of a real 2+-space gap NEAR that x (the actual column edge on
 *  a wrapped line where a cell shifted from its header position); only when no
 *  gap is nearby does it snap x off any word it lands inside (single-space
 *  column gaps). This keeps wrapped continuation lines from cutting a word into
 *  the neighbouring column. */
function _sliceCols(line, colX) {
  const gapEnds = [...line.matchAll(/\S(\s{2,})/g)].map((m) => m.index + m[0].length);
  const cutAt = (x) => {
    let best = null, bd = 13;                              // window: a gap within 12 cols of x
    for (const end of gapEnds) { const d = Math.abs(end - x); if (d < bd) { bd = d; best = end; } }
    if (best != null) return best;
    if (x <= 0 || x >= line.length || line[x] === " " || line[x - 1] === " ") return x;
    let l = x; while (l > 0 && line[l - 1] !== " ") l--;
    let r = x; while (r < line.length && line[r] !== " ") r++;
    return (x - l <= r - x) ? l : r;
  };
  const cells = []; let prev = colX[0];
  for (const cut of colX.slice(1).map(cutAt)) { cells.push(line.slice(prev, cut).trim()); prev = cut; }
  cells.push(line.slice(prev).trim());
  return cells;
}

/**
 * Deterministic parse of a "grid" mix-and-match table (Traps/Hazards 3d12,
 * Boons: Secrets 2d12): a dN header with `cols` column labels, then one row per
 * die face. Columns are sliced at the header's x-positions (not by delimiter),
 * so single-space column gaps that defeat 2+-space splitting still separate
 * cleanly. Returns an isCompound ParsedTable (cartesian-expanded at commit) or
 * null when the header layout can't be read (caller falls back to the spec
 * generator parser).
 */
/**
 * Group a column-layout table's lines into rows — shared by the grid + lookup
 * shapes. Slices each non-blank line into cells at the header column x-positions
 * (`colX`), then assigns EVERY line to its nearest row anchor (ties break
 * downward) so a wrapped cell's continuation lines rejoin their row instead of
 * being dropped (no silent data loss). A bare page-number line (a lone number
 * above `size`) is skipped.
 *   dieIndexed:true  → anchor = a leading die number before colX[0]; that
 *                      number is the row id.
 *   dieIndexed:false → anchor = the first content column being non-empty; ids
 *                      are sequential (Carousing Event, keyed by Cost).
 * `tieUp` decides which row an equidistant line joins: grid cells wrap BELOW
 * their die (die at the row top) → tieUp; Carousing wraps are centered/above
 * → tie down (default).
 * @returns {{ rows: Array<{ id:number, cells:string[] }> }}
 */
function _groupLayoutRows(raw, hi, colX, { dieIndexed = true, size, tieUp = false, col2Starts } = {}) {
  const cols = colX.length;
  // Semantic boundary for a 2-column lookup: the LAST column always starts with
  // this keyword (e.g. Carousing Outcome's Benefit always starts "Gain"). When a
  // long first-column cell collapses the gap to a single space and shoves the
  // keyword left of its header x, the geometry slice cuts mid-cell — so if the
  // keyword lands inside an earlier cell, move it (and everything after) into
  // the last column where it belongs.
  const col2Re = col2Starts && cols === 2 ? new RegExp(`\\b${col2Starts.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) : null;
  const frags = [];    // { line, cells }
  const anchors = [];  // { line, id }
  for (let i = hi + 1; i < raw.length; i++) {
    const l = raw[i];
    if (!l.trim()) { if (anchors.length) break; else continue; }
    const bare = /^\s*(\d{1,4})\s*$/.exec(l);
    if (bare && Number(bare[1]) > (size || 300)) continue;   // stray page number
    let cells;
    if (l.includes("|")) {
      // A manually-typed "|" is authoritative — split on it, not on geometry.
      // Strip a leading die number (dieIndexed) so it isn't captured as a column.
      let content = l;
      if (dieIndexed) { const dm = /^\s*\d+\s*\+?\s*/.exec(l); if (dm) content = l.slice(dm[0].length); }
      cells = content.split("|").map((s) => s.trim());
      while (cells.length < cols) cells.push("");
      cells = cells.slice(0, cols);
    } else {
      cells = _sliceCols(l, colX);
      if (col2Re && cells[0]) {
        const m = col2Re.exec(cells[0]);
        if (m && m.index > 0) {                              // keyword bled into col 1
          const moved = cells[0].slice(m.index).trim();
          cells[0] = cells[0].slice(0, m.index).trim();
          cells[1] = moved + (cells[1] ? ` ${cells[1]}` : "");
        }
      }
    }
    frags.push({ line: i, cells });
    if (dieIndexed) {
      const dm = /^\s*(\d+)\s*\+?/.exec(l);
      // A leading number is a die face only within the die range — a wrapped
      // benefit fragment like "100 item from your" must NOT become row 100.
      if (dm && dm.index < colX[0] && (!size || Number(dm[1]) <= size)) {
        anchors.push({ line: i, id: Number(dm[1]) });
      }
    } else if (cells[0]?.trim()) {
      anchors.push({ line: i, id: anchors.length + 1 });
    }
  }
  if (!anchors.length) return { rows: [] };
  const buckets = anchors.map(() => Array.from({ length: cols }, () => []));
  for (const f of frags) {
    let best = 0, bd = Infinity;
    anchors.forEach((a, idx) => {
      const d = Math.abs(f.line - a.line);
      if (d < bd) { bd = d; best = idx; }               // strictly nearer wins
      else if (d === bd && !tieUp && a.line > anchors[best].line) best = idx; // tie → lower row
      // tieUp: keep the earlier (upper) anchor on a tie.
    });
    for (let c = 0; c < cols; c++) if (f.cells[c]?.trim()) buckets[best][c].push(f.cells[c].trim());
  }
  return { rows: anchors.map((a, idx) => ({ id: a.id, cells: buckets[idx].map((p) => p.join(" ")) })) };
}

/** Shared: assemble grouped {id, cells} rows into a compound grid ParsedTable. */
function _buildGridTable(grouped, { name = "", cols, size, labels }) {
  const N = size || Math.max(0, ...grouped.map((r) => r.id));
  const columns = Array.from({ length: cols }, (_, c) => ({
    label: labels?.[c] ?? `Column ${c + 1}`, formula: `1d${N}`,
    rows: Array.from({ length: N }, (_, i) => ({ min: i + 1, max: i + 1, text: "" })),
  }));
  const warnings = [];
  const seen = new Set();
  for (const r of grouped) {
    if (r.id < 1 || r.id > N) { warnings.push(`Roll ${r.id} is outside 1–${N} — check the die size.`); continue; }
    seen.add(r.id);
    for (let c = 0; c < cols; c++) columns[c].rows[r.id - 1].text = (r.cells[c] ?? "").trim();
    const filled = r.cells.filter((x) => x.trim()).length;
    if (filled < cols) warnings.push(`Roll ${r.id}: ${filled}/${cols} columns filled — check the row.`);
  }
  for (let f = 1; f <= N; f++) if (!seen.has(f)) warnings.push(`Roll ${f}: no row found.`);
  const nm = (name || "").trim();
  return {
    name: nm, formula: `1d${N}`, replacement: true, isCompound: true,
    category: classify(nm), customLabel: "",
    separator: " | ", compound: { separator: " | ", columns }, columns,
    rows: [], warnings,
  };
}

function parseGridShape(text, { name = "", cols = 2, size, labels } = {}) {
  const raw = String(text).split(/\r?\n/);
  const hi = raw.findIndex((l) =>
    /(^|\s)d\d{1,3}(\s|$)/.test(l) && _layoutPieces(l).length >= cols + 1);
  if (hi < 0) return null;
  const cx = _layoutPieces(raw[hi]).map((p) => p.x);
  if (cx.length < cols + 1) return null;
  const colX = cx.slice(1, cols + 1);                      // the cols column x-starts
  // Grid cells wrap below their die (die at the row top) → tieUp.
  const { rows: grouped } = _groupLayoutRows(raw, hi, colX, { dieIndexed: true, size, tieUp: true });
  if (!grouped.length) return null;
  return _buildGridTable(grouped, { name, cols, size, labels });
}

/**
 * Boundary finder for reflowed-grid splitting. Given the remaining text of a
 * row, returns the index where the NEXT column begins per `spec`, or -1:
 *   "cap"  → the next word that starts with a capital letter (the first word,
 *            i.e. the current column's start, is skipped since it has no
 *            preceding space). Used where a column boundary is marked only by
 *            capitalization (Traps: Trap → Trigger).
 *   "dice" → the first dice expression (e.g. 1d6, 2d8/sleep, 3d10). Used where
 *            the final column always opens with a die (Traps: → Damage).
 *   other  → treated as a literal regex; boundary at its match start.
 */
function _reflowBoundary(rest, spec) {
  if (spec === "cap") { const m = /\s[A-Z]/.exec(rest); return m ? m.index + 1 : -1; }
  if (spec === "dice") { const m = /\d{1,3}d\d{1,3}/.exec(rest); return m ? m.index : -1; }
  const m = new RegExp(spec).exec(rest);
  return m ? m.index + (/^\s/.test(m[0]) ? 1 : 0) : -1;
}

/**
 * Parse a REFLOWED grid paste (copied from a PDF viewer — one row per line,
 * single-spaced, no column alignment) where the aligned `parseGridShape` can't
 * read the header. Each data line begins with its die face (the row id); the
 * remainder is split into `cols` columns at the boundaries named in
 * `reflow` (one spec per boundary, i.e. cols-1 entries — see _reflowBoundary).
 * Skips a manually-delimited paste (a "|" means the proven parseGenerators path
 * should handle it). Returns a compound grid ParsedTable or null.
 */
function parseGridReflow(text, { name = "", cols = 2, size, labels, reflow } = {}) {
  if (!reflow?.length || String(text).includes("|")) return null;
  const grouped = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const dm = /^(\d{1,3})\s+(.*)$/.exec(line);
    if (!dm) continue;                                     // title/header/blank
    const id = Number(dm[1]);
    if (size && (id < 1 || id > size)) continue;           // stray page number
    let rest = dm[2].trim();
    const cells = [];
    for (let c = 1; c < cols; c++) {
      const at = _reflowBoundary(rest, reflow[c - 1]);
      if (at <= 0) { cells.push(rest); rest = ""; break; }  // boundary not found
      cells.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    cells.push(rest.trim());
    while (cells.length < cols) cells.push("");
    grouped.push({ id, cells: cells.slice(0, cols) });
  }
  if (!grouped.length) return null;
  return _buildGridTable(grouped, { name, cols, size, labels });
}

/** Simple per-line lookup parse: one row per line. This is the path for a
 *  REFLOWED paste (copied from a PDF viewer — one row per line, single-spaced,
 *  no column alignment). When the shape names the last column's start keyword
 *  (`col2Starts`, e.g. Carousing Outcome's Benefit always begins "Gain"), a
 *  2-column row is split there — reliable where delimiter/geometry can't see a
 *  boundary in single-spaced prose. Otherwise falls back to splitCells. */
function _lookupSimple(text, { cols, col2Starts, dieIndexed = true }) {
  const col2Re = col2Starts && cols === 2
    ? new RegExp(`\\b${col2Starts.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) : null;
  const rows = [];
  let seq = 0;
  for (const l of String(text).split(/\r?\n/)) {
    const line = l.trim();
    if (!line) continue;
    if (dieIndexed) {
      // Each row starts with its die number — that's the row id.
      const r = parseLeadingRange(line);
      if (!r || r.rest === "") continue;
      // A manually-typed "|" always wins (splitCells honours it); only reach for
      // the keyword split when the user did NOT delimit the row themselves.
      const m = r.rest.includes("|") ? null : col2Re?.exec(r.rest);
      const cells = (m && m.index > 0)
        ? [r.rest.slice(0, m.index).trim(), r.rest.slice(m.index).trim()]
        : splitCells(r.rest, cols);
      rows.push({ min: r.min, max: r.max, text: cells.join(" | ") });
    } else {
      // No die column (Carousing Event, keyed by Cost). Do NOT run
      // parseLeadingRange — the first column's own number ("30 gp", "1,200 gp")
      // is NOT a die face. A data row is one the user delimited with "|", or one
      // that splits into exactly `cols` on 2+ spaces; header/title lines do
      // neither and are skipped. Rows are numbered in order.
      const byDelim = line.split(/\t+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
      if (!line.includes("|") && byDelim.length !== cols) continue;
      rows.push({ min: ++seq, max: seq, text: splitCells(line, cols).join(" | ") });
    }
  }
  return rows;
}

/**
 * Pattern-anchored lookup parse for a WRAPPED, un-delimited copy where the first
 * and last columns have recognisable shapes (Carousing Event: Cost "N gp" at the
 * start, Bonus "+N" at the end, Event = the wrapped middle). Each line matching
 * `rowStart` at its start begins a new row; following lines are stitched on until
 * the next such line, so a cost/event/bonus that wraps across several physical
 * lines rejoins. `colLast` (optional) peels the trailing last column; whatever
 * remains between is the middle column. Rows are numbered in order. Returns []
 * when it can't anchor a row (caller falls back to _lookupSimple).
 */
function parsePatternLookup(text, { cols, rowStart, colLast }) {
  const startRe = new RegExp(`^\\s*(${rowStart})`, "i");
  const lastRe = colLast ? new RegExp(`(${colLast})\\s*$`, "i") : null;
  const blobs = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (startRe.test(line)) blobs.push(line);              // a new row begins
    else if (blobs.length) blobs[blobs.length - 1] += ` ${line}`;   // wrap of the current row
    // lines before the first match (title / header) are dropped
  }
  const rows = [];
  blobs.forEach((blob, i) => {
    const sm = startRe.exec(blob);
    const first = sm ? sm[1].trim() : "";
    let mid = blob.slice(sm ? sm[0].length : 0).trim();
    let last = "";
    if (lastRe) { const lm = lastRe.exec(mid); if (lm) { last = lm[1].trim(); mid = mid.slice(0, lm.index).trim(); } }
    const cells = lastRe ? [first, mid, last] : [first, mid];
    while (cells.length < cols) cells.splice(cells.length - 1, 0, "");
    rows.push({ min: i + 1, max: i + 1, text: cells.slice(0, cols).join(" | ") });
  });
  return rows;
}

/**
 * Deterministic parse of a "lookup" table: one roll → one row read across
 * `cols` columns, cells joined by " | " (e.g. Carousing Outcome d14
 * Outcome|Benefit). Handles the Core carousing layout where cells wrap across
 * several lines and the row's die/cost is vertically CENTERED in the block: it
 * slices every line at the header's column x-positions, then groups lines to
 * the nearest row anchor (ties break downward), so wrapped fragments rejoin
 * their row. `dieIndexed:false` anchors on the first content column instead of
 * a leading die number (Carousing Event, keyed by Cost). Column labels land in
 * the description. Returns a single ParsedTable or null.
 */
function parseLookupShape(text, { name = "", cols = 2, size, labels, dieIndexed = true, col2Starts, rowStart, colLast } = {}) {
  const raw = String(text).split(/\r?\n/);
  // Header: a "dN Label…" line (die-indexed) or the labels line (no die).
  let hi = raw.findIndex((l) =>
    /(^|\s)d\d{1,3}(\s|$)/.test(l) && _layoutPieces(l).length >= cols + 1);
  if (hi < 0 && labels?.length) {
    hi = raw.findIndex((l) => labels.every((lb) => l.includes(lb)) && _layoutPieces(l).length >= cols);
  }

  let rows;
  const warnings = [];
  if (hi >= 0) {
    const pcs = _layoutPieces(raw[hi]).map((p) => p.x);
    // Die-indexed: skip the die column (pieces[0]); the content columns follow.
    // No-die: the first column starts at the line begin so a right-aligned first
    // column (e.g. Carousing Event's Cost "1,200 gp") isn't clipped at its header x.
    const colX = dieIndexed ? pcs.slice(1, cols + 1) : [0, ...pcs.slice(1, cols)];
    if (colX.length === cols) {
      const { rows: grouped } = _groupLayoutRows(raw, hi, colX, { dieIndexed, size, col2Starts });
      if (grouped.length) {
        rows = grouped.map((r) => ({ min: r.id, max: r.id, text: r.cells.join(" | ") }));
        if (size && rows.length !== size) {
          warnings.push(`Lookup parse: ${rows.length} rows found, expected ${size} — check the paste for missing/merged rows.`);
        }
      }
    }
  }
  // Un-delimited wrapped copy with recognisable first/last columns (Carousing
  // Event's raw copy) → pattern-anchored. A manual "|" or an aligned header
  // takes precedence, so this only runs when neither applied.
  if (!rows && rowStart && !text.includes("|")) {
    const pr = parsePatternLookup(text, { cols, rowStart, colLast });
    if (pr.length) rows = pr;
  }
  if (!rows) rows = _lookupSimple(text, { cols, col2Starts, dieIndexed });
  if (!rows.length) return null;

  const maxRange = rows.reduce((m, r) => Math.max(m, r.max), 0);
  const nm = (name || "").trim();
  const pt = {
    name: nm, formula: `1d${size || Math.max(1, maxRange)}`,
    replacement: true, bestEffort: false, category: classify(nm), customLabel: "",
    ...(labels ? { description: `Columns: ${labels.join(" | ")}` } : {}),
    rows, warnings,
  };
  pt.warnings = warnings.concat(computeWarnings(pt));
  return pt;
}

/**
 * Parse `text` per a table SHAPE descriptor (table-shapes.mjs). Returns a
 * `{ generators?, tables? }` bucket the hub routes into its preview lists, or
 * null when the shape can't parse the paste (caller falls back to heuristics).
 */
// An ALL-CAPS section caption on a multi-table page (RENOWN, ARMOR TYPE,
// ITEM FLAW). Uppercase letters + spaces and a few joiners, ≥2 chars, at least
// one letter, and NOT a "dN …" die header or a leading die-range row.
function isSectionCaption(line) {
  const t = String(line).trim();
  if (t.length < 2) return false;
  if (parseDieHeader(t) || parseLeadingRange(t)) return false;
  if (!/[A-Z]/.test(t)) return false;
  return /^[A-Z0-9][A-Z0-9 '&/.-]*$/.test(t) && !/[a-z]/.test(t);
}

/**
 * Slice one named single-die table out of a multi-table page and parse just it.
 * Core Rulebook generator pages stack several small tables — each an ALL-CAPS
 * caption ("RENOWN"), a "dN Title" header, then rows — so a whole-page parse
 * overlaps every table's low faces. The `section` shape finds the caption that
 * matches the seeded name (case-insensitive, caption override allowed), takes
 * the block up to the next caption, and runs the normal single-die parse on it.
 * The header die (count+size, e.g. 2d6 Party Secret) is read but its trailing
 * TITLE words are dropped so the matrix detector can't mis-split the rows.
 * Returns a ParsedTable or null (caller falls back to the generic parser).
 */
/**
 * Locate a captioned block on a multi-table page and return its die header +
 * body rows (up to the next caption), or null. Shared by parseSectionSlice and
 * parseGridColumn.
 */
function _sliceSection(text, { name = "", caption, size } = {}) {
  const lines = String(text).split("\n").map((l) => l.trim());
  const want = String(caption || name).toUpperCase().replace(/\s+/g, " ").trim();
  if (!want) return null;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isSectionCaption(lines[i]) && lines[i].toUpperCase().replace(/\s+/g, " ") === want) { start = i; break; }
  }
  if (start === -1) return null;
  // Header line = the "dN Title" right after the caption (skip blanks).
  let h = start + 1;
  while (h < lines.length && !lines[h]) h++;
  let die = parseDieHeader(lines[h]);
  let bodyStart = h + 1;
  if (!die) {
    // A `size` fallback rescues a header the die parser can't read (e.g. the
    // Core Drinks table prints "d* Details"): synthesize the die and skip that
    // pseudo-header line, but keep a real first row when there was no header.
    if (!size) return null;
    die = { count: 1, size, columns: [], remainder: "" };
    const l = lines[h] || "";
    const isPseudoHeader = /^d\S*/i.test(l) || /^(details?|results?|effects?)$/i.test(l);
    bodyStart = isPseudoHeader ? h + 1 : h;
  }
  // Body = rows until the next section caption.
  const body = [];
  for (let i = bodyStart; i < lines.length; i++) {
    if (isSectionCaption(lines[i])) break;
    if (lines[i]) body.push(lines[i]);
  }
  return body.length ? { die, body } : null;
}

function parseSectionSlice(text, { name = "", caption, size } = {}) {
  const s = _sliceSection(text, { name, caption, size });
  if (!s) return null;
  // Force single-die (columns stripped) so a multi-word title never matrix-splits.
  const pt = parseSingleDieBlock(name || s.die.remainder, { count: s.die.count, size: s.die.size, columns: [], remainder: "" }, s.body);
  if (name) pt.name = name;
  return pt.rows.length ? pt : null;
}

/**
 * Extract ONE column of a captioned "dN Col1 Col2 Col3…" grid as its own
 * single-die table (e.g. the Core "FOOD" page's Poor/Standard/Wealthy tiers).
 * Each body row is split into `ncols` cells (capital-word boundaries) and the
 * `col`-th cell becomes the row text. Returns a ParsedTable or null.
 */
function parseGridColumn(text, { name = "", caption, col = 0, ncols = 3 } = {}) {
  const s = _sliceSection(text, { name, caption });
  if (!s) return null;
  const dataLines = [];
  for (const line of s.body) {
    const r = parseLeadingRange(line);
    if (!r) continue;                                   // grid rows lead with a die value
    const cells = splitCells(r.rest, ncols);
    const cell = (cells[col] ?? "").trim();
    if (cell) dataLines.push(`${r.min === r.max ? r.min : `${r.min}-${r.max}`} ${cell}`);
  }
  if (!dataLines.length) return null;
  const pt = parseSingleDieBlock(name, { count: s.die.count, size: s.die.size, columns: [], remainder: "" }, dataLines);
  if (name) pt.name = name;
  return pt.rows.length ? pt : null;
}

/**
 * Parse a "dN, dN" cross-reference matrix (roll dN for the row, dN for the
 * column, read the cell) into a flat 1d(N·N) table — each of the N² cells is one
 * equally-likely result, which reproduces the two-die distribution with a single
 * roll. Reads LAYOUT-mode text: the header ("d4, d4  1  2  3  4") gives the
 * column x-positions and each data row's cells bin to the nearest column, so a
 * multi-word cell ("1d10 children") that a reading-order split can't separate is
 * placed correctly. Returns a ParsedTable or null.
 */
function parseMatrix(text, { name = "", caption, size = 4 } = {}) {
  const lines = String(text).split("\n");
  const want = String(caption || name).toUpperCase().replace(/\s+/g, " ").trim();
  if (!want) return null;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isSectionCaption(lines[i].trim()) && lines[i].trim().toUpperCase().replace(/\s+/g, " ") === want) { start = i; break; }
  }
  if (start === -1) return null;
  // Header "dN, dN 1 2 …": its digit pieces are the column x-anchors.
  let h = -1, n = size;
  for (let i = start + 1; i < lines.length && i < start + 4; i++) {
    const m = /\bd(\d+)\s*,\s*d(\d+)/i.exec(lines[i]);
    if (m) { h = i; n = Number(m[1]); break; }
  }
  if (h === -1 || !(n >= 2)) return null;
  // Body = lines after the header up to the next caption — bound the row search
  // here so a same-numbered row of an EARLIER table on the page isn't grabbed.
  let bodyEnd = lines.length;
  for (let i = h + 1; i < lines.length; i++) { if (isSectionCaption(lines[i].trim())) { bodyEnd = i; break; } }
  const body = lines.slice(h + 1, bodyEnd);
  // Each data row leads with its die number, then its n cells IN ORDER (the
  // layout padding separates columns with 2+ spaces). Take the cell pieces
  // positionally — the header's digit labels are offset from the cell text, so
  // binning by their x mis-assigns near a boundary. A row whose cells don't
  // split into exactly n pieces (tight columns the padding couldn't separate)
  // is kept best-effort and flagged.
  const grid = [];
  let raggedRows = 0;
  for (let r = 1; r <= n; r++) {
    const line = body.find((l) => { const p = parseLeadingRange(l.trim()); return p && p.min === r && p.max === r; });
    const cellPieces = line ? _layoutPieces(line).slice(1).map((p) => p.text) : [];
    if (cellPieces.length !== n) raggedRows++;
    const cells = cellPieces.slice(0, n);
    while (cells.length < n) cells.push("");
    grid.push(cells);
  }
  // Flatten row-major to a 1d(n²) table.
  const rows = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) rows.push({ min: rows.length + 1, max: rows.length + 1, text: (grid[r]?.[c] ?? "").trim() });
  const warnings = [];
  if (raggedRows) warnings.push(`Matrix parse: ${raggedRows} of ${n} rows didn't split into ${n} cells — check the layout.`);
  const nm = (name || caption || "Matrix").trim();
  const pt = {
    name: nm, formula: `1d${n * n}`, replacement: true, bestEffort: false,
    category: classify(nm), customLabel: "", rows, warnings,
  };
  return rows.some((row) => row.text) ? pt : null;
}

/**
 * A single large single-die table (a d100 encounter/treasure table) that spans
 * TWO pages. In 1-column extraction the weighted roll ranges stay paired with
 * their descriptions ("02-03 2d20 bandits…"), but the page carries noise the
 * generic parser trips on: the running header word ("Arctic"), a REPEATED
 * caption + "dN Details" header on the continuation page, and the page-footer
 * numbers (142/143) that inflate the die to 1d142. This strips all of that
 * (keeping the first caption/header) then single-die-parses the whole range.
 */
function parseLongTable(text, { name = "", caption, size = 100 } = {}) {
  const want = caption ? String(caption).toUpperCase().replace(/\s+/g, " ").trim() : null;
  const isHdr = (l) => /^\d{0,2}d\d{1,3}\b/i.test(l) && /details?|results?|effects?/i.test(l);
  // Strip the page-repeated noise: footers, the caption (any occurrence — some
  // pages omit it, some have a "TREASURE 10+" the caption regex can't match),
  // every "dN Details" header past the first, and the running-header crumb.
  let hdrSeen = 0;
  const kept = [];
  for (const raw of String(text).split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (/^\d+$/.test(l) && Number(l) > size) continue;                       // page footer / stray > die
    if (want && l.toUpperCase().replace(/\s+/g, " ") === want) continue;     // caption / seed line
    if (isHdr(l)) { hdrSeen++; if (hdrSeen > 1) continue; kept.push(l); continue; }
    if (/^[A-Z][a-z]+$/.test(l) && l.length < 12) continue;                  // running-header crumb ("Arctic")
    kept.push(l);
  }
  // Anchor on the first "dN Details" header (caption may be absent/graphical);
  // everything after it is the table body across both pages.
  const hi = kept.findIndex(isHdr);
  const die = hi >= 0 ? parseDieHeader(kept[hi]) : null;
  const body = hi >= 0 ? kept.slice(hi + 1) : kept.filter((l) => parseLeadingRange(l));
  if (!body.length) return null;
  const pt = parseSingleDieBlock(name, { count: die?.count ?? 1, size: die?.size ?? size, columns: [], remainder: "" }, body);
  if (name) pt.name = name;
  return pt.rows.length ? pt : null;
}

export function parseByShape(text, shape, { name = "" } = {}) {
  if (!shape) return null;
  if (shape.kind === "longtable") {
    const pt = parseLongTable(text, { name, caption: shape.caption, size: shape.size });
    return pt ? { tables: [pt] } : null;
  }
  if (shape.kind === "matrix") {
    const pt = parseMatrix(text, { name, caption: shape.caption, size: shape.size });
    return pt ? { tables: [pt] } : null;
  }
  if (shape.kind === "section") {
    const pt = parseSectionSlice(text, { name, caption: shape.caption, size: shape.size });
    return pt ? { tables: [pt] } : null;
  }
  if (shape.kind === "gridcol") {
    const pt = parseGridColumn(text, { name, caption: shape.caption, col: shape.col, ncols: shape.ncols });
    return pt ? { tables: [pt] } : null;
  }
  if (shape.kind === "compound" && shape.split === "prayer") {
    const pt = parsePrayerGenerator(text, { name, size: shape.size, labels: shape.labels });
    return pt ? { generators: [pt] } : null;
  }
  if (shape.kind === "compound" && shape.split === "grid") {
    // Mix-and-match grid (Traps/Hazards 3d12, Boons: Secrets 2d12): slice at the
    // header's column x-positions (handles single-space gaps that defeat
    // delimiter splitting). Fall back to the spec generator parser when the
    // header layout can't be read. When the entry declares reflow boundary
    // specs, they run FIRST: the author has said the aligned split is
    // unreliable for this page (Boons: Secrets "succeeded" positionally with
    // shredded cells — E2E D3), so the declared boundaries take precedence.
    // A caption bound keeps a shared page's OTHER die-numbered tables out of
    // the reflow scan (p281 stacks SECRETS above BLESSINGS — without the slice
    // the reflow happily reads the neighbour's rows). Freeform pastes without
    // the caption fall through to the whole text.
    let gtext = text;
    if (shape.caption) {
      const glines = String(text).split(/\r?\n/).map((l) => l.trim());
      const want = shape.caption.toUpperCase().replace(/\s+/g, " ");
      const s = glines.findIndex((l) => isSectionCaption(l) && l.toUpperCase().replace(/\s+/g, " ") === want);
      if (s !== -1) {
        let e = s + 1;
        while (e < glines.length && !(isSectionCaption(glines[e]) && glines[e].toUpperCase().replace(/\s+/g, " ") !== want)) e++;
        gtext = glines.slice(s, e).join("\n");
      }
    }
    // Run ALL THREE split strategies and keep the best-filled result — each
    // wins on different pages: the declared reflow boundaries on glued
    // single-column rows (Boons: Secrets, Nord Names), the aligned x-position
    // split on layout-preserved copies, and the generic spec parser on the
    // auto-extracted generator pages (Traps: the aligned header never matches
    // auto text, and reflow only fills column 1 — E2E follow-up 2026-07-14).
    // Ties prefer the earlier candidate (author-declared reflow first).
    const filled = (g) => (g?.columns ?? []).reduce((s, c) => s + (c.rows ?? []).filter((r) => String(r.text ?? "").trim()).length, 0);
    const viaReflow = shape.reflow?.length
      ? parseGridReflow(gtext, { name, cols: shape.cols, size: shape.size, labels: shape.labels, reflow: shape.reflow })
      : null;
    const viaAligned = parseGridShape(gtext, { name, cols: shape.cols, size: shape.size, labels: shape.labels });
    const viaGenerators = (() => {
      const [g] = parseGenerators(gtext, { columns: shape.cols, die: shape.size });
      if (!g) return null;
      if (shape.labels?.length) {
        g.columns.forEach((c, i) => { if (shape.labels[i]) c.label = shape.labels[i]; });
        if (g.compound) g.compound.columns = g.columns;
      }
      if (name) g.name = name;
      return g;
    })();
    const candidates = [viaReflow, viaAligned, viaGenerators].filter(Boolean);
    if (!candidates.length) return null;
    const pt = candidates.reduce((a, b) => (filled(b) > filled(a) ? b : a));
    return { generators: [pt] };
  }
  if (shape.kind === "lookup") {
    const pt = parseLookupShape(text, { name, cols: shape.cols, size: shape.size, labels: shape.labels, dieIndexed: shape.dieIndexed, col2Starts: shape.col2Starts, rowStart: shape.rowStart, colLast: shape.colLast });
    // A whole-page grab can sweep numbered prose (usage steps, sidebars) in as
    // extra "rows" past the die (CS6 Carousing Outcome: 25 rows on a d8 —
    // E2E W4). The declared size is authoritative: keep the first row per
    // in-bounds face, drop the rest with a visible note.
    if (pt && shape.size && shape.dieIndexed !== false) {
      const seen = new Set();
      const kept = [];
      let dropped = 0;
      for (const r of pt.rows) {
        const key = `${r.min}-${r.max}`;
        if (r.min < 1 || r.max > shape.size || seen.has(key)) { dropped++; continue; }
        seen.add(key);
        kept.push(r);
      }
      if (dropped) {
        pt.rows = kept;
        (pt.warnings ??= []).push(`Dropped ${dropped} row(s) outside or duplicating the d${shape.size} faces — numbered page prose swept into the lookup.`);
      }
    }
    return pt ? { tables: [pt] } : null;
  }
  return null;
}

/** Public (pure): build a RollTable.create payload from a ParsedTable. */
export function buildTableData(pt) {
  const TEXT = (typeof CONST !== "undefined" && CONST?.TABLE_RESULT_TYPES?.TEXT != null)
    ? CONST.TABLE_RESULT_TYPES.TEXT
    : 0;
  const name = (pt.name ?? "").trim() || "Imported Table";

  // Compound generators expand to the FULL cartesian product as one flat,
  // fully-visible RollTable — no hidden per-column roll logic (user pref). A
  // single 1d<product> roll reproduces the roll-each-column distribution
  // exactly: every ordered tuple of column cells is equally likely, so a 3d6
  // generator becomes a plain 216-row table. Products over EXPAND_CAP fall back
  // to the roll-each-column generator so browsing/creating stays sane. The cap
  // sits just above Traps/Hazards (3d12 = 1,728, which expand) and below the
  // Core d20×3 name generators (20³ = 8,000, which stay compound) — user pref
  // 2026-07-11.
  if (pt.isCompound) {
    const src = pt.compound?.columns ?? pt.columns ?? [];
    // Each column → its ordered cell list (one entry per die face; ranges are
    // expanded, gaps kept as "" so face alignment survives GM edits).
    const colCells = src.map((c) => {
      const rows = c.rows ?? [];
      const size = rows.reduce((m, r) => Math.max(m, r.max), 0);
      const byFace = new Map();
      for (const r of rows) for (let f = r.min; f <= r.max; f++) if (!byFace.has(f)) byFace.set(f, r.text ?? "");
      const cells = [];
      for (let f = 1; f <= size; f++) cells.push((byFace.get(f) ?? "").trim());
      return cells;
    }).filter((a) => a.length);
    // Honor the compound's configured separator (prayers use " ", grids " | ")
    // in the cartesian-expanded results too — matching the roll-each-column
    // fallback below — instead of a hardcoded " | ". (review 2026-07-12 #3)
    const sep = typeof pt.compound?.separator === "string"
      ? pt.compound.separator : (typeof pt.separator === "string" ? pt.separator : " ");
    // An explicit "Cartesian" import (the user pressed the Cartesian button)
    // expands far higher — they've chosen the long flat table. The automatic
    // path stays at 2000 so a huge auto-compound (e.g. a d20×3 name generator)
    // stays roll-each-column instead of exploding. The hub blocks a Cartesian
    // request above 25000 before commit, so this only ever expands within range.
    const EXPAND_CAP = pt.expand === "cartesian" ? 25000 : 2000;
    const product = colCells.length ? colCells.reduce((a, c) => a * c.length, 1) : 0;
    if (product >= 1 && product <= EXPAND_CAP) {
      let combos = [[]];
      for (const cells of colCells) {
        const next = [];
        for (const combo of combos) for (const cell of cells) next.push([...combo, cell]);
        combos = next;
      }
      const results = combos.map((cells, i) => ({
        type: TEXT,
        name: cells.filter((s) => s !== "").join(sep),
        weight: 1,
        range: [i + 1, i + 1],
      }));
      return { name, formula: `1d${product}`, replacement: true, displayRoll: false, results };
    }
    // Fallback: keep the compound flag + a single hint row so the sheet isn't
    // empty and core draw() never throws no-results.
    const colFormula = src[0]?.formula || (pt.formula ?? "").trim()
      || `1d${Math.max(1, ...(colCells.length ? colCells.map((c) => c.length) : [1]))}`;
    const columns = src.map((c) => ({
      label: (c.label ?? "").trim(),
      formula: (c.formula ?? "").trim() || colFormula,
      rows: (c.rows ?? []).map((r) => ({ min: r.min, max: r.max, text: r.text ?? "" })),
    }));
    return {
      name,
      formula: colFormula,
      replacement: true,
      displayRoll: false,
      results: [{
        type: TEXT,
        name: `🎲 Compound generator — rolls ${columns.length} columns and combines. Use “Roll” to draw.`,
        weight: 1,
        range: [1, 1],
      }],
      flags: {
        "shadowdark-enhancer": { compound: { separator: sep, columns } },
      },
    };
  }
  const maxRange = (pt.rows ?? []).reduce((m, r) => Math.max(m, r.max), 0);
  const formula = (pt.formula ?? "").trim() || `1d${Math.max(1, maxRange)}`;
  const results = (pt.rows ?? []).map(r => {
    let resultText = r.text ?? "";
    // Loot linking: embed a clickable @UUID on the matched noun. String
    // replace touches only the first occurrence; if the GM edited the text
    // so `matched` is gone, this is a graceful no-op.
    if (r.link?.uuid && r.link.matched) {
      resultText = resultText.replace(r.link.matched, `@UUID[${r.link.uuid}]{${r.link.matched}}`);
    }
    return {
      type: TEXT,
      name: resultText,
      weight: 1,
      range: [r.min, r.max],
    };
  });
  // displayRoll:false keeps the roll formula out of the chat card, which is
  // what Dice So Nice's "Enable 3D dice on Roll Tables" feature requires to
  // animate the draw (it also needs core "Animate Roll Table Roll" off).
  return {
    name, formula, replacement: pt.replacement !== false, displayRoll: false, results,
    ...(pt.description ? { description: pt.description } : {}),
  };
}

// Internal exports for tooling/tests that want the lower-level pieces.
export const _internals = { parseLeadingRange, parseDieHeader, splitBlocks, computeWarnings, parseStackedBlock, isHeaderish };

/**
 * Make a table name unique against a pack index array (or any array with .name).
 * Pure — no Foundry globals — node:testable.
 * @param {string} base
 * @param {Array<{name: string}>} index
 * @returns {string}
 */
export function _uniqueNameAgainstIndex(base, index) {
  const taken = new Set((index ?? []).map(e => (e.name ?? "").toLowerCase()));
  let n = 2;
  let candidate = `${base} (${n})`;
  while (taken.has(candidate.toLowerCase())) {
    n++;
    candidate = `${base} (${n})`;
  }
  return candidate;
}

/** Resolve a ParsedTable's category to its folder display label. */
function _categoryLabel(pt) {
  if (pt.category === CUSTOM_ID) return (pt.customLabel ?? "").trim() || "Other";
  return labelFor(pt.category);
}

/**
 * Create a RollTable from a reviewed ParsedTable and file it into the sde-tables
 * managed pack (pack-native, REQ-30 / D-08). Conflict-checks against the pack
 * index; creates per-source folders INSIDE the pack via ensureSourceFolder.
 *
 * @param {object} pt  ParsedTable (post-grid-edit)
 * @param {object} [opts]
 * @param {(name: string) => Promise<"replace"|"rename"|"cancel">} [opts.onConflict]
 *   Resolver invoked when a same-named table already exists in the pack. Omitted →
 *   non-destructive rename.
 * @returns {Promise<RollTable|null>}
 */
/**
 * Structured quality blockers for a parsed table — the conditions the E2E
 * proved end up as broken RollTables when committed (garbage prose rows,
 * unreachable bands, blank results). Pure; consumed by the preview badges and
 * the commit gate. Returns [{ code, message }]; empty = clean.
 * Coverage gaps only block when they are LARGE (>20% of faces) — small gaps
 * stay ordinary review warnings so freeform lookups aren't over-blocked.
 */
export function computeBlockers(pt) {
  const blockers = [];
  const B = (code, message) => blockers.push({ code, message });
  // A compound generator (Traps, name grids, Boons: Secrets) stores its data in
  // `columns`, not `rows` — validate those instead of the single-die checks.
  if (pt?.compound || (pt?.isCompound && pt?.columns?.length)) {
    const cols = pt.columns ?? [];
    if (!cols.length) { B("no-columns", "Compound generator has no columns."); return blockers; }
    cols.forEach((c, i) => {
      const crows = c.rows ?? c ?? [];
      const blank = crows.filter((r) => !String(r.text ?? r ?? "").trim()).length;
      // A WHOLE empty column = a broken generator (rolls produce blanks) →
      // block. A few scattered blank cells are hand-fixable in the preview and
      // the parser's own "N/M columns filled" warning already flags them, so
      // they stay a review warning, not a hard block.
      if (!crows.length || blank === crows.length)
        B("empty-column", `Column ${i + 1}${c.label ? ` (${c.label})` : ""} is empty — the generator would roll blanks.`);
    });
    for (const w of (pt.warnings ?? [])) if (/^BLOCKER:/i.test(String(w))) B("parser-blocker", String(w).replace(/^BLOCKER:\s*/i, "").slice(0, 180));
    return blockers;
  }
  const rows = pt?.rows ?? [];
  if (!rows.length) { B("no-rows", "No rows parsed."); return blockers; }
  const m = /^(\d+)d(\d+)$/.exec(String(pt.formula ?? "").trim());
  if (!m) B("bad-formula", `Formula "${pt.formula}" is not a plain NdM die.`);
  const lo = m ? Number(m[1]) : null;
  const hi = m ? Number(m[1]) * Number(m[2]) : null;
  const reversed = [], oob = [];
  for (const r of rows) {
    if (r.max < r.min) reversed.push(`${r.min}-${r.max}`);
    else if (m && (r.min < lo || r.max > hi)) oob.push(r.min === r.max ? String(r.min) : `${r.min}-${r.max}`);
  }
  if (reversed.length) B("reversed-range", `${reversed.length} reversed range(s): ${reversed.slice(0, 4).join(", ")}.`);
  if (oob.length) B("out-of-bounds", `${oob.length} row(s) outside ${lo}..${hi}: ${oob.slice(0, 4).join(", ")}${oob.length > 4 ? ", …" : ""}.`);
  if (m) {
    const inb = rows.filter((r) => r.min >= lo && r.max <= hi && r.max >= r.min).sort((a, b) => a.min - b.min);
    let cursor = lo, uncovered = 0, overs = 0;
    for (const r of inb) {
      if (r.min > cursor) uncovered += r.min - cursor;
      if (r.min < cursor) overs++;
      cursor = Math.max(cursor, r.max + 1);
    }
    if (cursor <= hi) uncovered += hi - cursor + 1;
    if (overs) B("overlap", `${overs} overlapping row range(s) — a roll matches more than one result.`);
    const faces = hi - lo + 1;
    if (uncovered / faces > 0.2) B("coverage-gap", `${uncovered} of ${faces} faces have no result.`);
  }
  const empty = rows.filter((r) => !String(r.text ?? "").trim() && !r.documentUuid).length;
  if (empty) B("empty-row", `${empty} row(s) with no result text.`);
  const dieRows = rows.filter((r) => /^\d*d\d+$/i.test(String(r.text ?? "").trim())).length;
  if (dieRows) B("die-as-row", `${dieRows} row(s) whose text is just die notation — parse garbage.`);
  for (const w of (pt.warnings ?? [])) {
    if (/^BLOCKER:/i.test(String(w))) B("parser-blocker", String(w).replace(/^BLOCKER:\s*/i, "").slice(0, 180));
  }
  return blockers;
}

export async function createTable(pt, { onConflict, allowInvalid = false } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can create roll tables.");
    return null;
  }
  // Foundry-bound choke point (Codex review): a broken structure never
  // persists unless the caller explicitly overrode after a confirmation.
  if (!allowInvalid) {
    const blockers = computeBlockers(pt);
    if (blockers.length) {
      console.warn(`Shadowdark Enhancer | createTable blocked "${pt?.name ?? "(untitled)"}":`, blockers.map((b) => b.message));
      return { blocked: true, blockers };
    }
  }

  // Resolve the sde-tables pack (find-or-create via ensureSuite).
  const { ensureSuite, ensureFolderPath: _ensureFolderPath } =
    await import("./compendium-suite.mjs");
  const suite = await ensureSuite();
  if (!suite?.tables) {
    ui.notifications?.error("Could not access the sde-tables compendium.");
    return null;
  }
  const pack = suite.tables;

  const data = buildTableData(pt);
  // Commit choke point: sanitize persisted HTML (review #1).
  if (data.description) {
    const { cleanImportHtml } = await import("./compendium-suite.mjs");
    data.description = cleanImportHtml(data.description);
  }

  // Conflict check against the PACK index (not world game.tables).
  const packIndex = await pack.getIndex();
  const existing = packIndex.find(e => e.name === data.name);
  let replaceTarget = null;
  if (existing) {
    const choice = onConflict ? await onConflict(data.name) : "rename";
    if (choice === "cancel") return null;
    if (choice === "replace") {
      // Replace ONLY the matching document — never the compendium (T-09-08).
      // Deferred to the create site below so the original survives until the
      // replacement data is fully built (non-destructive, review #2).
      replaceTarget = await pack.getDocument(existing._id);
    } else {
      data.name = _uniqueNameAgainstIndex(data.name, [...packIndex]);
    }
  }

  // File into the category-first folder tree that mirrors the Manage strip
  // (table-folders.mjs is the single source of truth; user req 2026-07-11 —
  // replaces the old flat per-source ensureSourceFolder filing).
  const { resolveTableFolderPath } = await import("./table-folders.mjs");
  const folderId = await _ensureFolderPath(pack, resolveTableFolderPath({ ...pt, name: data.name }));
  // Source id still stamps the source FLAG below (hub/migration grouping).
  const sourceId = pt.source
    ?? ((Array.isArray(pt.folderPath) && pt.folderPath.length) ? pt.folderPath[0] : null);

  data.folder = folderId ?? null;
  data.flags = {
    ...(data.flags ?? {}),
    "shadowdark-enhancer": {
      // Preserve flags already stamped by buildTableData (e.g. the compound
      // generator blob) — this key would otherwise be clobbered wholesale.
      ...(data.flags?.["shadowdark-enhancer"] ?? {}),
      tableType: (() => {
        const path = Array.isArray(pt.folderPath) ? pt.folderPath.filter(Boolean) : null;
        const leafLabel = path?.length ? path[path.length - 1] : null;
        return leafLabel ?? (pt.category === CUSTOM_ID ? (_categoryLabel(pt)) : (pt.category ?? "other"));
      })(),
      // When imported via the Roll Tables hub for a known manifest entry, stamp
      // its id so the hub matches this table EXACTLY (not by fuzzy name).
      ...(pt.manifestId ? { manifestId: pt.manifestId } : {}),
      // Stamp source so the hub/migration can group by source.
      ...(sourceId ? { source: sourceId } : {}),
    },
  };

  // File into sde-tables pack (pack-native — D-08 / REQ-30). On replace,
  // update the existing table in place (UUID + inbound @UUID links survive;
  // results swapped) — the original is never deleted before its replacement
  // exists (review #2).
  let table;
  if (replaceTarget) {
    const { replaceDocument } = await import("./compendium-suite.mjs");
    ({ doc: table } = await replaceDocument(replaceTarget, data, pack));
  } else {
    table = await RollTable.create(data, { pack: pack.collection });
  }
  // Compound generators have a single hint result — nothing to enrich, and
  // enriching would rewrite that hint with @UUID links.
  if (!pt.isCompound) await _autoEnrich(table, pt);
  await applyTableStructureSeed(table);
  return table;
}

/**
 * Restore gold-master wiring on a freshly imported table: when a structure
 * seed matches by name (exact, or the "Source - Name" suffix convention),
 * merge the seed's SDE flags and convert text results whose range matches a
 * seed link into document results (suite refs resolved by name, shadowdark.*
 * uuids literal). The row text stays the user's — only the LINK changes.
 * Part of the de-seal architecture: seeds ship structure, pastes ship words.
 */
export async function applyTableStructureSeed(table) {
  try {
    const { TABLE_STRUCTURE_SEEDS } = await import("./table-structure-seeds.mjs");
    const norm = (s) => String(s).toLowerCase().trim();
    const seed = TABLE_STRUCTURE_SEEDS[table.name]
      ?? Object.entries(TABLE_STRUCTURE_SEEDS).find(([k]) =>
        norm(k) === norm(table.name) || norm(table.name).endsWith(`- ${norm(k)}`) || norm(k).endsWith(`- ${norm(table.name)}`))?.[1];
    if (!seed) return;
    const { findSuitePack } = await import("./compendium-suite.mjs");
    const packOf = { tables: findSuitePack("sde-tables"), actors: findSuitePack("sde-actors"), items: findSuitePack("sde-items") };
    if (seed.flags && Object.keys(seed.flags).length)
      await table.update({ "flags.shadowdark-enhancer": { ...(table.flags["shadowdark-enhancer"] ?? {}), ...seed.flags } });
    // NOTE: seed.folder is no longer applied — createTable now files every
    // table via the category-first resolver (table-folders.mjs), which
    // supersedes the seeds' legacy single-name source folders.
    // The seed is authoritative for the die formula (e.g. Carousing Outcome is
    // 1d14, Freya Boons is 2d6) — a paste can mis-guess it from a stray page
    // number ("… 208" → 1d208). Only updates when it differs.
    if (seed.formula && table.formula !== seed.formula) {
      await table.update({ formula: seed.formula });
    }
    if (!seed.links?.length) return;
    // Group by range: the first link converts that range's text row; further
    // links at the same range ADD results (Choose-1 style multi-result rows).
    const groups = new Map();
    for (const link of seed.links) {
      let uuid = link.uuid ?? null;
      if (!uuid && link.ref) {
        const p = packOf[link.ref.pack];
        const idx = p ? await p.getIndex() : null;
        const hit = idx?.find((e) => e.name === link.ref.name);
        if (hit) uuid = `Compendium.${p.collection}.${p.documentName}.${hit._id}`;
      }
      if (!uuid) continue;   // target not imported yet — the Relink pass can finish later
      const key = `${link.range[0]}-${link.range[1]}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ uuid, range: link.range });
    }
    const updates = [], creates = [];
    for (const ls of groups.values()) {
      const rows = table.results.filter((r) =>
        r.range[0] === ls[0].range[0] && r.range[1] === ls[0].range[1] && r.type !== "document");
      ls.forEach((l, i) => {
        if (rows[i]) updates.push({ _id: rows[i].id, type: "document", documentUuid: l.uuid });
        else creates.push({ type: "document", documentUuid: l.uuid, range: l.range, weight: 1 });
      });
    }
    if (updates.length) await table.updateEmbeddedDocuments("TableResult", updates);
    if (creates.length) await table.createEmbeddedDocuments("TableResult", creates);
  } catch (err) {
    console.warn(`shadowdark-enhancer | applyTableStructureSeed(${table?.name}):`, err);
  }
}

/**
 * Auto-link a freshly imported table to the compendium so the GM never has to
 * press a "Link" button: encounter tables get monster @UUID links + inline-roll
 * counts; treasure/loot tables get real compendium items. Kind is inferred from
 * the table's category, custom label, folder path, and name — so a hub-seeded
 * "Random Encounter Tables" import, a plain Loot import, and the Loot Setup
 * Treasure 0-3 binding (category "loot") all enrich without manual steps.
 *
 * Uses a dynamic import so this parser module stays free of a static Foundry
 * dependency (keeps the pure parse path node-testable).
 */
async function _autoEnrich(table, pt) {
  if (!table) return;
  try {
    const { TableEnricher, inferEnrichKind } = await import("./table-enrich.mjs");
    const kind = inferEnrichKind([
      pt?.category, pt?.customLabel, ...(Array.isArray(pt?.folderPath) ? pt.folderPath : []),
      table.name,
    ]);
    if (!kind) return;
    if (kind === "treasure") await TableEnricher.enrichTreasure(table);
    else await TableEnricher.enrichEncounters(table);
  } catch (err) {
    console.warn("shadowdark-enhancer | auto-enrich failed:", err);
  }
}

/**
 * Split a pasted matrix grid into N per-column tables using a KNOWN column list
 * (from the manifest) instead of guessing the column count from the header.
 *
 * Each data line is "<index|range> <cell> <cell> …". The header line and any
 * trailing title are skipped (they don't start with a die index). When a row
 * has exactly N cell-tokens (single-word cells — names, syllables) the split is
 * exact regardless of a multi-word header. When a row has MORE tokens than
 * columns (multi-word cells) we fall back to first-(N-1)-single + rest-joined
 * and record a warning so the GM can fix that cell in the preview.
 *
 * @param {string} text
 * @param {string[]} columns  the matrix's column labels (length = N)
 * @param {number[][]} [widths]  optional per-row cell word-counts (roll-indexed);
 *   when a row's counts sum to its token count, the split is exact even from a
 *   single-spaced paste (the "cheat" — we know each cell's word count from the rules).
 * @returns {Array<ParsedTable>}  one ParsedTable per column
 */
export function parseMatrixByColumns(text, columns, widths) {
  const N = columns.length;
  const cols = columns.map(() => []);
  const warnings = [];
  let maxRange = 0;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?\s+(.+)$/.exec(line);
    if (!m) continue; // header / title / blank — skipped
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : min;
    maxRange = Math.max(maxRange, max);
    const rest = m[3];
    // Prefer real column delimiters (tabs or 2+ spaces) — PDF tables usually
    // copy with aligned whitespace between columns but single spaces inside a
    // cell, so this cleanly separates multi-word cells when alignment survives.
    const byDelim = rest.split(/\t+|\s{2,}/).map(s => s.trim()).filter(s => s.length);
    const toks = rest.trim().split(/\s+/);
    const w = Array.isArray(widths) ? widths[min - 1] : null;
    let cells;
    if (rest.includes("|")) {
      // Explicit pipe delimiter wins outright (user pref for multi-column tables).
      cells = rest.split("|").map(s => s.trim());
      while (cells.length < N) cells.push("");
      cells = cells.slice(0, N);
    } else if (w && w.length === N && w.reduce((a, b) => a + b, 0) === toks.length) {
      // Authoritative: split by the known per-cell word counts (handles
      // single-spaced multi-word cells with no delimiter at all).
      cells = []; let k = 0;
      for (const ww of w) { cells.push(toks.slice(k, k + ww).join(" ")); k += ww; }
    } else if (byDelim.length === N) {
      cells = byDelim;                                  // delimited multi-word cells
    } else if (toks.length === N) {
      cells = toks;                                     // single-word cells
    } else if (splitByCapitals(rest, N)) {
      cells = splitByCapitals(rest, N);                 // capital-led column boundaries
    } else if (toks.length > N) {
      cells = [...toks.slice(0, N - 1), toks.slice(N - 1).join(" ")];
      warnings.push(`Roll ${min}${max !== min ? "-" + max : ""}: ${toks.length} words across ${N} columns — verify the last column.`);
    } else {
      cells = [...toks, ...Array(N - toks.length).fill("")];
      warnings.push(`Roll ${min}: only ${toks.length} of ${N} columns had text.`);
    }
    for (let i = 0; i < N; i++) cols[i].push({ min, max, text: cells[i] ?? "" });
  }
  const formula = `1d${Math.max(1, maxRange)}`;
  return columns.map((col, i) => ({
    name: col, formula, replacement: true, bestEffort: true,
    rows: cols[i], warnings: i === 0 ? warnings : [],
  }));
}

export const TableImporter = {
  parse: parseTables,
  parseGenerators,
  parseByShape,
  parseDiceSpec,
  parseMatrixByColumns,
  buildTableData,
  createTable,
};
