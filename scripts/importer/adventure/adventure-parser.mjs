/**
 * Shadowdark Enhancer — numbered-location parser for printed adventures.
 *
 * Foundry-free. Turns the extracted lines of an adventure site's pages into one
 * draft per numbered location ("12. METEORITE ROOM", "3. Egg Nest. Cramped
 * cave…"). The hex parser (tables/hex-parser.mjs) reads three- and four-digit
 * hex numbers; a dungeon's rooms are one to three digits and are printed in two
 * different ways, so this is its own recognizer instead of a loosened copy:
 *
 *   "caps"    the number and an ALL-CAPS name on a line of their own, the body
 *             below ("1. ENTRY HALL"): Cursed Scrolls 1, 2, 3, 5 and 6.
 *   "inline"  the number, a Title Case name and a full stop, then the body on
 *             the same line ("1. Lava Pool. Churning, glows…"): Cursed Scroll 4.
 *
 * The style is given by the site's manifest row, never guessed: an inline
 * heading is a sentence start and a numbered list inside a body looks just like
 * one. What keeps a stray match out is the run rule: a heading is only taken
 * when its number follows the last one taken (by at most MAX_GAP), so the "2."
 * of a numbered list inside room 7 stays in room 7's text.
 *
 * Ships no book content. Every string in the tests is invented.
 */

import { PAGE_FURNITURE_RE } from "../tables/hex-parser.mjs";

/** A step bigger than this between two headings reads as a stray, not a run. */
export const MAX_GAP = 3;

