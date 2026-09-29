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

/** Setting reads made by one change: 0 = skipped as a builder write, 1 = no snapshot, 2+ = snapshot found. */
async function run(kind, options) {
  settingReads = 0;
  const it = mkItem();
  if (kind === "delete") {
    handlers.preDeleteItem(it, options, "u1");
    handlers.deleteItem(it, options, "u1");
  } else {
    handlers.preUpdateItem(it, CHANGES, options, "u1");
    handlers.updateItem(it, CHANGES, options, "u1");
  }
  await tick();
  return settingReads;
}

test("a delete without the builder option is remembered (unchanged)", async () => {
  assert.ok(await run("delete", {}) > 1);
  assert.ok(await run("delete", undefined) > 1);
});

test("a delete carrying the builder option is not remembered", async () => {
  assert.equal(await run("delete", BUILDER), 0);
});

test("a quantity update without the builder option is remembered (unchanged)", async () => {
  assert.ok(await run("update", {}) > 1);
});

test("a quantity update carrying the builder option is not remembered", async () => {
  assert.equal(await run("update", BUILDER), 0);
});

// An ordinary pre-hook remembered the item, then a LATER hook vetoed that change (no
// post hook ran). The stale snapshot is keyed by the same item uuid.
async function vetoThenBuilder(kind) {
  const it = mkItem();
  if (kind === "delete") handlers.preDeleteItem(it, {}, "u1");
  else handlers.preUpdateItem(it, CHANGES, {}, "u1");
  return run(kind, BUILDER);
}

test("an ordinary vetoed delete, then a builder delete: the stale snapshot is not consumed", async () => {
  assert.equal(await vetoThenBuilder("delete"), 0);
});

test("an ordinary vetoed quantity update, then a builder update: the stale snapshot is not consumed", async () => {
  assert.equal(await vetoThenBuilder("update"), 0);
});

test("the same veto followed by an ordinary change is still handled (unchanged)", async () => {
  const it = mkItem();
  handlers.preDeleteItem(it, {}, "u1");
  assert.ok(await run("delete", {}) > 1);
});

test("a builder post hook alone never consumes a snapshot left by another change", async () => {
  const it = mkItem();
  handlers.preDeleteItem(it, {}, "u1");
  settingReads = 0;
  handlers.deleteItem(it, BUILDER, "u1");
  await tick();
  assert.equal(settingReads, 0);
});

// ---------------------------------------------------------------------------
// The same shapes counted in real rolls: a Scavenger on the actor, a stubbed Roll.
// ---------------------------------------------------------------------------
let rolls = 0;
globalThis.Roll = class { constructor() { rolls++; } async evaluate() { this.total = 1; return this; } async toMessage() {} };
globalThis.ChatMessage = { getSpeaker: () => ({}) };
globalThis.game.i18n = { localize: (k) => k, format: (k) => k };
globalThis.game.users.push({ id: "u1", isGM: false, active: true });
actor.items = [{ type: "Talent", name: "Scavenger" }];
actor.testUserPermission = () => true;

/** Rolls posted by one change; `vetoed` = an ordinary pre-hook ran first and a later hook vetoed it. */
async function rollsFor(kind, vetoed, options) {
  const it = mkItem();
  const pre = (o) => (kind === "delete" ? handlers.preDeleteItem(it, o, "u1") : handlers.preUpdateItem(it, CHANGES, o, "u1"));
  if (vetoed) pre({});
  rolls = 0;
  pre(options);
  if (kind === "update") it.system.quantity = 0;
  if (kind === "delete") handlers.deleteItem(it, options, "u1"); else handlers.updateItem(it, CHANGES, options, "u1");
  await tick();
  return rolls;
}

for (const kind of ["delete", "update"]) {
  test(`rolls (${kind}): ordinary once, builder none, veto then builder none`, async () => {
    assert.equal(await rollsFor(kind, false, {}), 1);
    assert.equal(await rollsFor(kind, false, BUILDER), 0);
    assert.equal(await rollsFor(kind, true, BUILDER), 0);
  });
}
