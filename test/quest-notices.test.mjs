// A player's pop-ups for quest changes. Quests here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";

let debounced = 0;
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: {} } },
  utils: { randomID: () => "id", escapeHTML: (s) => String(s), debounce: (fn, ms) => () => { debounced = ms; } } };
const handlers = { on: [], once: [] };
globalThis.Hooks = { on: (n, f) => handlers.on.push([n, f]), once: (n, f) => handlers.once.push([n, f]), callAll() {} };
const toasts = [];
globalThis.ui = { notifications: { warn: (m) => toasts.push(["warn", m]), info: (m) => toasts.push(["info", m]) } };
const world = { isGM: false, quests: [] };
globalThis.game = { get user() { return { isGM: world.isGM }; }, i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` }, journal: { contents: [] }, settings: { get: () => false } };

const { Quests } = await import("../scripts/quests/quests.mjs");
Quests.list = () => world.quests;
const { registerQuestNotices, flushNotices } = await import("../scripts/quests/quest-notices.mjs");
registerQuestNotices();
const ready = () => handlers.once.find(([n]) => n === "ready")[1]();
const changed = () => handlers.on.find(([n]) => n.endsWith("questsChanged"))[1]({ ids: [] });
const q = (id, status, objectives = [], name = `Quest ${id}`) => ({ id, name, status, objectives });
const reset = () => { toasts.length = 0; flushNotices(); toasts.length = 0; };

test("priming on ready shows nothing", () => {
  world.quests = [q("a", "active", [{ id: "s1", text: "Ring it", done: false }])];
  ready(); flushNotices();
  assert.deepEqual(toasts, []);
});

test("a change shows one pop-up per quest after a one-second wait", () => {
  world.quests = [q("a", "active", [{ id: "s1", text: "Ring it", done: true }])];
  changed(); assert.equal(debounced, 1000);
  flushNotices();
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][1], /toast\.step/);
  reset();
});

test("failed uses warn, the rest info", () => {
  world.quests = [q("a", "failed", world.quests[0].objectives)];
  changed(); flushNotices();
  assert.deepEqual(toasts.map((t) => t[0]), ["warn"]);
  reset();
  world.quests = [{ ...world.quests[0] }, q("b", "available")];
  changed(); flushNotices();
  assert.deepEqual(toasts.map((t) => t[0]), ["info"]);
  reset();
});

test("events for one quest merge to the strongest", () => {
  world.quests = [...world.quests, q("c", "available")];
  changed();
  world.quests = world.quests.map((x) => (x.id === "c" ? q("c", "completed") : x));
  changed(); flushNotices();
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][1], /toast\.completed/);
  reset();
});

test("more than three quests collapse to one summary line", () => {
  world.quests = [...world.quests, q("d", "available"), q("e", "available"), q("f", "available"), q("g", "available")];
  changed(); flushNotices();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][1], "SDE.quests.toast.many");
  reset();
});

test("a GM gets none", () => {
  world.isGM = true;
  world.quests = [...world.quests, q("z", "active")];
  changed(); flushNotices();
  assert.deepEqual(toasts, []);
  world.isGM = false;
});
