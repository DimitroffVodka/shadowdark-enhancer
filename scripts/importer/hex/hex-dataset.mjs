/**
 * Shadowdark Enhancer — hexcrawl dataset builder (pure, Foundry-free).
 *
 * Produces the dataset Shadowdark Extras' hexcrawl builder consumes
 * (shadowdark-extras#141), from any mix of: hexcrawl drafts (hex-parser),
 * keyed summary rows (hex-summary), and per-hex tags from the tagger
 * (Phase 2). Hex numbers only at the boundary: `num` is the published number
 * as an integer; column and row never appear. The emitted file stays
 * column-major until the compatible Extras contract lands (see
 * docs/plans/hex-map-dataset.md §2).
 *
 * Numbering convention carried inside `grid` for the consumer: the leading
 * digits are the column, the last two the row (`hexIdKey`), so 1403 is column
 * 14, row 03 and `grid.cols`/`grid.rows` count those axes.
 */

import { hexIdKey, buildHexPageHtml, rewriteHexPlaceholders } from "../tables/hex-parser.mjs";

export const DATASET_VERSION = 1;

/** Overlay tags become networks, not terrain. The book's "path" is Extras' road. */
export const OVERLAY_TO_NETWORK = { river: "river", path: "road" };

/** Generic tag → the biome keys the Extras tile set actually accepts. */
export const TERRAIN_TO_BIOME = Object.freeze({
  arctic_sea: "water", ocean: "water", lake: "water", coast: "water",
  river: "water", mountain: "mountains", volcano: "mountains", lava: "mountains",
  canyon: "hills", forest: "forest", jungle: "forest", grassland: "plains",
  swamp: "swamp", desert: "plains", salt_flat: "plains", path: "plains",
  deep_tunnels: "hills",
});

const paddedHexId = (id) => {
  const s = String(id ?? "").trim();
  return typeof id === "number" && /^\d{1,2}$/.test(s) ? s.padStart(3, "0") : s;
};

const hexKeyForNum = (num) => hexIdKey(String(num).padStart(3, "0"));

const biomeForTerrain = (terrain) => TERRAIN_TO_BIOME[String(terrain ?? "").trim().toLowerCase()] ?? "forest";

/** Published number as an integer ("0101" → 101), or null. */
export function hexNum(id) {
  const key = hexIdKey(paddedHexId(id));
  if (key === null) return null;
  return parseInt(paddedHexId(id), 10);
}

/**
 * @param {object} args
 * @param {string} [args.name]           dataset / scene name
 * @param {string} [args.source]         Enhancer source key or label, informational
 * @param {object[]} [args.drafts]       hex-parser drafts; a draft may carry `html` (already built page HTML) instead of bodyLines
 * @param {object[]} [args.summaryRows]  hex-summary rows
 * @param {Object<string,{terrain?:string, overlays?:string[]}>} [args.tags]  per published number (string or int keys)
 * @param {{cols:number, rows:number}} [args.gridHint]
 * @returns {object} dataset
 */
