import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleCreateDrafts,
  parseGearTable,
} from "../scripts/importer/items/item-builder-gear.mjs";
import { buildItemData } from "../scripts/importer/items/item-importer.mjs";

const BASIC_GEAR_TABLE = [
  "Candle (3) 5 cp 1-3",
  "Miner's Putty, Jar 5 sp 1",
  "Lantern Hook 4 sp 1",
].join("\n");

test("Basic Gear carries Candle light/quantity and Miner's Putty slots", () => {
  const rows = parseGearTable(BASIC_GEAR_TABLE, "Basic");
  const drafts = assembleCreateDrafts(rows, "Basic");
  const data = Object.fromEntries(drafts.map((draft) => [draft.name, buildItemData(draft)]));

  assert.deepEqual(data["Candle (3)"].system.light, {
    active: false,
    hasBeenUsed: false,
    isSource: true,
    longevityMins: 20,
    remainingSecs: 1200,
    template: "torch",
  });
  assert.deepEqual(data["Candle (3)"].system.slots, {
    free_carry: 0,
    per_slot: 3,
    slots_used: 1,
  });
  assert.equal(data["Miner's Putty, Jar"].system.slots.slots_used, 3);

  // Unrelated Basic Gear keeps the parser's mechanics and receives no light.
  assert.deepEqual(data["Lantern Hook"].system.slots, {
    free_carry: 0,
    per_slot: 1,
    slots_used: 1,
  });
  assert.equal(data["Lantern Hook"].system.light, undefined);

  // A repeat builds the same physical data rather than accumulating changes.
  assert.deepEqual(buildItemData(drafts[0]).system, data["Candle (3)"].system);
});
