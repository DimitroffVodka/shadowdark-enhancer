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
import { isActiveGM } from "../shared/gm-relay.mjs";
import * as core from "./time-core.mjs";
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
  isNight: (t) => core.isNight(calendar(), when(t)),
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
  CONFIG.queries[OFF_DUTY_QUERY] = (data, { user } = {}) => handleOffDutyQuery(data, user);
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
