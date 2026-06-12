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
import { detectCrawlTitle, hexIdKey } from "./hex-parser.mjs";
import { parseNumberedLocationsDetailed } from "./location-keyer.mjs";
import { parseStatblock } from "./statblock-parser.mjs";
import { MonsterImporter } from "./monster-importer.mjs";
import { gatherCensus, gatherDuplicates, cullDuplicates } from "./monster-census-live.mjs";
import { MODULE_ID } from "../module-id.mjs";

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
      hubRelinkTables:        ImporterHubApp.prototype._onRelinkTables,
      hubRelinkJournals:      ImporterHubApp.prototype._onRelinkJournals,
      hubExportBundle:        ImporterHubApp.prototype._onExportBundle,
      hubImportBundle:        ImporterHubApp.prototype._onImportBundle,
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
      hubCommitJournal:       ImporterHubApp.prototype._onHubCommitJournal,
      hubBuildScene:          ImporterHubApp.prototype._onHubBuildScene,
      himportRemoveKey:       ImporterHubApp.prototype._onHimportRemoveKey,
      himportRemoveHex:       ImporterHubApp.prototype._onHimportRemoveHex,
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
  _importHexes = [];
  _importCrawlName = "";
  /** @type {"hex"|"location"} */
  _importKeyMode = "hex";
  /** Numbered locations are opt-in because ordinary tables use numbered rows. */
  _importLocationMode = false;
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
  /** Cancels a temporary canvas click capture when the hub closes. */
  _pendingCanvasCapture = null;
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
    this._pendingCanvasCapture?.();
    this._pendingCanvasCapture = null;
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
    const hasKeyed    = this._importHexes.length > 0;
    const isLocationMode = this._importKeyMode === "location";
    const keyLabel = isLocationMode ? "Location" : "Hex";
    const showImportAll = [hasMonsters, hasItems, hasTables, hasKeyed].filter(Boolean).length > 1;

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
      hasKeyed,
      keyed: this._importHexes.map((d, i) => ({
        idx: i,
        keyId: isLocationMode ? d.locationId : d.hexId,
        name: d.name,
        body: d.body ?? (d.bodyLines ?? []).join("\n"),
        warnings: d.warnings ?? [],
      })),
      keyedCount: this._importHexes.length,
      keyLabel,
      isLocationMode,
      locationMode: this._importLocationMode,
      crawlName: this._importCrawlName,
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

    // Render-friendly member dates — the raw _stats.modifiedTime epoch was
    // showing verbatim ("1781264550026"; live-caught by the GM).
    const dupGroupsCtx = dupGroups.map((g) => ({
      ...g,
      members: g.members.map((m) => ({
        ...m,
        date: m.date ? new Date(m.date).toLocaleDateString() : null,
      })),
    }));

    return {
      censusRows:      censusRowsCtx,
      duplicateGroups: dupGroupsCtx,
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
      this._wireHubLocationMode();
      this._wireHubSource();
      this._wireHubMonsterFieldEdits();
      this._wireHubItemFieldEdits();
      this._wireHubKeyedFieldEdits();
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

  /** Explicit numbered-location mode toggle; changing it clears stale previews. */
  _wireHubLocationMode() {
    const input = this.element.querySelector("input[data-import-location-mode]");
    if (!input) return;
    input.addEventListener("change", (ev) => {
      this._importLocationMode = !!ev.target.checked;
      this._importKeyMode = this._importLocationMode ? "location" : "hex";
      this._importMonsters = [];
      this._importItems = [];
      this._importTables = [];
      this._importHexes = [];
      this._importSkipped = [];
      this.render();
    });
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

    this._importKeyMode = this._importLocationMode ? "location" : "hex";
    if (this._importLocationMode) {
      this._importMonsters = [];
      this._importItems = [];
      this._importTables = [];
      const parsed = parseNumberedLocationsDetailed(this._importText);
      this._importHexes = parsed.drafts;
      this._importSkipped = this._importHexes.length || !this._importText.trim()
        ? parsed.skipped
        : [{
            name: "Numbered locations",
            reason: "No ascending run of 3+ punctuated headings was found (for example, \"1. Entry Hall\").",
          }];
    } else {
      const seg = segmentDump(this._importText);

      // Map raw monster chunks → [{ draft, warnings }]
      this._importMonsters = seg.monsters.map((chunk) => parseStatblock(chunk));

      // Items are already [{ draft, warnings }] from the item recognizer
      this._importItems = seg.items ?? [];

      // Tables are already ParsedTable[] from the segmenter
      this._importTables = seg.tables;

      // Hex drafts from the hexcrawl recognizer (Phase 16)
      this._importHexes = seg.hexes ?? [];
      this._importCrawlName = this._importHexes.length
        ? (detectCrawlTitle(this._importText) || this._importCrawlName || "")
        : "";

      // Skipped: union of segmenter skipped + any extra from parsers
      this._importSkipped = [...(seg.skipped ?? [])];
    }

    // Apply seed (D-07 bridge: per-row Import from Tables tab)
    this._applyImportSeed();

    // Link loot rows to compendium items
    await this._linkLootTables();

    if (!this._importMonsters.length && !this._importItems.length && !this._importTables.length && !this._importHexes.length) {
      ui.notifications.warn("No monsters, items, tables, or keyed locations found — review the Skipped section.");
    }

    this.render();
  }

  _onHubClear() {
    this._importText = "";
    this._importMonsters = [];
    this._importItems = [];
    this._importHexes = [];
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
    const hasKeyed    = this._importHexes.length > 0;
    if (!hasMonsters && !hasItems && !hasTables && !hasKeyed) { ui.notifications.warn("Nothing to import."); return; }

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

    // Hexcrawl journal fourth (Phase 16) — a missing crawl name skips the
    // stage with a visible note instead of blocking the other sections.
    if (hasKeyed) {
      const crawlName = (this._importCrawlName ?? "").trim();
      if (!crawlName) {
        parts.push("journal: skipped (no name)");
      } else {
        const { JournalImporter } = await import("./journal-importer.mjs");
        const result = await JournalImporter.createOrUpdateKeyedJournal(this._importHexes, {
          crawlName,
          source,
          keyMode: this._importKeyMode,
          onConflict: this._crawlConflictDialog(this._importKeyMode),
        });
        if (result && result.status !== "skipped") {
          parts.push(`journal: "${result.name}" ${result.status} (${result.pages.created} created, ${result.pages.updated} updated)`);
          this._importHexes = [];
          this._importCrawlName = "";
        } else {
          parts.push("journal: skipped");
        }
      }
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
   * Export the entire suite as one JSON bundle download (REQ-25, A-04).
   */
  async _onExportBundle() {
    if (!game.user?.isGM) return;
    const { exportBundle } = await import("./bundle-io.mjs");
    let bundle;
    try {
      bundle = await exportBundle();
    } catch (err) {
      console.error("shadowdark-enhancer | bundle export: unexpected error:", err);
      ui.notifications?.error("Bundle export failed — see the console for details.");
      return;
    }
    if (!bundle) return;
    const s = bundle.stats;
    const parts = Object.entries(s)
      .filter(([k, v]) => v && typeof v === "object" && v.docs)
      .map(([k, v]) => `${k} ${v.docs}`);
    const warn = bundle.warnings.length ? ` · ${bundle.warnings.length} unresolved ref(s) — see console` : "";
    if (bundle.warnings.length) console.warn("shadowdark-enhancer | bundle warnings:", bundle.warnings);
    ui.notifications?.info(`Bundle exported: ${parts.join(" · ")}${warn}.`);
  }

  /**
   * Import a bundle file: pick file → validate → per-pack summary confirm →
   * applyBundle (keepId, skip-existing, never overwrites) → report (REQ-25).
   */
  async _onImportBundle() {
    if (!game.user?.isGM) return;
    const { validateBundle, applyBundle } = await import("./bundle-io.mjs");

    // File picker dialog.
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: "Import Bundle" },
      content: `<p>Select a Shadowdark Enhancer bundle (.json):</p>
        <input type="file" name="bundle-file" accept=".json,application/json">`,
      buttons: [
        {
          action: "load", label: "Load", default: true,
          callback: (ev, button, dialog) => {
            const el = (dialog.element ?? dialog)?.querySelector?.("input[name='bundle-file']");
            return el?.files?.[0] ?? null;
          },
        },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!picked || picked === "cancel") return;

    let bundle;
    try {
      bundle = JSON.parse(await picked.text());
    } catch (err) {
      ui.notifications?.error("That file is not valid JSON.");
      return;
    }
    const check = validateBundle(bundle);
    if (!check.ok) {
      ui.notifications?.error(`Not a valid bundle: ${check.errors.join("; ")}.`);
      return;
    }

    // Per-pack summary confirm before touching anything.
    const rows = Object.entries(bundle.packs)
      .map(([k, p]) => `<li>${foundry.utils.escapeHTML(k)}: ${p.docs.length} doc(s), ${p.folders.length} folder(s)</li>`)
      .join("");
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Import Bundle" },
      content: `<p>Bundle from world <strong>${foundry.utils.escapeHTML(bundle.world ?? "?")}</strong>
        (module v${foundry.utils.escapeHTML(bundle.moduleVersion ?? "?")}, exported ${foundry.utils.escapeHTML((bundle.exported ?? "").slice(0, 10))}):</p>
        <ul>${rows}</ul>
        <p>Documents already in your packs (same id) are skipped — nothing is overwritten or deleted.</p>`,
      buttons: [
        { action: "import", label: "Import", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    if (!choice || choice === "cancel") return;

    let report;
    try {
      report = await applyBundle(bundle);
    } catch (err) {
      console.error("shadowdark-enhancer | bundle import: unexpected error:", err);
      ui.notifications?.error("Bundle import failed — see the console for details.");
      return;
    }
    if (!report) return;
    if (!report.ok) {
      ui.notifications?.error(`Bundle rejected: ${report.errors.join("; ")}.`);
      return;
    }
    const summary = [
      `${report.created} created`,
      `${report.skippedExisting} already present (skipped)`,
      report.failures ? `${report.failures} failure(s) — see console` : "",
    ].filter(Boolean).join(" · ");
    ui.notifications?.info(`Bundle import complete: ${summary}.`);
    this.render();
  }

  /**
   * Re-link every sde-tables doc to imported monsters/items (REQ-24 sweep).
   * Idempotent + link-preserving; DialogV2 confirm with the pack doc count.
   */
  async _onRelinkTables() {
    if (!game.user?.isGM) return;

    const { TableEnricher } = await import("./table-enrich.mjs");
    const { findSuitePack } = await import("./compendium-suite.mjs");
    const pack = findSuitePack("sde-tables");
    if (!pack) {
      ui.notifications?.warn("No sde-tables compendium pack found.");
      return;
    }

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Re-link Pack Tables" },
      content: `<p>Re-link all <strong>${pack.index.size}</strong> table(s) in <em>sde-tables</em> to your imported monsters and items.</p>
        <p>Safe to re-run — existing links and document rows are preserved; only missing links are added.</p>`,
      buttons: [
        { action: "relink", label: "Re-link", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    if (!choice || choice === "cancel") return;

    let tally;
    try {
      tally = await TableEnricher.sweepPack();
    } catch (err) {
      console.error("shadowdark-enhancer | table sweep: unexpected error:", err);
      ui.notifications?.error("Re-link failed — see the console for details.");
      return;
    }
    if (!tally) return;

    const summary = [
      `${tally.encounters} encounter table(s)`,
      `${tally.treasures} treasure table(s)`,
      tally.linked ? `${tally.linked} monster link(s)` : "",
      tally.skipped ? `${tally.skipped} skipped (not enrichable)` : "",
      tally.failures ? `${tally.failures} failure(s) — see console` : "",
    ].filter(Boolean).join(" · ");
    ui.notifications?.info(`Re-link complete: ${summary}.`);
  }

  /** Re-link managed keyed journal pages and refresh deployed world copies. */
  async _onRelinkJournals() {
    if (!game.user?.isGM) return;
    const { findSuitePack } = await import("./compendium-suite.mjs");
    const pack = findSuitePack("sde-journal");
    if (!pack) {
      ui.notifications?.warn("No sde-journal compendium pack found.");
      return;
    }
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Re-link Journal Pages" },
      content: `<p>Re-link all managed pages in <strong>${pack.index.size}</strong> journal entry or entries to available monsters and items.</p>
        <p>Only changed pages are updated. Existing deployed world copies are synchronized; no new world journal is created.</p>`,
      buttons: [
        { action: "relink", label: "Re-link", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    if (!choice || choice === "cancel") return;

    try {
      const { JournalEnricher } = await import("./journal-enrich.mjs");
      const tally = await JournalEnricher.sweepPack();
      if (!tally) return;
      const summary = [
        `${tally.updated} of ${tally.pages} page(s) updated`,
        `${tally.addedLinks} link(s) added`,
        `${tally.worldSynced} world journal(s) synchronized`,
        tally.failures ? `${tally.failures} failure(s) - see console` : "",
      ].filter(Boolean).join(" · ");
      ui.notifications?.info(`Journal re-link complete: ${summary}.`);
    } catch (err) {
      console.error(`${MODULE_ID} | journal sweep: unexpected error:`, err);
      ui.notifications?.error("Journal re-link failed - see the console for details.");
    }
  }

  /** Keyed journal field edits; commit in place so typing does not lose focus. */
  _wireHubKeyedFieldEdits() {
    const nameEl = this.element.querySelector("input[data-import-crawlname]");
    nameEl?.addEventListener("input", (ev) => { this._importCrawlName = ev.target.value; });
    this.element.querySelectorAll("[data-himport-field]").forEach((el) => {
      el.addEventListener("change", (ev) => {
        const rowEl = ev.target.closest("[data-keyed-idx]");
        if (!rowEl) return;
        const draft = this._importHexes[Number(rowEl.dataset.keyedIdx)];
        if (!draft) return;
        const field = ev.target.dataset.himportField;
        const v = ev.target.value;
        switch (field) {
          case "keyId": {
            if (this._importKeyMode === "location") {
              const nextId = Number(v.trim());
              if (Number.isInteger(nextId) && nextId > 0) {
                draft.locationId = String(nextId);
                draft.key = `loc:${draft.locationId}`;
              } else {
                ev.target.value = draft.locationId;
              }
            } else {
              draft.hexId = v.trim();
              draft.key = hexIdKey(draft.hexId) ?? draft.key;
            }
            break;
          }
          case "name": draft.name = v; break;
          case "body": {
            draft.body = v;
            draft.bodyLines = v.split("\n").map((l) => l.trim()).filter(Boolean);
            break;
          }
        }
      });
    });
  }

  _onHimportRemoveKey(event, target) {
    const idx = Number(target.closest("[data-keyed-idx]")?.dataset.keyedIdx);
    if (Number.isInteger(idx)) {
      this._importHexes.splice(idx, 1);
      this.render();
    }
  }

  /** Back-compatible action alias for Phase 16 templates. */
  _onHimportRemoveHex(event, target) {
    return this._onHimportRemoveKey(event, target);
  }

  /** A-04 conflict dialog: update-in-place (default) / separate copy / skip. */
  _crawlConflictDialog(keyMode = "hex") {
    return async (name) => {
      const safe = foundry.utils.escapeHTML(name);
      const kind = keyMode === "location" ? "numbered-location journal" : "crawl";
      const unit = keyMode === "location" ? "locations" : "hexes";
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Journal Already Exists" },
        content: `<p>A ${kind} named <strong>${safe}</strong> (same source) already exists in the journal compendium.</p>
          <p>Updating in place keeps every page's id — map pins stay valid. Pages for ${unit} not in this paste are left untouched. (Renaming it instead creates a separate entry.)</p>`,
        buttons: [
          { action: "update", label: "Update in place", default: true },
          { action: "copy",   label: "Create separate copy" },
          { action: "skip",   label: "Skip" },
        ],
        rejectClose: false,
      }).catch(() => "skip");
      return choice ?? "skip";
    };
  }

  /** Commit parsed hex or numbered-location drafts as one keyed journal. */
  async _onHubCommitJournal() {
    if (!game.user?.isGM) return;
    if (!this._importHexes.length) return;
    const crawlName = (this._importCrawlName ?? "").trim();
    if (!crawlName) {
      ui.notifications.warn("Give the journal a name before creating it.");
      return;
    }
    const { JournalImporter } = await import("./journal-importer.mjs");
    const result = await JournalImporter.createOrUpdateKeyedJournal(this._importHexes, {
      crawlName,
      source: this._importSource.trim(),
      keyMode: this._importKeyMode,
      onConflict: this._crawlConflictDialog(this._importKeyMode),
    });
    if (!result || result.status === "skipped") return;
    ui.notifications.info(
      `"${result.name}" ${result.status}: ${result.pages.created} page(s) created, ${result.pages.updated} updated → sde-journal.`);
    this._importHexes = [];
    this._importCrawlName = "";
    this.render();
  }

  _pickSceneImage(current = "") {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || null);
      };
      const picker = new foundry.applications.apps.FilePicker.implementation({
        type: "image",
        current,
        callback: (path) => finish(path),
      });
      const close = picker.close.bind(picker);
      picker.close = async (...args) => {
        const result = await close(...args);
        finish(null);
        return result;
      };
      picker.render(true);
    });
  }

  _captureSceneCalibration(imagePath) {
    return new Promise((resolve) => {
      const points = [];
      const overlay = document.createElement("div");
      overlay.className = "sde-scene-calibration-overlay";

      const panel = document.createElement("div");
      panel.className = "sde-scene-calibration-panel";
      overlay.append(panel);

      const title = document.createElement("h2");
      title.textContent = "Calibrate Hex Map";
      const status = document.createElement("p");
      status.textContent = "Click the center of hex 0101.";
      panel.append(title, status);

      const frame = document.createElement("div");
      frame.className = "sde-scene-calibration-frame";
      const image = document.createElement("img");
      image.alt = "Map calibration preview";
      image.src = imagePath;
      frame.append(image);
      panel.append(frame);

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      panel.append(cancel);

      const cleanup = () => {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
      };
      const finish = (value) => {
        cleanup();
        resolve(value);
      };
      const onKey = (event) => {
        if (event.key === "Escape") finish(null);
      };
      document.addEventListener("keydown", onKey);
      cancel.addEventListener("click", () => finish(null));
      image.addEventListener("error", () => {
        ui.notifications.error("The selected map image could not be loaded.");
        finish(null);
      });
      image.addEventListener("click", (event) => {
        const rect = image.getBoundingClientRect();
        const point = {
          x: (event.clientX - rect.left) * (image.naturalWidth / rect.width),
          y: (event.clientY - rect.top) * (image.naturalHeight / rect.height),
        };
        points.push(point);

        const marker = document.createElement("span");
        marker.className = "sde-scene-calibration-marker";
        marker.style.left = `${event.clientX - rect.left}px`;
        marker.style.top = `${event.clientY - rect.top}px`;
        marker.textContent = String(points.length);
        frame.append(marker);

        if (points.length === 1) {
          status.textContent = "Now click the center of hex 1611.";
        } else {
          finish({ p1: points[0], p2: points[1], ref1: "1,1", ref2: "16,11" });
        }
      });
      document.body.append(overlay);
    });
  }

  async _chooseLocationGridProfile() {
    const selection = await foundry.applications.api.DialogV2.wait({
      window: { title: "Location Map Grid" },
      content: `<p>Choose how Foundry should configure this adventure map.</p>
        <div class="form-group">
          <label>Grid mode</label>
          <select name="grid-mode">
            <option value="gridless">Gridless</option>
            <option value="square">Square grid</option>
          </select>
        </div>
        <div class="form-group"><label>Columns</label><input type="number" name="columns" min="1" value="68"></div>
        <div class="form-group"><label>Rows</label><input type="number" name="rows" min="1" value="44"></div>
        <div class="form-group"><label>Distance per square</label><input type="number" name="distance" min="1" value="5"></div>
        <div class="form-group"><label>Units</label><input type="text" name="units" value="ft"></div>
        <p class="hint">Columns and rows are used only for square-grid maps. Foundry requires an integer grid size, so the scene may be a few pixels larger than the source image.</p>`,
      buttons: [
        {
          action: "select",
          label: "Continue",
          default: true,
          callback: (ev, button, dialog) => {
            const root = dialog.element ?? dialog;
            return {
              gridMode: root?.querySelector?.("[name='grid-mode']")?.value ?? "gridless",
              columns: Number(root?.querySelector?.("[name='columns']")?.value),
              rows: Number(root?.querySelector?.("[name='rows']")?.value),
              distance: Number(root?.querySelector?.("[name='distance']")?.value),
              units: root?.querySelector?.("[name='units']")?.value?.trim() || "ft",
            };
          },
        },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!selection || selection === "cancel") return null;
    if (selection.gridMode === "square" &&
        (![selection.columns, selection.rows, selection.distance].every((value) =>
          Number.isFinite(value) && value > 0))) {
      ui.notifications.warn("Square-grid columns, rows, and distance must be positive numbers.");
      return null;
    }
    return selection;
  }

  /**
   * Capture one pointer click in Scene coordinates. Escape cancels and every
   * exit path removes the temporary PIXI + keyboard listeners.
   */
  _captureCanvasPoint(scene) {
    return new Promise((resolve) => {
      if (!canvas?.ready || canvas.scene?.id !== scene?.id || !canvas.stage?.toLocal) {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        canvas.stage.off("pointerdown", onPointerDown);
        window.removeEventListener("keydown", onKeyDown);
        if (this._pendingCanvasCapture === cancelCapture) {
          this._pendingCanvasCapture = null;
        }
        resolve(value);
      };
      const onPointerDown = (event) => {
        try {
          const local = canvas.stage.toLocal(event.global);
          finish({ x: local.x, y: local.y });
        } catch (err) {
          console.error(`${MODULE_ID} | canvas point conversion failed:`, err);
          finish(null);
        }
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") finish(null);
      };
      const cancelCapture = () => finish(null);
      this._pendingCanvasCapture = cancelCapture;
      canvas.stage.on("pointerdown", onPointerDown);
      window.addEventListener("keydown", onKeyDown);
      ui.notifications.info("Click the location on the map. Press Escape to stop keying.");
    });
  }

  async _activateLocationScene(scene) {
    if (canvas?.ready && canvas.scene?.id === scene.id) return true;
    const canvasReady = new Promise((resolve) => {
      let timer;
      const hookId = Hooks.once("canvasReady", () => {
        clearTimeout(timer);
        resolve(true);
      });
      timer = setTimeout(() => {
        Hooks.off("canvasReady", hookId);
        resolve(false);
      }, 15000);
    });
    await scene.activate();
    return canvasReady;
  }

  async _keyLocationScene({ crawl, scene, worldJournal, SceneBuilder }) {
    const pages = crawl.pages.contents
      .filter((page) => String(page.flags?.[MODULE_ID]?.key ?? "").startsWith("loc:"))
      .sort((a, b) =>
        Number(a.flags[MODULE_ID].locationId) - Number(b.flags[MODULE_ID].locationId));
    let placed = 0;
    let skipped = 0;

    for (const packPage of pages) {
      const key = packPage.flags[MODULE_ID].key;
      const progress = scene.flags?.[MODULE_ID]?.locationProgress ?? {};
      if (progress.placed?.includes(key) || progress.skipped?.includes(key)) continue;
      const safeName = foundry.utils.escapeHTML(packPage.name);
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: `Key ${packPage.name}` },
        content: `<p><strong>${safeName}</strong></p>
          <p>Place this journal pin on the active map, skip it, or stop and resume later.</p>`,
        buttons: [
          { action: "place", label: "Click map", default: true },
          { action: "skip", label: "Skip" },
          { action: "stop", label: "Stop" },
        ],
        rejectClose: false,
      }).catch(() => "stop");
      if (!choice || choice === "stop") break;
      if (choice === "skip") {
        await SceneBuilder.skipLocation({ scene, key });
        skipped++;
        continue;
      }

      const point = await this._captureCanvasPoint(scene);
      if (!point) break;
      const worldPage = worldJournal.pages.get(packPage.id);
      if (!worldPage) throw new Error(`World journal page ${packPage.id} is missing`);
      await SceneBuilder.placeLocationNote({ scene, page: worldPage, key, point });
      placed++;
    }
    return { placed, skipped };
  }

  async _buildLocationScene(crawl, SceneBuilder) {
    const existingScenes = game.scenes.contents
      .filter((scene) =>
        scene.flags?.[MODULE_ID]?.keyMode === "location" &&
        scene.flags?.[MODULE_ID]?.journalId === crawl.id)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (existingScenes.length) {
      const options = existingScenes
        .map((scene) => `<option value="${scene.id}">${foundry.utils.escapeHTML(scene.name)}</option>`)
        .join("");
      const resume = await foundry.applications.api.DialogV2.wait({
        window: { title: "Resume Location Keying" },
        content: `<p>A deployed map already exists for <strong>${foundry.utils.escapeHTML(crawl.name)}</strong>.</p>
          <select name="scene-id" style="width:100%">${options}</select>
          <p class="hint">Resume continues with the first location that is neither placed nor skipped.</p>`,
        buttons: [
          {
            action: "resume",
            label: "Resume",
            default: true,
            callback: (ev, button, dialog) => ({
              action: "resume",
              sceneId: (dialog.element ?? dialog)?.querySelector?.("[name='scene-id']")?.value,
            }),
          },
          { action: "new", label: "Create another map", callback: () => ({ action: "new" }) },
          { action: "cancel", label: "Cancel", callback: () => ({ action: "cancel" }) },
        ],
        rejectClose: false,
      }).catch(() => null);
      if (!resume || resume.action === "cancel") return;
      if (resume.action === "resume") {
        const scene = game.scenes.get(resume.sceneId);
        if (!scene) throw new Error("The selected location Scene no longer exists");
        const worldJournal = await SceneBuilder.deployCrawlJournal(crawl);
        await this._activateLocationScene(scene);
        const keyed = await this._keyLocationScene({
          crawl,
          scene,
          worldJournal,
          SceneBuilder,
        });
        ui.notifications.info(
          `Location map "${crawl.name}" resumed: ${keyed.placed} placed, ${keyed.skipped} skipped this run.`);
        return;
      }
    }

    const imagePath = await this._pickSceneImage();
    if (!imagePath) return;
    const profile = await this._chooseLocationGridProfile();
    if (!profile) return;
    const pageCount = crawl.pages.contents.filter((page) =>
      String(page.flags?.[MODULE_ID]?.key ?? "").startsWith("loc:")).length;
    const safeName = foundry.utils.escapeHTML(crawl.name);
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Deploy Location Map" },
      content: `<p>Deploy <strong>${safeName}</strong> into the world and create a
        ${profile.gridMode === "square" ? `${profile.columns} × ${profile.rows} square-grid` : "gridless"} scene.</p>
        <p>After the scene opens, you will place or skip ${pageCount} location pin(s). Progress and the sde-scenes backup are updated after every choice.</p>`,
      buttons: [
        { action: "deploy", label: "Deploy", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    if (choice !== "deploy") return;

    const result = await SceneBuilder.createLocationScene({
      crawlId: crawl.id,
      crawlName: crawl.name,
      source: crawl.flags?.[MODULE_ID]?.source ?? "",
      imagePath,
      ...profile,
    });
    if (!result) return;

    await this._activateLocationScene(result.scene);
    const keyed = await this._keyLocationScene({
      crawl,
      scene: result.scene,
      worldJournal: result.journal,
      SceneBuilder,
    });
    ui.notifications.info(
      `Location map "${crawl.name}" ready: ${keyed.placed} placed, ${keyed.skipped} skipped this run.`);
  }

  /** Deploy a managed crawl journal into the world and build its pinned scene. */
  async _onHubBuildScene() {
    if (!game.user?.isGM) return;
    const { findSuitePack } = await import("./compendium-suite.mjs");
    const { splitNorthSouth, SceneBuilder } = await import("./scene-builder.mjs");
    const pack = findSuitePack("sde-journal");
    if (!pack) {
      ui.notifications.warn("No sde-journal compendium found.");
      return;
    }

    const index = await pack.getIndex({ fields: ["flags"] });
    const crawls = [...index]
      .filter((entry) => entry.flags?.[MODULE_ID]?.crawl === true)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!crawls.length) {
      ui.notifications.warn("Create a keyed journal before building its scene.");
      return;
    }

    const options = crawls.map((entry) => {
      const source = entry.flags?.[MODULE_ID]?.source;
      const kind = String(entry.flags?.[MODULE_ID]?.keyMode ?? "hex") === "location"
        ? "locations"
        : "hexes";
      const label = `${entry.name}${source ? ` (${source})` : ""}`;
      return `<option value="${foundry.utils.escapeHTML(entry._id)}">${foundry.utils.escapeHTML(label)} — ${kind}</option>`;
    }).join("");
    const selection = await foundry.applications.api.DialogV2.wait({
      window: { title: "Build Map Scene" },
      content: `<p>Select a keyed journal to deploy into the world.</p>
        <select name="crawl-id" style="width:100%">${options}</select>
        <label style="display:flex;gap:.5rem;align-items:center;margin-top:.75rem">
          <input type="checkbox" name="calibrate"> Calibrate hex map with two reference clicks
        </label>
        <p class="hint">Hex journals use the standard template unless calibrated. Numbered-location journals ask for gridless or square-grid settings next.</p>`,
      buttons: [
        {
          action: "select",
          label: "Select",
          default: true,
          callback: (ev, button, dialog) => {
            const root = dialog.element ?? dialog;
            return {
              crawlId: root?.querySelector?.("select[name='crawl-id']")?.value ?? null,
              calibrate: !!root?.querySelector?.("input[name='calibrate']")?.checked,
            };
          },
        },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!selection || selection === "cancel" || !selection.crawlId) return;

    const crawl = await pack.getDocument(selection.crawlId);
    if (!crawl) {
      ui.notifications.error("That crawl journal could not be opened.");
      return;
    }
    if (String(crawl.flags?.[MODULE_ID]?.keyMode ?? "hex") === "location") {
      try {
        await this._buildLocationScene(crawl, SceneBuilder);
      } catch (err) {
        console.error(`${MODULE_ID} | location scene-builder: deploy failed:`, err);
        ui.notifications.error("Location scene deployment failed - see the console for details.");
      }
      return;
    }
    const keys = crawl.pages.contents
      .map((page) => page.flags?.[MODULE_ID]?.key)
      .filter(Boolean);
    const parts = splitNorthSouth(keys);

    const northImage = await this._pickSceneImage();
    if (!northImage) return;
    const southImage = parts.south.length ? await this._pickSceneImage() : null;
    if (parts.south.length && !southImage) return;
    let calib;
    if (selection.calibrate) {
      const clicks = await this._captureSceneCalibration(northImage);
      if (!clicks) return;
      calib = SceneBuilder.solveCalibration(clicks.p1, clicks.p2, clicks.ref1, clicks.ref2);
    }

    const safeName = foundry.utils.escapeHTML(crawl.name);
    const imageRows = [
      `<li>North / map image: ${foundry.utils.escapeHTML(northImage)}</li>`,
      southImage ? `<li>South map image: ${foundry.utils.escapeHTML(southImage)}</li>` : "",
    ].filter(Boolean).join("");
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Deploy Crawl" },
      content: `<p>Deploy <strong>${safeName}</strong> into the world and create
        ${parts.south.length ? "two gridless scenes" : "one gridless scene"} with ${keys.length} Note pin(s).</p>
        <ul>${imageRows}</ul>
        <p>Calibration: ${selection.calibrate ? "two-click custom alignment" : "standard template constants"}.</p>
        <p>The world journal keeps the compendium entry/page IDs; finished scenes are also backed up to sde-scenes.</p>`,
      buttons: [
        { action: "deploy", label: "Deploy", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    if (choice !== "deploy") return;

    try {
      const result = await SceneBuilder.buildCrawlScene({
        crawlId: crawl.id,
        crawlName: crawl.name,
        source: crawl.flags?.[MODULE_ID]?.source ?? "",
        imagePath: northImage,
        southImagePath: southImage,
        calib,
      });
      if (!result) return;
      const names = result.scenes.map((entry) => entry.scene.name).join(", ");
      ui.notifications.info(
        `Deployed "${crawl.name}": ${result.scenes.length} scene(s), ${result.notes} pin(s) - ${names}.`);
    } catch (err) {
      console.error(`${MODULE_ID} | scene-builder: deploy failed:`, err);
      ui.notifications.error("Crawl scene deployment failed - see the console for details.");
    }
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

    // Read the keeper from the checked radio inside this group's CARD. The
    // button itself also carries data-group-key, and closest() matches from
    // the element itself — so [data-group-key] resolved to the BUTTON and the
    // radio lookup always came up empty ("Select a keeper" even with one
    // checked; live-caught, Phase 15 follow-up).
    const card = target.closest(".sde-hub-monsters-dup-card");
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
