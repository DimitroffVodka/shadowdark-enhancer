/**
 * Shadowdark Enhancer — a town's games table (ApplicationV2), opened from the landing page when the GM has turned it on.
 *
 * The player picks a character, sets a wager (in silver, up to the town's limit) and plays one of the games; each is
 * rolled and settled on this client by town-games.mjs, with no GM connected. Bluff, Brag, the death roll and the roulette
 * open a table of their own. The last result stays on the window. The wager is never taken until a game is played, and a
 * game that cannot be saved is not played.
 *
 * Liar's Dice is a table of two to six: Play opens a set-up screen (how many of the house's players, how many seats for
 * other people), then a lobby if other people may sit down, then the match. The window only draws and asks; the table,
 * the other people and the money are the client's (liars-dice-net.mjs). The open tables of other people are listed above
 * the games. Closing the window leaves the table: a match is forfeited, a lobby is left, a table you host is called off
 * (everyone's wager goes back).
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { GAME_ICONS, GAME_KEYS, LIARS, SIDES, SIDE_KEYS, SIT_GAMES, TABLE_GAMES, wagerFromSp } from "./games-core.mjs";
import { MAX_SEATS } from "./liars-dice-core.mjs";
import { liveClient } from "./liars-dice-live.mjs";
import { lobbyView, pickFor, setupView, tableView, tablesView } from "./liars-dice-view.mjs";
import { landingOf } from "./town-core.mjs";
import { buyerChoices, buyerFor, redrawOnChange } from "./town-live.mjs";
import { playGame, liveIo } from "./town-games.mjs";
import { TownBlackjackApp } from "./town-blackjack-app.mjs";
import { startBlackjack } from "./town-blackjack.mjs";
import { TownDeathApp } from "./town-death-app.mjs";
import { startDeath } from "./town-death.mjs";
import { TownHandApp } from "./town-hand-app.mjs";
import { startHand } from "./town-hand.mjs";
import { TownRouletteApp } from "./town-roulette-app.mjs";
import { purseText } from "./town-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The quick wagers, in silver. */
const CHIPS = [{ sp: 1, label: "1 sp" }, { sp: 10, label: "1 gp" }, { sp: 50, label: "5 gp" }, { sp: 100, label: "10 gp" }, { sp: 500, label: "50 gp" }];

/** The games that deal a hand or a round at a window of their own: that window, and what puts the wager on the table. */
const DEALT = {
  bluff: [TownHandApp, startHand], brag: [TownHandApp, startHand], death: [TownDeathApp, startDeath], blackjack: [TownBlackjackApp, startBlackjack],
};

/** A finished match's result as the note under the table (and, once the table is left, on the list of games). */
const resultNote = (r) => (r?.ok ? { lines: r.lines, tone: r.result === "win" ? "good" : r.result === "lose" ? "bad" : "info", game: t(GAME_KEYS[LIARS].name) } : null);

/** What a table's reasons for saying no are called to the player (the others are strings already). */
const WHY = {
  busy: "SDE.town.games.liars.busy", seats: "SDE.town.games.liars.badSeats", gone: "SDE.town.games.liars.gone",
  full: "SDE.town.games.liars.deniedFull", closed: "SDE.town.games.liars.deniedClosed", already: "SDE.town.games.liars.deniedAlready",
};

