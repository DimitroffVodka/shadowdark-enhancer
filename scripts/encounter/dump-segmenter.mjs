/**
 * Shadowdark Enhancer — Universal Dump Segmenter
 *
 * Routes a raw mixed PDF dump through a recognizer registry:
 *   1. monster recognizer  — delegates to splitStatblocks (AC…LV anchor)
 *   2. table recognizer    — delegates to parseTables (dice-table rows)
 *   Anything not claimed by any recognizer → skipped (reviewable, never dropped).
 *
 * Classification order (Claude's Discretion per 10-CONTEXT.md):
 *   Monster recognizer runs first over the full raw text because statblock
 *   blocks are name-delimited by ALL-CAPS lines — a pattern that never appears
 *   in dice tables.  The table recognizer then runs over the remainder (the
 *   text that splitStatblocks did NOT claim), so the same lines are never
 *   double-counted.  Blocks claimed by neither recognizer land in skipped.
 *
 * Extensibility: RECOGNIZERS is an ordered array. A Phase 11 items recognizer
 * (or any future recognizer) plugs in via RECOGNIZERS.push({ id, claim, parse })
 * without touching segmentDump's loop.  The loop iterates the registry
 * in order, never branching on a hardcoded id.
 *
 * Pure / Foundry-free — no `game`, `ui`, `CONFIG`, `foundry`, or `Hooks`
 * references.  All helpers are importable by node:test directly.
 */

import { splitStatblocks } from "./statblock-parser.mjs";
import { parseTables } from "./table-importer.mjs";

// ─── Block-boundary helper ────────────────────────────────────────────────────

/**
 * Split raw text into blank-line-separated blocks.
 * Each returned element is the raw text of one block (lines joined by "\n"),
 * with leading/trailing blank lines stripped.
 *
 * @param {string} rawText
 * @returns {string[]}
 */
function splitRawBlocks(rawText) {
  const lines = String(rawText ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (cur.length) { blocks.push(cur.join("\n")); cur = []; }
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks;
}

// ─── Recognizer: monsters ─────────────────────────────────────────────────────

/**
 * Monster recognizer — delegates to splitStatblocks.
 *
 * claim(rawText): runs splitStatblocks over the full text. Returns:
 *   - claimed: raw monster chunks (one string per monster, as returned by splitStatblocks)
 *   - remainder: the original text with claimed monster lines removed, so the
 *     table recognizer never sees them.  We rebuild the remainder by removing
 *     only the lines that appear in claimed chunks (line-exact match).
 *   - skipped: blocks that splitStatblocks put in its own skipped list
 *     (section headers / lore blocks with no AC…LV line).
 *
 * parse(claimedBlocks) → the same string array (monster chunks are the items).
 */
// Patterns for monster and table detection at the raw-block level.
const STAT_AC = /\bAC\s+\d+/i;
const STAT_LV = /\bLV\s+\d+/i;
const DIE_HEADER_RE = /^d\d{1,3}\b/i;
const LEADING_RANGE_RE = /^\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?=\s|$)/;
const ALL_CAPS_NAME_RE = /^[A-Z][A-Z &/,.''\-]*$/;
const STAT_KW_RE = /\b(AC|HP|ATK|MV|AL|LV|DC|ADV|DISADV)\b/;

/** True if a raw block looks like a dice table (has a dN header or leading-range rows). */
function blockIsDiceTable(block) {
  return block.split("\n").some(l => {
    const t = l.trim();
    return DIE_HEADER_RE.test(t) || LEADING_RANGE_RE.test(l);
  });
}

/** True if a line is an ALL-CAPS monster name line (mirrors statblock-parser logic). */
function isNameLine(line) {
  const t = line.trim();
  if (!/^[A-Z][A-Z &/,.''\-]*$/.test(t)) return false;
  if ((t.match(/[A-Z]/g) || []).length < 2) return false;
  if (STAT_KW_RE.test(t)) return false;
  return true;
}

/** True if a raw block has an AC…LV stat line (the monster anchor). */
function blockHasStatLine(block) {
  const joined = block;
  return STAT_AC.test(joined) && STAT_LV.test(joined);
}

/**
 * Monster recognizer — works at raw-block granularity to avoid consuming table
 * blocks that follow a statblock, then delegates to splitStatblocks for the
 * actual parsing (AC…LV anchor validation + name extraction).
 *
 * Algorithm:
 *   1. Split input into raw blank-line blocks.
 *   2. Walk blocks: when a block starts with an ALL-CAPS name line, collect it
 *      and any following non-name, non-table continuation blocks as a "unit".
 *   3. Pass each unit's combined text through splitStatblocks to validate the
 *      AC…LV anchor and extract the monster chunk.  Units with no stat line →
 *      skipped (section headers / lore).
 *   4. Non-name blocks (tables, plain text) → remainder for later recognizers.
 */
const monsterRecognizer = {
  id: "monster",

  claim(rawText) {
    const allBlocks = splitRawBlocks(rawText);
    const monsters = [];
    const skipped = [];
    const remainderBlocks = [];

    let i = 0;
    while (i < allBlocks.length) {
      const block = allBlocks[i];
      const firstLine = block.split("\n")[0];

      if (isNameLine(firstLine)) {
        // Collect this name-block plus following non-name, non-table blocks.
        const unitBlocks = [block];
        let j = i + 1;
        while (j < allBlocks.length) {
          const next = allBlocks[j];
          const nextFirst = next.split("\n")[0];
          if (isNameLine(nextFirst) || blockIsDiceTable(next)) break;
          unitBlocks.push(next);
          j++;
        }
        i = j;

        // Delegate to splitStatblocks for AC…LV anchor validation.
        // This reuses the proven 18/18 statblock parser logic without
        // reimplementing the stat-line check.
        const combined = unitBlocks.join("\n\n");
        const { monsters: parsed, skipped: parsedSkipped } = splitStatblocks(combined);
        monsters.push(...parsed);
        skipped.push(...parsedSkipped);
      } else {
        // Not a name block → pass to later recognizers.
        remainderBlocks.push(block);
        i++;
      }
    }

    return { claimed: monsters, remainder: remainderBlocks.join("\n\n"), skipped };
  },

  parse(claimedBlocks) {
    // Monster chunks are already the final items (raw text strings from splitStatblocks).
    return claimedBlocks;
  },
};

