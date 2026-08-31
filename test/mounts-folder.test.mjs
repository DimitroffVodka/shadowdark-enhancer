/**
 * Mount placement is a managed-pack concern, not a parser concern.
 *
 * These fixtures exercise the Foundry-bound MountImporter seam without a live
 * world: one stable Actor folder is resolved before the batch, duplicate names
 * are skipped in place, and a failed document remains retryable. The ordinary
 * Boat and monster source-folder contracts are pinned alongside it so this
 * subtype-specific folder cannot leak into their import paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// mount-importer imports encounter-creator, whose module-level renderer reads
// Foundry during evaluation. Load it once with the smallest browser shim; all
// actual Foundry globals are installed per fake world below.
const savedRuntime = new Map();
for (const key of ["foundry", "CompendiumCollection"]) {
  savedRuntime.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
}
globalThis.foundry = {
  applications: {
    handlebars: { renderTemplate() {} },
  },
  documents: {
    collections: { CompendiumCollection: {} },
  },
  utils: {
    cleanHTML: (value) => value,
  },
};
const { MountImporter, ensureMountFolder, MOUNT_FOLDER_NAME } =
  await import("../scripts/importer/boats/mount-importer.mjs");
for (const [key, descriptor] of savedRuntime) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else delete globalThis[key];
}

const boatSource = readFileSync(
  new URL("../scripts/importer/boats/boat-importer.mjs", import.meta.url), "utf8");
const monsterSource = readFileSync(
  new URL("../scripts/importer/monsters/monster-importer.mjs", import.meta.url), "utf8");

function draft(name) {
  return {
    name,
    alignment: "N",
    level: 1,
    img: "icons/svg/mystery-man.svg",
    tokenSrc: "",
    description: `${name} description`,
    hp: { value: 5, max: 5 },
    ac: 11,
    abilities: { str: 1, dex: 1, con: 1, int: -1, wis: 0, cha: -1 },
    move: "near",
    moveNote: "",
    darkAdapted: false,
    spellcasting: { ability: "", bonus: 0, attacks: 0 },
    actions: [],
    features: [],
    spells: [],
  };
}

/**
 * A small Actor-pack adapter. The shape deliberately exposes the same
 * collection/index/document boundaries the production importer uses, while
 * recording every folder and Actor write for assertions.
 */
