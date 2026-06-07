/**
 * Shadowdark Enhancer — Roll Tables hub window.
 *
 * The "Set up ALL tables" home for canonical Shadowdark tables. Two tabs:
 *   - Dashboard: every catalog table with its live status (shipped by the
 *     system, imported into this world with row-count verification, or missing),
 *     a search box, and status + source filter chips.
 *   - Import: paste a table copied from a book/zine, review the parsed preview,
 *     and create it. (Moved here from the Encounter Roller — the per-row Import
 *     button on the Dashboard now seeds this tab in-window.)
 *
 * Imports auto-link to the compendium (encounter → monster @UUID links;
 * treasure → real items) via TableImporter.createTable — no manual button.
 * GM tool, opened from the crawl bar's Roll Tables button or `tables.openHub()`.
 */
import { TableHub } from "./table-hub.mjs";
import { TableImporter } from "./table-importer.mjs";
import { LootLinker } from "./loot-linker.mjs";
import { CATEGORIES, CUSTOM_ID } from "./table-categories.mjs";
import { findById, formulaFromDie, isMatrix, columnManifestId } from "./table-manifest.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RollTablesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-roll-tables",
    window: { title: "Roll Tables", icon: "fas fa-table-list", resizable: true },
    position: { width: 820, height: 720 },
    actions: {
      refresh:          RollTablesApp.prototype._onRefresh,
      filter:           RollTablesApp.prototype._onFilter,
      filterSource:     RollTablesApp.prototype._onFilterSource,
      importMissing:    RollTablesApp.prototype._onImportMissing,
      // Import tab
      importParse:      RollTablesApp.prototype._onImportParse,
      importClear:      RollTablesApp.prototype._onImportClear,
      importCreate:     RollTablesApp.prototype._onImportCreate,
      importCreateAll:  RollTablesApp.prototype._onImportCreateAll,
      importAddRow:     RollTablesApp.prototype._onImportAddRow,
      importDeleteRow:  RollTablesApp.prototype._onImportDeleteRow,
      importUnlinkRow:  RollTablesApp.prototype._onImportUnlinkRow,
    },
  };

  static PARTS = { body: { template: "modules/shadowdark-enhancer/templates/table-hub.hbs" } };

  _tab = "dashboard";   // "dashboard" | "import"
  _filter = null;       // active status filter: null | "system" | "imported" | "partial" | "missing"
  _sourceFilter = null; // active source filter: null | facet id ("core" | "cs1".. | "wr")
  _search = "";         // dashboard free-text search
  _searchFocused = false;
  _searchCursor = 0;

  // Import tab state (ported from the Encounter Roller).
  _importText = "";
  _importParsed = [];
  _importSeed = null;   // pre-fill from a Dashboard "Import" click
  _importTextFocused = false;
  _importTextCursor = 0;

  _hookIds = [];        // world-table hooks for auto-refresh
  _refreshTimer = null; // debounce timer that coalesces hook bursts

  constructor(options = {}) {
    super(options);
    // Auto-refresh on any change to the world's roll tables OR their rows, so
    // the dashboard status + the `N/expected rows` verify chips stay live.
    // Verified via MCP (Foundry 14.363 / SD 4.0.6): table create/rename/flag/
    // delete fire create/update/deleteRollTable, but adding/editing/removing a
    // ROW fires ONLY the *TableResult hooks — so we listen to those too. All
    // six are coalesced through one debounced render so an import or an
    // enrichment batch-update doesn't trigger a render storm.
    const events = [
      "createRollTable", "updateRollTable", "deleteRollTable",
      "createTableResult", "updateTableResult", "deleteTableResult",
    ];
    for (const ev of events) {
      this._hookIds.push([ev, Hooks.on(ev, () => this._scheduleRefresh())]);
    }
  }

  /** Coalesce rapid table/result changes into a single re-render. */
  _scheduleRefresh() {
    if (!this.rendered) return;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => { if (this.rendered) this.render(); }, 120);
  }

  static _instance = null;
  static open(tab = "dashboard", seed = null) {
    if (!this._instance) this._instance = new RollTablesApp();
    const inst = this._instance;
    inst._tab = tab;
    if (seed) { inst._importSeed = seed; inst._importParsed = []; inst._importText = ""; inst._tab = "import"; }
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }
  async close(options = {}) {
    clearTimeout(this._refreshTimer);
    for (const [ev, id] of this._hookIds) Hooks.off(ev, id);
    this._hookIds = [];
    RollTablesApp._instance = null;
    return super.close(options);
  }

  async _prepareContext() {
    const { groups, summary: globalSummary, sourceFacets } = await TableHub.buildRows();
    const stf = this._filter;       // status filter
    const sf = this._sourceFilter;  // source filter (facet id)
    const matches = sf ? (sourceFacets.find(f => f.id === sf)?.match ?? [sf]) : null;
    const inSrc = (r) => !matches || matches.includes(r.source);

    // Status counts scoped to the active source filter (so the chips stay
    // honest). Free-text search is applied CLIENT-SIDE (see _applySearchFilter)
    // so typing never re-renders — that's what keeps the caret stable.
    let summary = globalSummary;
    if (matches) {
      summary = { total: 0, system: 0, imported: 0, partial: 0, missing: 0 };
      for (const g of groups) for (const s of g.subgroups) for (const r of s.rows) {
        if (inSrc(r)) { summary.total++; summary[r.state]++; }
      }
    }

    // Display: keep rows matching source + status filters. Search hides the
    // rest in the DOM afterward.
    const shown = groups
      .map(g => ({
        ...g,
        subgroups: g.subgroups
          .map(s => ({ ...s, rows: s.rows.filter(r => inSrc(r) && (!stf || r.state === stf)) }))
          .filter(s => s.rows.length),
      }))
      .filter(g => g.subgroups.length);

    return {
      tab: this._tab,
      tabDashboard: this._tab !== "import",
      tabImport: this._tab === "import",
      search: this._search,
      groups: shown, summary, filter: stf,
      fAll: !stf, fSystem: stf === "system", fImported: stf === "imported",
      fPartial: stf === "partial", fMissing: stf === "missing",
      sources: sourceFacets.map(f => ({ id: f.id, label: f.label, count: f.count, active: sf === f.id })),
      sourceAll: !sf,
      importData: {
        text: this._importText,
        parsed: this._importParsed,
        seed: this._importSeed,
        categoryOptions: [
          ...CATEGORIES.map(c => ({ id: c.id, label: c.label })),
          { id: CUSTOM_ID, label: "Custom…" },
        ],
      },
    };
  }

  /** Toggle the status filter from a summary chip. */
  async _onFilter(event, target) {
    const s = target.dataset.state || null;
    this._filter = (s === "all" || this._filter === s) ? null : s;
    this.render();
  }

  /** Toggle the source-book filter from a source chip. */
  async _onFilterSource(event, target) {
    const s = target.dataset.source || null;
    this._sourceFilter = (s === "all" || this._sourceFilter === s) ? null : s;
    this.render();
  }

  /**
   * Show/hide rows (and empty sub-category / category sections) to match the
   * search box. Pure DOM — no re-render — so the input keeps focus and caret.
   * Each row carries a precomputed lowercase `data-search` haystack.
   */
  _applySearchFilter() {
    const root = this.element;
    if (!root) return;
    const q = (this._search || "").trim().toLowerCase();
    for (const row of root.querySelectorAll(".sde-thub-row")) {
      row.hidden = !!q && !(row.dataset.search || "").includes(q);
    }
    for (const sub of root.querySelectorAll(".sde-thub-sub")) {
      const rows = sub.querySelectorAll(".sde-thub-row");
      sub.hidden = rows.length > 0 && ![...rows].some(r => !r.hidden);
    }
    for (const cat of root.querySelectorAll(".sde-thub-cat")) {
      const subs = cat.querySelectorAll(".sde-thub-sub");
      cat.hidden = subs.length > 0 && ![...subs].some(s => !s.hidden);
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Tab switching (Dashboard | Import).
    for (const btn of this.element.querySelectorAll(".sde-thub-tabs .item")) {
      btn.addEventListener("click", (ev) => {
        this._tab = ev.currentTarget.dataset.thtab;
        this.render();
      });
    }

    // Dashboard search box. CLIENT-SIDE filter: typing hides non-matching rows
    // directly (no re-render), so ApplicationV2 never rebuilds the input and the
    // caret stays put — fixes the "type Treasure, get urereasT" scramble caused
    // by re-rendering on every keystroke.
    const searchInput = this.element.querySelector("input[name='thubSearch']");
    if (searchInput) {
      // Restore focus + caret only when a non-typing render lost it (filter/tab
      // click, auto-refresh). Typing no longer triggers a render, so this can't
      // fight the user mid-word.
      if (this._searchFocused) {
        searchInput.focus();
        const pos = this._searchCursor ?? searchInput.value.length;
        try { searchInput.setSelectionRange(pos, pos); } catch (_) {}
      }
      searchInput.addEventListener("input", (ev) => {
        this._search = ev.target.value;
        this._searchFocused = true;
        this._searchCursor = ev.target.selectionStart;
        this._applySearchFilter();
      });
      searchInput.addEventListener("blur", () => { this._searchFocused = false; });
    }
    // Apply the current search to the freshly rendered rows (covers renders from
    // filters / tabs / auto-refresh — not from typing).
    this._applySearchFilter();

    // Double-click a row to open its RollTable (to roll or review). Rows carry
    // data-uuid only when there's a table to open (system or imported).
    for (const li of this.element.querySelectorAll(".sde-thub-row[data-uuid]")) {
      li.addEventListener("dblclick", async (ev) => {
        if (ev.target.closest("button")) return; // let action buttons win
        const doc = await fromUuid(li.dataset.uuid).catch(() => null);
        if (doc?.sheet) doc.sheet.render(true);
        else ui.notifications?.warn("Couldn't open that table — it may have been deleted.");
      });
    }

    // ═══ Import tab wiring ════════════════════════════════════════════════

    // Paste box: debounced stash + cursor preservation. Parsing is explicit
    // (Parse button), so we only stash the text on input — no re-render.
    const importText = this.element.querySelector("textarea[data-import-text]");
    if (importText) {
      if (this._importTextFocused) {
        importText.focus();
        const pos = this._importTextCursor ?? importText.value.length;
        try { importText.setSelectionRange(pos, pos); } catch (_) {}
      }
      let importTimeout = null;
      importText.addEventListener("input", (ev) => {
        this._importTextFocused = true;
        this._importTextCursor = ev.target.selectionStart;
        clearTimeout(importTimeout);
        importTimeout = setTimeout(() => { this._importText = ev.target.value; }, 200);
      });
      importText.addEventListener("blur", () => {
        this._importTextFocused = false;
        this._importText = importText.value;
      });
    }

    // Preview-grid field edits. Commit on `change` so typing doesn't re-render
    // mid-edit. data-import-field identifies the field; table/row indices come
    // from the enclosing [data-table-idx]/[data-row-idx].
    this.element.querySelectorAll(".sde-import-table [data-import-field]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const tIdx = Number(ev.target.closest("[data-table-idx]")?.dataset.tableIdx);
        const tbl = this._importParsed[tIdx];
        if (!tbl) return;
        const field = ev.target.dataset.importField;
        const rowEl = ev.target.closest("[data-row-idx]");
        if (rowEl) {
          const rIdx = Number(rowEl.dataset.rowIdx);
          const row = tbl.rows[rIdx];
          if (!row) return;
          if (field === "min" || field === "max") row[field] = Number(ev.target.value);
          else if (field === "text") row.text = ev.target.value;
        } else {
          if (field === "name") tbl.name = ev.target.value;
          else if (field === "formula") tbl.formula = ev.target.value;
          else if (field === "replacement") tbl.replacement = ev.target.checked;
          else if (field === "category") tbl.category = ev.target.value;
          else if (field === "customLabel") tbl.customLabel = ev.target.value;
        }
        this.render();
      });
    });
  }

  async _onRefresh() { this.render(); }

  /**
   * Seed the in-window Import tab for a missing (or row-count-mismatched)
   * table: its name, formula, folder, and manifestId are pre-filled so the GM
   * only has to paste the rows. (Replaces the old cross-window bridge.)
   */
  async _onImportMissing(event, target) {
    if (!game.user.isGM) return;
    const entry = findById(target?.dataset?.id);
    if (!entry) return;
    this._importSeed = {
      name: entry.name,
      die: entry.die,
      page: entry.page,
      formula: formulaFromDie(entry.die),
      category: entry.category || null,
      folderLabel: entry.sub || entry.category || null,
      manifestId: entry.id,
      matrix: isMatrix(entry),
      columns: entry.columns ?? null,
      widths: entry.widths ?? null,
      grid: !!entry.grid,
    };
    this._importParsed = [];
    this._importText = "";
    this._tab = "import";
    this.render();
  }

  // ═══ Import tab handlers (ported from the Encounter Roller) ══════════════

  async _onImportParse() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;
    this._importParsed = TableImporter.parse(this._importText);
    this._applyImportSeed();
    await this._linkLootTables();
    if (!this._importParsed.length) {
      ui.notifications.warn("No tables found in the pasted text.");
    }
    this.render();
  }

  /**
   * When seeded from a Dashboard "Import" click, force the first parsed table's
   * identity to the manifest's — name/formula/folder + manifestId — so it lands
   * correctly and the Dashboard matches it EXACTLY after Create. Matrix and grid
   * entries re-split the paste by their known columns/widths.
   */
  _applyImportSeed() {
    const seed = this._importSeed;
    if (!seed || !this._importParsed?.length) return;
    const folderPath = [seed.category, seed.folderLabel].filter(Boolean);

    if (seed.grid && Array.isArray(seed.columns) && seed.columns.length) {
      const split = TableImporter.parseMatrixByColumns(this._importText, seed.columns, seed.widths);
      const nRows = Math.max(0, ...split.map(c => c.rows.length));
      const rows = [];
      let n = 1;
      for (let r = 0; r < nRows; r++) {
        for (const c of split) {
          const cell = c.rows[r];
          if (cell) { rows.push({ min: n, max: n, text: cell.text }); n++; }
        }
      }
      if (rows.length) {
        const merged = {
          name: seed.name, formula: `1d${rows.length}`, replacement: true,
          bestEffort: true, warnings: split[0]?.warnings ?? [], rows, manifestId: seed.manifestId ?? null,
        };
        if (folderPath.length) merged.folderPath = folderPath;
        else { merged.category = CUSTOM_ID; merged.customLabel = seed.folderLabel; }
        this._importParsed = [merged];
      }
      return;
    }

    if (seed.matrix && Array.isArray(seed.columns) && seed.columns.length) {
      const split = TableImporter.parseMatrixByColumns(this._importText, seed.columns, seed.widths);
      split.forEach((t, i) => {
        t.name = `${seed.name} - ${seed.columns[i]}`;
        if (seed.folderLabel) { t.category = CUSTOM_ID; t.customLabel = seed.folderLabel; }
        if (folderPath.length) t.folderPath = folderPath;
        t.manifestId = columnManifestId(seed.manifestId, seed.columns[i]);
      });
      this._importParsed = split;
      return;
    }

    const t0 = this._importParsed[0];
    if (seed.name) t0.name = seed.name;
    if (seed.formula) t0.formula = seed.formula;
    if (seed.folderLabel) { t0.category = CUSTOM_ID; t0.customLabel = seed.folderLabel; }
    if (folderPath.length) t0.folderPath = folderPath;
    t0.manifestId = seed.manifestId ?? null;
  }

  /** Link each Loot row's text to a compendium Item where a confident match exists. */
  async _linkLootTables() {
    const lootTables = this._importParsed.filter(t => t.category === "loot");
    if (!lootTables.length) return;
    const items = await LootLinker.buildItemIndex();
    for (const tbl of lootTables) {
      for (const row of tbl.rows) {
        row.link = LootLinker.findLink(row.text, items);
      }
    }
  }

  _onImportClear() {
    this._importText = "";
    this._importParsed = [];
    this._importSeed = null;
    this.render();
  }

  _onImportAddRow(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const tbl = this._importParsed[tIdx];
    if (!tbl) return;
    const nextMin = tbl.rows.reduce((m, r) => Math.max(m, r.max), 0) + 1;
    tbl.rows.push({ min: nextMin, max: nextMin, text: "" });
    this.render();
  }

  _onImportDeleteRow(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const rIdx = Number(target.closest("[data-row-idx]")?.dataset.rowIdx);
    const tbl = this._importParsed[tIdx];
    if (!tbl || !Number.isFinite(rIdx)) return;
    tbl.rows.splice(rIdx, 1);
    this.render();
  }

  _onImportUnlinkRow(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const rIdx = Number(target.closest("[data-row-idx]")?.dataset.rowIdx);
    const tbl = this._importParsed[tIdx];
    if (!tbl || !Number.isFinite(rIdx) || !tbl.rows[rIdx]) return;
    tbl.rows[rIdx].link = null;
    this.render();
  }

  async _onImportCreate(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const tbl = this._importParsed[tIdx];
    if (!tbl) return;
    await this._createImportedTable(tbl);
  }

  async _onImportCreateAll() {
    if (!this._importParsed.length) return;
    const total = this._importParsed.length;
    let created = 0;
    for (const tbl of [...this._importParsed]) {
      const made = await this._createImportedTable(tbl, { silent: true });
      if (made) created++;
    }
    ui.notifications.info(`Created ${created} of ${total} table(s).`);
    this.render();
  }

  /**
   * Create one parsed table as a world RollTable, resolving name clashes via a
   * 3-button dialog. createTable auto-links encounter/treasure tables to the
   * compendium. On success removes it from the preview list. When the preview
   * empties, hop back to the Dashboard so the GM sees the updated status.
   */
  async _createImportedTable(tbl, { silent = false } = {}) {
    const onConflict = async (name) => {
      const safe = foundry.utils.escapeHTML(name);
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Table Already Exists" },
        content: `<p>A table named <strong>${safe}</strong> already exists. What would you like to do?</p>`,
        buttons: [
          { action: "rename",  label: "Create as Copy", default: true },
          { action: "replace", label: "Replace Existing" },
          { action: "cancel",  label: "Cancel" },
        ],
        rejectClose: false,
      }).catch(() => "cancel");
      return choice ?? "cancel";
    };

    const table = await TableImporter.createTable(tbl, { onConflict });
    if (!table) return false;

    if (!silent) ui.notifications.info(`Created Roll Table: ${table.name}`);
    this._importParsed = this._importParsed.filter(t => t !== tbl);
    if (tbl.manifestId) this._importSeed = null; // seeded import fulfilled
    // Once the preview is empty, return to the Dashboard to show the new status.
    if (!this._importParsed.length) this._tab = "dashboard";
    if (!silent) this.render();
    return true;
  }
}
