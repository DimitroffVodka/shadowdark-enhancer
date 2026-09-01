/**
 * Pre-A1 suite bundles carry a `packs.monsterSpells` payload for the retired
 * world pack. SUITE_PACKS doubles as the bundle import schema, so retiring the
 * descriptor removed that key from applyBundle's restore loop — the bundle still
 * validated and still reported ok, while every Monster Spell in the backup was
 * dropped. These cover the compatibility path that consumes it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_BUNDLE_PACK_KEY,
  LEGACY_MONSTER_SPELL_PACK,
  restoreLegacyMonsterSpellBundle,
} from "../scripts/monster-creator/monster-spell-pack-migration.mjs";
import { applyBundle, BUNDLE_FORMAT, validateBundle } from "../scripts/importer/bundle-io.mjs";
import { SUITE_PACKS } from "../scripts/shared/compendium-suite.mjs";

const LEGACY = LEGACY_MONSTER_SPELL_PACK.collection;
const LEGACY_SLUG = "shadowdark-enhancer--monster-spells";

function generated(id, libraryId, { sourceLabel = "Shadowdark Core", name } = {}) {
  return {
    _id: id,
    name: name ?? `Blast - Mage [${libraryId}]`,
    type: "Spell",
    img: "icons/magic/fire/beam-jet-stream-embers.webp",
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

/** A GM's own hand-authored Item sitting in the retired pack. */
function handMade(id, name) {
  return { _id: id, name, type: "Spell", system: { tier: 1 }, effects: [], flags: {} };
}

function legacyPayload(docs, { slug = LEGACY_SLUG } = {}) {
  return { type: "Item", slug, folders: [{ _id: "f1", name: "Monster Spells" }], docs };
}

function targetStage({ documents = [], createDocuments = null } = {}) {
  const calls = { creates: [], folders: [], invalidated: 0 };
  let nextId = 0;
  const target = {
    collection: "world.shadowdark-enhancer--items",
    documentName: "Item",
    documents: [...documents],
    async getDocuments() { return this.documents; },
  };
  const ItemClass = {
    async createDocuments(data, options) {
      calls.creates.push({ data, options });
      if (createDocuments) return createDocuments(data, options, target);
      const made = data.map(entry => ({ ...entry, _id: `created-${nextId += 1}` }));
      target.documents.push(...made);
      return made;
    },
    async deleteDocuments() { throw new Error("the bundle restore must never delete"); },
  };
  return {
    calls,
    target,
    deps: {
      ensureTargetPack: async () => target,
      ensureFolderPath: async (_pack, path) => {
        calls.folders.push(path);
        return `folder:${path.join("/")}`;
      },
      ItemClass,
      invalidate: async () => { calls.invalidated += 1; },
    },
  };
}

test("a pre-A1 bundle carrying only Monster Spells still validates as format 1", () => {
  // Rejecting it would destroy backups rather than protect them, so the format
  // stays at 1 and the payload gets an explicit compatibility path instead.
  const bundle = {
    format: BUNDLE_FORMAT,
    module: "shadowdark-enhancer",
    packs: { [LEGACY_BUNDLE_PACK_KEY]: legacyPayload([generated("l1", "lib-a")]) },
  };

  assert.deepEqual(validateBundle(bundle), { ok: true, errors: [] });
  assert.equal(LEGACY_BUNDLE_PACK_KEY, "monsterSpells");
});

test("a legacy-only payload is restored into the Items pack under Monster Spells", async () => {
  const stage = targetStage();
  const docs = [
    generated("l1", "lib-a"),
    generated("l2", "lib-b", { sourceLabel: "Cursed Scroll 3" }),
    handMade("l3", "GM Homebrew Bolt"),
  ];

  const result = await restoreLegacyMonsterSpellBundle(legacyPayload(docs), stage.deps);

  assert.equal(result.examined, 3);
  assert.equal(result.created, 3);
  assert.equal(result.skippedExisting, 0);
  assert.equal(result.failures, 0);
  assert.equal(result.unaccounted, 0);
  assert.equal(result.targetCollection, "world.shadowdark-enhancer--items");
  assert.equal(stage.target.documents.length, 3);
  assert.deepEqual(stage.calls.folders, [
    ["Monster Spells", "Shadowdark Core"],
    ["Monster Spells", "Cursed Scroll 3"],
    ["Monster Spells", "Other Sources"],
  ]);
  assert.equal(stage.calls.invalidated, 1);
});

