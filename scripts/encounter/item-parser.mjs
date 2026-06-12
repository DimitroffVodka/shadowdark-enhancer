/**
 * Shadowdark Enhancer — Item parser (pure, Foundry-free, node-testable).
 *
 * Recognises item entries from a raw PDF dump and builds draft objects for the
 * universal paste-box importer (D9, A-01, A-02).
 *
 * Two deterministic anchors (A-01 — never guess):
 *   (a) Magic-item block — a name line followed by text containing a rider
 *       keyword: `Benefit.`, `Bonus.`, `Curse.`, or `Personality.`.
 *   (b) Gear line — a name followed (same or next line) by a cost pattern
 *       `N gp/sp/cp`, with an optional `N slots` / `N slot` field.
 *   Anything without an anchor → parseItem returns null; itemRecognizer
 *   leaves the block in remainder.  Nothing is ever guessed.
 *
 * Draft shape (A-02):
 *   { name, type, cost:{gp,sp,cp}, slots:{free_carry,per_slot,slots_used},
 *     description, riders:{benefit:[], bonus, curse, personality}, img }
 *
 * Ships ZERO book content — invented fixture text only.
 */

import { titleCaseName } from "./statblock-parser.mjs";
import { parseValue, pickTreasureIcon } from "./loot-pack.mjs";

// ─── Anchor constants ─────────────────────────────────────────────────────────

/** Rider keywords that anchor a magic-item block. */
const RIDER_KW = /\b(Benefit|Bonus|Curse|Personality)\./;

/** Cost pattern — at least one `N gp/sp/cp` occurrence. */
const COST_RE = /(\d+)\s*(gp|sp|cp)\b/i;

/** Slots pattern — `N slots` or `N slot`. */
const SLOTS_RE = /(\d+)\s*slots?\b/i;

// ─── Type inference ───────────────────────────────────────────────────────────

/**
 * Infer the Shadowdark Item type from the item name.
 * Mirrors the keyword sets in magic-forge.mjs / loot-pack.mjs but maps to
 * Shadowdark item type strings ("Weapon"/"Armor"/"Potion"/"Scroll"/"Wand"/"Basic").
 * Order matters: more specific first.
 *
 * @param {string} name
 * @returns {"Weapon"|"Armor"|"Potion"|"Scroll"|"Wand"|"Basic"}
 */
