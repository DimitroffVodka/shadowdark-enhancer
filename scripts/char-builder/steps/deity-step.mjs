import { ListStep } from "./list-step.mjs";

/**
 * Step — Deity. List/detail/aside pick, optional. The aside shows the deity's
 * alignment and flags a mismatch with the character's chosen alignment. Random
 * prefers a deity matching the character's alignment.
 */
export class DeityStep extends ListStep {
  get id() { return "deity"; }
  get label() { return "SDE.charBuilder.step.deity"; }
  get icon() { return "fa-solid fa-place-of-worship"; }
  get partial() { return "sde-cb-deity"; }
  get stateKey() { return "deity"; }
  // Rendered inside the Origins tab: short list, generic shared icon.
  get showListImages() { return false; }
  get showListSearch() { return false; }

  /** Deity is optional — never blocks Finish. */
  isComplete() { return true; }

  async loadItems() {
    return Array.from(await shadowdark.compendiums.deities()).sort((a, b) => a.name.localeCompare(b.name));
  }

  // CONFIG.SHADOWDARK.ALIGNMENTS holds raw i18n keys — localize before display.
  _alignLabel(a) { return a ? game.i18n.localize(CONFIG.SHADOWDARK?.ALIGNMENTS?.[a] ?? a) : "—"; }

  async asideContext(item) {
    return {
      alignment: this._alignLabel(item.system.alignment),
      matchesChar: !item.system.alignment || item.system.alignment === this.state.alignment,
    };
  }

  async extraContext() {
    return { charAlignment: this._alignLabel(this.state.alignment) };
  }

  async randomize() {
    const items = await this.items();
    const matching = items.filter((i) => !this.state.alignment || i.system.alignment === this.state.alignment);
    const pool = matching.length ? matching : items;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) await this.select(pick.uuid);
  }
}
