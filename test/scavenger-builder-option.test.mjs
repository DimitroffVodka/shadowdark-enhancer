/**
 * The merge-aware Character Builder passes { "shadowdark-enhancer": { builder } }
 * on every embedded write. Scavenger must not treat those as expenditure: with
 * the talent on the actor, a builder removing a Torch would post a roll and
 * restore the item 1 time in 3.
 *
 * Probe: _handle reads the ammo setting only after it found a pre-hook
 * snapshot, so the count of setting reads says whether a snapshot was taken.
 */
import test from "node:test";
import assert from "node:assert/strict";

const handlers = {};
globalThis.Hooks = { on: (name, fn) => { handlers[name] = fn; } };
let settingReads = 0;
globalThis.game = {
  settings: { get: () => { settingReads++; return true; } },
  user: { id: "u1" },
  users: Object.assign([], { activeGM: null }),
};
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o) } };

const { init } = await import("../scripts/scavenger/scavenger.mjs");
init();

const actor = { documentName: "Actor", type: "Player", items: [] };
const mkItem = () => ({
  uuid: "Actor.a.Item.i", type: "Basic", parent: actor, system: { quantity: 1 },
  toObject() { return { name: "Torch", type: "Basic", system: { quantity: 1 } }; },
});
const CHANGES = { system: { quantity: 0 } };
const BUILDER = { "shadowdark-enhancer": { builder: "c1" } };

const tick = () => new Promise((r) => setImmediate(r));

/** Setting reads made by one change: 1 = no snapshot, 2+ = snapshot found. */
async function run(kind, options) {
  settingReads = 0;
  const it = mkItem();
  if (kind === "delete") {
    handlers.preDeleteItem(it, options, "u1");
    handlers.deleteItem(it);
  } else {
    handlers.preUpdateItem(it, CHANGES, options, "u1");
    handlers.updateItem(it, CHANGES);
  }
  await tick();
  return settingReads;
}

test("a delete without the builder option is remembered (unchanged)", async () => {
  assert.ok(await run("delete", {}) > 1);
  assert.ok(await run("delete", undefined) > 1);
});

test("a delete carrying the builder option is not remembered", async () => {
  assert.equal(await run("delete", BUILDER), 1);
});

test("a quantity update without the builder option is remembered (unchanged)", async () => {
  assert.ok(await run("update", {}) > 1);
});

test("a quantity update carrying the builder option is not remembered", async () => {
  assert.equal(await run("update", BUILDER), 1);
});