function inferItemType(name) {
  const s = String(name ?? "").toLowerCase();
  if (/scroll/.test(s)) return "Scroll";
  if (/wand/.test(s)) return "Wand";
  if (/potion/.test(s)) return "Potion";
  if (/armor|mail|plate|shield|chainmail|leather/.test(s)) return "Armor";
  if (/weapon|sword|axe|mace|bow|dagger|spear|blade|hammer|flail/.test(s)) return "Weapon";
  return "Basic";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Wrap body text in `<p>…</p>` unless it already starts with `<` (D4 discipline).
 * @param {string} body
 * @returns {string}
 */
function toHtml(body) {
  const s = collapse(body);
  if (!s) return "<p></p>";
  return s.startsWith("<") ? s : `<p>${s}</p>`;
}

/**
 * Extract rider lines from block text.
 * Returns { benefit: string[], bonus: string, curse: string, personality: string,
 *           remainingLines: string[] }.
 * Each rider key in the text is `Keyword. text here`.
 */
function extractRiders(lines) {
  const benefit = [];
  let bonus = "";
  let curse = "";
  let personality = "";
  const remainingLines = [];

  let currentRider = null;
  let currentText = "";

  function flushRider() {
    if (!currentRider) return;
    const text = collapse(currentText);
    if (currentRider === "benefit") benefit.push(text);
    else if (currentRider === "bonus") bonus = text;
    else if (currentRider === "curse") curse = text;
    else if (currentRider === "personality") personality = text;
    currentRider = null;
    currentText = "";
  }

  for (const line of lines) {
    const m = /^(Benefit|Bonus|Curse|Personality)\.\s*(.*)$/i.exec(line.trim());
    if (m) {
      flushRider();
      currentRider = m[1].toLowerCase();
      currentText = m[2];
    } else if (currentRider) {
      // Continuation line of a rider
      currentText = collapse(`${currentText} ${line}`);
    } else {
      remainingLines.push(line);
    }
  }
  flushRider();

  return { benefit, bonus, curse, personality, remainingLines };
}

// ─── Core parser ──────────────────────────────────────────────────────────────

/**
 * Parse a single blank-line block into an item draft.
 *
 * Returns `{ draft, warnings }` when the block has a valid anchor, or `null`
 * when the block has neither a rider keyword nor a cost pattern.
 *
 * @param {string} blockText
 * @returns {{ draft: object, warnings: string[] } | null}
 */
export function parseItem(blockText) {
  const warnings = [];
  const rawLines = String(blockText ?? "").replace(/\r\n?/g, "\n").split("\n")
    .map(l => l.replace(/\s+$/, "")).filter(l => l.trim() !== "");

  if (!rawLines.length) return null;

  // Name is the first line — strip inline cost/slot tokens first
  // ("Probe Rope, 5 gp, 1 slot" → "Probe Rope"); gear-line names were
  // retaining their cost text (live-caught, 11-03 checkpoint).
  const nameLine = rawLines[0];
  const name = titleCaseName(
    nameLine.replace(/,?\s*\d+\s*(gp|sp|cp)\b.*$/i, "").trim()
  );

  // Body = everything after the name line (joined)
  const bodyLines = rawLines.slice(1);
  const bodyText = bodyLines.join("\n");

  // ── Determine anchor type ──
  const hasMagicAnchor = RIDER_KW.test(bodyText) || RIDER_KW.test(nameLine);
  const hasGearAnchor = COST_RE.test(bodyText) || COST_RE.test(nameLine);

  if (!hasMagicAnchor && !hasGearAnchor) return null;

  // ── Shared defaults ──
  const type = inferItemType(name);
  const img = pickTreasureIcon(name);

  const draft = {
    name,
    type,
    cost: { gp: 0, sp: 0, cp: 0 },
    slots: { free_carry: 0, per_slot: 1, slots_used: 1 },
    description: "",
    riders: { benefit: [], bonus: "", curse: "", personality: "" },
    img,
  };

  if (hasMagicAnchor) {
    // ── Magic-item path ──
    const { benefit, bonus, curse, personality, remainingLines } = extractRiders(bodyLines);
    draft.riders = { benefit, bonus, curse, personality };

    // Cost (optional on magic items — warn but don't fail)
    const allText = rawLines.join("\n");
    if (COST_RE.test(allText)) {
      draft.cost = parseValue(allText);
    } else {
      warnings.push("cost: magic item has no cost pattern — set manually");
    }

    // Slots (optional)
    const allForSlots = rawLines.join("\n");
    const slotsM = SLOTS_RE.exec(allForSlots);
    if (slotsM) {
      draft.slots.slots_used = Number(slotsM[1]);
    }

    // Description: assemble from remaining body lines + rider summary
    const descParts = [];
    if (remainingLines.length) descParts.push(remainingLines.join(" ").trim());
    for (const b of benefit) descParts.push(`<p><strong>Benefit.</strong> ${b}</p>`);
    if (bonus) descParts.push(`<p><strong>Bonus.</strong> ${bonus}</p>`);
    if (curse) descParts.push(`<p><strong>Curse.</strong> ${curse}</p>`);
    if (personality) descParts.push(`<p><strong>Personality.</strong> ${personality}</p>`);

    if (descParts.length) {
      // The first part may be plain text — wrap it; rider lines are already <p>
      const first = descParts[0];
      const wrappedFirst = first.startsWith("<") ? first : `<p>${first}</p>`;
      draft.description = [wrappedFirst, ...descParts.slice(1)].join("\n");
    } else {
      draft.description = "<p></p>";
    }

  } else {
    // ── Gear path ──
    const allText = rawLines.join("\n");
    draft.cost = parseValue(allText);

    // Slots
    const slotsM = SLOTS_RE.exec(allText);
    if (slotsM) {
      const n = Number(slotsM[1]);
      if (Number.isFinite(n) && n > 0) {
        draft.slots.slots_used = n;
      } else {
        warnings.push("slots: could not parse slot count — defaulted to 1");
      }
    }
    // Else default slots_used = 1 (already set)

    // Description: body lines minus the cost/slots portion
    const descLines = bodyLines.filter(l => !COST_RE.test(l) && !SLOTS_RE.test(l));
    // Also strip cost/slots from nameLine if inline
    const nameBodyStripped = collapse(
      nameLine
        .replace(COST_RE, "")
        .replace(SLOTS_RE, "")
        .replace(/,\s*$/, "")
        .trim()
    );
    // Only use nameBodyStripped if it differs from name (i.e. there was inline content after name)
    const extraFromName = nameBodyStripped !== name.trim() && nameBodyStripped.length > name.trim().length
      ? "" // No extra — the name was just the name
      : "";

    const descBody = descLines.join(" ").trim();
    draft.description = toHtml(descBody || "");
  }

  return { draft, warnings };
}

// ─── Recognizer ───────────────────────────────────────────────────────────────

/**
 * Split raw text into blank-line-separated blocks (mirrors segmenter helper).
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

/**
 * Items recognizer — plugs into the dump-segmenter RECOGNIZERS registry.
 *
 * id: "item"
 * claim(rawText): splits into blank-line blocks, claims any block that
 *   parseItem accepts (returns non-null). Remainder is passed to subsequent
 *   recognizers (the table recognizer).
 * parse(claimedBlocks): returns { draft, warnings }[] — NOT raw strings.
 *   Items return draft objects immediately (no second parse pass needed).
 *
 * Registration order (see dump-segmenter.mjs):
 *   [monsterRecognizer, itemRecognizer, tableRecognizer]
 *   Must run AFTER monsters (so statblock continuations are already claimed)
 *   and BEFORE tables (so item blocks don't fall through to the table
 *   recognizer's no-dice remainder path).
 */
export const itemRecognizer = {
  id: "item",

  /**
   * @param {string} rawText
   * @returns {{ claimed: string[], remainder: string, skipped?: {name,reason}[] }}
   */
  claim(rawText) {
    const blocks = splitRawBlocks(rawText);
    const claimed = [];
    const remainderBlocks = [];

    for (const block of blocks) {
      const result = parseItem(block);
      if (result !== null) {
        claimed.push(block);
      } else {
        remainderBlocks.push(block);
      }
    }

    return {
      claimed,
      remainder: remainderBlocks.join("\n\n"),
    };
  },

  /**
   * @param {string[]} claimedBlocks
   * @returns {{ draft: object, warnings: string[] }[]}
   */
  parse(claimedBlocks) {
    const items = [];
    for (const block of claimedBlocks) {
      const result = parseItem(block);
      if (result !== null) items.push(result);
    }
    return items;
  },
};

// ─── Internal helpers (exported for tests) ────────────────────────────────────

export const _internals = {
  splitRawBlocks,
  extractRiders,
  inferItemType,
  toHtml,
};
