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
import { TableImporter } from "./table-importer.mjs";
import { LootLinker } from "./loot-linker.mjs";
import { CATEGORIES, CUSTOM_ID } from "./table-categories.mjs";
import { findById, formulaFromDie, isMatrix, columnManifestId } from "./table-manifest.mjs";
import { segmentDump } from "./dump-segmenter.mjs";
import { parseStatblock } from "./statblock-parser.mjs";
import { MonsterImporter } from "./monster-importer.mjs";
import { gatherCensus, gatherDuplicates, cullDuplicates } from "./monster-census-live.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Common source labels offered as datalist suggestions. */
const SOURCE_SUGGESTIONS = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];

/** Fallback move keys if the system enum isn't present. */
const FALLBACK_MOVES = { close: "", near: "", doubleNear: "", tripleNear: "", far: "", special: "", none: "" };

/**
 * Map parser warnings to draft field names for highlight flags.
 * Mirrors MonsterImporterApp.warnFields exactly.
 */
function warnFields(warnings) {
  const f = new Set();
  for (const w of warnings) {
    const s = String(w).toLowerCase();
    if (/\bac\b/.test(s)) f.add("ac");
    if (/\bhp\b/.test(s)) f.add("hp");
    if (/alignment/.test(s)) f.add("alignment");
    if (/\blevel\b/.test(s) || /\blv\b/.test(s)) f.add("level");
    if (/move/.test(s)) f.add("move");
    if (/abilit|s\/d\/c/.test(s)) f.add("abilities");
    if (/attack|\batk\b/.test(s)) f.add("attacks");
    if (/spell/.test(s)) f.add("spellcasting");
  }
  return f;
}

