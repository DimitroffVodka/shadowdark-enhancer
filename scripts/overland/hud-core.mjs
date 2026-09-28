/**
 * Shadowdark Enhancer — the clock HUD, the pure half (#253, the #257 mockup).
 *
 * What the top bar, the sky dial, the season band and the month view show,
 * worked out from plain values and the calendar so Node can test it;
 * overland-bar.mjs draws it. The dial is the mockup's: a disc turning a
 * 24th of a turn an hour, with now always at the bottom.
 */

import { secondsPerDay, startOfDay, moonPhase, anchor } from "../time/time-core.mjs";

/** Who sees the bar: the `clockBar` setting's choices. Nobody while a combat runs. */
export const CLOCK_SHOWN = ["all", "gm", "off"];
export const clockShown = ({ setting, isGM, combat }) =>
  !combat && (setting === "all" || (setting === "gm" && isGM));

/**
 * The GM's step buttons, largest first: a day, 8 hours, an hour, 10 minutes
 * (a crawl turn) and a combat round, in the calendar's own units.
 * @returns {Array<{seconds:number, key:string}>}
 */
export function clockSteps(cal, roundSeconds = 6) {
  const day = secondsPerDay(cal);
  const hour = day / (cal?.days?.hoursPerDay ?? 24);
  return [
    { seconds: day, key: "SDE.clock.step.day" },
    { seconds: 8 * hour, key: "SDE.clock.step.hours8" },
    { seconds: hour, key: "SDE.clock.step.hour" },
    { seconds: hour / 6, key: "SDE.clock.step.minutes10" },
    { seconds: roundSeconds, key: "SDE.clock.step.round" },
  ];
}

// The dial's geometry, in its SVG's units (260 × 140): the disc hangs from the top.
export const DIAL = { cx: 130, cy: 14, disc: 86, moonTrack: 114, moonR: 8, twilight: 0.6 };

const point = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [+(DIAL.cx + r * Math.cos(a)).toFixed(1), +(DIAL.cy + r * Math.sin(a)).toFixed(1)];
};

