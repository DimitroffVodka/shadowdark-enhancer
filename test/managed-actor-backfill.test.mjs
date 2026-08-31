/**
 * A6 — managed-Actor backfill runner, pure lifecycle suite.
 *
 * Everything here runs without Foundry: the runner takes `game`, the pack
 * lookup, and the transform as injected collaborators, so the whole gate
 * (active GM, version stamp, per-document outcomes, advance-only-on-complete-
 * success) is exercisable against plain objects.
 *
 * The doubles record WRITES rather than final values, so "the stamp did not
 * advance" is asserted as "nothing was written" instead of "the value happens
 * to still read the same" — the A2 convention, kept deliberately.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  isManagedActorPack,
  runManagedActorBackfill,
} from "../scripts/importer/monsters/managed-actor-backfill.mjs";

const MODULE_ID = "shadowdark-enhancer";
const MODULE_VERSION = "0.13.1";
const SETTING = "creatureTypeBackfillVersion";

/** A compendium Actor double that records every write made to it. */
function actorDouble({ id, name, type = "NPC", flags = {} } = {}) {
  const writes = [];
  return {
    id,
    uuid: `Compendium.world.shadowdark-enhancer--actors.Actor.${id}`,
    name,
    type,
    flags,
    writes,
    items: [],
    async update(data) {
      writes.push(["update", data]);
      return this;
    },
    async updateEmbeddedDocuments(embeddedName, updates) {
      writes.push(["updateEmbeddedDocuments", embeddedName, updates]);
      return updates;
    },
  };
}

/** The managed Enhancer Actors pack (`world.shadowdark-enhancer--actors`), holding `actors`. */
function managedPack(actors = [], { getDocuments } = {}) {
  return {
    collection: "world.shadowdark-enhancer--actors",
    documentName: "Actor",
    metadata: { label: "Shadowdark Enhancer — Actors", packageType: "world" },
    getDocuments: getDocuments ?? (async () => actors),
  };
}

/** The Shadowdark system's Core monster pack — never a legal target. */
function corePack() {
  return {
    collection: "shadowdark.monsters",
    documentName: "Actor",
    metadata: { label: "Monsters", packageType: "system" },
    async getDocuments() {
      throw new Error("the runner must never read a Core/source pack");
    },
  };
}

function makeGame({
  isGM = true,
  userId = "gm-1",
  activeGMId = "gm-1",
  version = MODULE_VERSION,
  stamps = {},
  setThrows = false,
} = {}) {
  const store = new Map(Object.entries(stamps));
  const writes = [];
  const activeGM = { id: activeGMId };
  return {
    writes,
    // Mutable so a test can hand the crown to another client mid-run.
    users: { activeGM: activeGMId ? activeGM : null },
    user: { id: userId, isGM },
    modules: new Map(version ? [[MODULE_ID, { version }]] : []),
    get actors() {
      throw new Error("the runner must never touch world Actors");
    },
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        return store.get(key) ?? "";
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        if (setThrows) throw new Error("settings store is read-only");
        writes.push([key, value]);
        store.set(key, value);
        return value;
      },
    },
  };
}

const silent = { error() {}, warn() {} };

/** A transform that records its calls and stamps one flag onto every actor. */
function stampEveryone() {
  const seen = [];
  return {
    seen,
    transform(actor) {
      seen.push(actor.id);
      return { update: { "flags.shadowdark-enhancer.creatureType": "beast" } };
    },
  };
}

const baseOpts = { id: "creature-types", versionSetting: SETTING, log: silent };

// ─── Pack identity ─────────────────────────────────────────────────────────

