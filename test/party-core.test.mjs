import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeParty, removeMember, mayManage, mayAdd, memberGroup, scopedQuests } from "../scripts/party/party-core.mjs";

test("roster is explicit, deduplicated and preserves missing/compendium UUIDs", () => {
  const data = normalizeParty({ version: 1, members: ["Actor.a", "Actor.a", "Actor.deleted", "Compendium.book.actors.Actor.x"], leaderUuid: "Actor.a" });
  assert.deepEqual(data.members, ["Actor.a", "Actor.deleted", "Compendium.book.actors.Actor.x"]);
  assert.equal(data.version, 1);
  assert.deepEqual(normalizeParty().members, []);
});
test("removing leader selects next member and removes only its slot", () => {
  const original = normalizeParty({ members: ["Actor.a", "Actor.b"], leaderUuid: "Actor.a", formation: { slots: [{ memberUuid: "Actor.a", col: 0, row: 0 }, { memberUuid: "Actor.b", col: 1, row: 1 }] } });
  const next = removeMember(original, "Actor.a");
  assert.equal(next.leaderUuid, "Actor.b");
  assert.deepEqual(next.formation.slots, [{ memberUuid: "Actor.b", col: 1, row: 1 }]);
  assert.equal(original.members.length, 2);
});
test("two rosters may share a PC without enrolling any other owned PC", () => {
  const a = normalizeParty({ members: ["Actor.shared"] });
  const b = normalizeParty({ members: ["Actor.shared", "Actor.b"] });
  assert.deepEqual(removeMember(a, "Actor.shared").members, []);
  assert.deepEqual(b.members, ["Actor.shared", "Actor.b"]);
});
test("owner edits; observer and non-owner cannot; adding another owner's PC refused", () => {
  assert.equal(mayManage({ isGM: false, owner: true }), true);
  assert.equal(mayManage({ owner: false, observer: true }), false);
  assert.equal(mayManage({ owner: false }), false);
  assert.equal(mayAdd({ partyOwner: true, actorOwner: false, member: false, type: "Player" }), false);
  assert.equal(mayAdd({ partyOwner: true, actorOwner: true, type: "Player" }), true);
  assert.equal(mayAdd({ partyOwner: false, actorOwner: true, type: "Player" }), false);
  assert.equal(mayAdd({ partyOwner: true, member: true, type: "Player" }), true);
});
test("groups distinguish NPC hirelings and native mounts from PCs", () => {
  assert.equal(memberGroup("Player"), "characters");
  assert.equal(memberGroup("NPC"), "hirelings");
  assert.equal(memberGroup("shadowdark-enhancer.mount"), "mounts");
  assert.equal(memberGroup("Party"), null);
});
test("visible quest summaries are party or member scoped and deduplicated by UUID", () => {
  const q = { uuid: "JournalEntry.q", party: "Actor.party", characters: ["Actor.a"] };
  assert.deepEqual(scopedQuests([q, q, { uuid: "JournalEntry.m", characters: ["Actor.a"] }, { uuid: "JournalEntry.other", party: "Actor.other", characters: [] }], "Actor.party", ["Actor.a"]), [q, { uuid: "JournalEntry.m", characters: ["Actor.a"] }]);
});
test("future roster versions and malformed saved values are unknown, not empty", () => {
  assert.throws(() => normalizeParty({ version: 2, members: [] }));
  assert.throws(() => normalizeParty({ version: 1, members: "broken" }));
});
