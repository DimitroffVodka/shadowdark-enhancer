// What an NPC carries: only physical gear shows on its Inventory tab, its purse is whole coins,
// and Drop as loot turns both into a card whose items no longer belong to the creature.
import test from "node:test";
import assert from "node:assert/strict";
import { purse, hasCoins, carriedRows, lootBatch } from "../scripts/npc-inventory/npc-inventory-core.mjs";

test("a purse is whole coins whatever was stored", () => {
  assert.deepEqual(purse({ gp: "3", sp: 2.7, cp: -4 }), { gp: 3, sp: 2, cp: 0 });
  assert.deepEqual(purse(null), { gp: 0, sp: 0, cp: 0 });
  assert.equal(hasCoins(purse({ cp: 1 })), true);
  assert.equal(hasCoins(purse({})), false);
});

test("the tab lists carried gear only, by name, at least one of each", () => {
  const rows = carriedRows([
    { id: "a", name: "Sword", type: "Weapon", system: { quantity: 1 } },
    { id: "b", name: "Bite", type: "NPC Attack" },
    { id: "c", name: "Arrows", type: "Basic", system: { quantity: 0 } },
    { id: "d", name: "Fireball", type: "Spell" },
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.qty]), [["Arrows", 1], ["Sword", 1]]);
});

test("Drop as loot: each item travels as its own data, without the creature's id or placement", () => {
  const batch = lootBatch("Bandit", [{ _id: "x", _stats: {}, folder: "f", sort: 5, ownership: {}, name: "Dagger", img: "d.webp", type: "Weapon", system: { quantity: 2 } }], { gp: 4 });
  assert.equal(batch.tier, null, "no tier: the card reads as what the creature carried");
  assert.deepEqual(batch.coins, { gp: 4, sp: 0, cp: 0 });
  assert.equal(batch.items[0].qty, 2);
  assert.equal(batch.items[0].uuid, null);
  assert.deepEqual(Object.keys(batch.items[0].fabricate).sort(), ["img", "name", "system", "type"]);
});
