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
 * 14, row 03 and `grid.cols`/`grid.rows` count those axes. `grid.origin` is
 * 0 for a map that numbers its own first column and row 0 (the Western
 * Reaches: hex 0000 exists) and is omitted for the contract's default of 1
 * (shadowdark-extras#145). `grid.rowsLowered` goes out only when the lowered
 * columns end one row short of the others. `grid.firstRow` preserves a clipped
 * top half-cell when the raised columns begin one row after the map's origin.
 */

import { hexIdKey, buildHexPageHtml, rewriteHexPlaceholders } from "../tables/hex-parser.mjs";

export const DATASET_VERSION = 1;

/** Overlay tags become networks, not terrain. The book's "path" is Extras' road. */
export const OVERLAY_TO_NETWORK = { river: "river", path: "road" };

/**
 * Terrain goes out as the book's word ("salt flat", "deep tunnels"), never a
 * biome key: Extras' stable contract keeps the label on the record and maps it
 * to a painted biome itself (its Developer API, "Terrain labels versus painted
 * biomes"). Tags carry underscores; the contract's table has spaces.
 */
export const terrainWord = (t) => String(t ?? "").trim().toLowerCase().replace(/_/g, " ");

/** Where Extras' art lives. Assignment manifests name files relative to it. */
export const EXTRAS_ASSETS = "modules/shadowdark-extras/assets/";

/**
 * A GM's own tile-art manifest, normalised.
 *
 * The map's art is curated by hand outside this module — which hex gets which
 * painted tile, and which centre icon sits on top — and that curation is the
 * GM's, not ours: no manifest, and nothing from any book, ships here. This only
 * has to be able to READ one, in either shape the curation tends to arrive in:
 *
 *   { "643": { base_hex: "Hexes/Specials/goblinhole.webp", overlay_asset: "" } }
 *   [ { "Hex #": 643, "Base Hex": "...", "Overlay Asset": "..." } ]
 *
 * Ids that are not published hex numbers are dropped, not coerced. A manifest
 * can legitimately carry rows for a place that has no coordinates on this map
 * (an underworld level keyed M104, say); coercing those onto the surface grid
 * would paint a tile somewhere arbitrary.
 *
 * @param {object|object[]} manifest
 * @returns {Object<number, {art:string, icon?:string}>} by published number
 */
export function assignmentsFromManifest(manifest) {
  const rows = Array.isArray(manifest)
    ? manifest
    : Object.entries(manifest ?? {}).map(([id, v]) => ({ ...v, _id: id }));
  const out = {};
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const num = hexNum(r._id ?? r.hex_id ?? r["Hex #"] ?? r.num);
    if (num === null) continue;
    const base = String(r.art ?? r.base_hex ?? r["Base Hex"] ?? "").trim();
    if (!base) continue;
    const icon = String(r.icon ?? r.overlay_asset ?? r["Overlay Asset"] ?? "").trim();
    const full = (p) => (p.startsWith("modules/") ? p : EXTRAS_ASSETS + p);
    out[num] = icon ? { art: full(base), icon: full(icon) } : { art: full(base) };
  }
  return out;
}

const paddedHexId = (id) => {
  const s = String(id ?? "").trim();
  return typeof id === "number" && /^\d{1,2}$/.test(s) ? s.padStart(3, "0") : s;
};

const hexKeyForNum = (num) => hexIdKey(String(num).padStart(3, "0"));

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
 * @param {Object<string|number,{art:string, icon?:string}>} [args.assignments]  per-hex tile art (assignmentsFromManifest)
 * @param {{cols:number, rows:number, origin?:0|1, firstRow?:number, rowsLowered?:number}} [args.gridHint]  the map's size and numbering
 *   origin as the tagger knows them; without a hint the origin is 0 when any hex sits in column 0 or row 0
 * @returns {object} dataset
 */
