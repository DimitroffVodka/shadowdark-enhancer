import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createRivalPartyAdapter,
  readRivalPartySourceSnapshot,
} from "../scripts/forge-loot/rival-party-adapter.mjs";
import {
  ForgeLootController,
  GENERATOR_IDS,
  createGeneratorRegistry,
} from "../scripts/forge-loot/forge-loot-core.mjs";

function document(data, { uuid = null, documentName = "Item" } = {}) {
  return {
    ...structuredClone(data),
    uuid,
    documentName,
    toObject() { return structuredClone(data); },
  };
}

test("the Foundry reader produces a semantic plain snapshot from real index and TableResult shapes", async () => {
  const classId = "fighter";
  const derivedClassId = "Compendium.shadowdark.classes.Item.fighter";
  const ancestryId = "Compendium.shadowdark.ancestries.Item.human";
  const classDoc = document({
    _id: "fighter",
    name: "Fighter",
    type: "Class",
    system: {
      hitPoints: "1d8",
      classTalentTable: "RollTable.class-talents",
      talents: ["Item.weapon-mastery"],
      classAbilities: [],
      weapons: ["Item.mace"],
      armor: [],
      spellcasting: { class: "__not_spellcaster__", ability: "" },
    },
  });
  const talentTable = document({
    _id: "class-talents",
    name: "Fighter Talents",
    formula: "2d6",
    results: [{
      _id: "talent-row",
      name: "Training",
      type: "document",
      range: [2, 12],
      weight: 1,
      documentUuid: "Compendium.world.sde-items.Item.training",
    }],
  }, { uuid: "RollTable.class-talents", documentName: "RollTable" });
  const trainingId = "Compendium.world.sde-items.Item.training";
  const training = document({ _id: "training", name: "Training", type: "Talent", system: {}, effects: [] }, { uuid: trainingId });
  const mastery = document({ _id: "weapon-mastery", name: "Weapon Mastery", type: "Talent", system: {}, effects: [] }, { uuid: "Item.weapon-mastery" });
  const ancestry = document({
    _id: "human",
    name: "Human",
    type: "Ancestry",
    system: { talents: [], talentChoiceCount: 0, languages: { fixed: [] } },
  }, { uuid: ancestryId });
  const mace = document({
    _id: "mace",
    name: "Mace",
    type: "Weapon",
    system: { range: "melee", damage: { oneHanded: "d6" }, cost: { gp: 5 } },
  }, { uuid: "Item.mace" });
  const docs = new Map([
    ["RollTable.class-talents", talentTable],
    [trainingId, training],
    ["Item.weapon-mastery", mastery],
    [ancestryId, ancestry],
    ["Item.mace", mace],
  ]);
  const readinessReport = {
    version: 1,
    classes: [{ classId, name: "Fighter", source: "core", eligible: true, blockers: [], warnings: [] }],
    eligible: [],
    excluded: [],
    sources: [
      { source: "core", collection: "shadowdark.classes", present: true, classCount: 1, error: null },
      { source: "importer-managed", present: true, classCount: 0, error: null },
    ],
  };
  readinessReport.eligible = [readinessReport.classes[0]];
  const systemDescriptors = [{
    manifestId: "core-random-ancestry",
    source: "core",
    location: "system",
    uuid: "RollTable.ancestry",
    name: "Random Ancestry",
    formula: "1d12",
    results: [{
      _id: "human-row",
      name: "Human",
      type: "document",
      weight: 1,
      range: [1, 12],
      documentUuid: ancestryId,
    }],
  }];
  const shadowdark = { compendiums: {
    baseWeapons: async () => [mace],
    baseArmor: async () => [],
    basicItems: async () => [],
    weapons: async () => [mace],
    armor: async () => [],
    spells: async () => [],
    backgrounds: async () => [],
    deities: async () => [],
    patrons: async () => [],
    commonLanguages: async () => [],
    rareLanguages: async () => [],
  } };

  const corePack = {
    collection: "shadowdark.classes",
    documentName: "Item",
    async getDocument(id) { return id === "fighter" ? classDoc : null; },
  };
  const snapshot = await readRivalPartySourceSnapshot({
    game: { packs: new Map([[corePack.collection, corePack]]), settings: { get: () => null } },
    fromUuid: async (uuid) => docs.get(uuid) ?? null,
    shadowdark,
    collectReadiness: async () => readinessReport,
    loadManaged: async () => [],
    loadSystem: async () => systemDescriptors,
    readClassTable: async () => ({ _id: "rival", name: "Rival Crawler Classes", results: [] }),
  });

  assert.equal(snapshot.readinessReport.classes[0].classId, classId);
  assert.equal(snapshot.supporting.systemDescriptors[0].results[0].documentUuid, ancestryId);
  assert.equal(snapshot.supporting.systemDescriptors[0].results[0].type, "document");
  assert.equal(snapshot.supporting.systemDescriptors[0].results[0].weight, 1);
  assert.equal(snapshot.classesById[classId].classItem.data.type, "Class");
  assert.equal(snapshot.classesById[classId].classItem.sourceId, derivedClassId);
  assert.equal(snapshot.classesById[classId].tablesById["RollTable.class-talents"].rows[0].optionIds[0], trainingId);
  assert.equal(snapshot.classesById[classId].itemsById[trainingId].data.type, "Talent");
  assert.equal(snapshot.ancestriesById[ancestryId].data.type, "Ancestry");
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  assert.equal(JSON.stringify(snapshot).includes("toObject"), false);
});

