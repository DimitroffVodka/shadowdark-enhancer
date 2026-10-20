/** A generated merchant's stock: rolled per ware by rarity and settlement size, the right types, no repeats. */
import test from "node:test";
import assert from "node:assert/strict";
import { KINDS, SIZES, pickStock, rarityOf, stockItem } from "../scripts/merchant/stock-generator.mjs";

const row = (name, type, costCp) => ({ uuid: `Compendium.x.${type}.${name}`, name, type, costCp });
const gear = [
  row("Torch", "Basic", 5), row("Rations", "Basic", 50), row("Rope, 60'", "Basic", 100), row("Lantern", "Basic", 500),
  row("Dagger", "Weapon", 100), row("Longsword", "Weapon", 900), row("Greatsword", "Weapon", 1200), row("Club (Obsidian)", "Weapon", 500),
  row("Leather Armor", "Armor", 1000), row("Chainmail", "Armor", 6000), row("Plate Mail", "Armor", 13000), row("Mithral Plate Mail", "Armor", 52000),
];
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const typeOf = (uuid) => uuid.split(".")[2];
const names = (out) => out.map((o) => o.uuid.split(".")[3]);

test("the gear list's rarities, by name (punctuation and case aside)", () => {
  assert.equal(rarityOf({ name: "Rope, 60'" }), "common");
  assert.equal(rarityOf({ name: "oil flask" }), "common");
  assert.equal(rarityOf({ name: "Club" }), "common");
  assert.equal(rarityOf({ name: "Club (Obsidian)" }), "rare");
  assert.equal(rarityOf({ name: "Crawling Kit" }), "uncommon");
  assert.equal(rarityOf({ name: "Round Shield" }), "uncommon");
  assert.equal(rarityOf({ name: "Mithral Chainmail" }), "veryRare");
});

test("anything else takes its rarity from its price: 1 gp common, 10 gp uncommon, 100 gp rare, more very rare", () => {
  assert.deepEqual([100, 101, 1000, 1001, 10000, 10001].map((costCp) => rarityOf({ name: "Odd Thing", costCp })), ["common", "uncommon", "uncommon", "rare", "rare", "veryRare"]);
});

test("common goods are always in stock, even in a village on the worst roll", () => {
  const out = pickStock(gear, { kind: "outfitter", size: "village" }, () => 0.999);
  assert.deepEqual(names(out).sort(), ["Dagger", "Leather Armor", "Rations", "Rope, 60'", "Torch"]);
});

test("each rarity is kept when its roll falls under the size's chance", () => {
  // Just under / just over each chance at a town (uncommon 75, rare 20, very rare 3).
  const at = (r) => names(pickStock(gear, { kind: "outfitter", size: "town" }, () => r));
  assert.ok(at(0.74).includes("Lantern") && !at(0.75).includes("Lantern"));
  assert.ok(at(0.19).includes("Greatsword") && !at(0.20).includes("Greatsword"));
  assert.ok(at(0.029).includes("Mithral Plate Mail") && !at(0.03).includes("Mithral Plate Mail"));
  // A city-state always has the uncommon goods.
  assert.ok(names(pickStock(gear, { kind: "outfitter", size: "city_state" }, () => 0.999)).includes("Chainmail"));
});

test("the four sizes, smallest to largest, make rare goods likelier", () => {
  assert.deepEqual(SIZES.map((s) => s.id), ["village", "town", "city", "city_state"]);
  for (const r of ["uncommon", "rare", "veryRare"]) for (let i = 1; i < SIZES.length; i++) assert.ok(SIZES[i].chance[r] >= SIZES[i - 1].chance[r]);
});

test("how many: common in plenty (more in bigger places), uncommon a few, rare one", () => {
  const top = (size) => pickStock(gear, { kind: "outfitter", size }, () => 0);
  const bundles = (out, name) => out.find((o) => o.uuid.endsWith(`.${name}`))?.bundles;
  assert.ok(bundles(top("city_state"), "Torch") > bundles(top("village"), "Torch"));
  assert.ok(bundles(top("city"), "Dagger") <= bundles(top("city"), "Torch"), "weapons fewer than gear");
  const city = top("city");
  assert.ok([2, 3].includes(bundles(city, "Lantern")));
  assert.equal(bundles(city, "Greatsword"), 1);
  assert.equal(bundles(city, "Mithral Plate Mail"), 1);
  for (const s of SIZES) for (const o of pickStock(gear, { kind: "outfitter", size: s.id }, seeded(3))) assert.ok(o.bundles >= 1 && o.bundles <= s.plenty);
});

test("every kind stocks only its own types, with no ware twice", () => {
  for (const k of KINDS) for (const s of SIZES) {
    const out = pickStock(gear, { kind: k.id, size: s.id }, seeded());
    assert.ok(out.length > 0);
    assert.equal(new Set(out.map((o) => o.uuid)).size, out.length);
    assert.ok(out.every((o) => k.types.includes(typeOf(o.uuid))), k.id);
  }
});

test("left out: free things, the Light spells, the Basilisk Egg, potions, Holy Symbol, Thieves' Tools and siege gear", () => {
  assert.deepEqual(pickStock([{ ...row("Catapult", "Weapon", 10000), siege: true }, row("Siege Weapon Ammunition", "Basic", 100), row("Torch", "Basic", 5)], { kind: "outfitter", size: "city_state" }).map((o) => o.uuid.split(".")[3]), ["Torch"]);
  const out = pickStock([row("Light Spell (Double Time)", "Basic", 100), row("Basilisk Egg", "Basic", 100), row("Thieves' Tools", "Basic", 100), row("Holy Symbol", "Basic", 100), row("Free", "Basic", 0), row("Torch", "Basic", 5)], { kind: "general", size: "city_state" });
  assert.deepEqual(names(out), ["Torch"]);
  assert.deepEqual(pickStock(gear, { kind: "nope", size: "town" }), []);
  assert.deepEqual(pickStock(gear, { kind: "general", size: "huge" }), []);
});

test("two entries with the same name (case and spaces aside) are one ware: the first wins", () => {
  const dup = [{ uuid: "a", name: "Arrows", type: "Basic", costCp: 100 }, { uuid: "b", name: " arrows ", type: "Basic", costCp: 100 }, { uuid: "c", name: "Rope", type: "Basic", costCp: 100 }];
  assert.deepEqual(pickStock(dup, { kind: "general", size: "city" }, seeded()).map((o) => o.uuid), ["a", "c"]);
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
