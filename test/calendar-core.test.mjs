// The calendar's pure half: the sky's days (equinoxes, solstices, eclipses), the
// entries list, and what falls on a day of the month view.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENTRY_KINDS, MAX_ENTRIES, cleanEntry, customCalendar, dayEvents, eclipsesOn, paragraphs, solarAt, solarOn, withEntry, withRows, withoutEntry,
} from "../scripts/calendar/calendar-core.mjs";
import { ECLIPSES, NEW_MOON, SEASON_DAYS } from "../scripts/calendar/eclipse-data.mjs";
import { monthGrid, dateToTime } from "../scripts/overland/hud-core.mjs";
import { moonPhase, season, secondsPerDay } from "../scripts/time/time-core.mjs";
import { defaultMoonEpoch } from "../scripts/time/time.mjs";
import { holidayEffects, whenMatches } from "../scripts/holidays/holidays.mjs";
import { gregorian, at, shaped } from "./gregorian-calendar.mjs";

const DAY = secondsPerDay(gregorian);

test("the equinoxes and solstices are the days the Julian-style calendar shows (1348: 12 March)", () => {
  assert.equal(solarOn(1348, 3, 12), "springEquinox");
  assert.equal(solarOn(1348, 6, 13), "summerSolstice");
  assert.equal(solarOn(1348, 9, 14), "autumnEquinox");
  assert.equal(solarOn(1348, 12, 13), "winterSolstice");
  assert.equal(solarOn(1348, 3, 20), null, "not the Gregorian date");
  assert.equal(solarOn(1348, 4, 12), null);
});

test("past the table the usual northern dates stand in", () => {
  assert.equal(solarOn(1700, 3, 20), "springEquinox");
  assert.equal(solarOn(1700, 6, 21), "summerSolstice");
  assert.equal(solarOn(1700, 3, 12), null);
});

test("the table holds a row for every year 1200 to 1500, with sane days", () => {
  assert.equal(SEASON_DAYS.length, 301);
  SEASON_DAYS.forEach(([year, ...days], i) => {
    assert.equal(year, 1200 + i);
    assert.equal(days.length, 4);
    for (const d of days) assert.ok(d >= 9 && d <= 16, `${year}: ${d}`);
  });
  // The Julian calendar slips against the sun a day in 128 years, so the equinox moves earlier.
  assert.ok(SEASON_DAYS[0][1] > SEASON_DAYS[300][1]);
});

test("eclipses: a day has them or has none, and the table is in order", () => {
  const e = eclipsesOn(1348, 1, 17);
  assert.deepEqual(e, [{ time: "04:19", body: "L", type: "p", percent: 25 }]);
  assert.deepEqual(eclipsesOn(1348, 1, 18), []);
  assert.deepEqual(eclipsesOn(1900, 1, 1), [], "outside the table: none, not a guess");
  const keys = ECLIPSES.map(([y, m, d]) => y * 10000 + m * 100 + d);
  assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
  for (const [, , , time, body, type, percent] of ECLIPSES) {
    assert.match(time, /^\d\d:\d\d$/);
    assert.ok(body === "S" || body === "L");
    assert.ok(["t", "a", "p"].includes(type));
    assert.ok(percent > 0 && percent <= 100);
    if (body === "L") assert.notEqual(type, "a", "no annular eclipse of the Moon");
  }
});

test("the moon's average month, from the shipped new moon, stays within a day of every eclipse", () => {
  const epoch = defaultMoonEpoch(gregorian);
  assert.equal(epoch, dateToTime(gregorian, { year: NEW_MOON[0], month: NEW_MOON[1], day: NEW_MOON[2], hour: Number(NEW_MOON[3].slice(0, 2)), minute: Number(NEW_MOON[3].slice(3)) }));
  const SYNODIC = 29.530588853;
  let worst = 0;
  for (const [y, m, d, time, body] of ECLIPSES) {
    const t = at(y, m, d, Number(time.slice(0, 2)), Number(time.slice(3)));
    const { fraction } = moonPhase(gregorian, t, epoch);
    const target = body === "L" ? 0.5 : 0;               // a lunar eclipse is a full moon, a solar one a new moon
    const off = Math.abs(((fraction - target + 1.5) % 1) - 0.5) * SYNODIC;
    worst = Math.max(worst, off);
  }
  assert.ok(worst < 0.7, `worst miss ${worst.toFixed(2)} days`);
});

