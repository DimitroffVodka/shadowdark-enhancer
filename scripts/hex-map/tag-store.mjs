/**
 * Shadowdark Enhancer — the tagger's working store (pure, Foundry-free).
 *
 * Lives on the scene as `flags.shadowdark-enhancer.hexTags`, compact strings,
 * one write per sheet:
 *
 *   { version: 1,
 *     origin: { i, j, q, r, num: "000", shifted: "odd", bounds: { cols: 64, rows: 75 } } | null,
 *     cells: { "1403": "forest;river|gm", "1404": "forest|auto:1.42" } }
 *
 * A cell value is `tags|source[:margin][?]`: the first tag is the terrain, the
 * rest are overlays (river, path, coast); a trailing `?` marks an automatic
 * result the classifier flagged for review (unclear overlay or missing stamp)
 * beyond what the margin alone says. Numbers are published numbers as
 * decimal strings without leading zeros. ponytail: the flag re-sends the whole
 * object on every write; move to a flagged journal page (as Extras' hexData)
 * if a map ever exceeds about 10 000 cells.
 */

import { neighbours } from "./geometry.mjs";

export const STORE_VERSION = 1;
export const OVERLAYS = ["river", "path", "coast"];

export function emptyState() {
  return { version: STORE_VERSION, origin: null, cells: new Map() };
}

/** Flag object → state. Tolerates a missing or foreign flag. */
export function decodeTags(flag) {
  const state = emptyState();
  if (!flag || typeof flag !== "object") return state;
  state.origin = flag.origin ?? null;
  for (const [num, raw] of Object.entries(flag.cells ?? {})) {
    const [tagPart, srcPart = ""] = String(raw).split("|");
    const tags = tagPart.split(";").map((t) => t.trim()).filter(Boolean);
    if (!tags.length) continue;
    const review = srcPart.endsWith("?");
    const [source, margin] = (review ? srcPart.slice(0, -1) : srcPart).split(":");
    state.cells.set(String(parseInt(num, 10)), {
      terrain: tags[0], overlays: tags.slice(1).filter((t) => OVERLAYS.includes(t)),
      source: source || "gm", margin: margin !== undefined ? Number(margin) : undefined, review,
    });
  }
  return state;
}

/** State → flag object. */
export function encodeTags(state) {
  const cells = {};
  for (const [num, c] of state.cells) {
    if (!c?.terrain) continue;
    const tags = [c.terrain, ...(c.overlays ?? [])].join(";");
    const src = c.margin !== undefined ? `${c.source ?? "gm"}:${Number(c.margin).toFixed(2)}` : (c.source ?? "gm");
    cells[num] = `${tags}|${src}${c.review ? "?" : ""}`;
  }
  return { version: STORE_VERSION, origin: state.origin ?? null, cells };
}

