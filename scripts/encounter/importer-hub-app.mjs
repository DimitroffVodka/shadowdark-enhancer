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
import { parseCharContent, expandNamePartTables, normalizeTwoColumnRanges, CHAR_SOURCES, BACKGROUND_TABLES, sourcedTableName } from "./char-content-manifest.mjs";
import { sourcePdfHref, sourcePdfTarget } from "./source-pdf-registry.mjs";
import { buildManageTree } from "./manage-tree.mjs";
import { contentIdForName } from "./table-shapes.mjs";
import { findSuitePack } from "./compendium-suite.mjs";
import { MODULE_ID } from "../module-id.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Common source labels offered as datalist suggestions. */
const SOURCE_SUGGESTIONS = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];


/**
 * Pull the quoted row name out of each parser warning so the preview can flag
 * the EXACT attack/feature row the warning is about. A statblock warning like
 *   feature "Basilisk Cultists" captured from a standalone caps caption …
 * names the offending row in quotes; matching that to a feature/attack lets the
 * card highlight it and drop a "review" tag right on the row, instead of making
 * the GM read the note and then hunt for which row it means (user QA 2026-07-13:
 * "do a better job showing what is being flagged").
 * @param {string[]} warnings
 * @returns {Map<string,string>} lowercased row name → the warning message
 */
