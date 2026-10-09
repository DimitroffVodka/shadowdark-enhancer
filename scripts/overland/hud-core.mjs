/**
 * Shadowdark Enhancer — the clock HUD, the pure half (#253, the #257 mockup).
 *
 * What the top bar, the sky dial, the season band and the month view show,
 * worked out from plain values and the calendar so Node can test it;
 * overland-bar.mjs draws it. The dial is the mockup's: a disc turning a
 * 24th of a turn an hour, with now always at the bottom.
 */

import { secondsPerDay, startOfDay, moonPhase, anchor } from "../time/time-core.mjs";
import { esc } from "../shared/esc.mjs";

/**
 * Who sees the bar: the `clockBar` setting's choices, on a hex map only (#298).
 * Nobody while a combat runs, and nobody on a scene with no hex grid.
 */
export const clockShown = ({ setting, isGM, combat, hex }) =>
  !!hex && !combat && (setting === "all" || (setting === "gm" && isGM));

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

// The dial's geometry, in its SVG's units (400 × 198). It is a half disc: the svg's top edge is the diameter, and sits
// flush under the season band, so nothing is drawn above it. The disc turns inside an hour ring, the moon rides outside.
export const DIAL = { w: 400, h: 198, cx: 200, cy: 0, disc: 136, ringIn: 138, ringMid: 150, ringOut: 162, moonTrack: 180, moonR: 13, frame: 194, twilight: 0.6 };

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
 * hour ring carries a tick for each hour and a badge at sunrise and sunset,
 * which turn with the disc. The moon rides the outer track by its phase, not the hour.
 * @param {{hour:number, sunrise:number, sunset:number, moonFraction:number, hoursPerDay?:number}} sky
 */
export function dialModel({ hour, sunrise, sunset, moonFraction, hoursPerDay = 24 }) {
  const perHour = 360 / hoursPerDay;
  const A = (h) => 90 - perHour * h;
  const tw = DIAL.twilight;
  const p = ((moonFraction % 1) + 1) % 1;
  const [mx, my] = point(30 + 120 * p, DIAL.moonTrack);
  const r = DIAL.moonR;
  const ticks = Array.from({ length: hoursPerDay }, (_, h) => {
    const weight = h % Math.round(hoursPerDay / 4) === 0 ? 2 : h % Math.round(hoursPerDay / 8) === 0 ? 1 : 0;
    const [x1, y1] = point(A(h), DIAL.ringIn + 1), [x2, y2] = point(A(h), DIAL.ringIn + [4, 7, 10][weight]);
    return { x1, y1, x2, y2, weight };
  });
  return {
    rotate: +(perHour * hour).toFixed(2),
    day: sector(A(sunset), A(sunrise), DIAL.disc),
    dusk: sector(A(sunset + tw), A(sunset - tw), DIAL.disc),
    dawn: sector(A(sunrise + tw), A(sunrise - tw), DIAL.disc),
    isDay: hour > sunrise + tw && hour < sunset - tw,
    // The next of sunrise and sunset, to name under the weather.
    next: hour < sunrise ? { kind: "rises", hour: sunrise } : hour < sunset ? { kind: "sets", hour: sunset } : { kind: "rises", hour: null },
    moon: { x: mx, y: my, r, p, shadow: +(p < 0.5 ? -(4 * r * p) : 4 * r * (1 - p)).toFixed(2) },
    ticks,
    rise: point(A(sunrise), DIAL.ringMid + 2),
    set: point(A(sunset), DIAL.ringMid + 2),
  };
}

/** Fixed stars on the night side of the disc: [hour, radius, size]. */
export const DIAL_STARS = [[22, 100, 1.3], [23.4, 62, 1.8], [0.6, 112, 1.2], [1.8, 80, 1.5], [3, 104, 1.2], [20.8, 118, 1.3], [2.4, 48, 1.1],
  [21.6, 74, 1.1], [0.1, 90, 2], [3.7, 66, 1.3], [1.2, 118, 1.1], [23, 116, 1.1], [4.4, 100, 1.1], [20.2, 96, 1.2]];

/** Where a star sits for the dial's hour mapping. */
export const starPoint = ([hour, radius], hoursPerDay = 24) => point(90 - (360 / hoursPerDay) * hour, radius);

/**
 * Which party token the HUD finds: the selected party's if it has one on the scene, else the first.
 * @param {Array<{id:string, actorUuid:string}>} tokens  the party tokens on the scene
 * @param {string|null} selectedUuid  the selected party actor's uuid
 */
