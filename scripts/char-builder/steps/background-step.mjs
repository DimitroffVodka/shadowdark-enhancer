import { ListStep } from "./list-step.mjs";
import { rollItemFromTables } from "../data.mjs";

/**
 * Step — Background. A simple list/detail pick (Shadowdark backgrounds are
 * flavour: name + description). Choose from the list or roll Random — Random
 * draws from the GM-configured background roll tables when any are set.
 */
export class BackgroundStep extends ListStep {
  get id() { return "background"; }
  get label() { return "SDE.charBuilder.step.background"; }
  get icon() { return "fa-solid fa-scroll"; }
  get partial() { return "sde-cb-background"; }
  get stateKey() { return "background"; }
  // Rendered inside the Origins tab: short list, generic shared icon.
  get showListImages() { return false; }
  get showListSearch() { return false; }

  async loadItems() {
    // Same-named backgrounds ship from several packs (e.g. the Western
    // Reaches "Skald" vs the Cursed Scroll one) — keep one per name,
    // preferring the system's copy, like the gear shop does.
    const byName = new Map();
    for (const d of Array.from(await shadowdark.compendiums.backgrounds())) {
      const key = d.name.toLowerCase();
      const prev = byName.get(key);
      if (!prev || (!prev.uuid.startsWith("Compendium.shadowdark.") && d.uuid.startsWith("Compendium.shadowdark."))) {
        byName.set(key, d);
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async randomize() {
    const pick = await rollItemFromTables("background", await this.items());
    if (pick) return this.select(pick.uuid);
    await super.randomize();
  }
}
