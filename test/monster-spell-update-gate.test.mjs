import test from "node:test";
import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";

import {
  automaticMonsterSpellSourceIds,
  MONSTER_SPELL_SYNC_VERSION_SETTING,
  resetMonsterSpellUpdateGateSession,
  runMonsterSpellUpdateGate,
} from "../scripts/monster-creator/monster-spell-update-gate.mjs";
import { runMonsterSpellLibraryRefresh } from "../scripts/monster-creator/monster-spell-library.mjs";

const MODULE_ID = "shadowdark-enhancer";
const MODULE_VERSION = "0.15.1";

function actorPack(collection, label) {
  return {
    collection,
    documentName: "Actor",
    metadata: { label, packageType: collection.startsWith("world.") ? "world" : "system" },
    async getDocuments() { return []; },
  };
}

/** The retired world.shadowdark-enhancer--monster-spells pack, holding `ids`. */
function legacyPack(ids = []) {
  return {
    collection: "world.shadowdark-enhancer--monster-spells",
    async getIndex() { return ids.map(_id => ({ _id, type: "Spell" })); },
  };
}

/**
 * A game double with a settings store that records every write, so "the stamp
 * did not advance" can be asserted as "nothing was written" rather than as
 * "the value happens to still read the same".
 */
function makeGame({
  isGM = true,
  userId = "gm-1",
  activeGMId = "gm-1",
  version = MODULE_VERSION,
  stamp = "",
  packs = [
    actorPack("shadowdark.monsters", "Monsters"),
    actorPack("world.sde-actors", "Shadowdark Enhancer — Actors"),
    actorPack("other-module.monsters", "Other Monsters"),
  ],
} = {}) {
  const store = new Map([[MONSTER_SPELL_SYNC_VERSION_SETTING, stamp]]);
  const writes = [];
  return {
    writes,
    user: { id: userId, isGM },
    users: { activeGM: activeGMId ? { id: activeGMId } : null },
    system: { version: "4.0.6" },
    modules: new Map(version ? [[MODULE_ID, { version }]] : []),
    packs,
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        return store.get(key) ?? "";
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        writes.push([key, value]);
        store.set(key, value);
        return value;
      },
    },
  };
}

const silent = { error() {} };

function recorder({ migrate = { status: "absent" }, sync = { created: 3 } } = {}) {
  const calls = { migrate: [], sync: [] };
  return {
    calls,
    migrate: async options => {
      calls.migrate.push(options);
      if (migrate instanceof Error) throw migrate;
      return migrate;
    },
    sync: async options => {
      calls.sync.push(options);
      if (sync instanceof Error) throw sync;
      return sync;
    },
  };
}

test("a first activation on a new version refreshes and then stamps the version", async () => {
  const game = makeGame();
  const spy = recorder();

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.equal(outcome.status, "synced");
  assert.equal(outcome.version, MODULE_VERSION);
  assert.equal(spy.calls.sync.length, 1);
  assert.deepEqual(game.writes, [[MONSTER_SPELL_SYNC_VERSION_SETTING, MODULE_VERSION]]);
});

test("a second activation at the same version writes nothing and never refreshes", async () => {
  const game = makeGame({ stamp: MODULE_VERSION });
  const spy = recorder();

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.deepEqual(outcome, {
    status: "skipped",
    reason: "up-to-date",
    version: MODULE_VERSION,
    migration: { status: "absent" },
    migrationError: null,
  });
  assert.equal(spy.calls.sync.length, 0);
  assert.deepEqual(game.writes, []);
});

test("the legacy consolidation still runs on an activation the refresh skips", async () => {
  const game = makeGame({ stamp: MODULE_VERSION });
  const spy = recorder({ migrate: { status: "migrated", moved: 4 } });

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.equal(spy.calls.migrate.length, 1);
  assert.deepEqual(outcome.migration, { status: "migrated", moved: 4 });
  assert.deepEqual(game.writes, []);
});

