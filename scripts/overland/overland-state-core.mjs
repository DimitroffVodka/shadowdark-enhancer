/**
 * Shadowdark Enhancer — Overland travel state, the pure half (#229).
 *
 * One travel state per world (docs/plans/overland.md §2, decided 2026-09-26),
 * stored in the `overlandState` world setting and written only by the active
 * GM (overland.mjs). This file holds its shape, normalization and reducers, so
 * they are testable in Node, the same split as crawl-state-core.mjs.
 *
 * O3 owns the token, members, method and the hex, and O4 the weather (#230).
 * The day's budget and the clock (#231), encounter checks (#232) and forage
 * and rations (#233) fill their fields later. Each field is here with its
 * default, so those pieces add behaviour, not shape.
 */

export const OVERLAND_VERSION = 1;
export const METHODS = ["walking", "mounted", "sailing"];
export const WEATHER_RULES = ["western", "core"];
export const WEATHER_KINDS = ["stormy", "fair", "excellent"];

/** @returns {object} a fresh travel state: no token, no day open */
export function defaultOverlandState() {
  return {
    _v: OVERLAND_VERSION,
    tokenUuid: null,      // the travel token (§2.1, Q5)
    members: [],          // actor ids: who eats, forages and rolls the underground check
    mounts: 0,            // mounts to feed
    day: null,            // worldTime of the open travel day's dawn; null: no day open
    method: "walking",    // rules.hexesPerDay(method)
    boatUuid: null,       // aboard a boat actor, its speed is the budget
    pushed: false,        // chosen at dawn only
    budget: 0,            // the day's points, fixed at dawn
    spent: 0,             // points spent; hexes left = budget - spent
    weather: null,        // {kind, roll, rule, until, advantageNext, advantage, days} (#230)
    checks: [],           // the day's encounter checks (#232)
    pending: null,        // {until, reason}: an advance stopped by a hit (#232)
    foraged: [],          // actor ids that foraged today (#233)
    hex: null,            // {num, terrain, region, features}: the travel token's last hex
  };
}

const str = (v) => (typeof v === "string" && v ? v : null);
const int = (v, min = 0) => (Number.isFinite(Number(v)) ? Math.max(min, Math.trunc(Number(v))) : min);
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).filter((id) => typeof id === "string" && id))];
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? { ...v } : null);

/** A stored weather, or null when it isn't one. */
function weatherOf(v) {
  if (!obj(v) || !WEATHER_KINDS.includes(v.kind)) return null;
  return {
    kind: v.kind,
    roll: int(v.roll, 1),
    rule: WEATHER_RULES.includes(v.rule) ? v.rule : WEATHER_RULES[0],
    until: Number.isFinite(v.until) ? v.until : 0,
    advantageNext: v.advantageNext === true,
    advantage: v.advantage === true,
    days: Number.isInteger(v.days) && v.days > 0 ? v.days : null,
  };
}

/**
 * Coerce anything (a legacy or malformed setting) into a well-formed state.
 * Unknown fields are dropped; idempotent.
 * @param {*} value
 * @returns {object}
 */
export function normalizeOverlandState(value) {
  const base = defaultOverlandState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const hex = obj(value.hex);
  return {
    _v: OVERLAND_VERSION,
    tokenUuid: str(value.tokenUuid),
    members: ids(value.members),
    mounts: int(value.mounts),
    day: Number.isFinite(value.day) ? value.day : null,
    method: METHODS.includes(value.method) ? value.method : base.method,
    boatUuid: str(value.boatUuid),
    pushed: value.pushed === true,
    budget: int(value.budget),
    spent: int(value.spent),
    weather: weatherOf(value.weather),
    checks: Array.isArray(value.checks) ? value.checks.map(obj).filter(Boolean) : [],
    pending: obj(value.pending),
    foraged: ids(value.foraged),
    hex: hex && Number.isInteger(hex.num)
      ? { num: hex.num, terrain: str(hex.terrain), region: str(hex.region), features: ids(hex.features) }
      : null,
  };
}

// ── Reducers: each returns {state, changed} ────────────────────────────────

/**
 * Start (or resume) travel with this token and these members. An open day is
 * kept, so ending and restarting travel mid-day loses nothing (§4.3).
 * @param {object} state
 * @param {{tokenUuid:string, members:string[], method?:string}} opts
 */
export function startTravel(state, { tokenUuid, members, method } = {}) {
  const next = normalizeOverlandState({
    ...state,
    tokenUuid: tokenUuid ?? state.tokenUuid,
    members: members ?? state.members,
    method: method ?? state.method,
  });
  return { state: next, changed: JSON.stringify(next) !== JSON.stringify(state) };
}

/** The travel token stands in this hex now. Kept across scene changes. */
export function setHex(state, hex) {
  const next = normalizeOverlandState({ ...state, hex });
  return { state: next, changed: JSON.stringify(next.hex) !== JSON.stringify(state.hex) };
}

