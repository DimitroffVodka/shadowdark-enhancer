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
 * Pick the next sheet of cells to show.
 * @param {object} state
 * @param {object} opts
 * @param {number[]} opts.nums        every numbered cell on the map
 * @param {number} [opts.size=40]
 * @param {"random"|"keyed"|"review"} [opts.mode="random"]
 * @param {Set<number>} [opts.keyed]  numbers of keyed hexes (from the crawl entry)
 * @param {number} [opts.reviewMargin=1.3]
 * @param {() => number} [opts.rng]
 * @returns {number[]}
 */
export function nextSheet(state, { nums, size = 40, mode = "random", keyed = new Set(), reviewMargin = 1.3, rng = Math.random } = {}) {
  const tagged = (n) => state.cells.get(String(n));
  let pool;
  if (mode === "keyed") pool = nums.filter((n) => keyed.has(n) && !tagged(n));
  else if (mode === "review") pool = nums.filter((n) => { const c = tagged(n); return c && c.source === "auto" && (c.review || (c.margin !== undefined && c.margin < reviewMargin)); });
  else pool = nums.filter((n) => !tagged(n));
  // Fisher–Yates on a copy, then take the first `size`.
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; }
  return a.slice(0, size).sort((x, y) => x - y);
}

/**
 * Apply a sheet's answers. `answers` = { num: { terrain, overlays } }; an empty
 * terrain clears the cell. GM answers always carry source "gm".
 */
export function applySheet(state, answers) {
  for (const [num, a] of Object.entries(answers ?? {})) {
    const key = String(parseInt(num, 10));
    if (!a?.terrain) { state.cells.delete(key); continue; }
    state.cells.set(key, { terrain: a.terrain, overlays: (a.overlays ?? []).filter((t) => OVERLAYS.includes(t)), source: "gm" });
  }
  return state;
}

/** Tags in the shape hex-dataset's buildHexDataset takes: { num: { terrain, overlays } }. */
export function tagsForDataset(state) {
  const out = {};
  for (const [num, c] of state.cells) if (c?.terrain) out[num] = { terrain: c.terrain, overlays: c.overlays ?? [] };
  return out;
}

/** Counts for the header. */
export function summarize(state, total) {
  let gm = 0, auto = 0;
  for (const c of state.cells.values()) { if (c.source === "auto") auto++; else gm++; }
  return { total, tagged: gm + auto, gm, auto, untagged: Math.max(0, total - gm - auto) };
}
