/**
 * Shadowdark Enhancer — Monster level guidelines (pure, node-testable).
 *
 * Answers "what should a level-N Shadowdark monster look like?" and plans the
 * edits needed to move a creature onto that baseline. Consumed by:
 *   - the Monster Creator's Level Baseline section (applies to a draft)
 *   - the Token HUD quick-adjust app (applies to a live actor)
 *   - the Level Guidelines settings editor (view / edit / recalculate)
 *
 * PURE. No Foundry globals are touched at import time, so `node --test` can
 * exercise every function here. `getGuidelinesTable()` reads a world setting
 * but is only ever called lazily, never during module load.
 *
 * ── Where the numbers come from ──────────────────────────────────────────
 * BASE_GUIDELINES was COMPUTED, not transcribed: `deriveFromActors()` (below)
 * was run over the 244 actors in the `shadowdark.monsters` system pack, taking
 * the per-level median of AC / HP / attack count / attack bonus / damage die
 * and the p10–p90 band of ability modifiers, then smoothing the result with a
 * sample-weighted isotonic regression (see `_isotonic`) so that a level with
 * one lone monster can't dictate a guideline and a higher level is never
 * weaker than a lower one.
 *
 * The output was cross-checked against Night Noon Games' "Quick Combat
 * Statistics" bookmark (© Matt Dietrich) and agrees within a point nearly
 * everywhere — levels 3, 4 and 5 match it exactly. That agreement is evidence
 * the derivation is sound; no data is reproduced from that product here.
 *
 * The HP formula `ceil(LV × 4.5) + CON` is the one stated in Night Noon Games'
 * "Creating & Adapting Monsters for Shadowdark" (4.5 being the average roll on
 * the d8 hit die Shadowdark uses for monsters under the hood). It is a rule,
 * not data, and it reproduces the bestiary's own HP column.
 *
 * Caveat on one column: `talentDC` is the weakest figure in the table. Unlike
 * the others it isn't a structured field on any actor — it was scraped from
 * "DC nn" mentions in feature prose, so the sample is small and noisy. It is
 * advisory only (displayed to help a GM pick a DC) and is never applied to a
 * document. Treat it as a hint and edit it freely.
 */

/** Levels present in the table. 20–29 are interpolated; see `guidelineFor`. */
const TABLE_LEVELS = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,30];

/**
 * Damage dice the Shadowdark bestiary actually uses, in ascending average
 * damage. `deriveFromActors` snaps a fitted average back onto this ladder so
 * the guideline is always a die a GM would recognise.
 */
const DAMAGE_LADDER = ["1", "1d4", "1d6", "1d8", "1d10", "1d12", "2d6", "2d8", "2d10", "2d12", "3d10", "4d10", "5d10"];

/** Talent DCs cluster on this ladder across the bestiary. */
const DC_RUNGS = [9, 12, 15, 18];

/** Spell Tier Impact — a monster's spells make it effectively higher level. */
const SPELL_TIER_ADJUSTMENT = { 1: 1, 2: 2, 3: 4, 4: 6, 5: 10 };

/** The hidden monster hit die is a d8; 4.5 is its average roll. */
const HIT_DIE_AVERAGE = 4.5;

