/**
 * Shadowdark Enhancer — the Trouble tracker's rules (pure, Foundry-free, #193).
 *
 * "Fragile Civilizations" (GMWR pp.48–49): a weekly check whose chance grows
 * with every quiet week, a trouble in a real settlement, and a countdown on the
 * world clock from weeks to days to hours to happened. Everything here reads
 * the GM's imported tables as text; no book content ships.
 */

/** The countdown's stages, in order. */
export const STAGES = ["weeks", "days", "hours", "happened"];

/** Settlement kinds, as the hex import records them (hex-summary.mjs SETTLEMENTS). */
export const SETTLEMENT_KINDS = ["village", "town", "city", "city_state"];

/** The chance, in 6, after `quiet` quiet weeks: 1-in-6 the first week, then one more each week. */
export const checkChance = (quiet) => Math.min(6, Math.max(0, Math.trunc(Number(quiet) || 0)) + 1);

/**
 * One weekly check: trouble stirs on a d6 at or under the chance, and the
 * count of quiet weeks starts again; otherwise it grows by one.
 * @returns {{chance:number, stirs:boolean, quiet:number}}
 */
export function weeklyCheck(quiet, d6) {
  const chance = checkChance(quiet);
  const stirs = d6 <= chance;
  return { chance, stirs, quiet: stirs ? 0 : checkChance(quiet) };
}

/**
 * The worldTimes of the week starts in (from, to]: weekday 0 at 00:00, the
 * boundaries `crossings().weeks` counts (time-core.mjs).
 * @param {{secondsPerDay:number, week:number, offset:number}} cal
 */
export function weekStarts({ secondsPerDay, week, offset }, from, to) {
  const out = [];
  const first = Math.floor(from / secondsPerDay), last = Math.floor(to / secondsPerDay);
  for (let d = first + 1; d <= last; d++) if ((((d + offset) % week) + week) % week === 0) out.push(d * secondsPerDay);
  return out;
}

/** The settlement kind a Settlement table row names: "A city-state (reroll if none)" → "city_state". */
export function settlementKind(text) {
  const t = String(text ?? "").toLowerCase();
  if (/city[\s-]state/.test(t)) return "city_state";
  if (/\bcity\b/.test(t)) return "city";
  if (/\btown\b/.test(t)) return "town";
  if (/\bvillage\b/.test(t)) return "village";
  return null;
}

/**
 * A Type of Trouble row imported whole, its second roll printed inline:
 * "Monster horde. 1d6: 1. Orcs 2. Undead …" → { type, formula, options }.
 * Null for a row without one (an import that already split it, #188).
 */
export function inlineDetail(text) {
  const m = String(text ?? "").trim().match(/^(.*?)\.\s*(\d*d\d+)\s*:\s*(.*)$/i);
  if (!m) return null;
  const options = m[3].split(/(?:^|\s+)\d+\.\s+/).map((s) => s.trim()).filter(Boolean);
  return options.length ? { type: m[1].trim(), formula: m[2], options } : null;
}

/**
 * An Urgency Level row: "1d4 weeks away Discomfort, portents, denial" →
 * { stage: "weeks", formula: "1d4", symptoms: "Discomfort, portents, denial" };
 * "Already happened Devastation, …" → { stage: "happened", formula: null, … }.
 * Null for a row that names neither.
 */
export function urgencyRow(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const timed = t.match(/^(\d*d\d+)\s+(week|day|hour)s?\b(?:\s+away)?\s*(.*)$/i);
  if (timed) return { stage: `${timed[2].toLowerCase()}s`, formula: timed[1], symptoms: timed[3].trim() };
  const done = t.match(/^already happened\s*(.*)$/i);
  return done ? { stage: "happened", formula: null, symptoms: done[1].trim() } : null;
}

/**
 * When each stage begins, from the stage the urgency roll gave and the
 * distances rolled for it: `weeks`, `days` and `hours` are the counts rolled
 * on each stage's die (1d4, 1d8, 1d12). The trouble arrives the rolled
 * distance from `now`, and the later stages start that many days and hours
 * before it. A days lead longer than the weeks rolled starts it in days.
 * @param {string} stage  "weeks" | "days" | "hours" | "happened"
 * @param {number} now
 * @param {{weeks?:number, days?:number, hours?:number}} rolled
 * @param {{hour:number, day:number, week:number}} secs
 * @returns {{daysAt:number, hoursAt:number, arriveAt:number}}
 */
export function schedule(stage, now, rolled, secs) {
  const lead = (n, unit) => Math.max(0, Number(n) || 0) * unit;
  if (stage === "weeks") {
    const arriveAt = now + lead(rolled.weeks, secs.week);
    return { daysAt: Math.max(now, arriveAt - lead(rolled.days, secs.day)), hoursAt: Math.max(now, arriveAt - lead(rolled.hours, secs.hour)), arriveAt };
  }
  if (stage === "days") {
    const arriveAt = now + lead(rolled.days, secs.day);
    return { daysAt: now, hoursAt: Math.max(now, arriveAt - lead(rolled.hours, secs.hour)), arriveAt };
  }
  if (stage === "hours") return { daysAt: now, hoursAt: now, arriveAt: now + lead(rolled.hours, secs.hour) };
  return { daysAt: now, hoursAt: now, arriveAt: now };
}

/** The stage at worldTime `t`. */
export function stageAt(t, { daysAt, hoursAt, arriveAt }) {
  if (t >= arriveAt) return "happened";
  if (t >= hoursAt) return "hours";
  if (t >= daysAt) return "days";
  return "weeks";
}

/** The next time a trouble changes stage after `t`, or Infinity when it has happened or is resolved. */
export function nextChange(t, trouble) {
  if (!trouble || trouble.resolved) return Infinity;
  const next = [trouble.daysAt, trouble.hoursAt, trouble.arriveAt].filter((x) => x > t);
  return next.length ? Math.min(...next) : Infinity;
}