/** An SVG path for the disc's sector between two angles (degrees, clockwise). */
function sector(a1, a2, r) {
  const [x1, y1] = point(a1, r), [x2, y2] = point(a2, r);
  const sweep = (((a2 - a1) % 360) + 360) % 360;
  return `M${DIAL.cx} ${DIAL.cy} L${x1} ${y1} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
}

/**
 * The sky dial at an hour. The disc turns `360 / hoursPerDay` degrees an hour,
 * so the hour now always sits at the bottom, under the star; day is the light
 * sector from sunrise to sunset, hatched for the twilight either side. The
 * moon rides the outer track by its phase, not the hour.
 * @param {{hour:number, sunrise:number, sunset:number, moonFraction:number, hoursPerDay?:number}} sky
 */
export function dialModel({ hour, sunrise, sunset, moonFraction, hoursPerDay = 24 }) {
  const perHour = 360 / hoursPerDay;
  const A = (h) => 90 - perHour * h;
  const tw = DIAL.twilight;
  const p = ((moonFraction % 1) + 1) % 1;
  const [mx, my] = point(30 + 120 * p, DIAL.moonTrack);
  const r = DIAL.moonR;
  return {
    rotate: +(perHour * hour).toFixed(2),
    day: sector(A(sunset), A(sunrise), DIAL.disc),
    dusk: sector(A(sunset + tw), A(sunset - tw), DIAL.disc),
    dawn: sector(A(sunrise + tw), A(sunrise - tw), DIAL.disc),
    isDay: hour > sunrise + tw && hour < sunset - tw,
    // The next of sunrise and sunset, to name under the weather.
    next: hour < sunrise ? { kind: "rises", hour: sunrise } : hour < sunset ? { kind: "sets", hour: sunset } : { kind: "rises", hour: null },
    moon: { x: mx, y: my, r, shadow: +(p < 0.5 ? -(4 * r * p) : 4 * r * (1 - p)).toFixed(2) },
  };
}

/** Fixed stars on the night side of the disc: [hour, radius]. */
export const DIAL_STARS = [[22, 60], [23.4, 38], [0.6, 70], [1.8, 48], [3, 64], [20.8, 72], [2.4, 30]];

/** Where a star sits for the dial's hour mapping. */
export const starPoint = ([hour, radius], hoursPerDay = 24) => point(90 - (360 / hoursPerDay) * hour, radius);

/**
 * The season band's "next season" hatch: it grows from the right over the
 * season's last 30 days, to at most 30% of the band.
 * @returns {number} its width in percent, 0 when the change is further off
 */
export const seasonHatch = (daysLeft) => +(Math.max(0, Math.min(1, (30 - daysLeft) / 30)) * 30).toFixed(1);

/** The 00:00 of the first day of `t`'s month, read back from the calendar. */
function firstOfMonth(cal, t) {
  const spd = secondsPerDay(cal);
  let at = startOfDay(cal, t);
  for (let i = 0; i < 64 && cal.timeToComponents(at).dayOfMonth > 0; i++) at -= spd;
  return at;
}

/** The first of the month `by` months from the month starting at `first`. */
function shiftMonth(cal, first, by) {
  const spd = secondsPerDay(cal);
  let at = first;
  // From a month's first day, 32 days on is always inside the next month
  // (months run 28 to 31 days); a day back is inside the one before.
  for (let k = 0; k < Math.abs(by); k++) at = by > 0 ? firstOfMonth(cal, at + 32 * spd) : firstOfMonth(cal, at - spd);
  return at;
}

const MOON_MARKS = [[0.25, "q1"], [0.5, "full"], [0.75, "q3"]];

/**
 * The month view: `offset` months from `t`'s, in weeks that start on the
 * calendar's weekday 0, each day with its 00:00, the moon's quarter when one
 * falls that day, today, and the holidays `holidaysOn` names for it. Days are
 * read back one at a time rather than counted, because core shows leap days
 * where its own components say.
 * @param {object} cal  game.time.calendar
 * @param {number} t    now
 * @param {{offset?:number, epoch?:number, holidaysOn?:(date:object) => string[]}} [opts]
 */
export function monthGrid(cal, t, { offset = 0, epoch = 0, holidaysOn = () => [] } = {}) {
  const spd = secondsPerDay(cal);
  const today = startOfDay(cal, t);
  const first = shiftMonth(cal, firstOfMonth(cal, t), offset);
  const head = cal.timeToComponents(first);
  const week = cal.days?.values?.length || 7;
  const lastFull = anchor(cal, "lastFullMoon", head.year, epoch);
  const days = [];
  for (let at = first, i = 0; i < 64; at += spd, i++) {
    const c = cal.timeToComponents(at);
    if (c.month !== head.month || (i > 0 && c.dayOfMonth === 0)) break;
    const a = moonPhase(cal, at, epoch).fraction, b = moonPhase(cal, at + spd, epoch).fraction;
    const moon = b < a ? "new" : MOON_MARKS.find(([q]) => a <= q && b > q)?.[1] ?? null;
    const date = { year: c.year, month: c.month + 1, day: c.dayOfMonth + 1, isLastFullMoonOfYear: lastFull === at };
    days.push({ day: c.dayOfMonth + 1, at, moon, today: at === today, holidays: holidaysOn(date) });
  }
  const lead = head.dayOfWeek % week;
  const trail = (week - ((lead + days.length) % week)) % week;
  const before = Array.from({ length: lead }, (_, i) => ({ day: cal.timeToComponents(first - (lead - i) * spd).dayOfMonth + 1, out: true }));
  const after = Array.from({ length: trail }, (_, i) => ({ day: i + 1, out: true }));
  return {
    year: head.year + (cal.years?.yearZero ?? 0),
    month: cal.months?.values?.[head.month]?.name ?? "",
    season: head.season,
    weekdays: (cal.days?.values ?? []).map((d) => d.abbreviation ?? d.name),
    cells: [...before, ...days, ...after],
    fullMoon: days.find((d) => d.moon === "full")?.day ?? null,
  };
}

/**
 * A date as the calendar shows it (the year with its yearZero, the month and
 * day from 1) to a worldTime, read back from the calendar so a leap day lands
 * where core shows it; null for a date the calendar doesn't have.
 */
export function dateToTime(cal, { year, month, day, hour = 0, minute = 0 }) {
  const y = year - (cal.years?.yearZero ?? 0);
  const spd = secondsPerDay(cal);
  const months = cal.months?.values ?? [];
  if (month < 1 || month > months.length || day < 1) return null;
  const start = cal.componentsToTime({ year: y });
  const guess = months.slice(0, month - 1).reduce((s, x) => s + x.days, 0) + day - 1;
  const perMinute = cal.days?.secondsPerMinute ?? 60, perHour = (cal.days?.minutesPerHour ?? 60) * perMinute;
  for (const off of [0, 1, -1, 2, -2]) {
    const at = start + (guess + off) * spd;
    const c = cal.timeToComponents(at);
    if (c.year === y && c.month === month - 1 && c.dayOfMonth === day - 1) return at + hour * perHour + minute * perMinute;
  }
  return null;
}
