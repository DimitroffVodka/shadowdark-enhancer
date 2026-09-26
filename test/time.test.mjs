// The time API (#227, Overland O1): sun, moon, seasons, anchors and what a
// clock move crosses, on a stand-in core calendar; then the Foundry wrapper,
// the timeAdvanced hook and the recap stamp against a stubbed game.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SYNODIC_DAYS, ANCHORS, anchor, crossings, dateParts, dawnAfter, isNight, moonPhase, season, sun, startOfDay,
} from "../scripts/time/time-core.mjs";
import { gregorian, quirkyGregorian, at, clockAt } from "./gregorian-calendar.mjs";

const DAY = 86400;
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const shows = (cal, t) => { const c = cal.timeToComponents(t); return `${c.year}-${c.month + 1}-${c.dayOfMonth + 1}`; };

// ── Sun ──────────────────────────────────────────────────────────────────────

test("21 June: sunrise 04:30, sunset 19:30; 21 December: 07:30 and 16:30", () => {
  for (const year of [1300, 1301]) {   // a leap year and a common one
    assert.deepEqual(sun(gregorian, at(year, 6, 21, 12)), { sunrise: 4.5, sunset: 19.5 }, `June ${year}`);
    assert.deepEqual(sun(gregorian, at(year, 12, 21)), { sunrise: 7.5, sunset: 16.5 }, `December ${year}`);
  }
  // About 06:00 to 18:00 at the equinoxes (the curve is not symmetric to the day).
  for (const [month, day] of [[3, 20], [9, 22]]) {
    const { sunrise, sunset } = sun(gregorian, at(1301, month, day));
    assert.ok(Math.abs(sunrise - 6) < 0.1 && Math.abs(sunset - 18) < 0.1, `${month}/${day}: ${hhmm(sunrise)}–${hhmm(sunset)}`);
  }
  // The days lengthen from December to June and shorten after.
  assert.ok(sun(gregorian, at(1301, 4, 1)).sunrise > sun(gregorian, at(1301, 5, 1)).sunrise);
  assert.ok(sun(gregorian, at(1301, 8, 1)).sunrise < sun(gregorian, at(1301, 9, 1)).sunrise);
});

test("night is before sunrise and from sunset on", () => {
  assert.equal(isNight(gregorian, at(1301, 6, 21, 4, 29)), true);
  assert.equal(isNight(gregorian, at(1301, 6, 21, 4, 30)), false);
  assert.equal(isNight(gregorian, at(1301, 6, 21, 19, 29)), false);
  assert.equal(isNight(gregorian, at(1301, 6, 21, 19, 30)), true);
  assert.equal(isNight(gregorian, at(1301, 12, 21, 17)), true, "a winter evening");
});

test("dawnAfter: the next sunrise, and the nth; a sunrise at that very moment is not after it", () => {
  const rise21 = at(1301, 6, 21, 4, 30), rise22 = at(1301, 6, 22) + sun(gregorian, at(1301, 6, 22)).sunrise * 3600;
  assert.equal(dawnAfter(gregorian, at(1301, 6, 21, 3)), rise21, "before today's sunrise: today's");
  assert.equal(dawnAfter(gregorian, at(1301, 6, 21, 12)), rise22, "after it: tomorrow's");
  assert.equal(dawnAfter(gregorian, rise21), rise22, "at it: tomorrow's");
  assert.equal(dawnAfter(gregorian, at(1301, 12, 30, 20), 3), at(1302, 1, 2) + sun(gregorian, at(1302, 1, 2)).sunrise * 3600,
    "three dawns on, across the year's end");
});

// ── Moon ─────────────────────────────────────────────────────────────────────

