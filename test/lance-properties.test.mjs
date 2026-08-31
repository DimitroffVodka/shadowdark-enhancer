/**
 * B5 regression coverage for the WR Lance's three non-core weapon properties.
 *
 * The materializer is Foundry-bound at runtime, so the test supplies a tiny
 * managed Items pack and observes the public draft/pack result without a live
 * world. B2 owns the folder and identity policy; B5 must converge on it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { prepareLanceProperties, resolveLanceProperties } from "../scripts/importer/items/wr-property-importer.mjs";
import { parseGear } from "../scripts/importer/items/gear-parser.mjs";
import { buildItemData } from "../scripts/importer/items/item-importer.mjs";
import { assembleCreateDrafts, parseGearTable } from "../scripts/importer/items/item-builder-gear.mjs";
import { overlayFor } from "../scripts/importer/char-content/class-overlays.mjs";

const commitSource = readFileSync(
  new URL("../scripts/importer/importer-hub-commit.mjs", import.meta.url),
  "utf8",
);
const classSource = readFileSync(
  new URL("../scripts/importer/char-content/class-unit-importer.mjs", import.meta.url),
  "utf8",
);
const builderSource = readFileSync(
  new URL("../scripts/importer/items/item-builder-app.mjs", import.meta.url),
  "utf8",
);

const LANCE_NAMES = ["Charge", "Devastating", "Mounted"];

function fakeWorld({ properties = [], itemCreateError = null } = {}) {
  const folders = [];
  const documents = properties.map((entry, index) => ({
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
  }));
  const calls = { folderCreates: [], itemCreates: [] };
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
        _id: doc.id, name: doc.name, type: doc.type, folder: doc.folder,
      }));
    },
    async getDocument(id) {
      return documents.find((doc) => doc.id === id) ?? null;
    },
  };

  const saved = new Map();
  for (const key of ["game", "Folder", "Item"]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  globalThis.game = { packs: [pack], user: { isGM: true } };
  globalThis.Folder = {
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
  globalThis.Item = {
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

  return {
    pack, folders, documents, calls,
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

const lanceDraft = () => ({
  name: "Lance",
  type: "Weapon",
  properties: ["Compendium.shadowdark.properties.Item.TWOHANDED"],
  lanceProperties: LANCE_NAMES.map((name) => ({ name })),
});

test("Lance properties create once in the canonical WR folder and append to core properties", async () => {
  const world = fakeWorld();
  try {
    const first = lanceDraft();
    await resolveLanceProperties([first]);

    assert.deepEqual(world.folders.map((f) => ({
      name: f.name, parent: f.folder?.id ?? null,
    })), [
      { name: "Western Reaches", parent: null },
      { name: "Weapon Properties", parent: "folder-1" },
    ]);
    assert.equal(world.calls.itemCreates.length, 3);
    assert.deepEqual(world.calls.itemCreates.map(({ data }) => ({
      name: data.name,
      type: data.type,
      folder: data.folder,
      itemType: data.system.itemType,
      description: data.system.description,
      source: data.system.source.title,
    })), LANCE_NAMES.map((name) => ({
      name,
      type: "Property",
      folder: "folder-2",
      itemType: "weapon",
      description: "<p></p>",
      source: "western-reaches",
    })));
    assert.deepEqual(first.properties, [
      "Compendium.shadowdark.properties.Item.TWOHANDED",
      ...world.calls.itemCreates.map(({ doc }) => doc.uuid),
    ]);
    assert.equal("lanceProperties" in first, false);

    const second = lanceDraft();
    await resolveLanceProperties([second]);
    assert.equal(world.folders.length, 2, "re-import created a duplicate folder");
    assert.equal(world.calls.itemCreates.length, 3, "re-import created duplicate Properties");
    assert.deepEqual(second.properties, first.properties, "re-import changed Property UUIDs");
  } finally {
    world.restore();
  }
});

test("direct WR Lance parsing carries exactly the three custom names into item properties", async () => {
  const [{ draft, warnings }] = parseGear(
    "Lance 15 gp M C 1d12 C, D, M, 3 slots",
    "Weapon",
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(draft.lanceProperties, LANCE_NAMES);
  assert.deepEqual(draft.unmappedProps, []);

  const world = fakeWorld();
  try {
    draft.properties = ["Compendium.shadowdark.properties.Item.TWOHANDED"];
    await resolveLanceProperties([draft]);
    const data = buildItemData(draft);
    assert.deepEqual(data.system.properties, [
      "Compendium.shadowdark.properties.Item.TWOHANDED",
      ...world.calls.itemCreates.map(({ doc }) => doc.uuid),
    ]);
    assert.equal(data.system.description, "<p></p>");
  } finally {
    world.restore();
  }
});

test("the direct-import and Paladin-overlay roads converge on the same Property UUIDs", async () => {
  const [{ draft: direct }] = parseGear(
    "Lance 15 gp M C 1d12 C, D, M, 3 slots",
    "Weapon",
  );
  direct.properties = ["Compendium.shadowdark.properties.Item.b6Gm2ULKj2qyy2xJ"];
  const overlay = overlayFor("Paladin").items.find((item) => item.name === "Lance");
  const classDraft = {
    properties: [...overlay.system.properties],
    lanceProperties: [...overlay.customProperties],
  };

  const world = fakeWorld();
  try {
    await resolveLanceProperties([direct, classDraft]);
    assert.equal(world.calls.itemCreates.length, 3, "the two roads created duplicate Properties");
    assert.deepEqual(classDraft.properties, direct.properties);
    assert.equal("lanceProperties" in classDraft, false);
  } finally {
    world.restore();
  }
});

test("unsupported WR codes remain visible while controls keep their exact parser shape", () => {
  const [{ draft: unknown, warnings }] = parseGear(
    "Obsidian club 5 cp M C 1d4 O, Sn",
    "Weapon",
  );
  assert.equal(unknown.lanceProperties, undefined);
  assert.deepEqual(unknown.unmappedProps, ["Obsidian", "Sniper"]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Obsidian.*\(O\)/);
  assert.match(warnings[1], /Sniper.*\(Sn\)/);

  const [{ draft: unrelated, warnings: unrelatedWarnings }] = parseGear(
    "Spear 8 gp M C 1d6 C",
    "Weapon",
  );
  assert.equal(unrelated.lanceProperties, undefined);
  assert.deepEqual(unrelated.unmappedProps, ["Charge"]);
  assert.deepEqual(unrelatedWarnings, [
    'Property "Charge" (C) has no core Shadowdark property — left off; noted in the description.',
  ]);

  const [{ draft: sameAsBaseline, warnings: baselineWarnings }] = parseGear(
    "War lance 15 gp M C 1d12 C, D, M, 3 slots",
    "Weapon",
  );
  assert.deepEqual(sameAsBaseline, {
    name: "War lance",
    type: "Weapon",
    cost: { gp: 15, sp: 0, cp: 0 },
    slots: { free_carry: 0, per_slot: 1, slots_used: 3 },
    damage: { oneHanded: "d12", twoHanded: "" },
    range: "close",
    wtype: "melee",
    propNames: [],
    unmappedProps: ["Charge", "Devastating", "Mounted"],
    description: "<p></p>",
  });
  assert.deepEqual(baselineWarnings, [
    'Property "Charge" (C) has no core Shadowdark property — left off; noted in the description.',
    'Property "Devastating" (D) has no core Shadowdark property — left off; noted in the description.',
    'Property "Mounted" (M) has no core Shadowdark property — left off; noted in the description.',
  ]);

  const [{ draft: control }] = parseGear(
    "Longsword 9 gp M C 1d8 F",
    "Weapon",
  );
  assert.deepEqual(control, {
    name: "Longsword",
    type: "Weapon",
    cost: { gp: 9, sp: 0, cp: 0 },
    slots: { free_carry: 0, per_slot: 1, slots_used: 1 },
    damage: { oneHanded: "d8", twoHanded: "" },
    range: "close",
    wtype: "melee",
    propNames: ["Finesse"],
    unmappedProps: [],
    description: "<p></p>",
  });
});

function methodBody(name, nextName) {
  const start = commitSource.indexOf(`async ${name}(`);
  const end = commitSource.indexOf(`\n  async ${nextName}(`, start);
  assert.ok(start >= 0, `${name} not found`);
  assert.ok(end > start, `${name} boundary not found`);
  return commitSource.slice(start, end);
}

test("dedicated Items commit and Commit All prepare Lance properties before item creation", () => {
  const individual = methodBody("_onHubCommitItems", "_commitSpells");
  const all = methodBody("_onHubCommitAll", "_onExportBundle");
  for (const [label, body] of [["Items", individual], ["Commit All", all]]) {
    assert.match(body, /drafts\.some\(\(d\) => d\.lanceProperties\?\.length\)/,
      `${label} must detect Lance property drafts`);
    assert.match(body, /prepareLanceProperties\(drafts\)/,
      `${label} must materialize Lance properties before item creation`);
  }
});

test("guided Item Builder carries the Lance marker to its create draft", () => {
  const rows = parseGearTable("Lance 15 gp M C 1d12 C, D, M, 3 slots", "Weapon");
  const [draft] = assembleCreateDrafts(rows, "Weapon");
  assert.deepEqual(draft.lanceProperties, LANCE_NAMES);
  assert.match(builderSource, /drafts\.some\(\(d\) => d\.lanceProperties\?\.length\)/);
  assert.match(builderSource, /prepareLanceProperties\(drafts\)/);
});

test("the class importer prepares overlay Lance Properties and writes the resolved list", () => {
  assert.match(classSource, /lanceProperties: it\.customProperties/);
  assert.match(classSource, /prepareLanceProperties\(overlayGear, \{ pack: itemsPack \}\)/);
  assert.match(classSource, /\.\.\.\(Array\.isArray\(prepared\?\.properties\).*prepared\.properties/);
});

test("failed Lance Property creation is visible and leaves the draft retryable", async () => {
  const world = fakeWorld({ itemCreateError: new Error("pack is locked") });
  try {
    const [{ draft }] = parseGear("Lance 15 gp M C 1d12 C, D, M, 3 slots", "Weapon");
    assert.equal(await prepareLanceProperties([draft]), false);
    assert.equal(world.calls.itemCreates.length, 0);
    assert.equal("lanceProperties" in draft, true, "failed preparation consumed the retry marker");
    assert.equal("properties" in draft, false, "failed preparation stamped incomplete UUIDs");
  } finally {
    world.restore();
  }
});

test("Lance preparation refuses a noncanonical marker without creating an unknown Property", async () => {
  const world = fakeWorld();
  try {
    const draft = { name: "Lance", type: "Weapon", lanceProperties: ["Obsidian"] };
    assert.equal(await prepareLanceProperties([draft]), false);
    assert.deepEqual(world.folders, []);
    assert.equal(world.calls.itemCreates.length, 0);
    assert.deepEqual(draft.lanceProperties, ["Obsidian"]);
  } finally {
    world.restore();
  }
});
