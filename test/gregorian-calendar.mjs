// A stand-in for Foundry's world calendar in Node tests (not a test file
// itself): core's Simplified Gregorian as its config describes it. Leap years
// from year 8, every 4th; weekday 0 is Monday; seasons by month. Only the calls
// Foundry 13 and 14 both have. Written for the tests, not copied from Foundry.

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY = 86400;

const isLeapYear = (y) => y >= 8 && (y - 8) % 4 === 0;
const yearDays = (y) => (isLeapYear(y) ? 366 : 365);
const monthDays = (m, leap) => (m === 1 && leap ? 29 : MONTH_DAYS[m]);

export const gregorian = {
  years: { yearZero: 0, firstWeekday: 0, leapYear: { leapStart: 8, leapInterval: 4 } },
  months: {
    values: MONTHS.map((m, i) => ({ name: `CALENDAR.GREGORIAN.${m}`, ordinal: i + 1, days: MONTH_DAYS[i], ...(i === 1 ? { leapDays: 29 } : {}) })),
  },
  days: {
    values: WEEKDAYS.map((d, i) => ({ name: `CALENDAR.GREGORIAN.${d}`, ordinal: i + 1 })),
    daysPerYear: 365, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60,
  },
  seasons: {
    values: [
      { name: "CALENDAR.GREGORIAN.Spring", monthStart: 3, monthEnd: 5 },
      { name: "CALENDAR.GREGORIAN.Summer", monthStart: 6, monthEnd: 8 },
      { name: "CALENDAR.GREGORIAN.Fall", monthStart: 9, monthEnd: 11 },
      { name: "CALENDAR.GREGORIAN.Winter", monthStart: 12, monthEnd: 2 },
    ],
  },
  isLeapYear,
  componentsToTime({ year = 0, day = 0, hour = 0, minute = 0, second = 0 } = {}) {
    let days = day;
    for (let y = 0; y < year; y++) days += yearDays(y);
    return days * DAY + hour * 3600 + minute * 60 + second;
  },
  timeToComponents(t = 0) {
    let year = 0, rest = t;
    while (rest >= yearDays(year) * DAY) rest -= yearDays(year++) * DAY;
    const day = Math.floor(rest / DAY);
    rest -= day * DAY;
    return { year, day, ...monthOf(day, isLeapYear(year)), dayOfWeek: (Math.floor(t / DAY) + this.years.firstWeekday) % 7,
      hour: Math.floor(rest / 3600), minute: Math.floor((rest % 3600) / 60), second: rest % 60, leapYear: isLeapYear(year) };
  },
};

function monthOf(day, leap) {
  let month = 0, dayOfMonth = day;
  while (month < 11 && dayOfMonth >= monthDays(month, leap)) dayOfMonth -= monthDays(month++, leap);
  const ordinal = month + 1;
  const season = gregorian.seasons.values.findIndex((s) => (s.monthStart <= s.monthEnd
    ? ordinal >= s.monthStart && ordinal <= s.monthEnd
    : ordinal >= s.monthStart || ordinal <= s.monthEnd));
  return { month, dayOfMonth, season };
}

/**
 * The same calendar with core v14's leap-year display: a 366-day year shows
 * 1 January twice and no 29 February, and the year before it shows a
 * 29 February and no 31 December. Year lengths are unchanged.
 */
export const quirkyGregorian = {
  ...gregorian,
  timeToComponents(t = 0) {
    const c = gregorian.timeToComponents(t);
    if (isLeapYear(c.year)) return { ...c, ...monthOf(Math.max(c.day - 1, 0), false), day: Math.max(c.day - 1, 0) };
    if (isLeapYear(c.year + 1)) return { ...c, ...monthOf(c.day, true) };
    return c;
  },
};

/** The worldTime of a date as printed: month and day from 1. */
export function at(year, month, day, hour = 0, minute = 0) {
  let doy = day - 1;
  for (let m = 0; m < month - 1; m++) doy += monthDays(m, isLeapYear(year));
  return gregorian.componentsToTime({ year, day: doy, hour, minute });
}

/** A `game.time` over the stand-in calendar, at `t`. */
export const clockAt = (t, calendar = gregorian) => ({
  calendar, worldTime: t, get components() { return calendar.timeToComponents(t); },
});
