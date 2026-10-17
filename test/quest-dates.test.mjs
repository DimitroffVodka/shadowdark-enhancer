// The date boxes of the Quest Log: every day of 1348 to 1352 through dateToTime and core's own conversion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateToTime } from "../scripts/overland/hud-core.mjs";
import { lastDayPrinted, timeToDate } from "../scripts/quests/quest-core.mjs";
import { quirkyGregorian as cal } from "./gregorian-calendar.mjs";

const DAY = 86400;
const label = ({ year, month, day }) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Days that do not survive: a day read from core and typed back, and a printed date that finds no day. */
function sweep() {
  const from = cal.componentsToTime({ year: 1348 }), to = cal.componentsToTime({ year: 1353 });
  const lost = [], missing = [];
  for (let t = from; t < to; t += DAY) {
    const d = timeToDate(cal, t);
    if (dateToTime(cal, d) !== t) lost.push(label(d));
  }
  for (let year = 1348; year <= 1352; year++) {
    cal.months.values.forEach((m, i) => {
      const days = m.days + (m.leapDays && cal.isLeapYear(year) ? 1 : 0);
      for (let day = 1; day <= days; day++) {
        const got = dateToTime(cal, { year, month: i + 1, day });
        if (got === null || label(timeToDate(cal, got)) !== label({ year, month: i + 1, day })) missing.push(label({ year, month: i + 1, day }));
      }
    });
  }
  return { lost, missing };
}

test("a day read from core and typed back lands on itself, except the leap-year doubles", () => {
  const { lost } = sweep();
  // The doubled 1 January of each leap year: the second of its two days reads back as the first.
  assert.deepEqual(lost, ["1348-01-01", "1352-01-01"]);
});

test("a printed date finds its day, except the days core does not print around a leap year (29 February, and 31 December before it)", () => {
  const { missing } = sweep();
  assert.deepEqual(missing, ["1348-02-29", "1351-12-31", "1352-02-29"]);
});

test("a date with no day answers null, never a wrong time", () => {
  assert.equal(dateToTime(cal, { year: 1348, month: 2, day: 29 }), null);
  assert.equal(dateToTime(cal, { year: 1349, month: 2, day: 30 }), null);
  assert.equal(dateToTime(cal, { year: 1349, month: 13, day: 1 }), null);
});

test("a deadline typed as the doubled first day of a leap year is the second of the two days", () => {
  const typed = dateToTime(cal, { year: 1352, month: 1, day: 1 });
  const last = lastDayPrinted(cal, typed, DAY);
  assert.equal(last, typed + DAY);
  assert.equal(label(timeToDate(cal, last)), "1352-01-01");
  assert.equal(label(timeToDate(cal, last + DAY)), "1352-01-02");
  // An ordinary day is unchanged.
  const plain = dateToTime(cal, { year: 1351, month: 6, day: 10 });
  assert.equal(lastDayPrinted(cal, plain, DAY), plain);
  // "Appears on" is not advanced: the helper is for deadlines only, and the typed time stays the first day.
  assert.equal(label(timeToDate(cal, typed)), "1352-01-01");
});
