import { BaseStep } from "./base-step.mjs";
import { MODULE_ID } from "../../shared/module-id.mjs";
import { builderDiceAnimation } from "../constants.mjs";

/**
 * Step — Gold. Roll 2d6×5 gp, or use the GM's fixed starting-gold setting
 * (`charBuilderStartingGold` > 0). A manual field allows any amount. Rolls post
 * a chat card.
 */
export class GoldStep extends BaseStep {
  get id() { return "gold"; }
  get label() { return "SDE.charBuilder.step.gold"; }
  get icon() { return "fa-solid fa-coins"; }
  get partial() { return "sde-cb-gold"; }

  isComplete() { return this.state.goldRolled; }

  get fixed() {
    try { return Number(game.settings.get(MODULE_ID, "charBuilderStartingGold")) || 0; } catch (_e) { return 0; }
  }

  async prepareContext() {
    const fixed = this.fixed;
    // A GM-fixed amount is applied automatically the first time this step renders.
    if (fixed > 0 && !this.state.goldRolled) {
      this.state.coins.gp = fixed;
      this.state.goldRolled = true;
    }
    return {
      fixed: fixed > 0 ? fixed : null,
      gp: this.state.coins.gp,
      rolled: this.state.goldRolled,
      complete: this.isComplete(),
    };
  }

  supportsRandom() { return this.fixed <= 0; }
  async randomize() { await this._roll(); }

  async handleAction(action) {
    if (action === "cb-roll-gold") { await this._roll(); return true; }
    return false;
  }

  async _roll() {
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

  onRender(root) {
    root.querySelector("[data-cb-gold-input]")?.addEventListener("change", async (ev) => {
      this.state.coins.gp = Math.max(0, Math.floor(Number(ev.target.value) || 0));
      this.state.goldRolled = true;
      await this.app.render();   // keep the big-number total + Finish-ready state in sync
    });
  }
}
