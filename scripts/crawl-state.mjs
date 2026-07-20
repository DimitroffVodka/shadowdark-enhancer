import { MODULE_ID } from "./module-id.mjs";
import { MovementTracker } from "./movement-tracker.mjs";
import {
  STATE_VERSION,
  defaultCrawlState,
  normalizeCrawlState,
  enterCombatMode as _enterCombatMode,
  exitCombatMode  as _exitCombatMode,
  startCrawl      as _startCrawl,
  endCrawl        as _endCrawl,
  addMembers      as _addMembers,
  removeMember    as _removeMember,
  clearMembers    as _clearMembers,
  nextCrawlTurn   as _nextCrawlTurn,
  setOocInitiative   as _setOocInitiative,
  clearOocInitiative as _clearOocInitiative,
} from "./crawl-state-core.mjs";

/**
 * CrawlState — single source of truth for the strip's mode.
 *
 * Persists `{_v, mode, crawlTurn, oocInitiative, members, priorMode}` to a
 * world setting — the world setting IS the authoritative state; the module
 * socket only ever carries an empty "something changed, re-read" nudge
 * (never a payload) so other clients re-render. State shape/normalization/
 * reducer logic lives in the pure crawl-state-core.mjs; this module is the
 * Foundry-coupled I/O wrapper (persistence, socket, GM gating, Hooks).
 *
 * Forked pattern from vagabond-crawler/scripts/crawl-state.mjs.
 */

const SETTING_KEY = "crawlState";
const HOOK_CHANGED = "sde.stateChanged";
const SOCKET = `module.${MODULE_ID}`;

/**
 * Active-GM check: gates AUTOMATIC reactions that fire on every connected
 * GM client for the same trigger (a Foundry Hook like createCombat, or a
 * chat-message-created listener) so only ONE canonical writer among
 * several connected GMs reacts. Matches the activeGM guard pattern used
 * elsewhere in the module (merchant-shop.mjs, session-recap.mjs,
 * item-drops.mjs). NOT used to gate direct, user-initiated mutators below —
 * those are a single physical click by whichever GM made it, so any GM is
 * allowed (see the "Public mutators" section for why).
 */
export function isActiveGM() {
  return !!game.user?.isGM && game.users?.activeGM?.id === game.user?.id;
}

