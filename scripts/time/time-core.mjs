/**
 * Shadowdark Enhancer — time, the pure part (#227, Overland O1).
 *
 * Core Foundry's world clock is the one clock. This file only reads it: every
 * function takes the world calendar (`game.time.calendar`, a CalendarData) and
 * a worldTime in seconds. time.mjs supplies both.
 *
 * Foundry 13 and 14: only calls both versions have are used, which are
 * `timeToComponents`, `componentsToTime` and the calendar's config fields.
 * The two calendar calls 14 added are kept out of the whole module by a test
 * (test/time.test.mjs), which is why they are not named here.
 *
 * Nothing assumes Gregorian. Weekdays, months, seasons and the length of a day
 * come from the calendar. The anchors are Gregorian dates; a calendar without
 * twelve months puts them at the same fraction of its year.
 *
 * Design: docs/plans/overland.md §3.1–3.5.
 *
 * `daylightHours` is ported from Calendaria 1.4.2
 * (scripts/data/calendaria-calendar.mjs, #computeSinusoidalDaylight).
 * MIT License, Copyright (c) 2025 3 Death Saves. See CREDITS.md.
 */

/** Days from one new moon to the next. */
export const SYNODIC_DAYS = 29.530588853;

/** The eight phases, by `moonPhase().index`: 0 is new, 4 is full. */
export const MOON_PHASES = [
  "new", "waxingCrescent", "firstQuarter", "waxingGibbous",
  "full", "waningGibbous", "lastQuarter", "waningCrescent",
];

/**
 * The solar anchors as Gregorian month and day. The equinoxes and solstices
 * are their usual northern dates; each cross-quarter is the midpoint between
 * its neighbours. `lastFullMoon` is the other anchor, worked out by `anchor`.
 */
export const ANCHORS = {
  springEquinox: { month: 3, day: 20 },
  springCrossQuarter: { month: 5, day: 5 },
  summerSolstice: { month: 6, day: 21 },
  summerCrossQuarter: { month: 8, day: 7 },
  autumnEquinox: { month: 9, day: 22 },
  autumnCrossQuarter: { month: 11, day: 6 },
  winterSolstice: { month: 12, day: 21 },
  winterCrossQuarter: { month: 2, day: 4 },
};

const GREGORIAN_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ponytail: one latitude for the whole world, 9 hours of daylight at the winter
// solstice and 15 at the summer one (on a 24-hour day). A setting when a table
// asks for another.
const SHORTEST_DAY = 9, LONGEST_DAY = 15;

const hoursPerDay = (cal) => cal?.days?.hoursPerDay ?? 24;

/** Seconds in one day of the calendar (86400 without one). */
export function secondsPerDay(cal) {
  const d = cal?.days;
  return d ? d.hoursPerDay * d.minutesPerHour * d.secondsPerMinute : 86400;
}

/** Whole days since worldTime 0. A day starts at 00:00. */
export const absDay = (cal, t) => Math.floor(t / secondsPerDay(cal));

/** The worldTime of the 00:00 that starts `t`'s day. */
export const startOfDay = (cal, t) => absDay(cal, t) * secondsPerDay(cal);

/** The hour of the day at `t`, with its fraction (14:30 is 14.5). */
export const hourOfDay = (cal, t) => (t - startOfDay(cal, t)) / (secondsPerDay(cal) / hoursPerDay(cal));

/** A year's first and last-plus-one second, as core counts years. */
function yearBounds(cal, year) {
  return [cal.componentsToTime({ year }), cal.componentsToTime({ year: year + 1 })];
}

/**
 * The season at `t`: core's own `components.season`, which the Gregorian
 * calendar matches by month (spring is March to May). `key` is `spring`,
 * `summer`, `autumn` or `winter` (core's "Fall" is `autumn`), or null for a
 * season named otherwise. `name` is the calendar's, unlocalised.
 * @returns {{key:string|null, index:number|null, name:string|null}}
 */
