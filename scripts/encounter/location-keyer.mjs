/**
 * Shadowdark Enhancer - numbered location parsing and placement helpers.
 *
 * This module is Foundry-free. Location parsing is opt-in because ordinary
 * tables also begin with numbers; callers must expose the drafts for review.
 */

const LOCATION_HEADING_RE = /^(\d{1,3})[.)]\s+(.+?)\s*$/;
const LOCATION_PLACEHOLDER_RE = /@@KEY\[([^\]]+)\]\{([^}]*)\}@@/g;
const LOCATION_REF_RE =
  /\b(Areas?|Rooms?|Locations?)\s+(\d{1,3}(?:\s*(?:,|and|&)\s*\d{1,3})*)\b/gi;

function normalizeLines(rawText) {
  return String(rawText ?? "").replace(/\r\n?/g, "\n").split("\n");
}

function headingCandidate(line, lineIndex) {
  const match = LOCATION_HEADING_RE.exec(line.trim());
  if (!match) return null;
  const name = match[2].trim();
  if (!name || name.length > 120 || /\b\d{1,3}[.)]\s+/.test(name)) return null;
  return {
    lineIndex,
    locationId: String(Number(match[1])),
    number: Number(match[1]),
    name,
  };
}

function longestAscendingCandidates(candidates) {
  if (!candidates.length) return [];
  const lengths = new Array(candidates.length).fill(1);
  const previous = new Array(candidates.length).fill(-1);

  for (let i = 0; i < candidates.length; i++) {
    for (let j = 0; j < i; j++) {
      if (candidates[j].number >= candidates[i].number) continue;
      const nextLength = lengths[j] + 1;
      if (nextLength > lengths[i]) {
        lengths[i] = nextLength;
        previous[i] = j;
      }
    }
  }

  let end = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (lengths[i] > lengths[end]) end = i;
  }
  const run = [];
  for (let i = end; i >= 0; i = previous[i]) {
    run.push(candidates[i]);
    if (previous[i] < 0) break;
  }
  return run.reverse();
}

function consecutiveListLines(candidates) {
  const excluded = new Set();
  let run = [];
  const flush = () => {
    if (run.length >= 3) {
      for (const candidate of run) excluded.add(candidate.lineIndex);
    }
    run = [];
  };

  for (const candidate of candidates) {
    const previous = run.at(-1);
    if (!previous ||
        (candidate.lineIndex === previous.lineIndex + 1 &&
         candidate.number > previous.number)) {
      run.push(candidate);
    } else {
      flush();
      run.push(candidate);
    }
  }
  flush();
  return excluded;
}

function skippedPreface(lines) {
  return lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((block) => block.length)
    .map((block) => ({
      name: block[0],
      reason: `Unclaimed before the first numbered location: ${block.slice(1).join(" / ") || block[0]}`,
    }));
}

/**
 * Parse locations plus blocks before the accepted run that the hub must show
 * as unclaimed content.
 */
export function parseNumberedLocationsDetailed(rawText) {
  const lines = normalizeLines(rawText);
  const candidates = lines
    .map((line, lineIndex) => headingCandidate(line, lineIndex))
    .filter(Boolean);
  const listLines = consecutiveListLines(candidates);
  const accepted = longestAscendingCandidates(
    candidates.filter((candidate) => !listLines.has(candidate.lineIndex)),
  );
  if (accepted.length < 3) return { drafts: [], skipped: [] };

  const drafts = accepted.map((candidate, index) => {
    const nextLine = accepted[index + 1]?.lineIndex ?? lines.length;
    const bodyLines = lines
      .slice(candidate.lineIndex + 1, nextLine)
      .map((line) => line.trimEnd());
    while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
    while (bodyLines.length && !bodyLines.at(-1).trim()) bodyLines.pop();
    return {
      locationId: candidate.locationId,
      key: `loc:${candidate.locationId}`,
      name: candidate.name,
      bodyLines,
      warnings: [],
    };
  });
  return {
    drafts,
    skipped: skippedPreface(lines.slice(0, accepted[0].lineIndex)),
  };
}

