/**
 * Shadowdark Enhancer — a hand of Beholder's Bluff or Brag at a town table (ApplicationV2), opened from the games window.
 *
 * The games window deals the hand (the ante comes out of the purse there) and opens this table on it. Every move goes
 * through town-hand.mjs on this client, so it needs no GM: the window only shows the hand (hand-view.mjs) and passes on
 * what the player picked. Closing the window, or going back, in the middle of a hand walks away from it and loses the pot.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { toCopper } from "../shared/coins.mjs";
import { legalMoves } from "./hand-core.mjs";
import { handView } from "./hand-view.mjs";
import { handIo, playHand, settleTable, startHand, walkAwayHand } from "./town-hand.mjs";
import { TownTableApp } from "./town-table-app.mjs";
import { purseText } from "./town-view.mjs";

export class TownHandApp extends TownTableApp {
  static DEFAULT_OPTIONS = {
    id: "sde-town-hand",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town-hand"],
    position: { width: 640, height: 720 },
    window: { icon: "fa-solid fa-dice", title: "SDE.town.games.title", resizable: true },
    actions: {
      pick: TownHandApp.prototype._onPick, show: TownHandApp.prototype._onShow, reroll: TownHandApp.prototype._onReroll,
      move: TownHandApp.prototype._onMove, again: TownHandApp.prototype._onAgain, collect: TownHandApp.prototype._onCollect,
      back: TownHandApp.prototype._onBack,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-hand.hbs`, scrollable: [".ui-body"] },
  };

  /** The dice the player has selected, by index. */
  picked = [];

  reset() { this.picked = []; }
  _makeIo() { return handIo(); }
  _leave(player) { return walkAwayHand({ player, table: this.table, town: this.town }, this._io); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const player = this.player;
    return Object.assign(context, handView(this.table, { name: player?.name ?? "", purse: player ? toCopper(player.system.coins) : 0, picked: this.picked, edge: this.town.edge, loc: t }), {
      townName: this.townName, purse: player ? purseText(player.system.coins) : "", playerName: player?.name ?? "",
    });
  }

  /** Select a die: Bluff shows exactly one, Brag rerolls up to the step's limit. */
  _onPick(_event, target) {
    const i = Number(target.dataset.i), move = legalMoves(this.table.hand, "you");
    if (move.kind === "reveal") this.picked = [i];
    else if (move.kind === "draw") {
      this.picked = this.picked.includes(i) ? this.picked.filter((n) => n !== i) : [...this.picked, i].slice(-move.max);
    }
    return this.render();
  }

  _onShow() { return this._play({ type: "reveal", idx: this.picked[0] }); }
  _onReroll() { return this._play({ type: "draw", idx: [...this.picked] }); }
  _onMove(_event, target) { return this._play({ type: target.dataset.move }); }

  _play(action) {
    return this._run(async (io, player) => {
      const r = await playHand({ player, table: this.table, action, town: this.town }, io);
      if (r.table) this.table = r.table;
      if (!r.ok) ui.notifications.warn(r.error);
      else this.picked = [];
    });
  }

  /** The hand is over but the winnings did not save: try again. */
  _onCollect() {
    return this._run(async (io, player) => {
      const r = await settleTable({ player, table: this.table, town: this.town }, io);
      if (r.table) this.table = r.table;
      if (!r.ok) ui.notifications.warn(r.error);
    });
  }

  /** Another hand at the same wager. */
  _onAgain() {
    return this._run(async (io, player) => {
      if (!this.table.settled) return;
      const r = await startHand({ player, game: this.table.game, wager: this.table.wager, town: this.town }, io);
      if (r.ok) Object.assign(this, { table: r.table, picked: [] });
      else ui.notifications.warn(r.error);
    });
  }
}
