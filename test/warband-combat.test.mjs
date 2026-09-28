// A warband retraining its upgrades can't fight yet (#204, #284 review): its attack is stopped.
import test from "node:test";
import assert from "node:assert/strict";

const TYPE = "shadowdark-enhancer.warband";
const hooks = new Map();
const warned = [];
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), once() {}, callAll() {} };
globalThis.game = { time: { worldTime: 1000 }, i18n: { format: (k) => k, localize: (k) => k }, actors: [], combats: [] };
globalThis.ui = { notifications: { warn: (m) => warned.push(m) } };
const actor = (type, retrainingUntil) => ({
  documentName: "Actor", type, name: "Band", flags: { "shadowdark-enhancer": { warband: { retrainingUntil } } },
  getFlag(scope, key) { return this.flags[scope]?.[key]; },
});
const actors = { "Actor.retraining": actor(TYPE, 2000), "Actor.ready": actor(TYPE, 500), "Actor.goblin": actor("NPC", 2000) };
globalThis.fromUuidSync = (uuid) => actors[uuid] ?? null;
const { registerWarbandCombat } = await import("../scripts/actors/warband-combat.mjs");
registerWarbandCombat(TYPE);
const attack = hooks.get("SD-NPC-Attack");

test("a retraining warband's attack is stopped with a warning; a ready one and other NPCs attack", () => {
  assert.equal(attack({ actorUuid: "Actor.retraining" }), false);
  assert.deepEqual(warned, ["SDE.warband.notify.retraining"]);
  assert.equal(attack({ actorUuid: "Actor.ready" }), true, "the week is up");
  assert.equal(attack({ actorUuid: "Actor.goblin" }), true, "not a warband");
  assert.equal(warned.length, 1);
});
