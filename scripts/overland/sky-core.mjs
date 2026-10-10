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
/** The twilight's ease runs this many hours around each sun event (#389). */
const EASE_HOURS = 4;
/** The ease starts this many hours before its sun event. */
const LEAD = 1;

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
 * How dark an outdoor scene is: 0 by day; around each sun event the light
 * eases between the day and the night level over four hours, from an hour
 * before the event to three hours after it, on the cosine curve measured on
 * Ember (#389). The night level is 1 − 0.2 × the moon's illumination, so a
 * full-moon night is 0.8. The hex map stops at its cap.
 * The Midnight Sun never goes above 0.3; the Long Dark holds the night level all day.
 * @param {{hour:number, sunrise:number, sunset:number, illumination:number,
 *   cap?:number, override?:string|null}} sky  hours with fractions
 * @returns {number} 0 to 1, to two decimals
 */
export function darknessAt({ hour, sunrise, sunset, illumination, cap = 1, override = null }) {
  const night = 1 - 0.2 * Math.min(1, Math.max(0, illumination));
  const dawnStart = sunrise - LEAD, dawnEnd = dawnStart + EASE_HOURS;
  const duskStart = sunset - LEAD, duskEnd = duskStart + EASE_HOURS;
  const dawnEase = 0.5 * (1 + Math.cos((Math.PI * (hour - dawnStart)) / EASE_HOURS));
  const duskEase = 0.5 * (1 - Math.cos((Math.PI * (hour - duskStart)) / EASE_HOURS));
  let level;
  if (override === "longDark") level = night;
  else if (hour >= dawnStart && hour < dawnEnd) level = night * dawnEase;
  else if (hour >= duskStart && hour < duskEnd) level = night * duskEase;
  else if (hour >= dawnEnd && hour < duskStart) level = 0;
  else level = night;
  if (override === "midnightSun") level = Math.min(level, 0.3);
  return Math.round(Math.min(level, cap) * 100) / 100;
}

/** Is the change worth a write? */
export const darknessMoved = (current, next) => Math.abs((Number(current) || 0) - next) >= MIN_STEP - 1e-9;

/**
 * What a fair day shows, by season (#294): falling leaves in autumn, nothing
 * in winter (snow on a fair day read as a storm), spring or summer. Cosmetic only: the
 * weather kind, and the rules that read it, are unchanged. Stormy and
 * excellent days are not in this table (a storm is a rain storm, or a
 * blizzard in the cold; an excellent day shows nothing). Change a row here.
 */
export const FAIR_DAY_EFFECT = { winter: "", autumn: "leaves", spring: "", summer: "" };

/**
 * The weather on an outdoor scene: Foundry's rain storm when stormy, its
 * blizzard when stormy in a cold or freezing climate, the season's effect on
 * a fair day (FAIR_DAY_EFFECT), else none.
 * @param {{kind?:string|null, climate?:string|null, season?:string|null}} w
 *   `kind`: today's weather, stormy | fair | excellent (null when none holds);
 *   `climate`: the climate's label; `season`: time.season().key
 * @returns {string} a CONFIG.weatherEffects key, or "" for none
 */
export function weatherEffect({ kind = null, climate = null, season = null }) {
  if (kind === "stormy") return /cold|freez/i.test(String(climate ?? "")) ? "blizzard" : "rainStorm";
  return kind === "fair" && Object.hasOwn(FAIR_DAY_EFFECT, season) ? FAIR_DAY_EFFECT[season] : "";
}

/**
 * What to do with a scene's weather effect (#251 review). Overland changes or
 * clears only an effect it put there itself and that is still there
 * (`owned`, the scene's record of it); it takes an empty slot for a storm; and
 * any other effect, a GM's rain storm included, is left alone. When another
 * writer has changed an effect Overland put there, Overland lets it go.
 * @param {{current:string, owned:string|null, effect:string}} w
 *   `current`: the scene's weather; `owned`: what Overland last set, if recorded; `effect`: what it wants now
 * @returns {{weather?:string, own?:string|null}} the changes: the weather to write, and the record (null drops it)
 */
export function weatherPlan({ current, owned, effect }) {
  if (owned && owned !== current) return { own: null };
  if (owned) return effect === current ? {} : { weather: effect, own: effect || null };
  return !current && effect ? { weather: effect, own: effect } : {};
}

/**
 * The scenes the sky writes to: the active scene and the party's (the scene
 * of the Overland travel token), once each, those that follow the sky (#294).
 * A GM can have a dungeon active while the party is on the hex map.
 * @param {{active?:object|null, travel?:object|null, follows:(scene:object)=>boolean}} w
 */
export function skyScenes({ active = null, travel = null, follows }) {
  const seen = new Set();
  return [active, travel].filter((scene) => {
    if (!scene || seen.has(scene.id) || !follows(scene)) return false;
    seen.add(scene.id);
    return true;
  });
}

/**
 * Does this scene follow the sky? The scene's own choice, else yes for a
 * hex map (any hex grid) and no everywhere else, so a dungeon stays as it is.
 * @param {"on"|"off"|"default"|undefined} choice  the scene's followsSky flag
 */
export const followsSky = (choice, isHexMap) => (choice === "on" ? true : choice === "off" ? false : !!isHexMap);
