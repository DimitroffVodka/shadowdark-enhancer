/**
 * gear-parser.mjs — pure (Foundry-free, node-testable) parser for Shadowdark
 * Weapon and Armor stat blocks pasted from the rulebooks.
 *
 * The generic item recognizer (item-parser.mjs) only captures name/cost/slots —
 * it produces stat-less shells for Weapon/Armor. This parser reads the real
 * stat columns so imported gear works: armor AC (base/modifier/attribute) and
 * weapon damage (1h/2h die, range, melee/ranged), plus the letter-coded
 * PROPERTY column.
 *
 * INPUT SHAPES (both handled):
 *   • Reflowed table — one field per line, a blank line between records. This is
 *     how a PDF armor/weapon table pastes:
 *         Round shield,
 *         60 gp
 *          0            ← slots (bare number < 10)
 *          +2           ← AC modifier (leading "+", shield-style bonus)
 *          C, S         ← property codes
 *         mithral       ← material tag
 *   • Inline — one record per line, comma-separated:
 *         Longsword, 9 gp, 1 slot, 1d8 (1d10 two-handed), close, F
 *     A run of such lines (a clean table extract) splits per LINE — blank lines
 *     are not required between inline records; a wrapped property column
 *     rejoins the row above.
 *   • Stat row — the book table's space-separated columns, one row per line
 *     (what the single-column PDF extract of the WR weapon/armor tables
 *     actually yields; live-verified 2026-07-14):
 *         Weapon:  Falchion 12 gp M C 1d8 2H, F        (Type M|R|M/R · Range C|N|F)
 *         Armor:   Plate mail 130 gp 3 15 H, L, M       (slots · AC "15"/"11 + DEX mod"/"+2")
 *     Armor wraps long names across three lines ("Chainmail," / "240 gp 1 13
 *     + DEX mod M" / "mithral") — the bare comma-name binds to the headless
 *     stat line below it and a trailing lowercase word is the material.
 *     Headers, page-footer numbers, and the interleaved property-definitions
 *     PROSE on the same pages are dropped and reported via onDrop, never
 *     minted as items (2026-07-14 pre-push review; the "+"/"" phantom rows).
 *
 * OUTPUT: { draft, warnings }[] matching item-parser's itemRecognizer.parse, so
 * the hub's item pipeline and item-importer.buildItemData consume it unchanged.
 * `draft.propNames` holds resolved Shadowdark property NAMES; a Foundry-bound
 * resolver (item-importer.resolveGearProperties) turns those into the
 * DocumentUUID array the data model stores. Unknown/unmapped codes are flagged
 * for review, never silently dropped.
 *
 * WR PROPERTY LETTER-CODE LEGEND (Player's Guide to the Western Reaches):
 *   Carried (C)     → Occupies One Hand      [armor]
 *   Heavy (H)       → No Swim                 [armor]
 *   Loud (L)        → Disadvantage/Stealth    [armor]
 *   Restrictive (R) → Disadvantage/Swim       [armor]
 *   Sundering (S)   → Sundering               [armor & weapon — type-filtered]
 *   Mount (M)       → (no core SD property — flagged)
 */

import { collapse } from "./pdf-text-utils.mjs";

/** Cost token — `N gp/sp/cp`. Mirrors item-parser.COST_RE. */
const COST_RE = /(\d+)\s*(gp|sp|cp)\b/i;
/** Slots token — `N slot(s)`. */
const SLOTS_WORD_RE = /(\d+)\s*slots?\b/i;
/** A die expression: d8, 1d8, 2d6, or a versatile pair d8/d10. */
const DIE_RE = /^\d*d\d+(\s*(?:\/|\bor\b)\s*\d*d\d+)?$/i;
/** Ranges the weapon model accepts. */
const RANGES = new Set(["close", "near", "far", "nearline"]);
/** A "none" table cell — books print an em-dash (or hyphen) for "no value". */
const NONE_FIELD_RE = /^[—–-]+$/;

const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
/** System-style slug ("Plate mail" → "plate-mail") — matches shadowdark.gear's
 *  baseArmor values (live-verified: Mithral Chainmail → "chainmail"). */
