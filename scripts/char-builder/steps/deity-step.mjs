import { ListStep } from "./list-step.mjs";
import { rollItemFromTables } from "../data.mjs";

/**
 * Step — Deity. List/detail pick, optional. The detail shows the deity's
 * alignment and flags a mismatch with the character's chosen alignment. Random
 * draws from the GM-configured deity roll tables when any are set, else
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

  /**
   * A class may mandate a deity (e.g. Green Knight → Gede). It declares the
   * deity's (system-pack, cross-world-stable) uuid on
   * `flags.shadowdark-enhancer.fixedDeity`; when present the choice is pinned.
   */
  _fixedDeityUuid() {
    return this.state.class?.item?.flags?.["shadowdark-enhancer"]?.fixedDeity || null;
  }

  /** Pinned deity always wins over any attempted selection. */
  async select(uuid) {
    const fixed = this._fixedDeityUuid();
    return super.select(fixed || uuid);
  }

  async prepareContext() {
    // Force the class-mandated deity before rendering, so the built character
    // always carries it even if the deity tab is never visited.
    const fixed = this._fixedDeityUuid();
    if (fixed && this.selected?.uuid !== fixed) await super.select(fixed);
    const ctx = await super.prepareContext();
    if (fixed) ctx.fixedDeity = this.selected?.name ?? null;
    return ctx;
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
    const fixed = this._fixedDeityUuid();
    if (fixed) return super.select(fixed);
    const items = await this.items();
    const rolled = await rollItemFromTables("deity", items);
    if (rolled) return this.select(rolled.uuid);
    const matching = items.filter((i) => !this.state.alignment || i.system.alignment === this.state.alignment);
    const pool = matching.length ? matching : items;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) await this.select(pick.uuid);
  }
}