/** Record that a member foraged today. The check itself is #233's. */
export function recordForage(state, actorId) {
  if (state.foraged.includes(actorId)) return { state, changed: false };
  return { state: { ...state, foraged: [...state.foraged, actorId] }, changed: true };
}

/** Today's weather is this one (a roll, or a reroll replacing it). */
export function setWeather(state, weather) {
  const next = normalizeOverlandState({ ...state, weather });
  return { state: next, changed: JSON.stringify(next.weather) !== JSON.stringify(state.weather) };
}

// ── Decisions ──────────────────────────────────────────────────────────────

/**
 * Which token travels (decided, Q5): the Extras party token when exactly one
 * is on the scene; otherwise the one token the GM has selected.
 * @param {{partyTokens:string[], controlled:string[]}} tokens  token uuids
 * @returns {{uuid:string|null, reason:"party"|"selected"|"pick"}}
 */
export function pickTravelToken({ partyTokens = [], controlled = [] } = {}) {
  if (partyTokens.length === 1) return { uuid: partyTokens[0], reason: "party" };
  if (controlled.length === 1) return { uuid: controlled[0], reason: "selected" };
  return { uuid: null, reason: "pick" };
}

/**
 * May this forage be recorded? Ownership is checked before this, from the
 * query's authenticated user (gm-relay.mjs authorizeActorFor); this is the
 * travel side of it.
 * @param {{travelling:boolean, member:boolean, foraged:boolean}} s
 * @returns {null|"notTravelling"|"notMember"|"alreadyForaged"} null: allowed
 */
export function forageRefusal({ travelling, member, foraged }) {
  if (!travelling) return "notTravelling";
  if (!member) return "notMember";
  if (foraged) return "alreadyForaged";
  return null;
}

// ── Weather and climate (#230, design §5.1) ────────────────────────────────

/** Does this weather still hold at `now`? Each roll holds until a dawn. */
export const weatherHolds = (weather, now) => !!weather && weather.until > now;

/**
 * Does the roll about to be made have advantage? Only under the Western
 * Reaches rule: a 6 gives the NEXT roll 2d6 keep highest. A reroll (Predict)
 * replaces today's roll rather than following it, so it has the advantage the
 * replaced roll had.
 */
export function weatherAdvantage(weather, { rule, reroll = false, now = 0 }) {
  if (rule !== "western" || weather?.rule !== "western") return false;
  return reroll && weatherHolds(weather, now) ? weather.advantage : weather.advantageNext;
}

/** The dice for a weather roll. */
export const weatherFormula = (advantage) => (advantage ? "2d6kh" : "1d6");

/**
 * Today's weather from the kept d6.
 * - Western Reaches: 1 is stormy, 6 is excellent and the next roll has
 *   advantage, 2 to 5 is fair; it holds until the next dawn.
 * - Core: 1 is a storm lasting `stormDays` (the 1d4) dawns, with no roll while
 *   it lasts; anything else is fair until the next dawn.
 * @param {{rule:string, roll:number, advantage?:boolean, stormDays?:number|null,
 *   dawnAfter:(n:number) => number}} r  `dawnAfter(n)`: the worldTime of the nth dawn from now
 */
export function weatherFromRoll({ rule, roll, advantage = false, stormDays = null, dawnAfter }) {
  const storm = roll === 1;
  if (rule === "core") {
    const days = storm ? Math.max(1, Math.trunc(stormDays) || 1) : null;
    return { kind: storm ? "stormy" : "fair", roll, rule, until: dawnAfter(days ?? 1), advantageNext: false, advantage: false, days };
  }
  return {
    kind: storm ? "stormy" : roll === 6 ? "excellent" : "fair",
    roll, rule: "western", until: dawnAfter(1), advantageNext: roll === 6, advantage, days: null,
  };
}

/**
 * Is today harsh: the climate is harsh always (†), or harsh in storms (*) and
 * it is stormy. null when the region's climate isn't known (#195 not filled
 * in, or no hex yet).
 * @param {{harsh:""|"storm"|"always"}|null} climate  rules.climate()
 */
export function harshToday(climate, stormy) {
  if (!climate) return null;
  return climate.harsh === "always" || (climate.harsh === "storm" && !!stormy);
}

/**
 * What entering `hex` from `from` costs today (§5.2, §5.7): impassable
 * (Infinity) when stormy in a harsh climate, whatever the terrain; 1 from one
 * path hex to another; else the rules' terrain cost, which storms raise to
 * difficult. 1 for a hex with no terrain (a map with no tags), null when the
 * rules data doesn't know the terrain. A river feature never changes it.
 * @param {(terrain:string, opts:object) => number|null} terrainCost  rules.terrainCost
 */
export function hexCost(terrainCost, hex, { from = null, stormy = false, harsh = false, boat = false } = {}) {
  if (stormy && harsh) return Infinity;
  if (!hex?.terrain) return 1;
  const onPath = (h) => (h?.features ?? []).includes("path");
  if (onPath(hex) && onPath(from)) return 1;
  return terrainCost(hex.terrain, { boat, weather: stormy ? "stormy" : "", harsh: !!harsh });
}
