/**
 * Shadowdark Enhancer — which adventure is this map image?
 *
 * Pure. The GM picks the map that came with the book and the module should know
 * what it is: the files are named for their adventure ("Ruins of Bittermold Keep
 * (68 wide x 44 high).png", "Army Ants 36x30.jpg", "Library of Leng Level 2 GM_s
 * Version (VTT) 66x42.jpg"), so the file name says. Matching is on the words, not
 * the exact name: size, "VTT", "GM version" and the like are dropped, and the
 * longest adventure name found in what is left wins. Two adventures tying means
 * the name does not say, and the GM is asked.
 */

/**
 * Words and patterns a map file's name carries that say nothing about which map it
 * is. "Map" is not one of them: a name matches as a run of words inside the file's,
 * so "House of Rogues Map" still finds "House of Rogues", and "Star Map Temple"
 * keeps the word that is part of its name.
 */
const NOISE = [
  /\(?\s*\d+\s*(?:wide|high)?\s*x\s*\d+\s*(?:wide|high)?\s*\)?/g,   // 68 wide x 44 high, 36x30, 28 high x 28 wide
  /\b(?:vtt|gm s version|gm version|player s version|players version|full res|letter|v\d+(?: \d+)?)\b/g,
];

/** A name reduced to lower-case words separated by single spaces. */
export function normalizeName(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The words of a file path that name its map. */
export function mapWords(path) {
  const base = decodeURIComponent(String(path ?? "")).split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,5}$/i, "");
  let words = normalizeName(base);
  // The size reads as "68 wide x 44 high" or "28 high x 28 wide" before the non-letters are folded away.
  words = normalizeName(base.replace(/\d+\s*(?:wide|high)?\s*x\s*\d+\s*(?:wide|high)?/gi, " "));
  for (const re of NOISE) words = words.replace(re, " ");
  return ` ${words.replace(/\s+/g, " ").trim()} `;
}

/** Every name this site's map goes by: its title and any `mapNames` the manifest adds. */
export const siteNames = (site) => [site.title, ...(site.mapNames ?? [])].map(normalizeName).filter(Boolean);

/**
 * The adventure a map image is of, or null when the name does not say (or says two).
 * @param {string} path  the image's path or file name
 * @param {Array<{id:string, title:string, mapNames?:string[]}>} sites
 */
export function siteForImage(path, sites) {
  const words = mapWords(path);
  let best = null, tie = false;
  for (const site of sites) {
    const hit = siteNames(site).filter((n) => words.includes(` ${n} `)).sort((a, b) => b.length - a.length)[0];
    if (!hit) continue;
    if (!best || hit.length > best.len) { best = { site, len: hit.length }; tie = false; }
    else if (hit.length === best.len) tie = true;
  }
  return best && !tie ? best.site : null;
}
