/**
 * Shadowdark Enhancer — keyed hex summary rows (pure, Foundry-free, node-testable).
 *
 * Hexcrawl books print a keyed-location summary ahead of the per-hex entries:
 * one line per keyed hex with the number, the region, the terrain word(s) and
 * the name. With the module's own PDF text grab the row arrives as one line:
 *
 *   211   Grey Reach, The   Arctic sea      Puffin Rock
 *   1251  Tallow Jungle     Jungle, path    Bone Choir*
 *   358   Tallow Jungle     Jungle          Low Ford2
 *
 * The terrain words are the split point, so no region list ever ships (D1):
 * the zone is whatever sits between the number and the terrain run, the name
 * is what follows. A region can contain a terrain word ("Tallow Jungle"), and
 * a name can start with one ("Forest Shrine"), so a row may split more than
 * one way; the table decides. Across all rows the real zones repeat and the
 * wrong ones do not, so each row keeps the split whose zone is the most
 * frequent candidate zone, tie broken by "the name does not start with a
 * terrain word".
 *
 * Trailing digit 1-4 on the name (before any * or †) is the book's settlement
 * size; the markers are kept aside. Rows only count inside a run of three or
 * more consecutive matching lines, so an entry heading that happens to look
 * like a row ("1403 The Mountain Pass") in a prose section is never claimed.
 *
 * Ships ZERO book content — the vocabulary is generic geography, fixtures are
 * invented. Phase 1 of docs/plans/hex-map-dataset.md (#169).
 */

import { hexIdKey } from "../tables/hex-parser.mjs";

/** Generic terrain words the parser recognises (lower case, as printed). */
export const TERRAIN_WORDS = [
  "arctic sea", "ocean", "lake", "coast", "river", "mountain", "volcano", "lava",
  "canyon", "forest", "jungle", "grassland", "swamp", "desert", "salt flat",
  "deep tunnels", "path",
];

/** Printed word → dataset tag ("arctic sea" → "arctic_sea"). */
export const TERRAIN_TAGS = Object.fromEntries(TERRAIN_WORDS.map((w) => [w, w.replace(/\s+/g, "_")]));

/** Trailing settlement digit → feature. Anything else is a keyed location. */
export const SETTLEMENTS = { 1: "village", 2: "town", 3: "city", 4: "city_state" };

/** Rows only count inside a run of at least this many consecutive row lines. */
export const MIN_RUN = 3;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERRAIN_ALT = TERRAIN_WORDS.slice().sort((a, b) => b.length - a.length).map(escapeRe).join("|");
/** One terrain run: "Jungle" or "Jungle, path" (two words at most, as the books print). */
const RUN_RE = new RegExp(`\\b(${TERRAIN_ALT})(?:\\s*,\\s*(${TERRAIN_ALT}))?\\b`, "gi");
const ROW_RE = /^\s*(\d{3,4})\s+(\S.*)$/;
const STARTS_WITH_TERRAIN = new RegExp(`^(?:${TERRAIN_ALT})\\b`, "i");

/**
 * Every way one row remainder could split into zone | terrain run | name.
 * @param {string} rest  the line after the number
 * @returns {Array<{zone:string, terrain:string[], name:string, nameStartsWithTerrain:boolean}>}
 */
export function rowCandidates(rest) {
  const out = [];
  RUN_RE.lastIndex = 0;
  let m;
  while ((m = RUN_RE.exec(rest)) !== null) {
    const zone = rest.slice(0, m.index).trim();
    const name = rest.slice(m.index + m[0].length).trim();
    if (!zone || !name) continue;
    const terrain = [m[1], m[2]].filter(Boolean).map((w) => TERRAIN_TAGS[w.toLowerCase()]);
    // A run may not start on the second half of a "jungle, path" pair (zone would end in a comma).
    if (!zone.endsWith(",")) out.push({ zone, terrain, name, nameStartsWithTerrain: STARTS_WITH_TERRAIN.test(name) });
    RUN_RE.lastIndex = m.index + 1;   // overlapping runs: "Jungle Jungle, path" yields both
  }
  return out;
}

/** "Low Ford2" → { name: "Low Ford", feature: "town", markers: "" }; "Bone Choir*3†" → city, "*†".
 *  Markers sit on either side of the digit in print ("Stonebeck*3", "Harrowmoot3†"). */
