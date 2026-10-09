// The calendar's pure half: the sky's days (equinoxes, solstices, eclipses), the
// entries list, and what falls on a day of the month view.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENTRY_KINDS, MAX_ENTRIES, cleanEntry, dayEvents, eclipsesOn, paragraphs, solarOn, withEntry, withoutEntry,
} from "../scripts/calendar/calendar-core.mjs";
import { ECLIPSES, NEW_MOON, SEASON_DAYS } from "../scripts/calendar/eclipse-data.mjs";
import { monthGrid, dateToTime } from "../scripts/overland/hud-core.mjs";
import { moonPhase, secondsPerDay } from "../scripts/time/time-core.mjs";
import { defaultMoonEpoch } from "../scripts/time/time.mjs";
import { holidayEffects } from "../scripts/holidays/holidays.mjs";
import { gregorian, at } from "./gregorian-calendar.mjs";

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
