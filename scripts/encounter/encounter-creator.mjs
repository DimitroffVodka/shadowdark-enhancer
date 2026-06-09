/**
 * Shadowdark Enhancer — Monster Creator
 * Slice 1e: a multi-section authoring tool for Shadowdark NPC actors.
 *
 * Mounted inside the Encounter Roller's "creator" tab as a sub-app
 * (Vagabond's mountPanel pattern). Each section is collapsible with
 * state preserved across re-renders.
 *
 * Sub-slice 1e-i: shell + Identity + Description sections + Save.
 * Sub-slice 1e-ii: Stats + Movement + Spellcasting sections.
 * Sub-slice 1e-iii: Actions section (NPC Attack + NPC Special Attack).
 * Sub-slice 1e-iv: Features section (NPC Feature items).
 * Sub-slice 1e-v: Bestiary loader.
 */

import { MODULE_ID } from "../module-id.mjs";
import { _bestArtForActor, _isPlaceholderArt } from "./art-utils.mjs";
import { ACTION_QUICK_PICKS } from "./action-templates.mjs";
import { FEATURE_QUICK_PICKS } from "./feature-templates.mjs";
import {
  MUTATIONS, MUTATION_CATEGORIES,
  getMutation, getConflict, applyMutations, generateMutatedName,
} from "./mutation-data.mjs";
import { createMutatedFromDraft } from "./monster-mutator.mjs";
import { buildNpcNotes, extractFlavor } from "./npc-statblock.mjs";

const { renderTemplate } = foundry.applications.handlebars;

const TEMPLATE_PATH = "modules/shadowdark-enhancer/templates/encounter-creator.hbs";

/**
 * Default shape for a fresh-from-scratch monster. Mirrors the
 * Shadowdark NpcSD schema fields we expose for editing in 1e-i, plus
 * fields reserved for later sub-slices (kept commented out).
 */
function _defaultDraft() {
  return {
    name:        "",
    alignment:   "N",        // L/N/C
    level:       1,
    img:         "icons/svg/mystery-man.svg",
    tokenSrc:    "",         // empty = inherit from img on save
    description: "",
    // Stats — Sub-slice 1e-ii
    hp: { value: 1, max: 1 },
    ac: 10,
    acNote: "",              // AC parenthetical ("shield", "+3 plate mail") for the stat block
    darkAdapted: false,
    abilities: {
      str: 0, dex: 0, con: 0,
      int: 0, wis: 0, cha: 0
    },
    // Movement
    move:     "near",        // close/near/far
    moveNote: "",            // e.g. "climb", "swim"
    // Spellcasting
    spellcasting: {
      ability: "",           // "" (none) / int / wis / cha — lowercase to match
                             //   abilities object keys and Shadowdark schema
      bonus:   0,
      attacks: 0,            // spells-per-round; Browse NPCs filter requires >0
                             //   for "is a spellcaster"
    },
    // Items — Sub-slice 1e-iii / 1e-iv
    actions:  [],            // each: {id, name, type, num, bonus, damage, ranges, description}
    features: [],            // each: {id, name, description}
    // Spells — compendium-picked Spell items attached to the NPC.
    // Each: {uuid, name, img, tierLabel, source} where `source` is the
    // full spell toObject() (minus _id) pushed verbatim on save.
    spells:   [],
  };
}

/**
 * Plain class — NOT extending ApplicationV2.
 *
 * We tried mounting an ApplicationV2 subclass into an external host
 * div via overridden _replaceHTML, but the framework simultaneously
 * creates its own `content` element that conflicts with our manual
 * mount target — `this.element` ends up pointing to an empty,
 * never-displayed div, so subsequent querySelectorAll(...) finds
 * nothing and the visible host stays blank.
 *
 * For a panel that lives inside another app's DOM (mounted into the
 * EncounterRollerApp's creator tab), the simpler pattern is to
 * manage the DOM lifecycle ourselves: render template → set
 * host.innerHTML → wire events. ~30 lines, no framework surprises.
 */
export class MonsterCreatorApp {

  /** Click-action handler map. Each entry's value is called as
   *  `handler.call(this, event, target)` from _wireActions when a
   *  `[data-action]` element is clicked. Same shape ApplicationV2
   *  uses for its actions map, just dispatched manually. */
  static ACTIONS = {
    sectionToggle:              MonsterCreatorApp.prototype._onSectionToggle,
    pickImg:                    MonsterCreatorApp.prototype._onPickImg,
    pickTokenSrc:               MonsterCreatorApp.prototype._onPickTokenSrc,
    creatorAddAction:           MonsterCreatorApp.prototype._onAddAction,
    creatorAddSpecial:          MonsterCreatorApp.prototype._onAddSpecial,
    creatorRemoveAction:        MonsterCreatorApp.prototype._onRemoveAction,
    creatorAddQuickPick:        MonsterCreatorApp.prototype._onAddQuickPick,
    creatorAddFeature:          MonsterCreatorApp.prototype._onAddFeature,
    creatorRemoveFeature:       MonsterCreatorApp.prototype._onRemoveFeature,
    creatorAddFeatureQuickPick: MonsterCreatorApp.prototype._onAddFeatureQuickPick,
    creatorSpellAdd:            MonsterCreatorApp.prototype._onSpellAdd,
    creatorSpellRemove:         MonsterCreatorApp.prototype._onSpellRemove,
    creatorToggleLoader:        MonsterCreatorApp.prototype._onToggleLoader,
    creatorBulkImport:          MonsterCreatorApp.prototype._onBulkImport,
    creatorLoaderPick:          MonsterCreatorApp.prototype._onLoaderPick,
    creatorLoaderToggleSource:  MonsterCreatorApp.prototype._onLoaderToggleSource,
    creatorLoaderSort:          MonsterCreatorApp.prototype._onLoaderSort,
    creatorLoaderToggleAlign:   MonsterCreatorApp.prototype._onLoaderToggleAlign,
    creatorLoaderToggleDark:    MonsterCreatorApp.prototype._onLoaderToggleDark,
    creatorLoaderToggleSpellcaster: MonsterCreatorApp.prototype._onLoaderToggleSpellcaster,
    creatorMutCategory:         MonsterCreatorApp.prototype._onMutCategory,
    creatorMutToggle:           MonsterCreatorApp.prototype._onMutToggle,
    creatorMutApply:            MonsterCreatorApp.prototype._onMutApply,
    creatorMutCreateCopy:       MonsterCreatorApp.prototype._onMutCreateCopy,
    creatorMutClear:            MonsterCreatorApp.prototype._onMutClear,
    save:                       MonsterCreatorApp.prototype._onSave,
  };

