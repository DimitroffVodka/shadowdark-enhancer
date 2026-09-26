/**
 * Shadowdark Enhancer — time, the pure part (#227, Overland O1).
 *
 * Core Foundry's world clock is the one clock. This file only reads it: every
 * function takes the world calendar (`game.time.calendar`, a CalendarData) and
 * a worldTime in seconds. time.mjs supplies both.
 *
 * From the calendar it uses `timeToComponents`, `componentsToTime` and the
 * config fields, and nothing else.
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

const inMonths = (s, ordinal) => (s.monthStart <= s.monthEnd
  ? ordinal >= s.monthStart && ordinal <= s.monthEnd
  : ordinal >= s.monthStart || ordinal <= s.monthEnd);
const byDays = (s) => Number.isInteger(s.dayStart) && Number.isInteger(s.dayEnd);
const byMonths = (s) => Number.isInteger(s.monthStart) && Number.isInteger(s.monthEnd);

/**
 * Where the middle of a season falls in the year, 0 to 1, from the days or
 * months the calendar gives it; null when it gives neither.
 */
function seasonMiddle(cal, s) {
  const yearDays = cal.days.daysPerYear;
  const months = cal.months?.values ?? [];
  let start, end;
  if (byDays(s)) [start, end] = [s.dayStart - 1, s.dayEnd];
  else if (byMonths(s) && months.length) {
    const before = (ordinal) => months.filter((m) => m.ordinal < ordinal).reduce((sum, m) => sum + m.days, 0);
    start = before(s.monthStart);
    end = before(s.monthEnd) + (months.find((m) => m.ordinal === s.monthEnd)?.days ?? 0);
  } else return null;
  if (end <= start) end += yearDays;     // a season across the new year
  return ((start + end) / 2 / yearDays) % 1;
}

const SEASON_KEYS = ["winter", "spring", "summer", "autumn"];

/**
 * The season at `t`: core's own `components.season`, which the Gregorian
 * calendar matches by month (spring is March to May). `key` is `spring`,
 * `summer`, `autumn` or `winter`, by where the season's middle falls in the
 * year (in December to February is winter, and so on), so core's "Fall" is
 * `autumn` and a season called "Snowfall" in the dead of winter is `winter`.
 * Only a season with neither months nor days is keyed by its name, or null.
 * `name` is the calendar's, unlocalised.
 * @returns {{key:string|null, index:number|null, name:string|null}}
 */
export function season(cal, t) {
  const index = cal.timeToComponents(t).season;
  const s = cal.seasons?.values?.[index];
  if (!s) return { key: null, index: null, name: null };
  const middle = seasonMiddle(cal, s);
  if (middle !== null) return { key: SEASON_KEYS[Math.floor(((middle + 1 / 12) % 1) * 4)], index, name: s.name };
  const word = /spring|summer|autumn|fall|winter/i.exec(s.name)?.[0].toLowerCase() ?? null;
  return { key: word === "fall" ? "autumn" : word, index, name: s.name };
}

/**
 * The 00:00 of the first day after `t`'s whose season differs, or null when
 * the season never ends (or `t` has none). Counted from the season's months or
 * days, then read back like the anchors, so it is the day the calendar shows.
 */
function nextSeasonChange(cal, t) {
  const c = cal.timeToComponents(t);
  const s = cal.seasons?.values?.[c.season];
  if (!s) return null;
  const months = cal.months?.values ?? [];
  let left;                                   // days from t's day to the season's first day after
  if (byDays(s)) {
    const yearDays = cal.days.daysPerYear;
    left = (((s.dayEnd - (c.day + 1)) % yearDays) + yearDays) % yearDays + 1;
  } else if (byMonths(s) && months.length) {
    left = months[c.month].days - c.dayOfMonth;
    for (let i = 1, m = c.month; ; i++) {
      if (i > months.length) return null;     // every month is this season's
      m = (m + 1) % months.length;
      if (!inMonths(s, months[m].ordinal)) break;
      left += months[m].days;
    }
  } else return null;
  const spd = secondsPerDay(cal), day0 = startOfDay(cal, t);
  for (const off of [0, 1, -1, 2, -2]) {
    const n = left + off;
    if (n < 1) continue;
    const at = day0 + n * spd;
    if (cal.timeToComponents(at).season !== c.season && cal.timeToComponents(at - spd).season === c.season) return at;
  }
  return day0 + left * spd;
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
 * The worldTime of the `n`th sunrise after `t` (a sunrise at exactly `t` is
 * not after it). Overland's weather holds until a dawn (#230).
 */
export function dawnAfter(cal, t, n = 1) {
  const spd = secondsPerDay(cal), perHour = spd / hoursPerDay(cal);
  let found = 0;
  for (let d = absDay(cal, t); ; d++) {
    const rise = d * spd + sun(cal, d * spd).sunrise * perHour;
    if (rise > t && ++found >= n) return rise;
  }
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
 * changes (`seasonChanges`), sunrises (`dawns`) and sunsets (`dusks`).
 * `seasons` lists the LAST season changes, at most one per season of the
 * calendar (a year's worth), so a jump of centuries hands over four entries,
 * not thousands. A move backwards, or no move, crosses nothing.
 *
 * Cheap for any jump: days, weeks, dawns and dusks are arithmetic (the sun is
 * asked about the first and last day only), and the seasons jump from one
 * change to the next, a few calendar reads each.
 * @returns {{days:number, weeks:number, seasons:Array<{from:string|null, to:string|null, at:number}>,
 *   seasonChanges:number, dawns:number, dusks:number}}
 */
export function crossings(cal, from, to) {
  const out = { days: 0, weeks: 0, seasons: [], seasonChanges: 0, dawns: 0, dusks: 0 };
  if (!(to > from)) return out;
  const spd = secondsPerDay(cal), perHour = spd / hoursPerDay(cal);
  const first = absDay(cal, from), last = absDay(cal, to);
  const week = cal.days?.values?.length || 7, offset = cal.years?.firstWeekday ?? 0;
  out.days = last - first;
  out.weeks = Math.floor((last + offset) / week) - Math.floor((first + offset) / week);
  // Every whole day between the first and the last has its sunrise and sunset
  // inside the move; only the two end days need the sun.
  out.dawns = out.dusks = Math.max(0, last - first - 1);
  for (const d of first === last ? [first] : [first, last]) {
    const dayStart = d * spd;
    const { sunrise, sunset } = sun(cal, dayStart);
    const rise = dayStart + sunrise * perHour, set = dayStart + sunset * perHour;
    if (rise > from && rise <= to) out.dawns++;
    if (set > from && set <= to) out.dusks++;
  }
  const cycle = Math.max(1, cal.seasons?.values?.length ?? 0);
  let was = season(cal, from);
  for (let at = nextSeasonChange(cal, from); at !== null && at <= to; at = nextSeasonChange(cal, at)) {
    const now = season(cal, at);
    out.seasonChanges++;
    out.seasons.push({ from: was.key, to: now.key, at });
    if (out.seasons.length > cycle) out.seasons.shift();
    was = now;
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
