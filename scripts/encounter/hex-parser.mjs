/**
 * Shadowdark Enhancer — Hexcrawl parser (pure, Foundry-free, node-testable).
 *
 * Recognises hex-key dumps from a raw PDF paste and builds per-hex draft
 * pages for the universal paste-box importer (D9, REQ-35; Phase 16 A-01..A-03).
 *
 * Anchor (A-01 — clustered, never guess):
 *   A block whose FIRST line starts with a 3–4 digit hex ID ("0203", "1403",
 *   "122") is anchor-shaped — but a single anchored block NEVER claims.
 *   Claiming requires a RUN of ≥3 anchored units (MIN_RUN_UNITS); inside a
 *   claimed run, non-anchored blocks (ALL-CAPS headings, statblock-ish text,
 *   dice lines) attach to the preceding hex as continuations. Trailing
 *   continuations after the run's last anchor are capped at K = the largest
 *   continuation gap observed BETWEEN anchored units in the run (corpus-
 *   adaptive; K = 0 when every block is anchored) — anything past the cap
 *   stays in the remainder for later recognizers / the Skipped list.
 *
 * Hex-ID rule (seed, verified on the CS1–CS6 manual build):
 *   row = last TWO digits, col = leading digit(s). "1403" → col 14 row 03;
 *   "122" → col 1 row 22.
 *
 * Cross-references (A-02/A-03): in-set IDs become `@@HEX[key]{label}@@`
 * placeholders at parse time; the journal importer rewrites them to real
 * `@UUID[page.uuid]` links AFTER pages exist (two-pass — pack page uuids
 * cannot be hand-assembled before creation).
 *
 * Registered FIRST in the segmenter registry: hex bodies legally contain
 * text every later recognizer would otherwise steal. Order is SENSITIVE.
 *
 * Ships ZERO book content — invented fixture text only (D1).
 */

import { titleCaseName } from "./statblock-parser.mjs";

// ─── Constants ───────────────────────────────────────────────────────────────

/** First-line hex anchor: 3–4 digit ID + optional same-line title. */
const HEX_ANCHOR_RE = /^\s*(\d{3,4})\b[.:]?\s*(.*)$/;

/** A-01 cluster threshold — runs with fewer anchored units claim NOTHING. */
export const MIN_RUN_UNITS = 3;

/** Pass-1 placeholder written into page HTML; pass-2 rewrites to @UUID. */
const HEX_PLACEHOLDER_RE = /@@HEX\[([0-9]+,[0-9]+)\]\{([^}]*)\}@@/g;

