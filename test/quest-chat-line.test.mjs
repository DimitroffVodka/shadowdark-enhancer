// The one public chat line when a quest ends. Quests here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gregorian } from "./gregorian-calendar.mjs";
import { normalizeQuest } from "../scripts/quests/quest-core.mjs";

const M = "shadowdark-enhancer";
const EN = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url)));
const DAY = 86400;
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: {} } }, utils: { randomID: () => "id", escapeHTML: (s) => String(s) } };
globalThis._replace = (v) => v;
const { Quests } = await import("../scripts/quests/quests.mjs");

const localize = (k) => EN[k] ?? k.split(".").at(-1);
const format = (k, d = {}) => Object.entries(d).reduce((s, [a, b]) => s.replace(`{${a}}`, b), localize(k));

function fixture(flag, { now = 0 } = {}) {
  const entry = { id: "q", uuid: "JournalEntry.q", name: "The Drowned Bell", ownership: { default: 2 }, flags: { [M]: { quest: normalizeQuest(flag) } },
    pages: [{ flags: { [M]: { questPage: "player" } }, update: async () => {} }] };
  entry.update = async (data) => { for (const [key, value] of Object.entries(data)) { const ks = key.split("."); let t = entry; for (const k of ks.slice(0, -1)) t = t[k] ??= {}; t[ks.at(-1)] = structuredClone(value); } };
  const gm = { id: "gm", isGM: true };
  const messages = [];
  globalThis.game = { user: gm, users: { activeGM: gm }, journal: { get: (id) => (id === "q" ? entry : null) }, modules: new Map(), settings: { get: () => false },
    i18n: { localize, format }, time: { worldTime: now, calendar: gregorian }, actors: { contents: [], get: () => null, filter: () => [] }, messages: { contents: messages } };
  globalThis.ui = { notifications: { warn() {}, info() {} } }; globalThis.Hooks = { callAll() {} };
  globalThis.ChatMessage = { getSpeaker: () => ({}), create: async (data) => { messages.push(structuredClone(data)); return data; } };
  globalThis.fromUuidSync = () => null;
  return { entry, lines: () => messages.filter((m) => m.flags?.[M]?.questLine) };
}

test("available to completed posts exactly one line, flagged", async () => {
  const f = fixture({ status: "available" });
  await Quests.setStatus("q", "completed");
  assert.equal(f.lines().length, 1);
  assert.deepEqual(f.lines()[0].flags[M].questLine, { questUuid: "JournalEntry.q", status: "completed" });
  assert.match(f.lines()[0].content, /Quest completed: The Drowned Bell/);
});

test("the same status again posts nothing", async () => {
  const f = fixture({ status: "active" });
  await Quests.setStatus("q", "failed"); await Quests.setStatus("q", "failed");
  assert.equal(f.lines().length, 1);
});

test("active to failed after the deadline adds the due date", async () => {
  const deadline = 72 * DAY; // day 72 of year 0 is 14 March
  const f = fixture({ status: "active", deadline }, { now: deadline + 2 * DAY });
  await Quests.setStatus("q", "failed");
  assert.equal(f.lines().length, 1);
  assert.match(f.lines()[0].content, /Quest failed: The Drowned Bell \(due 14 March 0\)/);
});

test("failing before the deadline names no date", async () => {
  const f = fixture({ status: "active", deadline: 100 * DAY }, { now: 5 * DAY });
  await Quests.setStatus("q", "failed");
  assert.doesNotMatch(f.lines()[0].content, /due/);
});

test("hidden to failed posts none", async () => {
  const f = fixture({ status: "hidden" });
  await Quests.setStatus("q", "failed");
  assert.equal(f.entry.flags[M].quest.status, "failed");
  assert.equal(f.lines().length, 0);
});

test("completing again once Completed posts none", async () => {
  const f = fixture({ status: "available" });
  await Quests.setStatus("q", "completed"); await Quests.setStatus("q", "completed");
  assert.equal(f.lines().length, 1);
});

test("a payout that stays pending still posts once, and its retry posts none", async () => {
  const f = fixture({ status: "active", rewards: { xp: 3 } });
  globalThis.game.actors = { contents: [], get: () => null, filter: () => [] };
  const answer = { recipients: ["Actor.a"], itemTo: {} };
  const actor = { id: "a", uuid: "Actor.a", type: "Player", name: "a", system: { level: { xp: 0 }, coins: {} }, flags: {}, items: { contents: [] }, update: async () => {} };
  globalThis.game.actors.contents.push(actor);
  await Quests.setStatus("q", "completed", { payoutAnswer: answer, openTraining: false });
  const first = f.lines().length;
  await Quests.setStatus("q", "completed", { payoutAnswer: answer, openTraining: false });
  assert.equal(f.entry.flags[M].quest.status, "completed");
  assert.equal(first, 1);
  assert.equal(f.lines().length, 1);
});

test("a cancelled payout confirmation posts none", async () => {
  const f = fixture({ status: "active", rewards: { xp: 3 } });
  globalThis.foundry.applications.api.DialogV2.wait = async () => null;
  assert.equal(await Quests.setStatus("q", "completed"), null);
  assert.equal(f.entry.flags[M].quest.status, "active");
  assert.equal(f.lines().length, 0);
});

test("a chat message that throws does not stop the status change", async () => {
  const f = fixture({ status: "active" });
  globalThis.ChatMessage.create = async () => { throw Error("chat down"); };
  const warn = console.warn; console.warn = () => {};
  try { const q = await Quests.setStatus("q", "completed"); assert.equal(q.status, "completed"); }
  finally { console.warn = warn; }
  assert.equal(f.entry.flags[M].quest.status, "completed");
});
