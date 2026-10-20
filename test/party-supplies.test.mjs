import test from "node:test";
import assert from "node:assert/strict";

// The supplies readout counts what camping spends, so its tests build plain actors and items: a Basic item named
// Ration/Rations, and a torch is an unlit, unused, non-magical light source of the torch template.
const { partySupplies } = await import("../scripts/overland/party-supplies.mjs");

const MODULE_ID = "shadowdark-enhancer";
const torch = (quantity = 1, extra = {}) => ({
  type: "Basic", name: "Torch",
  system: { quantity, light: { isSource: true, template: "torch", active: false, hasBeenUsed: false, ...extra } },
});
const ration = (quantity = 1) => ({ type: "Basic", name: "Rations", system: { quantity } });
const actor = (uuid, items) => ({ uuid, type: "Player", items, testUserPermission: () => true });
const party = (uuid, members) => ({ uuid, type: "NPC", items: [], testUserPermission: () => true, flags: { [MODULE_ID]: { party: true, partyData: { members } } } });

const world = (...actors) => { globalThis.game = { user: { isGM: true }, actors: { contents: actors } }; return actors; };

test("the party sheet's own stacks count", () => {
  const p = party("Actor.p", []);
  p.items = [ration(3), torch(2)];
  world(p);
  assert.deepEqual(partySupplies(p), { rations: 3, torches: 2 });
});

test("every member's pack counts, and a mount's does too", () => {
  const [p, a, m] = world(
    party("Actor.p", ["Actor.a", "Actor.m"]),
    actor("Actor.a", [ration(2), torch(1)]),
    { ...actor("Actor.m", [ration(5), torch(4)]), type: "shadowdark-enhancer.mount" },
  );
  assert.deepEqual(partySupplies(p), { rations: 7, torches: 5 });
  assert.equal(a.items.length + m.items.length, 4);
});

test("a lit torch, a spent torch and a magic torch are not fresh stock", () => {
  const [p] = world(party("Actor.p", ["Actor.a"]), actor("Actor.a", [
    torch(1, { active: true }),
    torch(1, { hasBeenUsed: true }),
    { ...torch(1), system: { ...torch(1).system, magicItem: true } },
    torch(2),
  ]));
  assert.deepEqual(partySupplies(p), { rations: 0, torches: 2 });
});

test("items that are not rations or torches are left alone, and no party means no readout", () => {
  const [p] = world(party("Actor.p", ["Actor.a"]), actor("Actor.a", [
    { type: "Basic", name: "Crowbar", system: { quantity: 1 } },
    { type: "Weapon", name: "Rations", system: { quantity: 9 } },
    { type: "Basic", name: "Ration, iron", system: { quantity: 4 } },
  ]));
  assert.deepEqual(partySupplies(p), { rations: 0, torches: 0 });
  assert.equal(partySupplies(null), null);
});