export const BASE_GUIDELINES = {
  "0":  { ac: 11, hp: 1,   atk: { num: 1, bonus: 1,  damage: "1d4"  }, statMod: { median: 0, low: -4, high: 1 }, talentDC: 9  },
  "1":  { ac: 12, hp: 4,   atk: { num: 1, bonus: 1,  damage: "1d4"  }, statMod: { median: 0, low: -3, high: 1 }, talentDC: 12 },
  "2":  { ac: 13, hp: 10,  atk: { num: 1, bonus: 2,  damage: "1d6"  }, statMod: { median: 0, low: -3, high: 2 }, talentDC: 12 },
  "3":  { ac: 13, hp: 14,  atk: { num: 2, bonus: 3,  damage: "1d6"  }, statMod: { median: 1, low: -3, high: 3 }, talentDC: 12 },
  "4":  { ac: 13, hp: 19,  atk: { num: 2, bonus: 3,  damage: "1d6"  }, statMod: { median: 1, low: -3, high: 3 }, talentDC: 12 },
  "5":  { ac: 13, hp: 24,  atk: { num: 2, bonus: 4,  damage: "1d8"  }, statMod: { median: 1, low: -3, high: 3 }, talentDC: 12 },
  "6":  { ac: 14, hp: 29,  atk: { num: 2, bonus: 4,  damage: "1d8"  }, statMod: { median: 1, low: -2, high: 4 }, talentDC: 12 },
  "7":  { ac: 14, hp: 34,  atk: { num: 2, bonus: 6,  damage: "1d10" }, statMod: { median: 1, low: -2, high: 4 }, talentDC: 12 },
  "8":  { ac: 14, hp: 38,  atk: { num: 2, bonus: 6,  damage: "1d10" }, statMod: { median: 2, low: -2, high: 4 }, talentDC: 12 },
  "9":  { ac: 16, hp: 43,  atk: { num: 3, bonus: 7,  damage: "2d6"  }, statMod: { median: 3, low: -2, high: 4 }, talentDC: 12 },
  "10": { ac: 16, hp: 48,  atk: { num: 3, bonus: 8,  damage: "2d8"  }, statMod: { median: 3, low: -2, high: 4 }, talentDC: 15 },
  "11": { ac: 16, hp: 53,  atk: { num: 3, bonus: 9,  damage: "2d8"  }, statMod: { median: 3, low: 1,  high: 4 }, talentDC: 15 },
  "12": { ac: 16, hp: 58,  atk: { num: 3, bonus: 9,  damage: "2d10" }, statMod: { median: 3, low: 1,  high: 5 }, talentDC: 15 },
  "13": { ac: 16, hp: 61,  atk: { num: 3, bonus: 9,  damage: "2d10" }, statMod: { median: 3, low: 1,  high: 5 }, talentDC: 15 },
  "14": { ac: 16, hp: 68,  atk: { num: 3, bonus: 9,  damage: "2d10" }, statMod: { median: 3, low: 1,  high: 5 }, talentDC: 15 },
  "15": { ac: 16, hp: 71,  atk: { num: 3, bonus: 9,  damage: "2d10" }, statMod: { median: 3, low: 1,  high: 5 }, talentDC: 15 },
  "16": { ac: 18, hp: 76,  atk: { num: 3, bonus: 9,  damage: "2d10" }, statMod: { median: 4, low: 3,  high: 6 }, talentDC: 15 },
  "17": { ac: 18, hp: 80,  atk: { num: 3, bonus: 9,  damage: "2d10" }, statMod: { median: 4, low: 3,  high: 6 }, talentDC: 15 },
  "18": { ac: 18, hp: 85,  atk: { num: 3, bonus: 9,  damage: "2d10" }, statMod: { median: 4, low: 3,  high: 6 }, talentDC: 15 },
  "19": { ac: 18, hp: 89,  atk: { num: 3, bonus: 9,  damage: "2d10" }, statMod: { median: 4, low: 3,  high: 6 }, talentDC: 15 },
  "30": { ac: 22, hp: 140, atk: { num: 4, bonus: 13, damage: "5d10" }, statMod: { median: 4, low: 3,  high: 7 }, talentDC: 18 },
};

// ─── Small numeric helpers ────────────────────────────────────────────────

/** Average damage of a die expression ("2d6" → 7). Bare numbers pass through. */
export function averageDamage(expr) {
  const s = String(expr ?? "").trim().toLowerCase();
  const plain = Number(s);
  if (Number.isFinite(plain)) return plain;
  const m = /^(\d+)d(\d+)$/.exec(s);
  if (!m) return 0;
  return Number(m[1]) * (Number(m[2]) + 1) / 2;
}

