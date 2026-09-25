/**
 * Shadowdark Enhancer — which region is a hex in?
 *
 * A hexcrawl book prints the region on every keyed row ("1251  Tallow Jungle
 * Jungle, path  Bone Choir"), and hex-commit files those rows on the crawl
 * entry, so after a key-location import the module knows the region of every
 * KEYED hex exactly. It knows nothing about the other four thousand: region
 * shapes are the publisher's map, so no region table ships here (D1) and none
 * can be read out of the book's text.
 *
 * Two sources, best first. When the map has been scanned for region borders
 * (region-scan.mjs) the answer is EXACT for every hex inside an enclosure that
 * holds a keyed hex: the print drew the border, the book named what is inside
 * it, and nothing was guessed. That covers 98% of the Western Reaches.
 *
 * Failing that — no scan, or an enclosure with no keyed hex in it, which is
 * what a coastline or a lake ring carves off — a hex takes the region of the
 * NEAREST keyed hex, by hex distance on the printed grid. Measured on the
 * Western Reaches against the region the book prints on each of its 270 keyed
 * rows, holding each row out and answering it from the other 269 (2026-09-21):
 * 229 right, 41 wrong — 84.8%, on the hexes the book keyed. An earlier
 * unreviewed vision pass over the whole map puts it at 83.9% over all 4498
 * unkeyed hexes, which is the same number from a source that cannot be
 * trusted to be right. Ten of the fifteen regions score 89-100%. The losses are
 * boundary hexes plus one structural case — The Last Sea is 984 hexes with 14
 * keyed rows in it, so the coastal regions eat its edges (66% there).
 *
 * Every answer says which kind it is: `exact` is the book's own word for a
 * keyed hex, anything else is this guess with the distance it was made from.
 *
 * ponytail: nearest keyed seed, nothing stored. Growing the regions over the
 * tagger's terrain tags instead of straight-line distance was measured too and
 * bought 1.8 points (85.7%) for a second data dependency — not worth it. The
 * real upgrade is a region layer the GM can paint or import the way terrain
 * tags already work (tag-store.mjs); these seeds are what would prefill it.
 */

import { offsetToCube, originOffset, hexDistance } from "./geometry.mjs";
import { decodeRegions, decodeRegionFixes, REGIONS_FLAG } from "./region-scan.mjs";
import { KEY_LOCATION_PAGES } from "../importer/char-content/char-content-manifest.mjs";
import { hexNum } from "../importer/hex/hex-dataset.mjs";
import { HEX_FLAG } from "../importer/hex/hex-commit.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { assignRegionColors, extrasPalette, REGION_COLORS } from "./tag-overlay.mjs";

/** Cube of a published hex number under the map's column-shift rule, or null. */
function cubeOfNum(id, shifted) {
  const n = hexNum(id);
  if (n === null) return null;
  const o = originOffset({ num: String(n).padStart(3, "0") });
  return o ? offsetToCube(o.col, o.row, shifted) : null;
}

/** Every region name the module has a page map for, across all books. */
export function knownRegions() {
  return new Set(Object.values(KEY_LOCATION_PAGES).flatMap((book) => Object.keys(book)));
}

/**
 * Region seeds from filed crawl entries: one per keyed row that names a region.
 *
 * ONE SPELLING PER REGION, and which one matters. A book prints "Bastion Mtns"
 * in its keyed-location table while its own chapter heading — and therefore the
 * roll tables imported from it, "Bastion Mountains Encounter Zone: Coast" —
 * says "Bastion Mountains". Anything that looks a region's tables up by name
 * needs the second, so a crawl titled with a region THIS MODULE KNOWS (the
 * page map in char-content-manifest, which is where the table names come from
 * too) wins over the row's printed word.
 *
 * The row's zone is what answers for a crawl the module has no page map for —
 * a hand-pasted table, or one book's regions under another's title — where the
 * printed word is the only region name there is.
 *
 * @param {Array<JournalEntry|{flags:object}>} entries  crawl entries (hex-commit)
 * @returns {Array<{num:number, region:string}>} first seed per hex number wins
 */
export function regionSeeds(entries) {
  const known = knownRegions();
  const byNum = new Map();
  for (const entry of entries ?? []) {
    const flag = entry?.getFlag?.(MODULE_ID, HEX_FLAG) ?? entry?.flags?.[MODULE_ID]?.[HEX_FLAG] ?? {};
    const crawl = String(flag.crawl ?? "").trim();
    const canonical = known.has(crawl) ? crawl : "";
    for (const row of flag.keyed ?? []) {
      const num = hexNum(row?.num);
      const region = canonical || String(row?.zone ?? "").trim() || crawl;
      if (num === null || !region || byNum.has(num)) continue;
      byNum.set(num, { num, region });
    }
  }
  return [...byNum.values()];
}

