import { BaseStep } from "./base-step.mjs";
import { MODULE_ID } from "../../shared/module-id.mjs";
import { abilityMod, builderDiceAnimation, hpFromDice } from "../constants.mjs";

/**
 * Step — Hit Points. One hit die per character level: the first die takes the
 * CON modifier (minimum 1 total), every later one is added raw — see
 * `hpFromDice` for the rule text this mirrors.
 *
 * The GM setting `charBuilderMaxLevel1HP` forces the die maximum instead of a
 * roll (every die, at any level); the Take-Max button exists only while it is
 * on. Rolls post a chat card. With `charBuilderLockHpRolls` on, a player's
 * first roll is their only one. Requires a class (for the hit die).
 */
export class HpStep extends BaseStep {
  get id() { return "hp"; }
  get label() { return "SDE.charBuilder.step.hp"; }
  get icon() { return "fa-solid fa-heart"; }
  get partial() { return "sde-cb-hp"; }

  isComplete() { return this.state.hp.max > 0; }

  /** GM lock: a player whose HP is settled (rolled or maxed) rolls no more. */
  get rollLocked() { return this.state.hp.max > 0 && this.lockedBy("charBuilderLockHpRolls"); }

  /** Class hit die string — system classes use "d8", third-party ones "1d8". */
  get hitDie() { return this.state.class?.item?.system?.hitPoints || null; }
  /** "1dN" roll formula for the hit die, whichever form the class data uses. */
  get dieFormula() { return this.hitDie ? (/^\d/.test(this.hitDie) ? this.hitDie : `1${this.hitDie}`) : null; }
  get dieMax() {
    const m = String(this.hitDie || "").match(/^(\d*)\s*d\s*(\d+)/i);
    return m ? Math.max(1, Number(m[1]) || 1) * Number(m[2]) : 0;
  }
  get conMod() { return abilityMod(this.state.stats.values.con) ?? 0; }
  /** Hit dice to roll = character level (a level-0 funnel build rolls one). */
  get level() { return this.state.level0 ? 1 : (this.state.level || 1); }

  /** HP modifiers granted by the chosen ancestry talents, read structurally
   *  from their ActiveEffects (Dwarf "Stout": +2 max HP and advantage on HP
   *  rolls via system.roll.hp.advantage). Cached per talent set. */
  async _hpModifiers() {
    const key = (this.state.ancestryTalents || []).join(",");
    if (this._modsCache?.key === key) return this._modsCache.mods;
    const mods = { bonus: 0, advantage: false };
    for (const uuid of (this.state.ancestryTalents || [])) {
       
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
      rollLocked: this.rollLocked,
      hp: this.state.hp.max || null,
      rolled: this.state.hp.rolled,
      level: this.level,
      multiLevel: this.level > 1,
      // "5, 3, 7" — the individual hit dice behind the total (Handlebars can't join).
      diceLabel: (this.state.hp.dice?.length ?? 0) > 1 ? this.state.hp.dice.join(", ") : null,
      complete: this.isComplete(),
    };
  }

  supportsRandom() { return !!this.hitDie && !this.rollLocked; }
  async randomize() { if (!this.rollLocked) await this._roll(); }

  async handleAction(action) {
    switch (action) {
      case "cb-roll-hp": if (this.rollLocked) return false; await this._roll(); return true;
      case "cb-max-hp": if (!this.maxSetting || this.rollLocked) return false; await this._max(); return true;
      default: return false;
    }
  }

  async _roll() {
    if (!this.hitDie) return;
    if (this.maxSetting) return this._max();
    const mods = await this._hpModifiers();
    // Advantage (Dwarf Stout): roll the hit die twice, keep the highest — for
    // EACH level's die, not just the first.
    const m = String(this.hitDie).match(/^(\d*)\s*d\s*(\d+)/i);
    const faces = m ? Number(m[2]) : 0;
    const term = mods.advantage && faces ? `2d${faces}kh1` : this.dieFormula;
    // One Roll with a term per level, so the chat card animates once and each
    // die's kept result is readable off `roll.dice`.
    const roll = await new Roll(Array(this.level).fill(term).join(" + ")).evaluate();
    await this._settle(roll.dice.map((d) => d.total), mods, roll, mods.advantage ? "adv" : "roll");
  }

  async _max() {
    if (!this.hitDie) return;
    const mods = await this._hpModifiers();
    await this._settle(Array(this.level).fill(this.dieMax), mods, null, "max");
  }

  /** Fold the per-level dice into max HP, store them, and post the chat card. */
  async _settle(dice, mods, roll, kind) {
    const total = hpFromDice(dice, this.conMod) + mods.bonus;
    // `bonus` is granted by a talent effect that re-applies on the actor — the
    // commit writes base HP without it to avoid double-counting. `rolled` stays
    // the dice sum (its old meaning at level 1); `dice` holds the breakdown.
    this.state.hp = { max: total, rolled: dice.reduce((a, b) => a + b, 0), bonus: mods.bonus, dice };
    await this._card(dice, total, kind, roll);
  }

  async _card(dice, total, kind, roll) {
    const cm = this.conMod;
    const tag = kind === "max" ? ` (${game.i18n.localize("SDE.charBuilder.hp.maxTag")})`
      : kind === "adv" ? ` (${game.i18n.localize("SDE.charBuilder.hp.advTag")})` : "";
    const dieLine = dice.length > 1 ? `${this.hitDie}: ${dice.join(", ")}` : `${this.hitDie}`;
    const content = `<div class="sde-cb-rollcard"><h4>${game.i18n.localize("SDE.charBuilder.hp.card")}</h4>`
      + `<div class="method">${dieLine} + CON ${cm >= 0 ? `+${cm}` : cm} → <b>${total} HP</b>${tag}</div></div>`;
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
