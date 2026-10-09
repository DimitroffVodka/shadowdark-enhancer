/**
 * Shadowdark Enhancer — the travel panel's model, the pure half (#234, Overland O8).
 *
 * What the clock HUD's Travel panel shows (docs/plans/overland.md §4.1), from
 * plain values so it can be tested in Node, and when the HUD redraws; the sky
 * dial's half is hud-core.mjs. Players see no check hours: the checks are in
 * the model for a GM only.
 */

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
    uuid: actors[id].uuid ?? null,
    rations: actors[id].rations,
    int: actors[id].int ?? 0,
    // The actor's own day flag counts too: the state's list is cleared by a restarted day, the flag is what refuses a second forage.
    foraged: state.foraged.includes(id) || !!actors[id].foragedToday,
    found: actors[id].found ?? null,
    canForage: dayOpen && !state.pushed && owns(id) && !state.foraged.includes(id) && !actors[id].foragedToday,
  }));
  return {
    dayOpen,
    hexesLeft: state.hexesLeft,
    budget: state.budget,
    leftShare: state.budget > 0 ? Math.max(0, Math.min(1, state.hexesLeft / state.budget)) : 0,
    method: state.method,
    pushed: state.pushed,
    weather: state.weather?.kind ?? null,
    stormy: !!state.stormy,
    harsh: state.harsh,
    climate: state.climate?.label ?? null,
    members,
    mounts: state.mounts,
    // The pace is the table's: the GM's, or any player whose character travels (applyAction checks it again).
    canPace: isGM || members.some((m) => owns(m.id)),
    pending: isGM && !!state.pending,
    encounter: isGM && !!state.encounter,
    // When a creature woke the camp: the GM's alone, like the check hours, until the encounter is run.
    interrupted: isGM ? state.camp?.interrupted ?? null : null,
    // Players never see the check hours (§4.1).
    checks: isGM ? state.checks.map((c) => ({ half: c.half, at: c.at, rolled: c.rolled, hit: c.hit })) : [],
  };
}

/**
 * What a clock redraw depends on: the absolute minute (so a jump of whole
 * days still redraws; the bar shows the date), the weather that holds, and
 * whether an encounter holds the travel clock. Real-time light tracking ticks
 * every second, so the bar redraws once a minute, not once a tick.
 */
export const redrawStamp = (worldTime, secondsPerMinute, weather, pending = null) =>
  `${Math.floor(worldTime / (secondsPerMinute || 60))}|${weather ?? ""}|${pending ? 1 : 0}`;

/**
 * "19:10" from hours with a fraction, in the calendar's own hours and minutes (`days` is
 * `game.time.calendar.days`): a 100-minute hour reads "19:75", not "20:15".
 */
export const hhmm = (hours, days = globalThis.game?.time?.calendar?.days) => {
  const perHour = days?.minutesPerHour ?? 60, perDay = days?.hoursPerDay ?? 24;
  const minutes = Math.round(hours * perHour);
  return `${String(Math.floor(minutes / perHour) % perDay).padStart(2, "0")}:${String(minutes % perHour).padStart(2, "0")}`;
};

/** Does an Item change touch the bar: an item on one of the travelling members (their rations)? */
export const itemTouchesBar = (item, members) =>
  item?.parent?.documentName === "Actor" && members.includes(item.parent.id);
