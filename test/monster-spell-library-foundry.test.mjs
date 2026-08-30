import test from "node:test";
import assert from "node:assert/strict";

import {
  applyMonsterSpellRefresh,
  ensureMonsterSpellPack,
  listMonsterSpellSources,
  prepareMonsterSpellRefresh,
  previewMonsterSpellLibrary,
  runMonsterSpellLibraryRefresh,
  scanMonsterSpellSources,
  syncImportedMonsterSpells,
  syncMonsterSpellLibrary,
} from "../scripts/monster-creator/monster-spell-library.mjs";
import {
  ensurePackInSuite,
  SUITE_PACKS,
} from "../scripts/shared/compendium-suite.mjs";

function pack(collection, label, documents = []) {
  return {
    collection,
    documentName: "Actor",
    metadata: { label, packageType: collection.startsWith("world.") ? "world" : "system" },
    async getDocuments() { return documents; },
  };
}

function spell(name, id) {
  return { _id: id, name, type: "Spell", system: { tier: 1 }, effects: [] };
}

function actor(name, uuid, items) {
  return { name, uuid, items, _stats: { systemVersion: "4.0.6" } };
}

test("source discovery includes core monsters and the managed Enhancer Actors pack only", () => {
  const game = {
    system: { version: "4.0.6" },
    modules: new Map([["shadowdark-enhancer", { version: "0.15.1" }]]),
    packs: [
      pack("shadowdark.monsters", "Monsters"),
      pack("world.sde-actors", "Shadowdark Enhancer — Actors"),
      pack("other-module.monsters", "Other Monsters"),
    ],
  };

  const sources = listMonsterSpellSources({ game });

  assert.deepEqual(sources.map(source => source.id), [
    "shadowdark.monsters",
    "world.sde-actors",
  ]);
  assert.deepEqual(sources.map(source => source.label), [
    "Shadowdark Core",
    "Shadowdark Enhancer — Actors",
  ]);
  assert.deepEqual(sources.map(source => source.version), ["4.0.6", "0.15.1"]);
});

test("target pack is dedicated, player-hidden, and placed in the SDE compendium folder", async () => {
  let descriptor;
  let placedPack;
  const target = { collection: "world.shadowdark-enhancer--monster-spells" };
  const pack = await ensureMonsterSpellPack({
    ensureWorldPack: async value => {
      descriptor = value;
      return target;
    },
    placeInSuite: async value => { placedPack = value; },
  });

  assert.equal(pack, target);
  assert.equal(placedPack, target);
  assert.deepEqual(descriptor, {
    key: "monsterSpells",
    collection: "world.shadowdark-enhancer--monster-spells",
    label: "Shadowdark Enhancer — Monster Spells",
    documentName: "Item",
    ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "OWNER" },
  });
});

test("suite placement creates the SDE compendium folder and moves the pack into it", async () => {
  const folders = [];
  const configureCalls = [];
  const target = {
    folder: null,
    configure: async data => { configureCalls.push(data); },
  };
  const FolderClass = {
    create: async data => {
      assert.deepEqual(data, { name: "Shadowdark Enhancer", type: "Compendium" });
      const folder = { id: "sde-folder", name: data.name, type: data.type };
      folders.push(folder);
      return folder;
    },
  };

  const result = await ensurePackInSuite(target, {
    game: { user: { isGM: true }, folders },
    FolderClass,
  });

  assert.equal(result, target);
  assert.deepEqual(configureCalls, [{ folder: "sde-folder" }]);
});

test("the Monster Spell pack participates in managed-suite backup and restore", () => {
  assert.deepEqual(
    SUITE_PACKS.find(descriptor => descriptor.key === "monsterSpells"),
    {
      key: "monsterSpells",
      id: "shadowdark-enhancer--monster-spells",
      type: "Item",
      label: "Shadowdark Enhancer — Monster Spells",
    },
  );
});

test("automatic sync refreshes only the requested source as the primary GM", async () => {
  const core = { id: "shadowdark.monsters", pack: pack("shadowdark.monsters", "Core") };
  const managed = { id: "world.sde-actors", pack: pack("world.sde-actors", "SDE") };
  const prepared = [];
  const applied = [];
  const game = {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
  };

  const result = await syncMonsterSpellLibrary({
    game,
    sourceIds: ["shadowdark.monsters"],
    listSources: () => [core, managed],
    prepareRefresh: async ({ sources }) => {
      prepared.push(sources.map(source => source.id));
      return { plan: { create: [], update: [], metadataUpdate: [], unchanged: [], conflict: [], stale: [] } };
    },
    applyRefresh: async preview => {
      applied.push(preview);
      return { created: 0, updated: 0 };
    },
  });

  assert.deepEqual(prepared, [["shadowdark.monsters"]]);
  assert.equal(applied.length, 1);
  assert.deepEqual(result, { created: 0, updated: 0 });
});

