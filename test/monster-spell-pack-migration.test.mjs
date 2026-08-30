import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMonsterSpellMigrationPayload,
  LEGACY_MONSTER_SPELL_PACK,
  monsterSpellMigrationFolderPath,
  monsterSpellMigrationIdentity,
  planMonsterSpellPackMigration,
} from "../scripts/monster-creator/monster-spell-pack-migration.mjs";
import {
  materializeMonsterSpell,
  planMonsterSpellRefresh,
} from "../scripts/monster-creator/monster-spell-library-core.mjs";

const LEGACY = LEGACY_MONSTER_SPELL_PACK.collection;

function generated(id, libraryId, {
  name = `Blast - Mage [${libraryId}]`,
  sourceLabel = "Shadowdark Core",
  variant = false,
  extra = {},
} = {}) {
  return {
    _id: id,
    name,
    type: "Spell",
    img: "icons/magic/fire/beam-jet-stream-embers.webp",
    system: { tier: 2 },
    effects: [],
    ...extra,
    flags: {
      "shadowdark-enhancer": {
        monsterSpell: {
          generated: true,
          libraryId,
          originalName: "Blast",
          sourceFingerprint: `fnv1a32:${libraryId}`,
          materializedFingerprint: `fnv1a32:m-${libraryId}`,
          variant,
          sources: [{
            actorName: "Mage",
            actorUuid: "Compendium.shadowdark.monsters.Actor.mage",
            itemId: "blast",
            itemUuid: "Compendium.shadowdark.monsters.Actor.mage.Item.blast",
            sourcePack: "shadowdark.monsters",
            sourceLabel,
          }],
          warnings: [],
        },
      },
    },
  };
}

/** What the adapter actually writes into the Items pack for one legacy doc. */
function migrated(document, sourceId, { folder = "items-folder" } = {}) {
  return buildMonsterSpellMigrationPayload(document, {
    folder,
    legacyCollection: LEGACY,
    sourceId,
  });
}

function handMade(id, name) {
  return { _id: id, name, type: "Spell", system: { tier: 1 }, effects: [], flags: {} };
}

test("an empty legacy pack plans nothing", () => {
  const plan = planMonsterSpellPackMigration([], [generated("t1", "lib-a")]);

  assert.deepEqual(plan, { move: [], alreadyPresent: [], examined: 0 });
});

test("a populated legacy pack moves every document into an empty target", () => {
  const legacy = [generated("l1", "lib-a"), generated("l2", "lib-b"), handMade("l3", "Homebrew Bolt")];

  const plan = planMonsterSpellPackMigration(legacy, []);

  assert.deepEqual(plan.move.map(op => op.sourceId), ["l1", "l2", "l3"]);
  assert.equal(plan.alreadyPresent.length, 0);
  assert.equal(plan.examined, 3);
});

test("a generated spell already in the target by libraryId is not copied again", () => {
  const plan = planMonsterSpellPackMigration(
    [generated("l1", "lib-a"), generated("l2", "lib-b")],
    [generated("t1", "lib-a")],
  );

  assert.deepEqual(plan.move.map(op => op.sourceId), ["l2"]);
  assert.deepEqual(
    plan.alreadyPresent.map(op => [op.sourceId, op.matchedBy]),
    [["l1", "libraryId"]],
  );
});

test("a partial run re-runs exactly: marked copies are recognised, the rest still move", () => {
  const first = generated("l1", "lib-a");
  const second = generated("l2", "lib-b");
  // The previous run created l1's copy and then died before emptying the pack.
  const plan = planMonsterSpellPackMigration([first, second], [migrated(first, "l1")]);

  assert.deepEqual(plan.move.map(op => op.sourceId), ["l2"]);
  assert.deepEqual(
    plan.alreadyPresent.map(op => [op.sourceId, op.matchedBy]),
    [["l1", "migrationMarker"]],
  );
});

test("a hand-made Item without provenance is re-run safe through its migration marker", () => {
  const homebrew = handMade("l3", "Homebrew Bolt");

  const first = planMonsterSpellPackMigration([homebrew], []);
  assert.deepEqual(first.move.map(op => op.sourceId), ["l3"]);
  assert.equal(first.move[0].libraryKey, null);
  assert.equal(first.move[0].migrationKey, `migrated:${LEGACY}:l3`);

  const rerun = planMonsterSpellPackMigration([homebrew], [migrated(homebrew, "l3")]);
  assert.equal(rerun.move.length, 0);
  assert.deepEqual(
    rerun.alreadyPresent.map(op => [op.sourceId, op.matchedBy]),
    [["l3", "migrationMarker"]],
  );
});

