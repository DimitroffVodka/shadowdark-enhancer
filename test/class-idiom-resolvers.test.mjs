/**
 * G6a — pure class idiom and legal-choice policy.
 *
 * These fixtures intentionally use invented names and metadata. They prove
 * that the production seam follows class/talent/effect data, not a lookup of
 * familiar class names or a live client runtime.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ABILITY_ORDER,
  CHOICE_SPECS,
  UNSUPPORTED_CODES,
  _classPermits,
  buildClassPermits,
  choiceSpecFor,
  choiceSpecForDocument,
  choosableEffects,
  deriveClassIdiom,
  resolveAbilityScores,
  resolveChoice,
  resolveChoosableEffects,
  resolveClassChoices,
  resolveDeity,
  resolveLoadout,
  resolvePlusTwoChoice,
  resolvePatron,
  resolveArmorChoice,
  resolveSpellcastingAdvantage,
  resolveSpellSelection,
  resolveTalentChoice,
  resolveWeaponChoice,
  talentRollCount,
} from "../scripts/forge-loot/class-idiom.mjs";

const effect = (key, value = "") => ({ changes: [{ key, value }] });
const weapon = (name, type, die, extra = {}) => ({
  uuid: `Compendium.test.weapons.${name.toLowerCase().replace(/\s+/g, "-")}`,
  name, type: "Weapon", system: {
    type, damage: { oneHanded: die, twoHanded: "" }, cost: { gp: 1, sp: 0, cp: 0 },
    slots: { slots_used: 1 }, ...extra,
  },
});
const armor = (name, ac, extra = {}) => ({
  uuid: `Compendium.test.armor.${name.toLowerCase().replace(/\s+/g, "-")}`,
  name, type: "Armor", system: { ac: { base: ac }, cost: { gp: 1, sp: 0, cp: 0 }, slots: { slots_used: 1 }, ...extra },
});
const spell = (name, tier, duration, range = "near", extra = {}) => ({
  uuid: `Compendium.test.spells.${name.toLowerCase().replace(/\s+/g, "-")}`,
  name, type: "Spell", tier, system: { tier, duration: { type: duration, value: 0 }, range, ...extra },
});

const CASTING_CLASS = {
  name: "Metadata Vessel",
  type: "Class",
  system: {
    hitPoints: "d8",
    spellcasting: { ability: "int", class: "Compendium.test.classes.vessel" },
    allMeleeWeapons: true,
    armor: ["Compendium.test.armor.leather"],
    classTalentTable: { rows: [{ range: [2, 2], options: ["+2 to Strength, Dexterity, or Constitution"] }] },
  },
};

const EFFECT_DOCS = [
  { uuid: "Item.talent-one", name: "Quiet Calculation", type: "Talent", effects: [effect("system.roll.spell.bonus", "@abilities.int.mod")] },
  { uuid: "Item.talent-two", name: "Watchful Ward", type: "Talent", effects: [effect("system.attributes.ac.unarmored", "max(0,@abilities.wis.mod)")] },
];

function assertDecision(value) {
  assert.deepEqual(Object.keys(value).sort(), ["fallbackUsed", "signals", "value"]);
  assert.equal(typeof value.fallbackUsed, "boolean");
  assert.ok(Array.isArray(value.signals));
}

function assertUnsupported(value, code) {
  assert.deepEqual(Object.keys(value), ["unsupported"]);
  assert.equal(value.unsupported.code, code);
  assert.ok(value.unsupported.evidence);
}

test("the pure seam has no live-client dependency, class-name branch, or private PRNG", () => {
  const source = readFileSync(new URL("../scripts/forge-loot/class-idiom.mjs", import.meta.url), "utf8");
  for (const token of ["game.", "foundry.", "fromUuid", "shadowdark.", "Math.random", "hashSeed"]) {
    assert.equal(source.includes(token), false, `production seam must not use ${token}`);
  }
  assert.deepEqual(ABILITY_ORDER, ["str", "dex", "con", "int", "wis", "cha"]);
  assert.deepEqual(UNSUPPORTED_CODES, ["no-matching-spec", "empty-option-set", "missing-metadata"]);
});

test("deriveClassIdiom follows casting, effects, rows, gear, hit die, and CON floor", () => {
  const idiom = deriveClassIdiom(CASTING_CLASS, { talents: EFFECT_DOCS, rows: CASTING_CLASS.system.classTalentTable.rows });
  assert.equal(idiom.priority[0], "int", "casting ability remains the strongest signal");
  assert.ok(idiom.weights.wis > 0, "formula ability reference contributes");
  assert.ok(idiom.weights.str > idiom.weights.dex, "melee breadth contributes STR");
  assert.ok(idiom.weights.con > 0, "armor/hit-die/floor contribute CON");
  assert.ok(idiom.signals.some((s) => s.source === "spellcasting.ability" && s.ability === "int"));
  assert.ok(idiom.signals.some((s) => s.source === "talent.effect" && s.ability === "wis"));
  assert.ok(idiom.signals.some((s) => s.source === "stat-choice" && s.ability === "dex"));
  assert.equal(idiom.attackMode, "melee");
  assert.equal(idiom.frontline, true);
});

test("an unusual imported class is controlled by its metadata, not its name", () => {
  const unusual = {
    name: "Bog Lantern Cartographer",
    type: "Class",
    system: { hitPoints: "d6", allRangedWeapons: true, spellcasting: { ability: "", class: "__not_spellcaster__" } },
  };
  const idiom = deriveClassIdiom(unusual, [
    { name: "Mire Sense", type: "Talent", effects: [effect("system.roll.skill", "@abilities.cha.mod")] },
  ]);
  assert.equal(idiom.priority[0], "cha");
  assert.equal(idiom.attackMode, "ranged");
  assert.notEqual(idiom.priority[0], "str", "the production function never uses the display name");
});

test("idiom-thin classes retain all abilities and expose only the CON floor signal", () => {
  const idiom = deriveClassIdiom({ name: "Blank Metadata", system: { hitPoints: "d6" } }, []);
  assert.equal(idiom.idiomThin, true);
  assert.deepEqual(idiom.priority, ["con", "str", "dex", "int", "wis", "cha"], "the CON floor is intentionally visible");
  assert.deepEqual(idiom.signals.map((s) => s.source), ["constitution-floor"]);
});

test("assign and fixed stat methods are both deterministic decisions", () => {
  const idiom = { priority: ["wis", "int", "con", "str", "dex", "cha"], weights: { wis: 5, int: 4 } };
  const assigned = resolveAbilityScores({ scores: [10, 16, 12, 15, 9, 13], method: "4d6h3-assign", idiom });
  assertDecision(assigned);
  assert.deepEqual(assigned.value, { str: 12, dex: 10, con: 13, int: 15, wis: 16, cha: 9 });
  assert.deepEqual(assigned.signals[0].assignment, { str: 2, dex: 0, con: 5, int: 3, wis: 1, cha: 4 });
  const fixed = resolveAbilityScores({ scores: [10, 16, 12, 15, 9, 13], method: "3d6-down", idiom });
  assertDecision(fixed);
  assert.deepEqual(fixed.value, { str: 10, dex: 16, con: 12, int: 15, wis: 9, cha: 13 });
});

test("+2 selection prefers idiom priority and spills after the cap", () => {
  const idiom = { priority: ["wis", "con", "str", "dex", "int", "cha"] };
  const choice = resolvePlusTwoChoice({
    offered: ["+2 to Strength", "+2 to Constitution", "+2 to Wisdom"],
    amount: 3, current: { wis: 17, con: 18, str: 10 }, cap: 18, idiom,
  });
  assertDecision(choice);
  assert.equal(choice.value, "wis");
  assert.deepEqual(choice.signals[0].allocation, { str: 2, dex: 0, con: 0, int: 0, wis: 1, cha: 0 });
  assert.equal(choice.signals[0].spent, 3);
  assert.equal(choice.fallbackUsed, false);
  const fallback = resolvePlusTwoChoice({ amount: 2, current: {}, idiom });
  assertDecision(fallback);
  assert.equal(fallback.value, "wis");
  assert.deepEqual(fallback.signals[0].offered, ABILITY_ORDER);
  assert.equal(fallback.fallbackUsed, true);
  const oneRow = resolvePlusTwoChoice("+2 to Strength, Dexterity, or Constitution", idiom, { str: 10, dex: 10, con: 10 });
  assert.deepEqual(oneRow.signals[0].offered, ["str", "dex", "con"]);
  assert.equal(oneRow.value, "con");
});

test("talent choices score affected abilities/attack mode and fall back to table order", () => {
  const idiom = { priority: ["dex", "con", "str", "wis", "int", "cha"], weights: { dex: 8, con: 3 }, attackMode: "ranged" };
  const options = [
    { name: "First", type: "Talent", effects: [effect("system.roll.melee.bonus.REPLACEME", "1")] },
    { name: "Second", type: "Talent", effects: [effect("system.roll.ranged.bonus.REPLACEME", "1"), effect("x", "@abilities.dex.mod")] },
    { name: "Illegal", legal: false, effects: [effect("x", "@abilities.dex.mod")] },
  ];
  const selected = resolveTalentChoice({ options, idiom });
  assertDecision(selected);
  assert.equal(selected.value.name, "Second");
  assert.equal(selected.fallbackUsed, false);
  const plain = resolveTalentChoice({ options: [{ name: "Book First" }, { name: "Book Second" }], idiom });
  assert.equal(plain.value.name, "Book First");
  assert.equal(plain.fallbackUsed, true);
});

test("choice specs, talent roll wording, and every REPLACEME effect stay pure", () => {
  assert.equal(CHOICE_SPECS.length, 3);
  assert.equal(choiceSpecFor("weapon mastery").key, "weapon");
  assert.equal(choiceSpecFor("Armor Mastery").key, "armor");
  assert.equal(choiceSpecFor("Spellcasting Advantage on Spell").key, "spell");
  assert.equal(choiceSpecFor("Unknown Choice"), null);
  assert.equal(talentRollCount({ name: "Gain Two Corruption Talents", system: { description: "roll" } }), 2);
  assert.equal(talentRollCount({ name: "Gain 2 Corruption Talents", system: {} }), 2);
  assert.equal(talentRollCount({ name: "Gain twofold talents", system: {} }), 1);
  const document = { effects: [
    { name: "Weapon Mastery", ...effect("foo.REPLACEME") },
    { name: "Armor Mastery", ...effect("bar.REPLACEME") },
  ] };
  assert.equal(choosableEffects(document).length, 2);
  assert.equal(choiceSpecForDocument(document).key, "weapon");
  const all = resolveChoosableEffects(document, {
    weaponOptions: [weapon("Knife", "melee", "d6")],
    armorOptions: [armor("Leather", 11)],
  });
  assertDecision(all);
  assert.equal(all.value.length, 2);
  assert.equal(all.value[0].result.value.name, "Knife");
  assert.equal(all.value[1].result.value.name, "Leather");
});

test("unknown REPLACEME families are explicit unsupported results", () => {
  const unknown = { effects: [{ name: "Future Choice", ...effect("future.REPLACEME") }] };
  const all = resolveChoosableEffects(unknown, {});
  assertDecision(all);
  assert.deepEqual(all.value[0].result.unsupported.code, "no-matching-spec");
  assertUnsupported(resolveChoice("Future Choice"), "no-matching-spec");
  assertUnsupported(resolveAbilityScores({}), "missing-metadata");
  assertUnsupported(resolveWeaponChoice({ options: [] }), "empty-option-set");
});

test("class legality matches all four flags, UUID, slug, base identity, and basics", () => {
  const classItem = { system: {
    weapons: ["Compendium.test.weapons.short-sword"],
    armor: ["Compendium.test.armor.leather"],
  } };
  const permits = buildClassPermits(classItem);
  const exact = weapon("Short Sword", "melee", "d6");
  exact.uuid = "Compendium.test.weapons.short-sword";
  const base = weapon("Forged Blade", "melee", "d8", { baseWeapon: "short-sword" });
  const forbidden = weapon("Longbow", "ranged", "d8");
  assert.equal(_classPermits(exact, permits), true);
  assert.equal(_classPermits(base, permits), true);
  assert.equal(_classPermits(forbidden, permits), false);
  assert.equal(_classPermits({ type: "Basic", name: "Rope", system: {} }, permits), true);
  assert.equal(_classPermits(forbidden, { ...permits, classItem: { system: { allWeapons: true } } }), true);
  assert.equal(_classPermits(forbidden, { ...permits, classItem: { system: { allRangedWeapons: true } } }), true);
  assert.equal(_classPermits(exact, { ...permits, classItem: { system: { allMeleeWeapons: true } } }), true);
  assert.equal(_classPermits(armor("Plate", 18), { ...permits, classItem: { system: { allArmor: true } } }), true);
});

test("weapon mastery intersects legality, prefers mode/damage, and has an unsupported empty result", () => {
  const classItem = { system: { weapons: ["Compendium.test.weapons.short-sword", "Compendium.test.weapons.longbow"] } };
  const options = [
    weapon("Short Sword", "melee", "d8", { baseWeapon: "short-sword" }),
    weapon("Longbow", "ranged", "d10", { baseWeapon: "longbow" }),
    weapon("Forbidden Axe", "melee", "d12"),
  ];
  const ranged = resolveWeaponChoice({ options, classItem, idiom: { attackMode: "ranged" } });
  assertDecision(ranged);
  assert.equal(ranged.value.name, "Longbow");
  const empty = resolveWeaponChoice({ options, classItem, idiom: { attackMode: "ranged" }, permits: {
    wUuids: new Set(), wSlugs: new Set(), aUuids: new Set(), aSlugs: new Set(),
  } });
  assertUnsupported(empty, "empty-option-set");
});

test("armor mastery chooses highest legal AC with stable alphabetical ties", () => {
  const classItem = { system: { armor: ["Compendium.test.armor.leather", "Compendium.test.armor.chain"] } };
  const options = [armor("Leather", 11, { baseArmor: "leather" }), armor("Chain", 14, { baseArmor: "chain" }), armor("Plate", 18)];
  const selected = resolveArmorChoice({ options, classItem });
  assertDecision(selected);
  assert.equal(selected.value.name, "Chain");
  assert.equal(selected.signals[0].armorClass, 14);
});

test("spellcasting advantage prefers known high-tier and falls back deterministically", () => {
  const options = [spell("Low", 1, "focus"), spell("Known High", 3, "instant"), spell("Unknown High", 4, "instant")];
  const known = resolveSpellcastingAdvantage({ options, knownSpells: [options[1]] });
  assertDecision(known);
  assert.equal(known.value.name, "Known High");
  assert.equal(known.fallbackUsed, false);
  const fallback = resolveSpellcastingAdvantage({ options, knownSpells: [] });
  assert.equal(fallback.value.name, "Unknown High");
  assert.equal(fallback.fallbackUsed, true);
});

test("spell selection fills every tier quota in deterministic metadata order", () => {
  const options = [
    spell("Instant Near", 1, "instant", "near"),
    spell("Focus Close", 1, "focus", "close"),
    spell("Focus Far", 1, "focus", "far"),
    spell("Tier Two", 2, "instant", "near"),
  ];
  const selected = resolveSpellSelection({ spells: options, quotas: { 1: 2, 2: 1 } });
  assertDecision(selected);
  assert.deepEqual(selected.value.map((s) => s.name), ["Tier Two", "Focus Far", "Focus Close"]);
  assert.deepEqual(selected.signals[0].unmet, []);
  const short = resolveSpellSelection({ spells: options, quotas: { 1: 4 } });
  assert.equal(short.fallbackUsed, true);
  assert.deepEqual(short.signals[0].unmet, [{ tier: 1, requested: 4, available: 3 }]);
  assertUnsupported(resolveSpellSelection({ spells: options, quotas: {} }), "missing-metadata");
});

test("patron and deity use injected rng, while a pinned deity wins", () => {
  const patrons = [{ name: "Amber" }, { name: "Beryl" }, { name: "Cinder" }];
  const one = resolvePatron({ patrons, rng: () => 0.75 });
  const two = resolvePatron({ patrons: [...patrons].reverse(), rng: () => 0.75 });
  assertDecision(one);
  assert.equal(one.value.name, two.value.name, "source ordering does not change injected-rng result");
  assert.equal(one.value.name, "Cinder");
  const deities = [{ uuid: "deity-law", name: "Law", system: { alignment: "lawful" } },
    { uuid: "deity-neu", name: "Neutral", system: { alignment: "neutral" } }];
  const matching = resolveDeity({ deities, alignment: "neutral", rng: () => 0 });
  assert.equal(matching.value.uuid, "deity-neu");
  const pinned = resolveDeity({ deities, alignment: "lawful", fixedDeity: "deity-neu", rng: () => 0 });
  assert.equal(pinned.value.uuid, "deity-neu");
  assert.equal(pinned.signals[0].pinned, true);
  const noRng = resolvePatron({ patrons });
  assert.equal(noRng.value.name, "Amber");
  assert.equal(noRng.fallbackUsed, true);
});

test("loadout embeds grants, buys only legal gear, and reports affordable fallbacks", () => {
  const classItem = { flags: { "shadowdark-enhancer": { grantedItems: ["grant-claw"] } }, system: {
    allArmor: true, allMeleeWeapons: true,
  } };
  const gear = [
    { uuid: "grant-claw", name: "Natural Claw", type: "Weapon", granted: true, system: { cost: { gp: 99 }, slots: { slots_used: 0 } } },
    armor("Plate", 18, { cost: { gp: 20 } }),
    armor("Leather", 11, { cost: { gp: 1 } }),
    weapon("Great Hammer", "melee", "d10", { cost: { gp: 2 } }),
    weapon("Longbow", "ranged", "d12", { cost: { gp: 1 } }),
    { uuid: "basic-rope", name: "Rope", type: "Basic", system: { cost: { gp: 1 }, slots: { slots_used: 1 } } },
  ];
  const loadout = resolveLoadout({ gear, classItem, idiom: { attackMode: "melee", frontline: true }, budgetCp: 500 });
  assertDecision(loadout);
  assert.deepEqual(loadout.signals[0].granted.map((item) => item.name), ["Natural Claw"]);
  assert.deepEqual(loadout.signals[0].purchased.map((item) => item.name), ["Leather", "Great Hammer"]);
  assert.equal(loadout.value.every((item) => item.granted || _classPermits(item, classItem)), true);
  const noBudget = resolveLoadout({ gear, classItem, idiom: { attackMode: "melee", frontline: true }, budgetCp: 0 });
  assert.equal(noBudget.signals[0].granted.length, 1);
  assert.equal(noBudget.signals[0].purchased.length, 0);
  assert.equal(noBudget.fallbackUsed, true);
  assertUnsupported(resolveLoadout({ gear: [] }), "empty-option-set");
});

test("same metadata and injected rng sequence produce byte-equivalent aggregate choices", () => {
  const config = {
    classItem: CASTING_CLASS,
    talentDocs: EFFECT_DOCS,
    scores: [18, 16, 14, 12, 10, 8],
    method: "4d6h3-assign",
    plusTwo: { offered: ["str", "con", "int"], amount: 2 },
    talentOptions: [{ name: "A", effects: [effect("x", "@abilities.int.mod")] }, { name: "B" }],
    weaponOptions: [weapon("Mace", "melee", "d6"), weapon("Bow", "ranged", "d8")],
    armorOptions: [armor("Hide", 12)],
    spellOptions: [spell("Glyph", 2, "focus")],
    knownSpells: [],
    spells: [spell("Glyph", 2, "focus")],
    quotas: { 2: 1 },
    patrons: [{ name: "A" }, { name: "B" }],
    deities: [{ name: "N", system: { alignment: "neutral" } }],
    alignment: "neutral",
    gear: [weapon("Mace", "melee", "d6")],
    budgetCp: 100,
  };
  const a = resolveClassChoices({ ...config, rng: () => 0.5 });
  const b = resolveClassChoices({ ...config, rng: () => 0.5 });
  assert.deepEqual(a, b);
  assert.equal(a.patron.value.name, "B");
});
