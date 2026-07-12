/**
 * Shadowdark Enhancer — Universal Dump Segmenter
 *
 * Routes a raw mixed PDF dump through a recognizer registry (actual order —
 * see RECOGNIZERS at the bottom of this file):
 *   1. hexcrawl recognizer — clustered 3-4 digit hex anchors (hex-parser.mjs)
 *   2. spell recognizer    — Tier line + Duration/Range anchor (spell-parser.mjs)
 *   3. monster recognizer  — delegates to splitStatblocks (AC…LV anchor)
 *   4. item recognizer     — delegates to parseItem (rider keywords / cost pattern)
 *   5. table recognizer    — delegates to parseTables (dice-table rows)
 *   Anything not claimed by any recognizer → skipped (reviewable, never dropped).
 *
 * Classification order (Claude's Discretion per 10-CONTEXT.md):
 *   Each recognizer claims from the previous one's remainder, so the same
 *   lines are never double-counted; blocks claimed by nothing land in
 *   skipped. Monsters must run before items/tables because statblock blocks
 *   are name-delimited by ALL-CAPS lines; spells run before monsters because
 *   spell text legally contains "LV N"; hexes run first of all (see below).
 *
 * Extensibility: RECOGNIZERS is an ordered array; the loop iterates it in
 * order, never branching on a hardcoded id. ORDER IS SENSITIVE — a new
 * recognizer must be placed deliberately, not pushed at the end: the
 * hexcrawl recognizer runs FIRST because hex bodies legally contain
 * ALL-CAPS headings, statblock lines, and dice text that the later
 * recognizers would otherwise claim (its >=3-unit cluster threshold is
 * what makes first position safe — see hex-parser.mjs, Phase 16 A-01).
 *
 * Pure / Foundry-free — no `game`, `ui`, `CONFIG`, `foundry`, or `Hooks`
 * references.  All helpers are importable by node:test directly.
 */

import { splitStatblocks } from "./statblock-parser.mjs";
import { parseTables } from "./table-importer.mjs";
import { itemRecognizer, RIDER_KW as ITEM_RIDER_RE, COST_RE as ITEM_COST_RE } from "./item-parser.mjs";
import { spellRecognizer } from "./spell-parser.mjs";
import { hexcrawlRecognizer } from "./hex-parser.mjs";
import { splitRawBlocks } from "./pdf-text-utils.mjs";

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
// Patterns for table detection at the raw-block level. (Monster and item
// anchors are imported from their owning parsers; these table regexes are
// deliberately LOOSER than table-importer's row parser — block-level sniffing
// vs row-exact parsing — so they stay local.)
const DIE_HEADER_RE = /^d\d{1,3}\b/i;
const LEADING_RANGE_RE = /^\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?=\s|$)/;
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
  if (!/^[A-Z][A-Z &/,.''-]*$/.test(t)) return false;
  if ((t.match(/[A-Z]/g) || []).length < 2) return false;
  if (STAT_KW_RE.test(t)) return false;
  return true;
}

// Item anchors ITEM_RIDER_RE / ITEM_COST_RE are imported from item-parser
// (the owning module) — used to break monster continuation-block collection
// so item blocks aren't absorbed into a preceding statblock unit.

/** True if a raw block looks like an item entry (has a rider keyword or cost pattern). */
function blockIsItemCandidate(block) {
  return ITEM_RIDER_RE.test(block) || ITEM_COST_RE.test(block);
}

/**
 * Monster recognizer — works at raw-block granularity to avoid consuming table
 * blocks that follow a statblock, then delegates to splitStatblocks for the
 * actual parsing (AC…LV anchor validation + name extraction).
 *
 * Algorithm:
 *   1. Split input into raw blank-line blocks.
 *   2. Walk blocks: when a block starts with an ALL-CAPS name line, collect it
 *      and any following non-name, non-table, non-item continuation blocks as a "unit".
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
        // Collect this name-block plus following non-name, non-table,
        // non-item continuation blocks.  Stopping at item candidates ensures
        // that an item block immediately after a statblock reaches the item
        // recognizer rather than being absorbed into the monster unit.
        const unitBlocks = [block];
        let j = i + 1;
        while (j < allBlocks.length) {
          const next = allBlocks[j];
          const nextFirst = next.split("\n")[0];
          if (isNameLine(nextFirst) || blockIsDiceTable(next) || blockIsItemCandidate(next)) break;
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
        if (parsed.length === 0 && (blockIsItemCandidate(combined) || blockIsDiceTable(combined))) {
          // A zero-monster unit with an item/table anchor is NOT lore — an
          // ALL-CAPS magic-item block (name + Benefit./Curse. riders) was
          // being consumed here and skipped as "no stat line" before the
          // item recognizer ever saw it (live-caught, 11-03 checkpoint).
          // Hand the unit to later recognizers instead.
          remainderBlocks.push(...unitBlocks);
        } else {
          skipped.push(...parsedSkipped);
        }
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
 * Registration order (ORDER IS SENSITIVE):
 *   [hexcrawl, spell, monster, item, table]
 *   Hexcrawl runs FIRST: hex bodies legally contain ALL-CAPS headings,
 *   statblock lines, and dice text the later recognizers would steal; its
 *   >=3-consecutive-anchored-units cluster threshold (A-01) means statblock
 *   or table dumps can never be claimed by it. Spell runs BEFORE monster: a
 *   spell block starts with an ALL-CAPS name and its text legally contains
 *   "LV N", so the monster name-walk would otherwise absorb and skip it; the
 *   Tier + Duration/Range anchor can't match a monster/item/table. Items run
 *   after monsters (statblock continuations already claimed) and before tables
 *   (item blocks don't fall into the table recognizer's no-dice remainder).
 *
 * @type {Array<{ id: string, claim: Function, parse: Function }>}
 */
export const RECOGNIZERS = [hexcrawlRecognizer, spellRecognizer, monsterRecognizer, itemRecognizer, tableRecognizer];

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
 * @returns {{ monsters: string[], items: {draft:object,warnings:string[]}[], tables: import("./table-importer.mjs").ParsedTable[], skipped: {name:string,reason:string}[], [id:string]: any[] }}
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
  result.items    = result.item    ?? [];
  delete result.item;
  result.tables   = result.table   ?? [];
  delete result.table;
  result.spells   = result.spell   ?? [];
  delete result.spell;
  result.hexes    = result.hexcrawl ?? [];
  delete result.hexcrawl;

  return result;
}

// ─── Internal helpers (exported for tests) ────────────────────────────────────

export const _internals = {
  splitRawBlocks,
};
