/**
 * Shadowdark Enhancer — a town's games table (ApplicationV2), opened from the landing page when the GM has turned it on.
 *
 * The player picks a character, sets a wager (in silver, up to the town's limit) and plays one of eight games; the
 * game is rolled and settled on this client by town-games.mjs, with no GM connected (Bluff, Brag, the death roll and the roulette open a table of their own). The last result stays on the
 * window. The wager is never taken until a game is played, and a game that cannot be saved is not played.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { GAME_ICONS, GAME_IDS, GAME_KEYS, HAND_GAMES, SIDES, SIDE_KEYS, SIT_GAMES, wagerFromSp } from "./games-core.mjs";
import { landingOf } from "./town-core.mjs";
import { buyerChoices, buyerFor, redrawOnChange } from "./town-live.mjs";
import { playGame, liveIo } from "./town-games.mjs";
import { TownDeathApp } from "./town-death-app.mjs";
import { startDeath } from "./town-death.mjs";
import { TownHandApp } from "./town-hand-app.mjs";
import { startHand } from "./town-hand.mjs";
import { TownRouletteApp } from "./town-roulette-app.mjs";
import { purseText } from "./town-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The quick wagers, in silver. */
const CHIPS = [{ sp: 1, label: "1 sp" }, { sp: 10, label: "1 gp" }, { sp: 50, label: "5 gp" }, { sp: 100, label: "10 gp" }, { sp: 500, label: "50 gp" }];

export class TownGamesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-town-games",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town-games"],
    position: { width: 640, height: 720 },
    window: { icon: "fa-solid fa-dice", title: "SDE.town.games.title", resizable: true },
    actions: { setWager: TownGamesApp.prototype._onSetWager, play: TownGamesApp.prototype._onPlay, back: TownGamesApp.prototype._onBack },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-games.hbs`, scrollable: [".ui-body"] },
  };

  scene = null;
  buyerId = null;
  wagerSp = 10;
  last = null;
  _stop = null;
  _io = null;
  _busy = false;

  /** Open (or bring forward) the games table of a scene's town. */
  static open(scene) {
    const app = foundry.applications.instances.get(TownGamesApp.DEFAULT_OPTIONS.id) ?? new TownGamesApp();
    if (app.scene?.id !== scene?.id) app.last = null;
    app.scene = scene;
    app.render({ force: true });
    return app;
  }

  get page() { return landingOf(this.scene); }
  get townName() { return this.page?.title || this.scene?.name || ""; }
  /** The table as the player's play needs it. */
  get town() { const g = this.page?.games; return { name: this.townName, sceneId: this.scene?.id ?? "", on: !!g?.on, maxBet: g?.maxBet ?? 0, edge: g?.edge ?? 0 }; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const town = this.town, player = buyerFor(this.buyerId);
    this.buyerId = player?.id ?? null;
    const maxSp = town.maxBet * 10;
    this.wagerSp = Math.min(Math.max(1, Math.floor(this.wagerSp) || 1), maxSp || 1);
    return Object.assign(context, {
      townName: town.name, open: town.on, purse: player ? purseText(player.system.coins) : "",
      maxBet: formatPrice(fromCopper(town.maxBet * 100)), edge: town.edge, maxSp, wagerSp: this.wagerSp,
      wagerText: formatPrice(fromCopper(wagerFromSp(this.wagerSp))),
      chips: [...CHIPS.filter((c) => c.sp < maxSp), { sp: maxSp, label: t("SDE.town.games.max") }],
      games: [...GAME_IDS, ...SIT_GAMES].map((id) => ({
        id, icon: GAME_ICONS[id], name: t(GAME_KEYS[id].name), rules: t(GAME_KEYS[id].rules), odds: t(GAME_KEYS[id].odds),
        picks: id === "coin" ? SIDES.map((s) => ({ id: s, label: t(SIDE_KEYS[s]) })) : null,
      })),
      last: this.last, actors: buyerChoices().map((a) => ({ id: a.id, name: a.name, selected: a.id === player?.id })), hasPlayer: !!player,
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
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._stop = redrawOnChange(this);
  }

  _onClose(options) {
    this._stop?.();
    this._stop = null;
    super._onClose?.(options);
  }

  _onSetWager(_event, target) { this.wagerSp = Number(target.dataset.sp) || 1; return this.render(); }

  async _onPlay(_event, target) {
    const player = buyerFor(this.buyerId);
    if (this._busy) return;
    if (!player) return ui.notifications.warn(t("SDE.merchant.notify.noCharacterHint"));
    this._busy = true;
    try {
      this._io ??= await liveIo();
      const input = this.element.querySelector("input[name=wager]");
      // What is typed is the wager, even 0 (the game refuses it); only a box with nothing usable keeps the last one.
      const typed = input?.value === "" ? NaN : Number(input?.value);
      if (Number.isFinite(typed)) this.wagerSp = typed;
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

  /**
   * Sit down at a game with a table of its own. A hand or a round of the death roll takes its wager now and opens on the
   * dealt game; the roulette takes nothing until it spins, and opens on an empty board with the wager as the chip.
   */
  async _sit(player, game) {
    const wager = wagerFromSp(this.wagerSp), town = this.town;
    if (game === "roulette") {
      this.last = null;
      return TownRouletteApp.open({ scene: this.scene, player, table: { game, bets: {}, chip: Math.max(wager, 10), last: null, settled: true } });
    }
    const app = HAND_GAMES.includes(game) ? TownHandApp : TownDeathApp;
    if (app.inProgress()) return ui.notifications.warn(t("SDE.town.hand.inProgress"));
    // The house plays from the dice's own random source, like the games' dice.
    const io = { random: () => CONFIG.Dice.randomUniform(), ...this._io };
    const r = HAND_GAMES.includes(game) ? await startHand({ player, game, wager, town }, io) : await startDeath({ player, wager, town }, io);
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
