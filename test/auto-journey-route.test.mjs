// The automatic journey's walk (route.mjs) offline: its imports point at test/route-stubs.mjs, all but the pure
// overland-state-core.mjs. One walk per tab, a closed destination, ground that never opens, the stop notices.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const stubs = new URL("./route-stubs.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("/scripts/overland/route.mjs") && specifier !== "./overland-state-core.mjs") return { url: stubs, shortCircuit: true };
    return next(specifier, context);
  },
});

const hooks = new Map();
const Hooks = globalThis.Hooks = {
  on: (n, f) => { (hooks.get(n) ?? hooks.set(n, []).get(n)).push(f); },
  callAll: (n, ...a) => { for (const f of hooks.get(n) ?? []) f(...a); },
};
const store = new Map();
globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const notes = [];
globalThis.ui = { notifications: { info: (m) => notes.push(["info", m]), warn: (m) => notes.push(["warn", m]) } };
const whispers = [];
globalThis.ChatMessage = { create: async (d) => { whispers.push(d.content.replace(/<[^>]+>/g, "")); return d; }, getSpeaker: () => ({}) };
globalThis.foundry = {};
const gm = { id: "gm", isGM: true, active: true, name: "GM" };
const game = globalThis.game = { paused: false, user: gm, users: [gm], world: { id: "w" }, time: { worldTime: 1000 } };
const grid = {
  getOffset: (p) => ({ i: Math.floor(p.x / 100), j: 0 }),
  getAdjacentOffsets: (o) => [{ i: o.i - 1, j: 0 }, { i: o.i + 1, j: 0 }],
  getCube: (o) => ({ q: o.i, r: 0, s: -o.i }),
  getTopLeftPoint: (o) => ({ x: o.i * 100, y: 0 }),
  getCenterPoint: (o) => ({ x: o.i * 100 + 50, y: 50 }),
};
const scene = { grid };

const { S, log, cfg, reset, OVERLAND_CHANGED, MODULE_ID } = await import("./route-stubs.mjs");
const route = await import("../scripts/overland/route.mjs");
route.registerRoute();
const KEY = `${MODULE_ID}.autoJourney`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The travel token at hex 0. Each move takes 4 ms and spends a point; `refuse` is a hex the move is refused on;
 * `onMove` runs after each move lands.
 */
function world(state, { refuse = null, onMove = null, actor = { name: "Party", testUserPermission: () => true } } = {}) {
  reset(state);
  store.clear(); notes.length = 0; whispers.length = 0;
  game.paused = false; game.user = gm; game.time.worldTime += 3600;
  const moves = [];
  let inFlight = 0, maxInFlight = 0;
  const doc = {
    uuid: "Scene.s.Token.t", parent: scene, actor, _source: { x: 0, y: 0 },
    getCenterPoint: (s) => ({ x: s.x + 50, y: s.y + 50 }),
    async move({ x, y }, options) {
      const to = x / 100;
      moves.push({ to, auto: options?.[MODULE_ID]?.auto === true });
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await wait(4);
      inFlight--;
      if (to === refuse || cfg.closed.has(to)) return false;
      doc._source = { x, y };
      S.spent++; S.hexesLeft = S.budget - S.spent;
      onMove?.(to);
      return true;
    },
  };
  const token = { document: doc, get center() { return { x: doc._source.x + 50, y: 50 }; }, actor, control() {} };
  doc.object = token; // a real placeable is circular: nothing may stringify it
  globalThis.canvas = { grid, scene, tokens: { placeables: [token] } };
  globalThis.fromUuidSync = (uuid) => (uuid === doc.uuid ? doc : null);
  return { doc, moves, maxInFlight: () => maxInFlight, walks: () => log.setAutoGoal.filter(Boolean).length };
}
const saveJourney = (goal) => store.set(KEY, JSON.stringify({ tokenUuid: "Scene.s.Token.t", goal, waitUntil: null, world: "w", user: "gm" }));
const warned = (text) => notes.filter(([kind, m]) => kind === "warn" && m.includes(text)).length;
/** Ends this tab's journey between tests (Auto turned off). */
test.afterEach(async () => { await wait(60); Hooks.callAll(OVERLAND_CHANGED, { auto: false }); game.paused = false; });

test("a journey resumed on a closed day opens it once and walks once, though the day's own commit fires the hook again", async () => {
  const w = world({ autoGoal: { i: 5, j: 0 } });
  saveJourney({ i: 5, j: 0 });
  Hooks.callAll(OVERLAND_CHANGED, structuredClone(S));
  await wait(300);
  assert.equal(log.autoStartDay, 1);
  assert.equal(w.walks(), 1, "one walk");
  assert.equal(w.maxInFlight(), 1, "never two moves at once");
  assert.deepEqual(w.moves.map((m) => m.to), [1, 2, 3, 4], "the day's four points, then the camp");
  assert.ok(w.moves.every((m) => m.auto), "every move is tagged as the journey's own");
  assert.equal(whispers.filter((m) => m.includes("stopReason.moved")).length, 0, "no false 'moved' stop");
  assert.equal(warned("no camp in this world"), 1, "a failed camp is said once");
});

test("a second Resume auto while the first is opening the day is refused, never a second walk", async () => {
  const w = world({ autoGoal: { i: 3, j: 0 } });
  const [first, second] = await Promise.all([route.resumeAutoTravel(), route.resumeAutoTravel()]);
  assert.deepEqual([first.ok, second], [true, { ok: false, error: "SDE.route.autoBusy" }]);
  await wait(200);
  assert.equal(log.autoStartDay, 1);
  assert.equal(w.walks(), 1);
});

