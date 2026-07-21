import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  benefitCountFromRoll, curseFromRoll, bonusFromRoll, personalityFromRoll,
  composeName, inferSeedFromName, parseBonusValue, resolveSelectedBonus, assembleItemData,
} from "../scripts/magic-forge/magic-forge.mjs";
import { buildForgeProvenance } from "../scripts/magic-forge/magic-table-runtime.mjs";

/* -- legacy roll curves (pinned, back-compat) ------------------------------ */

test("roll → attribute mappings", () => {
  assert.equal(benefitCountFromRoll(1), 0);
  assert.equal(benefitCountFromRoll(3), 1);
  assert.equal(benefitCountFromRoll(6), 2);
  assert.equal(curseFromRoll(2), true);
  assert.equal(curseFromRoll(3), false);
  assert.deepEqual([1, 2, 9, 10, 11, 12].map(bonusFromRoll), [0, 0, 1, 2, 2, 3]);
  assert.equal(personalityFromRoll(1), true);
  assert.equal(personalityFromRoll(2), false);
});

test("composeName", () => {
  assert.equal(composeName({ type: "weapon", baseItem: "Longsword", bonus: 2 }), "+2 Longsword");
  assert.equal(composeName({ type: "weapon", baseItem: "Longsword", bonus: 0 }), "Longsword");
  assert.equal(composeName({ type: "armor", baseItem: "", bonus: 1 }), "+1 Armor");
  assert.equal(composeName({ type: "utility", baseItem: "", bonus: 0 }), "Utility");
});

test("composeName does not stack bonus prefixes when re-forging a forged base", () => {
  // Re-forging FROM a forged item is supported (assembleItemData strips the old
  // bonus effects); the name must be re-derived, not stacked.
  assert.equal(composeName({ type: "weapon", baseItem: "+2 Longsword", bonus: 3 }), "+3 Longsword");
  assert.equal(composeName({ type: "weapon", baseItem: "+2 Longsword", bonus: 2 }), "+2 Longsword");
  // Dropping to +0 drops the prefix — the effects are gone, so the name must not lie.
  assert.equal(composeName({ type: "weapon", baseItem: "+2 Longsword", bonus: 0 }), "Longsword");
  // Heals names already doubled by the pre-fix behaviour.
  assert.equal(composeName({ type: "weapon", baseItem: "+2 +2 Longsword", bonus: 1 }), "+1 Longsword");
  assert.equal(composeName({ type: "armor", baseItem: "+1 Plate Mail", bonus: 0 }), "Plate Mail");
  // A "+N" that isn't a leading prefix belongs to the name and is left alone.
  assert.equal(composeName({ type: "weapon", baseItem: "Sword of +1 Smiting", bonus: 2 }), "+2 Sword of +1 Smiting");
  assert.equal(composeName({ type: "weapon", baseItem: "Longsword +1", bonus: 2 }), "+2 Longsword +1");
  // A base named only "+2" has no strippable prefix (no trailing word) — kept.
  assert.equal(composeName({ type: "weapon", baseItem: "+2", bonus: 1 }), "+1 +2");
});

test("inferSeedFromName (legacy loot fallback)", () => {
  assert.deepEqual(inferSeedFromName("+2 Longsword"), { type: "weapon", bonus: 2 });
  assert.deepEqual(inferSeedFromName("Plate Mail"), { type: "armor", bonus: 0 });
  assert.deepEqual(inferSeedFromName("Scroll of Fireball"), { type: "scroll", bonus: 0 });
  assert.deepEqual(inferSeedFromName("Wand of Magic Missile"), { type: "wand", bonus: 0 });
  assert.deepEqual(inferSeedFromName("Mystery Trinket"), { type: "utility", bonus: 0 });
});

/* -- strict numeric bonus parser ------------------------------------------- */

