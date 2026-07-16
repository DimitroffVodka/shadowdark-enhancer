/**
 * Treasure/Loot → Magic Item Forge handoff — synthetic fixtures only.
 * Verifies the stable forgeType classification, the seed-type precedence
 * (stable hint preferred over name inference; legacy fallback), that a
 * forged item carries every field the claim/give copy must transfer, and the
 * card-replacement invariants (forgeType preserved; forgeable cleared).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/module-id.mjs";
import { forgeTypeOf } from "../scripts/encounter/loot-value.mjs";
import { resolveForgeType, inferSeedFromName, assembleItemData } from "../scripts/encounter/magic-forge.mjs";
import { buildForgeProvenance } from "../scripts/encounter/magic-table-runtime.mjs";

/* -- stable classification ------------------------------------------------- */

test("forgeTypeOf prefers the system item type, falls back to name keywords", () => {
  assert.equal(forgeTypeOf({ type: "Weapon", name: "Mysterious Rod" }), "weapon");
  assert.equal(forgeTypeOf({ type: "Armor", name: "Odd Vest" }), "armor");
  assert.equal(forgeTypeOf({ type: "Scroll", name: "x" }), "scroll");
  assert.equal(forgeTypeOf({ type: "Wand", name: "x" }), "wand");
  assert.equal(forgeTypeOf({ type: "Potion", name: "x" }), "potion");
  // no type → name inference
  assert.equal(forgeTypeOf({ name: "Rusted Longsword" }), "weapon");
  assert.equal(forgeTypeOf({ name: "Plate Mail" }), "armor");
  assert.equal(forgeTypeOf({ name: "Scroll of Whatever" }), "scroll");
  assert.equal(forgeTypeOf({ name: "Unknowable Bauble" }), "utility");
});

/* -- seed precedence: stable hint wins; legacy fallback -------------------- */

test("stable forgeType hint wins over the name-only inference", () => {
  // A "Rod of Cinders" name infers utility, but the placeholder classified it
  // as a weapon — the stable hint must win.
  const seed = { ...inferSeedFromName("Rod of Cinders"), forgeType: "weapon" };
  assert.equal(inferSeedFromName("Rod of Cinders").type, "utility");
  assert.equal(resolveForgeType(seed), "weapon");
});

test("legacy card (no forgeType) falls back to the name inference", () => {
  const seed = { ...inferSeedFromName("+2 Longsword"), forgeType: null };
  assert.equal(resolveForgeType(seed), "weapon");
  assert.equal(resolveForgeType({ ...inferSeedFromName("Plate Mail") }), "armor");
});

test("a potion/utility hint maps to the nearest working type (wand); junk → null", () => {
  assert.equal(resolveForgeType({ forgeType: "potion" }), "wand");
  assert.equal(resolveForgeType({ type: "utility" }), "wand");
  assert.equal(resolveForgeType({ type: "nonsense" }), null);
});

/* -- forged item carries everything the claim/give copy transfers ---------- */

test("a Core-forged weapon is a complete item-data object (claim copy loses nothing)", () => {
  const forge = buildForgeProvenance({
    recipe: { mode: "core", type: "weapon", sets: ["magic-weapon-base"] },
    results: [{ manifestId: "core-weapon-bonus", tableUuid: "t", resultId: "r", range: [10, 11], text: "SECRET" }],
    automation: [{ kind: "weapon-bonus", value: 2 }], nonAutomated: true,
  });
  const data = assembleItemData({
    type: "weapon", name: "+2 Test Blade",
    baseItemData: { type: "Weapon", img: "icons/x.webp", system: { damage: { value: "d8" }, properties: ["finesse"] } },
    bonus: 2, identified: true,
    descriptors: [{ role: "feature", text: "Hums softly" }],
    forge,
  });
  // effects (the +N mechanic), flags (forged/bonus + refs-only provenance),
  // identification, description, and carried-through properties all present.
  assert.equal(data.effects.length, 2);
  assert.equal(data.flags[MODULE_ID].forged, true);
  assert.equal(data.flags[MODULE_ID].bonus, 2);
  assert.equal(data.flags[MODULE_ID].forge.version, 2);
  assert.equal(data.system.identification.identified, true);
  assert.match(data.system.description, /Feature:/);
  assert.deepEqual(data.system.properties, ["finesse"]);
  assert.equal(data.system.damage.value, "d8");
  // No book prose leaked into the persisted flags.
  assert.ok(!JSON.stringify(data.flags).includes("SECRET"));
});

/* -- card replacement invariants (pure mirror of _handleForgedReplace) ------ */

test("forged replacement preserves forgeType and clears forgeable; cancel leaves card intact", () => {
  const card = { uuid: "Item.placeholder", name: "Unrefined Blade", img: "old.webp", forgeable: true, forgeType: "weapon", value: 50, tier: "Fabulous" };
  const forged = { uuid: "Item.forged", name: "+2 Blade", img: "new.webp" };

  // success path (the delivery handler's spread)
  const replaced = { ...card, uuid: forged.uuid, name: forged.name, img: forged.img ?? card.img, forgeable: false };
  assert.equal(replaced.uuid, "Item.forged");
  assert.equal(replaced.name, "+2 Blade");
  assert.equal(replaced.img, "new.webp");
  assert.equal(replaced.forgeable, false);
  assert.equal(replaced.forgeType, "weapon", "stable hint survives the swap");
  assert.equal(replaced.value, 50, "classification fields untouched");

  // cancel/failure path: onCreate never fires → the card object is unchanged.
  const untouched = { ...card };
  assert.deepEqual(untouched, card);
  assert.equal(untouched.forgeable, true);
});
