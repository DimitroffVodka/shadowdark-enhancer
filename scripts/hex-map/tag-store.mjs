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
 * rest are features (river, path, coast); a trailing `?` marks an automatic
 * result the classifier flagged for review (unclear feature or missing stamp)
 * beyond what the margin alone says. Numbers are published numbers as
 * decimal strings without leading zeros. ponytail: the flag re-sends the whole
 * object on every write; move to a flagged journal page (as Extras' hexData)
 * if a map ever exceeds about 10 000 cells.
 *
 * TERRAIN and FEATURES are different things, and "river" is both (#196):
 *
 *   terrain   what the hex IS, one word. Terrain "river" is a river TILE: the
 *             whole hex is water. It rolls on a River column, makes the land
 *             beside it coastal, and is costed as river for travel.
 *   features  what runs through or sits in a land hex. A "river" feature is a
 *             river LINE through, say, a forest: it is exactly like a path. It
 *             never makes a hex wet, never makes a neighbour coastal and never
 *             chooses an encounter column. "coast" is derived from touching
 *             water tiles (deriveCoasts), and is the one feature an encounter
 *             column may follow (encounter-terrain.mjs).
 *
 * The persisted format stays `terrain;feature;feature|source`; older code
 * called the features "overlays", so a decoded cell still answers to that.
 */

import { neighbours, onMap } from "./geometry.mjs";
import { SETTLEMENTS } from "../importer/hex/hex-summary.mjs";

export const STORE_VERSION = 1;
export const FEATURES = ["river", "path", "coast"];

export function emptyState() {
  return { version: STORE_VERSION, origin: null, cells: new Map() };
}

/** `overlays`, the old name, as a read-only alias of `features`. Not enumerable, so it never reaches a write. */
const OVERLAYS_ALIAS = { get() { return this.features; }, enumerable: false };

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
    state.cells.set(String(parseInt(num, 10)), Object.defineProperty({
      terrain: tags[0], features: tags.slice(1).filter((t) => FEATURES.includes(t)),
      source: source || "gm", margin: margin !== undefined ? Number(margin) : undefined, review,
    }, "overlays", OVERLAYS_ALIAS));
  }
  return state;
}