export function splitName(raw) {
  const m = String(raw ?? "").trim().match(/^(.*?)\s*([*†]*)([1-4])?([*†]*)$/);
  const digit = m?.[3];
  return {
    name: (m?.[1] ?? "").trim(),
    feature: digit ? SETTLEMENTS[digit] : "keyed_location",
    markers: (m?.[2] ?? "") + (m?.[4] ?? ""),
  };
}

/**
 * Parse keyed summary rows out of pasted text.
 * @param {string} text
 * @returns {{ rows: Array<{num:string, key:string, zone:string, terrain:string[], name:string, feature:string, markers:string, line:number}>, lines: Set<number> }}
 *   `lines` are the 0-based line numbers that were rows (for stripping).
 */
export function parseHexSummaryRows(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  // Pass A: candidate splits per line, then cluster into runs of consecutive row lines.
  const perLine = lines.map((l) => {
    const m = l.match(ROW_RE);
    if (!m || hexIdKey(m[1]) === null) return null;
    const cands = rowCandidates(m[2]);
    return cands.length ? { num: m[1], cands } : null;
  });
  const inRun = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length;) {
    if (!perLine[i]) { i++; continue; }
    let j = i;
    while (j < lines.length && perLine[j]) j++;
    if (j - i >= MIN_RUN) for (let k = i; k < j; k++) inRun[k] = true;
    i = j;
  }
  // Pass B: zone frequency across every candidate of every row line, then pick.
  const freq = new Map();
  perLine.forEach((p, i) => { if (p && inRun[i]) for (const c of p.cands) freq.set(c.zone, (freq.get(c.zone) ?? 0) + 1); });
  const rows = []; const rowLines = new Set();
  perLine.forEach((p, i) => {
    if (!p || !inRun[i]) return;
    const best = p.cands.slice().sort((a, b) =>
      (freq.get(b.zone) - freq.get(a.zone)) || (Number(a.nameStartsWithTerrain) - Number(b.nameStartsWithTerrain)))[0];
    const { name, feature, markers } = splitName(best.name);
    if (!name) return;
    rows.push({ num: p.num, key: hexIdKey(p.num), zone: best.zone, terrain: best.terrain, name, feature, markers, line: i });
    rowLines.add(i);
  });
  return { rows, lines: rowLines };
}

/**
 * Rows plus the text with the row lines removed, so the hexcrawl recognizer
 * never sees the summary table as one giant anchored block.
 * @param {string} text
 * @returns {{ rows: object[], remainder: string }}
 */
export function splitSummaryRows(text) {
  const { rows, lines } = parseHexSummaryRows(text);
  if (!rows.length) return { rows, remainder: String(text ?? "") };
  const remainder = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").filter((_, i) => !lines.has(i)).join("\n");
  return { rows, remainder };
}

/**
 * A keyed summary row as a map tag: the book's own answer for that hex.
 *
 * The print already says what every keyed hex is AND whether a river or a path
 * runs through it — "1251  Tallow Jungle  Jungle, path  Bone Choir" is a keyed
 * location on a path. Read off the page it is exact; read off the picture it is
 * a small icon over terrain stipple, which is why the scanner got 55 of Take
 * 10's 76 remaining errors on keyed hexes and found 4 of their 19 paths.
 *
 * The terrain of the tag is the FEATURE (keyed_location, village, town, city,
 * city_state) — that is what the map is showing there and what the GM tags by
 * hand. The book's underlying terrain word is not lost: it travels separately
 * into the dataset, where Extras wants it.
 *
 * EVERY printed terrain word is read for an overlay, including the first. The
 * first word is normally the hex's terrain and the rest are what runs through
 * it — but the tag's terrain is the FEATURE here, so the first word is not
 * being used for anything else and dropping it only loses information. The
 * books print a keyed hex's overlay first whenever there is nothing else to
 * say about the ground: "933  Coast  Old Lighthouse", "2025  River  The
 * Forks". Reading only the second word onward lost 10 of the GM Guide's 270
 * keyed hexes their river or coast outright (measured, 2026-09-20).
 *
 * @param {{terrain?:string[], feature?:string}} row
 * @returns {{terrain:string, overlays:string[]}|null}
 */
export function rowTag(row) {
  const terrain = row?.feature;
  if (!terrain) return null;
  const overlays = (row.terrain ?? []).filter((t) => OVERLAY_TAGS.includes(t));
  return { terrain, overlays };
}

/** Overlay tags a keyed row can carry beside its terrain. Matches the tag store's OVERLAYS. */
export const OVERLAY_TAGS = ["river", "path", "coast"];
