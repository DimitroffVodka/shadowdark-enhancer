import { BaseStep } from "./base-step.mjs";
import { enrich, weightedRandom } from "../data.mjs";

/**
 * Base class for the "list / detail / aside" steps (Ancestry, Class, Background,
 * Deity, Gear…) that mirror the Vagabond builder's three-column layout:
 *   • left   — searchable list of options (thumbnail + name)
 *   • center — the selected option's detail card (banner + enriched description)
 *   • right  — a step-specific aside (traits, features, stats…)
 *
 * Subclasses provide `loadItems()`, `stateKey`, and optionally `asideContext()`
 * / `extraContext()`. Selection, search filtering, and weighted random are shared.
 */
export class ListStep extends BaseStep {
  constructor(app) {
    super(app);
    this._items = null;
    this._search = "";
  }

  /** Load the raw compendium docs for the list. Override. */
  async loadItems() { return []; }

  /** Builder-state key holding the selection ({ uuid, name, item }). Override. */
  get stateKey() { return null; }

  /** Optional weight property path for weighted random (e.g. "system.randomWeight"). */
  get weightPath() { return null; }

  get searchPlaceholder() { return game.i18n.localize("SDE.charBuilder.searchPlaceholder"); }

  async items() {
    if (!this._items) this._items = await this.loadItems();
    return this._items;
  }

  get selected() { return this.state[this.stateKey]; }
  isComplete() { return !!this.selected?.uuid; }
  supportsRandom() { return true; }

  async select(uuid) {
    const items = await this.items();
    const item = items.find((i) => i.uuid === uuid);
    if (!item) return;
    this.state[this.stateKey] = { uuid: item.uuid, name: item.name, item };
    await this._onSelect(item);
  }

  /** Hook after a selection is made. Override for side effects. */
  async _onSelect(_item) {}

  async randomize() {
    const items = await this.items();
    const pick = weightedRandom(items, this.weightPath);
    if (pick) await this.select(pick.uuid);
  }

  /** Optional local portrait URL for an item, overriding its system icon. Override. */
  portrait(_item) { return null; }

  /** Shared list / detail context; aside + extras come from subclasses. */
  async prepareContext() {
    const items = await this.items();
    const selUuid = this.selected?.uuid ?? null;
    const entries = items.map((i) => ({ id: i.uuid, name: i.name, img: this.portrait(i) ?? i.img, selected: i.uuid === selUuid }));
    const selItem = items.find((i) => i.uuid === selUuid) ?? null;

    const portrait = selItem ? this.portrait(selItem) : null;
    const detail = selItem
      ? { name: selItem.name, img: portrait ?? selItem.img, description: await enrich(selItem.system?.description), hasPortrait: !!portrait }
      : null;

    return {
      list: { entries, search: this._search, placeholder: this.searchPlaceholder },
      detail,
      aside: selItem ? await this.asideContext(selItem) : null,
      hasSelection: !!selItem,
      ...(await this.extraContext(selItem)),
    };
  }

  /** Right-column context for the selected item. Override. */
  async asideContext(_item) { return null; }

  /** Extra top-level context merged into the step context. Override. */
  async extraContext(_item) { return {}; }

  onRender(root) {
    // Selection
    root.querySelectorAll("[data-cb-select]").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        await this.select(ev.currentTarget.dataset.cbSelect);
        await this.app.render();
      });
    });

    // Pure-DOM search filter — no re-render, keeps the input focused.
    root.querySelector("[data-cb-search]")?.addEventListener("input", (ev) => {
      this._search = ev.target.value;
      const q = this._search.toLowerCase();
      root.querySelectorAll("[data-cb-select]").forEach((el) => {
        el.style.display = (el.dataset.name || "").toLowerCase().includes(q) ? "" : "none";
      });
    });

    this._onRenderExtra(root);
  }

  /** Wire subclass-specific DOM after each render. Override. */
  _onRenderExtra(_root) {}
}