test("automatic sync queues an imported-monster refresh behind an in-flight sync", async () => {
  const game = {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
  };
  const source = { id: "shadowdark.monsters" };
  let releaseFirst;
  let enteredFirst;
  const firstHeld = new Promise(resolve => { releaseFirst = resolve; });
  const firstEntered = new Promise(resolve => { enteredFirst = resolve; });
  const order = [];
  const preview = { plan: { create: [], update: [], metadataUpdate: [], unchanged: [], conflict: [], stale: [] } };

  const first = syncMonsterSpellLibrary({
    game,
    listSources: () => [source],
    prepareRefresh: async () => {
      order.push("first-start");
      enteredFirst();
      await firstHeld;
      return preview;
    },
    applyRefresh: async () => {
      order.push("first-apply");
      return { sync: "first" };
    },
  });
  await firstEntered;

  const second = syncMonsterSpellLibrary({
    game,
    listSources: () => [source],
    prepareRefresh: async () => {
      order.push("second-start");
      return preview;
    },
    applyRefresh: async () => {
      order.push("second-apply");
      return { sync: "second" };
    },
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  releaseFirst();

  assert.deepEqual(await first, { sync: "first" });
  assert.deepEqual(await second, { sync: "second" });
  assert.deepEqual(order, ["first-start", "first-apply", "second-start", "second-apply"]);
});

test("import sync refreshes the managed Actor source only after monsters changed", async () => {
  const calls = [];
  const game = {};
  const listSources = () => [
    { id: "shadowdark.monsters" },
    { id: "world.sde-actors" },
  ];
  const sync = async options => { calls.push(options); return { created: 2 }; };

  const result = await syncImportedMonsterSpells(
    { created: [{ name: "Mage" }], replaced: [] },
    { game, listSources, sync },
  );
  const skipped = await syncImportedMonsterSpells(
    { created: [], replaced: [] },
    { game, listSources, sync },
  );

  assert.deepEqual(result, { created: 2 });
  assert.equal(skipped, null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].sourceIds, ["world.sde-actors"]);
});

test("source scan extracts embedded spells with source labels and a summary", async () => {
  const coreActor = {
    name: "Mage",
    uuid: "Compendium.shadowdark.monsters.Actor.mage",
    _stats: { systemVersion: "4.0.6" },
    items: [{ _id: "blast", name: "Blast", type: "Spell", system: { tier: 2 } }],
  };
  const importedActor = {
    name: "Dremir",
    uuid: "Compendium.world.shadowdark-enhancer--actors.Actor.dremir",
    _stats: { systemVersion: "4.0.6" },
    flags: { "shadowdark-enhancer": { source: "Cursed Scroll 5" } },
    items: [
      { _id: "impale", name: "Impale", type: "Spell", system: { tier: 1, description: "<p>DC 12.</p>" } },
      { _id: "rend", name: "Rend", type: "NPC Attack", system: {} },
    ],
  };
  const game = {
    packs: [
      pack("shadowdark.monsters", "Monsters", [coreActor]),
      pack("world.shadowdark-enhancer--actors", "Shadowdark Enhancer — Actors", [importedActor]),
    ],
  };

  const scan = await scanMonsterSpellSources(listMonsterSpellSources({ game }));

  assert.deepEqual(scan.entries.map(entry => entry.name), ["Blast - Mage", "Impale - Dremir"]);
  assert.equal(scan.entries[0].sources[0].sourceLabel, "Shadowdark Core");
  assert.equal(scan.entries[1].sources[0].sourceLabel, "Cursed Scroll 5");
  assert.equal(scan.entries[1].sources[0].sourceVersion, "4.0.6");
  assert.equal(scan.entries[1].sources[0].systemVersion, "4.0.6");
  assert.deepEqual(scan.summary, {
    sources: 2,
    actors: 2,
    actorsWithSpells: 2,
    embeddedSpells: 2,
    libraryEntries: 2,
    warnings: 1,
  });
});

test("refresh preparation is a read-only dry run with operation counts", async () => {
  const sourcePack = pack("shadowdark.monsters", "Monsters", [{
    name: "Mage",
    uuid: "Compendium.shadowdark.monsters.Actor.mage",
    items: [{ _id: "blast", name: "Blast", type: "Spell", system: { tier: 2 } }],
  }]);
  const targetPack = {
    collection: "world.shadowdark-enhancer--items",
    documentName: "Item",
    async getDocuments() { return []; },
  };

  const preview = await prepareMonsterSpellRefresh({
    sources: [{ id: "shadowdark.monsters", label: "Shadowdark Core", pack: sourcePack }],
    targetPack,
  });

  assert.equal(preview.targetPack, targetPack);
  assert.deepEqual(preview.operations, {
    create: 1,
    update: 0,
    unchanged: 0,
    conflict: 0,
    stale: 0,
  });
  assert.equal(preview.summary.libraryEntries, 1);
});

test("public preview filters selected source ids and compares the current target pack", async () => {
  const core = pack("shadowdark.monsters", "Monsters", [
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [spell("Blast", "blast")]),
  ]);
  const enhancer = pack("world.shadowdark-enhancer--actors", "Shadowdark Enhancer — Actors", [
    actor("Oracle", "Compendium.world.shadowdark-enhancer--actors.Actor.oracle", [spell("Omen", "omen")]),
  ]);
  const packs = [core, enhancer];
  packs.get = id => packs.find(candidate => candidate.collection === id);
  const targetPack = {
    collection: "world.shadowdark-enhancer--monster-spells",
    documentName: "Item",
    getDocuments: async () => [],
  };
  packs.push(targetPack);

  const preview = await previewMonsterSpellLibrary({
    game: { packs, system: { version: "4.0.6" }, modules: new Map() },
    sourceIds: ["shadowdark.monsters"],
  });

  assert.equal(preview.summary.sources, 1);
  assert.equal(preview.summary.libraryEntries, 1);
  assert.equal(preview.targetPack, targetPack);
});

