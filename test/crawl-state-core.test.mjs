import test from "node:test";
import assert from "node:assert/strict";
import {
  STATE_VERSION,
  defaultCrawlState,
  normalizeCrawlState,
  enterCombatMode,
  exitCombatMode,
  startCrawl,
  endCrawl,
  addMembers,
  removeMember,
  clearMembers,
  nextCrawlTurn,
  setOocInitiative,
  ensureOocTurn,
  advanceOocTurn,
  clearOocInitiative,
  hasOocRoll,
  oocOrderComplete,
} from "../scripts/crawl-strip/crawl-state-core.mjs";

// ── defaults / normalization ────────────────────────────────────────────────

test("defaultCrawlState is versioned and empty", () => {
  assert.deepEqual(defaultCrawlState(), {
    _v: STATE_VERSION, mode: "off", crawlTurn: 0, oocInitiative: {}, oocTurn: null, members: [], priorMode: "off",
  });
});

test("normalizeCrawlState: missing _v (legacy pre-version setting) normalizes to v1", () => {
  const legacy = { mode: "crawl", crawlTurn: 2, oocInitiative: {}, members: ["t1"] };
  assert.equal(legacy._v, undefined);
  const out = normalizeCrawlState(legacy);
  assert.equal(out._v, STATE_VERSION);
  assert.equal(out.mode, "crawl");
  assert.equal(out.crawlTurn, 2);
  assert.deepEqual(out.members, ["t1"]);
});

test("normalizeCrawlState: null/undefined/non-object → default state", () => {
  assert.deepEqual(normalizeCrawlState(null), defaultCrawlState());
  assert.deepEqual(normalizeCrawlState(undefined), defaultCrawlState());
  assert.deepEqual(normalizeCrawlState("garbage"), defaultCrawlState());
  assert.deepEqual(normalizeCrawlState(42), defaultCrawlState());
  assert.deepEqual(normalizeCrawlState([1, 2, 3]), defaultCrawlState());
});

test("normalizeCrawlState: malformed mode falls back to off", () => {
  const out = normalizeCrawlState({ mode: "haunted", crawlTurn: 1, members: [] });
  assert.equal(out.mode, "off");
});

test("normalizeCrawlState: negative/NaN/non-numeric crawlTurn falls back to 0", () => {
  assert.equal(normalizeCrawlState({ crawlTurn: -5 }).crawlTurn, 0);
  assert.equal(normalizeCrawlState({ crawlTurn: NaN }).crawlTurn, 0);
  assert.equal(normalizeCrawlState({ crawlTurn: "not a number" }).crawlTurn, 0);
  assert.equal(normalizeCrawlState({ crawlTurn: 3.9 }).crawlTurn, 3); // truncates
});

test("normalizeCrawlState: oocInitiative must be a plain object, not array", () => {
  assert.deepEqual(normalizeCrawlState({ oocInitiative: ["not", "an", "object"] }).oocInitiative, {});
  assert.deepEqual(normalizeCrawlState({ oocInitiative: null }).oocInitiative, {});
  assert.deepEqual(normalizeCrawlState({ oocInitiative: { t1: { init: 5 } } }).oocInitiative, { t1: { init: 5 } });
});

test("normalizeCrawlState: members dedupes and drops non-string/empty entries", () => {
  const out = normalizeCrawlState({ members: ["a", "b", "a", "", null, 42, "c"] });
  assert.deepEqual(out.members, ["a", "b", "c"]);
});

test("normalizeCrawlState: extra/unknown fields are stripped", () => {
  const out = normalizeCrawlState({ mode: "crawl", evil: "payload", __proto__: { hacked: true } });
  assert.deepEqual(Object.keys(out).sort(), ["_v", "crawlTurn", "members", "mode", "oocInitiative", "oocTurn", "priorMode"]);
  assert.equal(out.evil, undefined);
});

test("normalizeCrawlState is idempotent", () => {
  const messy = { mode: "combat", crawlTurn: "7", oocInitiative: { a: 1 }, members: ["x", "x", "y"], junk: true };
  const once = normalizeCrawlState(messy);
  const twice = normalizeCrawlState(once);
  assert.deepEqual(once, twice);
});

// ── off → crawl → combat → prior-mode restoration ───────────────────────────

