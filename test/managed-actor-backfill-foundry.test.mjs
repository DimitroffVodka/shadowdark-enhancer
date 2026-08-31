/**
 * A6 — managed-Actor backfill runner, Foundry-adapter suite.
 *
 * The pure suite proves the lifecycle. This one proves the seam it sits on:
 * the real `findMonsterPack` picking the managed pack out of a realistic
 * `game.packs`, dot-path `Actor#update` and `Actor#updateEmbeddedDocuments`
 * carrying a payload the way Foundry would, and — the part that matters most —
 * that a Core pack, a third-party Actor pack, and the world Actor directory are
 * never read or written even when they are sitting right there.
 *
 * The transform used here is deliberately a realistic missing-only composition
 * (an actor flag plus an embedded item description), because "the second run is
 * a no-op" is only meaningful against documents that actually retain the first
 * run's writes.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runManagedActorBackfill } from "../scripts/importer/monsters/managed-actor-backfill.mjs";

const MODULE_ID = "shadowdark-enhancer";
const MODULE_VERSION = "0.13.1";
const SETTING = "creatureTypeBackfillVersion";

/** Minimal `foundry.utils.setProperty` for the dot paths an update carries. */
function setPath(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

/**
 * A compendium Actor that behaves like a Foundry document for the two write
 * methods the runner uses: updates land on the document and survive into the
 * next run, and every write is counted.
 */
function packActor({ id, name, type = "NPC", flags = {}, items = [] }) {
  return {
    id,
    uuid: `Compendium.world.shadowdark-enhancer--actors.Actor.${id}`,
    name,
    type,
    flags: structuredClone(flags),
    items: items.map(i => ({ ...i, system: { ...i.system } })),
    writeCount: 0,
    async update(data) {
      this.writeCount++;
      for (const [path, value] of Object.entries(data)) setPath(this, path, value);
      return this;
    },
    async updateEmbeddedDocuments(embeddedName, updates) {
      assert.equal(embeddedName, "Item");
      this.writeCount++;
      for (const change of updates) {
        const item = this.items.find(i => i._id === change._id);
        assert.ok(item, `update named an item this actor does not have: ${change._id}`);
        for (const [path, value] of Object.entries(change)) {
          if (path === "_id") continue;
          setPath(item, path, value);
        }
      }
      return updates;
    },
    /** The comparable state a live-run diff would look at. */
    snapshot() {
      return JSON.stringify({ name: this.name, flags: this.flags, items: this.items });
    },
  };
}

function pack({ collection, label, packageType, documentName = "Actor", actors = [], forbidden = false }) {
  return {
    collection,
    documentName,
    metadata: { label, packageType },
    reads: 0,
    async getDocuments() {
      if (forbidden) throw new Error(`the runner read ${collection}, which it must never touch`);
      this.reads++;
      return actors;
    },
  };
}

/**
 * A `game` carrying the pack set a real world has: Shadowdark Core, this
 * module's managed Actors pack, and a third-party Actor compendium. Core and
 * the third party throw if they are read at all; `game.actors` throws if the
 * world directory is touched.
 */
function makeGame({ actors = [], stamp = "", version = MODULE_VERSION, activeGMId = "gm-1", userId = "gm-1" } = {}) {
  const managed = pack({
    collection: "world.shadowdark-enhancer--actors",
    label: "Shadowdark Enhancer — Actors",
    packageType: "world",
    actors,
  });
  const core = pack({
    collection: "shadowdark.monsters", label: "Monsters", packageType: "system", forbidden: true,
  });
  const thirdParty = pack({
    collection: "other-module.beasts", label: "Somebody Else's Beasts", packageType: "module", forbidden: true,
  });
  const store = new Map([[SETTING, stamp]]);
  const writes = [];
  return {
    managed, core, thirdParty, writes,
    packs: [core, managed, thirdParty],
    user: { id: userId, isGM: true },
    users: { activeGM: { id: activeGMId } },
    modules: new Map([[MODULE_ID, { version }]]),
    get actors() {
      throw new Error("the runner must never touch the world Actor directory");
    },
    settings: {
      get: (moduleId, key) => {
        assert.equal(moduleId, MODULE_ID);
        return store.get(key) ?? "";
      },
      set: async (moduleId, key, value) => {
        assert.equal(moduleId, MODULE_ID);
        writes.push([key, value]);
        store.set(key, value);
        return value;
      },
    },
  };
}

/**
 * A realistic missing-only transform: stamp the SDE creature type when it is
 * absent, and HTML-wrap any embedded feature description that is still plain.
 * Both halves are no-ops once applied — that is what makes the second run free.
 */
function backfillTypesAndText(typeByName) {
  return actor => {
    const update = {};
    const itemUpdates = [];

    if (!actor.flags?.[MODULE_ID]?.creatureType && typeByName[actor.name]) {
      update[`flags.${MODULE_ID}.creatureType`] = typeByName[actor.name];
    }
    for (const item of actor.items ?? []) {
      const description = item.system?.description ?? "";
      if (description && !description.trimStart().startsWith("<")) {
        itemUpdates.push({ _id: item._id, "system.description": `<p>${description}</p>` });
      }
    }
    const detail = { typed: Object.keys(update).length, wrapped: itemUpdates.length };
    return (detail.typed || detail.wrapped) ? { update, itemUpdates, detail } : null;
  };
}

function seededActors() {
  return [
    packActor({
      id: "a1",
      name: "Goblin",
      items: [{ _id: "i1", type: "NPC Feature", name: "Sneaky", system: { description: "Attacks with advantage." } }],
    }),
    packActor({
      id: "a2",
      name: "Wyvern",
      // Already typed and already wrapped — the transform must leave it alone.
      flags: { [MODULE_ID]: { creatureType: "dragon" } },
      items: [{ _id: "i2", type: "NPC Feature", name: "Sting", system: { description: "<p>Poison.</p>" } }],
    }),
  ];
}

const TYPES = { Goblin: "humanoid", Wyvern: "beast" };
const silent = { error() {} };

test("the runner finds the managed pack through the real lookup and reads nothing else", async () => {
  const actors = seededActors();
  const game = makeGame({ actors });

  const outcome = await runManagedActorBackfill({
    game, id: "creature-types", versionSetting: SETTING, log: silent,
    transform: backfillTypesAndText(TYPES),
  });

  assert.equal(outcome.status, "completed");
  assert.equal(game.managed.reads, 1);
  assert.equal(game.core.reads, 0, "Shadowdark Core was never read");
  assert.equal(game.thirdParty.reads, 0, "a third-party Actor pack was never read");
});

test("a seeded managed pack run twice changes nothing the second time", async () => {
  const actors = seededActors();
  const game = makeGame({ actors });
  const opts = {
    game, id: "creature-types", versionSetting: SETTING, log: silent,
    transform: backfillTypesAndText(TYPES),
  };

  const first = await runManagedActorBackfill(opts);
  assert.equal(first.status, "completed");
  assert.deepEqual(first.applied.map(o => o.name), ["Goblin"]);
  assert.deepEqual(first.applied[0].detail, { typed: 1, wrapped: 1 });
  assert.deepEqual(first.skipped.map(o => o.name), ["Wyvern"], "already-complete content is skipped, not rewritten");
  assert.equal(actors[0].flags[MODULE_ID].creatureType, "humanoid");
  assert.equal(actors[0].items[0].system.description, "<p>Attacks with advantage.</p>");
  assert.equal(actors[1].writeCount, 0);

  const after = actors.map(a => a.snapshot());
  const writesAfterFirst = actors.map(a => a.writeCount);

  // The stamp closes the gate; clearing it is the supported way to force the
  // sweep again, so the honest second run is the one with the gate reopened.
  const gated = await runManagedActorBackfill(opts);
  assert.equal(gated.status, "skipped");
  assert.equal(gated.reason, "up-to-date");

  await game.settings.set(MODULE_ID, SETTING, "");
  game.writes.length = 0;

  const second = await runManagedActorBackfill(opts);

  assert.equal(second.status, "completed");
  assert.deepEqual(second.applied, [], "a second identical run applies nothing");
  assert.deepEqual(second.skipped.map(o => o.name), ["Goblin", "Wyvern"]);
  assert.deepEqual(actors.map(a => a.snapshot()), after, "documents are byte-identical after the second run");
  assert.deepEqual(actors.map(a => a.writeCount), writesAfterFirst, "no document was written twice");
  assert.deepEqual(game.writes, [[SETTING, MODULE_VERSION]]);
});

test("one unwritable document leaves the others applied and the stamp behind", async () => {
  const actors = seededActors();
  actors[0].updateEmbeddedDocuments = async () => { throw new Error("compendium is locked"); };
  // Give the second actor something to do so a partial success is observable.
  actors[1].items[0].system.description = "Poison.";
  const game = makeGame({ actors });

  const outcome = await runManagedActorBackfill({
    game, id: "creature-types", versionSetting: SETTING, log: silent,
    transform: backfillTypesAndText(TYPES),
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stage, "documents");
  assert.deepEqual(outcome.failed.map(o => [o.name, o.reason]), [["Goblin", "write-failed"]]);
  assert.deepEqual(outcome.applied.map(o => o.name), ["Wyvern"]);
  assert.deepEqual(game.writes, [], "the gate stays open for the next activation");
  // The actor-level half of the failing document did land — that is exactly why
  // the retry has to be missing-only rather than assuming an untouched document.
  assert.equal(actors[0].flags[MODULE_ID].creatureType, "humanoid");
  assert.equal(actors[0].items[0].system.description, "Attacks with advantage.");

  // Retry: the applied half is skipped, the failed half is re-attempted.
  actors[0].updateEmbeddedDocuments = seededActors()[0].updateEmbeddedDocuments;
  const retry = await runManagedActorBackfill({
    game, id: "creature-types", versionSetting: SETTING, log: silent,
    transform: backfillTypesAndText(TYPES),
  });

  assert.equal(retry.status, "completed");
  assert.deepEqual(retry.applied.map(o => o.name), ["Goblin"]);
  assert.deepEqual(retry.applied[0].detail, { typed: 0, wrapped: 1 }, "only the still-missing half is written");
  assert.equal(actors[0].items[0].system.description, "<p>Attacks with advantage.</p>");
  assert.deepEqual(game.writes, [[SETTING, MODULE_VERSION]]);
});

test("a world whose only Actor pack is Core is not a backfill target", async () => {
  const game = makeGame();
  game.packs = [game.core, game.thirdParty];
  const errors = [];

  const outcome = await runManagedActorBackfill({
    game, id: "creature-types", versionSetting: SETTING,
    log: { error: (...args) => errors.push(args) },
    transform: () => ({ update: { touched: true } }),
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "no-pack");
  assert.deepEqual(game.writes, []);
  assert.equal(errors.length, 0, "an absent managed pack is ordinary, not an error");
});
