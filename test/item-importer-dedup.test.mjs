import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeItemName,
  partitionSystemDuplicates,
} from "../scripts/importer/items/item-importer.mjs";

function indexPack(names) {
  return {
    indexed: false,
    getIndex: async () => names.map((name) => ({ name })),
  };
}

test("Basic Gear's Flask or Bottle alias is skipped without dropping other gear", async () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    packs: new Map([
      ["shadowdark.gear", indexPack(["Flask", "Bottle", "Torch"])],
      ["shadowdark.magic-items", indexPack([])],
    ]),
  };

  try {
    assert.equal(normalizeItemName("Flask or Bottle"), normalizeItemName("Flask"));

    const { fresh, duplicates } = await partitionSystemDuplicates([
      { draft: { name: "Flask or Bottle", type: "Basic" } },
      { draft: { name: "Flask", type: "Basic" } },
      { draft: { name: "Bottle", type: "Basic" } },
      { draft: { name: "Flask of Holy Water", type: "Basic" } },
      { draft: { name: "Lantern Hook", type: "Basic" } },
    ]);

    assert.deepEqual(fresh.map(({ draft }) => draft.name), ["Flask of Holy Water", "Lantern Hook"]);
    assert.deepEqual(duplicates.map(({ name }) => name), ["Flask or Bottle", "Flask", "Bottle"]);
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
  }
});