export const CrawlState = {
  _state: defaultCrawlState(),

  // ── Getters ────────────────────────────────────────────────────────────
  get mode()           { return this._state.mode; },
  get crawlTurn()      { return this._state.crawlTurn; },
  get oocInitiative()  { return this._state.oocInitiative ?? {}; },
  get members()        { return this._state.members ?? []; },   // actor IDs added to the crawl (world-scoped)
  get isActive()       { return this._state.mode !== "off"; },

  // ── Bootstrap ──────────────────────────────────────────────────────────
  init() {
    const raw = game.settings.get(MODULE_ID, SETTING_KEY);
    const rawVersion = Number(raw?._v);
    const isFutureVersion = Number.isFinite(rawVersion) && rawVersion > STATE_VERSION;

    this._state = normalizeCrawlState(raw);

    if (isFutureVersion) {
      // A newer client wrote a state shape this version doesn't understand.
      // Never downgrade/overwrite what's persisted — normalize best-effort
      // in memory only (for local rendering) and warn.
      console.warn(`${MODULE_ID} | crawl state setting has a newer version `
        + `(_v=${rawVersion} > ${STATE_VERSION}) than this client understands; `
        + `using it in-memory only, not persisting a downgrade.`);
    } else {
      // v0 (missing/legacy _v) or a current-version-but-malformed setting:
      // persist the normalized/upgraded form ONLY when it's materially
      // different from what's stored — this both performs the legacy
      // upgrade and repairs corrupted content, without rewriting on every
      // load. Normalizing an already-normalized state is idempotent, so a
      // later init() finds no difference and skips the write — no loop.
      const materiallyDifferent = JSON.stringify(raw) !== JSON.stringify(this._state);
      if (isActiveGM() && materiallyDifferent) {
        game.settings.set(MODULE_ID, SETTING_KEY, this._state)
          .catch(err => console.warn(`${MODULE_ID} | crawl state version upgrade failed`, err));
      }
    }

    // Listen for state-changed notifications from other clients. The socket
    // message itself carries NO trusted data — no payload, no claimed sender
    // ID. It is purely a "something changed, go re-read" nudge; the world
    // setting (read fresh, then normalized) is the only source of truth. A
    // forged/malicious notification can therefore do nothing worse than
    // trigger a harmless, idempotent reread of whatever's actually
    // persisted — it cannot inject arbitrary state.
    game.socket.on(SOCKET, (msg) => {
      if (msg?.type !== "state") return;
      this._state = normalizeCrawlState(game.settings.get(MODULE_ID, SETTING_KEY));
      Hooks.callAll(HOOK_CHANGED, this._state);
    });

    // Mode-transition driver hooks.
    // Both createCombat AND combatStart flip mode to "combat" so the bar can
    // render the intermediate "Begin Encounter" state once a combat exists
    // but hasn't been started yet (Vagabond pattern).
    //
    // Gated on isActiveGM (not just isGM): these Hooks fire on EVERY
    // connected GM client for the same Combat event, so without an
    // active-GM gate, two online GMs would both react and race to write the
    // world setting. priorMode is persisted IN the state itself (not
    // client-local memory) so a reload or active-GM handoff mid-combat still
    // restores the correct mode on exit.
    const doEnterCombatMode = () => {
      if (!isActiveGM()) return;
      const { state, changed } = _enterCombatMode(this._state);
      if (!changed) return;
      void this._commit(state).catch((error) => {
        console.error(`${MODULE_ID} | failed to enter combat crawl mode`, error);
      });
    };
    Hooks.on("createCombat", doEnterCombatMode);
    Hooks.on("combatStart",   doEnterCombatMode);

    Hooks.on("deleteCombat", () => {
      if (!isActiveGM()) return;
      const { state, changed } = _exitCombatMode(this._state);
      if (!changed) return;
      void this._commit(state).catch((error) => {
        console.error(`${MODULE_ID} | failed to restore crawl mode after combat`, error);
      });
    });

    // If the user started combat BEFORE rolling initiative (common mis-step),
    // the active-turn pointer sticks on whoever was first by default order.
    // Once initiative gets rolled, Foundry re-sorts combat.turns but preserves
    // the previously-active combatant's index — so the highlight stays on the
    // wrong token even though the cards visually reorder.
    //
    // Fix: debounce after init-change bursts (rollAll fires many per-combatant
    // updates in quick succession). After the dust settles, if we're in round
    // 1 and every combatant has an initiative, jump turn to 0 — which is now
    // the top of initiative after Foundry's resort. Gated on isActiveGM —
    // this hook also fires on every connected GM client per combatant update.
    let _resetTimer = null;
    Hooks.on("updateCombatant", (combatant, changes) => {
      if (!isActiveGM()) return;
      if (!("initiative" in changes)) return;
      const combat = combatant.parent;
      if (!combat || combat.round !== 1) return;
      if (_resetTimer) clearTimeout(_resetTimer);
      _resetTimer = setTimeout(async () => {
        _resetTimer = null;
        const c = combatant.parent;
        if (!c || c.round !== 1) return;
        if (c.turn === 0) return;
        if (!c.turns.every(t => t.initiative != null)) return;
        await c.update({ turn: 0 });
      }, 150);
    });
  },

  // ── Public mutators (any GM) ─────────────────────────────────────────────
  // Gated on game.user.isGM, NOT isActiveGM: these are direct, user-initiated
  // actions (a button click) — at most one GM physically triggered any given
  // call, so there's no "every connected GM reacts to the same event" race
  // to prevent (unlike the automatic Hooks above). A secondary GM's UI
  // controls still work. Each mutator still runs a pure reducer from
  // crawl-state-core.mjs first, so a no-op transition (e.g. startCrawl while
  // already crawling) is skipped via the reducer's `changed: false` rather
  // than racing a redundant write.
  async startCrawl() {
    if (!game.user.isGM) return;
    const { state, changed } = _startCrawl(this._state);
    if (!changed) return;
    if (!await this._commit(state)) return;
    await MovementTracker.captureCrawlAnchors();
    // Session-boundary hook (Session Recap listens to prompt session tracking).
    Hooks.callAll(`${MODULE_ID}.crawlStart`, this._state);
  },

  async endCrawl() {
    if (!game.user.isGM) return;
    const { state, changed } = _endCrawl(this._state);
    if (!changed) return;
    if (this._hasFutureWorldState()) return;
    // Fire the end-boundary BEFORE the state reset so listeners can still read
    // the final crawlTurn if they need it.
    Hooks.callAll(`${MODULE_ID}.crawlEnd`, this._state);
    if (!await this._commit(state)) return;
    await MovementTracker.clearCrawlAnchors();
  },

  // Add actor IDs to the crawl member list (idempotent — no duplicates).
  // Membership is world-scoped: a member is identified by its actor, and its
  // token is resolved per-scene, so the roster survives a scene switch.
  async addMembers(actorIds) {
    if (!game.user.isGM) return;
    const wasCrawling = this._state.mode === "crawl";
    const { state, newIds, changed } = _addMembers(this._state, actorIds);
    if (!changed) return;
    if (!await this._commit(state)) return;
    // Capture an anchor for each new member so movement tracks from where
    // they were when added (not from their position at startCrawl, which may
    // have been before they were on the scene). newIds are actor IDs; the
    // tracker resolves them to their token on the current scene.
    if (wasCrawling) {
      await MovementTracker.captureCrawlAnchorsFor(newIds);
    }
  },

  // Remove an actor ID from the crawl member list.
  async removeMember(actorId) {
    if (!game.user.isGM) return;
    const { state, changed } = _removeMember(this._state, actorId);
    if (!changed) return;
    await this._commit(state);
  },

  async clearMembers() {
    if (!game.user.isGM) return;
    const { state, changed } = _clearMembers(this._state);
    if (!changed) return;
    await this._commit(state);
  },

  async nextCrawlTurn() {
    if (!game.user.isGM) return;
    const { state, changed } = _nextCrawlTurn(this._state);
    if (!changed) return;
    if (!await this._commit(state)) return;
    await MovementTracker.captureCrawlAnchors();
  },

  async setOocInitiative(actorId, entry) {
    if (!game.user.isGM) return;
    const { state } = _setOocInitiative(this._state, actorId, entry);
    await this._commit(state);
  },

  async clearOocInitiative() {
    if (!game.user.isGM) return;
    const { state, changed } = _clearOocInitiative(this._state);
    if (!changed) return;
    await this._commit(state);
  },

  // ── Internal ───────────────────────────────────────────────────────────
  _hasFutureWorldState() {
    const authoritative = game.settings.get(MODULE_ID, SETTING_KEY);
    if (!(Number(authoritative?._v) > STATE_VERSION)) return false;
    console.warn(
      `${MODULE_ID} | refusing crawl state write: world setting _v=${authoritative._v} is newer than supported _v=${STATE_VERSION}`,
    );
    this._state = normalizeCrawlState(authoritative);
    return true;
  },

  /**
   * Persist a reducer's output state (the world setting is authoritative),
   * then notify other clients to re-read it — the socket message carries no
   * state of its own, see the game.socket.on(SOCKET, ...) listener above.
   */
  async _commit(nextState) {
    if (this._hasFutureWorldState()) return false;
    this._state = normalizeCrawlState(nextState);
    await game.settings.set(MODULE_ID, SETTING_KEY, this._state);
    game.socket.emit(SOCKET, { type: "state" });
    Hooks.callAll(HOOK_CHANGED, this._state);
    return true;
  },

  HOOK_CHANGED,
};