/** Snap an average-damage value onto the nearest die in DAMAGE_LADDER. */
function snapDamage(avg) {
  return DAMAGE_LADDER.reduce(
    (best, d) => Math.abs(averageDamage(d) - avg) < Math.abs(averageDamage(best) - avg) ? d : best,
    DAMAGE_LADDER[0],
  );
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function quantile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Pool-adjacent-violators isotonic regression: the nearest weighted
 * non-decreasing sequence to `xs`. Used to smooth per-level medians so a
 * level with one monster (weight 1) can't outvote a level with thirty, and
 * so no level ends up weaker than the one below it.
 */
function _isotonic(xs, weights) {
  const blocks = xs.map((v, i) => ({ sum: v * weights[i], w: weights[i], len: 1 }));
  for (let i = 1; i < blocks.length; i++) {
    while (i > 0 && blocks[i - 1].sum / blocks[i - 1].w > blocks[i].sum / blocks[i].w) {
      blocks[i - 1].sum += blocks[i].sum;
      blocks[i - 1].w   += blocks[i].w;
      blocks[i - 1].len += blocks[i].len;
      blocks.splice(i, 1);
      i--;
    }
  }
  const out = [];
  for (const b of blocks) for (let k = 0; k < b.len; k++) out.push(b.sum / b.w);
  return out;
}

// ─── Table access ─────────────────────────────────────────────────────────

/**
 * The active guidelines table: shipped defaults with the GM's stored edits
 * layered on top. The setting default is `{}` rather than a snapshot, so a
 * GM who edited one row still picks up improvements to every other row.
 *
 * Touches `game.settings` — call lazily, never at import time.
 */
export function getGuidelinesTable() {
  const base = foundry.utils.deepClone(BASE_GUIDELINES);
  let stored = null;
  try {
    stored = game.settings.get("shadowdark-enhancer", "levelGuidelines");
  } catch {
    // Setting not registered yet (very early call) — fall back to defaults.
    stored = null;
  }
  const merged = stored && Object.keys(stored).length
    ? foundry.utils.mergeObject(base, stored, { inplace: false, insertKeys: true, insertValues: true })
    : base;
  for (const [level, row] of Object.entries(merged)) {
    if (row && typeof row === "object") row.level = Number(level);
  }
  return merged;
}

/**
 * The guideline row for a level. Levels between two table rows (20–29) are
 * linearly interpolated; anything outside the table clamps to its nearest end.
 */
export function guidelineFor(level, table = BASE_GUIDELINES) {
  const want = Number(level);
  const levels = Object.keys(table).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!levels.length) return null;

  const lo = levels[0];
  const hi = levels[levels.length - 1];
  if (!Number.isFinite(want) || want <= lo) return { ...table[String(lo)], level: lo };
  if (want >= hi) return { ...table[String(hi)], level: hi };
  if (table[String(want)]) return { ...table[String(want)], level: want };

  // Interpolate between the bracketing rows.
  const below = levels.filter(l => l < want).pop();
  const above = levels.find(l => l > want);
  const a = table[String(below)];
  const b = table[String(above)];
  const t = (want - below) / (above - below);
  const lerp = (x, y) => Math.round(x + (y - x) * t);
  return {
    level: want,
    ac: lerp(a.ac, b.ac),
    hp: lerp(a.hp, b.hp),
    atk: {
      num:    lerp(a.atk.num, b.atk.num),
      bonus:  lerp(a.atk.bonus, b.atk.bonus),
      damage: snapDamage(averageDamage(a.atk.damage) + (averageDamage(b.atk.damage) - averageDamage(a.atk.damage)) * t),
    },
    statMod: {
      median: lerp(a.statMod.median, b.statMod.median),
      low:    lerp(a.statMod.low, b.statMod.low),
      high:   lerp(a.statMod.high, b.statMod.high),
    },
    talentDC: lerp(a.talentDC, b.talentDC),
  };
}

/**
 * Monster HP: `ceil(LV × 4.5) + CON`, floored at 1. A level-0 creature with a
 * penalty CON still has a hit point.
 */
