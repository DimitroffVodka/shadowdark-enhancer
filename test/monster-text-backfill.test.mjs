/**
 * E2 — missing-only monster-context text enrichment over managed Actors.
 *
 * The focused suite uses the real A6 runner with Foundry-shaped doubles. It
 * proves the policy and lifecycle together: only NPC text is offered to the
 * transform, supported Item descriptions/riders and system.notes are patched
 * without rewriting source Spell Items, and a partial embedded write remains
 * retryable without advancing E2's consumer stamp.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MONSTER_TEXT_BACKFILL_ID,
  MONSTER_TEXT_BACKFILL_VERSION_SETTING,
  runMonsterTextBackfill,
  transformMonsterText,
} from "../scripts/importer/monsters/monster-text-backfill.mjs";

const MODULE_ID = "shadowdark-enhancer";
const MODULE_VERSION = "0.15.1";
const SETTING = MONSTER_TEXT_BACKFILL_VERSION_SETTING;

function setPath(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

/** Actor double that retains successful updates for a later missing-only retry. */
function actorDouble({ id, name, type = "NPC", notes, items = [], failEmbeddedTimes = 0 } = {}) {
  const writes = [];
  const actor = {
    id,
    uuid: `Compendium.world.shadowdark-enhancer--actors.Actor.${id}`,
    name,
    type,
    system: { notes },
    items: structuredClone(items),
    writes,
    failEmbeddedTimes,
    async update(data) {
      writes.push(["update", structuredClone(data)]);
      for (const [path, value] of Object.entries(data)) setPath(this, path, value);
      return this;
    },
    async updateEmbeddedDocuments(embeddedName, updates) {
      assert.equal(embeddedName, "Item");
      writes.push(["updateEmbeddedDocuments", embeddedName, structuredClone(updates)]);
      if (this.failEmbeddedTimes > 0) {
        this.failEmbeddedTimes--;
        throw new Error("embedded item store is temporarily locked");
      }
      for (const change of updates) {
        const item = this.items.find((candidate) => candidate.id === change._id || candidate._id === change._id);
        assert.ok(item, `unknown embedded item ${change._id}`);
        for (const [path, value] of Object.entries(change)) {
          if (path !== "_id") setPath(item, path, value);
        }
      }
      return updates;
    },
    snapshot() {
      return JSON.stringify({ type: this.type, name: this.name, system: this.system, items: this.items });
    },
  };
  return actor;
}

function managedPack(actors = []) {
  return {
    collection: "world.shadowdark-enhancer--actors",
    documentName: "Actor",
    metadata: { label: "Shadowdark Enhancer — Actors", packageType: "world" },
    async getDocuments() { return actors; },
  };
}

function forbiddenPack(collection, label, packageType) {
  return {
    collection,
    documentName: "Actor",
    metadata: { label, packageType },
    reads: 0,
    async getDocuments() {
      this.reads++;
      throw new Error(`${collection} must not be read`);
    },
  };
}

