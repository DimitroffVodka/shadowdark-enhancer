import { BaseStep } from "./base-step.mjs";
import { HpStep } from "./hp-step.mjs";
import { GoldStep } from "./gold-step.mjs";

/**
 * Step — Hit Points & Gold on one tab: both are single dice rolls, so they
 * share a page. Composes the two retained step classes (same pattern as
 * Origins); each keeps its own state, actions and DOM wiring, scoped to its
 * own <section>. The step id stays "hp" so the Finish gate is unchanged —
 * which now also requires gold to be rolled (one click, or the manual field).
 */
export class HpGoldStep extends BaseStep {
  constructor(app) {
    super(app);
    this.sub = { hp: new HpStep(app), gold: new GoldStep(app) };
  }

  get id() { return "hp"; }
  get label() { return "SDE.charBuilder.step.hpGold"; }
  get icon() { return "fa-solid fa-heart"; }
  get partial() { return "sde-cb-hp-gold"; }

  isComplete() { return this.sub.hp.isComplete() && this.sub.gold.isComplete(); }

  supportsRandom() { return this.sub.hp.supportsRandom() || this.sub.gold.supportsRandom(); }

  async randomize() {
    if (this.sub.hp.supportsRandom()) await this.sub.hp.randomize();
    if (this.sub.gold.supportsRandom()) await this.sub.gold.randomize();
  }

  async prepareContext() {
    return {
      hp: await this.sub.hp.prepareContext(),
      gold: await this.sub.gold.prepareContext(),
    };
  }

  /** Route the footer/step actions to whichever sub-step claims them. */
  async handleAction(action, event, target) {
    const hp = await this.sub.hp.handleAction(action, event, target);
    if (hp !== false) return hp;
    return this.sub.gold.handleAction(action, event, target);
  }

  onRender(root) {
    for (const [key, sub] of Object.entries(this.sub)) {
      const section = root.querySelector(`[data-cb-vital="${key}"]`);
      if (section) sub.onRender(section);
    }
  }
}
