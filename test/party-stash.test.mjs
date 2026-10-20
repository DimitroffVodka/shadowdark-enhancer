import test from "node:test";
import assert from "node:assert/strict";

// The stash's slot rules are pure; the reconcile is driven against a stub world with the module's own Party.
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
const { stashCapacity, donationLimit, planDonation, normalizeDonations } = await import("../scripts/party/party-stash-core.mjs");
const { mountLoad, RIDER_SLOTS } = await import("../scripts/actors/mount-load.mjs");
const { reconcileAllPartyStashes } = await import("../scripts/party/party-stash.mjs");
const MOD = "shadowdark-enhancer";

test("free mode keeps the party's own allowance; donated mode is exactly what members reserve", () => {
  assert.equal(stashCapacity({ mode: "free" }), 10);
  assert.equal(stashCapacity({ mode: "free", legacyMax: 14 }), 14);
  assert.equal(stashCapacity({ mode: "donated", donations: { a: 3, b: 2 } }), 5);
  assert.deepEqual(normalizeDonations({ a: 2.7, gone: 4, b: 0 }, ["a", "b"]), { a: 2 }, "whole slots, current members only");
});

test("a member may reserve only the room they have, counting their current reservation as free", () => {
  assert.equal(donationLimit({ max: 10, used: 7, stash: 3 }), 6);
  assert.equal(donationLimit({ max: 10, used: 12, stash: 0 }), 0);
});

test("a donation is capped at the member's room, and a cut that would strand the party's items is refused", () => {
  const ok = planDonation({ donations: { a: 2 }, memberId: "b", requested: 9, limit: 4, partyUsed: 3 });
  assert.deepEqual([ok.ok, ok.value, ok.capacity], [true, 4, 6]);
  const cut = planDonation({ donations: { a: 2, b: 4 }, memberId: "b", requested: 0, limit: 4, partyUsed: 5 });
  assert.equal(cut.ok, false);
  assert.equal(cut.reason, "SDE.party.stash.refuse.inUse");
  assert.equal(planDonation({ donations: {}, memberId: "a", requested: 1, limit: 1, mode: "free" }).ok, false);
});

test("a mount carries its gear, 10 slots per rider and what it donated, against 5 x STR (+5 Sturdy, +15 wagon)", () => {
  const mount = { flags: { [MOD]: { mount: { properties: { sturdy: true } }, occupants: ["Actor.r", "Actor.r"] } },
    system: { abilities: { str: { mod: 3 } } },
    items: { contents: [{ id: "i", type: "Basic", name: "Rope", system: { quantity: 1, slots: { per_slot: 1, slots_used: 2 } } }, { id: "s", type: "Spell", name: "x", system: {} }] } };
  const load = mountLoad(mount, { reserved: 2 });
  assert.deepEqual([load.max, load.used, load.riderSlots, load.load, load.free, load.over], [20, 2, RIDER_SLOTS, 14, 6, false], "one rider, counted once");
});

test("the start-up tidy-up skips the system's own Party actor and still cleans the next party's stale stash item", async () => {
  const sys = { id: "sys", uuid: "Actor.sys", type: "Party", name: "System party", flags: {}, items: { contents: [] }, testUserPermission: () => true };
  const native = { id: "p", uuid: "Actor.p", type: "NPC", name: "Party", flags: { [MOD]: { party: true, partyData: { members: [] }, partyStash: {} } }, items: { contents: [] }, testUserPermission: () => true };
  const filler = { flags: { [MOD]: { partyStash: true, partyStashParty: "Actor.p" } }, deleted: 0, async delete() { this.deleted += 1; } };
  const pc = { id: "pc", uuid: "Actor.pc", type: "Player", flags: {}, items: { contents: [filler], find: (f) => [filler].find(f) }, testUserPermission: () => true };
  const saved = globalThis.game;
  globalThis.game = { user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } }, actors: { contents: [sys, native, pc], get: (id) => [sys, native, pc].find((a) => a.id === id) },
    settings: { get: () => "donated" }, i18n: { localize: (k) => k, format: (k) => k } };
  try {
    await reconcileAllPartyStashes();
    assert.equal(filler.deleted, 1, "the stash item with no reservation behind it is removed");
  } finally {
    if (saved === undefined) delete globalThis.game; else globalThis.game = saved;
  }
});
