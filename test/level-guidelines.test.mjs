import test from "node:test";
import assert from "node:assert/strict";

import {
  BASE_GUIDELINES,
  averageDamage,
  guidelineFor,
  hpForLevel,
  spellLevelAdjustment,
  planLevelAdjust,
  deriveFromActors,
  parseGuidelinesJSON,
  _internals,
} from "../scripts/monster-creator/level-guidelines.mjs";

// ─── hpForLevel — the zine formula: ceil(LV × 4.5) + CON ──────────────────

test("hpForLevel applies ceil(level × 4.5) + CON", () => {
  assert.equal(hpForLevel(5, 3), 26, "ceil(22.5) = 23, +3 CON");
  assert.equal(hpForLevel(6, 3), 30, "matches the bestiary Ogre exactly");
  assert.equal(hpForLevel(8, 0), 36);
  assert.equal(hpForLevel(1, 0), 5, "ceil(4.5)");
});

test("hpForLevel floors at 1 hit point", () => {
  assert.equal(hpForLevel(0, 0), 1);
  assert.equal(hpForLevel(0, -4), 1, "a penalty CON never zeroes a creature out");
  assert.equal(hpForLevel(1, -4), 1);
});

test("hpForLevel tolerates junk input", () => {
  assert.equal(hpForLevel(undefined, undefined), 1);
  assert.equal(hpForLevel("3", "1"), 15, "ceil(13.5) + 1");
});

// ─── guidelineFor — lookup, clamping, interpolation ───────────────────────

test("guidelineFor returns the exact row for a tabled level", () => {
  const row = guidelineFor(5);
  assert.equal(row.level, 5);
  assert.equal(row.ac, 13);
  assert.equal(row.atk.damage, "1d8");
});

test("guidelineFor clamps outside the table", () => {
  assert.equal(guidelineFor(-3).level, 0);
  assert.equal(guidelineFor(999).level, 30);
  assert.equal(guidelineFor(Number.NaN).level, 0);
});

test("guidelineFor interpolates the untabled 20-29 band", () => {
  const l19 = guidelineFor(19);
  const l30 = guidelineFor(30);
  const l25 = guidelineFor(25);

  assert.equal(l25.level, 25);
  assert.ok(l25.ac > l19.ac && l25.ac < l30.ac, `AC ${l25.ac} sits between ${l19.ac} and ${l30.ac}`);
  assert.ok(l25.hp > l19.hp && l25.hp < l30.hp, `HP ${l25.hp} sits between ${l19.hp} and ${l30.hp}`);
  assert.match(l25.atk.damage, /^\d+d\d+$/, "interpolated damage is still a real die");
});

test("the shipped table never gets weaker as level rises", () => {
  const levels = Object.keys(BASE_GUIDELINES).map(Number).sort((a, b) => a - b);
  for (let i = 1; i < levels.length; i++) {
    const lo = BASE_GUIDELINES[String(levels[i - 1])];
    const hi = BASE_GUIDELINES[String(levels[i])];
    assert.ok(hi.ac >= lo.ac, `AC L${levels[i]} (${hi.ac}) >= L${levels[i - 1]} (${lo.ac})`);
    assert.ok(hi.hp > lo.hp, `HP L${levels[i]} (${hi.hp}) > L${levels[i - 1]} (${lo.hp})`);
    assert.ok(hi.atk.bonus >= lo.atk.bonus, `attack bonus L${levels[i]} >= L${levels[i - 1]}`);
    assert.ok(
      averageDamage(hi.atk.damage) >= averageDamage(lo.atk.damage),
      `damage L${levels[i]} (${hi.atk.damage}) >= L${levels[i - 1]} (${lo.atk.damage})`,
    );
    assert.ok(hi.statMod.low <= hi.statMod.high, `L${levels[i]} band is ordered`);
  }
});

// ─── spellLevelAdjustment — the Spell Tier Impact ladder ──────────────────

test("spellLevelAdjustment is zero without spells", () => {
  assert.equal(spellLevelAdjustment([]).adjustment, 0);
  assert.equal(spellLevelAdjustment().adjustment, 0);
  assert.equal(spellLevelAdjustment([{ name: "not a spell" }]).adjustment, 0);
});

