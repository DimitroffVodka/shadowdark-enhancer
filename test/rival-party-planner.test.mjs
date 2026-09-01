import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  assembleMemberPlan,
  pickStrict,
  planRivalParty,
  preflightParty,
  projectTableRows,
} from "../scripts/forge-loot/rival-party-planner.mjs";

test("strict supporting-table consumption preserves document rows and refuses unusable roll geometry", () => {
  const projection = projectTableRows({
    ready: true,
    manifestId: "core-random-ancestry",
    table: {
      uuid: "Compendium.shadowdark.rollable-tables.RollTable.ancestry",
      formula: "1d6",
      results: [
        {
          _id: "human",
          range: [1, 4],
          name: "Human",
          type: "document",
          weight: 3,
          documentUuid: "Compendium.shadowdark.ancestries.Item.human",
        },
      ],
    },
  });

  assert.deepEqual(projection.rows[0], {
    id: "human",
    name: "Human",
    type: "document",
    weight: 3,
    range: [1, 4],
    documentUuid: "Compendium.shadowdark.ancestries.Item.human",
  });

  assert.throws(
    () => pickStrict(projection, () => 0.99, { role: "ancestry" }),
    (error) => error.code === "party-uncovered-roll" && error.role === "ancestry" && error.roll === 6,
  );

  const canonical = projectTableRows({
    formula: "1d2",
    results: [{
      _id: "elf",
      name: "Elf",
      type: "document",
      range: [1, 2],
      _source: { documentUuid: "Compendium.shadowdark.ancestries.Item.elf" },
    }],
  });
  assert.equal(
    canonical.rows[0].documentUuid,
    "Compendium.shadowdark.ancestries.Item.elf",
    "a table row UUID is preserved from its canonical TableResult source",
  );
  assert.equal(projectTableRows({
    formula: "1d2",
    results: [{
      name: "Elf",
      range: [1, 2],
      documentUuid: "   ",
      _source: { documentUuid: "Compendium.shadowdark.ancestries.Item.elf" },
    }],
  }).rows[0].documentUuid, "Compendium.shadowdark.ancestries.Item.elf");

  for (const range of [[4, 1], [0, 1], [1, 7], [1.5, 2]]) {
    assert.throws(
      () => pickStrict({ ...projection, rows: [{ ...projection.rows[0], range }] }, () => 0, { role: "ancestry" }),
      (error) => error.code === "party-row-range-invalid" && error.role === "ancestry",
      `range ${range.join("-")} must be refused`,
    );
  }

  assert.throws(
    () => pickStrict({
      ...projection,
      rows: [
        { ...projection.rows[0], id: "one", range: [1, 4] },
        { ...projection.rows[0], id: "two", range: [4, 6] },
      ],
    }, () => 0.51, { role: "ancestry" }),
    (error) => error.code === "party-ambiguous-roll" && error.role === "ancestry" && error.roll === 4,
  );
});

test("party preflight requires both reported sources and preserves the G3 report for the GM", () => {
  const fighter = {
    classId: "Compendium.shadowdark.classes.Item.fighter",
    name: "Fighter",
    source: "core",
    eligible: true,
    blockers: [],
    warnings: [],
  };
  const healthy = {
    version: 1,
    classes: [fighter],
    eligible: [fighter],
    excluded: [],
    sources: [
      { source: "core", present: true, classCount: 1, error: null },
      { source: "importer-managed", present: true, classCount: 0, error: null },
    ],
  };

  assert.deepEqual(preflightParty(healthy), { ok: true, winners: [fighter] });

  const absent = structuredClone(healthy);
  absent.sources.splice(1, 1);
  const missing = preflightParty(absent);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "party-source-health-invalid");
  assert.equal(missing.role, "importer-managed");
  assert.match(missing.message, /importer-managed/i);
  assert.deepEqual(missing.report, absent);
  assert.notEqual(missing.report, absent);

  const errored = structuredClone(healthy);
  errored.sources[0].error = "pack read failed";
  assert.equal(preflightParty(errored).role, "core");

  const empty = structuredClone(healthy);
  empty.classes = [];
  empty.eligible = [];
  const refused = preflightParty(empty);
  assert.equal(refused.code, "party-no-eligible-classes");
  assert.match(refused.message, /eligible class/i);
  assert.deepEqual(refused.report, empty);
});