test("refresh application writes only planned creates and updates into source folders", async () => {
  const sourcePack = pack("shadowdark.monsters", "Monsters", [{
    name: "Mage",
    uuid: "Compendium.shadowdark.monsters.Actor.mage",
    items: [{ _id: "blast", name: "Blast", type: "Spell", system: { tier: 2 } }],
  }]);
  const targetPack = {
    collection: "world.shadowdark-enhancer--items",
    documentName: "Item",
    async getDocuments() { return []; },
  };
  const preview = await prepareMonsterSpellRefresh({
    sources: [{ id: "shadowdark.monsters", label: "Shadowdark Core", pack: sourcePack }],
    targetPack,
  });
  const calls = { folders: [], creates: [], updates: [], invalidated: 0 };
  const ItemClass = {
    async createDocuments(data, options) { calls.creates.push({ data, options }); return data; },
    async updateDocuments(data, options) { calls.updates.push({ data, options }); return data; },
  };

  const result = await applyMonsterSpellRefresh(preview, {
    game: { user: { isGM: true } },
    ensureTargetPack: async () => targetPack,
    ensureFolderPath: async (_pack, path) => {
      calls.folders.push(path);
      return "folder-core";
    },
    ItemClass,
    invalidate: () => { calls.invalidated += 1; },
  });

  assert.deepEqual(calls.folders, [["Monster Spells", "Shadowdark Core"]]);
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.creates[0].data[0].folder, "folder-core");
  assert.equal(calls.creates[0].options.pack, targetPack.collection);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.invalidated, 1);
  assert.deepEqual(result, { created: 1, updated: 0, unchanged: 0, conflict: 0, stale: 0 });
});

test("content refresh fully replaces embedded effects instead of recursively merging them", async () => {
  const calls = [];
  const entry = {
    name: "Blast",
    originalName: "Blast",
    fingerprint: "fnv1a32:source",
    data: { name: "Blast", type: "Spell", system: { tier: 2 }, effects: [] },
    sources: [{ actorName: "Mage", itemUuid: "Compendium.shadowdark.monsters.Actor.mage.Item.blast", sourceLabel: "Shadowdark Core" }],
    warnings: [],
  };
  const preview = {
    targetPack: { collection: "world.shadowdark-enhancer--monster-spells" },
    plan: {
      create: [],
      update: [{ entry, document: { _id: "generated-1" } }],
      unchanged: [],
      conflict: [],
      stale: [],
    },
  };

  await applyMonsterSpellRefresh(preview, {
    game: { user: { isGM: true } },
    ensureTargetPack: async () => preview.targetPack,
    ensureFolderPath: async () => ({ id: "folder" }),
    ItemClass: {
      createDocuments: async () => [],
      updateDocuments: async (updates, options) => calls.push({ updates, options }),
    },
    invalidate: async () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.diff, false);
  assert.equal(calls[0].options.recursive, false);
  assert.deepEqual(calls[0].updates[0].effects, []);
});

test("interactive refresh returns null and warns for non-GM callers", async () => {
  const messages = [];
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { warn: message => messages.push(message) } };
  try {
    const result = await runMonsterSpellLibraryRefresh({
      game: { user: { isGM: false } },
      sources: [],
    });
    assert.equal(result, null);
    assert.deepEqual(messages, ["Monster Spell Library refresh is GM only."]);
  } finally {
    globalThis.ui = previousUi;
  }
});

