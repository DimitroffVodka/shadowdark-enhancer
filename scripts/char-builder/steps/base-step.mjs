/**
 * Base class for character-builder steps.
 *
 * Each step owns a slice of the builder state, a registered Handlebars partial
 * for its body, and its own action + DOM wiring. The app drives the lifecycle:
 * `prepareContext` on render, `handleAction`/`onRender` for interaction,
 * `randomize` for the per-section (and Full-Random) dice buttons.
 */
export class BaseStep {
  /** @param {ShadowdarkCharBuilder} app */
  constructor(app) {
    this.app = app;
  }

  /** Shared builder state. */
  get state() { return this.app.builderState; }

  /** Drop any cached compendium-derived content so a re-render re-reads it
   *  (called when the importer unlocks new content). Override to clear caches. */
  invalidateContentCache() {}

  /** Unique step id, also used as a tab key. Override. */
  get id() { return "base"; }

  /** i18n key for the step's tab label. Override. */
  get label() { return "SDE.charBuilder.step.base"; }

  /** FontAwesome icon class. Override. */
  get icon() { return "fa-solid fa-circle"; }

  /** Registered Handlebars partial name for this step's body. Override. */
  get partial() { return "sde-cb-placeholder"; }

  /** Whether this step's requirements are satisfied (drives the tab check + Finish). */
  isComplete() { return false; }

  /** Whether the footer shows a per-section "Random" button for this step. */
  supportsRandom() { return false; }

  /** Randomize this step's choices. Override. */
  async randomize() {}

  /** Step-specific render context (exposed as `step` in the template). */
  async prepareContext() { return {}; }

  /**
   * Handle a delegated `data-action` click.
   * @returns {boolean} false to skip the automatic re-render; anything else re-renders.
   */
  async handleAction(_action, _event, _target) { return false; }

  /** Wire step-specific DOM listeners (selects/inputs) after each render. */
  onRender(_root) {}
}