test("an entry needs a title and a time, and is trimmed and clamped", () => {
  assert.equal(cleanEntry({ id: "a", at: 10, title: "   " }), null);
  assert.equal(cleanEntry({ id: "a", at: NaN, title: "x" }), null);
  assert.equal(cleanEntry({ at: 10, title: "x" }), null, "no id");
  const e = cleanEntry({ id: "a", at: 10.9, kind: "bogus", title: `  ${"t".repeat(200)} `, text: "x".repeat(3000), gm: 1 });
  assert.equal(e.kind, "note");
  assert.equal(e.at, 10);
  assert.equal(e.title.length, 120);
  assert.equal(e.text.length, 2000);
  assert.equal(e.gm, true);
  assert.equal(e.auto, false);
  for (const kind of ENTRY_KINDS) assert.equal(cleanEntry({ id: "a", at: 1, kind, title: "x" }).kind, kind);
});

test("over the cap, logged lines go first, then the oldest written one", () => {
  const mk = (i, auto = false) => cleanEntry({ id: String(i), at: i, title: `e${i}`, auto });
  let list = [mk(0), mk(1, true)];
  for (let i = 2; list.length < MAX_ENTRIES; i++) list = withEntry(list, mk(i));
  assert.equal(list.length, MAX_ENTRIES);
  let next = withEntry(list, mk(9000));
  assert.equal(next.length, MAX_ENTRIES);
  assert.ok(!next.some((e) => e.id === "1"), "the logged line went");
  assert.ok(next.some((e) => e.id === "0"), "the written one stayed");
  next = withEntry(next, mk(9001));
  assert.equal(next.length, MAX_ENTRIES);
  assert.ok(!next.some((e) => e.id === "0"), "no logged line left: the oldest written one went");
  assert.deepEqual(withoutEntry([mk(1), mk(2)], "1").map((e) => e.id), ["2"]);
});

test("a day lists holidays, the sun, a season's start, eclipses, then entries by hour; players miss GM-only ones", () => {
  const g = monthGrid(gregorian, at(1348, 3, 12, 8), { holidaysOn: (d) => (d.day === 12 ? ["Test Day"] : []) });
  const spd = DAY;
  const cell = (day) => g.cells.find((c) => !c.out && c.day === day);
  const noon = at(1348, 3, 12, 12), morning = at(1348, 3, 12, 6);
  const entries = [
    cleanEntry({ id: "n", at: noon, title: "Noon" }),
    cleanEntry({ id: "m", at: morning, title: "Morning", gm: true }),
    cleanEntry({ id: "x", at: at(1348, 3, 13, 1), title: "Tomorrow" }),
  ];
  const gm = dayEvents({ cell: cell(12), year: g.year, month: g.monthNumber, spd, entries, gm: true });
  assert.deepEqual(gm.map((e) => e.kind), ["holiday", "solar", "entry", "entry"]);
  assert.equal(gm[1].key, "springEquinox");
  assert.deepEqual(gm.slice(2).map((e) => e.entry.id), ["m", "n"], "by hour");
  const player = dayEvents({ cell: cell(12), year: g.year, month: g.monthNumber, spd, entries, gm: false });
  assert.deepEqual(player.filter((e) => e.kind === "entry").map((e) => e.entry.id), ["n"]);
  const first = dayEvents({ cell: cell(1), year: g.year, month: g.monthNumber, spd, entries });
  assert.deepEqual(first.map((e) => e.kind), ["season"], "spring starts on 1 March");
  assert.equal(first[0].index, 0);
});