/** Reference spans (A-03): "(1403)", "(207, 1404)", "hex 1403", "hexes 207 and 1404". */
const REF_SPAN_RES = [
  /\b(?:hex(?:es)?)\s+(\d{3,4}(?:\s*(?:,|and|&)\s*\d{3,4})*)/gi,
  /\((\d{3,4}(?:\s*(?:,|and|&)\s*\d{3,4})*)\)/g,
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize a hex ID to its "col,row" key.
 * "1403" → "14,3"; "122"/"0122" → "1,22". Non-3/4-digit → null.
 * @param {string} id
 * @returns {string|null}
 */
export function hexIdKey(id) {
  const s = String(id ?? "").trim();
  if (!/^\d{3,4}$/.test(s)) return null;
  const row = Number(s.slice(-2));
  const col = Number(s.slice(0, -2));
  return `${col},${row}`;
}

/**
 * Test a raw block's FIRST line against the hex anchor.
 * NOTE: a lone numeric line matches HERE — the cluster threshold in claim()
 * is what prevents lone-line claims (A-01), not this predicate.
 * @param {string} block
 * @returns {{id: string, sameLineTitle: string}|null}
 */
export function matchHexAnchor(block) {
  const first = String(block ?? "").split("\n")[0] ?? "";
  const m = HEX_ANCHOR_RE.exec(first);
  if (!m) return null;
  if (hexIdKey(m[1]) === null) return null;
  return { id: m[1], sameLineTitle: (m[2] ?? "").trim() };
}

/**
 * Cluster blank-line blocks into hex RUNS per A-01.
 * @param {string[]} blocks
 * @returns {{runs: Array<{units: string[][]}>, claimedIdxSet: Set<number>}}
 *   Each unit is the array of block strings belonging to one hex.
 */
export function clusterHexRuns(blocks) {
  const runs = [];
  const claimedIdxSet = new Set();
  let i = 0;
  while (i < blocks.length) {
    if (!matchHexAnchor(blocks[i])) { i++; continue; }
    // Candidate run starting at i: walk forward collecting units + gaps.
    const units = [];       // each: { idxs: number[] }
    const gaps = [];        // continuation count between consecutive anchors
    let pending = [];       // non-anchored blocks after the last anchor
    let j = i;
    while (j < blocks.length) {
      if (matchHexAnchor(blocks[j])) {
        if (units.length) {
          units[units.length - 1].idxs.push(...pending.splice(0));
          gaps.push(units[units.length - 1].idxs.length - 1);
        }
        units.push({ idxs: [j] });
        j++;
      } else {
        pending.push(j);
        j++;
      }
    }
    // Trailing cap: K = max interior gap (0 when every block was anchored).
    const K = gaps.length ? Math.max(...gaps) : 0;
    const tail = pending.splice(0, Math.min(pending.length, K));
    if (units.length) units[units.length - 1].idxs.push(...tail);

    if (units.length >= MIN_RUN_UNITS) {
      const run = { units: units.map((u) => u.idxs.map((k) => blocks[k])) };
      runs.push(run);
      for (const u of units) for (const k of u.idxs) claimedIdxSet.add(k);
    }
    // Whether claimed or not, we've consumed the scan up to j minus the
    // un-attached pending tail — resume after the last block we examined.
    i = j;
  }
  return { runs, claimedIdxSet };
}

/**
 * Parse one hex unit (its blocks joined "\n\n") into a draft.
 * @param {string} unitText
 * @returns {{hexId: string, key: string, name: string, body: string,
 *            bodyLines: string[], warnings: string[]}}
 */
export function parseHexUnit(unitText) {
  const warnings = [];
  const lines = String(unitText ?? "").replace(/\r\n?/g, "\n").split("\n");
  const anchor = matchHexAnchor(unitText) ?? { id: "0", sameLineTitle: "" };
  let name = "";
  let bodyStart = 1;
  if (anchor.sameLineTitle) {
    name = titleCaseName(anchor.sameLineTitle);
  } else {
    const next = (lines[1] ?? "").trim();
    if (next && next.length <= 60 && !/[.!?]$/.test(next)) {
      name = titleCaseName(next);
      bodyStart = 2;
    }
  }
  const bodyLines = lines.slice(bodyStart).map((l) => l.trim()).filter(Boolean);
  return {
    hexId: anchor.id,
    key: hexIdKey(anchor.id),
    name,
    body: bodyLines.join("\n"),
    bodyLines,
    warnings,
  };
}

/**
 * Crawl-name prefill (A-05): nearest short, non-anchored, non-empty line
 * ABOVE the first claimed run. Pure read — that text stays in the remainder.
 * @param {string} rawText
 * @returns {string}
 */
export function detectCrawlTitle(rawText) {
  const blocks = splitRawBlocks(rawText);
  const { claimedIdxSet } = clusterHexRuns(blocks);
  if (!claimedIdxSet.size) return "";
  const first = Math.min(...claimedIdxSet);
  for (let i = first - 1; i >= 0; i--) {
    const line = (blocks[i].split("\n")[0] ?? "").trim();
    if (line && line.length <= 60 && !matchHexAnchor(blocks[i])) {
      return titleCaseName(line);
    }
  }
  return "";
}

/**
 * Find in-set hex references (A-03 forms). An ID only counts when its key is
 * in `hexKeySet` — unknown IDs never link (D9, never guess).
 * @param {string} text
 * @param {Set<string>} hexKeySet - keys from hexIdKey()
 * @returns {Array<{index: number, length: number, id: string, key: string}>}
 */
export function scanHexReferences(text, hexKeySet) {
  const s = String(text ?? "");
  const out = [];
  for (const re of REF_SPAN_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const spanStart = m.index + m[0].indexOf(m[1]);
      const idRe = /\d{3,4}/g;
      let idm;
      while ((idm = idRe.exec(m[1])) !== null) {
        const key = hexIdKey(idm[0]);
        if (key && hexKeySet?.has(key)) {
          out.push({ index: spanStart + idm.index, length: idm[0].length, id: idm[0], key });
        }
      }
    }
  }
  // de-dup overlapping hits (same index found by both span regexes)
  const seen = new Set();
  return out.filter((h) => !seen.has(h.index) && seen.add(h.index))
    .sort((a, b) => a.index - b.index);
}