  constructor() {
    this._draft = _defaultDraft();
    // Section open/closed state — survives renders. Default: Identity open.
    this._sectionOpen = {
      identity:     true,
      stats:        false,
      movement:     false,
      actions:      false,
      features:     false,
      spellcasting: false,
      mutations:    false,
      description:  false,
    };
    // Mutations section state (survives renders). `_mutSelected` holds the
    // chosen mutation ids; `_mutCategory` is the active catalog filter pill.
    this._mutSelected = [];
    this._mutCategory = "all";
    // Spell picker state (survives renders). The picker only queries the
    // Spell compendiums while there's a search term or tier filter set, so
    // an empty section doesn't load hundreds of spells.
    this._spellSearch = "";
    this._spellTier   = null;   // null = all tiers

    // Text-input focus stashes for cursor preservation across renders.
    this._focused = {};  // { fieldName: {selectionStart} }
    this._lastFocusedField = null;

    // Bestiary Loader state (1e-v). Filters mirror the Browse NPCs tab
    // and run through the same EncounterBrowse.applyFilters/applySort, so
    // behavior stays in lockstep with Browse without duplicating logic.
    this._loaderOpen   = false;
    this._loaderSources = null;   // lazily seeded from settings on first open
    this._loaderSearch        = "";
    this._loaderAlignment     = [];     // empty = all alignments pass
    this._loaderLevelMin      = null;
    this._loaderLevelMax      = null;
    this._loaderHpMin         = null;
    this._loaderHpMax         = null;
    this._loaderAcMin         = null;
    this._loaderAcMax         = null;
    this._loaderMoves         = [];
    this._loaderDarkAdapted   = false;
    this._loaderHasSpellcasting = false;
    this._loaderAbilitySearch = "";
    this._loaderSortCol       = "name";
    this._loaderSortAsc       = true;
  }

  // ─── Singleton + mount/unmount ────────────────────────────────────

  static _instance = null;

  static get instance() {
    if (!this._instance) this._instance = new MonsterCreatorApp();
    return this._instance;
  }

  /** Mounts the creator panel inside the given host element. Called by
   *  EncounterRollerApp when the creator tab is opened. Idempotent —
   *  re-calling with the same host just re-renders. */
  static async mountPanel(host) {
    const inst = this.instance;
    inst._mountHost = host;
    await inst.render();
  }

  /** Unmounts the panel without destroying its state. Called when the
   *  user switches to another tab. State is preserved on the singleton
   *  so reopening the creator tab restores in-progress edits. */
  static unmountPanel() {
    if (this._instance?._mountHost) {
      this._instance._mountHost.innerHTML = "";
      this._instance._mountHost = null;
    }
  }

  /** Open the Encounter Roller directly on the creator tab. */
  static async open() {
    const mod = await import("./encounter-roller-app.mjs");
    return mod.EncounterRollerApp.open("creator");
  }

  // ─── Render lifecycle ────────────────────────────────────────────
  //
  // No ApplicationV2 inheritance — we manage the DOM directly inside
  // the host div EncounterRollerApp gives us. render() is the single
  // entry point; everything else (input wiring, action dispatch, focus
  // restoration) runs from _onRender after the HTML is in place.

  async render() {
    if (!this._mountHost) return;
    try {
      const context = await this._prepareContext();
      const html = await renderTemplate(TEMPLATE_PATH, context);
      this._mountHost.innerHTML = html;
      this._onRender(context);
    } catch (err) {
      // Surface template / context errors visibly in the panel
      // instead of leaving the user with an empty tab.
      console.error(`${MODULE_ID} | Monster Creator render failed:`, err);
      this._mountHost.innerHTML =
        `<div class="sde-creator-error">Monster Creator failed to render: ${err.message}<br><small>Check console for stack trace.</small></div>`;
    }
  }

