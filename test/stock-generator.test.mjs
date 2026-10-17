/** A generated merchant's stock: the right types, no repeats, the size's ceiling and quantity caps. */
import test from "node:test";
import assert from "node:assert/strict";
import { KINDS, SIZES, pickStock, stockItem } from "../scripts/merchant/stock-generator.mjs";

const row = (n, type, costCp) => ({ uuid: `Compendium.x.${type}.${n}`, type, costCp });
const pool = [
  ...Array.from({ length: 30 }, (_, i) => row(`b${i}`, "Basic", 5 + i * 40)),
  ...Array.from({ length: 30 }, (_, i) => row(`w${i}`, "Weapon", 100 + i * 500)),
  ...Array.from({ length: 30 }, (_, i) => row(`a${i}`, "Armor", 200 + i * 900)),
];
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const typeOf = (uuid) => uuid.split(".")[2];

test("every kind stocks only its own types, with no ware twice", () => {
  for (const k of KINDS) for (const s of SIZES) {
    const out = pickStock(pool, { kind: k.id, size: s.id }, seeded());
    assert.ok(out.length > 0 && out.length <= s.wares);
    assert.equal(new Set(out.map((o) => o.uuid)).size, out.length);
    assert.ok(out.every((o) => k.types.includes(typeOf(o.uuid))), k.id);
  }
});

test("a village holds nothing over 20 gp and at most 3 bundles (1 for weapons and armor)", () => {
  const out = pickStock([...pool, { uuid: "dear", type: "Basic", costCp: 5000 }], { kind: "outfitter", size: "village" }, seeded(3));
  const cost = new Map(pool.map((r) => [r.uuid, r]));
  for (const o of out) {
    assert.ok(cost.has(o.uuid) && cost.get(o.uuid).costCp <= 2000);
    assert.ok(o.bundles >= 1 && o.bundles <= (typeOf(o.uuid) === "Basic" ? 3 : 1));
  }
});

test("a city has no ceiling, up to 20 wares and 8 bundles (4 for weapons and armor)", () => {
  const out = pickStock(pool, { kind: "outfitter", size: "city" }, seeded(11));
  assert.equal(out.length, 20);
  const cost = new Map(pool.map((r) => [r.uuid, r]));
  for (const o of out) assert.ok(o.bundles <= (cost.get(o.uuid).type === "Basic" ? 8 : 4));
  assert.ok(pickStock(pool, { kind: "armorer", size: "city" }, seeded()).some((o) => cost.get(o.uuid).costCp > 7000));
});

test("free items, duplicates and an unknown kind or size give nothing", () => {
  assert.deepEqual(pickStock([row("f", "Basic", 0), row("f", "Basic", 0)], { kind: "general", size: "town" }), []);
  assert.deepEqual(pickStock(pool, { kind: "nope", size: "town" }), []);
  assert.deepEqual(pickStock(pool, { kind: "general", size: "huge" }), []);
  assert.equal(pickStock([row("d", "Basic", 10), row("d", "Basic", 10)], { kind: "general", size: "town" }).length, 1);
});

test("the bundle count comes from the random source, 1 at the bottom and the cap at the top", () => {
  const low = pickStock([row("r", "Basic", 10)], { kind: "general", size: "city" }, () => 0);
  const high = pickStock([row("r", "Basic", 10)], { kind: "general", size: "city" }, () => 0.999);
  assert.deepEqual([low[0].bundles, high[0].bundles], [1, 8]);
});

test("stock is counted in units: 2 bundles of arrows (20 to a slot) are 40, and the _id is dropped", () => {
  const arrows = { _id: "abc", name: "Arrows", type: "Basic", system: { quantity: 20, slots: { per_slot: 20 }, cost: { gp: 1 } } };
  const out = stockItem(arrows, 2);
  assert.equal(out.system.quantity, 40);
  assert.equal("_id" in out, false);
  assert.equal(out.system.cost.gp, 1);
  assert.equal(arrows.system.quantity, 20, "the source data is not changed");
  assert.equal(stockItem({ name: "Torch", system: {} }, 3).system.quantity, 3);
});