/**
 * The region of one hex: its own when it is keyed, else the nearest seed's.
 * Ties go to the lowest seed number, so the same seeds always answer the same.
 * @param {string|number} id  published hex number
 * @param {Array<{num:number, region:string}>} seeds
 * @param {{shifted?:"odd"|"even"}} [opts]  which columns the map lowers
 * @returns {{num:number, region:string, exact:boolean, distance:number, seed:number}|null}
 */
export function nearestRegion(id, seeds, { shifted = "odd" } = {}) {
  const num = hexNum(id);
  const cube = cubeOfNum(id, shifted);
  if (num === null || !cube) return null;
  let best = null;
  for (const s of seeds ?? []) {
    const c = cubeOfNum(s?.num, shifted);
    if (!c || !s.region) continue;
    const distance = hexDistance(cube, c);
    if (!best || distance < best.distance || (distance === best.distance && s.num < best.seed)) {
      best = { num, region: s.region, exact: distance === 0, distance, seed: s.num };
    }
  }
  return best;
}

/** Every crawl entry filed by the hex importer, from the managed journals pack. */
export async function crawlEntries() {
  const pack = findSuitePack("journal");
  if (!pack) return [];
  const docs = await pack.getDocuments();
  return docs.filter((d) => d.getFlag(MODULE_ID, HEX_FLAG)?.crawl);
}

/**
 * Name each border enclosure from the keyed hexes inside it.
 *
 * A component holding keyed hexes of two different regions means a border was
 * missed and two regions ran together; it is reported rather than silently
 * resolved, because the majority vote would then label real hexes wrongly and
 * nothing downstream would know. On the Western Reaches there are none.
 * @param {Map<number, number>} components  published number → component id
 * @param {Array<{num:number, region:string}>} seeds
 * @returns {{byNum:Map<number,string>, regions:Map<number,{region:string, seeds:number, conflict:string[]}>}}
 */
export function nameComponents(components, seeds) {
  const seedRegion = new Map((seeds ?? []).map((s) => [s.num, s.region]));
  const tally = new Map();
  for (const [num, id] of components ?? []) {
    const region = seedRegion.get(num);
    if (!region) continue;
    if (!tally.has(id)) tally.set(id, new Map());
    const t = tally.get(id);
    t.set(region, (t.get(region) ?? 0) + 1);
  }
  const regions = new Map();
  for (const [id, t] of tally) {
    // Most keyed hexes wins; the name breaks a tie so one map always answers
    // the same way. `conflict` lists every other region caught in there.
    const ranked = [...t].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    regions.set(id, {
      region: ranked[0][0],
      seeds: [...t.values()].reduce((a, b) => a + b, 0),
      conflict: ranked.slice(1).map(([r]) => r),
    });
  }
  const byNum = new Map();
  for (const [num, id] of components ?? []) {
    const hit = regions.get(id);
    if (hit) byNum.set(num, hit.region);
  }
  return { byNum, regions };
}

/** The region components scanned onto a scene, or an empty map. */
export function sceneRegions(scene = globalThis.canvas?.scene) {
  return decodeRegions(scene?.getFlag?.(MODULE_ID, REGIONS_FLAG));
}

/** The GM's own region corrections on a scene, which outrank everything else. */
export function sceneRegionFixes(scene = globalThis.canvas?.scene) {
  return decodeRegionFixes(scene?.getFlag?.(MODULE_ID, REGIONS_FLAG));
}

/**
 * Which region is this hex in?
 *
 * Reads the scanned borders on the active scene first and the filed crawls for
 * the names. Pass `seeds` and `components` when asking about many hexes at
 * once, so the pack and the flag are read once.
 * @param {string|number} id
 * @param {{seeds?:Array<{num:number,region:string}>, components?:Map<number,number>,
 *   scene?:object, shifted?:"odd"|"even"}} [opts]
 * @returns {Promise<{num:number, region:string, exact:boolean, via:"border"|"nearest",
 *   distance:number, seed:number|null}|null>}
 */