  async _prepareContext() {
    // Bestiary loader (1e-v): when open, load + filter + sort through the
    // SAME EncounterBrowse pipeline the Browse NPCs tab uses, so the
    // loader's filters behave identically. Only computed while open.
    let loaderData = null;
    if (this._loaderOpen) {
      const { EncounterBrowse } = await import("./encounter-browse.mjs");
      const availableSources = EncounterBrowse.listAvailableSources();
      const availableIds = new Set(availableSources.map(s => s.id));
      // Drop any selected source that no longer exists (pack uninstalled).
      const selectedSources = (this._loaderSources ?? []).filter(id => availableIds.has(id));
      this._loaderSources = selectedSources;

      const all = await EncounterBrowse.loadNPCs(selectedSources);
      const rows = EncounterBrowse.applyFilters(all, {
        search:          this._loaderSearch,
        alignment:       this._loaderAlignment,
        levelMin:        this._loaderLevelMin,
        levelMax:        this._loaderLevelMax,
        hpMin:           this._loaderHpMin,
        hpMax:           this._loaderHpMax,
        acMin:           this._loaderAcMin,
        acMax:           this._loaderAcMax,
        moves:           this._loaderMoves,
        darkAdapted:     this._loaderDarkAdapted,
        hasSpellcasting: this._loaderHasSpellcasting,
        abilitySearch:   this._loaderAbilitySearch,
      });
      EncounterBrowse.applySort(rows, {
        column:    this._loaderSortCol,
        ascending: this._loaderSortAsc,
      });

      loaderData = {
        availableSources,
        selectedSources,
        sourcesLabel:    _loaderSourcesLabel(selectedSources, availableSources),
        rows,
        totalCount:      all.length,
        filteredCount:   rows.length,
        empty:           rows.length === 0,
        noSources:       selectedSources.length === 0,
        search:          this._loaderSearch,
        alignment:       this._loaderAlignment,
        levelMin:        this._loaderLevelMin,
        levelMax:        this._loaderLevelMax,
        hpMin:           this._loaderHpMin,
        hpMax:           this._loaderHpMax,
        acMin:           this._loaderAcMin,
        acMax:           this._loaderAcMax,
        moves:           this._loaderMoves,
        darkAdapted:     this._loaderDarkAdapted,
        hasSpellcasting: this._loaderHasSpellcasting,
        abilitySearch:   this._loaderAbilitySearch,
        sortCol:         this._loaderSortCol,
        sortAsc:         this._loaderSortAsc,
        moveOptions:     Object.keys(CONFIG.SHADOWDARK?.NPC_MOVES ?? {
          close: "", near: "", doubleNear: "", tripleNear: "",
          far: "", special: "", none: "",
        }),
      };
    }

    // Mutations section — category pills + the catalog filtered to the
    // active category, each entry flagged with its current selection and
    // any conflict against an already-selected same-group mutation. The
    // name preview shows what "Create Mutated Copy" would title the actor.
    const mutCategory = this._mutCategory || "all";
    const selectedSet = new Set(this._mutSelected);
    const mutCategories = [
      { key: "all", label: "All", icon: "fa-shapes", active: mutCategory === "all" },
      ...Object.entries(MUTATION_CATEGORIES).map(([key, c]) => ({
        key, label: c.label, icon: c.icon, active: mutCategory === key,
      })),
    ];
    const mutSource = mutCategory === "all"
      ? MUTATIONS
      : MUTATIONS.filter(m => m.category === mutCategory);
    const mutList = mutSource.map(m => {
      const selected = selectedSet.has(m.id);
      return {
        id:               m.id,
        name:             m.name,
        type:             m.type,
        description:      m.description,
        suggestedBaneName: m.suggestedBane ? (getMutation(m.suggestedBane)?.name ?? null) : null,
        selected,
        // Conflict only matters for an unselected card — it tells the user
        // that picking it will replace the named same-group selection.
        conflict:         selected ? null : getConflict(m.id, selectedSet),
      };
    });
    const selectedMutations = this._mutSelected.map(getMutation).filter(Boolean);
    const mutNamePreview = selectedMutations.length
      ? generateMutatedName(
          this._draft.name || "Creature",
          selectedMutations.map(m => m.namePrefix).filter(Boolean),
          selectedMutations.map(m => m.nameSuffix).filter(Boolean),
        )
      : "";

    // Spell picker — only queries the compendiums while the Spellcasting
    // section is open AND a search/tier filter is active. Results cap at
    // 40 rows; already-attached spells are flagged so their + turns into
    // a disabled check. Selected spells (draft.spells) render as chips
    // regardless of query so the user always sees what's attached.
    const draftSpells = this._draft.spells ?? [];
    const selectedSpellUuids = new Set(draftSpells.map(s => s.uuid));
    const spellQuery = this._spellSearch.trim();
    const spellHasQuery = !!spellQuery || this._spellTier != null;
    let spellResults = [];
    if (this._sectionOpen.spellcasting && spellHasQuery) {
      const { SpellIndex } = await import("./spell-index.mjs");
      const all = await SpellIndex.loadAll();
      const filtered = SpellIndex.filter(all, {
        search: spellQuery,
        tier:   this._spellTier,
      });
      SpellIndex.sort(filtered, { column: "tier", ascending: true });
      spellResults = filtered.slice(0, 40).map(r => ({
        ...r,
        added: selectedSpellUuids.has(r.uuid),
      }));
    }
    const spellPicker = {
      search:        this._spellSearch,
      tier:          this._spellTier,
      tierOptions:   [1, 2, 3, 4, 5],
      results:       spellResults,
      resultCount:   spellResults.length,
      capped:        spellResults.length >= 40,
      hasQuery:      spellHasQuery,
      selected:      draftSpells.map(s => ({
        uuid:      s.uuid,
        name:      s.name,
        img:       s.img,
        tierLabel: s.tierLabel,
      })),
      selectedCount: draftSpells.length,
    };

    return {
      draft:       this._draft,
      draftPreview: _draftPreview(this._draft),
      sectionOpen: this._sectionOpen,
      spellPicker,
      mutations: {
        categories:    mutCategories,
        list:          mutList,
        selectedCount: this._mutSelected.length,
        namePreview:   mutNamePreview,
      },
      alignments:  ["L", "N", "C"],
      // Movement options come from the system's NPC_MOVES enum — the
      // full set (close/near/doubleNear/tripleNear/far/special/none),
      // not just close/near/far. Read at render-time so we follow any
      // future system additions automatically.
      moveOptions: Object.keys(CONFIG.SHADOWDARK?.NPC_MOVES ?? {
        close: "", near: "", doubleNear: "", tripleNear: "",
        far: "", special: "", none: "",
      }),
      // Lowercase ability keys to match the system schema. The
      // Spellcasting ability dropdown stores these directly into
      // system.spellcasting.ability, which expects lowercase.
      spellAbilities: ["int", "wis", "cha"],
      // 1e-iii
      ACTION_QUICK_PICKS,
      ranges: Object.keys(CONFIG.SHADOWDARK?.RANGES ?? {
        close: "", near: "", far: "", nearLine: "",
      }),
      // 1e-iv
      FEATURE_QUICK_PICKS,
      // 1e-v — Bestiary Loader. _loaderOpen gates the takeover view;
      // loaderData (null unless open) carries the Browse-style sidebar +
      // table context. Private instance fields are invisible to Handlebars,
      // so everything the template reads has to be returned here.
      _loaderOpen: this._loaderOpen,
      loaderData,
    };
  }

