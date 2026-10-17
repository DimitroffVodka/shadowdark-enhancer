// What a non-GM gets from Quests.list / Quests.get: never a secret step. Quests here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";

const M = "shadowdark-enhancer";
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === "prototype" ? t.prototype : stub()), construct: () => ({}), apply: () => stub() });
const known = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: {} } },
  utils: { randomID: () => "id", debounce: (fn) => fn, escapeHTML: (s) => String(s) },
};
const withStubs = (o) => new Proxy(o, { get: (t, k) => (t[k] === undefined ? stub() : t[k]?.constructor === Object ? withStubs(t[k]) : t[k]) });
globalThis.foundry = withStubs(known);
globalThis._replace = (v) => v;
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 }, SORT_INTEGER_DENSITY: 100000 };

const entry = {
  id: "q1", uuid: "JournalEntry.q1", name: "The drowned bell", _stats: { createdTime: 1 },
  testUserPermission: () => true,
  flags: { [M]: { quest: {
    status: "active",
    objectives: [
      { id: "a", text: "Find the bell" }, { id: "a1", text: "Ask the ferryman", parent: "a" },
      { id: "s", text: "The ferryman is a ghost", secret: true }, { id: "s1", text: "Child of a secret", parent: "s" },
    ],
  } } },
};
globalThis.game = { user: { isGM: false }, journal: { contents: [entry], get: (id) => (id === "q1" ? entry : null) },
  i18n: { localize: (k) => k, format: (k) => k }, settings: { get: () => true, register() {} } };

const { Quests } = await import("../scripts/quests/quests.mjs");
const texts = (q) => q.objectives.map((o) => o.text);

test("a player's list and get carry no secret step, nor the children of one", () => {
  assert.deepEqual(texts(Quests.list()[0]), ["Find the bell", "Ask the ferryman"]);
  assert.deepEqual(texts(Quests.get("q1")), ["Find the bell", "Ask the ferryman"]);
  assert.ok(!JSON.stringify(Quests.list()).includes("ghost"));
});

test("a GM sees every step", () => {
  globalThis.game.user.isGM = true;
  assert.equal(Quests.get("q1").objectives.length, 4);
  globalThis.game.user.isGM = false;
});
