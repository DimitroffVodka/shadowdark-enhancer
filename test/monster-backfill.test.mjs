/**
 * A6a — legacy Actor backfill accounting.
 *
 * The legacy worker keeps its public changed/unchanged/totals shape while
 * gaining the managed-backfill runner's per-Actor failure vocabulary. These
 * tests drive the real backfillActor round-trip with Foundry-shaped doubles;
 * no production test hook is needed.
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { backfillTargets } from "../scripts/importer/monsters/monster-backfill.mjs";
import { runMonsterTextBackfillAfterLegacy } from "../scripts/importer/monsters/monster-text-backfill.mjs";

const MODULE_ID = "shadowdark-enhancer";

const STATS_NOTES = "<p><i>Flavor</i></p>\n"
  + "<p><strong>AC</strong> 10, <strong>HP</strong> 1, <strong>MV</strong> near, "
  + "<strong>S</strong> +0, <strong>D</strong> +0, <strong>C</strong> +0, "
  + "<strong>I</strong> +0, <strong>W</strong> +0, <strong>Ch</strong> +0, "
  + "<strong>AL</strong> N, <strong>LV</strong> 1</p>\n"
  + "<p><strong>Feature</strong>. Plain feature text</p>";

let previousGlobals;

before(() => {
  previousGlobals = {
    CONST: globalThis.CONST,
    document: globalThis.document,
    foundry: globalThis.foundry,
    ui: globalThis.ui,
  };
  globalThis.CONST = { DEFAULT_TOKEN: "icons/svg/mystery-man.svg" };
  globalThis.document = {
    createElement() {
      let html = "";
      return {
        set innerHTML(value) { html = String(value ?? ""); },
        get textContent() { return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); },
      };
    },
  };
  globalThis.foundry = {
    applications: { handlebars: { renderTemplate() {} } },
    utils: {
      cleanHTML: value => value,
      deepClone: structuredClone,
      randomID: () => "generated-id",
    },
  };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
});

after(() => {
  for (const [key, value] of Object.entries(previousGlobals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
});

function setPath(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

/** Actor double that retains successful writes for a real retry. */
function actorDouble({
  id,
  name = id,
  notes = STATS_NOTES,
  malformed = false,
  failEmbeddedTimes = 0,
} = {}) {
  const actor = {
    id,
    uuid: `Compendium.world.shadowdark-enhancer--actors.Actor.${id}`,
    name,
    type: "NPC",
    img: "art.png",
    prototypeToken: { texture: { src: "token.png" } },
    system: {
      alignment: "neutral",
      level: { value: 1 },
      attributes: { hp: { value: 1, max: 1 }, ac: { value: 10 } },
      abilities: {
        str: { mod: 0 }, dex: { mod: 0 }, con: { mod: 0 },
        int: { mod: 0 }, wis: { mod: 0 }, cha: { mod: 0 },
      },
      darkAdapted: false,
      move: "near",
      moveNote: "",
      spellcasting: { ability: "", bonus: 0, attacks: 0 },
      notes,
    },
    items: malformed ? null : [{
      id: `${id}-feature`,
      _id: `${id}-feature`,
      type: "NPC Feature",
      name: "Feature",
      img: "icons/creatures/abilities/dragon-breath-purple.webp",
      system: { description: "Plain feature text" },
    }],
    writes: [],
    failEmbeddedTimes,
    async update(data) {
      this.writes.push(["update", structuredClone(data)]);
      for (const [path, value] of Object.entries(data)) setPath(this, path, value);
      return this;
    },
    async updateEmbeddedDocuments(type, updates) {
      assert.equal(type, "Item");
      this.writes.push(["updateEmbeddedDocuments", structuredClone(updates)]);
      if (this.failEmbeddedTimes > 0) {
        this.failEmbeddedTimes--;
        throw new Error("embedded item store is temporarily locked");
      }
      for (const update of updates) {
        const item = this.items.find(candidate => candidate.id === update._id || candidate._id === update._id);
        assert.ok(item, `unknown embedded Item ${update._id}`);
        for (const [path, value] of Object.entries(update)) {
          if (path !== "_id") setPath(item, path, value);
        }
      }
      return updates;
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "Item");
      this.writes.push(["deleteEmbeddedDocuments", structuredClone(ids)]);
      this.items = this.items.filter(item => !ids.includes(item.id));
      return ids;
    },
    async createEmbeddedDocuments(type, documents) {
      assert.equal(type, "Item");
      this.writes.push(["createEmbeddedDocuments", structuredClone(documents)]);
      this.items.push(...documents.map((document, index) => ({
        ...structuredClone(document),
        id: `${this.id}-created-${index}`,
      })));
      return documents;
    },
  };
  return actor;
}