test("a same-named Item elsewhere in the Items pack never suppresses a move", () => {
  const homebrew = handMade("l3", "Homebrew Bolt");
  const unrelated = { _id: "t9", name: "Homebrew Bolt", type: "Spell", flags: {} };

  const plan = planMonsterSpellPackMigration([homebrew], [unrelated]);

  assert.deepEqual(plan.move.map(op => op.sourceId), ["l3"]);
  assert.equal(plan.alreadyPresent.length, 0);
});

test("two legacy copies of one generated spell collapse to a single target Item", () => {
  const plan = planMonsterSpellPackMigration(
    [generated("l1", "lib-a"), generated("l1-dup", "lib-a")],
    [],
  );

  assert.deepEqual(plan.move.map(op => op.sourceId), ["l1"]);
  assert.deepEqual(
    plan.alreadyPresent.map(op => [op.sourceId, op.matchedBy]),
    [["l1-dup", "libraryId"]],
  );
});

test("a fully migrated pack re-plans as a complete no-op", () => {
  const legacy = [generated("l1", "lib-a"), handMade("l3", "Homebrew Bolt")];
  const target = legacy.map(document => migrated(document, document._id));

  const plan = planMonsterSpellPackMigration(legacy, target);

  assert.equal(plan.move.length, 0);
  assert.equal(plan.alreadyPresent.length, 2);
});

test("identity reads only real generated provenance, never a bare flag", () => {
  assert.deepEqual(monsterSpellMigrationIdentity(generated("l1", "lib-a")), {
    libraryKey: "library:lib-a",
    migrationKey: null,
  });
  assert.deepEqual(
    monsterSpellMigrationIdentity({
      flags: { "shadowdark-enhancer": { monsterSpell: { libraryId: "lib-a" } } },
    }),
    { libraryKey: null, migrationKey: null },
  );
  assert.deepEqual(monsterSpellMigrationIdentity(undefined), {
    libraryKey: null,
    migrationKey: null,
  });
});

test("migrated spells are filed under their own source label, unlabelled ones under Other Sources", () => {
  assert.deepEqual(
    monsterSpellMigrationFolderPath(generated("l1", "lib-a", { sourceLabel: "Cursed Scroll 3" })),
    ["Monster Spells", "Cursed Scroll 3"],
  );
  assert.deepEqual(
    monsterSpellMigrationFolderPath(handMade("l3", "Homebrew Bolt")),
    ["Monster Spells", "Other Sources"],
  );
});

test("source-qualified variants keep their qualified name and variant marker", () => {
  const variant = generated("l1", "lib-a", {
    name: "Blast - Mage (Cursed Scroll 3)",
    sourceLabel: "Cursed Scroll 3",
    variant: true,
  });

  const plan = planMonsterSpellPackMigration([variant], []);

  const moved = plan.move[0].document;
  assert.equal(moved.name, "Blast - Mage (Cursed Scroll 3)");
  assert.equal(moved.flags["shadowdark-enhancer"].monsterSpell.variant, true);
  assert.deepEqual(monsterSpellMigrationFolderPath(moved), ["Monster Spells", "Cursed Scroll 3"]);
});

test("migrated documents keep a reconciliation identity the refresh treats as unchanged", () => {
  // The whole point of copying provenance verbatim: the next library refresh
  // must recognise the migrated copies instead of generating a second set.
  const entry = {
    name: "Blast - Mage",
    originalName: "Blast",
    fingerprint: "fnv1a32:lib-a",
    libraryId: "lib-a",
    data: { name: "Blast", type: "Spell", img: null, system: { tier: 2 }, effects: [] },
    sources: [{
      actorName: "Mage",
      actorUuid: "Compendium.shadowdark.monsters.Actor.mage",
      itemId: "blast",
      itemUuid: "Compendium.shadowdark.monsters.Actor.mage.Item.blast",
      sourcePack: "shadowdark.monsters",
      sourceLabel: "Shadowdark Core",
      sourceVersion: "",
      systemVersion: "",
      coreVersion: "",
      moduleVersion: "",
    }],
    warnings: [],
    variant: false,
  };
  // Materialize the way the library itself would, then migrate that document.
  const legacyDocument = { _id: "l1", ...materializeMonsterSpell(entry, { folder: "legacy-folder" }) };

  const plan = planMonsterSpellPackMigration([legacyDocument], []);
  const targetDocument = { _id: "t1", ...migrated(plan.move[0].document, "l1") };

  const refresh = planMonsterSpellRefresh([entry], [targetDocument], {
    refreshedSourcePacks: ["shadowdark.monsters"],
  });

  assert.equal(refresh.create.length, 0);
  assert.equal(refresh.conflict.length, 0);
  assert.equal(refresh.stale.length, 0);
  assert.equal(refresh.unchanged.length, 1);
});
