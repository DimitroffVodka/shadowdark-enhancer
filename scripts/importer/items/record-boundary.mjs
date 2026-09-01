/**
 * record-boundary.mjs — where one pasted description record ends and the next
 * begins. Pure (Foundry-free, node-testable).
 *
 * THE RULE THIS OWNS (C1 / #69). Both description consumers used to end a
 * record at the next header they had CLAIMED — item-parser's
 * splitDescriptionsByNames at the next anchored name, gear-join's bodyFor at
 * the next matched header. Any real record start neither of them claimed
 * therefore failed to close the record above it, and that record swallowed it.
 * Four ways a real start goes unclaimed, all seen on one book's gear pages:
 *
 *   • the importer refuses the row — Coin and Gem are currency, never items,
 *     so they never become anchors (see item-parser.isCurrencyName);
 *   • the book header is spelled differently from the table row — the row
 *     reads "Oil, flask" and the header reads "Oil flask.";
 *   • two rows reduce to one variant — "Rope, 60'" and "Rope, morzo silk"
 *     both yield "Rope", which the builder drops as ambiguous;
 *   • the start is not a record at all but page furniture between two records.
 *
 * So a record ends at the next record START, claimed or not. The whole problem
 * is telling a record start from an ordinary sentence, because a description's
 * own sentences also begin with a capital and end in a period.
 *
 * WHAT A RECORD START LOOKS LIKE. Three signals, in decreasing authority:
 *
 *   1. A KNOWN name followed by a period. Definitive — the caller has told us
 *      this is an item. Matched at the start of the text, after a period, or
 *      after a newline, so two records sharing one line still split. No shape
 *      test applies: a known name may be any length.
 *   2. A LINE-INITIAL name-shaped lead-in followed by a period. This is the
 *      new signal, and the one that closes the bug. It is deliberately
 *      line-initial only: mid-line, "One use." and "Don't lose it." are
 *      indistinguishable from names, and cutting there would shred bodies.
 *   3. Nothing else. A sentence that merely begins a line stays in its body.
 *
 * WHY THE SHAPE TEST IS ≤ 3 WORDS. Measured, not guessed. Across a full gear
 * chapter's description pages every one of the 34 real headers is line-initial
 * and at most three words ("Flask or bottle.", "Rope, morzo silk."), and the
 * ONLY line-initial false positive is a seven-word sentence ("Has a shutter to
 * hide the light."). A cap of three admits every real header and excludes it.
 * The sentence-opener guard then removes the short-but-verbal cases ("One
 * use.", "Do not lose it.") for corpora whose line breaks fall differently.
 * The cost of the two mistakes is not symmetric — a missed boundary absorbs
 * the next record, a false boundary DROPS a valid trailing sentence — so the
 * cap stays tight and signal 1 carries anything longer.
 *
 * PAGE FURNITURE is excised, never treated as a boundary. A footer page number
 * sitting between two records must not land in the record above it; a footer
 * interrupting one record's body must not split that body in two. Removing the
 * line does both, and a boundary would only do the first.
 */

/** Longest lead-in we will even consider as a header (chars before the period). */
export const MAX_HEADER_LEAD = 44;
/** Most words a name-shaped (unknown) header may have — see the header note. */
export const MAX_HEADER_WORDS = 3;

/** A line-initial capitalised lead-in terminated by an early period. */
const HEADER_RE = new RegExp(`^([A-Z][^.]{0,${MAX_HEADER_LEAD}})\\.(?:\\s|$)`);

/**
 * A page-footer / running-header line: a bare number, optionally fenced by
 * punctuation ("108", "— 42 —"). Anything with a letter in it is content.
 */
export const PAGE_FURNITURE_RE = /^[^A-Za-z0-9]*\d{1,4}[^A-Za-z0-9]*$/;

/**
 * Words that open a sentence but never open an item name. Checked against the
 * lead-in's FIRST word only — "Flask or bottle" and "Flint and steel" are real
 * headers, so a blanket function-word ban would reject them.
 */
const SENTENCE_LEAD_RE = new RegExp(
  `^(?:a|an|the|it|its|this|that|these|those|you|your|he|she|they|them|we|us|i`
  + `|if|when|once|after|before|while|during|unless|until|though|although`
  + `|on|in|at|for|to|of|with|without|from|by|as|and|or|but|so|then|also`
  + `|has|have|had|is|are|was|were|be|being|been|can|could|may|might|must`
  + `|will|would|shall|should|do|does|did|don'?t|cannot`
  + `|each|any|all|every|some|no|not|both|either|neither|one|two|three`
  + `|there|here|otherwise|instead|roll|make|add|gain|lose|take|deal|deals`
  + `|use|uses|used|treat|choose|reduce|increase|apply|see)(?=['’\\s,;:]|$)`,
  "i",
);