test("at the epoch the moon is new, and 14.77 days later it is full", () => {
  assert.equal(moonPhase(gregorian, 0).key, "new");
  assert.equal(moonPhase(gregorian, 0).index, 0);
  assert.equal(moonPhase(gregorian, 0).illumination, 0);
  const full = moonPhase(gregorian, 14.77 * DAY);
  assert.equal(full.key, "full");
  assert.equal(full.index, 4);
  assert.ok(full.illumination > 0.99);
  // The epoch moves the whole cycle.
  const epoch = at(1301, 6, 10);
  assert.equal(moonPhase(gregorian, epoch, epoch).key, "new");
  assert.equal(moonPhase(gregorian, epoch + 14.77 * DAY, epoch).key, "full");
  assert.equal(moonPhase(gregorian, epoch + SYNODIC_DAYS * DAY, epoch).key, "new", "a month later, new again");
  assert.equal(moonPhase(gregorian, epoch - 7.4 * DAY, epoch).key, "lastQuarter", "before the epoch too");
});

// ── Anchors ──────────────────────────────────────────────────────────────────

test("anchor('summerSolstice') is 21 June, at 00:00, every year", () => {
  for (const year of [1299, 1300, 1301, 1302, 1303]) {
    const t = anchor(gregorian, "summerSolstice", year);
    assert.equal(t, at(year, 6, 21), `${year}`);
    assert.equal(t, startOfDay(gregorian, t));
  }
  assert.equal(anchor(gregorian, "springEquinox", 1301), at(1301, 3, 20));
  assert.equal(anchor(gregorian, "autumnEquinox", 1301), at(1301, 9, 22));
  assert.equal(anchor(gregorian, "winterSolstice", 1301), at(1301, 12, 21));
  // The cross-quarters are the midpoints between them.
  assert.equal(anchor(gregorian, "springCrossQuarter", 1301), at(1301, 5, 5));
  assert.equal(anchor(gregorian, "summerCrossQuarter", 1301), at(1301, 8, 7));
  assert.equal(anchor(gregorian, "autumnCrossQuarter", 1301), at(1301, 11, 6));
  assert.equal(anchor(gregorian, "winterCrossQuarter", 1301), at(1301, 2, 4));
  assert.equal(anchor(gregorian, "midsummer", 1301), null, "an unknown name");
});

test("an anchor falls on the date the calendar shows, whatever core does with leap days", () => {
  // Core v14 shows 29 February a year early and 1 January twice (quirkyGregorian).
  for (const year of [1299, 1300, 1301]) {
    for (const name of Object.keys(ANCHORS)) {
      const t = anchor(quirkyGregorian, name, year);
      assert.equal(shows(quirkyGregorian, t), `${year}-${ANCHORS[name].month}-${ANCHORS[name].day}`, `${name} ${year}`);
    }
    // And the solstices still give exactly 15 and 9 hours on the days shown.
    assert.deepEqual(sun(quirkyGregorian, anchor(quirkyGregorian, "summerSolstice", year)), { sunrise: 4.5, sunset: 19.5 });
    assert.deepEqual(sun(quirkyGregorian, anchor(quirkyGregorian, "winterSolstice", year)), { sunrise: 7.5, sunset: 16.5 });
  }
});

test("the last full moon of the year falls in its last 29.53 days", () => {
  for (const epoch of [0, at(1301, 6, 10, 7)]) {
    for (const year of [1300, 1301, 1302]) {
      const end = at(year + 1, 1, 1);
      const t = anchor(gregorian, "lastFullMoon", year, epoch);
      assert.ok(t < end && t >= end - SYNODIC_DAYS * DAY, `${year}: ${shows(gregorian, t)}`);
      assert.equal(t, startOfDay(gregorian, t));
      // The full moon itself is within that day.
      const peak = [...Array(24).keys()].map((h) => moonPhase(gregorian, t + h * 3600, epoch).fraction);
      assert.ok(peak.some((f) => Math.abs(f - 0.5) < 1 / SYNODIC_DAYS / 2), `${year}: full that day`);
    }
  }
});