test("interactive refresh returns null and warns for a secondary active GM", async () => {
  const messages = [];
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { warn: message => messages.push(message) } };
  try {
    const result = await runMonsterSpellLibraryRefresh({
      game: {
        user: { id: "gm-2", isGM: true },
        users: { activeGM: { id: "gm-1" } },
      },
      sources: [],
    });
    assert.equal(result, null);
    assert.deepEqual(messages, ["Only the primary active GM can refresh the Monster Spell Library."]);
  } finally {
    globalThis.ui = previousUi;
  }
});

test("interactive refresh blocks a concurrent refresh on the same client", async () => {
  const source = {
    id: "shadowdark.monsters",
    label: "Shadowdark Core",
    pack: pack("shadowdark.monsters", "Monsters"),
  };
  const game = {
    user: { id: "gm-1", isGM: true },
    users: { activeGM: { id: "gm-1" } },
  };
  const messages = [];
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { warn: message => messages.push(message) } };
  let releaseSelection;
  const selection = new Promise(resolve => { releaseSelection = resolve; });
  try {
    const first = runMonsterSpellLibraryRefresh({
      game,
      sources: [source],
      chooseSources: async () => selection,
    });
    const second = await runMonsterSpellLibraryRefresh({ game, sources: [source] });
    assert.equal(second, null);
    assert.deepEqual(messages, ["A Monster Spell Library refresh is already in progress."]);
    releaseSelection([]);
    assert.equal(await first, null);
  } finally {
    globalThis.ui = previousUi;
  }
});

test("metadata-only refresh patches provenance without replacing spell content", async () => {
  const calls = [];
  const provenance = {
    generated: true,
    libraryId: "library-1",
    sources: [{ sourcePack: "world.sde-actors" }],
  };
  const preview = {
    targetPack: { collection: "world.shadowdark-enhancer--monster-spells" },
    plan: {
      create: [],
      update: [],
      metadataUpdate: [{ document: { _id: "generated-1" }, provenance }],
      unchanged: [],
      conflict: [],
      stale: [],
    },
  };

  await applyMonsterSpellRefresh(preview, {
    game: { user: { isGM: true } },
    ensureTargetPack: async () => preview.targetPack,
    ItemClass: {
      createDocuments: async () => [],
      updateDocuments: async (updates, options) => calls.push({ updates, options }),
    },
    invalidate: async () => {},
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].updates, [{
    _id: "generated-1",
    "flags.shadowdark-enhancer.monsterSpell": provenance,
  }]);
  assert.equal(calls[0].options.diff, undefined);
  assert.equal(calls[0].updates[0].effects, undefined);
});

test("refresh revalidates an existing target pack before writing", async () => {
  const targetPack = { collection: "world.shadowdark-enhancer--monster-spells" };
  let ensured = 0;
  await applyMonsterSpellRefresh({
    targetPack,
    plan: { create: [], update: [], unchanged: [], conflict: [], stale: [] },
  }, {
    game: { user: { isGM: true } },
    ensureTargetPack: async () => { ensured += 1; return targetPack; },
    ItemClass: { createDocuments: async () => [], updateDocuments: async () => [] },
    invalidate: async () => {},
  });

  assert.equal(ensured, 1);
});

test("refresh application rejects non-GM callers before creating a pack", async () => {
  let ensured = false;
  await assert.rejects(
    applyMonsterSpellRefresh({ plan: { create: [], update: [], unchanged: [], conflict: [], stale: [] } }, {
      game: { user: { isGM: false } },
      ensureTargetPack: async () => { ensured = true; },
    }),
    /GM only/,
  );
  assert.equal(ensured, false);
});