test("spellLevelAdjustment follows the tier ladder", () => {
  const at = tier => spellLevelAdjustment([{ tier }]).adjustment;
  assert.equal(at(1), 1);
  assert.equal(at(2), 2);
  assert.equal(at(3), 4);
  assert.equal(at(4), 6);
  assert.equal(at(5), 10);
});

test("spellLevelAdjustment adds one level per spell beyond the second", () => {
  const two   = spellLevelAdjustment([{ tier: 2 }, { tier: 1 }]);
  const four  = spellLevelAdjustment([{ tier: 2 }, { tier: 1 }, { tier: 1 }, { tier: 1 }]);
  assert.equal(two.adjustment, 2, "highest tier drives it; no surcharge at two spells");
  assert.equal(four.adjustment, 4, "tier 2 (+2) plus two extra spells (+2)");
  assert.equal(four.reasons.length, 2);
});

test("spellLevelAdjustment reads the Creator draft's tierLabel shape", () => {
  const fromLabel = spellLevelAdjustment([{ tierLabel: "T3" }]);
  const fromSource = spellLevelAdjustment([{ source: { system: { tier: 3 } } }]);
  assert.equal(fromLabel.adjustment, 4);
  assert.equal(fromSource.adjustment, 4);
});

// ─── planLevelAdjust — the core planner ───────────────────────────────────

/** The bestiary Ogre: L6, AC 9, HP 30, one 2-attack greatclub +6 (2d6). */
function ogre() {
  return {
    level: 6,
    ac: 9,
    hp: { value: 30, max: 30 },
    abilities: { str: 4, dex: -1, con: 3, int: -2, wis: -2, cha: -2 },
    attacks: [{ id: "atk1", name: "Greatclub", num: 2, bonus: 6, damage: "2d6" }],
  };
}

test("planLevelAdjust writes nothing and reports what would change", () => {
  const before = ogre();
  const plan = planLevelAdjust(before, 8);

  assert.deepEqual(before, ogre(), "input snapshot is not mutated");
  assert.equal(plan.targetLevel, 8);
  assert.equal(plan.rows.find(r => r.key === "level").to, 8);
  assert.equal(plan.rows.find(r => r.key === "ac").to, 14, "L8 guideline AC");
  assert.ok(plan.changed);
});

test("planLevelAdjust derives HP from the post-change CON when abilities apply", () => {
  const withAbilities = planLevelAdjust(ogre(), 8, { applyAbilities: true });
  const withoutAbilities = planLevelAdjust(ogre(), 8, { applyAbilities: false });

  assert.equal(withAbilities.nextHp, hpForLevel(8, withAbilities.nextAbilities.con));
  assert.equal(withoutAbilities.nextHp, hpForLevel(8, 3), "unchecked abilities means the original CON");
  assert.notEqual(
    withAbilities.nextHp,
    withoutAbilities.nextHp,
    "the HP row must react to the abilities checkbox",
  );
});

test("planLevelAdjust shifts abilities uniformly and clamps into the level band", () => {
  const plan = planLevelAdjust(ogre(), 8);
  const band = plan.guideline.statMod;

  for (const [key, value] of Object.entries(plan.nextAbilities)) {
    assert.ok(
      value >= band.low && value <= band.high,
      `${key} ${value} is inside the L8 band [${band.low}, ${band.high}]`,
    );
  }
  // Uniform delta preserves the ogre's shape: STR stays the highest.
  const best = Object.entries(plan.nextAbilities).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(best, "str", "a brute stays a brute");
});

test("planLevelAdjust seeds a flat ability spread from the level's typical mod", () => {
  // A fresh Creator draft sits at all-zero mods. Shifting by the level delta
  // would be a no-op when target === current level, leaving the ability toggle
  // permanently dead — so a shapeless spread adopts the median instead.
  const fresh = { level: 5, ac: 10, hp: { max: 1 }, abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, attacks: [] };
  const plan = planLevelAdjust(fresh, 5);
  const median = guidelineFor(5).statMod.median;

  for (const value of Object.values(plan.nextAbilities)) assert.equal(value, median);
  assert.ok(plan.rows.some(r => r.group === "abilities" && r.changed), "the ability rows report a change");
});

