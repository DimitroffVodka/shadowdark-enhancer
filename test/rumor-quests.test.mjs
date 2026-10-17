// Hidden quests drafted from the Rumors Heard ledger. Rumors and quests here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";

const M = "shadowdark-enhancer";
// Importing rumors.mjs loads half the module; every Foundry namespace it touches at load time is a stub.
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
globalThis.game = { user: { isGM: true }, i18n: { localize: (k) => k, format: (k) => k }, settings: { get: () => true, register() {} }, journal: { find: () => null } };

const { Rumors, draftGiven } = await import("../scripts/rumors/rumors.mjs");
const { QuestLogApp, fromRumorsDrafted } = await import("../scripts/quests/quest-log-app.mjs");
const { Quests } = await import("../scripts/quests/quests.mjs");
const { Troubles } = await import("../scripts/troubles/troubles.mjs");

/** A ledger with one page holding `rumors`; returns the page. */
function ledgerWith(rumors) {
  const page = {
    id: "p1", uuid: "JournalEntry.l.JournalEntryPage.p1",
    flags: { [M]: { rumorPage: { region: null, rumors } } },
    getFlag: (scope, key) => page.flags[scope]?.[key],
    update: async (data) => { for (const [k, v] of Object.entries(data)) page.flags[M][k.split(".").pop()] = v; },
  };
  const entry = { getFlag: (scope, key) => (key === "rumorLedger" ? true : undefined), pages: { contents: [page], get: () => page } };
  globalThis.game.journal = { find: (fn) => (fn(entry) ? entry : null) };
  return page;
}

/** Quests.create made to record its calls; `fail` names a rumor text it throws on. */
function stubQuests({ fail } = {}) {
  const calls = [];
  Quests.get = () => null;
  Quests.create = async (data) => {
    if (data.description === fail) throw new Error("create failed");
    calls.push(data);
    return { uuid: `JournalEntry.q${calls.length}`, ...data };
  };
  return calls;
}

test("every rumor with no quest gets a Hidden one, linked back on the ledger page", async () => {
  const page = ledgerWith([{ id: "a", text: "A bell tolls under the lake." }, { id: "b", text: "The miller sells maps." }]);
  const calls = stubQuests();
  const made = await Rumors.draftQuests();
  assert.equal(made.length, 2);
  assert.deepEqual(calls.map((c) => c.status), ["hidden", "hidden"]);
  assert.deepEqual(calls.map((c) => c.source), [{ kind: "rumor", uuid: page.uuid }, { kind: "rumor", uuid: page.uuid }]);
  assert.deepEqual(page.flags[M].rumorPage.rumors.map((r) => r.questUuid), ["JournalEntry.q1", "JournalEntry.q2"]);
  assert.deepEqual(await Rumors.draftQuests(), [], "a second run finds nothing to draft");
});

test("a rumor whose quest was deleted stays without one", async () => {
  ledgerWith([{ id: "a", text: "A bell tolls.", questUuid: "JournalEntry.gone" }, { id: "b", text: "Maps." }]);
  const calls = stubQuests();
  assert.equal((await Rumors.draftQuests()).length, 1);
  assert.deepEqual(calls.map((c) => c.description), ["Maps."]);
});

test("a rumor about a trouble drafts through the Trouble tracker, Hidden", async () => {
  const page = ledgerWith([{ id: "t", text: "Word from Hollowmere.", source: { trouble: "Trouble.1" } }]);
  const calls = [];
  Quests.get = () => null;
  Troubles.promote = async (id, opts) => { calls.push([id, opts]); return { uuid: "JournalEntry.tq" }; };
  assert.equal((await Rumors.draftQuests()).length, 1);
  assert.deepEqual(calls, [["Trouble.1", { status: "hidden" }]]);
  assert.equal(page.flags[M].rumorPage.rumors[0].questUuid, "JournalEntry.tq");
});