test("parseBonusValue accepts only unambiguous whole-result +N in 0..3", () => {
  assert.equal(parseBonusValue("+0"), 0);
  assert.equal(parseBonusValue("+1"), 1);
  assert.equal(parseBonusValue("+2"), 2);
  assert.equal(parseBonusValue("+3"), 3);
  assert.equal(parseBonusValue("2"), 2);
  assert.equal(parseBonusValue("+2 bonus"), 2);
  // rejected: out of range, prose, ranges, multi-digit, blank
  assert.equal(parseBonusValue("+4"), null);
  assert.equal(parseBonusValue("Roll on the Feature table"), null);
  assert.equal(parseBonusValue("2d6"), null);
  assert.equal(parseBonusValue("12"), null);
  assert.equal(parseBonusValue(""), null);
  assert.equal(parseBonusValue(null), null);
  // strict whole-result boundary (review #3): no hyphen/comma/decimal/sign leakage
  assert.equal(parseBonusValue("1-3"), null, "range must not parse to 1");
  assert.equal(parseBonusValue("3,000 gp"), null, "currency must not parse to 3");
  assert.equal(parseBonusValue("1.5"), null);
  assert.equal(parseBonusValue("-1"), null);
  assert.equal(parseBonusValue("4"), null);
  assert.equal(parseBonusValue("+2 to attacks"), null, "arbitrary trailing prose rejected");
  assert.equal(parseBonusValue("2 bonus"), 2);
});

test("resolveSelectedBonus returns +N or throws (fail-closed for a picked bonus)", () => {
  assert.equal(resolveSelectedBonus("+2"), 2);
  assert.equal(resolveSelectedBonus("0"), 0);
  assert.throws(() => resolveSelectedBonus("1-3"), /usable \+N/);
  assert.throws(() => resolveSelectedBonus("Cursed to shatter"), /usable \+N/);
  assert.throws(() => resolveSelectedBonus("+4"), /usable \+N/);
});

/* -- weapon +N mechanics --------------------------------------------------- */

const AE_MODE_ADD = 2;

test("weapon +0 forges no bonus effects, flags bonus 0", () => {
  const data = assembleItemData({ type: "weapon", baseItemData: { type: "Weapon", system: {} }, bonus: 0 });
  assert.ok(!data.effects || data.effects.length === 0);
  assert.equal(data.flags[MODULE_ID].bonus, 0);
  assert.notEqual(data.system.magicItem, true);
});

test("weapon +2 forges exactly two transferring AEs with the native SD keys", () => {
  const data = assembleItemData({ type: "weapon", baseItemData: { type: "Weapon", system: {} }, bonus: 2 });
  assert.equal(data.effects.length, 2);
  const keys = data.effects.map((e) => e.changes[0].key).sort();
  assert.deepEqual(keys, ["system.roll.attack.bonus.this", "system.roll.attack.damage.this"]);
  for (const e of data.effects) {
    assert.equal(e.transfer, true);
    assert.equal(e.changes[0].value, 2);
    assert.equal(e.changes[0].mode, AE_MODE_ADD);
    assert.equal(e.flags[MODULE_ID].forgeBonus, true);
  }
  assert.equal(data.system.magicItem, true);
});

test("weapon +1 and +3 both forge two effects with the right magnitude", () => {
  for (const n of [1, 3]) {
    const data = assembleItemData({ type: "weapon", baseItemData: { type: "Weapon", system: {} }, bonus: n });
    assert.equal(data.effects.length, 2);
    assert.ok(data.effects.every((e) => e.changes[0].value === n));
  }
});

test("armor +N rides system.ac.modifier, no active effects", () => {
  const data = assembleItemData({ type: "armor", baseItemData: { type: "Armor", system: { ac: { base: 13, attribute: "dex" } } }, bonus: 2 });
  assert.equal(data.system.ac.modifier, 2);
  assert.equal(data.system.ac.base, 13, "base AC preserved");
  assert.equal(data.system.ac.attribute, "dex", "AC attribute preserved");
  assert.ok(!data.effects || data.effects.length === 0);
});

