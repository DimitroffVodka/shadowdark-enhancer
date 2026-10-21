/**
 * Shadowdark Enhancer — what the sit-down games' windows (a hand of Bluff or Brag, the death roll, the roulette) have in
 * common: one window of its kind at a time, a chosen character, the town's table settings, the redraw when coins change,
 * a guard against a second click while one is working, and leaving the table when the window closes.
 *
 * A subclass names its template and actions, builds its own context from `this.table`, supplies `_makeIo()` (the Foundry
 * side of its game) and `_leave(player, io)` (what leaving in the middle of a game does: walk away from a hand, say).
 */
import { landingOf } from "./town-core.mjs";
import { buyerFor, houseLeftAt, redrawOnChange } from "./town-live.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TownTableApp extends HandlebarsApplicationMixin(ApplicationV2) {
  scene = null;
  playerId = null;
  /** The game in progress, as its runner makes it: `{ game, wager, ..., settled }`. */
  table = null;
  _stop = null;
  _io = null;
  _busy = false;

  /** A game is under way at this window (dealt and not settled), so another must not replace it. */
  static inProgress() {
    const app = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
    return !!app?.table && !app.table.settled;
  }

  /** Open (or bring forward) the window on a game just dealt for `player` in the town of `scene`. */
  static open({ scene, player, table }) {
    const app = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id) ?? new this();
    Object.assign(app, { scene, playerId: player.id, table });
    app.reset?.();
    app.render({ force: true });
    return app;
  }

  get page() { return landingOf(this.scene); }
  get player() { return buyerFor(this.playerId); }
  get townName() { return this.page?.title || this.scene?.name || ""; }
  /** The table as a play needs it. */
  get town() { const g = this.page?.games; return { name: this.townName, sceneId: this.scene?.id ?? "", on: !!g?.on, maxBet: g?.maxBet ?? 0, edge: g?.edge ?? 0, left: houseLeftAt(this.scene) }; }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._stop = redrawOnChange(this);
  }

  _onClose(options) {
    this._stop?.();
    this._stop = null;
    // Leaving a game is giving it up. Nothing waits on this: the card it posts says what happened.
    const player = this.player;
    if (this.table && !this.table.settled && player) this._leave(player).catch((e) => console.error(e));
    super._onClose?.(options);
  }

  /** Run one click's work with the game's io and the chosen character, one at a time, and redraw when it is done. */
  async _run(work) {
    const player = this.player;
    if (this._busy || !player) return;
    this._busy = true;
    try {
      this._io ??= await this._makeIo();
      await work(this._io, player);
    } finally { this._busy = false; }
    return this.render();
  }

  async _onBack() { return this.close(); }
}
