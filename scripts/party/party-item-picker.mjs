import { searchItemIndex } from "./party-sheet-core.mjs";

const { ApplicationV2 } = foundry.applications.api;
const t = (key) => game.i18n.localize(key);

/**
 * A small window that searches every Item compendium by name and hands the picked entry to `onPick`.
 * The index is read once, when the window opens; a search filters it as you type (no re-render, so the
 * field keeps focus).
 */
export class PartyItemPicker extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sde-party-item-picker", classes: ["sde-ui", "sde-item-picker"],
    window: { title: "SDE.party.item.pickerTitle", icon: "fa-solid fa-book", resizable: true },
    position: { width: 420, height: 520 },
  };

  /** @param {{ onPick: (entry: { uuid: string, name: string }) => unknown }} options */
  static open({ onPick }) {
    const app = new PartyItemPicker({ onPick });
    void app.render(true);
    return app;
  }

  constructor({ onPick, ...options } = {}) {
    super(options);
    this.onPick = onPick;
    this.entries = null;
  }

  /** Every Item in every Item compendium the user can see: { uuid, name, img, pack }. */
  async _loadIndex() {
    const entries = [];
    for (const pack of game.packs.filter((p) => p.documentName === "Item")) {
      try {
        const index = await pack.getIndex({ fields: ["img"] });
        for (const entry of index) entries.push({ uuid: entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`, name: entry.name, img: entry.img, pack: pack.title });
      } catch (error) { console.debug(`shadowdark-enhancer | Item picker index ${pack.collection}`, error); }
    }
    return entries;
  }

  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "sde-item-picker-body";
    root.innerHTML = `<div class="ui-search"><i class="fas fa-search"></i><input type="search" data-picker-query autocomplete="off" aria-label="${t("SDE.party.item.pickerSearch")}" placeholder="${t("SDE.party.item.pickerSearch")}"></div><ol class="ui-list sde-item-picker-list" data-picker-list></ol><p class="ui-muted" data-picker-note>${t("SDE.party.item.pickerLoading")}</p>`;
    return root;
  }

  _replaceHTML(result, content) { content.replaceChildren(result); }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element.querySelector(".sde-item-picker-body");
    const input = root.querySelector("[data-picker-query]"), list = root.querySelector("[data-picker-list]"), note = root.querySelector("[data-picker-note]");
    const show = () => {
      if (!this.entries) return;
      const found = searchItemIndex(this.entries, input.value);
      list.replaceChildren(...found.map((entry) => {
        const row = document.createElement("li");
        row.className = "ui-row";
        const img = document.createElement("img"); img.src = entry.img ?? "icons/svg/item-bag.svg"; img.alt = "";
        const main = document.createElement("div"); main.className = "ui-row-main";
        const name = document.createElement("span"); name.className = "ui-row-name"; name.textContent = entry.name;
        const sub = document.createElement("span"); sub.className = "ui-row-sub"; sub.textContent = entry.pack;
        main.append(name, sub);
        const add = document.createElement("button"); add.type = "button"; add.className = "ui-btn"; add.textContent = t("SDE.party.item.add");
        add.addEventListener("click", async () => { add.disabled = true; try { await this.onPick?.(entry); } finally { add.disabled = false; } });
        row.append(img, main, add);
        return row;
      }));
      note.textContent = input.value.trim() ? (found.length ? "" : t("SDE.party.item.pickerNone")) : t("SDE.party.item.pickerHint");
    };
    input.addEventListener("input", show);
    input.focus();
    if (!this.entries) { this.entries = await this._loadIndex(); }
    note.textContent = t("SDE.party.item.pickerHint");
    show();
  }
}
