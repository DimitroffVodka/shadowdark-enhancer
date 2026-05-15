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
  return { mode: "off", crawlTurn: 0, oocInitiative: {} };
}

export const CrawlState = {
  _state: defaultState(),
  _priorMode: "off",   // remembers mode before combat for restoration

  // ── Getters ────────────────────────────────────────────────────────────
  get mode()           { return this._state.mode; },
  get crawlTurn()      { return this._state.crawlTurn; },
  get oocInitiative()  { return this._state.oocInitiative ?? {}; },
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
    Hooks.on("combatStart", () => {
      if (!game.user.isGM) return;
      // If combatStart double-fires (or another combat begins mid-restoration),
      // keep the original pre-combat mode rather than overwriting with "off".
      this._priorMode = this._state.mode === "combat" ? this._priorMode : this._state.mode;
      this._update({ mode: "combat" });
    });

    Hooks.on("deleteCombat", () => {
      if (!game.user.isGM) return;
      if (this._state.mode !== "combat") return;
      this._update({ mode: this._priorMode ?? "off" });
    });
  },

  // ── Public mutators (GM only) ──────────────────────────────────────────
  async startCrawl() {
    if (!game.user.isGM) return;
    if (this._state.mode === "combat") return;
    await this._update({ mode: "crawl" });
    await MovementTracker.captureCrawlAnchors();
  },

  async endCrawl() {
    if (!game.user.isGM) return;
    if (this._state.mode === "combat") return;
    await this._update({ mode: "off", crawlTurn: 0 });
    await MovementTracker.clearCrawlAnchors();
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
