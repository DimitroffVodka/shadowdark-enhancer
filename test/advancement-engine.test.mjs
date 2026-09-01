import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ADVANCEMENT_FAILURE_CODES,
  ADVANCEMENT_STATUSES,
  ADVANCEMENT_WARNING_CODES,
  advanceMemberPlan,
} from "../scripts/forge-loot/advancement-engine.mjs";

const ROOT = new URL("../", import.meta.url);

const item = (sourceId, name, data = {}) => ({
  sourceId,
  data: { name, type: "Talent", system: {}, effects: [], ...data },
});

const spell = (sourceId, name, tier, data = {}) => ({
  sourceId,
  data: { name, type: "Spell", tier, system: { tier, duration: { type: "instant", value: 0 }, range: "near" }, ...data },
});

const classItem = ({ hitPoints = "1d6", caster = false, grid = null, ...system } = {}) => ({
  sourceId: "class:fixture",
  data: {
    name: "Fixture Class",
    type: "Class",
    system: {
      hitPoints,
      classTalentTable: "table:class",
      spellcasting: caster ? { class: "class:fixture", ability: "int", spellsknown: grid } : {
        class: "__not_spellcaster__", ability: "",
      },
      ...system,
    },
  },
});

const plan = ({ hp = 10, items = [], knownSpellIds = [], seenByTable = {} } = {}) => ({
  actorData: {
    name: "Fixture Member",
    type: "Player",
    system: { level: { value: 1 }, attributes: { hp: { max: hp, value: hp } } },
  },
  items,
  knownSpellIds,
  seenByTable,
});

const source = ({
  classData = classItem().data,
  classTalentTableId = "table:class",
  tables = {},
  items = [],
  spellPool = [],
  choicePools = {},
  idiom = { priority: ["int", "str", "dex", "con", "wis", "cha"], weights: {} },
} = {}) => ({
  classItem: classData,
  idiom,
  classTalentTableId,
  tablesById: tables,
  itemsById: Object.fromEntries(items.map((entry) => [entry.sourceId, entry])),
  spellPool,
  choicePools,
});

const table = (sourceId, formula, optionIds, { dedupe = false, rows = null } = {}) => ({
  sourceId,
  formula,
  rows: rows ?? [{ range: [1, 20], optionIds }],
  dedupe,
});

function sequence(values) {
  let index = 0;
  return () => values[index++] ?? 0;
}

function noncasterSource(options = {}) {
  return source({
    classData: classItem(options).data,
    tables: {
      "table:class": table("table:class", "1d2", ["talent:a", "talent:b"], {
        rows: [
          { range: [1, 1], optionIds: ["talent:a"] },
          { range: [2, 2], optionIds: ["talent:b"] },
        ],
      }),
    },
    items: [
      item("talent:a", "A", {
        effects: [{ changes: [{ key: "system.roll.hp.advantage", value: true }] }],
      }),
      item("talent:b", "B"),
    ],
  });
}

test("the advancement seam and vocabularies are explicit", async () => {
  assert.deepEqual(ADVANCEMENT_STATUSES, ["complete", "failed"]);
  assert.deepEqual(ADVANCEMENT_FAILURE_CODES, [
    "invalid-level-one-plan", "invalid-target-level", "invalid-roll-formula",
    "missing-source", "uncovered-roll", "unsupported-choice", "spell-quota-unmet",
  ]);
  assert.deepEqual(ADVANCEMENT_WARNING_CODES, [
    "resolver-fallback", "duplicate-reroll", "duplicate-cap", "recursion-cap",
  ]);
  const text = await readFile(new URL("scripts/forge-loot/advancement-engine.mjs", ROOT), "utf8");
  for (const forbidden of ["game", "foundry", "shadowdark", "Math.random", "createEmbeddedDocuments", "PRNG factory"]) {
    assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, `pure seam must not use ${forbidden}`);
  }
});