export function buildHexDataset({ name = "", source = "", drafts = [], summaryRows = [], tags = {}, gridHint } = {}) {
  const byNum = new Map();
  const slot = (num) => { if (!byNum.has(num)) byNum.set(num, { num }); return byNum.get(num); };

  for (const r of summaryRows) {
    const num = hexNum(r?.num);
    if (num === null) continue;
    const h = slot(num);
    h.name = r.name || h.name;
    h.zone = r.zone || h.zone;
    h.terrain = r.terrain?.[0] || h.terrain;
    h.feature = r.feature || h.feature;
    for (const t of r.terrain?.slice(1) ?? []) if (OVERLAY_TO_NETWORK[t]) (h.overlays ??= new Set()).add(t);
  }
  const keySet = new Set(drafts.map((d) => d?.key).filter(Boolean));
  for (const d of drafts) {
    const num = hexNum(d?.hexId);
    if (num === null) continue;
    const h = slot(num);
    if (!h.name && d.name) h.name = d.name;
    const html = d.html ?? buildHexPageHtml(d, keySet);
    // Links to hexes exist only once pages do; in a dataset the label is enough.
    h.desc = rewriteHexPlaceholders(html, new Map());
    if (h.desc === "<p></p>") h.desc = "";
  }
  for (const [k, t] of Object.entries(tags ?? {})) {
    const num = hexNum(k);
    if (num === null || !t) continue;
    const h = slot(num);
    if (t.terrain) h.terrain = h.terrain || t.terrain;   // a keyed row's terrain wins over a tag
    for (const o of t.overlays ?? []) if (OVERLAY_TO_NETWORK[o]) (h.overlays ??= new Set()).add(o);
  }

  // Terrain regions and networks.
  const regions = new Map(); const networks = { river: [], road: [] };
  let maxCol = -1, maxRow = -1;
  for (const h of byNum.values()) {
    const [c, r] = hexKeyForNum(h.num).split(",").map(Number);
    maxCol = Math.max(maxCol, c); maxRow = Math.max(maxRow, r);
    if (h.terrain) {
      const biome = biomeForTerrain(h.terrain);
      if (!regions.has(biome)) regions.set(biome, []);
      regions.get(biome).push(h.num);
    }
    for (const o of h.overlays ?? []) networks[OVERLAY_TO_NETWORK[o]].push(h.num);
  }
  const counts = [...regions.entries()].sort((a, b) => (b[1].length - a[1].length) || a[0].localeCompare(b[0]));
  const hexes = [...byNum.values()].filter((h) => h.name).sort((a, b) => a.num - b.num).map((h) => ({
    num: h.num, name: h.name, terrain: h.terrain ?? "", desc: h.desc ?? "", zone: h.zone ?? "", icon: "", feature: h.feature ?? "keyed_location",
  }));

  return {
    version: DATASET_VERSION,
    name, source,
    grid: {
      cols: gridHint?.cols ?? (maxCol + 1), rows: gridHint?.rows ?? (maxRow + 1),
      distance: 6, units: "mi", landscape: false, flipX: false, flipY: false,
      numbering: "column-major",   // leading digits = column, last two = row
    },
    terrain: {
      default: counts[0]?.[0] ?? "forest",
      regions: counts.map(([biome, nums]) => ({ biome, hexes: nums.sort((a, b) => a - b) })),
    },
    hexes,
    networks: { river: networks.river.sort((a, b) => a - b), road: networks.road.sort((a, b) => a - b) },
  };
}

/**
 * Contract check before hand-off or download.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateHexDataset(ds) {
  const errors = [];
  const isNum = (n) => Number.isInteger(n) && n >= 0;
  if (!ds || typeof ds !== "object") return { ok: false, errors: ["not an object"] };
  if (!Array.isArray(ds.hexes)) errors.push("hexes missing");
  const seen = new Set();
  for (const h of ds.hexes ?? []) {
    if (!isNum(h.num)) errors.push(`hex num not an integer: ${JSON.stringify(h.num)}`);
    else if (seen.has(h.num)) errors.push(`duplicate hex num ${h.num}`);
    seen.add(h.num);
    if (!h.name) errors.push(`hex ${h.num} has no name`);
    if ("col" in h || "row" in h) errors.push(`hex ${h.num} carries col/row — numbers only at the boundary`);
  }
  for (const r of ds.terrain?.regions ?? []) {
    if (!r.biome) errors.push("region without a biome");
    for (const n of r.hexes ?? []) if (!isNum(n)) errors.push(`region ${r.biome} has a non-integer hex ${JSON.stringify(n)}`);
  }
  for (const kind of ["river", "road"]) for (const n of ds.networks?.[kind] ?? []) if (!isNum(n)) errors.push(`network ${kind} has a non-integer hex`);
  if (!isNum(ds.grid?.cols) || !isNum(ds.grid?.rows)) errors.push("grid cols/rows missing");
  return { ok: errors.length === 0, errors };
}
