/** "Relink loot table" (loot-catalog.mjs linkTableItems): rows change where they stand, and only the ones that change. */
import test from "node:test";
import assert from "node:assert/strict";

globalThis.CONST = { TABLE_RESULT_TYPES: { TEXT: "text", DOCUMENT: "document" } };
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k) => k },
  packs: Object.assign([], { get: () => null, find: () => null, filter: () => [] }),
  settings: { get: () => null },
};
globalThis.ui = { notifications: { info() {}, warn() {} } };

const { LootCatalog } = await import("../scripts/loot/loot-catalog.mjs");
const { LootLinker } = await import("../scripts/loot/loot-linker.mjs");
LootLinker.buildItemIndex = async () => [];
LootLinker.findLink = (text) => (text === "Rope" ? { uuid: "Compendium.x.Item.rope" } : null);

function table(rows) {
  const calls = [];
  return {
    calls, name: "Spoils", flags: {},
    results: rows.map((r, i) => ({ id: `r${i}`, ...r, toObject: () => ({ ...r }) })),
    updateEmbeddedDocuments: async (type, updates) => { calls.push(["update", updates]); },
    deleteEmbeddedDocuments: async () => { calls.push(["delete"]); },
    createEmbeddedDocuments: async () => { calls.push(["create"]); },
  };
}

test("a newly resolvable row is linked in place; the rest are not rewritten", async () => {
  const t = table([
    { type: "document", documentUuid: "Compendium.x.Item.sword", range: [1, 1] },
    { type: "text", name: "30 gp", range: [2, 2] },
    { type: "text", name: "Rope", img: "rope.webp", description: "<p>GM note</p>", drawn: true, range: [3, 3] },
    { type: "text", name: "A strange idol", range: [4, 4] },
  ]);
  const summary = await LootCatalog.linkTableItems(t);
  assert.deepEqual(t.calls, [["update", [{ _id: "r2", type: "document", documentUuid: "Compendium.x.Item.rope" }]]],
    "one row changes, by id; nothing is deleted or recreated");
  assert.deepEqual([summary.linked, summary.coins, summary.unresolved], [2, 1, 1]);
});

test("a table with nothing to link is not written at all", async () => {
  const t = table([{ type: "text", name: "A strange idol", range: [1, 1] }]);
  assert.equal((await LootCatalog.linkTableItems(t)).unchanged, true);
  assert.deepEqual(t.calls, []);
});
