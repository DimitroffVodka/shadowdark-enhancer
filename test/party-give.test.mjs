/** A player can give a party item (a gem) to a character: the GM's client moves it, after checking the sender owns the party. */
import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
globalThis._replace = (v) => v;
globalThis.Hooks = { on() {}, once() {}, callAll() {} };

function world() {
  const created = [], deleted = [];
  const pc = { uuid: "Actor.pc", type: "Player", name: "Elan", createEmbeddedDocuments: async (_t, docs) => { created.push(...docs); } };
  const other = { uuid: "Actor.other", type: "Player", name: "Stranger" };
  const gem = { id: "g1", name: "Ruby", toObject: () => ({ _id: "g1", name: "Ruby", type: "Gem" }), delete: async () => { deleted.push("g1"); } };
  const party = { id: "p", type: "NPC", flags: { [MOD]: { party: true, partyData: { members: ["Actor.pc"] } } }, items: { get: (id) => (id === "g1" ? gem : null) }, testUserPermission: (user) => user.id === "owner" };
  globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, actors: { get: (id) => (id === "p" ? party : null) }, user: { id: "gm", isGM: true } };   // the GM's client runs the handler
  globalThis.fromUuidSync = (uuid) => ({ "Actor.pc": pc, "Actor.other": other })[uuid] ?? null;
  return { created, deleted };
}

test("an owner's give moves the gem onto a party member", async () => {
  const { created, deleted } = world();
  const { handleGiveQuery } = await import("../scripts/party/party-give.mjs");
  const reply = await handleGiveQuery({ partyId: "p", itemId: "g1", uuid: "Actor.pc" }, { id: "owner", isGM: false });
  assert.equal(reply.ok, true);
  assert.deepEqual(created, [{ name: "Ruby", type: "Gem" }], "the copy carries no _id");
  assert.deepEqual(deleted, ["g1"]);
});

test("a player who does not own the party, or a target outside it, moves nothing", async () => {
  const { created, deleted } = world();
  const { handleGiveQuery } = await import("../scripts/party/party-give.mjs");
  assert.equal((await handleGiveQuery({ partyId: "p", itemId: "g1", uuid: "Actor.pc" }, { id: "viewer", isGM: false })).ok, false);
  assert.equal((await handleGiveQuery({ partyId: "p", itemId: "g1", uuid: "Actor.other" }, { id: "owner", isGM: false })).ok, false);
  assert.equal((await handleGiveQuery({ partyId: "p", itemId: "nope", uuid: "Actor.pc" }, { id: "owner", isGM: false })).ok, false);
  assert.deepEqual([created, deleted], [[], []]);
});