export function season(cal, t) {
  const index = cal.timeToComponents(t).season;
  const s = cal.seasons?.values?.[index];
  if (!s) return { key: null, index: null, name: null };
  const word = /spring|summer|autumn|fall|winter/i.exec(s.name)?.[0].toLowerCase() ?? null;
  return { key: word === "fall" ? "autumn" : word, index, name: s.name };
}

/** The 00:00 of a solar anchor's day in `year`. */
function solarAnchor(cal, name, year) {
  const a = ANCHORS[name], spd = secondsPerDay(cal);
  const [start, end] = yearBounds(cal, year);
  const months = cal.months?.values ?? [];
  if (months.length !== 12) {
    // Another calendar: the same fraction of its year.
    const gregorian = GREGORIAN_MONTH_DAYS.slice(0, a.month - 1).reduce((sum, d) => sum + d, 0) + a.day - 1;
    return start + Math.round((gregorian / 365) * ((end - start) / spd)) * spd;
  }
  // Twelve months: the day the calendar itself SHOWS as that month and day,
  // read back rather than counted. Core puts leap days where its own
  // timeToComponents says, which is not always where isLeapYear says (v14.368
  // shows Feb 29 in the year before a 366-day year and 1 January twice in it),
  // and a holiday has to fall on the date the GM sees.
  const day = Math.min(a.day, months[a.month - 1].days) - 1;
  const guess = months.slice(0, a.month - 1).reduce((sum, m) => sum + m.days, 0) + day;
  for (const off of [0, 1, -1, 2, -2]) {
    const t = start + (guess + off) * spd;
    const c = cal.timeToComponents(t);
    if (c.year === year && c.month === a.month - 1 && c.dayOfMonth === day) return t;
  }
  return start + guess * spd;
}

/**
 * The worldTime of the 00:00 an anchor falls on in `year` (core's count,
 * `components.year`). Names: the keys of ANCHORS, and `lastFullMoon`, the day
 * of the last full moon that falls in the year. Null for an unknown name, or
 * for a year too short to hold a full moon.
 */
export function anchor(cal, name, year, epoch = 0) {
  if (name === "lastFullMoon") {
    const [start, end] = yearBounds(cal, year);
    const month = SYNODIC_DAYS * secondsPerDay(cal);
    // Full moons fall at epoch + (k + ½) months: take the last k before the year ends.
    const k = Math.ceil((end - epoch) / month - 0.5) - 1;
    const full = epoch + (k + 0.5) * month;
    return full >= start ? startOfDay(cal, full) : null;
  }
  return ANCHORS[name] ? solarAnchor(cal, name, year) : null;
}

/**
 * Hours of daylight on a day of the year: a half cosine from the winter
 * solstice up to the summer one and another back down, so both solstices are
 * exact. Ported from Calendaria (see the file header).
 */
export function daylightHours(dayOfYear, yearDays, winter, summer, shortest, longest) {
  const sinceWinter = (dayOfYear - winter + yearDays) % yearDays;
  const between = (summer - winter + yearDays) % yearDays;
  const progress = sinceWinter <= between
    ? sinceWinter / between
    : 1 - (sinceWinter - between) / (yearDays - between);
  return shortest + (longest - shortest) * ((1 - Math.cos(progress * Math.PI)) / 2);
}

/**
 * Sunrise and sunset on `t`'s day, in hours with their fraction, centred on
 * noon: 04:30 to 19:30 on 21 June, 07:30 to 16:30 on 21 December, about 06:00
 * to 18:00 at the equinoxes.
 * @returns {{sunrise:number, sunset:number}}
 */
