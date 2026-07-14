/**
 * Shadowdark Enhancer — Class section parser (pure, node-testable)
 *
 * Parses a pasted class section (pdftotext reading order, same shape in the
 * core book and third-party supplements) into a structured unit the
 * class-unit importer turns into real documents:
 *
 *   NAME                        → parsed.name ("Barbarian Class" → "Barbarian")
 *   flavor paragraph(s)         → parsed.flavor
 *   Weapons: … / Armor: … /
 *   Hit Points: 1d8 per level   → wield lists + hit die (recognized ANYWHERE,
 *                                 not just a contiguous block — two-column PDF
 *                                 copies interleave them with features)
 *   Name. Rules text…           → parsed.features[] (Languages + Spellcasting
 *                                 are lifted into their own fields)
 *   TALENTS                     → parsed.talentTable { formula, rows }
 *
 * The talent table is recognized in BOTH layouts:
 *   row-major   "2  Gain Weapon Mastery…" (range and effect on one line)
 *   column copy  bare ranges (2 / 3-6 / 7-9 / 10-11 / 12) in one run, the
 *                "<CLASS> TALENTS" caption + "Effect" header + effect lines
 *                in another — zipped back together in order.
 *
 * This is the parse-and-author path: every word of book text in the output
 * comes from the user's paste — the module ships only this grammar.
 * See .planning/CLASS-AUTHORING-PLAYBOOK.md for the target document shapes.
 */

import { escapeHtml } from "./pdf-text-utils.mjs";

// ─── Line classifiers ────────────────────────────────────────────────────────

