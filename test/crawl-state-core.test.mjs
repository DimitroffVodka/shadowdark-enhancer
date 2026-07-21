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
  clearOocInitiative,
} from "../scripts/crawl-strip/crawl-state-core.mjs";

// ── defaults / normalization ────────────────────────────────────────────────

test("defaultCrawlState is versioned and empty", () => {
  assert.deepEqual(defaultCrawlState(), {
    _v: STATE_VERSION, mode: "off", crawlTurn: 0, oocInitiative: {}, members: [], priorMode: "off",
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
  assert.deepEqual(Object.keys(out).sort(), ["_v", "crawlTurn", "members", "mode", "oocInitiative", "priorMode"]);
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

test("endCrawl resets turn/members/oocInitiative and is a no-op during combat", () => {
  const state = {
    _v: STATE_VERSION, mode: "crawl", crawlTurn: 4,
    oocInitiative: { t1: { init: 9 } }, members: ["a", "b"],
  };
  const r = endCrawl(state);
  assert.equal(r.changed, true);
  assert.deepEqual(r.state, { _v: STATE_VERSION, mode: "off", crawlTurn: 0, oocInitiative: {}, members: [] });

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
