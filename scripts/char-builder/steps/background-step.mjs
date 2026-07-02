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
    return Array.from(await shadowdark.compendiums.backgrounds()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async randomize() {
    const pick = await rollItemFromTables("background", await this.items());
    if (pick) return this.select(pick.uuid);
    await super.randomize();
  }
}
