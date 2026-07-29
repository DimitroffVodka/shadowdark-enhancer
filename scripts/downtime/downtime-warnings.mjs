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

/** Slot key → its printed label, for warning prose. */
export function slotLabel(key) {
  try {
    return slotByKey(key)?.slot?.label ?? key;
  } catch {
    return key;
  }
}

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
  return (parseResult?.warnings ?? [])
    .map(warningText)
    .sort((a, b) => Number(a.info) - Number(b.info));
}