test("interactive refresh applies only after source selection and dry-run confirmation", async () => {
  const core = {
    id: "shadowdark.monsters",
    label: "Shadowdark Core",
    pack: pack("shadowdark.monsters", "Monsters", [{
      name: "Mage",
      uuid: "Compendium.shadowdark.monsters.Actor.mage",
      items: [{ _id: "blast", name: "Blast", type: "Spell", system: { tier: 2 } }],
    }]),
  };
  const imported = {
    id: "world.shadowdark-enhancer--actors",
    label: "Shadowdark Enhancer — Actors",
    pack: pack("world.shadowdark-enhancer--actors", "Shadowdark Enhancer — Actors"),
  };
  let confirmedPreview = null;
  let appliedPreview = null;

  const result = await runMonsterSpellLibraryRefresh({
    game: { user: { isGM: true } },
    sources: [core, imported],
    targetPack: null,
    chooseSources: async () => [core],
    confirm: async preview => { confirmedPreview = preview; return true; },
    apply: async preview => { appliedPreview = preview; return { created: 1 }; },
  });

  assert.equal(confirmedPreview.summary.sources, 1);
  assert.notEqual(appliedPreview, confirmedPreview);
  assert.deepEqual(appliedPreview.operations, confirmedPreview.operations);
  assert.deepEqual(result, { created: 1 });
});

test("interactive refresh aborts when source data changes after the dry run", async () => {
  let reads = 0;
  const sourcePack = {
    collection: "shadowdark.monsters",
    documentName: "Actor",
    async getDocuments() {
      reads += 1;
      return [actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
        { _id: "blast", name: "Blast", type: "Spell", system: { tier: reads === 1 ? 2 : 3 } },
      ])];
    },
  };
  const core = { id: "shadowdark.monsters", label: "Shadowdark Core", pack: sourcePack };
  let applied = false;
  const messages = [];
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { warn: message => messages.push(message), info: () => {} } };
  try {
    const result = await runMonsterSpellLibraryRefresh({
      game: { user: { isGM: true } },
      sources: [core],
      targetPack: null,
      chooseSources: async sources => sources,
      confirm: async () => true,
      apply: async () => { applied = true; return {}; },
    });

    assert.equal(result, null);
    assert.equal(applied, false);
    assert.match(messages[0], /changed after the dry run/i);
  } finally {
    globalThis.ui = previousUi;
  }
});

test("interactive refresh does not write when the dry-run is declined", async () => {
  const core = {
    id: "shadowdark.monsters",
    label: "Shadowdark Core",
    pack: pack("shadowdark.monsters", "Monsters"),
  };
  let applied = false;

  const result = await runMonsterSpellLibraryRefresh({
    game: { user: { isGM: true } },
    sources: [core],
    targetPack: null,
    chooseSources: async sources => sources,
    confirm: async () => false,
    apply: async () => { applied = true; },
  });

  assert.equal(result, null);
  assert.equal(applied, false);
});

test("refresh marks curated generated spells as conflicts without overwriting their content", async () => {
  const updates = [];
  const provenance = {
    generated: true,
    libraryId: "monster-spell:abc",
  };
  const conflictDocument = {
    _id: "generated-1",
    flags: { "shadowdark-enhancer": { monsterSpell: provenance } },
  };
  const preview = {
    targetPack: { collection: "world.shadowdark-enhancer--items" },
    plan: {
      create: [],
      update: [],
      unchanged: [],
      conflict: [{ document: conflictDocument }],
      stale: [],
    },
  };

  const result = await applyMonsterSpellRefresh(preview, {
    game: { user: { isGM: true } },
    ensureTargetPack: async () => preview.targetPack,
    ensureFolderPath: async () => ({ id: "folder" }),
    ItemClass: {
      createDocuments: async () => [],
      updateDocuments: async data => { updates.push(...data); },
    },
    invalidate: async () => {},
  });

  assert.deepEqual(updates, [{
    _id: "generated-1",
    "flags.shadowdark-enhancer.monsterSpell.conflict": true,
  }]);
  assert.equal(result.updated, 0);
});

test("refresh clears a prior conflict marker after the generated spell is restored", async () => {
  const updates = [];
  const unchangedDocument = {
    _id: "generated-1",
    flags: { "shadowdark-enhancer": { monsterSpell: { generated: true, conflict: true } } },
  };
  const preview = {
    targetPack: { collection: "world.shadowdark-enhancer--items" },
    plan: {
      create: [],
      update: [],
      unchanged: [{ document: unchangedDocument }],
      conflict: [],
      stale: [],
    },
  };

  await applyMonsterSpellRefresh(preview, {
    game: { user: { isGM: true } },
    ensureTargetPack: async () => preview.targetPack,
    ensureFolderPath: async () => ({ id: "folder" }),
    ItemClass: {
      createDocuments: async () => [],
      updateDocuments: async data => { updates.push(...data); },
    },
    invalidate: async () => {},
  });

  assert.deepEqual(updates, [{
    _id: "generated-1",
    "flags.shadowdark-enhancer.monsterSpell.conflict": false,
  }]);
});
