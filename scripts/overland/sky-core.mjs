/**
 * Shadowdark Enhancer — the sky on scenes, the pure half (#235, Overland O9).
 *
 * Design: docs/plans/overland.md §6.2. Outdoor scenes darken with the sun and
 * the moon, and show the weather; the Isles of Andrik keep their own skies.
 * sky.mjs writes the answers onto scenes.
 */

/** The hex overview map darkens only to a readable tint (decided, Q7). */
export const HEX_MAP_CAP = 0.6;
/** A darkness change smaller than this isn't written. */
export const MIN_STEP = 0.02;
/** How long a twilight lasts, in hours: after sunset and before sunrise. */
const TWILIGHT = 1;

/** The Isles of Andrik, by the region name the hex scan gives. */
const ISLES = /^\s*(the\s+)?isles?\s+of\s+andrik\s*$/i;

/**
 * The Isles of Andrik's skies (a shipped recipe, source: GMWR; no book text):
 * the Midnight Sun in spring and summer, the Long Dark in winter, and an
 * ordinary autumn. null anywhere else.
 * @param {string|null} region  the party's region
 * @param {string|null} season  time.season().key
 * @returns {null|"midnightSun"|"longDark"}
 */
export function skyOverride(region, season) {
  if (!ISLES.test(String(region ?? ""))) return null;
  if (season === "spring" || season === "summer") return "midnightSun";
  if (season === "winter") return "longDark";
  return null;
}

/** Is it night, with the Isles' skies taken into account? */
export function nightWithOverride(isNight, override) {
  if (override === "midnightSun") return false;
  if (override === "longDark") return true;
  return isNight;
}

/**
 * How dark an outdoor scene is: 0 by day; over a one-hour twilight after
 * sunset it deepens to the night level, and in the hour before sunrise it
 * lifts again. The night level is 1 − 0.2 × the moon's illumination, so a
 * full-moon night is 0.8. The hex map stops at its cap.
 * The Midnight Sun never goes above 0.3; the Long Dark holds the night level all day.
 * @param {{hour:number, sunrise:number, sunset:number, illumination:number,
 *   cap?:number, override?:string|null}} sky  hours with fractions
 * @returns {number} 0 to 1, to two decimals
 */
export function darknessAt({ hour, sunrise, sunset, illumination, cap = 1, override = null }) {
  const night = 1 - 0.2 * Math.min(1, Math.max(0, illumination));
  let level;
  if (override === "longDark") level = night;
  else if (hour >= sunrise && hour < sunset) level = 0;
  else if (hour >= sunset && hour < sunset + TWILIGHT) level = night * ((hour - sunset) / TWILIGHT);
  else if (hour < sunrise && hour >= sunrise - TWILIGHT) level = night * ((sunrise - hour) / TWILIGHT);
  else level = night;
  if (override === "midnightSun") level = Math.min(level, 0.3);
  return Math.round(Math.min(level, cap) * 100) / 100;
}

/** Is the change worth a write? */
export const darknessMoved = (current, next) => Math.abs((Number(current) || 0) - next) >= MIN_STEP - 1e-9;

/**
 * The weather on an outdoor scene: Foundry's rain storm when stormy, its
 * blizzard when stormy in a cold or freezing climate, else none.
 * @param {{stormy:boolean, climate?:string|null}} w  `climate`: the climate's label
 * @returns {""|"rainStorm"|"blizzard"}
 */
export function weatherEffect({ stormy, climate = null }) {
  if (!stormy) return "";
  return /cold|freez/i.test(String(climate ?? "")) ? "blizzard" : "rainStorm";
}

/**
 * Does this scene follow the sky? The scene's own choice, else yes for a
 * tagged hex map and no everywhere else, so a dungeon stays as it is.
 * @param {"on"|"off"|"default"|undefined} choice  the scene's followsSky flag
 */
export const followsSky = (choice, isHexMap) => (choice === "on" ? true : choice === "off" ? false : !!isHexMap);

/**
 * Does Calendaria drive this scene's darkness? Its scene flag wins
 * ("enabled"/true or "disabled"/false); otherwise its darknessSync setting.
 * Only one writer may own a scene's darkness.
 */
export function calendariaDrives({ active, sceneFlag, worldSetting }) {
  if (!active) return false;
  if (sceneFlag === true || sceneFlag === "enabled") return true;
  if (sceneFlag === false || sceneFlag === "disabled") return false;
  return !!worldSetting;
}
