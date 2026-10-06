/**
 * Shadowdark Enhancer — the master list of the books' own maps.
 *
 * A GM's folder holds the book's files next to their own work: a colour copy, an overlay, a GM version
 * somebody made, the two halves of a map stitched into one. Matching on a name alone takes those for the
 * real thing. So for every map the wizard asks for, this says what the book's own file looks like: its pixel
 * size (shape), what a file's name must or must not say to be it, and which of two shipped copies to use.
 *
 * Every size here was measured off the book's own download, and each agrees with the map's printed grid to
 * about 0.1% (the Bittermold Keep map is 3600 x 2329 against a 68 x 44 grid). The adventure sites' names are
 * in adventure-manifest.mjs; the hex maps' are in wizard-core.mjs (HEX_MAPS). Pure data, no Foundry.
 */

/** id → [width, height] in pixels of the book's own file; for a book that ships a small VTT copy, that copy. */
export const MAP_SHAPE = {
  "cs1-mugdulblub": [3600, 2329],
  "cs2-iron-fortress": [3600, 2800], "cs2-mines": [3600, 2720],
  "cs3-wortwick": [8400, 8400], "cs3-sea-wolf": [3600, 2330],
  "cs4-army-ants": [10800, 9000], "cs4-basilisk-cult": [9000, 7200], "cs4-black-ziggurat": [5400, 9600],
  "cs4-chanichu": [6600, 6600], "cs4-eclipse-dial": [9300, 7200], "cs4-flooded-ruins": [7200, 9300],
  "cs4-star-map-temple": [6900, 6300], "cs4-black-seed": [8400, 8100], "cs4-tsibalba": [6000, 5700],
  "cs5-leng-1": [4000, 2545], "cs5-leng-2": [4000, 2545],
  "cs6-gedgarrin": [3600, 1469], "cs6-gutterwash": [3600, 1469], "cs6-high-harbor": [3600, 1469], "cs6-montmar-castle": [3600, 1469],
  "cs6-ninestones": [3600, 1469], "cs6-rilken-row": [3600, 1469], "cs6-silvertop": [3600, 1469], "cs6-the-rooks": [3600, 1469],
  "cs6-city": [3600, 3210],
  "wrma-house-of-rogues": [9000, 5400], "wrma-grotto-golden-swan": [6600, 6000], "wrma-forge-metallic-sisters": [10800, 8400],
  "wrma-fallen-keep-emerald-knight": [6600, 6300], "wrma-burial-mound-kaghan": [8400, 6300], "wrma-chapel-plague-priestesses": [8100, 6000],
  "hex-wr": [9933, 14043],
  "hex-cs1": [2250, 1674], "hex-cs2": [2250, 1674], "hex-cs3": [2250, 1674],
  "hex-cs4:north": [2250, 1674], "hex-cs4:south": [2250, 1674],
  "hex-cs5": [4500, 3348],
};

/** How far a file's width / height may be from the book's before the wizard says it is not that map's shape. */
export const SHAPE_TOLERANCE = 0.015;

/** Names that mark a file as somebody's work on a map, not the book's file. Never an adventure map. */
const WORK_PRODUCTS = [" map placement ", " clean base map ", " ground layer ", " transparent linework ", " map preview "];

/**
 * Per-map name rules on top of the manifest's names. `needs`: the file's name must say all of these.
 * `avoid`: it must say none. Written as normalised word runs with a space either side (see map-detect.mjs).
 */
export const MAP_RULES = {
  // A later 3500 x 2481 "GM" copy is not the book's 68 x 44 map.
  "cs1-mugdulblub": { avoid: [" gm "] },
  // A scene is for the GM: the GM's version, not the player's.
  "cs5-leng-2": { avoid: [" player "] },
  // The city ships plain, boundary-line and keyed copies; the pins are placed on the fully keyed one. The GM's Guide
  // prints a wider crop of it ("City of Masks Map ...", 4489 x 3210 against 3600 x 3210), where those pins would sit off.
  "cs6-city": { needs: [" fully keyed "], avoid: [" map "] },
};

/** May a file whose normalised name is `words` be this adventure map? */
export function nameAllowed(id, words) {
  if (WORK_PRODUCTS.some((x) => words.includes(x))) return false;
  const rule = MAP_RULES[id];
  if (!rule) return true;
  return (rule.needs ?? []).every((x) => words.includes(x)) && !(rule.avoid ?? []).some((x) => words.includes(x));
}

/**
 * Of two shipped copies of one map, which is preferred: 0 best. The small VTT copy loads in Foundry; the
 * full-resolution one can be a quarter of a gigapixel (Leng level 2 is 19800 x 12600).
 */
export function variantRank(name) {
  const w = ` ${String(name).toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return w.includes(" vtt ") ? 0 : w.includes(" full res ") ? 2 : 1;
}

/** Width / height of the book's file for a map, or null for a map not on the list. */
export function shapeOf(id) {
  const s = MAP_SHAPE[id];
  return s ? s[0] / s[1] : null;
}

/** Is a picture of w x h the shape of the book's file for this map? True when the list has no shape for it. */
export function shapeMatches(id, w, h) {
  const want = shapeOf(id);
  return want === null || Math.abs(w / h - want) / want <= SHAPE_TOLERANCE;
}