  _onRender(context) {
    this._restoreFocus();
    this._wireActions();
    this._wireFieldInputs();
    this._wireLoaderInputs();
    this._wireSpellInputs();
  }

  /**
   * Wire the spell-picker inputs: a debounced search box (focus-stashed
   * like the loader text filters so the cursor survives the re-render)
   * and a tier `<select>` that commits on change. Both write to the
   * `_spell*` instance fields, not the draft.
   */
  _wireSpellInputs() {
    if (!this._mountHost) return;

    const search = this._mountHost.querySelector("input[data-spell-search]");
    if (search) {
      let t = null;
      search.addEventListener("input", ev => {
        this._focused.__spellSearch = { selectionStart: ev.target.selectionStart };
        this._lastFocusedField = "__spellSearch";
        clearTimeout(t);
        t = setTimeout(() => {
          this._spellSearch = ev.target.value;
          this.render();
        }, 200);
      });
      search.addEventListener("blur", () => {
        if (this._lastFocusedField === "__spellSearch") this._lastFocusedField = null;
      });
    }

    const tier = this._mountHost.querySelector("select[data-spell-tier]");
    if (tier) {
      tier.addEventListener("change", ev => {
        this._spellTier = ev.target.value === "" ? null : Number(ev.target.value);
        this.render();
      });
    }
  }

