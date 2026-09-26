/**
 * Shadowdark Enhancer — the sky on scenes (#235, Overland O9, docs/plans/overland.md §6.2).
 *
 * The active GM writes the active scene's darkness and weather effect when
 * the clock moves, when Overland's weather or hex changes, and when a scene
 * is activated. Only a scene that follows the sky is touched: a tagged hex
 * map by default, and any scene its GM marks in Scene Configuration's
 * Environment tab. A dungeon stays as it is unless it is marked.
 *
 * - Darkness (sky-core.mjs darknessAt) is written only when it moves by 0.02
 *   or more, animated for a step under an hour. The hex map stops at 0.6.
 *   Nothing is written when the scene's darkness is locked, or when
 *   Calendaria drives that scene's darkness: one writer per scene.
 * - Weather: Foundry's rainStorm when stormy, its blizzard when stormy in a
 *   cold climate, else none. A weather effect the GM chose (fog, snow...) is
 *   left alone.
 * - The Isles of Andrik keep their own skies, by the party's region.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { esc } from "../shared/esc.mjs";
import { overlandState, OVERLAND_CHANGED } from "./overland.mjs";
import {
  HEX_MAP_CAP, calendariaDrives, darknessAt, darknessMoved, followsSky, skyOverride, weatherEffect,
} from "./sky-core.mjs";

export const FOLLOWS_SKY = "followsSky";
/** The weather effects Overland sets; any other is the GM's and stays. */
const OURS = new Set(["", "rainStorm", "blizzard"]);
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

/** A setting of another module, or undefined when it isn't registered. */
function otherSetting(ns, key) {
  try { return game.settings.get(ns, key); } catch { return undefined; }
}

let _calendariaNoted = false;
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

  const calendaria = calendariaDrives({
    active: !!game.modules?.get("calendaria")?.active,
    sceneFlag: scene.getFlag?.("calendaria", "darknessSync"),
    worldSetting: otherSetting("calendaria", "darknessSync"),
  });
  if (calendaria) {
    if (!_calendariaNoted) console.log(`${MODULE_ID} | Calendaria drives scene darkness here; Overland leaves it alone`);
    _calendariaNoted = true;
  } else if (!scene.environment?.darknessLock) {
    const c = game.time.calendar.timeToComponents(now);
    const next = darknessAt({
      hour: c.hour + c.minute / 60, ...api.sun(now), illumination: api.moonPhase(now).illumination,
      cap: hex ? HEX_MAP_CAP : 1, override,
    });
    if (darknessMoved(scene.environment?.darknessLevel, next)) {
      updates["environment.darknessLevel"] = next;
      if (Number.isFinite(dt) && Math.abs(dt) < ANIMATE_BELOW) options.animateDarkness = ANIMATE_MS;
    }
  }

  const current = scene.weather ?? "";
  const effect = weatherEffect({ stormy: state.stormy, climate: state.climate?.label });
  if (effect !== current && OURS.has(current)) updates.weather = effect;

  if (!Object.keys(updates).length) return null;
  await scene.update(updates, options);
  return updates;
}

/**
 * One sky pass at a time: real-time light tracking moves the clock every
 * second, and a pass that finds more to do runs once more afterwards.
 */
function queueSky(scene, options) {
  if (_running) { _again = [scene, options]; return _running; }
  _running = applySky(scene, options)
    .catch((err) => console.error(`${MODULE_ID} | the sky on the scene`, err))
    .finally(() => {
      _running = null;
      if (_again) { const [s, o] = _again; _again = null; queueSky(s, o); }
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

export function registerSky() {
  Hooks.on("renderSceneConfig", onRenderSceneConfig);
  Hooks.on("updateWorldTime", (worldTime, dt) => { if (isActiveGM()) queueSky(undefined, { dt }); });
  Hooks.on(OVERLAND_CHANGED, () => { if (isActiveGM()) queueSky(); });
  Hooks.on("updateScene", (scene, changed) => {
    if (!isActiveGM()) return;
    const flagChanged = changed.flags?.[MODULE_ID] && FOLLOWS_SKY in changed.flags[MODULE_ID];
    if (changed.active === true || (flagChanged && scene.active)) queueSky(scene);
  });
  // Called from the module's ready hook: set the active scene's sky now.
  if (isActiveGM()) queueSky();
}