/** Deterministic RNG for tests; the app passes Math.random. */
export function lcg(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * How often the classifier turns out to be wrong at a given margin, measured on
 * one map of 4768 hexes the GM verified by hand (Take 8: 4105 cells the
 * classifier decided unaided, 215 of them wrong).
 *
 * The point of the table is that it is steeply monotone — the least confident
 * cells are fifty times likelier to be wrong than the most confident. A hard
 * cutoff throws that away: the old review queue took everything under 1.3 and
 * SHUFFLED it, so the GM met a 39%-wrong cell and a 16%-wrong cell in random
 * order, and never saw the 115 errors that sat above the line at all.
 *
 * These rates come from one map and one print style. They are used only to
 * ORDER the queue, never to decide anything, so being off by a few points
 * costs nothing; being monotone is the whole job.
 */
/**
 * A hex called river with no wet neighbour is not a river.
 *
 * Rivers are chains: every real river hex on a printed map touches another
 * river, a lake, a coast or the sea. A lone one is the classifier reading
 * desert stipple and a printed hex number as a watercourse. Measured on the
 * verified map: of 174 hexes classified river, **19 had no wet neighbour and
 * all 19 were wrong — every one of them desert**. No correct river was caught.
 *
 * It only ever rings the hex. A river chain on some other print could be one
 * hex long where the map crops it, and demoting the terrain would break that
 * map to tidy up this one; asking the GM costs nothing either way.
 */
const WET = new Set(["river", "coast", "ocean", "lake", "arctic_sea"]);

/**
 * @param {object} state  the tag store
 * @param {number|string} num
 * @returns {boolean}
 */
export function strandedRiver(state, num) {
  const cell = state?.cells?.get(String(num));
  if (cell?.terrain !== "river" || cell.source !== "auto") return false;
  const n = Number(num);
  if (!Number.isFinite(n)) return false;
  for (const nb of neighbours(Math.floor(n / 100), n % 100, state.origin?.shifted ?? "odd")) {
    const other = state.cells.get(String(nb.col * 100 + nb.row));
    if (!other) continue;
    if (WET.has(other.terrain) || (other.overlays ?? []).includes("river")) return false;
  }
  return true;
}

/**
 * How often a stranded river turns out to be wrong. Measured at 19 of 19, but
 * that is one map and nineteen hexes, so it sits just below certainty — high
 * enough to reach the top of the queue, not so high it claims to be a fact.
 */
export const STRANDED_RIVER_RATE = 0.9;

export const REVIEW_BANDS = [
  { under: 1.1, rate: 0.388 },
  { under: 1.3, rate: 0.219 },
  { under: 1.6, rate: 0.158 },
  { under: 2.0, rate: 0.049 },
  { under: 3.0, rate: 0.033 },
  { under: Infinity, rate: 0.007 },
];

/**
 * How likely this cell is to be wrong, 0 for anything a human already settled.
 * A cell the classifier flagged itself (`review`) is treated as at least as
 * suspect as the worst band, and so is one with no margin recorded.
 * @param {object|null} cell
 * @returns {number}
 */
export function errorRate(cell, { stranded = false } = {}) {
  if (!cell?.terrain || cell.source !== "auto") return 0;
  // A stranded river outranks every margin band: the margin describes how the
  // glyph looked, and this describes where the hex sits.
  if (stranded) return STRANDED_RIVER_RATE;
  if (cell.review || cell.margin === undefined) return REVIEW_BANDS[0].rate;
  return REVIEW_BANDS.find((b) => cell.margin < b.under)?.rate ?? REVIEW_BANDS.at(-1).rate;
}

/** The chance a sheet holds at least one mistake, and how many to expect. */
export function sheetRisk(state, sheet = []) {
  let expected = 0;
  for (const n of sheet) expected += errorRate(state.cells.get(String(n)), { stranded: strandedRiver(state, n) });
  return { expected, cells: sheet.length };
}

/**
 * Pick the next sheet of cells to show.
 *
 * Review mode is ranked, not filtered: every cell the classifier decided is in
 * the pool, worst first.
 *
 * Measured on Take 8 (4105 auto cells, 215 of them wrong). Drawing the whole
 * queue is a wash — the first 503 ranked cells hold the same 100 errors the old
 * cutoff did, because they are largely the same cells. The gain is in the two
 * things a GM actually does:
 *
 *   - Stopping early. 200 cells ranked finds 66 errors; 200 cells drawn at
 *     random from the old pool finds about 40. Two thirds more for the same
 *     number of decisions, and the old queue was shuffled.
 *   - Carrying on. 750 cells finds 144 errors (67%), 1000 finds 166 (77%),
 *     1500 finds 189 (88%). Under the cutoff those sat above the line and no
 *     amount of reviewing reached them without changing a setting.
 * @param {object} state
 * @param {object} opts
 * @param {number[]} opts.nums        every numbered cell on the map
 * @param {number} [opts.size=40]
 * @param {"random"|"keyed"|"review"} [opts.mode="random"]
 * @param {Set<number>} [opts.keyed]  numbers of keyed hexes (from the crawl entry)
 * @param {() => number} [opts.rng]
 * @returns {number[]}
 */
export function nextSheet(state, { nums, size = 40, mode = "random", keyed = new Set(), rng = Math.random } = {}) {
  const tagged = (n) => state.cells.get(String(n));
  if (mode === "review") {
    return nums
      .map((n) => { const cell = tagged(n); return { n, cell, rate: errorRate(cell, { stranded: strandedRiver(state, n) }) }; })
      .filter((e) => e.rate > 0)
      // Riskiest first; inside a band the thinner margin first, so the order is
      // total and a redraw of the same state gives the same sheet.
      .sort((a, b) => b.rate - a.rate
        || (a.cell.margin ?? 0) - (b.cell.margin ?? 0)
        || a.n - b.n)
      .slice(0, size).map((e) => e.n)
      .sort((x, y) => x - y);
  }
  const pool = mode === "keyed"
    ? nums.filter((n) => keyed.has(n) && !tagged(n))
    : nums.filter((n) => !tagged(n));
  // Fisher–Yates on a copy, then take the first `size`.
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; }
  return a.slice(0, size).sort((x, y) => x - y);
}

/**
 * Apply a sheet's answers. `answers` = { num: { terrain, overlays } }; an empty
 * terrain clears the cell. GM answers always carry source "gm".
 *
 * Returns what each answer replaced, so a caller can record the GM's verdict on
 * the classifier before it is overwritten (tag-corrections.mjs). Every answer
 * is a transition, including the ones that change nothing: leaving a guess
 * alone is the verdict "this one is right".
 * @returns {Array<{num:string, before:object|null, after:object|null}>}
 */
export function applySheet(state, answers) {
  const transitions = [];
  for (const [num, a] of Object.entries(answers ?? {})) {
    const key = String(parseInt(num, 10));
    const before = state.cells.get(key) ?? null;
    let after = null;
    if (!a?.terrain) state.cells.delete(key);
    else {
      after = { terrain: a.terrain, overlays: (a.overlays ?? []).filter((t) => OVERLAYS.includes(t)), source: "gm" };
      state.cells.set(key, after);
    }
    transitions.push({ num: key, before, after });
  }
  return transitions;
}

