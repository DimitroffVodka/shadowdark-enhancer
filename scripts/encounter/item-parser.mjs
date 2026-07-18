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
import { escapeHtml, textToHtml, splitRawBlocks, collapse } from "./pdf-text-utils.mjs";

// ─── Anchor constants ─────────────────────────────────────────────────────────

/** Rider keywords that anchor a magic-item block. Exported: the segmenter
 * reuses the owning parser's anchors (review 2026-07-11 maintainability). */
export const RIDER_KW = /\b(Benefit|Bonus|Curse|Personality)\./;

/** Cost pattern — at least one `N gp/sp/cp` occurrence. Exported for the
 * segmenter (same reuse rule as RIDER_KW). */
export const COST_RE = /(\d+)\s*(gp|sp|cp)\b/i;

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

/**
 * Wrap body text in `<p>…</p>`, HTML-escaped. Pasted PDF text is plain text —
 * a leading `<` is content to escape, never markup to trust (review #1).
 * @param {string} body
 * @returns {string}
 */
function toHtml(body) {
  return textToHtml(body);
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
 * `force` (set when the hub's item-type selector is on a specific subtype — the
 * GM has asserted "these are items") skips the anchor gate: every non-empty
 * block becomes an item via the gear path, cost/slots optional. Auto mode keeps
 * the strict gate so arbitrary prose never turns into items.
 *
 * @param {string} blockText
 * @param {{ force?: boolean }} [opts]
 * @returns {{ draft: object, warnings: string[] } | null}
 */
export function parseItem(blockText, { force = false } = {}) {
  const warnings = [];
  const rawLines = String(blockText ?? "").replace(/\r\n?/g, "\n").split("\n")
    .map(l => l.replace(/\s+$/, "")).filter(l => l.trim() !== "");

  if (!rawLines.length) return null;

  let nameLine = rawLines[0];
  const bodyLines = rawLines.slice(1);

  // Same-line rider split ("Flame Ring Benefit. You resist fire.") — the
  // rider text moves to the body so extractRiders sees it; it must never be
  // title-cased into the name (review #6).
  const inlineRider = /^(.*?)\s*\b(Benefit|Bonus|Curse|Personality)\.\s*(.*)$/.exec(nameLine);
  if (inlineRider && inlineRider[1].trim()) {
    nameLine = inlineRider[1].trim().replace(/[,;:]\s*$/, "");
    bodyLines.unshift(`${inlineRider[2]}. ${inlineRider[3]}`.trim());
  }

  // Name is the first line — strip inline cost/slot tokens first
  // ("Probe Rope, 5 gp, 1 slot" → "Probe Rope"); gear-line names were
  // retaining their cost text (live-caught, 11-03 checkpoint).
  const nameRaw = nameLine.replace(/,?\s*\d+\s*(gp|sp|cp)\b.*$/i, "").trim();
  const name = titleCaseName(nameRaw);

  const bodyText = bodyLines.join("\n");

  // ── Determine anchor type ──
  const hasMagicAnchor = RIDER_KW.test(bodyText) || RIDER_KW.test(nameLine);
  const hasGearAnchor = COST_RE.test(bodyText) || COST_RE.test(nameLine);

  if (!hasMagicAnchor && !hasGearAnchor && !force) return null;

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

    // Description: assemble from remaining body lines + rider summary.
    // Every pasted fragment is escaped before entering module markup.
    const descParts = [];
    if (remainingLines.length) descParts.push(textToHtml(remainingLines.join(" ")));
    for (const b of benefit) descParts.push(`<p><strong>Benefit.</strong> ${escapeHtml(b)}</p>`);
    if (bonus) descParts.push(`<p><strong>Bonus.</strong> ${escapeHtml(bonus)}</p>`);
    if (curse) descParts.push(`<p><strong>Curse.</strong> ${escapeHtml(curse)}</p>`);
    if (personality) descParts.push(`<p><strong>Personality.</strong> ${escapeHtml(personality)}</p>`);

    draft.description = descParts.length ? descParts.join("\n") : "<p></p>";

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

    // Description: keep every body line, removing only the recognized
    // cost/slot tokens — a line like "50 feet long, 5 gp, 1 slot" keeps
    // "50 feet long" instead of being dropped wholesale (review #5).
    const stripTokens = (l) => collapse(
      String(l ?? "")
        .replace(new RegExp(COST_RE.source, "gi"), "")
        .replace(new RegExp(SLOTS_RE.source, "gi"), "")
    ).replace(/\s*,\s*(?=,|$)/g, "").replace(/^[,\s]+/, "").trim();
    const descLines = bodyLines.map(stripTokens).filter(Boolean);

    // Inline name-line remainder ("Rope, 5 gp, 1 slot, 50 feet of hemp" →
    // "50 feet of hemp") joins the description instead of being discarded.
    const strippedNameLine = stripTokens(nameLine);
    let nameLineExtra = "";
    if (nameRaw && strippedNameLine.toLowerCase().startsWith(nameRaw.toLowerCase())) {
      nameLineExtra = strippedNameLine.slice(nameRaw.length).replace(/^[,\s]+/, "").trim();
    }

    const descBody = [nameLineExtra, ...descLines].filter(Boolean).join(" ").trim();
    draft.description = toHtml(descBody || "");
  }

  return { draft, warnings };
}