export class TownGamesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-town-games",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town-games"],
    position: { width: 640, height: 720 },
    window: { icon: "fa-solid fa-dice", title: "SDE.town.games.title", resizable: true },
    actions: {
      setWager: TownGamesApp.prototype._onSetWager, play: TownGamesApp.prototype._onPlay, back: TownGamesApp.prototype._onBack,
      setupStep: TownGamesApp.prototype._onSetupStep, sit: TownGamesApp.prototype._onSit, cancelSetup: TownGamesApp.prototype._onCancelSetup,
      joinTable: TownGamesApp.prototype._onJoinTable, startTable: TownGamesApp.prototype._onStartTable, leaveTable: TownGamesApp.prototype._onLeaveTable,
      step: TownGamesApp.prototype._onStep, face: TownGamesApp.prototype._onFace, bid: TownGamesApp.prototype._onBid,
      call: TownGamesApp.prototype._onCall, done: TownGamesApp.prototype._onDone, rules: TownGamesApp.prototype._onRules,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-games.hbs`, scrollable: [".ui-body"] },
  };

  scene = null;
  buyerId = null;
  wagerSp = 10;
  last = null;
  /** This tab's Liar's Dice client (the table, the other people, the money), made when first needed; a test may set it. */
  client = null;
  /** The set-up screen's choices while it is up: `{ ai, humans }`, else null. */
  setup = null;
  /** The bid the player has dialed in at the table. */
  pick = null;
  /** Whether the how-to-play screen is up (over whichever Liar's Dice screen the player was on). */
  rules = false;
  /** The round whose dice have already tumbled on screen (table and round), so a redraw does not roll them again. */
  _rolled = null;
  _stop = null;
  _io = null;
  _busy = false;

  /** Open (or bring forward) the games table of a scene's town. */
  static open(scene) {
    const app = foundry.applications.instances.get(TownGamesApp.DEFAULT_OPTIONS.id) ?? new TownGamesApp();
    if (app.scene?.id !== scene?.id) app.last = null;
    if (app.scene && app.scene.id !== scene?.id) app.leaveTable();
    app.scene = scene;
    app.render({ force: true });
    return app;
  }

  get liars() { return (this.client ??= liveClient()); }
  get page() { return landingOf(this.scene); }
  get townName() { return this.page?.title || this.scene?.name || ""; }
  /** The table as the player's play needs it. */
  get town() { const g = this.page?.games; return { name: this.townName, sceneId: this.scene?.id ?? "", on: !!g?.on, maxBet: g?.maxBet ?? 0, edge: g?.edge ?? 0 }; }

  /** Which screen Liar's Dice is on: the rules, set-up, joining (waiting to be seated), lobby, table, called off, or none (the list of games). */
  get screen() {
    if (this.rules) return "rules";
    const view = this.client?.view, part = this.client?.part;
    if (view?.phase === "lobby") return "lobby";
    if (view?.phase === "playing" || view?.phase === "over") return "table";
    if (view?.phase === "cancelled") return "cancelled";
    if (part && !view) return "joining";
    return this.setup ? "setup" : null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const town = this.town, player = buyerFor(this.buyerId);
    this.buyerId = player?.id ?? null;
    const maxSp = town.maxBet * 10;
    this.wagerSp = Math.min(Math.max(1, Math.floor(this.wagerSp) || 1), maxSp || 1);
    const screen = this.screen, view = this.client?.view, result = this.client?.part?.result;
    return Object.assign(context, {
      townName: town.name, open: town.on, purse: player ? purseText(player.system.coins) : "",
      maxBet: formatPrice(fromCopper(town.maxBet * 100)), edge: town.edge, maxSp, wagerSp: this.wagerSp,
      wagerText: formatPrice(fromCopper(wagerFromSp(this.wagerSp))),
      chips: [...CHIPS.filter((c) => c.sp < maxSp), { sp: maxSp, label: t("SDE.town.games.max") }],
      games: TABLE_GAMES.map((id) => ({
        id, icon: GAME_ICONS[id], name: t(GAME_KEYS[id].name), rules: t(GAME_KEYS[id].rules), odds: t(GAME_KEYS[id].odds), rulesBtn: id === LIARS,
        picks: id === "coin" ? SIDES.map((s) => ({ id: s, label: t(SIDE_KEYS[s]) })) : null,
      })),
      screen, isScreen: { [screen ?? "list"]: true },
      setup: screen === "setup" ? setupView(this.setup, wagerFromSp(this.wagerSp), t) : null,
      lobby: screen === "lobby" ? lobbyView(view, t) : null,
      match: screen === "table" ? tableView(view, this.pick, t) : null,
      tables: screen ? [] : tablesView(this.client?.tables.values() ?? [], t),
      last: screen === "table" ? resultNote(result) : this.last,
      actors: buyerChoices().map((a) => ({ id: a.id, name: a.name, selected: a.id === player?.id })), hasPlayer: !!player,
      atTable: !!this.client?.part,
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element, input = root.querySelector("input[name=wager]");
    root.querySelector("select[name=player]")?.addEventListener("change", (event) => { this.buyerId = event.target.value; this.last = null; this.render(); });
    input?.addEventListener("input", () => {
      this.wagerSp = Number(input.value) || 1;
      const text = root.querySelector(".tg-wager-text");
      if (text) text.textContent = formatPrice(fromCopper(wagerFromSp(this.wagerSp)));
    });
    // A new round rolls new dice, and it can happen while the player looks elsewhere: make the roll something to see.
    const view = this.client?.view, key = view && `${view.id}:${view.round}`;
    if (view?.phase === "playing" && this._rolled !== key) {
      this._rolled = key;
      this._tumble();
    }
  }

  /**
   * The new round's dice tumble: the player's faces flicker and settle on the real ones one after another, the cups shake
   * and the round label flashes (the keyframes are in the stylesheet, `ld-rolling`). Only the picture moves: the dice were
   * rolled before the window drew them. Skipped for a player who asks the system for less motion.
   */
  _tumble() {
    const table = this.element?.querySelector(".ld-table");
    if (!table || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    table.classList.add("ld-rolling");
    this.element.querySelectorAll(".ld-you .ld-die.pips").forEach((die, i) => {
      const real = die.dataset.face, stop = Date.now() + 420 + i * 120;
      const flicker = setInterval(() => {
        if (!die.isConnected) return clearInterval(flicker);
        const done = Date.now() >= stop;
        die.dataset.face = done ? real : String(1 + Math.floor(Math.random() * 6));
        if (done) clearInterval(flicker);
      }, 70);
    });
    setTimeout(() => table.classList.remove("ld-rolling"), 1100);
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._stop = redrawOnChange(this);
    // The table and the other people reach this window through the client: draw again when it changes, say why a seat was
    // refused, and ask who has a table open.
    this.liars.onChange = () => { if (this.rendered !== false) this.render(); };
    this.liars.onError = (reason) => ui.notifications.warn(t(WHY[reason] ?? reason));
    this.liars.requestTables();
  }

  _onClose(options) {
    this._stop?.();
    this._stop = null;
    this.leaveTable();
    if (this.client) this.client.onChange = this.client.onError = null;
    super._onClose?.(options);
  }

  /** Walk away from the table (a match is forfeited, a lobby left, a table this person hosts called off). */
  leaveTable() {
    const c = this.client;
    if (!c?.part) return null;
    this.setup = null;
    this.pick = null;
    this._rolled = null;
    return c.leave().catch((err) => console.error(`${MODULE_ID} | liar's dice: leave`, err));
  }

  /** Open or close the how-to-play screen. */
  _onRules() {
    this.rules = !this.rules;
    return this.render();
  }

  _onSetWager(_event, target) { this.wagerSp = Number(target.dataset.sp) || 1; return this.render(); }

  async _onPlay(_event, target) {
    const player = buyerFor(this.buyerId);
    if (this._busy) return;
    if (!player) return ui.notifications.warn(t("SDE.merchant.notify.noCharacterHint"));
    this._busy = true;
    try {
      const input = this.element.querySelector("input[name=wager]");
      // What is typed is the wager, even 0 (the game refuses it); only a box with nothing usable keeps the last one.
      const typed = input?.value === "" ? NaN : Number(input?.value);
      if (Number.isFinite(typed)) this.wagerSp = typed;
      if (target.dataset.game === LIARS) {
        this.setup = { ai: 1, humans: 0 };
        this.last = null;
        return this.render();
      }
      this._io ??= await liveIo();
      if (SIT_GAMES.includes(target.dataset.game)) {
        await this._sit(player, target.dataset.game);
        return this.render();
      }
      const result = await playGame({ player, game: target.dataset.game, wager: wagerFromSp(this.wagerSp), pick: target.dataset.pick ?? "", town: this.town }, this._io);
      if (!result.ok) ui.notifications.warn(result.error);
      this.last = result.ok ? { lines: result.lines, tone: result.result === "win" ? "good" : result.result === "lose" ? "bad" : "info", game: t(GAME_KEYS[result.game].name) } : null;
    } finally { this._busy = false; }
    return this.render();
  }

  // ─── setting up and sitting down ───────────────────────────────────────────

  /** One more or fewer of the house's players (`what` "ai") or of seats for other people ("humans"), within two to six seats. */
  _onSetupStep(_event, target) {
    const { what, by } = target.dataset, next = { ...this.setup, [what]: this.setup[what] + Number(by) };
    const seats = 1 + next.ai + next.humans;
    if (next.ai < 0 || next.humans < 0 || next.ai > 5 || next.humans > 5 || seats < 2 || seats > MAX_SEATS) return null;
    this.setup = next;
    return this.render();
  }

  _onCancelSetup() {
    this.setup = null;
    return this.render();
  }

  /** Sit down: the wager goes in, and the match starts (no seat for anyone else) or the lobby opens. */
  async _onSit() {
    const player = buyerFor(this.buyerId);
    if (this._busy || !this.setup) return;
    if (!player) return ui.notifications.warn(t("SDE.merchant.notify.noCharacterHint"));
    this._busy = true;
    try {
      const r = await this.liars.open({ player, ante: wagerFromSp(this.wagerSp), aiCount: this.setup.ai, humanSlots: this.setup.humans, town: this.town });
      if (r.ok) { this.setup = null; this.pick = null; this.last = null; this._rolled = null; }
      else ui.notifications.warn(t(WHY[r.error] ?? r.error));
    } finally { this._busy = false; }
    return this.render();
  }

  /** Sit down at someone else's open table. */
  async _onJoinTable(_event, target) {
    const player = buyerFor(this.buyerId);
    if (this._busy) return;
    if (!player) return ui.notifications.warn(t("SDE.merchant.notify.noCharacterHint"));
    this._busy = true;
    try {
      const r = await this.liars.join(target.dataset.table, player);
      if (!r.ok) ui.notifications.warn(t(WHY[r.error] ?? r.error));
      else { this.pick = null; this.last = null; this._rolled = null; }
    } finally { this._busy = false; }
    return this.render();
  }

  _onStartTable() {
    this.liars.startTable();
    return this.render();
  }

  async _onLeaveTable() {
    await this.leaveTable();
    return this.render();
  }

  // ─── at the table ──────────────────────────────────────────────────────────

  /** Dial the bid's count up or down; it only has to beat the table when it is placed. */
  _onStep(_event, target) {
    const view = this.client?.view;
    if (view?.phase !== "playing") return null;
    const total = view.seats.reduce((n, x) => n + x.dice, 0), pick = pickFor(view, this.pick) ?? { qty: 1, face: 2 };
    this.pick = { ...pick, qty: Math.min(total, Math.max(1, pick.qty + Number(target.dataset.by))) };
    return this.render();
  }

  _onFace(_event, target) {
    const view = this.client?.view;
    if (view?.phase !== "playing") return null;
    this.pick = { ...(pickFor(view, this.pick) ?? { qty: 1 }), face: Number(target.dataset.face) };
    return this.render();
  }

  _onBid() {
    const pick = pickFor(this.client?.view ?? { bid: null, seats: [] }, this.pick);
    return pick && this._move({ qty: pick.qty, face: pick.face });
  }

  _onCall() { return this._move({ call: true }); }

  _move(move) {
    if (!this.liars.move(move)) return null;
    this.pick = null;
    return this.render();
  }

  /** Back to the list of games once a match is over (its result stays on the window), or once a table was called off. */
  async _onDone() {
    this.last = resultNote(this.client?.part?.result) ?? this.last;
    await this.leaveTable();
    return this.render();
  }

  /**
   * Sit down at a game with a table of its own. A hand, a round of the death roll or a deal of blackjack takes its wager now and opens on the
   * dealt game; the roulette takes nothing until it spins, and opens on an empty board with the wager as the chip.
   */
  async _sit(player, game) {
    const wager = wagerFromSp(this.wagerSp), town = this.town;
    if (game === "roulette") {
      this.last = null;
      return TownRouletteApp.open({ scene: this.scene, player, table: { game, bets: {}, chip: Math.max(wager, 10), last: null, settled: true } });
    }
    const [app, deal] = DEALT[game];
    if (app.inProgress()) return ui.notifications.warn(t("SDE.town.hand.inProgress"));
    // The house plays from the dice's own random source, like the games' dice.
    const io = { random: () => CONFIG.Dice.randomUniform(), ...this._io };
    const r = await deal({ player, game, wager, town }, io);
    if (!r.ok) return ui.notifications.warn(r.error);
    this.last = null;
    app.open({ scene: this.scene, player, table: r.table });
  }

  async _onBack() {
    const { TownApp } = await import("./town-app.mjs");
    TownApp.open(this.scene);
    return this.close();
  }
}
