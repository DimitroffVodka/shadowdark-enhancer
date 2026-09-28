// Downtime takes time (#198): one 2d6 roll for the group when the session
// starts, one off-duty clock move when it ends, never alongside a carouse.
import test from "node:test";
import assert from "node:assert/strict";

import { carousingUnderway } from "../scripts/session-recap/carousing-feed-core.mjs";

const settings = new Map();
const warnings = [];
const messages = [];
const dice = [];
let carousing = null;             // SDX's sync journal flags, or null when Extras is off
Object.assign(globalThis, {
  Hooks: { on() {}, callAll() {} },
  ui: { notifications: { warn: (m) => warnings.push(m) } },
  Roll: class {
    constructor(formula) { this.formula = formula; }
    async evaluate() { this.total = dice.shift(); return this; }
  },
  ChatMessage: { create: async (data) => { messages.push(data); return { id: `m${messages.length}` }; } },
  game: {
    user: { id: "gm", isGM: true },
    i18n: { localize: (k) => k, format: (k, d) => k + JSON.stringify(d) },
    settings: { get: (ns, key) => settings.get(`${ns}.${key}`) ?? null, set: async (ns, key, v) => { settings.set(`${ns}.${key}`, v); } },
    socket: { emit() {} },
    messages: { get: () => null },
    modules: { get: (id) => (id === "shadowdark-extras" && carousing ? { active: true } : null) },
    journal: { find: (fn) => [carousing?.journal].filter(Boolean).find(fn) },
  },
});
settings.set("shadowdark-extras.enableCarousing", true);

const { DowntimeSession } = await import("../scripts/downtime/downtime-session.mjs");
DowntimeSession.storedFor = () => ({ ok: true, slots: {} });
const moves = [];
let refuse = false;
DowntimeSession._passTime = async (seconds) => { moves.push(seconds); return refuse ? { ok: false, error: "no" } : { ok: true }; };

/** A started session with `rolled` settled results. */
async function started(days, rolled = 1) {
  warnings.length = messages.length = moves.length = 0;
  refuse = false;
  await DowntimeSession._commit({ active: false });
  dice.push(days);
  await DowntimeSession.start("gmwr");
  const results = Object.fromEntries(Array.from({ length: rolled }, (_, i) => [`actor${i}`, { total: 12 }]));
  await DowntimeSession._commit({ ...DowntimeSession.state, results });
}

test("start rolls 2d6 once for the group; the card shows it and carries the roll", async () => {
  await started(7);
  assert.equal(DowntimeSession.days, 7);
  assert.equal(dice.length, 0, "one roll");
  assert.equal(messages[0].rolls[0].formula, "2d6");
  assert.match(messages[0].content, /SDE\.downtime\.card\.days\{"days":7\}/);
});

test("end moves the clock its days once, off duty, and closes the session", async () => {
  await started(7);
  await Promise.all([DowntimeSession.end(), DowntimeSession.end()]);   // a double click
  assert.deepEqual(moves, [7 * 86400]);
  assert.equal(DowntimeSession.active, false);
  assert.match(messages.at(-1).content, /SDE\.downtime\.card\.daysPassed\{"days":7\}/);
});

test("a refused move leaves the session open to end again", async () => {
  await started(5);
  refuse = true;
  assert.equal(await DowntimeSession.end(), false);
  assert.equal(DowntimeSession.active, true);
  refuse = false;
  await DowntimeSession.end();
  assert.deepEqual(moves, [5 * 86400, 5 * 86400], "the second End moves it");
  assert.equal(DowntimeSession.active, false);
});

test("a session nobody rolled in is called off: no time passes", async () => {
  await started(9, 0);
  await DowntimeSession.end();
  assert.deepEqual(moves, []);
  assert.equal(DowntimeSession.active, false);
});

test("downtime won't start during a carouse in Extras, and says why", async () => {
  await DowntimeSession._commit({ active: false });
  const flags = { carousingSession: { phase: "setup" }, carousingDrops: { user1: "actor1" } };
  carousing = { journal: { documentName: "JournalEntry", name: "__sdx_carousing_sync__", getFlag: (ns, k) => flags[k] } };
  warnings.length = 0;
  assert.equal(await DowntimeSession.start("gmwr"), null);
  assert.deepEqual(warnings, ["SDE.downtime.notify.carousingOpen"]);
  assert.equal(DowntimeSession.active, false);
  carousing = null;
});

test("a carouse is under way while rolling, or with characters in for an outing not yet complete", () => {
  assert.equal(carousingUnderway({ phase: "rolling" }, {}), true);
  assert.equal(carousingUnderway({ phase: "setup" }, { u: "a" }), true);
  assert.equal(carousingUnderway({ phase: "setup" }, {}), false, "an empty window");
  assert.equal(carousingUnderway({ phase: "complete" }, { u: "a" }), false, "its time has passed");
  assert.equal(carousingUnderway(null, null), false);
});
