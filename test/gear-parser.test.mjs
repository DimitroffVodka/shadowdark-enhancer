// Regression tests for the Weapon/Armor stat parser (gear-parser.parseGear) and
// its handoff to item-importer.buildItemData. Pure — no Foundry globals; the
// property NAME → UUID resolution is commit-time (Foundry-bound, live-verified,
// not here). Fixtures mirror the Western Reaches gear-table SHAPE with synthetic
// values — no book content ships in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGear, WR_ARMOR_CODES, WR_WEAPON_CODES } from "../scripts/encounter/gear-parser.mjs";
import { buildItemData } from "../scripts/encounter/item-importer.mjs";

const one = (text, kind) => parseGear(text, kind)[0];

test("reflowed shield: slots vs AC-modifier disambiguation + C/S codes", () => {
  // One field per line (PDF-viewer copy shape): name / cost / slots / +mod / codes / material.
  const { draft, warnings } = one([
    "Round shield,",
    "60 gp",
    " 0",      // bare < 10 → slots
    " +2",     // leading + → ac.modifier (shield bonus)
    " C, S",   // Carried + Sundering
    "mithral",
  ].join("\n"), "Armor");

  assert.equal(draft.type, "Armor");
  assert.deepEqual(draft.cost, { gp: 60, sp: 0, cp: 0 });
  assert.equal(draft.slots.slots_used, 0);
  assert.equal(draft.ac.base, 0);
  assert.equal(draft.ac.modifier, 2);
  assert.equal(draft.ac.attribute, "");              // shields carry no bonus attribute
  assert.equal(draft.baseArmor, "mithral");
  assert.equal(draft.name, "Mithral Round shield");
  assert.deepEqual(draft.propNames, ["Occupies One Hand", "Sundering"]);
  assert.deepEqual(warnings, []);
});

test("body armor: bare number >= 10 is AC base, dex attribute defaulted, L code", () => {
  const { draft } = one([
    "Chain shirt",
    "40 gp",
    "1",       // slots
    "13",      // AC base
    "L",       // Loud → Disadvantage/Stealth
  ].join("\n"), "Armor");
  assert.equal(draft.ac.base, 13);
  assert.equal(draft.ac.modifier, 0);
  assert.equal(draft.ac.attribute, "dex");
  assert.equal(draft.slots.slots_used, 1);
  assert.deepEqual(draft.propNames, ["Disadvantage/Stealth"]);
});

test("Mount (M) code has no core property → flagged, not applied", () => {
  const { draft, warnings } = one("Barding\n30 gp\n2\n11\nM", "Armor");
  assert.deepEqual(draft.propNames, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Mount.*\(M\).*no core Shadowdark property/);
});

test("unknown armor code is flagged and left off", () => {
  const { draft, warnings } = one("Oddplate\n50 gp\n2\n15\nZ", "Armor");
  assert.deepEqual(draft.propNames, []);
  assert.match(warnings[0], /Unknown armor property code "Z"/);
});

test("inline weapon: versatile damage pair, range, code F", () => {
  const { draft } = one("Bastard sword, 10 gp, 1 slot, d8/d10, close, F, V", "Weapon");
  assert.equal(draft.type, "Weapon");
  assert.deepEqual(draft.damage, { oneHanded: "d8", twoHanded: "d10" });
  assert.equal(draft.range, "close");
  assert.equal(draft.wtype, "melee");
  assert.deepEqual(draft.propNames, ["Finesse", "Versatile"]);
});

test("two-handed-only weapon puts single die in twoHanded; far range → ranged", () => {
  const { draft } = one("Crossbow, 8 gp, 1 slot, d6, far, Lo, 2H", "Weapon");
  assert.deepEqual(draft.damage, { oneHanded: "", twoHanded: "d6" });
  assert.equal(draft.range, "far");
  assert.equal(draft.wtype, "ranged");
  assert.deepEqual(draft.propNames, ["Loading", "Two-Handed"]);
});

test("plain one-handed weapon, no properties", () => {
  const { draft } = one("Longsword, 9 gp, 1 slot, d8, close", "Weapon");
  assert.deepEqual(draft.damage, { oneHanded: "d8", twoHanded: "" });
  assert.deepEqual(draft.propNames, []);
});

test("multi-die siege damage kept verbatim (3d6)", () => {
  const { draft } = one("Ballista, 150 gp, ranged, 3d6, far", "Weapon");
  assert.equal(draft.damage.oneHanded === "3d6" || draft.damage.twoHanded === "3d6", true);
  assert.equal(draft.wtype, "ranged");
});

test("buildItemData maps an Armor draft to the ArmorSD system shape", () => {
  const { draft } = one("Round shield,\n60 gp\n0\n+2\nC, S\nmithral", "Armor");
  draft.properties = ["Compendium.shadowdark.properties.Item.CARRIED", "Compendium.shadowdark.properties.Item.SUND"];
  const data = buildItemData(draft);
  assert.equal(data.type, "Armor");
  assert.deepEqual(data.system.ac, { attribute: "", base: 0, modifier: 2 });
  assert.equal(data.system.baseArmor, "mithral");
  assert.equal(data.system.slots.slots_used, 0);
  assert.deepEqual(data.system.properties, draft.properties);
  assert.equal("treasure" in data.system, false);   // Armor never carries treasure
});

test("buildItemData maps a Weapon draft to the WeaponSD system shape", () => {
  const { draft } = one("Bastard sword, 10 gp, 1 slot, d8/d10, close, V", "Weapon");
  draft.properties = ["Compendium.shadowdark.properties.Item.VERS"];
  const data = buildItemData(draft);
  assert.equal(data.type, "Weapon");
  assert.deepEqual(data.system.damage, { oneHanded: "d8", twoHanded: "d10" });
  assert.equal(data.system.range, "close");
  assert.equal(data.system.type, "melee");
  assert.deepEqual(data.system.properties, draft.properties);
});

test("buildItemData: Basic gear defaults treasure:false (no longer stamps true)", () => {
  const data = buildItemData({ name: "Rope, 60'", type: "Basic", cost: { gp: 1, sp: 0, cp: 0 } });
  assert.equal(data.system.treasure, false);
});

test("legend maps are the documented WR codes", () => {
  assert.equal(WR_ARMOR_CODES.C, "Occupies One Hand");
  assert.equal(WR_ARMOR_CODES.S, "Sundering");
  assert.equal(WR_ARMOR_CODES.M, null);
  assert.equal(WR_WEAPON_CODES["2H"], "Two-Handed");
});