export function sun(cal, t) {
  const { year } = cal.timeToComponents(t);
  const [start, end] = yearBounds(cal, year);
  // Days counted on the clock from the year's start, so the solstice anchors
  // (the dates the calendar shows) land on exactly 9 and 15 hours.
  const dayOf = (time) => absDay(cal, time) - absDay(cal, start);
  const scale = hoursPerDay(cal) / 24;
  const light = daylightHours(dayOf(t), dayOf(end),
    dayOf(solarAnchor(cal, "winterSolstice", year)), dayOf(solarAnchor(cal, "summerSolstice", year)),
    SHORTEST_DAY * scale, LONGEST_DAY * scale);
  const noon = hoursPerDay(cal) / 2;
  return { sunrise: noon - light / 2, sunset: noon + light / 2 };
}

/** Is it night at `t`: before sunrise, or from sunset on. */
export function isNight(cal, t) {
  const { sunrise, sunset } = sun(cal, t);
  const hour = hourOfDay(cal, t);
  return hour < sunrise || hour >= sunset;
}

/**
 * The moon at `t`, counted in synodic months from `epoch`, a worldTime at
 * which the moon was new. `fraction` runs 0 to 1 through one month;
 * `illumination` is the lit part of the disc, 0 to 1.
 * @returns {{index:number, key:string, fraction:number, illumination:number}}
 */
export function moonPhase(cal, t, epoch = 0) {
  const months = (t - epoch) / secondsPerDay(cal) / SYNODIC_DAYS;
  const fraction = ((months % 1) + 1) % 1;
  const index = Math.round(fraction * 8) % 8;
  return { index, key: MOON_PHASES[index], fraction, illumination: (1 - Math.cos(2 * Math.PI * fraction)) / 2 };
}

/**
 * What a clock move from `from` to `to` crossed, counting what falls in
 * (from, to]: midnights (`days`), week starts (`weeks`, a week starting at
 * weekday 0, 00:00, which is Monday on core's Gregorian calendar), season
 * changes, sunrises (`dawns`) and sunsets (`dusks`). A move backwards, or no
 * move, crosses nothing.
 * @returns {{days:number, weeks:number, seasons:Array<{from:string|null, to:string|null, at:number}>, dawns:number, dusks:number}}
 */
export function crossings(cal, from, to) {
  const out = { days: 0, weeks: 0, seasons: [], dawns: 0, dusks: 0 };
  if (!(to > from)) return out;
  const spd = secondsPerDay(cal), perHour = spd / hoursPerDay(cal);
  const first = absDay(cal, from), last = absDay(cal, to);
  const week = cal.days?.values?.length || 7, offset = cal.years?.firstWeekday ?? 0;
  out.days = last - first;
  out.weeks = Math.floor((last + offset) / week) - Math.floor((first + offset) / week);
  // ponytail: a few calendar reads per day crossed, so a ten-year jump is
  // ~15,000 of them (milliseconds). Step by month if a table jumps centuries.
  let was = season(cal, from);
  for (let d = first; d <= last; d++) {
    const dayStart = d * spd;
    if (d > first) {
      const now = season(cal, dayStart);
      if (now.index !== was.index) out.seasons.push({ from: was.key, to: now.key, at: dayStart });
      was = now;
    }
    const { sunrise, sunset } = sun(cal, dayStart);
    const rise = dayStart + sunrise * perHour, set = dayStart + sunset * perHour;
    if (rise > from && rise <= to) out.dawns++;
    if (set > from && set <= to) out.dusks++;
  }
  return out;
}

/**
 * The pieces of the date string: weekday and month as the calendar names them
 * (localisation keys on core's calendar), the day of the month from 1, the
 * year as shown (core's count plus the calendar's `yearZero`), and HH:MM.
 */
export function dateParts(cal, t) {
  const c = cal.timeToComponents(t);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    weekday: cal.days?.values?.[c.dayOfWeek]?.name ?? "",
    day: c.dayOfMonth + 1,
    month: cal.months?.values?.[c.month]?.name ?? "",
    year: c.year + (cal.years?.yearZero ?? 0),
    time: `${pad(c.hour)}:${pad(c.minute)}`,
  };
}