test("a bumped module version refreshes again", async () => {
  const game = makeGame({ stamp: "0.15.0" });
  const spy = recorder();

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.equal(outcome.status, "synced");
  assert.deepEqual(game.writes, [[MONSTER_SPELL_SYNC_VERSION_SETTING, MODULE_VERSION]]);
});

test("a failed refresh does not advance the stamp, so the next activation retries", async () => {
  const game = makeGame();
  const spy = recorder({ sync: new Error("pack write rejected") });

  const failed = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.stage, "sync");
  assert.deepEqual(game.writes, []);

  // Same world, next activation: the stamp is still empty, so the gate is open.
  const retry = recorder();
  const second = await runMonsterSpellUpdateGate({
    game, migrate: retry.migrate, sync: retry.sync, log: silent,
  });
  assert.equal(second.status, "synced");
  assert.deepEqual(game.writes, [[MONSTER_SPELL_SYNC_VERSION_SETTING, MODULE_VERSION]]);
});

test("a failed consolidation defers the refresh while the retired pack still holds content", async () => {
  // Consolidation moves legacy documents verbatim, curated GM edits included;
  // the refresh regenerates from source Actors. Refreshing over a half-moved
  // pack lets a generated copy take the identity a curated original had not
  // reached yet, and the next consolidation then deletes that original as
  // "already present".
  const game = makeGame();
  const spy = recorder({ migrate: new Error("legacy pack locked") });

  const outcome = await runMonsterSpellUpdateGate({
    game,
    migrate: spy.migrate,
    sync: spy.sync,
    findLegacyPack: () => legacyPack(["curated-spell"]),
    notifications: { warn() {} },
    log: silent,
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stage, "migration");
  assert.equal(outcome.legacyPopulated, true);
  assert.equal(spy.calls.sync.length, 0);
  assert.deepEqual(game.writes, []);

  // Still retryable: a later activation whose consolidation succeeds refreshes
  // and stamps as normal.
  const retry = recorder();
  const second = await runMonsterSpellUpdateGate({
    game, migrate: retry.migrate, sync: retry.sync, log: silent,
  });
  assert.equal(second.status, "synced");
  assert.deepEqual(game.writes, [[MONSTER_SPELL_SYNC_VERSION_SETTING, MODULE_VERSION]]);
});

/**
 * A1's real partial-failure result — `migrateMonsterSpellPack` resolves with
 * this (it does NOT throw) when it created copies it could not verify in the
 * target, and keeps those originals in the retired pack so a later run retries
 * them. Shape copied from monster-spell-pack-migration.mjs; the A1 adapter test
 * "an original whose copy cannot be verified is kept and the run stays
 * retryable" produces exactly this status/remaining pair.
 */
function incompleteMigration({ examined = 2, deleted = 1, remaining = 1 } = {}) {
  return {
    status: "incomplete",
    legacyCollection: "world.shadowdark-enhancer--monster-spells",
    targetCollection: "world.sde-items",
    examined,
    moved: examined,
    alreadyPresent: 0,
    deleted,
    remaining,
    foldersRemoved: 0,
  };
}

test("a consolidation that RETURNS incomplete defers exactly like one that throws", async () => {
  // The A2 blocker: `incomplete` resolves normally, so a gate that only watches
  // the catch refreshes over originals A1 deliberately kept for a retry, and
  // stamps the version — letting the next consolidation delete the curated
  // original as "already present".
  resetMonsterSpellUpdateGateSession();
  const game = makeGame();
  const warns = [];
  const spy = recorder({ migrate: incompleteMigration() });
  const deps = {
    game,
    migrate: spy.migrate,
    sync: spy.sync,
    findLegacyPack: () => legacyPack(["retained-curated-spell"]),
    notifications: { warn: message => warns.push(message) },
    log: silent,
  };

  const first = await runMonsterSpellUpdateGate(deps);
  const second = await runMonsterSpellUpdateGate(deps);

  assert.equal(first.status, "failed");
  assert.equal(first.stage, "migration");
  assert.equal(first.reason, "consolidation-incomplete");
  assert.equal(first.legacyPopulated, true);
  assert.equal(first.migration.remaining, 1, "the A1 result travels with the outcome");
  assert.equal(first.migrationError, null, "nothing threw — this is a returned failure");
  assert.equal(second.status, "failed", "it keeps deferring until the retry succeeds");

  assert.equal(spy.calls.sync.length, 0, "zero refreshes");
  assert.deepEqual(game.writes, [], "zero setting writes");
  assert.equal(first.warned, true);
  assert.equal(second.warned, false);
  assert.equal(warns.length, 1, "warned once per session, not once per activation");

  // A later activation whose consolidation completes refreshes and stamps.
  const retry = recorder({ migrate: { status: "migrated", moved: 1, remaining: 0 } });
  const third = await runMonsterSpellUpdateGate({
    game, migrate: retry.migrate, sync: retry.sync, log: silent,
  });
  assert.equal(third.status, "synced");
  assert.equal(retry.calls.sync.length, 1);
  assert.deepEqual(game.writes, [[MONSTER_SPELL_SYNC_VERSION_SETTING, MODULE_VERSION]]);
});

test("a returned incomplete over an already-empty retired pack may still continue", async () => {
  // The bounded rule is the pack state, not the failure shape: with nothing left
  // in the retired pack there is no verbatim original for a refresh to regenerate
  // over, so the same `incomplete` result must not strand the library.
  const game = makeGame();
  const spy = recorder({ migrate: incompleteMigration({ examined: 1, deleted: 1, remaining: 0 }) });

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, findLegacyPack: () => legacyPack([]), log: silent,
  });

  assert.equal(outcome.status, "synced");
  assert.equal(spy.calls.sync.length, 1);
  assert.deepEqual(game.writes, [[MONSTER_SPELL_SYNC_VERSION_SETTING, MODULE_VERSION]]);
});