/** State → flag object. */
export function encodeTags(state) {
  const cells = {};
  for (const [num, c] of state.cells) {
    if (!c?.terrain) continue;
    const tags = [c.terrain, ...(c.features ?? [])].join(";");
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
/**
 * Standing and running water a hex can be ON THE SHORE OF.
 *
 * Only terrain counts, never a feature: a hex whose terrain is lake or ocean
 * IS water, while a river crossing a forest is a line drawn through the hex,
 * the same as a path. Patrick: "if it's like a river going through it like
 * similar to a path that does not count that's something different."
 */
export const COASTAL_WATER = new Set(["arctic_sea", "ocean", "sea", "lake", "river"]);

/**
 * Mark every land hex that touches water as coast.
 *
 * The scanner reads a coastline badly — it is a thin line shared between two
 * hexes rather than a glyph inside one — but it reads sea, lake and river
 * reliably, and a coast is just a land hex beside them. So the feature is
 * derived from terrain the classifier is good at instead of detected from ink
 * it is bad at. Measured on the Western Reaches against the 270 keyed rows,
 * where the book prints the terrain words itself: this finds 13 of the book's
 * 13 coasts and misses none.
 *
 * Whether RIVER belongs in `water` is a judgement, not a fact. Including it is
 * what makes the recall perfect — 5 of those 13 touch only a river — but some
 * regions print a Coast column AND a River column in the same encounter grid
 * (Lowland Moor, Isles of Andrik), and a hex marked both matches both, which
 * the encounter picture then has to report as undecidable. Pass a narrower set
 * to drop it.
 *
 * Never changes a terrain and never removes a coast: this only ever adds one
 * where the map implies it. That includes hexes the GM tagged themselves. A
 * GM tags TERRAIN; the coast follows from the neighbours, which the GM did
 * not weigh when naming the hex forest. Skipping GM hexes (the old default)
 * left half of Take 4's shoreline untagged once half its cells had been
 * reviewed. Pass onlyAuto to keep GM hexes untouched.
 * @param {object} state           the tag store
 * @param {{water?:Set<string>, onlyAuto?:boolean}} [opts]
 * @returns {number[]} the hexes it marked
 */
export function deriveCoasts(state, { water = COASTAL_WATER, onlyAuto = false } = {}) {
  const shifted = state?.origin?.shifted ?? "odd";
  const marked = [];
  for (const [key, cell] of state?.cells ?? []) {
    if (!cell?.terrain || water.has(cell.terrain)) continue;          // water is not its own shore
    if (cell.features?.includes("coast")) continue;                    // already said
    if (onlyAuto && cell.source && cell.source !== "auto") continue;    // the GM's hex is the GM's
    const n = Number(key);
    if (!Number.isFinite(n)) continue;
    const wet = neighbours(Math.floor(n / 100), n % 100, shifted)
      .some(({ col, row }) => water.has(state.cells.get(String(col * 100 + row))?.terrain));
    if (!wet) continue;
    cell.features = [...new Set([...(cell.features ?? []), "coast"])];
    marked.push(n);
  }
  return marked.sort((a, b) => a - b);
}

export function strandedRiver(state, num) {
  const cell = state?.cells?.get(String(num));
  if (cell?.terrain !== "river" || cell.source !== "auto") return false;
  const n = Number(num);
  if (!Number.isFinite(n)) return false;
  for (const nb of neighbours(Math.floor(n / 100), n % 100, state.origin?.shifted ?? "odd")) {
    const other = state.cells.get(String(nb.col * 100 + nb.row));
    if (!other) continue;
    if (WET.has(other.terrain) || (other.features ?? []).includes("river")) return false;
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
 * Apply a sheet's answers. `answers` = { num: { terrain, features } }; an empty
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
      after = { terrain: a.terrain, features: (a.features ?? []).filter((t) => FEATURES.includes(t)), source: "gm" };
      state.cells.set(key, after);
    }
    transitions.push({ num: key, before, after });
  }
  return transitions;
}

/**
 * Tags in the shape hex-dataset's buildHexDataset takes: { num: { terrain, features } }.
 *
 * Cells the map does not have are dropped. A tag can arrive by NUMBER rather
 * than by position — a truth CSV, an exported tag file, tags written before the
 * map's size was set — so the store can hold a cell in the frame, and the
 * store is not where that is noticed. Shadowdark Extras bakes the grid into a
 * built scene and refuses a record outside it ("hex N is outside the published
 * grid"), which would surface as a failed hand-off AFTER the scene was built.
 * Dropping them here keeps that from ever leaving.
 *
 * Each cell goes out as readCell reads it, so a legacy "coast" terrain never
 * leaves as a terrain; a cell whose ground nothing names goes with its
 * features alone.
 */
export function tagsForDataset(state) {
  const shifted = state?.origin?.shifted ?? "odd";
  const bounds = state?.origin?.bounds;
  const out = {};
  for (const [num, c] of state?.cells ?? []) {
    if (!c?.terrain) continue;
    const n = parseInt(num, 10);
    if (!Number.isInteger(n) || !onMap(Math.floor(n / 100), n % 100, bounds, shifted)) continue;
    const { terrain, features } = readCell(state, n, c);
    out[String(num).padStart(3, "0")] = terrain ? { terrain, features } : { features };
  }
  return out;
}

/**
 * What a list of tags says about a hex, read the #196 way.
 *
 * The persisted store can hold a feature word where the terrain goes, and so
 * can a book's Terrain column: an imported row of features only ("coast;river")
 * keeps its first tag as the terrain (importTags), and the keyed row of a city
 * at a river mouth prints "Coast, river". Read here, never migrated:
 *   - the first land word is the terrain;
 *   - failing that, sea, ocean, lake or arctic sea is, a water tile;
 *   - "river" is a river tile only when nothing else says land: beside coast
 *     or path it is a river running through land to the shore, a feature;
 *   - coast and path are never terrain; with no land word the ground is
 *     unknown (null), and readCell asks the neighbours.
 * Order does not matter, so "coast;river" and "river;coast" read the same.
 * @param {string[]} words  tags or a keyed row's terrain words
 * @returns {{terrain:string|null, features:string[]}}  features in FEATURES order
 */
export function readTags(words) {
  const w = (words ?? []).filter(Boolean);
  const land = w.find((t) => !COASTAL_WATER.has(t) && !FEATURES.includes(t));
  const ashore = w.includes("coast") || w.includes("path");
  const tile = w.find((t) => COASTAL_WATER.has(t) && t !== "river") ?? (!ashore && w.includes("river") ? "river" : null);
  const terrain = land ?? tile ?? null;
  return { terrain, features: FEATURES.filter((f) => f !== terrain && w.includes(f)) };
}

/** What sits on a hex rather than the ground under it: never a neighbour's terrain. */
const NOT_GROUND = new Set([...Object.values(SETTLEMENTS), "keyed_location"]);

/**
 * One stored cell read by readTags, the ground filled in from the hex's
 * neighbours when nothing names it: the land terrain most of the six have
 * (water, settlements and keyed locations do not count), ties to the
 * alphabetically first, null when none has one. Only the neighbours' own
 * words are read, so the answer depends on nothing but the tags and is the
 * same on every send.
 * @returns {{terrain:string|null, features:string[]}|null} null for an untagged cell
 */
export function readCell(state, num, cell = state?.cells?.get(String(num))) {
  // `cell` is passed when the caller holds it under a key of its own ("001").
  if (!cell?.terrain) return null;
  const read = readTags([cell.terrain, ...(cell.features ?? [])]);
  if (read.terrain) return read;
  const n = Number(num), votes = new Map();
  for (const { col, row } of neighbours(Math.floor(n / 100), n % 100, state.origin?.shifted ?? "odd")) {
    const other = state.cells.get(String(col * 100 + row));
    const t = other?.terrain ? readTags([other.terrain, ...(other.features ?? [])]).terrain : null;
    if (t && !COASTAL_WATER.has(t) && !NOT_GROUND.has(t)) votes.set(t, (votes.get(t) ?? 0) + 1);
  }
  const ground = [...votes].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return { terrain: ground, features: read.features };
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
 * non-feature tag is the terrain, so "river;forest" and "forest;river" agree,
 * and a row of features only ("river" for a cell that is all water) keeps its
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
    const terrain = tags.find((t) => !FEATURES.includes(t)) ?? tags[0];
    if (!Number.isInteger(num) || num < 0 || !terrain) continue;
    const cell = { terrain, features: tags.filter((t) => FEATURES.includes(t) && t !== terrain), source: r.source === "auto" ? "auto" : "gm", review: !!r.review };
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
    return { origin: s.origin, rows: [...s.cells].map(([num, c]) => ({ num, tags: [c.terrain, ...c.features], source: c.source, margin: c.margin, review: c.review })) };
  }
  const byNum = new Map();
  const add = (num, tag) => { const k = String(parseInt(num, 10)); if (k === "NaN" || !tag) return; if (!byNum.has(k)) byNum.set(k, []); byNum.get(k).push(tag); };
  for (const r of obj?.terrain?.regions ?? []) for (const n of r.hexes ?? []) add(n, r.biome);
  for (const h of obj?.hexes ?? []) add(h.num, h.terrain);
  for (const [net, feature] of [["river", "river"], ["road", "path"]]) for (const n of obj?.networks?.[net] ?? []) add(n, feature);
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
        if (!tags.some((t) => !FEATURES.includes(String(t).trim().toLowerCase()))) add(col * 100 + row, fallback);
      }
    }
  }
  return { origin: null, rows: [...byNum].map(([num, tags]) => ({ num, tags, source: "gm" })) };
}
