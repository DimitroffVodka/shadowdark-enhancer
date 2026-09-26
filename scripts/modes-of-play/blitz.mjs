/**
 * Shadowdark Enhancer — Blitz Mode (core rulebook p.111): light timers last
 * 30 minutes. Setting `modeBlitzLights`, in the Modes of Play window (#178).
 *
 * Torches and lanterns. Every way of lighting one only flips
 * `system.light.active` (the system's sheet toggle, Shadowdark Extras' party
 * inventory, the crawl strip's fallback), so one preUpdateItem hook covers
 * them all: the update that lights it also clamps `remainingSecs` to 30
 * minutes. Only `remainingSecs` is clamped, never `longevityMins`, so turning
 * Blitz off leaves no torch permanently short; the system's tracker never
 * raises the remaining time (its tick is min(longevity, remaining - delta)).
 * The same update marks the light used: the system resets an UNUSED light to
 * its full longevity whenever its sheet renders, and the non-sheet lighting
 * paths never set the flag, so without it the next sheet render would give the
 * torch its hour back.
 *
 * Light spells. The system times an Effect item that carries a light from its
 * duration and start stamp, so the duration is clamped when it is created.
 *
 * Shadowdark Extras' camping campfire keeps its 8 hours: it is a camping rule,
 * not a light timer.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** Blitz's light time, in seconds. */
export const BLITZ_LIGHT_SECS = 30 * 60;

const EXTRAS_ID = "shadowdark-extras";

const getProp = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** A value from an update's changes, expanded or flat ("system.light.active"). */
function changed(changes, path) {
  if (changes && Object.hasOwn(changes, path)) return changes[path];
  return getProp(changes, path);
}

const isCampfire = (item) => !!getProp(item, `flags.${EXTRAS_ID}.campingCampfire`);

/**
 * The fields to add to an update that lights a Basic light source, or null.
 * Pure: the item as it is now, and the update's changes.
 * @param {object} item  {type, system:{light:{isSource, active, remainingSecs}}, flags}
 * @param {object} changes
 * @returns {object|null}  flat update keys to merge into the changes
 */
export function blitzLightPatch(item, changes) {
  if (item?.type !== "Basic" || !item.system?.light?.isSource || isCampfire(item)) return null;
  if (changed(changes, "system.light.active") !== true || item.system.light.active === true) return null;
  const incoming = changed(changes, "system.light.remainingSecs");
  const remaining = Number.isFinite(incoming) ? incoming : Number(item.system.light.remainingSecs ?? BLITZ_LIGHT_SECS);
  return {
    "system.light.remainingSecs": Math.min(remaining, BLITZ_LIGHT_SECS),
    "system.light.hasBeenUsed": true,
  };
}

/**
 * The fields to set on a light-carrying Effect item being created, or null.
 * Durations the system counts in real time are clamped to 30 minutes; one
 * that is already shorter, or not timed (focus, permanent, unlimited), is left.
 * @param {object} data  the Effect item's creation data
 * @param {Object<string, number>} units  CONFIG.SHADOWDARK.DURATION_UNITS (seconds per unit)
 * @returns {object|null}  flat source keys for item.updateSource
 */
export function blitzEffectPatch(data, units) {
  if (data?.type !== "Effect" || !data.system?.light?.isSource || isCampfire(data)) return null;
  const { type, value } = data.system.duration ?? {};
  const perUnit = units?.[type];
  if (!perUnit || !Number.isFinite(Number(value))) return null;
  if (Number(value) * perUnit <= BLITZ_LIGHT_SECS) return null;
  return {
    "system.duration.type": "minutes",
    "system.duration.value": BLITZ_LIGHT_SECS / 60,
    "system.light.longevitySecs": BLITZ_LIGHT_SECS,
    "system.light.remainingSecs": BLITZ_LIGHT_SECS,
    "system.light.longevityMins": BLITZ_LIGHT_SECS / 60,
  };
}

const blitzOn = () => game.settings.get(MODULE_ID, "modeBlitzLights") === true;

export function init() {
  // The client making the update runs this, whoever it is: the setting is
  // world-scoped and readable everywhere, and the patch rides the same update.
  Hooks.on("preUpdateItem", (item, changes) => {
    if (!blitzOn()) return;
    const patch = blitzLightPatch(item, changes);
    if (patch) foundry.utils.mergeObject(changes, foundry.utils.expandObject(patch));
  });

  Hooks.on("preCreateItem", (item, data) => {
    if (!blitzOn()) return;
    const patch = blitzEffectPatch(item.toObject?.() ?? data, CONFIG.SHADOWDARK?.DURATION_UNITS);
    if (patch) item.updateSource(patch);
  });
}