export async function regionOf(id, { seeds, components, scene, shifted } = {}) {
  const num = hexNum(id);
  if (num === null) return null;
  seeds ??= regionSeeds(await crawlEntries());
  components ??= sceneRegions(scene);
  // The GM's correction wins over anything read off the print or reasoned from it.
  const fixed = sceneRegionFixes(scene).get(num);
  if (fixed) return { num, region: fixed, via: "gm", exact: true, distance: 0, seed: null };
  if (components?.size) {
    const { byNum } = nameComponents(components, seeds);
    const region = byNum.get(num);
    // The print drew the border and the book named what is inside it, so the
    // only guess left is none: distance 0, and `exact` still means what it
    // always did — the book keyed THIS hex.
    if (region) return {
      num, region, via: "border", distance: 0,
      exact: seeds.some((s) => s.num === num && s.region === region),
      seed: null,
    };
  }
  const near = nearestRegion(num, seeds, { shifted });
  return near && { ...near, via: "nearest" };
}

/** "#rrggbb" for a 0xRRGGBB fill, the only colour form Extras' zoneColor accepts. */
const cssHex = (n) => `#${n.toString(16).padStart(6, "0")}`;

/**
 * A zone name and colour for EVERY hex a region scan covers, for the hand-off
 * to Extras. Without it only the keyed hexes carry a zone and Extras fills the
 * other ~95% with the dataset's name, so a whole map reads "Western Reaches".
 *
 * Each hex resolves exactly as regionOf resolves one — the GM's fix, then the
 * named border enclosure, then the nearest keyed hex — and the names are the
 * seeds' canonical ones ("Rimespire Mountains", not the row's "Rimespire
 * Mtns"). Colours are the overlay's: no two touching regions share one.
 *
 * No scan, or no seeds, is an empty map: nothing to say beyond the keyed rows.
 * @param {{components?:Map<number,number>, fixes?:Map<number,string>,
 *   seeds?:Array<{num:number,region:string}>, shifted?:"odd"|"even", palette?:number[]}} args
 * @returns {{byNum:Map<number,{zone:string, zoneColor:string}>,
 *   via:{gm:number, border:number, nearest:number}, conflicts:string[]}}
 */
export function hexZones({ components = new Map(), fixes = new Map(), seeds = [], shifted = "odd", palette = REGION_COLORS } = {}) {
  const via = { gm: 0, border: 0, nearest: 0 };
  if (!components.size || !seeds.length) return { byNum: new Map(), via, conflicts: [] };
  const { byNum: named, regions } = nameComponents(components, seeds);
  const regionByNum = new Map();
  for (const num of new Set([...components.keys(), ...fixes.keys()])) {
    let region = fixes.get(num);
    if (region) via.gm++;
    else if ((region = named.get(num))) via.border++;
    else if ((region = nearestRegion(num, seeds, { shifted })?.region)) via.nearest++;
    if (region) regionByNum.set(num, region);
  }
  const colorOf = assignRegionColors(regionByNum, { shifted, palette });
  const byNum = new Map([...regionByNum].map(([num, zone]) => [num, { zone, zoneColor: cssHex(colorOf.get(zone)) }]));
  const conflicts = [...regions.values()].flatMap((r) => r.conflict.map((c) => `${r.region} / ${c}`));
  return { byNum, via, conflicts };
}

/**
 * hexZones for a scanned scene: its borders and fixes, the filed crawls for the
 * names, its own column shift, and Extras' palette when Extras offers one.
 * @param {object|null} scene  the PRINT scene carrying the scan, not the Extras scene
 */
export async function sceneZones(scene) {
  if (!scene) return hexZones();
  return hexZones({
    components: sceneRegions(scene),
    fixes: sceneRegionFixes(scene),
    seeds: regionSeeds(await crawlEntries()),
    shifted: scene.getFlag?.(MODULE_ID, "hexTags")?.origin?.shifted ?? "odd",
    palette: extrasPalette() ?? REGION_COLORS,
  });
}

/**
 * The scene whose region scan answers for `scene`: itself when it was scanned,
 * else the world's one scanned scene. An Extras-built scene carries no scan and
 * no link back to its print, so with several scanned prints this cannot pick
 * and says null — pass the print scene explicitly then.
 * @param {string|object|null} scene  a Scene or its id
 */
export function scanSceneFor(scene) {
  const scenes = globalThis.game?.scenes;
  const scanned = (s) => !!s?.getFlag?.(MODULE_ID, REGIONS_FLAG);
  const own = typeof scene === "string" ? scenes?.get?.(scene) : scene;
  if (scanned(own)) return own;
  const all = scenes?.filter?.(scanned) ?? [];
  return all.length === 1 ? all[0] : null;
}
