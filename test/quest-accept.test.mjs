// A player asks to take on an Available quest; the GM approves. Quests and players here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeQuest, canRequestAccept } from "../scripts/quests/quest-core.mjs";

const M = "shadowdark-enhancer";
const EN = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url)));
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: {} } }, utils: { randomID: () => "id", escapeHTML: (s) => String(s) } };
globalThis._replace = (v) => v;
const { Quests, QUEST_QUERY, handleQuestQuery } = await import("../scripts/quests/quests.mjs");

const localize = (k) => EN[k] ?? k;
const format = (k, d = {}) => Object.entries(d).reduce((s, [a, b]) => s.replace(`{${a}}`, b), localize(k));
const GM = { id: "gm", isGM: true, name: "GM" };
const PLAYER = { id: "p1", isGM: false, name: "Ava" };

/** A world with one quest "q"; `observers` is who may read it. `dialog` decides each prompt's answer. */
function world({ status = "available", observers = ["p1"], name = "The Drowned Bell" } = {}) {
  const entry = { id: "q", uuid: "JournalEntry.q", name, ownership: { default: 2 }, flags: { [M]: { quest: normalizeQuest({ status }) } },
    testUserPermission: (u) => observers.includes(u.id),
    pages: [{ flags: { [M]: { questPage: "player" } }, update: async () => {} }] };
  entry.update = async (data) => { for (const [key, value] of Object.entries(data)) { const ks = key.split("."); let t = entry; for (const k of ks.slice(0, -1)) t = t[k] ??= {}; t[ks.at(-1)] = structuredClone(value); } };
  const w = { entry, prompts: [], messages: [], statusCalls: [], infos: [], sent: [], answer: () => "approve" };
  globalThis.game = { user: GM, users: { activeGM: GM }, journal: { get: (id) => (id === "q" ? entry : null), contents: [entry] }, modules: new Map(), settings: { get: () => false },
    i18n: { localize, format }, time: { worldTime: 0, calendar: null }, actors: { contents: [], get: () => null, filter: () => [] }, messages: { contents: w.messages } };
  globalThis.ui = { notifications: { warn() {}, info: (m) => w.infos.push(m) } }; globalThis.Hooks = { callAll() {} };
  globalThis.ChatMessage = { getSpeaker: () => ({}), create: async (d) => { w.messages.push(d); return d; } };
  globalThis.foundry.applications.api.DialogV2.wait = (opts) => { w.prompts.push(opts); return Promise.resolve(w.answer(opts)); };
  Quests.setStatus = async (id, st) => { w.statusCalls.push([id, st]); return {}; };
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const generic = format("SDE.quests.acceptRefused");

test("refused when refuseQuery refuses: not the active GM, or no user id", async () => {
  const w = world();
  globalThis.game.users.activeGM = { id: "other" };
  assert.equal((await handleQuestQuery({ action: "accept", id: "q" }, PLAYER)).ok, false);
  globalThis.game.users.activeGM = GM;
  assert.equal((await handleQuestQuery({ action: "accept", id: "q" }, {})).ok, false);
  assert.equal((await handleQuestQuery({ action: "accept", id: "q" }, undefined)).ok, false);
  await tick();
  assert.equal(w.prompts.length, 0);
});

test("one generic refusal: unknown quest, not Available, unreadable, Hidden", async () => {
  const cases = [
    [{}, { action: "accept", id: "nope" }],
    [{ status: "active" }, { action: "accept", id: "q" }],
    [{ status: "completed" }, { action: "accept", id: "q" }],
    [{ observers: [] }, { action: "accept", id: "q" }],
    [{ status: "hidden" }, { action: "accept", id: "q" }],
    [{}, { action: "other", id: "q" }],
  ];
  for (const [opts, data] of cases) {
    const w = world(opts), user = PLAYER;
    assert.deepEqual(await handleQuestQuery(data, user), { ok: false, error: generic });
    await tick();
    assert.equal(w.prompts.length, 0);
  }
});

test("a hostile id gets the generic refusal and no prompt", async () => {
  const w = world();
  for (const id of [{ toString: 1 }, ["q"], 5, null]) {
    assert.deepEqual(await handleQuestQuery({ action: "accept", id }, PLAYER), { ok: false, error: generic });
  }
  await tick();
  assert.equal(w.prompts.length, 0);
});

test("the prompt's default button is Not now, never Approve; Approve is listed first", async () => {
  const w = world();
  await handleQuestQuery({ action: "accept", id: "q" }, PLAYER);
  await tick();
  const buttons = w.prompts[0].buttons;
  assert.deepEqual(buttons.filter((b) => b.default).map((b) => b.action), ["notNow"]);
  assert.equal(buttons[0].action, "approve");
});

test("the sender comes from the user, never from the payload", async () => {
  const w = world({ observers: ["p1"] });
  // The payload names the GM, who could read anything; the sender is a player who cannot read the quest.
  const out = await handleQuestQuery({ action: "accept", id: "q", userId: "gm", user: GM }, { id: "p9", isGM: false, name: "Eve" });
  assert.equal(out.ok, false);
  await tick();
  assert.equal(w.prompts.length, 0);
  // And a readable sender who forges another name is still the one named in the prompt.
  await handleQuestQuery({ action: "accept", id: "q", userId: "gm" }, PLAYER);
  await tick();
  assert.match(w.prompts[0].content, /Ava/);
  assert.doesNotMatch(w.prompts[0].content, /GM wants/);
});

test("ok comes back at once while the prompt is still open; a second request is dropped; a later one opens a new prompt", async () => {
  const w = world();
  let release;
  w.answer = () => new Promise((r) => { release = r; });
  globalThis.foundry.applications.api.DialogV2.wait = (opts) => { w.prompts.push(opts); return w.answer(opts); };
  assert.deepEqual(await handleQuestQuery({ action: "accept", id: "q" }, PLAYER), { ok: true });
  assert.deepEqual(await handleQuestQuery({ action: "accept", id: "q" }, PLAYER), { ok: true });
  await tick();
  assert.equal(w.prompts.length, 1);
  release("notNow"); await tick(); await tick();
  assert.deepEqual(await handleQuestQuery({ action: "accept", id: "q" }, PLAYER), { ok: true });
  await tick();
  assert.equal(w.prompts.length, 2);
  release("notNow"); await tick(); await tick();
});

test("Approve sets Active only while the quest is still Available", async () => {
  const w = world();
  await handleQuestQuery({ action: "accept", id: "q" }, PLAYER);
  await tick(); await tick();
  assert.deepEqual(w.statusCalls, [["q", "active"]]);
  assert.equal(w.messages.length, 0);

  const w2 = world();
  w2.answer = () => { w2.entry.flags[M].quest.status = "completed"; return "approve"; };
  await handleQuestQuery({ action: "accept", id: "q" }, PLAYER);
  await tick(); await tick();
  assert.deepEqual(w2.statusCalls, []);
});

test("Not now and a closed prompt each whisper the requester exactly once", async () => {
  for (const answer of ["notNow", null]) {
    const w = world();
    w.answer = () => answer;
    await handleQuestQuery({ action: "accept", id: "q" }, PLAYER);
    await tick(); await tick();
    assert.deepEqual(w.statusCalls, []);
    assert.equal(w.messages.length, 1);
    assert.deepEqual(w.messages[0].whisper, ["p1"]);
    assert.match(w.messages[0].content, /The GM isn&#39;t ready for you to take The Drowned Bell/);
    assert.doesNotMatch(w.messages[0].content, /warn/);
  }
});

test("names are escaped in the prompt and in the whisper", async () => {
  const w = world({ name: "<img src=x onerror=1>" });
  w.answer = () => "notNow";
  await handleQuestQuery({ action: "accept", id: "q" }, { ...PLAYER, name: "<b>Ava</b>" });
  await tick(); await tick();
  assert.doesNotMatch(w.prompts[0].content, /<img|<b>/);
  assert.match(w.prompts[0].content, /&lt;b&gt;Ava&lt;\/b&gt;/);
  assert.doesNotMatch(w.messages[0].content, /<img/);
  assert.match(w.messages[0].content, /&lt;img/);
});

test("the open-prompt guard is cleared even when the dialog throws", async () => {
  const w = world();
  const warn = console.warn; console.warn = () => {};
  try {
    w.answer = () => { throw new Error("dialog broke"); };
    assert.deepEqual(await handleQuestQuery({ action: "accept", id: "q" }, PLAYER), { ok: true });
    await tick(); await tick();
    w.answer = () => "notNow";
    await handleQuestQuery({ action: "accept", id: "q" }, PLAYER);
    await tick(); await tick();
    assert.equal(w.prompts.length, 2);
  } finally { console.warn = warn; }
});

test("requestAccept sends the payload through the relay and toasts only on success", async () => {
  const w = world();
  let reply = { ok: true };
  globalThis.game.user = { ...PLAYER, hasPermission: () => true };
  globalThis.game.users.activeGM = { ...GM, query: async (name, data, opts) => { w.sent.push({ name, data, opts }); return reply; } };
  assert.equal(await Quests.requestAccept("q"), true);
  assert.deepEqual(w.sent[0].name, QUEST_QUERY);
  assert.deepEqual(w.sent[0].data, { action: "accept", id: "q" });
  assert.deepEqual(w.infos, [format("SDE.quests.acceptSent")]);
  reply = { ok: false, error: "no" };
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await Quests.requestAccept("q"), false); } finally { console.warn = warn; }
  assert.equal(w.infos.length, 1);
});

test("a GM never gets the link, nor a quest that is not Available", () => {
  assert.equal(canRequestAccept({ status: "available" }, { isGM: true }), false);
  assert.equal(canRequestAccept({ status: "available" }, { isGM: false }), true);
  for (const status of ["active", "completed", "failed", "hidden"]) assert.equal(canRequestAccept({ status }, { isGM: false }), false);
  const hbs = readFileSync(new URL("../templates/quest-log.hbs", import.meta.url), "utf8");
  assert.match(hbs, /\{\{#if canAccept\}\}<a data-action="qlAccept"/, "an anchor: the Party sheet disables buttons for observers");
  assert.doesNotMatch(hbs, /<button[^>]*qlAccept/);
});

test("player-facing quest log controls are anchors, never buttons (the Party sheet disables buttons for observers)", () => {
  const hbs = readFileSync(new URL("../templates/quest-log.hbs", import.meta.url), "utf8");
  const bad = [...hbs.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /data-action="(qlTab|qlJump|qlOpenJournal|qlAccept|qlSelect)"/.test(tag));
  assert.deepEqual(bad, []);
});
