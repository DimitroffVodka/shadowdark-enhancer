/**
 * Shadowdark Enhancer — the sky on scenes (#235, Overland O9, docs/plans/overland.md §6.2).
 *
 * The active GM writes the darkness and weather effect of the active scene
 * and of the party's scene (the one the Overland travel token is on, which
 * can differ: #294) when the clock moves, when Overland's weather, hex or
 * token changes, and when a scene is activated. Only a scene that follows the sky is touched: a tagged hex
 * map by default, and any scene its GM marks in Scene Configuration's
 * Environment tab. A dungeon stays as it is unless it is marked.
 *
 * - Darkness (sky-core.mjs darknessAt) is written only when it moves by 0.02
 *   or more, animated for a step under an hour. The hex map stops at 0.6.
 *   Nothing is written when the scene's darkness is locked. No other module
 *   is consulted: a scene set to not follow the sky is the way out.
 * - Weather: Foundry's rainStorm when stormy, its blizzard when stormy in a
 *   cold climate, on a fair day the season's effect (FAIR_DAY_EFFECT: snow in
 *   winter, leaves in autumn), else none. Overland records the effect it put on a scene
 *   (the skyWeather flag) and only ever changes or clears that one; a weather
 *   effect the GM chose, a rain storm included, is left alone (weatherPlan).
 * - The Isles of Andrik keep their own skies, by the party's region.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { esc } from "../shared/esc.mjs";
import { overlandState, travelScene, weatherNow, OVERLAND_CHANGED } from "./overland.mjs";
import { hourOfDay } from "../time/time-core.mjs";
import {
  HEX_MAP_CAP, darknessAt, darknessMoved, followsSky, skyOverride, skyScenes, weatherEffect, weatherPlan,
} from "./sky-core.mjs";

export const FOLLOWS_SKY = "followsSky";
/** The weather effect Overland put on this scene, while it is still the one there. */
export const SKY_WEATHER = "skyWeather";
/** A darkness step under this many seconds of clock is animated. */
const ANIMATE_BELOW = 3600;
const ANIMATE_MS = 2000;

const t = (key) => game.i18n.localize(key);
const FOLLOWS_LABEL = {
  default: "SDE.overland.sky.followsDefault",
  on: "SDE.overland.sky.followsOn",
  off: "SDE.overland.sky.followsOff",
};

/** Is this scene a tagged hex map? (The scene's own, not the viewed canvas.) */
const isHexMap = (scene) => !!scene?.getFlag?.(MODULE_ID, "hexTags")?.origin && !!scene?.grid?.isHexagonal;

const sceneFollows = (scene) => followsSky(scene.getFlag(MODULE_ID, FOLLOWS_SKY), isHexMap(scene));

let _running = null;
let _again = null;

/**
 * Work out the sky for `scene` and write what changed (active GM only).
 * @param {Scene} [scene]  the active scene by default
 * @param {{dt?:number|null}} [options]  the clock step that caused it, for the animation
 * @returns {Promise<object|null>} what was written, or null
 */
export async function applySky(scene = game.scenes?.active, { dt = null } = {}) {
  if (!scene || !isActiveGM()) return null;
  const hex = isHexMap(scene);
  if (!followsSky(scene.getFlag(MODULE_ID, FOLLOWS_SKY), hex)) return null;
  const api = game.shadowdarkEnhancer?.time;
  if (!api) return null;
  const now = game.time.worldTime;
  const state = overlandState();
  const override = skyOverride(state.hex?.region, api.season(now)?.key ?? null);
  const updates = {};
  const options = {};

  if (!scene.environment?.darknessLock) {
    const next = darknessAt({
      hour: hourOfDay(game.time.calendar, now), ...api.sun(now), illumination: api.moonPhase(now).illumination,
      cap: hex ? HEX_MAP_CAP : 1, override,
    });
    if (darknessMoved(scene.environment?.darknessLevel, next)) {
      updates["environment.darknessLevel"] = next;
      if (Number.isFinite(dt) && Math.abs(dt) < ANIMATE_BELOW) options.animateDarkness = ANIMATE_MS;
    }
  }

  const plan = weatherPlan({
    current: scene.weather ?? "",
    owned: scene.getFlag(MODULE_ID, SKY_WEATHER) ?? null,
    effect: weatherEffect({ kind: weatherNow(), climate: state.climate?.label, season: api.season(now)?.key ?? null }),
  });
  if ("weather" in plan) updates.weather = plan.weather;
  // The record goes in the same update as the effect it records, so the two
  // never disagree. A string flag in an ordinary (recursive) update; nothing
  // here uses recursive: false, so our other flags on the scene are untouched.
  if (plan.own) updates[`flags.${MODULE_ID}.${SKY_WEATHER}`] = plan.own;
  else if ("own" in plan) updates[`flags.${MODULE_ID}.${SKY_WEATHER}`] = _del;

  if (!Object.keys(updates).length) return null;
  await scene.update(updates, options);
  return updates;
}

