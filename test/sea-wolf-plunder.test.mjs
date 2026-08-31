/**
 * D4/#57 — Sea Wolf Plunder's exact CS3 rows, curated art, and generated
 * materializer.  The live Foundry proof is separate; these fixtures exercise
 * the same table/result and A7 seams without mutating a world.
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
  curatedNameKey,
  resolveCuratedIcon,
} from "../scripts/shared/curated-icons.mjs";
import { generatedItemId } from "../scripts/shared/generated-items.mjs";
import {
  SEA_WOLF_PLUNDER_ICONS,
  SEA_WOLF_PLUNDER_ROWS,
} from "../scripts/shared/curated-icon-maps/sea-wolf-plunder-icons.mjs";
import "../scripts/shared/curated-icon-maps/index.mjs";
import {
  buildSeaWolfPlunderDefinitions,
  buildSeaWolfPlunderItem,
  isSeaWolfPlunderTable,
  materializeSeaWolfPlunder,
  seaWolfPlunderItemName,
  seaWolfPlunderSource,
} from "../scripts/loot/sea-wolf-plunder.mjs";

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

const SOURCE_ROWS = SEA_WOLF_PLUNDER_ROWS.map((row, index) => `${row.name} (${(index + 1) * 10} gp)`);
const EXPECTED_KEYS = SEA_WOLF_PLUNDER_ROWS.map((row) => curatedNameKey(row.name));

function rowObject(text, index) {
  return {
    id: `row-${index + 1}`,
    range: [index + 1, index + 1],
    weight: 1,
    drawn: false,
    type: 0,
    name: text,
    toObject() { return { ...this }; },
  };
}

function makeTable(
  texts = SOURCE_ROWS,
  flags = { source: "CS3", manifestId: "cs3-sea-wolf-plunder-from-distant-lands" },
  { supportsUpdate = true, failCreates = 0 } = {},
) {
  const table = {
    name: "Sea Wolf Plunder From Distant Lands",
    flags: { [MODULE_ID]: { ...flags } },
    results: texts.map(rowObject),
    deleted: 0,
    created: 0,
    updated: 0,
    createAttempts: 0,
    failCreates,
    async deleteEmbeddedDocuments(_name, ids) {
      this.deleted += ids.length ? 1 : 0;
      const removed = new Set(ids);
      this.results = this.results.filter((row) => !removed.has(row.id));
    },
    async createEmbeddedDocuments(_name, rows) {
      this.createAttempts += 1;
      if (this.failCreates > 0) {
        this.failCreates -= 1;
        throw new Error("forced TableResult create failure");
      }
      this.created += 1;
      const nextId = this.results.length + 1;
      this.results.push(...rows.map((row, index) => ({
        ...row,
        id: `row-${nextId + index}`,
        toObject() { return { ...this }; },
      })));
    },
  };
  if (supportsUpdate) {
    table.updateEmbeddedDocuments = async (_name, updates) => {
      table.updated += 1;
      const byId = new Map(updates.map((update) => [update._id, update]));
      table.results = table.results.map((row) => {
        const update = byId.get(row.id);
        if (!update) return row;
        const next = { ...row, ...update, id: row.id };
        delete next._id;
        next.toObject = function toObject() { return { ...this }; };
        return next;
      });
    };
  }
  return table;
}

function plainResultSnapshot(table) {
  return table.results.map((row) => {
    const out = row.toObject();
    delete out.toObject;
    return JSON.parse(JSON.stringify(out));
  });
}

function itemDocument(payload, id) {
  const doc = {
    id,
    uuid: `Compendium.${MANAGED_ITEMS_PACK}.Item.${id}`,
    ...payload,
    toObject() { return { ...this, _id: this.id }; },
  };
  return doc;
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
  };
}

test("Sea Wolf map is exactly the twenty sourced N3 §5.1 rows", () => {
  assert.equal(SEA_WOLF_PLUNDER_ICONS.label, "sea-wolf-plunder");
  assert.equal(SEA_WOLF_PLUNDER_ICONS.space, CURATED_KEY_SPACES.SOURCED);
  assert.deepEqual([...SEA_WOLF_PLUNDER_ICONS.problems], []);
  assert.equal(SEA_WOLF_PLUNDER_ICONS.entries.size, 20);
  assert.deepEqual([...SEA_WOLF_PLUNDER_ICONS.entries.keys()].sort(), EXPECTED_KEYS.map((key) => `cs3:${key}`).sort());
  assert.deepEqual(
    SEA_WOLF_PLUNDER_ROWS.map((row) => SEA_WOLF_PLUNDER_ICONS.entries.get(`cs3:${curatedNameKey(row.name)}`)),
    SEA_WOLF_PLUNDER_ROWS.map((row) => row.img),
  );
});

test("A4 discovery registers the Sea Wolf sourced map without changing bare maps", () => {
  const registry = curatedIconRegistry();
  assert.ok(registry.maps.includes(SEA_WOLF_PLUNDER_ICONS));
  assert.equal(registry.sourced.size, 20);
  assert.equal(registry.bare.size, 94);
  assert.equal(resolveCuratedIcon({ name: SEA_WOLF_PLUNDER_ROWS[0].name, source: "Cursed Scroll #3" }), SEA_WOLF_PLUNDER_ROWS[0].img);
  assert.equal(resolveCuratedIcon({ name: SEA_WOLF_PLUNDER_ROWS[0].name, source: "CS2" }), null);
  assert.equal(resolveCuratedIcon({ name: SEA_WOLF_PLUNDER_ROWS[0].name }), null);
});

test("the Sea Wolf map passes the real Foundry icon path gate", { skip: INVENTORY_SKIP_REASON }, () => {
  assert.ok(FOUNDRY_ICONS.size > 1_000, "the path predicate must use the real Foundry inventory");
  const report = auditCuratedIconRegistry(buildCuratedIconRegistry([SEA_WOLF_PLUNDER_ICONS]), {
    pathExists: (iconPath) => FOUNDRY_ICONS.has(iconPath),
  });
  assert.equal(report.total, 20);
  assert.equal(report.bare, 0);
  assert.equal(report.sourced, 20);
  assert.deepEqual(report.perMap, [{ label: "sea-wolf-plunder", space: "sourced", entries: 20 }]);
  assert.deepEqual(report.problems, []);
});

test("terminal gp stripping is narrow and source rows keep their published names", () => {
  const raw = SOURCE_ROWS[0];
  assert.equal(seaWolfPlunderItemName(raw), SEA_WOLF_PLUNDER_ROWS[0].name);
  assert.equal(seaWolfPlunderItemName(`${SEA_WOLF_PLUNDER_ROWS[0].name} (10 sp)`), `${SEA_WOLF_PLUNDER_ROWS[0].name} (10 sp)`);
  assert.equal(seaWolfPlunderItemName(`${SEA_WOLF_PLUNDER_ROWS[0].name} (10 gp) extra`), `${SEA_WOLF_PLUNDER_ROWS[0].name} (10 gp) extra`);
  assert.equal(seaWolfPlunderItemName(`${SEA_WOLF_PLUNDER_ROWS[0].name} (relic) (10 gp)`), `${SEA_WOLF_PLUNDER_ROWS[0].name} (relic)`);
});

test("one Sea Wolf definition has A7 identity, CS3 source, cost, and curated provenance", () => {
  const built = buildSeaWolfPlunderItem(SOURCE_ROWS[0]);
  assert.equal(built.status, "resolved");
  assert.equal(built.name, SEA_WOLF_PLUNDER_ROWS[0].name);
  assert.equal(built.itemData.name, SEA_WOLF_PLUNDER_ROWS[0].name);
  assert.equal(built.itemData.system.cost.gp, 10);
  assert.equal(built.itemData.img, SEA_WOLF_PLUNDER_ROWS[0].img);
  assert.deepEqual(built.itemData.flags[MODULE_ID].art, { state: ART_STATES.CURATED, img: SEA_WOLF_PLUNDER_ROWS[0].img });
  assert.equal(built.itemData.flags[MODULE_ID].source, "cs3");

  const definitions = buildSeaWolfPlunderDefinitions(SOURCE_ROWS.map((name) => ({ name })));
  assert.equal(definitions.desired.length, 20);
  assert.equal(definitions.resolved.length, 20);
  assert.equal(definitions.unresolved.length, 0);
  assert.deepEqual(definitions.desired.map((item) => item.name), SEA_WOLF_PLUNDER_ROWS.map((row) => row.name));
});

describe("Sea Wolf table identity and generated materialization", () => {
  test("the exact table is recognized, while other CS3 tables are not", () => {
    assert.equal(isSeaWolfPlunderTable({ name: "Sea Wolf Plunder From Distant Lands", flags: { [MODULE_ID]: { source: "CS3" } } }), true);
    assert.equal(seaWolfPlunderSource({ name: "Cursed Scroll 3 p68: Sea Wolf Plunder From Distant Lands" }), "cs3");
    assert.equal(seaWolfPlunderSource({ name: "Cursed Scroll 1 p68: Sea Wolf Plunder From Distant Lands" }), null);
    assert.equal(seaWolfPlunderSource({ name: "Cursed Scroll 2 p68: Sea Wolf Plunder From Distant Lands" }), null);
    assert.equal(isSeaWolfPlunderTable({ name: "CS1 p68: Sea Wolf Plunder From Distant Lands" }), false);
    assert.equal(isSeaWolfPlunderTable({ name: "CS2 p68: Sea Wolf Plunder From Distant Lands" }), false);
    assert.equal(isSeaWolfPlunderTable({ name: "Sea Wolf Plunder From Distant Lands", flags: { [MODULE_ID]: { source: "CS2" } } }), false);
    assert.equal(isSeaWolfPlunderTable({ name: "CS3 Random Encounters", flags: { [MODULE_ID]: { source: "CS3" } } }), false);
  });

  test("all twenty rows become document results with raw price text and no system mutation", async () => {
    const table = makeTable();
    const systemItem = { name: SEA_WOLF_PLUNDER_ROWS[0].name, img: "system-original.webp" };
    const pack = fakePack();
    const adapter = createAdapter(pack);
    const out = await materializeSeaWolfPlunder(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs3-treasure",
      adapter,
    });

    assert.equal(out.linked, 20);
    assert.equal(out.unresolved, 0);
    assert.equal(out.created, 20);
    assert.equal(pack.docs.length, 20);
    assert.equal(table.updated, 1, "same-sized writes update TableResults in place");
    assert.equal(table.created, 0);
    assert.equal(table.deleted, 0);
    assert.deepEqual(table.results.map((row) => row.name), SOURCE_ROWS);
    assert.deepEqual(table.results.map((row) => row.id), SOURCE_ROWS.map((_row, index) => `row-${index + 1}`));
    assert.ok(table.results.every((row) => row.type === 1 && row.documentUuid?.startsWith(`Compendium.${MANAGED_ITEMS_PACK}.Item.`)));
    assert.deepEqual(pack.docs.map((doc) => doc.name), SEA_WOLF_PLUNDER_ROWS.map((row) => row.name));
    assert.ok(pack.docs.every((doc) => doc.flags[MODULE_ID].generated === true));
    assert.ok(pack.docs.every((doc) => doc.flags[MODULE_ID].generatedItem.source === "cs3"));
    assert.deepEqual(pack.docs.map((doc) => doc.img), SEA_WOLF_PLUNDER_ROWS.map((row) => row.img));
    assert.equal(systemItem.img, "system-original.webp", "the base-system Item is never an apply target");
  });

  test("a second materialization is identity-stable and creates no duplicates", async () => {
    const table = makeTable();
    const pack = fakePack();
    const adapter = createAdapter(pack);
    const options = {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs3-treasure",
      adapter,
    };
    const first = await materializeSeaWolfPlunder(table, options);
    const before = adapter.calls;
    const second = await materializeSeaWolfPlunder(table, options);

    assert.equal(first.created, 20);
    assert.equal(second.generatedUnchanged, 20);
    assert.equal(second.unchanged, true);
    assert.equal(adapter.calls, before);
    assert.equal(pack.docs.length, 20);
    assert.equal(table.updated, 1);
    assert.equal(table.created, 0);
    assert.equal(table.deleted, 0);
  });

  test("an owned-name ambiguity remains TEXT and does not take over the Item", async () => {
    const foreign = itemDocument({ name: SEA_WOLF_PLUNDER_ROWS[0].name, type: "Basic", img: "foreign.webp", flags: {} }, "foreign-1");
    const table = makeTable();
    const pack = fakePack([foreign]);
    const adapter = createAdapter(pack);
    const out = await materializeSeaWolfPlunder(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs3-treasure",
      adapter,
    });

    assert.equal(out.unresolved, 1);
    assert.ok(out.unresolvedRows.some((row) => row.reason === "name-collision" && row.text === SOURCE_ROWS[0]));
    assert.equal(table.results[0].type, 0);
    assert.equal(table.results[0].name, SOURCE_ROWS[0]);
    assert.equal(pack.docs[0].img, "foreign.webp");
    assert.equal(pack.docs.length, 20, "the other nineteen rows may still be generated");
  });

  test("a failed create is explicit and a rerun creates only the missing row", async () => {
    const table = makeTable();
    const pack = fakePack();
    const firstAdapter = createAdapter(pack, { failName: SEA_WOLF_PLUNDER_ROWS[0].name });
    const first = await materializeSeaWolfPlunder(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs3-treasure",
      adapter: firstAdapter,
    });
    assert.equal(first.created, 19);
    assert.equal(first.failures.filter((failure) => failure.reason === "create-failed").length, 1);
    assert.equal(table.results[0].type, 0);
    assert.equal(table.results[0].name, SOURCE_ROWS[0]);

    const retryAdapter = createAdapter(pack);
    const retry = await materializeSeaWolfPlunder(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs3-treasure",
      adapter: retryAdapter,
    });
    assert.equal(retry.created, 1);
    assert.equal(retry.generatedUnchanged, 19);
    assert.equal(retry.failures.length, 0);
    assert.ok(table.results.every((row) => row.type === 1));
    assert.equal(pack.docs.length, 20);
  });

  test("a TableResult create failure after the old delete point restores priced source rows", async () => {
    // An adapter without updateEmbeddedDocuments exercises the compatibility
    // writer.  The create is forced to fail where the old implementation had
    // already deleted the source rows; the new writer creates first and then
    // proves the original rows survived before returning the failure.
    const table = makeTable([SOURCE_ROWS[0]], undefined, { supportsUpdate: false, failCreates: 1 });
    const original = plainResultSnapshot(table);
    const pack = fakePack();
    const adapter = createAdapter(pack);
    const first = await materializeSeaWolfPlunder(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs3-treasure",
      adapter,
    });

    assert.equal(first.linked, 0);
    assert.equal(first.failures[0].reason, "table-write-failed");
    assert.equal(first.failures[0].restored, true);
    assert.deepEqual(plainResultSnapshot(table), original);
    assert.equal(table.deleted, 0, "the source rows were never deleted before create succeeded");
    assert.equal(pack.docs.length, 1, "the generated Item remains available for a retry");

    table.failCreates = 0;
    const retry = await materializeSeaWolfPlunder(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs3-treasure",
      adapter,
    });
    assert.equal(retry.linked, 1);
    assert.equal(retry.failures.length, 0);
    assert.equal(table.results.length, 1);
    assert.equal(table.results[0].type, 1);
    assert.equal(table.results[0].name, SOURCE_ROWS[0]);
    assert.equal(pack.docs.length, 1);
  });

  test("a non-managed pack is refused before any create or table write", async () => {
    const table = makeTable();
    let creates = 0;
    const out = await materializeSeaWolfPlunder(table, {
      ensurePack: async () => ({ collection: "shadowdark.gear", getDocuments: async () => [] }),
      ensureFolder: async () => { throw new Error("must not be called"); },
      reconcile: async () => { creates += 1; return null; },
    });
    assert.equal(out.unresolved, 20);
    assert.equal(out.failures[0].reason, "out-of-boundary");
    assert.equal(creates, 0);
    assert.equal(table.created, 0);
    assert.ok(table.results.every((row) => row.type === 0 && row.name.endsWith(" gp)")));
  });
});

test("generated identity remains source-qualified for every published row", () => {
  const ids = SEA_WOLF_PLUNDER_ROWS.map((row) => generatedItemId("CS3", row.name));
  assert.equal(new Set(ids).size, 20);
  assert.ok(ids.every((id) => /^fnv1a32:[0-9a-f]{8}$/.test(id)));
});
