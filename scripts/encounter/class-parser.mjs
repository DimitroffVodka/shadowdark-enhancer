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

// ─── Line classifiers ────────────────────────────────────────────────────────

const HEADER_KEY  = /^(Weapons?|Armou?r|Hit\s*Points?)\s*[:.]\s*(.*)$/i;
const TALENTS_CAP = /^(?:[A-Z' -]+\s+)?TALENTS$/;          // "TALENTS" / "BARBARIAN TALENTS"
const TITLES_CAP  = /^(?:[A-Z' -]+\s+)?TITLES$/;
const DIE_HEADER  = /^(\d*d\d+)\b/i;                        // "2d6 Effect"
const DIE_ONLY    = /^(\d*d\d+)$/i;                         // a lone "2d6" line
const ROW_START   = /^(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?\s+(\S.*)$/;
const LONE_RANGE  = /^(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?$/; // a bare "3-6" line
const CAPS_CAP    = /^[A-Z' -]{4,}$/;                       // any all-caps caption
const FEATURE_RE  = /^([A-Z][A-Za-z'’ -]{0,39})\.\s+(\S.*)$/;
const BULLET      = /^[•\-]\s+/;

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
  const known = flat.match(/know(?:s)?\s+(?:either\s+)?(?:the\s+)?([A-Z][\w'’-]+(?:\s*(?:,|and|or)\s*[A-Z][\w'’-]+)*)\s+languages?/i);
  if (known) {
    const names = known[1].split(/\s*(?:,|and|or)\s*/).map((w) => w.trim()).filter((w) => /^[A-Z]/.test(w));
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
      if (/^effects?$/i.test(l) || /^\d{1,3}$/.test(l)) { skip.add(k); continue; }
      if (TITLES_CAP.test(l) || CAPS_CAP.test(l)) break;   // next caption
      skip.add(k);
      if (texts.length && /^[a-z]/.test(l)) texts[texts.length - 1] += " " + l;   // wrapped line
      else texts.push(l);
    }
    return texts;
  };
  const zip = (run, texts, skip, formula) => {
    const n = Math.min(run.length, texts.length);
    const rows = [];
    for (let k = 0; k < n; k++) {
      const rm = run[k].match(LONE_RANGE);
      rows.push({ lo: Number(rm[1]), hi: Number(rm[2] ?? rm[1]), text: texts[k].replace(/\s+/g, " ").trim() });
    }
    const warnings = run.length !== texts.length
      ? [`Talent table (column copy): ${run.length} roll ranges vs ${texts.length} effect lines — zipped the first ${n}; review the table before commit.`]
      : [];
    return rows.length ? { skip, formula, rows, warnings } : null;
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

  if (capIdx === -1) return null;
  const skip = new Set([capIdx]);
  let j = capIdx + 1;
  let formula = "2d6";
  // Skip die-header / "Effect" strays directly after the caption.
  while (j < lines.length && (DIE_ONLY.test(lines[j]) || /^effects?$/i.test(lines[j]))) {
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
    const rm = lines[j].match(ROW_START);
    if (rm) { rows.push({ lo: Number(rm[1]), hi: Number(rm[2] ?? rm[1]), text: rm[3] }); skip.add(j); }
    else if (rows.length) { rows[rows.length - 1].text += " " + lines[j]; skip.add(j); }   // wrapped row
  }
  return rows.length ? { skip, formula, rows, warnings: [] } : null;
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
  if (capIdx === -1) return null;
  const skip = new Set([capIdx]);
  const warnings = [];
  let order = ["lawful", "chaotic", "neutral"];
  const bands = [];
  for (let k = capIdx + 1; k < lines.length; k++) {
    const l = lines[k];
    if (/levels?/i.test(l) && /lawful|chaotic|neutral/i.test(l)) {
      const cols = [...l.matchAll(/lawful|chaotic|neutral/gi)].map((m) => m[0].toLowerCase());
      if (cols.length === 3) order = cols;
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
function _findSpellsKnown(lines) {
  const capIdx = lines.findIndex((l) => /^[A-Z' -]*SPELLS\s+KNOWN$/.test(l));
  if (capIdx === -1) return null;
  const skip = new Set([capIdx]);
  const tokens = [];
  for (let k = capIdx + 1; k < lines.length; k++) {
    const l = lines[k];
    if (/^spells\s+known\s+by/i.test(l)) { skip.add(k); continue; }   // subtitle
    const parts = l.split(/\s+/);
    if (!parts.every((p) => /^(?:levels?|\d{1,2}|[-–—+])$/i.test(p))) break;   // zone ends
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

  // ── Unified walk: headers, features, flavor — headers recognized anywhere
  // (two-column PDF copies interleave them with features). ──
  let weaponsText = "", armorText = "", hitDie = "";
  const flavorLines = [];
  const features = [];
  let cur = null;
  for (let i = 1; i < lines.length; i++) {
    if (tbl?.skip.has(i) || ttl?.skip.has(i) || sk?.skip.has(i)) continue;
    const line = lines[i];
    if (/^\d{1,3}$/.test(line)) continue;                       // stray page number
    if (DIE_ONLY.test(line) || /^effects?$/i.test(line)) continue;   // sheared table-header strays
    if (TALENTS_CAP.test(line)) continue;                       // caption w/o parsed rows
    if (TITLES_CAP.test(line)) break;                           // unparsed titles follow
    const m = line.match(HEADER_KEY);
    if (m) {
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
      if (cur) features.push(cur);
      cur = { name: fm[1].trim(), lines: [fm[2]] };
      continue;
    }
    if (cur) cur.lines.push(line);
    else flavorLines.push(line);
  }
  if (cur) features.push(cur);
  if (!hitDie) warnings.push("No hit die found on the Hit Points line — defaulting to d6; check the sheet.");

  // Render each feature's lines to HTML, preserving bullet lists.
  const toHtml = (ls) => {
    const out = []; let list = null;
    const flush = () => { if (list) { out.push(`<ul>${list.map((b) => `<li>${b}</li>`).join("")}</ul>`); list = null; } };
    let para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${para.join(" ")}</p>`); para = []; } };
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
    if (/choose one type of (?:gear or )?weapon.*(?:wield|attack)/i.test(body) || /choose one type of gear/i.test(body))
      warnings.push(`"${f.name}" is a choice-at-creation feature — register it in CHOICE_SPECS (class-step.mjs) and wire its effect.`);
    keptFeatures.push({ name: f.name, description: toHtml(f.lines) });
  }

  // ── Talent-table row classification ──
  let talentTable = null;
  if (tbl) {
    for (const r of tbl.rows) {
      r.text = r.text.replace(/\s+/g, " ").trim();
      Object.assign(r, _classifyRow(r.text));
      if (r.kind === "single" && / or /i.test(r.text))
        warnings.push(`Talent row ${r.lo}${r.hi !== r.lo ? `-${r.hi}` : ""} contains "or" but wasn't split into options — review before commit.`);
    }
    talentTable = { formula: tbl.formula, rows: tbl.rows };
  }
  if (!talentTable) warnings.push("No TALENTS table found in the paste — the class will have no talent table until one is added.");
  if (!ttl) warnings.push("No TITLES table in the paste (often a separate book section) — paste it into the class text, add bands in the preview, or set system.titles later.");

  // ── Wield lists ──
  // "All …" phrases set the booleans; whatever survives stripping them is a
  // NAMED EXTRA that coexists with the grant ("All melee weapons, crossbow"
  // → allMelee + ["crossbow"] — SD's weapons[] array works alongside the flags).
  const splitNames = (s) => s.split(/\s*(?:,|\band\b)\s*/i).map((w) => w.trim()).filter(Boolean);
  const allWeapons = /all\s+weapons/i.test(weaponsText);
  const allMelee   = /all\s+melee/i.test(weaponsText);
  const allRanged  = /all\s+ranged/i.test(weaponsText);
  const allArmor   = /all\s+armou?r/i.test(armorText);
  const weaponExtras = weaponsText.replace(/all\s+(?:melee\s+|ranged\s+)?weapons?/ig, "");
  const armorExtras  = armorText.replace(/all\s+armou?r(?:\s+and\s+shields?)?/ig, "").replace(/\bnone\b/i, "");

  return {
    name,
    flavor: flavorLines.length ? `<p>${flavorLines.join(" ")}</p>` : "",
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
    warnings,
  };
}