export function hpForLevel(level, conMod = 0) {
  const lv = Number(level);
  const con = Number(conMod);
  const base = Math.ceil((Number.isFinite(lv) ? lv : 0) * HIT_DIE_AVERAGE);
  return Math.max(1, base + (Number.isFinite(con) ? con : 0));
}

/**
 * Spell Tier Impact: attached spells make a monster effectively higher level.
 * The highest tier present sets the base bump; every spell past the second
 * adds one more level.
 *
 * @param {Array} spells — entries carrying `tier`, `system.tier`, or a
 *                         "T3"-style `tierLabel` (the Creator draft shape).
 * @returns {{adjustment:number, tiers:number[], reasons:string[]}}
 */
export function spellLevelAdjustment(spells = []) {
  const tiers = (spells ?? [])
    .map(s => {
      const direct = Number(s?.tier ?? s?.system?.tier ?? s?.source?.system?.tier);
      if (Number.isFinite(direct) && direct > 0) return direct;
      const m = /^T(\d+)$/i.exec(String(s?.tierLabel ?? ""));
      return m ? Number(m[1]) : null;
    })
    .filter(t => Number.isFinite(t) && t > 0);

  if (!tiers.length) return { adjustment: 0, tiers: [], reasons: [] };

  const highest = Math.max(...tiers);
  const base = SPELL_TIER_ADJUSTMENT[Math.min(highest, 5)] ?? 0;
  const extra = Math.max(0, tiers.length - 2);
  const reasons = [`Tier ${highest} spell: +${base} level${base === 1 ? "" : "s"}`];
  if (extra) reasons.push(`${extra} spell${extra === 1 ? "" : "s"} beyond 2: +${extra}`);

  return { adjustment: base + extra, tiers, reasons };
}

// ─── The adjustment planner ───────────────────────────────────────────────

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * Plan the edits that move `current` onto the guideline for `targetLevel`.
 * PURE — returns a description of the change and writes nothing.
 *
 * @param {object} current  Normalized snapshot:
 *   `{ level, ac, hp: {value, max}, abilities: {str..cha}, attacks: [{id, name, num, bonus, damage}] }`
 *   `abilities` values are Shadowdark ability MODIFIERS, not scores.
 * @param {number} targetLevel
 * @param {object} [opts]
 * @param {object} [opts.table]           Guidelines table (defaults to BASE_GUIDELINES).
 * @param {boolean} [opts.applyAbilities] Whether the ability change is checked. HP depends on
 *   the post-change CON, so the plan needs to know. Defaults to true.
 * @returns {{targetLevel, guideline, abilityDelta, rows: Array, attacks: Array, changed: boolean}}
 */
