/**
 * Downtime unlock warnings — one shared prose map for every surface that
 * renders a parseDowntimeText() result (the Importer Hub's downtime preview,
 * and any in-app unlock panel).
 *
 * Split out of downtime-app.mjs so the hub and the app can't drift apart on
 * what a parser code means. Pure: no Foundry globals, no Date, no Math.random.
 *
 * `info: true` marks a note the GM can ignore — a two-column PDF paste ALWAYS
 * reports segment-overflow / orphan-segment / phase2-fill even when all 25
 * slots land correctly, because that is precisely the corruption signature the
 * interleave rescue keys off. Rendering those in the same red as a real
 * problem would make a perfect unlock look broken.
 */

import { slotByKey } from "./downtime-core.mjs";
import { DOWNTIME_SKELETON } from "./downtime-skeleton.mjs";

/** One string from `languages/en.json`; the key when no i18n is mounted. */
const L = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

/** Slot key → its printed label, for warning prose. */
export function slotLabel(key) {
  try {
    return slotByKey(key)?.slot?.label ?? key;
  } catch {
    return key;
  }
}

/** Activity key → its printed name ("martialTraining" → "Martial Training"). */
function activityLabel(key) {
  const found = (DOWNTIME_SKELETON?.activities ?? []).find((a) => a.key === key);
  return found?.name ?? key ?? L("SDE.downtime.warn.thisActivity");
}

/**
 * What a given activity needs ABOVE its bullets before they can be filed.
 *
 * Each of these needs a line of its own above the bullets, and they are the
 * activities that go missing when a paste lacks one — so the note names the
 * line to look for rather than leaving the GM to infer it. Martial Training
 * and Magical Research need a true sub-heading; Skulduggery needs the check
 * line that tells its CHA half from its DEX half.
 *
 * The quoted lines are the book's own headings (what the parser looks for), so
 * they stay data; only the sentence around them is translated.
 */
const SUBHEADING_HINT = {
  martialTraining: ["SDE.downtime.warn.hintTier", { line: "d4. INT, STR, or DEX Check" }],
  magicalResearch: ["SDE.downtime.warn.hintSubsection", { line: "INT or CHA Spellcasters" }],
  skulduggery: ["SDE.downtime.warn.hintCheck", { cha: "CHA Check", dex: "DEX Check" }],
};

/**
 * Human-readable text for the parser's warning codes, keyed to the codes
 * downtime-parser.mjs actually emits.
 */
export const WARNING_TEXT = {
  "segment-overflow": {
    info: true,
    text: (w) => L("SDE.downtime.warn.segmentOverflow", { segment: w.segmentId, bullets: w.bullets, slots: w.slots }),
  },
  "orphan-segment": {
    info: true,
    text: (w) => L("SDE.downtime.warn.orphanSegment", { activity: w.activity }),
  },
  "phase2-fill": {
    info: true,
    text: (w) => L("SDE.downtime.warn.phase2Fill", { slot: slotLabel(w.slot), segment: w.fromSegment }),
  },
  "asterisk-mismatch": {
    info: false,
    text: (w) => {
      const key = w.bulletStar
        ? (w.skeletonPaid ? "SDE.downtime.warn.asteriskMarkedPaid" : "SDE.downtime.warn.asteriskMarkedFree")
        : (w.skeletonPaid ? "SDE.downtime.warn.asteriskUnmarkedPaid" : "SDE.downtime.warn.asteriskUnmarkedFree");
      return L(key, { slot: slotLabel(w.slot) });
    },
  },
  "duplicate-fill": {
    info: false,
    text: (w) => L("SDE.downtime.warn.duplicateFill", { slot: slotLabel(w.slot) }),
  },
  "ambiguous-match": {
    info: false,
    text: (w) => L("SDE.downtime.warn.ambiguousMatch", { candidates: (w.candidates ?? []).map(slotLabel).join(", ") }),
  },
  "authority-mismatch": {
    info: false,
    text: (w) => L("SDE.downtime.warn.authorityMismatch", { found: w.found, source: w.source, expected: w.expected }),
  },
  "incomplete-unlock": {
    info: false,
    text: (w) => L("SDE.downtime.warn.incompleteUnlock", { filled: w.filled, expected: w.expected }),
  },

  /* The four below are the parser's "couldn't place this line" codes. They used
   * to fall through to the `Parser note: <code>` default, which renders as a
   * quiet info line — so a paste that dropped two whole activities looked no
   * noisier than a clean one. They are real problems and now say so. */

  "unresolved-segment": {
    info: false,
    text: (w) => {
      const hint = SUBHEADING_HINT[w.activity];
      const activity = activityLabel(w.activity);
      return hint
        ? L("SDE.downtime.warn.unresolvedSegmentHint", { activity, hint: L(...hint) })
        : L("SDE.downtime.warn.unresolvedSegment", { activity });
    },
  },
  "missing-activity-header": {
    info: false,
    text: () => L("SDE.downtime.warn.missingHeader"),
  },
  "keyword-miss": {
    info: false,
    text: (w) => L("SDE.downtime.warn.keywordMiss", { dc: w.dc, segment: w.segmentId }),
  },
  "dc-not-in-segment": {
    info: false,
    text: (w) => L("SDE.downtime.warn.dcNotInSegment", { dc: w.dc, segment: w.segmentId }),
  },
};

/** Turn a warning object from the parser into {text, info} for a preview. */
export function warningText(w) {
  const def = WARNING_TEXT[w?.code];
  if (!def) return { text: L("SDE.downtime.warn.parserNote", { code: w?.code ?? "unknown" }), info: true };
  try {
    return { text: def.text(w), info: def.info };
  } catch {
    return { text: L("SDE.downtime.warn.parserNote", { code: w.code }), info: def.info };
  }
}

/**
 * Shape a parse result for a preview: real problems first, the two-column
 * recovery notes below them. Shared by every unlock surface.
 * @param {{warnings?: object[]}} parseResult
 * @returns {Array<{text: string, info: boolean}>}
 */
export function warningLines(parseResult) {
  // The place-this-line codes fire once per BULLET, so a whole activity that
  // failed to open would repeat one sentence fifteen times. Identical text is
  // one problem however many lines it swallowed; collapse it.
  const seen = new Set();
  return (parseResult?.warnings ?? [])
    .map(warningText)
    .filter(({ text }) => {
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .sort((a, b) => Number(a.info) - Number(b.info));
}
