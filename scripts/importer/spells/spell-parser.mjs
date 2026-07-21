/**
 * Shadowdark Enhancer — Spell parser (pure, Foundry-free, node-testable).
 *
 * Recognises Shadowdark spell blocks pasted from the rulebooks / Cursed Scrolls
 * and builds Spell drafts for the universal paste-box importer. Mirrors the
 * item parser's recognizer shape (item-parser.mjs).
 *
 * Source format (observed):
 *   NAME                       ← ALL-CAPS, first line
 *   Tier <1-5>, <class>        ← anchor; class is free text ("necromancer")
 *   Duration: <Permanent|Focus|Instant|N rounds|N days>
 *   Range: <Close|Near|Far|Self>
 *   <description, hard-wrapped across many lines>
 *
 * Anchor (A-01 — never guess): a `Tier <1-5>` line PLUS a `Duration:` or
 * `Range:` line. That trio can't appear in a monster statblock (no AC…LV), an
 * item block (no cost/riders), or a dice table — so the recognizer is safe to
 * run BEFORE the monster recognizer (whose ALL-CAPS-name walk would otherwise
 * absorb and skip spell blocks, since spell text legally contains "LV N").
 *
 * Draft shape:
 *   { name, type:"Spell", tier, className, class:[], range, duration:{type,value},
 *     description (HTML), damageType, formula?, source:{title} }
 *   `className` (string) is resolved to `class` (UUID array) at commit time via
 *   class-index.resolveSpellClass — the parser stays Foundry-free.
 *
 * Ships ZERO book content — invented fixture text only.
 */

import { titleCaseName } from "../monsters/statblock-parser.mjs";
import { textToHtml, splitRawBlocks, collapse } from "../pdf-text-utils.mjs";

// ─── Anchor constants ─────────────────────────────────────────────────────────

const TIER_RE     = /^\s*Tier\s+([1-5])\b\s*[,.\-–]?\s*(.*)$/i;
const DURATION_RE = /^\s*Duration\s*[:\-]\s*(.+)$/i;
const RANGE_RE    = /^\s*Range\s*[:\-]\s*(.+)$/i;

/**
 * Wrap body text in `<p>…</p>`, HTML-escaped — pasted PDF text is never
 * trusted as markup (review #1).
 */
function toHtml(body) {
  return textToHtml(body);
}

