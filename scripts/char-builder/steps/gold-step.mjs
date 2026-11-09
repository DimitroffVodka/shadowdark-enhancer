import { BaseStep } from "./base-step.mjs";
import { MODULE_ID } from "../../shared/module-id.mjs";
import { builderDiceAnimation } from "../constants.mjs";
import { slotsFor } from "./gear-step.mjs";

/** The system generator's level-0 starting gear table, and the arrows its shortbow result adds. */
const LEVEL_ZERO_GEAR_TABLE = "Compendium.shadowdark.rollable-tables.RollTable.WKVfMaGkoXe3DGub";
const ARROWS = "Compendium.shadowdark.gear.Item.XXwA9ZWajYEDmcea";

/**
 * Step — Gold. Roll 2d6×5 gp, or use the GM's fixed starting-gold setting
 * (`charBuilderStartingGold` > 0). A GM-only manual field allows any amount.
 * Rolls post a chat card; with `charBuilderLockGoldRolls` on, a player's first
 * roll is their only one. A level-0 character has no gold: the same button rolls
 * its starting gear on the system's level-0 gear table instead, free of charge.
 */
export class GoldStep extends BaseStep {
  get id() { return "gold"; }
  get label() { return "SDE.charBuilder.step.gold"; }
  get icon() { return "fa-solid fa-coins"; }
  get partial() { return "sde-cb-gold"; }

  /** An existing actor's coins are what it holds: no starting gold, no roll (#168). */
  get readOnly() { return !!this.state.existing; }

  isComplete() { return this.state.goldRolled; }

  /** GM lock: a player who has rolled (or been handed a fixed amount) rolls no more. */
  get rollLocked() { return !!this.state.goldRolled && this.lockedBy("charBuilderLockGoldRolls"); }

  get fixed() {
    try { return Number(game.settings.get(MODULE_ID, "charBuilderStartingGold")) || 0; } catch (_e) { return 0; }
  }

  async prepareContext() {
    if (this.readOnly) {
      const c = this.state.coins;
      const coinsText = [c.gp && `${c.gp} gp`, c.sp && `${c.sp} sp`, c.cp && `${c.cp} cp`].filter(Boolean).join(" ") || "0 gp";
      return { existing: true, coinsText, complete: true };
    }
    if (this.state.level0) {
      const gear = this.state.gear.filter((g) => g.rowId?.startsWith("level0-")).map((g) => g.qty > 1 ? `${g.name} (${g.qty})` : g.name);
      return { level0: true, rollLocked: this.rollLocked, rolled: this.state.goldRolled, gear: gear.join(", "), complete: this.isComplete() };
    }
    const fixed = this.fixed;
    // A GM-fixed amount is applied automatically the first time this step renders.
    if (fixed > 0 && !this.state.goldRolled) {
      this.state.coins.gp = fixed;
      this.state.goldRolled = true;
    }
    return {
      fixed: fixed > 0 ? fixed : null,
      canEdit: !!game.user?.isGM,   // the manual gp box is a GM override, never a player's
      rollLocked: this.rollLocked,
      gp: this.state.coins.gp,
      rolled: this.state.goldRolled,
      complete: this.isComplete(),
    };
  }

  supportsRandom() { return !this.readOnly && (this.state.level0 || this.fixed <= 0) && !this.rollLocked; }
  async randomize() { if (!this.rollLocked) await this._roll(); }

  async handleAction(action) {
    if (this.readOnly) return false;
    if (action === "cb-roll-gold") {
      if (this.rollLocked) return false;
      await this._roll();
      return true;
    }
    return false;
  }

  async _roll() {
    if (this.readOnly) return;
    if (this.state.level0) return this._rollLevel0Gear();
    if (this.fixed > 0) {
      this.state.coins.gp = this.fixed;
      this.state.goldRolled = true;
      return;
    }
    const roll = await new Roll("2d6 * 5").evaluate();
    this.state.coins.gp = roll.total;
    this.state.goldRolled = true;
    const content = `<div class="sde-cb-rollcard"><h4>${game.i18n.localize("SDE.charBuilder.gold.card")}</h4>`
      + `<div class="method">2d6 × 5 → <b>${roll.total} gp</b></div></div>`;
    const animate = builderDiceAnimation();
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker(),
        flavor: game.i18n.localize("SDE.charBuilder.title"),
        content,
        rolls: animate ? [roll] : [],
        sound: animate ? CONFIG.sounds.dice : undefined,
      });
    } catch (e) {
      console.error("shadowdark-enhancer | char-builder gold card failed:", e);
    }
  }

  /** Draw the level-0 gear table (the system posts the result to chat) and put the items in the cart at no cost. */
  async _rollLevel0Gear() {
    const table = await fromUuid(LEVEL_ZERO_GEAR_TABLE).catch(() => null);
    if (!table) { ui.notifications.warn(game.i18n.localize("SDE.charBuilder.gold.noGearTable")); return; }
    const draw = await table.draw({ displayChat: true });
    // A table result can be a stack (Arrows ×5, Iron Spikes ×10): the cart counts what Create delivers.
    const rows = (await shadowdark.utils.getItemsFromRollResults(draw.results)).filter(Boolean)
      .map((doc) => ({ doc, qty: Math.max(1, Number(doc.system?.quantity) || 1) }));
    // As the system's generator does: its shortbow result comes with five arrows.
    if (rows.some((r) => r.doc.name === "Shortbow and 5 arrows")) {
      const arrows = await fromUuid(ARROWS).catch(() => null);
      if (arrows) rows.push({ doc: arrows, qty: 5 });
    }
    // A reroll replaces the rolled rows; anything bought in the shop stays.
    this.state.gear = this.state.gear.filter((g) => !g.rowId?.startsWith("level0-"));
    rows.forEach(({ doc: d, qty }, i) => {
      this.state.gear.push({
        rowId: `level0-${i}`, uuid: d.uuid, name: d.name, img: d.img, qty, type: d.type,
        magic: !!d.system?.magicItem, costCp: 0, slots: slotsFor(d, qty), slotSpec: d.system?.slots ?? null,
      });
    });
    this.state.coins = { gp: 0, sp: 0, cp: 0 };
    this.state.goldRolled = true;
  }

  onRender(root) {
    if (this.readOnly || !game.user?.isGM) return;
    root.querySelector("[data-cb-gold-input]")?.addEventListener("change", async (ev) => {
      this.state.coins.gp = Math.max(0, Math.floor(Number(ev.target.value) || 0));
      this.state.goldRolled = true;
      await this.app.render();   // keep the big-number total + Finish-ready state in sync
    });
  }
}
