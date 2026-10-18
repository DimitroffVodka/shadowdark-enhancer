// The Quest Log's clock: when it acts, on whom, and in what order. Quests here are invented.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { gregorian } from "./gregorian-calendar.mjs";

const M = "shadowdark-enhancer";
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === "prototype" ? t.prototype : stub()), construct: () => ({}), apply: () => stub() });
const known = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: {} } },
  utils: { randomID: () => "id", debounce: (fn) => fn, escapeHTML: (s) => String(s) },
};
const withStubs = (o) => new Proxy(o, { get: (t, k) => (t[k] === undefined ? stub() : t[k]?.constructor === Object ? withStubs(t[k]) : t[k]) });
globalThis.foundry = withStubs(known);
globalThis._replace = (v) => v;
const handlers = { on: [], once: [] };
globalThis.Hooks = { on: (n, f) => handlers.on.push([n, f]), once: (n, f) => handlers.once.push([n, f]), callAll() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 }, SORT_INTEGER_DENSITY: 100000 };
const DAY = 86400;
const world = { isGM: true, activeGM: true, now: 20 * DAY };
globalThis.game = {
  get user() { return { id: "gm1", isGM: world.isGM }; },
  get users() { return { activeGM: { id: world.activeGM ? "gm1" : "other" } }; },
  time: { get worldTime() { return world.now; }, calendar: gregorian },
  i18n: { localize: (k) => k, format: (k) => k }, settings: { get: () => true, register() {} }, journal: { find: () => null },
};

const { Quests } = await import("../scripts/quests/quests.mjs");
const { registerQuestClock, runQuestClock } = await import("../scripts/quests/quest-clock.mjs");
const { normalizeQuest } = await import("../scripts/quests/quest-core.mjs");

const calls = [];
let list = [];
let failFor = null;
const flush = () => new Promise((r) => setTimeout(r, 10));
const q = (id, over) => ({ ...normalizeQuest(over), id });

beforeEach(() => {
  calls.length = 0; handlers.on.length = 0; handlers.once.length = 0;
  Object.assign(world, { isGM: true, activeGM: true, now: 20 * DAY });
  failFor = null;
  list = [q("rev", { status: "hidden", startsAt: 10 * DAY }), q("fail", { status: "active", deadline: 10 * DAY, autoFail: true })];
  Quests.list = () => list;
  Quests.setStatus = async (id, status) => { calls.push(["setStatus", id, status]); if (id === failFor) throw new Error("boom"); return { id, status }; };
  Quests.update = async (id, patch) => { calls.push(["update", id, patch]); return { id }; };
});

test("status moves first, the clearing update second, quest by quest", async () => {
  await runQuestClock();
  assert.deepEqual(calls, [
    ["setStatus", "rev", "available"], ["update", "rev", { startsAt: null }],
    ["setStatus", "fail", "failed"], ["update", "fail", { autoFail: false }],
  ]);
});

test("a quest that fails to move keeps its date and does not stop the others", async () => {
  failFor = "rev";
  const errors = console.error; console.error = () => {};
  try { await runQuestClock(); } finally { console.error = errors; }
  assert.deepEqual(calls, [["setStatus", "rev", "available"], ["setStatus", "fail", "failed"], ["update", "fail", { autoFail: false }]]);
});

test("a status change that did not take (setStatus returned nothing) is not cleared", async () => {
  Quests.setStatus = async (id, status) => { calls.push(["setStatus", id, status]); return null; };
  await runQuestClock();
  assert.ok(!calls.some((c) => c[0] === "update"));
});

test("a clear-only change (stale autoFail on a Failed quest) skips setStatus and just clears", async () => {
  list = [q("stale", { status: "failed", deadline: 10 * DAY, autoFail: true }), q("open", { status: "active", deadline: 10 * DAY, autoFail: false })];
  await runQuestClock();
  assert.deepEqual(calls, [["update", "stale", { autoFail: false }]]);
});

test("nothing happens off the active GM", async () => {
  world.activeGM = false; await runQuestClock();
  world.activeGM = true; world.isGM = false; await runQuestClock();
  assert.deepEqual(calls, []);
});

test("the hook acts only when a midnight was crossed, and load acts once", async () => {
  registerQuestClock();
  const timeHook = handlers.on.find(([n]) => n === `${M}.timeAdvanced`)[1];
  timeHook({ crossed: { days: 0 } }); timeHook({}); timeHook(undefined);
  await flush();
  assert.deepEqual(calls, [], "same-day moves do nothing");
  timeHook({ crossed: { days: 1 } });
  await flush();
  assert.equal(calls.filter((c) => c[0] === "setStatus").length, 2);
  calls.length = 0;
  handlers.once.find(([n]) => n === "ready")[1]();
  await flush();
  assert.equal(calls.filter((c) => c[0] === "setStatus").length, 2, "ready runs the check");
});

test("an edit or questsChanged never triggers it: only the clock and ready are subscribed", () => {
  registerQuestClock();
  assert.deepEqual(handlers.on.map(([n]) => n), [`${M}.timeAdvanced`]);
  assert.deepEqual(handlers.once.map(([n]) => n), ["ready"]);
});