function flaggedRowNames(warnings) {
  const map = new Map();
  for (const w of warnings ?? []) {
    // Straight or curly single/double quotes around a 2+ char name.
    const re = /[“"'‘]([^“”"'’]{2,})[”"'’]/g;
    let m;
    while ((m = re.exec(String(w)))) {
      const key = m[1].trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, String(w));
    }
  }
  return map;
}

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
      hubParseCartesian:      ImporterHubApp.prototype._onHubParseCartesian,
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
      // Source PDF library
      hubManageSourcePdfs:    ImporterHubApp.prototype._onManageSourcePdfs,
      // PDF → text extraction (Foundry's bundled PDF.js; no external tool)
      hubGrabPdfText:         ImporterHubApp.prototype._onGrabPdfText,
      hubExtractPdf:          ImporterHubApp.prototype._onExtractPdf,
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
      spellListSeed:          ImporterHubApp.prototype._onSpellListSeed,
      openClassImporter:      ImporterHubApp.prototype._onOpenClassImporter,
      openSpellImporter:      ImporterHubApp.prototype._onOpenSpellImporter,
      openSourcePdf:          ImporterHubApp.prototype._onOpenSourcePdf,
      hubCommitChar:          ImporterHubApp.prototype._onHubCommitChar,
      cuOptAdd:               ImporterHubApp.prototype._onCuOptAdd,
      cuOptDel:               ImporterHubApp.prototype._onCuOptDel,
      cuRowSplit:             ImporterHubApp.prototype._onCuRowSplit,
      cuRowMerge:             ImporterHubApp.prototype._onCuRowMerge,
      cuRowDel:               ImporterHubApp.prototype._onCuRowDel,
      cuRowAdd:               ImporterHubApp.prototype._onCuRowAdd,
      cuFeatAdd:              ImporterHubApp.prototype._onCuFeatAdd,
      cuFeatDel:              ImporterHubApp.prototype._onCuFeatDel,
      cuTitleAdd:             ImporterHubApp.prototype._onCuTitleAdd,
      cuTitleDel:             ImporterHubApp.prototype._onCuTitleDel,
      hubRelinkTables:        ImporterHubApp.prototype._onRelinkTables,
      migrateCompendium:      ImporterHubApp.prototype._onMigrateCompendium,
      hubFoldLegacyLoot:      ImporterHubApp.prototype._onFoldLegacyLoot,
      mimportBackfill:        ImporterHubApp.prototype._onBackfill,
      mimportMigrateSuite:    ImporterHubApp.prototype._onMigrateSuite,
    },
  };

  static PARTS = {
    body: {
      template: "modules/shadowdark-enhancer/templates/importer-hub.hbs",
      // Preserve the scroll position across re-renders — every tree
      // expand/collapse re-renders the app, and without this the view
      // snaps back to the top of the hub. "" = the part's root element
      // (.sde-importer-hub is the template root, so a selector can't match it).
      scrollable: [""],
    },
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
  /** Hook id for the `contentUnlocked` subscription (refreshes the census when a
   *  dedicated Class/Spell importer commits). @type {number|null} */
  _contentHookId = null;
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
    if (this._contentHookId) { Hooks.off(`${MODULE_ID}.contentUnlocked`, this._contentHookId); this._contentHookId = null; }
    return super.close(options);
  }

  // ── Context preparation ────────────────────────────────────────────────────

  async _prepareContext() {
    const moveOptions = npcMoveKeys();
    // Borrowable spell lists for caster class-units (Knight of St. Ydris →
    // Witch pattern); only fetched when a caster is actually in preview.
    const casterChoices = this._importChar.some((p) => p.draft.classUnit?.spellcasting)
      ? await this._casterClassChoices()
      : [];
    // Stage-2 supplement drafts need a target class to attach their tables to.
    const attachChoices = this._importChar.some((p) => p.draft.classSupplement)
      ? await this._attachClassChoices()
      : [];

    const importMonsterCards = this._importMonsters.map((p, i) => {
      const wf = warnFields(p.warnings ?? []);
      // Row-level flags: tie each quoted-name warning to its exact attack/feature
      // row so the preview can mark it (not just list the note at the top).
      const flagMap = flaggedRowNames(p.warnings);
      const flagFor = (name) => {
        const reason = flagMap.get(String(name ?? "").trim().toLowerCase());
        return { flagged: !!reason, flagReason: reason ?? "" };
      };
      // Display views aligned 1:1 with the draft arrays (indices match, so the
      // in-place field-edit + remove-row handlers still address the real draft).
      const features = (p.draft.features ?? []).map((f) => ({
        name: f.name, description: f.description, ...flagFor(f.name),
      }));
      const actions = (p.draft.actions ?? []).map((a) => ({ ...a, ...flagFor(a.name) }));
      return {
        idx: i,
        draft: p.draft,
        features,
        actions,
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

    // Custom top-level folders the GM already created in the sde-tables pack
    // surface as reusable options ("If a custom folder is made it should show
    // up in the drop down in the future" — user QA 2026-07-11). Selecting one
    // resolves to category=custom + that label (see _wireHubTableFieldEdits).
    const CANON_TOPS = new Set(["Character Content", "Gameplay", "Roll Tables", "Custom"]);
    const topFolders = (findSuitePack("sde-tables")?.folders ?? [])
      .filter((f) => !f.folder).map((f) => f.name);
    const customFolders = topFolders
      .filter((n) => !CANON_TOPS.has(n))
      .map((n) => ({ id: `custom:${n}`, label: `📁 ${n}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const categoryOptions = [
      ...CATEGORIES.map(c => ({ id: c.id, label: c.label })),
      ...customFolders,
      { id: CUSTOM_ID, label: "Custom…" },
    ];
    // The Source field's datalist also lists existing top-level folders (the
    // canonical buckets + any the GM created) so a custom folder reappears
    // there for reuse — T5 "should show up in the drop down in the future".
    const sourceSuggestions = [...new Set([...SOURCE_SUGGESTIONS, ...topFolders])]
      .sort((a, b) => a.localeCompare(b));

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

    // Which sealed docs already exist at their destination? The import is
    // idempotent (reuses by name), so tell the user up front which entries
    // will be reused instead of implying everything is new.
    const sealedPresent = new Set();
    if (this._importSealed) {
      const { findSuitePack } = await import("./compendium-suite.mjs");
      const packOf = {
        RollTable: findSuitePack("sde-tables") ?? game.packs.get("world.shadowdark-enhancer--roll-tables"),
        Actor: findSuitePack("sde-actors") ?? game.packs.get("world.shadowdark-enhancer--actors"),
        Item: findSuitePack("sde-items") ?? game.packs.get("world.shadowdark-enhancer--items"),
      };
      for (const d of this._importSealed.payload.docs) {
        const kind = d.kind === "RollTable" ? "RollTable" : d.kind === "Actor" ? "Actor" : "Item";
        const idx = packOf[kind]?.index;
        if (idx?.find((x) => x.name === d.data.name)) sealedPresent.add(d.data.name);
      }
    }

    const t = this._importType;
    const importData = {
      text: this._importText,
      source: this._importSource,
      sourceSuggestions,
      seed: this._importSeed,
      // Deep-link into the user's uploaded source PDF at the cited page, so the
      // GM can jump straight to the section to copy. Only for char-content
      // seeds whose source has a mapped PDF + a page cite (else null → no link).
      seedPdfHref: this._importSeed?._charSeed
        ? sourcePdfHref(this._importSeed.src, this._importSeed.page)
        : null,
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
        { value: "cartesian", label: "Cartesian (expand)" },
        { value: "backgrounds", label: "Backgrounds" },
        { value: "talents",  label: "Talents" },
        { value: "ancestries", label: "Ancestry" },
      ].map(o => ({ ...o, selected: o.value === t })),
      showItemSubtype: t === "items" || t === "auto",
      showGenSpec: t === "generators" || t === "cartesian",
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
            preview: sealedPresent.has(d.data.name)
              ? "✓ already in your library — will be reused, not duplicated"
              : "🔓 sealed content — verified, imports exactly as authored",
          }))
        : this._importChar.map((p) => {
            const strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            const u = p.draft.classUnit;
            // Auto-match the parsed "casts wizard spells" hint to a real class
            // once, so the Spell-list select comes pre-picked and commit uses it.
            if (u?.spellcasting && !u.spellcasting.spellClass && u.spellcasting.spellList) {
              u.spellcasting.spellClass =
                casterChoices.find((c) => c.name.toLowerCase() === u.spellcasting.spellList) ?? null;
            }
            // Class units get a full structured preview (description, features,
            // talent table, spellcasting, review notes) instead of a one-liner.
            const unit = u ? {
              hp: u.hitPoints,
              weaponsText: u.weaponNames.join(", "),
              armorText: u.armorNames.join(", "),
              allWeapons: u.allWeapons, allMeleeWeapons: u.allMeleeWeapons,
              allRangedWeapons: u.allRangedWeapons, allArmor: u.allArmor,
              langFixed: u.languages.fixed.join(", "),
              langCommon: u.languages.common, langRare: u.languages.rare,
              flavor: strip(u.flavor),
              features: u.features.map((f) => ({ name: f.name, text: strip(f.description) })),
              table: u.talentTable ? {
                formula: u.talentTable.formula,
                rows: u.talentTable.rows.map((r) => ({
                  range: r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`,
                  text: r.text,
                  options: r.options ?? [],
                  isChoice: r.kind === "choice",
                  grand: r.kind === "grand",
                })),
              } : null,
              isCaster: !!u.spellcasting,
              scText: u.spellcasting ? strip(u.spellcasting.text) : "",
              spellListOptions: [
                { value: "", label: `Own list (${p.draft.name})`, selected: !u.spellcasting?.spellClass },
                ...casterChoices.map((c) => ({
                  value: c.uuid, label: c.name, selected: u.spellcasting?.spellClass?.uuid === c.uuid,
                })),
              ],
              spellsKnown: (u.spellsKnown ?? []).map((r) => ({
                level: r.level,
                cells: r.tiers.map((n) => n || "—").join(" · "),
              })),
              scOptions: ["", "int", "wis", "cha"].map((v) => ({
                value: v,
                label: v ? v.toUpperCase() : "— not a caster",
                selected: (u.spellcasting?.ability ?? "") === v && (v !== "" || !u.spellcasting),
              })),
              titles: u.titles.map((t) => ({
                range: t.from === t.to ? String(t.from) : `${t.from}-${t.to}`,
                lawful: t.lawful, chaotic: t.chaotic, neutral: t.neutral,
              })),
              // Stage 1 (Class · Description + Features): the class BODY only —
              // roll tables (talent table / titles / spells known) are hidden here
              // and imported in Stage 2. A classUnit draft only ever comes from
              // the stage-1 "classes" type.
              stage1: true,
              warnings: u.warnings,
            } : null;
            // Ancestry/background/talent drafts: surface the parsed language
            // grant + ancestry talent so the user can confirm they imported
            // without opening the tiny preview (user request).
            let meta = null;
            if (!unit && p.draft.type === "Ancestry") {
              const L = p.draft.languages ?? {};
              const langBits = [...(L.fixed ?? [])];
              if (L.common) langBits.push(`+${L.common} common`);
              if (L.rare) langBits.push(`+${L.rare} rare`);
              if (L.select) langBits.push(`+${L.select} choice`);
              meta = {
                languages: langBits.join(", ") || "—",
                talent: p.draft.talent?.name ?? "—",
                talentText: p.draft.talent ? strip(`<p>${p.draft.talent.text}</p>`) : "",
              };
            }
            // Stage-2 supplement draft (bare titles / talent table / spells
            // known) — a compact preview + an "attach to class" picker.
            const sup = p.draft.classSupplement;
            const supplement = sup ? {
              hasTable: !!sup.talentTable,
              tableRows: sup.talentTable ? sup.talentTable.rows.length : 0,
              titles: sup.titles.map((t) => ({
                range: t.from === t.to ? String(t.from) : `${t.from}-${t.to}`,
                lawful: t.lawful, chaotic: t.chaotic, neutral: t.neutral,
              })),
              spellsKnown: sup.spellsKnown.map((r) => ({
                level: r.level, cells: r.tiers.map((n) => n || "—").join(" · "),
              })),
              extraTables: (sup.extraTables ?? []).map((t) => ({ name: t.name, rows: t.rows.length })),
              warnings: sup.warnings ?? [],
              attachOptions: [
                { value: "", label: "— choose a class —", selected: !p.draft.attachTo },
                ...attachChoices.map((c) => ({
                  value: c.uuid, label: c.name, selected: p.draft.attachTo === c.uuid,
                })),
              ],
            } : null;
            return {
              name: p.draft.name,
              type: p.draft.type,
              unit,
              supplement,
              meta,
              preview: (unit || supplement) ? "" : strip(p.draft.description).slice(0, 140),
            };
          }),
      hasChar: this._importChar.length > 0 || !!this._importSealed,
      charsCount: this._importSealed?.payload.docs.length ?? this._importChar.length,
      // Section title + commit label name the ACTUAL destination:
      // importSealedPayload routes RollTables → sde-tables and Actors →
      // sde-actors, so "Create in Items" is wrong for those payloads.
      ...(() => {
        if (!this._importSealed) return { charsTitle: "Character content", charsCommitLabel: "Create in Items" };
        const kinds = new Set(this._importSealed.payload.docs.map((d) => d.kind === "RollTable" ? "RollTable" : d.kind === "Actor" ? "Actor" : "Item"));
        if (kinds.size === 1 && kinds.has("RollTable")) return { charsTitle: "Sealed roll tables", charsCommitLabel: "Create in Roll Tables" };
        if (kinds.size === 1 && kinds.has("Actor")) return { charsTitle: "Sealed monsters", charsCommitLabel: "Create in Actors" };
        if (kinds.size === 1) return { charsTitle: "Sealed content", charsCommitLabel: "Create in Items" };
        return { charsTitle: "Sealed content", charsCommitLabel: "Create in library" };
      })(),
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
    this._wireHubClassRowEdits();

    // Manage strip: prepare its census lazily the first time it's expanded, so
    // opening the importer never triggers a world scan.
    const manage = this.element.querySelector("details[data-manage]");
    if (manage) {
      manage.addEventListener("toggle", () => {
        if (manage.open && !this._manageExpanded) { this._manageExpanded = true; this.render(); }
      });
    }
  }

  /** Subscribe ONCE per instance to `contentUnlocked` so the Manage census
   *  refreshes whenever content is unlocked from ANYWHERE — including the
   *  dedicated Class/Spell Importer workspaces, which commit outside this app.
   *  Without this a just-imported class/spell stays a "gap" until the hub is
   *  closed and reopened (issue #1). Kept out of `_onRender` so a hook-triggered
   *  re-render can't re-subscribe after close(). Unsubscribed in close(). */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._contentHookId = Hooks.on(`${MODULE_ID}.contentUnlocked`, () => {
      this._invalidateManageTree();
      this._invalidateItemsCache();
      this._invalidateMonstersCache();
      if (this.rendered) this.render();
    });
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
   * Class-unit talent-row edits. Range/effect/option text commit on `change`
   * with NO re-render (focus stays put); structural changes (add/remove
   * option or row, split/merge) are data-action buttons that re-render.
   * Edits mutate draft.classUnit directly — the commit path reads it as-is.
   */
  _wireHubClassRowEdits() {
    const splitNames = (s) => s.split(/\s*(?:,|\band\b)\s*/i).map((w) => w.trim()).filter(Boolean);
    const parseRange = (v) => {
      const m = v.trim().match(/^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/);
      if (!m) return null;
      let lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
      if (hi < lo) [lo, hi] = [hi, lo];
      return { lo, hi };
    };
    this.element.querySelectorAll(".sde-class-preview [data-cu-field]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const field = ev.target.dataset.cuField;
        const v = ev.target.value;

        // ── Titles row scope — works for a classUnit (stage 1) AND a
        // classSupplement (stage 2), so titles are editable in the tables stage. ──
        const titleEl = ev.target.closest("[data-cu-title]");
        if (titleEl) {
          const titles = this._cuTitlesFor(ev.target);
          const band = titles?.[Number(titleEl.dataset.cuTitle)];
          if (!band) return;
          if (field === "titleRange") {
            const r = parseRange(v);
            if (!r) { ev.target.value = band.from === band.to ? String(band.from) : `${band.from}-${band.to}`; return; }
            band.from = r.lo; band.to = r.hi;
            ev.target.value = r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`;
          }
          else if (field === "titleLawful") band.lawful = v.trim();
          else if (field === "titleChaotic") band.chaotic = v.trim();
          else if (field === "titleNeutral") band.neutral = v.trim();
          return;
        }

        const unit = this._importChar[Number(ev.target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft.classUnit;
        if (!unit) return;

        // ── Talent-table row scope ──
        const rowEl = ev.target.closest("[data-cu-row]");
        if (rowEl) {
          const row = unit.talentTable?.rows[Number(rowEl.dataset.cuRow)];
          if (!row) return;
          if (field === "range") {
            const r = parseRange(v);
            if (!r) { ev.target.value = row.lo === row.hi ? String(row.lo) : `${row.lo}-${row.hi}`; return; }
            row.lo = r.lo; row.hi = r.hi;
            ev.target.value = r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`;
          } else if (field === "text") {
            row.text = v.trim();
          } else if (field === "option") {
            const oIdx = Number(ev.target.closest("[data-cu-opt]")?.dataset.cuOpt);
            if (Array.isArray(row.options) && row.options[oIdx] !== undefined) row.options[oIdx] = v.trim();
          }
          return;
        }

        // ── Feature row scope ──
        const featEl = ev.target.closest("[data-cu-feat]");
        if (featEl) {
          const f = unit.features[Number(featEl.dataset.cuFeat)];
          if (!f) return;
          if (field === "featName") f.name = v.trim();
          else if (field === "featText") f.description = v.trim() ? `<p>${v.trim()}</p>` : "";
          return;
        }

        // ── Unit-level fields ──
        if (field === "hp") {
          const m = v.trim().match(/^(?:1)?(d\d+)$/i);
          if (!m) { ev.target.value = unit.hitPoints; return; }
          unit.hitPoints = m[1].toLowerCase();
          ev.target.value = unit.hitPoints;
        } else if (field === "flavor") {
          unit.flavor = v.trim() ? `<p>${v.trim()}</p>` : "";
        } else if (field === "weapons") {
          unit.weaponsText = v.trim();
          unit.weaponNames = splitNames(v);
        } else if (field === "armor") {
          unit.armorText = v.trim();
          unit.armorNames = splitNames(v);
        } else if (["allWeapons", "allMeleeWeapons", "allRangedWeapons", "allArmor"].includes(field)) {
          // Flags and named lists COEXIST ("All melee weapons, crossbow") —
          // toggling a flag never touches the names.
          unit[field] = ev.target.checked;
        } else if (field === "tblFormula") {
          const m = v.trim().match(/^\d*d\d+$/i);
          if (!m || !unit.talentTable) { ev.target.value = unit.talentTable?.formula ?? "2d6"; return; }
          unit.talentTable.formula = v.trim().toLowerCase();
        } else if (field === "langFixed") {
          unit.languages.fixed = splitNames(v);
        } else if (field === "langCommon") {
          unit.languages.common = Math.max(0, Number(v) || 0);
        } else if (field === "langRare") {
          unit.languages.rare = Math.max(0, Number(v) || 0);
        } else if (field === "scAbility") {
          unit.spellcasting = v
            ? { ability: v, text: unit.spellcasting?.text ?? "",
                spellList: unit.spellcasting?.spellList ?? null,
                spellClass: unit.spellcasting?.spellClass ?? null }
            : null;
          this.render();   // caster chip style + Spellcasting block visibility
        } else if (field === "spellList") {
          if (unit.spellcasting)
            unit.spellcasting.spellClass = (this._casterChoices ?? []).find((c) => c.uuid === v) ?? null;
        } else if (field === "scText") {
          if (unit.spellcasting) unit.spellcasting.text = v.trim() ? `<p>${v.trim()}</p>` : "";
        }
      });
    });

    // Stage-2 supplement: the "attach to class" picker stores the target on
    // the draft; the commit routes it through mergeClassSupplement.
    this.element.querySelectorAll("[data-supplement-attach]").forEach((sel) => {
      sel.addEventListener("change", (ev) => {
        const p = this._importChar[Number(ev.target.closest("[data-char-idx]")?.dataset.charIdx)];
        if (p?.draft?.classSupplement) p.draft.attachTo = ev.target.value || null;
      });
    });
  }

  /**
   * Caster classes a new class can borrow a spell list from (Knight of
   * St. Ydris → Witch pattern). System classes + suite-pack classes with a
   * casting ability. Cached per hub instance; parse drops the cache.
   */
  async _casterClassChoices() {
    if (this._casterChoices) return this._casterChoices;
    const out = [];
    const scan = async (pack) => {
      if (!pack) return;
      try {
        const idx = await pack.getIndex({ fields: ["type", "system.spellcasting.ability"] });
        for (const e of idx) {
          if (e.type !== "Class" || !e.system?.spellcasting?.ability) continue;
          out.push({ uuid: `Compendium.${pack.collection}.Item.${e._id}`, name: e.name, slug: e.name.slugify() });
        }
      } catch (err) { console.warn(`${MODULE_ID} | caster-class scan failed for ${pack?.collection}:`, err); }
    };
    await scan(game.packs.get("shadowdark.classes"));
    const { findSuitePack } = await import("./compendium-suite.mjs");
    await scan(findSuitePack("sde-items"));
    this._casterChoices = out;
    return out;
  }

  /**
   * Editable SDE Class items a stage-2 supplement (titles / talent table /
   * spells-known) can attach to: world.classes + legacy sde-items copies.
   * System classes are excluded (locked, not editable). Cached per hub;
   * dropped after a char commit so a class imported this session appears.
   */
  async _attachClassChoices() {
    if (this._attachChoices) return this._attachChoices;
    const out = [];
    const scan = async (pack) => {
      if (!pack) return;
      try {
        const idx = await pack.getIndex({ fields: ["type"] });
        for (const e of idx)
          if (e.type === "Class") out.push({ uuid: `Compendium.${pack.collection}.Item.${e._id}`, name: e.name });
      } catch (err) { console.warn(`${MODULE_ID} | attach-class scan failed for ${pack?.collection}:`, err); }
    };
    const { findSuitePack } = await import("./compendium-suite.mjs");
    await scan(findSuitePack("classes"));
    await scan(findSuitePack("sde-items"));
    out.sort((a, b) => a.name.localeCompare(b.name));
    this._attachChoices = out;
    return out;
  }

  /** Resolve the classUnit talent row a click/change happened in. */
  _cuRowFor(target) {
    const unit = this._importChar[Number(target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft.classUnit;
    const rows = unit?.talentTable?.rows ?? null;
    const rowEl = target.closest("[data-cu-row]");
    const row = rows?.[Number(rowEl?.dataset.cuRow)] ?? null;
    return { unit, rows, row, rowIdx: rowEl ? Number(rowEl.dataset.cuRow) : -1 };
  }

  /** Add a blank option to a choice row (structural → re-render). */
  _onCuOptAdd(event, target) {
    const { row } = this._cuRowFor(target);
    if (!row) return;
    row.kind = "choice";
    (row.options ??= []).push("");
    this.render();
  }

  /** Remove one option; below 2 options the row folds back to single. */
  _onCuOptDel(event, target) {
    const { row } = this._cuRowFor(target);
    const oIdx = Number(target.closest("[data-cu-opt]")?.dataset.cuOpt);
    if (!row || !Array.isArray(row.options)) return;
    row.options.splice(oIdx, 1);
    if (row.options.length < 2) { row.kind = "single"; delete row.options; }
    this.render();
  }

  /** Single → choice: seed options by splitting the text on " or ". */
  _onCuRowSplit(event, target) {
    const { row } = this._cuRowFor(target);
    if (!row) return;
    const parts = row.text.split(/\s+or\s+/i).map((p) => p.trim().replace(/[.]$/, "")).filter(Boolean);
    row.kind = "choice";
    row.options = parts.length >= 2 ? parts : [row.text, ""];
    this.render();
  }

  /** Choice → single: the row commits as one talent named by its text. */
  _onCuRowMerge(event, target) {
    const { row } = this._cuRowFor(target);
    if (!row) return;
    row.kind = "single";
    delete row.options;
    this.render();
  }

  /** Delete a talent row. */
  _onCuRowDel(event, target) {
    const { rows, rowIdx } = this._cuRowFor(target);
    if (!rows || rowIdx < 0) return;
    rows.splice(rowIdx, 1);
    this.render();
  }

  /** Append a blank single row — bootstraps a 2d6 table when none parsed. */
  _onCuRowAdd(event, target) {
    const unit = this._importChar[Number(target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft.classUnit;
    if (!unit) return;
    unit.talentTable ??= { formula: "2d6", rows: [] };
    const rows = unit.talentTable.rows;
    const next = rows.length ? Math.max(...rows.map((r) => r.hi)) + 1 : 2;
    rows.push({ lo: next, hi: next, text: "", kind: "single" });
    this.render();
  }

  /** Resolve the classUnit a structural button belongs to. */
  _cuUnitFor(target) {
    return this._importChar[Number(target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft.classUnit ?? null;
  }

  /** The titles array a title editor belongs to — a classUnit (stage 1) or a
   *  classSupplement (stage 2). Creates the array so "add band" works on a
   *  supplement that parsed no titles (manual entry). */
  _cuTitlesFor(target) {
    const draft = this._importChar[Number(target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft;
    if (!draft) return null;
    if (draft.classUnit) return (draft.classUnit.titles ??= []);
    if (draft.classSupplement) return (draft.classSupplement.titles ??= []);
    return null;
  }

  /** Add a blank class feature. */
  _onCuFeatAdd(event, target) {
    const unit = this._cuUnitFor(target);
    if (!unit) return;
    unit.features.push({ name: "", description: "" });
    this.render();
  }

  /** Remove a class feature. */
  _onCuFeatDel(event, target) {
    const unit = this._cuUnitFor(target);
    const idx = Number(target.closest("[data-cu-feat]")?.dataset.cuFeat);
    if (!unit || !(idx >= 0)) return;
    unit.features.splice(idx, 1);
    this.render();
  }

  /** Add a title band after the current last level range. */
  _onCuTitleAdd(event, target) {
    const titles = this._cuTitlesFor(target);
    if (!titles) return;
    const last = titles[titles.length - 1];
    const from = last ? last.to + 1 : 1;
    titles.push({ from, to: from + 1, lawful: "", chaotic: "", neutral: "" });
    this.render();
  }

  /** Remove a title band. */
  _onCuTitleDel(event, target) {
    const titles = this._cuTitlesFor(target);
    const idx = Number(target.closest("[data-cu-title]")?.dataset.cuTitle);
    if (!titles || !(idx >= 0)) return;
    titles.splice(idx, 1);
    this.render();
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
          else if (field === "category") {
            // "custom:<Folder>" options = reuse an existing custom pack folder.
            const v = ev.target.value;
            if (v.startsWith("custom:")) { tbl.category = CUSTOM_ID; tbl.customLabel = v.slice(7); }
            else tbl.category = v;
            this.render();
          }
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
          case "description": draft.description = ImporterHubApp._wrapEditedHtml(v); break;
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
   * Cartesian button: parse the paste as a multi-column generator (same as
   * Compound — roll-each-column, "|" respected), but spell it out into ONE long
   * flat table with every combination instead of the hidden roll-each-column
   * form. Blocks a request over 25000 rows (user pref) with a warning.
   */
  async _onHubParseCartesian() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;
    if (!this._importText.trim()) { ui.notifications.warn("Paste a table first, then click Cartesian."); return; }

    const spec = await foundry.applications.api.DialogV2.wait({
      window: { title: "Cartesian Table", icon: "fas fa-table-cells" },
      content: `
        <p>Spell out <strong>every combination</strong> of the columns into one long,
        fully-visible table (no hidden roll-each-column logic).</p>
        <p style="display:flex;align-items:center;gap:0.5rem;">
          <label for="sde-cartesian-spec"><strong>Dice</strong></label>
          <input id="sde-cartesian-spec" name="spec" type="text" value="3d6" placeholder="e.g. 3d6 or 2d10" style="flex:1;">
        </p>
        <p class="notes"><code>3d6</code> = 3 columns each with 6 rows → a 216-row table. Insert <code>|</code> between columns in your paste to set the splits yourself. Over 25,000 rows is blocked — use Compound for those.</p>`,
      buttons: [
        { action: "parse", label: "Expand to Cartesian", icon: "fas fa-table-cells", default: true,
          callback: (event, button) => button.form.elements.spec.value },
        { action: "cancel", label: "Cancel", icon: "fas fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (spec == null || spec === "cancel") return;

    this._importType = "cartesian";
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

    // RETIRED sealed path — DEAD. SEALED_UNITS is empty and nothing is
    // bundled or decrypted, so sealedUnitsFor() always returns [] and this
    // block falls straight through to the parse-and-author path below. Kept
    // only until the later cleanup removes it (see sealed-content.mjs header).
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

    // Shape-directed parse: when the thing being unlocked ships a precise
    // structure descriptor (table-shapes.mjs) — a prayer generator, a Carousing
    // lookup — reconstruct it deterministically instead of guessing. Driven by
    // the unlock seed's identity, or a "PRAYER GENERATOR" title in the paste.
    if (type === "auto" || type === "tables" || type === "generators") {
      const { resolveShape, shapeForName } = await import("./table-shapes.mjs");
      // Dispatch by persistent contentId first (collision-free); else resolve
      // the name WITHIN the seed's source, so a same-named table in another book
      // can't borrow this shape; name-only fallback is for freeform seedless
      // pastes (handled by the PRAYER GENERATOR title check below).
      let shape = resolveShape({ contentId: seed?.contentId, name: seed?.name, src: seed?.src });
      if (!shape && /prayer\s+generator/i.test(text)) shape = shapeForName("Gede Prayers");
      if (shape) {
        const bucket = TableImporter.parseByShape(text, shape, { name: seed?.name || "" });
        if (bucket) {
          this._importMonsters = []; this._importItems = []; this._importSpells = [];
          this._importGenerators = bucket.generators ?? [];
          this._importTables = bucket.tables ?? [];
          this._importChar = []; this._importSkipped = [];
          this._applyImportSeed();
          if (!this._importGenerators.length && !this._importTables.length) {
            ui.notifications.warn("Shape parse produced nothing — check the pasted section.");
          }
          this.render();
          return;
        }
      }
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

    // Cartesian: same multi-column parse as Compound, but each table is stamped
    // to expand into a flat table at commit. Blocks anything over 25000 rows
    // (user pref) with a warning — those should stay Compound.
    if (type === "cartesian") {
      const CARTESIAN_CAP = 25000;
      const kept = [];
      for (const g of parseGenerators(text, this._importGenSpec)) {
        const cols = g.compound?.columns ?? g.columns ?? [];
        const product = cols.reduce((a, c) =>
          a * Math.max(1, (c.rows ?? []).reduce((m, r) => Math.max(m, r.max), 0)), cols.length ? 1 : 0);
        if (product > CARTESIAN_CAP) {
          ui.notifications.warn(`"${g.name || "table"}" would be ${product.toLocaleString()} rows (over ${CARTESIAN_CAP.toLocaleString()}) — use the Compound button for that one.`);
          continue;
        }
        g.expand = "cartesian";
        kept.push(g);
      }
      this._importGenerators = kept;
      this._importMonsters = []; this._importItems = []; this._importSpells = [];
      this._importTables = []; this._importChar = []; this._importSkipped = [];
      if (!kept.length) {
        ui.notifications.warn("Nothing to expand — need a die header (e.g. d6) and 2+ columns (insert | between them), and ≤ 25,000 total rows.");
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
      // A background bundle's d100 list spans several PDF pages joined by blank
      // lines, so parseTables split it into one table per page and `keep` holds
      // only the first. Rebuild the whole table: drop the bare page-footer rows
      // (74/75/76/77 collide with real faces) and collapse the page gaps so the
      // full list parses as one d100 for the random-background roll.
      if (this._importSeed._bgBundle) {
        const { parsePageRange } = await import("./pdf-text-extract.mjs");
        const footers = new Set(parsePageRange(this._importSeed.page).map(String));
        const merged = this._importText
          .split("\n").filter((l) => !footers.has(l.trim())).join("\n")
          .replace(/\n\s*\n+/g, "\n");
        const full = parseTables(merged).reduce((a, b) => ((b.rows?.length ?? 0) > (a?.rows?.length ?? 0) ? b : a), null);
        if (full && (full.rows?.length ?? 0) > (keep?.rows?.length ?? 0)) keep = full;
      }
      for (const t of [...nameTables, ...tables]) {
        if (t !== keep) skipped.push({ name: t.name || `(untitled ${t.formula ?? ""} table)`, reason: `dropped — this unlock expects only "${want}"` });
      }
      // Convention: imported tables are named "Source - Table Name" (e.g.
      // "Western Reaches - Dwarf Trinket"); ancestry NAME tables instead become
      // "Character Names: Source Ancestry" so the ancestry sheet's Random Name
      // Table dropdown lists them (sourcedTableName). Background-bundle tables
      // already carry a complete, unique name (e.g. "Western Reach Backgrounds")
      // — don't prefix them or it doubles the source and forks a duplicate.
      const srcLabel = CHAR_SOURCES[this._importSeed.src]?.label;
      keep.name = (srcLabel && !this._importSeed._bgBundle) ? sourcedTableName(srcLabel, want) : want;
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
          t.name = sourcedTableName(CHAR_SOURCES.WR.label, id.name);
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
            t.name = sourcedTableName(CHAR_SOURCES.WR.label, missing[0].name);
            (t.warnings ??= []).push(`Assumed "${missing[0].name}" — the only names table still missing.`);
          } else {
            (t.warnings ??= []).push(
              `Which ancestry? The page caption just says NAMES — edit the table name above (e.g. "Elf Names") before creating. Still missing: ${missing.map((m) => m.name).join(", ")}.`);
          }
        }
      }
    }

    // The source-naming convention applies to unseeded character tables too,
    // using whatever the GM typed in the Source box: NAME tables become
    // "Character Names: Source Ancestry" (dropdown-visible), Trinkets keep the
    // "Source - Name" suffix. Already-named-table entries are left alone.
    const srcPrefix = this._importSource.trim();
    if (!this._importSeed?._charSeed && srcPrefix) {
      for (const t of tables) {
        const nm = t.name ?? "";
        if (/^character names:/i.test(nm)) continue;
        if (/\bnames$/i.test(nm)) t.name = sourcedTableName(srcPrefix, nm);
        else if (/\btrinkets$/i.test(nm) && !nm.toLowerCase().startsWith(srcPrefix.toLowerCase())) {
          t.name = `${srcPrefix} - ${nm}`;
        }
      }
    }

    // Character-content types (Backgrounds / Talents / Class) parse into their
    // own draft list; everything else clears it. A background-table bundle seed
    // additionally parses the individual Background items from the same paste
    // (the table above; the items here) so one commit unlocks both.
    this._importChar = ["backgrounds", "talents", "classes", "classtables", "ancestries"].includes(type)
      ? parseCharContent(text, type)
      : (this._importSeed?._bgBundle ? parseCharContent(text, "backgrounds") : []);

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

  /**
   * Shared commit-report line: "N created[, N updated][, N replaced][, N
   * skipped]" — the single formatter for every per-type commit notification
   * (was copy-pasted per handler; review 2026-07-11 maintainability).
   */
  static _commitSummary(result) {
    const parts = [`${result.created.length} created`];
    if (result.updated?.length) parts.push(`${result.updated.length} updated`);
    if (result.replaced?.length) parts.push(`${result.replaced.length} replaced`);
    if (result.skipped?.length) parts.push(`${result.skipped.length} skipped`);
    return parts.join(", ");
  }

  /**
   * Preview description edits: keep deliberately-typed HTML (sanitized again
   * at the commit choke point, review #1), wrap plain text as one paragraph
   * (D4). Shared by the item and spell field-edit wiring.
   */
  static _wrapEditedHtml(v) {
    const trimmed = String(v ?? "").trim();
    return trimmed.startsWith("<") ? trimmed : (trimmed ? `<p>${trimmed}</p>` : "<p></p>");
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

    ui.notifications.info(`Items: ${ImporterHubApp._commitSummary(result)} → sde-items${source ? ` / ${source}` : ""}.`);
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

    ui.notifications.info(`Spells: ${ImporterHubApp._commitSummary(result)} → sde-items${source ? ` / ${source}` : ""}.`);
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

    ui.notifications.info(`Monsters: ${ImporterHubApp._commitSummary(result)} → ${MonsterImporter.PACK_LABEL}${source ? ` / ${source}` : ""}.`);
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
    // Compound grids (Traps/Hazards, name generators) land as sde-tables just
    // like plain tables — drop the char + Manage-tree caches so the census
    // re-scans and their Unlock buttons clear (parity with _onHubCommitTables).
    this._invalidateCharCache();
    if (created) this._announceContentUnlocked();
    this.render();
  }

  // (_fileCharTable removed — createTable now files every table via the
  // category-first resolver in table-folders.mjs, incl. char-content paths
  // like Character Content → Ancestries → Names.)

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
        parts.push(`monsters: ${ImporterHubApp._commitSummary(result)}`);
        this._importMonsters = [];
      }
    }

    // Items second
    if (hasItems) {
      const { ItemImporter } = await import("./item-importer.mjs");
      const drafts = this._importItems.map((p) => p.draft);
      const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
      if (result) {
        parts.push(`items: ${ImporterHubApp._commitSummary(result)}`);
        this._importItems = [];
      }
    }

    // Spells third
    if (hasSpells) {
      const result = await this._commitSpells(source);
      if (result) {
        parts.push(`spells: ${ImporterHubApp._commitSummary(result)}`);
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
  /** Migrate world RollTables into sde-tables — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onMigrateCompendium() {
    const { migrateCompendiumTables } = await import("./importer-hub-maintenance.mjs");
    return migrateCompendiumTables(this);
  }

  /** Export the suite as one JSON bundle (REQ-25) — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onExportBundle() {
    const { exportSuiteBundle } = await import("./importer-hub-maintenance.mjs");
    return exportSuiteBundle(this);
  }

  /** Import a suite bundle JSON (REQ-25) — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onImportBundle() {
    const { importSuiteBundle } = await import("./importer-hub-maintenance.mjs");
    return importSuiteBundle(this);
  }

  /** Manage the source-PDF library — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onManageSourcePdfs() {
    const { manageSourcePdfs } = await import("./importer-hub-maintenance.mjs");
    return manageSourcePdfs(this);
  }

  /** Re-link sde-tables to imported monsters/items (REQ-24) — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onRelinkTables() {
    const { relinkPackTables } = await import("./importer-hub-maintenance.mjs");
    return relinkPackTables(this);
  }

  /** Fold the legacy Loot pack into sde-items — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onFoldLegacyLoot() {
    const { foldLegacyLoot } = await import("./importer-hub-maintenance.mjs");
    return foldLegacyLoot(this);
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
    const src = target.dataset.src ?? "";
    // Trailing newline so the seeded name reads as a title line and the GM's
    // pasted section lands on the line AFTER it (review: unlock line break).
    this._importText = `${name}\n`;
    this._importSeed = { name, src, _monsterSeed: true };
    this._importType = "monsters";
    // Monster gaps carry a source (book) but no page cite — stamp the source so
    // the import folder + the "Grab from PDF" extractor default to the book.
    if (src) this._importSource = CHAR_SOURCES[src]?.label ?? src;
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
    // Trailing newline so the seeded name reads as a title line and the GM's
    // pasted section lands on the line AFTER it (review: unlock line break).
    this._importText = `${name}\n`;
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
  /** Open the dedicated Class Importer workspace (classes have their own
   *  guided body → roll-tables → titles flow, not the generic paste box). */
  async _onOpenClassImporter() {
    const { ClassImporterApp } = await import("./class-importer-app.mjs");
    ClassImporterApp.open();
  }

  /** Open the dedicated Spell Importer workspace (Class → Tier → Alignment). */
  async _onOpenSpellImporter() {
    const { SpellImporterApp } = await import("./spell-importer-app.mjs");
    SpellImporterApp.open();
  }

  /** Bulk-import a caster spell list (Druid/Sorcerer/Mage/Priest/Necromancer):
   *  open the Spell Importer preset to that list's class + alignment + source and
   *  deep-link its PDF, so the GM pastes the whole section once. */
  async _onSpellListSeed(event, target) {
    const key = target?.dataset?.listKey;
    if (!key) return;
    const { SpellImporterApp } = await import("./spell-importer-app.mjs");
    const app = SpellImporterApp.open();
    app._reset();            // fresh list — never carry a stale parsed batch
    app._onSelectList(key);  // sets class + alignment + source, opens the PDF, renders
  }

  _onCharSeedPaste(event, target) {
    const name = target.dataset.name ?? "";
    const type = target.dataset.type ?? "";
    const src = target.dataset.src ?? "";
    if (!name) return;
    // Spells go to their own Class → Tier → Alignment workspace.
    if (type === "Spell") {
      import("./spell-importer-app.mjs").then(({ SpellImporterApp }) => {
        const app = SpellImporterApp.open();
        app._reset();   // fresh unlock — never import a stale parsed batch (review #2)
        if (src) app._source = CHAR_SOURCES[src]?.label ?? src;
        if (name) app._pasteText = `${name}\n`;   // start the paste with the unlocked spell's name
        app.render();
      });
      return;
    }

    // Classes go to their own workspace, not the generic paste box.
    if (type === "Class") {
      import("./class-importer-app.mjs").then(async ({ ClassImporterApp }) => {
        const app = ClassImporterApp.open();
        app._reset();   // fresh unlock — clear any prior class's state (review #2)
        if (src) app._source = CHAR_SOURCES[src]?.label ?? src;
        // Seed the class name so the workspace knows which class it's unlocking.
        if (name) app._seedClassName = name;
        app.render();
        // One-click flow (matches every other unlock): open the writeup PDF
        // straight to the class's page — no separate Open-PDF click.
        const { overlayFor } = await import("./class-overlays.mjs");
        const page = target.dataset.pages || overlayFor(name)?.pages;
        const href = sourcePdfHref(src, page);
        if (href) this._showSourcePdf(href, `${name} writeup${page ? ` — p.${page}` : ""}`);
      });
      return;
    }
    const importType = ({
      Spell: "spells",
      Basic: "items", Weapon: "items", Armor: "items",
      Background: "backgrounds",
      Talent: "talents",
      Class: "classes", Ancestry: "ancestries",
      Table: "tables",
    })[type] ?? "auto";
    // Background roll tables bundle-unlock: one paste creates both the d100
    // table AND the individual Background items (the char-builder lists those
    // for picking). Flagged so _onHubParse also runs the backgrounds parser.
    const bgBundle = type === "Table"
      && BACKGROUND_TABLES.has(name.toLowerCase().replace(/\s+/g, " ").trim());
    // Trailing newline so the seeded name reads as a title line and the GM's
    // pasted section lands on the line AFTER it (review: unlock line break).
    this._importText = `${name}\n`;
    this._importSeed = {
      name,
      src,
      type,
      // Persistent content id (PDF-import review §09 rec #2): prefer the id the
      // manage-tree stamped, else derive it from the name via the registry's
      // reverse index. Drives collision-free shape dispatch in _onHubParse.
      contentId: target.dataset.contentId || contentIdForName(name, src) || undefined,
      page: target.dataset.pages || undefined,
      book: CHAR_SOURCES[src]?.book || src || undefined,
      _charSeed: true,
      _bgBundle: bgBundle,
    };
    this._importType = importType;
    if (src && CHAR_SOURCES[src]) this._importSource = CHAR_SOURCES[src].label;
    this.render();
    // One-click flow: if this source's PDF is uploaded and the entry has a page
    // cite, open the viewer straight to it — no separate Open-PDF click needed.
    const href = sourcePdfHref(src, this._importSeed.page);
    if (href) this._showSourcePdf(href, `${name}${this._importSeed.page ? ` — p.${this._importSeed.page}` : ""}`);
  }

  /** Open (or re-point) the in-Foundry PDF viewer at `href`, titled `title`. */
  async _showSourcePdf(href, title) {
    if (!href) return;
    const { SourcePdfViewer } = await import("./source-pdf-viewer.mjs");
    SourcePdfViewer.show(href, title);
  }

  /**
   * Open the user's uploaded source PDF at the seed's cited page in Foundry's
   * core PDF.js viewer (own local copy — nothing is bundled), embedded in a
   * Foundry window rather than an external browser tab. Reuses one viewer
   * window so repeated clicks re-jump the page in place.
   */
  async _onOpenSourcePdf(event, target) {
    const href = target?.dataset?.href;
    if (!href) return;
    const seed = this._importSeed;
    const title = seed?.name
      ? `${seed.name}${seed.page ? ` — p.${seed.page}` : ""}`
      : "Source PDF";
    this._showSourcePdf(href, title);
  }

  /**
   * "Grab text" (seed flow): pull the cited page's text straight out of the
   * source PDF and drop it into the paste box — no viewer, no drag-selecting.
   * Uses Foundry's bundled PDF.js (see pdf-text-extract.mjs); column-aware so
   * two-column spell/table pages come out in reading order. Appends after
   * whatever's already in the box (the seeded name line stays the title).
   */
  async _onGrabPdfText() {
    const seed = this._importSeed;
    const target = seed ? sourcePdfTarget(seed.src, seed.page) : null;
    if (!target) {
      ui.notifications.warn("No source PDF is linked for this entry, or it has no page cite. Use “Source PDFs” to upload the book.");
      return;
    }
    // Preserve any live edits in the box before we append to it.
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;

    // A page cite may be a RANGE ("74-77", the WR d100 background list). Expand
    // it to every PDF page (offset-corrected per page via sourcePdfTarget) so a
    // multi-page table imports whole, not just its first page. A background
    // bundle forces 1-column extraction: 2-column mode splits each entry's
    // description off its name, which the "Name. Text" background parser drops.
    const { extractPdfText, parsePageRange } = await import("./pdf-text-extract.mjs");
    const bookPages = parsePageRange(seed.page);
    const pdfPages = (bookPages.length ? bookPages : [null])
      .map((bp) => (bp == null ? target.page : sourcePdfTarget(seed.src, String(bp))?.page))
      .filter((p) => p != null);
    const columns = seed._bgBundle ? "1" : "auto";

    let result;
    try {
      result = await extractPdfText(target.file, { pages: pdfPages.length ? pdfPages : [target.page], columns });
    } catch (err) {
      console.error("Shadowdark Enhancer | PDF text extraction failed", err);
      ui.notifications.error("Couldn't read text from that PDF page — see the console.");
      return;
    }
    if (!result.text) {
      ui.notifications.warn(`Page ${target.page} has no selectable text (likely a scanned or art page).`);
      return;
    }
    const base = this._importText.replace(/\s*$/, "");
    this._importText = base ? `${base}\n${result.text}\n` : `${result.text}\n`;
    this.render();
    ui.notifications.info(`Pulled page ${target.page} into the paste box — review, then Parse.`);
  }

  /**
   * The CHAR_SOURCES key to pre-select in the Extract dialog: from the active
   * seed's source (a manifest key like "CS4" or a display label like "Western
   * Reaches") or the free-text Source field. Lets a monster-gap "Grab from PDF"
   * open straight to the right book. Null when nothing matches.
   */
  _defaultExtractSrc() {
    const cand = String(this._importSeed?.src || this._importSource || "").trim().toLowerCase();
    if (!cand) return null;
    for (const [k, v] of Object.entries(CHAR_SOURCES)) {
      if (k.toLowerCase() === cand
        || (v.label && v.label.toLowerCase() === cand)
        || (v.book && v.book.toLowerCase() === cand)) return k;
    }
    return null;
  }

  /**
   * "Extract from PDF" (standalone): pick a linked source book, a page or page
   * range, and column handling, then drop the extracted text into the paste
   * box. Same engine as the seed-flow grab, but page-driven for content that
   * isn't tied to an unlock row (e.g. monster-census gaps, which know the book
   * but not the page). Pre-selects the book from the active seed / source.
   */
  async _onExtractPdf() {
    const { listSourcePdfs } = await import("./source-pdf-registry.mjs");
    const rows = (await listSourcePdfs()).filter((r) => r.linked && r.file);
    if (!rows.length) {
      ui.notifications.warn("No source PDFs are linked yet. Use “Source PDFs” to upload your books first.");
      return;
    }
    const defaultSrc = this._defaultExtractSrc();
    const options = rows
      .map((r) => `<option value="${r.src}"${r.src === defaultSrc ? " selected" : ""}>${foundry.utils.escapeHTML(r.label)}</option>`)
      .join("");
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: "Extract text from PDF", icon: "fas fa-file-pdf" },
      content: `
        <p>Pull clean, reading-ordered text out of one of your uploaded books
        using Foundry's built-in PDF engine — nothing is uploaded.</p>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:0.4rem 0.6rem;align-items:center;">
          <label for="sde-xpdf-src"><strong>Book</strong></label>
          <select id="sde-xpdf-src" name="src">${options}</select>
          <label for="sde-xpdf-pages"><strong>Pages</strong></label>
          <input id="sde-xpdf-pages" name="pages" type="text" placeholder="e.g. 34 or 34-36 or 12,16,20-22">
          <label for="sde-xpdf-cols"><strong>Columns</strong></label>
          <select id="sde-xpdf-cols" name="cols">
            <option value="auto" selected>Auto-detect</option>
            <option value="1">Single column</option>
            <option value="2">Two columns</option>
          </select>
        </div>
        <p class="notes">These are the book's own PDF page numbers (including cover/credits), not the printed page. Auto-detect handles two-column spell/table pages; force Single/Two if a page comes out jumbled.</p>`,
      buttons: [
        { action: "extract", label: "Extract", icon: "fas fa-file-pdf", default: true,
          callback: (event, button) => ({
            src: button.form.elements.src.value,
            pages: button.form.elements.pages.value,
            cols: button.form.elements.cols.value,
          }) },
        { action: "cancel", label: "Cancel", icon: "fas fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!picked || picked === "cancel") return;

    const { resolveSourcePdf } = await import("./source-pdf-registry.mjs");
    const file = resolveSourcePdf(picked.src);
    if (!file) { ui.notifications.warn("That book isn't linked to a PDF."); return; }

    const { extractPdfText, parsePageRange } = await import("./pdf-text-extract.mjs");
    let result;
    try {
      const doc = await extractPdfText(file, { pages: [1] });   // cheap open to learn page count
      const pages = parsePageRange(picked.pages, doc.numPages);
      if (!pages.length) {
        ui.notifications.warn("Enter at least one valid page number.");
        return;
      }
      result = await extractPdfText(file, { pages, columns: picked.cols });
    } catch (err) {
      console.error("Shadowdark Enhancer | PDF text extraction failed", err);
      ui.notifications.error("Couldn't read text from that PDF — see the console.");
      return;
    }
    if (!result.text) {
      ui.notifications.warn("Those pages have no selectable text (likely scanned or art pages).");
      return;
    }
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;
    const base = this._importText.replace(/\s*$/, "");
    this._importText = base ? `${base}\n${result.text}\n` : `${result.text}\n`;
    // Stamp the source label from the picked book if the field is empty.
    if (!this._importSource.trim() && CHAR_SOURCES[picked.src]) {
      this._importSource = CHAR_SOURCES[picked.src].label;
    }
    this.render();
    const empties = result.pages.filter((p) => p.empty).map((p) => p.page);
    const emptyNote = empties.length ? ` (${empties.length} page${empties.length > 1 ? "s" : ""} had no text: ${empties.join(", ")})` : "";
    ui.notifications.info(`Extracted ${result.pages.length - empties.length} page(s) into the paste box${emptyNote} — review, then Parse.`);
  }

  /** Commit parsed Background/Talent/Class drafts into sde-items. GM-gated. */
  async _onHubCommitChar() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import content."); return; }
    // RETIRED sealed path — DEAD (_importSealed is never set; see above).
    if (this._importSealed) {
      const { importSealedPayload } = await import("./sealed-content.mjs");
      const created = await importSealedPayload(this._importSealed.payload);
      const reused = created.filter((c) => c.reused).length;
      const madeNew = created.length - reused;
      ui.notifications.info(`"${this._importSealed.unit.name}" unlocked: ${madeNew} created${reused ? `, ${reused} already in library (reused)` : ""}.`);
      this._importSealed = null;
      this._importSeed = null;
      this._invalidateItemsCache();
      this._invalidateCharCache();
      this._announceContentUnlocked();
      this.render();
      return;
    }
    if (!this._importChar.length) { ui.notifications.warn("No character content to import."); return; }
    const bgBundle = this._importSeed?._bgBundle;

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

    // Full class units (parse-and-author path) go through the class-unit
    // importer: talents + 2d6 table + wired Class, in dependency order.
    const unitDrafts  = this._importChar.filter((p) => p.draft.classUnit);
    const suppDrafts  = this._importChar.filter((p) => p.draft.classSupplement);
    const plainDrafts = this._importChar.filter((p) => !p.draft.classUnit && !p.draft.classSupplement);

    const parts = [];
    if (unitDrafts.length) {
      const { createClassUnit } = await import("./class-unit-importer.mjs");
      const { overlayFor } = await import("./class-overlays.mjs");
      for (const p of unitDrafts) {
        // SDE wiring overlay (effects, invented outcome names) — the paste
        // supplies the text, the overlay supplies the plumbing.
        const overlay = overlayFor(p.draft.name);
        // Stage 1: the class BODY only (description + features). Roll tables are
        // imported in Stage 2 ("Class · Roll Tables") and attached.
        const rep = await createClassUnit(p.draft.classUnit, { source, sourceTitle, overlay, bodyOnly: true });
        if (!rep) continue;
        const updated = rep.updated ?? [];
        parts.push(`class "${p.draft.name}": ${rep.created.length} created, ${updated.length} updated, ${rep.reused.length} reused, ${rep.systemReuse.length} system talents linked`);
        if (updated.length) {
          // Corrected re-import summary (review #12): say WHAT changed, per doc.
          console.info(`${MODULE_ID} | class import "${p.draft.name}" — updated in place:\n- ${
            updated.map((u) => `${u.type} "${u.name}": ${u.fields.join(", ")}`).join("\n- ")}`);
        }
        if (rep.warnings.length) {
          console.warn(`${MODULE_ID} | class import "${p.draft.name}" — review notes:\n- ${rep.warnings.join("\n- ")}`);
          ui.notifications.warn(`"${p.draft.name}" imported with ${rep.warnings.length} review note(s) — see the console (F12).`);
        }
      }
    }

    // Stage-2 supplements: merge parsed tables/titles/spells-known onto the
    // chosen already-imported class (mergeClassSupplement). Drafts with no
    // target picked are kept below so the user can attach and re-commit.
    if (suppDrafts.length) {
      const { mergeClassSupplement } = await import("./class-unit-importer.mjs");
      for (const p of suppDrafts) {
        if (!p.draft.attachTo) {
          ui.notifications.warn(`"${p.draft.name}" — pick a class to attach these tables to first.`);
          continue;
        }
        const rep = await mergeClassSupplement(p.draft.attachTo, p.draft.classSupplement, { source, sourceTitle });
        if (!rep) continue;
        const target = await fromUuid(p.draft.attachTo).catch(() => null);
        parts.push(`tables → "${target?.name ?? "class"}": ${rep.created.length} created, ${rep.updated.length} updated, ${rep.reused.length} reused`);
        if (rep.warnings.length) {
          console.warn(`${MODULE_ID} | class supplement → "${target?.name ?? p.draft.attachTo}" — review notes:\n- ${rep.warnings.join("\n- ")}`);
          ui.notifications.warn(`Class tables merged with ${rep.warnings.length} review note(s) — see the console (F12).`);
        }
      }
    }

    if (plainDrafts.length) {
      // Ancestry drafts: resolve fixed-language NAMES → language-item UUIDs and
      // create+link the inline ancestry talent, because the system (and the
      // char-builder) store both as item UUIDs. Runs before the ancestry is
      // created so the talent UUID exists to reference.
      for (const p of plainDrafts) {
        if (p.draft.type === "Ancestry") await this._resolveAncestryDraft(p.draft, sourceTitle, source);
      }
      const drafts = plainDrafts.map((p) => ({ ...p.draft, sourceTitle }));
      const { ItemImporter } = await import("./item-importer.mjs");
      const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
      if (!result) return;
      parts.push(`${result.created.length} created`);
      if (result.replaced.length) parts.push(`${result.replaced.length} replaced`);
      if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    }
    ui.notifications.info(`Character content: ${parts.join("; ")} → suite packs${source ? ` / ${source}` : ""}.`);
    // Keep supplement drafts the user never assigned a target — everything
    // committed (units, plain items, attached supplements) is cleared.
    this._importChar = this._importChar.filter((p) => p.draft.classSupplement && !p.draft.attachTo);
    this._attachChoices = null;   // a class imported this run should now be attachable
    this._invalidateItemsCache();
    this._invalidateCharCache();
    this._announceContentUnlocked();
    // Background bundle: the same paste also yielded the d100 roll table — commit
    // it now so one click unlocks both the items and the table.
    if (bgBundle && this._importTables.length) {
      await this._onHubCommitTables();
      return;   // _onHubCommitTables renders
    }
    this.render();
  }

  /**
   * Ancestry commit pre-pass: make a parsed ancestry char-builder-ready.
   *   • languages.fixed: map recognised NAMES ("Common","Elvish") → the system's
   *     language-item UUIDs (the builder pools fixed languages by UUID). Unknown
   *     names are left as-is for the GM to fix on the sheet.
   *   • talent {name,text}: create it as an "ancestry" Talent item in sde-items
   *     and link its UUID into system.talents (with talentChoiceCount 1), so the
   *     builder grants it — instead of losing it in the description.
   * Idempotent: a re-import reuses/finds the existing talent by name.
   */
  async _resolveAncestryDraft(draft, sourceTitle, source) {
    // Languages: names → UUIDs.
    const fixed = Array.isArray(draft.languages?.fixed) ? draft.languages.fixed : [];
    if (fixed.some((f) => !/^Compendium\./.test(f))) {
      const byName = {};
      for (const getter of ["commonLanguages", "rareLanguages"]) {
        try { for (const d of await shadowdark.compendiums[getter]()) byName[d.name.toLowerCase()] = d.uuid; }
        catch (_e) { /* language pack unavailable — keep names */ }
      }
      draft.languages.fixed = fixed.map((f) => /^Compendium\./.test(f) ? f : (byName[String(f).toLowerCase()] ?? f));
    }
    // Talent: reuse an existing same-named ancestry talent (idempotent
    // re-import), else create it. Check FIRST so a re-import never duplicates.
    // Talents route to world.talents (createItems type-routing), so probe there.
    if (draft.talent?.name && draft.talent?.text) {
      const { findSuitePack } = await import("./compendium-suite.mjs");
      const pack = findSuitePack("talents");
      let uuid = null;
      if (pack) {
        const idx = await pack.getIndex({ fields: ["type"] });
        const hit = [...idx].find((e) => e.type === "Talent" && e.name === draft.talent.name);
        if (hit) uuid = `Compendium.${pack.collection}.Item.${hit._id}`;
      }
      if (!uuid) {
        const { ItemImporter } = await import("./item-importer.mjs");
        const res = await ItemImporter.createItems([{
          name: draft.talent.name, type: "Talent", talentClass: "ancestry",
          description: `<p>${draft.talent.text}</p>`, sourceTitle,
        }], { source, onConflict: this._itemConflictDialog() });
        uuid = res?.created?.[0]?.uuid ?? res?.replaced?.[0]?.uuid ?? null;
      }
      if (uuid) { draft.talents = [uuid]; draft.talentChoiceCount = 1; }
      delete draft.talent;
    }
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

  /** Backfill imported NPCs to fresh-import fidelity — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onBackfill() {
    const { backfillMonsters } = await import("./importer-hub-maintenance.mjs");
    return backfillMonsters(this);
  }

  /** Migrate world imported actors into sde-actors — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onMigrateSuite() {
    const { migrateSuiteActors } = await import("./importer-hub-maintenance.mjs");
    return migrateSuiteActors(this);
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