test("cloning a base preserves its mechanics (damage die, properties)", () => {
  const base = { type: "Weapon", system: { damage: { numDice: 1, value: "d8" }, properties: ["finesse"] } };
  const data = assembleItemData({ type: "weapon", baseItemData: base, bonus: 1, name: "Test Blade" });
  assert.equal(data.system.damage.value, "d8");
  assert.deepEqual(data.system.properties, ["finesse"]);
  assert.equal(data.name, "Test Blade");
});

test("re-forging a base that already carries SDE bonus effects does not stack (dedup)", () => {
  const forgedBase = {
    type: "Weapon", system: {},
    effects: [
      { name: "old atk", changes: [{ key: "system.roll.attack.bonus.this", value: 1, mode: AE_MODE_ADD }], flags: { [MODULE_ID]: { forgeBonus: true } } },
      { name: "old dmg", changes: [{ key: "system.roll.attack.damage.this", value: 1, mode: AE_MODE_ADD }], flags: { [MODULE_ID]: { forgeBonus: true } } },
      { name: "unrelated glow", changes: [{ key: "system.light.range", value: 20, mode: AE_MODE_ADD }], flags: {} },
    ],
  };
  const data = assembleItemData({ type: "weapon", baseItemData: forgedBase, bonus: 3 });
  const forgeEffects = data.effects.filter((e) => e.flags?.[MODULE_ID]?.forgeBonus);
  assert.equal(forgeEffects.length, 2, "exactly one fresh pair, no stacking");
  assert.ok(data.effects.every((e) => !e.flags?.[MODULE_ID]?.forgeBonus || e.changes[0].value === 3));
  assert.ok(data.effects.some((e) => e.name === "unrelated glow"), "non-forge base effects preserved");
});

/* -- Core-mode descriptive riders + provenance ----------------------------- */

test("descriptive riders are escaped and carry a visible non-automated marker", () => {
  const data = assembleItemData({
    type: "weapon", baseItemData: { type: "Weapon", system: {} }, bonus: 1,
    descriptors: [
      { role: "feature", text: "Glows faintly near <gold>" },
      { role: "curse", text: "Whispers <script>alert(1)</script> at night" },
      { role: "type", text: "Sword (suggested)" }, // hint only — must NOT be written
    ],
  });
  const desc = data.system.description;
  assert.match(desc, /Feature:/);
  assert.match(desc, /Curse:/);
  assert.ok(!/<script>/i.test(desc), "hostile markup must be escaped");
  assert.match(desc, /&lt;script&gt;/);
  assert.match(desc, /sde-forge-nonauto/, "non-automated marker present");
  assert.ok(!/Sword \(suggested\)/.test(desc), "type is a hint only — never persisted");
});

test("forge provenance v2 flag is refs-only; forged/bonus contract preserved", () => {
  const forge = buildForgeProvenance({
    recipe: "magic-weapon-base",
    results: [{ manifestId: "core-weapon-bonus", tableUuid: "t1", resultId: "r1", range: [10, 11], text: "SECRET" }],
    automation: [{ kind: "weapon-bonus", value: 2 }],
    nonAutomated: true,
  });
  const data = assembleItemData({ type: "weapon", baseItemData: { type: "Weapon", system: {} }, bonus: 2, forge });
  assert.equal(data.flags[MODULE_ID].forged, true);
  assert.equal(data.flags[MODULE_ID].bonus, 2);
  assert.equal(data.flags[MODULE_ID].forge.version, 2);
  assert.deepEqual(data.flags[MODULE_ID].forge.refs, [{ manifestId: "core-weapon-bonus", tableUuid: "t1", resultId: "r1", range: [10, 11] }]);
  assert.ok(!JSON.stringify(data.flags[MODULE_ID].forge).includes("SECRET"));
});

test("manual behavior unchanged: scroll references a spell, no forge flag when omitted", () => {
  const data = assembleItemData({ type: "scroll", spellUuids: ["Compendium.x.Item.abc"], name: "Scroll of X" });
  assert.equal(data.type, "Scroll");
  assert.equal(data.system.spellUuid, "Compendium.x.Item.abc");
  assert.equal(data.system.magicItem, true);
  assert.equal(data.flags[MODULE_ID].forge, undefined);
});

