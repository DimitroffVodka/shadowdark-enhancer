/**
 * Shadowdark Enhancer — time, read from Foundry's world clock (#227, Overland O1).
 *
 * `game.shadowdarkEnhancer.time` and the `shadowdark-enhancer.timeAdvanced`
 * hook. The world clock (`game.time`) is the one clock and only the off-duty
 * move (off-duty.mjs, #228) writes it; there is no calendar UI. The arithmetic is time-core.mjs; this file
 * hands it `game.time.calendar`, the current worldTime and the moon's epoch.
 * Docs: docs/API.md, the `time` section.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM, registerQuery } from "../shared/gm-relay.mjs";
import * as core from "./time-core.mjs";
import { nightWithOverride, skyOverride } from "../overland/sky-core.mjs";
import { advanceOffDuty, handleOffDutyQuery, OFF_DUTY_QUERY } from "./off-duty.mjs";

/** World setting: a worldTime at which the moon was new. The phases count from it. */
export const MOON_EPOCH = "moonEpoch";

/** The moon's epoch, 0 (worldTime 0) until a GM sets another. */
export const moonEpoch = () => Number(globalThis.game?.settings?.get?.(MODULE_ID, MOON_EPOCH)) || 0;

const calendar = () => game.time.calendar;
/** `t` when given, else now. */
const when = (t) => (Number.isFinite(t) ? t : game.time.worldTime);

/** The date and time as the bar shows it: "Monday, 21 June 1300, 14:30". */
export function format(t) {
  const p = core.dateParts(calendar(), when(t));
  const l = (key) => game.i18n.localize(key);
  return game.i18n.format("SDE.time.format", { ...p, weekday: l(p.weekday), month: l(p.month) });
}

export const timeApi = {
  /** @returns {{worldTime:number, components:object, label:string}} */
  now() {
    const t = game.time.worldTime;
    return { worldTime: t, components: calendar().timeToComponents(t), label: format(t) };
  },
  /** @returns {{key:string|null, index:number|null, name:string|null}} name localised */
  season(t) {
    const s = core.season(calendar(), when(t));
    return { ...s, name: s.name && game.i18n.localize(s.name) };
  },
  /**
   * Is it night? With `{ region }` (the party's), the Isles of Andrik's skies
   * apply: never night under the Midnight Sun, always under the Long Dark (#235).
   */
  isNight: (t, { region } = {}) => {
    const at = when(t);
    return nightWithOverride(core.isNight(calendar(), at), skyOverride(region, core.season(calendar(), at).key));
  },
  sun: (t) => core.sun(calendar(), when(t)),
  moonPhase: (t) => core.moonPhase(calendar(), when(t), moonEpoch()),
  /** `year` is core's count (`game.time.components.year`); the current year by default. */
  anchor: (name, year) => core.anchor(calendar(), name,
    Number.isInteger(year) ? year : calendar().timeToComponents(game.time.worldTime).year, moonEpoch()),
  format,
  /** GM only: move the clock with the party's carried lights put out, keeping their time (#228). */
  advanceOffDuty,
};

/**
 * `shadowdark-enhancer.timeAdvanced`, fired on the active GM only, once per
 * world-time change, with what the move crossed. Everything that subscribes is
 * therefore a single writer. `offDuty` is the reason an off-duty move passed in
 * `game.time.advance(s, { "shadowdark-enhancer": { offDuty } })` (#228).
 * Cheap on purpose: the system's real-time light clock advances every tick.
 */
export function registerTimeHooks() {
  registerQuery(OFF_DUTY_QUERY, (data, { user } = {}) => handleOffDutyQuery(data, user));
  Hooks.on("updateWorldTime", slideShownTime);
  Hooks.on("updateWorldTime", (worldTime, dt, options) => {
    if (!isActiveGM()) return;
    const from = worldTime - dt;
    Hooks.callAll(`${MODULE_ID}.timeAdvanced`, {
      from, to: worldTime, dt,
      offDuty: options?.[MODULE_ID]?.offDuty ?? null,
      crossed: core.crossings(calendar(), from, worldTime),
    });
  });
}

// ── The time this screen shows (#257) ──────────────────────────────────────

/**
 * While Overland runs the clock in paced slices (a walk, a camp's or Continue's
 * time-lapse), each slice's advance carries `paceMs`. Every screen then slides
 * the time it shows from where it is to the new worldTime over twice the pace,
 * so the pause between two hexes or a late slice doesn't stop it, and
 * the bar's dial and the sky's darkness are painted from it every frame
 * (onShownTime). A small unpaced step (the system's real-time light tracking
 * ticks a second at a time) moves the slide's end; a bigger one ends the slide
 * where the clock is.
 */
const SLIDE_OVER_PACE = 2;
const RIDES_ALONG = 60;
let slide = null;
let slideFrame = null;
const shownPainters = new Set();

/** True for an advance that is one paced slice of a walk or a time-lapse. */
export const isPacedStep = (options) => Number(options?.[MODULE_ID]?.paceMs) > 0;

/** The time this screen shows: the world clock, or how far its slide to it has got. */
export function shownTime(now = performance.now()) {
  if (!slide) return game.time.worldTime;
  return slide.from + (slide.to - slide.from) * Math.min(1, (now - slide.start) / slide.ms);
}

/** `fn(time, done)` on every frame of a slide, and once with `done` true when it ends. */
export const onShownTime = (fn) => shownPainters.add(fn);

function paintShown() {
  slideFrame = null;
  const done = !slide || performance.now() - slide.start >= slide.ms;
  if (done) slide = null;
  const time = shownTime();
  for (const paint of shownPainters) {
    try { paint(time, done); } catch (err) { console.error(`${MODULE_ID} | painting the clock`, err); }
  }
  if (!done) slideFrame = requestAnimationFrame(paintShown);
}

function slideShownTime(worldTime, dt, options) {
  if (isPacedStep(options) && dt > 0) {
    // The first slice starts from the time shown before it, which the clock has just left.
    slide = { from: slide ? shownTime() : worldTime - dt, to: worldTime, start: performance.now(), ms: options[MODULE_ID].paceMs * SLIDE_OVER_PACE };
  } else if (slide && Math.abs(dt) <= RIDES_ALONG) {
    slide.to = worldTime;
    return;
  } else if (slide) slide = null;
  else return;
  slideFrame ??= requestAnimationFrame(paintShown);
}