test("the month view carries the eclipse, and the holiday rule sees the real solstice", () => {
  const jan = monthGrid(gregorian, at(1348, 1, 10));
  const cell = jan.cells.find((c) => !c.out && c.day === 17);
  const ev = dayEvents({ cell, year: jan.year, month: jan.monthNumber, spd: DAY });
  assert.deepEqual(ev.map((e) => [e.kind, e.body, e.type]), [["eclipse", "L", "p"]]);
  const seen = [];
  monthGrid(gregorian, at(1348, 6, 1), { holidaysOn: (d) => { if (d.solar) seen.push([d.day, d.solar]); return []; } });
  assert.deepEqual(seen, [[13, "summerSolstice"]]);
});

test("an imported page becomes plain paragraphs", () => {
  const html = "<h3>Heading</h3>\n<p>Gain +1 to rolls &amp; more.&nbsp;Fine.</p>\n<p>  Two\n spaces </p>";
  assert.deepEqual(paragraphs(html), ["Heading", "Gain +1 to rolls & more. Fine.", "Two spaces"]);
  assert.deepEqual(paragraphs(null), []);
});

test("a holiday's carousing effects come out as lines, in reading order", () => {
  assert.deepEqual(holidayEffects({ eventBonus: 1, benefitBonus: 15 }), [
    { key: "SDE.calendar.effect.eventBonus", n: 1 }, { key: "SDE.calendar.effect.benefitBonus", n: 15 }]);
  const duke = holidayEffects({ eventBonus: 2, benefitAdvantage: true, chances: [{ oneIn: 20, label: "Asked onto the floor" }] });
  assert.deepEqual(duke.map((e) => e.key), ["SDE.calendar.effect.eventBonus", "SDE.calendar.effect.benefitAdvantage", "SDE.calendar.effect.chance"]);
  assert.equal(duke[2].n, 20);
  assert.deepEqual(holidayEffects({ extraBenefit: true }), [{ key: "SDE.calendar.effect.extraBenefit" }]);
  assert.deepEqual(holidayEffects(undefined), []);
});

// ── A GM's own calendar ──────────────────────────────────────────────────────

const month = (name, days) => ({ name, days });
const dolmen = { months: { values: [month("Grimvold", 30), month("Lymewald", 28)] }, days: { values: [{ name: "Colly" }, { name: "Chime" }] } };

test("a calendar of names and lengths becomes a config core can build", () => {
  const { config, error } = customCalendar(dolmen);
  assert.equal(error, undefined);
  assert.equal(config.name, "Custom");
  assert.equal(config.days.daysPerYear, 58, "counted, never trusted: core walks off the months when it is too big");
  assert.deepEqual(config.months.values[1], { name: "Lymewald", abbreviation: "Lym", ordinal: 2, days: 28 });
  assert.deepEqual(config.years, { yearZero: 0, firstWeekday: 0, leapYear: null });
  assert.deepEqual([config.days.hoursPerDay, config.days.minutesPerHour, config.days.secondsPerMinute], [24, 60, 60]);
});

test("a pasted calendar's daysPerYear is recounted and its own fields stay", () => {
  const { config } = customCalendar({
    name: "Pasted", years: { yearZero: 1000, firstWeekday: 2, leapYear: { leapStart: 4, leapInterval: 4 } },
    months: { values: [{ ...month("One", 10), leapDays: 11, abbreviation: "1st" }] },
    days: { values: [{ name: "Day" }], daysPerYear: 400, hoursPerDay: 20 },
    seasons: { values: [{ name: "Always", monthStart: 1, monthEnd: 1 }] },
  });
  assert.equal(config.days.daysPerYear, 10);
  assert.equal(config.days.hoursPerDay, 20);
  assert.equal(config.years.yearZero, 1000);
  assert.deepEqual(config.months.values[0], { name: "One", abbreviation: "1st", ordinal: 1, days: 10, leapDays: 11 });
  assert.deepEqual(config.seasons.values, [{ name: "Always", monthStart: 1, monthEnd: 1 }]);
});

