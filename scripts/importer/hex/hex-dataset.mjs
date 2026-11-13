/**
 * Shadowdark Enhancer — hex numbers and hex art manifests (pure, Foundry-free).
 *
 * What is left of the Shadowdark Extras dataset builder now that the Enhancer draws hex maps itself
 * (docs/plans/hex-painting.md, step 6): reading a published hex number, a terrain's word, and a GM's own
 * tile-art manifest. Nothing here is handed to Extras any more.
 */

import { hexIdKey } from "../tables/hex-parser.mjs";

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

/** Published number as an integer ("0101" → 101), or null. */
export function hexNum(id) {
  const key = hexIdKey(paddedHexId(id));
  if (key === null) return null;
  return parseInt(paddedHexId(id), 10);
}