/**
 * Parse the strongest ascending sequence of punctuated numbered headings.
 * Fewer than three headings are rejected to avoid claiming ordinary lists.
 *
 * @param {string} rawText
 * @returns {Array<{locationId:string,key:string,name:string,bodyLines:string[],warnings:string[]}>}
 */
export function parseNumberedLocations(rawText) {
  return parseNumberedLocationsDetailed(rawText).drafts;
}

function singularReferenceLabel(word, id) {
  const lower = word.toLowerCase();
  if (lower.startsWith("area")) return `Area ${id}`;
  if (lower.startsWith("room")) return `Room ${id}`;
  return `Location ${id}`;
}

/**
 * Replace explicit in-set location references with pass-1 placeholders.
 * @param {string} text
 * @param {Set<string>} keySet
 * @returns {string}
 */
export function linkifyLocationText(text, keySet) {
  return String(text ?? "").replace(LOCATION_REF_RE, (full, word, numberList) => {
    let first = true;
    return numberList.replace(/\d{1,3}/g, (rawId) => {
      const id = String(Number(rawId));
      const key = `loc:${id}`;
      if (!keySet?.has(key)) {
        const label = first ? singularReferenceLabel(word, id) : rawId;
        first = false;
        return label;
      }
      const label = first ? singularReferenceLabel(word, id) : rawId;
      first = false;
      return `@@KEY[${key}]{${label}}@@`;
    });
  });
}

/**
 * Build location page HTML from the GM's imported text.
 * @param {{bodyLines:string[]}} draft
 * @param {Set<string>} keySet
 * @returns {string}
 */
export function buildLocationPageHtml(draft, keySet) {
  const lines = draft?.bodyLines ?? [];
  if (!lines.length) return "<p></p>";
  return lines.map((line) => `<p>${linkifyLocationText(line, keySet)}</p>`).join("\n");
}

/**
 * Rewrite keyed placeholders to page UUID links.
 * @param {string} content
 * @param {Map<string,string>} uuidByKey
 * @returns {string}
 */
export function rewriteLocationPlaceholders(content, uuidByKey) {
  return String(content ?? "").replace(LOCATION_PLACEHOLDER_RE, (full, key, label) => {
    const uuid = uuidByKey?.get?.(key);
    return uuid ? `@UUID[${uuid}]{${label}}` : label;
  });
}

/**
 * Build a Note payload at a GM-selected Scene point.
 * @param {object} page
 * @param {{x:number,y:number}} point
 * @returns {{entryId:string,pageId:string,x:number,y:number}}
 */
export function locationNoteData(page, point) {
  const entryId = page?.parent?.id;
  const pageId = page?.id;
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!entryId || !pageId || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("A deployed journal page and finite Scene point are required");
  }
  return { entryId, pageId, x, y };
}

function normalizeProgress(progress) {
  return {
    placed: [...new Set(progress?.placed ?? [])],
    skipped: [...new Set(progress?.skipped ?? [])],
  };
}

/**
 * Move one key into the placed or skipped progress bucket.
 * @param {object} progress
 * @param {string} key
 * @param {"placed"|"skipped"} status
 * @returns {{placed:string[],skipped:string[]}}
 */
export function updateLocationProgress(progress, key, status) {
  if (status !== "placed" && status !== "skipped") {
    throw new TypeError(`Invalid location progress status "${status}"`);
  }
  const next = normalizeProgress(progress);
  next.placed = next.placed.filter((entry) => entry !== key);
  next.skipped = next.skipped.filter((entry) => entry !== key);
  next[status].push(key);
  return next;
}

/**
 * Return the first key not already placed or skipped.
 * @param {string[]} keys
 * @param {object} progress
 * @returns {string|null}
 */
export function nextPending(keys, progress) {
  const state = normalizeProgress(progress);
  const handled = new Set([...state.placed, ...state.skipped]);
  return (keys ?? []).find((key) => !handled.has(key)) ?? null;
}

export const LocationKeyer = {
  parseNumberedLocations,
  parseNumberedLocationsDetailed,
  linkifyLocationText,
  buildLocationPageHtml,
  rewriteLocationPlaceholders,
  locationNoteData,
  updateLocationProgress,
  nextPending,
};