test("the Rival adapter lets the G4 controller reroll and commit the exact approved preview once", async () => {
  const snapshot = { revision: 1 };
  const commits = [];
  const adapter = createRivalPartyAdapter({
    readSnapshot: async () => structuredClone(snapshot),
    planner: ({ seed, sourceSnapshot, rng }) => ({
      generator: GENERATOR_IDS.RIVAL,
      seed,
      preview: { seed, value: rng(), revision: sourceSnapshot.revision },
      sourceSnapshot,
      blocked: false,
      disabled: false,
      missing: [],
      exclusions: [],
      warnings: [],
    }),
    commitPreview: async (request) => {
      commits.push(request);
      return { actorIds: ["actor-1"] };
    },
  });
  const controller = new ForgeLootController({
    registry: createGeneratorRegistry([adapter]),
    generator: GENERATOR_IDS.RIVAL,
    seed: "first-seed",
    isActiveGM: async () => true,
  });

  const first = await controller.preview();
  assert.equal(first.ok, true);
  const firstPreview = controller.state.preview;
  const rerolled = await controller.reroll();
  assert.equal(rerolled.ok, true);
  assert.notEqual(controller.state.seed, "first-seed");
  assert.notDeepEqual(controller.state.preview, firstPreview);
  const approvedPreview = controller.state.preview;

  const committed = await controller.approve();
  assert.equal(committed.ok, true);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].preview, approvedPreview);
  assert.equal(Object.hasOwn(commits[0], "rng"), false);
  assert.equal(controller.cancel().reason, "preview-consumed");
});