const HEADER_KEY  = /^(Weapons?|Armou?r|Hit\s*Points?)\s*[:.]\s*(.*)$/i;
const TALENTS_CAP = /^(?:[A-Z' -]+\s+)?TALENTS$/;          // "TALENTS" / "BARBARIAN TALENTS"
const TITLES_CAP  = /^(?:[A-Z' -]+\s+)?TITLES$/;
const DIE_HEADER  = /^(\d*d\d+)\b/i;                        // "2d6 Effect"
const DIE_ONLY    = /^(\d*d\d+)$/i;                         // a lone "2d6" line
const ROW_START   = /^(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?\s+(\S.*)$/;
const LONE_RANGE  = /^(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?$/; // a bare "3-6" line
const CAPS_CAP    = /^[A-Z' -]{4,}$/;                       // any all-caps caption
// Every class page closes with a flavor quote + attribution ("Have I told you
// …?" / -Reginald Merrymay, human duelist). Effects never open with a quote,
// never end sentence-then-quote, and never start with a dash-attribution.
const FLAVOR_LINE = /^["“”]|^[-–—]\s?[A-Z]|[!?.]["”]$/;
const FEATURE_RE  = /^([A-Z][A-Za-z'’ -]{0,39})\.\s+(\S.*)$/;
const BULLET      = /^[•\-]\s+/;

/**
 * Choice-at-creation feature names the char-builder ALREADY wires — mirror of
 * CHOICE_SPECS in scripts/char-builder/steps/class-step.mjs (keep in sync). A
 * feature whose name is here gets no "register in CHOICE_SPECS" warning: the
 * builder surfaces its weapon/armor pick and applies the effect. Delver's
 * "Trusty Gear" (level-scaling weapon bonus) is wired via the class overlay.
 */
const WIRED_CHOICE_FEATURES = new Set([
  "weapon mastery", "increased weapon damage die", "trusty gear", "armor mastery",
]);

/** "Weapon Mastery." / "Eye of Yag-Kesh." — Title-Case-ish, ≤5 words, no commas. */
const _SMALL_WORDS = new Set(["of", "the", "and", "a", "an", "to", "in", "on", "for", "with"]);
function _isFeatureName(s) {
  if (!s || s.length > 40 || s.includes(",")) return false;
  const words = s.split(/\s+/);
  if (words.length > 5) return false;
  if (!/^[A-Z]/.test(words[0])) return false;
  return words.every((w) => /^[A-Z]/.test(w) || _SMALL_WORDS.has(w.toLowerCase()));
}

/** All-caps book caption → display case ("GREEN KNIGHT" → "Green Knight"). */
function _displayCase(s) {
  if (/[a-z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’])([a-z])/g, (m, sep, c) => sep + c.toUpperCase())
    .replace(/\b(Of|The|And|A|An)\b/g, (w, _1, off) => (off === 0 ? w : w.toLowerCase()));
}

// ─── Language grant ("You know two additional common languages.") ───────────

const _WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };

function _parseLanguageGrant(text) {
  const lang = { common: 0, rare: 0, select: 0, selectOptions: [], fixed: [] };
  const flat = String(text).replace(/\s+/g, " ");
  // Trailing "language(s)" is optional: WR grants read "You know Sylvan." /
  // "You know Primordial." with no suffix. Safe because this parser only runs
  // on the body of a feature literally named "Languages".
  const known = flat.match(/know(?:s)?\s+(?:either\s+)?(?:the\s+)?([A-Z][\w'’-]+(?:(?:\s*(?:,|\band\b|\bor\b)\s*)+[A-Z][\w'’-]+)*)(?:\s+languages?)?/i);
  if (known) {
    // \b keeps "and"/"or" INSIDE a name intact ("Prim·or·dial" must not split).
    const names = known[1].split(/\s*(?:,|\band\b|\bor\b)\s*/).map((w) => w.trim()).filter((w) => /^[A-Z]/.test(w));
    // "either Celestial, Diabolic, or Primordial" → a pick, not fixed grants.
    if (/know(?:s)?\s+either\b/i.test(flat)) { lang.select = 1; lang.selectOptions = names; }
    else lang.fixed.push(...names);
  }
  // "two additional common languages" / "one rare language of your choice"
  const addRe = /(\w+)\s+(?:additional\s+)?(common|rare)\s+languages?/ig;
  let m;
  while ((m = addRe.exec(flat))) {
    const n = _WORD_NUM[m[1].toLowerCase()] ?? Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (m[2].toLowerCase() === "common") lang.common += n; else lang.rare += n;
  }
  return lang;
}

// ─── Talent-row choice detection ─────────────────────────────────────────────

const _STAT_CHOICE = /^\+(\d+)\s+(?:points?\s+)?to\s+([A-Za-z]+),\s*([A-Za-z]+),?\s+or\s+([A-Za-z]+)(?:\s+stats?)?\.?$/i;
/** An " or "-fragment that reads like a standalone effect, not prose. */
const _EFFECTISH = /^(?:[+-]\d|gain|learn|advantage|add|choose)/i;

/**
 * Classify one table row's text.
 * @returns {{kind: "single"|"choice"|"grand", options?: string[]}}
 */
function _classifyRow(text) {
  const t = text.trim().replace(/\s+/g, " ");
  // Row-12 style: "Choose a talent, or +2 points to distribute to stats"
  if (/^choose\s+(?:a|any)\s+talent\b/i.test(t)) return { kind: "grand" };
  // "+2 to Strength, Dexterity, or Constitution stat" → one option per stat
  const stat = t.match(_STAT_CHOICE);
  if (stat) {
    const bonus = stat[1];
    return { kind: "choice", options: [stat[2], stat[3], stat[4]].map((s) => `+${bonus} to ${_displayCase(s.toUpperCase())}`) };
  }
  // Distributed adjective: "+1 to melee or ranged attacks and damage"
  // → "+1 to melee attacks and damage" / "+1 to ranged attacks and damage"
  const dist = t.match(/^([+-]\d+\s+(?:to|on)\s+)([a-z]+)\s+or\s+([a-z]+)\s+(.+?)\.?$/i);
  if (dist) return { kind: "choice", options: [`${dist[1]}${dist[2]} ${dist[4]}`, `${dist[1]}${dist[3]} ${dist[4]}`] };
  // Explicit "Choose one: A or B" / bare "A or B" where both halves are effects
  const body = t.replace(/^choose\s+(?:one|1)\s*[:.]?\s*/i, "");
  if (body.includes(" or ")) {
    const parts = body.split(/\s+or\s+/).map((p) => p.trim().replace(/[.,]$/, ""));
    if (parts.length >= 2 && parts.length <= 3 && parts.every((p) => p.length >= 3 && p.length <= 70 && _EFFECTISH.test(p)))
      return { kind: "choice", options: parts };
  }
  return { kind: "single" };
}

/**
 * Classify a raw talent table (from _findTalentTable) in place: normalize each
 * row's text and set its kind/options via _classifyRow, pushing review
 * warnings. Returns { formula, rows } or null. Shared by the full-class parse
 * and the supplement parse.
 */
function _classifyTalentTable(tbl, warnings) {
  if (!tbl) return null;
  for (const r of tbl.rows) {
    r.text = r.text.replace(/\s+/g, " ").trim();
    Object.assign(r, _classifyRow(r.text));
    if (r.kind === "single" && / or /i.test(r.text))
      warnings.push(`Talent row ${r.lo}${r.hi !== r.lo ? `-${r.hi}` : ""} contains "or" but wasn't split into options — review before commit.`);
  }
  return { formula: tbl.formula, rows: tbl.rows };
}

/** "2d6" → {min:2, max:12}; "d6" → {min:1, max:6}; null when unparseable. */
function _dieBounds(formula) {
  const m = /^(\d*)d(\d+)$/i.exec(String(formula ?? "").trim());
  if (!m) return null;
  const n = Math.max(1, Number(m[1] || 1));
  return { min: n, max: n * Number(m[2]) };
}

/**
 * Post-parse band sanity for a talent table: drop rows outside the die's
 * bounds (page-footer numbers that captured an effect text) and flag
 * non-tiling bands — the signature of a shifted range↔effect pairing.
 * Mutates and returns `tbl` (null passes through).
 */
function _validateTalentBands(tbl) {
  const die = tbl ? _dieBounds(tbl.formula) : null;
  if (!die) return tbl;
  const kept = [];
  for (const r of tbl.rows) {
    if (r.lo < die.min || r.hi > die.max) {
      tbl.warnings.push(`BLOCKER: talent row ${r.lo}${r.hi !== r.lo ? `-${r.hi}` : ""} ("${String(r.text).slice(0, 48)}") is outside ${tbl.formula} — dropped; verify the table against the book.`);
      continue;
    }
    kept.push(r);
  }
  tbl.rows = kept;
  if (kept.length) {
    const sorted = [...kept].sort((a, b) => a.lo - b.lo);
    let tiles = sorted[0].lo === die.min && sorted[sorted.length - 1].hi === die.max;
    for (let i = 1; tiles && i < sorted.length; i++) tiles = sorted[i].lo === sorted[i - 1].hi + 1;
    if (!tiles)
      tbl.warnings.push(`BLOCKER: talent bands (${sorted.map((r) => (r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`)).join(", ")}) don't tile ${die.min}..${die.max} for ${tbl.formula} — the pairing may be shifted; verify against the book.`);
  }
  return tbl;
}

// ─── Talent-table extraction (both layouts) ──────────────────────────────────

/**
 * Locate and parse the talent table. Returns null or:
 *   { skip: Set<lineIdx>, formula, rows: [{lo,hi,text}], warnings: [] }
 * `skip` covers every line the table consumed (either layout) so the
 * feature walk never sees roll ranges or effect lines as rules text.
 */
function _findTalentTable(lines) {
  const capIdx = lines.findIndex((l) => TALENTS_CAP.test(l));

  // Effect texts from `start` until the next caption: wrapped (lowercase-
  // start) lines merge into the previous text; page numbers and "Effect"
  // header strays are dropped. Consumed lines land in `skip`.
  const collectTexts = (start, skip) => {
    const texts = [];
    for (let k = start; k < lines.length; k++) {
      const l = lines[k];
      // Drop page numbers, the bare "Effect" header, and — before any effect
      // has been collected — the parenthetical header variant every WR class
      // uses ("Effect (reroll 10-11 if …)"), which otherwise becomes texts[0]
      // and silently shifts every range↔effect pairing by one.
      if (/^\d{1,3}$/.test(l) || /^effects?$/i.test(l) || (!texts.length && /^effects?\b/i.test(l))) { skip.add(k); continue; }
      if (TITLES_CAP.test(l) || CAPS_CAP.test(l)) break;   // next caption
      if (FLAVOR_LINE.test(l)) break;                      // trailing flavor quote / attribution
      skip.add(k);
      if (texts.length && /^[a-z]/.test(l)) texts[texts.length - 1] += " " + l;   // wrapped line
      else texts.push(l);
    }
    return texts;
  };
  const zip = (run, texts, skip, formula) => {
    const die = _dieBounds(formula);
    const kept = [];
    const warnings = [];
    for (const l of run) {
      const rm = l.match(LONE_RANGE);
      const lo = Number(rm[1]), hi = Number(rm[2] ?? rm[1]);
      // A bare singleton outside the die's bounds is a swept-in page footer
      // (Delver's "38" on a 2d6) — drop it from the range run so the
      // positional pairing below can't shift.
      if (die && rm[2] == null && (lo < die.min || lo > die.max)) {
        warnings.push(`Talent table: dropped stray "${l.trim()}" from the roll-range column (outside ${formula} — likely a page number).`);
        continue;
      }
      kept.push({ lo, hi });
    }
    const n = Math.min(kept.length, texts.length);
    const rows = [];
    for (let k = 0; k < n; k++)
      rows.push({ lo: kept[k].lo, hi: kept[k].hi, text: texts[k].replace(/\s+/g, " ").trim() });
    const res = rows.length ? _validateTalentBands({ skip, formula, rows, warnings }) : null;
    if (res && kept.length !== texts.length) {
      // Extra TRAILING texts with perfectly tiling bands = post-table junk the
      // flavor-line filter missed (a quote whose opening mark was sheared off).
      // Anything else — too few texts, or bands that no longer tile — is a
      // genuine pairing hazard.
      const bandsClean = !res.warnings.some((w) => /don't tile|is outside/.test(w));
      if (texts.length > kept.length && bandsClean)
        res.warnings.push(`Talent table: discarded ${texts.length - kept.length} trailing line(s) after the last band (flavor text): ${texts.slice(n).map((t) => `"${t.slice(0, 40)}"`).join(" | ")}`);
      else
        res.warnings.push(`BLOCKER: talent table (column copy) has ${kept.length} roll ranges vs ${texts.length} effect lines — zipped the first ${n}, so the pairing may be SHIFTED; verify every band against the book before commit.`);
    }
    return res;
  };
  // A run of ≥3 bare range lines needs a dash somewhere so clustered page
  // numbers can't fake it.
  const runEnd = (i) => {
    let j = i;
    while (j < lines.length && LONE_RANGE.test(lines[j])) j++;
    return (j - i >= 3 && lines.slice(i, j).some((l) => /[-–—]/.test(l))) ? j : -1;
  };

  // ── Column copy, ranges-first: bare ranges BEFORE the caption, effect
  // texts after it ("2d6 / 2 / 3-6 … / BARBARIAN TALENTS / Effect / …"). ──
  for (let i = 0; i < lines.length && capIdx !== -1; i++) {
    if (!LONE_RANGE.test(lines[i])) continue;
    const j = runEnd(i);
    if (j !== -1 && capIdx >= j) {
      const skip = new Set([capIdx]);
      let formula = "2d6";
      if (i > 0 && DIE_ONLY.test(lines[i - 1])) { formula = lines[i - 1].toLowerCase(); skip.add(i - 1); }
      for (let k = i; k < j; k++) skip.add(k);
      return zip(lines.slice(i, j), collectTexts(capIdx + 1, skip), skip, formula);
    }
    i = j === -1 ? i : j;
  }

  if (capIdx === -1) {
    // No "TALENTS" caption — many cleaned pastes head the class talent table
    // with only its die line ("2d6 Effect"). Anchor on a DIE_HEADER line that
    // isn't itself a row, then read row-major rows after it. Guard like runEnd:
    // ≥3 rows with at least one dash-range, so a stray "2d6 damage" (or the
    // Hit Points die) can't fake a table.
    for (let h = 0; h < lines.length; h++) {
      if (!DIE_HEADER.test(lines[h]) || ROW_START.test(lines[h])) continue;
      const skip = new Set([h]);
      const formula = lines[h].match(DIE_HEADER)[1].toLowerCase();
      const rows = [];
      for (let k = h + 1; k < lines.length; k++) {
        if (TALENTS_CAP.test(lines[k]) || TITLES_CAP.test(lines[k]) || CAPS_CAP.test(lines[k])) break;
        if (/^effects?\b/i.test(lines[k]) || /^\d{1,3}$/.test(lines[k])) { skip.add(k); continue; }   // header / page-footer stray
        if (FLAVOR_LINE.test(lines[k])) break;             // trailing flavor quote / attribution
        const rm = lines[k].match(ROW_START);
        if (rm) { rows.push({ lo: Number(rm[1]), hi: Number(rm[2] ?? rm[1]), text: rm[3] }); skip.add(k); }
        else if (rows.length) { rows[rows.length - 1].text += " " + lines[k]; skip.add(k); }   // wrapped row
        else break;   // die header not followed by rows — not a talent table
      }
      if (rows.length >= 3 && rows.some((r) => r.hi !== r.lo))
        return _validateTalentBands({ skip, formula, rows, warnings: [] });
    }
    return null;
  }
  const skip = new Set([capIdx]);
  let j = capIdx + 1;
  let formula = "2d6";
  // Skip die-header / "Effect" strays directly after the caption.
  while (j < lines.length && (DIE_ONLY.test(lines[j]) || /^effects?\b/i.test(lines[j]))) {
    const dh = lines[j].match(DIE_ONLY);
    if (dh) formula = dh[1].toLowerCase();
    skip.add(j); j++;
  }
  if (j < lines.length) {
    const dh = lines[j].match(DIE_HEADER);
    if (dh && !ROW_START.test(lines[j])) { formula = dh[1].toLowerCase(); skip.add(j); j++; }
  }

  // ── Column copy, caption-first: caption, then bare ranges, then texts
  // ("TALENTS / 2 / 3-6 … / 12 / Your Eldritch Shield increases … / …"). ──
  if (LONE_RANGE.test(lines[j] ?? "")) {
    const k = runEnd(j);
    if (k !== -1) {
      for (let x = j; x < k; x++) skip.add(x);
      return zip(lines.slice(j, k), collectTexts(k, skip), skip, formula);
    }
  }

  // ── Row-major layout: ranged rows ("2  Gain Weapon Mastery …") ──
  const rows = [];
  for (; j < lines.length; j++) {
    if (TITLES_CAP.test(lines[j]) || CAPS_CAP.test(lines[j])) break;
    if (/^effects?\b/i.test(lines[j]) || /^\d{1,3}$/.test(lines[j])) { skip.add(j); continue; }   // header / page-footer stray
    if (FLAVOR_LINE.test(lines[j])) break;                 // trailing flavor quote / attribution
    const rm = lines[j].match(ROW_START);
    if (rm) { rows.push({ lo: Number(rm[1]), hi: Number(rm[2] ?? rm[1]), text: rm[3] }); skip.add(j); }
    else if (rows.length) { rows[rows.length - 1].text += " " + lines[j]; skip.add(j); }   // wrapped row
  }
  return rows.length ? _validateTalentBands({ skip, formula, rows, warnings: [] }) : null;
}

// ─── Titles extraction ───────────────────────────────────────────────────────

/**
 * Parse a TITLES section into SD title bands. Book layout:
 *   TITLES
 *   Levels  Lawful   Chaotic  Neutral
 *   1-2     Squire   Knave    Wanderer
 *   …
 * Column order follows the header line when present (default L/C/N). Cells
 * split on 2+ spaces when the copy kept the layout; single spaces otherwise
 * (3 words → 3 names; anything else lands in one cell with a warning).
 * Returns null or { skip: Set<lineIdx>, bands, warnings }.
 */
function _findTitles(lines) {
  const capIdx = lines.findIndex((l) => TITLES_CAP.test(l));
  // The column header ("Levels Lawful Chaotic Neutral") is the real anchor — it
  // lets a copied titles table parse even with no "TITLES" caption above it.
  const isHeader = (l) => /levels?/i.test(l) && /lawful/i.test(l) && /chaotic/i.test(l) && /neutral/i.test(l);
  const headIdx = lines.findIndex(isHeader);
  if (capIdx === -1 && headIdx === -1) return null;
  const skip = new Set();
  if (capIdx !== -1) skip.add(capIdx);
  const warnings = [];
  let order = ["lawful", "chaotic", "neutral"];
  let colOffsets = null;   // char offsets of the 3 column names in the header line
  // A wide cell can abut its neighbour with a SINGLE space ("Knight of the
  // Cross Blackguard") — the 2+-space split then fails. The header's column
  // positions give an exact slice; a boundary landing mid-word nudges to the
  // nearest gap (≤3 chars) or bails to the fallbacks.
  const sliceAtOffsets = (line) => {
    if (!colOffsets) return null;
    const bounds = [];
    for (const o of colOffsets) {
      let b = Math.min(o, line.length);
      if (b > 0 && b < line.length && line[b] !== " " && line[b - 1] !== " ") {
        let found = -1;
        for (let d = 1; d <= 3 && found === -1; d++) {
          if (line[b - d] === " ") found = b - d + 1;
          else if (line[b + d] === " ") found = b + d + 1;
        }
        if (found === -1) return null;
        b = found;
      }
      bounds.push(b);
    }
    const cells = bounds.map((b, i) => line.slice(b, i + 1 < bounds.length ? bounds[i + 1] : undefined).trim());
    return cells.length === 3 && cells.every(Boolean) ? cells : null;
  };
  const bands = [];
  // Walk from just after the caption, or from the header line when caption-less.
  const start = capIdx !== -1 ? capIdx + 1 : headIdx;
  for (let k = start; k < lines.length; k++) {
    const l = lines[k];
    if (isHeader(l)) {
      const hits = [...l.matchAll(/lawful|chaotic|neutral/gi)];
      if (hits.length === 3) { order = hits.map((m) => m[0].toLowerCase()); colOffsets = hits.map((m) => m.index); }
      skip.add(k);
      continue;
    }
    const m = l.match(/^(\d{1,2})\s*(?:[-–—]\s*(\d{1,2})|\+)?\s+(\S.*)$/);
    if (!m) { if (bands.length) break; skip.add(k); continue; }   // pre-table strays
    skip.add(k);
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : (l.includes("+") ? from : from);
    let cells = m[3].split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length !== 3) {
      const sliced = sliceAtOffsets(l);
      if (sliced) cells = sliced;
    }
    if (cells.length !== 3) {
      const words = m[3].split(/\s+/);
      if (words.length === 3) cells = words;
      else {
        cells = [m[3].trim(), "", ""];
        warnings.push(`Titles row ${m[1]}${m[2] ? `-${m[2]}` : ""}: couldn't split "${m[3]}" into Lawful/Chaotic/Neutral — edit in the preview.`);
      }
    }
    const band = { from, to, lawful: "", chaotic: "", neutral: "" };
    order.forEach((col, ci) => { band[col] = cells[ci] ?? ""; });
    bands.push(band);
  }
  return bands.length ? { skip, bands, warnings } : null;
}

// ─── Spells-known extraction ─────────────────────────────────────────────────

/**
 * Parse a "<CLASS> SPELLS KNOWN" level×tier table. Handles the row-major
 * book layout and the token-per-line column copy ("Level / 1 / 2 / 3 / 1 /
 * - / - / - / 2 / …"): everything in the zone is tokenized, tier headers are
 * the ascending run after "Level", then rows are fixed-width groups of
 * (level, count-per-tier), "-" → 0.
 * Returns null or { skip: Set<lineIdx>, known: [{level, tiers: number[]}] }.
 */
/**
 * Slice just the "…SPELLS KNOWN" grid block out of a page's text (caption +
 * "Spells Known By…" subtitle + "Level 1 2 3…" header + the numeric rows),
 * dropping surrounding prose. A caster class's grid lives on the page AFTER the
 * two-column writeup, where auto extraction shears the numbers off their levels;
 * grabbing that page single-column and slicing this block lets _findSpellsKnown
 * read it. Returns the block text, or null when the page has no grid.
 */
export function sliceSpellsKnown(text) {
  const lines = String(text).split("\n").map((l) => l.trim());
  // The caption is a standalone ALL-CAPS "… SPELLS KNOWN" line (or the "Spells
  // Known by…" subtitle) — NOT a prose sentence that merely ends in "Spells
  // Known" (e.g. the writeup's "…chainmail Necromancer Spells Known" reference).
  const isCap = (l) => /^[A-Z][A-Z' -]*SPELLS\s+KNOWN$/.test(l) || /^spells\s+known\s+by/i.test(l);
  const isTierHeader = (l) => /^levels?\b/i.test(l) && /\b1\b/.test(l) && /\b2\b/.test(l);
  const isGridRow = (l) => l && l.split(/\s+/).every((p) => /^(?:levels?|\d{1,2}|[-–—+])$/i.test(p));
  let start = lines.findIndex(isCap);
  if (start === -1) start = lines.findIndex(isTierHeader);
  if (start === -1) return null;
  const out = [];
  let sawGrid = false;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (isCap(l)) { out.push(l); continue; }
    if (isTierHeader(l) || isGridRow(l)) { out.push(l); sawGrid = true; continue; }
    if (sawGrid) break;                 // the grid ended
  }
  return sawGrid && out.length ? out.join("\n") : null;
}

function _findSpellsKnown(lines) {
  // Anchor on a "SPELLS KNOWN" caption, a "Spells Known by …" subtitle, OR the
  // "Level 1 2 3 …" tier header — so a copied grid parses without an all-caps
  // caption above it. A two-page grab can carry the grid TWICE (a sheared
  // auto-extract copy earlier, the clean single-column slice appended later),
  // so EVERY anchor is tried and the parse with the most level rows wins.
  const isCaption = (l) => /^[A-Z' -]*SPELLS\s+KNOWN$/.test(l) || /^spells\s+known\s+by/i.test(l);
  const isTierHeader = (l) => /^levels?\b/i.test(l) && /\b1\b/.test(l) && /\b2\b/.test(l);
  const parseFrom = (start) => {
    const skip = new Set();
    const tokens = [];
    for (let k = start; k < lines.length; k++) {
      const l = lines[k];
      if (isCaption(l) && !isTierHeader(l)) { skip.add(k); continue; }   // caption / subtitle
      const parts = l.split(/\s+/);
      if (!parts.every((p) => /^(?:levels?|\d{1,2}|[-–—+])$/i.test(p))) {
        if (tokens.length) break;   // the numeric grid ended
        continue;                    // stray line before the grid
      }
      skip.add(k);
      tokens.push(...parts);
    }
    const lvIdx = tokens.findIndex((t) => /^levels?$/i.test(t));
    if (lvIdx === -1) return null;
    // Tier headers: the ascending 1,2,3,… run right after "Level".
    let n = 0;
    while (Number(tokens[lvIdx + 1 + n]) === n + 1) n++;
    if (n < 1) return null;
    const known = [];
    for (let p = lvIdx + 1 + n; p + n < tokens.length; p += n + 1) {
      const level = Number(tokens[p]);
      if (!Number.isInteger(level) || level < 1 || level > 20) break;
      known.push({
        level,
        tiers: tokens.slice(p + 1, p + 1 + n).map((t) => (/^\d+$/.test(t) ? Number(t) : 0)),
      });
    }
    return known.length ? { skip, known } : null;
  };
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!isCaption(lines[i]) && !isTierHeader(lines[i])) continue;
    const res = parseFrom(i);
    if (res && (!best || res.known.length > best.known.length)) best = res;
  }
  return best;
}

// ─── Extra named tables (CORRUPTION, etc.) ───────────────────────────────────

/**
 * Lift NAMED dice tables that sit after the class body — the Wyrdling
 * CORRUPTION table, and any block shaped `<CAPS NAME>` / `dN Effect` / numbered
 * rows. Distinct from the class TALENTS table (found separately). Returns
 * `{ skip, tables: [{ name, formula, rows: [{lo,hi,text}] }] }` so the feature
 * walk never absorbs them (the Pseudopod-feature-ate-the-tables bug).
 *
 * @param {string[]} lines
 * @param {Set<number>} consumed  line indices already claimed (talent/titles/spells)
 */
function _findExtraTables(lines, consumed) {
  const skip = new Set();
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i) || skip.has(i)) continue;
    // An all-caps caption that isn't the class TALENTS/TITLES header…
    if (!CAPS_CAP.test(lines[i]) || TALENTS_CAP.test(lines[i]) || TITLES_CAP.test(lines[i])) continue;
    // …immediately followed by a die-header line ("d10 Effect", "2d6 Effect")
    // that is not itself a row.
    const j = i + 1;
    const dh = j < lines.length ? lines[j].match(DIE_HEADER) : null;
    if (!dh || ROW_START.test(lines[j])) continue;
    const formula = dh[1].toLowerCase().replace(/^d/, "1d");
    const rows = [];
    let k = j + 1;
    for (; k < lines.length; k++) {
      if (consumed.has(k)) break;
      if (CAPS_CAP.test(lines[k]) || TALENTS_CAP.test(lines[k]) || TITLES_CAP.test(lines[k])) break;
      const rm = lines[k].match(ROW_START);
      if (rm) rows.push({ lo: Number(rm[1]), hi: Number(rm[2] ?? rm[1]), text: rm[3] });
      else if (rows.length) rows[rows.length - 1].text += " " + lines[k];   // wrapped row
      else break;   // caption + die header but no rows — not a table
    }
    if (rows.length >= 3) {
      skip.add(i); skip.add(j);
      for (let x = j + 1; x < k; x++) skip.add(x);
      tables.push({
        name: _displayCase(lines[i]),
        formula,
        rows: rows.map((r) => ({ lo: r.lo, hi: r.hi, text: r.text.replace(/\s+/g, " ").trim() })),
      });
    }
  }
  return { skip, tables };
}