const slugify = (s) => String(s ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * WR armor property letter-codes → Shadowdark property names.
 * `null` = a real WR code with no core Shadowdark equivalent (flagged, not applied).
 */
export const WR_ARMOR_CODES = {
  C: "Occupies One Hand",
  H: "No Swim",
  L: "Disadvantage/Stealth",
  R: "Disadvantage/Swim",
  S: "Sundering",
  M: null,   // Mount — no core SD property
};
/** Human labels for the flag message when a code maps to nothing. */
export const WR_CODE_LABELS = { C: "Carried", H: "Heavy", L: "Loud", R: "Restrictive", S: "Sundering", M: "Mount" };

/**
 * WR weapon property letter-codes → Shadowdark property names. The weapons table
 * uses the standard Shadowdark abbreviations; Sundering (S) is shared with armor
 * and resolves by item type.
 */
export const WR_WEAPON_CODES = {
  F: "Finesse",
  Th: "Thrown",
  T: "Thrown",
  V: "Versatile",
  Lo: "Loading",
  L: "Loading",
  "2H": "Two-Handed",
  S: "Sundering",
  R: "Returning",
  B: "Breakable",
  // WR-only weapon codes with no core Shadowdark property — flagged with
  // their book label (live weapon table p110-111), never applied silently.
  C: null,    // Charge
  D: null,    // Devastating
  M: null,    // Mounted
  O: null,    // Obsidian
  Sn: null,   // Sniper
};
/** Weapon-side labels for null-mapped codes (armor labels live in WR_CODE_LABELS). */
export const WR_WEAPON_LABELS = { C: "Charge", D: "Devastating", M: "Mounted", O: "Obsidian", Sn: "Sniper" };

/** Full property names we recognize verbatim (so pastes can spell them out). */
const KNOWN_PROP_NAMES = new Set([
  "occupies one hand", "no swim", "disadvantage/stealth", "disadvantage/swim",
  "sundering", "shield", "finesse", "thrown", "versatile", "loading",
  "two-handed", "returning", "breakable",
].map((s) => s));

/**
 * Anchored gear-signal test for one comma field. Anchoring matters: prose like
 * "deals 1d4 damage" or "is worth 10 gp at least" must NOT count, or the
 * property-definitions section printed beside the book tables trips the
 * inline-run splitter (live-verified failure mode, 2026-07-14).
 */
function isFieldSignal(f) {
  return /^\d+\s*(?:gp|sp|cp)(?:\s+\d+\s*(?:gp|sp|cp))*$/i.test(f)
    || /^varies$/i.test(f) || NONE_FIELD_RE.test(f)
    || /^\d+\s*slots?$/i.test(f) || /^\+?\d+$/.test(f)
    || /^\d*d\d+(?:\s*\/\s*\d*d\d+)?$/i.test(f)
    || RANGES.has(f.toLowerCase()) || /^(melee|ranged)$/i.test(f)
    || asCodeTokens(f) !== null;
}

/**
 * Does a line read as a COMPLETE inline gear row ("Name, cost, …")? Needs a
 * name-like first field, ≥3 comma fields, and at least one whole-field gear
 * signal among the rest (cost, Varies, "—", slots, die, range, melee/ranged,
 * a bare/plus number, or property codes). Cost alone is deliberately NOT
 * required — real tables print "Varies" and "—" costs.
 */
function looksInlineRow(line) {
  const fields = String(line).split(",").map(collapse).filter(Boolean);
  if (fields.length < 3) return false;
  if (!/^[A-Za-z]/.test(fields[0]) || fields[0].length < 2) return false;
  return fields.slice(1).some(isFieldSignal);
}

// ── Book stat rows (space-separated table columns) ────────────────────────────

/** Table column codes → the model's words. Dual codes ("M/R", "C/N") keep the
 *  FIRST as the stored value — the props column (Th) carries the other use,
 *  matching how the core system data stores e.g. the Dagger. */
const TYPE_CODE = { M: "melee", R: "ranged" };
const RANGE_CODE = { C: "close", N: "near", F: "far" };

// Cost is a coin amount or a "—" (the unarmed-strikes row prints a dash cost;
// the dash passes through as a none-field so "No cost found" review-flags it).
const WEAPON_STAT_ROW_RE = /^(?<name>[A-Za-z][A-Za-z0-9' -]*?)\s+(?<cost>\d+\s*(?:gp|sp|cp)|[—–-])\s+(?<type>[MR](?:\/[MR])?)(?<x2>\s+2x)?\s+(?<range>[CNF](?:\/[CNF])?)\s+(?<damage>\d*d\d+(?:\/\d*d\d+)?|\d+|[—–-])(?:\s+(?<props>\S.*))?$/;
const WEAPON_STAT_HEADLESS_RE = /^(?<cost>\d+\s*(?:gp|sp|cp)|[—–-])\s+(?<type>[MR](?:\/[MR])?)(?<x2>\s+2x)?\s+(?<range>[CNF](?:\/[CNF])?)\s+(?<damage>\d*d\d+(?:\/\d*d\d+)?|\d+|[—–-])(?:\s+(?<props>\S.*))?$/;
const ARMOR_STAT_ROW_RE = /^(?<name>[A-Za-z][A-Za-z0-9' -]*?(?:,\s*[A-Za-z][A-Za-z ]*?)?)\s+(?<cost>\d+\s*(?:gp|sp|cp))\s+(?<slots>\d)\s+(?<ac>\+\d+|\d{2}(?:\s*\+\s*DEX(?:\s+mod)?)?)(?:\s+(?<props>\S.*))?$/i;
const ARMOR_STAT_HEADLESS_RE = /^(?<cost>\d+\s*(?:gp|sp|cp))\s+(?<slots>\d)\s+(?<ac>\+\d+|\d{2}(?:\s*\+\s*DEX(?:\s+mod)?)?)(?:\s+(?<props>\S.*))?$/i;

/** Match a line as a book stat row for `kind`. → { full } | { headless } | null */
function matchStatRow(line, kind) {
  const [fullRe, headlessRe] = kind === "Armor"
    ? [ARMOR_STAT_ROW_RE, ARMOR_STAT_HEADLESS_RE]
    : [WEAPON_STAT_ROW_RE, WEAPON_STAT_HEADLESS_RE];
  const full = fullRe.exec(line);
  if (full) return { full };
  const headless = headlessRe.exec(line);
  if (headless) return { headless };
  return null;
}

/**
 * Turn a matched stat row into a synthetic FIELDS record (multi-element array,
 * so recordFields passes it through verbatim — no comma re-splitting).
 * `pendingName` supplies the name for a headless wrap line.
 */
function statRowFields(kind, groups, pendingName) {
  const g = groups;
  const name = collapse(pendingName ?? g.name ?? "");
  const fields = [name, g.cost];
  if (kind === "Armor") {
    fields.push(`${g.slots} slots`);
    // Keep the book's AC distinction intact: "13 + DEX mod" stays a DEX-armor
    // field, a bare "15" becomes the explicit no-DEX "AC 15" (plate-style —
    // the system stores attribute "" there, live-verified vs shadowdark.gear),
    // and "+2" stays a shield modifier.
    if (/^\+\d+$/.test(g.ac)) fields.push(g.ac);
    else if (/dex/i.test(g.ac)) fields.push(g.ac.replace(/\s*mod$/i, "").trim());
    else fields.push(`AC ${g.ac}`);
    if (g.props) fields.push(g.props);
  } else {
    fields.push(TYPE_CODE[g.type[0]]);
    fields.push(RANGE_CODE[g.range[0]]);
    // Flat damage ("1") and "—" have no die — leave the field off so the
    // parser's "No damage die found" review flag fires (faithful; the GM
    // confirms flat/no damage on the sheet).
    if (/\d*d\d+/.test(g.damage)) fields.push(g.damage);
    if (g.x2) fields.push("2x");   // reach notation — surfaces as an unparsed-field review flag
    for (const tok of String(g.props ?? "").split(",").map(collapse).filter(Boolean)) fields.push(tok);
  }
  return fields;
}

/**
 * Split a paste into records. Blank lines always bound blocks (the reflowed
 * PDF-viewer shape). Within a block:
 *   1. ≥2 book STAT rows → a run of one-row records; bare comma-names bind to
 *      the headless stat line below (armor name wrap), a trailing lowercase
 *      word is that record's material, everything else (headers, page-footer
 *      numbers, the property-definitions prose) is dropped + reported.
 *   2. else ≥2 comma-INLINE rows → a run of one-line records; non-row lines
 *      rejoin the row above (wrapped property columns), symbol-only strays
 *      and leading noise are dropped + reported.
 *   3. else the block is one reflowed record.
 */
function splitRecords(text, kind, { onDrop } = {}) {
  const blocks = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((r) => r.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
  const records = [];
  for (const lines of blocks) {
    const stat = lines.map((l) => matchStatRow(l, kind));
    // One FULL stat row is decisive on its own (the regex is strict: name +
    // cost + column codes) — so an isolated row, or blank-separated rows one
    // per block, parse as stat rows too. Headless matches still need company.
    const fullCount = stat.filter((m) => m?.full).length;
    if (fullCount >= 1 || stat.filter(Boolean).length >= 2) {
      let pendingName = null;   // "Chainmail," — waiting for its headless stat line
      let lastWrap = null;      // record built from a wrap — its material may follow
      const dropPending = () => { if (pendingName) { onDrop?.(pendingName, "not a gear row"); pendingName = null; } };
      for (let i = 0; i < lines.length; i++) {
        const m = stat[i];
        if (m?.full) {
          dropPending();
          records.push(statRowFields(kind, m.full.groups, null));
          lastWrap = null;
        } else if (m?.headless) {
          if (pendingName) {
            const rec = statRowFields(kind, m.headless.groups, pendingName.replace(/,\s*$/, ""));
            records.push(rec); lastWrap = rec; pendingName = null;
          } else onDrop?.(lines[i], "stat columns without an item name");
        } else if (lastWrap && /^[a-z][a-z' -]*$/.test(lines[i])) {
          lastWrap.push(lines[i]);   // "mithral" → material field on the wrap record
          lastWrap = null;
        } else if (/^[A-Za-z][A-Za-z' -]*,$/.test(lines[i])) {
          dropPending();
          pendingName = lines[i];    // wrap start: a bare name ending in a comma
          lastWrap = null;
        } else {
          onDrop?.(lines[i], "not a gear row");
          lastWrap = null;
        }
      }
      dropPending();
      continue;
    }
    const inline = lines.map(looksInlineRow);
    if (lines.length > 1 && inline.filter(Boolean).length >= 2) {
      let cur = null;
      for (let i = 0; i < lines.length; i++) {
        if (inline[i]) { cur = [lines[i]]; records.push(cur); }
        else if (/^[^A-Za-z0-9]*$/.test(lines[i])) onDrop?.(lines[i], "stray symbol between rows");
        else if (cur) cur[0] = `${cur[0]}, ${lines[i]}`;   // wrap continuation
        else onDrop?.(lines[i], "not a gear row");          // leading header/noise
      }
    } else records.push(lines);
  }
  return records;
}

/**
 * Turn a record's raw lines into classifiable FIELDS. A single-line record is an
 * inline comma list; a multi-line record is already one field per line (but a
 * property field like "C, S" stays a single field so it's decoded as codes).
 */
function recordFields(lines) {
  if (lines.length === 1) return lines[0].split(",").map(collapse).filter(Boolean);
  return lines;
}

/** Parse a `N gp/sp/cp` field (possibly several coins) → {gp,sp,cp}. */
function parseCost(field) {
  const cost = { gp: 0, sp: 0, cp: 0 };
  let hit = false;
  for (const m of String(field).matchAll(new RegExp(COST_RE.source, "gi"))) {
    cost[m[2].toLowerCase()] += Number(m[1]);
    hit = true;
  }
  return hit ? cost : null;
}

/** A comma/space list of 1-2 letter tokens → the tokens (e.g. "C, S" → [C,S]). */
function asCodeTokens(field) {
  const toks = String(field).split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
  if (!toks.length) return null;
  // Every token must look like a property code: 1-2 letters, or a digit+letter
  // like "2H". A lone word ("mithral") fails this and is treated as material.
  if (toks.every((t) => /^(?:[A-Za-z]{1,2}|\dH)$/.test(t))) return toks;
  return null;
}

/**
 * Decode a property field (codes or full names) into Shadowdark property names.
 * @returns {{ names: string[], warnings: string[] }}
 */
function decodeProps(field, kind) {
  const names = [];
  const warnings = [];
  const codeMap = kind === "Armor" ? WR_ARMOR_CODES : WR_WEAPON_CODES;

  const codes = asCodeTokens(field);
  if (codes) {
    for (const raw of codes) {
      // Try exact case, then a case-normalized lookup (C, s, 2h all resolve).
      const key = Object.keys(codeMap).find((k) => k.toLowerCase() === raw.toLowerCase());
      if (key === undefined) {
        warnings.push(`Unknown ${kind.toLowerCase()} property code "${raw}" — left off; add it in the sheet if needed.`);
        continue;
      }
      const name = codeMap[key];
      if (name === null) {
        const labels = kind === "Armor" ? WR_CODE_LABELS : WR_WEAPON_LABELS;
        const label = labels[key] ?? key;
        warnings.push(`Property "${label}" (${key}) has no core Shadowdark property — left off; note it in the description.`);
        continue;
      }
      names.push(name);
    }
    return { names, warnings };
  }

  // Full names, comma-separated.
  for (const part of String(field).split(",").map(collapse).filter(Boolean)) {
    if (KNOWN_PROP_NAMES.has(part.toLowerCase())) names.push(titleCase(part));
    else warnings.push(`Unrecognized property "${part}" — left off; add it in the sheet if needed.`);
  }
  return { names, warnings };
}

/** Parse a damage field ("d8", "2d6", "d8/d10", "d10 (two-handed)") → {oneHanded,twoHanded}. */
function parseDamage(field, { twoHandedOnly = false } = {}) {
  const raw = collapse(field).toLowerCase();
  const pair = raw.match(/(\d*d\d+)\s*(?:\/|\bor\b)\s*(\d*d\d+)/);
  if (pair) return { oneHanded: normDie(pair[1]), twoHanded: normDie(pair[2]) };
  const die = raw.match(/\d*d\d+/);
  if (!die) return null;
  const d = normDie(die[0]);
  return twoHandedOnly ? { oneHanded: "", twoHanded: d } : { oneHanded: d, twoHanded: "" };
}

/** Normalize a die to the model's key form: "1d8"→"d8", "2d6"→"2d6", "d8"→"d8". */
function normDie(d) {
  const m = String(d).toLowerCase().match(/^(\d*)d(\d+)$/);
  if (!m) return String(d);
  const n = m[1] === "" || m[1] === "1" ? "" : m[1];
  return `${n}d${m[2]}`;
}

/** Parse one Armor record's fields → { draft, warnings }. */
function parseArmorRecord(lines) {
  const fields = recordFields(lines);
  const warnings = [];
  const originalName = collapse(fields[0] ?? "").replace(/,\s*$/, "");
  let nameRaw = originalName;
  let cost = null, base = 0, modifier = 0, slots = null, material = "";
  let acAttr = null;   // null = unstated; "dex" / "" when the source is explicit
  const propNames = [];

  for (const field of fields.slice(1)) {
    const f = collapse(field);
    if (!f || NONE_FIELD_RE.test(f) || /^varies$/i.test(f)) continue;   // "—"/"Varies" = no value
    const c = parseCost(f);
    if (c) { cost = c; continue; }
    const sw = f.match(SLOTS_WORD_RE);
    if (sw) { slots = Number(sw[1]); continue; }
    if (/^\+\d+$/.test(f)) { modifier = Number(f.slice(1)); continue; }   // +2 → shield bonus
    const dexAc = f.match(/^(\d+)\s*\+\s*dex(?:\s+mod)?$/i);              // "13 + DEX (mod)"
    if (dexAc) { base = Number(dexAc[1]); acAttr = "dex"; continue; }
    const flatAc = f.match(/^ac\s+(\d+)$/i);                              // "AC 15" — explicit no-DEX
    if (flatAc) { base = Number(flatAc[1]); acAttr = ""; continue; }
    if (/^\d+$/.test(f)) {
      const n = Number(f);
      if (n >= 10) base = n;          // worn armor AC (11/13/15)
      else slots = n;                 // gear slots (0-3)
      continue;
    }
    const codes = asCodeTokens(f);
    if (codes || /[,/]/.test(f) || KNOWN_PROP_NAMES.has(f.toLowerCase())) {
      const dec = decodeProps(f, "Armor");
      propNames.push(...dec.names); warnings.push(...dec.warnings);
      continue;
    }
    // A lone word that isn't a code/number/cost → material (mithral, etc.).
    if (/^[A-Za-z][A-Za-z' -]*$/.test(f)) { material = f.toLowerCase(); continue; }
    warnings.push(`Unparsed armor field "${f}" — ignored.`);
  }

  // Fold a material into the name: a ", mithral" suffix or a standalone tag.
  const suffix = nameRaw.match(/,\s*([A-Za-z][A-Za-z' -]*)$/);
  if (suffix) { material = material || suffix[1].toLowerCase(); nameRaw = nameRaw.slice(0, suffix.index).trim(); }
  const folded = material && !nameRaw.toLowerCase().includes(material);
  const name = folded ? `${titleCase(material)} ${nameRaw}` : nameRaw;
  // baseArmor holds the UNDERLYING armor's slug on material variants (system
  // convention, live-verified: Mithral Chainmail → "chainmail"); plain "".
  const baseArmor = folded ? slugify(nameRaw) : "";
  // The pre-fold spellings anchor description matching (the book's headers
  // say "Shield." while the folded item is "Mithral Shield").
  const altNames = folded
    ? [...new Set([originalName, nameRaw])].filter((n) => n && n !== collapse(name))
    : [];

  if (cost === null) warnings.push("No cost found — defaulted to 0 gp.");
  if (base === 0 && modifier === 0) warnings.push("No AC value found — set the AC on the sheet after import.");

  const draft = {
    name: collapse(name) || "Unnamed Armor",
    type: "Armor",
    cost: cost ?? { gp: 0, sp: 0, cp: 0 },
    slots: { free_carry: 0, per_slot: 1, slots_used: slots ?? 1 },
    // Explicit source notation wins; a bare reflowed number keeps the old
    // dex default (11/13 worn armor is DEX armor unless the book says not).
    ac: { base, modifier, attribute: acAttr ?? (base ? "dex" : "") },
    baseArmor,
    ...(altNames.length ? { altNames } : {}),
    propNames,
    description: "<p></p>",
  };
  return { draft, warnings };
}

/** Parse one Weapon record's fields → { draft, warnings }. */
function parseWeaponRecord(lines) {
  const fields = recordFields(lines);
  const warnings = [];
  const nameRaw = collapse(fields[0] ?? "").replace(/,\s*$/, "");
  let cost = null, slots = null, range = "", wtype = "", damage = null;
  const propNames = [];
  const rest = fields.slice(1);

  // Decode properties first so parseDamage knows about two-handed-only weapons.
  const propFields = [];
  const other = [];
  for (const field of rest) {
    const f = collapse(field);
    if (!f || NONE_FIELD_RE.test(f) || /^varies$/i.test(f)) continue;   // "—"/"Varies" = no value
    if (parseCost(f)) { cost = parseCost(f); continue; }
    const sw = f.match(SLOTS_WORD_RE);
    if (sw) { slots = Number(sw[1]); continue; }
    if (/^\d+$/.test(f) && Number(f) < 10 && slots === null) { slots = Number(f); continue; }
    if (RANGES.has(f.toLowerCase())) { range = f.toLowerCase(); continue; }
    if (/^(melee|ranged)$/i.test(f)) { wtype = f.toLowerCase(); continue; }
    if (DIE_RE.test(f) || /\d*d\d+\s*\(.*two-?handed.*\)/i.test(f) || /\d*d\d+.*two-?handed/i.test(f)) { other.push({ kind: "damage", f }); continue; }
    const codes = asCodeTokens(f);
    if (codes || KNOWN_PROP_NAMES.has(f.toLowerCase()) || /[,/]/.test(f)) { propFields.push(f); continue; }
    other.push({ kind: "?", f });
  }

  for (const pf of propFields) {
    const dec = decodeProps(pf, "Weapon");
    propNames.push(...dec.names); warnings.push(...dec.warnings);
  }
  const twoHandedOnly = propNames.includes("Two-Handed") && !propNames.includes("Versatile");
  for (const o of other) {
    if (o.kind === "damage") {
      const twoH = /two-?handed/i.test(o.f);
      damage = parseDamage(o.f, { twoHandedOnly: twoHandedOnly && !/\//.test(o.f) });
      if (twoH && damage && !/\//.test(o.f)) damage = { oneHanded: "", twoHanded: damage.oneHanded || damage.twoHanded };
    } else {
      warnings.push(`Unparsed weapon field "${o.f}" — ignored.`);
    }
  }

  // Default type: ranged when the range is far (siege/bows), else melee.
  if (!wtype) wtype = range === "far" ? "ranged" : "melee";
  if (!range) range = wtype === "ranged" ? "far" : "close";
  if (cost === null) warnings.push("No cost found — defaulted to 0 gp.");
  if (!damage) warnings.push("No damage die found — set damage on the sheet after import.");

  const draft = {
    name: nameRaw || "Unnamed Weapon",
    type: "Weapon",
    cost: cost ?? { gp: 0, sp: 0, cp: 0 },
    slots: { free_carry: 0, per_slot: 1, slots_used: slots ?? 1 },
    damage: damage ?? { oneHanded: "", twoHanded: "" },
    range, wtype,
    propNames,
    description: "<p></p>",
  };
  return { draft, warnings };
}

/**
 * Parse a Weapon or Armor paste.
 * @param {string} text
 * @param {"Weapon"|"Armor"} kind
 * @param {{ onDrop?: (text: string, reason: string) => void }} [opts] — called
 *   for every block/line rejected as not-a-record (strays, phantoms), so the
 *   caller can surface the drops (hub Skipped list / builder note) instead of
 *   silently losing them.
 * @returns {{ draft: object, warnings: string[] }[]}
 */
export function parseGear(text, kind, { onDrop } = {}) {
  const records = splitRecords(text, kind, { onDrop });
  const parseOne = kind === "Armor" ? parseArmorRecord : parseWeaponRecord;
  // Record hygiene: never mint an item from a nameless/symbol-only block
  // ("+", "112" page footers — the observed phantom rows), drop multi-line
  // PROSE blocks (the property-definitions section shares the table's pages),
  // and treat lone one-word blocks ("mithral") as noise when real rows exist.
  const keep = [];
  const loneWords = [];
  for (const rec of records) {
    const nameField = collapse(recordFields(rec)[0] ?? "").replace(/,\s*$/, "");
    if (!nameField || !/^[A-Za-z]/.test(nameField)) { onDrop?.(rec.join(" / "), "no item name"); continue; }
    const prose = rec.length >= 3
      && rec.every((l) => !matchStatRow(l, kind))
      && rec.reduce((n, l) => n + l.length, 0) / rec.length > 30;
    if (prose) { onDrop?.(`${rec[0]} …`, "prose block, not a gear record"); continue; }
    const substantial = rec.length > 1 || recordFields(rec).length > 1;
    if (!substantial && /^[A-Za-z][A-Za-z' -]*$/.test(nameField)) { loneWords.push(rec); continue; }
    keep.push(rec);
  }
  // A lone word next to real rows is extraction noise, but a name-only paste
  // (seeded unlock, hand-typed name) should still make a reviewable draft.
  if (keep.length === 0) keep.push(...loneWords);
  else for (const rec of loneWords) onDrop?.(rec.join(" / "), "lone word — not an item row");
  return keep.map(parseOne);
}

export const gearParser = { parseGear, WR_ARMOR_CODES, WR_WEAPON_CODES };