/* -- review #2: +0 gear with descriptive magic is still a magic item -------- */

test("+0 weapon with a descriptive rider is magicItem=true but has NO effects", () => {
  const data = assembleItemData({
    type: "weapon", baseItemData: { type: "Weapon", system: {} }, bonus: 0,
    descriptors: [{ role: "curse", text: "Whispers at night" }],
  });
  assert.equal(data.system.magicItem, true, "descriptive-only magic still flags magicItem");
  assert.ok(!data.effects || data.effects.length === 0, "+0 applies no effects");
  assert.equal(data.flags[MODULE_ID].bonus, 0);
});

test("+0 weapon with forge provenance (no rider text) is still magicItem=true", () => {
  const forge = buildForgeProvenance({ recipe: "x", results: [{ manifestId: "core-weapon-feature", tableUuid: "t", resultId: "r", range: [1, 1] }] });
  const data = assembleItemData({ type: "weapon", baseItemData: { type: "Weapon", system: {} }, bonus: 0, forge });
  assert.equal(data.system.magicItem, true);
  assert.ok(!data.effects || data.effects.length === 0);
});

test("+0 armor with a Feature rider gets magicItem but no ac.modifier bump", () => {
  const data = assembleItemData({
    type: "armor", baseItemData: { type: "Armor", system: { ac: { base: 13 } } }, bonus: 0,
    descriptors: [{ role: "feature", text: "Faintly warm" }],
  });
  assert.equal(data.system.magicItem, true);
  assert.notEqual(data.system.ac.modifier, 1);
  assert.ok(!(data.system.ac.modifier > 0), "+0 armor sets no positive modifier");
});

test("plain +0 gear with NO magic stays mundane", () => {
  const data = assembleItemData({ type: "weapon", baseItemData: { type: "Weapon", system: {} }, bonus: 0 });
  assert.notEqual(data.system.magicItem, true);
});

/* -- review #4: manual re-forge strips inherited Core provenance ------------ */

test("manual re-forge of a Core-forged base drops the stale forge flag", () => {
  // A base that was previously Core-forged carries flags[MODULE_ID].forge.
  const priorForge = buildForgeProvenance({ recipe: "magic-weapon-base", results: [{ manifestId: "core-weapon-bonus", tableUuid: "t", resultId: "OLD", range: [10, 11] }] });
  const forgedBase = {
    type: "Weapon", system: {},
    flags: { [MODULE_ID]: { forged: true, bonus: 2, forge: priorForge } },
  };
  // Manual re-forge supplies NO new draft.forge.
  const data = assembleItemData({ type: "weapon", baseItemData: forgedBase, bonus: 1 });
  assert.equal(data.flags[MODULE_ID].forge, undefined, "stale Core provenance must not survive a manual re-forge");
  assert.ok(!JSON.stringify(data.flags).includes("OLD"), "no stale refs remain");
  assert.equal(data.flags[MODULE_ID].bonus, 1);
});

test("re-forge REPLACING provenance keeps only the new refs", () => {
  const priorForge = buildForgeProvenance({ recipe: "x", results: [{ manifestId: "core-weapon-bonus", tableUuid: "t", resultId: "OLD", range: [10, 11] }] });
  const forgedBase = { type: "Weapon", system: {}, flags: { [MODULE_ID]: { forged: true, bonus: 2, forge: priorForge } } };
  const newForge = buildForgeProvenance({ recipe: "y", results: [{ manifestId: "core-weapon-feature", tableUuid: "t2", resultId: "NEW", range: [5, 5] }] });
  const data = assembleItemData({ type: "weapon", baseItemData: forgedBase, bonus: 2, forge: newForge });
  assert.equal(data.flags[MODULE_ID].forge.refs.length, 1);
  assert.equal(data.flags[MODULE_ID].forge.refs[0].resultId, "NEW");
  assert.ok(!JSON.stringify(data.flags).includes("OLD"));
});