test("a closed destination the weather may open: the walk starts at once, waits the day out, and the tab keeps its journey", async () => {
  const w = world({ day: 1, budget: 4, hexesLeft: 4, autoGoal: { i: 3, j: 0 } });
  cfg.closed = new Set([3]); cfg.blocked = "weather";
  saveJourney({ i: 3, j: 0 });
  Hooks.callAll(OVERLAND_CHANGED, structuredClone(S));
  await wait(300);
  assert.ok(w.moves.length > 0, "it walked without waiting for another hook");
  assert.ok(log.travelBlocked >= 1, "the destination was asked about");
  assert.equal(cfg.camps, 1, "the closed day is camped out");
  assert.deepEqual(JSON.parse(store.get(KEY)).goal, { i: 3, j: 0 }, "the tab's journey is saved, nothing circular in it");
});

test("Resume auto to ground that never opens is refused and drops the destination; nothing moves", async () => {
  const w = world({ day: 1, budget: 4, hexesLeft: 4, autoGoal: { i: 3, j: 0 } });
  cfg.closed = new Set([3]); cfg.blocked = "terrain";
  assert.deepEqual(await route.resumeAutoTravel(), { ok: false, error: "SDE.route.autoPermanent" });
  await wait(20);
  assert.deepEqual(w.moves, []);
  assert.deepEqual(log.setAutoGoal, [null]);
});

test("a walk refused at a destination that never opens says so, drops the destination and the tab's journey", async () => {
  world({ day: 1, budget: 4, hexesLeft: 4, autoGoal: { i: 3, j: 0 } }, { refuse: 3 });
  cfg.blocked = "terrain";
  assert.deepEqual(await route.resumeAutoTravel(), { ok: true });
  await wait(200);
  assert.equal(warned("SDE.route.autoPermanent"), 1);
  assert.equal(log.setAutoGoal.at(-1), null);
  assert.equal(notes.filter(([, m]) => m === "SDE.route.autoStopped").length, 0, "Resume auto is not offered again");
  assert.equal(store.has(KEY), false);
});

test("a pause after a step is a pause in the GM's whisper, in the table's words when the party and its place have no name", async () => {
  world({ day: 1, budget: 4, hexesLeft: 4, autoGoal: { i: 3, j: 0 }, hex: null }, { actor: {}, onMove: () => { game.paused = true; } });
  assert.deepEqual(await route.resumeAutoTravel(), { ok: true });
  await wait(100);
  assert.equal(whispers.length, 1);
  assert.match(whispers[0], /stopReason\.paused/);
  assert.match(whispers[0], /SDE\.route\.gmStopParty/);
  assert.match(whispers[0], /SDE\.route\.gmStopWhere/);
});

test("the unpause hint is only for a GM or the travel token's owner, who have Resume auto", () => {
  world({ autoGoal: { i: 3, j: 0 } }, { actor: { testUserPermission: () => false } });
  game.user = { id: "p", isGM: false, name: "P" };
  Hooks.callAll("pauseGame", false);
  assert.equal(notes.filter(([, m]) => m === "SDE.route.autoResumeHint").length, 0, "a player who cannot resume");
  game.user = gm;
  Hooks.callAll("pauseGame", false);
  assert.equal(notes.filter(([, m]) => m === "SDE.route.autoResumeHint").length, 1, "the GM");
});

test("an error in the journey stops it and says so, not as a day being waited out", async () => {
  world({ autoGoal: { i: 5, j: 0 } });
  cfg.startError = "the GM went away";
  saveJourney({ i: 5, j: 0 });
  Hooks.callAll(OVERLAND_CHANGED, structuredClone(S));
  await wait(60);
  assert.equal(warned('SDE.route.autoError {"reason":"the GM went away"}'), 1);
  assert.equal(warned("SDE.route.autoDays"), 0);
  assert.equal(store.has(KEY), false, "the journey is dropped");
});

test("a destination that never opens, met in a harsh storm, is waited out only until the storm lifts, then dropped once", async () => {
  const w = world({ day: 1, budget: 4, hexesLeft: 4, autoGoal: { i: 3, j: 0 } });
  cfg.closed = new Set([3]); cfg.blocked = ["storm", "storm", "terrain"]; cfg.campOk = true;
  assert.deepEqual(await route.resumeAutoTravel(), { ok: true });
  await wait(300);
  assert.equal(cfg.camps, 1, "the storm day is camped out once");
  assert.equal(warned("SDE.route.autoPermanent"), 1, "said once");
  assert.equal(log.setAutoGoal.filter((g) => g === null).length, 1, "the destination is dropped once");
  assert.equal(store.has(KEY), false, "and the tab's journey with it");
  assert.ok(w.moves.length > 0);
});

test("Resume auto whose day start throws answers with the error, and the next Resume walks", async () => {
  const w = world({ autoGoal: { i: 3, j: 0 } });
  cfg.startError = "commit failed";
  const first = await route.resumeAutoTravel();
  assert.deepEqual(first, { ok: false, error: 'SDE.route.autoError {"reason":"commit failed"}' });
  delete cfg.startError;
  assert.deepEqual(await route.resumeAutoTravel(), { ok: true });
  await wait(200);
  assert.deepEqual(w.moves.map((m) => m.to), [1, 2, 3]);
});
