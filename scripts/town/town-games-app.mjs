/**
 * Shadowdark Enhancer — a town's games table (ApplicationV2), opened from the landing page when the GM has turned it on.
 *
 * The player picks a character, sets a wager (in silver, up to the town's limit) and plays one of seven games; the
 * game is rolled and settled on this client by town-games.mjs, with no GM connected. The last result stays on the
 * window. The wager is never taken until a game is played, and a game that cannot be saved is not played.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { BET_KEYS, GAME_ICONS, GAME_IDS, GAME_KEYS, ROULETTE_BETS, ROULETTE_SIZE, SIDES, SIDE_KEYS, wagerFromSp } from "./games-core.mjs";
import { landingOf } from "./town-core.mjs";
import { buyerChoices, buyerFor, redrawOnChange } from "./town-live.mjs";
import { playGame, liveIo } from "./town-games.mjs";
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
  /** The roulette number in the box, kept across redraws like the wager. */
  number = 7;
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
      games: GAME_IDS.map((id) => ({
        id, icon: GAME_ICONS[id], name: t(GAME_KEYS[id].name), rules: t(GAME_KEYS[id].rules), odds: t(GAME_KEYS[id].odds),
        picks: id === "coin" ? SIDES.map((s) => ({ id: s, label: t(SIDE_KEYS[s]) }))
          : id === "roulette" ? ROULETTE_BETS.map((b) => ({ id: b, label: t(BET_KEYS[b]) })) : null,
        numberBet: id === "roulette",
      })),
      number: this.number, numberMax: ROULETTE_SIZE,
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
    const pick = root.querySelector("input[name=number]");
    pick?.addEventListener("input", () => { this.number = pick.value; });
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
      // The Number button bets on what is in the box; a box with nothing usable is no bet (the game says so).
      const pick = target.dataset.pick === "number" ? String(Math.trunc(Number(this.number)) || "") : target.dataset.pick ?? "";
      const result = await playGame({ player, game: target.dataset.game, wager: wagerFromSp(this.wagerSp), pick, town: this.town }, this._io);
      if (!result.ok) ui.notifications.warn(result.error);
      this.last = result.ok ? { lines: result.lines, tone: result.result === "win" ? "good" : result.result === "lose" ? "bad" : "info", game: t(GAME_KEYS[result.game].name) } : null;
    } finally { this._busy = false; }
    return this.render();
  }

  async _onBack() {
    const { TownApp } = await import("./town-app.mjs");
    TownApp.open(this.scene);
    return this.close();
  }
}
