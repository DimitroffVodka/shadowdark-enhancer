import test from "node:test";
import assert from "node:assert/strict";

// Taunt expires on the turn that just ended. On a Chaos round that held its turn
// events, Foundry 14.369 leaves Combat#previous a turn behind, so the hold's own
// record of the old round's last turn has to be the one read.
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
Object.assign(globalThis, {
  foundry: deep, CONFIG: {}, Hooks: { on() {}, once() {} }, ui: {},
  game: { user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } }, settings: { get: () => true } },
});
const { Taunt } = await import("../scripts/taunt/taunt.mjs");
const { turnSeq } = await import("../scripts/taunt/taunt-core.mjs");

const MOD = "shadowdark-enhancer";
const holder = (cleared) => ({
  flags: { [MOD]: { taunt: { combatId: "c1", armedAt: turnSeq({ round: 1, turn: 0 }) } } },
  unsetFlag: async () => { cleared.push(true); },
});
const combatOf = (actors, previous) => ({
  id: "c1", previous, combatants: { get: (id) => ({ actor: actors[id] }) },
});

test("a taunt held by the last combatant ends with their turn, even though a held Chaos round left Combat#previous a turn behind", async () => {
  const cleared = [];
  const combat = combatOf({ Ana: {}, Cy: holder(cleared) }, { round: 1, turn: 1, combatantId: "Ana" });
  const options = { [MOD]: { chaosHeld: true, previous: { round: 1, turn: 2, combatantId: "Cy" } } };
  await Taunt._onTurnChange(combat, { round: 2, turn: 0 }, options);
  assert.equal(cleared.length, 1);
});

test("an update that was not held reads Combat#previous, as before", async () => {
  const cleared = [];
  const combat = combatOf({ Cy: holder(cleared) }, { round: 1, turn: 2, combatantId: "Cy" });
  await Taunt._onTurnChange(combat, { round: 2, turn: 0 }, { direction: 1 });
  assert.equal(cleared.length, 1);
});

test("a held round does not end the taunt of the combatant whose turn ended earlier", async () => {
  const cleared = [];
  const combat = combatOf({ Ana: holder(cleared), Cy: {} }, { round: 1, turn: 0, combatantId: "Ana" });
  const options = { [MOD]: { chaosHeld: true, previous: { round: 1, turn: 2, combatantId: "Cy" } } };
  await Taunt._onTurnChange(combat, { round: 2, turn: 0 }, options);
  assert.equal(cleared.length, 0);
});