test("only the two managed Enhancer Actor packs are recognised", () => {
  assert.equal(isManagedActorPack(managedPack()), true);
  assert.equal(
    isManagedActorPack({
      collection: "world.shadowdark-enhancer--actors",
      documentName: "Actor",
      metadata: { label: "Shadowdark Enhancer — Imported Monsters", packageType: "world" },
    }),
    true,
    "the retired Imported Monsters pack is still managed content",
  );
  assert.equal(isManagedActorPack(corePack()), false);
  assert.equal(
    isManagedActorPack({
      documentName: "Actor",
      metadata: { label: "Shadowdark Enhancer — Actors", packageType: "module" },
    }),
    false,
    "a module-shipped pack wearing the label is not this world's managed pack",
  );
  assert.equal(
    isManagedActorPack({
      documentName: "Item",
      metadata: { label: "Shadowdark Enhancer — Actors", packageType: "world" },
    }),
    false,
  );
  assert.equal(isManagedActorPack(null), false);
});

// ─── Success and the version gate ──────────────────────────────────────────

test("a first run applies the transform to every managed actor and then stamps", async () => {
  const actors = [actorDouble({ id: "a1", name: "Goblin" }), actorDouble({ id: "a2", name: "Kobold" })];
  const game = makeGame();
  const spy = stampEveryone();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => managedPack(actors), transform: spy.transform,
  });

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.version, MODULE_VERSION);
  assert.equal(outcome.total, 2);
  assert.deepEqual(outcome.applied.map(o => o.name), ["Goblin", "Kobold"]);
  assert.deepEqual(outcome.skipped, []);
  assert.deepEqual(outcome.failed, []);
  assert.equal(outcome.stamped, true);
  assert.deepEqual(game.writes, [[SETTING, MODULE_VERSION]]);
  assert.deepEqual(actors[0].writes, [["update", { "flags.shadowdark-enhancer.creatureType": "beast" }]]);
  assert.deepEqual(actors[1].writes, [["update", { "flags.shadowdark-enhancer.creatureType": "beast" }]]);
});

test("a second run at the same version writes nothing and never reads the pack", async () => {
  const game = makeGame({ stamps: { [SETTING]: MODULE_VERSION } });
  const spy = stampEveryone();
  let packLookups = 0;

  const outcome = await runManagedActorBackfill({
    ...baseOpts,
    game,
    findPack: () => { packLookups++; return managedPack(); },
    transform: spy.transform,
  });

  assert.deepEqual(outcome, {
    status: "skipped",
    reason: "up-to-date",
    id: "creature-types",
    version: MODULE_VERSION,
    total: 0,
    applied: [],
    skipped: [],
    failed: [],
    stamped: false,
  });
  assert.equal(packLookups, 0, "the gate short-circuits before the pack lookup");
  assert.deepEqual(spy.seen, []);
  assert.deepEqual(game.writes, []);
});

test("a rerun with a missing-only transform completes with zero document writes", async () => {
  // The stamp was cleared, so the gate opens again — idempotence now has to come
  // from the transform, exactly as it will for E2/E3.
  const actors = [
    actorDouble({ id: "a1", name: "Goblin", flags: { "shadowdark-enhancer": { creatureType: "humanoid" } } }),
    actorDouble({ id: "a2", name: "Kobold", flags: { "shadowdark-enhancer": { creatureType: "humanoid" } } }),
  ];
  const game = makeGame();
  const missingOnly = actor =>
    actor.flags?.["shadowdark-enhancer"]?.creatureType
      ? null
      : { update: { "flags.shadowdark-enhancer.creatureType": "beast" } };

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => managedPack(actors), transform: missingOnly,
  });

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.applied, []);
  assert.deepEqual(outcome.skipped.map(o => o.name), ["Goblin", "Kobold"]);
  assert.deepEqual(actors.flatMap(a => a.writes), [], "no document was touched");
  assert.deepEqual(game.writes, [[SETTING, MODULE_VERSION]], "a complete no-op run still stamps");
});

test("an empty payload counts as skipped rather than a write", async () => {
  const actors = [actorDouble({ id: "a1", name: "Goblin" })];
  const game = makeGame();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => managedPack(actors), transform: () => ({ update: {}, itemUpdates: [] }),
  });

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.applied, []);
  assert.deepEqual(outcome.skipped.map(o => o.id), ["a1"]);
  assert.deepEqual(actors[0].writes, []);
});

