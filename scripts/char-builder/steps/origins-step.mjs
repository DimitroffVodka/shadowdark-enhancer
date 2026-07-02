import { BaseStep } from "./base-step.mjs";
import { BackgroundStep } from "./background-step.mjs";
import { AlignmentStep } from "./alignment-step.mjs";
import { DeityStep } from "./deity-step.mjs";

/**
 * Step — Origins: Background + Alignment + Deity on one tab.
 *
 * Composes the three retained step classes rather than merging their code —
 * each sub-step keeps its own list cache, selection, random and DOM wiring,
 * and keeps writing the same builder-state keys (`background`, `alignment`,
 * `deity`), so the commit path is untouched. Only this step appears in the
 * app's tab list.
 */
export class OriginsStep extends BaseStep {
  constructor(app) {
    super(app);
    this.sub = {
      background: new BackgroundStep(app),
      alignment: new AlignmentStep(app),
      deity: new DeityStep(app),
    };
  }

  get id() { return "origins"; }
  get label() { return "SDE.charBuilder.step.origins"; }
  get icon() { return "fa-solid fa-scroll"; }
  get partial() { return "sde-cb-origins"; }

  /** Background required; alignment defaults to neutral; deity is optional. */
  isComplete() { return !!this.state.background?.uuid; }

  supportsRandom() { return true; }

  /** Alignment before deity — deity's random is weighted to the alignment. */
  async randomize() {
    await this.sub.background.randomize();
    await this.sub.alignment.randomize();
    await this.sub.deity.randomize();
  }

  async prepareContext() {
    return {
      background: await this.sub.background.prepareContext(),
      alignment: await this.sub.alignment.prepareContext(),
      deity: await this.sub.deity.prepareContext(),
    };
  }

  /**
   * Scope each sub-step's wiring to its own <section> — the two ListSteps both
   * bind [data-cb-select]/[data-cb-search] and would cross-wire on a shared root.
   */
  onRender(root) {
    for (const [key, sub] of Object.entries(this.sub)) {
      const section = root.querySelector(`[data-cb-origin="${key}"]`);
      if (section) sub.onRender(section);
    }
  }
}