test("planLevelAdjust leaves an already-typical flat spread alone", () => {
  const median = guidelineFor(5).statMod.median;
  const flat = Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, median]));
  const plan = planLevelAdjust({ level: 5, ac: 10, hp: { max: 1 }, abilities: flat, attacks: [] }, 5);
  assert.equal(plan.abilityDelta, 0);
  for (const value of Object.values(plan.nextAbilities)) assert.equal(value, median);
});

test("planLevelAdjust still shifts a shaped spread rather than flattening it", () => {
  const plan = planLevelAdjust(ogre(), 8);
  const values = Object.values(plan.nextAbilities);
  assert.ok(new Set(values).size > 1, "a creature with a stat shape keeps it");
});

test("planLevelAdjust is idempotent once a creature is on-guideline", () => {
  const g = guidelineFor(8);
  const onGuideline = {
    level: 8,
    ac: g.ac,
    hp: { value: hpForLevel(8, g.statMod.median), max: hpForLevel(8, g.statMod.median) },
    abilities: { str: g.statMod.median, dex: g.statMod.median, con: g.statMod.median,
                 int: g.statMod.median, wis: g.statMod.median, cha: g.statMod.median },
    attacks: [{ id: "a", name: "Claw", num: g.atk.num, bonus: g.atk.bonus, damage: g.atk.damage }],
  };

  const plan = planLevelAdjust(onGuideline, 8);
  assert.equal(plan.changed, false, "nothing left to change");
  assert.equal(plan.rows.filter(r => r.changed).length, 0);
  assert.equal(plan.attacks.filter(a => a.changed).length, 0);
});

test("planLevelAdjust rewrites every NPC attack onto the guideline", () => {
  const plan = planLevelAdjust(ogre(), 8);
  const [atk] = plan.attacks;
  const g = guidelineFor(8);

  assert.equal(atk.name, "Greatclub");
  assert.equal(atk.num.to, g.atk.num);
  assert.equal(atk.bonus.to, g.atk.bonus);
  assert.equal(atk.damage.to, g.atk.damage);
  assert.equal(atk.damage.from, "2d6");
});

test("planLevelAdjust survives a creature with no attacks or abilities", () => {
  const plan = planLevelAdjust({ level: 1 }, 3);
  assert.equal(plan.attacks.length, 0);
  assert.equal(Object.keys(plan.nextAbilities).length, 6);
  assert.ok(Number.isFinite(plan.nextHp));
});

// ─── deriveFromActors — the recalculate path ──────────────────────────────

function fakeActor(level, { ac, hp, mod, num, bonus, damage }) {
  return {
    system: {
      level: { value: level },
      attributes: { ac: { value: ac }, hp: { max: hp } },
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { mod }])),
    },
    items: [{ type: "NPC Attack", system: { attack: { num }, bonuses: { attackBonus: bonus }, damage: { value: damage } } }],
  };
}

test("deriveFromActors reproduces medians from a fixture", () => {
  const actors = [
    fakeActor(1, { ac: 12, hp: 4, mod: 0, num: 1, bonus: 1, damage: "1d4" }),
    fakeActor(1, { ac: 12, hp: 4, mod: 0, num: 1, bonus: 1, damage: "1d4" }),
    fakeActor(1, { ac: 12, hp: 4, mod: 0, num: 1, bonus: 1, damage: "1d4" }),
    fakeActor(5, { ac: 15, hp: 24, mod: 2, num: 2, bonus: 4, damage: "1d8" }),
    fakeActor(5, { ac: 15, hp: 24, mod: 2, num: 2, bonus: 4, damage: "1d8" }),
    fakeActor(5, { ac: 15, hp: 24, mod: 2, num: 2, bonus: 4, damage: "1d8" }),
  ];
  const table = deriveFromActors(actors);

  assert.deepEqual(Object.keys(table).sort(), ["1", "5"]);
  assert.equal(table["1"].ac, 12);
  assert.equal(table["1"].hp, 4);
  assert.equal(table["5"].ac, 15);
  assert.equal(table["5"].atk.bonus, 4);
  assert.equal(table["5"].atk.damage, "1d8");
  assert.equal(table["5"].statMod.median, 2);
});

