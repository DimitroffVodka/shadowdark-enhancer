import test from "node:test";
import assert from "node:assert/strict";

import {
  findLegacyMonsterSpellPack,
  LEGACY_MONSTER_SPELL_PACK,
  migrateMonsterSpellPack,
} from "../scripts/monster-creator/monster-spell-pack-migration.mjs";
import { findSuitePack, SUITE_PACKS } from "../scripts/shared/compendium-suite.mjs";

const LEGACY = LEGACY_MONSTER_SPELL_PACK.collection;
const TARGET = "world.sde-items";

function generated(id, libraryId, { sourceLabel = "Shadowdark Core", name } = {}) {
  return {
    _id: id,
    name: name ?? `Blast - Mage [${libraryId}]`,
    type: "Spell",
    system: { tier: 2 },
    effects: [],
    folder: "legacy-folder",
    flags: {
      "shadowdark-enhancer": {
        monsterSpell: {
          generated: true,
          libraryId,
          originalName: "Blast",
          sourceFingerprint: `fnv1a32:${libraryId}`,
          materializedFingerprint: `fnv1a32:m-${libraryId}`,
          variant: false,
          sources: [{ actorName: "Mage", sourcePack: "shadowdark.monsters", sourceLabel }],
          warnings: [],
        },
      },
    },
  };
}

/**
 * A stand-in world holding the legacy pack and the managed Items pack. Creates
 * land in `target.documents`, deletes remove from `legacy.documents`, so the
 * post-run state of both packs is directly assertable.
 */
function world({
  legacyDocuments = null,
  targetDocuments = [],
  locked = false,
  folders = [],
  createDocuments = null,
} = {}) {
  const calls = { creates: [], deletes: [], folders: [], configure: [], invalidated: 0 };
  const legacy = legacyDocuments === null ? null : {
    collection: LEGACY,
    documentName: "Item",
    metadata: { packageType: "world", label: LEGACY_MONSTER_SPELL_PACK.label },
    get locked() { return locked; },
    folders,
    documents: [...legacyDocuments],
    async getDocuments() { return this.documents; },
    async configure(data) { calls.configure.push(data); locked = false; },
  };
  const target = {
    collection: TARGET,
    documentName: "Item",
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Items" },
    documents: [...targetDocuments],
    async getDocuments() { return this.documents; },
  };
  let nextId = 0;
  const ItemClass = {
    async createDocuments(data, options) {
      calls.creates.push({ data, options });
      if (createDocuments) return createDocuments(data, options, target);
      const created = data.map(entry => ({ ...entry, _id: `created-${nextId += 1}` }));
      target.documents.push(...created);
      return created;
    },
    async deleteDocuments(ids, options) {
      calls.deletes.push({ ids, options });
      if (legacy) legacy.documents = legacy.documents.filter(doc => !ids.includes(doc._id));
      return ids;
    },
  };
  const packs = [target];
  if (legacy) packs.push(legacy);
  return {
    calls,
    legacy,
    target,
    ItemClass,
    game: { user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } }, packs },
    deps() {
      return {
        game: this.game,
        ensureTargetPack: async () => target,
        ensureFolderPath: async (_pack, path) => {
          calls.folders.push(path);
          return `folder:${path.join("/")}`;
        },
        ItemClass,
        invalidate: async () => { calls.invalidated += 1; },
      };
    },
  };
}

test("the legacy Monster Spells pack is no longer a managed suite pack", () => {
  assert.equal(SUITE_PACKS.some(descriptor => descriptor.key === "monsterSpells"), false);
  assert.equal(
    SUITE_PACKS.some(descriptor => descriptor.id === "shadowdark-enhancer--monster-spells"),
    false,
  );
  // The Items pack it consolidates into is still a protected managed pack.
  assert.deepEqual(SUITE_PACKS.find(descriptor => descriptor.key === "items"), {
    key: "items",
    id: "sde-items",
    type: "Item",
    label: "Shadowdark Enhancer — Items",
  });
});

test("the retired pack, left empty in the world, is not mistaken for the Spells pack", () => {
  // `world.shadowdark-enhancer--monster-spells` ends in "spells". An unanchored
  // suffix match therefore returned it for findSuitePack("spells"), so
  // ensureSuite never created world.spells and the importer wrote class spells
  // into a pack scheduled for removal. Reproduced live in `abletodestroy`.
  const retired = {
    collection: LEGACY,
    metadata: { packageType: "world", label: LEGACY_MONSTER_SPELL_PACK.label },
  };
  const spells = { collection: "world.spells", metadata: { packageType: "world", label: "Spells" } };

  assert.equal(findSuitePack("spells", { game: { packs: [retired] } }), undefined);
  assert.equal(findSuitePack("spells", { game: { packs: [retired, spells] } }), spells);
  // The label fallback still resolves a pack whose collection was slugified
  // differently from its descriptor id — the v14-durable half of the contract.
  assert.equal(
    findSuitePack("sde-items", {
      game: {
        packs: [retired, {
          collection: "world.shadowdark-enhancer--items",
          metadata: { packageType: "world", label: "Shadowdark Enhancer — Items" },
        }],
      },
    })?.collection,
    "world.shadowdark-enhancer--items",
  );
});