test("mode lifecycle: off → crawl → combat → restores prior mode (crawl) on exit", () => {
  let state = defaultCrawlState();
  assert.equal(state.mode, "off");

  const started = startCrawl(state);
  assert.equal(started.changed, true);
  state = started.state;
  assert.equal(state.mode, "crawl");

  const entered = enterCombatMode(state);
  assert.equal(entered.changed, true);
  state = entered.state;
  assert.equal(state.mode, "combat");
  assert.equal(state.priorMode, "crawl");

  const exited = exitCombatMode(state);
  assert.equal(exited.changed, true);
  state = exited.state;
  assert.equal(state.mode, "crawl"); // restored, not reset to off
  assert.equal(state.priorMode, "off"); // consumed after restoration
});

test("mode lifecycle: off → combat → restores off (no prior crawl)", () => {
  const state = defaultCrawlState();
  const entered = enterCombatMode(state);
  assert.equal(entered.state.priorMode, "off");
  const exited = exitCombatMode(entered.state);
  assert.equal(exited.state.mode, "off");
  assert.equal(exited.state.priorMode, "off");
});

test("enterCombatMode is a no-op when already in combat", () => {
  const state = { ...defaultCrawlState(), mode: "combat" };
  const r = enterCombatMode(state);
  assert.equal(r.changed, false);
  assert.equal(r.state, state); // same reference, no new object
});

test("exitCombatMode is a no-op when not in combat", () => {
  const state = { ...defaultCrawlState(), mode: "crawl" };
  const r = exitCombatMode(state, "off");
  assert.equal(r.changed, false);
  assert.equal(r.state, state);
});

test("startCrawl is a no-op during combat", () => {
  const state = { ...defaultCrawlState(), mode: "combat" };
  const r = startCrawl(state);
  assert.equal(r.changed, false);
  assert.equal(r.state.mode, "combat");
});

// ── crawl start/end reset semantics ─────────────────────────────────────────

test("startCrawl clears leftover OoC initiative from a prior session", () => {
  const state = { ...defaultCrawlState(), mode: "off", oocInitiative: { t1: { init: 12 } } };
  const r = startCrawl(state);
  assert.equal(r.state.mode, "crawl");
  assert.deepEqual(r.state.oocInitiative, {});
});

test("endCrawl resets turn/members/oocInitiative/oocTurn and is a no-op during combat", () => {
  const state = {
    _v: STATE_VERSION, mode: "crawl", crawlTurn: 4,
    oocInitiative: { t1: { init: 9 } }, oocTurn: "t1", members: ["a", "b"],
  };
  const r = endCrawl(state);
  assert.equal(r.changed, true);
  assert.deepEqual(r.state, { _v: STATE_VERSION, mode: "off", crawlTurn: 0, oocInitiative: {}, oocTurn: null, members: [] });

  const combatState = { ...state, mode: "combat" };
  const noop = endCrawl(combatState);
  assert.equal(noop.changed, false);
  assert.equal(noop.state, combatState);
});

// ── member add/remove/clear idempotency and invalid IDs ─────────────────────

test("addMembers is idempotent and skips invalid IDs", () => {
  const state = defaultCrawlState();
  const r1 = addMembers(state, ["a", "b", "a", "", null, undefined, "b"]);
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.state.members, ["a", "b"]);
  assert.deepEqual(r1.newIds, ["a", "b"]);

  // Re-adding the same members is a no-op.
  const r2 = addMembers(r1.state, ["a", "b"]);
  assert.equal(r2.changed, false);
  assert.deepEqual(r2.newIds, []);
  assert.equal(r2.state, r1.state);
});

test("addMembers with a non-array or empty input is a no-op", () => {
  const state = defaultCrawlState();
  assert.equal(addMembers(state, null).changed, false);
  assert.equal(addMembers(state, undefined).changed, false);
  assert.equal(addMembers(state, []).changed, false);
  assert.equal(addMembers(state, "not-an-array").changed, false);
});

test("removeMember is idempotent — removing a non-member is a no-op", () => {
  const state = { ...defaultCrawlState(), members: ["a", "b"] };
  const r1 = removeMember(state, "a");
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.state.members, ["b"]);

  const r2 = removeMember(r1.state, "a"); // already gone
  assert.equal(r2.changed, false);
  assert.equal(r2.state, r1.state);

  const r3 = removeMember(state, "nonexistent-id");
  assert.equal(r3.changed, false);
});

