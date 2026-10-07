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
import { BOLD_OPEN, BOLD_CLOSE, stripBold, mergeBold } from "../pdf-text-utils.mjs";
import { enrichContextualText } from "../../shared/contextual-enricher.mjs";
import { linkItems, linkCreatures, linkMembers } from "./adventure-journal.mjs";

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
 * @param {{style?:"caps"|"inline", range?:[number,number], skip?:RegExp, intro?:boolean}} [opts]
 *   range = the numbers the site is printed to hold, to report what is missing;
 *   skip = lines that are page banners, not text ("Gedgarrin District");
 *   intro = keep the text printed before the first location (a site's "The
 *   Monastery" and "Inhabitants" sections) instead of dropping it. Opt-in: a
 *   page read from further up a book's page may open with something unrelated.
 *   Lines may carry bold markers (extractPdfText markBold): every match is made on the plain
 *   text, and each location's `boldLines` keeps the marked copy of its `bodyLines`.
 * @returns {{locations: Array<{num:number, name:string, bodyLines:string[], boldLines:string[]}>, warnings:string[], intro:string[], introBold:string[]}}
 */
export function parseAdventurePages(pages, { style = "caps", range, skip, intro = false } = {}) {
  const locations = [];
  const warnings = [];
  const introLines = [], introBold = [];
  let cur = null;
  for (const lines of pages ?? []) {
    const page = [...lines];
    // The printed page number sits last on the page; it is furniture, not text.
    while (page.length && PAGE_FURNITURE_RE.test(String(page.at(-1)).trim())) page.pop();
    for (const raw of page) {
      const marked = String(raw ?? "").trim();
      const line = stripBold(marked).trim();
      if (skip?.test(line)) continue;
      const head = matchHeading(line, style);
      const last = locations.at(-1)?.num;
      const follows = head && (last == null ? (!range || head.num <= range[0] + MAX_GAP) : (head.num > last && head.num - last <= MAX_GAP));
      if (follows) {
        if (last != null && head.num - last > 1) warnings.push(`missing ${last + 1}${head.num - last > 2 ? `-${head.num - 1}` : ""}`);
        cur = { num: head.num, name: head.name, bodyLines: head.rest ? [head.rest] : [], boldLines: head.rest ? [markedTail(marked, head.rest)] : [] };
        locations.push(cur);
      } else if (cur && line) {
        cur.bodyLines.push(line);
        cur.boldLines.push(marked);
      } else if (!cur && intro && line) {
        introLines.push(line);
        introBold.push(marked);
      }
    }
  }
  if (locations.length) {
    const end = locations.at(-1), keep = trimTrailingTable(end.bodyLines).length;
    end.bodyLines = end.bodyLines.slice(0, keep);
    end.boldLines = end.boldLines.slice(0, keep);
  }
  if (range && locations.length) {
    if (locations[0].num > range[0]) warnings.push(`missing ${range[0]}${locations[0].num - 1 > range[0] ? `-${locations[0].num - 1}` : ""}`);
    const end = locations.at(-1).num;
    if (end < range[1]) warnings.push(`missing ${end + 1}${range[1] > end + 1 ? `-${range[1]}` : ""}`);
  }
  if (range && !locations.length) warnings.push(`no locations found (expected ${range[0]}-${range[1]})`);
  return { locations, warnings, intro: introLines, introBold };
}

/**
 * The tail of a marked line: the part whose plain text is `rest` (a heading's
 * body, after "3. Parlor."). Walks the marked text until that many plain
 * characters are left, so a bold heading never leaks into the body.
 */
function markedTail(marked, rest) {
  const plain = stripBold(marked).trim();
  let skip = plain.length - rest.length;
  let i = 0;
  while (i < marked.length && skip > 0) { if (stripBold(marked[i])) skip--; i++; }
  return marked.slice(i).trim();
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

/** Lines the book marks as their own item, and how deep: a bullet, a trap/special arrow, the arrow under that. */
const ITEM_RE = /^[•▶►▷]\s*/;
const ITEM_LEVEL = { "•": 1, "▶": 2, "►": 2, "▷": 3 };

/** The bullet glyph off the front of a (possibly bold-marked) line, and any bold run it leaves empty. */
const dropBullet = (marked) => marked.replace(/[•▶►▷]\s*/, "")
  .replace(new RegExp(`${BOLD_OPEN}\\s*${BOLD_CLOSE}`, "g"), "")
  .replace(new RegExp(`${BOLD_OPEN}\\s+`, "g"), BOLD_OPEN);

/**
 * Body lines → blocks. A column gives one line per printed line, so the lines
 * are re-joined: a bullet or arrow starts an item and runs until the next one,
 * an ALL-CAPS line stands alone as a sub-heading, a word the column broke
 * ("stalac-" / "tite") is put back together. Lines may carry bold markers
 * (extractPdfText markBold); they survive the joining, and every test is made on the plain text.
 * @param {string[]} lines
 * @returns {Array<{kind:"p"|"li"|"h", text:string, level?:number}>}  level 1 for a bullet, 2 for an arrow, 3 for the arrow under that
 */
export function bodyBlocks(lines) {
  const blocks = [];
  let open = null;
  const join = (a, b) => {
    // "stalac-" + "tite": the hyphen is the last plain character, maybe with a bold marker closing after it.
    if (/[A-Za-z]-$/.test(stripBold(a))) { const i = a.lastIndexOf("-"); return mergeBold(a.slice(0, i) + a.slice(i + 1) + b); }
    return mergeBold(`${a} ${b}`);
  };
  for (const raw of lines ?? []) {
    const marked = String(raw ?? "").trim();
    const line = stripBold(marked).trim();
    if (!line) { open = null; continue; }
    if (ITEM_RE.test(line)) { open = { kind: "li", level: ITEM_LEVEL[line[0]] ?? 1, text: dropBullet(marked) }; blocks.push(open); continue; }
    if (!/[a-z]/.test(line) && hasLetters(line)) { blocks.push({ kind: "h", text: line }); open = null; continue; }
    if (open) open.text = join(open.text, marked);
    else { open = { kind: "p", text: marked }; blocks.push(open); }
  }
  return blocks;
}

/** Same-site cross-references: "Area 32", "Areas 1 and 4", "Areas 1, 2, and 3", "Room 9". */
const REF_RE = /\b(Areas?|Rooms?)\s+(\d{1,3}(?:\s*(?:,\s*(?:and|or|&)?|and|&|or)\s*\d{1,3})*)\b/g;
const NUM_SPLIT_RE = /(\d{1,3})/;

/**
 * Link "Area N" references to the site's other locations, then escape. The
 * references are matched on the RAW text and each piece is escaped on its own,
 * so a separator such as "&" survives to be matched. A placeholder carries the
 * number; the commit swaps it for a @UUID once every page exists, and an unknown
 * number degrades to the plain text it replaced.
 * @param {string} text   raw text, not yet escaped
 * @param {Set<number>} known  numbers that have a page
 * @returns {string}
 */
export function linkRefs(text, known) {
  const src = String(text ?? "");
  let out = "", last = 0;
  for (const m of src.matchAll(REF_RE)) {
    out += escapeHtml(src.slice(last, m.index));
    const body = m[2].split(NUM_SPLIT_RE).map((piece, i) =>
      (i % 2 === 0 ? escapeHtml(piece) : (known.has(Number(piece)) ? `@@LOC[${Number(piece)}]{${piece}}@@` : piece))).join("");
    out += `${m[1]} ${body}`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(src.slice(last));
}

/**
 * A run of marked text as HTML: the book's bold runs become <strong>, a bold creature name the bestiary knows
 * becomes a link inside its bold, "Area N" references become placeholders, and what is left is escaped.
 * @param {string} marked  text that may carry bold markers
 * @param {Set<number>} known
 * @param {(phrase:string)=>string|undefined} [resolve]  creature link target for a bold name
 */
export function inlineHtml(marked, known, resolve) {
  const src = mergeBold(String(marked ?? ""));
  const out = [];
  let last = 0;
  for (const m of src.matchAll(new RegExp(`${BOLD_OPEN}([^${BOLD_CLOSE}]*)${BOLD_CLOSE}`, "g"))) {
    out.push(linkRefs(stripBold(src.slice(last, m.index)), known));
    const [, lead, core, tail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(m[1]);
    const label = /^(.*?)([.:,;]*)$/.exec(core);
    const uuid = label[1] && label[1].length <= 40 && resolve ? resolve(label[1]) : undefined;
    // "Pool. Mugdulblub": a run-in label and the creature's name set in one bold run; the name is what links.
    const cut = uuid || !resolve ? -1 : label[1].lastIndexOf(". ");
    const named = cut > 0 && label[1].length - cut - 2 <= 40 ? resolve(label[1].slice(cut + 2)) : undefined;
    const inner = uuid ? `@UUID[${uuid}]{${escapeHtml(label[1])}}${escapeHtml(label[2])}`
      : named ? `${linkRefs(label[1].slice(0, cut + 2), known)}@UUID[${named}]{${escapeHtml(label[1].slice(cut + 2))}}${escapeHtml(label[2])}`
        : linkRefs(core, known);
    out.push(lead, inner ? `<strong>${inner}</strong>` : "", tail);
    last = m.index + m[0].length;
  }
  out.push(linkRefs(stripBold(src.slice(last)), known));   // a marker the pairs did not close never reaches the page
  return out.join("");
}

/** Items → nested lists. A level that jumps more than one step down is held to one. */
function listHtml(items, known, resolve) {
  const root = { children: [] }, stack = [{ level: 0, node: root }];
  for (const it of items) {
    while (stack.length > 1 && stack.at(-1).level >= it.level) stack.pop();
    const node = { text: it.text, children: [] };
    stack.at(-1).node.children.push(node);
    stack.push({ level: stack.at(-1).level + 1, node });
  }
  const render = (nodes) => `<ul>${nodes.map((n) => `<li><p>${inlineHtml(n.text, known, resolve)}</p>${n.children.length ? render(n.children) : ""}</li>`).join("")}</ul>`;
  return render(root.children);
}

/**
 * A location as page HTML, in the layout of the Lost Citadel quickstart: the player-safe description as a paragraph
 * of bold labels, the GM's details as bullets with the arrows nested under them, dice and DC checks as inline
 * rolls and requests, the bold creature names the bestiary knows as links.
 * @param {{bodyLines:string[], boldLines?:string[]}} draft  boldLines: bodyLines with the bold markers
 * @param {Set<number>} known
 * @param {{resolve?:(phrase:string)=>string|undefined, items?:Array<{name:string,uuid:string}>, creatures?:Array<{form:string,uuid:string}>}} [opts]  resolve: links for the creatures the book sets in bold; creatures: the adventure's creature names (creatureVocabulary), linked where the book printed them plain; items: the magic items and treasure to link (adventure-journal linkableItems)
 * @returns {string}
 */
export function buildLocationHtml(draft, known, { resolve, items, creatures } = {}) {
  const marked = draft?.boldLines?.length && draft.boldLines.length === (draft.bodyLines ?? []).length ? draft.boldLines : draft?.bodyLines;
  const blocks = bodyBlocks(marked);
  if (!blocks.length) return "<p></p>";
  const out = [];
  for (let i = 0; i < blocks.length;) {
    const b = blocks[i];
    if (b.kind === "li") {
      const run = [];
      while (blocks[i]?.kind === "li") run.push(blocks[i++]);
      out.push(listHtml(run, known, resolve));
      continue;
    }
    out.push(b.kind === "h" ? `<p><strong>${escapeHtml(titleCaseName(b.text))}</strong></p>` : `<p>${inlineHtml(b.text, known, resolve)}</p>`);
    i++;
  }
  return linkItems(linkMembers(linkCreatures(enrichContextualText(out.join("\n"), { context: "journal" }), creatures), creatures), items);
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

/**
 * Page name, in the quickstart's style: "Area 12: Meteorite Room". A site that is not made of areas (a city) says
 * `noun: ""` in its manifest row and keeps "12. Meteorite Room".
 */
export const locationPageName = (loc, noun = "Area") => (noun ? `${noun} ${loc.num}: ${titleCaseName(loc.name)}` : `${loc.num}. ${titleCaseName(loc.name)}`);
