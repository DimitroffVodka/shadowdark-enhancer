/**
 * Shadowdark Enhancer — extra weather looks.
 *
 * A look is one of Foundry's own weather effects with other settings laid over
 * it, so it runs on core's shaders and joins Scene Configuration's Weather list
 * on every scene. They are for the GM to pick; Overland still picks only the
 * effects in sky-core.mjs. Registered once at init, after core has built
 * CONFIG.weatherEffects; a look whose core source a later Foundry no longer
 * has is skipped, never thrown on.
 */

/**
 * The looks. Each part names a core effect (`from`), the shader entry in it
 * (`effect`), and the config that goes over that entry's own. The first part's
 * effect also lends the look its filter.
 */
export const WEATHER_LOOKS = [
  {
    id: "sdeDrizzle", label: "SDE.weather.drizzle",
    parts: [{ from: "rain", effect: "rainShader", config: { opacity: 0.25, intensity: 1, strength: 0.8 } }],
  },
  {
    id: "sdeMist", label: "SDE.weather.mist",
    parts: [{ from: "fog", effect: "fogShader", config: { intensity: 0.15, slope: 0.35, speed: 0.2 } }],
  },
  {
    id: "sdeHeavyFog", label: "SDE.weather.heavyFog",
    parts: [{ from: "fog", effect: "fogShader", config: { tint: [0.82, 0.86, 0.9], intensity: 0.8, slope: 0.6, speed: 0.25 } }],
  },
  {
    id: "sdeSleet", label: "SDE.weather.sleet",
    parts: [
      { from: "rain", effect: "rainShader", config: { opacity: 0.3, tint: [0.8, 0.9, 1], intensity: 1.2, strength: 1.2, rotation: 0.4 } },
      { from: "snow", effect: "snowShader", config: { tint: [0.9, 0.95, 1], direction: 0.7, speed: 4 } },
    ],
  },
  {
    id: "sdeDustStorm", label: "SDE.weather.dustStorm",
    parts: [{ from: "fog", effect: "fogShader", config: { tint: [0.85, 0.68, 0.42], intensity: 0.8, slope: 0.5, speed: 6 } }],
  },
];

/**
 * Our looks as CONFIG.weatherEffects entries, built from core's. Core's
 * entries are not changed.
 * @param {Record<string, object>} core  CONFIG.weatherEffects
 * @returns {Record<string, object>}  look id to entry
 */
export function buildLooks(core, looks = WEATHER_LOOKS) {
  const built = {};
  for (const look of looks) {
    const effects = look.parts.map(({ from, effect, config }) => {
      const base = core?.[from]?.effects?.find((e) => e.id === effect);
      return base && { ...base, config: { ...base.config, ...config } };
    });
    if (effects.includes(undefined) || effects.includes(null)) continue;
    built[look.id] = { ...core[look.parts[0].from], id: look.id, label: look.label, effects };
  }
  return built;
}

/** Add the looks to Foundry's list. Runs at init, on every client. */
export function registerWeatherLooks() {
  Object.assign(CONFIG.weatherEffects, buildLooks(CONFIG.weatherEffects));
}