/** True if a line is an ALL-CAPS spell-name line (mirrors statblock isNameLine). */
function isNameLine(line) {
  const t = String(line ?? "").trim();
  if (!/^[A-Z][A-Z0-9 &/,.'’\-]*$/.test(t)) return false;
  if ((t.match(/[A-Z]/g) || []).length < 2) return false;
  return true;
}

/** Leading connective words that mark a WRAPPED name-continuation line. A long
 *  ALL-CAPS spell heading wraps across lines in the books' two-column layout
 *  ("PROTECTION" / "FROM GOOD"); the lower fragment starts with a connective,
 *  which a real spell name never does — so it joins the line above it, while a
 *  standalone section heading like "SPELLS" above a real name never merges. */
const NAME_CONNECTIVE_RE = /^(?:from|of|the|and|to|with|in|on|for|at|by|into|upon|over|under)\b/i;

/** The index where a wrapped spell name begins, given the name line NEAREST the
 *  Tier anchor. Climbs over all-caps lines while the current line reads as a
 *  connective-led continuation of the line above. Returns `nameIdx` unchanged
 *  for the common single-line (or mixed-case) name. */
function nameStartIndex(lines, nameIdx) {
  let s = nameIdx;
  while (s > 0 && isNameLine(lines[s - 1]) && NAME_CONNECTIVE_RE.test(String(lines[s]).trim())) s--;
  return s;
}

// ─── Range / duration mapping ─────────────────────────────────────────────────

/** Map a raw range word → Shadowdark range enum (self/close/near/far). */
function mapRange(raw, warnings) {
  const s = String(raw ?? "").toLowerCase();
  if (/\bself\b/.test(s))       return "self";
  if (/\btouch\b/.test(s))      return "touch";
  if (/double\s*near/.test(s))  return "doubleNear";
  if (/\bclose\b/.test(s))      return "close";
  if (/\bnear\b/.test(s))       return "near";
  if (/\bfar\b/.test(s))        return "far";
  if (collapse(raw)) warnings.push(`range: unrecognized "${collapse(raw)}" — defaulted to close`);
  return "close";
}

/**
 * Map a raw duration string → { type, value }. Untimed durations
 * (instant/focus/permanent) carry value "-1"; timed ones carry the number.
 * NOTE: enum keys (instant/focus/permanent/rounds/days/turns) are validated
 * against CONFIG.SHADOWDARK.SPELL_DURATIONS during live verification.
 */
function mapDuration(raw, warnings) {
  const s = collapse(raw);
  const lc = s.toLowerCase();
  if (!lc) return { type: "instant", value: "-1" };
  if (/^instant(aneous)?$/.test(lc)) return { type: "instant", value: "-1" };
  if (/^focus$/.test(lc))            return { type: "focus", value: "-1" };
  if (/^permanent$/.test(lc))        return { type: "permanent", value: "-1" };
  let m;
  if ((m = /^(\d+)\s*rounds?$/.exec(lc))) return { type: "rounds", value: String(m[1]) };
  if ((m = /^(\d+)\s*days?$/.exec(lc)))   return { type: "days", value: String(m[1]) };
  if ((m = /^(\d+)\s*turns?$/.exec(lc)))  return { type: "turns", value: String(m[1]) };
  if ((m = /(\d+)/.exec(lc))) {
    warnings.push(`duration: "${s}" not a known form — mapped to ${m[1]} rounds`);
    return { type: "rounds", value: String(m[1]) };
  }
  warnings.push(`duration: unrecognized "${s}" — defaulted to instant`);
  return { type: "instant", value: "-1" };
}

// ─── Core parser ──────────────────────────────────────────────────────────────

/**
 * Parse a single spell block into a draft.
 * Returns `{ draft, warnings }` when the block carries the spell anchor (a Tier
 * line + a Duration or Range line), or `null` otherwise.
 *
 * @param {string} blockText
 * @returns {{ draft: object, warnings: string[] } | null}
 */
export function parseSpell(blockText) {
  const warnings = [];
  const rawLines = String(blockText ?? "").replace(/\r\n?/g, "\n").split("\n")
    .map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
  if (!rawLines.length) return null;

  // Locate the meta lines (order-tolerant), tracking each line's index so the
  // description can be "every non-meta line" rather than "everything after
  // the last meta line" (which silently dropped interleaved prose, review #8).
  let tier = null, className = "", durationRaw = null, rangeRaw = null;
  let tierIdx = -1, durIdx = -1, rangeIdx = -1;
  rawLines.forEach((line, idx) => {
    let m;
    if (tierIdx === -1 && (m = TIER_RE.exec(line))) {
      tierIdx = idx;
      tier = Number(m[1]);
      className = collapse(m[2]).replace(/^[,\s]+/, "").replace(/[.,;:]+$/, "");
    } else if (durIdx === -1 && (m = DURATION_RE.exec(line))) {
      durIdx = idx; durationRaw = m[1];
    } else if (rangeIdx === -1 && (m = RANGE_RE.exec(line))) {
      rangeIdx = idx; rangeRaw = m[1];
    }
  });

  // Anchor check.
  if (tierIdx === -1 || (durationRaw === null && rangeRaw === null)) return null;

  // Name: the heading above the Tier anchor (review #7 — a section heading like
  // "SPELLS" pasted above the real name must NOT become the name). A long
  // ALL-CAPS spell heading wraps across lines in the books' two-column layout
  // ("PROTECTION" / "FROM GOOD"); nameStartIndex climbs over the connective-led
  // continuation so the whole heading is the name, while a standalone heading
  // stays out of it. Anything above the chosen block is surfaced in a warning.
  const nameStart = tierIdx > 0 ? nameStartIndex(rawLines, tierIdx - 1) : tierIdx;
  let name = nameStart < tierIdx
    ? titleCaseName(rawLines.slice(nameStart, tierIdx).map((l) => l.trim()).join(" "))
    : "";
  if (!name) { name = "Unnamed Spell"; warnings.push("name: no name line above the Tier line"); }
  if (nameStart > 0) {
    const lead = rawLines.slice(0, nameStart).map((l) => collapse(l)).filter(Boolean);
    if (lead.length) warnings.push(`ignored ${lead.length} line(s) above the spell name: "${lead.join(" / ")}"`);
  }

  // Description: every non-meta line after the Tier anchor, in source order.
  const metaIdxSet = new Set([tierIdx, durIdx, rangeIdx]);
  const descLines = rawLines.filter((_, idx) => idx > tierIdx && !metaIdxSet.has(idx));
  const description = toHtml(descLines.join(" "));

  const range = mapRange(rangeRaw, warnings);
  const duration = mapDuration(durationRaw, warnings);
  // A missing meta line silently changes spell mechanics — surface the
  // default explicitly (review #9).
  if (durationRaw === null) warnings.push("duration: line missing — defaulted to instant; verify");
  if (rangeRaw === null) warnings.push("range: line missing — defaulted to close; verify");
  if (!className) warnings.push("class: none found on the Tier line — spell will import unlinked");

  // Damage formula: only an NdN that is explicitly a DAMAGE roll (so "1d4
  // rounds" / "1d4 turns" are never mistaken for damage).
  const descText = descLines.join(" ");
  const dmgM = /(\d+d\d+)(?=\s+(?:\w+\s+){0,2}damage)/i.exec(descText) || /(\d+d\d+)\s+damage/i.exec(descText);
  const formula = dmgM ? dmgM[1] : null;

  const draft = {
    name,
    type: "Spell",
    tier: tier ?? 1,
    className,
    class: [],
    range,
    duration,
    description,
    damageType: "none",
    source: { title: "" },
    ...(formula ? { formula } : {}),
  };
  return { draft, warnings };
}

// ─── Block splitting ──────────────────────────────────────────────────────────

/**
 * Split ONE block into spell units. A unit starts at an ALL-CAPS name line whose
 * next non-blank line is a Tier line, and runs until the next such boundary —
 * so spells glued together with NO blank line between them are still separated.
 * Must be called per blank-line block so it never crosses into following
 * non-spell content (a statblock / table after the spell list).
 *
 * @param {string} blockText
 * @returns {{ units: string[], remainder: string }}  remainder = lines before the first unit
 */
function splitSpellUnits(blockText) {
  const lines = String(blockText ?? "").replace(/\r\n?/g, "\n").split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isNameLine(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j < lines.length && TIER_RE.test(lines[j])) {
      // A long ALL-CAPS heading wraps in the book's two-column layout
      // ("PROTECTION" / "FROM GOOD"); only the LAST wrapped line sits directly
      // above the Tier anchor. Extend the unit start UP over the connective-led
      // continuation (shared with parseSpell) so the whole heading belongs to
      // this spell, not glued to the previous one's description — while a real
      // section heading above a standalone name is left out (review #7).
      starts.push(nameStartIndex(lines, i));
      i = j;   // don't rescan the wrapped lines (or the Tier line) as further starts
    }
  }
  if (!starts.length) return { units: [], remainder: String(blockText ?? "") };

  const units = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const unit = lines.slice(from, to).join("\n").trim();
    if (unit) units.push(unit);
  }
  const lead = lines.slice(0, starts[0]).join("\n").trim();
  return { units, remainder: lead };
}

