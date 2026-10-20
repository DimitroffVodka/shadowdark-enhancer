/**
 * Shadowdark Enhancer — a hand of blackjack at a town table (ApplicationV2), opened from the games window.
 *
 * The games window deals the hand (the wager comes out of the purse there) and opens this table on it. The player hits,
 * stands, doubles down or splits a pair; every move goes through town-blackjack.mjs on this client, so it needs no GM, and
 * the window only shows the hand (blackjack-view.mjs). Closing the window, or going back, in the middle of a hand walks
 * away from it and loses what is on the table.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { toCopper } from "../shared/coins.mjs";
import { blackjackView } from "./blackjack-view.mjs";
import { blackjackIo, playBlackjack, settleBlackjackTable, startBlackjack, walkAwayBlackjackTable } from "./town-blackjack.mjs";
import { TownTableApp } from "./town-table-app.mjs";
import { purseText } from "./town-view.mjs";

export class TownBlackjackApp extends TownTableApp {
  static DEFAULT_OPTIONS = {
    id: "sde-town-blackjack",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town-blackjack"],
    position: { width: 640, height: 640 },
    window: { icon: "fa-solid fa-diamond", title: "SDE.town.games.title", resizable: true },
    actions: {
      move: TownBlackjackApp.prototype._onMove, again: TownBlackjackApp.prototype._onAgain,
      collect: TownBlackjackApp.prototype._onCollect, back: TownBlackjackApp.prototype._onBack,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-blackjack.hbs`, scrollable: [".ui-body"] },
  };

  _makeIo() { return blackjackIo(); }
  _leave(player) { return walkAwayBlackjackTable({ player, table: this.table, town: this.town }, this._io); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const player = this.player;
    return Object.assign(context, blackjackView(this.table, { name: player?.name ?? "", purse: player ? toCopper(player.system.coins) : 0, edge: this.town.edge, loc: t }), {
      townName: this.townName, purse: player ? purseText(player.system.coins) : "", playerName: player?.name ?? "",
    });
  }

  /** A button's move: hit, stand, double or split. */
  _onMove(_event, target) {
    return this._run(async (io, player) => {
      const r = await playBlackjack({ player, table: this.table, action: { type: target.dataset.move }, town: this.town }, io);
      if (r.table) this.table = r.table;
      if (!r.ok) ui.notifications.warn(r.error);
    });
  }

  /** The hand is over but the winnings did not save: try again. */
  _onCollect() {
    return this._run(async (io, player) => {
      const r = await settleBlackjackTable({ player, table: this.table, town: this.town }, io);
      if (r.table) this.table = r.table;
      if (!r.ok) ui.notifications.warn(r.error);
    });
  }

  /** Another hand at the same wager. */
  _onAgain() {
    return this._run(async (io, player) => {
      if (!this.table.settled) return;
      const r = await startBlackjack({ player, wager: this.table.wager, town: this.town }, io);
      if (r.ok) this.table = r.table;
      else ui.notifications.warn(r.error);
    });
  }
}
