/**
 * D5/#58 — fingerprint-recognised CS2 Dead Bandit loot rows, curated art, and
 * generated materialization.  These fixtures cover the pure source seam and the
 * Foundry-shaped table/pack adapters without mutating a world.
 *
 * No book text lives in this repo: the rows below are INVENTED.  Their shapes
 * (which words of a row are the Item name, where the feature starts) and their
 * art are installed through the module's test seam and the curated registry,
 * then run through the same recogniser the shipped fingerprints use.  The
 * shipped tables are checked for shape only.
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
  registerCuratedIconMap,
  resolveCuratedIcon,
} from "../scripts/shared/curated-icons.mjs";
import { textFingerprint } from "../scripts/shared/text-fingerprint.mjs";
import { generatedItemId } from "../scripts/shared/generated-items.mjs";
import {
  DEAD_BANDIT_LOOT_ICONS,
  DEAD_BANDIT_LOOT_ROWS as SHIPPED_ICON_ROWS,
} from "../scripts/shared/curated-icon-maps/dead-bandit-loot-icons.mjs";
import "../scripts/shared/curated-icon-maps/index.mjs";
import {
  DEAD_BANDIT_LOOT_CONTENT_ID,
  DEAD_BANDIT_LOOT_MANIFEST_ID,
  DEAD_BANDIT_LOOT_SOURCE,
  DEAD_BANDIT_LOOT_SOURCE_ROWS as SHIPPED_SHAPES,
  DEAD_BANDIT_LOOT_TABLE_NAME,
  _setDeadBanditLootRows,
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

// Twenty made-up rows: [source text, Item name, feature, name word indices,
// feature start].  They cover a contiguous name, a name with a skipped word,
// a leading article dropped and the name capitalised, a trailing `;` or `,`
// stripped, an interior comma kept, a row that is all name, and an interior
// "10 gp" that is feature prose and not a terminal price.
const INVENTED = Object.freeze([
  ["Glass bead; glows near running water", "Glass bead", "glows near running water", [0, 1], 2],
  ["Linen sack tied shut with a sleeping badger inside", "Linen sack", "tied shut with a sleeping badger inside", [0, 1], 2],
  ["Torn corner of a seaside chart; rest of it turns up later", "Torn corner of a seaside chart", "rest of it turns up later", [0, 1, 2, 3, 4, 5], 6],
  ["Wicker basket with, 1d6: 1-3. 10 gp, 4-6. a nest of wasps", "Wicker basket", "with, 1d6: 1-3. 10 gp, 4-6. a nest of wasps", [0, 1], 2],
  ["Pewter flask with a hidden compartment for notes", "Pewter flask", "with a hidden compartment for notes", [0, 1], 2],
  ["Four loaded coins weighted to land, 1d6: 1-3. heads, 4-6. tails", "Four loaded coins", "weighted to land, 1d6: 1-3. heads, 4-6. tails", [0, 1, 2], 3],
  ["Summons to a secret tea party at a baron's cottage", "Summons to a secret tea party", "at a baron's cottage", [0, 1, 2, 3, 4, 5], 6],
  ["An amber brooch that, by custom, excuses its wearer from one chore", "Amber brooch", "that, by custom, excuses its wearer from one chore", [1, 2], 3],
  ["Stoppered ceramic bottle with a polite, living cricket inside it", "Stoppered ceramic bottle", "with a polite, living cricket inside it", [0, 1, 2], 3],
  ["Sealed barrel of unusually fragrant harbour tea", "Sealed barrel of unusually fragrant harbour tea", "", [0, 1, 2, 3, 4, 5, 6], null],
  ["Fox token; ADV on the next climb", "Fox token", "ADV on the next climb", [0, 1], 2],
  ["Silver thimble belonging to a baker in Hollowmere", "Silver thimble", "belonging to a baker in Hollowmere", [0, 1], 2],
  ["Satchel of 3d4 smooth pebbles that each skip twice", "Satchel of smooth pebbles", "of 3d4 smooth pebbles that each skip twice", [0, 1, 3, 4], 1],
  ["Lamp wax; melt in a bowl to call a lazy moth in 1d4 rds", "Lamp wax", "melt in a bowl to call a lazy moth in 1d4 rds", [0, 1], 2],
  ["Phial of ink, 1d4: 1-2. blue, 3. green, 4. gold", "Phial of ink", "1d4: 1-2. blue, 3. green, 4. gold", [0, 1, 2], 3],
  ["Tin with 2d4 pressed daisies, work as lucky bookmarks", "Tin with pressed daisies", "2d4 pressed daisies, work as lucky bookmarks", [0, 1, 3, 4], 2],
  ["Deed to a modest windmill kept in Hollowmere", "Deed to a modest windmill", "kept in Hollowmere", [0, 1, 2, 3, 4], 5],
  ["Chip of green glass that sometimes hums quietly", "Chip of green glass", "that sometimes hums quietly", [0, 1, 2, 3], 4],
  ["Pinch of salt; sprinkle on a stair to quiet it", "Pinch of salt", "sprinkle on a stair to quiet it", [0, 1, 2], 3],
  ["Weathered, copper spoon etched with a tiny map", "Weathered, copper spoon", "etched with a tiny map", [0, 1, 2], 3],
].map(([sourceText, name, feature, nameWords, featureFrom], index) => Object.freeze({
  sourceText,
  name,
  feature,
  img: `icons/invented/bandit-${index + 1}.webp`,
  shape: Object.freeze({ fp: textFingerprint(sourceText), name: nameWords, feature: featureFrom }),
})));
const EXPECTED_SOURCE_TEXTS = INVENTED.map((row) => row.sourceText);
const EXPECTED_FEATURES = INVENTED.map((row) => row.feature);
const DEAD_BANDIT_LOOT_ROWS = INVENTED.map(({ name, img }) => ({ name, img }));
_setDeadBanditLootRows(INVENTED.map((row) => row.shape));
registerCuratedIconMap(
  "invented-dead-bandit",
  { cs2: Object.fromEntries(INVENTED.map((row) => [row.shape.fp, row.img])) },
  { space: CURATED_KEY_SPACES.SOURCED },
);

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

test("the shipped Dead Bandit data is twenty fingerprints, word indices and art, and no text", () => {
  assert.equal(SHIPPED_SHAPES.length, 20);
  assert.equal(SHIPPED_ICON_ROWS.length, 20);
  for (const shape of SHIPPED_SHAPES) {
    assert.deepEqual(Object.keys(shape).sort(), ["feature", "fp", "name"]);
    assert.match(shape.fp, /^[0-9a-f]{14}$/);
    assert.ok(shape.name.length > 0 && shape.name.every(Number.isInteger));
    assert.ok(shape.feature === null || Number.isInteger(shape.feature));
  }
  assert.deepEqual(SHIPPED_SHAPES.map((shape) => shape.fp), SHIPPED_ICON_ROWS.map((row) => row.fp));
});

test("Dead Bandit map is exactly twenty sourced fingerprints with native Foundry paths", () => {
  assert.equal(DEAD_BANDIT_LOOT_ICONS.label, "dead-bandit-loot");
  assert.equal(DEAD_BANDIT_LOOT_ICONS.space, CURATED_KEY_SPACES.SOURCED);
  assert.deepEqual([...DEAD_BANDIT_LOOT_ICONS.problems], []);
  assert.equal(DEAD_BANDIT_LOOT_ICONS.entries.size, 20);
  assert.deepEqual(
    [...DEAD_BANDIT_LOOT_ICONS.entries.keys()].sort(),
    SHIPPED_ICON_ROWS.map((row) => `cs2:${row.fp}`).sort(),
  );
  assert.deepEqual(
    SHIPPED_ICON_ROWS.map((row) => DEAD_BANDIT_LOOT_ICONS.entries.get(`cs2:${row.fp}`)),
    SHIPPED_ICON_ROWS.map((row) => row.img),
  );
});

test("A4 discovery registers Dead Bandit art in the CS2 sourced space", () => {
  const registry = curatedIconRegistry();
  const key = INVENTED[9].shape.fp;
  assert.ok(registry.maps.includes(DEAD_BANDIT_LOOT_ICONS));
  assert.equal(registry.sourced.size, 60 + INVENTED.length);
  assert.equal(registry.bare.size, 94);
  assert.equal(resolveCuratedIcon({ name: key, source: "CS2" }), INVENTED[9].img);
  assert.equal(resolveCuratedIcon({ name: key, source: "CS3" }), null);
  assert.equal(resolveCuratedIcon({ name: key }), null);
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
  // 94 bare + the three shipped treasure maps' 60 + this file's invented 20.
  assert.equal(report.total, 154 + INVENTED.length);
  assert.equal(report.bare, 94);
  assert.equal(report.sourced, 60 + INVENTED.length);
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

test("every row's Item name and feature are cut out of the printed text by its shipped shape", () => {
  for (const row of INVENTED) {
    const built = buildDeadBanditLootItem(row.sourceText);
    assert.equal(built.status, "resolved", row.sourceText);
    assert.equal(built.name, row.name);
    assert.equal(built.feature, row.feature);
    assert.equal(built.img, row.img);
  }
});

test("curly quotes and stray whitespace in the printed text do not change the minted Item", () => {
  const row = INVENTED[6];
  const messy = row.sourceText.replace("'", "\u2019").replace(/ /g, "  ");
  const built = buildDeadBanditLootItem(` ${messy} `);
  assert.equal(built.status, "resolved");
  assert.equal(built.name, row.name);
  assert.equal(built.feature, row.feature);
});

test("a row whose fingerprint is unknown is refused, and art is source-qualified", () => {
  const unknown = buildDeadBanditLootItem("Glass bead; glows near running snow");
  assert.equal(unknown.status, "unresolved");
  assert.equal(unknown.reason, "unmapped-row");
  assert.equal(unknown.itemData, undefined);
  for (const book of ["CS1", "CS3"]) {
    assert.equal(buildDeadBanditLootItem(EXPECTED_SOURCE_TEXTS[0], { source: book }).reason, "wrong-source");
  }
  // The row's art is registered under CS2 only: no other book resolves it.
  assert.equal(resolveCuratedIcon({ name: INVENTED[0].shape.fp, source: "cs2" }), INVENTED[0].img);
  assert.equal(resolveCuratedIcon({ name: INVENTED[0].shape.fp, source: "cs1" }), null);
  assert.equal(resolveCuratedIcon({ name: INVENTED[0].shape.fp, source: "cs3" }), null);
});

test("negative rows never use generic Bottle/Flask containment or neighboring source art", () => {
  const teaNearMiss = buildDeadBanditLootItem("Harbour tea in a barrel (25 gp)");
  const oilNearMiss = buildDeadBanditLootItem("A flask of exceptionally fine oil (2 gp)");
  assert.equal(teaNearMiss.status, "unresolved");
  assert.equal(teaNearMiss.reason, "unmapped-row");
  assert.equal(oilNearMiss.status, "unresolved");
  assert.equal(oilNearMiss.reason, "unmapped-row");
  assert.equal(buildDeadBanditLootItem(EXPECTED_SOURCE_TEXTS[0], { source: "CS3" }).reason, "wrong-source");
  assert.equal(buildDeadBanditLootItem("100 gp").status, "coin");
  assert.equal(buildDeadBanditLootItem("Harbour tea in a barrel (25 gp)").itemData, undefined);
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

test("restoring the shipped rows forgets an invented row", () => {
  assert.equal(buildDeadBanditLootItem(EXPECTED_SOURCE_TEXTS[0]).status, "resolved");
  _setDeadBanditLootRows();
  assert.equal(buildDeadBanditLootItem(EXPECTED_SOURCE_TEXTS[0]).reason, "unmapped-row");
});
