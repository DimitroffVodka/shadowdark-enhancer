/**
 * Shadowdark Enhancer — Statblock parser (pure, Foundry-free, node-testable).
 *
 * Turns a raw PDF monster-statblock dump (copied from a book by the GM) into
 * `draft` objects matching the Monster Creator's `_defaultDraft` shape, so they
 * feed `draftToActorData()` (encounter-creator.mjs) verbatim.
 *
 * DETERMINISTIC — no AI, no network. There is no AI in the production loop:
 * shipped code does all of this. So the parser degrades GRACEFULLY and flags
 * every low-confidence field as a `warning`; the GM is the human-in-the-loop who
 * corrects them in the import preview grid.
 *
 * Anchors on the Shadowdark stat line — a packed line that begins `AC <n>` and
 * ends `LV <n>` (often wrapped across several PDF lines). Everything is derived
 * relative to it: name above it, flavor between name and it, features after it.
 *
 * Ships ZERO book content — this is machinery only.
 */

// Movement words → Shadowdark NPC move keys (system.move).
const MOVE_KEYS = {
  "close": "close", "near": "near", "far": "far",
  "double near": "doubleNear", "triple near": "tripleNear",
  "none": "none", "special": "special",
};

// Valid attack range keys (CONFIG.SHADOWDARK.RANGES). Unknown → default close.
const RANGE_KEYS = new Set(["close", "near", "far", "self"]);

// Single-word "feature headers" that are really wrapped spell range/duration
// keywords (e.g. a spell desc wrapping to a line that starts "Close. …"),
// NOT real features. Prevents over-splitting spellcaster feature blocks.
const FEATURE_FALSE_POSITIVES = new Set(["close", "near", "far", "focus", "self"]);