test("clearMembers is idempotent", () => {
  const state = { ...defaultCrawlState(), members: ["a", "b"] };
  const r1 = clearMembers(state);
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.state.members, []);

  const r2 = clearMembers(r1.state);
  assert.equal(r2.changed, false);
  assert.equal(r2.state, r1.state);
});

test("clearMembers clears the pointer too — re-adding members starts a fresh order", () => {
  const state = orderedState({ oocTurn: "A" });
  const cleared = clearMembers(state);
  assert.equal(cleared.changed, true);
  assert.deepEqual(cleared.state.members, []);
  assert.equal(cleared.state.oocTurn, null, "the pointer goes with the roster");

  // Re-adding the same actors must NOT resurrect the old order with the
  // stale pointer: a fresh roll starts a fresh order at the new top.
  const reAdded = addMembers(cleared.state, ["A", "B"]);
  const rolled = setOocInitiative(reAdded.state, "B", { roll: 99 });
  assert.equal(rolled.state.oocTurn, "B", "the old pointer did not survive the clear");
});

// ── OoC initiative set/clear ─────────────────────────────────────────────────

test("setOocInitiative merges without clobbering other entries", () => {
  const state = { ...defaultCrawlState(), oocInitiative: { t1: { init: 3 } } };
  const r = setOocInitiative(state, "t2", { init: 8 });
  assert.equal(r.changed, true);
  assert.deepEqual(r.state.oocInitiative, { t1: { init: 3 }, t2: { init: 8 } });
});

test("setOocInitiative overwrites an existing entry for the same token", () => {
  const state = { ...defaultCrawlState(), oocInitiative: { t1: { init: 3 } } };
  const r = setOocInitiative(state, "t1", { init: 99 });
  assert.deepEqual(r.state.oocInitiative, { t1: { init: 99 } });
});

test("clearOocInitiative is idempotent", () => {
  const state = { ...defaultCrawlState(), oocInitiative: { t1: { init: 3 } } };
  const r1 = clearOocInitiative(state);
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.state.oocInitiative, {});

  const r2 = clearOocInitiative(r1.state);
  assert.equal(r2.changed, false);
  assert.equal(r2.state, r1.state);
});

// ── crawl turn ────────────────────────────────────────────────────────────

test("nextCrawlTurn only advances in crawl mode", () => {
  const crawling = { ...defaultCrawlState(), mode: "crawl", crawlTurn: 2 };
  const r = nextCrawlTurn(crawling);
  assert.equal(r.changed, true);
  assert.equal(r.state.crawlTurn, 3);

  const off = { ...defaultCrawlState(), mode: "off", crawlTurn: 2 };
  const noop = nextCrawlTurn(off);
  assert.equal(noop.changed, false);
  assert.equal(noop.state.crawlTurn, 2);
});

// ── OoC turn pointer (issue #14 part 2) ─────────────────────────────────────
//
// Helper: a crawl-mode state with a two-member rolled order (A beats B).
function orderedState({ members = ["A", "B"], oocTurn = null, rolls = { A: { roll: 10 }, B: { roll: 5 } }, mode = "crawl" } = {}) {
  return { ...defaultCrawlState(), mode, members, oocInitiative: rolls, oocTurn };
}

test("normalizeCrawlState: a valid v2 oocTurn is kept, invalid ones normalize to null", () => {
  const base = { mode: "crawl", members: ["A", "B"], oocInitiative: { A: { roll: 10 }, B: { roll: 5 } } };
  assert.equal(normalizeCrawlState({ ...base, oocTurn: "A" }).oocTurn, "A");
  assert.equal(normalizeCrawlState({ ...base, oocTurn: "B" }).oocTurn, "B");
  assert.equal(normalizeCrawlState({ ...base, oocTurn: "ghost" }).oocTurn, null, "non-member holder is dropped");
  assert.equal(normalizeCrawlState({ ...base, oocTurn: "C" }).oocTurn, null);
  assert.equal(normalizeCrawlState({ ...base, oocTurn: 42 }).oocTurn, null, "non-string holder is dropped");
  assert.equal(normalizeCrawlState({ ...base, oocTurn: "A", oocInitiative: {} }).oocTurn, null, "holder without a roll is dropped");
});