  /** Manually dispatch clicks on `[data-action="..."]` elements to the
   *  matching handler in ACTIONS. Replaces ApplicationV2's framework
   *  wiring since we no longer extend it. */
  _wireActions() {
    if (!this._mountHost) return;
    this._mountHost.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const action = ev.currentTarget.dataset.action;
        const handler = MonsterCreatorApp.ACTIONS[action];
        if (handler) handler.call(this, ev, ev.currentTarget);
      });
    });
  }

  /**
   * Wire the Bestiary-Loader filter inputs (Browse-style sidebar).
   *
   * These write to `this._loader*` fields directly — NOT to
   * `this._draft` — so they can't use the generic `data-draft-field`
   * binder (which walks down from `this._draft`). The two text inputs
   * (search + abilities) are debounced and stash focus so
   * `_restoreFocus` puts the cursor back after the re-render rebuilds
   * the DOM. Numeric ranges and the move select fire on `change`, so
   * they don't need focus restoration (commit happens on blur/enter).
   */
  _wireLoaderInputs() {
    if (!this._mountHost) return;

    // ── Debounced text inputs (search + abilities) ──
    for (const [selector, prop, focusKey] of [
      ["input[data-loader-search]",  "_loaderSearch",        "__loaderSearch"],
      ["input[data-loader-ability]", "_loaderAbilitySearch", "__loaderAbility"],
    ]) {
      const input = this._mountHost.querySelector(selector);
      if (!input) continue;
      let t = null;
      input.addEventListener("input", ev => {
        this._focused[focusKey] = { selectionStart: ev.target.selectionStart };
        this._lastFocusedField = focusKey;
        clearTimeout(t);
        t = setTimeout(() => {
          this[prop] = ev.target.value;
          this.render();
        }, 200);
      });
      input.addEventListener("blur", () => {
        if (this._lastFocusedField === focusKey) this._lastFocusedField = null;
      });
    }

    // ── Numeric range inputs (level/hp/ac min/max) ──
    for (const [name, prop] of [
      ["loaderLevelMin", "_loaderLevelMin"],
      ["loaderLevelMax", "_loaderLevelMax"],
      ["loaderHpMin",    "_loaderHpMin"],
      ["loaderHpMax",    "_loaderHpMax"],
      ["loaderAcMin",    "_loaderAcMin"],
      ["loaderAcMax",    "_loaderAcMax"],
    ]) {
      const input = this._mountHost.querySelector(`input[name='${name}']`);
      if (!input) continue;
      input.addEventListener("change", ev => {
        const v = ev.target.value;
        this[prop] = v === "" ? null : Number(v);
        this.render();
      });
    }

    // ── Movement select ──
    const moveSelect = this._mountHost.querySelector("select[name='loaderMove']");
    if (moveSelect) {
      moveSelect.addEventListener("change", ev => {
        this._loaderMoves = ev.target.value ? [ev.target.value] : [];
        this.render();
      });
    }
  }

  // ─── Field wiring (text/number inputs use change-events to limit re-renders) ─

  _wireFieldInputs() {
    if (!this._mountHost) return;

    // Generic field-binder: every input with [data-draft-field="path.to.field"]
    // updates this._draft on change. Uses dot-path so we can wire nested
    // fields later (system.attributes.hp.max etc.) the same way.
    this._mountHost.querySelectorAll("[data-draft-field]").forEach(input => {
      input.addEventListener("change", ev => {
        const path = ev.target.dataset.draftField;
        // Array-valued checkbox groups (e.g. actions.N.ranges) — the
        // checkbox has a `value` attribute holding the string we want
        // to add/remove from the existing array. Toggling replaces the
        // array with [oldValues ± value] instead of clobbering it
        // with the checkbox's boolean `checked` state.
        if (ev.target.type === "checkbox" && ev.target.hasAttribute("value")) {
          const tag = ev.target.value;
          const cur = this._getDraft(path);
          const arr = Array.isArray(cur) ? [...cur] : [];
          const at  = arr.indexOf(tag);
          if (ev.target.checked && at === -1) arr.push(tag);
          else if (!ev.target.checked && at !== -1) arr.splice(at, 1);
          this._setDraft(path, arr);
          return;
        }
        let value;
        if (ev.target.type === "checkbox") {
          value = ev.target.checked;
        } else if (ev.target.type === "number") {
          value = Number(ev.target.value);
        } else {
          value = ev.target.value;
        }
        this._setDraft(path, value);
      });
      // For text/textarea inputs, also stash cursor on input so we can
      // restore after re-render. Renders are change-event-driven though,
      // so this is only a safety net for re-renders triggered by other paths.
      if (input.type === "text" || input.tagName === "TEXTAREA") {
        input.addEventListener("input", ev => {
          const path = ev.target.dataset.draftField;
          this._focused[path] = {
            selectionStart: ev.target.selectionStart,
          };
          this._lastFocusedField = path;
        });
        input.addEventListener("focus", ev => {
          this._lastFocusedField = ev.target.dataset.draftField;
        });
      }
    });
  }

  _restoreFocus() {
    // Re-focus the most recently focused field after re-render, putting
    // the cursor back where the user left it. Avoids the cursor-jumps-
    // to-end issue ApplicationV2 has on full re-renders.
    const lastField = this._lastFocusedField;
    if (!lastField) return;
    // Special case: loader text filters use data-attributes (not draft
    // fields — see _wireLoaderInputs for why).
    const selector = lastField === "__loaderSearch"
      ? "input[data-loader-search]"
      : lastField === "__loaderAbility"
      ? "input[data-loader-ability]"
      : lastField === "__spellSearch"
      ? "input[data-spell-search]"
      : `[data-draft-field="${CSS.escape(lastField)}"]`;
    const input = this._mountHost?.querySelector(selector);
    if (input) {
      input.focus();
      const pos = this._focused[lastField]?.selectionStart ?? input.value.length;
      try { input.setSelectionRange(pos, pos); } catch (_) {}
    }
  }

  _setDraft(path, value) {
    // Dot-path setter — handles top-level fields in 1e-i and nested
    // ones (e.g. "hp.max") in later sub-slices without refactoring.
    const parts = path.split(".");
    let obj = this._draft;
    while (parts.length > 1) {
      const key = parts.shift();
      obj[key] ??= {};
      obj = obj[key];
    }
    obj[parts[0]] = value;
    this.render();
  }

  /** Dot-path reader, mirror of _setDraft. Returns undefined if any
   *  segment is missing. Used by the array-checkbox toggle path so we
   *  can read the existing array, mutate, and write back. */
  _getDraft(path) {
    const parts = path.split(".");
    let obj = this._draft;
    for (const key of parts) {
      if (obj == null) return undefined;
      obj = obj[key];
    }
    return obj;
  }

  // ─── Action handlers ──────────────────────────────────────────────

  _onSectionToggle(event, target) {
    const section = target.dataset.section;
    if (!section) return;
    this._sectionOpen[section] = !this._sectionOpen[section];
    this.render();
  }

  _onAddAction() {
    this._draft.actions.push({
      id: foundry.utils.randomID(),
      name: "New Attack",
      type: "NPC Attack",
      num: 1,
      bonus: 0,
      damage: "1d6",
      ranges: ["close"],
      description: "",
    });
    this._sectionOpen.actions = true;
    this.render();
  }

  _onAddSpecial() {
    this._draft.actions.push({
      id: foundry.utils.randomID(),
      name: "New Special",
      type: "NPC Special Attack",
      description: "Description of the special effect.",
    });
    this._sectionOpen.actions = true;
    this.render();
  }

  _onRemoveAction(event, target) {
    const id = target.dataset.id;
    this._draft.actions = this._draft.actions.filter(a => a.id !== id);
    this.render();
  }

  _onAddQuickPick(event, target) {
    const idx = Number(target.dataset.index);
    const template = ACTION_QUICK_PICKS[idx];
    if (!template) return;

    this._draft.actions.push({
      ...foundry.utils.deepClone(template),
      id: foundry.utils.randomID(),
    });
    this._sectionOpen.actions = true;
    this.render();
  }

  _onAddFeature() {
    this._draft.features.push({
      id: foundry.utils.randomID(),
      name: "New Feature",
      description: "Description of the feature.",
    });
    this._sectionOpen.features = true;
    this.render();
  }

  _onRemoveFeature(event, target) {
    const id = target.dataset.id;
    this._draft.features = this._draft.features.filter(f => f.id !== id);
    this.render();
  }

  _onAddFeatureQuickPick(event, target) {
    const idx = Number(target.dataset.index);
    const template = FEATURE_QUICK_PICKS[idx];
    if (!template) return;

    this._draft.features.push({
      ...foundry.utils.deepClone(template),
      id: foundry.utils.randomID(),
    });
    this._sectionOpen.features = true;
    this.render();
  }

  /** Attach a compendium/world Spell item to the draft. Resolves the full
   *  source via fromUuid (async) and stores its toObject() so the save
   *  path can push it verbatim without another lookup. No-op if already
   *  attached or if the uuid doesn't resolve to a Spell. */
  async _onSpellAdd(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    this._draft.spells ??= [];
    if (this._draft.spells.some(s => s.uuid === uuid)) return;
    const doc = await fromUuid(uuid);
    if (!doc || doc.type !== "Spell") {
      ui.notifications.warn("That spell could not be loaded.");
      return;
    }
    const source = doc.toObject();
    delete source._id;
    this._draft.spells.push({
      uuid,
      name:      doc.name,
      img:       doc.img,
      tierLabel: `T${doc.system?.tier ?? 0}`,
      source,
    });
    this.render();
  }

  _onSpellRemove(event, target) {
    const uuid = target.dataset.uuid;
    this._draft.spells = (this._draft.spells ?? []).filter(s => s.uuid !== uuid);
    this.render();
  }

  async _onPickImg() {
    const fp = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: this._draft.img,
      callback: (path) => { this._draft.img = path; this.render(); },
    });
    fp.render(true);
  }

  async _onPickTokenSrc() {
    const fp = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: this._draft.tokenSrc || this._draft.img,
      callback: (path) => { this._draft.tokenSrc = path; this.render(); },
    });
    fp.render(true);
  }

  /** Open the standalone Bulk Monster Importer window (paste → preview → create). */
  async _onBulkImport() {
    const mod = await import("./monster-importer-app.mjs");
    mod.MonsterImporterApp.open();
  }

  _onToggleLoader() {
    this._loaderOpen = !this._loaderOpen;
    // Seed the loader's source selection from the Browse tab's saved
    // setting on first open. This is a loader-LOCAL copy: toggling
    // sources inside the loader does NOT write back to the global
    // `encounterSources` setting, so it never changes what the Browse
    // tab shows. _prepareContext does the actual load/filter/sort.
    if (this._loaderOpen && this._loaderSources === null) {
      this._loaderSources = game.settings.get(MODULE_ID, "encounterSources")
        ?? ["world", "shadowdark.bestiary"];
    }
    this.render();
  }

  _onLoaderToggleSource(event, target) {
    const id = target.dataset.sourceId;
    if (!id) return;
    const set = new Set(this._loaderSources ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this._loaderSources = [...set];
    this.render();
  }

  _onLoaderSort(event, target) {
    const col = target.dataset.column;
    if (!col) return;
    if (col === this._loaderSortCol) {
      this._loaderSortAsc = !this._loaderSortAsc;
    } else {
      this._loaderSortCol = col;
      this._loaderSortAsc = true;
    }
    this.render();
  }

  _onLoaderToggleAlign(event, target) {
    const a = target.dataset.alignment;
    if (!a) return;
    const set = new Set(this._loaderAlignment);
    if (set.has(a)) set.delete(a);
    else set.add(a);
    this._loaderAlignment = [...set];
    this.render();
  }

  _onLoaderToggleDark() {
    this._loaderDarkAdapted = !this._loaderDarkAdapted;
    this.render();
  }

  _onLoaderToggleSpellcaster() {
    this._loaderHasSpellcasting = !this._loaderHasSpellcasting;
    this.render();
  }

  // ─── Mutation handlers ───────────────────────────────────────────

  _onMutCategory(event, target) {
    this._mutCategory = target.dataset.category || "all";
    this.render();
  }

  /** Toggle a mutation in/out of the selection. Selecting a mutation that
   *  shares a conflictGroup with an existing pick (e.g. two body-type HP
   *  mutations) auto-removes the conflicting one, since they can't coexist. */
  _onMutToggle(event, target) {
    const id = target.dataset.mutationId;
    if (!id) return;
    const set = new Set(this._mutSelected);
    if (set.has(id)) {
      set.delete(id);
    } else {
      const mut = getMutation(id);
      if (mut?.conflictGroup) {
        for (const sid of [...set]) {
          if (getMutation(sid)?.conflictGroup === mut.conflictGroup) set.delete(sid);
        }
      }
      set.add(id);
    }
    this._mutSelected = [...set];
    this.render();
  }

  _onMutClear() {
    this._mutSelected = [];
    this.render();
  }

  /** Apply selected mutations to the IN-PROGRESS draft, in place. Opens the
   *  sections the mutations touched so the changes are visible, then clears
   *  the selection. */
  _onMutApply() {
    if (!this._mutSelected.length) {
      ui.notifications.warn("Select at least one mutation to apply.");
      return;
    }
    const { applied } = applyMutations(this._draft, this._mutSelected);
    this._sectionOpen.stats = true;
    this._sectionOpen.actions = this._draft.actions.length > 0;
    this._sectionOpen.features = this._draft.features.length > 0;
    this._mutSelected = [];
    ui.notifications.info(
      `Applied ${applied.length} mutation${applied.length === 1 ? "" : "s"} to the draft.`,
    );
    this.render();
  }

  /** Create a NEW world actor from a mutated COPY of the current draft,
   *  leaving the draft untouched. Mirrors the standalone mutator path. */
  async _onMutCreateCopy() {
    if (!this._mutSelected.length) {
      ui.notifications.warn("Select at least one mutation to create a mutated copy.");
      return;
    }
    if (!this._draft.name?.trim()) {
      ui.notifications.warn("The draft needs a name before creating a mutated copy.");
      return;
    }
    try {
      const actor = await createMutatedFromDraft(this._draft, this._mutSelected);
      ui.notifications.info(`Created mutated copy: ${actor.name}`);
    } catch (err) {
      console.error(MODULE_ID, "Create mutated copy failed:", err);
      ui.notifications.error(`Failed to create mutated copy: ${err.message}`);
    }
  }

  async _onLoaderPick(event, target) {
    const uuid = target.dataset.uuid;
    const actor = await fromUuid(uuid);
    if (actor) {
      await this._draftFromActor(actor);
      this._loaderOpen = false;
      this.render();
    }
  }

  async _draftFromActor(actor) {
    const draft = await actorToDraft(actor);
    this._draft = draft;
    // Open sections that have content
    this._sectionOpen.stats = true;
    this._sectionOpen.actions = draft.actions.length > 0;
    this._sectionOpen.features = draft.features.length > 0;
    this._sectionOpen.spellcasting = !!draft.spellcasting.ability || draft.spells.length > 0;
    this._sectionOpen.description = !!draft.description;
  }

  async _onSave() {
    const d = this._draft;
    if (!d.name?.trim()) {
      ui.notifications.warn("Monster needs a name before it can be saved.");
      return;
    }

    try {
      const { actorData, items } = draftToActorData(d);
      const actor = await Actor.implementation.create(actorData);
      if (items.length) {
        await actor.createEmbeddedDocuments("Item", items);
      }

      ui.notifications.info(`Created NPC: ${actor.name}`);
      // Reset the draft so the form is ready for the next monster.
      this._draft = _defaultDraft();
      this.render();
    } catch (err) {
      console.error(MODULE_ID, "Monster Creator save failed:", err);
      ui.notifications.error(`Failed to save monster: ${err.message}`);
    }
  }
}