test("restored documents keep provenance and carry the same marker the live migration writes", async () => {
  const stage = targetStage();
  const source = generated("l1", "lib-a");

  await restoreLegacyMonsterSpellBundle(legacyPayload([source]), stage.deps);

  const restored = stage.target.documents[0];
  assert.deepEqual(
    restored.flags["shadowdark-enhancer"].monsterSpell,
    source.flags["shadowdark-enhancer"].monsterSpell,
  );
  // Identical shape to migrateMonsterSpellPack's marker, so a restore and a live
  // migration of the same world converge instead of duplicating.
  assert.deepEqual(restored.flags["shadowdark-enhancer"].monsterSpellMigration, {
    from: LEGACY,
    sourceId: "l1",
  });
  assert.equal(restored.folder, "folder:Monster Spells/Shadowdark Core");
});

test("a mixed bundle only restores the legacy half that the suite loop cannot see", async () => {
  // The Items payload has already been restored by applyBundle's normal loop,
  // including one Monster Spell that was migrated before the export.
  const alreadyRestored = {
    _id: "kept-id",
    ...generated("l1", "lib-a"),
    folder: "items-folder",
  };
  alreadyRestored.flags["shadowdark-enhancer"].monsterSpellMigration = {
    from: LEGACY, sourceId: "l1",
  };
  const stage = targetStage({ documents: [alreadyRestored] });

  const result = await restoreLegacyMonsterSpellBundle(
    legacyPayload([generated("l1", "lib-a"), generated("l2", "lib-b")]),
    stage.deps,
  );

  assert.equal(result.created, 1);
  assert.equal(result.skippedExisting, 1);
  assert.equal(result.failures, 0);
  assert.equal(stage.target.documents.length, 2, "no duplicate target Item");
});

test("restoring the same bundle twice creates nothing the second time", async () => {
  const stage = targetStage();
  const payload = legacyPayload([generated("l1", "lib-a"), handMade("l3", "GM Homebrew Bolt")]);

  const first = await restoreLegacyMonsterSpellBundle(payload, stage.deps);
  const second = await restoreLegacyMonsterSpellBundle(payload, stage.deps);

  assert.equal(first.created, 2);
  assert.equal(second.created, 0);
  assert.equal(second.skippedExisting, 2);
  assert.equal(second.failures, 0);
  assert.equal(stage.target.documents.length, 2, "no duplicate target Item");
});

test("a bundle restored into a world that already migrated the same pack live is a no-op", async () => {
  // The ids in a bundle are the ids the live pack had, so the markers match.
  const live = { _id: "t1", ...generated("l1", "lib-a"), folder: "items-folder" };
  live.flags["shadowdark-enhancer"].monsterSpellMigration = { from: LEGACY, sourceId: "l1" };
  const stage = targetStage({ documents: [live] });

  const result = await restoreLegacyMonsterSpellBundle(
    legacyPayload([generated("l1", "lib-a")]),
    stage.deps,
  );

  assert.equal(result.created, 0);
  assert.equal(result.skippedExisting, 1);
  assert.equal(stage.target.documents.length, 1);
});

test("an existing generated Item in the target wins the libraryId collision", async () => {
  const curated = { _id: "t1", ...generated("t1", "lib-a"), name: "Curated Blast", folder: "items-folder" };
  const stage = targetStage({ documents: [curated] });

  const result = await restoreLegacyMonsterSpellBundle(
    legacyPayload([generated("l1", "lib-a")]),
    stage.deps,
  );

  assert.equal(result.created, 0);
  assert.equal(result.skippedExisting, 1);
  assert.equal(stage.target.documents.length, 1, "no duplicate target Item");
  assert.equal(stage.target.documents[0].name, "Curated Blast", "the curated copy is untouched");
});