/** Normalized key for comparing a lead-in against a known name. */
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** True for a page-footer / running-header line. */
export function isPageFurnitureLine(line) {
  const s = String(line ?? "").trim();
  return s !== "" && PAGE_FURNITURE_RE.test(s);
}

/**
 * Drop page furniture from a slice of description text, so a footer neither
 * lands in the record above it nor splits a record that continues past it.
 * @param {string} text
 * @returns {string}
 */
export function stripPageFurniture(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !isPageFurnitureLine(l))
    .join("\n");
}

/**
 * Is a lead-in shaped like an item NAME rather than a sentence? Exported so a
 * caller that has already extracted a header phrase (gear-join's orphan review
 * list) applies exactly the shape test the boundary rule applied.
 * @param {string} phrase
 * @returns {boolean}
 */
export function isNameShapedPhrase(phrase) {
  if (String(phrase ?? "").length > MAX_HEADER_LEAD) return false;
  if (SENTENCE_LEAD_RE.test(phrase)) return false;
  const words = phrase.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= MAX_HEADER_WORDS;
}

/**
 * Does this LINE begin a new record? Returns the header phrase, or null.
 *
 * A lead-in matching one of `knownNames` is a record start whatever its shape
 * (signal 1); otherwise it must be name-shaped (signal 2).
 *
 * @param {string} line
 * @param {{ knownNames?: string[] }} [opts]
 * @returns {string|null}
 */
export function isRecordStartLine(line, { knownNames = [] } = {}) {
  const m = HEADER_RE.exec(String(line ?? "").trim());
  if (!m) return null;
  const phrase = m[1].trim();
  if (!phrase) return null;
  if (knownNames.length) {
    const known = new Set(knownNames.map(norm).filter(Boolean));
    if (known.has(norm(phrase))) return phrase;
  }
  return isNameShapedPhrase(phrase) ? phrase : null;
}

/**
 * Every position in `text` where a new record begins, in reading order.
 *
 * @param {string} text
 * @param {{ knownNames?: string[] }} [opts]
 * @returns {{ start: number, bodyStart: number, name: string, kind: "known"|"unknown" }[]}
 *   `start` is the first character of the header, `bodyStart` the first
 *   character after it. `name` is the exact known-list spelling for a `known`
 *   start (so a caller can match it straight back to its item) and the text's
 *   own lead-in for an `unknown` one.
 */
export function findRecordStarts(text, { knownNames = [] } = {}) {
  const clean = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!clean.trim()) return [];

  const found = [];

  // ── Signal 1: known names, anywhere a record may begin ──────────────────────
  // Longest first, so a multi-word name anchors before its shorter prefix.
  const uniq = [...new Set(knownNames.map((n) => String(n ?? "").trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  for (const name of uniq) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[.\\n]\\s*)(${esc})\\.`, "gi");
    let m;
    while ((m = re.exec(clean)) !== null) {
      const start = m.index + m[1].length;
      re.lastIndex = start + 1;   // allow overlapping scans
      // The match is case-INSENSITIVE so the caller's spelling need not match
      // the book's ("Iron Spikes" vs "Iron spikes."), but a header is always
      // capitalised in the source. Lowercase prose that happens to name an item
      // is a sentence, not a record start: "Caltrops. Tiny, triangle-shaped
      // iron spikes. Living creatures…" wraps onto a line beginning "iron
      // spikes." and would otherwise cut Caltrops' body in two.
      if (!/^[A-Z]/.test(m[2])) continue;
      found.push({ start, bodyStart: m.index + m[0].length, name, kind: "known" });
    }
  }

  // ── Signal 2: line-initial name-shaped lead-ins the caller never claimed ────
  let offset = 0;
  for (const line of clean.split("\n")) {
    const lead = line.length - line.replace(/^\s+/, "").length;
    const phrase = isRecordStartLine(line);
    if (phrase) {
      const start = offset + lead;
      found.push({ start, bodyStart: start + phrase.length + 1, name: phrase, kind: "unknown" });
    }
    offset += line.length + 1;   // + the newline
  }

  // Earliest first; at a tie a known start wins, then the longer name. Then
  // drop any start that falls inside a header already claimed — a shorter name
  // nested in a longer one, or the unknown twin of a known start.
  found.sort((a, b) =>
    a.start - b.start
    || (a.kind === b.kind ? 0 : a.kind === "known" ? -1 : 1)
    || b.name.length - a.name.length);

  const picked = [];
  let claimedTo = -1;
  for (const s of found) {
    if (s.start < claimedTo) continue;
    picked.push(s);
    claimedTo = s.bodyStart;
  }
  return picked;
}