function item(sourceId, name, data = {}) {
  return {
    sourceId,
    data: { name, type: "Talent", system: {}, effects: [], ...data },
  };
}

function memberSourceSnapshot() {
  const mastery = item("talent:mastery", "Weapon Mastery", {
    effects: [{
      name: "Weapon Mastery",
      changes: [{ key: "system.roll.meleeWeaponDamage.REPLACEME", value: 1 }],
    }],
  });
  const training = item("talent:training", "Battle Training");
  const mace = item("weapon:mace", "Mace", {
    type: "Weapon",
    system: {
      damage: { oneHanded: "d6" },
      range: "melee",
      cost: { gp: 5, sp: 0, cp: 0 },
      slots: { slots_used: 1, per_slot: 1, free_carry: 0 },
    },
  });
  const classData = {
    name: "Fixture Vanguard",
    type: "Class",
    system: {
      hitPoints: "1d6",
      classTalentTable: "table:class",
      talents: [mastery.sourceId],
      classAbilities: [],
      weapons: [mace.sourceId],
      armor: [],
      spellcasting: { class: "__not_spellcaster__", ability: "" },
      languages: { fixed: [] },
    },
  };
  const classSource = {
    classItem: { sourceId: "class:vanguard", data: classData },
    classTalentTableId: "table:class",
    idiom: {
      priority: ["str", "con", "dex", "wis", "int", "cha"],
      weights: { str: 10, con: 4 },
      attackMode: "melee",
      frontline: true,
    },
    tablesById: {
      "table:class": {
        sourceId: "table:class",
        formula: "2d6",
        rows: [{ range: [2, 12], optionIds: [training.sourceId] }],
      },
    },
    itemsById: {
      [mastery.sourceId]: mastery,
      [training.sourceId]: training,
      [mace.sourceId]: mace,
    },
    spellPool: [],
    choicePools: { weapon: [mace], armor: [], spell: [] },
    levelOne: {
      fixedItemIds: [mastery.sourceId],
      classAbilityIds: [],
      gear: [mace.data],
    },
  };
  return {
    classesById: { "class:vanguard": classSource },
    ancestriesById: {
      "ancestry:human": {
        sourceId: "ancestry:human",
        data: {
          name: "Human",
          type: "Ancestry",
          system: { talents: [], talentChoiceCount: 0, languages: { fixed: [] } },
        },
        itemsById: {},
      },
    },
    common: {
      backgrounds: [],
      deities: [],
      patrons: [],
      commonLanguages: [],
      rareLanguages: [],
    },
  };
}