test("embedded item updates are applied through the actor, not the pack", async () => {
  const actors = [actorDouble({ id: "a1", name: "Goblin" })];
  const game = makeGame();
  const itemUpdates = [{ _id: "i1", "system.description": "<p>enriched</p>" }];

  const outcome = await runManagedActorBackfill({
    ...baseOpts,
    game,
    findPack: () => managedPack(actors),
    transform: () => ({ itemUpdates, detail: { enriched: 1 } }),
  });

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.applied[0].detail, { enriched: 1 });
  assert.deepEqual(actors[0].writes, [["updateEmbeddedDocuments", "Item", itemUpdates]]);
});

test("outcomes are ordered by name then id regardless of pack order", async () => {
  const actors = [
    actorDouble({ id: "z", name: "Wyvern" }),
    actorDouble({ id: "b", name: "Goblin" }),
    actorDouble({ id: "a", name: "Goblin" }),
    actorDouble({ id: "m", name: "Kobold" }),
  ];
  const game = makeGame();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => managedPack(actors), transform: () => null,
  });

  assert.deepEqual(outcome.skipped.map(o => o.id), ["a", "b", "m", "z"]);
});

test("select narrows what the runner offers the transform", async () => {
  const actors = [
    actorDouble({ id: "a1", name: "Goblin", type: "NPC" }),
    actorDouble({ id: "a2", name: "Rowboat", type: "Boat" }),
  ];
  const game = makeGame();
  const spy = stampEveryone();

  const outcome = await runManagedActorBackfill({
    ...baseOpts,
    game,
    findPack: () => managedPack(actors),
    select: actor => actor.type === "NPC",
    transform: spy.transform,
  });

  assert.equal(outcome.total, 1);
  assert.deepEqual(spy.seen, ["a1"]);
  assert.deepEqual(actors[1].writes, []);
});

// ─── Nothing to run against ────────────────────────────────────────────────

test("an absent managed pack skips without stamping", async () => {
  const game = makeGame();
  const spy = stampEveryone();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => undefined, transform: spy.transform,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "no-pack");
  assert.equal(outcome.stamped, false);
  assert.deepEqual(spy.seen, []);
  assert.deepEqual(game.writes, [], "a world that has not imported yet must stay eligible");
});

test("an empty managed pack skips without stamping", async () => {
  const game = makeGame();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => managedPack([]), transform: () => ({ update: { x: 1 } }),
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "no-actors");
  assert.equal(outcome.total, 0);
  assert.deepEqual(game.writes, [], "stamping an empty pack would strand actors imported later");
});

test("a pack that is not the managed Enhancer Actors pack is refused", async () => {
  const game = makeGame();
  const errors = [];

  const outcome = await runManagedActorBackfill({
    ...baseOpts,
    game,
    log: { error: (...args) => errors.push(args) },
    findPack: () => corePack(),
    transform: () => ({ update: { x: 1 } }),
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "unmanaged-pack");
  assert.deepEqual(game.writes, []);
  assert.equal(errors.length, 1, "refusing to write outside managed content is worth logging");
});

test("a pack that cannot be read fails without stamping", async () => {
  const game = makeGame();
  const boom = new Error("pack index unavailable");

  const outcome = await runManagedActorBackfill({
    ...baseOpts,
    game,
    findPack: () => managedPack([], { getDocuments: async () => { throw boom; } }),
    transform: () => ({ update: { x: 1 } }),
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stage, "pack");
  assert.equal(outcome.error, boom);
  assert.deepEqual(game.writes, []);
});

test("no version to stamp means no run", async () => {
  const game = makeGame({ version: "" });
  const spy = stampEveryone();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => managedPack([actorDouble({ id: "a1", name: "Goblin" })]), transform: spy.transform,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "unknown-version");
  assert.deepEqual(spy.seen, []);
  assert.deepEqual(game.writes, []);
});

// ─── Active-GM selection ───────────────────────────────────────────────────

test("a non-GM never runs", async () => {
  const game = makeGame({ isGM: false });
  const spy = stampEveryone();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => managedPack([actorDouble({ id: "a1", name: "Goblin" })]), transform: spy.transform,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "not-gm");
  assert.deepEqual(spy.seen, []);
  assert.deepEqual(game.writes, []);
});