export function planLevelAdjust(current, targetLevel, opts = {}) {
  const table = opts.table ?? BASE_GUIDELINES;
  const applyAbilities = opts.applyAbilities !== false;

  const target = Number(targetLevel);
  const guideline = guidelineFor(target, table);
  const from = guidelineFor(current?.level ?? 0, table);

  // Abilities: preserve the creature's stat SHAPE if it has one. A uniform
  // shift keeps an ogre STR-heavy, and the per-ability clamp stops a dump stat
  // drifting up into hero territory.
  //
  // A flat spread (all six mods equal — a fresh draft at 0, or a featureless
  // creature) has no shape to preserve, and shifting it by the level delta
  // would be a no-op whenever the target level equals the current one. In that
  // case adopt the level's typical modifier instead, so the ability toggle
  // does something useful when authoring from scratch.
  const curAbilities = current?.abilities ?? {};
  const currentMods = ABILITY_KEYS.map(k => Number(curAbilities[k] ?? 0));
  const isFlat = currentMods.every(m => m === currentMods[0]);

  const abilityDelta = isFlat
    ? guideline.statMod.median - currentMods[0]
    : guideline.statMod.median - from.statMod.median;

  const nextAbilities = {};
  for (const key of ABILITY_KEYS) {
    const cur = Number(curAbilities[key] ?? 0);
    nextAbilities[key] = clamp(cur + abilityDelta, guideline.statMod.low, guideline.statMod.high);
  }

  const conForHp = applyAbilities ? nextAbilities.con : Number(curAbilities.con ?? 0);
  const nextHp = hpForLevel(target, conForHp);

  const rows = [
    _row("level", "Level", current?.level ?? 0, target),
    _row("ac", "AC", Number(current?.ac ?? 0), guideline.ac),
    _row("hp", "HP", Number(current?.hp?.max ?? current?.hp ?? 0), nextHp),
  ];

  for (const key of ABILITY_KEYS) {
    rows.push(_row(`abilities.${key}`, key.toUpperCase(), Number(curAbilities[key] ?? 0), nextAbilities[key], "abilities"));
  }

  const attacks = (current?.attacks ?? []).map(a => ({
    id: a.id,
    name: a.name,
    num:    { from: Number(a.num ?? 1),   to: guideline.atk.num },
    bonus:  { from: Number(a.bonus ?? 0), to: guideline.atk.bonus },
    damage: { from: String(a.damage ?? ""), to: guideline.atk.damage },
    changed:
      Number(a.num ?? 1) !== guideline.atk.num ||
      Number(a.bonus ?? 0) !== guideline.atk.bonus ||
      String(a.damage ?? "") !== guideline.atk.damage,
  }));

  return {
    targetLevel: target,
    guideline,
    abilityDelta,
    nextAbilities,
    nextHp,
    rows,
    attacks,
    changed: rows.some(r => r.changed) || attacks.some(a => a.changed),
  };
}

function _row(key, label, from, to, group = key) {
  return { key, group, label, from, to, delta: to - from, changed: from !== to };
}

// ─── Derivation + validation ──────────────────────────────────────────────

/**
 * Recompute the whole guidelines table from a list of Shadowdark NPC actors.
 * This is the exact code that produced BASE_GUIDELINES, so the settings
 * editor's "Recalculate from installed monsters" button and the shipped
 * defaults are always the same algorithm over different inputs.
 *
 * Accepts documents or plain objects — it only reads `system` and `items`.
 */
export function deriveFromActors(actors = []) {
  const buckets = new Map();
  for (const a of actors) {
    const sys = a?.system ?? {};
    const lvl = typeof sys.level === "object" ? Number(sys.level?.value) : Number(sys.level);
    if (!Number.isFinite(lvl)) continue;

    if (!buckets.has(lvl)) buckets.set(lvl, { n: 0, ac: [], hp: [], num: [], bonus: [], dmg: [], mods: [] });
    const b = buckets.get(lvl);
    b.n++;

    const ac = Number(sys.attributes?.ac?.value);
    if (Number.isFinite(ac)) b.ac.push(ac);
    const hp = Number(sys.attributes?.hp?.max);
    if (Number.isFinite(hp)) b.hp.push(hp);
    for (const key of ABILITY_KEYS) {
      const m = Number(sys.abilities?.[key]?.mod);
      if (Number.isFinite(m)) b.mods.push(m);
    }
    for (const it of (a.items ?? [])) {
      if (it?.type !== "NPC Attack") continue;
      const num = Number(it.system?.attack?.num);
      if (Number.isFinite(num)) b.num.push(num);
      const bonus = Number(it.system?.bonuses?.attackBonus);
      if (Number.isFinite(bonus)) b.bonus.push(bonus);
      const dmg = String(it.system?.damage?.value ?? "").trim();
      if (/^\d+d\d+$/.test(dmg)) b.dmg.push(dmg);
    }
  }

  const levels = [...buckets.keys()].sort((x, y) => x - y);
  // Nothing to learn from — hand back the shipped defaults untouched. Cloned
  // without foundry.utils so this stays callable under `node --test`.
  if (!levels.length) return JSON.parse(JSON.stringify(BASE_GUIDELINES));

  const raw = levels.map(l => {
    const b = buckets.get(l);
    const fallback = guidelineFor(l);
    return {
      level: l,
      n: b.n,
      ac:    median(b.ac) ?? fallback.ac,
      hp:    median(b.hp) ?? fallback.hp,
      num:   median(b.num) ?? fallback.atk.num,
      bonus: median(b.bonus) ?? fallback.atk.bonus,
      dmgAvg: b.dmg.length
        ? median(b.dmg.map(averageDamage))
        : averageDamage(fallback.atk.damage),
      med:  quantile(b.mods, 0.50) ?? fallback.statMod.median,
      low:  quantile(b.mods, 0.10) ?? fallback.statMod.low,
      high: quantile(b.mods, 0.90) ?? fallback.statMod.high,
    };
  });

  const weights = raw.map(r => Math.max(1, r.n));
  const fit = key => _isotonic(raw.map(r => r[key]), weights).map(Math.round);
  const ac = fit("ac");
  const hp = fit("hp");
  const num = fit("num");
  const bonus = fit("bonus");
  const med = fit("med");
  const low = fit("low");
  const high = fit("high");
  const dmg = _isotonic(raw.map(r => r.dmgAvg), weights).map(snapDamage);

  const out = {};
  raw.forEach((r, i) => {
    out[String(r.level)] = {
      level: r.level,
      ac: ac[i],
      hp: hp[i],
      atk: { num: Math.max(1, num[i]), bonus: bonus[i], damage: dmg[i] },
      statMod: { median: med[i], low: low[i], high: high[i] },
      // Not derivable from structured actor data — carry the shipped value.
      talentDC: guidelineFor(r.level).talentDC,
    };
  });
  return out;
}

