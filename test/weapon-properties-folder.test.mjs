/**
 * Regression coverage for WR siege-property materialization.
 *
 * Blast and Exploding are real Property Items, but unlike system properties
 * they are created by the siege importer itself. Keep their foldering and
 * reuse contract independent of a live Foundry browser, and pin both hub
 * commit paths to the same preparation step.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveSiegeProperties } from "../scripts/importer/boats/siege-importer.mjs";

const commitSource = readFileSync(
  new URL("../scripts/importer/importer-hub-commit.mjs", import.meta.url),
  "utf8",
);

function fakeWorld({ properties = [] } = {}) {
  const folders = [];
  const documents = properties.map((entry, index) => {
    const doc = {
      id: entry.id ?? `property-${index + 1}`,
      name: entry.name,
      type: "Property",
      folder: entry.folder ?? null,
      updates: [],
      async update(changes) {
        this.updates.push(changes);
        if (Object.hasOwn(changes, "folder")) this.folder = changes.folder;
        return this;
      },
    };
    return doc;
  });
  const calls = { folderCreates: [], itemCreates: [], moves: [] };
  let nextFolder = 1;
  let nextItem = documents.length + 1;

  const pack = {
    collection: "world.shadowdark-enhancer--items",
    documentName: "Item",
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Items" },
    locked: false,
    folders,
    async getIndex() {
      return documents.map((doc) => ({
        _id: doc.id,
        name: doc.name,
        type: doc.type,
        folder: doc.folder,
      }));
    },
    async getDocument(id) {
      return documents.find((doc) => doc.id === id) ?? null;
    },
  };

  const Folder = {
    async create(data) {
      const folder = {
        id: `folder-${nextFolder++}`,
        name: data.name,
        folder: data.folder ? { id: data.folder } : null,
      };
      folders.push(folder);
      calls.folderCreates.push({ data, folder });
      return folder;
    },
  };

  const Item = {
    async create(data) {
      const id = `property-${nextItem++}`;
      const doc = {
        id,
        name: data.name,
        type: data.type,
        folder: data.folder ?? null,
        uuid: `Compendium.${pack.collection}.Item.${id}`,
        async update(changes) {
          if (Object.hasOwn(changes, "folder")) this.folder = changes.folder;
          return this;
        },
      };
      documents.push(doc);
      calls.itemCreates.push({ data, doc });
      return doc;
    },
  };

  const saved = new Map();
  for (const [key, value] of Object.entries({ game: globalThis.game, Folder: globalThis.Folder, Item: globalThis.Item })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    if (value === undefined) delete globalThis[key];
  }
  globalThis.game = { packs: [pack], user: { isGM: true } };
  globalThis.Folder = Folder;
  globalThis.Item = Item;

  return {
    pack,
    folders,
    documents,
    calls,
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

const siegeDraft = (names = ["Blast", "Exploding"]) => ({
  name: "Ballista",
  type: "Weapon",
  siegeProperties: names.map((name) => ({ name, description: `<p>${name} rule text.</p>` })),
});

test("siege properties create once under Western Reaches / Weapon Properties and reuse on re-import", async () => {
  const world = fakeWorld();
  try {
    const first = siegeDraft();
    await resolveSiegeProperties([first]);

    assert.deepEqual(world.folders.map((f) => ({ name: f.name, parent: f.folder?.id ?? null })), [
      { name: "Western Reaches", parent: null },
      { name: "Weapon Properties", parent: "folder-1" },
    ]);
    assert.equal(world.calls.itemCreates.length, 2);
    assert.deepEqual(world.calls.itemCreates.map(({ data }) => data.folder), ["folder-2", "folder-2"]);
    assert.deepEqual(first.properties, world.calls.itemCreates.map(({ doc }) => doc.uuid));
    assert.equal("siegeProperties" in first, false);

    const second = siegeDraft();
    await resolveSiegeProperties([second]);
    assert.equal(world.folders.length, 2, "re-import created a duplicate folder");
    assert.equal(world.calls.itemCreates.length, 2, "re-import created duplicate Property items");
    assert.deepEqual(second.properties, first.properties, "re-import did not reuse Property UUIDs");
  } finally {
    world.restore();
  }
});

test("pre-B2 root properties move in place without changing their UUIDs", async () => {
  const world = fakeWorld({
    properties: [
      { id: "blast-id", name: "Blast" },
      { id: "exploding-id", name: "Exploding" },
    ],
  });
  try {
    const draft = siegeDraft();
    await resolveSiegeProperties([draft]);

    assert.equal(world.calls.itemCreates.length, 0, "existing properties were duplicated");
    assert.deepEqual(world.documents.map((doc) => doc.folder), ["folder-2", "folder-2"]);
    assert.deepEqual(world.documents.map((doc) => doc.updates), [
      [{ folder: "folder-2" }],
      [{ folder: "folder-2" }],
    ]);
    assert.deepEqual(draft.properties, [
      "Compendium.world.shadowdark-enhancer--items.Item.blast-id",
      "Compendium.world.shadowdark-enhancer--items.Item.exploding-id",
    ]);
  } finally {
    world.restore();
  }
});

function methodBody(name, nextName) {
  const start = commitSource.indexOf(`async ${name}(`);
  const end = commitSource.indexOf(`\n  async ${nextName}(`, start);
  assert.ok(start >= 0, `${name} not found`);
  assert.ok(end > start, `${name} boundary not found`);
  return commitSource.slice(start, end);
}

test("dedicated Items commit and Commit All both prepare siege properties", () => {
  const individual = methodBody("_onHubCommitItems", "_commitSpells");
  const all = methodBody("_onHubCommitAll", "_onExportBundle");
  for (const [label, body] of [["Items", individual], ["Commit All", all]]) {
    assert.match(body, /drafts\.some\(\(d\) => d\.siegeProperties\?\.length\)/,
      `${label} must detect siege-property drafts`);
    assert.match(body, /resolveSiegeProperties\(drafts\)/,
      `${label} must materialize siege properties before item creation`);
  }
});