test("what core would throw on, or walk off the end of, never reaches it", () => {
  const bad = (over) => customCalendar({ ...dolmen, ...over }).error;
  for (const raw of [null, {}, "text", [], { months: { values: [] }, days: dolmen.days }]) assert.ok(customCalendar(raw).error, JSON.stringify(raw));
  assert.equal(bad({ months: { values: [month("", 30)] } }), "SDE.calendarEditor.error.months");
  assert.equal(bad({ months: { values: [month("Half", 2.5)] } }), "SDE.calendarEditor.error.months");
  assert.equal(bad({ months: { values: [month("None", 0)] } }), "SDE.calendarEditor.error.months");
  assert.equal(bad({ months: { values: [{ ...month("Odd", 30), leapDays: 1.5 }] } }), "SDE.calendarEditor.error.months");
  assert.equal(bad({ days: { values: [] } }), "SDE.calendarEditor.error.weekdays");
  assert.equal(bad({ days: { values: [{ name: " " }] } }), "SDE.calendarEditor.error.weekdays");
  assert.equal(bad({ days: { values: [{ name: "A" }], hoursPerDay: 0 } }), "SDE.calendarEditor.error.time");
});

test("seasons the GM left out fit a year of any shape and read as the four seasons", () => {
  const { config } = customCalendar({ ...dolmen, months: { values: Array.from({ length: 10 }, (_, i) => month(`M${i + 1}`, 36)) } });
  const cal = shaped(config);
  assert.deepEqual(config.seasons.values.map((s) => [s.dayStart, s.dayEnd]), [[59, 149], [150, 240], [241, 329], [330, 58]]);
  const at = (day) => season(cal, day * secondsPerDay(cal)).key;
  assert.deepEqual([at(0), at(100), at(200), at(300), at(350)], ["winter", "spring", "summer", "autumn", "winter"]);
});

test("the editor's rows replace the months and keep what a row does not show", () => {
  const raw = { name: "Mine", years: { yearZero: 9 },
    months: { values: [{ name: "KEY.Feb", abbreviation: "F", days: 28, leapDays: 29 }, month("Two", 30)] },
    days: { values: [{ name: "KEY.Mon", abbreviation: "M" }], hoursPerDay: 20 },
    seasons: { values: [{ name: "S", monthStart: 1, monthEnd: 2 }] } };
  const shown = (s) => s.replace("KEY.", "");
  const same = withRows(raw, [month("Feb", 28), month("Two", 30)], [{ name: "Mon" }], shown);
  assert.deepEqual(same, { ...raw, months: { values: [raw.months.values[0], month("Two", 30)] }, days: { ...raw.days, values: [{ name: "KEY.Mon", abbreviation: "M" }] } });
  const longer = withRows(raw, [month("Renamed", 31), month("Two", 30)], [{ name: "Sun" }], shown);
  assert.deepEqual(longer.months.values[0], month("Renamed", 31), "a new name and length drop the short name and the leap days");
  assert.deepEqual(longer.days.values, [{ name: "Sun" }]);
  assert.equal(longer.seasons, undefined, "a year of another shape takes fresh seasons");
  assert.equal(longer.days.hoursPerDay, 20);
  assert.equal(longer.years.yearZero, 9);
});

// ── What the calendar shows on one that is not Earth's ───────────────────────

const custom = (months, week = 7) => shaped(customCalendar({
  months: { values: months.map((days, i) => month(`M${i + 1}`, days)) },
  days: { values: Array.from({ length: week }, (_, i) => ({ name: `W${i + 1}` })) },
}).config);
const dayOf = (cal, n) => n * secondsPerDay(cal);