test("target one is a cloned no-op and never consumes the injected stream", () => {
  const levelOnePlan = plan({ items: [item("talent:l1", "Level One")] });
  const before = structuredClone(levelOnePlan);
  let calls = 0;
  const result = advanceMemberPlan({
    levelOnePlan,
    targetLevel: 1,
    source: noncasterSource(),
    rng: () => { calls++; return 0; },
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.actorData.items, before.items.map((entry) => entry.data));
  assert.deepEqual(result.history, []);
  assert.equal(calls, 0);
  assert.deepEqual(levelOnePlan, before);
});

test("levels two through six apply HP before talents and preserve source-ID identity", () => {
  const levelOnePlan = plan({ items: [item("talent:l1", "Same Name")] });
  const before = structuredClone(levelOnePlan);
  const result = advanceMemberPlan({
    levelOnePlan,
    targetLevel: 6,
    source: noncasterSource(),
    // L2 HP, L3 HP/table, L4 advantaged HP, L5 advantaged HP/table, L6 HP.
    rng: sequence([0, 0, 0, 0.99, 0, 0, 0.99, 0.99, 0, 0]),
  });
  assert.equal(result.status, "complete");
  assert.equal(result.actorData.system.level.value, 6);
  assert.deepEqual(result.actorData.system.attributes.hp, { max: 25, value: 25 });
  assert.deepEqual(result.history.map((entry) => entry.level), [2, 3, 4, 5, 6]);
  assert.deepEqual(result.history.map((entry) => entry.hp.rolls), [[1], [1], [6, 1], [1, 6], [1, 1]]);
  assert.deepEqual(result.history[1].talents.map((entry) => [entry.sourceId, entry.depth]), [["talent:a", 0]]);
  assert.deepEqual(result.history[3].talents.map((entry) => [entry.sourceId, entry.depth]), [["talent:b", 0]]);
  const gained = result.actorData.items.filter((entry) => entry.system.level > 1);
  assert.deepEqual(gained.map((entry) => [entry.name, entry.system.level]), [["A", 3], ["B", 5]]);
  assert.deepEqual(levelOnePlan, before);
});

test("caster spell deltas are cumulative and exclude already-known full IDs", () => {
  const grid = {
    1: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 },
    2: { 1: 2, 2: 0, 3: 0, 4: 0, 5: 0 },
    3: { 1: 2, 2: 1, 3: 0, 4: 0, 5: 0 },
  };
  const spells = [spell("spell:known", "Known", 1), spell("spell:new", "New", 1), spell("spell:tier2", "Tier Two", 2)];
  const result = advanceMemberPlan({
    levelOnePlan: plan({
      items: [item("talent:l1", "Level One"), spells[0]],
      knownSpellIds: ["spell:known"],
    }),
    targetLevel: 3,
    source: source({
      classData: classItem({ caster: true, grid }).data,
      tables: { "table:class": table("table:class", "1d1", ["talent:l3"]) },
      items: [item("talent:l3", "L3")],
      spellPool: spells,
    }),
    rng: sequence([0, 0, 0]),
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.history[0].spells, {
    requested: { 1: 1 }, selected: ["spell:new"], byTier: { 1: 1 },
  });
  assert.deepEqual(result.history[1].spells, {
    requested: { 2: 1 }, selected: ["spell:tier2"], byTier: { 2: 1 },
  });
  assert.deepEqual(result.actorData.items.filter((entry) => entry.type === "Spell").map((entry) => entry.name), ["Known", "New", "Tier Two"]);
});

test("an unmet spell quota fails with history and no committable actor data", () => {
  const grid = {
    1: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    2: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    3: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    4: { 1: 0, 2: 2, 3: 0, 4: 0, 5: 0 },
  };
  const result = advanceMemberPlan({
    levelOnePlan: plan(),
    targetLevel: 4,
    source: source({
      classData: classItem({ caster: true, grid }).data,
      tables: { "table:class": table("table:class", "1d1", ["talent:l3"]) },
      items: [item("talent:l3", "L3")],
      spellPool: [spell("spell:one", "Only One", 2)],
    }),
    rng: sequence([0, 0, 0]),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "spell-quota-unmet");
  assert.equal(result.level, 4);
  assert.equal(Object.hasOwn(result, "actorData"), false);
  assert.deepEqual(result.history.map((entry) => entry.level), [2, 3, 4]);
  assert.equal(result.history.at(-1).status, "failed");
  assert.deepEqual(result.history.at(-1).spells.selected, ["spell:one"]);
});

test("a dedupe collision gets exactly three attempts, then retains the duplicate", () => {
  const result = advanceMemberPlan({
    levelOnePlan: plan({ items: [item("talent:dup", "Duplicate")] , seenByTable: { "table:class": ["talent:dup"] } }),
    targetLevel: 3,
    source: source({
      tables: { "table:class": table("table:class", "1d1", ["talent:dup"], { dedupe: true }) },
      items: [item("talent:dup", "Duplicate")],
    }),
    rng: sequence([0, 0, 0, 0]),
  });
  assert.equal(result.status, "complete");
  const talent = result.history.at(-1).talents[0];
  assert.equal(talent.attempts.length, 3);
  assert.deepEqual(talent.attempts.map((attempt) => attempt.total), [1, 1, 1]);
  assert.deepEqual(result.warnings.map((warning) => warning.code).filter((code) => code !== "resolver-fallback"), [
    "duplicate-reroll", "duplicate-reroll", "duplicate-cap",
  ]);
  assert.equal(result.actorData.items.filter((entry) => entry.name === "Duplicate").length, 2);
});

test("depth four retains the selected Talent and suppresses only its further rolls", () => {
  const followup = (sourceId, next, name = sourceId) => item(sourceId, name, {
    followupTableId: next,
    system: { description: name === "deep final" ? "Gain Two Further Talents" : "Gain a Further Talent" },
  });
  const items = [
    item("talent:root", "root", { followupTableId: "table:1" }),
    followup("talent:1", "table:2", "first-depth"),
    followup("talent:2", "table:3", "second-depth"),
    followup("talent:3", "table:4", "third-depth"),
    followup("talent:4", "table:5", "deep final"),
    item("talent:5", "suppressed"),
  ];
  const tables = {
    "table:class": table("table:class", "1d1", ["talent:root"]),
    "table:1": table("table:1", "1d1", ["talent:1"]),
    "table:2": table("table:2", "1d1", ["talent:2"]),
    "table:3": table("table:3", "1d1", ["talent:3"]),
    "table:4": table("table:4", "1d1", ["talent:4"]),
    "table:5": table("table:5", "1d1", ["talent:5"]),
  };
  const result = advanceMemberPlan({
    levelOnePlan: plan(),
    targetLevel: 3,
    source: source({ tables, items }),
    rng: sequence([0, 0, 0, 0, 0, 0]),
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.history.at(-1).talents.map((entry) => [entry.sourceId, entry.depth]), [
    ["talent:root", 0], ["talent:1", 1], ["talent:2", 2], ["talent:3", 3], ["talent:4", 4],
  ]);
  assert.deepEqual(result.warnings.filter((warning) => warning.code === "recursion-cap").map((warning) => warning.suppressed), [2]);
  assert.equal(result.actorData.items.some((entry) => entry.name === "suppressed"), false);
});

test("every replacement effect is resolved, including multiple effects on one Talent", () => {
  const chosen = item("talent:choice", "Choice Talent", {
    effects: [
      { name: "Weapon Mastery", changes: [{ key: "system.roll.weapon.REPLACEME", value: 1 }] },
      { name: "Armor Mastery", system: { changes: [{ key: "system.roll.armor.REPLACEME", value: 1 }] } },
    ],
  });
  const result = advanceMemberPlan({
    levelOnePlan: plan(),
    targetLevel: 3,
    source: source({
      classData: classItem({ allWeapons: true, allArmor: true }).data,
      tables: { "table:class": table("table:class", "1d1", ["talent:choice"]) },
      items: [chosen],
      choicePools: {
        weapon: [item("weapon:sword", "Sword", { type: "Weapon", system: { type: "melee", damage: { oneHanded: "d8" } } })],
        armor: [item("armor:chain", "Chain Mail", { type: "Armor", system: { ac: { base: 14 } } })],
      },
    }),
    rng: sequence([0, 0]),
  });
  assert.equal(result.status, "complete");
  const effects = result.actorData.items.at(-1).effects;
  assert.equal(JSON.stringify(effects).includes("REPLACEME"), false);
  assert.equal(effects[0].changes[0].key, "system.roll.weapon.sword");
  assert.equal(effects[1].system.changes[0].key, "system.roll.armor.chain-mail");
});

test("a nested unsupported choice is preserved in diagnostics and prevents actor output", () => {
  const unresolved = item("talent:unsupported", "Unsupported", {
    effects: [{ name: "Future Choice", changes: [{ key: "system.future.REPLACEME", value: 1 }] }],
  });
  const result = advanceMemberPlan({
    levelOnePlan: plan(),
    targetLevel: 3,
    source: source({
      tables: { "table:class": table("table:class", "1d1", ["talent:unsupported"]) },
      items: [unresolved],
    }),
    rng: sequence([0, 0]),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "unsupported-choice");
  assert.equal(result.evidence.unsupported.code, "no-matching-spec");
  assert.equal(Object.hasOwn(result, "actorData"), false);
});

test("invalid formulas, uncovered ranges, missing tables, and targets are tagged", () => {
  const base = { levelOnePlan: plan(), targetLevel: 2, rng: sequence([0]) };
  const invalid = advanceMemberPlan({
    ...base,
    source: source({ classData: classItem({ hitPoints: "1d6+1" }).data }),
  });
  assert.equal(invalid.code, "invalid-roll-formula");

  const uncovered = advanceMemberPlan({
    levelOnePlan: plan(),
    targetLevel: 3,
    source: source({ tables: { "table:class": table("table:class", "1d1", ["talent:a"], { rows: [{ range: [2, 2], optionIds: ["talent:a"] }] }) }, items: [item("talent:a", "A")] }),
    rng: sequence([0, 0]),
  });
  assert.equal(uncovered.code, "uncovered-roll");

  const missing = advanceMemberPlan({
    levelOnePlan: plan(),
    targetLevel: 3,
    source: source({ classTalentTableId: null }),
    rng: sequence([0, 0]),
  });
  assert.equal(missing.code, "missing-source");

  const target = advanceMemberPlan({ levelOnePlan: plan(), targetLevel: 7, source: noncasterSource(), rng: sequence([]) });
  assert.equal(target.code, "invalid-target-level");
});

test("overlapping logical rows fail closed while one normalized choice row remains valid", () => {
  const overlap = advanceMemberPlan({
    levelOnePlan: plan(),
    targetLevel: 3,
    source: source({
      tables: {
        "table:class": table("table:class", "1d1", ["talent:a"], {
          rows: [
            { range: [1, 1], optionIds: ["talent:a"] },
            { range: [1, 1], optionIds: ["talent:b"] },
          ],
        }),
      },
      items: [item("talent:a", "A"), item("talent:b", "B")],
    }),
    rng: sequence([0, 0]),
  });
  assert.equal(overlap.status, "failed");
  assert.equal(overlap.code, "uncovered-roll");
  assert.equal(Object.hasOwn(overlap, "actorData"), false);
  assert.equal(overlap.evidence.reason, "overlapping-rows");
  assert.deepEqual(overlap.evidence.rows, [
    { rowIndex: 0, range: [1, 1] },
    { rowIndex: 1, range: [1, 1] },
  ]);

  const choice = advanceMemberPlan({
    levelOnePlan: plan(),
    targetLevel: 3,
    source: source({
      tables: {
        "table:class": table("table:class", "1d1", ["talent:a", "talent:b"], {
          rows: [{ range: [1, 1], optionIds: ["talent:a", "talent:b"] }],
        }),
      },
      items: [item("talent:a", "A"), item("talent:b", "B")],
    }),
    rng: sequence([0, 0]),
  });
  assert.equal(choice.status, "complete");
  assert.equal(choice.history.at(-1).talents.length, 1);
  assert.equal(Object.hasOwn(choice, "actorData"), true);
});

test("the same input and stream produce byte-equivalent output", () => {
  const make = () => advanceMemberPlan({
    levelOnePlan: plan(),
    targetLevel: 3,
    source: noncasterSource(),
    rng: sequence([0, 0, 0]),
  });
  assert.equal(JSON.stringify(make()), JSON.stringify(make()));
});
