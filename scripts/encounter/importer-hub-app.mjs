/**
 * Shadowdark Enhancer — Importer Hub (ApplicationV2).
 *
 * A single-view universal importer: paste a raw dump, pick what you're
 * importing (Auto-detect / Monsters / Items / Spells / Tables), preview &
 * edit, then commit to the suite compendia. Auto-detect sorts mixed dumps via
 * dump-segmenter; choosing a specific type runs only that recognizer. A
 * collapsible "Manage" strip (lazy) carries the maintenance tools — monster &
 * item census/duplicate-cull, relink/migrate tables, fold legacy loot,
 * backfill, migrate-suite.
 *
 * The Cursed Scroll adventure pipeline (Journal + Scenes) and the CS1–6/WR
 * content-manifest reconcile live on `preserve/scene-journal-adventure`.
 *
 * Export:
 *   ImporterHubApp  — the ApplicationV2 class
 *   ImporterHubAPI  — { open(tab, seed) } for entry-point wiring
 */
import { TableImporter, parseTables, parseGenerators } from "./table-importer.mjs";
import { npcMoveKeys } from "./npc-moves.mjs";
import { LootLinker } from "./loot-linker.mjs";
import { CATEGORIES, CUSTOM_ID } from "./table-categories.mjs";
import { columnManifestId } from "./table-manifest.mjs";
import { segmentDump } from "./dump-segmenter.mjs";
import { parseStatblock, splitStatblocks } from "./statblock-parser.mjs";
import { itemRecognizer } from "./item-parser.mjs";
import { spellRecognizer } from "./spell-parser.mjs";
import { resolveSpellClass } from "./class-index.mjs";
import { MonsterImporter } from "./monster-importer.mjs";
import { gatherCensus, gatherDuplicates, cullDuplicates } from "./monster-census-live.mjs";
import { gatherItemCensus, gatherItemDuplicates, cullItemDuplicates } from "./item-census-live.mjs";
import { parseCharContent, expandNamePartTables, normalizeTwoColumnRanges, CHAR_SOURCES } from "./char-content-manifest.mjs";
import { buildManageTree } from "./manage-tree.mjs";
import { MODULE_ID } from "../module-id.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Common source labels offered as datalist suggestions. */
const SOURCE_SUGGESTIONS = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];


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
      // Parse / clear
      hubParse:               ImporterHubApp.prototype._onHubParse,
      hubParseCompound:       ImporterHubApp.prototype._onHubParseCompound,
      hubClear:               ImporterHubApp.prototype._onHubClear,
      // Monster section structural actions
      mimportAddAttack:       ImporterHubApp.prototype._onMimportAddAttack,
      mimportAddSpecial:      ImporterHubApp.prototype._onMimportAddSpecial,
      mimportRemoveAttack:    ImporterHubApp.prototype._onMimportRemoveAttack,
      mimportAddFeature:      ImporterHubApp.prototype._onMimportAddFeature,
      mimportRemoveFeature:   ImporterHubApp.prototype._onMimportRemoveFeature,
      mimportRemoveMonster:   ImporterHubApp.prototype._onMimportRemoveMonster,
      // Item section structural actions
      iimportRemoveItem:      ImporterHubApp.prototype._onIimportRemoveItem,
      // Spell section structural actions
      simportRemoveSpell:     ImporterHubApp.prototype._onSimportRemoveSpell,
      // Table section structural actions
      importAddRow:           ImporterHubApp.prototype._onImportAddRow,
      importDeleteRow:        ImporterHubApp.prototype._onImportDeleteRow,
      importUnlinkRow:        ImporterHubApp.prototype._onImportUnlinkRow,
      // Compound-generator structural actions
      genAddColumn:           ImporterHubApp.prototype._onGenAddColumn,
      genRemoveColumn:        ImporterHubApp.prototype._onGenRemoveColumn,
      genAddRow:              ImporterHubApp.prototype._onGenAddRow,
      genDeleteRow:           ImporterHubApp.prototype._onGenDeleteRow,
      // Commit actions
      hubCommitMonsters:      ImporterHubApp.prototype._onHubCommitMonsters,
      hubCommitItems:         ImporterHubApp.prototype._onHubCommitItems,
      hubCommitSpells:        ImporterHubApp.prototype._onHubCommitSpells,
      hubCommitTables:        ImporterHubApp.prototype._onHubCommitTables,
      hubCommitGenerators:    ImporterHubApp.prototype._onHubCommitGenerators,
      hubCommitAll:           ImporterHubApp.prototype._onHubCommitAll,
      // Bundle export/import
      hubExportBundle:        ImporterHubApp.prototype._onExportBundle,
      hubImportBundle:        ImporterHubApp.prototype._onImportBundle,
      // Manage strip — census/gap/duplicate + maintenance
      monsterGapExpand:       ImporterHubApp.prototype._onMonsterGapExpand,
      monsterSeedPaste:       ImporterHubApp.prototype._onMonsterSeedPaste,
      monsterCullGroup:       ImporterHubApp.prototype._onMonsterCullGroup,
      itemGapExpand:          ImporterHubApp.prototype._onItemGapExpand,
      itemSeedPaste:          ImporterHubApp.prototype._onItemSeedPaste,
      itemCullGroup:          ImporterHubApp.prototype._onItemCullGroup,
      manageNodeExpand:       ImporterHubApp.prototype._onManageNodeExpand,
      manageExpandAll:        ImporterHubApp.prototype._onManageExpandAll,
      manageCollapseAll:      ImporterHubApp.prototype._onManageCollapseAll,
      charSeedPaste:          ImporterHubApp.prototype._onCharSeedPaste,
      hubCommitChar:          ImporterHubApp.prototype._onHubCommitChar,
      hubRelinkTables:        ImporterHubApp.prototype._onRelinkTables,
      migrateCompendium:      ImporterHubApp.prototype._onMigrateCompendium,
      hubFoldLegacyLoot:      ImporterHubApp.prototype._onFoldLegacyLoot,
      mimportBackfill:        ImporterHubApp.prototype._onBackfill,
      mimportMigrateSuite:    ImporterHubApp.prototype._onMigrateSuite,
    },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/importer-hub.hbs" },
  };

  // ── Import type selector ───────────────────────────────────────────────────
  /** @type {"auto"|"monsters"|"items"|"spells"|"tables"|"backgrounds"|"talents"|"classes"|"ancestries"} */
  _importType = "auto";
  /** Forced item subtype when importing items ("auto" = name inference). */
  _importItemSubtype = "auto";
  /** Dice spec for compound generators ("3d6"/"2d10"; "" = auto-detect). */
  _importGenSpec = "";

  // ── Import seed (set by a Manage-strip census gap "Seed" click) ────────────
  /** @type {object|null} Carries a per-row Import seed; applied on parse. */
  _importSeed = null;

  // ── Character content (Backgrounds/Talents/Classes unlock flow) ────────────
  /** @type {Array<{draft: object}>} Parsed char-content drafts awaiting commit. */
  _importChar = [];

  // ── Import content state ───────────────────────────────────────────────────
  /** Raw paste text (stashed on input, committed on blur/parse). */
  _importText = "";
  /** Monster parse results: [{ draft, warnings }] */
  _importMonsters = [];
  /** Item parse results: [{ draft, warnings }] */
  _importItems = [];
  /** Spell parse results: [{ draft, warnings }] */
  _importSpells = [];
  /** Table parse results: ParsedTable[] */
  _importTables = [];
  /** Compound-generator parse results: ParsedTable[] with isCompound + compound.columns */
  _importGenerators = [];
  /** Skipped blocks (from segmenter + parser): [{ name, reason }] */
  _importSkipped = [];
  /** Source label (free-text, feeds the import folder). */
  _importSource = "";
  /** Paste-box focus/cursor preservation. */
  _importTextFocused = false;
  _importTextCursor = 0;

  // ── Manage strip (collapsible, lazy) ───────────────────────────────────────
  /** Whether the Manage strip is expanded (its census is computed only then). */
  _manageExpanded = false;
  /** Built Manage tree (top-level nodes), invalidated on cull/commit/migrate. @type {Array|null} */
  _manageTreeCache = null;
  /** Node ids currently expanded in the Manage tree (starts fully collapsed). */
  _manageExpandedNodes = new Set();

  // ── Monsters-tab census cache ─────────────────────────────────────────────
  /**
   * Cached monsters-tab data (invalidated after cull/import/commit).
   * Shape: { rows, duplicateGroups, duplicateCount } or null.
   * @type {object|null}
   */
  _monstersCache = null;
  /** Pending cache refresh (debounce). */
  _monstersCacheTimer = null;
  /** Which monster gap rows are expanded: Set of source ids. */
  _expandedGapRows = new Set();

  // ── Items-tab census cache ────────────────────────────────────────────────
  /** Cached items-tab data (invalidated after cull/fold/commit). @type {object|null} */
  _itemsCache = null;
  /** Which item gap rows are expanded: Set of source ids. */
  _expandedItemGapRows = new Set();

  // ── Singleton lifecycle ────────────────────────────────────────────────────

  static _instance = null;

  /**
   * Open (or bring forward) the single-view importer.
   * @param {*} [_tab] - Ignored (legacy tab arg; the hub is one view now).
   * @param {object|null} [seed=null] - Optional per-row Import seed for the paste box.
   */
  static open(_tab = null, seed = null) {
    if (!this._instance) this._instance = new ImporterHubApp();
    const inst = this._instance;
    if (seed) inst._importSeed = seed;
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }

  async close(options = {}) {
    ImporterHubApp._instance = null;
    return super.close(options);
  }

  // ── Context preparation ────────────────────────────────────────────────────

  async _prepareContext() {
    const moveOptions = npcMoveKeys();

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

    const importSpellCards = this._importSpells.map((p, i) => ({
      idx: i,
      draft: p.draft,
      warnings: p.warnings ?? [],
      hasWarnings: (p.warnings?.length ?? 0) > 0,
      warnCount: p.warnings?.length ?? 0,
    }));

    const categoryOptions = [
      ...CATEGORIES.map(c => ({ id: c.id, label: c.label })),
      { id: CUSTOM_ID, label: "Custom…" },
    ];

    // Compound generators → row-major grid for the editable preview.
    const importGenerators = this._importGenerators.map((g, i) => {
      const cols = g.compound?.columns ?? g.columns ?? [];
      const size = Math.max(1, cols.reduce((m, c) =>
        Math.max(m, (c.rows ?? []).reduce((mm, r) => Math.max(mm, r.max), 0)), 0));
      const faces = [];
      for (let f = 1; f <= size; f++) {
        faces.push({
          face: f,
          cells: cols.map((c, ci) => {
            const row = (c.rows ?? []).find(r => f >= r.min && f <= r.max);
            return { colIdx: ci, text: row?.text ?? "" };
          }),
        });
      }
      return {
        idx: i,
        name: g.name,
        formula: g.formula,
        separator: g.compound?.separator ?? g.separator ?? " ",
        columns: cols.map((c, ci) => ({ idx: ci, label: c.label })),
        colCount: cols.length,
        faces,
        warnings: g.warnings ?? [],
        hasWarnings: (g.warnings?.length ?? 0) > 0,
      };
    });

    const hasMonsters = importMonsterCards.length > 0;
    const hasItems    = this._importItems.length > 0;
    const hasSpells   = importSpellCards.length > 0;
    const hasTables   = this._importTables.length > 0;
    const hasGenerators = importGenerators.length > 0;
    const showImportAll = [hasMonsters, hasItems, hasSpells, hasTables].filter(Boolean).length > 1;

    const t = this._importType;
    const importData = {
      text: this._importText,
      source: this._importSource,
      sourceSuggestions: SOURCE_SUGGESTIONS,
      seed: this._importSeed,
      // Post-parse feedback for a seeded import: what landed, so the GM can
      // tell at a glance whether the paste worked.
      seedResult: (() => {
        if (!this._importSeed || !this._importTables.length) return null;
        const t = this._importTables[0];
        const rows = t.rows?.length ?? 0;
        // Structural problems = gap/overlap warnings from the parser. Auto-fix
        // and range-rebuild notes are informational (the table is complete) and
        // don't count against correctness.
        const structural = (t.warnings ?? []).filter((w) => !/^(Auto-fixed|Rebuilt)\b/.test(w));
        // Names tables additionally have a known-correct shape: 100 on 1d100.
        const isNames = /\bnames$/i.test(this._importSeed.name ?? "");
        const ok = structural.length === 0 && (!isNames || (rows === 100 && t.formula === "1d100"));
        return { name: t.name, formula: t.formula, rows, ok,
          expected: isNames ? "100 rows on 1d100" : "full die coverage — see the warnings on the card" };
      })(),
      // Type selector
      importType: t,
      typeOptions: [
        { value: "auto",     label: "Auto-detect" },
        { value: "monsters", label: "Monsters" },
        { value: "items",    label: "Items" },
        { value: "spells",   label: "Spells" },
        { value: "tables",   label: "Tables" },
        { value: "generators", label: "Generators (roll-all)" },
        { value: "backgrounds", label: "Backgrounds" },
        { value: "talents",  label: "Talents" },
        { value: "classes",  label: "Class" },
        { value: "ancestries", label: "Ancestry" },
      ].map(o => ({ ...o, selected: o.value === t })),
      showItemSubtype: t === "items" || t === "auto",
      showGenSpec: t === "generators",
      genSpec: this._importGenSpec,
      itemSubtype: this._importItemSubtype,
      itemSubtypeOptions: [
        { value: "auto", label: "Auto (by name)" },
        ...["Basic", "Weapon", "Armor", "Potion", "Scroll", "Wand"].map(v => ({ value: v, label: v })),
      ].map(o => ({ ...o, selected: o.value === this._importItemSubtype })),
      // Previews
      monsters: importMonsterCards,
      items: this._importItems,
      spells: importSpellCards,
      tables: this._importTables,
      generators: importGenerators,
      skipped: this._importSkipped,
      hasMonsters, hasItems, hasSpells, hasTables, hasGenerators, showImportAll,
      chars: this._importSealed
        ? this._importSealed.payload.docs.map((d) => ({
            name: d.data.name,
            type: d.kind === "RollTable" ? "Table" : d.data.type,
            preview: "🔓 sealed content — verified, imports exactly as authored",
          }))
        : this._importChar.map((p) => ({
            name: p.draft.name,
            type: p.draft.type,
            preview: String(p.draft.description ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 140),
          })),
      hasChar: this._importChar.length > 0 || !!this._importSealed,
      charsCount: this._importSealed?.payload.docs.length ?? this._importChar.length,
      skippedCount: this._importSkipped.length,
      monstersCount: importMonsterCards.length,
      itemsCount: this._importItems.length,
      spellsCount: importSpellCards.length,
      tablesCount: this._importTables.length,
      generatorsCount: importGenerators.length,
      // Option lists
      itemTypeOptions: ["Basic", "Weapon", "Armor", "Potion", "Scroll", "Wand"],
      spellRanges: ["self", "touch", "close", "near", "doubleNear", "far"],
      spellDurationTypes: ["instant", "focus", "permanent", "rounds", "days", "turns"],
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

    // ── Manage strip — lazy: census/duplicate scans run only when expanded ────
    let manage = null;
    if (this._manageExpanded) {
      const [monstersData, itemsData, tree] = await Promise.all([
        this._prepareMonstersContext(),
        this._prepareItemsContext(),
        this._prepareManageTree(),
      ]);
      manage = { monstersData, itemsData, tree };
    }

    return { importData, manageExpanded: this._manageExpanded, manage };
  }

  /**
   * Prepare Monsters-tab context: per-source live census rows merged with gap
   * counts (monster names referenced in pack tables that don't resolve to an
   * owned/system actor), plus duplicate groups. Cached per render cycle;
   * invalidated on cull/import/commit.
   *
   * @returns {Promise<object>}
   */
  async _prepareMonstersContext() {
    if (!this._monstersCache) {
      const [rows, dupGroups] = await Promise.all([
        gatherCensus().catch((err) => {
          console.error("shadowdark-enhancer | gatherCensus failed:", err);
          return [];
        }),
        gatherDuplicates().catch((err) => {
          console.error("shadowdark-enhancer | gatherDuplicates failed:", err);
          return [];
        }),
      ]);
      this._monstersCache = { rows, duplicateGroups: dupGroups, duplicateCount: dupGroups.length };
    }
    return this._censusContext(this._monstersCache, this._expandedGapRows, "monsterSeedPaste");
  }

  /**
   * Shape a cached census ({ rows, duplicateGroups, duplicateCount }) for the
   * Monsters/Items dashboard template: per-source rows with expand state and a
   * gap-name list, plus the duplicate cards. Replaces the former manifest
   * `_catalogContext` — there is no source/manifest reconcile anymore.
   */
  _censusContext(cache, expandedSet, seedAction) {
    const { rows, duplicateGroups: dupGroups, duplicateCount } = cache;
    const expandAction = seedAction === "monsterSeedPaste" ? "monsterGapExpand" : "itemGapExpand";
    // Stamp the per-row/per-name action strings so the template only ever reads
    // block params (no parent/`../` lookups across {{#each}} depths).
    const censusRows = rows.map((r) => ({
      label:        r.label,
      have:         r.have ?? 0,
      gap:          r.gap ?? 0,
      hasGap:       (r.gap ?? 0) > 0,
      expanded:     expandedSet.has(r.label),
      expandAction,
      missingNames: (r.missingNames ?? []).map((name) => ({ name, seedAction })),
    }));
    const dupGroupsCtx = dupGroups.map((g) => ({
      ...g,
      members: g.members.map((m) => ({
        ...m,
        date: m.date ? new Date(m.date).toLocaleDateString() : null,
      })),
    }));
    return {
      censusRows,
      totalHave:       censusRows.reduce((a, r) => a + r.have, 0),
      totalGap:        censusRows.reduce((a, r) => a + r.gap, 0),
      noCensus:        censusRows.length === 0,
      duplicateGroups: dupGroupsCtx,
      duplicateCount,
      hasDuplicates:   dupGroups.length > 0,
    };
  }

  /** Invalidate the monsters-tab cache. */
  _invalidateMonstersCache() {
    this._monstersCache = null;
    clearTimeout(this._monstersCacheTimer);
    this._invalidateManageTree();
  }

  /**
   * Prepare Items-tab context: per-source live census rows merged with gap
   * counts (item names referenced in loot/treasure pack tables that don't
   * resolve), plus duplicate groups. Parallels _prepareMonstersContext.
   *
   * @returns {Promise<object>}
   */
  async _prepareItemsContext() {
    if (!this._itemsCache) {
      // gatherItemCensus returns { total, typeCounts, rows } — unwrap rows
      // (unlike gatherCensus, which returns the row array directly).
      const [census, dupGroups] = await Promise.all([
        gatherItemCensus().catch((err) => {
          console.error("shadowdark-enhancer | gatherItemCensus failed:", err);
          return { rows: [] };
        }),
        gatherItemDuplicates().catch((err) => {
          console.error("shadowdark-enhancer | gatherItemDuplicates failed:", err);
          return [];
        }),
      ]);
      this._itemsCache = {
        rows: census.rows ?? [],
        duplicateGroups: dupGroups,
        duplicateCount: dupGroups.length,
      };
    }
    return this._censusContext(this._itemsCache, this._expandedItemGapRows, "itemSeedPaste");
  }

  /** Invalidate the items-tab cache. */
  _invalidateItemsCache() {
    this._itemsCache = null;
    this._invalidateManageTree();
  }

  /**
   * Prepare the Manage tree: compose the character-content / monsters / items
   * censuses into the nested folder tree (buildManageTree, cached), then stamp
   * each node with its expand state and depth for the recursive template.
   */
  async _prepareManageTree() {
    if (!this._manageTreeCache) {
      this._manageTreeCache = await buildManageTree().catch((err) => {
        console.error("shadowdark-enhancer | buildManageTree failed:", err);
        return [];
      });
    }
    const applyState = (node, depth) => {
      node.depth = depth;
      node.expandable = node.children.length > 0 || node.entries.length > 0;
      node.expanded = this._manageExpandedNodes.has(node.id);
      node.children.forEach((c) => applyState(c, depth + 1));
      return node;
    };
    return this._manageTreeCache.map((n) => applyState(n, 0));
  }

  /** Invalidate the built Manage tree (content changed). */
  _invalidateManageTree() {
    this._manageTreeCache = null;
  }

  /** Invalidate the character-content caches (kept as the commit-flow entry point). */
  _invalidateCharCache() {
    this._invalidateManageTree();
  }

  // ── Render wiring ─────────────────────────────────────────────────────────

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Single-view wiring (always).
    this._wireHubType();
    this._wireHubPaste();
    this._wireHubSource();
    this._wireHubMonsterFieldEdits();
    this._wireHubItemFieldEdits();
    this._wireHubSpellFieldEdits();
    this._wireHubTableFieldEdits();
    this._wireHubGeneratorFieldEdits();

    // Manage strip: prepare its census lazily the first time it's expanded, so
    // opening the importer never triggers a world scan.
    const manage = this.element.querySelector("details[data-manage]");
    if (manage) {
      manage.addEventListener("toggle", () => {
        if (manage.open && !this._manageExpanded) { this._manageExpanded = true; this.render(); }
      });
    }
  }

  // ── Import-tab wiring helpers ─────────────────────────────────────────────

  /** Import-type selector + item-subtype override. */
  _wireHubType() {
    const typeSel = this.element.querySelector("select[data-import-type]");
    if (typeSel) typeSel.addEventListener("change", (ev) => { this._importType = ev.target.value; this.render(); });

    const subSel = this.element.querySelector("select[data-import-subtype]");
    if (subSel) subSel.addEventListener("change", (ev) => {
      this._importItemSubtype = ev.target.value;
      // Re-type any already-parsed items immediately.
      if (this._importItemSubtype !== "auto") {
        for (const it of this._importItems) it.draft.type = this._importItemSubtype;
      }
      this.render();
    });

    // Dice spec for generators — stash on input; consumed at Parse (no re-render).
    const specInput = this.element.querySelector("input[data-gen-spec]");
    if (specInput) specInput.addEventListener("input", (ev) => { this._importGenSpec = ev.target.value; });
  }

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
   * Compound-generator preview edits. Cell/label/name/separator edits commit in
   * place with NO re-render (focus stays put); only a formula change re-renders,
   * since it changes how many face-rows the grid shows.
   */
  _wireHubGeneratorFieldEdits() {
    this.element.querySelectorAll(".sde-import-gen [data-gen-field]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const g = this._importGenerators[Number(ev.target.closest("[data-gen-idx]")?.dataset.genIdx)];
        if (!g) return;
        const cols = g.compound?.columns ?? g.columns ?? [];
        const field = ev.target.dataset.genField;
        if (field === "name") { g.name = ev.target.value; }
        else if (field === "formula") {
          g.formula = ev.target.value;
          for (const c of cols) c.formula = ev.target.value;
          this.render(); // face count may change
        }
        else if (field === "separator") {
          const v = ev.target.value;
          g.separator = v;
          if (g.compound) g.compound.separator = v;
        }
        else if (field === "label") {
          const ci = Number(ev.target.dataset.colIdx);
          if (cols[ci]) cols[ci].label = ev.target.value;
        }
        else if (field === "cell") {
          const ci = Number(ev.target.dataset.colIdx);
          const face = Number(ev.target.dataset.face);
          const col = cols[ci];
          if (!col) return;
          let row = (col.rows ?? []).find(r => face >= r.min && face <= r.max);
          if (!row) { row = { min: face, max: face, text: "" }; (col.rows ??= []).push(row); col.rows.sort((a, b) => a.min - b.min); }
          row.text = ev.target.value;
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

  /** Spell preview field edits — commit in place, no re-render (keeps focus). */
  _wireHubSpellFieldEdits() {
    this.element.querySelectorAll("[data-simport-field]").forEach((el) => {
      el.addEventListener("change", (ev) => {
        const rowEl = ev.target.closest("[data-spell-idx]");
        if (!rowEl) return;
        const card = this._importSpells[Number(rowEl.dataset.spellIdx)];
        if (!card) return;
        const draft = card.draft;
        const field = ev.target.dataset.simportField;
        const v = ev.target.value;
        switch (field) {
          case "name":          draft.name = v; break;
          case "tier":          draft.tier = Number(v); break;
          case "className":     draft.className = v; break;
          case "range":         draft.range = v; break;
          case "durationType":  draft.duration = { ...draft.duration, type: v }; break;
          case "durationValue": draft.duration = { ...draft.duration, value: String(v) }; break;
          case "description": {
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
   * "Compound" shortcut: parse the current paste as a roll-all generator without
   * changing the type dropdown first. Prompts for the dice spec (e.g. 3d6 = 3
   * columns each on a d6), then forces the generators type + spec and parses.
   */
  async _onHubParseCompound() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;
    if (!this._importText.trim()) { ui.notifications.warn("Paste a table first, then click Compound."); return; }

    const spec = await foundry.applications.api.DialogV2.wait({
      window: { title: "Compound Generator", icon: "fas fa-dice-d6" },
      content: `
        <p>Roll <strong>every column once</strong> and combine the results in order
        (result 1 + result 2 + … = final).</p>
        <p style="display:flex;align-items:center;gap:0.5rem;">
          <label for="sde-compound-spec"><strong>Dice</strong></label>
          <input id="sde-compound-spec" name="spec" type="text" value="3d6" placeholder="e.g. 3d6 or 2d10" style="flex:1;">
        </p>
        <p class="notes"><code>3d6</code> = 3 columns, each rolled on a d6 (6 rows). Leave blank to auto-detect from the paste.</p>`,
      buttons: [
        { action: "parse", label: "Parse as compound", icon: "fas fa-dice-d6", default: true,
          callback: (event, button) => button.form.elements.spec.value },
        { action: "cancel", label: "Cancel", icon: "fas fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (spec == null || spec === "cancel") return;

    this._importType = "generators";
    this._importGenSpec = String(spec).trim();
    await this._onHubParse();
  }

  /**
   * Parse action: reads the paste box, runs segmentDump, maps monster chunks
   * via parseStatblock, applies the seed to the first table (if any), links
   * loot tables. Then re-renders.
   */
  async _onHubParse() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;
    const text = this._importText;
    const type = this._importType;

    // Sealed units first: if the paste contains the section's key phrases,
    // decrypt the pre-authored, verified documents instead of parsing.
    this._importSealed = null;
    const seed = this._importSeed;
    if (seed?._charSeed || seed?._monsterSeed) {
      const { sealedUnitsFor, tryUnseal } = await import("./sealed-content.mjs");
      // A monster-census seed carries no doc type; it always covers Actor units.
      const seedType = seed._monsterSeed ? "Actor" : seed.type;
      const candidates = sealedUnitsFor({ name: seed.name, type: seedType, source: seed.src });
      let best = { found: 0, total: 0, unit: null };
      for (const unit of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const res = await tryUnseal(unit, text);
        if (res.ok) {
          this._importSealed = { unit, payload: res.payload };
          this._importMonsters = []; this._importItems = []; this._importSpells = [];
          this._importTables = []; this._importChar = []; this._importSkipped = [];
          ui.notifications.info(`Unlocked "${unit.name}": ${res.payload.docs.length} verified documents ready — review below, then Create.`);
          this.render();
          return;
        }
        if (res.found > best.found) best = { found: res.found, total: res.total, unit };
      }
      if (best.unit && best.found) ui.notifications.warn(`"${best.unit.name}": found ${best.found}/${best.total} key phrases — paste the full section to unlock the verified version. Falling back to the text parser.`);
    }

    // Compound generators are an explicit type only (never in a mixed dump):
    // one table rolled once per column, cells combined in order. Parse and
    // return early — the table/char pipeline below doesn't apply.
    if (type === "generators") {
      this._importGenerators = parseGenerators(text, this._importGenSpec);
      this._importMonsters = []; this._importItems = []; this._importSpells = [];
      this._importTables = []; this._importChar = []; this._importSkipped = [];
      if (!this._importGenerators.length) {
        ui.notifications.warn("No compound generator recognized — need a die header (e.g. d6) and 2+ column labels (e.g. Detail 1, Detail 2…).");
      }
      this.render();
      return;
    }

    let monsters = [], items = [], spells = [], tables = [], skipped = [];

    // 2d10 name-part tables (ancestry Names) expand to d100 before anything
    // else sees the text, in both auto and tables modes.
    let nameTables = [];
    let effectiveText = text;
    let rangeNotes = [];
    if (type === "auto" || type === "tables") {
      const expanded = expandNamePartTables(text);
      nameTables = expanded.tables;
      // Two-column d100 spreads (trinkets etc.) fold into one column here.
      const normalized = normalizeTwoColumnRanges(expanded.remainder);
      effectiveText = normalized.text;
      rangeNotes = normalized.notes;
    }

    if (type === "auto") {
      // Sort a mixed dump across every recognizer.
      const seg = segmentDump(effectiveText);
      monsters = seg.monsters.map((chunk) => parseStatblock(chunk));
      items    = seg.items ?? [];
      spells   = seg.spells ?? [];
      tables   = seg.tables ?? [];
      skipped  = [...(seg.skipped ?? [])];
    } else if (type === "monsters") {
      const { monsters: chunks, skipped: sk } = splitStatblocks(text);
      monsters = chunks.map((chunk) => parseStatblock(chunk));
      skipped  = sk ?? [];
    } else if (type === "items") {
      const { claimed, remainder } = itemRecognizer.claim(text);
      items   = itemRecognizer.parse(claimed);
      skipped = this._leftoverSkipped(remainder);
    } else if (type === "spells") {
      const { claimed, remainder } = spellRecognizer.claim(text);
      spells  = spellRecognizer.parse(claimed);
      skipped = this._leftoverSkipped(remainder);
    } else if (type === "tables") {
      tables = parseTables(effectiveText);
    }

    // Seeded unlock (one expected table): keep the best-matching table only,
    // stamp the expected name on it, and shunt everything else — OCR junk
    // fragments included — to the Skipped list instead of the preview.
    if (this._importSeed?._charSeed && (type === "tables" || type === "auto") && (nameTables.length || tables.length)) {
      const want = this._importSeed.name;
      let keep;
      if (nameTables.length) {
        keep = nameTables[0];
      } else {
        keep = tables.find((t) => t.name && t.name.toLowerCase() === want.toLowerCase())
          ?? tables.reduce((a, b) => ((b.rows?.length ?? 0) > (a.rows?.length ?? 0) ? b : a));
      }
      for (const t of [...nameTables, ...tables]) {
        if (t !== keep) skipped.push({ name: t.name || `(untitled ${t.formula ?? ""} table)`, reason: `dropped — this unlock expects only "${want}"` });
      }
      // Convention: imported tables are named "Source - Table Name"
      // (e.g. "Western Reaches - Dwarf Names").
      const srcLabel = CHAR_SOURCES[this._importSeed.src]?.label;
      keep.name = srcLabel ? `${srcLabel} - ${want}` : want;
      // Category drives the system-mirroring compendium folder.
      if (/\bnames$/i.test(want)) keep.category = "character-names";
      else if (/\btrinkets$/i.test(want)) keep.category = "trinkets";
      nameTables = [];
      tables = [keep];
    }
    tables = [...nameTables, ...tables];
    if (rangeNotes.length && tables.length) (tables[0].warnings ??= []).push(...rangeNotes);

    // Nameless table + a recognizable page caption ("DWARF TRINKET") →
    // adopt the manifest identity. All ancestry tables are WR content.
    if (!this._importSeed?._charSeed) {
      const { identifyAncestryTable, gatherCharContentCensus } = await import("./char-content-manifest.mjs");
      for (const t of tables) {
        const generic = !t.name || t.name === "Names";   // expander fallback
        if (!generic) continue;
        const id = identifyAncestryTable(text);
        if (id) {
          t.name = `${CHAR_SOURCES.WR.label} - ${id.name}`;
          t.category = id.category;
          (t.warnings ??= []).push(`Identified from the page caption as "${id.name}" (WR pg ${id.pages}).`);
          continue;
        }
        if (t.category === "character-names") {
          // Names pages all carry the same generic "NAMES" caption. If only
          // one ancestry's names table is still missing, it must be that one;
          // otherwise the GM has to say which ancestry this is.
          const rows = await gatherCharContentCensus().catch(() => []);
          const missing = (rows.find((r) => r.source === "WR")?.missingNames ?? [])
            .filter((m) => m.type === "Table" && /\bnames$/i.test(m.name));
          if (missing.length === 1) {
            t.name = `${CHAR_SOURCES.WR.label} - ${missing[0].name}`;
            (t.warnings ??= []).push(`Assumed "${missing[0].name}" — the only names table still missing.`);
          } else {
            (t.warnings ??= []).push(
              `Which ancestry? The page caption just says NAMES — edit the table name above (e.g. "Elf Names") before creating. Still missing: ${missing.map((m) => m.name).join(", ")}.`);
          }
        }
      }
    }

    // The "Source - Table Name" convention applies to unseeded character
    // tables too, using whatever the GM typed in the Source box.
    const srcPrefix = this._importSource.trim();
    if (!this._importSeed?._charSeed && srcPrefix) {
      for (const t of tables) {
        if (/\b(names|trinkets)$/i.test(t.name ?? "") && !t.name.toLowerCase().startsWith(srcPrefix.toLowerCase())) {
          t.name = `${srcPrefix} - ${t.name}`;
        }
      }
    }

    // Character-content types (Backgrounds / Talents / Class) parse into their
    // own draft list; everything else clears it.
    this._importChar = ["backgrounds", "talents", "classes", "ancestries"].includes(type)
      ? parseCharContent(text, type)
      : [];

    // Item subtype override (forces all parsed items to the chosen type).
    if (this._importItemSubtype !== "auto") {
      for (const it of items) it.draft.type = this._importItemSubtype;
    }

    this._importMonsters = monsters;
    this._importItems    = items;
    this._importSpells   = spells;
    this._importTables   = tables;
    this._importGenerators = [];
    this._importSkipped  = skipped;

    this._applyImportSeed();
    await this._linkLootTables();

    if (!monsters.length && !items.length && !spells.length && !tables.length && !this._importChar.length) {
      ui.notifications.warn("Nothing recognized — try a different import type or review the Skipped section.");
    }
    this.render();
  }

  /** Turn leftover (unclaimed) text into skipped entries for the review list. */
  _leftoverSkipped(remainder) {
    const out = [];
    for (const block of String(remainder ?? "").split(/\n\s*\n/)) {
      const first = block.split("\n")[0]?.trim();
      if (first) out.push({ name: first, reason: "not recognized as the selected type" });
    }
    return out;
  }

  _onHubClear() {
    this._importText = "";
    this._importMonsters = [];
    this._importItems = [];
    this._importSpells = [];
    this._importTables = [];
    this._importGenerators = [];
    this._importChar = [];
    this._importSealed = null;
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
    // Character-content seeds set their own identity in _onHubParse
    // ("Source - Name" convention + category) — don't clobber it here.
    if (seed._charSeed) return;
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

  _onSimportRemoveSpell(event, target) {
    const idx = Number(target.closest("[data-spell-idx]")?.dataset.spellIdx);
    if (!Number.isFinite(idx)) return;
    this._importSpells.splice(idx, 1);
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

  // ── Compound-generator structural actions ─────────────────────────────────

  /** Columns of a generator draft (handles the compound.columns / columns mirror). */
  _genColumns(g) { return g?.compound?.columns ?? g?.columns ?? []; }

  /** Current face count = highest max across all columns (min 1). */
  _genSize(g) {
    return Math.max(1, this._genColumns(g).reduce((m, c) =>
      Math.max(m, (c.rows ?? []).reduce((mm, r) => Math.max(mm, r.max), 0)), 0));
  }

  _onGenAddColumn(event, target) {
    const g = this._importGenerators[Number(target.closest("[data-gen-idx]")?.dataset.genIdx)];
    if (!g) return;
    const cols = this._genColumns(g);
    const size = this._genSize(g);
    const formula = cols[0]?.formula || g.formula || `1d${size}`;
    const rows = [];
    for (let f = 1; f <= size; f++) rows.push({ min: f, max: f, text: "" });
    cols.push({ label: `Detail ${cols.length + 1}`, formula, rows });
    this.render();
  }

  _onGenRemoveColumn(event, target) {
    const g = this._importGenerators[Number(target.closest("[data-gen-idx]")?.dataset.genIdx)];
    const ci = Number(target.closest("[data-col-idx]")?.dataset.colIdx);
    if (!g || !Number.isFinite(ci)) return;
    const cols = this._genColumns(g);
    if (cols.length <= 1) { ui.notifications.warn("A generator needs at least one column."); return; }
    cols.splice(ci, 1);
    this.render();
  }

  _onGenAddRow(event, target) {
    const g = this._importGenerators[Number(target.closest("[data-gen-idx]")?.dataset.genIdx)];
    if (!g) return;
    const cols = this._genColumns(g);
    const face = this._genSize(g) + 1;
    for (const c of cols) (c.rows ??= []).push({ min: face, max: face, text: "" });
    const formula = `1d${face}`;
    g.formula = formula;
    for (const c of cols) c.formula = formula;
    this.render();
  }

  _onGenDeleteRow(event, target) {
    const g = this._importGenerators[Number(target.closest("[data-gen-idx]")?.dataset.genIdx)];
    const face = Number(target.closest("[data-face-row]")?.dataset.faceRow);
    if (!g || !Number.isFinite(face)) return;
    const cols = this._genColumns(g);
    // Drop the face from each column, then renumber remaining rows to stay 1..N.
    for (const c of cols) {
      c.rows = (c.rows ?? []).filter(r => !(r.min === face && r.max === face));
      c.rows.sort((a, b) => a.min - b.min);
      c.rows.forEach((r, i) => { r.min = r.max = i + 1; });
    }
    const size = this._genSize(g);
    const formula = `1d${size}`;
    g.formula = formula;
    for (const c of cols) c.formula = formula;
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
    this._invalidateItemsCache();
    this.render();
  }

  /**
   * Resolve each spell draft's class name → UUID, then create all pending
   * spells into sde-items. Returns the createItems result (or null).
   */
  async _commitSpells(source) {
    if (!this._importSpells.length) return null;
    const drafts = this._importSpells.map((p) => p.draft);
    const unresolved = [];
    for (const d of drafts) {
      const w = await resolveSpellClass(d);
      if (w) unresolved.push(d.name);
    }
    const { ItemImporter } = await import("./item-importer.mjs");
    const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
    if (unresolved.length) {
      ui.notifications.warn(`Spells: ${unresolved.length} imported without a class link (${unresolved.slice(0, 3).join(", ")}${unresolved.length > 3 ? "…" : ""}).`);
    }
    return result;
  }

  /** Commit: create all pending spells into sde-items. GM-gated. */
  async _onHubCommitSpells() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import spells."); return; }
    if (!this._importSpells.length) { ui.notifications.warn("No spells to import."); return; }

    const source = this._importSource.trim();
    const result = await this._commitSpells(source);
    if (!result) return;

    const parts = [`${result.created.length} created`];
    if (result.replaced.length) parts.push(`${result.replaced.length} replaced`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    ui.notifications.info(`Spells: ${parts.join(", ")} → sde-items${source ? ` / ${source}` : ""}.`);
    this._importSpells = [];
    this._invalidateItemsCache();
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
      // Convention at commit time too, so hand-typing "Elf Names" on the card
      // is enough — bare generic names ("Names") are left for the GM to fix.
      if (/\b(names|trinkets)$/i.test(tbl.name ?? "") && tbl.name.trim().split(/\s+/).length >= 2 && !/ - /.test(tbl.name)) {
        tbl.name = `${this._importSource.trim() || "Western Reaches"} - ${tbl.name.trim()}`;
      }
      const table = await TableImporter.createTable(tbl, { onConflict });
      if (table) {
        created++;
        this._importTables = this._importTables.filter(t => t !== tbl);
        if (tbl.manifestId) this._importSeed = null;
        await this._fileCharTable(table, tbl);
        await this._registerCharBuilderTable(table);
      }
    }
    ui.notifications.info(`Tables: ${created} created → sde-tables.`);
    if (this._importSeed?._charSeed && !this._importTables.length) this._importSeed = null;
    this._invalidateCharCache();
    if (created) this._announceContentUnlocked();
    this.render();
  }

  /**
   * Commit compound generators → sde-tables (one self-contained RollTable each,
   * carrying the compound flag). Same conflict dialog as regular tables.
   */
  async _onHubCommitGenerators() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import tables."); return; }
    if (!this._importGenerators.length) { ui.notifications.warn("No generators to import."); return; }

    const onConflict = this._tableConflictDialog();
    let created = 0;
    for (const g of [...this._importGenerators]) {
      const src = this._importSource.trim();
      if (src) g.source = src;
      const table = await TableImporter.createTable(g, { onConflict });
      if (table) {
        created++;
        this._importGenerators = this._importGenerators.filter(x => x !== g);
      }
    }
    ui.notifications.info(`Generators: ${created} created → sde-tables. Roll from the table sheet to combine columns.`);
    this.render();
  }

  /**
   * Character-content tables mirror the system compendium's folder taxonomy
   * (Names, Trinkets, Class Talents, Character Background) instead of the
   * encounter suite's per-source folders.
   */
  async _fileCharTable(table, tbl) {
    const folderName = ({
      "character-names": "Names",
      "trinkets": "Trinkets",
      "talents": "Class Talents",
      "background": "Character Background",
    })[tbl.category];
    if (!folderName || !table.pack) return;
    try {
      const pack = game.packs.get(table.pack);
      let folder = pack.folders.find((f) => f.name === folderName);
      if (!folder) folder = await Folder.create({ name: folderName, type: "RollTable" }, { pack: pack.collection });
      if (table.folder?.id !== folder.id) await table.update({ folder: folder.id });
    } catch (err) {
      console.error(`${MODULE_ID} | failed to file ${table.name} under ${folderName}:`, err);
    }
  }

  /**
   * The character builder now auto-discovers installed Names/Trinkets tables
   * (char-builder/data.mjs configuredTables) — there is no source setting to
   * update, so an imported table is available immediately. Kept as a no-op for
   * existing callers.
   */
  async _registerCharBuilderTable(_table) { /* auto-discovered — nothing to register */ }

  /** Signal an open Character Builder to drop caches and re-render, so unlocked
   *  content (ancestries, tables, backgrounds, classes…) appears immediately. */
  _announceContentUnlocked() { Hooks.callAll(`${MODULE_ID}.contentUnlocked`); }

  /** Commit: create all monsters, items, then tables in one action. GM-gated. */
  async _onHubCommitAll() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import."); return; }

    const hasMonsters = this._importMonsters.length > 0;
    const hasItems    = this._importItems.length > 0;
    const hasSpells   = this._importSpells.length > 0;
    const hasTables   = this._importTables.length > 0;
    if (!hasMonsters && !hasItems && !hasSpells && !hasTables) { ui.notifications.warn("Nothing to import."); return; }

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

    // Spells third
    if (hasSpells) {
      const result = await this._commitSpells(source);
      if (result) {
        parts.push(`spells: ${result.created.length} created${result.replaced.length ? `, ${result.replaced.length} replaced` : ""}${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`);
        this._importSpells = [];
      }
    }

    // Tables last
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
    if (parts.length) this._announceContentUnlocked();
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
    this._invalidateItemsCache();

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
    this._importType = "monsters";
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

  // ── Items-tab dashboard actions (parallel to Monsters) ─────────────────────

  _onItemGapExpand(event, target) {
    const source = target.dataset.source ?? "";
    if (this._expandedItemGapRows.has(source)) this._expandedItemGapRows.delete(source);
    else this._expandedItemGapRows.add(source);
    this.render();
  }

  /** Seed the paste box with a missing item name. */
  _onItemSeedPaste(event, target) {
    const name = target.dataset.name ?? "";
    if (!name) return;
    this._importText = name;
    this._importSeed = { name, _itemSeed: true };
    this._importType = "items";
    this.render();
  }

  // ── Manage-tree actions ────────────────────────────────────────────────────

  /** Toggle a Manage-tree node open/closed (keyed by its stable node id). */
  _onManageNodeExpand(event, target) {
    const id = target.dataset.nodeId ?? "";
    if (!id) return;
    if (this._manageExpandedNodes.has(id)) this._manageExpandedNodes.delete(id);
    else this._manageExpandedNodes.add(id);
    this.render();
  }

  /** Expand every node in the Manage tree. */
  _onManageExpandAll() {
    const ids = [];
    const walk = (nodes) => { for (const n of nodes) { ids.push(n.id); walk(n.children); } };
    if (this._manageTreeCache) walk(this._manageTreeCache);
    this._manageExpandedNodes = new Set(ids);
    this.render();
  }

  /** Collapse the whole Manage tree. */
  _onManageCollapseAll() {
    this._manageExpandedNodes = new Set();
    this.render();
  }

  /**
   * Unlock a missing character-content entry: pre-select the matching import
   * type, stamp the source label, and seed the paste box with the entry name
   * so the GM only has to paste the section from the cited book.
   */
  _onCharSeedPaste(event, target) {
    const name = target.dataset.name ?? "";
    const type = target.dataset.type ?? "";
    const src = target.dataset.src ?? "";
    if (!name) return;
    const importType = ({
      Spell: "spells",
      Basic: "items", Weapon: "items", Armor: "items",
      Background: "backgrounds",
      Talent: "talents",
      Class: "classes", Ancestry: "ancestries",
      Table: "tables",
    })[type] ?? "auto";
    this._importText = name;
    this._importSeed = {
      name,
      src,
      type,
      page: target.dataset.pages || undefined,
      book: CHAR_SOURCES[src]?.book || src || undefined,
      _charSeed: true,
    };
    this._importType = importType;
    if (src && CHAR_SOURCES[src]) this._importSource = CHAR_SOURCES[src].label;
    this.render();
  }

  /** Commit parsed Background/Talent/Class drafts into sde-items. GM-gated. */
  async _onHubCommitChar() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import content."); return; }
    // Sealed unlock: create the pre-authored documents with links remapped.
    if (this._importSealed) {
      const { importSealedPayload } = await import("./sealed-content.mjs");
      const created = await importSealedPayload(this._importSealed.payload);
      ui.notifications.info(`"${this._importSealed.unit.name}" unlocked: ${created.length} documents created.`);
      this._importSealed = null;
      this._importSeed = null;
      this._invalidateItemsCache();
      this._invalidateCharCache();
      this._announceContentUnlocked();
      this.render();
      return;
    }
    if (!this._importChar.length) { ui.notifications.warn("No character content to import."); return; }

    const source = this._importSource.trim();
    // The char-builder gates visibility on system.source.title — stamp it from
    // the source label so unlocked content is attributed like hand-imports.
    const sourceTitle = ({
      "cursed scroll 4": "cursed-scroll-4",
      "cursed scroll 5": "cursed-scroll-5",
      "cursed scroll 6": "cursed-scroll-6",
      "cs4": "cursed-scroll-4", "cs5": "cursed-scroll-5", "cs6": "cursed-scroll-6",
      "western reaches": "western-reaches",
    })[source.toLowerCase()] ?? source.toLowerCase().replace(/\s+/g, "-");

    const drafts = this._importChar.map((p) => ({ ...p.draft, sourceTitle }));
    const { ItemImporter } = await import("./item-importer.mjs");
    const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
    if (!result) return;

    const parts = [`${result.created.length} created`];
    if (result.replaced.length) parts.push(`${result.replaced.length} replaced`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    ui.notifications.info(`Character content: ${parts.join(", ")} → sde-items${source ? ` / ${source}` : ""}.`);
    this._importChar = [];
    this._invalidateItemsCache();
    this._invalidateCharCache();
    this._announceContentUnlocked();
    this.render();
  }

  /**
   * Guided cull for duplicate sde-items: read the chosen keeper, confirm via
   * DialogV2, delete the other pack copies (D-06). Mirrors _onMonsterCullGroup.
   */
  async _onItemCullGroup(event, target) {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can cull duplicates."); return; }

    const groupKey = target.dataset.groupKey ?? "";
    if (!groupKey) return;
    const groups = this._itemsCache?.duplicateGroups ?? [];
    const group = groups.find((g) => g.key === groupKey);
    if (!group) { ui.notifications.warn("Duplicate group not found — refresh the Items tab."); return; }

    const card = target.closest(".sde-hub-monsters-dup-card");
    const checkedRadio = card?.querySelector("input[type='radio']:checked");
    const keepUuid = checkedRadio?.value ?? "";
    if (!keepUuid) { ui.notifications.warn("Select a keeper before culling."); return; }

    const dropMembers = group.members.filter((m) => m.uuid !== keepUuid);
    if (!dropMembers.length) { ui.notifications.info("Nothing to cull — only one member selected as keeper."); return; }

    const keepMember = group.members.find((m) => m.uuid === keepUuid);
    const keepLabel  = foundry.utils.escapeHTML(keepMember?.name ?? keepUuid);
    const dropList   = dropMembers.map((m) => `<li>${foundry.utils.escapeHTML(m.name)} <em>(${m.source || "unknown source"})</em></li>`).join("");
    const content = `
      <p>Keep: <strong>${keepLabel}</strong></p>
      <p>Delete these pack copies:</p>
      <ul style="margin:.3em 0">${dropList}</ul>
      <p style="color:var(--sde-bar-text-muted,#9a9a9a);font-size:.85em">
        Only pack copies in sde-items are deleted. World items and _Backup docs are never touched.
      </p>`;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Cull Duplicate Items" },
      content,
      buttons: [
        { action: "cull",   label: "Delete copies", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    if (choice !== "cull") return;

    const tally = await cullItemDuplicates(keepUuid, dropMembers.map((m) => m.uuid));
    const parts = [];
    if (tally.deleted) parts.push(`${tally.deleted} deleted`);
    if (tally.skipped) parts.push(`${tally.skipped} skipped`);
    if (tally.failed)  parts.push(`${tally.failed} failed (see console)`);
    ui.notifications.info(`Cull complete: ${parts.join(", ") || "nothing done"}.`);

    this._invalidateItemsCache();
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
