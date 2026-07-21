/**
 * Shadowdark Enhancer — Gear join (pure, Foundry-free, node-testable).
 *
 * Some gear sources split each item across two layouts on the page:
 *   (a) a COST TABLE  — `Name | Cost | Quantity Per Gear Slot` rows, and
 *   (b) a run-on block of DESCRIPTION paragraphs, each starting `Name. body…`.
 *
 * Neither half is a valid item on its own: a description has no cost anchor
 * (the item parser refuses it — nothing to price), and a cost row has no
 * flavor text. This module joins them.
 *
 * The COST TABLE is the SPINE — it carries the real price + slot anchors, so
 * every cost row becomes an importable draft. Each description paragraph is
 * attached to its row by a normalized token-SET match (never guessed):
 * lowercase, drop apostrophes, drop pure-number tokens, compare as a bag of
 * words, assign globally best-overlap-first, one-to-one. This is what makes
 * `Cord, 40'` ↔ `Cord.` (not `Cord, spider silk`) and `Vial, oil` ↔
 * `Oil vial.` line up while keeping same-stem names distinct.
 *
 * A description paragraph that matches no row is surfaced
 * (`unclaimedDescriptions`), never committed — mirroring the item parser's
 * "never guess" contract. A cost row with no description still commits (price
 * is the anchor) with a warning.
 *
 * Draft shape matches item-parser.mjs / item-importer.mjs consumers:
 *   { name, type:"Basic", cost:{gp,sp,cp},
 *     slots:{free_carry, per_slot, slots_used},
 *     description, riders:{benefit:[],bonus,curse,personality}, img, warnings }
 *
 * Ships ZERO book content — all fixtures are invented (rule D1).
 */

import { titleCaseName } from "../monsters/statblock-parser.mjs";
import { parseValue, pickTreasureIcon } from "../../loot/loot-pack.mjs";
import { textToHtml } from "../pdf-text-utils.mjs";

// ─── Normalizer ────────────────────────────────────────────────────────────

/**
 * Token set for join matching: lowercase, drop apostrophes, split on any
 * non-alphanumeric run, drop pure-number tokens. Dropping numbers is what
 * collapses `Arrows (20)` and `Cord, 40'` onto their bare-name descriptions
 * while keeping multi-word variants (`Cord, spider silk`) distinct.
 * @param {string} s
 * @returns {string[]} deduped is NOT applied — callers Set() when needed
 */
export function gearTokens(s) {
  return String(s ?? "").toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/)
    .filter(t => t && !/^\d+$/.test(t));
}

const overlap = (a, b) => { const B = new Set(b); let n = 0; for (const x of new Set(a)) if (B.has(x)) n++; return n; };
const isSubset = (a, b) => { const B = new Set(b); return [...new Set(a)].every(x => B.has(x)); };
const uniqCount = (a) => new Set(a).size;
const symdiff = (a, b) => uniqCount(a) + uniqCount(b) - 2 * overlap(a, b);

// ─── Cost table ──────────────────────────────────────────────────────────────

/** Cost cell — one `N gp/sp/cp` or the literal `Varies`. */
const COST_TOKEN = /(\d+\s*(?:gp|sp|cp)|Varies)\b/i;

/**
 * Parse the `Quantity Per Gear Slot` cell into slot fields.
 * `1-20` → per_slot 20 (range upper bound = stack size); `1` → per_slot 1;
 * `(first N free to carry)` → free_carry N (`one` → 1). A `mount`/special
 * carry note is left in per_slot but flagged for manual review.
 * @param {string} qty
 * @param {string} name
 * @returns {{ per_slot:number, free_carry:number, warn:string }}
 */
function parseQuantity(qty, name) {
  const s = String(qty ?? "");
  let per_slot = 1;
  const range = /(\d+)\s*-\s*(\d+)/.exec(s);
  const single = /(\d+)/.exec(s);
  if (range) per_slot = Number(range[2]);
  else if (single) per_slot = Number(single[1]);

  let free_carry = 0;
  const fc = /first\s+(\d+|one)\s+free/i.exec(s);
  if (fc) free_carry = /one/i.test(fc[1]) ? 1 : Number(fc[1]);

  const warn = /mount/i.test(s) ? `${name}: special carry rule ("${s.trim()}") — verify slots` : "";
  return { per_slot, free_carry, warn };
}

/**
 * Parse the cost table into spine rows. Any line without a cost cell (section
 * titles like "Basic Gear", the "Item Cost Quantity…" header) is skipped —
 * never guessed into an item.
 * @param {string} text
 * @returns {{ rows: object[], warnings: string[] }}
 */
export function parseCostTable(text) {
  const rows = [];
  const warnings = [];
  for (const raw of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = COST_TOKEN.exec(line);
    if (!m) continue; // header / section title / unpriced line — skipped

    const nameRaw = line.slice(0, m.index).replace(/[,\s]+$/, "").trim();
    const name = titleCaseName(nameRaw);
    if (!name) continue;

    const costRaw = m[1];
    let cost = { gp: 0, sp: 0, cp: 0 };
    if (/varies/i.test(costRaw)) warnings.push(`${name}: cost "Varies" — set manually`);
    else cost = parseValue(costRaw);

    const qtyRaw = line.slice(m.index + costRaw.length).trim();
    const { per_slot, free_carry, warn } = parseQuantity(qtyRaw, name);
    if (warn) warnings.push(warn);

    rows.push({
      name,
      cost,
      slots: { free_carry, per_slot, slots_used: 1 },
      tset: gearTokens(name),
    });
  }
  return { rows, warnings };
}

