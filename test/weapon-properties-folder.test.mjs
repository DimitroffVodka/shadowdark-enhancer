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

import {
  prepareSiegeProperties,
  resolveSiegeProperties,
} from "../scripts/importer/boats/siege-importer.mjs";

const commitSource = readFileSync(
  new URL("../scripts/importer/importer-hub-commit.mjs", import.meta.url),
  "utf8",
);

function fakeWorld({ properties = [], folders: seededFolders = [], itemCreateError = null } = {}) {
  const folders = seededFolders.map(({ id, name, parent = null }) => ({
    id,
    name,
    folder: parent ? { id: parent } : null,
  }));
  const calls = { folderCreates: [], itemCreates: [], moves: [], notificationErrors: [] };
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
      const error = typeof itemCreateError === "function" ? itemCreateError(data) : itemCreateError;
      if (error) throw (error instanceof Error ? error : new Error(String(error)));
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
  for (const [key, value] of Object.entries({
    game: globalThis.game, Folder: globalThis.Folder, Item: globalThis.Item, ui: globalThis.ui,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    if (value === undefined) delete globalThis[key];
  }
  globalThis.game = { packs: [pack], user: { isGM: true } };
  globalThis.Folder = Folder;
  globalThis.Item = Item;
  globalThis.ui = { notifications: { error(message) { calls.notificationErrors.push(message); } } };

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
    assert.equal(await prepareSiegeProperties([first]), true);

    assert.deepEqual(world.folders.map((f) => ({ name: f.name, parent: f.folder?.id ?? null })), [
      { name: "Western Reaches", parent: null },
      { name: "Weapon Properties", parent: "folder-1" },
    ]);
    assert.equal(world.calls.itemCreates.length, 2);
    assert.deepEqual(world.calls.itemCreates.map(({ data }) => data.folder), ["folder-2", "folder-2"]);
    assert.deepEqual(first.properties, world.calls.itemCreates.map(({ doc }) => doc.uuid));
    assert.equal("siegeProperties" in first, false);

    const second = siegeDraft();
    assert.equal(await prepareSiegeProperties([second]), true);
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

test("target-folder collision wins over a root duplicate without moving either document", async () => {
  const world = fakeWorld({
    folders: [
      { id: "wr-folder", name: "Western Reaches" },
      { id: "weapon-properties-folder", name: "Weapon Properties", parent: "wr-folder" },
    ],
    properties: [
      { id: "root-blast", name: "Blast" },
      { id: "target-blast", name: "Blast", folder: "weapon-properties-folder" },
    ],
  });
  try {
    const draft = siegeDraft(["Blast"]);
    await resolveSiegeProperties([draft]);

    assert.equal(world.calls.itemCreates.length, 0, "target collision created a third Property");
    assert.deepEqual(draft.properties, [
      "Compendium.world.shadowdark-enhancer--items.Item.target-blast",
    ]);
    assert.deepEqual(world.documents.map((doc) => ({ id: doc.id, folder: doc.folder, updates: doc.updates })), [
      { id: "root-blast", folder: null, updates: [] },
      { id: "target-blast", folder: "weapon-properties-folder", updates: [] },
    ]);
  } finally {
    world.restore();
  }
});

test("two root duplicates choose the lowest id deterministically and leave the other at root", async () => {
  const world = fakeWorld({
    properties: [
      { id: "root-z", name: "Blast" },
      { id: "root-a", name: "Blast" },
    ],
  });
  try {
    const draft = siegeDraft(["Blast"]);
    await resolveSiegeProperties([draft]);

    assert.equal(world.calls.itemCreates.length, 0, "root collision created a duplicate Property");
    assert.deepEqual(draft.properties, [
      "Compendium.world.shadowdark-enhancer--items.Item.root-a",
    ]);
    assert.deepEqual(world.documents.map((doc) => ({ id: doc.id, folder: doc.folder, updates: doc.updates })), [
      { id: "root-z", folder: null, updates: [] },
      { id: "root-a", folder: "folder-2", updates: [{ folder: "folder-2" }] },
    ]);
  } finally {
    world.restore();
  }
});

test("same-name Property in an unrelated folder stays untouched while canonical target is created", async () => {
  const world = fakeWorld({
    folders: [{ id: "custom-folder", name: "Custom Properties" }],
    properties: [{ id: "custom-blast", name: "Blast", folder: "custom-folder" }],
  });
  try {
    const draft = siegeDraft(["Blast"]);
    await resolveSiegeProperties([draft]);

    assert.equal(world.calls.itemCreates.length, 1, "unrelated Property was incorrectly reused");
    assert.deepEqual(world.calls.itemCreates[0].data, {
      name: "Blast",
      type: "Property",
      system: { itemType: "weapon", description: "<p>Blast rule text.</p>", source: { title: "western-reaches" } },
      folder: "folder-2",
    });
    assert.deepEqual(draft.properties, [
      "Compendium.world.shadowdark-enhancer--items.Item.property-2",
    ]);
    assert.deepEqual({
      id: "custom-blast",
      name: world.documents[0].name,
      type: world.documents[0].type,
      folder: world.documents[0].folder,
      updates: world.documents[0].updates,
    }, {
      id: "custom-blast", name: "Blast", type: "Property", folder: "custom-folder", updates: [],
    });
  } finally {
    world.restore();
  }
});

test("failed Property creation blocks the prepass and reports an import error", async () => {
  const world = fakeWorld({ itemCreateError: new Error("pack is locked") });
  try {
    const draft = siegeDraft(["Blast"]);
    assert.equal(await prepareSiegeProperties([draft]), false);
    assert.equal(world.calls.itemCreates.length, 0);
    assert.deepEqual(world.calls.notificationErrors, [
      "Siege weapon Properties could not be prepared; no items were imported. See the console.",
    ]);
    assert.equal("siegeProperties" in draft, true, "failed prepass consumed the retry marker");
    assert.equal("properties" in draft, false, "failed prepass stamped an incomplete properties list");
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
    assert.match(body, /prepareSiegeProperties\(drafts\)/,
      `${label} must use the shared siege-property preparation helper`);
  }
});
