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
    .replace(/(^|[\s,\-'’/(&])([a-z])/g, (_, p, c) => p + c.toUpperCase());
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
  if (!/^[A-Z][A-Z &/,.'’\-]*$/.test(t)) return false;           // uppercase letters + light punct (incl & and /), no digits/+/(
  if ((t.match(/[A-Z]/g) || []).length < 2) return false;
  if (/\b(AC|HP|ATK|MV|AL|LV|DC|ADV|DISADV)\b/.test(t)) return false; // a stat-line fragment, not a name
  return true;
}

/** A standalone page-number line (PDF artifact). */
const isPageNumber = (line) => /^\s*\d{1,4}\s*$/.test(line);

// The monster anchor pair — exported so the dump-segmenter (and any other
// recognizer-order logic) reuses the OWNING parser's definition instead of
// keeping a drifting copy (review 2026-07-11 maintainability).
export const STAT_AC = /\bAC\s+\d+/i;
export const STAT_LV = /\bLV\s+\d+/i;

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

  // A no-stat block that directly follows a monster is usually that monster's
  // ALL-CAPS feature caption ("AMPHIBIOUS" + prose), not a new unit — detach
  // it and the feature is silently lost (review #4). Reattach it, UNLESS it
  // carries another recognizer's anchor (item cost/rider, spell tier, table
  // rows) — those must stay unclaimed for the later recognizers.
  const baitsOtherRecognizer = (text) =>
    /\b\d+\s*(gp|sp|cp)\b/i.test(text) ||
    /\b(Benefit|Bonus|Curse|Personality)\./.test(text) ||
    /\bTier\s+\d/i.test(text) ||
    /^\s*\d+\s*[-–]\s*\d+\s+\S/m.test(text);

  let prevWasMonster = false;
  for (const b of blocks) {
    const hasStat = b.lines.some((l) => STAT_AC.test(l)) &&
                    [b.name, ...b.lines].join(" ").match(STAT_LV);
    if (hasStat) {
      monsters.push([b.name, ...b.lines].join("\n"));
      prevWasMonster = true;
      continue;
    }
    const blockText = [b.name, ...b.lines].join("\n");
    const captionWords = b.name.trim().split(/\s+/).length;
    const looksLikeFeatureCaption = prevWasMonster &&
      captionWords <= 4 && !/\d/.test(b.name) &&
      b.lines.filter((l) => l.trim()).length <= 6 &&
      !baitsOtherRecognizer(blockText);
    if (looksLikeFeatureCaption) {
      monsters[monsters.length - 1] += `\n${blockText}`;
      // prevWasMonster stays true — a monster may have several caption blocks.
    } else {
      skipped.push({ name: b.name, reason: "no stat line — section header or lore block" });
      prevWasMonster = false;
    }
  }
  return { monsters, skipped };
}

/** Map a parsed move base + parenthetical → {move, moveNote, warning?}. */
function parseMove(mvText, warnings) {
  // Isolate the primary mode + its parenthetical, then anything after the first
  // TOP-LEVEL comma is a secondary mode → moveNote. Splitting in the regex (not
  // on indexOf(",")) keeps a single-mode note whose own text contains a comma
  // inside parens intact — e.g. "near (climb, swim)" stays move "near" / note
  // "climb, swim" — while a compound "near (climb), double near (fly)" keeps the
  // primary "near" instead of collapsing the whole thing to "special".
  const full = String(mvText).trim();
  const m = /^([A-Za-z ]+?)\s*(?:\(([^)]*)\))?\s*(?:,\s*(.*))?$/.exec(full);
  const base = collapse(m?.[1] ?? full).toLowerCase();
  const note = collapse(m?.[2] ?? "");
  const extra = collapse(m?.[3] ?? "");
  const move = MOVE_KEYS[base];
  if (!move) {
    warnings.push(`movement "${full}" not recognized — set to "special"`);
    return { move: "special", moveNote: collapse([`${base} ${note}`.trim(), extra].filter(Boolean).join("; ")) };
  }
  return { move, moveNote: collapse([note, extra].filter(Boolean).join("; ")) };
}

/** Map a range string ("far", "close/near") → array of valid range keys. */
function mapRanges(range, name, warnings) {
  if (!range) return ["close"];
  const keys = range.split(/[/,]/).map((r) => r.trim().toLowerCase()).filter(Boolean);
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

  // Anchor the to-hit bonus to the signed number immediately before the "("
  // damage group, falling back to a free scan only when there's no parenthetical
  // (e.g. "spell +4"). Stops a signed number inside a rider from being read as
  // the to-hit. The lookahead keeps the match text the bare bonus, so the
  // index/slice math below is byte-identical on canonical inputs.
  const bonusM = /([+-]\d+)(?=\s*\()/.exec(rest) || /([+-]\d+)/.exec(rest);
  if (!bonusM) {
    // No bonus/damage → a special attack ("hypnotize", "pounce") or bare "spell".
    const nameOnly = collapse(rest.replace(/\([^)]*\)/g, ""));
    if (/^spells?\b/i.test(nameOnly)) return { spell: true, num, bonus: 0 };
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

  if (/^spells?\b/i.test(name)) return { spell: true, num, bonus };

  // damage clause after the bonus: "(1d10 + swallow)" / "(toxin)" / "(1 + burrow)"
  let damage = "", special = "";
  // First "(" to LAST ")" (not the first) so a nested parenthetical inside the
  // rider — e.g. "(1d8 + poison (DC 12))" — is preserved instead of truncated.
  // Unanchored (no trailing $) so a clause with text after the damage group
  // ("(1d6) plus poison") still captures the damage rather than losing it.
  const dmgM = /^\((.*)\)/.exec(afterBonus);
  if (dmgM) {
    const inner = collapse(dmgM[1]);
    const parts = inner.split(/\s*\+\s*/);
    // Greedily absorb ALL leading dice/flat-numeric terms into the damage
    // formula, so a flat modifier ("1d6 + 2", "2d6 + 1", "1d12 + 1d6") is kept as
    // real damage instead of being stranded as a "special" rider. The first
    // non-numeric token (e.g. "swallow") starts the rider.
    const isTerm = (p) => /^(\d*d\d+|\d+)$/.test(p);
    if (isTerm(parts[0])) {
      let i = 0;
      const dmg = [];
      while (i < parts.length && isTerm(parts[i])) { dmg.push(parts[i]); i++; }
      damage = dmg.join(" + ");
      special = parts.slice(i).join(" + ");
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
  // Split on " and "/" or " ONLY when the next fragment begins a new clause — a
  // count ("1 pounce") or the bare word "spell". This stops an " and "/" or "
  // embedded in an attack NAME ("hit and run", "grab or throw") from tearing the
  // real attack into a phantom special + a renamed attack. Canonical multi-clause
  // statblocks always lead the next clause with a count or "spell", so they still
  // split. (Graceful limitation: a count-less trailing special "… and pounce"
  // merges into the prior name rather than splitting — far less destructive than
  // the old mis-split, and rare in canonical content.)
  const parts = atkText.split(/\s+(?:and|or)\s+(?=\d|spell\b)/i).map((s) => s.trim()).filter(Boolean);
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
    // Strip a leading bullet/dash/asterisk (some PDFs render features as a list)
    // before matching the header. Name class accepts hyphen, slash, en-dash,
    // em-dash, and a trailing numeric suffix ("Acid Spit 2.") in addition to
    // letters/apostrophes/spaces — the old class silently dropped all of those,
    // turning a real feature into unnamed review text (and, when it followed
    // another feature, merging it into the prior one with NO warning). The
    // optional "(… Spell)" tag capture is preserved so spellcaster detection
    // still sees it.
    const stripped = line.replace(/^[•\-*–—]\s+/, "");
    // Standalone ALL-CAPS caption line ("AMPHIBIOUS") — some PDFs render the
    // feature name on its own line with the prose below (review #4). Start a
    // named feature and flag it for review (the reattach in splitStatblocks
    // is heuristic — the caption could be an unrelated section header).
    const capsCaption = /^[A-Z][A-Z'’/–—\- ]+$/.test(stripped) && stripped.length <= 40
      ? titleCaseName(stripped) : null;
    if (capsCaption && !FEATURE_FALSE_POSITIVES.has(capsCaption.toLowerCase())) {
      if (cur) features.push(cur);
      cur = { name: capsCaption, description: "" };
      warnings.push(`feature "${capsCaption}" captured from a standalone caps caption — verify it belongs to this monster`);
      continue;
    }
    const m = /^([A-Z][A-Za-z'’/–—\- ]*\d*(?:\s*\([^)]*\))?)\.\s+(.+)$/.exec(stripped);
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
    hp: { value: 1, max: 1 }, ac: 10, acNote: "", darkAdapted: false,
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
  if (ac) { draft.ac = Number(ac[1]); if (ac[2]) draft.acNote = collapse(ac[2]); }
  else warnings.push("AC not found");
  // An AC parenthetical (e.g. "AC 16 (shield)") is kept as acNote for the
  // stat-block description; the numeric value drives the AC field.

  const hp = /\bHP\s+(\d+)/i.exec(statLine);
  if (hp) { draft.hp = { value: Number(hp[1]), max: Number(hp[1]) }; }
  else warnings.push("HP not found");

  // Parse each ability mod INDEPENDENTLY so one missing/garbled token doesn't
  // reset the whole block to zeros (the old single all-or-nothing alternation
  // did). `\bC\s*[+-]` can't steal CHA's value because "Ch" has an "h" (not a
  // sign) after the C, so the CON scan skips it. CHA also accepts "Cha"/"CHA".
  // A real 0 mod ("C +0") yields Number 0 (kept); only a truly absent stat is
  // null and gets flagged.
  const grabMod = (key) => {
    const m = new RegExp(`\\b${key}\\s*([+-]\\d+)`, "i").exec(statLine);
    return m ? Number(m[1]) : null;
  };
  const abVals = {
    str: grabMod("S"), dex: grabMod("D"), con: grabMod("C"),
    int: grabMod("I"), wis: grabMod("W"),
  };
  const chaM = /\bCh(?:a)?\s*([+-]\d+)/i.exec(statLine);
  abVals.cha = chaM ? Number(chaM[1]) : null;
  const missingMods = Object.entries(abVals).filter(([, v]) => v === null).map(([k]) => k);
  draft.abilities = {
    str: abVals.str ?? 0, dex: abVals.dex ?? 0, con: abVals.con ?? 0,
    int: abVals.int ?? 0, wis: abVals.wis ?? 0, cha: abVals.cha ?? 0,
  };
  if (missingMods.length) warnings.push(`ability mods not parsed: ${missingMods.join("/")}`);

  // Accept spelled-out alignment ("Lawful"/"Neutral"/"Chaotic") by capturing the
  // leading initial and consuming the optional remainder — the old trailing \b
  // after a single letter failed on "AL Lawful" and silently defaulted to N.
  const al = /\bAL\s+([LNC])(?:awful|eutral|haotic)?\b/i.exec(statLine);
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
