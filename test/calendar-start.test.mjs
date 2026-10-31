// The campaign start date: it moves a new world's clock once, and never a clock
// another calendar is reading. And what Save in the calendar editor switches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gregorian } from "./gregorian-calendar.mjs";

const CORE = { name: "Simplified Gregorian" };
globalThis.foundry = { data: { SIMPLIFIED_GREGORIAN_CALENDAR_CONFIG: CORE }, applications: { api: {} } };

const { CAMPAIGN_START, CHOICE_SETTING, CUSTOM_SETTING, DATE_OWNERS, STARTED_SETTING, applyCampaignStart, saveCalendar } = await import("../scripts/calendar/calendar.mjs");
const { timeApi } = await import("../scripts/time/time.mjs");
const { dateToTime } = await import("../scripts/overland/hud-core.mjs");

/** A world as `applyCampaignStart` sees it; returns the moves it asked for and the settings it wrote. */
async function start({ worldTime = 0, config = CORE, active = [], started = false } = {}) {
  const moves = [], writes = [];
  timeApi.advanceOffDuty = async (to) => moves.push(to);
  globalThis.CONFIG = { time: { worldCalendarConfig: config } };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
    modules: new Map(DATE_OWNERS.map((id) => [id, { id, active: active.includes(id) }])),
    settings: { get: () => started, set: async (_ns, key, value) => writes.push([key, value]) },
    time: { worldTime, calendar: gregorian },
  };
  await applyCampaignStart();
  return { moves, writes };
}

test("a new world on core's calendar jumps to the campaign start, once", async () => {
  const { moves, writes } = await start();
  assert.deepEqual(moves, [dateToTime(gregorian, CAMPAIGN_START)]);
  assert.deepEqual(writes, [[STARTED_SETTING, true]]);
  assert.deepEqual((await start({ started: true })).moves, []);
});

test("a clock someone set stays where it is", async () => {
  assert.deepEqual((await start({ worldTime: 5000 })).moves, []);
});

for (const id of DATE_OWNERS) {
  test(`${id} keeps the date: no jump, and the question is closed`, async () => {
    const { moves, writes } = await start({ active: [id] });
    assert.deepEqual(moves, []);
    assert.deepEqual(writes, [[STARTED_SETTING, true]]);
  });
}

test("an installed but inactive calendar module changes nothing", async () => {
  assert.equal((await start({ active: [] })).moves.length, 1);
});

test("a world calendar that is not core's gets no jump: 1348 is a Gregorian count", async () => {
  const { moves, writes } = await start({ config: { name: "Someone's" } });
  assert.deepEqual(moves, []);
  assert.deepEqual(writes, [[STARTED_SETTING, true]]);
});

/** A GM pressing Save: whether the world reloads, and what was written. */
async function save({ config = CORE, active = [] } = {}) {
  const writes = [];
  globalThis.CONFIG = { time: { worldCalendarConfig: config } };
  globalThis.game = {
    modules: new Map(active.map((id) => [id, { id, title: id, active: true }])),
    settings: { set: async (_ns, key, value) => writes.push([key, value]) },
  };
  return { live: await saveCalendar({ months: "mine" }), writes };
}

test("Save puts a Gregorian world on the GM's calendar: the one step that makes it live", async () => {
  assert.deepEqual(await save(), { live: true, writes: [[CUSTOM_SETTING, { months: "mine" }], [CHOICE_SETTING, "custom"]] });
});

test("Save under a module that runs the calendar only keeps it, and asks for no reload", async () => {
  const kept = { live: false, writes: [[CUSTOM_SETTING, { months: "mine" }]] };
  assert.deepEqual(await save({ active: ["calendaria"] }), kept);
  assert.deepEqual(await save({ config: { name: "Someone's" } }), { ...kept }, "a world calendar no id gives away");
});