test("a returned incomplete with an unreadable retired pack defers", async () => {
  const game = makeGame();
  const spy = recorder({ migrate: incompleteMigration() });

  const outcome = await runMonsterSpellUpdateGate({
    game,
    migrate: spy.migrate,
    sync: spy.sync,
    findLegacyPack: () => ({ async getIndex() { throw new Error("index unavailable"); } }),
    notifications: { warn() {} },
    log: silent,
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "consolidation-incomplete");
  assert.equal(spy.calls.sync.length, 0);
  assert.deepEqual(game.writes, []);
});

test("a completed consolidation is not mistaken for a failure", async () => {
  // The guard keys on "incomplete" exactly; `migrated`, `empty` and `absent` are
  // successes even though they also resolve with a status string.
  for (const migration of [
    { status: "migrated", moved: 4, remaining: 0 },
    { status: "empty", examined: 0 },
    { status: "absent", moved: 0 },
  ]) {
    const game = makeGame();
    const spy = recorder({ migrate: migration });
    const outcome = await runMonsterSpellUpdateGate({
      game,
      migrate: spy.migrate,
      sync: spy.sync,
      findLegacyPack: () => legacyPack(["something-unrelated"]),
      log: silent,
    });
    assert.equal(outcome.status, "synced", `${migration.status} must not defer`);
    assert.equal(spy.calls.sync.length, 1);
  }
});

test("a failed consolidation over an EMPTY retired pack does not block the refresh", async () => {
  const game = makeGame();
  const spy = recorder({ migrate: new Error("legacy pack locked") });

  const outcome = await runMonsterSpellUpdateGate({
    game,
    migrate: spy.migrate,
    sync: spy.sync,
    findLegacyPack: () => legacyPack([]),
    log: silent,
  });

  assert.equal(outcome.status, "synced");
  assert.equal(spy.calls.sync.length, 1);
  assert.ok(outcome.migrationError, "the consolidation error is still reported");
  assert.deepEqual(game.writes, [[MONSTER_SPELL_SYNC_VERSION_SETTING, MODULE_VERSION]]);
});

test("a failed consolidation with no retired pack at all does not block the refresh", async () => {
  const game = makeGame();
  const spy = recorder({ migrate: new Error("consolidation exploded early") });

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, findLegacyPack: () => undefined, log: silent,
  });

  assert.equal(outcome.status, "synced");
  assert.deepEqual(game.writes, [[MONSTER_SPELL_SYNC_VERSION_SETTING, MODULE_VERSION]]);
});