test("another calendar puts the anchors at the same fraction of its year", () => {
  const ten = {
    ...gregorian,
    months: { values: Array.from({ length: 10 }, (_, i) => ({ name: `M${i}`, ordinal: i + 1, days: 36 })) },
    componentsToTime: ({ year = 0, day = 0 }) => (year * 360 + day) * DAY,
    timeToComponents: (t) => ({ year: Math.floor(t / DAY / 360), day: Math.floor(t / DAY) % 360 }),
  };
  assert.equal(anchor(ten, "summerSolstice", 2), (2 * 360 + Math.round((171 / 365) * 360)) * DAY);
});

// ── Seasons and crossings ────────────────────────────────────────────────────

test("seasons come from the core calendar's months, and Fall is autumn", () => {
  assert.deepEqual(season(gregorian, at(1301, 2, 28)), { key: "winter", index: 3, name: "CALENDAR.GREGORIAN.Winter" });
  assert.equal(season(gregorian, at(1301, 3, 1)).key, "spring");
  assert.equal(season(gregorian, at(1301, 6, 1)).key, "summer");
  assert.equal(season(gregorian, at(1301, 9, 1)).key, "autumn");
  assert.equal(season({ ...gregorian, seasons: { values: [] } }, at(1301, 9, 1)).key, null);
});

test("a season's key comes from where it falls in the year, not from its name", () => {
  // The same months as core's seasons, under other names.
  const names = ["Thaw", "Highsun", "Harvest", "Snowfall"];
  const renamed = { ...gregorian, seasons: { values: gregorian.seasons.values.map((s, i) => ({ ...s, name: names[i] })) } };
  assert.deepEqual([3, 6, 9, 12].map((m) => season(renamed, at(1301, m, 10)).key), ["spring", "summer", "autumn", "winter"]);
  // By days instead of months: days 335 to 59 are December to February.
  const byDay = { ...gregorian, seasons: { values: [{ name: "Snowfall", dayStart: 335, dayEnd: 59 }] },
    timeToComponents: (t) => ({ ...gregorian.timeToComponents(t), season: 0 }) };
  assert.equal(season(byDay, at(1301, 1, 10)).key, "winter");
  // Neither months nor days: only then does the name decide.
  const bare = { ...byDay, seasons: { values: [{ name: "Late Summer" }] } };
  assert.equal(season(bare, at(1301, 1, 10)).key, "summer");
});

test("28 February to 1 March reports winter to spring", () => {
  const out = crossings(gregorian, at(1301, 2, 28, 20), at(1301, 3, 1, 8));
  assert.deepEqual(out.seasons, [{ from: "winter", to: "spring", at: at(1301, 3, 1) }]);
  assert.equal(out.seasonChanges, 1);
  assert.equal(out.days, 1);
  assert.equal(out.dawns, 1);
  assert.equal(out.dusks, 0);
});

test("Sunday 23:00 plus 10 days reports weeks: 2", () => {
  // Weekday 0 is Monday on core's calendar, so a week starts Monday 00:00.
  let sunday = at(1301, 6, 1, 23);
  while (gregorian.timeToComponents(sunday).dayOfWeek !== 6) sunday += DAY;
  const out = crossings(gregorian, sunday, sunday + 10 * DAY);
  assert.equal(out.weeks, 2);
  assert.equal(out.days, 10);
  assert.equal(out.dawns, 10);
  assert.equal(out.dusks, 10);
  assert.equal(crossings(gregorian, sunday - 22 * 3600, sunday).weeks, 0, "within one week");
});

test("a move backwards, or none, crosses nothing", () => {
  const none = { days: 0, weeks: 0, seasons: [], seasonChanges: 0, dawns: 0, dusks: 0 };
  assert.deepEqual(crossings(gregorian, at(1301, 3, 2), at(1301, 2, 20)), none);
  assert.deepEqual(crossings(gregorian, at(1301, 3, 2), at(1301, 3, 2)), none);
  // A tick of the real-time clock inside one day crosses nothing either.
  assert.deepEqual(crossings(gregorian, at(1301, 3, 2, 10), at(1301, 3, 2, 10) + 6), none);
});