export class ImporterHubApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-importer-hub",
    window: { title: "Importer", icon: "fas fa-file-import", resizable: true },
    position: { width: 860, height: 780 },
    actions: {
      // Tab nav
      switchTab:              ImporterHubApp.prototype._onSwitchTab,
      // Tables-tab dashboard
      refresh:                ImporterHubApp.prototype._onRefresh,
      filter:                 ImporterHubApp.prototype._onFilter,
      filterSource:           ImporterHubApp.prototype._onFilterSource,
      importMissing:          ImporterHubApp.prototype._onImportMissing,
      migrateCompendium:      ImporterHubApp.prototype._onMigrateCompendium,
      hubFoldLegacyLoot:      ImporterHubApp.prototype._onFoldLegacyLoot,
      // Import tab — parse/clear
      hubParse:               ImporterHubApp.prototype._onHubParse,
      hubClear:               ImporterHubApp.prototype._onHubClear,
      // Import tab — monster section structural actions
      mimportAddAttack:       ImporterHubApp.prototype._onMimportAddAttack,
      mimportAddSpecial:      ImporterHubApp.prototype._onMimportAddSpecial,
      mimportRemoveAttack:    ImporterHubApp.prototype._onMimportRemoveAttack,
      mimportAddFeature:      ImporterHubApp.prototype._onMimportAddFeature,
      mimportRemoveFeature:   ImporterHubApp.prototype._onMimportRemoveFeature,
      mimportRemoveMonster:   ImporterHubApp.prototype._onMimportRemoveMonster,
      // Import tab — item section structural actions
      iimportRemoveItem:      ImporterHubApp.prototype._onIimportRemoveItem,
      // Import tab — table section structural actions
      importAddRow:           ImporterHubApp.prototype._onImportAddRow,
      importDeleteRow:        ImporterHubApp.prototype._onImportDeleteRow,
      importUnlinkRow:        ImporterHubApp.prototype._onImportUnlinkRow,
      // Import tab — commit actions
      hubCommitMonsters:      ImporterHubApp.prototype._onHubCommitMonsters,
      hubCommitItems:         ImporterHubApp.prototype._onHubCommitItems,
      hubCommitTables:        ImporterHubApp.prototype._onHubCommitTables,
      hubCommitAll:           ImporterHubApp.prototype._onHubCommitAll,
      // Monsters-tab census/gap/duplicate actions
      monsterGapExpand:       ImporterHubApp.prototype._onMonsterGapExpand,
      monsterSeedPaste:       ImporterHubApp.prototype._onMonsterSeedPaste,
      monsterCullGroup:       ImporterHubApp.prototype._onMonsterCullGroup,
      // Monsters-tab maintenance actions (D-03, ported from MonsterImporterApp)
      mimportBackfill:        ImporterHubApp.prototype._onBackfill,
      mimportMigrateSuite:    ImporterHubApp.prototype._onMigrateSuite,
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

  // ── Import-tab seed (set by Tables-tab per-row Import, applied on parse) ────
  /**
   * Seed object set by _onImportMissing (Tables tab per-row Import button).
   * Carries { name, die, page, formula, category, folderLabel, manifestId,
   *           matrix, columns, widths, grid }.
   * Applied to _importTables[0] during _onHubParse via _applyImportSeed.
   * @type {object|null}
   */
  _importSeed = null;

  // ── Import-tab content state ───────────────────────────────────────────────
  /** Raw paste text (stashed on input, committed on blur/parse). */
  _importText = "";
  /** Monster parse results: [{ draft, warnings }] */
  _importMonsters = [];
  /** Item parse results: [{ draft, warnings }] from seg.items */
  _importItems = [];
  /** Table parse results: ParsedTable[] */
  _importTables = [];
  /** Skipped blocks (from segmenter + parser): [{ name, reason }] */
  _importSkipped = [];
  /** Monster section source label (free-text, feeds createMonsters folder). */
  _importSource = "";
  /** Paste-box focus/cursor preservation. */
  _importTextFocused = false;
  _importTextCursor = 0;

  // ── Monsters-tab census cache ─────────────────────────────────────────────
  /**
   * Cached monsters-tab data (invalidated after cull/import/commit).
   * Shape: { censusRows, duplicateGroups, duplicateCount } or null.
   * @type {object|null}
   */
  _monstersCache = null;
  /** Pending cache refresh (debounce). */
  _monstersCacheTimer = null;
  /** Which gap rows are expanded: Set of source ids. */
  _expandedGapRows = new Set();

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

    // ── Import-tab data ──────────────────────────────────────────────────────
    const moveOptions = Object.keys(CONFIG.SHADOWDARK?.NPC_MOVES ?? FALLBACK_MOVES);

    const importMonsterCards = this._importMonsters.map((p, i) => {
      const wf = warnFields(p.warnings ?? []);
      return {
        idx: i,
        draft: p.draft,
        warnings: p.warnings ?? [],
        hasWarnings: (p.warnings?.length ?? 0) > 0,
        warnCount: p.warnings?.length ?? 0,
        warn: {
          ac: wf.has("ac"), hp: wf.has("hp"), alignment: wf.has("alignment"),
          level: wf.has("level"), move: wf.has("move"), abilities: wf.has("abilities"),
          attacks: wf.has("attacks"), spellcasting: wf.has("spellcasting"),
        },
      };
    });

    const categoryOptions = [
      ...CATEGORIES.map(c => ({ id: c.id, label: c.label })),
      { id: CUSTOM_ID, label: "Custom…" },
    ];

    const hasMonsters = importMonsterCards.length > 0;
    const hasItems    = this._importItems.length > 0;
    const hasTables   = this._importTables.length > 0;
    const showImportAll = [hasMonsters, hasItems, hasTables].filter(Boolean).length > 1;

    const importData = {
      text: this._importText,
      source: this._importSource,
      sourceSuggestions: SOURCE_SUGGESTIONS,
      seed: this._importSeed,
      monsters: importMonsterCards,
      items: this._importItems,
      tables: this._importTables,
      skipped: this._importSkipped,
      hasMonsters,
      hasItems,
      hasTables,
      showImportAll,
      skippedCount: this._importSkipped.length,
      monstersCount: importMonsterCards.length,
      itemsCount: this._importItems.length,
      tablesCount: this._importTables.length,
      itemTypeOptions: ["Basic", "Weapon", "Armor", "Potion", "Scroll", "Wand"],
      categoryOptions,
      alignments: ["L", "N", "C"],
      moveOptions,
      spellAbilities: [
        { value: "", label: "— none —" },
        { value: "int", label: "INT" },
        { value: "wis", label: "WIS" },
        { value: "cha", label: "CHA" },
      ],
      attackTypes: ["NPC Attack", "NPC Special Attack"],
      abilityKeys: [
        { key: "str", label: "STR" }, { key: "dex", label: "DEX" }, { key: "con", label: "CON" },
        { key: "int", label: "INT" }, { key: "wis", label: "WIS" }, { key: "cha", label: "CHA" },
      ],
    };

    // ── Monsters-tab data ────────────────────────────────────────────────────
    let monstersData = null;
    if (this._activeTab === "monsters") {
      monstersData = await this._prepareMonstersContext();
    }

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
      // Import-tab context
      importData,
      // Monsters-tab context (null when not on Monsters tab)
      monstersData,
    };
  }

  /**
   * Prepare Monsters-tab context: census rows merged with gap counts, duplicate
   * groups, and expanded-gap-row tracking. Results are cached within a render
   * cycle; cache is invalidated on cull/import/tab-switch.
   *
   * @returns {Promise<object>}
   */
  async _prepareMonstersContext() {
    if (!this._monstersCache) {
      // Fetch in parallel: census (includes gaps) + duplicates
      const [censusRowsMerged, dupGroups] = await Promise.all([
        gatherCensus().catch((err) => {
          console.error("shadowdark-enhancer | gatherCensus failed:", err);
          return [];
        }),
        gatherDuplicates().catch((err) => {
          console.error("shadowdark-enhancer | gatherDuplicates failed:", err);
          return [];
        }),
      ]);

      this._monstersCache = {
        censusRows:     censusRowsMerged,
        duplicateGroups: dupGroups,
        duplicateCount:  dupGroups.length,
      };
    }

    const { censusRows: rows, duplicateGroups: dupGroups, duplicateCount } = this._monstersCache;

    // Enrich census rows with expansion state
    const censusRowsCtx = rows.map((r) => ({
      ...r,
      expanded: this._expandedGapRows.has(r.source),
    }));

    const hasGaps = rows.some((r) => r.gap > 0);
    const hasDuplicates = dupGroups.length > 0;

    return {
      censusRows:      censusRowsCtx,
      duplicateGroups: dupGroups,
      duplicateCount,
      hasGaps,
      hasDuplicates,
      noCensus:        rows.length === 0,
    };
  }

  /** Invalidate the monsters-tab cache and optionally schedule a re-render. */
  _invalidateMonstersCache() {
    this._monstersCache = null;
    clearTimeout(this._monstersCacheTimer);
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

    // ── Import-tab wiring (only when Import tab is active) ────────────────────
    if (this._activeTab === "import") {
      this._wireHubPaste();
      this._wireHubSource();
      this._wireHubMonsterFieldEdits();
      this._wireHubItemFieldEdits();
      this._wireHubTableFieldEdits();
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

  // ── Import-tab wiring helpers ─────────────────────────────────────────────

  /** Paste box: debounced stash + cursor preservation. */
  _wireHubPaste() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (!ta) return;
    if (this._importTextFocused) {
      ta.focus();
      const pos = this._importTextCursor ?? ta.value.length;
      try { ta.setSelectionRange(pos, pos); } catch (_) {}
    }
    let t = null;
    ta.addEventListener("input", (ev) => {
      this._importTextFocused = true;
      this._importTextCursor = ev.target.selectionStart;
      clearTimeout(t);
      t = setTimeout(() => { this._importText = ev.target.value; }, 200);
    });
    ta.addEventListener("blur", () => { this._importTextFocused = false; this._importText = ta.value; });
  }

  /** Source label input: free-text, commit on input. */
  _wireHubSource() {
    const input = this.element.querySelector("input[data-import-source]");
    if (!input) return;
    input.addEventListener("input", (ev) => { this._importSource = ev.target.value; });
  }

  /**
   * Monster grid field edits. Commit in place WITHOUT re-render so focus is
   * preserved. Clears warn highlight on the edited field. Mirrors
   * MonsterImporterApp._wireFieldEdits exactly, reading from _importMonsters.
   */
  _wireHubMonsterFieldEdits() {
    this.element.querySelectorAll("[data-mimport-field]").forEach((el) => {
      el.addEventListener("change", (ev) => {
        const mEl = ev.target.closest("[data-monster-idx]");
        if (!mEl) return;
        const card = this._importMonsters[Number(mEl.dataset.monsterIdx)];
        if (!card) return;
        const draft = card.draft;
        const field = ev.target.dataset.mimportField;
        const aEl = ev.target.closest("[data-attack-idx]");
        const fEl = ev.target.closest("[data-feature-idx]");
        if (aEl) {
          const a = draft.actions[Number(aEl.dataset.attackIdx)];
          if (a) this._setDraftAttackField(a, field, ev.target);
        } else if (fEl) {
          const ft = draft.features[Number(fEl.dataset.featureIdx)];
          if (ft) {
            if (field === "fName") ft.name = ev.target.value;
            else if (field === "fDesc") ft.description = ev.target.value;
          }
        } else {
          this._setDraftScalarField(draft, field, ev.target);
        }
        ev.target.classList.remove("sde-mimport-warn");
      });
    });
  }

  /**
   * Table preview field edits. Commit on `change`, no re-render, matching
   * RollTablesApp._onRender's import-tab wiring. The category select re-renders
   * (needed to show/hide customLabel input) — that is the one exception.
   */
  _wireHubTableFieldEdits() {
    this.element.querySelectorAll(".sde-import-table [data-import-field]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const tIdx = Number(ev.target.closest("[data-table-idx]")?.dataset.tableIdx);
        const tbl = this._importTables[tIdx];
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
          else if (field === "category") { tbl.category = ev.target.value; this.render(); }
          else if (field === "customLabel") tbl.customLabel = ev.target.value;
        }
      });
    });
  }

  /**
   * Item grid field edits. Commit in place WITHOUT re-render so focus is
   * preserved. Mirrors _wireHubMonsterFieldEdits commit-in-place pattern.
   */
  _wireHubItemFieldEdits() {
    this.element.querySelectorAll("[data-iimport-field]").forEach((el) => {
      el.addEventListener("change", (ev) => {
        const rowEl = ev.target.closest("[data-item-idx]");
        if (!rowEl) return;
        const card = this._importItems[Number(rowEl.dataset.itemIdx)];
        if (!card) return;
        const draft = card.draft;
        const field = ev.target.dataset.iimportField;
        const v = ev.target.value;
        switch (field) {
          case "name":        draft.name = v; break;
          case "type":        draft.type = v; break;
          case "costGp":      draft.cost.gp = Number(v); break;
          case "costSp":      draft.cost.sp = Number(v); break;
          case "costCp":      draft.cost.cp = Number(v); break;
          case "slots":       draft.slots.slots_used = Number(v); break;
          case "description": {
            // Re-wrap as HTML if the user typed plain text (D4 discipline)
            const trimmed = v.trim();
            draft.description = trimmed.startsWith("<") ? trimmed : (trimmed ? `<p>${trimmed}</p>` : "<p></p>");
            break;
          }
        }
      });
    });
  }

  _setDraftScalarField(draft, field, el) {
    const v = el.value;
    switch (field) {
      case "name": draft.name = v; break;
      case "level": draft.level = Number(v); break;
      case "ac": draft.ac = Number(v); break;
      case "hpValue": draft.hp.value = Number(v); break;
      case "hpMax": draft.hp.max = Number(v); break;
      case "alignment": draft.alignment = v; break;
      case "move": draft.move = v; break;
      case "moveNote": draft.moveNote = v; break;
      case "str": case "dex": case "con": case "int": case "wis": case "cha":
        draft.abilities[field] = Number(v); break;
      case "scAbility": draft.spellcasting.ability = v; break;
      case "scBonus": draft.spellcasting.bonus = Number(v); break;
      case "scAttacks": draft.spellcasting.attacks = Number(v); break;
    }
  }

  _setDraftAttackField(a, field, el) {
    const v = el.value;
    switch (field) {
      case "aNum": a.num = Number(v); break;
      case "aName": a.name = v; break;
      case "aType": a.type = v; break;
      case "aBonus": a.bonus = Number(v); break;
      case "aDamage": a.damage = v; break;
      case "aRanges": a.ranges = v.split(/[,/]/).map((s) => s.trim().toLowerCase()).filter(Boolean); break;
      case "aDesc": a.description = v; break;
    }
  }

  // ── Import-tab parse/clear actions ────────────────────────────────────────

  /**
   * Parse action: reads the paste box, runs segmentDump, maps monster chunks
   * via parseStatblock, applies the seed to the first table (if any), links
   * loot tables. Then re-renders.
   */
  async _onHubParse() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;

    const seg = segmentDump(this._importText);

    // Map raw monster chunks → [{ draft, warnings }]
    this._importMonsters = seg.monsters.map((chunk) => parseStatblock(chunk));

    // Items are already [{ draft, warnings }] from the item recognizer
    this._importItems = seg.items ?? [];

    // Tables are already ParsedTable[] from the segmenter
    this._importTables = seg.tables;

    // Skipped: union of segmenter skipped + any extra from parsers
    this._importSkipped = [...(seg.skipped ?? [])];

    // Apply seed (D-07 bridge: per-row Import from Tables tab)
    this._applyImportSeed();

    // Link loot rows to compendium items
    await this._linkLootTables();

    if (!this._importMonsters.length && !this._importItems.length && !this._importTables.length) {
      ui.notifications.warn("No monsters, items, or tables found — review the Skipped section.");
    }

    this.render();
  }

  _onHubClear() {
    this._importText = "";
    this._importMonsters = [];
    this._importItems = [];
    this._importTables = [];
    this._importSkipped = [];
    this._importSeed = null;
    this.render();
  }

  /**
   * Apply the import seed from a Tables-tab per-row Import click.
   * Forces the first parsed table's identity to the manifest entry.
   * Ported directly from RollTablesApp._applyImportSeed.
   */
  _applyImportSeed() {
    const seed = this._importSeed;
    if (!seed || !this._importTables?.length) return;
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
        this._importTables = [merged];
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
      this._importTables = split;
      return;
    }

    const t0 = this._importTables[0];
    if (seed.name) t0.name = seed.name;
    if (seed.formula) t0.formula = seed.formula;
    if (seed.folderLabel) { t0.category = CUSTOM_ID; t0.customLabel = seed.folderLabel; }
    if (folderPath.length) t0.folderPath = folderPath;
    t0.manifestId = seed.manifestId ?? null;
  }

  /** Link each Loot row's text to a compendium Item. Ported from RollTablesApp. */
  async _linkLootTables() {
    const lootTables = this._importTables.filter(t => t.category === "loot");
    if (!lootTables.length) return;
    const items = await LootLinker.buildItemIndex();
    for (const tbl of lootTables) {
      for (const row of tbl.rows) {
        row.link = LootLinker.findLink(row.text, items);
      }
    }
  }

  // ── Import-tab monster structural actions ────────────────────────────────

  _onMimportRemoveMonster(event, target) {
    const idx = Number(target.closest("[data-monster-idx]")?.dataset.monsterIdx);
    if (!Number.isFinite(idx)) return;
    this._importMonsters.splice(idx, 1);
    this.render();
  }

  _onMimportAddAttack(event, target) {
    const draft = this._hubMonsterDraft(target);
    if (!draft) return;
    draft.actions.push({ name: "New Attack", type: "NPC Attack", num: 1, bonus: 0, damage: "1d6", ranges: ["close"], description: "" });
    this.render();
  }

  _onMimportAddSpecial(event, target) {
    const draft = this._hubMonsterDraft(target);
    if (!draft) return;
    draft.actions.push({ name: "New Special", type: "NPC Special Attack", num: 1, bonus: 0, damage: "", ranges: [], description: "" });
    this.render();
  }

  _onMimportRemoveAttack(event, target) {
    const draft = this._hubMonsterDraft(target);
    const aIdx = Number(target.closest("[data-attack-idx]")?.dataset.attackIdx);
    if (!draft || !Number.isFinite(aIdx)) return;
    draft.actions.splice(aIdx, 1);
    this.render();
  }

  _onMimportAddFeature(event, target) {
    const draft = this._hubMonsterDraft(target);
    if (!draft) return;
    draft.features.push({ name: "New Feature", description: "" });
    this.render();
  }

  _onMimportRemoveFeature(event, target) {
    const draft = this._hubMonsterDraft(target);
    const fIdx = Number(target.closest("[data-feature-idx]")?.dataset.featureIdx);
    if (!draft || !Number.isFinite(fIdx)) return;
    draft.features.splice(fIdx, 1);
    this.render();
  }

  _hubMonsterDraft(target) {
    const idx = Number(target.closest("[data-monster-idx]")?.dataset.monsterIdx);
    return this._importMonsters[idx]?.draft ?? null;
  }

  // ── Import-tab item structural actions ───────────────────────────────────

  _onIimportRemoveItem(event, target) {
    const idx = Number(target.closest("[data-item-idx]")?.dataset.itemIdx);
    if (!Number.isFinite(idx)) return;
    this._importItems.splice(idx, 1);
    this.render();
  }

  // ── Import-tab table structural actions ──────────────────────────────────

  _onImportAddRow(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const tbl = this._importTables[tIdx];
    if (!tbl) return;
    const nextMin = tbl.rows.reduce((m, r) => Math.max(m, r.max), 0) + 1;
    tbl.rows.push({ min: nextMin, max: nextMin, text: "" });
    this.render();
  }

  _onImportDeleteRow(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const rIdx = Number(target.closest("[data-row-idx]")?.dataset.rowIdx);
    const tbl = this._importTables[tIdx];
    if (!tbl || !Number.isFinite(rIdx)) return;
    tbl.rows.splice(rIdx, 1);
    this.render();
  }

  _onImportUnlinkRow(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const rIdx = Number(target.closest("[data-row-idx]")?.dataset.rowIdx);
    const tbl = this._importTables[tIdx];
    if (!tbl || !Number.isFinite(rIdx) || !tbl.rows[rIdx]) return;
    tbl.rows[rIdx].link = null;
    this.render();
  }

  // ── Import-tab commit actions ─────────────────────────────────────────────

  /** Conflict dialog for monster name collisions (rename/replace/skip). */
  _monsterConflictDialog() {
    return async (name) => {
      const safe = foundry.utils.escapeHTML(name);
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Monster Already Exists" },
        content: `<p>A monster named <strong>${safe}</strong> is already in the imported-monsters compendium. What would you like to do?</p>`,
        buttons: [
          { action: "rename",  label: "Import as Copy", default: true },
          { action: "replace", label: "Replace Existing" },
          { action: "skip",    label: "Skip" },
        ],
        rejectClose: false,
      }).catch(() => "skip");
      return choice ?? "skip";
    };
  }

  /** Conflict dialog for table name collisions (rename/replace/cancel). */
  _tableConflictDialog() {
    return async (name) => {
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
  }

  /** Conflict dialog for item name collisions (rename/replace/skip). */
  _itemConflictDialog() {
    return async (name) => {
      const safe = foundry.utils.escapeHTML(name);
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Item Already Exists" },
        content: `<p>An item named <strong>${safe}</strong> is already in the imported-items compendium. What would you like to do?</p>`,
        buttons: [
          { action: "rename",  label: "Keep both", default: true },
          { action: "replace", label: "Replace Existing" },
          { action: "skip",    label: "Skip" },
        ],
        rejectClose: false,
      }).catch(() => "skip");
      return choice ?? "skip";
    };
  }

  /** Commit: create all pending items into sde-items. GM-gated. */
  async _onHubCommitItems() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import items."); return; }
    if (!this._importItems.length) { ui.notifications.warn("No items to import."); return; }

    const source = this._importSource.trim();
    const drafts = this._importItems.map((p) => p.draft);
    const { ItemImporter } = await import("./item-importer.mjs");
    const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
    if (!result) return;

    const parts = [`${result.created.length} created`];
    if (result.replaced.length) parts.push(`${result.replaced.length} replaced`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    ui.notifications.info(`Items: ${parts.join(", ")} → sde-items${source ? ` / ${source}` : ""}.`);
    this._importItems = [];
    this.render();
  }

  /** Commit: create all pending monsters into sde-actors. GM-gated. */
  async _onHubCommitMonsters() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import monsters."); return; }
    if (!this._importMonsters.length) { ui.notifications.warn("No monsters to import."); return; }

    const source = this._importSource.trim();
    const drafts = this._importMonsters.map((p) => p.draft);
    const result = await MonsterImporter.createMonsters(drafts, { source, onConflict: this._monsterConflictDialog() });
    if (!result) return;

    const parts = [`${result.created.length} created`];
    if (result.replaced.length) parts.push(`${result.replaced.length} replaced`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    ui.notifications.info(`Monsters: ${parts.join(", ")} → ${MonsterImporter.PACK_LABEL}${source ? ` / ${source}` : ""}.`);
    this._importMonsters = [];
    this.render();
  }

  /** Commit: create all pending tables into sde-tables. GM-gated. */
  async _onHubCommitTables() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import tables."); return; }
    if (!this._importTables.length) { ui.notifications.warn("No tables to import."); return; }

    const onConflict = this._tableConflictDialog();
    let created = 0;
    for (const tbl of [...this._importTables]) {
      const table = await TableImporter.createTable(tbl, { onConflict });
      if (table) {
        created++;
        this._importTables = this._importTables.filter(t => t !== tbl);
        if (tbl.manifestId) this._importSeed = null;
      }
    }
    ui.notifications.info(`Tables: ${created} created → sde-tables.`);
    this.render();
  }

  /** Commit: create all monsters, items, then tables in one action. GM-gated. */
  async _onHubCommitAll() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import."); return; }

    const hasMonsters = this._importMonsters.length > 0;
    const hasItems    = this._importItems.length > 0;
    const hasTables   = this._importTables.length > 0;
    if (!hasMonsters && !hasItems && !hasTables) { ui.notifications.warn("Nothing to import."); return; }

    const parts = [];
    const source = this._importSource.trim();

    // Monsters first
    if (hasMonsters) {
      const drafts = this._importMonsters.map((p) => p.draft);
      const result = await MonsterImporter.createMonsters(drafts, { source, onConflict: this._monsterConflictDialog() });
      if (result) {
        parts.push(`monsters: ${result.created.length} created${result.replaced.length ? `, ${result.replaced.length} replaced` : ""}${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`);
        this._importMonsters = [];
      }
    }

    // Items second
    if (hasItems) {
      const { ItemImporter } = await import("./item-importer.mjs");
      const drafts = this._importItems.map((p) => p.draft);
      const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
      if (result) {
        parts.push(`items: ${result.created.length} created${result.replaced.length ? `, ${result.replaced.length} replaced` : ""}${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`);
        this._importItems = [];
      }
    }

    // Tables third
    if (hasTables) {
      const onConflict = this._tableConflictDialog();
      let created = 0;
      for (const tbl of [...this._importTables]) {
        const table = await TableImporter.createTable(tbl, { onConflict });
        if (table) {
          created++;
          this._importTables = this._importTables.filter(t => t !== tbl);
          if (tbl.manifestId) this._importSeed = null;
        }
      }
      parts.push(`tables: ${created} created`);
    }

    ui.notifications.info(`Import complete — ${parts.join("; ")}.`);
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

  /**
   * Fold the legacy world "Loot" pack into sde-items (A-08).
   * Dry-run preview → DialogV2 confirm → migrateItems → LootLinker.invalidate().
   * Non-destructive: originals stay, the legacy pack is locked as backup (D6).
   */
  async _onFoldLegacyLoot() {
    if (!game.user?.isGM) return;

    const { ItemMigration } = await import("./item-migration.mjs");
    const { LootLinker } = await import("./loot-linker.mjs");

    const preview = await ItemMigration.planItemMigration();
    if (!preview) return;

    const bySourceLines = Object.entries(preview.bySource)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([src, n]) => `<li>${foundry.utils.escapeHTML(src)}: ${n}</li>`)
      .join("");

    if (preview.total === 0) {
      await foundry.applications.api.DialogV2.alert({
        window: { title: "Fold Legacy Loot Pack" },
        content: `<p>No un-migrated items found in the legacy "Loot" pack. Either it is absent or every item already carries the migrated stamp.</p>`,
      }).catch(() => {});
      return;
    }

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Fold Legacy Loot Pack into Items" },
      content: `<p>Found <strong>${preview.total}</strong> item(s) in the legacy "Loot" pack to copy into <em>sde-items</em>.</p>
        <p>Originals are never deleted — the legacy pack is locked afterward as a backup.</p>
        ${bySourceLines ? `<p><strong>By source:</strong></p><ul>${bySourceLines}</ul>` : ""}`,
      buttons: [
        { action: "fold",   label: "Fold in", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");

    if (!choice || choice === "cancel") return;

    let report;
    try {
      report = await ItemMigration.migrateItems({ dryRun: false });
    } catch (err) {
      console.error("shadowdark-enhancer | item-migration: unexpected error:", err);
      ui.notifications?.error("Legacy Loot fold-in failed — see the console for details.");
      return;
    }
    if (!report) return;

    LootLinker.invalidate();

    const summary = [
      `${report.legacyMigrated} item(s) folded into sde-items`,
      `legacy pack locked as backup`,
      report.failures ? `${report.failures} failure(s) — see console` : "",
    ].filter(Boolean).join(" · ");
    ui.notifications?.info(`Fold-in complete: ${summary}.`);
    this.render();
  }

  // ── Monsters-tab action handlers ───────────────────────────────────────────

  /**
   * Toggle a gap row's missing-names list open/closed.
   * Re-uses the _expandedGapRows Set to track state without a cache invalidation.
   */
  _onMonsterGapExpand(event, target) {
    const source = target.dataset.source ?? "";
    if (this._expandedGapRows.has(source)) {
      this._expandedGapRows.delete(source);
    } else {
      this._expandedGapRows.add(source);
    }
    this.render();
  }

  /**
   * "Seed the paste box" shortcut: pre-sets _importText to a seed hint for a
   * single missing monster name, switches to the Import tab, re-renders.
   * Reuses the 10-03 seed-hint pattern (sets _importSeed so the hint bar shows).
   */
  _onMonsterSeedPaste(event, target) {
    const name = target.dataset.name ?? "";
    if (!name) return;
    this._importText = name;
    this._importSeed = { name, _monsterSeed: true };
    this._activeTab = "import";
    this.render();
  }

  /**
   * Guided cull: read the chosen keeper uuid from the form, compute dropUuids,
   * show a DialogV2 confirm listing exactly which pack copies will be deleted,
   * call cullDuplicates on confirm, invalidate cache, re-render. (D-06)
   */
  async _onMonsterCullGroup(event, target) {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can cull duplicates."); return; }

    const groupKey = target.dataset.groupKey ?? "";
    if (!groupKey) return;

    // Find the group in the cache
    const groups = this._monstersCache?.duplicateGroups ?? [];
    const group = groups.find((g) => g.key === groupKey);
    if (!group) { ui.notifications.warn("Duplicate group not found — refresh the Monsters tab."); return; }

    // Read the keeper from the checked radio inside this group's card
    const card = target.closest("[data-group-key]");
    const checkedRadio = card?.querySelector("input[type='radio']:checked");
    const keepUuid = checkedRadio?.value ?? "";
    if (!keepUuid) { ui.notifications.warn("Select a keeper before culling."); return; }

    const dropMembers = group.members.filter((m) => m.uuid !== keepUuid);
    if (!dropMembers.length) { ui.notifications.info("Nothing to cull — only one member selected as keeper."); return; }

    // Build confirmation dialog listing exactly what will be deleted
    const keepMember = group.members.find((m) => m.uuid === keepUuid);
    const keepLabel  = foundry.utils.escapeHTML(keepMember?.name ?? keepUuid);
    const dropList   = dropMembers.map((m) => `<li>${foundry.utils.escapeHTML(m.name)} <em>(${m.source || "unknown source"})</em></li>`).join("");

    const content = `
      <p>Keep: <strong>${keepLabel}</strong></p>
      <p>Delete these pack copies:</p>
      <ul style="margin:.3em 0">${dropList}</ul>
      <p style="color:var(--sde-bar-text-muted,#9a9a9a);font-size:.85em">
        Only pack copies in sde-actors are deleted. World actors and _Backup docs are never touched.
      </p>`;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Cull Duplicate Monsters" },
      content,
      buttons: [
        { action: "cull",   label: "Delete copies", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");

    if (choice !== "cull") return;

    const dropUuids = dropMembers.map((m) => m.uuid);
    const tally = await cullDuplicates(keepUuid, dropUuids);

    const parts = [];
    if (tally.deleted)  parts.push(`${tally.deleted} deleted`);
    if (tally.skipped)  parts.push(`${tally.skipped} skipped`);
    if (tally.failed)   parts.push(`${tally.failed} failed (see console)`);
    ui.notifications.info(`Cull complete: ${parts.join(", ") || "nothing done"}.`);

    this._invalidateMonstersCache();
    this.render();
  }

  /**
   * Backfill existing imported NPCs to fresh-import fidelity.
   * Ported verbatim from MonsterImporterApp._onBackfill (D-03).
   */
  async _onBackfill() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can run the monster backfill."); return; }
    const { backfillTargets } = await import("./monster-backfill.mjs");

    ui.notifications.info("Scanning imported monsters for upgrades…");
    const preview = await backfillTargets({ scope: "pack", dryRun: true });
    if (!preview) return;

    if (preview.total === 0) {
      ui.notifications.info("No imported-monsters compendium found or it contains no NPC actors.");
      return;
    }

    if (preview.changed.length === 0) {
      ui.notifications.info(`All ${preview.total} actor(s) already at full fidelity — nothing to backfill.`);
      return;
    }

    const t = preview.totals;
    const lines = [];
    if (t.descriptionsWrapped) lines.push(`${t.descriptionsWrapped} item description(s) will be HTML-wrapped`);
    if (t.namesCased)          lines.push(`${t.namesCased} attack name(s) will be Title-Cased`);
    if (t.iconsSet)            lines.push(`${t.iconsSet} item icon(s) will be set`);
    if (t.spellsConverted)     lines.push(`${t.spellsConverted} spell feature(s) will become real Spell items`);
    if (t.artAssigned)         lines.push(`${t.artAssigned} portrait/token image(s) will be resolved`);

    const actorList = preview.changed.map((r) => `<li>${foundry.utils.escapeHTML(r.actor)}</li>`).join("");
    const content = `
      <p><strong>${preview.changed.length} of ${preview.total}</strong> actor(s) need upgrading:</p>
      <ul style="max-height:160px;overflow-y:auto;margin:.4em 0">${actorList}</ul>
      <p>${lines.join("; ")}.</p>
      <p>This is non-destructive and idempotent. Proceed?</p>`;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Backfill Imported Monsters" },
      content,
      buttons: [
        { action: "confirm", label: "Backfill", default: true },
        { action: "cancel",  label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");

    if (choice !== "confirm") return;

    const result = await backfillTargets({ scope: "pack", dryRun: false });
    if (!result) return;

    const rt = result.totals;
    const parts = [];
    if (rt.descriptionsWrapped) parts.push(`${rt.descriptionsWrapped} desc wrapped`);
    if (rt.namesCased)          parts.push(`${rt.namesCased} names cased`);
    if (rt.iconsSet)            parts.push(`${rt.iconsSet} icons set`);
    if (rt.spellsConverted)     parts.push(`${rt.spellsConverted} spells converted`);
    if (rt.artAssigned)         parts.push(`${rt.artAssigned} art assigned`);
    ui.notifications.info(
      `Backfill complete: ${result.changed.length} actor(s) upgraded (${parts.join(", ") || "minor updates"}). ` +
      `${result.unchanged.length} already up to date.`
    );
  }

  /**
   * Migrate world-side imported monster actors into sde-actors compendium suite pack.
   * Ported verbatim from MonsterImporterApp._onMigrateSuite (D-03).
   */
  async _onMigrateSuite() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can run the suite migration."); return; }
    const { migrateActors } = await import("./actor-migration.mjs");

    ui.notifications.info("Scanning imported monsters for suite migration…");
    const preview = await migrateActors({ dryRun: true });
    if (!preview) return;

    if (preview.total === 0) {
      ui.notifications.info("No imported-monsters actors found to migrate (all already migrated or none present).");
      return;
    }

    const sourceLines = Object.entries(preview.bySource)
      .map(([src, count]) => {
        const label = src === "" ? "Custom / (no source)" : src === "undefined" ? "(unknown)" : src;
        return `<li><strong>${foundry.utils.escapeHTML(label)}</strong>: ${count}</li>`;
      })
      .join("");

    const content = `
      <p>This will migrate <strong>${preview.total}</strong> imported monster actor(s) into the
      <em>Shadowdark Enhancer — Actors</em> compendium suite pack:</p>
      <ul style="margin:.4em 0">
        <li>World actors to copy: <strong>${preview.worldCount}</strong></li>
        <li>Legacy pack docs to fold in: <strong>${preview.legacyPackCount}</strong></li>
      </ul>
      ${sourceLines ? `<p>By source:</p><ul style="max-height:120px;overflow-y:auto;margin:.4em 0">${sourceLines}</ul>` : ""}
      <p>Each actor is backfilled to current fidelity first, then copied into
      <em>sde-actors</em> under its per-source folder. World originals are
      <strong>moved</strong> (not deleted) into a <em>_Backup (pre-suite)</em>
      folder. The legacy "Imported Monsters" pack (if any) is retired in place —
      never deleted. This operation is idempotent; re-running skips
      already-migrated actors.</p>
      <p>Proceed?</p>`;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Migrate to Compendium Suite" },
      content,
      buttons: [
        { action: "confirm", label: "Migrate", default: true },
        { action: "cancel",  label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");

    if (choice !== "confirm") return;

    const result = await migrateActors({ dryRun: false });
    if (!result) return;

    const parts = [];
    if (result.copied)         parts.push(`${result.copied} copied to sde-actors`);
    if (result.backedUp)       parts.push(`${result.backedUp} moved to _Backup`);
    if (result.legacyMigrated) parts.push(`${result.legacyMigrated} legacy pack docs folded in`);
    if (result.failures)       parts.push(`${result.failures} failed (see console)`);
    ui.notifications.info(
      `Suite migration complete: ${parts.join("; ") || "nothing to do"}.`
    );

    // Invalidate monsters cache so census reflects migrated actors
    this._invalidateMonstersCache();
    this.render();
  }
}

/**
 * Back-compat entry-point API for Task 2 / shadowdark-enhancer.mjs wiring.
 * tables.openHub(tab, seed) and monsters.openImporter() both route through here.
 * tables.openHub(tab, seed) and monsters.openImporter() both route through here.
 */
export const ImporterHubAPI = {
  open: (tab, seed) => ImporterHubApp.open(tab, seed),
};
