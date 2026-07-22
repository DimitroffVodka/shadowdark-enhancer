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
import { npcMoveKeys } from "../monster-creator/npc-moves.mjs";
import { CATEGORIES, CUSTOM_ID } from "./tables/table-categories.mjs";
import { CHAR_SOURCES } from "./char-content/char-content-manifest.mjs";
import { sourcePdfHref, sourcePdfTarget } from "./source-pdf-registry.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { SOURCE_SUGGESTIONS, BOOK_SOURCES, FORMAT_EXAMPLES, flaggedRowNames, warnFields } from "./importer-hub-shared.mjs";
import { installHubPaste } from "./importer-hub-paste.mjs";
import { installHubCommit } from "./importer-hub-commit.mjs";
import { installHubManage } from "./importer-hub-manage.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ImporterHubApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-importer-hub",
    window: { title: "Importer", icon: "fas fa-file-import", resizable: true },
    position: { width: 860, height: 780 },
    actions: {
      // Parse / clear
      hubParse:               function (...args) { return this._onHubParse(...args); },
      hubParseCompound:       function (...args) { return this._onHubParseCompound(...args); },
      hubParseCartesian:      function (...args) { return this._onHubParseCartesian(...args); },
      hubClear:               function (...args) { return this._onHubClear(...args); },
      // Monster section structural actions
      mimportAddAttack:       function (...args) { return this._onMimportAddAttack(...args); },
      mimportAddSpecial:      function (...args) { return this._onMimportAddSpecial(...args); },
      mimportRemoveAttack:    function (...args) { return this._onMimportRemoveAttack(...args); },
      mimportAddFeature:      function (...args) { return this._onMimportAddFeature(...args); },
      mimportRemoveFeature:   function (...args) { return this._onMimportRemoveFeature(...args); },
      mimportRemoveMonster:   function (...args) { return this._onMimportRemoveMonster(...args); },
      // Item section structural actions
      iimportRemoveItem:      function (...args) { return this._onIimportRemoveItem(...args); },
      // Spell section structural actions
      simportRemoveSpell:     function (...args) { return this._onSimportRemoveSpell(...args); },
      // Table section structural actions
      importAddRow:           function (...args) { return this._onImportAddRow(...args); },
      importDeleteRow:        function (...args) { return this._onImportDeleteRow(...args); },
      importUnlinkRow:        function (...args) { return this._onImportUnlinkRow(...args); },
      // Compound-generator structural actions
      genAddColumn:           function (...args) { return this._onGenAddColumn(...args); },
      genRemoveColumn:        function (...args) { return this._onGenRemoveColumn(...args); },
      genAddRow:              function (...args) { return this._onGenAddRow(...args); },
      genDeleteRow:           function (...args) { return this._onGenDeleteRow(...args); },
      // Commit actions
      hubCommitMonsters:      function (...args) { return this._onHubCommitMonsters(...args); },
      hubCommitItems:         function (...args) { return this._onHubCommitItems(...args); },
      hubCommitSpells:        function (...args) { return this._onHubCommitSpells(...args); },
      hubCommitTables:        function (...args) { return this._onHubCommitTables(...args); },
      hubCommitGenerators:    function (...args) { return this._onHubCommitGenerators(...args); },
      hubCommitAll:           function (...args) { return this._onHubCommitAll(...args); },
      // Bundle export/import
      hubExportBundle:        function (...args) { return this._onExportBundle(...args); },
      hubImportBundle:        function (...args) { return this._onImportBundle(...args); },
      // Source PDF library
      hubManageSourcePdfs:    function (...args) { return this._onManageSourcePdfs(...args); },
      // PDF → text extraction (Foundry's bundled PDF.js; no external tool)
      hubGrabPdfText:         function (...args) { return this._onGrabPdfText(...args); },
      hubExtractPdf:          function (...args) { return this._onExtractPdf(...args); },
      // Manage strip — census/gap/duplicate + maintenance
      monsterGapExpand:       function (...args) { return this._onMonsterGapExpand(...args); },
      monsterSeedPaste:       function (...args) { return this._onMonsterSeedPaste(...args); },
      monsterCullGroup:       function (...args) { return this._onMonsterCullGroup(...args); },
      itemGapExpand:          function (...args) { return this._onItemGapExpand(...args); },
      itemSeedPaste:          function (...args) { return this._onItemSeedPaste(...args); },
      itemCullGroup:          function (...args) { return this._onItemCullGroup(...args); },
      manageNodeExpand:       function (...args) { return this._onManageNodeExpand(...args); },
      manageExpandAll:        function (...args) { return this._onManageExpandAll(...args); },
      manageCollapseAll:      function (...args) { return this._onManageCollapseAll(...args); },
      charSeedPaste:          function (...args) { return this._onCharSeedPaste(...args); },
      spellListSeed:          function (...args) { return this._onSpellListSeed(...args); },
      openClassImporter:      function (...args) { return this._onOpenClassImporter(...args); },
      openSpellImporter:      function (...args) { return this._onOpenSpellImporter(...args); },
      openSourcePdf:          function (...args) { return this._onOpenSourcePdf(...args); },
      hubCommitChar:          function (...args) { return this._onHubCommitChar(...args); },
      cuOptAdd:               function (...args) { return this._onCuOptAdd(...args); },
      cuOptDel:               function (...args) { return this._onCuOptDel(...args); },
      cuRowSplit:             function (...args) { return this._onCuRowSplit(...args); },
      cuRowMerge:             function (...args) { return this._onCuRowMerge(...args); },
      cuRowDel:               function (...args) { return this._onCuRowDel(...args); },
      cuRowAdd:               function (...args) { return this._onCuRowAdd(...args); },
      cuFeatAdd:              function (...args) { return this._onCuFeatAdd(...args); },
      cuFeatDel:              function (...args) { return this._onCuFeatDel(...args); },
      cuTitleAdd:             function (...args) { return this._onCuTitleAdd(...args); },
      cuTitleDel:             function (...args) { return this._onCuTitleDel(...args); },
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
    if (seed) {
      inst._importSeed = seed;
      // A NEW unlock seed means a NEW import: drop the previous unlock's parsed
      // drafts, or the preview keeps showing the last import's tables (e.g. the
      // Armor Benefit rows rendering under a fresh Armor Curse seed) and a
      // Commit would create the stale content instead of the seeded one.
      inst._importTables = []; inst._importMonsters = []; inst._importItems = [];
      inst._importSpells = []; inst._importGenerators = []; inst._importChar = [];
      inst._importSkipped = []; inst._shapeFailNote = null;
      // A matrix TABLE seed (e.g. the Monster Generator / Make It Weird matrices
      // routed in from the Monster Creator) pre-selects the tables type and seeds
      // the paste box with the title line, mirroring the char-content unlock flow
      // so Open PDF / Grab text work immediately. Char seeds set this themselves.
      // A magic base-recipe BUNDLE seed (several tables on one page) carries a
      // `magicSet` + `children` list instead of a single manifestId; leave the
      // paste box empty so the auto-grab fills the whole page for the gate.
      const isMagicBundle = !!(seed.magicSet && Array.isArray(seed.children) && seed.children.length > 1);
      if ((seed.manifestId || seed.magicSet) && !seed._charSeed) {
        inst._importType = "tables";
        inst._importText = (!isMagicBundle && seed.name) ? `${seed.name}\n` : "";
        inst._importItemSubtype = "auto";
        if (seed.src && CHAR_SOURCES[seed.src]) inst._importSource = CHAR_SOURCES[seed.src].label;
      }
    }
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    // One-press Import + extraction for a matrix seed: once the paste box is
    // rendered, pull the cited page straight in (falls back to opening the
    // viewer when the book PDF isn't linked). Best-effort; never blocks open().
    if ((seed?.manifestId || seed?.magicSet) && !seed._charSeed && seed.src && seed.page) {
      Promise.resolve().then(async () => {
        await inst.render();
        if (sourcePdfTarget(seed.src, seed.page)) {
          await inst._onGrabPdfText();
        } else {
          const href = sourcePdfHref(seed.src, seed.page);
          if (href) await inst._showSourcePdf(href, `${seed.name} — p.${seed.page}`);
        }
      }).catch((err) => console.warn(`${MODULE_ID} | matrix seed auto-grab failed`, err));
    }
    return inst;
  }

  /**
   * Open the hub and seed a generic content unlock from an external caller —
   * e.g. the Loot Setup treasure-library Unlock buttons. Mirrors the Manage
   * tree's charSeedPaste flow (name title line + one-press PDF extraction) so
   * every unlock entry point shares one seeding path.
   * @param {{name:string, src?:string, type?:string, contentId?:string|null, page?:string|null}} seed
   */
  static async openContentUnlock(seed) {
    const inst = this.open();
    await inst._seedGenericUnlock(seed);
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

    // Item cards reuse the live draft object (so in-place field edits still
    // address the real draft), adding a read-only stat line for Weapon/Armor so
    // the GM can eyeball the parsed AC/damage/range/properties before committing.
    const importItemCards = this._importItems.map((p, i) => ({
      idx: i,
      draft: p.draft,
      statLine: ImporterHubApp._gearStatLine(p.draft),
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
    // Source is now a fixed dropdown of the eight books. Preserve any current
    // value that isn't one of them (a seed or custom folder) as a selected
    // extra option so it still shows.
    const curSource = this._importSource ?? "";
    const sourceOptions = [
      { value: "", label: "— none —", selected: !curSource },
      ...BOOK_SOURCES.map((b) => ({ value: b, label: b, selected: b === curSource })),
      ...(curSource && !BOOK_SOURCES.includes(curSource)
        ? [{ value: curSource, label: `${curSource} (custom)`, selected: true }] : []),
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
      sourceSuggestions,
      sourceOptions,
      seed: this._importSeed,
      // Deep-link into the user's uploaded source PDF at the cited page, so the
      // GM can jump straight to the section to copy. ANY seed carrying a
      // source-PDF key (`src`) + page cite qualifies — char-content unlocks and
      // matrix-table seeds (Monster Generator / Make It Weird) alike (else null).
      seedPdfHref: (this._importSeed?.src && this._importSeed?.page)
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
      // Type selector — the single "what am I importing" control. Parse-in-
      // place types are grouped first; the two guided workspaces (Spells,
      // Classes) sit in their own group and OPEN when picked (handled in
      // _wireHubType) rather than parsing inline.
      importType: t,
      formatExample: FORMAT_EXAMPLES[t] ?? FORMAT_EXAMPLES.auto,
      typeGroups: [
        { group: "Paste & parse here", options: [
          { value: "auto",       label: "Auto-detect" },
          { value: "monsters",   label: "Monsters" },
          { value: "items",      label: "Items" },
          { value: "tables",     label: "Tables" },
          { value: "backgrounds", label: "Backgrounds" },
          { value: "talents",    label: "Talents" },
          { value: "ancestries", label: "Ancestry" },
          { value: "generators", label: "Compound generator" },
          { value: "cartesian",  label: "Cartesian table" },
        ] },
        { group: "Guided workspaces", options: [
          { value: "__spells",  label: "Spells…" },
          { value: "__classes", label: "Classes…" },
        ] },
      ].map(g => ({ ...g, options: g.options.map(o => ({ ...o, selected: o.value === t })) })),
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
      items: importItemCards,
      spells: importSpellCards,
      tables: this._importTables,
      generators: importGenerators,
      skipped: this._importSkipped,
      hasMonsters, hasItems, hasSpells, hasTables, hasGenerators, showImportAll,
      chars: this._importChar.map((p) => {
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
      hasChar: this._importChar.length > 0,
      charsCount: this._importChar.length,
      charsTitle: "Character content",
      charsCommitLabel: "Create in Items",
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
}

// The hub is one ApplicationV2 split across four files (2026-07): this shell
// (lifecycle, context, singleton, caches' fields) + paste/commit/manage method
// packs installed onto the class here. Actions in DEFAULT_OPTIONS late-bind
// through `this` so the split methods resolve at click time, not at class
// definition time.
installHubPaste(ImporterHubApp);
installHubCommit(ImporterHubApp);
installHubManage(ImporterHubApp);

/**
 * Back-compat entry-point API for Task 2 / shadowdark-enhancer.mjs wiring.
 * tables.openHub(tab, seed) and monsters.openImporter() both route through here.
 * tables.openHub(tab, seed) and monsters.openImporter() both route through here.
 */
export const ImporterHubAPI = {
  open: (tab, seed) => ImporterHubApp.open(tab, seed),
};
