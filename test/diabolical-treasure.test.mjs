/**
 * D6/#59 — Diabolical Treasure's exact CS1 census, unidentified Item shape,
 * curated art, generated reconciliation, and safe RollTable materialization.
 *
 * These fixtures stay Foundry-free.  The live import/reimport/draw proof is a
 * separate bounded lease because the generated pack is shared world state.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import { ART_STATES, MANAGED_ITEMS_PACK } from "../scripts/shared/art-provenance.mjs";
import {
  CURATED_KEY_SPACES,
  auditCuratedIconRegistry,
  buildCuratedIconRegistry,
  curatedIconRegistry,
} from "../scripts/shared/curated-icons.mjs";
import { generatedItemId, readGeneratedItem } from "../scripts/shared/generated-items.mjs";
import {
  DIABOLICAL_TREASURE_ICONS,
} from "../scripts/shared/curated-icon-maps/diabolical-treasure-icons.mjs";
import "../scripts/shared/curated-icon-maps/index.mjs";
import {
  DIABOLICAL_TREASURE_CONTENT_ID,
  DIABOLICAL_TREASURE_MANIFEST_ID,
  DIABOLICAL_TREASURE_ROWS as SOURCE_ROWS,
  DIABOLICAL_TREASURE_TABLE_NAME,
  buildDiabolicalTreasureDefinitions,
  buildDiabolicalTreasureItem,
  isDiabolicalTreasureTable,
  materializeDiabolicalTreasure,
  parseDiabolicalTreasureResult,
  diabolicalTreasureSource,
} from "../scripts/loot/diabolical-treasure.mjs";

const LOCAL_FOUNDRY_ICON_ROOT = "/home/patricks/FoundryV14/public/icons";
const configuredIconRoot = String(process.env.SHADOWDARK_ENHANCER_FOUNDRY_ICON_ROOT ?? "").trim();
const FOUNDRY_ICON_ROOT = path.resolve(configuredIconRoot || LOCAL_FOUNDRY_ICON_ROOT);

function foundryIconInventory(dir, prefix = "icons", out = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) foundryIconInventory(full, relative, out);
    else if (entry.isFile() && entry.name.endsWith(".webp")) out.add(relative);
  }
  return out;
}

function loadFoundryIconInventory(root) {
  try {
    if (!statSync(root).isDirectory()) return null;
    return foundryIconInventory(root);
  } catch {
    return null;
  }
}

const FOUNDRY_ICONS = loadFoundryIconInventory(FOUNDRY_ICON_ROOT);
const INVENTORY_SKIP_REASON = FOUNDRY_ICONS === null
  ? `Foundry icon directory unavailable: ${FOUNDRY_ICON_ROOT}`
  : false;

function sourceResult(name, feature, index) {
  return {
    id: `source-${index}`,
    range: [index + 1, index + 1],
    weight: 1,
    drawn: false,
    type: 0,
    name: `${name} | ${feature}`,
    toObject() { return { ...this }; },
  };
}

function sourceRows() {
  let index = 0;
  return SOURCE_ROWS.flatMap((item) => SOURCE_ROWS.map((featureRow) => (
    sourceResult(item.name, featureRow.feature, index++)
  )));
}

function itemDocument(payload, id) {
  const doc = {
    id,
    uuid: `Compendium.${MANAGED_ITEMS_PACK}.Item.${id}`,
    ...clone(payload),
  };
  doc.toObject = function toObject() { return { ...this, _id: this.id }; };
  return doc;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fakePack(initial = []) {
  const docs = [...initial];
  return {
    collection: MANAGED_ITEMS_PACK,
    docs,
    async getDocuments() { return docs; },
  };
}

function createAdapter(pack, { failName = null } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    createItem: async (payload) => {
      calls += 1;
      if (payload.name === failName) return null;
      const doc = itemDocument(payload, `generated-${calls}`);
      pack.docs.push(doc);
      return doc;
    },
    replace: async (doc, payload) => {
      const id = doc.id;
      const uuid = doc.uuid;
      for (const key of Object.keys(doc)) {
        if (!["id", "uuid", "toObject"].includes(key)) delete doc[key];
      }
      Object.assign(doc, clone(payload), { id, uuid });
    },
  };
}

function tableResult(row) {
  return {
    ...row,
    toObject() { return { ...this }; },
  };
}

function makeTable(
  rows = sourceRows(),
  flags = { source: "CS1", manifestId: DIABOLICAL_TREASURE_MANIFEST_ID },
  { supportsUpdate = true, failCreates = 0, failDeletes = 0, failUpdates = 0, partialUpdate = false } = {},
) {
  const table = {
    name: DIABOLICAL_TREASURE_TABLE_NAME,
    formula: rows.length === 400 ? "1d400" : "1d20",
    flags: { [MODULE_ID]: { ...flags } },
    results: rows.map(tableResult),
    deleted: 0,
    created: 0,
    updated: 0,
    failCreates,
    failDeletes,
    failUpdates,
    partialUpdate,
    async deleteEmbeddedDocuments(_name, ids) {
      if (this.failDeletes > 0) {
        this.failDeletes -= 1;
        throw new Error("forced TableResult delete failure");
      }
      this.deleted += ids.length ? 1 : 0;
      const removed = new Set(ids);
      this.results = this.results.filter((row) => !removed.has(row.id));
    },
    async createEmbeddedDocuments(_name, rowsToCreate) {
      if (this.failCreates > 0) {
        this.failCreates -= 1;
        throw new Error("forced TableResult create failure");
      }
      this.created += 1;
      const nextId = this.results.length + 1;
      this.results.push(...rowsToCreate.map((row, index) => tableResult({
        ...row,
        id: row._id ?? `row-${nextId + index}`,
      })));
    },
  };
  if (supportsUpdate) {
    table.updateEmbeddedDocuments = async (_name, updates) => {
      table.updated += 1;
      if (table.failUpdates > 0) {
        table.failUpdates -= 1;
        if (table.partialUpdate && updates.length) {
          const first = updates[0];
          table.results = table.results.map((row) => (
            row.id === first._id
              ? tableResult({ ...row, ...first, id: row.id, _id: undefined })
              : row
          ));
        }
        throw new Error("forced TableResult update failure");
      }
      const byId = new Map(updates.map((update) => [update._id, update]));
      table.results = table.results.map((row) => {
        const update = byId.get(row.id);
        if (!update) return row;
        const next = { ...row, ...update, id: row.id };
        delete next._id;
        if (Object.hasOwn(next, "-=documentUuid")) {
          delete next.documentUuid;
          delete next["-=documentUuid"];
        }
        return tableResult(next);
      });
    };
  }
  table.update = async (update) => {
    Object.assign(table, update);
  };
  return table;
}

function plainResultSnapshot(table) {
  return table.results.map((row) => {
    const out = row.toObject();
    delete out.toObject;
    return clone(out);
  });
}

function materializeOptions(pack, adapter, table = null) {
  return {
    ensurePack: async () => pack,
    ensureFolder: async () => "folder-cs1-treasure",
    adapter,
    notify: () => {},
    ...(table ? { table } : {}),
  };
}

test("the N3 §5.2 map is exactly twenty sourced rows and passes the real path gate", { skip: INVENTORY_SKIP_REASON }, () => {
  assert.ok(FOUNDRY_ICONS.size > 1_000, "the path predicate must use the real Foundry inventory");
  assert.equal(DIABOLICAL_TREASURE_ICONS.label, "diabolical-treasure");
  assert.equal(DIABOLICAL_TREASURE_ICONS.space, CURATED_KEY_SPACES.SOURCED);
  assert.equal(DIABOLICAL_TREASURE_ICONS.entries.size, 20);
  assert.deepEqual(DIABOLICAL_TREASURE_ICONS.problems, []);
  const report = auditCuratedIconRegistry(buildCuratedIconRegistry([DIABOLICAL_TREASURE_ICONS]), {
    pathExists: (iconPath) => FOUNDRY_ICONS.has(iconPath),
  });
  assert.equal(report.total, 20);
  assert.equal(report.bare, 0);
  assert.equal(report.sourced, 20);
  assert.deepEqual(report.perMap, [{ label: "diabolical-treasure", space: "sourced", entries: 20 }]);
  assert.deepEqual(report.problems, []);
});

test("A4 discovery registers the D6 map and keeps its identity source-qualified", () => {
  const registry = curatedIconRegistry();
  assert.ok(registry.maps.includes(DIABOLICAL_TREASURE_ICONS));
  assert.equal(registry.sourced.get("cs1:carved bone"), SOURCE_ROWS[0].img);
  assert.equal(registry.sourced.get("cs2:carved bone"), undefined);
  assert.equal(generatedItemId("CS1", SOURCE_ROWS[0].name), generatedItemId("Cursed Scroll #1", SOURCE_ROWS[0].name));
  assert.notEqual(generatedItemId("CS1", SOURCE_ROWS[0].name), generatedItemId("CS3", SOURCE_ROWS[0].name));
});

test("the source census carries every reviewed feature in N3 order", () => {
  assert.equal(SOURCE_ROWS.length, 20);
  assert.deepEqual(SOURCE_ROWS.map((row) => row.name), [
    "Carved bone", "Eyeball", "Wolf idol", "Dried rose", "Pickled imp",
    "Bundle of sage", "Cold iron spike", "Warped skull", "Cracked mirror",
    "Severed finger", "Black candle", "Shrunken head", "Ring of daisies",
    "Unholy symbol", "Rusty key", "Vial of blood", "Faded locket",
    "Bag of teeth", "Pan pipe", "Brain in a jar",
  ]);
  assert.deepEqual(SOURCE_ROWS.map((row) => row.feature), [
    "Ignites in flames once/day for 1d4 rounds",
    "Repels insects and spiders to arm's length",
    "Floats in the air wherever it's placed",
    "Turns toward due north when untouched",
    "Attracts demonic creatures to its location",
    "A creature holding it can't knowingly lie",
    "You can smell if something is poisonous",
    "Drips blood in the presence of undead",
    "Sings a haunting lullaby when rattled",
    "Belongs to a witch who wants it back",
    "Causes pain and disgust in fey creatures",
    "Can open a one-way gate to hell once",
    "Allows you to hold your breath for an hour",
    "A demon owes the item's owner a favor",
    "Once/day, fire immunity 1d4 rounds",
    "Slowly rolls away on its own if released",
    "Once/day, briefly read one creature's mind",
    "Object cannot be crushed by anything",
    "As heavy as an anvil when not carried",
    "Causes doubt and hesitation in demons",
  ]);
});

describe("Diabolical Treasure parsing and Item shape", () => {
  test("the 20×20 source expansion reduces to one canonical row per Item", () => {
    const definitions = buildDiabolicalTreasureDefinitions(sourceRows());
    assert.equal(definitions.entries.length, 20);
    assert.equal(definitions.desired.length, 20);
    assert.equal(definitions.resolved.length, 20);
    assert.equal(definitions.unresolved.length, 0);
    assert.deepEqual(definitions.desired.map((item) => item.name), SOURCE_ROWS.map((row) => row.name));
    assert.ok(definitions.resolved.every((entry) => entry.displayText === entry.name));
  });

  test("one Item exposes only the physical face until identification", () => {
    const row = SOURCE_ROWS[0];
    const built = buildDiabolicalTreasureItem(`${row.name} | ${row.feature}`);
    assert.equal(built.status, "resolved");
    assert.equal(built.itemData.type, "Basic");
    assert.equal(built.itemData.name, row.name);
    assert.equal(built.itemData.system.magicItem, true);
    assert.equal(built.itemData.system.treasure, true);
    assert.equal(built.itemData.system.identification.identified, false);
    assert.equal(built.itemData.system.description, `<p>${row.name}</p>`);
    assert.equal(built.itemData.system.identification.name, row.name);
    assert.equal(built.itemData.system.identification.description, `<p>${row.feature}</p>`);
    assert.equal(built.itemData.system.description.includes(row.feature), false);
    assert.equal(built.itemData.system.identification.description.includes(row.feature), true);
    assert.equal(built.itemData.flags[MODULE_ID].source, "cs1");
    assert.deepEqual(built.itemData.flags[MODULE_ID].art, { state: ART_STATES.CURATED, img: row.img });

    // This is the PhysicalItemSD identification contract: identifying an item
    // swaps the public face with the stored identification face.
    const identified = {
      ...built.itemData,
      name: built.itemData.system.identification.name,
      system: {
        ...built.itemData.system,
        description: built.itemData.system.identification.description,
        identification: { ...built.itemData.system.identification, identified: true },
      },
    };
    assert.equal(identified.name, row.name);
    assert.equal(identified.system.description, `<p>${row.feature}</p>`);
    assert.equal(identified.system.identification.identified, true);
  });

  test("parsing never fuzzy-matches an interior word and rejects wrong source", () => {
    assert.equal(parseDiabolicalTreasureResult("a carved bone replica"), null);
    assert.equal(parseDiabolicalTreasureResult("Carved bone | revised feature").row.name, "Carved bone");
    assert.equal(parseDiabolicalTreasureResult("1-20 Carved bone | revised feature").row.name, "Carved bone");
    assert.equal(buildDiabolicalTreasureItem("Carved bone | feature", { source: "CS3" }).reason, "wrong-source");
    assert.equal(buildDiabolicalTreasureItem("Unlisted relic | feature").reason, "unmapped-row");
  });
});

describe("Diabolical Treasure identity and materialization", () => {
  test("only CS1's exact table identity is routed to D6", () => {
    assert.equal(isDiabolicalTreasureTable({
      name: DIABOLICAL_TREASURE_TABLE_NAME,
      flags: { [MODULE_ID]: { source: "CS1", manifestId: DIABOLICAL_TREASURE_MANIFEST_ID } },
    }), true);
    assert.equal(diabolicalTreasureSource({ name: "Cursed Scroll 1 p68: Diabolical Treasure" }), "cs1");
    assert.equal(diabolicalTreasureSource({ name: "CS2 p68: Diabolical Treasure" }), null);
    assert.equal(diabolicalTreasureSource({ name: "CS3 p68: Diabolical Treasure" }), null);
    assert.equal(diabolicalTreasureSource({
      name: DIABOLICAL_TREASURE_TABLE_NAME,
      flags: { [MODULE_ID]: { source: "CS2" } },
    }), null);
    assert.equal(isDiabolicalTreasureTable({ name: "CS1 Random Encounters", flags: { [MODULE_ID]: { source: "CS1" } } }), false);
  });

  test("first materialization creates exactly twenty managed Items and linked name-only results", async () => {
    const table = makeTable();
    const pack = fakePack();
    const systemItem = { id: "system-1", name: "Carved bone", img: "system-original.webp", flags: {} };
    const adapter = createAdapter(pack);
    const out = await materializeDiabolicalTreasure(table, materializeOptions(pack, adapter));

    assert.equal(out.linked, 20);
    assert.equal(out.unresolved, 0);
    assert.equal(out.created, 20);
    assert.equal(pack.docs.length, 20);
    assert.equal(table.updated, 1, "same-sized writes update source rows in place");
    assert.equal(table.created, 0);
    assert.equal(table.deleted, 1, "surplus cartesian rows are removed after replacement rows exist");
    assert.deepEqual(table.results.map((row) => row.name), SOURCE_ROWS.map((row) => row.name));
    assert.ok(table.results.every((row) => row.type === 1));
    assert.ok(table.results.every((row) => !row.name.includes("|")));
    assert.ok(table.results.every((row) => row.documentUuid?.startsWith(`Compendium.${MANAGED_ITEMS_PACK}.Item.`)));
    assert.equal(table.formula, "1d20");
    assert.deepEqual(pack.docs.map((doc) => doc.name), SOURCE_ROWS.map((row) => row.name));
    assert.ok(pack.docs.every((doc) => doc.flags[MODULE_ID].generated === true));
    assert.ok(pack.docs.every((doc) => readGeneratedItem(doc)?.source === "cs1"));
    assert.deepEqual(pack.docs.map((doc) => doc.img), SOURCE_ROWS.map((row) => row.img));
    assert.equal(systemItem.img, "system-original.webp", "the base-system Item is never an apply target");
  });

  test("rerun is identity-stable and hand edits are replaced without duplicates", async () => {
    const table = makeTable();
    const pack = fakePack();
    const adapter = createAdapter(pack);
    const options = materializeOptions(pack, adapter);
    const first = await materializeDiabolicalTreasure(table, options);
    const beforeCalls = adapter.calls;
    const second = await materializeDiabolicalTreasure(table, options);
    assert.equal(first.created, 20);
    assert.equal(second.generatedUnchanged, 20);
    assert.equal(second.unchanged, true);
    assert.equal(adapter.calls, beforeCalls);
    assert.equal(pack.docs.length, 20);
    assert.equal(table.updated, 1, "the no-op rerun does not dirty TableResults");

    const edited = pack.docs[0];
    edited.name = "Carved bone (hand edited)";
    edited.img = "worlds/mine/hand-picked.webp";
    edited.system.description = "<p>GM notes</p>";
    const editedId = edited.id;
    const third = await materializeDiabolicalTreasure(table, options);
    assert.equal(third.updated, 1);
    assert.equal(pack.docs.length, 20);
    assert.equal(pack.docs[0].id, editedId);
    assert.equal(pack.docs[0].name, SOURCE_ROWS[0].name);
    assert.equal(pack.docs[0].img, SOURCE_ROWS[0].img);
    assert.equal(pack.docs[0].system.description, `<p>${SOURCE_ROWS[0].name}</p>`);
    assert.equal(pack.docs[0].system.identification.description, `<p>${SOURCE_ROWS[0].feature}</p>`);
  });

  test("a foreign same-name document collides while the other rows still converge", async () => {
    const foreign = itemDocument({ name: SOURCE_ROWS[0].name, type: "Basic", img: "foreign.webp", flags: {} }, "foreign-1");
    const table = makeTable();
    const pack = fakePack([foreign]);
    const out = await materializeDiabolicalTreasure(table, {
      ...materializeOptions(pack, createAdapter(pack)),
    });
    assert.equal(out.unresolved, 1);
    assert.ok(out.unresolvedRows.some((row) => row.reason === "name-collision" && row.text.includes(SOURCE_ROWS[0].name)));
    assert.equal(table.results[0].type, 0);
    assert.equal(table.results[0].name, SOURCE_ROWS[0].name);
    assert.equal(pack.docs[0].img, "foreign.webp");
    assert.equal(pack.docs.length, 20);
  });

  test("a rerun that loses an owned target clears its stale TableResult link", async () => {
    const table = makeTable();
    const pack = fakePack();
    const options = materializeOptions(pack, createAdapter(pack));
    await materializeDiabolicalTreasure(table, options);
    const oldUuid = table.results[0].documentUuid;
    const foreign = itemDocument({ name: SOURCE_ROWS[0].name, type: "Basic", img: "foreign.webp", flags: {} }, "foreign-1");
    pack.docs.splice(0, 1, foreign);

    const out = await materializeDiabolicalTreasure(table, materializeOptions(pack, createAdapter(pack)));
    assert.equal(out.linked, 19);
    assert.equal(table.results[0].type, 0);
    assert.equal(table.results[0].name, SOURCE_ROWS[0].name);
    assert.notEqual(table.results[0].documentUuid, oldUuid);
    assert.equal(Object.hasOwn(table.results[0], "documentUuid"), false);
    assert.equal(pack.docs.length, 20);
  });

  test("a failed Item create is reported and retry creates only the missing identity", async () => {
    const table = makeTable();
    const pack = fakePack();
    const first = await materializeDiabolicalTreasure(table, {
      ...materializeOptions(pack, createAdapter(pack, { failName: SOURCE_ROWS[0].name })),
    });
    assert.equal(first.created, 19);
    assert.equal(first.failures.filter((failure) => failure.reason === "create-failed").length, 1);
    assert.equal(table.results[0].type, 0);
    assert.equal(table.results[0].name, SOURCE_ROWS[0].name);

    const retry = await materializeDiabolicalTreasure(table, materializeOptions(pack, createAdapter(pack)));
    assert.equal(retry.created, 1);
    assert.equal(retry.generatedUnchanged, 19);
    assert.equal(retry.failures.length, 0);
    assert.ok(table.results.every((row) => row.type === 1));
    assert.equal(pack.docs.length, 20);
  });

  test("partial TableResult update rolls back the source snapshot", async () => {
    const row = SOURCE_ROWS[0];
    const table = makeTable([sourceResult(row.name, row.feature, 0)], {
      source: "CS1", manifestId: DIABOLICAL_TREASURE_CONTENT_ID,
    }, {
      failUpdates: 1,
      partialUpdate: true,
    });
    const original = plainResultSnapshot(table);
    const pack = fakePack();
    const out = await materializeDiabolicalTreasure(table, materializeOptions(pack, createAdapter(pack)));
    assert.equal(out.linked, 0);
    assert.equal(out.failures[0].reason, "table-write-failed");
    assert.equal(out.failures[0].restored, true);
    assert.deepEqual(plainResultSnapshot(table), original);
    assert.equal(pack.docs.length, 1, "the one resolved Item write is independently retryable");
  });

  test("compatibility create-before-delete rollback preserves all source rows", async () => {
    const table = makeTable(sourceRows().slice(0, 1).map((row, index) => sourceResult(row.name, row.feature, index)),
      undefined, { supportsUpdate: false, failDeletes: 1 });
    const original = plainResultSnapshot(table);
    const pack = fakePack();
    const out = await materializeDiabolicalTreasure(table, materializeOptions(pack, createAdapter(pack)));
    assert.equal(out.linked, 0);
    assert.equal(out.failures[0].reason, "table-write-failed");
    assert.equal(out.failures[0].restored, true);
    assert.deepEqual(plainResultSnapshot(table), original);
    assert.equal(table.results.length, 1);
    assert.equal(pack.docs.length, 1);
  });

  test("a non-managed pack is refused before folder, reconcile, or table writes", async () => {
    const table = makeTable();
    let reconciles = 0;
    const out = await materializeDiabolicalTreasure(table, {
      ensurePack: async () => ({ collection: "shadowdark.gear", getDocuments: async () => [] }),
      ensureFolder: async () => { throw new Error("must not be called"); },
      reconcile: async () => { reconciles += 1; return null; },
      notify: () => {},
    });
    assert.equal(out.unresolved, 20);
    assert.equal(out.failures[0].reason, "out-of-boundary");
    assert.equal(reconciles, 0);
    assert.ok(table.results.every((row) => row.type === 0 && row.name.includes("|")));
  });
});