test("deriveFromActors will not let a sparse level outrank a well-sampled one", () => {
  // One lone level-9 weakling against thirty level-8 monsters: the isotonic
  // fit must not emit an L9 AC below L8's.
  const actors = [
    ...Array.from({ length: 30 }, () => fakeActor(8, { ac: 16, hp: 38, mod: 2, num: 2, bonus: 6, damage: "1d10" })),
    fakeActor(9, { ac: 8, hp: 43, mod: 2, num: 1, bonus: 1, damage: "1d4" }),
  ];
  const table = deriveFromActors(actors);
  assert.ok(table["9"].ac >= table["8"].ac, `L9 AC ${table["9"].ac} >= L8 AC ${table["8"].ac}`);
  assert.ok(table["9"].atk.bonus >= table["8"].atk.bonus);
});

test("deriveFromActors falls back to the shipped table when given nothing", () => {
  assert.deepEqual(deriveFromActors([]), JSON.parse(JSON.stringify(BASE_GUIDELINES)));
  assert.deepEqual(deriveFromActors([{ system: {} }]), JSON.parse(JSON.stringify(BASE_GUIDELINES)));
});

// ─── parseGuidelinesJSON — import validation ──────────────────────────────

function validRow() {
  return {
    ac: 13,
    hp: 24,
    atk: { num: 2, bonus: 4, damage: "1d8" },
    statMod: { median: 1, low: -3, high: 3 },
    talentDC: 12,
  };
}

test("parseGuidelinesJSON accepts a well-formed table", () => {
  const result = parseGuidelinesJSON(JSON.stringify({ 5: validRow() }));
  assert.equal(result.ok, true);
  assert.equal(result.table["5"].ac, 13);
  assert.equal(result.table["5"].level, 5);
});

test("parseGuidelinesJSON round-trips the shipped defaults", () => {
  const result = parseGuidelinesJSON(JSON.stringify(BASE_GUIDELINES));
  assert.equal(result.ok, true, result.error);
  assert.equal(Object.keys(result.table).length, Object.keys(BASE_GUIDELINES).length);
});

test("parseGuidelinesJSON rejects malformed input", () => {
  const bad = (label, payload) => {
    const result = typeof payload === "string" ? parseGuidelinesJSON(payload) : parseGuidelinesJSON(JSON.stringify(payload));
    assert.equal(result.ok, false, `${label} should be rejected`);
    assert.ok(result.error.length, `${label} should explain why`);
  };

  bad("not JSON", "{nope");
  bad("an array", [validRow()]);
  bad("a non-numeric level key", { fifth: validRow() });
  bad("a missing atk block", { 5: { ...validRow(), atk: undefined } });
  bad("a non-finite value", { 5: { ...validRow(), ac: "high" } });
  bad("a malformed damage string", { 5: { ...validRow(), atk: { num: 2, bonus: 4, damage: "a bunch" } } });
  bad("an inverted stat band", { 5: { ...validRow(), statMod: { median: 1, low: 5, high: -5 } } });
  bad("an empty object", {});
});

// ─── numeric helpers ──────────────────────────────────────────────────────

test("averageDamage handles dice, plain numbers, and junk", () => {
  assert.equal(averageDamage("2d6"), 7);
  assert.equal(averageDamage("1d8"), 4.5);
  assert.equal(averageDamage("1"), 1);
  assert.equal(averageDamage(""), 0);
  assert.equal(averageDamage(null), 0);
});

test("isotonic regression returns the nearest non-decreasing sequence", () => {
  const { _isotonic } = _internals;
  const out = _isotonic([3, 1, 2], [1, 1, 1]);
  for (let i = 1; i < out.length; i++) assert.ok(out[i] >= out[i - 1]);
  assert.equal(out.reduce((a, b) => a + b, 0), 6, "pooling preserves the total");

  const already = _isotonic([1, 2, 3], [1, 1, 1]);
  assert.deepEqual(already, [1, 2, 3], "an ordered input is left alone");
});
