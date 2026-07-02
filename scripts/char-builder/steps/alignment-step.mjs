import { BaseStep } from "./base-step.mjs";

const ORDER = ["lawful", "neutral", "chaotic"];

/**
 * Step — Alignment. Three choice cards (Lawful / Neutral / Chaotic). If a class
 * is chosen, its alignment is surfaced as a suggestion. Random picks one of the
 * three. Always "complete" (state defaults to neutral).
 */
export class AlignmentStep extends BaseStep {
  get id() { return "alignment"; }
  get label() { return "SDE.charBuilder.step.alignment"; }
  get icon() { return "fa-solid fa-scale-balanced"; }
  get partial() { return "sde-cb-alignment"; }

  isComplete() { return !!this.state.alignment; }

  /** Suggested alignment from the chosen class, if any. */
  get suggested() {
    const a = this.state.class?.item?.system?.alignment;
    return ORDER.includes(a) ? a : null;
  }

  // CONFIG.SHADOWDARK.ALIGNMENTS holds raw i18n keys — localize before display.
  _label(k) { return game.i18n.localize(CONFIG.SHADOWDARK?.ALIGNMENTS?.[k] ?? k); }

  /** Level-1 title for the chosen class at the given alignment, if any. */
  _titleFor(alignment) {
    const titles = this.state.class?.item?.system?.titles || [];
    const level = this.state.level0 ? 0 : 1;
    const t = titles.find((x) => level >= x.from && level <= x.to) || titles[0];
    return t ? (t[alignment] || null) : null;
  }

  async prepareContext() {
    const sug = this.suggested;
    return {
      options: ORDER.map((k) => ({
        key: k,
        label: this._label(k),
        desc: game.i18n.localize(`SDE.charBuilder.alignment.${k}Desc`),
        selected: this.state.alignment === k,
        suggested: sug === k,
        title: this._titleFor(k),
      })),
      suggestedLabel: sug ? this._label(sug) : null,
      currentTitle: this._titleFor(this.state.alignment),
      className: this.state.class?.name ?? null,
    };
  }

  supportsRandom() { return true; }

  async randomize() {
    this.state.alignment = ORDER[Math.floor(Math.random() * ORDER.length)];
  }

  onRender(root) {
    root.querySelectorAll("[data-cb-align]").forEach((el) => {
      el.addEventListener("click", async () => {
        this.state.alignment = el.dataset.cbAlign;
        await this.app.render();
      });
    });
  }
}
