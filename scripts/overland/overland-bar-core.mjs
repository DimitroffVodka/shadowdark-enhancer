/**
 * Shadowdark Enhancer — the travel bar, the pure half (#234, Overland O8).
 *
 * What the bar shows (docs/plans/overland.md §4.1), worked out from plain
 * values so it can be tested in Node; overland-bar.mjs puts it on screen.
 * Players see no check hours: the checks are in the model for a GM only.
 */

/** A sky dome: an arc from the left horizon to the right, in its SVG's units. */
export const DOME = { cx: 60, cy: 54, r: 46 };

/**
 * Where the sky's body is: the sun from sunrise to sunset, else the moon
 * from sunset to the next sunrise, as progress 0 (rising) to 1 (setting).
 * @param {{hour:number, sunrise:number, sunset:number, hoursPerDay?:number}} sky  hours with fractions
 * @returns {{isDay:boolean, progress:number}}
 */
export function skyPosition({ hour, sunrise, sunset, hoursPerDay = 24 }) {
  if (hour >= sunrise && hour < sunset) return { isDay: true, progress: (hour - sunrise) / (sunset - sunrise) };
  const night = hoursPerDay - (sunset - sunrise);
  const since = hour >= sunset ? hour - sunset : hour + hoursPerDay - sunset;
  return { isDay: false, progress: night > 0 ? Math.min(1, since / night) : 0 };
}

/** The point on the dome's arc at `progress` (0 left horizon, 0.5 overhead, 1 right horizon). */
export function domePoint(progress, { cx, cy, r } = DOME) {
  const angle = Math.PI * (1 - Math.min(1, Math.max(0, progress)));
  return { x: +(cx + r * Math.cos(angle)).toFixed(2), y: +(cy - r * Math.sin(angle)).toFixed(2) };
}

/**
 * The moon's shadow as a disc laid over it, shifted sideways: none at full,
 * the whole disc at new. Waxing, the lit side is the right; waning, the left.
 * @param {{fraction:number, illumination:number}} moon  time.moonPhase()
 * @returns {number} the shadow's x offset in moon radii, from -2 to 2
 */
export function moonShadow({ fraction, illumination }) {
  const shift = 2 * Math.min(1, Math.max(0, illumination));
  return fraction < 0.5 ? -shift : shift;
}

/**
 * The bar's model for one viewer.
 * @param {{state:object, isGM:boolean, owns:(actorId:string) => boolean,
 *   actors:Object<string,{name:string, rations:number}>}} view
 *   `state`: overland.state(); `actors`: the members' names and ration counts
 */
export function barModel({ state, isGM, owns, actors }) {
  const dayOpen = Number.isFinite(state.day);
  const members = state.members.filter((id) => actors[id]).map((id) => ({
    id,
    name: actors[id].name,
    rations: actors[id].rations,
    foraged: state.foraged.includes(id),
    canForage: dayOpen && !state.pushed && owns(id) && !state.foraged.includes(id),
  }));
  return {
    dayOpen,
    hexesLeft: state.hexesLeft,
    budget: state.budget,
    spentShare: state.budget > 0 ? Math.min(1, state.spent / state.budget) : 0,
    method: state.method,
    pushed: state.pushed,
    weather: state.weather?.kind ?? null,
    stormy: !!state.stormy,
    harsh: state.harsh,
    climate: state.climate?.label ?? null,
    members,
    mounts: state.mounts,
    pending: isGM && !!state.pending,
    // Players never see the check hours (§4.1).
    checks: isGM ? state.checks.map((c) => ({ half: c.half, at: c.at, rolled: c.rolled, hit: c.hit })) : [],
  };
}
