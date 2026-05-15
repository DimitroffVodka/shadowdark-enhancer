import { MODULE_ID } from "./module-id.mjs";
import { MovementTracker } from "./movement-tracker.mjs";

/**
 * CrawlState — single source of truth for the strip's mode.
 *
 * Persists `{mode, crawlTurn, oocInitiative}` to a world setting.
 * Mutations broadcast over the module socket so every client re-renders.
 *
 * Forked pattern from vagabond-crawler/scripts/crawl-state.mjs.
 */

const SETTING_KEY = "crawlState";
const HOOK_CHANGED = "sde.stateChanged";
const SOCKET = `module.${MODULE_ID}`;

function defaultState() {
  return { mode: "off", crawlTurn: 0, oocInitiative: {}, members: [] };
}

export const CrawlState = {
  _state: defaultState(),
  _priorMode: "off",   // remembers mode before combat for restoration

  // ── Getters ────────────────────────────────────────────────────────────
  get mode()           { return this._state.mode; },
  get crawlTurn()      { return this._state.crawlTurn; },
  get oocInitiative()  { return this._state.oocInitiative ?? {}; },
  get members()        { return this._state.members ?? []; },   // token IDs added to the crawl
  get isActive()       { return this._state.mode !== "off"; },

  // ── Bootstrap ──────────────────────────────────────────────────────────
  init() {
    this._state = game.settings.get(MODULE_ID, SETTING_KEY) ?? defaultState();

    // Listen for state pushes from other clients.
    game.socket.on(SOCKET, (msg) => {
      if (msg?.type === "state") {
        this._state = msg.payload;
        Hooks.callAll(HOOK_CHANGED, this._state);
      }
    });

    // Mode-transition driver hooks.
    // Both createCombat AND combatStart flip mode to "combat" so the bar can
    // render the intermediate "Begin Encounter" state once a combat exists
    // but hasn't been started yet (Vagabond pattern).
    const enterCombatMode = () => {
      if (!game.user.isGM) return;
      if (this._state.mode === "combat") return;  // already there
      this._priorMode = this._state.mode;
      this._update({ mode: "combat" });
    };
    Hooks.on("createCombat", enterCombatMode);
    Hooks.on("combatStart",   enterCombatMode);

    Hooks.on("deleteCombat", () => {
      if (!game.user.isGM) return;
      if (this._state.mode !== "combat") return;
      this._update({ mode: this._priorMode ?? "off" });
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
    // the top of initiative after Foundry's resort.
    let _resetTimer = null;
    Hooks.on("updateCombatant", (combatant, changes) => {
      if (!game.user.isGM) return;
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

  // ── Public mutators (GM only) ──────────────────────────────────────────
  async startCrawl() {
    if (!game.user.isGM) return;
    if (this._state.mode === "combat") return;
    // Fresh slate — clear any leftover OoC initiative from a prior session.
    await this._update({ mode: "crawl", oocInitiative: {} });
    await MovementTracker.captureCrawlAnchors();
  },

  async endCrawl() {
    if (!game.user.isGM) return;
    if (this._state.mode === "combat") return;
    await this._update({ mode: "off", crawlTurn: 0, members: [], oocInitiative: {} });
    await MovementTracker.clearCrawlAnchors();
  },

  // Add token IDs to the crawl member list (idempotent — no duplicates).
  async addMembers(tokenIds) {
    if (!game.user.isGM) return;
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) return;
    const current = new Set(this._state.members ?? []);
    const newIds = [];
    for (const id of tokenIds) {
      if (id && !current.has(id)) { current.add(id); newIds.push(id); }
    }
    if (newIds.length === 0) return;
    await this._update({ members: [...current] });
    // Capture an anchor for each new member so movement tracks from where
    // they were when added (not from their position at startCrawl, which may
    // have been before they were on the scene).
    if (this._state.mode === "crawl") {
      await MovementTracker.captureCrawlAnchorsFor(newIds);
    }
  },

  // Remove a token ID from the crawl member list.
  async removeMember(tokenId) {
    if (!game.user.isGM) return;
    const next = (this._state.members ?? []).filter(id => id !== tokenId);
    await this._update({ members: next });
  },

  async clearMembers() {
    if (!game.user.isGM) return;
    await this._update({ members: [] });
  },

  async nextCrawlTurn() {
    if (!game.user.isGM) return;
    if (this._state.mode !== "crawl") return;
    await this._update({ crawlTurn: this._state.crawlTurn + 1 });
    await MovementTracker.captureCrawlAnchors();
  },

  async setOocInitiative(tokenId, entry) {
    if (!game.user.isGM) return;
    const next = { ...this._state.oocInitiative, [tokenId]: entry };
    await this._update({ oocInitiative: next });
  },

  async clearOocInitiative() {
    if (!game.user.isGM) return;
    await this._update({ oocInitiative: {} });
  },

  // ── Internal ───────────────────────────────────────────────────────────
  async _update(patch) {
    this._state = { ...this._state, ...patch };
    await game.settings.set(MODULE_ID, SETTING_KEY, this._state);
    game.socket.emit(SOCKET, { type: "state", payload: this._state });
    Hooks.callAll(HOOK_CHANGED, this._state);
  },

  HOOK_CHANGED,
};
