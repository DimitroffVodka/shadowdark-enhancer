/**
 * Shadowdark Enhancer — Bastion panel.
 *
 * One window listing the bastions you can see, or only a party's: a card each with its
 * art, type and week, hit points, treasury and upgrades, and buttons to open its sheet
 * (the GM also pays in and out, and starts a new bastion). It redraws as bastions change.
 *
 * It is a window of its own so it works wherever the Enhancer does; the same cards are
 * what a tab on a party sheet would show.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { BASTION_TYPE, ensureSprites } from "./bastion-art.mjs";
import { visibleBastions, bastionCard } from "./bastion-panel-core.mjs";
import { fundBastion } from "./bastion-writes.mjs";
import { t, format } from "./bastion-text.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class BastionPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-bastion-panel",
    classes: ["shadowdark-enhancer", "sde-bastion-panel"],
    position: { width: 680, height: 560 },
    window: { icon: "fa-solid fa-chess-rook", title: "SDE.bastion.panel.title", resizable: true },
    actions: {
      openSheet: BastionPanel.prototype._onOpenSheet,
      deposit: BastionPanel.prototype._onDeposit,
      withdraw: BastionPanel.prototype._onWithdraw,
      newBastion: BastionPanel.prototype._onNewBastion,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/bastion-panel.hbs`, scrollable: [".sde-bp-cards"] },
  };

  /** The party whose bastions are shown, or null for every one you can see. */
  party = null;
  _hooks = [];

  /** Open (or bring forward) the one panel, for a party or for all. */
  static open({ party = null } = {}) {
    const panel = foundry.applications.instances.get(BastionPanel.DEFAULT_OPTIONS.id) ?? new BastionPanel();
    panel.party = party;
    panel.render({ force: true });
    return panel;
  }

  get title() {
    const base = t("SDE.bastion.panel.title");
    return this.party ? `${base}: ${this.party.name}` : base;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    await ensureSprites();
    const bastions = visibleBastions(game.actors.contents, { user: game.user, party: this.party });
    context.gm = game.user.isGM;
    context.cards = bastions.map((actor) => bastionCard(actor, { t, format }));
    context.empty = this.party
      ? format("SDE.bastion.panel.emptyParty", { party: this.party.name })
      : t("SDE.bastion.panel.empty");
    return context;
  }

  /** The window's title is only read when it is first drawn, so a panel reopened for another party sets it again. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.window?.title) this.window.title.textContent = this.title;
  }

  /** Redraw while open whenever a bastion is made, changed or removed. */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const refresh = (actor) => { if (actor?.type === BASTION_TYPE) this.render(); };
    for (const hook of ["createActor", "updateActor", "deleteActor"]) this._hooks.push([hook, Hooks.on(hook, refresh)]);
  }

  _onClose(options) {
    for (const [hook, id] of this._hooks) Hooks.off(hook, id);
    this._hooks = [];
    return super._onClose?.(options);
  }

  _onOpenSheet(_event, target) {
    game.actors.get(target.dataset.id)?.sheet?.render(true);
  }

  _onDeposit(_event, target) { return this._fund(target.dataset.id, "deposit"); }
  _onWithdraw(_event, target) { return this._fund(target.dataset.id, "withdraw"); }

  _fund(id, direction) {
    const actor = game.actors.get(id);
    return actor ? fundBastion(actor, direction) : false;
  }

  /** A new, unbuilt House, owned by this panel's party when it has one, and its sheet. */
  async _onNewBastion() {
    if (!game.user.isGM) return;
    const actor = await Actor.implementation.create({
      name: t("SDE.bastion.panel.newName"),
      type: BASTION_TYPE,
      system: this.party ? { party: this.party.uuid } : {},
    });
    actor?.sheet?.render(true);
  }
}