test("the legacy pack is found by collection id or by its v14-durable label", () => {
  const byId = { collection: LEGACY, metadata: { packageType: "world", label: "Renamed" } };
  const byLabel = {
    collection: "world.something-else",
    metadata: { packageType: "world", label: LEGACY_MONSTER_SPELL_PACK.label },
  };

  assert.equal(findLegacyMonsterSpellPack({ game: { packs: [byId] } }), byId);
  assert.equal(findLegacyMonsterSpellPack({ game: { packs: [byLabel] } }), byLabel);
  assert.equal(findLegacyMonsterSpellPack({ game: { packs: [] } }), undefined);
});

test("a world that never had the legacy pack completes without touching the Items pack", async () => {
  const stage = world({ legacyDocuments: null });
  let ensured = false;

  const result = await migrateMonsterSpellPack({
    ...stage.deps(),
    ensureTargetPack: async () => { ensured = true; return stage.target; },
  });

  assert.deepEqual(result, { status: "absent", moved: 0, deleted: 0 });
  assert.equal(ensured, false);
  assert.equal(stage.calls.creates.length, 0);
});

test("a world holding only the auto-created empty pack completes safely and writes nothing", async () => {
  const stage = world({ legacyDocuments: [] });
  let ensured = false;

  const result = await migrateMonsterSpellPack({
    ...stage.deps(),
    ensureTargetPack: async () => { ensured = true; return stage.target; },
  });

  assert.equal(result.status, "empty");
  assert.equal(result.examined, 0);
  assert.equal(ensured, false);
  assert.equal(stage.calls.creates.length, 0);
  assert.equal(stage.calls.deletes.length, 0);
});

test("a populated legacy pack moves its content into the Items pack and is emptied", async () => {
  const stage = world({
    legacyDocuments: [
      generated("l1", "lib-a"),
      generated("l2", "lib-b", { sourceLabel: "Cursed Scroll 3" }),
    ],
  });

  const result = await migrateMonsterSpellPack(stage.deps());

  assert.equal(result.status, "migrated");
  assert.equal(result.examined, 2);
  assert.equal(result.moved, 2);
  assert.equal(result.deleted, 2);
  assert.equal(result.remaining, 0);
  // Content count is preserved, and the legacy pack is left present-but-empty.
  assert.equal(stage.target.documents.length, 2);
  assert.equal(stage.legacy.documents.length, 0);
  assert.deepEqual(stage.calls.folders, [
    ["Monster Spells", "Shadowdark Core"],
    ["Monster Spells", "Cursed Scroll 3"],
  ]);
  assert.deepEqual(
    stage.target.documents.map(doc => doc.folder),
    ["folder:Monster Spells/Shadowdark Core", "folder:Monster Spells/Cursed Scroll 3"],
  );
  assert.deepEqual(
    stage.target.documents.map(doc => doc.flags["shadowdark-enhancer"].monsterSpellMigration),
    [{ from: LEGACY, sourceId: "l1" }, { from: LEGACY, sourceId: "l2" }],
  );
  assert.equal(stage.calls.deletes[0].options.pack, LEGACY);
  assert.equal(stage.calls.creates[0].options.pack, TARGET);
  assert.equal(stage.calls.invalidated, 1);
});

test("migrated Items keep their generated provenance verbatim", async () => {
  const source = generated("l1", "lib-a");
  const stage = world({ legacyDocuments: [source] });

  await migrateMonsterSpellPack(stage.deps());

  const moved = stage.target.documents[0];
  assert.deepEqual(
    moved.flags["shadowdark-enhancer"].monsterSpell,
    source.flags["shadowdark-enhancer"].monsterSpell,
  );
  assert.equal(moved.name, source.name);
  assert.equal(moved._id, "created-1", "a compendium id is only unique inside its own pack");
});

test("rerunning after a completed migration is a no-op", async () => {
  const stage = world({ legacyDocuments: [generated("l1", "lib-a")] });

  await migrateMonsterSpellPack(stage.deps());
  stage.calls.creates.length = 0;
  stage.calls.deletes.length = 0;
  const second = await migrateMonsterSpellPack(stage.deps());

  assert.equal(second.status, "empty");
  assert.equal(stage.calls.creates.length, 0);
  assert.equal(stage.target.documents.length, 1, "no duplicate target Item");
});