function makeGame({ actors = [], stamp = "", version = MODULE_VERSION, packs } = {}) {
  const store = new Map([[SETTING, stamp]]);
  const writes = [];
  const managed = managedPack(actors);
  return {
    managed,
    packs: packs ?? [managed],
    writes,
    user: { id: "gm-1", isGM: true },
    users: { activeGM: { id: "gm-1" } },
    modules: new Map([[MODULE_ID, { version }]]),
    get actors() {
      throw new Error("E2 must never touch world Actors");
    },
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

const RAW_NOTES = "<p>DC 15 DEX or 2d4 damage. Keep [[request 9 str]] and @UUID[Compendium.shadowdark.monsters.Actor.core]{1d6}.</p>";
const RAW_ATTACK = {
  id: "attack-1",
  type: "NPC Attack",
  name: "Bite",
  system: {
    description: "DC 12 CON or 1d6; custom rider.",
    damage: { special: "DC 12 CON or 1d6; custom rider." },
  },
};
const RAW_SPECIAL = {
  id: "special-1",
  type: "NPC Special Attack",
  name: "Gaze",
  system: { description: "<p>DC 13 WIS and 2d6. Custom text.</p>" },
};
const RAW_FEATURE = {
  id: "feature-1",
  type: "NPC Feature",
  name: "Amphibious",
  system: { description: "<p>Can breathe air and water.</p>" },
};
const SOURCE_SPELL = {
  id: "spell-1",
  type: "Spell",
  name: "Fire Bolt",
  system: { description: "<p>DC 10 DEX and 1d4.</p>" },
};

test("transform enriches monster notes and NPC prose while preserving valid markup and unrelated text", () => {
  const actor = actorDouble({
    id: "raw",
    name: "Raw Beast",
    notes: RAW_NOTES,
    items: [RAW_ATTACK, RAW_SPECIAL, RAW_FEATURE, SOURCE_SPELL],
  });

  const before = actor.snapshot();
  const payload = transformMonsterText(actor);

  assert.deepEqual(payload.update, {
    "system.notes": "<p>[[request 15 dex]] or [[/r 2d4]] damage. Keep [[request 9 str]] and @UUID[Compendium.shadowdark.monsters.Actor.core]{1d6}.</p>",
  });
  assert.deepEqual(payload.itemUpdates, [
    {
      _id: "attack-1",
      "system.description": "[[request 12 con]] or [[/r 1d6]]; custom rider.",
      "system.damage.special": "[[request 12 con]] or [[/r 1d6]]; custom rider.",
    },
    {
      _id: "special-1",
      "system.description": "<p>[[request 13 wis]] and [[/r 2d6]]. Custom text.</p>",
    },
  ]);
  assert.deepEqual(payload.detail, { notes: 1, itemDescriptions: 2, damageSpecials: 1 });
  assert.equal(actor.snapshot(), before, "the transform is pure; A6 owns writes");
  assert.equal(SOURCE_SPELL.system.description, "<p>DC 10 DEX and 1d4.</p>");
});

test("already enriched monster content is a fixed-point no-op and Spell text is not a target", () => {
  const actor = actorDouble({
    id: "complete",
    name: "Complete Beast",
    notes: "<p>[[request 15 dex]] and [[/r 2d4]]. Keep this custom sentence.</p>",
    items: [
      {
        id: "attack-1",
        type: "NPC Attack",
        system: {
          description: "[[request 12 con]] or [[/r 1d6]].",
          damage: { special: "[[request 12 con]] or [[/r 1d6]]." },
        },
      },
      {
        id: "feature-1",
        type: "NPC Feature",
        system: { description: "<p>[[request 13 wis]] and [[/r 2d6]].</p>" },
      },
      SOURCE_SPELL,
    ],
  });

  assert.equal(transformMonsterText(actor), null);
});

test("the E2 consumer passes its own stamp, NPC selector, transform, and managed-pack lookup to A6", async () => {
  let received;
  const result = await runMonsterTextBackfill({
    game: { marker: "test-game" },
    log: { error() {} },
    findPack: () => "managed",
    runBackfill: async (options) => {
      received = options;
      return { status: "test" };
    },
  });

  assert.deepEqual(result, { status: "test" });
  assert.equal(received.game.marker, "test-game");
  assert.equal(received.id, MONSTER_TEXT_BACKFILL_ID);
  assert.equal(received.versionSetting, SETTING);
  assert.equal(received.select({ type: "NPC" }), true);
  assert.equal(received.select({ type: "Mount" }), false);
  assert.equal(received.findPack(), "managed");
  assert.equal(received.transform, transformMonsterText);
});

test("A6 applies only selected NPCs, reports deterministic outcomes, and a cleared-stamp rerun writes no document twice", async () => {
  const raw = actorDouble({ id: "raw", name: "Raw Beast", notes: RAW_NOTES, items: [RAW_ATTACK, RAW_SPECIAL] });
  const complete = actorDouble({
    id: "complete",
    name: "Complete Beast",
    notes: "<p>[[request 15 dex]] and [[/r 2d4]].</p>",
    items: [{
      id: "feature-1", type: "NPC Feature", name: "Ready",
      system: { description: "<p>[[request 13 wis]] and [[/r 2d6]].</p>" },
    }],
  });
  const mount = actorDouble({ id: "mount", name: "Raw Mount", type: "Mount", notes: RAW_NOTES, items: [RAW_FEATURE] });
  const game = makeGame({ actors: [mount, complete, raw] });

  const opts = { game, log: { error() {} } };
  const first = await runMonsterTextBackfill(opts);

  assert.equal(first.status, "completed");
  assert.equal(first.total, 2, "Mount is outside E2's NPC candidate set");
  assert.deepEqual(first.applied.map((entry) => entry.name), ["Raw Beast"]);
  assert.deepEqual(first.skipped.map((entry) => entry.name), ["Complete Beast"]);
  assert.deepEqual(first.failed, []);
  assert.deepEqual(game.writes, [[SETTING, MODULE_VERSION]]);
  assert.deepEqual(mount.writes, [], "non-monster Actor was never touched");

  const snapshots = [raw, complete, mount].map((actor) => actor.snapshot());
  const documentWrites = [raw, complete, mount].map((actor) => actor.writes.length);

  const gated = await runMonsterTextBackfill(opts);
  assert.equal(gated.status, "skipped");
  assert.equal(gated.reason, "up-to-date");

  await game.settings.set(MODULE_ID, SETTING, "");
  game.writes.length = 0;
  const second = await runMonsterTextBackfill(opts);

  assert.equal(second.status, "completed");
  assert.deepEqual(second.applied, [], "the cleared-stamp rerun found no missing text");
  assert.deepEqual(second.skipped.map((entry) => entry.name), ["Complete Beast", "Raw Beast"]);
  assert.deepEqual([raw, complete, mount].map((actor) => actor.snapshot()), snapshots);
  assert.deepEqual([raw, complete, mount].map((actor) => actor.writes.length), documentWrites);
  assert.deepEqual(game.writes, [[SETTING, MODULE_VERSION]]);
});

test("a partial embedded write reports the failed Actor, leaves E2 unstamped, and retries only the missing half", async () => {
  const failing = actorDouble({
    id: "failing", name: "Failing Beast", notes: RAW_NOTES,
    items: [RAW_ATTACK], failEmbeddedTimes: 1,
  });
  const succeeding = actorDouble({
    id: "succeeding", name: "Succeeding Beast", notes: "<p>DC 11 STR and 1d4.</p>",
    items: [RAW_FEATURE],
  });
  const game = makeGame({ actors: [succeeding, failing] });
  const opts = { game, log: { error() {} } };

  const first = await runMonsterTextBackfill(opts);
  assert.equal(first.status, "failed");
  assert.equal(first.stage, "documents");
  assert.deepEqual(first.applied.map((entry) => entry.name), ["Succeeding Beast"]);
  assert.deepEqual(first.failed.map((entry) => [entry.name, entry.reason]), [["Failing Beast", "write-failed"]]);
  assert.deepEqual(game.writes, [], "partial document failure keeps E2 retryable");
  assert.match(failing.system.notes, /\[\[request 15 dex\]\]/);
  assert.match(failing.items[0].system.description, /DC 12 CON/);

  const retry = await runMonsterTextBackfill(opts);
  assert.equal(retry.status, "completed");
  assert.deepEqual(retry.applied.map((entry) => entry.name), ["Failing Beast"]);
  assert.deepEqual(retry.skipped.map((entry) => entry.name), ["Succeeding Beast"]);
  assert.deepEqual(game.writes, [[SETTING, MODULE_VERSION]]);
  assert.equal(failing.writes.filter(([kind]) => kind === "update").length, 1, "the actor-level half was not rewritten");
  assert.equal(failing.writes.filter(([kind]) => kind === "updateEmbeddedDocuments").length, 2);
  assert.match(failing.items[0].system.description, /\[\[request 12 con\]\]/);
});

test("Core/source packs and world Actors are a hard non-target boundary", async () => {
  const core = forbiddenPack("shadowdark.monsters", "Monsters", "system");
  const game = makeGame({ packs: [] });
  const outcome = await runMonsterTextBackfill({ game, findPack: () => core, log: { error() {} } });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "unmanaged-pack");
  assert.equal(core.reads, 0, "Core was refused before getDocuments");
  assert.deepEqual(game.writes, []);
});

test("startup wires E2 after the legacy worker promise and keeps the consumer dynamic", async () => {
  const source = await readFile(new URL("../scripts/shadowdark-enhancer.mjs", import.meta.url), "utf8");

  assert.match(source, /let legacyBackfillDone = Promise\.resolve\(\);/);
  assert.match(source, /await legacyBackfillDone;/);
  assert.match(source, /import\("\.\/importer\/monsters\/monster-text-backfill\.mjs"\)/);
  assert.match(source, /runMonsterTextBackfill\(\{ game \}\)/);
});
