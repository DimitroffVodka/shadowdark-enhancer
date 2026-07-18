/**
 * Shadowdark Enhancer — CrawlState core (pure, Foundry-free, node-testable).
 *
 * Holds the state shape, normalization, and reducer logic for the strip's
 * mode singleton. crawl-state.mjs wraps these with the Foundry-coupled I/O
 * (world-setting persistence, socket broadcast, GM gating, Hooks). Kept
 * separate so the domain rules can be unit-tested without mocking Foundry —
 * the same split as party-xp-core.mjs / loot-value.mjs.
 */

export const STATE_VERSION = 1;

const VALID_MODES = new Set(["off", "crawl", "combat"]);
// priorMode only ever needs to hold what to restore ON EXIT FROM COMBAT, so
// "combat" itself is never a valid value here.
const VALID_PRIOR_MODES = new Set(["off", "crawl"]);

/** Versioned default state. `members` has been part of the shape since v1. */
export function defaultCrawlState() {
  return { _v: STATE_VERSION, mode: "off", crawlTurn: 0, oocInitiative: {}, members: [], priorMode: "off" };
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

  return { _v: STATE_VERSION, mode, crawlTurn, oocInitiative, members, priorMode };
}

// ── Pure reducers ────────────────────────────────────────────────────────
//
// Each reducer takes a normalized state (plus any extra args) and returns
// `{ state, changed }` — `changed: false` means the input is returned as-is
// and the caller should skip persistence/broadcast (idempotency / no-op
// guards live here, not just in the Foundry-facing wrapper).

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

/** Start a crawl: clears leftover OoC initiative. No-op during combat. */
export function startCrawl(state) {
  if (state.mode === "combat") return { state, changed: false };
  return { state: { ...state, mode: "crawl", oocInitiative: {} }, changed: true };
}

/** End a crawl: resets turn/members/OoC initiative. No-op during combat. */
export function endCrawl(state) {
  if (state.mode === "combat") return { state, changed: false };
  return { state: { ...state, mode: "off", crawlTurn: 0, members: [], oocInitiative: {} }, changed: true };
}

/** Add token IDs to the crawl roster, deduplicated. No-op if none are new. */
export function addMembers(state, tokenIds) {
  const ids = Array.isArray(tokenIds) ? tokenIds : [];
  const current = new Set(state.members);
  const newIds = [];
  for (const id of ids) {
    if (id && !current.has(id)) { current.add(id); newIds.push(id); }
  }
  if (newIds.length === 0) return { state, newIds, changed: false };
  return { state: { ...state, members: [...current] }, newIds, changed: true };
}

/** Remove one token ID from the roster. No-op if it wasn't a member. */
export function removeMember(state, tokenId) {
  if (!state.members.includes(tokenId)) return { state, changed: false };
  return { state: { ...state, members: state.members.filter(id => id !== tokenId) }, changed: true };
}

/** Clear the roster. No-op if already empty. */
export function clearMembers(state) {
  if (state.members.length === 0) return { state, changed: false };
  return { state: { ...state, members: [] }, changed: true };
}

/** Advance the crawl turn counter. No-op outside crawl mode. */
export function nextCrawlTurn(state) {
  if (state.mode !== "crawl") return { state, changed: false };
  return { state: { ...state, crawlTurn: state.crawlTurn + 1 }, changed: true };
}

/** Set (or overwrite) one token's out-of-crawl initiative entry. */
export function setOocInitiative(state, tokenId, entry) {
  return { state: { ...state, oocInitiative: { ...state.oocInitiative, [tokenId]: entry } }, changed: true };
}

/** Clear all OoC initiative entries. No-op if already empty. */
export function clearOocInitiative(state) {
  if (Object.keys(state.oocInitiative).length === 0) return { state, changed: false };
  return { state: { ...state, oocInitiative: {} }, changed: true };
}
