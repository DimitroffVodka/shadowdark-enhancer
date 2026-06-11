/**
 * Shadowdark Enhancer — Importer Hub (ApplicationV2).
 *
 * A single three-tab window that is the front door for all import/management
 * work: Import (universal paste), Tables (the Phase-5 manifest dashboard),
 * and Monsters (census/gap/duplicates — populated in 10-03/10-04).
 *
 * Absorbs RollTablesApp's full Tables-tab behavior:
 *   - Status chips, source chips, free-text search, collapsible rows.
 *   - Per-row "Import" button now seeds the hub's Import tab (_importSeed
 *     field) and switches to it — the actual Import-tab rendering is wired
 *     in plan 10-03, which consumes _importSeed.
 *   - Migrate-to-compendium button (D-03: lives on Tables tab, unchanged).
 *   - Six auto-refresh hooks (create/update/delete × RollTable/TableResult).
 *
 * Export:
 *   ImporterHubApp  — the ApplicationV2 class
 *   ImporterHubAPI  — { open(tab, seed) } for entry-point wiring (Task 2)
 */
import { TableHub } from "./table-hub.mjs";
import { findById, formulaFromDie, isMatrix, columnManifestId } from "./table-manifest.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ImporterHubApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-importer-hub",
    window: { title: "Importer", icon: "fas fa-file-import", resizable: true },
    position: { width: 860, height: 780 },
    actions: {
      // Tab nav
      switchTab:        ImporterHubApp.prototype._onSwitchTab,
      // Tables-tab dashboard
      refresh:          ImporterHubApp.prototype._onRefresh,
      filter:           ImporterHubApp.prototype._onFilter,
      filterSource:     ImporterHubApp.prototype._onFilterSource,
      importMissing:    ImporterHubApp.prototype._onImportMissing,
      migrateCompendium: ImporterHubApp.prototype._onMigrateCompendium,
    },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/importer-hub.hbs" },
  };

  // ── Active tab ─────────────────────────────────────────────────────────────
  /** @type {"import"|"tables"|"monsters"} */
  _activeTab = "import";

  // ── Tables-tab dashboard state (absorbed from RollTablesApp) ──────────────
  /** @type {string|null} */
  _filter = null;       // status filter: null | "system" | "imported" | "partial" | "missing"
  /** @type {string|null} */
  _sourceFilter = null; // source facet id filter
  _search = "";
  _searchFocused = false;
  _searchCursor = 0;

  // ── Import-tab seed (consumed by plan 10-03) ───────────────────────────────
  /**
   * Seed object set by _onImportMissing (Tables tab per-row Import button).
   * Carries { name, die, page, formula, category, folderLabel, manifestId,
   *           matrix, columns, widths, grid }.
   * Plan 10-03 reads this field when rendering the Import tab to pre-fill the
   * paste UI with the manifest entry's identity.
   * @type {object|null}
   */
  _importSeed = null;

  // ── Hook / timer plumbing ─────────────────────────────────────────────────
  _hookIds = [];
  _refreshTimer = null;

  constructor(options = {}) {
    super(options);
    // Mirror RollTablesApp: auto-refresh on any RollTable or TableResult change.
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

  // ── Singleton lifecycle ────────────────────────────────────────────────────

  static _instance = null;

  /**
   * Open (or bring forward) the hub.
   * @param {"import"|"tables"|"monsters"} [tab="import"]
   * @param {object|null} [seed=null] - When provided, forces Import tab and
   *   stores the seed so 10-03's Import tab can pre-fill the paste box.
   */
  static open(tab = "import", seed = null) {
    if (!this._instance) this._instance = new ImporterHubApp();
    const inst = this._instance;
    if (seed) {
      inst._importSeed = seed;
      inst._activeTab = "import";
    } else {
      inst._activeTab = tab || "import";
    }
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }

  async close(options = {}) {
    clearTimeout(this._refreshTimer);
    for (const [ev, id] of this._hookIds) Hooks.off(ev, id);
    this._hookIds = [];
    ImporterHubApp._instance = null;
    return super.close(options);
  }

  // ── Context preparation ────────────────────────────────────────────────────

  async _prepareContext() {
    // ── Tables-tab data (absorbed from RollTablesApp._prepareContext) ────────
    const { groups, summary: globalSummary, sourceFacets } = await TableHub.buildRows();
    const stf = this._filter;
    const sf  = this._sourceFilter;
    const matches = sf ? (sourceFacets.find(f => f.id === sf)?.match ?? [sf]) : null;
    const inSrc = (r) => !matches || matches.includes(r.source);

    let summary = globalSummary;
    if (matches) {
      summary = { total: 0, system: 0, imported: 0, partial: 0, missing: 0 };
      for (const g of groups) for (const s of g.subgroups) for (const r of s.rows) {
        if (inSrc(r)) { summary.total++; summary[r.state]++; }
      }
    }

    const shown = groups
      .map(g => ({
        ...g,
        subgroups: g.subgroups
          .map(s => ({ ...s, rows: s.rows.filter(r => inSrc(r) && (!stf || r.state === stf)) }))
          .filter(s => s.rows.length),
      }))
      .filter(g => g.subgroups.length);

    return {
      // Tab flags
      activeTab:    this._activeTab,
      tabImport:    this._activeTab === "import",
      tabTables:    this._activeTab === "tables",
      tabMonsters:  this._activeTab === "monsters",
      // Tables-tab context
      search:   this._search,
      groups:   shown,
      summary,
      filter:   stf,
      fAll:     !stf,
      fSystem:  stf === "system",
      fImported: stf === "imported",
      fPartial:  stf === "partial",
      fMissing:  stf === "missing",
      sources: sourceFacets.map(f => ({
        id: f.id, label: f.label, count: f.count, active: sf === f.id,
      })),
      sourceAll: !sf,
    };
  }

  // ── Render wiring ─────────────────────────────────────────────────────────

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Tab nav: clicking a hub-tab button sets _activeTab and re-renders.
    for (const btn of this.element.querySelectorAll("[data-hubtab]")) {
      btn.addEventListener("click", (ev) => {
        this._activeTab = ev.currentTarget.dataset.hubtab;
        this.render();
      });
    }

    // ── Tables-tab dashboard wiring (absorbed from RollTablesApp._onRender) ─

    // Free-text search: client-side filter, no re-render on typing.
    const searchInput = this.element.querySelector("input[name='thubSearch']");
    if (searchInput) {
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
    this._applySearchFilter();

    // Double-click / Enter to open a RollTable.
    for (const li of this.element.querySelectorAll(".sde-thub-row[data-uuid]")) {
      const openTable = async () => {
        const doc = await fromUuid(li.dataset.uuid).catch(() => null);
        if (doc?.sheet) doc.sheet.render(true);
        else ui.notifications?.warn("Couldn't open that table — it may have been deleted.");
      };
      li.addEventListener("dblclick", async (ev) => {
        if (ev.target.closest("button")) return;
        await openTable();
      });
      li.setAttribute("tabindex", "0");
      li.addEventListener("keydown", async (ev) => {
        if (ev.key !== "Enter" || ev.target.closest("button")) return;
        await openTable();
      });
    }
  }

  /**
   * Show/hide rows (and empty sub-category/category sections) to match the
   * search box. Pure DOM — no re-render — so the input keeps focus and caret.
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

  // ── Tables-tab action handlers ─────────────────────────────────────────────

  async _onSwitchTab(event, target) {
    this._activeTab = target.dataset.hubtab;
    this.render();
  }

  async _onRefresh() { this.render(); }

  async _onFilter(event, target) {
    const s = target.dataset.state || null;
    this._filter = (s === "all" || this._filter === s) ? null : s;
    this.render();
  }

  async _onFilterSource(event, target) {
    const s = target.dataset.source || null;
    this._sourceFilter = (s === "all" || this._sourceFilter === s) ? null : s;
    this.render();
  }

  /**
   * Per-row "Import" button on the Tables tab.
   * Seeds _importSeed from the manifest entry (same payload as RollTablesApp),
   * then switches to the hub's Import tab so plan 10-03's paste UI picks it up.
   * The actual pre-fill rendering is wired in 10-03 — this wave just stores the
   * seed and switches tabs.
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
    this._activeTab = "import";
    this.render();
  }

  /**
   * Migrate world RollTables into the sde-tables compendium pack.
   * Dry-run preview → DialogV2 confirm → commit. (D-03: lives on Tables tab.)
   * Dynamic import keeps table-migration.mjs Foundry-free from the hub itself.
   */
  async _onMigrateCompendium() {
    if (!game.user?.isGM) return;

    const { migrateTables } = await import("./table-migration.mjs");

    const plan = await migrateTables({ dryRun: true });
    if (!plan) return;

    const bySourceLines = Object.entries(plan.bySource)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([src, n]) => `<li>${foundry.utils.escapeHTML(src || "(no source)")}: ${n}</li>`)
      .join("");
    const byCategoryLines = Object.entries(plan.byCategory)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, n]) => `<li>${foundry.utils.escapeHTML(cat || "(no category)")}: ${n}</li>`)
      .join("");

    const previewHtml = plan.total === 0
      ? `<p>No module-imported world tables found to migrate. All tables are either already in the compendium pack or are hand-made world tables.</p>`
      : `<p>Found <strong>${plan.total}</strong> module-imported world table(s) to migrate into <em>sde-tables</em>.</p>
         <p>Originals will be moved to <em>_Backup (pre-suite)</em> (never deleted).<br>
         Loot Setup bindings will be repointed to the new pack UUIDs.</p>
         ${bySourceLines ? `<p><strong>By source:</strong></p><ul>${bySourceLines}</ul>` : ""}
         ${byCategoryLines ? `<p><strong>By category:</strong></p><ul>${byCategoryLines}</ul>` : ""}`;

    if (plan.total === 0) {
      await foundry.applications.api.DialogV2.alert({
        window: { title: "Migrate to Compendium" },
        content: previewHtml,
      }).catch(() => {});
      return;
    }

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Migrate Tables to Compendium" },
      content: previewHtml,
      buttons: [
        { action: "migrate", label: "Migrate", default: true },
        { action: "cancel",  label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");

    if (!choice || choice === "cancel") return;

    let result;
    try {
      result = await migrateTables({ dryRun: false });
    } catch (err) {
      console.error("shadowdark-enhancer | table-migration: unexpected error:", err);
      ui.notifications?.error("Table migration failed — see the console for details.");
      return;
    }

    if (!result) return;

    const summary = [
      `${result.copied} table(s) copied to compendium`,
      `${result.backedUp} original(s) moved to _Backup`,
      result.bindingsRepointed ? `${result.bindingsRepointed} Loot Setup binding(s) repointed` : "",
      result.failures ? `${result.failures} failure(s) — see console` : "",
    ].filter(Boolean).join(" · ");

    ui.notifications?.info(`Migration complete: ${summary}.`);
    this.render();
  }
}

/**
 * Back-compat entry-point API for Task 2 / shadowdark-enhancer.mjs wiring.
 * tables.openHub(tab, seed) and monsters.openImporter() both route through here.
 */
export const ImporterHubAPI = {
  open: (tab, seed) => ImporterHubApp.open(tab, seed),
};