test("SDX capability changes only preview disclosure, never the seeded party plan", async () => {
  const fixedPlan = ({ seed, sourceSnapshot }) => ({
    generator: GENERATOR_IDS.RIVAL,
    seed,
    preview: { seed, shared: { partyName: "Iron Stars" }, members: [{ id: 1 }] },
    sourceSnapshot,
    view: { title: "Iron Stars", summary: "Preview", sections: [], members: [] },
    blocked: false,
    disabled: false,
    missing: [],
    exclusions: [],
    warnings: [],
  });
  const states = [
    {
      label: "absent",
      game: { modules: new Map(), settings: { get: () => [] } },
      mode: "folder",
      warning: /not active/i,
    },
    {
      label: "disabled",
      game: {
        modules: new Map([["shadowdark-extras", { active: true, api: {} }]]),
        settings: { get: () => ["party.management"] },
      },
      mode: "folder",
      warning: /disabled/i,
    },
    {
      label: "unverifiable",
      game: {
        modules: new Map([["shadowdark-extras", { active: true, api: {} }]]),
        settings: { get: () => undefined },
      },
      mode: "folder",
      warning: /could not be verified/i,
    },
    {
      label: "enabled",
      game: {
        modules: new Map([["shadowdark-extras", { active: true, api: {} }]]),
        settings: { get: () => [] },
      },
      mode: "party-token",
      warning: null,
    },
  ];
  const results = [];
  for (const state of states) {
    const adapter = createRivalPartyAdapter({
      game: state.game,
      readSnapshot: async () => ({ revision: 1 }),
      planner: fixedPlan,
    });
    const result = await adapter.plan({ seed: "same-seed", rng: () => 0.5 });
    results.push(result);
    assert.equal(result.commitTarget.mode, state.mode, state.label);
    assert.equal(result.preview.commitTarget.mode, state.mode, state.label);
    if (state.warning) {
      assert.match(result.commitTarget.message, state.warning);
      assert.ok(result.warnings.some((warning) => warning.code === "party-token-unavailable"));
    } else {
      assert.equal(result.warnings.length, 0);
    }
  }
  const seededPreview = (result) => {
    const preview = structuredClone(result.preview);
    delete preview.commitTarget;
    return preview;
  };
  assert.deepEqual(seededPreview(results[0]), seededPreview(results[1]));
  assert.deepEqual(seededPreview(results[1]), seededPreview(results[2]));
  assert.deepEqual(seededPreview(results[2]), seededPreview(results[3]));
  assert.deepEqual(results[0].sourceSnapshot, results[3].sourceSnapshot);
});

test("the registered adapter senses SDX from the live game at preview time", async () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    modules: new Map([["shadowdark-extras", { active: true }]]),
    settings: { get: () => [] },
  };
  try {
    const adapter = createRivalPartyAdapter({
      readSnapshot: async () => ({ revision: 1 }),
      planner: ({ seed, sourceSnapshot }) => ({
        generator: GENERATOR_IDS.RIVAL,
        seed,
        preview: { seed, shared: { partyName: "Iron Stars" }, members: [{ id: 1 }] },
        sourceSnapshot,
        view: { title: "Iron Stars", summary: "Preview", sections: [], members: [] },
        blocked: false,
        disabled: false,
        missing: [],
        exclusions: [],
        warnings: [],
      }),
    });
    const result = await adapter.plan({ seed: "live-game", rng: () => 0.5 });
    assert.equal(result.commitTarget.mode, "party-token");
    assert.equal(result.preview.commitTarget.mode, "party-token");
  } finally {
    globalThis.game = previousGame;
  }
});

test("the G4 shell registers the Rival adapter without moving generation rules into the application", async () => {
  const app = await readFile(new URL("../scripts/forge-loot/forge-loot-app.mjs", import.meta.url), "utf8");
  const planner = await readFile(new URL("../scripts/forge-loot/rival-party-planner.mjs", import.meta.url), "utf8");
  assert.match(app, /createRivalPartyAdapter/);
  assert.match(app, /ForgeLootGenerators\.register\(createRivalPartyAdapter\(\)\)/);
  assert.doesNotMatch(app, /assembleMemberPlan|advanceMemberPlan|Actor\.create|Folder\.create/);
  assert.match(planner, /resolveClassChoices/);
  assert.match(planner, /advanceMemberPlan/);
  assert.match(planner, /createSeededRng/);
  assert.doesNotMatch(planner, /Math\.random|\bDialog\b|Actor\.create|Folder\.create|RollTable\.draw|new Roll\b/);
});