test("a partial run that already created the copy does not create it twice", async () => {
  const stage = world({ legacyDocuments: [generated("l1", "lib-a")] });
  // Simulate the previous run dying after createDocuments and before deleting:
  // the copy is in the target, the original is still in the legacy pack.
  await migrateMonsterSpellPack({
    ...stage.deps(),
    ItemClass: {
      createDocuments: stage.ItemClass.createDocuments,
      deleteDocuments: async () => { throw new Error("connection lost"); },
    },
  }).catch(() => {});
  assert.equal(stage.target.documents.length, 1);
  assert.equal(stage.legacy.documents.length, 1);

  const result = await migrateMonsterSpellPack(stage.deps());

  assert.equal(result.status, "migrated");
  assert.equal(result.moved, 0);
  assert.equal(result.alreadyPresent, 1);
  assert.equal(result.deleted, 1);
  assert.equal(stage.target.documents.length, 1, "no duplicate target Item");
  assert.equal(stage.legacy.documents.length, 0);
});

test("an original whose copy cannot be verified is kept and the run stays retryable", async () => {
  const stage = world({
    legacyDocuments: [generated("l1", "lib-a"), generated("l2", "lib-b")],
    // Only the first create actually lands.
    createDocuments: (data, _options, target) => {
      const created = { ...data[0], _id: "created-1" };
      target.documents.push(created);
      return [created];
    },
  });

  const result = await migrateMonsterSpellPack(stage.deps());

  assert.equal(result.status, "incomplete");
  assert.equal(result.deleted, 1);
  assert.equal(result.remaining, 1);
  assert.deepEqual(stage.legacy.documents.map(doc => doc._id), ["l2"]);
  assert.equal(result.foldersRemoved, 0, "an unfinished pack keeps its folder tree");
});

test("existing generated content in the Items pack wins over the legacy copy", async () => {
  const stage = world({
    legacyDocuments: [generated("l1", "lib-a")],
    targetDocuments: [{ ...generated("t1", "lib-a"), folder: "items-folder" }],
  });

  const result = await migrateMonsterSpellPack(stage.deps());

  assert.equal(result.moved, 0);
  assert.equal(result.alreadyPresent, 1);
  assert.equal(result.deleted, 1);
  assert.equal(stage.target.documents.length, 1, "no duplicate target Item");
  assert.equal(stage.target.documents[0]._id, "t1");
  assert.equal(stage.legacy.documents.length, 0);
});

test("a locked legacy pack is unlocked before its content is removed", async () => {
  const stage = world({ legacyDocuments: [generated("l1", "lib-a")], locked: true });

  await migrateMonsterSpellPack(stage.deps());

  assert.deepEqual(stage.calls.configure, [{ locked: false }]);
  assert.equal(stage.legacy.documents.length, 0);
});

test("the emptied legacy pack loses its now-orphaned folder tree", async () => {
  const deleted = [];
  const folders = [
    { name: "Monster Spells", folder: null, delete: async () => deleted.push("Monster Spells") },
    { name: "Shadowdark Core", folder: { id: "root" }, delete: async () => deleted.push("Shadowdark Core") },
  ];
  const stage = world({ legacyDocuments: [generated("l1", "lib-a")], folders });

  const result = await migrateMonsterSpellPack(stage.deps());

  assert.equal(result.foldersRemoved, 2);
  assert.deepEqual(deleted, ["Shadowdark Core", "Monster Spells"], "children before parents");
});

test("a failing folder delete leaves the pack empty and the migration successful", async () => {
  const folders = [{
    name: "Monster Spells",
    folder: null,
    delete: async () => { throw new Error("locked"); },
  }];
  const stage = world({ legacyDocuments: [generated("l1", "lib-a")], folders });

  const result = await migrateMonsterSpellPack(stage.deps());

  assert.equal(result.status, "migrated");
  assert.equal(result.foldersRemoved, 0);
  assert.equal(stage.legacy.documents.length, 0);
});

test("only the single active GM migrates", async () => {
  const stage = world({ legacyDocuments: [generated("l1", "lib-a")] });

  const player = await migrateMonsterSpellPack({
    ...stage.deps(),
    game: { user: { id: "p", isGM: false }, packs: stage.game.packs },
  });
  const secondGm = await migrateMonsterSpellPack({
    ...stage.deps(),
    game: {
      user: { id: "gm2", isGM: true },
      users: { activeGM: { id: "gm" } },
      packs: stage.game.packs,
    },
  });

  assert.deepEqual(player, { status: "skipped", reason: "not-gm" });
  assert.deepEqual(secondGm, { status: "skipped", reason: "not-active-gm" });
  assert.equal(stage.calls.creates.length, 0);
  assert.equal(stage.legacy.documents.length, 1);
});
