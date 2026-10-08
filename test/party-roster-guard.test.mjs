/**
 * The party roster rule (mayAdd: a player adds only an actor they own) held only on the player's client, so the
 * party's owner could write any actor into the roster and every GM-run flow trusted it. The active GM now re-checks
 * a roster a player writes (party.mjs registerPartyRosterGuard).
 */
import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
const GM = { id: "gm", isGM: true }, P1 = { id: "p1", isGM: false }, P2 = { id: "p2", isGM: false };
const hooks = new Map();
globalThis.Hooks = { on: (n, fn) => hooks.set(n, fn), once: (n, fn) => hooks.set(n, fn) };
globalThis._replace = (v) => v;

const actor = (id, type, ownerIds) => ({ id, uuid: `Actor.${id}`, type, system: { isPC: type === "Player" }, flags: {},
  testUserPermission: (u, p) => u.isGM || (p === "OWNER" ? ownerIds.includes(u.id) : true) });
const mine = actor("mine", "Player", ["p1"]), theirs = actor("theirs", "Player", ["p2"]), boss = actor("boss", "NPC", []);
const party = actor("party", "NPC", ["p1"]);
const writes = [];
party.flags = { [MOD]: { party: true, partyData: { members: ["Actor.theirs"] } } };
party.update = async (changes) => { writes.push(changes); party.flags[MOD].partyData = changes[`flags.${MOD}.partyData`]; };
// An Extras party not yet adopted: its roster is still Extras' `members` flag (actor ids).
const EX = "shadowdark-extras";
const old = actor("old", "NPC", ["p1"]);
old.flags = { [EX]: { isParty: true, members: ["mine"] } };
old.update = async (changes) => { writes.push(changes); old.flags[EX].members = changes[`flags.${EX}.members`]; };
globalThis.game = {
  user: GM, users: Object.assign([GM, P1, P2], { activeGM: GM, get: (id) => [GM, P1, P2].find((u) => u.id === id) }),
  actors: { contents: [mine, theirs, boss, party, old], get: (id) => [mine, theirs, boss, party, old].find((a) => a.id === id) },
};

const { registerPartyRosterGuard, Party } = await import("../scripts/party/party.mjs");
registerPartyRosterGuard();
hooks.get("ready")();   // the GM sees the roster as it stands: the other player's PC, added by the GM

const write = async (members, userId) => {
  party.flags[MOD].partyData = { ...party.flags[MOD].partyData, members };
  await hooks.get("updateActor")(party, { flags: { [MOD]: { partyData: party.flags[MOD].partyData } } }, {}, userId);
};

test("a player's own character and a member already on the roster stay", async () => {
  writes.length = 0;
  await write(["Actor.theirs", "Actor.mine"], "p1");
  assert.deepEqual(writes, []);
  assert.deepEqual(party.flags[MOD].partyData.members, ["Actor.theirs", "Actor.mine"]);
});

test("an actor the player does not own, written in by hand, is taken off again by the GM", async () => {
  writes.length = 0;
  await write(["Actor.theirs", "Actor.mine", "Actor.boss"], "p1");
  assert.equal(writes.length, 1);
  assert.deepEqual(party.flags[MOD].partyData.members, ["Actor.theirs", "Actor.mine"]);
});

test("a GM may put anyone on the roster", async () => {
  writes.length = 0;
  await write(["Actor.theirs", "Actor.mine", "Actor.boss"], "gm");
  assert.deepEqual(writes, []);
  assert.ok(party.flags[MOD].partyData.members.includes("Actor.boss"));
});

test("a legacy Extras party not yet adopted gets the same check on Extras' member list", async () => {
  writes.length = 0;
  old.flags[EX].members = ["mine", "boss"];
  await hooks.get("updateActor")(old, { flags: { [EX]: { members: old.flags[EX].members } } }, {}, "p1");
  assert.equal(writes.length, 1);
  assert.deepEqual(old.flags[EX].members, ["mine"], "the boss the player wrote in is taken off again");
  assert.deepEqual(Party.data(old).members, ["Actor.mine"], "and the flows, and a later adoption, read only the PC");
});