// ─── Recognizer ───────────────────────────────────────────────────────────────

/**
 * Spell recognizer — plugs into the dump-segmenter RECOGNIZERS registry.
 *
 * Registration order: BEFORE monsterRecognizer (see dump-segmenter.mjs). Spell
 * blocks start with ALL-CAPS names and contain "LV N" in their text, which the
 * monster recognizer's name-walk would otherwise consume and skip.
 */
export const spellRecognizer = {
  id: "spell",

  claim(rawText) {
    const claimed = [];
    const remainderParts = [];
    // Per blank-line block so spell-unit splitting never crosses into a
    // following statblock/table block.
    for (const block of splitRawBlocks(rawText)) {
      const { units, remainder } = splitSpellUnits(block);
      if (!units.length) { remainderParts.push(block); continue; }
      if (remainder) remainderParts.push(remainder); // lead lines before the first unit
      for (const unit of units) {
        if (parseSpell(unit) !== null) claimed.push(unit);
        else remainderParts.push(unit);
      }
    }
    return { claimed, remainder: remainderParts.join("\n\n") };
  },

  parse(claimedBlocks) {
    const out = [];
    for (const block of claimedBlocks) {
      const r = parseSpell(block);
      if (r !== null) out.push(r);
    }
    return out;
  },
};

// ─── Internal helpers (exported for tests) ────────────────────────────────────

export const _internals = { splitSpellUnits, mapRange, mapDuration, isNameLine };
