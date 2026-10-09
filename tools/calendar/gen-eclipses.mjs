#!/usr/bin/env node
/**
 * Writes scripts/calendar/eclipse-data.mjs: what a person in Avignon could see
 * of the sky from 1200 to 1500, from Astronomy Engine (MIT; install it with
 * `npm i --no-save astronomy-engine`, as pdfjs-dist is):
 * the eclipses, the day of each equinox and solstice, and the moon's epoch.
 *
 *   node tools/calendar/gen-eclipses.mjs [firstYear] [lastYear]
 *
 * The data ships; the library does not. DATES ARE FOUNDRY'S. Its world
 * calendar is "Simplified Gregorian": a leap day every 4th year with no
 * century rule, which for these centuries is the Julian calendar. So an
 * instant is turned into a Julian calendar date, not the proleptic Gregorian
 * one a JavaScript Date would give: the vernal equinox of 1348 falls on 12
 * March in it, and the calendar must say so. Times are Avignon's local mean
 * time (UTC plus its longitude in hours). Penumbral lunar eclipses are left
 * out: nobody sees them. An eclipse counts as seen when the Sun (or Moon) is
 * above the horizon at the start, the peak or the end.
 *
 * ASTRONOMY_ENGINE=<path to astronomy.js> runs it from a library installed
 * somewhere else.
 */
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const A = await import(process.env.ASTRONOMY_ENGINE ? pathToFileURL(process.env.ASTRONOMY_ENGINE).href : "astronomy-engine");
const [from = 1200, to = 1500] = process.argv.slice(2).map(Number);

const AVIGNON = { lat: 43.9493, lon: 4.8055, height: 25 };
const observer = new A.Observer(AVIGNON.lat, AVIGNON.lon, AVIGNON.height);
const LMT_MS = (AVIGNON.lon / 15) * 3600e3;
const lastMs = Date.UTC(to, 11, 31);

const pad = (n) => String(n).padStart(2, "0");

/** Avignon's local date and time of a UTC instant, as the Julian calendar prints it. */
function julian(utcMs) {
  const local = utcMs + LMT_MS;
  const jdn = Math.floor(local / 86400e3 + 2440587.5 + 0.5);
  const c = jdn + 32082, d = Math.floor((4 * c + 3) / 1461), e = c - Math.floor((1461 * d) / 4), m = Math.floor((5 * e + 2) / 153);
  const into = new Date(local);
  return {
    year: d - 4800 + Math.floor(m / 10), month: m + 3 - 12 * Math.floor(m / 10), day: e - Math.floor((153 * m + 2) / 5) + 1,
    time: `${pad(into.getUTCHours())}:${pad(into.getUTCMinutes())}`,
  };
}
const row = (kind, type, peak, percent) => {
  const j = julian(peak.getTime());
  return [j.year, j.month, j.day, j.time, kind, type, Math.round(percent * 100)];
};
const up = (body, time) => {
  const eq = A.Equator(body, time, observer, true, true);
  return A.Horizon(time, observer, eq.ra, eq.dec, "normal").altitude > 0;
};

let out = [];
const start = new Date(Date.UTC(from, 0, 1));

// Solar: the library reports the first one a local observer has, with the Sun's altitude at each contact.
for (let s = A.SearchLocalSolarEclipse(start, observer); s.peak.time.date.getTime() <= lastMs;
  s = A.NextLocalSolarEclipse(s.peak.time, observer)) {
  const seen = [s.partial_begin, s.peak, s.partial_end].some((c) => c.altitude > 0);
  if (seen && s.obscuration > 0) out.push(row("S", s.kind[0], s.peak.time.date, s.obscuration));
}

// Lunar: global; seen when the Moon is up at the start, the peak or the end of the partial phase.
for (let l = A.SearchLunarEclipse(start); l.peak.date.getTime() <= lastMs; l = A.NextLunarEclipse(l.peak)) {
  if (l.kind === "penumbral") continue;
  const half = l.sd_partial * 60e3;
  const times = [l.peak, l.peak.AddDays(-half / 86400e3), l.peak.AddDays(half / 86400e3)];
  if (times.some((t) => up(A.Body.Moon, t))) out.push(row("L", l.kind[0], l.peak.date, l.obscuration));
}

// A sliver under half a percent is not an eclipse anyone sees.
out = out.filter((r) => r[6] > 0).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

// The four days of each year. March, June, September and December hold them in every one of these years.
const seasons = [];
for (let y = from; y <= to; y++) {
  const s = A.Seasons(y);
  const days = [[s.mar_equinox, 3], [s.jun_solstice, 6], [s.sep_equinox, 9], [s.dec_solstice, 12]].map(([t, month]) => {
    const j = julian(t.date.getTime());
    if (j.month !== month) throw new Error(`${y}: month ${month} event fell in ${j.month}`);
    return j.day;
  });
  seasons.push([y, ...days]);
}

// The moon's average month (29.530588853 days), fitted to every real new moon in the range so that its
// error is centred (about 14 hours either way) rather than whatever one new moon happened to be. The
// epoch is the fitted new moon nearest March 1348.
const MONTH_MS = 29.530588853 * 86400e3;
const first = A.SearchMoonPhase(0, start, 40).date.getTime();
let residual = 0, lunations = 0;
for (let m = A.SearchMoonPhase(0, start, 40); m.date.getTime() <= lastMs; m = A.SearchMoonPhase(0, new Date(m.date.getTime() + 20 * 86400e3), 40), lunations++) {
  const k = Math.round((m.date.getTime() - first) / MONTH_MS);
  residual += m.date.getTime() - (first + k * MONTH_MS);
}
const fitted = first + residual / lunations;
const mid = Date.UTC(1348, 2, 1);
const nm = julian(fitted + Math.round((mid - fitted) / MONTH_MS) * MONTH_MS);

const file = fileURLToPath(new URL("../../scripts/calendar/eclipse-data.mjs", import.meta.url));
fs.writeFileSync(file, `/**
 * GENERATED by tools/calendar/gen-eclipses.mjs; do not edit. What a person in
 * Avignon could see of the sky, ${from} to ${to}, from Astronomy Engine (MIT).
 * Dates are the ones Foundry's calendar prints (the Julian calendar for these
 * centuries); the time is Avignon local mean time.
 */

/**
 * Eclipses. Each row: year, month, day, time "HH:MM", S sun or L moon, type t
 * total, a annular or p partial, and the percent covered at the peak (the
 * Sun's disc for S, the Moon's for L).
 */
export const ECLIPSES = [
${out.map((r) => `  ${JSON.stringify(r)},`).join("\n")}
];

/**
 * The day of the month on which the spring equinox (March), summer solstice
 * (June), autumn equinox (September) and winter solstice (December) fall.
 * Each row: year, then those four days.
 */
export const SEASON_DAYS = [
${seasons.map((r) => `  ${JSON.stringify(r)},`).join("\n")}
];

/** The moon's epoch for its average month, fitted to the real new moons of the range: year, month, day, time. */
export const NEW_MOON = ${JSON.stringify([nm.year, nm.month, nm.day, nm.time])};
`);
console.log(`${out.length} eclipses, ${seasons.length} years, new moon ${JSON.stringify(nm)}, ${from}-${to}`);