// ─── Description block ─────────────────────────────────────────────────────────

/**
 * Flatten a raw description slice: de-hyphenate soft wraps (keeping the hyphen
 * — hard compound hyphens dominate this corpus), newlines → spaces, collapse.
 * @param {string} text
 * @returns {string}
 */
function flattenDesc(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/-\n/g, "-")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Candidate item headers = lines that START with a capitalized lead-in
 * terminated by an early period (`Ball bearing.`, `Rope, morzo silk.`).
 * Item paragraphs always begin a line; mid-line sentence continuations
 * ("…can carry. Don't lose it.") are not line-initial and never claimed.
 * @param {string} descText
 * @returns {{ lines: string[], headers: {i:number, phrase:string, tset:string[]}[] }}
 */
function extractHeaders(descText) {
  const lines = String(descText ?? "").replace(/\r\n?/g, "\n").split("\n");
  const headers = [];
  lines.forEach((line, i) => {
    const m = /^([A-Z][^.]{0,44})\.(?:\s|$)/.exec(line.trim());
    if (!m) return;
    const tset = gearTokens(m[1]);
    if (tset.length) headers.push({ i, phrase: m[1].trim(), tset });
  });
  return { lines, headers };
}

// ─── Join ──────────────────────────────────────────────────────────────────────

/**
 * Join a cost table and a description block into gear drafts.
 *
 * @param {string} costText   the `Name | Cost | Quantity` table paste
 * @param {string} descText   the run-on `Name. body…` description block
 * @returns {{
 *   drafts: object[],                          // one per cost row (spine)
 *   unclaimedDescriptions: {phrase, tokens}[], // orphan paragraphs — surface, don't commit
 *   warnings: string[]                         // table-level (Varies cost, mount carry)
 * }}
 */
export function joinGear(costText, descText) {
  const { rows, warnings } = parseCostTable(costText);
  const { lines, headers } = extractHeaders(descText);

  // Global greedy assignment: strongest pairs first (overlap desc, symdiff
  // asc, earliest header). A pair is eligible only on overlap ≥ 2 or a subset
  // relation — a single shared common word is not enough to claim.
  const pairs = [];
  for (const c of rows) for (const h of headers) {
    const ov = overlap(c.tset, h.tset);
    if (!ov) continue;
    if (ov < 2 && !(isSubset(c.tset, h.tset) || isSubset(h.tset, c.tset))) continue;
    pairs.push({ c, h, ov, sd: symdiff(c.tset, h.tset) });
  }
  pairs.sort((a, b) => b.ov - a.ov || a.sd - b.sd || a.h.i - b.h.i);

  const usedC = new Set(), usedH = new Set(), matchOf = new Map();
  for (const p of pairs) {
    if (usedC.has(p.c) || usedH.has(p.h)) continue;
    usedC.add(p.c); usedH.add(p.h); matchOf.set(p.c, p.h);
  }

  // Each matched paragraph runs from its header line to the next MATCHED
  // header line — false headers (capitalized full sentences) never cut a body.
  const chosen = [...matchOf.values()].map(h => h.i).sort((a, b) => a - b);
  const bodyFor = (h) => {
    const end = chosen.find(x => x > h.i) ?? lines.length;
    const seg = flattenDesc(lines.slice(h.i, end).join("\n"));
    const cut = seg.indexOf("."); // strip the leading "Header." so the body doesn't repeat the name
    return (cut !== -1 ? seg.slice(cut + 1) : seg).trim();
  };

  const drafts = rows.map((c) => {
    const h = matchOf.get(c);
    const warns = [];
    let description = "<p></p>";
    if (h) {
      const body = bodyFor(h);
      description = body ? textToHtml(body) : "<p></p>";
    } else {
      warns.push(`${c.name}: no description matched — imported with price only`);
    }
    return {
      name: c.name,
      type: "Basic",
      cost: c.cost,
      slots: c.slots,
      description,
      riders: { benefit: [], bonus: "", curse: "", personality: "" },
      img: pickTreasureIcon(c.name),
      warnings: warns,
    };
  });

  // Orphan paragraphs the spine didn't cover — name-shaped only (≤ 4 tokens),
  // so capitalized full-sentence "headers" don't spam the review list.
  const unclaimedDescriptions = headers
    .filter(h => !usedH.has(h) && h.tset.length <= 4 && h.phrase.length <= 40)
    .map(h => ({ phrase: h.phrase, tokens: h.tset }));

  return { drafts, unclaimedDescriptions, warnings };
}

// ─── Internal helpers (exported for tests) ────────────────────────────────────

export const _internals = { parseQuantity, flattenDesc, extractHeaders, overlap, isSubset, symdiff };
