/**
 * D5/#58 — exact CS2 Dead Bandit loot rows, curated art, and generated
 * materialization.  These fixtures cover the pure source seam and the
 * Foundry-shaped table/pack adapters without mutating a world.
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
  DEAD_BANDIT_LOOT_ICONS,
  DEAD_BANDIT_LOOT_ROWS,
} from "../scripts/shared/curated-icon-maps/dead-bandit-loot-icons.mjs";
import "../scripts/shared/curated-icon-maps/index.mjs";
import {
  DEAD_BANDIT_LOOT_CONTENT_ID,
  DEAD_BANDIT_LOOT_MANIFEST_ID,
  DEAD_BANDIT_LOOT_SOURCE,
  DEAD_BANDIT_LOOT_SOURCE_ROWS,
  DEAD_BANDIT_LOOT_TABLE_NAME,
  buildDeadBanditLootDefinitions,
  buildDeadBanditLootItem,
  deadBanditLootItemName,
  deadBanditLootSource,
  isDeadBanditLootTable,
  materializeDeadBanditLoot,
} from "../scripts/loot/dead-bandit-loot.mjs";

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

const EXPECTED_SOURCE_TEXTS = [
  "Cursed eye token; DISADV on next check or attack roll",
  "Burlap bag tied shut with an angry cobra inside",
  "Torn half of a treasure map; other half next time rolling this",
  "Sealed clay jar with, 1d4: 1-2. 20 gp, 3-4. scarab beetle swarm",
  "Brass wine cup with secret reservoir that dispenses poison",
  "Three trick dice weighted to roll, 1d4: 1-2. high, 3-4. low",
  "Invitation to a private pit fight at a powerful noble's palace",
  "A jade comb that, by law, forgives its bearer of one crime",
  "Corked glass vial with a tiny, living scorpion inside it",
  "Unopened bottle of exceptionally potent Murgazi wine",
  "Scarab beetle token; ADV on next check or attack roll",
  "Gold signet ring belonging to a noble family in Alkesh",
  "Bag of 1d4 sweet dates that each heal 1 HP when eaten",
  "Worm oil; pour in sand to attract a purple worm in 1d4 rds",
  "Vial of poison, 1d4: 1-2. common, 3. uncommon, 4. rare",
  "Tube with 1d4 phoenix plumes, work as waterproof matches",
  "Ownership papers for a prized war horse stabled in Alkesh",
  "Shard of blue glass that sometimes reflects brief portents",
  "Bag of magic sesame seeds; sprinkle on a door to unlock it",
  "Tarnished, bronze oil lamp carved with a faded inscription",
];

const EXPECTED_FEATURES = [
  "DISADV on next check or attack roll",
  "tied shut with an angry cobra inside",
  "other half next time rolling this",
  "with, 1d4: 1-2. 20 gp, 3-4. scarab beetle swarm",
  "with secret reservoir that dispenses poison",
  "weighted to roll, 1d4: 1-2. high, 3-4. low",
  "at a powerful noble's palace",
  "that, by law, forgives its bearer of one crime",
  "with a tiny, living scorpion inside it",
  "",
  "ADV on next check or attack roll",
  "belonging to a noble family in Alkesh",
  "of 1d4 sweet dates that each heal 1 HP when eaten",
  "pour in sand to attract a purple worm in 1d4 rds",
  "1d4: 1-2. common, 3. uncommon, 4. rare",
  "1d4 phoenix plumes, work as waterproof matches",
  "stabled in Alkesh",
  "that sometimes reflects brief portents",
  "sprinkle on a door to unlock it",
  "carved with a faded inscription",
];

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
  texts = EXPECTED_SOURCE_TEXTS,
  flags = { source: "CS2", manifestId: DEAD_BANDIT_LOOT_MANIFEST_ID },
  { name = DEAD_BANDIT_LOOT_TABLE_NAME, supportsUpdate = true, failCreates = 0, failUpdates = false } = {},
) {
  const table = {
    name,
    flags: { [MODULE_ID]: { ...flags } },
    results: texts.map(rowObject),
    deleted: 0,
    created: 0,
    updated: 0,
    createAttempts: 0,
    failCreates,
    failUpdates,
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
        id: row._id ?? `row-${nextId + index}`,
        toObject() { return { ...this }; },
      })));
    },
  };
  if (supportsUpdate) {
    table.updateEmbeddedDocuments = async (_name, updates) => {
      table.updated += 1;
      if (table.failUpdates) {
        if (typeof table.failUpdates === "number") table.failUpdates -= 1;
        throw new Error("forced TableResult update failure");
      }
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
  return {
    id,
    uuid: `Compendium.${MANAGED_ITEMS_PACK}.Item.${id}`,
    ...payload,
    toObject() { return { ...this, _id: this.id }; },
  };
}

function fakePack(initial = [], collection = MANAGED_ITEMS_PACK) {
  const docs = [...initial];
  return {
    collection,
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

test("Dead Bandit source data pins exactly the twenty N3 §5.3 rows", () => {
  assert.equal(DEAD_BANDIT_LOOT_SOURCE_ROWS.length, 20);
  assert.deepEqual(DEAD_BANDIT_LOOT_SOURCE_ROWS.map((row) => row.sourceText), EXPECTED_SOURCE_TEXTS);
  assert.deepEqual(DEAD_BANDIT_LOOT_SOURCE_ROWS.map((row) => row.feature), EXPECTED_FEATURES);
  assert.deepEqual(DEAD_BANDIT_LOOT_SOURCE_ROWS.map((row) => row.name), DEAD_BANDIT_LOOT_ROWS.map((row) => row.name));
});

test("Dead Bandit map is exactly twenty sourced rows with the reviewed paths", () => {
  assert.equal(DEAD_BANDIT_LOOT_ICONS.label, "dead-bandit-loot");
  assert.equal(DEAD_BANDIT_LOOT_ICONS.space, CURATED_KEY_SPACES.SOURCED);
  assert.deepEqual([...DEAD_BANDIT_LOOT_ICONS.problems], []);
  assert.equal(DEAD_BANDIT_LOOT_ICONS.entries.size, 20);
  assert.deepEqual(
    [...DEAD_BANDIT_LOOT_ICONS.entries.keys()].sort(),
    DEAD_BANDIT_LOOT_ROWS.map((row) => `cs2:${curatedNameKey(row.name)}`).sort(),
  );
  assert.deepEqual(
    DEAD_BANDIT_LOOT_ROWS.map((row) => DEAD_BANDIT_LOOT_ICONS.entries.get(`cs2:${curatedNameKey(row.name)}`)),
    DEAD_BANDIT_LOOT_ROWS.map((row) => row.img),
  );
});

test("A4 discovery registers Dead Bandit art in the CS2 sourced space", () => {
  const registry = curatedIconRegistry();
  assert.ok(registry.maps.includes(DEAD_BANDIT_LOOT_ICONS));
  assert.equal(registry.sourced.size, 60);
  assert.equal(registry.bare.size, 94);
  assert.equal(resolveCuratedIcon({ name: "Unopened bottle of exceptionally potent Murgazi wine", source: "CS2" }), DEAD_BANDIT_LOOT_ROWS[9].img);
  assert.equal(resolveCuratedIcon({ name: "Unopened bottle of exceptionally potent Murgazi wine", source: "CS3" }), null);
  assert.equal(resolveCuratedIcon({ name: "Unopened bottle of exceptionally potent Murgazi wine" }), null);
});

test("the Dead Bandit map passes the real Foundry icon path gate", { skip: INVENTORY_SKIP_REASON }, () => {
  assert.ok(FOUNDRY_ICONS.size > 1_000, "the path predicate must use the real Foundry inventory");
  const report = auditCuratedIconRegistry(buildCuratedIconRegistry([DEAD_BANDIT_LOOT_ICONS]), {
    pathExists: (iconPath) => FOUNDRY_ICONS.has(iconPath),
  });
  assert.equal(report.total, 20);
  assert.equal(report.sourced, 20);
  assert.deepEqual(report.problems, []);
});

test("all composed curated maps remain collision-free after D5", () => {
  const report = auditCuratedIconRegistry(curatedIconRegistry());
  assert.equal(report.total, 154);
  assert.equal(report.bare, 94);
  assert.equal(report.sourced, 60);
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.crossSpaceNames, []);
});

test("table identity accepts CS2 aliases and rejects neighboring books", () => {
  assert.equal(isDeadBanditLootTable({ name: DEAD_BANDIT_LOOT_TABLE_NAME, flags: { [MODULE_ID]: { source: "CS2" } } }), true);
  assert.equal(deadBanditLootSource({ name: "Cursed Scroll 2 p68: In A Dead Bandit's Hand, You Find..." }), DEAD_BANDIT_LOOT_SOURCE);
  assert.equal(deadBanditLootSource({ name: DEAD_BANDIT_LOOT_TABLE_NAME, flags: { [MODULE_ID]: { manifestId: DEAD_BANDIT_LOOT_CONTENT_ID } } }), DEAD_BANDIT_LOOT_SOURCE);
  assert.equal(isDeadBanditLootTable({ name: "Cursed Scroll 1 p68: In A Dead Bandit's Hand, You Find..." }), false);
  assert.equal(isDeadBanditLootTable({ name: "Cursed Scroll 3 p68: In A Dead Bandit's Hand, You Find..." }), false);
  assert.equal(isDeadBanditLootTable({ name: DEAD_BANDIT_LOOT_TABLE_NAME, flags: { [MODULE_ID]: { source: "CS3" } } }), false);
  assert.equal(isDeadBanditLootTable({ name: "CS2 Random Encounters", flags: { [MODULE_ID]: { source: "CS2" } } }), false);
});

test("source-exact definitions expose canonical names, visible features, and terminal-only prices", () => {
  const priced = `${EXPECTED_SOURCE_TEXTS[9]} (25 gp)`;
  assert.equal(deadBanditLootItemName(priced), EXPECTED_SOURCE_TEXTS[9]);
  assert.equal(deadBanditLootItemName(`${EXPECTED_SOURCE_TEXTS[0]} (10 sp)`), EXPECTED_SOURCE_TEXTS[0]);
  assert.equal(deadBanditLootItemName(`${EXPECTED_SOURCE_TEXTS[0]} (relic)`), EXPECTED_SOURCE_TEXTS[0] + " (relic)");

  const one = buildDeadBanditLootItem(priced);
  assert.equal(one.status, "resolved");
  assert.equal(one.name, DEAD_BANDIT_LOOT_ROWS[9].name);
  assert.equal(one.itemData.name, DEAD_BANDIT_LOOT_ROWS[9].name);
  assert.equal(one.itemData.system.cost.gp, 25);
  assert.equal(one.itemData.system.description, "<p></p>");
  assert.equal(one.itemData.img, DEAD_BANDIT_LOOT_ROWS[9].img);
  assert.deepEqual(one.itemData.flags[MODULE_ID].art, { state: ART_STATES.CURATED, img: DEAD_BANDIT_LOOT_ROWS[9].img });
  assert.equal(one.itemData.flags[MODULE_ID].source, "cs2");

  const definitions = buildDeadBanditLootDefinitions(EXPECTED_SOURCE_TEXTS.map((name) => ({ name })));
  assert.equal(definitions.desired.length, 20);
  assert.equal(definitions.resolved.length, 20);
  assert.equal(definitions.unresolved.length, 0);
  assert.deepEqual(definitions.desired.map((item) => item.name), DEAD_BANDIT_LOOT_ROWS.map((row) => row.name));
  assert.equal(definitions.desired[0].system.description, `<p>${EXPECTED_FEATURES[0]}</p>`);
  assert.equal(definitions.desired[3].system.cost.gp, 0, "interior 20 gp is feature prose, not a terminal price");
});

test("negative rows never use generic Bottle/Flask containment or neighboring source art", () => {
  const murgaziNearMiss = buildDeadBanditLootItem("Murgazi wine in a bottle (25 gp)");
  const oilNearMiss = buildDeadBanditLootItem("A flask of exceptionally fine oil (2 gp)");
  assert.equal(murgaziNearMiss.status, "unresolved");
  assert.equal(murgaziNearMiss.reason, "unmapped-row");
  assert.equal(oilNearMiss.status, "unresolved");
  assert.equal(oilNearMiss.reason, "unmapped-row");
  assert.equal(buildDeadBanditLootItem(EXPECTED_SOURCE_TEXTS[0], { source: "CS3" }).reason, "wrong-source");
  assert.equal(buildDeadBanditLootItem("100 gp").status, "coin");
  assert.equal(buildDeadBanditLootItem("Murgazi wine in a bottle (25 gp)").itemData, undefined);
});

describe("Dead Bandit generated materialization", () => {
  test("all twenty rows become managed generated documents while raw display stays exact", async () => {
    const table = makeTable();
    const pack = fakePack();
    const adapter = createAdapter(pack);
    const out = await materializeDeadBanditLoot(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs2-treasure",
      adapter,
    });

    assert.equal(out.linked, 20);
    assert.equal(out.unresolved, 0);
    assert.equal(out.created, 20);
    assert.equal(pack.docs.length, 20);
    assert.equal(table.updated, 1, "same-sized writes update TableResults in place");
    assert.equal(table.created, 0);
    assert.equal(table.deleted, 0);
    assert.deepEqual(table.results.map((row) => row.name), EXPECTED_SOURCE_TEXTS);
    assert.deepEqual(table.results.map((row) => row.id), EXPECTED_SOURCE_TEXTS.map((_row, index) => `row-${index + 1}`));
    assert.ok(table.results.every((row) => row.type === 1 && row.documentUuid?.startsWith(`Compendium.${MANAGED_ITEMS_PACK}.Item.`)));
    assert.deepEqual(pack.docs.map((doc) => doc.name), DEAD_BANDIT_LOOT_ROWS.map((row) => row.name));
    assert.ok(pack.docs.every((doc) => doc.flags[MODULE_ID].generated === true));
    assert.ok(pack.docs.every((doc) => doc.flags[MODULE_ID].generatedItem.source === "cs2"));
    assert.deepEqual(pack.docs.map((doc) => doc.img), DEAD_BANDIT_LOOT_ROWS.map((row) => row.img));
    assert.deepEqual(pack.docs.map((doc) => doc.system.description), EXPECTED_FEATURES.map((feature) => `<p>${feature}</p>`));
  });

  test("an optional terminal price is preserved on the raw result and only prices the generated Item", async () => {
    const pricedText = `${EXPECTED_SOURCE_TEXTS[9]} (25 gp).`;
    const table = makeTable([pricedText]);
    const pack = fakePack();
    const out = await materializeDeadBanditLoot(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs2-treasure",
      adapter: createAdapter(pack),
    });
    assert.equal(out.linked, 1);
    assert.equal(out.unresolved, 0);
    assert.equal(table.results[0].name, pricedText);
    assert.equal(table.results[0].type, 1);
    assert.equal(pack.docs[0].name, DEAD_BANDIT_LOOT_ROWS[9].name);
    assert.equal(pack.docs[0].system.cost.gp, 25);
    assert.equal(pack.docs[0].system.description, "<p></p>");
  });

  test("rerun identity is stable and creates no duplicates", async () => {
    const table = makeTable();
    const pack = fakePack();
    const adapter = createAdapter(pack);
    const options = {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs2-treasure",
      adapter,
    };
    const first = await materializeDeadBanditLoot(table, options);
    const before = adapter.calls;
    const second = await materializeDeadBanditLoot(table, options);
    assert.equal(first.created, 20);
    assert.equal(second.generatedUnchanged, 20);
    assert.equal(second.unchanged, true);
    assert.equal(adapter.calls, before);
    assert.equal(pack.docs.length, 20);
    assert.equal(table.updated, 1);
    assert.equal(table.created, 0);
    assert.equal(table.deleted, 0);
  });

  test("a foreign same-name document is an explicit name collision and stays raw", async () => {
    const foreign = itemDocument({ name: DEAD_BANDIT_LOOT_ROWS[9].name, type: "Basic", img: "foreign.webp", flags: {} }, "foreign-1");
    const table = makeTable();
    const pack = fakePack([foreign]);
    const adapter = createAdapter(pack);
    const out = await materializeDeadBanditLoot(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs2-treasure",
      adapter,
    });
    assert.equal(out.unresolved, 1);
    assert.ok(out.unresolvedRows.some((row) => row.reason === "name-collision" && row.text === EXPECTED_SOURCE_TEXTS[9]));
    assert.equal(table.results[9].type, 0);
    assert.equal(table.results[9].name, EXPECTED_SOURCE_TEXTS[9]);
    assert.equal(pack.docs[0].img, "foreign.webp");
    assert.equal(pack.docs.length, 20, "the other nineteen rows may still be generated");
  });

  test("a failed generated create is explicit and retry creates only the missing row", async () => {
    const table = makeTable();
    const pack = fakePack();
    const firstAdapter = createAdapter(pack, { failName: DEAD_BANDIT_LOOT_ROWS[0].name });
    const first = await materializeDeadBanditLoot(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs2-treasure",
      adapter: firstAdapter,
    });
    assert.equal(first.created, 19);
    assert.equal(first.failures.filter((failure) => failure.reason === "create-failed").length, 1);
    assert.equal(table.results[0].type, 0);
    assert.equal(table.results[0].name, EXPECTED_SOURCE_TEXTS[0]);

    const retryAdapter = createAdapter(pack);
    const retry = await materializeDeadBanditLoot(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs2-treasure",
      adapter: retryAdapter,
    });
    assert.equal(retry.created, 1);
    assert.equal(retry.generatedUnchanged, 19);
    assert.equal(retry.failures.length, 0);
    assert.ok(table.results.every((row) => row.type === 1));
    assert.equal(pack.docs.length, 20);
  });

  test("a compatibility TableResult create failure restores exact source rows", async () => {
    const table = makeTable([EXPECTED_SOURCE_TEXTS[0]], undefined, { supportsUpdate: false, failCreates: 1 });
    const original = plainResultSnapshot(table);
    const pack = fakePack();
    const adapter = createAdapter(pack);
    const first = await materializeDeadBanditLoot(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs2-treasure",
      adapter,
    });
    assert.equal(first.linked, 0);
    assert.equal(first.failures[0].reason, "table-write-failed");
    assert.equal(first.failures[0].restored, true);
    assert.deepEqual(plainResultSnapshot(table), original);
    assert.equal(table.deleted, 0, "source rows were not deleted before create succeeded");
    assert.equal(pack.docs.length, 1, "generated Item remains available for retry");

    table.failCreates = 0;
    const retry = await materializeDeadBanditLoot(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs2-treasure",
      adapter,
    });
    assert.equal(retry.linked, 1);
    assert.equal(retry.failures.length, 0);
    assert.equal(table.results[0].type, 1);
    assert.equal(table.results[0].name, EXPECTED_SOURCE_TEXTS[0]);
    assert.equal(pack.docs.length, 1);
  });

  test("a managed TableResult update failure restores source rows for retry", async () => {
    const table = makeTable([EXPECTED_SOURCE_TEXTS[0]], undefined, { failUpdates: 1 });
    const original = plainResultSnapshot(table);
    const pack = fakePack();
    const adapter = createAdapter(pack);
    const out = await materializeDeadBanditLoot(table, {
      ensurePack: async () => pack,
      ensureFolder: async () => "folder-cs2-treasure",
      adapter,
    });
    assert.equal(out.failures[0].reason, "table-write-failed");
    assert.equal(out.failures[0].restored, true);
    assert.deepEqual(plainResultSnapshot(table), original);
  });

  test("a non-managed pack is refused before any create or table write", async () => {
    const table = makeTable();
    let creates = 0;
    const out = await materializeDeadBanditLoot(table, {
      ensurePack: async () => ({ collection: "shadowdark.gear", getDocuments: async () => [] }),
      ensureFolder: async () => { throw new Error("must not be called"); },
      reconcile: async () => { creates += 1; return null; },
    });
    assert.equal(out.unresolved, 20);
    assert.equal(out.failures[0].reason, "out-of-boundary");
    assert.equal(creates, 0);
    assert.equal(table.created, 0);
    assert.ok(table.results.every((row) => row.type === 0 && row.name === EXPECTED_SOURCE_TEXTS[row.range[0] - 1]));
  });
});

test("generated identity remains source-qualified for every canonical row", () => {
  const ids = DEAD_BANDIT_LOOT_ROWS.map((row) => generatedItemId("CS2", row.name));
  assert.equal(new Set(ids).size, 20);
  assert.ok(ids.every((id) => /^fnv1a32:[0-9a-f]{8}$/.test(id)));
});