test("normalizeCrawlState: a v1 state (no oocTurn field) migrates to v2 with a null pointer", () => {
  const v1 = { _v: 1, mode: "crawl", crawlTurn: 0, oocInitiative: { A: { roll: 10 } }, members: ["A"], priorMode: "off" };
  const out = normalizeCrawlState(v1);
  assert.equal(out._v, STATE_VERSION);
  assert.equal(out.oocTurn, null);
  assert.deepEqual(out.members, ["A"], "the roster survives the migration");
  assert.deepEqual(out.oocInitiative, { A: { roll: 10 } }, "existing rolls survive the migration");
});

test("setOocInitiative: the first roll of a fresh order starts the turn on that member", () => {
  const state = { ...defaultCrawlState(), mode: "crawl", members: ["A"] };
  const r = setOocInitiative(state, "A", { roll: 10 });
  assert.equal(r.state.oocTurn, "A");
});

test("setOocInitiative: a roll into an order that already has a holder never steals the turn", () => {
  const state = orderedState({ oocTurn: "A" });
  const r = setOocInitiative(state, "B", { roll: 99 });
  assert.equal(r.state.oocTurn, "A", "the higher new roll does not take the turn");
  assert.deepEqual(r.state.oocInitiative.B, { roll: 99 });
});

test("setOocInitiative: an unset pointer with existing entries pins to the top of the order", () => {
  // The migration case: v1 world with rolls but no pointer; the next roll
  // establishes the turn at the true top.
  const state = orderedState({ oocTurn: null });
  const r = setOocInitiative(state, "A", { roll: 10 });
  assert.equal(r.state.oocTurn, "A", "A is the highest roller");
  const r2 = setOocInitiative(orderedState({ oocTurn: null }), "C", { roll: 1 });
  assert.equal(r2.state.oocTurn, "A", "a non-member roll cannot become the holder");
});

test("ensureOocTurn: pins the pointer to the true top when unset (roll-all batch end)", () => {
  const state = orderedState({ oocTurn: null });
  const r = ensureOocTurn(state);
  assert.equal(r.changed, true);
  assert.equal(r.state.oocTurn, "A", "the highest roller takes the turn");
});

test("ensureOocTurn: no-op when a turn is already established or no order exists", () => {
  assert.equal(ensureOocTurn(orderedState({ oocTurn: "B" })).changed, false);
  const noOrder = { ...defaultCrawlState(), mode: "crawl", members: ["A"], oocInitiative: {}, oocTurn: null };
  assert.equal(ensureOocTurn(noOrder).changed, false);
});

test("advanceOocTurn: moves to the next member in rolled order", () => {
  const state = orderedState({ oocTurn: "A" }); // order: A(10), B(5)
  const r = advanceOocTurn(state);
  assert.equal(r.changed, true);
  assert.equal(r.state.oocTurn, "B");
});

test("advanceOocTurn: advancing past the last member wraps to the first", () => {
  const state = orderedState({ oocTurn: "B" });
  const r = advanceOocTurn(state);
  assert.equal(r.changed, true);
  assert.equal(r.state.oocTurn, "A", "wrap-around back to the top of the order");
});

test("advanceOocTurn: an unset pointer starts at the top of the order", () => {
  const r = advanceOocTurn(orderedState({ oocTurn: null }));
  assert.equal(r.changed, true);
  assert.equal(r.state.oocTurn, "A");
});

test("advanceOocTurn: a single-member order wraps to itself (no-op)", () => {
  const state = orderedState({ members: ["A"], oocTurn: "A" });
  const r = advanceOocTurn(state);
  assert.equal(r.changed, false);
  assert.equal(r.state.oocTurn, "A");
});

test("advanceOocTurn: no-op outside crawl mode or with no order", () => {
  assert.equal(advanceOocTurn(orderedState({ mode: "off", oocTurn: "A" })).changed, false);
  const noOrder = { ...defaultCrawlState(), mode: "crawl", members: ["A"], oocInitiative: {}, oocTurn: null };
  assert.equal(advanceOocTurn(noOrder).changed, false);
});