test("a year's jump crosses four seasons and its sunrises", () => {
  const out = crossings(gregorian, at(1301, 1, 15), at(1302, 1, 15));
  assert.deepEqual(out.seasons.map((s) => `${s.from}>${s.to}`), ["winter>spring", "spring>summer", "summer>autumn", "autumn>winter"]);
  assert.equal(out.seasonChanges, 4);
  assert.equal(out.days, 365);
  assert.equal(out.dawns, 365);
  assert.equal(out.dusks, 365);
});

test("season changes land on the 1st the calendar shows, even in core's leap-year display", () => {
  for (const year of [1299, 1300, 1301]) {
    const out = crossings(quirkyGregorian, at(year, 1, 15), at(year + 1, 1, 15));
    assert.deepEqual(out.seasons.map((s) => shows(quirkyGregorian, s.at)), [3, 6, 9, 12].map((m) => `${year}-${m}-1`), `${year}`);
  }
});

test("a jump of 1300 years is quick, counts everything, and lists only the last year's seasons", () => {
  const from = at(0, 1, 15), to = at(1300, 1, 15);
  const started = performance.now();
  const out = crossings(gregorian, from, to);
  const took = performance.now() - started;
  assert.ok(took < 500, `took ${Math.round(took)} ms`);
  const days = (to - from) / DAY;
  assert.equal(out.days, days);
  assert.equal(out.dawns, days);
  assert.equal(out.dusks, days);
  assert.equal(out.weeks, Math.floor((days + 14) / 7) - Math.floor(14 / 7), "worldTime 0 is a Monday, 15 January is day 14");
  assert.equal(out.seasonChanges, 1300 * 4);
  assert.deepEqual(out.seasons.map((s) => `${s.from}>${s.to}@${shows(gregorian, s.at)}`),
    ["winter>spring@1299-3-1", "spring>summer@1299-6-1", "summer>autumn@1299-9-1", "autumn>winter@1299-12-1"]);
});

test("dateParts: weekday and month as the calendar names them, the day from 1, HH:MM", () => {
  assert.deepEqual(dateParts(gregorian, at(1301, 6, 21, 14, 5)), {
    weekday: `CALENDAR.GREGORIAN.${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][gregorian.timeToComponents(at(1301, 6, 21)).dayOfWeek]}`,
    day: 21, month: "CALENDAR.GREGORIAN.June", year: 1301, time: "14:05",
  });
  assert.equal(dateParts({ ...gregorian, years: { ...gregorian.years, yearZero: 1000 } }, at(301, 1, 1)).year, 1301, "yearZero is added");
});

// ── The Foundry wrapper, against a stubbed game ──────────────────────────────

function stubGame(t, { gm = true, active = true } = {}) {
  const calls = [], handlers = {};
  globalThis.CONFIG = { queries: {} };
  globalThis.Hooks = {
    on: (name, fn) => { handlers[name] = fn; },
    callAll: (name, payload) => calls.push({ name, payload }),
  };
  const user = { id: "u1", isGM: gm };
  globalThis.game = {
    time: clockAt(t),
    user,
    users: { activeGM: active ? user : { id: "u2" } },
    settings: { get: () => 0 },
    i18n: {
      localize: (k) => k.replace("CALENDAR.GREGORIAN.", ""),
      format: (k, data) => (k === "SDE.time.format" ? "{weekday}, {day} {month} {year}, {time}" : k).replace(/\{(\w+)\}/g, (_, n) => data[n]),
    },
  };
  return { calls, handlers };
}

