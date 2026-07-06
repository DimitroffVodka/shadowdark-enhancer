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

  /** Show per-row thumbnails in the list. Override false when every row shares
   *  one generic icon (e.g. Backgrounds, Deities) — they only add noise. */
  get showListImages() { return true; }

  /** Show the search box above the list. Override false for short lists. */
  get showListSearch() { return true; }

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

  /** Manifest item types whose locked (not-yet-imported) entries show in this
   *  list for the GM — e.g. ["Class"]. Null = no locked rows. Override. */
  get lockedTypes() { return null; }

  /** GM-only: manifest entries of the given types missing from this world. */
  async _lockedEntries(types) {
    if (!game.user?.isGM || !types?.length) return [];
    if (!this.app._lockedCensus) {
      const { gatherCharContentCensus } = await import("../../encounter/char-content-manifest.mjs");
      this.app._lockedCensus = await gatherCharContentCensus().catch((err) => {
        console.error("shadowdark-enhancer | locked census failed:", err);
        return [];
      });
    }
    const out = [];
    for (const row of this.app._lockedCensus) {
      for (const m of row.missingNames) {
        if (types.includes(m.type)) out.push({ name: m.name, type: m.type, src: row.source, book: row.book, pages: m.pages ?? "" });
      }
    }
    return out;
  }

  /** Locked entries shaped as list rows (🔒 name; click routes to the importer). */
  async _lockedListEntries(types) {
    const locked = await this._lockedEntries(types);
    return locked.map((l) => ({
      id: `locked::${l.src}::${l.type}::${l.name}`,
      name: `🔒 ${l.name}`,
      img: "icons/svg/padlock.svg",
      selected: false,
    }));
  }

  /** A locked row was clicked: open the Importer seeded for this entry. */
  async _unlockViaImporter(id) {
    if (!game.user?.isGM) return;
    const [, src, type, ...rest] = id.split("::");
    const name = rest.join("::");
    const pages = (this.app._lockedCensus ?? [])
      .find((r) => r.source === src)?.missingNames.find((m) => m.name === name)?.pages ?? "";
    const { ImporterHubApp } = await import("../../encounter/importer-hub-app.mjs");
    const inst = ImporterHubApp.open();
    inst._onCharSeedPaste(null, { dataset: { name, type, src, pages } });
    const { CHAR_SOURCES } = await import("../../encounter/char-content-manifest.mjs");
    ui.notifications.info(`Unlock "${name}": paste its section from ${CHAR_SOURCES[src]?.book ?? src} into the Importer and Parse.`);
    // Force fresh lists once the import lands and the builder re-renders.
    this._items = null;
    this.app._lockedCensus = null;
  }

  /** Optional local portrait URL for an item, overriding its system icon. Override. */
  portrait(_item) { return null; }

  /** Whether list thumbnails use the portrait too (vs only the detail view). */
  get showPortraitInList() { return true; }

  /** Shared list / detail context; aside + extras come from subclasses. */
  async prepareContext() {
    const items = await this.items();
    const selUuid = this.selected?.uuid ?? null;
    const entries = items.map((i) => ({
      id: i.uuid,
      name: i.name,
      img: (this.showPortraitInList ? this.portrait(i) : null) ?? i.img,
      selected: i.uuid === selUuid,
    }));
    if (this.lockedTypes) entries.push(...await this._lockedListEntries(this.lockedTypes));
    const selItem = items.find((i) => i.uuid === selUuid) ?? null;

    const portrait = selItem ? this.portrait(selItem) : null;
    const detail = selItem
      ? { name: selItem.name, img: portrait ?? selItem.img, description: await enrich(selItem.system?.description), hasPortrait: !!portrait }
      : null;

    return {
      list: {
        entries,
        search: this._search,
        placeholder: this.searchPlaceholder,
        noThumbs: !this.showListImages,
        noSearch: !this.showListSearch,
      },
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
        const id = ev.currentTarget.dataset.cbSelect;
        if (id?.startsWith("locked::")) { await this._unlockViaImporter(id); return; }
        await this.select(id);
        await this.app.render();
      });
    });

    // Inline unlock buttons (e.g. ancestry Names/Trinkets chips).
    root.querySelectorAll("[data-cb-unlock]").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await this._unlockViaImporter(ev.currentTarget.dataset.cbUnlock);
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
