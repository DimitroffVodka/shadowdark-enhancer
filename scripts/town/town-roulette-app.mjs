/**
 * Shadowdark Enhancer — the roulette board at a town table (ApplicationV2), opened from the games window.
 *
 * The player picks a chip size and clicks spots to lay chips (a click lays one, the chip stack takes one back), then
 * spins: one d20 settles every spot at once, through town-roulette.mjs on this client, so it needs no GM. Nothing is
 * taken from the purse until the spin, so closing the window costs nothing. The layout stays after a spin to bet again.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { formatPrice, fromCopper, toCopper } from "../shared/coins.mjs";
import { WAGER_KEYS } from "./games-core.mjs";
import { addChip, boardStake, removeChip } from "./roulette-core.mjs";
import { rouletteView } from "./roulette-view.mjs";
import { spinWheel } from "./town-roulette.mjs";
import { liveIo } from "./town-games.mjs";
import { TownTableApp } from "./town-table-app.mjs";
import { purseText } from "./town-view.mjs";

export class TownRouletteApp extends TownTableApp {
  static DEFAULT_OPTIONS = {
    id: "sde-town-roulette",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town-roulette"],
    position: { width: 640, height: 720 },
    window: { icon: "fa-solid fa-bullseye", title: "SDE.town.games.title", resizable: true },
    actions: {
      chip: TownRouletteApp.prototype._onChip, bet: TownRouletteApp.prototype._onBet, unbet: TownRouletteApp.prototype._onUnbet,
      clear: TownRouletteApp.prototype._onClear, spin: TownRouletteApp.prototype._onSpin, back: TownRouletteApp.prototype._onBack,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-roulette.hbs`, scrollable: [".ui-body"] },
  };

  _makeIo() { return liveIo(); }
  _leave() { return Promise.resolve(); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const player = this.player;
    return Object.assign(context, rouletteView(this.table, { name: player?.name ?? "", maxBet: this.town.maxBet, loc: t }), {
      townName: this.townName, purse: player ? purseText(player.system.coins) : "", playerName: player?.name ?? "",
    });
  }

  _onChip(_event, target) {
    this.table = { ...this.table, chip: Number(target.dataset.chip) };
    return this.render();
  }

  /** Lay a chip, if the board stays within the table's limit and the purse. */
  _onBet(_event, target) {
    const next = { ...this.table, bets: addChip(this.table.bets, target.dataset.pick) };
    const stake = boardStake(next.bets, next.chip), player = this.player;
    if (stake > this.town.maxBet * 100) return ui.notifications.warn(t(WAGER_KEYS.max, { max: formatPrice(fromCopper(this.town.maxBet * 100)) }));
    if (!player || stake > toCopper(player.system.coins)) return ui.notifications.warn(t(WAGER_KEYS.poor));
    this.table = next;
    return this.render();
  }

  _onUnbet(_event, target) {
    this.table = { ...this.table, bets: removeChip(this.table.bets, target.dataset.pick) };
    return this.render();
  }

  _onClear() {
    this.table = { ...this.table, bets: {} };
    return this.render();
  }

  _onSpin() {
    return this._run(async (io, player) => {
      const r = await spinWheel({ player, bets: this.table.bets, chip: this.table.chip, town: this.town }, io);
      if (!r.ok) return ui.notifications.warn(r.error);
      this.table = { ...this.table, last: { d20: r.out.d20, spots: r.out.spots, lines: r.lines.slice(0, 2), result: r.result, net: r.net, tone: r.result === "win" ? "good" : r.result === "lose" ? "bad" : "info" } };
    });
  }
}