test("member assembly resolves level-one choices and advances a complete Player plan without dialogs", () => {
  const result = assembleMemberPlan({
    member: {
      index: 0,
      name: "Arden",
      targetLevel: 3,
      ancestry: { name: "Human", documentUuid: "ancestry:human" },
      class: { name: "Fixture Vanguard", classId: "class:vanguard", warnings: [] },
    },
    shared: { alignment: "lawful", partyName: "The Iron Stars" },
    sourceSnapshot: memberSourceSnapshot(),
    rng: () => 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.member.actorData.name, "Arden");
  assert.equal(result.member.actorData.type, "Player");
  assert.equal(result.member.actorData.system.level.value, 3);
  assert.equal(result.member.actorData.system.ancestry, "ancestry:human");
  assert.equal(result.member.actorData.system.class, "class:vanguard");
  assert.equal(result.member.actorData.system.alignment, "lawful");
  assert.equal(Object.hasOwn(result.member.actorData, "pack"), false);
  assert.equal(
    JSON.stringify(result.member.actorData).includes("REPLACEME"),
    false,
    "approved Actor data must never reach an interactive effect-choice fallback",
  );
  assert.ok(result.member.actorData.items.some((entry) => entry.name === "Weapon Mastery"));
  assert.ok(result.member.actorData.items.some((entry) => entry.name === "Battle Training"));
  assert.deepEqual(result.member.advancement.map((entry) => entry.level), [2, 3]);
});

test("member assembly honors captured generation settings and completes language choices", () => {
  const sourceSnapshot = memberSourceSnapshot();
  sourceSnapshot.generation = {
    statMethod: "4d6h3-down",
    startingGold: 20,
    maxLevelOneHp: true,
  };
  sourceSnapshot.ancestriesById["ancestry:human"].data.system.languages = {
    fixed: ["language:fixed"],
    common: 1,
    select: 1,
    selectOptions: ["language:select"],
  };
  sourceSnapshot.common.commonLanguages = [item("language:common", "Common")];
  sourceSnapshot.common.rareLanguages = [];
  sourceSnapshot.common.deities = [{
    sourceId: "deity:lawful",
    data: {
      _id: "lawful",
      name: "Lawful Saint",
      type: "Deity",
      system: { alignment: "lawful" },
    },
  }];

  const result = assembleMemberPlan({
    member: {
      index: 0,
      name: "Arden",
      targetLevel: 1,
      ancestry: { name: "Human", documentUuid: "ancestry:human" },
      class: { name: "Fixture Vanguard", classId: "class:vanguard", warnings: [] },
    },
    shared: { alignment: "lawful", partyName: "The Iron Stars" },
    sourceSnapshot,
    rng: () => 0,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.member.actorData.system.languages.sort(), [
    "language:common",
    "language:fixed",
    "language:select",
  ]);
  assert.equal(result.member.generation.abilityScores.method, "4d6h3-down");
  assert.equal(result.member.generation.startingGold.fixedGp, 20);
  assert.equal(result.member.generation.levelOneHp.maximized, true);
  assert.equal(result.member.generation.levelOneHp.kept, 6);
  assert.equal(result.member.actorData.system.deity, "deity:lawful");
});

test("member assembly refuses a caster when the level-one spell quota cannot be filled", () => {
  const sourceSnapshot = memberSourceSnapshot();
  const source = sourceSnapshot.classesById["class:vanguard"];
  source.classItem.data.system.spellcasting = {
    class: "wizard",
    ability: "int",
    spellsknown: { 1: { 1: 1 } },
  };
  source.spellPool = [];
  source.choicePools.spell = [];

  const result = assembleMemberPlan({
    member: {
      index: 0,
      name: "Arden",
      targetLevel: 1,
      ancestry: { name: "Human", documentUuid: "ancestry:human" },
      class: { name: "Fixture Vanguard", classId: "class:vanguard", warnings: [] },
    },
    shared: { alignment: "lawful", partyName: "The Iron Stars" },
    sourceSnapshot,
    rng: () => 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "party-choice-unresolved");
  assert.equal(result.role, "Fixture Vanguard spells");
});

function supportingDocument(manifestId, formula, rows) {
  return {
    _id: manifestId,
    uuid: `Compendium.world.sde-tables.RollTable.${manifestId}`,
    name: manifestId,
    formula,
    flags: { [MODULE_ID]: { manifestId, source: "CORE" } },
    results: rows,
  };
}

function textRow(name, range) {
  return { _id: name, name, type: "text", weight: 1, range };
}

function fullPartySnapshot() {
  const readinessReport = {
    version: 1,
    classes: [{
      classId: "class:vanguard",
      name: "Fixture Vanguard",
      source: "core",
      eligible: true,
      blockers: [],
      warnings: [{ code: "idiom-thin", message: "Uses deterministic fallbacks." }],
    }],
    eligible: [],
    excluded: [],
    sources: [
      { source: "core", present: true, classCount: 1, error: null },
      { source: "importer-managed", present: true, classCount: 0, error: null },
    ],
  };
  readinessReport.eligible = [readinessReport.classes[0]];
  const descriptors = [
    supportingDocument("core-renown", "1d6", [textRow("Noted", [1, 6])]),
    supportingDocument("core-secret", "2d6", [textRow("Owes the crown", [2, 12])]),
    supportingDocument("core-wealth-rival-crawlers", "1d6", [textRow("Well equipped", [1, 6])]),
    supportingDocument("core-signature-tactics:lawful", "1d4", [textRow("Shield wall", [1, 4])]),
    supportingDocument("core-signature-tactics:neutral", "1d4", [textRow("Patient ambush", [1, 4])]),
    supportingDocument("core-signature-tactics:chaotic", "1d4", [textRow("Wild charge", [1, 4])]),
    supportingDocument("core-party-name:name-1", "1d20", [textRow("Iron", [1, 20])]),
    supportingDocument("core-party-name:name-2", "1d20", [textRow("Stars", [1, 20])]),
    supportingDocument("core-party-name:known-for", "1d20", [textRow("Never retreating", [1, 20])]),
    supportingDocument("core-npc-names-by-ancestry:human", "1d20", [textRow("Arden", [1, 20])]),
  ];
  const systemDescriptors = [
    {
      manifestId: "core-random-alignment",
      source: "core",
      location: "system",
      uuid: "Compendium.shadowdark.rollable-tables.RollTable.alignment",
      name: "Random Alignment",
      formula: "1d6",
      results: [textRow("Lawful", [1, 6])],
    },
    {
      manifestId: "core-random-ancestry",
      source: "core",
      location: "system",
      uuid: "Compendium.shadowdark.rollable-tables.RollTable.ancestry",
      name: "Random Ancestry",
      formula: "1d12",
      results: [{
        _id: "human",
        name: "Human",
        type: "document",
        weight: 1,
        range: [1, 12],
        documentUuid: "ancestry:human",
      }],
    },
  ];
  return {
    readinessReport,
    supporting: { descriptors, systemDescriptors },
    ...memberSourceSnapshot(),
  };
}

test("a seeded party preview is byte-stable, immutable, and contains every approved Actor payload", () => {
  const sourceSnapshot = fullPartySnapshot();
  const first = planRivalParty({ seed: "party-seed", sourceSnapshot });
  const second = planRivalParty({ seed: "party-seed", sourceSnapshot });

  assert.equal(first.blocked, false);
  assert.deepEqual(first, second);
  assert.equal(first.preview.shared.partyName, "Iron Stars");
  assert.equal(first.preview.shared.alignment, "lawful");
  assert.equal(first.preview.shared.signatureTactics, "Shield wall");
  assert.equal(first.preview.shared.renown, "Noted");
  assert.equal(first.preview.shared.secret, "Owes the crown");
  assert.equal(first.preview.shared.wealth, "Well equipped");
  assert.ok(first.preview.shared.rolls.alignment.roll >= 1
    && first.preview.shared.rolls.alignment.roll <= 6);
  assert.equal(first.preview.shared.rolls.partySize.formula, "1d4");
  assert.ok(first.preview.members.length >= 2 && first.preview.members.length <= 5);
  assert.ok(first.preview.members.every((member) =>
    member.actorData.type === "Player"
      && member.actorData.system.level.value === member.targetLevel
      && member.actorData.system.alignment === first.preview.shared.alignment
      && !Object.hasOwn(member.actorData, "pack")));
  assert.equal(Object.hasOwn(first.preview, "organisation"), false,
    "environment capabilities must not change the seeded plan");
  assert.equal(Object.isFrozen(first.preview), true);
  assert.equal(Object.isFrozen(first.preview.members[0].actorData), true);
  assert.throws(() => { first.preview.shared.partyName = "Changed"; }, TypeError);
  assert.equal(first.view.sections[0].title, "Shared party traits");
  assert.equal(first.view.members.length, first.preview.members.length);
});
