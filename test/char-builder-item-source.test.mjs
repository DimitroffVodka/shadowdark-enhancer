import test from "node:test";
import assert from "node:assert/strict";
import { stampSource } from "../scripts/char-builder/item-source.mjs";

test("stampSource sets compendiumSource and returns the same object", () => {
  const obj = { name: "Torch", _stats: { coreVersion: "14" } };
  const out = stampSource(obj, "Compendium.shadowdark.gear.Item.abc");
  assert.equal(out, obj);
  assert.equal(obj._stats.compendiumSource, "Compendium.shadowdark.gear.Item.abc");
});

test("stampSource keeps the other _stats fields", () => {
  const obj = { _stats: { coreVersion: "14", systemId: "shadowdark", compendiumSource: null } };
  stampSource(obj, "Compendium.x.Item.1");
  assert.deepEqual(obj._stats, {
    coreVersion: "14", systemId: "shadowdark", compendiumSource: "Compendium.x.Item.1",
  });
});

test("stampSource creates _stats when the object has none", () => {
  const obj = { name: "Dagger" };
  stampSource(obj, "Compendium.x.Item.2");
  assert.deepEqual(obj._stats, { compendiumSource: "Compendium.x.Item.2" });
});

test("stampSource never overwrites an existing source", () => {
  const obj = { _stats: { compendiumSource: "Compendium.x.Item.first" } };
  stampSource(obj, "Compendium.x.Item.second");
  assert.equal(obj._stats.compendiumSource, "Compendium.x.Item.first");
});

test("stampSource without a uuid changes nothing", () => {
  for (const uuid of [undefined, null, ""]) {
    const obj = { name: "Rope" };
    stampSource(obj, uuid);
    assert.equal("_stats" in obj, false);
  }
  const withStats = { _stats: { coreVersion: "14" } };
  stampSource(withStats, null);
  assert.deepEqual(withStats._stats, { coreVersion: "14" });
});

test("stampSource passes a falsy object through", () => {
  assert.equal(stampSource(null, "Compendium.x.Item.3"), null);
});