function managedPack(actors) {
  return {
    collection: "world.shadowdark-enhancer--actors",
    documentName: "Actor",
    metadata: { label: "Shadowdark Enhancer — Actors", packageType: "world" },
    reads: 0,
    async getDocuments() {
      this.reads++;
      return actors;
    },
  };
}

function makeGame() {
  const settings = new Map([["backfillVersion", ""]]);
  const writes = [];
  return {
    user: { id: "gm-1", isGM: true },
    users: { activeGM: { id: "gm-1" } },
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        return settings.get(key) ?? "";
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        writes.push([key, value]);
        settings.set(key, value);
        return value;
      },
    },
    writes,
  };
}

async function runPack(game, actors, { dryRun = false } = {}) {
  globalThis.game = game;
  return backfillTargets({
    scope: "pack",
    packCollection: managedPack(actors),
    dryRun,
  });
}

async function withLinkerSpy(fn) {
  const { MonsterLinker } = await import("../scripts/importer/monsters/monster-linker.mjs");
  const original = MonsterLinker.invalidate;
  let count = 0;
  MonsterLinker.invalidate = () => { count++; };
  try {
    return await fn(() => count);
  } finally {
    MonsterLinker.invalidate = original;
  }
}

test("a non-GM caller is refused before any pack is read", async () => {
  const game = makeGame();
  game.user.isGM = false;
  const forbidden = {
    collection: "shadowdark.monsters",
    documentName: "Actor",
    metadata: { label: "Monsters", packageType: "system" },
    reads: 0,
    async getDocuments() {
      this.reads++;
      throw new Error("Core must not be read");
    },
  };

  globalThis.game = game;
  const result = await backfillTargets({
    scope: "pack",
    packCollection: forbidden,
  });

  assert.equal(result, null);
  assert.equal(forbidden.reads, 0);
});

test("pack scope resolves only the managed Actors pack, never Core/source packs or world Actors", async () => {
  const game = makeGame();
  const managedActor = actorDouble({ id: "managed", name: "Managed Monster" });
  const managed = managedPack([managedActor]);
  const core = {
    collection: "shadowdark.monsters",
    documentName: "Actor",
    metadata: { label: "Monsters", packageType: "system" },
    reads: 0,
    async getDocuments() {
      this.reads++;
      throw new Error("Core must not be read");
    },
  };
  const source = {
    collection: "world.some-module-actors",
    documentName: "Actor",
    metadata: { label: "Somebody Else", packageType: "module" },
    reads: 0,
    async getDocuments() {
      this.reads++;
      throw new Error("source pack must not be read");
    },
  };
  game.packs = [core, source, managed];
  Object.defineProperty(game, "actors", {
    get() {
      throw new Error("world Actors must not be read");
    },
  });

  globalThis.game = game;
  const result = await backfillTargets({ scope: "pack" });

  assert.equal(result.total, 1);
  assert.deepEqual(result.changed.map(({ actor }) => actor), ["Managed Monster"]);
  assert.equal(managed.reads, 1);
  assert.equal(core.reads, 0);
  assert.equal(source.reads, 0);
});

test("one transform throw is isolated: all other Actors are attempted and successes stay in changed", async () => {
  const actors = [
    actorDouble({ id: "a1", name: "Alpha" }),
    actorDouble({ id: "a2", name: "Bravo", malformed: true }),
    actorDouble({ id: "a3", name: "Charlie" }),
    actorDouble({ id: "a4", name: "Delta" }),
  ];
  const game = makeGame();

  const result = await withLinkerSpy(async getInvalidations => {
    return runPack(game, actors).then(outcome => ({ outcome, invalidations: getInvalidations() }));
  });

  assert.equal(result.outcome.total, 4);
  assert.deepEqual(result.outcome.changed.map(({ actor }) => actor), ["Alpha", "Charlie", "Delta"]);
  assert.deepEqual(result.outcome.failed.map(({ id, uuid, name, reason, message }) => ({
    id, uuid, name, reason, message,
  })), [{
    id: "a2",
    uuid: actors[1].uuid,
    name: "Bravo",
    reason: "transform-threw",
    message: "actor.items is not iterable",
  }]);
  assert.equal(result.outcome.totals.descriptionsWrapped, 3);
  assert.equal(result.invalidations, 1, "one linker invalidation follows the changed partial batch");
  assert.ok(actors[0].writes.length > 0 && actors[2].writes.length > 0 && actors[3].writes.length > 0);
});

