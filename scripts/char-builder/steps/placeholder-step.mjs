import { BaseStep } from "./base-step.mjs";

/**
 * A not-yet-implemented step. Appears in the rail so the full flow is visible,
 * but renders a "coming soon" body. Real step managers replace these one by one.
 */
export class PlaceholderStep extends BaseStep {
  constructor(app, id, label, icon) {
    super(app);
    this._id = id;
    this._label = label;
    this._icon = icon ?? "fa-solid fa-hourglass-half";
  }

  get id() { return this._id; }
  get label() { return this._label; }
  get icon() { return this._icon; }
  get partial() { return "sde-cb-placeholder"; }

  isComplete() { return false; }

  async prepareContext() {
    return { title: game.i18n.localize(this._label) };
  }
}
