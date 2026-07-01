import { BaseStep } from "./base-step.mjs";
import { MODULE_ID } from "../../module-id.mjs";
import { abilityMod, builderDiceAnimation } from "../constants.mjs";

/**
 * Step — Hit Points. Level-1 HP = class hit die + CON modifier (minimum 1).
 * The GM setting `charBuilderMaxLevel1HP` forces the die maximum instead of a
 * roll; a Take-Max button is always available. Rolls post a chat card.
 * Requires a class (for the hit die).
 */
export class HpStep extends BaseStep {
  get id() { return "hp"; }
  get label() { return "SDE.charBuilder.step.hp"; }
  get icon() { return "fa-solid fa-heart"; }
  get partial() { return "sde-cb-hp"; }

  isComplete() { return this.state.hp.max > 0; }

  /** Class hit die string, e.g. "d8". */
  get hitDie() { return this.state.class?.item?.system?.hitPoints || null; }
  get dieMax() { return this.hitDie ? (Number(this.hitDie.replace(/^d/i, "")) || 0) : 0; }
  get conMod() { return abilityMod(this.state.stats.values.con) ?? 0; }
  get maxSetting() {
    try { return !!game.settings.get(MODULE_ID, "charBuilderMaxLevel1HP"); } catch (_e) { return false; }
  }

  async prepareContext() {
    const cm = this.conMod;
    return {
      hasClass: !!this.hitDie,
      hitDie: this.hitDie,
      conModLabel: cm >= 0 ? `+${cm}` : `${cm}`,
      maxSetting: this.maxSetting,
      hp: this.state.hp.max || null,
      rolled: this.state.hp.rolled,
      complete: this.isComplete(),
    };
  }

  supportsRandom() { return !!this.hitDie; }
  async randomize() { await this._roll(); }

  async handleAction(action) {
    switch (action) {
      case "cb-roll-hp": await this._roll(); return true;
      case "cb-max-hp": await this._max(); return true;
      default: return false;
    }
  }

  async _roll() {
    if (!this.hitDie) return;
    if (this.maxSetting) return this._max();
    const roll = await new Roll(`1${this.hitDie}`).evaluate();
    const total = Math.max(1, roll.total + this.conMod);
    this.state.hp = { max: total, rolled: roll.total };
    await this._card(roll, total, "roll");
  }

  async _max() {
    if (!this.hitDie) return;
    const total = Math.max(1, this.dieMax + this.conMod);
    this.state.hp = { max: total, rolled: this.dieMax };
    await this._card(null, total, "max");
  }

  async _card(roll, total, kind) {
    const cm = this.conMod;
    const tag = kind === "max" ? ` (${game.i18n.localize("SDE.charBuilder.hp.maxTag")})` : "";
    const content = `<div class="sde-cb-rollcard"><h4>${game.i18n.localize("SDE.charBuilder.hp.card")}</h4>`
      + `<div class="method">${this.hitDie} + CON ${cm >= 0 ? `+${cm}` : cm} → <b>${total} HP</b>${tag}</div></div>`;
    const animate = builderDiceAnimation();
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker(),
        flavor: game.i18n.localize("SDE.charBuilder.title"),
        content,
        rolls: (roll && animate) ? [roll] : [],
        sound: (roll && animate) ? CONFIG.sounds.dice : undefined,
      });
    } catch (e) {
      console.error("shadowdark-enhancer | char-builder HP card failed:", e);
    }
  }
}