test("a document that does not land is reported as a failure, never as success", async () => {
  const stage = targetStage({
    createDocuments: (data, _options, target) => {
      const made = { ...data[0], _id: "created-1" };
      target.documents.push(made);
      return [made];
    },
  });

  const result = await restoreLegacyMonsterSpellBundle(
    legacyPayload([generated("l1", "lib-a"), generated("l2", "lib-b")]),
    stage.deps,
  );

  assert.equal(result.examined, 2);
  assert.equal(result.created, 1);
  assert.equal(result.failures, 1);
  assert.equal(result.unaccounted, 0, "every document is accounted for exactly once");
});

test("an unavailable Items pack fails every document instead of claiming success", async () => {
  const result = await restoreLegacyMonsterSpellBundle(
    legacyPayload([generated("l1", "lib-a"), generated("l2", "lib-b")]),
    { ensureTargetPack: async () => null, invalidate: async () => {} },
  );

  assert.equal(result.created, 0);
  assert.equal(result.failures, 2);
  assert.equal(result.unaccounted, 0);
});

test("a current bundle with no legacy payload restores nothing and touches nothing", async () => {
  const stage = targetStage();
  let ensured = false;

  const result = await restoreLegacyMonsterSpellBundle(legacyPayload([]), {
    ...stage.deps,
    ensureTargetPack: async () => { ensured = true; return stage.target; },
  });

  assert.deepEqual(result, {
    examined: 0,
    created: 0,
    skippedExisting: 0,
    failures: 0,
    unaccounted: 0,
    legacyCollection: LEGACY,
    targetCollection: "",
  });
  assert.equal(ensured, false, "an absent payload must not even resolve the Items pack");
  assert.equal(stage.calls.creates.length, 0);
});

test("the legacy collection is taken from the payload's own slug", async () => {
  const stage = targetStage();

  const result = await restoreLegacyMonsterSpellBundle(
    legacyPayload([generated("l1", "lib-a")], { slug: "renamed--monster-spells" }),
    stage.deps,
  );

  assert.equal(result.legacyCollection, "world.renamed--monster-spells");
  assert.deepEqual(
    stage.target.documents[0].flags["shadowdark-enhancer"].monsterSpellMigration,
    { from: "world.renamed--monster-spells", sourceId: "l1" },
  );
});

/**
 * Stand up just enough of a world for the real applyBundle: every managed pack
 * already present (so ensureSuite creates nothing), a suite sidebar folder, and
 * an Item class that records creates.
 */
function bundleWorld() {
  const created = [];
  const packs = SUITE_PACKS.map(desc => ({
    collection: `world.${desc.id}`,
    documentName: desc.type,
    metadata: { packageType: "world", label: desc.label, type: desc.type },
    locked: false,
    folder: "suite-folder",
    folders: [],
    index: [],
    documents: [],
    async getDocuments() { return this.documents; },
    async configure() {},
  }));
  const libraryPack = packs.find(pack => pack.collection === "world.sde-monster-spells");
  let nextId = 0;
  const previous = {
    game: globalThis.game, Item: globalThis.Item, Folder: globalThis.Folder, ui: globalThis.ui,
    foundry: globalThis.foundry, CompendiumCollection: globalThis.CompendiumCollection,
  };
  // ensurePack dereferences `foundry` eagerly, before it checks whether the pack
  // already exists. createCompendium throwing is the assertion that this restore
  // never brings the retired pack — or any pack — back.
  const CompendiumCollection = {
    createCompendium: async ({ label }) => {
      throw new Error(`applyBundle must not create a compendium here (${label})`);
    },
  };
  globalThis.CompendiumCollection = CompendiumCollection;
  globalThis.foundry = { documents: { collections: { CompendiumCollection } } };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
    packs,
    folders: [{ id: "suite-folder", name: "Shadowdark Enhancer", type: "Compendium", folder: null }],
    modules: new Map(),
  };
  globalThis.Folder = { create: async data => ({ id: `folder-${data.name}`, ...data }) };
  globalThis.Item = {
    async createDocuments(data, options) {
      const made = data.map(entry => ({ ...entry, _id: `created-${nextId += 1}` }));
      created.push({ data, options });
      if (options?.pack === libraryPack.collection) libraryPack.documents.push(...made);
      return made;
    },
    async create(data, options) { return (await this.createDocuments([data], options))[0]; },
    async deleteDocuments() { throw new Error("applyBundle must never delete"); },
  };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
  return {
    created,
    libraryPack,
    restore() { Object.assign(globalThis, previous); },
  };
}

