// A warband retraining its upgrades can't fight yet (#204, #284 review): its attack is stopped.
import test from "node:test";
import assert from "node:assert/strict";

const TYPE = "shadowdark-enhancer.warband";
const hooks = new Map();
const warned = [];
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), once() {}, callAll() {} };
globalThis.game = {
  time: { worldTime: 1000 }, i18n: { format: (k) => k, localize: (k) => k }, actors: [], combats: [],
  user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } },
};
const rolled = [];
let rollTotal = 20;
globalThis._replace = (value) => ({ value });
globalThis.Roll = class { constructor(formula) { this.formula = formula; rolled.push(formula); } async evaluate() { this.total = rollTotal; return this; } async toMessage() {} };
globalThis.ChatMessage = { getSpeaker: () => ({}) };
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

test("a warband in no one's service checks no morale in battle; a commanded one does (Patrick, 2026-09-28)", async () => {
  const hurt = (id, commander) => ({
    id, uuid: `Actor.${id}`, type: TYPE, name: id, system: { attributes: { hp: { value: 5, max: 20 } } },
    flags: { "shadowdark-enhancer": { warband: { commander, upgrades: [] } } },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
  });
  globalThis.fromUuid = async (uuid) => (uuid === "Actor.pc" ? { system: { abilities: { cha: { mod: 2 } } } } : null);
  const unhired = hurt("unhired", null);
  const hired = hurt("hired", "Actor.pc");
  globalThis.game.combats = [{ active: true, combatants: [{ actorId: "unhired" }, { actorId: "hired" }] }];
  const update = hooks.get("updateActor");
  rolled.length = 0;
  update(unhired, { system: { attributes: { hp: { value: 5 } } } });   // from full (the max) to a quarter
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(rolled, [], "no commander: no roll");
  update(hired, { system: { attributes: { hp: { value: 5 } } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(rolled, ["1d20 + 2"], "the commander's CHA");
  const orphan = hurt("orphan", "Actor.deleted");                       // its commander was deleted (#285 review)
  globalThis.game.combats[0].combatants.push({ actorId: "orphan" });
  rolled.length = 0;
  update(orphan, { system: { attributes: { hp: { value: 5 } } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(rolled, [], "a deleted commander serves no one: no roll");
});

/** A commanded warband at a quarter HP whose flag write rejects: it never landed, or it landed and then rejected (v14 runs _onUpdate after applying). */
async function routWithRejectedWrite(landed) {
  const id = landed ? "landed" : "never";           // the hook keeps each uuid's last HP
  const stored = { commander: "Actor.pc", upgrades: [] };
  const band = {
    id, uuid: `Actor.${id}`, type: TYPE, name: id, system: { attributes: { hp: { value: 5, max: 20 } } },
    flags: { "shadowdark-enhancer": { warband: stored } }, defeated: 0,
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async update(data) {
      if (landed) this.flags["shadowdark-enhancer"].warband = Object.values(data)[0].value;
      throw new Error("vetoed after save");
    },
    async _setDefeated() { this.defeated++; },
  };
  globalThis.fromUuid = async () => ({ system: { abilities: { cha: { mod: 0 } } } });
  globalThis.game.combats = [{ active: true, combatants: [{ actorId: id }] }];
  const logged = console.error;
  console.error = () => {};
  rollTotal = 1;                                   // morale fails, and so does the rout stand
  try {
    hooks.get("updateActor")(band, { system: { attributes: { hp: { value: 5 } } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally { console.error = logged; rollTotal = 20; }
  return band;
}

test("a rout whose flag write is rejected still marks the warband defeated (#285 review)", async () => {
  const landed = await routWithRejectedWrite(true);
  assert.equal(landed.flags["shadowdark-enhancer"].warband.routed, true, "landed then rejected: the flag is stored");
  assert.equal(landed.defeated, 1, "and the warband is defeated, not left on the strip");
  const never = await routWithRejectedWrite(false);
  assert.equal(never.flags["shadowdark-enhancer"].warband.routed, undefined, "never landed: nothing stored");
  assert.equal(never.defeated, 1, "defeated all the same; a later hit re-checks and writes the flag again");
});