test("one failing quest does not stop the others", async () => {
  const page = ledgerWith([{ id: "a", text: "Bad." }, { id: "b", text: "Good." }]);
  stubQuests({ fail: "Bad." });
  const quiet = console.error;
  console.error = () => {};
  try { assert.equal((await Rumors.draftQuests()).length, 1); } finally { console.error = quiet; }
  assert.equal(page.flags[M].rumorPage.rumors[0].questUuid, undefined);
  assert.equal(page.flags[M].rumorPage.rumors[1].questUuid, "JournalEntry.q1");
});

test("only a GM can draft", async () => {
  ledgerWith([{ id: "a", text: "A bell tolls." }]);
  const calls = stubQuests();
  globalThis.game.user.isGM = false;
  try { assert.equal(await Rumors.draftQuests(), null); } finally { globalThis.game.user.isGM = true; }
  assert.equal(calls.length, 0);
});

/** The ledger of ledgerWith, with the `find` on its pages that a give needs. */
function givenLedger(rumors) {
  const page = ledgerWith(rumors);
  const entry = globalThis.game.journal.find(() => true);
  entry.pages.find = (fn) => [page].find(fn);
  return page;
}

test("a give drafts a Hidden quest per new rumor with the setting on, none with it off", async () => {
  const page = givenLedger([{ id: "a", text: "A bell." }, { id: "b", text: "Maps." }]);
  const calls = stubQuests();
  const settings = globalThis.game.settings;
  try {
    globalThis.game.settings = { get: () => false };
    assert.deepEqual(await draftGiven([{ id: "a", region: null }]), []);
    assert.equal(calls.length, 0);
    globalThis.game.settings = { get: () => true };
    assert.equal((await draftGiven([{ id: "a", region: null }, { id: "b", region: null }])).length, 2);
  } finally { globalThis.game.settings = settings; }
  assert.deepEqual(calls.map((c) => c.status), ["hidden", "hidden"]);
  assert.deepEqual(page.flags[M].rumorPage.rumors.map((r) => r.questUuid), ["JournalEntry.q1", "JournalEntry.q2"]);
});

test("a draft that fails during a give does not throw out of it", async () => {
  givenLedger([{ id: "a", text: "Bad." }]);
  stubQuests({ fail: "Bad." });
  const quiet = console.error;
  console.error = () => {};
  try { assert.deepEqual(await draftGiven([{ id: "a", region: null }]), []); } finally { console.error = quiet; }
});

/** Opens the Quest Log with `Quests.get` serving `known` (id to summary). */
function openLog(known, arg) {
  Quests.get = (id) => known[id] ?? null;
  const app = Object.create(QuestLogApp.prototype);
  app.tab = "active"; app.selectedId = "old"; app.filters = { character: "x", party: "", source: "" };
  app.render = () => {};
  globalThis.foundry.applications.instances = { get: () => app };
  QuestLogApp.open(arg);
  return app;
}

test("opening the Quest Log on a Hidden quest selects its tab and clears the filters", () => {
  const app = openLog({ q1: { id: "q1", status: "hidden" } }, "q1");
  assert.equal(app.tab, "hidden");
  assert.equal(app.selectedId, "q1");
  assert.deepEqual(app.filters, { character: "", party: "", source: "" });
});

test("opening on an unknown or unreadable quest, or on none, changes nothing", () => {
  for (const arg of ["nope", undefined]) {
    const app = openLog({}, arg);
    assert.equal(app.tab, "active");
    assert.equal(app.selectedId, "old");
    assert.equal(app.filters.character, "x");
  }
});

test("From rumors counts only the Hidden quests it drafted", () => {
  const made = [{ id: "a", status: "active" }, { id: "b", status: "hidden" }];
  assert.deepEqual(fromRumorsDrafted(made).map((q) => q.id), ["b"]);
  assert.equal(fromRumorsDrafted(null), null);
});