const CAPS_RE = /^(\d{1,3})\.\s+([A-Z0-9][A-Z0-9 '’\-,&:!?()/]*)$/;
const INLINE_RE = /^(\d{1,2})\.\s+([A-Z][^.:]{1,44}?)\.(?:\s+(\S.*))?$/;

/** Letters only: "12. 3-4" must not read as a caps heading. */
const hasLetters = (s) => (s.match(/[A-Z]/g) ?? []).length >= 2;

/**
 * One line as a heading candidate, or null.
 * @param {string} line
 * @param {"caps"|"inline"} style
 * @returns {{num:number, name:string, rest:string}|null}
 */
export function matchHeading(line, style = "caps") {
  const text = String(line ?? "").trim();
  if (style === "inline") {
    const m = INLINE_RE.exec(text);
    if (!m) return null;
    return { num: Number(m[1]), name: m[2].trim(), rest: (m[3] ?? "").trim() };
  }
  const m = CAPS_RE.exec(text);
  if (!m || !hasLetters(m[2]) || m[2].length > 60) return null;
  return { num: Number(m[1]), name: m[2].trim(), rest: "" };
}

/**
 * Book style: "THE BOOK OF IMMORTALS" → "The Book of Immortals", "MUGDULBLUB'S
 * HALL" → "Mugdulblub's Hall". Names that are not all caps are left as printed.
 * @param {string} name
 * @returns {string}
 */
export function titleCaseName(name) {
  const s = String(name ?? "").trim();
  if (/[a-z]/.test(s)) return s;
  const small = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to"]);
  return s.toLowerCase().replace(/[\p{L}\d]+(?:['’][\p{L}]+)*/gu, (w, i) =>
    (i > 0 && small.has(w)) ? w : w[0].toUpperCase() + w.slice(1));
}

/**
 * Parse a site's pages.
 * @param {string[][]} pages  one array of lines per page, in page order
 * @param {{style?:"caps"|"inline", range?:[number,number], skip?:RegExp}} [opts]
 *   range = the numbers the site is printed to hold, to report what is missing;
 *   skip = lines that are page banners, not text ("Gedgarrin District")
 * @returns {{locations: Array<{num:number, name:string, bodyLines:string[]}>, warnings:string[]}}
 */
export function parseAdventurePages(pages, { style = "caps", range, skip } = {}) {
  const locations = [];
  const warnings = [];
  let cur = null;
  for (const lines of pages ?? []) {
    const page = [...lines];
    // The printed page number sits last on the page; it is furniture, not text.
    while (page.length && PAGE_FURNITURE_RE.test(String(page.at(-1)).trim())) page.pop();
    for (const raw of page) {
      const line = String(raw ?? "").trim();
      if (skip?.test(line)) continue;
      const head = matchHeading(line, style);
      const last = locations.at(-1)?.num;
      const follows = head && (last == null ? (!range || head.num <= range[0] + MAX_GAP) : (head.num > last && head.num - last <= MAX_GAP));
      if (follows) {
        if (last != null && head.num - last > 1) warnings.push(`missing ${last + 1}${head.num - last > 2 ? `-${head.num - 1}` : ""}`);
        cur = { num: head.num, name: head.name, bodyLines: head.rest ? [head.rest] : [] };
        locations.push(cur);
      } else if (cur && line) {
        cur.bodyLines.push(line);
      }
    }
  }
  if (locations.length) locations.at(-1).bodyLines = trimTrailingTable(locations.at(-1).bodyLines);
  if (range && locations.length) {
    if (locations[0].num > range[0]) warnings.push(`missing ${range[0]}${locations[0].num - 1 > range[0] ? `-${locations[0].num - 1}` : ""}`);
    const end = locations.at(-1).num;
    if (end < range[1]) warnings.push(`missing ${end + 1}${range[1] > end + 1 ? `-${range[1]}` : ""}`);
  }
  if (range && !locations.length) warnings.push(`no locations found (expected ${range[0]}-${range[1]})`);
  return { locations, warnings };
}

/**
 * A site's last location runs to the end of its pages, which is where the book
 * parks its random tables ("VOID JUNK" / "d20 Details"). Cut at the first
 * ALL-CAPS title that sits directly above a die header. ponytail: only the last
 * location is cut; a table inside an earlier room is that room's own.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function trimTrailingTable(lines) {
  const at = lines.findIndex((l, i) => !/[a-z]/.test(l) && hasLetters(l) && /^d\d+\b/i.test(lines[i + 1] ?? ""));
  return at < 0 ? lines : lines.slice(0, at);
}

// ─── Page body ────────────────────────────────────────────────────────────────

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Lines the book marks as their own item: a bullet, a trap/special arrow. */
const ITEM_RE = /^[•▶►]\s*/;

/**
 * Body lines → blocks. A column gives one line per printed line, so the lines
 * are re-joined: a bullet or arrow starts an item and runs until the next one,
 * an ALL-CAPS line stands alone as a sub-heading, a word the column broke
 * ("stalac-" / "tite") is put back together.
 * @param {string[]} lines
 * @returns {Array<{kind:"p"|"li"|"h", text:string}>}
 */
export function bodyBlocks(lines) {
  const blocks = [];
  let open = null;
  const join = (a, b) => (/[A-Za-z]-$/.test(a) ? a.slice(0, -1) + b : `${a} ${b}`);
  for (const raw of lines ?? []) {
    const line = String(raw ?? "").trim();
    if (!line) { open = null; continue; }
    if (ITEM_RE.test(line)) { open = { kind: "li", text: line.replace(ITEM_RE, "") }; blocks.push(open); continue; }
    if (!/[a-z]/.test(line) && hasLetters(line)) { blocks.push({ kind: "h", text: line }); open = null; continue; }
    if (open) open.text = join(open.text, line);
    else { open = { kind: "p", text: line }; blocks.push(open); }
  }
  return blocks;
}

/** Same-site cross-references: "Area 32", "Areas 1 and 4", "Room 9", "see Area 12". */
const REF_RE = /\b(Areas?|Rooms?)\s+(\d{1,3}(?:\s*(?:,|and|&|or)\s*\d{1,3})*)\b/g;
const NUM_RE = /\d{1,3}/g;

/**
 * Escape, then link "Area N" references to the site's other locations. A
 * placeholder carries the number; the commit swaps it for a @UUID once every
 * page exists, and an unknown number degrades to the plain text it replaced.
 * @param {string} text   raw text, not yet escaped
 * @param {Set<number>} known  numbers that have a page
 * @returns {string}
 */
export function linkRefs(text, known) {
  return escapeHtml(text).replace(REF_RE, (full, word, nums) => {
    const body = nums.replace(NUM_RE, (n) => (known.has(Number(n)) ? `@@LOC[${Number(n)}]{${n}}@@` : n));
    return `${word} ${body}`;
  });
}

/**
 * A location as page HTML.
 * @param {{bodyLines:string[]}} draft
 * @param {Set<number>} known
 * @returns {string}
 */
export function buildLocationHtml(draft, known) {
  const blocks = bodyBlocks(draft?.bodyLines);
  if (!blocks.length) return "<p></p>";
  const out = [];
  let list = false;
  for (const b of blocks) {
    if (b.kind !== "li" && list) { out.push("</ul>"); list = false; }
    if (b.kind === "li") {
      if (!list) { out.push("<ul>"); list = true; }
      out.push(`<li>${linkRefs(b.text, known)}</li>`);
    } else if (b.kind === "h") out.push(`<p><strong>${escapeHtml(titleCaseName(b.text))}</strong></p>`);
    else out.push(`<p>${linkRefs(b.text, known)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("\n");
}

const LOC_PLACEHOLDER_RE = /@@LOC\[(\d+)\]\{([^}]*)\}@@/g;

/**
 * Pass 2: placeholders → `@UUID[…]{N}`. An unknown number is the bare label.
 * @param {string} content
 * @param {Map<number,string>} uuidByNum
 * @returns {string}
 */
export function rewriteLocPlaceholders(content, uuidByNum) {
  return String(content ?? "").replace(LOC_PLACEHOLDER_RE, (full, num, label) => {
    const uuid = uuidByNum?.get?.(Number(num));
    return uuid ? `@UUID[${uuid}]{${label}}` : label;
  });
}

/** Page name: number first, so pages sort by number ("12. Meteorite Room"). */
export const locationPageName = (loc) => `${loc.num}. ${titleCaseName(loc.name)}`;