test("removeMember: a departing holder passes the turn to the next member in order", () => {
  // order: A(10), B(5). A holds and leaves → the turn passes to B.
  const state = orderedState({ members: ["A", "B", "C"], rolls: { A: { roll: 10 }, B: { roll: 5 }, C: { roll: 1 } }, oocTurn: "A" });
  const r = removeMember(state, "A");
  assert.equal(r.state.oocTurn, "B", "the next-in-order member takes the turn");
  assert.deepEqual(r.state.members, ["B", "C"]);
  assert.deepEqual(r.state.oocInitiative, { B: { roll: 5 }, C: { roll: 1 } }, "the departed holder's roll is dropped");
});

test("removeMember: a departing LAST-in-order holder wraps the turn to the front", () => {
  // order: A(10), B(5). B (last) holds and leaves → wrap to A.
  const state = orderedState({ members: ["A", "B"], oocTurn: "B" });
  const r = removeMember(state, "B");
  assert.equal(r.state.oocTurn, "A", "wrap-around to the front of the order");
});

test("removeMember: the last remaining holder leaving clears the pointer — never stranded", () => {
  const state = orderedState({ members: ["A"], rolls: { A: { roll: 10 } }, oocTurn: "A" });
  const r = removeMember(state, "A");
  assert.equal(r.state.oocTurn, null, "nobody remains to hold the turn");
  assert.deepEqual(r.state.members, []);
  assert.deepEqual(r.state.oocInitiative, {}, "no lingering rolls either");
});

test("removeMember: a non-holder's departure drops their lingering roll", () => {
  const state = orderedState({ members: ["A", "B"], oocTurn: "A" });
  const r = removeMember(state, "B");
  assert.deepEqual(r.state.oocInitiative, { A: { roll: 10 } }, "B's roll does not accumulate in persisted state");
  assert.deepEqual(r.state.members, ["A"]);
  assert.equal(r.state.oocTurn, "A");
});

test("hasOocRoll: only a real roll value counts", () => {
  const init = { A: { roll: 10 }, B: {}, C: { roll: 0 } };
  assert.equal(hasOocRoll(init, "A"), true);
  assert.equal(hasOocRoll(init, "B"), false, "an entry without a roll value does not count");
  assert.equal(hasOocRoll(init, "C"), true, "roll 0 is still a roll");
  assert.equal(hasOocRoll(init, "ghost"), false);
  assert.equal(hasOocRoll(undefined, "A"), false);
});

test("oocOrderComplete: complete only when EVERY member has rolled", () => {
  const complete = { members: ["A", "B"], oocInitiative: { A: { roll: 10 }, B: { roll: 5 } } };
  assert.equal(oocOrderComplete(complete), true);
  assert.equal(oocOrderComplete({ members: ["A", "B"], oocInitiative: { A: { roll: 10 } } }), false, "B has not rolled");
  assert.equal(oocOrderComplete({ members: ["A"], oocInitiative: { A: { roll: 10 }, X: { roll: 99 } } }), true, "non-member rolls are irrelevant");
  assert.equal(oocOrderComplete({ members: [], oocInitiative: {} }), false, "an empty roster is not an order");
  assert.equal(oocOrderComplete({ members: ["A"], oocInitiative: { A: {} } }), false, "an entry without a roll value");
  assert.equal(oocOrderComplete(undefined), false);
});

test("removeMember: removing a non-holder leaves the pointer untouched", () => {
  const state = orderedState({ members: ["A", "B"], oocTurn: "A" });
  const r = removeMember(state, "B");
  assert.equal(r.state.oocTurn, "A");
  assert.deepEqual(r.state.members, ["A"]);
});

test("clearOocInitiative clears the turn pointer too", () => {
  const state = orderedState({ oocTurn: "A" });
  const r = clearOocInitiative(state);
  assert.equal(r.changed, true);
  assert.deepEqual(r.state.oocInitiative, {});
  assert.equal(r.state.oocTurn, null);
});

test("startCrawl clears a leftover OoC order AND its pointer", () => {
  const state = orderedState({ oocTurn: "A" });
  const r = startCrawl(state);
  assert.equal(r.state.mode, "crawl");
  assert.deepEqual(r.state.oocInitiative, {});
  assert.equal(r.state.oocTurn, null);
});
