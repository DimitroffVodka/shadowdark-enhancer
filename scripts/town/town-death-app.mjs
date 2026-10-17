/**
 * Shadowdark Enhancer — a round of the death roll at a town table (ApplicationV2), opened from the games window.
 *
 * The games window puts the wager on the table and opens this window on the round. The player rolls the die when it is
 * their turn and may double the stake before a roll (or take or pass the house's double); every move goes through
 * town-death.mjs on this client, so it needs no GM. Closing the window in the middle of a round walks away from it.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { toCopper } from "../shared/coins.mjs";
import { deathView } from "./death-view.mjs";
import { deathIo, playDeath, settleDeathTable, startDeath, walkAwayDeathTable } from "./town-death.mjs";
import { TownTableApp } from "./town-table-app.mjs";
import { purseText } from "./town-view.mjs";

export class TownDeathApp extends TownTableApp {
  static DEFAULT_OPTIONS = {
    id: "sde-town-death",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town-death"],
    position: { width: 640, height: 600 },
    window: { icon: "fa-solid fa-skull", title: "SDE.town.games.title", resizable: true },
    actions: {
      roll: TownDeathApp.prototype._onRoll, skip: TownDeathApp.prototype._onSkip, double: TownDeathApp.prototype._onDouble,
      take: TownDeathApp.prototype._onTake, pass: TownDeathApp.prototype._onPass, again: TownDeathApp.prototype._onAgain,
      collect: TownDeathApp.prototype._onCollect, back: TownDeathApp.prototype._onBack,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-death.hbs`, scrollable: [".ui-body"] },
  };

  _makeIo() { return deathIo(); }
  _leave(player) { return walkAwayDeathTable({ player, table: this.table, town: this.town }, this._io); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const player = this.player;
    return Object.assign(context, deathView(this.table, { name: player?.name ?? "", purse: player ? toCopper(player.system.coins) : 0, edge: this.town.edge, loc: t }), {
      townName: this.townName, purse: player ? purseText(player.system.coins) : "", playerName: player?.name ?? "",
    });
  }

  _play(action) {
    return this._run(async (io, player) => {
      const r = await playDeath({ player, table: this.table, action, town: this.town }, io);
      if (r.table) this.table = r.table;
      if (!r.ok) ui.notifications.warn(r.error);
    });
  }

  _onRoll() { return this._play({ type: "roll" }); }
  _onSkip() { return this._play({ type: "skip" }); }
  _onDouble() { return this._play({ type: "double" }); }
  _onTake() { return this._play({ type: "take" }); }
  _onPass() { return this._play({ type: "pass" }); }

  /** The round is over but the winnings did not save: try again. */
  _onCollect() {
    return this._run(async (io, player) => {
      const r = await settleDeathTable({ player, table: this.table, town: this.town }, io);
      if (r.table) this.table = r.table;
      if (!r.ok) ui.notifications.warn(r.error);
    });
  }

  /** Another round at the same wager. */
  _onAgain() {
    return this._run(async (io, player) => {
      if (!this.table.settled) return;
      const r = await startDeath({ player, wager: this.table.wager, town: this.town }, io);
      if (r.ok) this.table = r.table;
      else ui.notifications.warn(r.error);
    });
  }
}
