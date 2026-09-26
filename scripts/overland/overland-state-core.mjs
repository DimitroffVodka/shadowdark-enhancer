/**
 * Shadowdark Enhancer — Overland travel state, the pure half (#229).
 *
 * One travel state per world (docs/plans/overland.md §2, decided 2026-09-26),
 * stored in the `overlandState` world setting and written only by the active
 * GM (overland.mjs). This file holds its shape, normalization and reducers, so
 * they are testable in Node, the same split as crawl-state-core.mjs.
 *
 * O3 owns the token, members, method and the hex; weather (#230), the day's
 * budget and the clock (#231), encounter checks (#232) and forage and rations
 * (#233) fill their fields later. Each field is here with its default, so
 * those pieces add behaviour, not shape.
 */

export const OVERLAND_VERSION = 1;
export const METHODS = ["walking", "mounted", "sailing"];

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
    weather: null,        // {kind, roll, rule, until, advantageNext} (#230)
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
    weather: obj(value.weather),
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
