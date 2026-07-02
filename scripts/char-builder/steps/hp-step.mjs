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

  /** Class hit die string — system classes use "d8", third-party ones "1d8". */
  get hitDie() { return this.state.class?.item?.system?.hitPoints || null; }
  /** "1dN" roll formula for the hit die, whichever form the class data uses. */
  get dieFormula() { return this.hitDie ? (/^\d/.test(this.hitDie) ? this.hitDie : `1${this.hitDie}`) : null; }
  get dieMax() {
    const m = String(this.hitDie || "").match(/^(\d*)\s*d\s*(\d+)/i);
    return m ? Math.max(1, Number(m[1]) || 1) * Number(m[2]) : 0;
  }
  get conMod() { return abilityMod(this.state.stats.values.con) ?? 0; }

  /** HP modifiers granted by the chosen ancestry talents, read structurally
   *  from their ActiveEffects (Dwarf "Stout": +2 max HP and advantage on HP
   *  rolls via system.roll.hp.advantage). Cached per talent set. */
  async _hpModifiers() {
    const key = (this.state.ancestryTalents || []).join(",");
    if (this._modsCache?.key === key) return this._modsCache.mods;
    const mods = { bonus: 0, advantage: false };
    for (const uuid of (this.state.ancestryTalents || [])) {
      // eslint-disable-next-line no-await-in-loop
      const doc = await fromUuid(uuid).catch(() => null);
      for (const effect of (doc?.effects ?? [])) {
        for (const c of (effect.changes ?? [])) {
          if (c.key === "system.attributes.hp.max") mods.bonus += Number(c.value) || 0;
          if (c.key === "system.roll.hp.advantage") mods.advantage = true;
        }
      }
    }
    this._modsCache = { key, mods };
    return mods;
  }
  get maxSetting() {
    try { return !!game.settings.get(MODULE_ID, "charBuilderMaxLevel1HP"); } catch (_e) { return false; }
  }

  async prepareContext() {
    const cm = this.conMod;
    const mods = await this._hpModifiers();
    return {
      hasClass: !!this.hitDie,
      hitDie: this.hitDie,
      conModLabel: cm >= 0 ? `+${cm}` : `${cm}`,
      hpBonus: mods.bonus || null,
      advantage: mods.advantage,
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
    const mods = await this._hpModifiers();
    // Advantage (Dwarf Stout): roll the hit die twice, keep the highest.
    const m = String(this.hitDie).match(/^(\d*)\s*d\s*(\d+)/i);
    const faces = m ? Number(m[2]) : 0;
    const formula = mods.advantage && faces ? `2d${faces}kh1` : this.dieFormula;
    const roll = await new Roll(formula).evaluate();
    const total = Math.max(1, roll.total + this.conMod) + mods.bonus;
    // `bonus` is granted by a talent effect that re-applies on the actor — the
    // commit writes base HP without it to avoid double-counting.
    this.state.hp = { max: total, rolled: roll.total, bonus: mods.bonus };
    await this._card(roll, total, mods.advantage ? "adv" : "roll");
  }

  async _max() {
    if (!this.hitDie) return;
    const mods = await this._hpModifiers();
    const total = Math.max(1, this.dieMax + this.conMod) + mods.bonus;
    this.state.hp = { max: total, rolled: this.dieMax, bonus: mods.bonus };
    await this._card(null, total, "max");
  }

  async _card(roll, total, kind) {
    const cm = this.conMod;
    const tag = kind === "max" ? ` (${game.i18n.localize("SDE.charBuilder.hp.maxTag")})`
      : kind === "adv" ? ` (${game.i18n.localize("SDE.charBuilder.hp.advTag")})` : "";
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
