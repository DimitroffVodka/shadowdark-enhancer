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

/** Slot key → its printed label, for warning prose. */
export function slotLabel(key) {
  try {
    return slotByKey(key)?.slot?.label ?? key;
  } catch {
    return key;
  }
}

/** Activity key → its printed name ("martialTraining" → "Martial Training"). */
export function activityLabel(key) {
  const found = (DOWNTIME_SKELETON?.activities ?? []).find((a) => a.key === key);
  return found?.name ?? key ?? "This activity";
}

/**
 * What a given activity needs ABOVE its bullets before they can be filed.
 *
 * Only these two carry a sub-heading, and they are exactly the two that go
 * missing when a paste lacks one — so the note names the line to look for
 * rather than leaving the GM to infer it.
 */
const SUBHEADING_HINT = {
  martialTraining: 'a tier line — "d4. INT, STR, or DEX Check"',
  magicalResearch: 'a subsection line — "INT or CHA Spellcasters"',
  skulduggery: 'a check line — "CHA Check" or "DEX Check"',
};

/**
 * Human-readable text for the parser's warning codes, keyed to the codes
 * downtime-parser.mjs actually emits.
 */
export const WARNING_TEXT = {
  "segment-overflow": {
    info: true,
    text: (w) => `Two-column paste detected: the "${w.segmentId}" block held ${w.bullets} lines for ${w.slots} slots. The extra lines were re-homed below.`,
  },
  "orphan-segment": {
    info: true,
    text: (w) => `"${w.activity}" had no lines of its own — its column was merged into a neighbour. Re-homed below.`,
  },
  "phase2-fill": {
    info: true,
    text: (w) => `Recovered "${slotLabel(w.slot)}" out of the "${w.fromSegment}" block.`,
  },
  "asterisk-mismatch": {
    info: false,
    text: (w) => `"${slotLabel(w.slot)}": the paste ${w.bulletStar ? "marks" : "does not mark"} this activity with an asterisk, but this book ${w.skeletonPaid ? "charges" : "does not charge"} for it. The book's cost rule wins — check the page.`,
  },
  "duplicate-fill": {
    info: false,
    text: (w) => `Two pasted lines both matched "${slotLabel(w.slot)}". The first one was kept.`,
  },
  "ambiguous-match": {
    info: false,
    text: (w) => `A line could have been any of: ${(w.candidates ?? []).map(slotLabel).join(", ")}. It was left unmatched — assign it by hand or paste that column on its own.`,
  },
  "authority-mismatch": {
    info: false,
    text: (w) => `This text names "${w.found}" but ${w.source} expects "${w.expected}" — you may have picked the wrong source book.`,
  },
  "incomplete-unlock": {
    info: false,
    text: (w) => `Only ${w.filled} of ${w.expected} slots matched. The rest stay locked until you paste them.`,
  },

  /* The four below are the parser's "couldn't place this line" codes. They used
   * to fall through to the `Parser note: <code>` default, which renders as a
   * quiet info line — so a paste that dropped two whole activities looked no
   * noisier than a clean one. They are real problems and now say so. */

  "unresolved-segment": {
    info: false,
    text: (w) => {
      const hint = SUBHEADING_HINT[w.activity];
      return `"${activityLabel(w.activity)}": lines arrived with no sub-heading to file them under, so none of them matched.`
        + (hint ? ` The paste needs ${hint} above its DC lines.` : "");
    },
  },
  "missing-activity-header": {
    info: false,
    text: () => "Lines arrived before any activity heading, so none of them matched. Paste the ALL-CAPS activity name (SPIRITUALISM, SKULDUGGERY, MARTIAL TRAINING, MAGICAL RESEARCH) above its own lines.",
  },
  "keyword-miss": {
    info: false,
    text: (w) => `A DC ${w.dc} line under "${w.segmentId}" matched no entry there — its wording differs from the one this book prints. Left unmatched rather than guessed at.`,
  },
  "dc-not-in-segment": {
    info: false,
    text: (w) => `"${w.segmentId}" has no DC ${w.dc} entry, so that line was left unmatched. Check it sits under the heading it belongs to.`,
  },
};

/** Turn a warning object from the parser into {text, info} for a preview. */
export function warningText(w) {
  const def = WARNING_TEXT[w?.code];
  if (!def) return { text: `Parser note: ${w?.code ?? "unknown"}`, info: true };
  try {
    return { text: def.text(w), info: def.info };
  } catch {
    return { text: `Parser note: ${w.code}`, info: def.info };
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
    .filter(({ text }) => (seen.has(text) ? false : (seen.add(text), true)))
    .sort((a, b) => Number(a.info) - Number(b.info));
}
