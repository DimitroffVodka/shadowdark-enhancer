/**
 * Shadowdark Enhancer — CrawlState core (pure, Foundry-free, node-testable).
 *
 * Holds the state shape, normalization, and reducer logic for the strip's
 * mode singleton. crawl-state.mjs wraps these with the Foundry-coupled I/O
 * (world-setting persistence, socket broadcast, GM gating, Hooks). Kept
 * separate so the domain rules can be unit-tested without mocking Foundry —
 * the same split as party-xp-core.mjs / loot-value.mjs.
 */

export const STATE_VERSION = 2;

const VALID_MODES = new Set(["off", "crawl", "combat"]);
// priorMode only ever needs to hold what to restore ON EXIT FROM COMBAT, so
// "combat" itself is never a valid value here.
const VALID_PRIOR_MODES = new Set(["off", "crawl"]);

/**
 * Versioned default state. `members` has been part of the shape since v1; it
 * holds ACTOR ids (world-scoped crawl roster), resolved to per-scene tokens by
 * the Foundry-facing layer. `oocInitiative` is likewise keyed by actor id.
 *
 * v2 adds `oocTurn`: the actor id of the current out-of-combat turn-holder
 * (issue #14's "whose turn is it" pointer), or null when no order is
 * established. The migration is purely additive — v1 state normalizes with
 * `oocTurn: null`, and the first initiative roll of an upgraded world
 * establishes the pointer (rolling sets it when unset).
 */
export function defaultCrawlState() {
  return { _v: STATE_VERSION, mode: "off", crawlTurn: 0, oocInitiative: {}, oocTurn: null, members: [], priorMode: "off" };
}

/**
 * Coerce an arbitrary value (malformed payload, legacy pre-`_v` setting,
 * socket message, etc.) into a well-formed state. Unknown fields are
 * stripped; missing/invalid fields fall back to the default. Idempotent —
 * normalizing an already-normalized state returns an equal state.
 */
export function normalizeCrawlState(value) {
  const base = defaultCrawlState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;

  const mode = VALID_MODES.has(value.mode) ? value.mode : base.mode;
  const priorMode = VALID_PRIOR_MODES.has(value.priorMode) ? value.priorMode : base.priorMode;

  let crawlTurn = Number(value.crawlTurn);
  crawlTurn = Number.isFinite(crawlTurn) && crawlTurn >= 0 ? Math.trunc(crawlTurn) : base.crawlTurn;

  let oocInitiative = base.oocInitiative;
  if (value.oocInitiative && typeof value.oocInitiative === "object" && !Array.isArray(value.oocInitiative)) {
    oocInitiative = { ...value.oocInitiative };
  }

  let members = base.members;
  if (Array.isArray(value.members)) {
    const seen = new Set();
    members = [];
    for (const id of value.members) {
      if (typeof id === "string" && id && !seen.has(id)) { seen.add(id); members.push(id); }
    }
  }

  // The pointer is only ever valid when it names a member who is actually in
  // the rolled order; anything else normalizes away to null (never strands a
  // stale id in the persisted shape).
  let oocTurn = base.oocTurn;
  if (typeof value.oocTurn === "string" && value.oocTurn
    && members.includes(value.oocTurn)
    && oocInitiative[value.oocTurn]?.roll != null) {
    oocTurn = value.oocTurn;
  }

  return { _v: STATE_VERSION, mode, crawlTurn, oocInitiative, oocTurn, members, priorMode };
}

// ── Pure reducers ────────────────────────────────────────────────────────
//
// Each reducer takes a normalized state (plus any extra args) and returns
// `{ state, changed }` — `changed: false` means the input is returned as-is
// and the caller should skip persistence/broadcast (idempotency / no-op
// guards live here, not just in the Foundry-facing wrapper).

/** Members with an initiative entry, in the strip's order (roll desc). */
function orderedMembers(state) {
  return state.members
    .filter(id => hasOocRoll(state.oocInitiative, id))
    .sort((a, b) => (state.oocInitiative[b].roll ?? -Infinity) - (state.oocInitiative[a].roll ?? -Infinity));
}

/** The member with the highest roll (first in members order on ties), or null. */
function topOfOrder(state) {
  const order = orderedMembers(state);
  return order.length > 0 ? order[0] : null;
}

// ── Out-of-combat order facts (issue #14 part 2) ────────────────────────────
//
// The "does this member have a roll" check is the single shared primitive for
// the OoC order: the tracker derives its rolled-count from it, and the strip
// render + relay handler derive completeness through oocOrderComplete, so the
// three call sites that read CrawlState cannot drift apart.

/**
 * Does this crawl member have an out-of-combat initiative roll?
 * @param {object} oocInitiative  The state's oocInitiative map (CrawlState-shaped).
 * @param {string} actorId        Crawl member actor id.
 * @returns {boolean}
 */
export function hasOocRoll(oocInitiative, actorId) {
  return oocInitiative?.[actorId]?.roll != null;
}

/**
 * Is the out-of-combat order COMPLETE — every crawl member has rolled?
 * An incomplete order is not an order: the OoC lock, the advance button and
 * the holder highlight all engage only once this holds (an empty roster is
 * never an order). Callers reading CrawlState use this (or hasOocRoll for
 * the tracker's counts) instead of re-deriving the rule.
 * @param {{members: string[], oocInitiative: object}} state  CrawlState-shaped.
 * @returns {boolean}
 */
export function oocOrderComplete(state) {
  const members = state?.members ?? [];
  const oocInitiative = state?.oocInitiative ?? {};
  return members.length > 0 && members.every(id => hasOocRoll(oocInitiative, id));
}