// ───── Helpers ─────────────────────────────────────────────────────

/**
 * Wrap a GM-authored description in HTML so the Shadowdark NPC sheet renders it.
 * NpcSheetSD passes item descriptions through jQuery `$(...)`, which throws
 * ("unrecognized expression") on bare text because jQuery reads a non-`<` string
 * as a CSS selector. The system stores its own NPC descriptions as `<p>…</p>`.
 * Idempotent: passes through anything already starting with a tag; "" for empty.
 */
function _descHtml(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  if (s.startsWith("<")) return s;
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p>${esc}</p>`;
}

/**
 * Inverse of _descHtml: flatten stored HTML back to plain text for the editable
 * draft model (the parser + the importer's preview grid speak plain text).
 * Browser-only (uses the DOM); this module is Foundry-bound and never node-imported.
 */
function _stripHtml(html) {
  const s = String(html ?? "");
  if (!s || !s.includes("<")) return s.trim();
  const tmp = document.createElement("div");
  tmp.innerHTML = s;
  return (tmp.textContent || "").replace(/\s+/g, " ").trim();
}

/**
 * Convert a Shadowdark NPC actor into the Monster Creator draft model.
 * Pure (aside from async art resolution) so it can be reused by the
 * standalone Monster Mutator without going through the app instance.
 *
 * @param {Actor} actor
 * @returns {Promise<object>} a draft matching _defaultDraft()'s shape
 */
export async function actorToDraft(actor) {
  const s = actor.system;
  const { img, tokenSrc } = await _bestArtForActor(actor);

  const draft = {
    name:        actor.name,
    // Normalize alignment to a 1-letter code. Shadowdark's canonical
    // form is full words ("lawful"/"neutral"/"chaotic"); our Creator
    // radio buttons store the short form (L/N/C). Without the
    // first-char normalization, loading a bestiary actor leaves all
    // three alignment radios unchecked because no value matches.
    alignment:   (s.alignment || "N").charAt(0).toUpperCase(),
    // system.level is a nested schema ({value, xp}) in Shadowdark,
    // not a plain number. Read .value first; fall back to plain
    // number for any unmigrated data.
    level:       (typeof s.level === "object" ? s.level?.value : s.level) ?? 1,
    img:         img || "icons/svg/mystery-man.svg",
    tokenSrc:    tokenSrc || "",
    description: extractFlavor(s.notes),
    hp: {
      value: s.attributes?.hp?.value ?? 1,
      max:   s.attributes?.hp?.max   ?? 1,
    },
    ac: s.attributes?.ac?.value ?? 10,
    acNote: "",
    darkAdapted: !!s.darkAdapted,
    abilities: {
      str: s.abilities?.str?.mod ?? 0,
      dex: s.abilities?.dex?.mod ?? 0,
      con: s.abilities?.con?.mod ?? 0,
      int: s.abilities?.int?.mod ?? 0,
      wis: s.abilities?.wis?.mod ?? 0,
      cha: s.abilities?.cha?.mod ?? 0,
    },
    move:     s.move || "near",
    moveNote: s.moveNote || "",
    spellcasting: {
      ability: s.spellcasting?.ability || "",
      bonus:   s.spellcasting?.bonus   || 0,
      attacks: s.spellcasting?.attacks || 0,
    },
    actions:  [],
    features: [],
    spells:   [],
  };

  // Split items into Actions, Features, and Spells
  for (const item of actor.items) {
    if (item.type === "NPC Attack" || item.type === "NPC Special Attack") {
      draft.actions.push({
        id:     foundry.utils.randomID(),
        name:   item.name,
        type:   item.type,
        num:    item.system.attack?.num ?? 1,
        bonus:  item.system.bonuses?.attackBonus ?? 0,
        damage: item.system.damage?.value || "",
        ranges: item.system.ranges || [],
        description: _stripHtml(item.system.description || item.system.damage?.special || ""),
      });
    } else if (item.type === "NPC Feature") {
      draft.features.push({
        id:     foundry.utils.randomID(),
        name:   item.name,
        description: _stripHtml(item.system.description || ""),
      });
    } else if (item.type === "Spell") {
      const source = item.toObject();
      delete source._id;
      draft.spells.push({
        uuid:      item.uuid,
        name:      item.name,
        img:       item.img,
        tierLabel: `T${item.system?.tier ?? 0}`,
        source,
      });
    }
  }

  return draft;
}

/**
 * Convert a draft model into Foundry actor-create data plus the embedded
 * item documents to create afterward. Pure — no side effects — so both
 * the Creator's Save and the standalone Mutator share one source of truth
 * for the Shadowdark NPC data shape.
 *
 * @param {object} d — draft model (see _defaultDraft)
 * @returns {{actorData: object, items: object[]}}
 */
export function draftToActorData(d) {
  const name = (d.name || "").trim() || "New Monster";
  const img = d.img || "icons/svg/mystery-man.svg";

  const actorData = {
    name,
    type: "NPC",
    img,
    system: {
      // Shadowdark schema enforces alignment ∈ {lawful, neutral, chaotic}
      // (full words). Our Creator stores the 1-letter UI code; expand
      // here on save so the schema validates and the actor sheet picks
      // the right alignment value.
      alignment: _ALIGNMENT_EXPANDED[d.alignment] ?? "neutral",
      // system.level is a nested schema ({value, xp}) per actorFields
      // .level(). Writing a plain number gets rejected by validation
      // or silently coerced; build the object shape directly.
      level:     { value: Number(d.level ?? 1), xp: 0 },
      notes:     buildNpcNotes(d),
      attributes: {
        hp: {
          value: Number(d.hp.value ?? 1),
          max:   Number(d.hp.max ?? 1),
        },
        ac: { value: Number(d.ac ?? 10), attribute: "" },
      },
      abilities: {
        str: { mod: Number(d.abilities.str ?? 0) },
        dex: { mod: Number(d.abilities.dex ?? 0) },
        con: { mod: Number(d.abilities.con ?? 0) },
        int: { mod: Number(d.abilities.int ?? 0) },
        wis: { mod: Number(d.abilities.wis ?? 0) },
        cha: { mod: Number(d.abilities.cha ?? 0) },
      },
      darkAdapted: !!d.darkAdapted,
      move:     d.move || "near",
      moveNote: d.moveNote || "",
      // Schema is `system.spellcasting.{ability, bonus, attacks}`.
      // Writing the legacy `spellcastingAbility` / `spellAttackBonus`
      // fields would round-trip through NpcSD.migrateData() — clean
      // creates should use the new shape directly.
      spellcasting: {
        ability: d.spellcasting.ability || "",
        bonus:   Number(d.spellcasting.bonus ?? 0),
        attacks: Number(d.spellcasting.attacks ?? 0),
      },
    },
    prototypeToken: {
      name,
      texture: { src: d.tokenSrc || img },
    },
  };

  // ─── Action Items ─────────────────────────────────────────────
  // Schema (NpcAttackSD.mjs):
  //   system.attack:   { num }                                — count only
  //   system.bonuses:  { attackBonus, damageBonus, critical } — sibling
  //   system.damage:   { numDice, special, value }            — `special` rider
  //   system.ranges:   array of CONFIG.SHADOWDARK.RANGES keys
  // `description` is mirrored into `damage.special` for NPC Attack so the
  // action menu's stat-block renderer (slice 1a) shows the rider inline.
  const items = (d.actions ?? []).map(a => {
    const base = {
      name: (a.name || "").trim() || "New Action",
      type: a.type,
      // NPC Attack keeps its rider as PLAIN text (it's mirrored into
      // damage.special, which the action stat-block renderer reads as text).
      // Feature / Special-Attack descriptions must be HTML or the SD NPC sheet's
      // jQuery render throws "unrecognized expression" on the bare text.
      system: { description: a.type === "NPC Attack" ? (a.description || "") : _descHtml(a.description) },
    };
    if (a.type === "NPC Attack") {
      base.system.attack  = { num: Number(a.num ?? 1) };
      base.system.bonuses = { attackBonus: Number(a.bonus ?? 0) };
      base.system.damage  = {
        value:   a.damage || "1d6",
        special: a.description || "",
      };
      base.system.ranges  = Array.isArray(a.ranges) && a.ranges.length
        ? a.ranges
        : ["close"];
    } else if (a.type === "NPC Special Attack") {
      base.system.attack  = { num: Number(a.num ?? 1) };
      base.system.bonuses = { attackBonus: Number(a.bonus ?? 0) };
    }
    return base;
  });

  // ─── Feature Items ────────────────────────────────────────────
  for (const f of (d.features ?? [])) {
    items.push({
      name: (f.name || "").trim() || "New Feature",
      type: "NPC Feature",
      system: { description: _descHtml(f.description) },
    });
  }

  // ─── Spell Items ──────────────────────────────────────────────
  // Each draft.spells entry already holds the full Spell source object
  // (captured via toObject() at add-time). Push it verbatim minus any
  // `_id`, so createEmbeddedDocuments mints a fresh embedded copy.
  for (const sp of (d.spells ?? [])) {
    if (!sp?.source) continue;
    const src = foundry.utils.deepClone(sp.source);
    delete src._id;
    items.push(src);
  }

  return { actorData, items };
}

/**
 * Convert the Creator's 1-letter alignment UI code to the full word
 * Shadowdark stores. The schema's `choices` are the keys of
 * CONFIG.SHADOWDARK.ALIGNMENTS, which are lawful/neutral/chaotic.
 */
const _ALIGNMENT_EXPANDED = {
  L: "lawful",
  N: "neutral",
  C: "chaotic",
};

/**
 * Summary label for the loader's Sources dropdown summary line —
 * "No sources" / "All sources" / single source label / "N sources".
 * Mirrors EncounterRollerApp's private `_multiFilterLabel` (the Browse
 * tab uses the same pattern; it isn't exported, so we keep a local copy).
 *
 * @param {string[]} selectedIds
 * @param {Array<{id:string,label:string}>} options
 * @returns {string}
 */
function _loaderSourcesLabel(selectedIds, options) {
  const optionIds = new Set(options.map(o => o.id));
  const visible = (selectedIds ?? []).filter(id => optionIds.has(id));
  if (!visible.length) return "No sources";
  if (visible.length === options.length) return "All sources";
  if (visible.length === 1) {
    return options.find(o => o.id === visible[0])?.label ?? visible[0];
  }
  return `${visible.length} sources`;
}

/**
 * Build the right-side "alignment + level" label for a bestiary
 * loader row. Renders gracefully when:
 *   - Level is missing (NaN/null/undefined) → show "—" instead of "NaN"
 *   - Alignment is stored as a full word ("lawful"/"neutral"/"chaotic"
 *     — Shadowdark's canonical form) → collapse to a 1-letter code
 *     matching our Creator radio buttons (L/N/C)
 *
 * @param {object} row — loader row {alignment, level, ...}
 * @returns {string}   — e.g. "C 3" or "N —" or "—"
 */
function _draftPreview(d) {
  const level = Number.isFinite(Number(d.level)) ? Number(d.level) : "—";
  const hpValue = Number(d.hp?.value ?? 0);
  const hpMax = Number(d.hp?.max ?? hpValue);
  const hp = hpMax > hpValue ? `${hpValue}/${hpMax}` : String(hpValue);
  const ac = Number.isFinite(Number(d.ac)) ? Number(d.ac) : "—";
  const attack = _draftAttackSummary(d.actions ?? []);
  const traits = (d.features?.length ?? 0)
    + (d.spellcasting?.ability ? 1 : 0)
    + (d.darkAdapted ? 1 : 0);
  return `LV ${level} · HP ${hp} · AC ${ac} · ${attack} · ${traits} trait${traits === 1 ? "" : "s"}`;
}

function _draftAttackSummary(actions) {
  const firstAttack = actions.find(a => a.type === "NPC Attack");
  const specialCount = actions.filter(a => a.type === "NPC Special Attack").length;
  if (!firstAttack && specialCount === 0) return "no attacks";
  const bits = [];
  if (firstAttack) {
    bits.push(`x${Number(firstAttack.num ?? 1)}`);
    const bonus = Number(firstAttack.bonus ?? 0);
    bits.push(`${bonus >= 0 ? "+" : ""}${bonus}`);
    if (firstAttack.damage) bits.push(firstAttack.damage);
  }
  if (specialCount) bits.push("+ special");
  return bits.join(" ");
}

// Convenience accessor — same shape as EncounterRollerApp's API
// exposure in shadowdark-enhancer.mjs.
export const MonsterCreator = MonsterCreatorApp;