/** Tags in the shape hex-dataset's buildHexDataset takes: { num: { terrain, overlays } }. */
export function tagsForDataset(state) {
  const out = {};
  for (const [num, c] of state.cells) if (c?.terrain) out[String(num).padStart(3, "0")] = {
    terrain: c.terrain,
    overlays: [...new Set([...(c.overlays ?? []), ...(OVERLAYS.includes(c.terrain) ? [c.terrain] : [])])],
  };
  return out;
}

/** Counts for the header. */
export function summarize(state, total) {
  let gm = 0, auto = 0;
  for (const c of state.cells.values()) { if (c.source === "auto") auto++; else gm++; }
  return { total, tagged: gm + auto, gm, auto, untagged: Math.max(0, total - gm - auto) };
}

/**
 * Side door in (Phase 4): rows from a CSV (classify.mjs parseTruthCsv) or from
 * rowsFromJson. A row is { num, tags, source?, margin?, review? }; the first
 * non-overlay tag is the terrain, so "river;forest" and "forest;river" agree,
 * and a row of overlays only ("river" for a cell that is all water) keeps its
 * first tag as the terrain, the same rule compareTags applies to a truth CSV
 * (167 of the Western Reaches table's 4768 rows are like that). Imported rows
 * replace the cell; `origin` is taken only when the store has none (it is tied
 * to the scene's grid). Returns the number of cells written.
 */
export function importTags(state, rows, { origin = null } = {}) {
  let n = 0;
  for (const r of rows ?? []) {
    const num = parseInt(r?.num, 10);
    const tags = (r?.tags ?? []).map((t) => String(t).trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean);
    const terrain = tags.find((t) => !OVERLAYS.includes(t)) ?? tags[0];
    if (!Number.isInteger(num) || num < 0 || !terrain) continue;
    const cell = { terrain, overlays: tags.filter((t) => OVERLAYS.includes(t) && t !== terrain), source: r.source === "auto" ? "auto" : "gm", review: !!r.review };
    if (Number.isFinite(r.margin)) cell.margin = Number(r.margin);
    state.cells.set(String(num), cell);
    n++;
  }
  if (origin && !state.origin) state.origin = origin;
  return n;
}

/**
 * Rows from a JSON side door: the tag flag itself (exported by the tagger) or
 * an Extras dataset (regions → terrain, networks → river/path, keyed hexes'
 * terrain). Dataset regions carry biome keys, which come back as free-text
 * terrain; the flag round-trips exactly.
 * @returns {{rows:object[], origin:object|null}}
 */
export function rowsFromJson(obj) {
  if (obj?.cells && typeof obj.cells === "object" && !Array.isArray(obj.cells)) {
    const s = decodeTags(obj);
    return { origin: s.origin, rows: [...s.cells].map(([num, c]) => ({ num, tags: [c.terrain, ...c.overlays], source: c.source, margin: c.margin, review: c.review })) };
  }
  const byNum = new Map();
  const add = (num, tag) => { const k = String(parseInt(num, 10)); if (k === "NaN" || !tag) return; if (!byNum.has(k)) byNum.set(k, []); byNum.get(k).push(tag); };
  for (const r of obj?.terrain?.regions ?? []) for (const n of r.hexes ?? []) add(n, r.biome);
  for (const h of obj?.hexes ?? []) add(h.num, h.terrain);
  for (const [net, overlay] of [["river", "river"], ["road", "path"]]) for (const n of obj?.networks?.[net] ?? []) add(n, overlay);
  // A compact dataset paints every cell of the grid with terrain.default:
  // expand it under the contract's numbering (origin 1 unless the dataset
  // says 0; the lowered columns, odd physical ones, may end a row short).
  const { cols, rows } = obj?.grid ?? {};
  const origin = obj?.grid?.origin === 0 ? 0 : 1;
  const rowsLowered = Number.isInteger(obj?.grid?.rowsLowered) ? obj.grid.rowsLowered : rows;
  const fallback = obj?.terrain?.default;
  if (fallback && Number.isInteger(cols) && cols > 0 && Number.isInteger(rows) && rows > 0) {
    for (let col = origin; col < cols + origin; col++) {
      const last = ((col - origin) % 2 === 1 ? rowsLowered : rows) + origin;
      for (let row = origin; row < last; row++) {
        const tags = byNum.get(String(col * 100 + row)) ?? [];
        if (!tags.some((t) => !OVERLAYS.includes(String(t).trim().toLowerCase()))) add(col * 100 + row, fallback);
      }
    }
  }
  return { origin: null, rows: [...byNum].map(([num, tags]) => ({ num, tags, source: "gm" })) };
}
