/**
 * Spell↔class retro-link contract (import-order independence).
 * Pure halves only — the Foundry-bound sweep (relinkSpellsToClasses) is
 * live-probed via MCP:
 *   • buildItemData stamps the parsed caster-class NAME on the spell doc
 *     (flags[MODULE_ID].spellClassName) so an unresolved commit keeps its
 *     intent for the sweep to link later.
 *   • classNameFromSpellFolder recovers the class name from the
 *     "Spells / <Class> (Variant)" folder leaf for pre-stamp spells.
 * All fixture data is invented — no book content.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildItemData, classNameFromSpellFolder } from "../scripts/encounter/item-importer.mjs";
import { MODULE_ID } from "../scripts/module-id.mjs";

test("classNameFromSpellFolder: plain class name passes through", () => {
  assert.equal(classNameFromSpellFolder("Necromancer"), "Necromancer");
});

test("classNameFromSpellFolder: '(Variant)' suffix strips", () => {
  assert.equal(classNameFromSpellFolder("Wizard (Druid)"), "Wizard");
  assert.equal(classNameFromSpellFolder("Priest (Lawful)"), "Priest");
});

test("classNameFromSpellFolder: only the TRAILING parenthetical strips", () => {
  assert.equal(classNameFromSpellFolder("Knight (Green) (Neutral)"), "Knight (Green)");
});

test("classNameFromSpellFolder: blank/nullish → empty string", () => {
  assert.equal(classNameFromSpellFolder(""), "");
  assert.equal(classNameFromSpellFolder(null), "");
  assert.equal(classNameFromSpellFolder(undefined), "");
  assert.equal(classNameFromSpellFolder("  Green Knight  "), "Green Knight");
});

test("buildItemData(Spell): stamps flags[MODULE_ID].spellClassName from draft.className", () => {
  const data = buildItemData({
    type: "Spell", name: "Probe Bolt", tier: 1,
    className: " Necromancer ", class: [],
    description: "A test spell.",
  });
  assert.equal(data.type, "Spell");
  assert.equal(data.flags[MODULE_ID].spellClassName, "Necromancer");
  assert.equal(data.flags[MODULE_ID].imported, true);
  assert.deepEqual(data.system.class, []);
});

test("buildItemData(Spell): resolved class UUIDs pass through alongside the stamp", () => {
  const data = buildItemData({
    type: "Spell", name: "Probe Bolt", tier: 2,
    className: "Wizard", class: ["Compendium.shadowdark.classes.Item.abc123def456"],
    description: "A test spell.",
  });
  assert.deepEqual(data.system.class, ["Compendium.shadowdark.classes.Item.abc123def456"]);
  assert.equal(data.flags[MODULE_ID].spellClassName, "Wizard");
});

test("buildItemData(Spell): no className → no spellClassName key", () => {
  const data = buildItemData({ type: "Spell", name: "Orphan Bolt", tier: 1, description: "x" });
  assert.ok(!("spellClassName" in data.flags[MODULE_ID]));
  assert.equal(data.flags[MODULE_ID].imported, true);
});
