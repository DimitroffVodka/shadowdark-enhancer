import { MODULE_ID } from "../module-id.mjs";
import { SHOP_STOCK, slug } from "./steps/gear-step.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Item types that are never "gear" — they can't be bought/carried, so the
 *  picker hides them even though they live in Item packs. Lower-cased match. */
const NON_GEAR = new Set([
  "spell", "talent", "class", "ancestry", "background", "deity", "language",
  "effect", "property", "class ability", "patron", "boon",
  "npc feature", "npc attack", "npc special attack", "wand talent",
]);

/**
 * Extra Gear editor — a GM-only picker for granting the Character Builder's shop
 * items beyond its curated starting stock (SHOP_STOCK in gear-step.mjs). Items
 * are grouped into collapsible folders by source material (compendium pack /
 * world), with a source dropdown and a name filter. The checked UUIDs are stored
 * in the `charBuilderExtraGear` world setting; the shop merges them in (still
 * honouring the class weapon/armor filter). Opened from Configure Settings.
 */
export class ExtraGearEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-extra-gear-editor",
    tag: "form",
    classes: ["shadowdark", "sde-extra-gear-editor"],
    window: {
      title: "SDE.charBuilder.extraGear.title",
      icon: "fa-solid fa-toolbox",
      resizable: true,
    },
    position: { width: 560, height: 720 },
    form: { handler: ExtraGearEditor._onSubmit, closeOnSubmit: true },
    actions: {
      "ege-reset": ExtraGearEditor._onReset,
      "ege-cancel": ExtraGearEditor._onCancel,
    },
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/char-builder/gear-editor.hbs`,
      scrollable: [".sde-ege-list"],
    },
  };

  /** Currently-granted UUIDs from the setting. */
  _selected() {
    try { return game.settings.get(MODULE_ID, "charBuilderExtraGear") || []; }
    catch (_e) { return []; }
  }

  async _prepareContext() {
    const selected = new Set(this._selected());
    const folders = new Map();   // sourceId → { id, label, items[] }
    const seen = new Set();
    const add = (sourceId, sourceLabel, uuid, name, type, img) => {
      if (!uuid || !name || seen.has(uuid)) return;
      if (NON_GEAR.has(String(type || "").toLowerCase())) return;
      seen.add(uuid);
      if (!folders.has(sourceId)) folders.set(sourceId, { id: sourceId, label: sourceLabel, items: [] });
      // Default stock (SHOP_STOCK) is always in the builder shop; show it checked
      // and locked. Extra grants (in the setting) are checked and removable.
      const isDefault = SHOP_STOCK.has(slug(name));
      folders.get(sourceId).items.push({
        uuid, name, type: type || "Item",
        img: img || "icons/svg/item-bag.svg",
        isDefault, checked: isDefault || selected.has(uuid),
      });
    };

    for (const pack of game.packs) {
      if (pack.documentName !== "Item") continue;
      let index;
      try { index = await pack.getIndex({ fields: ["img", "type"] }); }
      catch (_e) { continue; }
      const label = pack.metadata?.label || pack.collection;
      for (const e of index) {
        add(pack.collection, label, e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, e.name, e.type, e.img);
      }
    }
    const worldLabel = game.i18n.localize("SDE.charBuilder.extraGear.world");
    for (const it of game.items) add("__world__", worldLabel, it.uuid, it.name, it.type, it.img);

    const folderList = [...folders.values()]
      .filter((f) => f.items.length)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((f) => {
        const items = f.items.sort((x, y) => x.name.localeCompare(y.name));
        // Auto-open only folders that hold an actual extra grant (not defaults),
        // else every folder opens (all contain default stock).
        return { id: f.id, label: f.label, count: items.length, items, hasChecked: items.some((i) => i.checked && !i.isDefault) };
      });
    const count = folderList.reduce((n, f) => n + f.items.filter((i) => i.checked && !i.isDefault).length, 0);
    const sources = folderList.map((f) => ({ id: f.id, label: f.label, count: f.count }));
    return { folders: folderList, sources, count, hasGroups: folderList.length > 0 };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const filter = this.element.querySelector(".sde-ege-filter");
    const source = this.element.querySelector(".sde-ege-source");
    if (filter) filter.addEventListener("input", () => this._applyFilter());
    if (source) source.addEventListener("change", () => this._applyFilter());
    this.element.querySelectorAll(".sde-gear-pick")
      .forEach((cb) => cb.addEventListener("change", () => this._updateCount()));
  }

  /** Combined name + source filter; hides emptied folders and auto-expands
   *  folders with matches while a query or source is active. */
  _applyFilter() {
    const q = (this.element.querySelector(".sde-ege-filter")?.value || "").trim().toLowerCase();
    const src = this.element.querySelector(".sde-ege-source")?.value || "";
    for (const folder of this.element.querySelectorAll(".sde-ege-folder")) {
      const sourceMatch = !src || folder.dataset.source === src;
      let anyVisible = false;
      for (const row of folder.querySelectorAll(".sde-ege-row")) {
        const match = sourceMatch && (!q || (row.dataset.name || "").toLowerCase().includes(q));
        row.hidden = !match;
        if (match) anyVisible = true;
      }
      folder.hidden = !anyVisible;
      if (anyVisible && (q || src)) folder.open = true;
    }
  }

  /** The count reflects only the GM's added extras — default stock is always on
   *  and locked, so it isn't part of what the GM is choosing. */
  _updateCount() {
    const n = this.element.querySelectorAll(".sde-gear-pick:checked:not([data-default])").length;
    const el = this.element.querySelector(".sde-ege-count");
    if (el) el.textContent = `${game.i18n.localize("SDE.charBuilder.extraGear.selected")}: ${n}`;
  }

  static _onCancel() { this.close(); }

  /** Reset to default: uncheck every extra grant, leaving only the locked default
   *  stock. Staged in the UI — the GM still clicks Save to commit. */
  static _onReset() {
    this.element.querySelectorAll(".sde-gear-pick:not([data-default])").forEach((cb) => { cb.checked = false; });
    this._updateCount();
  }

  /** Persist the checked EXTRA UUIDs (default stock is excluded — it's implicit).
   *  Only currently-listed (installed) items can be granted, so items whose pack
   *  is disabled drop out on save — by design. */
  static async _onSubmit(_event, form, _formData) {
    const uuids = [...form.querySelectorAll(".sde-gear-pick:checked:not([data-default])")].map((el) => el.dataset.uuid);
    await game.settings.set(MODULE_ID, "charBuilderExtraGear", uuids);
    ui.notifications.info(game.i18n.format("SDE.charBuilder.extraGear.saved", { n: uuids.length }));
  }
}