/**
 * The sky for every scene that follows it and matters now: the active scene
 * and the party's, which is where the map is when a dungeon is active (#294).
 * @returns {Promise<Array<object|null>>} what was written to each
 */
export async function applySkies(options) {
  const scenes = skyScenes({ active: game.scenes?.active, travel: travelScene(), follows: sceneFollows });
  const written = [];
  for (const scene of scenes) written.push(await applySky(scene, options));
  return written;
}

/**
 * One sky pass at a time: real-time light tracking moves the clock every
 * second, and a pass that finds more to do runs once more afterwards.
 * A pass covers the active scene and the party's.
 */
function queueSky(options) {
  // The slot is an object so a trigger without options still queues a re-run;
  // it keeps a pending clock step rather than lose it to a later plain one.
  if (_running) { _again = { options: options ?? _again?.options }; return _running; }
  _running = applySkies(options)
    .catch((err) => console.error(`${MODULE_ID} | the sky on the scene`, err))
    .finally(() => {
      _running = null;
      if (_again) { const { options: o } = _again; _again = null; queueSky(o); }
    });
  return _running;
}

/** Scene Configuration's Environment tab gets the "Follows the sky" choice (GM). */
function onRenderSceneConfig(app, element) {
  if (!game.user?.isGM) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const tab = root?.querySelector('.tab[data-tab="environment"]');
  if (!tab || tab.querySelector(".sde-follows-sky")) return;
  const current = app.document?.getFlag(MODULE_ID, FOLLOWS_SKY) ?? "default";
  const group = document.createElement("div");
  group.className = "form-group sde-follows-sky";
  group.innerHTML = `<label>${esc(t("SDE.overland.sky.follows"))}</label>
    <div class="form-fields"><select name="flags.${MODULE_ID}.${FOLLOWS_SKY}">${
  Object.entries(FOLLOWS_LABEL).map(([v, key]) => `<option value="${v}"${v === current ? " selected" : ""}>${esc(t(key))}</option>`).join("")
}</select></div>
    <p class="hint">${esc(t("SDE.overland.sky.followsHint"))}</p>`;
  tab.prepend(group);
}

// ── Weather visuals, per client (#294) ─────────────────────────────────────

/** This client's switch: off draws no weather effect here, whatever the scene says. */
export const WEATHER_VISUALS = "weatherVisuals";
const visualsOn = () => {
  try { return game.settings.get(MODULE_ID, WEATHER_VISUALS) !== false; } catch { return true; }
};

/** drawWeatherEffects: the layer was just drawn with the scene's effect; with the switch off, drop it. */
export function onDrawWeatherEffects(layer) {
  if (!visualsOn()) layer.clearEffects();
}

/** The switch changed: put this client's effect back or take it away, with no redraw of the scene. */
export function applyWeatherVisuals() {
  const layer = canvas?.weather;
  if (!canvas?.ready || !layer) return;
  if (visualsOn()) layer.initializeEffects(CONFIG.weatherEffects?.[canvas.scene?.weather]);
  else layer.clearEffects();
}

/**
 * Register the client's "Show weather effects" switch and the hook that
 * honours it. Runs at init on every client: the first canvas draw comes
 * before `ready`, and a weather change redraws the scene.
 */
export function registerWeatherVisuals() {
  game.settings.register(MODULE_ID, "weatherVisuals", {
    name: "SDE.settings.weatherVisuals.name",
    hint: "SDE.settings.weatherVisuals.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: applyWeatherVisuals,
  });
  Hooks.on("drawWeatherEffects", onDrawWeatherEffects);
}

export function registerSky() {
  Hooks.on("renderSceneConfig", onRenderSceneConfig);
  Hooks.on("updateWorldTime", (worldTime, dt) => { if (isActiveGM()) queueSky({ dt }); });
  Hooks.on(OVERLAND_CHANGED, () => { if (isActiveGM()) queueSky(); });
  Hooks.on("updateScene", (scene, changed) => {
    if (!isActiveGM()) return;
    const flagChanged = changed.flags?.[MODULE_ID] && FOLLOWS_SKY in changed.flags[MODULE_ID];
    if (changed.active === true || (flagChanged && (scene.active || scene.id === travelScene()?.id))) queueSky();
  });
  // Called from the module's ready hook: set the sky now, on the active scene and the party's.
  if (isActiveGM()) queueSky();
}