test("no eclipse on a calendar that is not Earth's, though the date matches one", () => {
  const [y, m, d] = ECLIPSES[0];
  const cell = { day: d, at: 0, holidays: [] };
  assert.ok(dayEvents({ cell, year: y, month: m, spd: DAY }).some((e) => e.kind === "eclipse"));
  assert.ok(!dayEvents({ cell, year: y, month: m, spd: DAY, earth: false }).some((e) => e.kind === "eclipse"));
});

test("off Earth the sun's four days are its own anchors, not the 1348 table", () => {
  const cal = custom(Array(12).fill(28));
  const grid = (m) => monthGrid(cal, dayOf(cal, (m - 1) * 28 + 28 * 1348 * 12), { earth: false }).cells.filter((c) => c.solar).map((c) => [c.day, c.solar]);
  assert.deepEqual(grid(3), [[20, "springEquinox"]], "12 March would be the table's");
  assert.deepEqual(grid(6), [[21, "summerSolstice"]]);
  assert.deepEqual(grid(12), [[21, "winterSolstice"]]);
  const ten = custom(Array(10).fill(36));
  const found = Array.from({ length: 360 }, (_, i) => solarAt(ten, dayOf(ten, i), false)).filter(Boolean);
  assert.deepEqual(found.sort(), ["autumnEquinox", "springEquinox", "summerSolstice", "winterSolstice"], "a calendar with no twelfth month still has all four");
});

test("the holiday that follows the sun falls on the anchor of a calendar that has no twelfth month", () => {
  const ten = custom(Array(10).fill(36));
  const day = Array.from({ length: 360 }, (_, i) => dayOf(ten, i)).find((at) => solarAt(ten, at, false) === "summerSolstice");
  assert.ok(whenMatches({ anchor: "summerSolstice" }, { month: 5, day: 28, solar: solarAt(ten, day, false) }));
  assert.ok(!whenMatches({ anchor: "summerSolstice" }, { month: 6, day: 21, solar: null }), "not the Gregorian date");
  assert.ok(whenMatches({ anchor: "springCrossQuarter" }, { month: 5, day: 1, solar: null }), "Maytide is the 1st of the 5th month");
});

test("the month view pages through months of any length, and a long one fills its grid", () => {
  const cal = custom([50, 10, 36], 5);
  const names = [0, 1, 2, 3, 4].map((offset) => monthGrid(cal, 0, { offset, earth: false })).map((g) => [g.month, g.cells.filter((c) => !c.out).length]);
  assert.deepEqual(names, [["M1", 50], ["M2", 10], ["M3", 36], ["M1", 50], ["M2", 10]]);
  assert.deepEqual(monthGrid(cal, dayOf(cal, 55), { offset: -1, earth: false }).month, "M1");
  const one = custom([400]);
  assert.equal(monthGrid(one, 0, { earth: false }).cells.filter((c) => !c.out).length, 400);
  assert.equal(monthGrid(one, 0, { earth: false, offset: 1 }).year, 1);
});

test("a Custom world at the clock's first second can look back a month", () => {
  const cal = custom([30, 30], 7);
  const g = monthGrid(cal, 0, { offset: -1, earth: false });
  assert.equal(g.month, "M2");
  assert.equal(g.year, -1);
  assert.equal(g.cells.length % 7, 0, "the weeks stay whole before second 0");
});

test("a date round-trips through a calendar of another shape, and one it lacks is refused", () => {
  const cal = custom([50, 10, 36], 5);
  assert.equal(dateToTime(cal, { year: 3, month: 2, day: 10 }), dayOf(cal, 3 * 96 + 59));
  assert.equal(dateToTime(cal, { year: 3, month: 2, day: 11 }), null);
  assert.equal(dateToTime(cal, { year: 3, month: 4, day: 1 }), null);
});