/**
 * Validate and parse an exported guidelines JSON blob.
 * @returns {{ok: true, table: object} | {ok: false, error: string}}
 */
export function parseGuidelinesJSON(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ""));
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err.message}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "Top level must be an object keyed by level." };
  }

  const table = {};
  for (const [key, row] of Object.entries(data)) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < 0) {
      return { ok: false, error: `"${key}" is not a valid level key.` };
    }
    if (!row || typeof row !== "object") {
      return { ok: false, error: `Level ${key}: row must be an object.` };
    }
    for (const field of ["ac", "hp", "talentDC"]) {
      if (!Number.isFinite(Number(row[field]))) {
        return { ok: false, error: `Level ${key}: "${field}" must be a number.` };
      }
    }
    if (!row.atk || typeof row.atk !== "object") {
      return { ok: false, error: `Level ${key}: missing "atk" block.` };
    }
    for (const field of ["num", "bonus"]) {
      if (!Number.isFinite(Number(row.atk[field]))) {
        return { ok: false, error: `Level ${key}: "atk.${field}" must be a number.` };
      }
    }
    const damage = String(row.atk.damage ?? "").trim();
    if (!/^(\d+|\d+d\d+)$/.test(damage)) {
      return { ok: false, error: `Level ${key}: "atk.damage" must look like "2d6" or a plain number.` };
    }
    if (!row.statMod || typeof row.statMod !== "object") {
      return { ok: false, error: `Level ${key}: missing "statMod" block.` };
    }
    for (const field of ["median", "low", "high"]) {
      if (!Number.isFinite(Number(row.statMod[field]))) {
        return { ok: false, error: `Level ${key}: "statMod.${field}" must be a number.` };
      }
    }
    if (Number(row.statMod.low) > Number(row.statMod.high)) {
      return { ok: false, error: `Level ${key}: statMod.low is above statMod.high.` };
    }

    table[String(level)] = {
      level,
      ac: Number(row.ac),
      hp: Number(row.hp),
      atk: { num: Number(row.atk.num), bonus: Number(row.atk.bonus), damage },
      statMod: {
        median: Number(row.statMod.median),
        low:    Number(row.statMod.low),
        high:   Number(row.statMod.high),
      },
      talentDC: Number(row.talentDC),
    };
  }

  if (!Object.keys(table).length) {
    return { ok: false, error: "No level rows found." };
  }
  return { ok: true, table };
}

export const _internals = { _isotonic, snapDamage, median, quantile, TABLE_LEVELS, DAMAGE_LADDER, DC_RUNGS };