test("a second GM that is not the active GM performs no work", async () => {
  const game = makeGame({ userId: "gm-2", activeGMId: "gm-1" });
  const actors = [actorDouble({ id: "a1", name: "Goblin" })];
  const spy = stampEveryone();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => managedPack(actors), transform: spy.transform,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "not-active-gm");
  assert.deepEqual(spy.seen, []);
  assert.deepEqual(actors[0].writes, []);
  assert.deepEqual(game.writes, []);
});

test("losing the active-GM race while the pack loads aborts before the first write", async () => {
  // `game.users.activeGM` can name a different client seconds after the check
  // that scheduled this. The pack load is the await where that happens.
  const game = makeGame();
  const actors = [actorDouble({ id: "a1", name: "Goblin" })];
  const spy = stampEveryone();

  const outcome = await runManagedActorBackfill({
    ...baseOpts,
    game,
    findPack: () => managedPack(actors, {
      getDocuments: async () => {
        game.users.activeGM = { id: "gm-2" };
        return actors;
      },
    }),
    transform: spy.transform,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "superseded");
  assert.deepEqual(spy.seen, [], "the winner of the race owns the writes");
  assert.deepEqual(actors[0].writes, []);
  assert.deepEqual(game.writes, []);
});

test("a world with no active GM recorded still runs for a GM", async () => {
  const game = makeGame({ activeGMId: null });
  const actors = [actorDouble({ id: "a1", name: "Goblin" })];

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, findPack: () => managedPack(actors), transform: () => ({ update: { x: 1 } }),
  });

  assert.equal(outcome.status, "completed");
  assert.deepEqual(game.writes, [[SETTING, MODULE_VERSION]]);
});

// ─── Partial failure ───────────────────────────────────────────────────────

test("a transform that throws for one document leaves the rest applied and the gate retryable", async () => {
  const actors = [
    actorDouble({ id: "a1", name: "Goblin" }),
    actorDouble({ id: "a2", name: "Kobold" }),
    actorDouble({ id: "a3", name: "Wyvern" }),
  ];
  const game = makeGame();
  const boom = new Error("no map entry");
  const errors = [];

  const outcome = await runManagedActorBackfill({
    ...baseOpts,
    game,
    log: { error: (...args) => errors.push(args) },
    findPack: () => managedPack(actors),
    transform: actor => {
      if (actor.id === "a2") throw boom;
      return { update: { "flags.shadowdark-enhancer.creatureType": "beast" } };
    },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stage, "documents");
  assert.deepEqual(outcome.applied.map(o => o.name), ["Goblin", "Wyvern"]);
  assert.equal(outcome.failed.length, 1);
  assert.equal(outcome.failed[0].name, "Kobold");
  assert.equal(outcome.failed[0].reason, "transform-threw");
  assert.equal(outcome.failed[0].error, boom);
  assert.equal(outcome.failed[0].message, "no map entry");
  assert.equal(outcome.stamped, false);
  assert.deepEqual(game.writes, [], "a partial run must stay retryable on the next activation");
  assert.equal(actors[1].writes.length, 0, "the failing document is left untouched");
  assert.equal(errors.length, 1);
});

test("a rejected document write is reported per document, not as an aborted batch", async () => {
  const actors = [actorDouble({ id: "a1", name: "Goblin" }), actorDouble({ id: "a2", name: "Kobold" })];
  const boom = new Error("document is locked");
  actors[0].update = async () => { throw boom; };
  const game = makeGame();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, log: silent, findPack: () => managedPack(actors), transform: () => ({ update: { x: 1 } }),
  });

  assert.equal(outcome.status, "failed");
  assert.deepEqual(outcome.failed.map(o => [o.name, o.reason]), [["Goblin", "write-failed"]]);
  assert.deepEqual(outcome.applied.map(o => o.name), ["Kobold"], "one bad document does not abort the sweep");
  assert.deepEqual(game.writes, []);
});