export function buildHexDataset({ name = "", source = "", drafts = [], summaryRows = [], tags = {}, assignments = {}, gridHint } = {}) {
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

  // Curated art, last: it names a file and says nothing about terrain, so it
  // neither creates nor changes a hex's own answer. Extras strips both fields
  // before the record is written — they are for the paint pass only.
  for (const [k, a] of Object.entries(assignments ?? {})) {
    const num = hexNum(k);
    if (num === null || !a?.art) continue;
    const h = slot(num);
    h.art = a.art;
    if (a.icon) h.icon = a.icon;
  }

  // Terrain regions and networks.
  const regions = new Map(); const networks = { river: [], road: [] };
  let maxCol = -1, maxRow = -1, minCol = Infinity, minRow = Infinity;
  for (const h of byNum.values()) {
    const [c, r] = hexKeyForNum(h.num).split(",").map(Number);
    maxCol = Math.max(maxCol, c); maxRow = Math.max(maxRow, r);
    minCol = Math.min(minCol, c); minRow = Math.min(minRow, r);
    const word = terrainWord(h.terrain);
    if (word) { if (!regions.has(word)) regions.set(word, []); regions.get(word).push(h.num); }
    for (const o of h.overlays ?? []) networks[OVERLAY_TO_NETWORK[o]].push(h.num);
  }
  const counts = [...regions.entries()].sort((a, b) => (b[1].length - a[1].length) || a[0].localeCompare(b[0]));
  // Only the fields Extras' builder accepts (it rejects any other key: see
  // RECORD_FIELDS in its HexcrawlBuilderSD).
  //
  // A record is emitted for every hex we know ANYTHING about, not only the
  // keyed ones. `terrain` is a per-hex string there, and it is the only place
  // the book's own word survives: the painted tile comes from terrain.regions,
  // whose biome vocabulary is much coarser than the book's — measured on a real
  // hand-off, Extras paints arctic sea, lake and river all as ocean, salt flat
  // as desert, jungle as forest and canyon as hills. Sending the word per hex
  // costs one short record and keeps "arctic sea" on the hex the GM opens,
  // whatever the art under it ends up being.
  //
  // The book's settlement marker still has no field of its own; it stays on the
  // crawl entry's keyed rows.
  const hexes = [...byNum.values()]
    .filter((h) => h.name || h.terrain || h.desc || h.zone || h.art)
    .sort((a, b) => a.num - b.num).map((h) => {
      const out = { num: h.num };
      if (h.name) out.name = h.name;
      const word = terrainWord(h.terrain);
      if (word) out.terrain = word;
      if (h.desc) out.desc = h.desc;
      if (h.zone) out.zone = h.zone;
      if (h.art) out.art = h.art;
      if (h.icon) out.icon = h.icon;
      return out;
    });

  const origin = gridHint?.origin === 0 || gridHint?.origin === 1 ? gridHint.origin : ((minCol === 0 || minRow === 0) ? 0 : 1);
  const grid = {
    cols: gridHint?.cols ?? Math.max(1, maxCol + 1 - origin), rows: gridHint?.rows ?? Math.max(1, maxRow + 1 - origin),
    distance: 6, units: "mi", landscape: false, flipX: false, flipY: false,
  };
  if (origin === 0) grid.origin = 0;
  if (Number.isInteger(gridHint?.firstRow) && gridHint.firstRow !== origin) grid.firstRow = gridHint.firstRow;
  if (Number.isInteger(gridHint?.rowsLowered) && gridHint.rowsLowered !== grid.rows) grid.rowsLowered = gridHint.rowsLowered;
  return {
    version: DATASET_VERSION,
    name, source,
    grid,
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
    // A name is not required: Extras does not ask for one, and a hex that
    // carries only its terrain is the ordinary case on a tagged map.
    if (!h.name && !h.terrain && !h.desc && !h.zone && !h.art) errors.push(`hex ${h.num} carries nothing`);
    for (const key of ["art", "icon"]) {
      if (key in h && typeof h[key] !== "string") errors.push(`hex ${h.num} ${key} must be text`);
    }
    if ("col" in h || "row" in h) errors.push(`hex ${h.num} carries col/row — numbers only at the boundary`);
  }
  for (const r of ds.terrain?.regions ?? []) {
    if (!r.biome) errors.push("region without a biome");
    for (const n of r.hexes ?? []) if (!isNum(n)) errors.push(`region ${r.biome} has a non-integer hex ${JSON.stringify(n)}`);
  }
  for (const kind of ["river", "road"]) for (const n of ds.networks?.[kind] ?? []) if (!isNum(n)) errors.push(`network ${kind} has a non-integer hex`);
  if (!isNum(ds.grid?.cols) || !isNum(ds.grid?.rows)) errors.push("grid cols/rows missing");
  // Every hex must sit inside the grid we declare, because the consumer checks
  // exactly that and refuses the whole build over the first one that does not.
  // The grid used to be described from the tagger's in-memory sample while the
  // hexes came from the saved tags, so the two could disagree and the first we
  // heard of it was Extras throwing. Checked here, it names the real problem.
  if (isNum(ds.grid?.cols) && isNum(ds.grid?.rows)) {
    const g = ds.grid, org = g.origin ?? 1, first = g.firstRow ?? org, lowered = g.rowsLowered ?? g.rows;
    const outside = [];
    for (const h of ds.hexes ?? []) {
      if (!isNum(h.num)) continue;
      const [c, r] = hexKeyForNum(h.num).split(",").map(Number);
      // Lowered columns (odd, as the consumer counts them from the origin) keep
      // their top cell and lose their bottom one; raised columns the reverse.
      const low = (c - org) % 2 === 1;
      const ok = c >= org && c < g.cols + org
        && r >= (low ? org : first) && r < g.rows + org
        && !(low && r >= lowered + org);
      if (!ok) outside.push(h.num);
    }
    if (outside.length) {
      errors.push(`${outside.length} hex${outside.length === 1 ? "" : "es"} outside the ${g.cols}×${g.rows} grid`
        + ` (origin ${org}${g.firstRow !== undefined ? `, first row ${g.firstRow}` : ""}): ${outside.slice(0, 5).join(", ")}`);
    }
  }
  const g = ds.grid ?? {};
  if (g.origin !== undefined && g.origin !== 0 && g.origin !== 1) errors.push("grid.origin must be 0 or 1");
  const origin = g.origin ?? 1;
  if (g.firstRow !== undefined && ![origin, origin + 1].includes(g.firstRow)) errors.push("grid.firstRow must be origin or origin + 1");
  if (g.rowsLowered !== undefined && !(Number.isInteger(g.rowsLowered) && (g.rowsLowered === g.rows || g.rowsLowered === g.rows - 1))) errors.push("grid.rowsLowered must be rows or rows - 1");
  return { ok: errors.length === 0, errors };
}