// ─── Main parse ──────────────────────────────────────────────────────────────

/**
 * @param {string} text  a pasted class section (one class)
 * @returns {object|null}  parsed class unit, or null when the paste has no
 *   class anchors (needs a Hit Points line to qualify)
 */
export function parseClassSection(text) {
  // Two-column PDF copies shear big captions ("ELDRITCH KNIGHT TALENTS") and
  // glue the fragments onto the neighbouring column ("KNIGHTSpellcasting.").
  // A line-leading run of 3+ capitals followed by TitleCase is such a
  // fragment — strip it so the real word ("Spellcasting.") survives.
  const DEGLUE = /^[A-Z]{3,}(?=[A-Z][a-z])/;
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n")
    .map((l) => l.trim().replace(DEGLUE, "").trim()).filter(Boolean);
  if (!lines.length) return null;
  if (!lines.some((l) => HEADER_KEY.test(l) && /hit/i.test(l))) return null;

  const warnings = [];
  const name = _displayCase(lines[0]).replace(/\s+Class$/i, "").trim();
  if (!name || name.length > 40) return null;

  // Table + titles first — their lines are excluded from the walk below so
  // column-copied range runs and title bands never pollute feature text.
  const tbl = _findTalentTable(lines);
  if (tbl) warnings.push(...tbl.warnings);
  const ttl = _findTitles(lines);
  if (ttl) warnings.push(...ttl.warnings);
  const sk = _findSpellsKnown(lines);
  // Named extra tables (CORRUPTION, …) — after the talent/titles/spells passes
  // so their lines aren't re-claimed. Their lines join the walk's skip set so
  // trailing tables never glue onto the last feature.
  const consumed = new Set([...(tbl?.skip ?? []), ...(ttl?.skip ?? []), ...(sk?.skip ?? [])]);
  const ex = _findExtraTables(lines, consumed);

  // ── Unified walk: headers, features, flavor — headers recognized anywhere
  // (two-column PDF copies interleave them with features). ──
  let weaponsText = "", armorText = "", hitDie = "";
  const flavorLines = [];
  const features = [];
  let cur = null;
  let trailing = false;   // past the features, in aux blocks (weapon stat table…)
  for (let i = 1; i < lines.length; i++) {
    if (tbl?.skip.has(i) || ttl?.skip.has(i) || sk?.skip.has(i) || ex.skip.has(i)) continue;
    const line = lines[i];
    if (/^\d{1,3}$/.test(line)) continue;                       // stray page number
    if (DIE_ONLY.test(line) || /^effects?$/i.test(line)) continue;   // sheared table-header strays
    if (TALENTS_CAP.test(line)) continue;                       // caption w/o parsed rows
    if (TITLES_CAP.test(line)) break;                           // unparsed titles follow
    const m = line.match(HEADER_KEY);
    if (m) {
      trailing = false;
      // Value may wrap — absorb following lowercase-start lines.
      let val = m[2];
      while (i + 1 < lines.length && !tbl?.skip.has(i + 1)
             && /^[a-z]/.test(lines[i + 1]) && !HEADER_KEY.test(lines[i + 1])) {
        val += " " + lines[++i];
      }
      const key = m[1].toLowerCase();
      if (key.startsWith("weapon")) weaponsText = val.trim();
      else if (key.startsWith("armo")) armorText = val.trim();
      else hitDie = val.match(/(?:1)?(d\d+)/i)?.[1]?.toLowerCase() ?? "";
      continue;
    }
    const fm = line.match(FEATURE_RE);
    if (fm && _isFeatureName(fm[1])) {
      trailing = false;
      if (cur) features.push(cur);
      cur = { name: fm[1].trim(), lines: [fm[2]] };
      continue;
    }
    // Any other all-caps caption (a weapon stat block like "PSEUDOPOD", an
    // unrecognized table…) ends the feature list — trailing aux blocks must
    // never glue onto the last feature. Recognized extra tables are already in
    // ex.skip; whatever remains here is dropped, not appended.
    if (CAPS_CAP.test(line)) { if (cur) { features.push(cur); cur = null; } trailing = true; continue; }
    if (cur) cur.lines.push(line);
    else if (!trailing) flavorLines.push(line);
  }
  if (cur) features.push(cur);
  if (!hitDie) warnings.push("No hit die found on the Hit Points line — defaulting to d6; check the sheet.");

  // Render each feature's lines to HTML, preserving bullet lists. Pasted
  // lines are escaped before entering the markup (review #1).
  const toHtml = (ls) => {
    const out = []; let list = null;
    const flush = () => { if (list) { out.push(`<ul>${list.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`); list = null; } };
    let para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${escapeHtml(para.join(" "))}</p>`); para = []; } };
    for (const l of ls) {
      if (BULLET.test(l)) { flushPara(); (list ??= []).push(l.replace(BULLET, "").trim()); }
      else { flush(); para.push(l); }
    }
    flushPara(); flush();
    return out.join("");
  };

  // Lift Languages + Spellcasting out of the feature list.
  let languages = { common: 0, rare: 0, select: 0, selectOptions: [], fixed: [] };
  let spellcasting = null;
  const keptFeatures = [];
  for (const f of features) {
    const body = f.lines.join(" ");
    if (/^languages?$/i.test(f.name)) { languages = _parseLanguageGrant(body); continue; }
    if (/^spell\s*casting$/i.test(f.name.replace(/\s+/g, " "))) {
      const ab = body.match(/\b(intelligence|wisdom|charisma|INT\b|WIS\b|CHA\b)/i)?.[1]?.slice(0, 3).toLowerCase() ?? "";
      // "You can cast WIZARD spells you know" → this class borrows an
      // existing spell list (Knight of St. Ydris pattern: spellcasting.class
      // points at the lender, the enabler talent adds the LENDER's slug).
      const _STOP = new Set(["your", "the", "these", "those", "any", "all", "known", "new"]);
      const listName = body.match(/\bcasts?\s+([a-z][a-z' -]{2,24}?)\s+spells\b/i)?.[1]?.trim().toLowerCase() ?? null;
      const spellList = (listName && !_STOP.has(listName) && listName !== name.toLowerCase()) ? listName : null;
      spellcasting = { ability: ab, text: toHtml(f.lines), spellList, spellClass: null };
      if (!ab) warnings.push("Spellcasting feature found but no casting ability detected — set it on the sheet.");
      warnings.push("Spellcaster: the class's spell list must be imported separately and tagged to this class.");
      if (!sk) warnings.push("No SPELLS KNOWN table in the paste — paste it with the class or fill the level×tier grid on the sheet.");
      continue;
    }
    if ((/choose one type of (?:gear or )?weapon.*(?:wield|attack)/i.test(body) || /choose one type of gear/i.test(body))
        && !WIRED_CHOICE_FEATURES.has(f.name.trim().toLowerCase()))
      warnings.push(`"${f.name}" is a choice-at-creation feature — register it in CHOICE_SPECS (class-step.mjs) and wire its effect.`);
    keptFeatures.push({ name: f.name, description: toHtml(f.lines) });
  }

  // ── Talent-table row classification ──
  const talentTable = _classifyTalentTable(tbl, warnings);
  if (!talentTable) warnings.push("No TALENTS table found in the paste — the class will have no talent table until one is added.");
  if (!ttl) warnings.push("No TITLES table in the paste (often a separate book section) — paste it into the class text, add bands in the preview, or import a TITLES block separately and attach it to this class.");

  // ── Wield lists ──
  // "All …" phrases set the booleans; whatever survives stripping them is a
  // NAMED EXTRA that coexists with the grant ("All melee weapons, crossbow"
  // → allMelee + ["crossbow"] — SD's weapons[] array works alongside the flags).
  const splitNames = (s) => s.split(/\s*(?:,|\band\b)\s*/i).map((w) => w.trim()).filter(Boolean);
  const allWeapons = /all\s+weapons/i.test(weaponsText);
  const allMelee   = /all\s+melee/i.test(weaponsText);
  const allRanged  = /all\s+ranged/i.test(weaponsText);
  const allArmor   = /all\s+armou?r/i.test(armorText);
  // "none" is a grant of nothing, not a gear name — strip it from BOTH lists
  // (it was only stripped from armor, so "Weapons: none" produced a literal
  // weapon lookup for "none" downstream; review #11).
  const weaponExtras = weaponsText.replace(/all\s+(?:melee\s+|ranged\s+)?weapons?/ig, "").replace(/\bnone\b/i, "");
  const armorExtras  = armorText.replace(/all\s+armou?r(?:\s+and\s+shields?)?/ig, "").replace(/\bnone\b/i, "");

  return {
    name,
    flavor: flavorLines.length ? `<p>${escapeHtml(flavorLines.join(" "))}</p>` : "",
    hitPoints: hitDie || "d6",
    weaponsText, armorText,
    allWeapons, allMeleeWeapons: allMelee, allRangedWeapons: allRanged, allArmor,
    weaponNames: splitNames(weaponExtras),
    armorNames:  splitNames(armorExtras),
    languages,
    spellcasting,
    features: keptFeatures,
    talentTable,
    titles: ttl?.bands ?? [],
    spellsKnown: sk?.known ?? [],
    extraTables: ex.tables,
    warnings,
  };
}

/**
 * Parse a class SUPPLEMENT — a fragment pasted after the class body (a TITLES
 * block, a bare talent table, or a SPELLS KNOWN grid) — WITHOUT the Hit-Points
 * anchor parseClassSection requires. The caller picks the target class to merge
 * onto (the fragment carries no class name).
 *
 * @param {string} text
 * @returns {{titles: object[], talentTable: object|null, spellsKnown: object[],
 *   warnings: string[]}|null}  null when the paste has none of the three.
 */
export function parseClassSupplement(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n")
    .map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const warnings = [];
  const tbl = _findTalentTable(lines);
  const ttl = _findTitles(lines);
  const sk = _findSpellsKnown(lines);
  if (tbl) warnings.push(...tbl.warnings);
  if (ttl) warnings.push(...ttl.warnings);
  const talentTable = _classifyTalentTable(tbl, warnings);
  const consumed = new Set([...(tbl?.skip ?? []), ...(ttl?.skip ?? []), ...(sk?.skip ?? [])]);
  const ex = _findExtraTables(lines, consumed);
  if (!talentTable && !ttl && !(sk?.known?.length) && !ex.tables.length) return null;
  return {
    titles: ttl?.bands ?? [],
    talentTable,
    spellsKnown: sk?.known ?? [],
    extraTables: ex.tables,
    warnings,
  };
}
