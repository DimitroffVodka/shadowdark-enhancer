/**
 * Shadowdark Enhancer — Roll Tables hub window.
 *
 * The "Set up ALL tables" dashboard: shows every canonical Shadowdark table
 * (Core + Cursed Scroll) with its live status — shipped by the system, already
 * imported into this world (row-count verified), or still missing. GM tool,
 * opened from the crawl bar's Roll Tables button or `tables.openHub()`.
 *
 * (Import-tab move + export bundle land in following milestones; for now the
 * per-row Import button bridges to the existing Importer.)
 */
import { TableHub } from "./table-hub.mjs";
import { TableEnricher } from "./table-enrich.mjs";
import { findById, formulaFromDie, isMatrix } from "./table-manifest.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RollTablesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-roll-tables",
    window: { title: "Roll Tables — Core & Cursed Scroll", icon: "fas fa-table-list", resizable: true },
    position: { width: 780, height: 720 },
    actions: {
      refresh:           RollTablesApp.prototype._onRefresh,
      filter:            RollTablesApp.prototype._onFilter,
      filterSource:      RollTablesApp.prototype._onFilterSource,
      importMissing:     RollTablesApp.prototype._onImportMissing,
      enrichRow:         RollTablesApp.prototype._onEnrichRow,
      enrichEncounters:  RollTablesApp.prototype._onEnrichEncounters,
      enrichTreasure:    RollTablesApp.prototype._onEnrichTreasure,
    },
  };

  static PARTS = { body: { template: "modules/shadowdark-enhancer/templates/table-hub.hbs" } };

  _filter = null;       // active status filter: null | "system" | "imported" | "partial" | "missing"
  _sourceFilter = null; // active source filter: null | "core" | "cs1".."cs6" | "pgwr" | "gmgwr"

  static _instance = null;
  static open() {
    if (!this._instance) this._instance = new RollTablesApp();
    if (!this._instance.rendered) this._instance.render(true);
    else { this._instance.bringToFront(); this._instance.render(); }
    return this._instance;
  }
  async close(options = {}) { RollTablesApp._instance = null; return super.close(options); }

  async _prepareContext() {
    const { groups, summary: globalSummary, sourceFacets } = await TableHub.buildRows();
    const stf = this._filter;       // status filter
    const sf = this._sourceFilter;  // source filter (facet id)
    const matches = sf ? (sourceFacets.find(f => f.id === sf)?.match ?? [sf]) : null;
    const inSrc = (r) => !matches || matches.includes(r.source);

    // Status counts scoped to the active source filter (so the chips stay honest).
    let summary = globalSummary;
    if (matches) {
      summary = { total: 0, system: 0, imported: 0, partial: 0, missing: 0 };
      for (const g of groups) for (const s of g.subgroups) for (const r of s.rows) {
        if (inSrc(r)) { summary.total++; summary[r.state]++; }
      }
    }

    // Display: keep rows matching BOTH the source and status filters.
    const shown = groups
      .map(g => ({
        ...g,
        subgroups: g.subgroups
          .map(s => ({ ...s, rows: s.rows.filter(r => inSrc(r) && (!stf || r.state === stf)) }))
          .filter(s => s.rows.length),
      }))
      .filter(g => g.subgroups.length);

    return {
      groups: shown, summary, filter: stf,
      fAll: !stf, fSystem: stf === "system", fImported: stf === "imported",
      fPartial: stf === "partial", fMissing: stf === "missing",
      sources: sourceFacets.map(f => ({ id: f.id, label: f.label, count: f.count, active: sf === f.id })),
      sourceAll: !sf,
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

  _onRender(context, options) {
    super._onRender?.(context, options);
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
  }

  async _onRefresh() { this.render(); }

  /**
   * Open the Roll Table Importer pre-filled for a missing table: its name,
   * formula, folder, and manifestId are seeded so the GM only has to paste the
   * rows. (Bridges to the existing Importer until the Import tab moves in here.)
   */
  async _onImportMissing(event, target) {
    if (!game.user.isGM) return;
    const entry = findById(target?.dataset?.id);
    const seed = entry && {
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
    game.shadowdarkEnhancer?.encounter?.openRoller?.("import", seed ?? null);
  }

  /** Link one imported table's entries to the compendium (monsters / items). */
  async _onEnrichRow(event, target) {
    if (!game.user.isGM) return;
    await TableEnricher.enrich(target.dataset.uuid, target.dataset.kind);
    this.render();
  }

  async _onEnrichEncounters() { return this._enrichAllOfKind("encounter", "encounter"); }
  async _onEnrichTreasure()   { return this._enrichAllOfKind("treasure", "treasure"); }

  async _enrichAllOfKind(kind, label) {
    if (!game.user.isGM) return;
    const { groups } = await TableHub.buildRows();
    const targets = groups
      .flatMap(g => g.subgroups.flatMap(s => s.rows))
      .filter(r => r.linkable && r.linkKind === kind)
      .map(r => ({ uuid: r.uuid, kind }));
    if (!targets.length) { ui.notifications.info(`No imported ${label} tables to link.`); return; }
    await TableEnricher.enrichMany(targets);
    this.render();
  }
}
