import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultOverlandState, normalizeOverlandState, startTravel, setHex, recordForage,
  pickTravelToken, forageRefusal, OVERLAND_VERSION,
} from "../scripts/overland/overland-state-core.mjs";

test("a fresh travel state has no token, no open day and walks", () => {
  const s = defaultOverlandState();
  assert.equal(s._v, OVERLAND_VERSION);
  assert.equal(s.tokenUuid, null);
  assert.equal(s.day, null);
  assert.equal(s.method, "walking");
  assert.deepEqual(s.members, []);
  assert.deepEqual(normalizeOverlandState(s), s, "normalizing is idempotent");
});

test("a malformed or legacy setting normalizes: unknown fields dropped, bad values defaulted", () => {
  const s = normalizeOverlandState({
    junk: 1, method: "flying", members: ["a", "a", "", 3, "b"], budget: -2, spent: "3",
    hex: { num: 2849, terrain: "forest", region: "Lowland Moor", features: ["river", "river"], extra: true },
    pushed: "yes", day: "dawn",
  });
  assert.equal("junk" in s, false);
  assert.equal(s.method, "walking");
  assert.deepEqual(s.members, ["a", "b"]);
  assert.equal(s.budget, 0);
  assert.equal(s.spent, 3);
  assert.equal(s.pushed, false);
  assert.equal(s.day, null);
  assert.deepEqual(s.hex, { num: 2849, terrain: "forest", region: "Lowland Moor", features: ["river"] });
  assert.deepEqual(normalizeOverlandState(null), defaultOverlandState());
  assert.deepEqual(normalizeOverlandState([1]), defaultOverlandState());
});

test("starting travel sets the token and members, and resuming keeps an open day", () => {
  const first = startTravel(defaultOverlandState(), { tokenUuid: "Scene.s.Token.t", members: ["a", "b"] });
  assert.equal(first.changed, true);
  assert.equal(first.state.tokenUuid, "Scene.s.Token.t");
  assert.deepEqual(first.state.members, ["a", "b"]);
  const midDay = { ...first.state, day: 1000, budget: 4, spent: 2, foraged: ["a"] };
  const resumed = startTravel(midDay, { tokenUuid: "Scene.s.Token.t", members: ["a", "b"] });
  assert.equal(resumed.changed, false, "the same party starting again changes nothing");
  assert.equal(resumed.state.day, 1000);
  assert.equal(resumed.state.spent, 2);
  const newToken = startTravel(midDay, { tokenUuid: "Scene.s.Token.u", members: ["a"] });
  assert.equal(newToken.state.tokenUuid, "Scene.s.Token.u");
  assert.equal(newToken.state.day, 1000, "a new travel token keeps the open day");
});

test("the travel token's hex is kept, and an equal hex is no change", () => {
  const hex = { num: 353, terrain: "grassland", region: "Duchy of Montmar", features: ["coast"] };
  const a = setHex(defaultOverlandState(), hex);
  assert.equal(a.changed, true);
  assert.deepEqual(a.state.hex, hex);
  assert.equal(setHex(a.state, { ...hex }).changed, false);
  assert.equal(setHex(a.state, null).state.hex, null);
});

test("a member forages once a day", () => {
  const s = { ...defaultOverlandState(), members: ["a"] };
  const once = recordForage(s, "a");
  assert.equal(once.changed, true);
  assert.deepEqual(once.state.foraged, ["a"]);
  assert.equal(recordForage(once.state, "a").changed, false);
});

test("the travel token: the one party token, else the one selected token, else the GM picks", () => {
  assert.deepEqual(pickTravelToken({ partyTokens: ["p"], controlled: ["x", "y"] }), { uuid: "p", reason: "party" });
  assert.deepEqual(pickTravelToken({ partyTokens: ["p", "q"], controlled: ["x"] }), { uuid: "x", reason: "selected" });
  assert.deepEqual(pickTravelToken({ partyTokens: [], controlled: ["x"] }), { uuid: "x", reason: "selected" });
  assert.deepEqual(pickTravelToken({ partyTokens: [], controlled: [] }), { uuid: null, reason: "pick" });
  assert.deepEqual(pickTravelToken({ partyTokens: [], controlled: ["x", "y"] }), { uuid: null, reason: "pick" });
});

test("a forage is refused when nobody travels, for a non-member, and a second time today", () => {
  assert.equal(forageRefusal({ travelling: true, member: true, foraged: false }), null);
  assert.equal(forageRefusal({ travelling: false, member: true, foraged: false }), "notTravelling");
  assert.equal(forageRefusal({ travelling: true, member: false, foraged: false }), "notMember");
  assert.equal(forageRefusal({ travelling: true, member: true, foraged: true }), "alreadyForaged");
});