test("an unreadable retired pack defers rather than guessing it is empty", async () => {
  const game = makeGame();
  const spy = recorder({ migrate: new Error("legacy pack locked") });

  const outcome = await runMonsterSpellUpdateGate({
    game,
    migrate: spy.migrate,
    sync: spy.sync,
    findLegacyPack: () => ({ async getIndex() { throw new Error("index unavailable"); } }),
    notifications: { warn() {} },
    log: silent,
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.legacyPopulated, true);
  assert.equal(spy.calls.sync.length, 0);
});

test("the deferral is surfaced to the GM once per session, not once per activation", async () => {
  resetMonsterSpellUpdateGateSession();
  const warned = [];
  const notifications = { warn: message => warned.push(message) };
  const deferOnce = async () => runMonsterSpellUpdateGate({
    game: makeGame(),
    migrate: async () => { throw new Error("legacy pack locked"); },
    sync: async () => ({ created: 0 }),
    findLegacyPack: () => legacyPack(["curated-spell"]),
    notifications,
    log: silent,
  });

  const first = await deferOnce();
  const second = await deferOnce();

  assert.equal(first.warned, true);
  assert.equal(second.warned, false, "a warning per activation would train people to ignore it");
  assert.equal(warned.length, 1);
  assert.match(warned[0], /Build \/ Refresh/, "the warning must name the manual workaround");
});

test("a failed stamp is reported as a failure rather than a silent success", async () => {
  const game = makeGame();
  game.settings.set = async () => { throw new Error("setting write rejected"); };
  const spy = recorder();

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stage, "stamp");
});

test("only the single active GM refreshes when two GM clients are online", async () => {
  const primary = makeGame({ userId: "gm-1", activeGMId: "gm-1" });
  const secondary = makeGame({ userId: "gm-2", activeGMId: "gm-1" });
  const primarySpy = recorder();
  const secondarySpy = recorder();

  const [primaryOutcome, secondaryOutcome] = await Promise.all([
    runMonsterSpellUpdateGate({
      game: primary, migrate: primarySpy.migrate, sync: primarySpy.sync, log: silent,
    }),
    runMonsterSpellUpdateGate({
      game: secondary, migrate: secondarySpy.migrate, sync: secondarySpy.sync, log: silent,
    }),
  ]);

  assert.equal(primaryOutcome.status, "synced");
  assert.deepEqual(secondaryOutcome, { status: "skipped", reason: "not-active-gm" });
  assert.equal(secondarySpy.calls.migrate.length, 0);
  assert.equal(secondarySpy.calls.sync.length, 0);
  assert.deepEqual(secondary.writes, []);
  assert.deepEqual(primary.writes, [[MONSTER_SPELL_SYNC_VERSION_SETTING, MODULE_VERSION]]);
});

test("the active GM is read at execution time, not when ready scheduled the run", async () => {
  const game = makeGame({ userId: "gm-1", activeGMId: "gm-1" });
  // The primary disconnects between `ready` and the deferred run: another client
  // is the active GM by the time the gate actually fires.
  game.users.activeGM = { id: "gm-2" };
  const spy = recorder();

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.deepEqual(outcome, { status: "skipped", reason: "not-active-gm" });
  assert.deepEqual(game.writes, []);
});