test("a retry after a partial failure applies only what is still missing and then stamps", async () => {
  const applied = new Set();
  const actors = [
    actorDouble({ id: "a1", name: "Goblin" }),
    actorDouble({ id: "a2", name: "Kobold" }),
  ];
  const game = makeGame();
  let failNext = true;
  const transform = actor => {
    if (actor.id === "a2" && failNext) throw new Error("transient");
    if (applied.has(actor.id)) return null;
    applied.add(actor.id);
    return { update: { "flags.shadowdark-enhancer.creatureType": "beast" } };
  };
  const opts = { ...baseOpts, game, findPack: () => managedPack(actors), transform };

  const first = await runManagedActorBackfill(opts);
  assert.equal(first.status, "failed");
  assert.deepEqual(game.writes, []);

  failNext = false;
  const second = await runManagedActorBackfill(opts);

  assert.equal(second.status, "completed");
  assert.deepEqual(second.applied.map(o => o.name), ["Kobold"], "Goblin was already done");
  assert.deepEqual(second.skipped.map(o => o.name), ["Goblin"]);
  assert.deepEqual(game.writes, [[SETTING, MODULE_VERSION]]);
  assert.equal(actors[0].writes.length, 1, "the already-applied document is written exactly once");
});

test("a payload that is not an object fails that document without writing", async () => {
  const actors = [actorDouble({ id: "a1", name: "Goblin" })];
  const game = makeGame();

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, log: silent, findPack: () => managedPack(actors), transform: () => "yes",
  });

  assert.equal(outcome.status, "failed");
  assert.deepEqual(outcome.failed.map(o => o.reason), ["invalid-payload"]);
  assert.deepEqual(actors[0].writes, []);
});

test("a stamp write that fails is reported and leaves the run retryable", async () => {
  const actors = [actorDouble({ id: "a1", name: "Goblin" })];
  const game = makeGame({ setThrows: true });

  const outcome = await runManagedActorBackfill({
    ...baseOpts, game, log: silent, findPack: () => managedPack(actors), transform: () => ({ update: { x: 1 } }),
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stage, "stamp");
  assert.equal(outcome.stamped, false);
  assert.deepEqual(outcome.applied.map(o => o.name), ["Goblin"], "the applied work is still reported");
});

// ─── Composition ───────────────────────────────────────────────────────────

test("two consumers share the lifecycle but keep independent stamps", async () => {
  const actors = [actorDouble({ id: "a1", name: "Goblin" })];
  const game = makeGame({ stamps: { enricherBackfillVersion: MODULE_VERSION } });
  const findPack = () => managedPack(actors);

  const enrichers = await runManagedActorBackfill({
    game, id: "enrichers", versionSetting: "enricherBackfillVersion", log: silent,
    findPack, transform: () => ({ update: { enriched: true } }),
  });
  const types = await runManagedActorBackfill({
    game, id: "creature-types", versionSetting: "creatureTypeBackfillVersion", log: silent,
    findPack, transform: () => ({ update: { typed: true } }),
  });

  assert.equal(enrichers.status, "skipped", "already done at this version");
  assert.equal(types.status, "completed");
  assert.deepEqual(game.writes, [["creatureTypeBackfillVersion", MODULE_VERSION]]);
  assert.deepEqual(actors[0].writes, [["update", { typed: true }]]);
});

test("a missing versionSetting or transform is a programming error, not a silent skip", async () => {
  const game = makeGame();
  await assert.rejects(
    () => runManagedActorBackfill({ game, id: "x", transform: () => null }),
    /versionSetting/,
  );
  await assert.rejects(
    () => runManagedActorBackfill({ game, id: "x", versionSetting: SETTING }),
    /transform/,
  );
});