test("write rejection has a distinct reason and retry applies only the still-missing embedded work", async () => {
  const failing = actorDouble({ id: "a1", name: "Locked Monster", failEmbeddedTimes: 1 });
  const succeeding = actorDouble({ id: "a2", name: "Good Monster" });
  const game = makeGame();

  const first = await runPack(game, [failing, succeeding]);
  assert.deepEqual(first.failed.map(({ id, name, reason, message }) => ({ id, name, reason, message })), [{
    id: "a1",
    name: "Locked Monster",
    reason: "write-failed",
    message: "embedded item store is temporarily locked",
  }]);
  assert.deepEqual(first.changed.map(({ actor }) => actor), ["Good Monster"]);
  assert.deepEqual(game.writes, [], "the public legacy sweep does not own the startup version stamp");
  assert.deepEqual(failing.writes.map(([kind]) => kind), ["updateEmbeddedDocuments"]);

  const retry = await runPack(game, [failing, succeeding]);
  assert.deepEqual(retry.failed, []);
  assert.deepEqual(retry.changed.map(({ actor }) => actor), ["Locked Monster"]);
  assert.deepEqual(retry.unchanged.map(({ actor }) => actor), ["Good Monster"]);
  assert.deepEqual(failing.writes.map(([kind]) => kind), ["updateEmbeddedDocuments", "updateEmbeddedDocuments"]);
  assert.deepEqual(succeeding.writes.map(([kind]) => kind), ["updateEmbeddedDocuments"]);

  const second = await runPack(game, [failing, succeeding]);
  assert.deepEqual(second.failed, []);
  assert.deepEqual(second.changed, []);
  assert.deepEqual(second.unchanged.map(({ actor }) => actor), ["Locked Monster", "Good Monster"]);
  assert.deepEqual(failing.writes.map(([kind]) => kind), ["updateEmbeddedDocuments", "updateEmbeddedDocuments"]);
  assert.deepEqual(succeeding.writes.map(([kind]) => kind), ["updateEmbeddedDocuments"]);
});

test("complete success has an empty failed list, while dryRun never writes or invalidates", async () => {
  const completeGame = makeGame();
  const complete = await runPack(completeGame, [actorDouble({ id: "complete", name: "Complete Monster" })]);
  assert.deepEqual(complete.failed, []);
  assert.deepEqual(complete.changed.map(({ actor }) => actor), ["Complete Monster"]);

  const dryGame = makeGame();
  const dryActor = actorDouble({ id: "dry", name: "Dry Monster" });
  const dry = await withLinkerSpy(async getInvalidations => {
    return runPack(dryGame, [dryActor], { dryRun: true })
      .then(outcome => ({ outcome, invalidations: getInvalidations() }));
  });
  assert.equal(dry.outcome.dryRun, true);
  assert.deepEqual(dry.outcome.failed, []);
  assert.deepEqual(dry.outcome.changed.map(({ actor }) => actor), ["Dry Monster"]);
  assert.deepEqual(dryActor.writes, []);
  assert.deepEqual(dryGame.writes, []);
  assert.equal(dry.invalidations, 0);
});

test("value-equal Actor art and notes are not redundantly rewritten, so the real backfill reaches a fixed point", async () => {
  const actor = actorDouble({ id: "fixed", name: "Fixed Monster" });
  const game = makeGame();

  const first = await runPack(game, [actor]);
  assert.equal(first.changed.length, 1);
  assert.deepEqual(actor.writes.map(([kind]) => kind), ["updateEmbeddedDocuments"]);

  const second = await runPack(game, [actor]);
  assert.deepEqual(second.changed, []);
  assert.deepEqual(second.unchanged.map(({ actor: name }) => name), ["Fixed Monster"]);
  assert.deepEqual(actor.writes.map(([kind]) => kind), ["updateEmbeddedDocuments"]);
});

test("startup leaves backfillVersion open on failed legacy results and releases E2 as unhealthy", async () => {
  const source = await readFile(new URL("../scripts/shadowdark-enhancer.mjs", import.meta.url), "utf8");
  const call = source.indexOf("const result = await backfillTargets({ scope: \"pack\", dryRun: false });");
  const stamp = source.indexOf("await game.settings.set(MODULE_ID, \"backfillVersion\", cur);", call);
  assert.ok(call >= 0, "startup invokes the legacy pack sweep");
  assert.ok(stamp > call, "startup stamp remains in the success path");
  const block = source.slice(call, stamp);
  assert.match(block, /if \(!result \|\| result\.failed\?\.length\) \{/);
  assert.match(block, /console\.error\([^\n]*auto-backfill did not complete/);
  assert.match(block, /resolve\(false\);/);
  assert.ok(source.indexOf("resolve(false)", call) < stamp);
  assert.match(source, /let legacyBackfillDone = Promise\.resolve\(true\);/);
  assert.match(source, /if \(game\.users\.activeGM\?\.id !== game\.user\.id\)/);

  let calls = 0;
  const deferred = await runMonsterTextBackfillAfterLegacy({
    game: {},
    legacyBackfillDone: Promise.resolve(false),
    log: { error() {} },
    runBackfill: async () => {
      calls++;
      return { status: "completed" };
    },
  });
  assert.equal(deferred.status, "skipped");
  assert.equal(deferred.reason, "legacy-failed");
  assert.equal(deferred.stamped, false);
  assert.equal(calls, 0, "E2 remains deferred after a failed legacy result");
});