/**
 * Enter combat mode, stamping `priorMode` INTO the persisted state (not
 * client-local memory) so a page reload, or a different GM becoming active
 * GM mid-combat, still restores the correct mode on exit. No-op if already
 * in combat.
 */
export function enterCombatMode(state) {
  if (state.mode === "combat") return { state, changed: false };
  return { state: { ...state, mode: "combat", priorMode: state.mode }, changed: true };
}

/**
 * Restore the mode captured by enterCombatMode from `state.priorMode`, then
 * reset priorMode back to "off" (consumed). No-op if not in combat.
 */
export function exitCombatMode(state) {
  if (state.mode !== "combat") return { state, changed: false };
  return { state: { ...state, mode: state.priorMode ?? "off", priorMode: "off" }, changed: true };
}

/** Start a crawl: clears leftover OoC initiative and its turn pointer. No-op during combat. */
export function startCrawl(state) {
  if (state.mode === "combat") return { state, changed: false };
  return { state: { ...state, mode: "crawl", oocInitiative: {}, oocTurn: null }, changed: true };
}

/** End a crawl: resets turn/members/OoC initiative. No-op during combat. */
export function endCrawl(state) {
  if (state.mode === "combat") return { state, changed: false };
  return { state: { ...state, mode: "off", crawlTurn: 0, members: [], oocInitiative: {}, oocTurn: null }, changed: true };
}

/** Add actor IDs to the crawl roster, deduplicated. No-op if none are new. */
export function addMembers(state, actorIds) {
  const ids = Array.isArray(actorIds) ? actorIds : [];
  const current = new Set(state.members);
  const newIds = [];
  for (const id of ids) {
    if (id && !current.has(id)) { current.add(id); newIds.push(id); }
  }
  if (newIds.length === 0) return { state, newIds, changed: false };
  return { state: { ...state, members: [...current] }, newIds, changed: true };
}

/**
 * Remove one actor ID from the roster, dropping their initiative entry along
 * with it (a departed member's roll would otherwise accumulate in persisted
 * world state forever). If the departing member held the out-of-combat turn,
 * the pointer passes to the NEXT member in the rolled order (wrapping), or
 * clears when nobody with a roll remains — the turn is never stranded on a
 * departed actor.
 */
export function removeMember(state, actorId) {
  if (!state.members.includes(actorId)) return { state, changed: false };
  const members = state.members.filter(id => id !== actorId);
  const oocInitiative = { ...state.oocInitiative };
  delete oocInitiative[actorId];
  let oocTurn = state.oocTurn;
  if (oocTurn === actorId) {
    // The order as it stood BEFORE the removal; the successor is whoever
    // comes next after the departed holder, wrapping to the front.
    const before = orderedMembers(state);
    const idx = before.indexOf(actorId);
    oocTurn = before.length > 1 ? before[(idx + 1) % before.length] : null;
  }
  return { state: { ...state, members, oocInitiative, oocTurn }, changed: true };
}

/**
 * Clear the roster and the OoC turn pointer with it. No-op if already empty
 * (and no pointer to clear).
 */
export function clearMembers(state) {
  if (state.members.length === 0 && !state.oocTurn) return { state, changed: false };
  return { state: { ...state, members: [], oocTurn: null }, changed: true };
}

/** Advance the crawl turn counter. No-op outside crawl mode. */
export function nextCrawlTurn(state) {
  if (state.mode !== "crawl") return { state, changed: false };
  return { state: { ...state, crawlTurn: state.crawlTurn + 1 }, changed: true };
}

/**
 * Set (or overwrite) one actor's out-of-crawl initiative entry. A roll that
 * establishes a previously-empty order also starts the turn at the top of the
 * order; a roll into an order that already has a holder leaves the turn where
 * it is (a reroll never steals the current turn).
 */
export function setOocInitiative(state, actorId, entry) {
  const oocInitiative = { ...state.oocInitiative, [actorId]: entry };
  const oocTurn = state.oocTurn ?? topOfOrder({ ...state, oocInitiative });
  return { state: { ...state, oocInitiative, oocTurn }, changed: true };
}

/**
 * Pin the pointer to the top of the order when it is unset. Used at the end
 * of a roll-all batch: rolls land one chat message at a time, so the first
 * roll may have started the turn on someone who is NOT the highest roller —
 * once the batch is complete, the true top takes the turn.
 */
export function ensureOocTurn(state) {
  if (state.oocTurn) return { state, changed: false };
  const oocTurn = topOfOrder(state);
  if (!oocTurn) return { state, changed: false };
  return { state: { ...state, oocTurn }, changed: true };
}

/**
 * Advance the out-of-combat turn to the next member in the rolled order,
 * wrapping past the last member back to the first. No-op outside crawl mode
 * or when no order exists; an unset pointer starts at the top of the order.
 */
export function advanceOocTurn(state) {
  if (state.mode !== "crawl") return { state, changed: false };
  const order = orderedMembers(state);
  if (order.length === 0) return { state, changed: false };
  const idx = state.oocTurn ? order.indexOf(state.oocTurn) : -1;
  const oocTurn = order[(idx + 1) % order.length];
  if (oocTurn === state.oocTurn) return { state, changed: false };
  return { state: { ...state, oocTurn }, changed: true };
}

/** Clear all OoC initiative entries and the turn pointer. No-op if already empty. */
export function clearOocInitiative(state) {
  if (Object.keys(state.oocInitiative).length === 0 && !state.oocTurn) return { state, changed: false };
  return { state: { ...state, oocInitiative: {}, oocTurn: null }, changed: true };
}