/**
 * Replace each in-set ID token with its pass-1 placeholder; surrounding
 * prose ("hex ", parens, "and") is untouched.
 * @param {string} text
 * @param {Set<string>} hexKeySet
 * @returns {string}
 */
export function linkifyHexText(text, hexKeySet) {
  const hits = scanHexReferences(text, hexKeySet);
  let s = String(text ?? "");
  for (const h of [...hits].reverse()) {
    s = `${s.slice(0, h.index)}@@HEX[${h.key}]{${h.id}}@@${s.slice(h.index + h.length)}`;
  }
  return s;
}

/**
 * Draft body → page HTML: linkify, then `<p>`-wrap each body line (D4).
 * @param {{bodyLines: string[]}} draft
 * @param {Set<string>} hexKeySet
 * @returns {string}
 */
export function buildHexPageHtml(draft, hexKeySet) {
  const lines = draft?.bodyLines ?? [];
  if (!lines.length) return "<p></p>";
  return lines.map((l) => `<p>${linkifyHexText(l, hexKeySet)}</p>`).join("\n");
}

/**
 * Pass-2 (A-02): placeholders → `@UUID[<page.uuid>]{label}`. Unknown key
 * degrades to the bare label — never a broken link.
 * @param {string} content
 * @param {Map<string, string>} uuidByKey
 * @returns {string}
 */
export function rewriteHexPlaceholders(content, uuidByKey) {
  return String(content ?? "").replace(HEX_PLACEHOLDER_RE, (full, key, label) => {
    const uuid = uuidByKey?.get?.(key);
    return uuid ? `@UUID[${uuid}]{${label}}` : label;
  });
}

// ─── Block splitting (duplicated from item-parser pattern — circular import) ──

/** Split raw text into blank-line-separated blocks. */
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

// ─── Recognizer ───────────────────────────────────────────────────────────────

/**
 * Hexcrawl recognizer — MUST be registered FIRST (A-01): hex bodies legally
 * contain ALL-CAPS headings, statblock lines, and dice text that the monster/
 * item/table recognizers would otherwise claim. The ≥3-unit cluster threshold
 * is what makes first-position safe — statblock or table dumps never produce
 * three consecutive blocks whose first line is a bare 3–4 digit hex ID.
 */
export const hexcrawlRecognizer = {
  id: "hexcrawl",

  /** @param {string} rawText */
  claim(rawText) {
    const blocks = splitRawBlocks(rawText);
    const { runs, claimedIdxSet } = clusterHexRuns(blocks);
    const claimed = [];
    for (const run of runs) for (const unitBlocks of run.units) claimed.push(unitBlocks.join("\n\n"));
    const remainder = blocks.filter((_, i) => !claimedIdxSet.has(i)).join("\n\n");
    return { claimed, remainder };
  },

  /** @param {string[]} claimedUnits */
  parse(claimedUnits) {
    const drafts = claimedUnits.map((u) => parseHexUnit(u));
    const seen = new Map();
    for (const d of drafts) {
      if (seen.has(d.key)) {
        d.warnings.push(`duplicate hex key ${d.key} (also "${seen.get(d.key)}") — pages would collide; edit one ID`);
      } else {
        seen.set(d.key, d.hexId);
      }
    }
    return drafts;
  },
};

// ─── Internal exports for tests ───────────────────────────────────────────────

export const _internals = { clusterHexRuns, matchHexAnchor, splitRawBlocks, MIN_RUN_UNITS };
