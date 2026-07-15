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

/** Cost token — `N gp/sp/cp`. Mirrors item-parser.COST_RE. */
const COST_RE = /(\d+)\s*(gp|sp|cp)\b/i;
/** Slots token — `N slot(s)`. */
const SLOTS_WORD_RE = /(\d+)\s*slots?\b/i;
/** A die expression: d8, 1d8, 2d6, or a versatile pair d8/d10. */
const DIE_RE = /^\d*d\d+(\s*(?:\/|\bor\b)\s*\d*d\d+)?$/i;
/** Ranges the weapon model accepts. */
const RANGES = new Set(["close", "near", "far", "nearline"]);

const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

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
};

/** Full property names we recognize verbatim (so pastes can spell them out). */
const KNOWN_PROP_NAMES = new Set([
  "occupies one hand", "no swim", "disadvantage/stealth", "disadvantage/swim",
  "sundering", "shield", "finesse", "thrown", "versatile", "loading",
  "two-handed", "returning", "breakable",
].map((s) => s));

/** Split a paste into reflowed records: blank line = record boundary. */
function splitRecords(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((r) => r.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
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
        const label = WR_CODE_LABELS[key] ?? key;
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
  let nameRaw = collapse(fields[0] ?? "").replace(/,\s*$/, "");
  let cost = null, base = 0, modifier = 0, slots = null, baseArmor = "";
  const propNames = [];

  for (const field of fields.slice(1)) {
    const f = collapse(field);
    if (!f) continue;
    const c = parseCost(f);
    if (c) { cost = c; continue; }
    const sw = f.match(SLOTS_WORD_RE);
    if (sw) { slots = Number(sw[1]); continue; }
    if (/^\+\d+$/.test(f)) { modifier = Number(f.slice(1)); continue; }   // +2 → shield bonus
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
    if (/^[A-Za-z][A-Za-z' -]*$/.test(f)) { baseArmor = f.toLowerCase(); continue; }
    warnings.push(`Unparsed armor field "${f}" — ignored.`);
  }

  // Fold a material into the name: a ", mithral" suffix or a standalone tag.
  const suffix = nameRaw.match(/,\s*([A-Za-z][A-Za-z' -]*)$/);
  if (suffix) { baseArmor = baseArmor || suffix[1].toLowerCase(); nameRaw = nameRaw.slice(0, suffix.index).trim(); }
  const name = baseArmor && !nameRaw.toLowerCase().includes(baseArmor)
    ? `${titleCase(baseArmor)} ${nameRaw}` : nameRaw;

  if (cost === null) warnings.push("No cost found — defaulted to 0 gp.");
  if (base === 0 && modifier === 0) warnings.push("No AC value found — set the AC on the sheet after import.");

  const draft = {
    name: collapse(name) || "Unnamed Armor",
    type: "Armor",
    cost: cost ?? { gp: 0, sp: 0, cp: 0 },
    slots: { free_carry: 0, per_slot: 1, slots_used: slots ?? 1 },
    ac: { base, modifier, attribute: base ? "dex" : "" },
    baseArmor,
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
    if (!f) continue;
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
 * @returns {{ draft: object, warnings: string[] }[]}
 */
export function parseGear(text, kind) {
  const records = splitRecords(text);
  const parseOne = kind === "Armor" ? parseArmorRecord : parseWeaponRecord;
  return records.map(parseOne);
}

export const gearParser = { parseGear, WR_ARMOR_CODES, WR_WEAPON_CODES };