// ─── Recognizer ───────────────────────────────────────────────────────────────

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
 * Registration order (see dump-segmenter.mjs RECOGNIZERS):
 *   [hexcrawl, spell, monster, item, table]
 *   Must run AFTER monsters (so statblock continuations are already claimed)
 *   and BEFORE tables (so item blocks don't fall through to the table
 *   recognizer's no-dice remainder path).
 */
export const itemRecognizer = {
  id: "item",

  /**
   * @param {string} rawText
   * @param {{ force?: boolean }} [opts]  force → claim every block (subtype set)
   * @returns {{ claimed: string[], remainder: string, skipped?: {name,reason}[] }}
   */
  claim(rawText, { force = false } = {}) {
    const blocks = force ? _forceBlocks(rawText) : splitRawBlocks(rawText);
    const claimed = [];
    const remainderBlocks = [];
    const skipped = [];

    for (const block of blocks) {
      // Force mode: a block still carrying many prices after splitting is a
      // multi-column reference table (Basic Gear / Weapons grid) whose names and
      // costs sit in separate columns — it can't be split into per-item rows, so
      // parsing it as one item sums every price and mashes the whole grid into a
      // single garbage description. Decline it with a clear reason instead.
      if (force && _looksLikeTableDump(block)) {
        skipped.push({
          name: _firstLine(block),
          reason: "Looks like a multi-column equipment table, not individual items — its names and prices are in separate columns, so it can't be split into rows. The core gear/weapons/armor already ship in the shadowdark.gear and shadowdark.magic-items compendiums; drag from there instead.",
        });
        continue;
      }
      const result = parseItem(block, { force });
      if (result !== null) {
        claimed.push(block);
      } else {
        remainderBlocks.push(block);
      }
    }

    return {
      claimed,
      remainder: remainderBlocks.join("\n\n"),
      skipped,
    };
  },

  /**
   * @param {string[]} claimedBlocks
   * @param {{ force?: boolean }} [opts]
   * @returns {{ draft: object, warnings: string[] }[]}
   */
  parse(claimedBlocks, { force = false } = {}) {
    const items = [];
    for (const block of claimedBlocks) {
      const result = parseItem(block, { force });
      if (result !== null) items.push(result);
    }
    return items;
  },
};

/**
 * Block splitting for force (subtype-selected) mode. Starts from the blank-line
 * blocks, then splits any block that is a clean gear LIST — 2+ lines, every line
 * carrying a cost token and no rider keyword — into one item per line. This is
 * the PDF-dump case where items ("Torch 5 sp, 1 slot" / "Rope 1 gp…") sit on
 * consecutive lines with no blank gap, which blank-line splitting would fuse
 * into one wrong item. Multi-line items (a name line + a description/cost line)
 * are left intact because their non-cost lines fail the every-line test.
 */
function _forceBlocks(rawText) {
  const out = [];
  for (const block of splitRawBlocks(rawText)) {
    if (RIDER_KW.test(block)) { out.push(block); continue; }   // magic item — keep whole
    const lines = block.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
    const priced = lines.filter((l) => COST_RE.test(l));
    // A gear list / table: 2+ rows that each pair a name with a cost on the SAME
    // line — a clean single-column extraction of the Basic Gear / Weapons grid
    // ("Ball bearing 1 gp 1"), or a hand list. Emit each priced row as its own
    // item; the ALL-CAPS caption ("BASIC GEAR"), the "Item Cost Quantity Slot"
    // column header, and price-less rows (Coin/Gem "Varies") carry no cost token
    // so they're naturally dropped — they'd need a manual cost anyway. This is
    // what lets the WR gear table import as ~26 items instead of one blob.
    if (priced.length >= 2) {
      out.push(...priced);
      // "Varies"-cost rows (Coin, Gem) are real gear the manifest expects —
      // dropping them left "Gem" permanently locked (E2E D7). Emit them with a
      // 0-cost token; the description pass supplies the value rules.
      for (const l of lines) {
        if (!COST_RE.test(l) && /\bvaries\b/i.test(l) && /^[A-Za-z]/.test(l.trim()))
          out.push(l.replace(/\bvaries\b/i, "0 gp"));
      }
    } else {
      out.push(block);
    }
  }
  return out;
}

/** First non-empty line of a block, trimmed — a readable label for a skip. */
function _firstLine(block) {
  const l = String(block).split("\n").map((s) => s.trim()).find(Boolean) ?? "(empty)";
  return l.length > 60 ? `${l.slice(0, 57)}…` : l;
}

/**
 * A block that carries several prices across several lines is a multi-column
 * reference table (prices in one column, names in another), not one item —
 * parsing it as a single item sums every price and mashes the whole grid into
 * one description. A ≥4-cost-token / ≥3-line threshold keeps it from firing on a
 * legitimate item that merely mentions a price or two. Only consulted in force
 * mode, after per-line gear-list splitting has already peeled off clean rows.
 */
function _looksLikeTableDump(block) {
  const costs = String(block).match(new RegExp(COST_RE.source, "gi")) || [];
  const lines = String(block).split("\n").filter((l) => l.trim());
  return costs.length >= 4 && lines.length >= 3;
}

// ─── Item descriptions (second-pass, matched by name) ─────────────────────────

/**
 * Split a pasted "descriptions" blob — the book's `Name. flavor/rules text…`
 * section that sits apart from the price table — into per-item descriptions,
 * anchored on a KNOWN item-name list (from the already-imported items). Anchoring
 * on real names is what makes this robust: a description's own sentences end in
 * periods too, so a blind "Capitalised word ." split would shred them. A header
 * is a known name at the start of the text or just after a sentence/line break,
 * followed by a period; the description runs to the next header. Longest names
 * win (so "Rope, morzo silk" beats "Rope"), and overlapping shorter matches are
 * dropped. Returns [{ name, description }] in reading order; `name` is the exact
 * known-list spelling so the caller can match it straight back to its item.
 *
 * @param {string} text
 * @param {string[]} names   known item names to anchor on
 * @returns {{name: string, description: string}[]}
 */
export function splitDescriptionsByNames(text, names) {
  const clean = String(text ?? "").replace(/\r\n?/g, "\n");
  const uniq = [...new Set((names ?? []).map((n) => String(n ?? "").trim()).filter(Boolean))];
  if (!clean.trim() || !uniq.length) return [];
  // Longest names first so a multi-word name anchors before its shorter prefix.
  uniq.sort((a, b) => b.length - a.length);

  const anchors = [];
  for (const name of uniq) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Header = start-of-text or after a period/newline, the name, then a period.
    const re = new RegExp(`(^|[.\\n]\\s*)(${esc})\\.`, "gi");
    let m;
    while ((m = re.exec(clean)) !== null) {
      anchors.push({ name, start: m.index + m[1].length, bodyStart: re.lastIndex });
      re.lastIndex = m.index + m[1].length + 1;   // allow overlapping scans
    }
  }
  if (!anchors.length) return [];
  // Earliest first; at a tie prefer the longer name. Then drop any anchor that
  // starts inside an already-claimed header (a shorter name nested in a longer).
  anchors.sort((a, b) => a.start - b.start || b.name.length - a.name.length);
  const picked = [];
  let claimedTo = -1;
  for (const a of anchors) {
    if (a.start < claimedTo) continue;
    picked.push(a);
    claimedTo = a.bodyStart;
  }
  const out = [];
  for (let i = 0; i < picked.length; i++) {
    const end = i + 1 < picked.length ? picked[i + 1].start : clean.length;
    const description = collapse(clean.slice(picked[i].bodyStart, end));
    if (description) out.push({ name: picked[i].name, description });
  }
  return out;
}

// ─── Internal helpers (exported for tests) ────────────────────────────────────

export const _internals = {
  splitRawBlocks,
  extractRiders,
  inferItemType,
  toHtml,
};
