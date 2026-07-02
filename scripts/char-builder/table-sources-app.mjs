import { MODULE_ID } from "../module-id.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The table kinds the builder draws from, with their storage setting and the
 *  name pattern that shows the kind's checkbox by default. */
const KINDS = [
  { key: "name", setting: "charBuilderNameTables", re: /name/i, colKey: "SDE.charBuilder.tableSources.nameCol" },
  { key: "trinket", setting: "charBuilderTrinketTables", re: /trinket/i, colKey: "SDE.charBuilder.tableSources.trinketCol" },
  { key: "background", setting: "charBuilderBackgroundTables", re: /background/i, colKey: "SDE.charBuilder.tableSources.backgroundCol" },
  { key: "deity", setting: "charBuilderDeityTables", re: /deit/i, colKey: "SDE.charBuilder.tableSources.deityCol" },
];

/**
 * Settings menu — pick which installed RollTables the Character Builder draws
 * from: Names and Trinkets (Ancestry step) and Backgrounds and Deities
 * (Origins step's Random). Rows are grouped by pack (plus the world
 * directory); by default a kind's checkbox only shows on tables whose name
 * matches that kind, with a "show all tables" escape hatch. The builder never
 * shows a table picker — these settings are the only place sources are chosen.
 */
export class CharBuilderTableSourcesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-cb-table-sources",
    tag: "form",
    classes: ["shadowdark", "sde-cb-table-sources"],
    window: { title: "SDE.charBuilder.tableSources.title", icon: "fa-solid fa-table-list", resizable: true },
    position: { width: 660, height: 660 },
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
    this._pending = null;   // { [kind]: Set } once the user has touched checkboxes
  }

  /** Current selections — DOM state if the user has interacted, else settings. */
  _selections() {
    if (this._pending) return this._pending;
    const sel = {};
    for (const k of KINDS) sel[k.key] = new Set(game.settings.get(MODULE_ID, k.setting) || []);
    return sel;
  }

  /** Read the live checkbox state into _pending (survives re-renders). */
  _captureChecks() {
    const sel = {};
    for (const k of KINDS) sel[k.key] = new Set();
    const boxes = [...this.element.querySelectorAll("input[data-kind]")];
    for (const cb of boxes) if (cb.checked) sel[cb.dataset.kind].add(cb.dataset.uuid);
    // Off-screen rows (filtered out) keep their prior selection.
    const prev = this._selections();
    const visible = new Set(boxes.map((cb) => cb.dataset.uuid));
    for (const k of KINDS) {
      for (const u of prev[k.key]) if (!visible.has(u)) sel[k.key].add(u);
    }
    this._pending = sel;
  }

  async _prepareContext() {
    const sel = this._selections();
    const groups = [];

    const row = (uuid, name) => {
      const kinds = KINDS.map((k) => ({
        key: k.key,
        // In show-all mode every table offers every column (escape hatch).
        show: k.re.test(name) || this._showAll,
        checked: sel[k.key].has(uuid),
      }));
      return { uuid, name, kinds };
    };

    const push = (groupLabel, rows) => {
      const filtered = this._showAll ? rows : rows.filter((r) => r.kinds.some((c) => c.show));
      if (filtered.length) groups.push({ label: groupLabel, rows: filtered });
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

    return {
      groups,
      showAll: this._showAll,
      columns: KINDS.map((k) => game.i18n.localize(k.colKey)),
    };
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
    for (const k of KINDS) {
      await game.settings.set(MODULE_ID, k.setting, [...this._pending[k.key]]);
    }
    ui.notifications.info(game.i18n.localize("SDE.charBuilder.tableSources.saved"));
    await this.close();
  }
}
