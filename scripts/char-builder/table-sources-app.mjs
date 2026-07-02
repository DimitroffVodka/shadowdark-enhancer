import { MODULE_ID } from "../module-id.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Settings menu — pick which installed RollTables the Character Builder offers
 * as Name and Trinket sources on the Ancestry step. Rows are grouped by pack
 * (plus the world directory); by default only tables whose name mentions
 * "name" / "trinket" show the matching checkbox column, with a "show all
 * tables" escape hatch. Selections persist as two UUID arrays
 * (charBuilderNameTables / charBuilderTrinketTables).
 */
export class CharBuilderTableSourcesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-cb-table-sources",
    tag: "form",
    classes: ["shadowdark", "sde-cb-table-sources"],
    window: { title: "SDE.charBuilder.tableSources.title", icon: "fa-solid fa-table-list", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      save: CharBuilderTableSourcesApp.prototype._onSave,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/char-builder/table-sources.hbs` },
  };

  constructor(options = {}) {
    super(options);
    this._showAll = false;
    this._pending = null;   // { name: Set, trinket: Set } once the user has touched checkboxes
  }

  /** Current selections — DOM state if the user has interacted, else settings. */
  _selections() {
    if (this._pending) return this._pending;
    return {
      name: new Set(game.settings.get(MODULE_ID, "charBuilderNameTables") || []),
      trinket: new Set(game.settings.get(MODULE_ID, "charBuilderTrinketTables") || []),
    };
  }

  /** Read the live checkbox state into _pending (survives re-renders). */
  _captureChecks() {
    const sel = { name: new Set(), trinket: new Set() };
    this.element.querySelectorAll("input[data-kind]").forEach((cb) => {
      if (cb.checked) sel[cb.dataset.kind].add(cb.dataset.uuid);
    });
    // Off-screen rows (filtered out) keep their prior selection.
    const prev = this._selections();
    const visible = new Set([...this.element.querySelectorAll("input[data-kind]")].map((cb) => cb.dataset.uuid));
    for (const kind of ["name", "trinket"]) {
      for (const u of prev[kind]) if (!visible.has(u)) sel[kind].add(u);
    }
    this._pending = sel;
  }

  async _prepareContext() {
    const sel = this._selections();
    const groups = [];

    const push = (groupLabel, rows) => {
      const filtered = this._showAll ? rows : rows.filter((r) => r.isName || r.isTrinket);
      if (filtered.length) groups.push({ label: groupLabel, rows: filtered });
    };

    const row = (uuid, name) => {
      const isName = /name/i.test(name);
      const isTrinket = /trinket/i.test(name);
      return {
        uuid, name, isName, isTrinket,
        // In show-all mode every table offers both columns (escape hatch).
        showNameCheck: isName || this._showAll,
        showTrinketCheck: isTrinket || this._showAll,
        checkedName: sel.name.has(uuid),
        checkedTrinket: sel.trinket.has(uuid),
      };
    };

    push(
      game.i18n.localize("SDE.charBuilder.tableSources.world"),
      game.tables.contents.map((t) => row(t.uuid, t.name)).sort((a, b) => a.name.localeCompare(b.name)),
    );
    const seenTitles = new Set(groups.map((g) => g.label));
    for (const pack of game.packs.filter((p) => p.documentName === "RollTable")) {
      // Same-titled packs (e.g. two "Rollable Tables") get their collection id appended.
      let title = pack.title ?? pack.collection;
      if (seenTitles.has(title)) title = `${title} (${pack.collection})`;
      seenTitles.add(title);
      const idx = await pack.getIndex();
      push(
        title,
        Array.from(idx).map((e) => row(`Compendium.${pack.collection}.RollTable.${e._id}`, e.name))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }

    return { groups, showAll: this._showAll };
  }

  _onRender() {
    this.element.querySelector("[data-show-all]")?.addEventListener("change", async (ev) => {
      this._captureChecks();
      this._showAll = ev.target.checked;
      await this.render();
    });
  }

  async _onSave() {
    this._captureChecks();
    await game.settings.set(MODULE_ID, "charBuilderNameTables", [...this._pending.name]);
    await game.settings.set(MODULE_ID, "charBuilderTrinketTables", [...this._pending.trinket]);
    ui.notifications.info(game.i18n.localize("SDE.charBuilder.tableSources.saved"));
    await this.close();
  }
}