function fakeWorld({ folders: seededFolders = [], actors: seededActors = [], failCreates = [] } = {}) {
  const folders = seededFolders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    type: folder.type,
    folder: folder.parent ? { id: folder.parent } : null,
  }));
  const actors = seededActors.map((actor) => ({
    id: actor.id,
    name: actor.name,
    type: actor.type ?? "shadowdark-enhancer.mount",
    folder: actor.folder ?? null,
    uuid: `Compendium.world.sde-actors.Actor.${actor.id}`,
    flags: actor.flags ?? {},
  }));
  const failures = new Map(failCreates.map((name) => [name, 1]));
  const calls = { folderCreates: [], actorCreates: [], errors: [] };
  let nextFolder = 1;
  let nextActor = 1;

  const pack = {
    collection: "world.sde-actors",
    documentName: "Actor",
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Actors" },
    locked: false,
    folders,
    async getIndex() {
      return actors.map((actor) => ({
        _id: actor.id,
        name: actor.name,
        type: actor.type,
        folder: actor.folder,
      }));
    },
    async getDocument(id) {
      return actors.find((actor) => actor.id === id) ?? null;
    },
  };

  const Folder = {
    async create(data) {
      const folder = {
        id: `folder-${nextFolder++}`,
        name: data.name,
        type: data.type,
        folder: data.folder ? { id: data.folder } : null,
      };
      folders.push(folder);
      calls.folderCreates.push({ data, folder });
      return folder;
    },
  };

  const Actor = {
    async create(data, options) {
      assert.equal(options.pack, pack.collection);
      const remaining = failures.get(data.name) ?? 0;
      if (remaining) {
        failures.set(data.name, remaining - 1);
        throw new Error(`simulated create failure for ${data.name}`);
      }
      const actor = {
        id: `actor-${nextActor++}`,
        name: data.name,
        type: data.type,
        folder: data.folder ?? null,
        uuid: `Compendium.${pack.collection}.Actor.actor-${nextActor - 1}`,
        flags: data.flags ?? {},
        system: data.system,
      };
      actors.push(actor);
      calls.actorCreates.push({ data, actor });
      return actor;
    },
  };

  const saved = new Map();
  for (const key of ["game", "Folder", "Actor", "CONST", "ui", "foundry", "fromUuid"]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  globalThis.game = { packs: [pack], user: { isGM: true } };
  globalThis.Folder = Folder;
  globalThis.Actor = Actor;
  globalThis.CONST = { DEFAULT_TOKEN: "icons/svg/mystery-man.svg" };
  globalThis.ui = { notifications: { error(message) { calls.errors.push(message); } } };
  globalThis.foundry = {
    applications: { handlebars: { renderTemplate() {} } },
    documents: { collections: { CompendiumCollection: {} } },
    utils: { cleanHTML: (value) => value },
  };
  globalThis.fromUuid = async () => null;

  return {
    pack,
    folders,
    actors,
    calls,
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("Mounts folder helper reuses an existing top-level Actor folder", async () => {
  const world = fakeWorld({ folders: [{ id: "mounts", name: "Mounts", type: "Actor" }] });
  try {
    assert.equal(await ensureMountFolder(world.pack), "mounts");
    assert.equal(await ensureMountFolder(world.pack), "mounts");
    assert.equal(world.calls.folderCreates.length, 0);
  } finally {
    world.restore();
  }
});

test("Mounts folder helper creates one correctly typed root folder when missing", async () => {
  const world = fakeWorld();
  try {
    const folderId = await ensureMountFolder(world.pack);
    assert.equal(folderId, "folder-1");
    assert.deepEqual(world.calls.folderCreates.map(({ data }) => data), [
      { name: MOUNT_FOLDER_NAME, type: "Actor" },
    ]);
    assert.equal(await ensureMountFolder(world.pack), folderId);
    assert.equal(world.calls.folderCreates.length, 1);
  } finally {
    world.restore();
  }
});

test("a same-name non-Actor folder is not reused for Mount actors", async () => {
  const world = fakeWorld({ folders: [{ id: "wrong-type", name: "Mounts", type: "Item" }] });
  try {
    const folderId = await ensureMountFolder(world.pack);
    assert.notEqual(folderId, "wrong-type");
    assert.equal(world.calls.folderCreates.length, 1);
    assert.deepEqual(world.calls.folderCreates[0].data, {
      name: "Mounts", type: "Actor",
    });
  } finally {
    world.restore();
  }
});

test("individual and batch-shaped Mount commits share one folder and reimport identity", async () => {
  const world = fakeWorld();
  try {
    const first = await MountImporter.createMounts([draft("Donkey")], { source: "Western Reaches" });
    const firstActor = world.actors[0];
    assert.deepEqual(first, { created: ["Donkey"], skipped: [], replaced: [] });
    assert.equal(world.calls.folderCreates.length, 1);
    assert.deepEqual(world.calls.folderCreates[0].data, { name: "Mounts", type: "Actor" });
    assert.equal(world.folders[0].name, "Mounts");
    assert.equal(firstActor.folder, "folder-1");
    assert.equal(firstActor.flags["shadowdark-enhancer"].source, "Western Reaches");

    const batch = await MountImporter.createMounts(
      [draft("Donkey"), draft("Pony")], { source: "Western Reaches" });
    assert.deepEqual(batch, { created: ["Pony"], skipped: ["Donkey"], replaced: [] });
    assert.equal(world.calls.folderCreates.length, 1, "batch created a second Mounts folder");
    assert.equal(world.actors.find((actor) => actor.name === "Donkey").id, firstActor.id);
    assert.ok(world.actors.every((actor) => actor.folder === "folder-1"));
    assert.equal(world.actors.length, 2);
  } finally {
    world.restore();
  }
});

test("a partial Mount batch continues and a retry creates only the failed actor", async () => {
  const world = fakeWorld({ failCreates: ["Pony"] });
  try {
    const first = await MountImporter.createMounts(
      [draft("Donkey"), draft("Pony"), draft("War Horse")],
      { source: "Western Reaches" },
    );
    assert.deepEqual(first, {
      created: ["Donkey", "War Horse"], skipped: [], replaced: [],
    });
    assert.equal(world.actors.length, 2);
    assert.equal(world.calls.folderCreates.length, 1);

    const retry = await MountImporter.createMounts(
      [draft("Donkey"), draft("Pony"), draft("War Horse")],
      { source: "Western Reaches" },
    );
    assert.deepEqual(retry, {
      created: ["Pony"], skipped: ["Donkey", "War Horse"], replaced: [],
    });
    assert.equal(world.calls.folderCreates.length, 1);
    assert.equal(world.actors.length, 3);
    assert.equal(new Set(world.actors.map((actor) => actor.id)).size, 3);
  } finally {
    world.restore();
  }
});

test("Boat and ordinary monster imports retain their existing source-folder seam", () => {
  assert.match(boatSource, /ensureSourceFolder\(pack, source \|\| "Western Reaches"\)/);
  assert.match(monsterSource, /ensureSourceFolder\(pack, source\)/);
  assert.doesNotMatch(boatSource, /Mounts/);
  assert.doesNotMatch(monsterSource, /Mounts/);
});
