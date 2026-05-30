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
const LEADING_RANGE = /^\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?(?=\s|$)/;

// A "dN ..." header line. Trailing words (if any) are candidate column
// labels — used by the Tier-2 matrix path (later task).
const DIE_HEADER = /^d(\d{1,3})\b\s*(.*)$/i;

/** Parse a leading die token. Returns {min,max,rest} or null. */
function parseLeadingRange(line) {
  const m = LEADING_RANGE.exec(line);
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] != null ? Number(m[2]) : min;
  const rest = line.slice(m[0].length).trim();
  return { min, max, rest };
}

/** Parse a "dN Col Col Col" header. Returns {size,columns,remainder} or null. */
function parseDieHeader(line) {
  const m = DIE_HEADER.exec(String(line).trim());
  if (!m) return null;
  const size = Number(m[1]);
  const remainder = (m[2] ?? "").trim();
  const columns = remainder ? remainder.split(/\s+/).filter(Boolean) : [];
  return { size, columns, remainder };
}

/** Split raw paste text into blocks on blank lines. */
function splitBlocks(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (cur.length) { blocks.push(cur); cur = []; }
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

/** Non-blocking warnings: gaps, overlaps, formula/max-range mismatch. */
function computeWarnings(pt) {
  const warnings = [];
  const sizeMatch = /^\s*\d*d(\d{1,3})/i.exec(pt.formula ?? "");
  const size = sizeMatch ? Number(sizeMatch[1]) : null;
  const maxRange = (pt.rows ?? []).reduce((m, r) => Math.max(m, r.max), 0);

  if (size != null && maxRange > size) {
    warnings.push(`Rows reach ${maxRange} but formula is ${pt.formula}.`);
  }
  for (let i = 0; i < pt.rows.length; i++) {
    for (let j = i + 1; j < pt.rows.length; j++) {
      const a = pt.rows[i], b = pt.rows[j];
      if (a.max >= b.min && a.min <= b.max) {
        warnings.push(`Rows ${i + 1} and ${j + 1} overlap.`);
      }
    }
  }
  const top = size ?? maxRange;
  for (let face = 1; face <= top; face++) {
    if (!pt.rows.some(r => face >= r.min && face <= r.max)) {
      warnings.push(`Value ${face} has no row.`);
    }
  }
  return warnings;
}

/** Build a single-die ParsedTable from a block's data lines. */
function parseSingleDieBlock(title, die, dataLines) {
  const rows = [];
  const anyToken = dataLines.some(l => parseLeadingRange(l));

  if (anyToken) {
    for (const line of dataLines) {
      const r = parseLeadingRange(line);
      if (r) {
        rows.push({ min: r.min, max: r.max, text: r.rest });
      } else if (rows.length) {
        const prev = rows[rows.length - 1];
        prev.text = `${prev.text} ${line.trim()}`.trim();
      }
      // a continuation with no prior row is dropped (stray header crumb)
    }
  } else {
    dataLines.forEach((line, i) => {
      rows.push({ min: i + 1, max: i + 1, text: line.trim() });
    });
  }

  const maxRange = rows.reduce((m, r) => Math.max(m, r.max), 0);
  // With no separate title line, a dN header's trailing text is the table
  // name (e.g. "d100 Details" → "Details"). Matrix column-label use of the
  // remainder is handled on the Tier-2 path (later task), not here.
  const name = title || (die ? die.remainder : "");
  const pt = {
    name: name || "",
    formula: die ? `1d${die.size}` : `1d${Math.max(1, maxRange)}`,
    replacement: true,
    bestEffort: false,
    rows,
    warnings: [],
  };
  pt.warnings = computeWarnings(pt);
  return pt;
}

/** Split a row's result text into exactly n cells (surplus → last cell). */
function splitCells(rest, n) {
  const tokens = String(rest).split(/\s+/).filter(Boolean);
  if (tokens.length <= n) {
    const cells = tokens.slice();
    while (cells.length < n) cells.push("");
    return cells;
  }
  const cells = [];
  for (let i = 0; i < n - 1; i++) cells.push(tokens[i]);
  cells.push(tokens.slice(n - 1).join(" "));
  return cells;
}

/** Build N best-effort ParsedTables from a multi-column block. */
function parseMatrixBlock(title, die, dataLines) {
  const n = die.columns.length;
  const tables = die.columns.map((label, ci) => ({
    name: [title, label].filter(Boolean).join(" — ") || label || `Column ${ci + 1}`,
    formula: `1d${die.size}`,
    replacement: true,
    bestEffort: true,
    rows: [],
    warnings: [],
  }));

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
  if (!die || die.columns.length < 2) return false;
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

/** Public (pure): build a RollTable.create payload from a ParsedTable. */
export function buildTableData(pt) {
  const TEXT = (typeof CONST !== "undefined" && CONST?.TABLE_RESULT_TYPES?.TEXT != null)
    ? CONST.TABLE_RESULT_TYPES.TEXT
    : 0;
  const name = (pt.name ?? "").trim() || "Imported Table";
  const maxRange = (pt.rows ?? []).reduce((m, r) => Math.max(m, r.max), 0);
  const formula = (pt.formula ?? "").trim() || `1d${Math.max(1, maxRange)}`;
  const results = (pt.rows ?? []).map(r => ({
    type: TEXT,
    name: r.text ?? "",
    weight: 1,
    range: [r.min, r.max],
  }));
  // displayRoll:false keeps the roll formula out of the chat card, which is
  // what Dice So Nice's "Enable 3D dice on Roll Tables" feature requires to
  // animate the draw (it also needs core "Animate Roll Table Roll" off).
  return { name, formula, replacement: pt.replacement !== false, displayRoll: false, results };
}

// Internal exports for tooling/tests that want the lower-level pieces.
export const _internals = { parseLeadingRange, parseDieHeader, splitBlocks, computeWarnings };

/** Make a table name unique against existing world tables by suffixing. */
function _uniqueTableName(base) {
  let n = 2;
  let candidate = `${base} (${n})`;
  while (game.tables.find(t => t.name === candidate)) {
    n++;
    candidate = `${base} (${n})`;
  }
  return candidate;
}

/**
 * Create a world RollTable from a reviewed ParsedTable.
 *
 * @param {object} pt  ParsedTable (post-grid-edit)
 * @param {object} [opts]
 * @param {(name: string) => Promise<"replace"|"rename"|"cancel">} [opts.onConflict]
 *   Resolver invoked when a same-named table already exists. Omitted →
 *   non-destructive rename.
 * @returns {Promise<RollTable|null>}
 */
export async function createTable(pt, { onConflict } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can create roll tables.");
    return null;
  }
  const data = buildTableData(pt);
  const existing = game.tables.find(t => t.name === data.name);
  if (existing) {
    const choice = onConflict ? await onConflict(data.name) : "rename";
    if (choice === "cancel") return null;
    if (choice === "replace") await existing.delete();
    else data.name = _uniqueTableName(data.name);
  }
  return RollTable.create(data);
}

export const TableImporter = {
  parse: parseTables,
  buildTableData,
  createTable,
};