test("the API reads Foundry's clock: now, season, sun, moon, anchor, format", async () => {
  const { timeApi } = await import("../scripts/time/time.mjs");
  const t = at(1301, 6, 21, 14, 30);
  stubGame(t);
  const weekday = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][gregorian.timeToComponents(t).dayOfWeek];
  assert.equal(timeApi.format(), `${weekday}, 21 June 1301, 14:30`);
  assert.equal(timeApi.now().worldTime, t);
  assert.equal(timeApi.now().label, `${weekday}, 21 June 1301, 14:30`);
  assert.equal(timeApi.now().components.month, 5);
  assert.deepEqual(timeApi.season(), { key: "summer", index: 1, name: "Summer" });
  assert.deepEqual(timeApi.sun(), { sunrise: 4.5, sunset: 19.5 });
  assert.equal(timeApi.isNight(), false);
  assert.equal(timeApi.isNight(at(1301, 6, 21, 22)), true, "a time can be given");
  assert.equal(timeApi.anchor("summerSolstice"), at(1301, 6, 21), "this year by default");
  assert.equal(timeApi.anchor("summerSolstice", 1300), at(1300, 6, 21));
  assert.equal(timeApi.moonPhase(0).key, "new");
});

test("timeAdvanced fires on the active GM only, with what the move crossed and the off-duty reason", async () => {
  const { registerTimeHooks } = await import("../scripts/time/time.mjs");
  const from = at(1301, 2, 28, 20), to = at(1301, 3, 1, 8);
  const { calls, handlers } = stubGame(to);
  registerTimeHooks();
  handlers.updateWorldTime(to, to - from, { "shadowdark-enhancer": { offDuty: "downtime" } }, "u1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "shadowdark-enhancer.timeAdvanced");
  assert.deepEqual(calls[0].payload, {
    from, to, dt: to - from, offDuty: "downtime",
    crossed: {
      days: 1, weeks: calls[0].payload.crossed.weeks, dawns: 1, dusks: 0,
      seasons: [{ from: "winter", to: "spring", at: at(1301, 3, 1) }], seasonChanges: 1,
    },
  });
  handlers.updateWorldTime(to, 60, {}, "u1");
  assert.equal(calls[1].payload.offDuty, null, "an ordinary move");

  const other = stubGame(to, { active: false });
  registerTimeHooks();
  other.handlers.updateWorldTime(to, 60, {}, "u2");
  assert.equal(other.calls.length, 0, "another GM's client stays quiet");
});

test("timeAdvanced for a clock set back, and for a first set from 0 to the year 1300", async () => {
  // game.time.set and game.time.advance both reach updateWorldTime as (worldTime, dt).
  const { registerTimeHooks } = await import("../scripts/time/time.mjs");
  const later = at(1301, 3, 5, 12), earlier = at(1301, 2, 20, 12);
  let { calls, handlers } = stubGame(earlier);
  registerTimeHooks();
  handlers.updateWorldTime(earlier, earlier - later, {}, "u1");   // set back 13 days
  assert.equal(calls.length, 1, "a move back still fires");
  assert.deepEqual(calls[0].payload, {
    from: later, to: earlier, dt: earlier - later, offDuty: null,
    crossed: { days: 0, weeks: 0, seasons: [], seasonChanges: 0, dawns: 0, dusks: 0 },
  });

  const year1300 = at(1300, 1, 1);
  ({ calls, handlers } = stubGame(year1300));
  registerTimeHooks();
  const started = performance.now();
  handlers.updateWorldTime(year1300, year1300, {}, "u1");         // set from worldTime 0
  assert.ok(performance.now() - started < 500);
  const { crossed } = calls[0].payload;
  assert.equal(crossed.days, year1300 / DAY);
  assert.equal(crossed.seasonChanges, 1300 * 4, "four a year, years 0 to 1299");
  assert.equal(crossed.seasons.length, 4);
});

test("Session Recap's entry stamp carries the in-game time", async () => {
  const { SessionRecap } = await import("../scripts/session-recap/session-recap.mjs");
  const t = at(1301, 6, 21, 9, 15);
  stubGame(t);
  const stamp = SessionRecap._stamp();
  assert.equal(stamp.worldTime, t);
  assert.match(stamp.gameTime, /^\w+day, 21 June 1301, 09:15$/);
  assert.ok(Number.isFinite(stamp.timestamp) && stamp.time, "the real time is still there");
  delete globalThis.game.time;
  const bare = SessionRecap._stamp();
  assert.deepEqual([bare.worldTime, bare.gameTime], [null, null], "no clock: the keys are there, empty");
});