test("a refresh that declined to run does not stamp", async () => {
  // syncMonsterSpellLibrary re-checks the active GM itself and returns null when
  // it loses that race — which can happen while the consolidation is awaited.
  const game = makeGame();
  const spy = recorder({ sync: null });

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "not-refreshed");
  assert.deepEqual(game.writes, []);
});

test("a player client does nothing at all", async () => {
  const game = makeGame({ isGM: false });
  const spy = recorder();

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.deepEqual(outcome, { status: "skipped", reason: "not-gm" });
  assert.equal(spy.calls.migrate.length, 0);
  assert.deepEqual(game.writes, []);
});

test("an unknown module version consolidates but never refreshes, because it could not be remembered", async () => {
  const game = makeGame({ version: "" });
  const spy = recorder();

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "unknown-version");
  assert.equal(spy.calls.migrate.length, 1);
  assert.equal(spy.calls.sync.length, 0);
  assert.deepEqual(game.writes, []);
});

test("the automatic run scans Core plus the managed Enhancer Actors pack and nothing else", async () => {
  const game = makeGame();
  const spy = recorder();

  await runMonsterSpellUpdateGate({ game, migrate: spy.migrate, sync: spy.sync, log: silent });

  assert.deepEqual(spy.calls.sync[0].sourceIds, ["shadowdark.monsters", "world.sde-actors"]);
});

test("source selection ignores a third-party monster compendium even when the library offers it", () => {
  const game = makeGame();
  const listSources = () => [
    { id: "shadowdark.monsters" },
    { id: "world.sde-actors" },
    { id: "third-party.monsters" },
  ];

  assert.deepEqual(
    automaticMonsterSpellSourceIds({ game, listSources }),
    ["shadowdark.monsters", "world.sde-actors"],
  );
});

test("a world without the managed Actors pack automatically scans Core alone", () => {
  const game = makeGame({ packs: [actorPack("shadowdark.monsters", "Monsters")] });

  assert.deepEqual(automaticMonsterSpellSourceIds({ game }), ["shadowdark.monsters"]);
});

test("no installed source leaves the stamp alone so a later activation still runs", async () => {
  const game = makeGame({ packs: [] });
  const spy = recorder();

  const outcome = await runMonsterSpellUpdateGate({
    game, migrate: spy.migrate, sync: spy.sync, log: silent,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "no-sources");
  assert.equal(spy.calls.sync.length, 0);
  assert.deepEqual(game.writes, []);
});

test("manual Build / Refresh never reads the stamp, so it repairs a world the gate is skipping", async () => {
  // This is the documented workaround when the gate defers, so it has to work
  // in exactly the state the gate refuses to act in: stamp current.
  const game = makeGame({ stamp: MODULE_VERSION });
  game.settings.get = (_moduleId, key) => {
    if (key === MONSTER_SPELL_SYNC_VERSION_SETTING) {
      throw new Error("the manual path must not consult the update-gate stamp");
    }
    return "";
  };
  let applied = false;
  const sources = [{ id: "shadowdark.monsters", label: "Shadowdark Core", pack: actorPack("shadowdark.monsters", "Monsters") }];

  const result = await runMonsterSpellLibraryRefresh({
    game,
    sources,
    targetPack: { collection: "world.sde-items", async getDocuments() { return []; } },
    chooseSources: async available => available,
    confirm: async () => true,
    apply: async () => {
      applied = true;
      return { created: 0, updated: 0, unchanged: 0, conflict: 0, stale: 0 };
    },
  });

  assert.ok(applied);
  assert.ok(result);
  assert.deepEqual(game.writes, [], "manual repair must not move the automatic stamp");
});

test("the manual refresh module carries neither the stamp nor the consolidation", async () => {
  // The structural half of the same guarantee: the manual path cannot become
  // gate-dependent by accident, and cannot start running the consolidation whose
  // failure is the very thing it exists to work around.
  const library = await readFile(
    new URL("../scripts/monster-creator/monster-spell-library.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(library, /monsterSpellSyncVersion/);
  assert.doesNotMatch(library, /migrateMonsterSpellPack/);
});
