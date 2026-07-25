import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInlineSubroll, subrollName, resolveInlineSubroll,
} from "../scripts/loot/subroll.mjs";

// Every row below is real text from the world's "Luxury Items" table.

test("parses a plain sub-roll row into prefix + options", () => {
  const p = parseInlineSubroll("Meteorite 1d4: 1. lute, 2. viol, 3. harp, 4. flute");
  assert.equal(p.prefix, "Meteorite");
  assert.equal(p.dice, "1d4");
  assert.equal(p.faces, 4);
  assert.equal(p.qualifier, false);
  assert.deepEqual(p.options.map(o => o.label), ["lute", "viol", "harp", "flute"]);
});

test("a trailing comma on the prefix marks the option as a property", () => {
  const plain = parseInlineSubroll("Meteorite 1d4: 1. lute, 2. viol, 3. harp, 4. flute");
  const qual = parseInlineSubroll("Mithral Bottle, 1d4: 1. wine, 2. grog, 3. mead, 4. ale");
  assert.equal(qual.prefix, "Mithral Bottle");
  assert.equal(qual.qualifier, true);
  assert.equal(subrollName(plain, 3), "Meteorite harp");
  assert.equal(subrollName(qual, 1), "Mithral Bottle (wine)");
});

test("ranged options cover every number in the range", () => {
  const p = parseInlineSubroll("Dragonscaled Altar, 1d4: 1. Memnon, 2. Ord, 3-4. Madeera");
  assert.deepEqual(p.options.at(-1), { min: 3, max: 4, label: "Madeera" });
  assert.equal(subrollName(p, 3), "Dragonscaled Altar (Madeera)");
  assert.equal(subrollName(p, 4), "Dragonscaled Altar (Madeera)");
});

test("a missing separator between options still splits", () => {
  // The book drops the comma before "4." on this row.
  const p = parseInlineSubroll("Holy relic 1d4: 1. shield, 2. helm, 3. bracers 4. greaves");
  assert.deepEqual(p.options.map(o => o.label), ["shield", "helm", "bracers", "greaves"]);
  assert.equal(subrollName(p, 4), "Holy relic greaves");
});

test("a roll landing in a gap takes the nearest option", () => {
  const p = parseInlineSubroll("Etched-copper 1d6: 1. tusk, 2. horn, 5-6. skull");
  assert.equal(subrollName(p, 3), "Etched-copper horn");
  assert.equal(subrollName(p, 6), "Etched-copper skull");
});

test("rows that merely mention dice are not sub-rolls", () => {
  assert.equal(parseInlineSubroll("Golden Life-sized humanoid figure"), null);
  assert.equal(parseInlineSubroll("Potion of healing, restores 1d4 HP"), null);
  assert.equal(parseInlineSubroll("Gems worth 2d6 x 10 gp"), null);
  assert.equal(parseInlineSubroll("Silver tooth (1 gp)"), null);
  assert.equal(parseInlineSubroll(""), null);
  assert.equal(parseInlineSubroll(null), null);
});

test("a one-option list is not a sub-roll", () => {
  assert.equal(parseInlineSubroll("Reliquary 1d4: 1. bone"), null);
});

test("resolveInlineSubroll rolls the parsed die and names the prize", async () => {
  const seen = [];
  const roller = async (dice) => { seen.push(dice); return 2; };
  const name = await resolveInlineSubroll("White marble 1d4: 1. mirror, 2. vase, 3. pottery, 4. ewer", roller);
  assert.equal(name, "White marble vase");
  assert.deepEqual(seen, ["1d4"]);
});

test("resolveInlineSubroll returns null for a non-sub-roll row, without rolling", async () => {
  let rolled = false;
  const name = await resolveInlineSubroll("Bent, tin fork (1 cp)", () => { rolled = true; return 1; });
  assert.equal(name, null);
  assert.equal(rolled, false);
});