export const pickPartyToken = (tokens, selectedUuid = null) => tokens.find((t) => t.actorUuid === selectedUuid) ?? tokens[0] ?? null;

/** How wide a line can run across the disc at a height, with a margin for the halo. */
const chord = (y) => Math.round(2 * Math.sqrt(DIAL.disc ** 2 - (y + 4) ** 2) - 16);

/** One line shrunk to fit `room` (an estimate: `ratio` is the glyph's width in ems), then cut short with an ellipsis. */
function fitLine(text, { max, min, ratio, room }) {
  const size = Math.min(max, room / (text.length * ratio));
  if (size >= min) return { text, size: +size.toFixed(1) };
  const keep = Math.max(4, Math.floor(room / (min * ratio)) - 1);
  return { text: text.slice(0, keep).trimEnd() + "…", size: min };
}

/**
 * Where the region and the terrain sit on the disc. Each line is held to the disc's width at its own height; a
 * region that will not fit on one line at a readable size breaks at the space nearest its middle.
 * @returns {{region:Array<{text:string,size:number,y:number}>, terrain:null|{text:string,size:number,y:number}}}
 */
export function placeLines({ region = "", terrain = "" }) {
  const R = { max: 18, min: 12, ratio: 0.78 };
  const words = region.split(" ").filter(Boolean);
  const oneLine = words.length < 2 || region.length * R.ratio * R.min <= chord(58);
  const mid = region.length / 2, len = (n) => words.slice(0, n).join(" ").length;
  const cut = words.reduce((best, _, i) => (i && Math.abs(len(i) - mid) < Math.abs(len(best) - mid) ? i : best), 1);
  const texts = !words.length ? [] : oneLine ? [region] : [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
  const y0 = oneLine ? 58 : 52;
  const lines = texts.map((l, i) => ({ ...fitLine(l.toUpperCase(), { ...R, room: chord(y0 + i * 20) }), y: y0 + i * 20 }));
  const y = y0 + texts.length * 20 + 2;
  return { region: lines, terrain: terrain ? { ...fitLine(terrain.toLowerCase(), { max: 15, min: 11, ratio: 0.72, room: chord(y) }), y } : null };
}

/** A sunrise or sunset badge: the sun half over a horizon, an arrow for the way it is going. It stays upright as the disc turns. */
const sunChip = (up, [x, y], turn, tip) => `<g data-dial-chip data-x="${x}" data-y="${y}" transform="translate(${x} ${y}) rotate(${-turn})" data-tooltip="${esc(tip)}">
    <circle r="11.5" fill="#000" stroke="#c9c9c9" stroke-width="1.5"/>
    <path d="M-5 2 A5 5 0 0 1 5 2 Z" fill="#fff"/>
    <path d="M0 -8.4 V-6.2 M-6.6 -5.2 L-5.2 -3.8 M6.6 -5.2 L5.2 -3.8" stroke="#fff" stroke-width="1.3" stroke-linecap="round" fill="none"/>
    <path d="M-7 2 H7" stroke="#c9c9c9" stroke-width="1.3" stroke-linecap="round"/>
    <path d="${up ? "M-3 8 L0 5 L3 8" : "M-3 5 L0 8 L3 5"}" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>`;

/**
 * The sky dial's SVG. The pieces that turn with the hour carry `data-dial-turn` (the disc, and the hour ring with its
 * badges); the badges also carry `data-dial-chip`, which the bar re-levels as it turns them (overland-bar `_paintTime`).
 * @param {{d:object, hoursPerDay?:number, region?:string, terrain?:string, label?:string, tip?:string, riseTip?:string, setTip?:string}} v
 *   `d`: dialModel(); `label`: the screen-reader text; `tip`: the dial's tooltip; `riseTip`, `setTip`: the badges' tooltips; `nowTip`: the star that marks the hour now
 */
export function dialMarkup({ d, hoursPerDay = 24, region = "", terrain = "", label = "", tip = "", riseTip = "", setTip = "", nowTip = "" }) {
  const { cx, cy, disc } = DIAL;
  const turn = `data-dial-turn transform="rotate(${d.rotate} ${cx} ${cy})"`;
  const stars = DIAL_STARS.map((s) => { const [x, y] = starPoint(s, hoursPerDay); return `<circle cx="${x}" cy="${y}" r="${s[2]}" class="sde-hud-star"/>`; }).join("");
  const ticks = d.ticks.map((k) => `<line x1="${k.x1}" y1="${k.y1}" x2="${k.x2}" y2="${k.y2}" stroke="#c9c9c9" stroke-width="${k.weight === 2 ? 1.8 : 1}" opacity="${[0.5, 0.85, 1][k.weight]}"/>`).join("");
  const at = placeLines({ region, terrain });
  const text = [
    ...at.region.map((l) => `<text x="${cx}" y="${l.y}" text-anchor="middle" class="sde-hud-region sde-hud-halo" style="font-size:${l.size}px">${esc(l.text)}</text>`),
    at.terrain ? `<text x="${cx}" y="${at.terrain.y}" text-anchor="middle" class="sde-hud-sunline sde-hud-halo" style="font-size:${at.terrain.size}px">${esc(at.terrain.text)}</text>` : "",
  ].join("\n  ");
  const m = d.moon;
  return `<svg class="sde-hud-dial" width="${DIAL.w}" height="${DIAL.h}" viewBox="0 0 ${DIAL.w} ${DIAL.h}" role="img" aria-label="${esc(label)}"${tip ? ` data-tooltip="${esc(tip)}"` : ""}>
  <defs>
    <pattern id="sde-hud-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#0b0b0b"/><line x1="0" y1="0" x2="0" y2="5" stroke="#c9c9c9" stroke-width="1"/></pattern>
    <linearGradient id="sde-hud-dayg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f2f2"/><stop offset="1" stop-color="#b0b0b0"/></linearGradient>
    <radialGradient id="sde-hud-moonglow"><stop offset=".55" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <clipPath id="sde-hud-disc"><circle cx="${cx}" cy="${cy}" r="${disc}"/></clipPath>
    <clipPath id="sde-hud-moonc"><circle cx="${m.x}" cy="${m.y}" r="${m.r}"/></clipPath>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${DIAL.frame - 1}" fill="#000"/>
  <circle cx="${cx}" cy="${cy}" r="${DIAL.moonTrack}" class="sde-hud-track"/>
  <g clip-path="url(#sde-hud-disc)"><g ${turn}>
    <circle cx="${cx}" cy="${cy}" r="${disc}" fill="#0b0b0b"/>${stars}
    <path d="${d.day}" fill="url(#sde-hud-dayg)"/><path d="${d.dusk}" fill="url(#sde-hud-hatch)"/><path d="${d.dawn}" fill="url(#sde-hud-hatch)"/>
  </g></g>
  <circle cx="${cx}" cy="${cy}" r="${disc}" fill="none" stroke="#c9c9c9" stroke-width="1"/>
  <circle cx="${cx}" cy="${cy}" r="${DIAL.ringMid}" fill="none" stroke="#000" stroke-width="${DIAL.ringOut - DIAL.ringIn}"/>
  <circle cx="${cx}" cy="${cy}" r="${DIAL.ringIn}" fill="none" stroke="#c9c9c9" stroke-width="1.5"/>
  <circle cx="${cx}" cy="${cy}" r="${DIAL.ringOut}" fill="none" stroke="#c9c9c9" stroke-width="1.5"/>
  <g ${turn}>${ticks}${sunChip(true, d.rise, d.rotate, riseTip)}${sunChip(false, d.set, d.rotate, setTip)}</g>
  <circle cx="${cx}" cy="${cy}" r="${DIAL.frame - 4}" fill="none" stroke="#000" stroke-width="8"/>
  <circle cx="${cx}" cy="${cy}" r="${DIAL.frame}" fill="none" stroke="#c9c9c9" stroke-width="2"/>
  <circle cx="${cx}" cy="${cy}" r="${DIAL.frame + 3}" fill="none" stroke="#555" stroke-width="1"/>
  ${text}
  <path transform="translate(${cx} ${cy + DIAL.ringMid})"${nowTip ? ` data-tooltip="${esc(nowTip)}"` : ""} d="M0 -11 L2.6 -2.6 L11 0 L2.6 2.6 L0 11 L-2.6 2.6 L-11 0 L-2.6 -2.6 Z" fill="#ffffff" stroke="#000" stroke-width="1.5"/>
  <circle cx="${m.x}" cy="${m.y}" r="${m.r + 9}" fill="url(#sde-hud-moonglow)" opacity="${+(0.35 + 0.65 * Math.sin(Math.PI * m.p)).toFixed(2)}"/>
  <g clip-path="url(#sde-hud-moonc)"><circle cx="${m.x}" cy="${m.y}" r="${m.r}" fill="#f0f0f0"/><circle cx="${+(m.x + m.shadow).toFixed(1)}" cy="${m.y}" r="${m.r}" fill="#000"/></g>
  <circle cx="${m.x}" cy="${m.y}" r="${m.r}" fill="none" stroke="#c9c9c9" stroke-width="1"/>
</svg>`;
}

/**
 * The season band's "next season" hatch: it grows from the right over the
 * season's last 30 days, to at most 30% of the band.
 * @returns {number} its width in percent, 0 when the change is further off
 */
export const seasonHatch = (daysLeft) => +(Math.max(0, Math.min(1, (30 - daysLeft) / 30)) * 30).toFixed(1);

/**
 * The 00:00 of the first day of `t`'s month, read back from the calendar: the
 * earliest day with the same year and month. Not "day of month 0": core v14
 * shows 1 January twice in a 366-day year.
 */
function firstOfMonth(cal, t) {
  const spd = secondsPerDay(cal);
  let at = startOfDay(cal, t);
  const { year, month } = cal.timeToComponents(at);
  for (let i = 0; i < 64; i++) {
    const before = cal.timeToComponents(at - spd);
    if (before.year !== year || before.month !== month) break;
    at -= spd;
  }
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
    if (c.month !== head.month || c.year !== head.year) break;
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
  const hoursPerDay = cal.days?.hoursPerDay ?? 24, minutesPerHour = cal.days?.minutesPerHour ?? 60;
  if (month < 1 || month > months.length || day < 1) return null;
  if (hour < 0 || hour >= hoursPerDay || minute < 0 || minute >= minutesPerHour) return null;
  const start = cal.componentsToTime({ year: y });
  const guess = months.slice(0, month - 1).reduce((s, x) => s + x.days, 0) + day - 1;
  const perMinute = cal.days?.secondsPerMinute ?? 60, perHour = minutesPerHour * perMinute;
  for (const off of [0, 1, -1, 2, -2]) {
    const at = start + (guess + off) * spd;
    const c = cal.timeToComponents(at);
    if (c.year === y && c.month === month - 1 && c.dayOfMonth === day - 1) return at + hour * perHour + minute * perMinute;
  }
  return null;
}

// ── The Travel panel: the book's travel procedure in eight steps (GMWR p.46, #257) ──

/** The steps, in the book's order: the panel's list and its record of the day. */
export const TRAVEL_STEPS = ["weather", "sight", "method", "speed", "traveling", "encounters", "resting", "night"];

/**
 * The step the day stands at, 1 to 8: before a day opens, the weather; an
 * encounter holding the clock, 6 for a day check and 8 for a night one (by
 * the half of the check that hit when known, else by why the clock stopped:
 * 8 for a camp); otherwise travelling, 5.
 * @param {{dayOpen:boolean, pending:{reason:string}|null, heldHalf?:"day"|"night"|null}} day
 */
export function currentStep({ dayOpen, pending, heldHalf = null }) {
  if (pending) return (heldHalf ?? (pending.reason === "camp" ? "night" : "day")) === "night" ? 8 : 6;
  return dayOpen ? 5 : 1;
}

const terrainWord = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/**
 * How far the party sees, in hexes, and why (GMWR p.41): 1, less in darkness
 * or a storm, more in excellent weather and from slight or high ground. The
 * same sum as Shadowdark Extras' hex fog (hexNearRadius), so the panel and the
 * fog agree. Null when the rules data's visibility numbers aren't imported.
 * @param {object|null} rules  game.shadowdarkEnhancer.rules.visibility()
 * @param {{terrain:string|null, night:boolean, weather:string|null}} now
 * @returns {{parts:Array<[string, number]>, radius:number}|null}
 */
export function sightParts(rules, { terrain, night, weather }) {
  if (!["darkness", "stormy", "excellent", "slight", "high"].every((k) => Number.isFinite(rules?.[k]))) return null;
  const parts = [["base", 1]];
  if (night) parts.push(["darkness", rules.darkness]);
  if (weather === "stormy" || weather === "excellent") parts.push([weather, rules[weather]]);
  const height = rules.elevation?.[terrainWord(terrain)];
  if (height === "slight" || height === "high") parts.push([height, rules[height]]);
  return { parts, radius: Math.max(0, Math.floor(parts.reduce((n, [, v]) => n + v, 0))) };
}
