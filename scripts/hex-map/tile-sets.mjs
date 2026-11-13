/**
 * Shadowdark Enhancer — which picture a hex wears (pure, Foundry-free, node-tested).
 *
 * Step 1 of docs/plans/hex-painting.md. The drawn map reads a hex's terrain from the tag store and
 * asks this file for its picture. Nothing is stored for the ordinary case: the same hex on the same
 * map always gets the same picture, and a GM's own choice for one hex (the `hexArt` flag) wins.
 *
 * The terrain-to-folder rules carry over what Shadowdark Extras learned (BIOME_TILES,
 * TERRAIN_COLORED_RULES, DRAW_EXCLUDES and FEATURE_COLORED_RULES in its HexcrawlBuilderSD /
 * hex-colored-tiles): plain desert never draws salt-flat art, the weak "(dark)" jungle recolour
 * stays out of the pool, and a numbered Specials tile ("657_Extinct_Volcano.webp") is one keyed
 * location's own picture, never a generic terrain's.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { lcg } from "./tag-store.mjs";

/** Where the shipped hex art lives, as Foundry serves it. */
export const HEX_ART_ROOT = `modules/${MODULE_ID}/assets/hexes/`;

/** "Salt Flat", "salt_flat", "salt-flat" all read as salt_flat; folder names read the same way. */
export const normTerrain = (t) => String(t ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/**
 * Tag-store terrain (hex-summary TERRAIN_TAGS, plus settlements) → folder, with substrings of the
 * lower-cased file name a file must hold (`include`, any one) or must not (`exclude`).
 * A terrain with no rule falls back to a folder of its own name ("snow", "badlands", "autumn").
 */
export const TERRAIN_RULES = {
  arctic_sea: { folder: "Water-Arctic" },
  ocean: { folder: "Water" },
  sea: { folder: "Water" },
  lake: { folder: "Water-Lake" },
  river: { folder: "Water-River" },
  // "coast" is land on a shore, as the tagger and Extras both read it: painting it as sea put a beach in open water.
  coast: { folder: "Vegetation", include: ["plains"] },
  grassland: { folder: "Vegetation", include: ["plains"] },
  path: { folder: "Vegetation", include: ["plains"] },
  hills: { folder: "Vegetation", include: ["hill"] },
  forest: { folder: "Vegetation", include: ["forest", "trees"] },
  jungle: { folder: "Jungle", exclude: ["(dark)"] },
  mountain: { folder: "Mountains", exclude: ["bridge", "mountains spikes"] },
  deep_tunnels: { folder: "Specials", include: ["rocky"] },
  volcano: { folder: "Specials", include: ["volcano"] },
  lava: { folder: "Lava Fields" },
  canyon: { folder: "Canyons" },
  swamp: { folder: "swamp" },
  desert: { folder: "Desert", exclude: ["salt flat"] },
  salt_flat: { folder: "Salt Flats" },
  // A settlement draws as its settlement, not its ground; thirty villages are thirty farmsteads.
  village: { folder: "Specials", include: ["farm (lush)"] },
  town: { folder: "Specials", include: ["town (lush)", "modern town, inhabited"] },
  city: { folder: "Specials", include: ["city (lush)"] },
  city_state: { folder: "Specials", include: ["city (lush)"] },
};

/** One keyed location's own picture: never dealt to a generic terrain. */
const KEYED_SPECIAL = /^\d+_/;

/**
 * The files `terrain` may draw, as paths under HEX_ART_ROOT ("Vegetation/forest.webp"), in manifest
 * order. Empty when nothing fits: an unknown terrain, or a rule whose folder holds no match.
 * @param {string} terrain
 * @param {{folders: Record<string, string[]>}} manifest  assets/hexes/manifest.json
 * @returns {string[]}
 */
export function poolFor(terrain, manifest) {
  const key = normTerrain(terrain);
  const folders = manifest?.folders ?? {};
  const rule = Object.hasOwn(TERRAIN_RULES, key)
    ? TERRAIN_RULES[key]
    : { folder: Object.keys(folders).find((name) => normTerrain(name) === key) };
  const files = (rule.folder && folders[rule.folder]) || [];
  return files
    .filter((file) => {
      const text = file.toLowerCase();
      return !KEYED_SPECIAL.test(file)
        && (!rule.include || rule.include.some((part) => text.includes(part)))
        && !rule.exclude?.some((part) => text.includes(part));
    })
    .map((file) => `${rule.folder}/${file}`);
}

/** FNV-1a: a stable 32-bit number for a string. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

const mod = (a, n) => ((a % n) + n) % n;

/**
 * The picture of `pool` a hex at cube {q, r} wears.
 *
 * No two touching hexes of the same pool share a picture once the pool holds three or more: the
 * index is (q + a·r) mod n with a in [2, n-1], so the six neighbours differ from the hex by ±1, ±a
 * and ±(a-1), none of which is 0 mod n. The terrain picks a and shuffles which picture each index
 * means, so two terrains with pools of the same size don't line up.
 * ponytail: the layout repeats every n hexes along a line; if that shows on a real map, vary a per
 * region and check region borders keep the no-repeat rule.
 * @param {string[]} pool
 * @param {{q:number, r:number}} cube
 * @param {string} terrain
 * @returns {string|null}
 */
export function pickTile(pool, { q, r }, terrain) {
  const n = pool?.length ?? 0;
  if (!n) return null;
  if (n < 3) return pool[mod(q + 2 * r, n)]; // a hex grid can't be coloured with fewer than three
  const seed = hash(normTerrain(terrain));
  const a = 2 + (seed % (n - 2));
  const order = [...pool.keys()];
  const rng = lcg(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return pool[order[mod(q + a * r, n)]];
}

/**
 * The ground picture a hex is dealt, or null when nothing fits. A hex's own picture is not ground: it is the
 * `hexArt` flag's ({ "1403": { art } }, keyed-art.mjs), drawn over this where the fog allows (hex-art-core.mjs).
 * @param {{terrain:string, cube:{q:number, r:number}, manifest:object}} hex
 * @returns {string|null}
 */
export function tileFor({ terrain, cube, manifest }) {
  const picked = pickTile(poolFor(terrain, manifest), cube, terrain);
  return picked ? HEX_ART_ROOT + picked : null;
}