test("applyBundle consumes a pre-A1 Monster Spells payload instead of silently dropping it", async () => {
  // The reviewed defect: validateBundle accepted packs.monsterSpells, applyBundle
  // iterated only the current SUITE_PACKS, and the GM saw a successful restore
  // while every Monster Spell in the backup was discarded.
  const world = bundleWorld();
  try {
    const report = await applyBundle({
      format: BUNDLE_FORMAT,
      module: "shadowdark-enhancer",
      packs: { [LEGACY_BUNDLE_PACK_KEY]: legacyPayload([generated("l1", "lib-a"), handMade("l3", "GM Homebrew Bolt")]) },
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.packs[LEGACY_BUNDLE_PACK_KEY], {
      created: 2,
      skippedExisting: 0,
      failures: 0,
      legacy: true,
      restoredInto: "world.sde-monster-spells",
    });
    assert.equal(report.created, 2);
    assert.equal(report.failures, 0);
    assert.equal(world.libraryPack.documents.length, 2);
    assert.equal(
      world.libraryPack.documents[0].flags["shadowdark-enhancer"].monsterSpellMigration.from,
      LEGACY,
    );
    // The Monster Spells pack is a managed pack again (#147), so the legacy
    // payload restores into it rather than into Items. What must still hold is
    // that applyBundle does not CREATE a pack as a side effect — the fixture's
    // createCompendium throws, so reaching this line already proves it.
    assert.equal(
      globalThis.game.packs.filter(p => p.collection.includes("monster-spells")).length, 1,
      "exactly the managed pack, never a second one conjured by the restore");
  } finally {
    world.restore();
  }
});

test("applyBundle re-run with the same legacy bundle creates no duplicates", async () => {
  const world = bundleWorld();
  try {
    const bundle = {
      format: BUNDLE_FORMAT,
      module: "shadowdark-enhancer",
      packs: { [LEGACY_BUNDLE_PACK_KEY]: legacyPayload([generated("l1", "lib-a")]) },
    };
    await applyBundle(bundle);
    const second = await applyBundle(bundle);

    assert.equal(second.ok, true);
    assert.equal(second.packs[LEGACY_BUNDLE_PACK_KEY].created, 0);
    assert.equal(second.packs[LEGACY_BUNDLE_PACK_KEY].skippedExisting, 1);
    assert.equal(world.libraryPack.documents.length, 1);
  } finally {
    world.restore();
  }
});

test("applyBundle reports ok:false when legacy documents could not be restored", async () => {
  const world = bundleWorld();
  try {
    globalThis.Item.createDocuments = async () => []; // every write silently drops
    const report = await applyBundle({
      format: BUNDLE_FORMAT,
      module: "shadowdark-enhancer",
      packs: { [LEGACY_BUNDLE_PACK_KEY]: legacyPayload([generated("l1", "lib-a")]) },
    });

    assert.equal(report.ok, false, "a restore that lost data must not report success");
    assert.equal(report.packs[LEGACY_BUNDLE_PACK_KEY].failures, 1);
    assert.match(report.errors.join(" "), /legacy Monster Spell document\(s\) could not be restored/);
  } finally {
    world.restore();
  }
});

test("a current bundle with no legacy key behaves exactly as before", async () => {
  const world = bundleWorld();
  try {
    const report = await applyBundle({
      format: BUNDLE_FORMAT,
      module: "shadowdark-enhancer",
      packs: { items: { type: "Item", slug: "sde-items", folders: [], docs: [] } },
    });

    assert.equal(report.ok, true);
    assert.equal(report.created, 0);
    assert.equal(report.failures, 0);
    assert.equal(LEGACY_BUNDLE_PACK_KEY in report.packs, false);
    assert.equal(report.errors, undefined);
  } finally {
    world.restore();
  }
});

test("the restore never deletes — the retired pack is a compatibility shell, not a source", async () => {
  const stage = targetStage();
  // stage's deleteDocuments throws if called at all.
  await restoreLegacyMonsterSpellBundle(
    legacyPayload([generated("l1", "lib-a")]),
    stage.deps,
  );
  assert.equal(stage.target.documents.length, 1);
});
