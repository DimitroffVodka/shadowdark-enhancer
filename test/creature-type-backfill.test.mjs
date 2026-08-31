/**
 * E3 — reviewed creature-type backfill.
 *
 * These tests use Foundry-shaped doubles but keep the implementation pure
 * enough to run under node:test. They cover source/name identity, both flag
 * namespaces, optional SDX runtime evidence, A6 retry/idempotence, and the
 * managed-pack boundary.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  CREATURE_TYPE_ACTOR_TYPES,
  CREATURE_TYPE_BACKFILL_ID,
  CREATURE_TYPE_BACKFILL_VERSION_SETTING,
  creatureTypeKey,
  hasCreatureTypeFlag,
  resolveSdxRuntimeMap,
  reviewedCreatureType,
  runCreatureTypeBackfill,
  transformCreatureType,
} from "../scripts/importer/monsters/creature-type-backfill.mjs";
import { CREATURE_TYPE_MAP } from "../scripts/importer/monsters/creature-type-map-data.mjs";

const SDX_ID = "shadowdark-extras";
const VERSION = "0.15.1";

function setPath(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function actorDouble({
  id,
  name,
  source,
  type = "NPC",
  sdeType,
  sdxType,
  failWrites = 0,
} = {}) {
  const writes = [];
  const flags = {
    ...(sdeType !== undefined || source !== undefined
      ? { [MODULE_ID]: { ...(source !== undefined ? { source } : {}), ...(sdeType !== undefined ? { creatureType: sdeType } : {}) } }
      : {}),
    ...(sdxType !== undefined ? { [SDX_ID]: { creatureType: sdxType } } : {}),
  };
  const actor = {
    id,
    uuid: `Compendium.world.shadowdark-enhancer--actors.Actor.${id}`,
    name,
    type,
    flags,
    writes,
    failWrites,
    async update(data) {
      writes.push(["update", structuredClone(data)]);
      if (this.failWrites > 0) {
        this.failWrites--;
        throw new Error("Actor is temporarily locked");
      }
      for (const [path, value] of Object.entries(data)) setPath(this, path, value);
      return this;
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

function makeGame({ actors = [], stamp = "", sdxMap, sdxActive = false } = {}) {
  const settings = new Map([[CREATURE_TYPE_BACKFILL_VERSION_SETTING, stamp]]);
  const writes = [];
  const modules = new Map([[MODULE_ID, { version: VERSION }]]);
  if (sdxMap !== undefined) {
    modules.set(SDX_ID, {
      active: sdxActive,
      api: { getMappedCreatureType: (name) => sdxMap[name] ?? "" },
    });
  }
  const managed = managedPack(actors);
  return {
    writes,
    user: { id: "gm-1", isGM: true },
    users: { activeGM: { id: "gm-1" } },
    modules,
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
    managed,
    packs: [managed],
    get actors() {
      throw new Error("E3 must never touch world Actors");
    },
  };
}

const silent = { error() {}, warn() {} };

test("N4 map is source-scoped, complete, and uses supported title-case values", () => {
  assert.equal(Object.keys(CREATURE_TYPE_MAP).length, 79);
  assert.equal(CREATURE_TYPE_MAP["CS1:bogthorn"], "Plant");
  assert.equal(CREATURE_TYPE_MAP["CS1:hexling"], "Undead");
  assert.equal(CREATURE_TYPE_MAP["CS1:mugdulblub"], "Ooze");
  assert.equal(CREATURE_TYPE_MAP["CS3:the scourge"], undefined);
  assert.equal(CREATURE_TYPE_MAP["CS2:the scourge"], "Dragon");
  assert.equal(CREATURE_TYPE_MAP["WR:pony"], "Animal");
  assert.equal(CREATURE_TYPE_MAP.bogthorn, undefined, "bare-name fallback is forbidden");

  const supported = new Set([
    "Aberration", "Animal", "Celestial", "Construct", "Dinosaur", "Dragon",
    "Elemental", "Fey", "Fiend", "Humanoid", "Insect", "Monstrosity", "Ooze",
    "Plant", "Undead",
  ]);
  for (const [key, type] of Object.entries(CREATURE_TYPE_MAP)) {
    assert.match(key, /^(CS[1-5]|WR):[a-z0-9][a-z0-9 ,'-]*$/);
    assert.ok(supported.has(type), `${key} has an unsupported type ${type}`);
  }
});

test("source/name keys stay distinct and pre-flag source folders remain resolvable", () => {
  const cs2 = actorDouble({ id: "cs2", name: "Scrag", source: "Cursed Scroll #2" });
  const wr = actorDouble({ id: "wr", name: "Scrag", source: "Western Reaches", type: "Mount" });
  assert.equal(creatureTypeKey(cs2), "CS2:scrag");
  assert.equal(creatureTypeKey(wr), "WR:scrag");
  assert.equal(reviewedCreatureType(cs2), "Monstrosity");
  assert.equal(reviewedCreatureType(wr), "Monstrosity");

  const folderOnly = actorDouble({ id: "folder", name: "Bogthorn" });
  folderOnly.folder = { name: "Cursed Scroll 1 — Diablerie" };
  assert.equal(creatureTypeKey(folderOnly), "CS1:bogthorn");
});

test("missing-only transform writes SDE and mirrors SDX only for a proven runtime gap", () => {
  const conflict = actorDouble({ id: "bog", name: "Bogthorn", source: "CS1" });
  assert.deepEqual(
    transformCreatureType(conflict, { sdxRuntimeMap: () => "Monstrosity", log: silent }),
    {
      update: { "flags.shadowdark-enhancer.creatureType": "Plant" },
      detail: { key: "CS1:bogthorn", type: "Plant", sde: 1, sdx: 0 },
    },
    "an SDX conflict is runtime-owned and does not receive an optional mirror",
  );

  const absent = actorDouble({ id: "pony", name: "Pony", source: "WR", type: `${MODULE_ID}.mount` });
  assert.deepEqual(
    transformCreatureType(absent, { sdxRuntimeMap: () => "", log: silent }),
    {
      update: {
        "flags.shadowdark-enhancer.creatureType": "Animal",
        "flags.shadowdark-extras.creatureType": "Animal",
      },
      detail: { key: "WR:pony", type: "Animal", sde: 1, sdx: 1 },
    },
  );

  const existing = actorDouble({ id: "existing", name: "Bogthorn", source: "CS1", sdeType: "custom", sdxType: "custom" });
  assert.equal(transformCreatureType(existing, { sdxRuntimeMap: () => "", log: silent }), null);
  assert.equal(hasCreatureTypeFlag(false), true, "non-string legacy values are still preserved");
  assert.equal(hasCreatureTypeFlag(""), false);
});

test("SDX absence, inactive state, and lookup failure never block SDE taxonomy", () => {
  const actor = actorDouble({ id: "void", name: "Void Being", source: "CS4" });
  assert.equal(resolveSdxRuntimeMap(makeGame()), null);
  assert.equal(resolveSdxRuntimeMap(makeGame({ sdxMap: {}, sdxActive: false })), null);

  assert.deepEqual(
    transformCreatureType(actor, { sdxRuntimeMap: () => { throw new Error("API disappeared"); }, log: silent }),
    {
      update: { "flags.shadowdark-enhancer.creatureType": "Undead" },
      detail: { key: "CS4:void being", type: "Undead", sde: 1, sdx: 0, sdxLookup: "unavailable" },
    },
  );
});

test("A6 consumer applies mapped Actors, reports missing-map separately, and excludes Boat/world content", async () => {
  const actors = [
    actorDouble({ id: "bog", name: "Bogthorn", source: "CS1" }),
    actorDouble({ id: "pony", name: "Pony", source: "WR", type: `${MODULE_ID}.mount` }),
    actorDouble({ id: "typed", name: "Hexling", source: "CS1", sdeType: "custom", sdxType: "Fiend" }),
    actorDouble({ id: "unknown", name: "Homebrew", source: "CS1" }),
    actorDouble({ id: "boat", name: "Pony", source: "WR", type: `${MODULE_ID}.boat` }),
  ];
  const game = makeGame({ actors, sdxMap: { Bogthorn: "Monstrosity", Pony: "" }, sdxActive: true });
  const outcome = await runCreatureTypeBackfill({ game, log: silent });

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.id, CREATURE_TYPE_BACKFILL_ID);
  assert.equal(outcome.total, 4);
  assert.deepEqual(outcome.counts, { applied: 2, skipped: 1, missingMap: 1, failed: 0 });
  assert.deepEqual(outcome.missingMap.map(({ id, key, reason }) => ({ id, key, reason })), [
    { id: "unknown", key: "CS1:homebrew", reason: "missing-map" },
  ]);
  assert.equal(game.writes.length, 1, "only the consumer stamp is a setting write");
  assert.deepEqual(actors.find((actor) => actor.id === "bog").writes, [
    ["update", { "flags.shadowdark-enhancer.creatureType": "Plant" }],
  ]);
  assert.deepEqual(actors.find((actor) => actor.id === "pony").writes, [
    ["update", {
      "flags.shadowdark-enhancer.creatureType": "Animal",
      "flags.shadowdark-extras.creatureType": "Animal",
    }],
  ]);
  assert.deepEqual(actors.find((actor) => actor.id === "boat").writes, []);
});

test("a completed E3 run is idempotent at the same version", async () => {
  const actors = [actorDouble({ id: "bog", name: "Bogthorn", source: "CS1" })];
  const game = makeGame({ actors });
  let lookups = 0;
  const findPack = () => {
    lookups++;
    if (lookups > 1) throw new Error("up-to-date gate must not read the pack");
    return game.managed;
  };
  const first = await runCreatureTypeBackfill({ game, findPack, log: silent });
  assert.equal(first.status, "completed");

  const second = await runCreatureTypeBackfill({ game, findPack, log: silent });
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "up-to-date");
  assert.equal(second.counts.applied, 0);
  assert.deepEqual(actors[0].writes, [
    ["update", { "flags.shadowdark-enhancer.creatureType": "Plant" }],
  ]);
  assert.deepEqual(game.writes, [[CREATURE_TYPE_BACKFILL_VERSION_SETTING, VERSION]]);
});

test("partial document failure leaves the stamp open and retries only remaining missing flags", async () => {
  const actors = [
    actorDouble({ id: "bog", name: "Bogthorn", source: "CS1" }),
    actorDouble({ id: "pony", name: "Pony", source: "WR", failWrites: 1 }),
  ];
  const game = makeGame({ actors });
  const options = { game, log: silent };

  const first = await runCreatureTypeBackfill(options);
  assert.equal(first.status, "failed");
  assert.deepEqual(first.counts, { applied: 1, skipped: 0, missingMap: 0, failed: 1 });
  assert.deepEqual(game.writes, [], "A6 does not advance the gate after a partial failure");

  const second = await runCreatureTypeBackfill(options);
  assert.equal(second.status, "completed");
  assert.deepEqual(second.counts, { applied: 1, skipped: 1, missingMap: 0, failed: 0 });
  assert.equal(actors[0].writes.length, 1, "already-applied Bogthorn is not rewritten");
  assert.equal(actors[1].writes.length, 2, "the failed Actor is retried");
  assert.deepEqual(game.writes, [[CREATURE_TYPE_BACKFILL_VERSION_SETTING, VERSION]]);
});

test("startup and settings wiring remain lazy and consumer-owned", async () => {
  const settings = await readFile(new URL("../scripts/shared/settings.mjs", import.meta.url), "utf8");
  const startup = await readFile(new URL("../scripts/shadowdark-enhancer.mjs", import.meta.url), "utf8");
  assert.match(settings, /game\.settings\.register\(MODULE_ID, "creatureTypeBackfillVersion"/);
  assert.match(startup, /import\("\.\/importer\/monsters\/creature-type-backfill\.mjs"\)/);
  assert.match(startup, /runCreatureTypeBackfill\(\{ game \}\)/);
  assert.doesNotMatch(startup, /import .*creature-type-backfill/);
  assert.deepEqual(CREATURE_TYPE_ACTOR_TYPES, ["NPC", "Mount", "shadowdark-enhancer.mount"]);
});