// ─── Recognizer: tables ───────────────────────────────────────────────────────

/**
 * Table recognizer — delegates to parseTables (alias TableImporter.parse).
 *
 * claim(rawText): runs parseTables over the text.  parseTables splits on blank
 * lines internally and returns ParsedTable[] for blocks with dice rows.  Blocks
 * that produce zero rows are NOT tables — rebuild those as skipped entries.
 *
 * parse(claimedBlocks) → the ParsedTable array (already built during claim;
 * stored on the recognizer's claim result so parse can return it directly).
 */
const tableRecognizer = {
  id: "table",

  claim(rawText) {
    // Process block-by-block so we can distinguish:
    //   (a) blocks that produced ≥1 ParsedTable → claimed
    //   (b) blocks with dice content but 0 rows  → skipped
    //   (c) blocks with no dice content at all   → remainder (let later recognizers try)
    const DIE_HEADER = /^d\d{1,3}\b/i;
    const LEADING_RANGE = /^\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?=\s|$)/;

    function blockHasDiceContent(block) {
      return block.split("\n").some(l => DIE_HEADER.test(l.trim()) || LEADING_RANGE.test(l));
    }

    const allBlocks = splitRawBlocks(rawText);
    const claimed = [];      // ParsedTable[]
    const skipped = [];      // { name, reason }[]
    const remainderBlocks = []; // raw block strings

    for (const block of allBlocks) {
      if (!blockHasDiceContent(block)) {
        // No dice content — not a table. Pass to remainder so later recognizers
        // (or the leftover skipped logic) can handle it.
        remainderBlocks.push(block);
        continue;
      }
      // Has dice content — try to parse.
      const pts = parseTables(block);
      if (pts.length > 0) {
        claimed.push(...pts);
      } else {
        // Dice header present but no parseable rows.
        const firstLine = block.split("\n")[0].trim();
        if (firstLine) {
          skipped.push({ name: firstLine, reason: "dice header present but no parseable rows" });
        }
      }
    }

    return { claimed, remainder: remainderBlocks.join("\n\n"), skipped };
  },

  parse(claimedBlocks) {
    // claimedBlocks IS already the ParsedTable array from claim().
    return claimedBlocks;
  },
};

// ─── Public registry ──────────────────────────────────────────────────────────

/**
 * Ordered recognizer registry.  Each entry: { id, claim(rawText), parse(claimedBlocks) }
 *
 * - `claim(rawText)` → `{ claimed, remainder, skipped? }`
 *     claimed   — the items this recognizer owns (type-specific)
 *     remainder — the text left for subsequent recognizers
 *     skipped   — optional array of { name, reason } for blocks this recognizer
 *                 looked at but rejected
 *
 * - `parse(claimedBlocks)` → items array (recognizer-specific type)
 *
 * Phase 11 plug-in pattern:
 *   import { RECOGNIZERS } from "./dump-segmenter.mjs";
 *   RECOGNIZERS.splice(1, 0, itemsRecognizer); // insert before table recognizer
 *
 * @type {Array<{ id: string, claim: Function, parse: Function }>}
 */
export const RECOGNIZERS = [monsterRecognizer, tableRecognizer];

// ─── Core segmenter ───────────────────────────────────────────────────────────

/**
 * Segment a raw dump into per-recognizer buckets plus a skipped list.
 *
 * Iterates RECOGNIZERS in order.  Each recognizer's claim() receives the
 * text not yet claimed by prior recognizers (the remainder).  The loop
 * never branches on a hardcoded recognizer id — it simply accumulates
 * buckets keyed by recognizer id and merges skipped lists.
 *
 * @param {string|null|undefined} rawText
 * @returns {{ monsters: string[], tables: import("./table-importer.mjs").ParsedTable[], skipped: {name:string,reason:string}[], [id:string]: any[] }}
 */
export function segmentDump(rawText) {
  const text = String(rawText ?? "");
  const result = { skipped: [] };
  let remainder = text;

  for (const rec of RECOGNIZERS) {
    const { claimed, remainder: next, skipped: recSkipped = [] } = rec.claim(remainder);
    result[rec.id] = rec.parse(claimed);
    result.skipped.push(...recSkipped);
    remainder = next;
  }

  // Any text left after all recognizers have run → skipped.
  const leftoverBlocks = splitRawBlocks(remainder);
  for (const block of leftoverBlocks) {
    const firstLine = block.split("\n")[0].trim();
    if (firstLine) {
      result.skipped.push({ name: firstLine, reason: "not claimed by any recognizer" });
    }
  }

  // Guarantee the canonical output keys exist.
  result.monsters = result.monster ?? [];
  delete result.monster;
  result.tables   = result.table   ?? [];
  delete result.table;

  return result;
}

// ─── Internal helpers (exported for tests) ────────────────────────────────────

export const _internals = {
  splitRawBlocks,
};