const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Title-case a SHOUTING statblock name, e.g. "DIRE WOLF" → "Dire Wolf" (keeps ", Qualifier"). */
export function titleCaseName(s) {
  return String(s ?? "").toLowerCase()
    .replace(/(^|[\s,\-'’/(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

/**
 * A monster/section NAME line: ALL-uppercase WORDS only — letters + light punct
 * (space, comma, hyphen, apostrophe, period), ≥2 letters, and **no digits and no
 * stat-line keywords**. The digit/keyword guards are essential: a wrapped stat
 * line can leave an all-caps fragment like "LV 0" or "AL C, LV 6" on its own
 * line, which must NOT be mistaken for a name (that splits blocks + drops monsters).
 */
function isNameLine(line) {
  const t = line.trim();
  if (!/^[A-Z][A-Z ,.'’\-]*$/.test(t)) return false;             // uppercase letters + light punct, no digits/+/(
  if ((t.match(/[A-Z]/g) || []).length < 2) return false;
  if (/\b(AC|HP|ATK|MV|AL|LV|DC|ADV|DISADV)\b/.test(t)) return false; // a stat-line fragment, not a name
  return true;
}

/** A standalone page-number line (PDF artifact). */
const isPageNumber = (line) => /^\s*\d{1,4}\s*$/.test(line);

const STAT_AC = /\bAC\s+\d+/i;
const STAT_LV = /\bLV\s+\d+/i;

/**
 * Group a raw dump into blocks and classify each as a monster (has an AC…LV
 * stat line) or skipped (section header / lore / artifact).
 * @returns {{ monsters: string[], skipped: {name:string, reason:string}[] }}
 */
export function splitStatblocks(rawText) {
  const lines = String(rawText ?? "").replace(/\r\n?/g, "\n").split("\n")
    .filter((l) => !isPageNumber(l));               // drop page numbers globally

  // Partition into name-delimited blocks.
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    if (isNameLine(line)) {
      if (cur) blocks.push(cur);
      cur = { name: line.trim(), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
    // lines before the first name line are preamble → ignored
  }
  if (cur) blocks.push(cur);

  const monsters = [];
  const skipped = [];
  for (const b of blocks) {
    const hasStat = b.lines.some((l) => STAT_AC.test(l)) &&
                    [b.name, ...b.lines].join(" ").match(STAT_LV);
    if (hasStat) {
      monsters.push([b.name, ...b.lines].join("\n"));
    } else {
      skipped.push({ name: b.name, reason: "no stat line — section header or lore block" });
    }
  }
  return { monsters, skipped };
}

/** Map a parsed move base + parenthetical → {move, moveNote, warning?}. */
function parseMove(mvText, warnings) {
  const m = /^(.*?)\s*(?:\(([^)]*)\))?\s*$/.exec(mvText.trim());
  const base = collapse(m?.[1] ?? mvText).toLowerCase();
  const note = collapse(m?.[2] ?? "");
  const move = MOVE_KEYS[base];
  if (!move) {
    warnings.push(`movement "${mvText.trim()}" not recognized — set to "special"`);
    return { move: "special", moveNote: collapse(`${base} ${note}`) };
  }
  return { move, moveNote: note };
}

/** Map a range string ("far", "close/near") → array of valid range keys. */
function mapRanges(range, name, warnings) {
  if (!range) return ["close"];
  const keys = range.split("/").map((r) => r.trim().toLowerCase()).filter(Boolean);
  const out = keys.filter((k) => RANGE_KEYS.has(k));
  if (!out.length) {
    warnings.push(`attack "${name}" range "${range}" not recognized — defaulted to close`);
    return ["close"];
  }
  return out;
}

/** Parse one attack clause into an action object (or a spell marker). */
function parseOneAttack(s, warnings) {
  const str = s.trim();
  const numM = /^(\d+)\s+(.*)$/.exec(str);
  let num = 1, rest = str;
  if (numM) { num = Number(numM[1]); rest = numM[2].trim(); }
  else warnings.push(`attack "${str}" has no leading count — assumed 1`);

  const bonusM = /([+-]\d+)/.exec(rest);
  if (!bonusM) {
    // No bonus/damage → a special attack ("hypnotize", "pounce") or bare "spell".
    const nameOnly = collapse(rest.replace(/\([^)]*\)/g, ""));
    if (/^spell\b/i.test(nameOnly)) return { spell: true, num, bonus: 0 };
    return { name: titleCaseName(nameOnly) || "Special Attack", type: "NPC Special Attack",
      num, bonus: 0, damage: "", ranges: [], description: "" };
  }

  const bonus = Number(bonusM[1]);
  const beforeBonus = rest.slice(0, bonusM.index).trim();
  const afterBonus = rest.slice(bonusM.index + bonusM[0].length).trim();

  // name + optional (range) before the bonus
  let name = beforeBonus, range = "";
  const rangeM = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(beforeBonus);
  if (rangeM) { name = rangeM[1].trim(); range = rangeM[2].trim(); }

  if (/^spell\b/i.test(name)) return { spell: true, num, bonus };

  // damage clause after the bonus: "(1d10 + swallow)" / "(toxin)" / "(1 + burrow)"
  let damage = "", special = "";
  const dmgM = /^\(([^)]*)\)/.exec(afterBonus);
  if (dmgM) {
    const inner = collapse(dmgM[1]);
    const parts = inner.split(/\s*\+\s*/);
    if (/^\d*d\d+$/.test(parts[0]) || /^\d+$/.test(parts[0])) {
      damage = parts[0];
      special = parts.slice(1).join(" + ");
    } else {
      special = inner;
      warnings.push(`attack "${name}" damage "${inner}" isn't dice — left blank for review`);
    }
  } else {
    warnings.push(`attack "${name}" has a to-hit bonus but no damage`);
  }

  return { name: name || "Attack", type: "NPC Attack", num, bonus,
    damage, ranges: mapRanges(range, name, warnings), description: special };
}

/** Parse the ATK clause → { actions, spellAttack } (spellAttack feeds spellcasting). */
function parseAttacks(atkText, warnings) {
  const actions = [];
  let spellAttack = null;
  const parts = atkText.split(/\s+(?:and|or)\s+/i).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const a = parseOneAttack(p, warnings);
    if (a?.spell) { spellAttack = a; continue; }
    if (a) actions.push(a);
  }
  return { actions, spellAttack };
}

/** Parse the feature region lines into [{name, description}]. */
function parseFeatures(featureLines, warnings) {
  const features = [];
  let cur = null;
  for (const raw of featureLines) {
    const line = raw.trim();
    if (!line) continue;
    // A feature header: a Title-Case name (with an optional "(… Spell)" tag),
    // immediately followed by ". " then text.
    const m = /^([A-Z][A-Za-z'’ ]*(?:\([^)]*\))?)\.\s+(.+)$/.exec(line);
    const headerName = m ? collapse(m[1]) : null;
    const isFalsePositive = headerName &&
      FEATURE_FALSE_POSITIVES.has(headerName.toLowerCase());
    if (m && !isFalsePositive) {
      if (cur) features.push(cur);
      cur = { name: headerName, description: collapse(m[2]) };
    } else if (cur) {
      cur.description = collapse(`${cur.description} ${line}`);
    } else {
      cur = { name: "", description: collapse(line) };
      warnings.push(`feature text before any feature name — review`);
    }
  }
  if (cur) features.push(cur);
  return features;
}

/** Extract a spellcasting ability ("int"/"wis"/"cha") from a "(WIS Spell)" tag. */
function spellAbilityFromFeatures(features) {
  for (const f of features) {
    const m = /\((int|wis|cha)\s+spell\)/i.exec(f.name);
    if (m) return m[1].toLowerCase();
  }
  return "";
}

/**
 * Parse ONE monster chunk into { draft, warnings }.
 * `draft` matches encounter-creator.mjs `_defaultDraft`.
 */
export function parseStatblock(chunk) {
  const warnings = [];
  const lines = String(chunk ?? "").split("\n").map((l) => l.replace(/\s+$/, ""));
  const draft = {
    name: "", alignment: "N", level: 1,
    img: "icons/svg/mystery-man.svg", tokenSrc: "", description: "",
    hp: { value: 1, max: 1 }, ac: 10, darkAdapted: false,
    abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    move: "near", moveNote: "",
    spellcasting: { ability: "", bonus: 0, attacks: 0 },
    actions: [], features: [], spells: [],
  };

  // name = first non-empty line
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  if (firstIdx === -1) { warnings.push("empty block"); return { draft, warnings }; }
  draft.name = titleCaseName(lines[firstIdx].trim());

  // locate + reassemble the stat line (first AC… line through the line w/ LV)
  const statStart = lines.findIndex((l, i) => i > firstIdx && STAT_AC.test(l));
  if (statStart === -1) {
    warnings.push("no stat line (AC…LV) found");
    return { draft, warnings };
  }
  let statLine = "";
  let statEnd = statStart;
  for (let i = statStart; i < lines.length; i++) {
    statLine = collapse(`${statLine} ${lines[i]}`);
    statEnd = i;
    if (STAT_LV.test(statLine)) break;
  }
  if (!STAT_LV.test(statLine)) warnings.push("stat line had no LV — level unset");

  // description = lines between name and the stat line
  draft.description = collapse(lines.slice(firstIdx + 1, statStart).join(" "));

  // ── parse the stat line fields ──
  const ac = /\bAC\s+(\d+)(?:\s*\(([^)]*)\))?/i.exec(statLine);
  if (ac) draft.ac = Number(ac[1]); else warnings.push("AC not found");
  // An AC parenthetical (e.g. "AC 16 (shield)") is informational — the value is captured.

  const hp = /\bHP\s+(\d+)/i.exec(statLine);
  if (hp) { draft.hp = { value: Number(hp[1]), max: Number(hp[1]) }; }
  else warnings.push("HP not found");

  const ab = /\bS\s*([+-]\d+),\s*D\s*([+-]\d+),\s*C\s*([+-]\d+),\s*I\s*([+-]\d+),\s*W\s*([+-]\d+),\s*Ch\s*([+-]\d+)/i.exec(statLine);
  if (ab) {
    draft.abilities = { str: +ab[1], dex: +ab[2], con: +ab[3], int: +ab[4], wis: +ab[5], cha: +ab[6] };
  } else warnings.push("ability mods (S/D/C/I/W/Ch) not fully parsed");

  const al = /\bAL\s+(L|N|C)\b/i.exec(statLine);
  if (al) draft.alignment = al[1].toUpperCase(); else warnings.push("alignment not found");

  const lv = /\bLV\s+(\d+)/i.exec(statLine);
  if (lv) draft.level = Number(lv[1]); else warnings.push("level not found");

  const mv = /\bMV\s+(.+?),\s*S\s*[+-]\d/i.exec(statLine);
  if (mv) {
    const { move, moveNote } = parseMove(mv[1], warnings);
    draft.move = move; draft.moveNote = moveNote;
  } else warnings.push("movement not found");

  const atk = /\bATK\s+(.+?),\s*MV\b/i.exec(statLine);
  if (atk) {
    const { actions, spellAttack } = parseAttacks(atk[1], warnings);
    draft.actions = actions;
    if (spellAttack) {
      draft.spellcasting.bonus = spellAttack.bonus;
      draft.spellcasting.attacks = spellAttack.num || 1;
    }
  } else warnings.push("ATK clause not found");

  // ── features ──
  draft.features = parseFeatures(lines.slice(statEnd + 1), warnings);

  // ── spellcasting ability (from a "(XXX Spell)" feature tag) ──
  const ability = spellAbilityFromFeatures(draft.features);
  const isSpellcaster = !!ability || draft.spellcasting.attacks > 0;
  if (isSpellcaster) {
    draft.spellcasting.ability = ability;
    if (!draft.spellcasting.attacks) draft.spellcasting.attacks = 1;
    if (!ability) warnings.push("spellcaster, but no spell ability tag found — set ability manually");
    warnings.push("spellcaster — review the spell features (parser may over-split spell text)");
  }

  return { draft, warnings };
}

/** Parse a whole dump → { drafts: [{draft, warnings}], skipped }. */
export function parseStatblocks(rawText) {
  const { monsters, skipped } = splitStatblocks(rawText);
  return { drafts: monsters.map((m) => parseStatblock(m)), skipped };
}

export const _internals = {
  isNameLine, isPageNumber, parseMove, mapRanges, parseOneAttack, parseAttacks, parseFeatures,
};
