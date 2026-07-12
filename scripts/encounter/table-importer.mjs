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
  pt.warnings = computeWarnings(pt);
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
// The "smaller + more detailed" successor to the old sealed AES blobs and to
// formula-only seeds: an unlockable table ships its exact column recipe, so the
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
  return {
    name: nm, formula: `1d${size}`, replacement: true, isCompound: true,
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
export function parseByShape(text, shape, { name = "" } = {}) {
  if (!shape) return null;
  if (shape.kind === "compound" && shape.split === "prayer") {
    const pt = parsePrayerGenerator(text, { name, size: shape.size, labels: shape.labels });
    return pt ? { generators: [pt] } : null;
  }
  if (shape.kind === "compound" && shape.split === "grid") {
    // Mix-and-match grid (Traps/Hazards 3d12, Boons: Secrets 2d12): slice at the
    // header's column x-positions (handles single-space gaps that defeat
    // delimiter splitting). Fall back to the spec generator parser when the
    // header layout can't be read.
    const pt = parseGridShape(text, { name, cols: shape.cols, size: shape.size, labels: shape.labels });
    if (pt) return { generators: [pt] };
    const [g] = parseGenerators(text, { columns: shape.cols, die: shape.size });
    if (!g) return null;
    if (shape.labels?.length) {
      g.columns.forEach((c, i) => { if (shape.labels[i]) c.label = shape.labels[i]; });
      if (g.compound) g.compound.columns = g.columns;
    }
    if (name) g.name = name;
    return { generators: [g] };
  }
  if (shape.kind === "lookup") {
    const pt = parseLookupShape(text, { name, cols: shape.cols, size: shape.size, labels: shape.labels, dieIndexed: shape.dieIndexed, col2Starts: shape.col2Starts, rowStart: shape.rowStart, colLast: shape.colLast });
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
    const separator = " | ";
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
        name: cells.filter((s) => s !== "").join(separator),
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
    const sep = typeof pt.compound?.separator === "string"
      ? pt.compound.separator : (typeof pt.separator === "string" ? pt.separator : " ");
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
export async function createTable(pt, { onConflict } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can create roll tables.");
    return null;
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
