/**
 * Shadowdark Enhancer — Encounter Roller App
 * Slice 1b: ApplicationV2 window shell + 4 tabs.
 *
 * Only the "Roll Tables" tab is functional in 1b; Build Table, Browse
 * NPCs, and Monster Creator render as disabled stubs so the UI shape
 * matches the final design from day one.
 */

import { MODULE_ID } from "../module-id.mjs";
import { DISTANCE, ACTIVITY, reactionBand } from "./encounter-result.mjs";
import { EncounterBrowse } from "./encounter-browse.mjs";
import { EncounterBuild } from "./encounter-build.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
// v13/v14 namespaced renderTemplate (the global emits deprecation warnings).
const { renderTemplate } = foundry.applications.handlebars;

// CHA modifiers in practice fall within ±5 — clamp the stepper to that
// range to keep the UI sane.
const CHA_MOD_MIN = -5;
const CHA_MOD_MAX = 5;

// User flag where we persist this window's position between sessions.
const POSITION_FLAG = "encounterRollerPosition";

export class EncounterRollerApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sde-encounter-roller",
    tag: "form",
    window: {
      title: "Random Encounter",
      icon: "fas fa-dice-d20",
      resizable: true,
    },
    position: {
      // Bumped from 720 → 920 to accommodate the Browse NPCs sidebar
      // (220px) without crushing the results table. The other tabs
      // (Roll Tables, Build Table) fit comfortably at this width too.
      width: 920,
      height: "auto",
    },
    actions: {
      setAsActive:  EncounterRollerApp.prototype._onSetAsActive,
      rollTable:    EncounterRollerApp.prototype._onRollTable,
      reroll:       EncounterRollerApp.prototype._onReroll,
      chaDec:       EncounterRollerApp.prototype._onChaDec,
      chaInc:       EncounterRollerApp.prototype._onChaInc,
      postToChat:   EncounterRollerApp.prototype._onPostToChat,
      placeTokens:  EncounterRollerApp.prototype._onPlaceTokens,
      previewPost:  EncounterRollerApp.prototype._onPreviewPost,
      previewPlace: EncounterRollerApp.prototype._onPreviewPlace,
      browseToggleSource:      EncounterRollerApp.prototype._onBrowseToggleSource,
      browseSort:              EncounterRollerApp.prototype._onBrowseSort,
      browseToggleAlign:       EncounterRollerApp.prototype._onBrowseToggleAlign,
      browseToggleMove:        EncounterRollerApp.prototype._onBrowseToggleMove,
      browseToggleDark:        EncounterRollerApp.prototype._onBrowseToggleDark,
      browseToggleSpellcaster: EncounterRollerApp.prototype._onBrowseToggleSpellcaster,
      browseAddToBuild:        EncounterRollerApp.prototype._onBrowseAddToBuild,
      // Build Table tab — Slice 1c
      buildAddSlot:       EncounterRollerApp.prototype._onBuildAddSlot,
      buildRemoveSlot:    EncounterRollerApp.prototype._onBuildRemoveSlot,
      buildClearSlot:     EncounterRollerApp.prototype._onBuildClearSlot,
      buildPostSlot:      EncounterRollerApp.prototype._onBuildPostSlot,
      buildPlaceSlot:     EncounterRollerApp.prototype._onBuildPlaceSlot,
      buildSave:          EncounterRollerApp.prototype._onBuildSave,
    }
  };

  static PARTS = {
    tabs: {
      template: "modules/shadowdark-enhancer/templates/encounter-roller.hbs",
    }
  };

  constructor(options = {}) {
    // Restore last saved window position from per-user flag.
    const savedPos = game.user.getFlag(MODULE_ID, POSITION_FLAG) ?? null;
    if (savedPos && (Number.isFinite(savedPos.left) || Number.isFinite(savedPos.top))) {
      options.position = { ...(options.position ?? {}), ...savedPos };
    }
    super(options);
    this._activeTab = "tables";
    // The setting stores the active table's full UUID (e.g.
    // "RollTable.abc123") so the encounter-check flow can resolve it
    // without depending on the roller being open. The picker dropdown
    // however uses table IDs as <option value>s, so we resolve the
    // UUID -> ID at construction time. Without this resolution the
    // dropdown would fall back to "-- Select Table --" every time the
    // window reopened, even though the active table was still set.
    const activeTableUuid = game.settings.get(MODULE_ID, "encounterTableUuid");
    this._selectedTableId = activeTableUuid
      ? (fromUuidSync(activeTableUuid)?.id ?? null)
      : null;
    this._lastResult = null;
    // Track the in-flight Place-Tokens listener so we can cancel it on
    // close / escape / app reopen — prevents stale handlers from firing
    // a stray token-drop after the GM moved on.
    this._placeAbort = null;

    // Browse NPCs tab state. Loaded lazily — only when the user actually
    // opens the Browse tab do we read from compendium packs.
    this._browseSources    = game.settings.get(MODULE_ID, "encounterSources") ?? ["world", "shadowdark.bestiary"];
    this._browseSearch     = "";
    this._browseAlignment  = []; // empty array = all alignments pass
    this._browseLevelMin   = null;
    this._browseLevelMax   = null;
    this._browseSortCol    = "name";
    this._browseSortAsc    = true;
    this._browseMoves          = [];
    this._browseDarkAdapted    = false;
    this._browseHasSpellcasting = false;
    this._browseAbilitySearch  = "";
    // Cursor-preservation state for the search input — set on input
    // events, consumed on the next render. Avoids the cursor jumping
    // to the end every keystroke after the first.
    this._browseSearchFocused = false;
    this._browseSearchCursor  = 0;
    // Same trick for the new abilities-search input.
    this._browseAbilityFocused = false;
    this._browseAbilityCursor  = 0;

    // Build Table tab state — Slice 1c.
    // Slots model: each slot is {min, max, name, uuid, appearing, flavor}.
    // Default: one empty slot per face of a d6.
    this._buildDieKey    = EncounterBuild.DEFAULT_DIE_KEY;
    this._buildTableName = "";
    this._buildSlots     = EncounterBuild.defaultSlots(this._buildDieKey);
    // Focus stash for the table-name input — same pattern as the
    // browse search input to keep the cursor stable across renders.
    this._buildNameFocused = false;
    this._buildNameCursor  = 0;
  }

  // ─── Singleton ───

  static _instance = null;

  static async open(tab = "tables") {
    if (!this._instance) {
      this._instance = new EncounterRollerApp();
    }
    this._instance._activeTab = tab;
    if (!this._instance.rendered) {
      await this._instance.render(true);
    } else {
      this._instance.bringToFront();
      this._instance.render();
    }
    return this._instance;
  }

  // ─── Lifecycle ───

  async close(options = {}) {
    // Persist window position so the next open lands where the user left it.
    if (this.position?.left != null && this.position?.top != null) {
      await game.user.setFlag(MODULE_ID, POSITION_FLAG, {
        left: this.position.left,
        top:  this.position.top,
      });
    }
    this._cancelPlaceTokens();
    EncounterRollerApp._instance = null;
    return super.close(options);
  }

  // ─── Data Preparation ───

  async _prepareContext(options) {
    const activeTableUuid = game.settings.get(MODULE_ID, "encounterTableUuid");

    // Group world tables by folder
    const worldTables = game.tables.contents;
    const folders = game.folders.filter(f => f.type === "RollTable");

    const tableGroups = [];

    // Unfoldered
    const rootTables = worldTables.filter(t => !t.folder);
    if (rootTables.length) {
      tableGroups.push({
        name: "No Folder",
        tables: rootTables.map(t => ({
          id: t.id,
          name: t.name,
          isActive: t.uuid === activeTableUuid
        }))
      });
    }

    // Foldered
    for (const folder of folders) {
      const tables = worldTables.filter(t => t.folder?.id === folder.id);
      if (tables.length) {
        tableGroups.push({
          name: folder.name,
          tables: tables.map(t => ({
            id: t.id,
            name: t.name,
            isActive: t.uuid === activeTableUuid
          }))
        });
      }
    }

    // Build a preview of the selected table's contents so the GM can
    // see what monsters might appear before committing to a roll.
    const tablePreview = await this._buildTablePreview(this._selectedTableId);

    // Browse NPCs tab — load + filter + sort, but only when the tab is
    // active so other tabs don't pay the cost.
    let browseData = null;
    if (this._activeTab === "browse") {
      const all = await EncounterBrowse.loadNPCs(this._browseSources);
      const filtered = EncounterBrowse.applyFilters(all, {
        search:          this._browseSearch,
        alignment:       this._browseAlignment,
        levelMin:        this._browseLevelMin,
        levelMax:        this._browseLevelMax,
        moves:           this._browseMoves,
        darkAdapted:     this._browseDarkAdapted,
        hasSpellcasting: this._browseHasSpellcasting,
        abilitySearch:   this._browseAbilitySearch,
      });
      EncounterBrowse.applySort(filtered, {
        column:    this._browseSortCol,
        ascending: this._browseSortAsc,
      });
      browseData = {
        availableSources: EncounterBrowse.listAvailableSources(),
        selectedSources:  this._browseSources,
        rows:             filtered,
        totalCount:       all.length,
        filteredCount:    filtered.length,
        search:           this._browseSearch,
        alignment:        this._browseAlignment,
        levelMin:         this._browseLevelMin,
        levelMax:         this._browseLevelMax,
        moves:            this._browseMoves,
        darkAdapted:      this._browseDarkAdapted,
        hasSpellcasting:  this._browseHasSpellcasting,
        abilitySearch:    this._browseAbilitySearch,
        sortCol:          this._browseSortCol,
        sortAsc:          this._browseSortAsc,
        moveOptions:      Object.keys(CONFIG.SHADOWDARK?.NPC_MOVES ?? {
          close: "", near: "", doubleNear: "", tripleNear: "", far: "", special: "", none: "",
        }),
      };
    }

    // Build Table tab — assemble slot + die data. Only computed when
    // the Build tab is active, mirroring the Browse pattern.
    let buildData = null;
    if (this._activeTab === "build") {
      const die = EncounterBuild.getDie(this._buildDieKey);
      const validation = EncounterBuild.validateSlots(this._buildSlots, this._buildDieKey);
      buildData = {
        dice:      EncounterBuild.DICE,
        dieKey:    this._buildDieKey,
        die,
        tableName: this._buildTableName,
        slots:     this._buildSlots.map((s, idx) => ({
          ...s,
          idx,
          rangeLabel: (s.min === s.max) ? `${s.min}` : `${s.min}-${s.max}`,
          isEmpty:    !s.name,
          isMonster:  !!s.uuid && !s.flavor,
          isFlavor:   !!s.flavor,
        })),
        warnings: validation.filter(v => v.severity === "warning").map(v => v.message),
        errors:   validation.filter(v => v.severity === "error").map(v => v.message),
        canSave:  validation.every(v => v.severity !== "error") && this._buildSlots.some(s => s.name),
      };
    }

    return {
      activeTab: this._activeTab,
      selectedTableId: this._selectedTableId,
      tableGroups,
      tablePreview,
      lastResult: this._lastResult,
      browseData,
      buildData,
    };
  }

  /**
   * Build a row-by-row preview of a RollTable's contents.
   * Each row shows: roll range, resolved monster (or raw text), and the
   * appearing formula if one is set on the result.
   *
   * @param {string} tableId
   * @returns {Promise<{name: string, formula: string, rows: Array} | null>}
   * @private
   */
  async _buildTablePreview(tableId) {
    if (!tableId) return null;
    const table = game.tables.get(tableId);
    if (!table) return null;

    const rows = [];
    for (const r of table.results) {
      // Range label: "1", "2-3", "4-6"
      const [min, max] = r.range ?? [0, 0];
      const range = (min === max) ? `${min}` : `${min}-${max}`;

      // Try to resolve a friendly monster name. Use the same priority order
      // as _parseMonsterFromResult so previews match what would actually roll.
      // If nothing resolves, this row is a flavor entry — show the raw text.
      const body = _resultBody(r);
      let name = r.name || body || "(empty)";
      let flavor = true;
      try {
        // v13 canonical: TableResult.uuid is the linked document reference.
        // Resolve it; if it's an Actor, this is a monster row.
        if (r.uuid) {
          const doc = await fromUuid(r.uuid).catch(() => null);
          if (doc instanceof Actor) {
            name = doc.name;
            flavor = false;
          }
        }
        // Fallback: scan body for embedded @UUID[…] references.
        if (flavor) {
          const uuidMatch = body.match(/@UUID\[([^\]]+)\]/);
          if (uuidMatch) {
            const doc = await fromUuid(uuidMatch[1]);
            if (doc?.name) {
              name = doc.name;
              flavor = false;
            }
          }
        }
      } catch (_) {
        // Resolution failures fall back to body text — non-fatal.
      }

      // Appearing formula: flag wins, then inline [[/r N]], else blank.
      // Flavor entries never get an appearing formula.
      const flagAppearing = flavor ? null : r.getFlag(MODULE_ID, "appearing");
      const inlineMatch = flavor ? null : body.match(/\[\[\/r\s+([^\]]+)\]\]/);
      const appearing = flagAppearing ? String(flagAppearing)
                      : inlineMatch ? inlineMatch[1]
                      : "";

      rows.push({ id: r.id, range, name, appearing, flavor });
    }

    return {
      name: table.name,
      formula: table.formula || "",
      rows,
    };
  }

  // ─── Event Handlers ───

  _onRender(context, options) {
    super._onRender(context, options);

    // Tab switching
    const tabs = this.element.querySelectorAll(".sde-tabs .item:not(.disabled)");
    tabs.forEach(tab => {
      tab.addEventListener("click", ev => {
        this._activeTab = ev.currentTarget.dataset.tab;
        this.render();
      });
    });

    // Table selection change
    const select = this.element.querySelector("select[name='selectedTable']");
    if (select) {
      select.addEventListener("change", ev => {
        this._selectedTableId = ev.currentTarget.value;
        this.render();
      });
    }

    // Browse tab: search input, level min/max
    const searchInput = this.element.querySelector("input[name='browseSearch']");
    if (searchInput) {
      // If the user was typing in this input before the last render,
      // restore their cursor position. ApplicationV2 rebuilds the DOM
      // on render, so a fresh input replaces the old one and resets
      // the cursor to the end of the value — visible as a jumpy
      // experience on every keystroke past the first.
      if (this._browseSearchFocused) {
        searchInput.focus();
        const pos = this._browseSearchCursor ?? searchInput.value.length;
        try { searchInput.setSelectionRange(pos, pos); } catch (_) {}
      }

      // Debounce so we don't render on every keystroke.
      let timeout = null;
      searchInput.addEventListener("input", ev => {
        // Stash focus + cursor BEFORE the next render so we can restore.
        this._browseSearchFocused = true;
        this._browseSearchCursor  = ev.target.selectionStart;

        clearTimeout(timeout);
        timeout = setTimeout(() => {
          this._browseSearch = ev.target.value;
          this.render();
        }, 200);
      });
      // Clear the restore flag if the user moves focus away.
      searchInput.addEventListener("blur", () => {
        this._browseSearchFocused = false;
      });
    }
    const minInput = this.element.querySelector("input[name='browseLevelMin']");
    if (minInput) {
      minInput.addEventListener("change", ev => {
        const v = ev.target.value;
        this._browseLevelMin = v === "" ? null : Number(v);
        this.render();
      });
    }
    const maxInput = this.element.querySelector("input[name='browseLevelMax']");
    if (maxInput) {
      maxInput.addEventListener("change", ev => {
        const v = ev.target.value;
        this._browseLevelMax = v === "" ? null : Number(v);
        this.render();
      });
    }

    // Abilities search — text-search NPC Feature names (e.g. "petrify").
    // Cursor preservation pattern matches the main search input.
    const abilityInput = this.element.querySelector("input[name='browseAbilitySearch']");
    if (abilityInput) {
      if (this._browseAbilityFocused) {
        abilityInput.focus();
        const pos = this._browseAbilityCursor ?? abilityInput.value.length;
        try { abilityInput.setSelectionRange(pos, pos); } catch (_) {}
      }
      let abilityTimeout = null;
      abilityInput.addEventListener("input", ev => {
        this._browseAbilityFocused = true;
        this._browseAbilityCursor  = ev.target.selectionStart;
        clearTimeout(abilityTimeout);
        abilityTimeout = setTimeout(() => {
          this._browseAbilitySearch = ev.target.value;
          this.render();
        }, 200);
      });
      abilityInput.addEventListener("blur", () => {
        this._browseAbilityFocused = false;
      });
    }

    // Drag-to-canvas (and to anything else that accepts Foundry's Actor
    // drag payload — sidebar, other modules, future Build Table tab).
    this.element.querySelectorAll(".sde-browse-row[draggable='true']").forEach(row => {
      row.addEventListener("dragstart", ev => {
        const uuid = row.dataset.uuid;
        if (!uuid) return;
        ev.dataTransfer.setData("text/plain", JSON.stringify({
          type: "Actor",
          uuid,
        }));
        ev.dataTransfer.effectAllowed = "copy";
      });
    });

    // ═══ Build Table tab wiring ═══════════════════════════════════════

    // Die-type select: changes die AND resets slots to that die's
    // natural per-face defaults. (User can edit ranges afterward.)
    const dieSelect = this.element.querySelector("select[name='buildDie']");
    if (dieSelect) {
      dieSelect.addEventListener("change", ev => {
        this._buildDieKey = ev.target.value;
        this._buildSlots  = EncounterBuild.defaultSlots(this._buildDieKey);
        this.render();
      });
    }

    // Table-name input with cursor preservation (same pattern as
    // browse search — avoids the cursor jumping to the end on render).
    const nameInput = this.element.querySelector("input[name='buildTableName']");
    if (nameInput) {
      if (this._buildNameFocused) {
        nameInput.focus();
        const pos = this._buildNameCursor ?? nameInput.value.length;
        try { nameInput.setSelectionRange(pos, pos); } catch (_) {}
      }
      let nameTimeout = null;
      nameInput.addEventListener("input", ev => {
        this._buildNameFocused = true;
        this._buildNameCursor  = ev.target.selectionStart;
        clearTimeout(nameTimeout);
        nameTimeout = setTimeout(() => {
          this._buildTableName = ev.target.value;
          this.render();
        }, 200);
      });
      nameInput.addEventListener("blur", () => {
        this._buildNameFocused = false;
      });
    }

    // Per-slot min / max range inputs — change-event only, so the GM
    // can type freely without triggering re-renders mid-input.
    this.element.querySelectorAll(".sde-build-slot input[data-slot-field='min'], .sde-build-slot input[data-slot-field='max']").forEach(input => {
      input.addEventListener("change", ev => {
        const idx = Number(ev.target.closest("[data-slot-idx]")?.dataset.slotIdx);
        const field = ev.target.dataset.slotField;
        const val = Number(ev.target.value);
        if (Number.isFinite(idx) && this._buildSlots[idx] && Number.isFinite(val)) {
          this._buildSlots[idx][field] = val;
          this.render();
        }
      });
    });

    // Appearing-formula input per slot — change-event, so typing
    // "1d4+1" doesn't trigger a render until the user commits.
    this.element.querySelectorAll(".sde-build-slot input[data-slot-field='appearing']").forEach(input => {
      input.addEventListener("change", ev => {
        const idx = Number(ev.target.closest("[data-slot-idx]")?.dataset.slotIdx);
        if (Number.isFinite(idx) && this._buildSlots[idx]) {
          this._buildSlots[idx].appearing = ev.target.value.trim();
          this.render();
        }
      });
    });

    // Free-text entry on empty slots — Enter commits as flavor entry,
    // Esc cancels. Click on the placeholder swaps to the input.
    this.element.querySelectorAll(".sde-build-slot-text").forEach(input => {
      input.addEventListener("keydown", ev => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          const idx = Number(ev.target.closest("[data-slot-idx]")?.dataset.slotIdx);
          const text = ev.target.value.trim();
          if (Number.isFinite(idx) && this._buildSlots[idx] && text) {
            EncounterBuild.fillSlotFromText(this._buildSlots[idx], text);
            this.render();
          }
        } else if (ev.key === "Escape") {
          ev.target.value = "";
          ev.target.blur();
        }
      });
    });

    // Drag-and-drop: each slot is an Actor drop target. Accepts the
    // standard Foundry drag payload (same one emitted by the Browse
    // tab rows and Foundry's sidebar).
    this.element.querySelectorAll(".sde-build-slot[data-slot-idx]").forEach(slot => {
      slot.addEventListener("dragover", ev => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        slot.classList.add("sde-build-slot-dragover");
      });
      slot.addEventListener("dragleave", () => {
        slot.classList.remove("sde-build-slot-dragover");
      });
      slot.addEventListener("drop", async ev => {
        ev.preventDefault();
        slot.classList.remove("sde-build-slot-dragover");
        const idx = Number(slot.dataset.slotIdx);
        if (!Number.isFinite(idx) || !this._buildSlots[idx]) return;
        let data;
        try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (_) { return; }
        if (data?.type !== "Actor" || !data?.uuid) return;
        const actor = await fromUuid(data.uuid);
        if (!actor || actor.type !== "NPC") {
          ui.notifications.warn("Only NPC actors can be dropped into encounter slots.");
          return;
        }
        EncounterBuild.fillSlotFromActor(this._buildSlots[idx], actor);
        this.render();
      });
    });
  }

  async _onSetAsActive(event, target) {
    if (!this._selectedTableId) return;
    const table = game.tables.get(this._selectedTableId);
    if (!table) return;

    await game.settings.set(MODULE_ID, "encounterTableUuid", table.uuid);
    ui.notifications.info(`Active encounter table set to: ${table.name}`);
    this.render();
  }

  async _onRollTable(event, target) {
    await this.rollActiveTable(this._selectedTableId);
  }

  async rollActiveTable(tableId = null) {
    // Resolve the active-table setting (stores UUID) → table ID for
    // `game.tables.get`. fromUuidSync is the canonical sync lookup for
    // world documents in v13+; the previous `game.tables.getByUUID`
    // isn't a standard Foundry Collection method and was relying on
    // undefined behavior.
    const id = tableId || fromUuidSync(game.settings.get(MODULE_ID, "encounterTableUuid") ?? "")?.id;
    if (!id) {
      ui.notifications.warn("No active table selected.");
      return;
    }

    const table = game.tables.get(id);
    if (!table) return;

    const draw = await table.draw({ displayChat: false });
    const result = draw.results[0];

    if (!result) {
      this._lastResult = { kind: "empty" };
      this.render();
      return;
    }

    await this._buildResultFrom(result);
  }

  /**
   * Build `_lastResult` from a specific TableResult and re-render. Used
   * by both the random-roll path (rollActiveTable) and the manual-pick
   * path (preview row Post / Place buttons). Three result shapes:
   *   - monster:  resolved an Actor → full encounter card with facets
   *   - flavor:   no monster but result has text → flavor-only card
   *   - empty:    no monster, no text → error state
   *
   * @param {TableResult} result
   * @private
   */
  async _buildResultFrom(result) {
    const monster = await this._parseMonsterFromResult(result);
    if (monster) {
      this._lastResult = {
        kind: "monster",
        uuid: monster.uuid,
        name: monster.name,
        img: monster.img || "icons/svg/mystery-man.svg",
        count: await this._rollCount(result),
        distanceRoll: await this._roll("1d6"),
        activityRoll: await this._roll("2d6"),
        reactionRoll: await this._roll("2d6"),
        chaMod: 0
      };
      this._updateResultStrings();
    } else {
      const body = _resultBody(result).trim();
      if (body) {
        this._lastResult = { kind: "flavor", text: body };
      } else {
        this._lastResult = { kind: "empty" };
      }
    }
    this.render();
  }

  /**
   * Resolve the TableResult associated with a preview-row button click.
   * The row carries `data-result-id`; we look it up on the currently
   * selected table.
   *
   * @param {HTMLElement} target  the clicked action button
   * @returns {TableResult | null}
   * @private
   */
  _getPreviewResult(target) {
    const id = target.closest("[data-result-id]")?.dataset.resultId;
    if (!id || !this._selectedTableId) return null;
    const table = game.tables.get(this._selectedTableId);
    return table?.results?.get(id) ?? null;
  }

  async _onPreviewPost(event, target) {
    const result = this._getPreviewResult(target);
    if (!result) return;
    await this._buildResultFrom(result);
    await this._onPostToChat();
  }

  async _onPreviewPlace(event, target) {
    const result = this._getPreviewResult(target);
    if (!result) return;
    await this._buildResultFrom(result);
    // Flavor entries can't be placed (no monster).
    if (this._lastResult.kind !== "monster") {
      ui.notifications.warn("This entry has no monster to place.");
      return;
    }
    await this._onPlaceTokens();
  }

  async _parseMonsterFromResult(result) {
    // v13 canonical: TableResult.uuid is the linked document reference.
    // If it resolves to an NPC Actor, this is a monster row.
    if (result.uuid) {
      const doc = await fromUuid(result.uuid).catch(() => null);
      if (doc instanceof Actor && doc.type === "NPC") return doc;
    }

    // Fallback: scan body text for embedded @UUID[…] references.
    const body = _resultBody(result);
    const uuidMatch = body.match(/@UUID\[([^\]]+)\]/);
    if (uuidMatch) {
      const doc = await fromUuid(uuidMatch[1]).catch(() => null);
      if (doc instanceof Actor) return doc;
    }

    return null;
  }

  async _rollCount(result) {
    // Priority 1: SDE flag (set by Build Table save)
    const flagCount = result.getFlag(MODULE_ID, "appearing");
    if (flagCount) return (await new Roll(flagCount.toString()).evaluate()).total;

    // Priority 2: Inline formula [[/r N]] anywhere in the body text.
    const formulaMatch = _resultBody(result).match(/\[\[\/r\s+([^\]]+)\]\]/);
    if (formulaMatch) return (await new Roll(formulaMatch[1]).evaluate()).total;

    // Default
    return 1;
  }

  async _roll(formula) {
    const r = await new Roll(formula).evaluate();
    return r.total;
  }

  _updateResultStrings() {
    if (!this._lastResult) return;
    const res = this._lastResult;
    res.distanceText = DISTANCE[res.distanceRoll];
    res.activityText = ACTIVITY[res.activityRoll];
    res.reactionBand = reactionBand(res.reactionRoll + res.chaMod);
  }

  async _onReroll(event, target) {
    const facet = target.dataset.facet;
    if (facet === "distance") this._lastResult.distanceRoll = await this._roll("1d6");
    if (facet === "activity") this._lastResult.activityRoll = await this._roll("2d6");
    if (facet === "reaction") this._lastResult.reactionRoll = await this._roll("2d6");
    this._updateResultStrings();
    this.render();
  }

  _onChaDec() {
    if (!this._lastResult) return;
    if (this._lastResult.chaMod <= CHA_MOD_MIN) return;
    this._lastResult.chaMod--;
    this._updateResultStrings();
    this.render();
  }

  _onChaInc() {
    if (!this._lastResult) return;
    if (this._lastResult.chaMod >= CHA_MOD_MAX) return;
    this._lastResult.chaMod++;
    this._updateResultStrings();
    this.render();
  }

  async _onPostToChat() {
    if (!this._lastResult || this._lastResult.kind === "empty") return;

    // Pick the chat template based on result shape. Flavor entries get
    // a simple text card; monster encounters get the full facet recap.
    const template = this._lastResult.kind === "flavor"
      ? "modules/shadowdark-enhancer/templates/chat/encounter-flavor.hbs"
      : "modules/shadowdark-enhancer/templates/chat/encounter-result.hbs";

    const content = await renderTemplate(template, this._lastResult);
    const gmOnly = game.settings.get(MODULE_ID, "encounterRollGMOnly");

    await ChatMessage.create({
      user: game.user.id,
      content,
      whisper: gmOnly ? ChatMessage.getWhisperRecipients("GM") : [],
    });
  }

  /**
   * Place N tokens of the rolled monster on the active scene,
   * one per click. The GM clicks anywhere on the canvas to drop a
   * token at that position; this repeats until all N are placed or
   * the GM presses Escape to cancel the remainder.
   *
   * Why DOM events instead of canvas.stage PIXI events: Foundry v13
   * ships PIXI v7+ which changed the federated-event API. The old
   * `event.data.getLocalPosition()` pattern is gone, and the new
   * `event.getLocalPosition()` interacts with layered Canvas children
   * unreliably (TokenLayer can capture clicks first). DOM-level
   * pointerdown with capture:true gets us first dibs and uses
   * Foundry's already-tracked `canvas.mousePosition` for world coords.
   *
   * Compendium actors are imported as world actors first (or an
   * existing same-named world actor is reused) so the placed tokens
   * have a valid `actorId` reference.
   *
   * Token texture fallback: some compendium NPCs have
   * `prototypeToken.texture.src` set to the default mystery-man while
   * `actor.img` holds the actual illustration. Detect that case and
   * use `actor.img` instead so placed tokens display the right art.
   */
  async _onPlaceTokens() {
    if (!this._lastResult) return;
    if (!canvas.ready || !canvas.scene) {
      ui.notifications.warn("No active scene.");
      return;
    }

    let actor = await fromUuid(this._lastResult.uuid);
    if (!actor) {
      ui.notifications.error("Monster actor not found.");
      return;
    }

    // Compendium → world. Foundry doesn't track tokens against
    // compendium actors directly; we need a world actor for the
    // token's actorId. Reuse one by name+type if it already exists.
    if (actor.pack) {
      const existing = game.actors.find(a =>
        a.type === "NPC" && a.name === actor.name
      );
      actor = existing ?? await Actor.implementation.create(actor.toObject());
    }

    // Build the template token source, with image fallback.
    const tokenSource = (await actor.getTokenDocument()).toObject();
    const protoSrc = tokenSource.texture?.src;
    const isDefaultArt = !protoSrc
      || protoSrc === "icons/svg/mystery-man.svg"
      || protoSrc === CONST.DEFAULT_TOKEN;
    if (isDefaultArt && actor.img && actor.img !== "icons/svg/mystery-man.svg") {
      tokenSource.texture = { ...(tokenSource.texture ?? {}), src: actor.img };
    }

    // Cancellable click-to-place loop. Each click drops one token at
    // the cursor's snapped grid position. Window closes so the canvas
    // is fully visible; ESC cancels remaining placements.
    const total = this._lastResult.count;
    let remaining = total;

    const canvasEl = canvas.app.view;
    let active = true;

    const updateNotif = () => {
      ui.notifications.info(
        `Click canvas to place token ${total - remaining + 1} of ${total} — ${actor.name} (Esc to cancel).`
      );
    };

    const cleanup = () => {
      if (!active) return;
      active = false;
      canvasEl.removeEventListener("pointerdown", onClick, true);
      document.removeEventListener("keydown", onKey);
      if (this._placeAbort === ctrl) this._placeAbort = null;
    };

    const onClick = async (ev) => {
      if (!active || ev.button !== 0) return;
      // Capture-phase + stopPropagation prevents Foundry's TokenLayer
      // from acting on this click (no drag-select, no deselect).
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      // Use Foundry's continuously-tracked mouse position (world coords).
      const pos = canvas.mousePosition;
      const snap = canvas.grid.getSnappedPoint(
        { x: pos.x, y: pos.y },
        { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX }
      );

      const td = { ...tokenSource, x: snap.x, y: snap.y, actorId: actor.id };
      delete td._id; // Foundry assigns a fresh ID per token
      await canvas.scene.createEmbeddedDocuments("Token", [td]);

      remaining--;
      if (remaining > 0) {
        updateNotif();
      } else {
        cleanup();
        ui.notifications.info(`Placed all ${total} × ${actor.name}.`);
      }
    };

    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      cleanup();
      const placed = total - remaining;
      ui.notifications.info(
        placed > 0
          ? `Cancelled — placed ${placed} of ${total} × ${actor.name}.`
          : `Cancelled — no tokens placed.`
      );
    };

    // Track this as the in-flight placement so close() can cancel it.
    const ctrl = { abort: cleanup };
    this._placeAbort = ctrl;

    this.close();
    updateNotif();
    // Capture-phase = true so we run before the canvas layers do.
    canvasEl.addEventListener("pointerdown", onClick, true);
    document.addEventListener("keydown", onKey);
  }

  /** Aborts any in-flight click-to-place loop (called from close()). */
  _cancelPlaceTokens() {
    if (this._placeAbort?.abort) {
      this._placeAbort.abort();
      this._placeAbort = null;
    }
  }

  async _onBrowseToggleSource(event, target) {
    const id = target.dataset.sourceId;
    if (!id) return;
    const set = new Set(this._browseSources);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this._browseSources = [...set];
    EncounterBrowse.invalidateCache();    // selected sources changed
    await game.settings.set(MODULE_ID, "encounterSources", this._browseSources);
    this.render();
  }

  _onBrowseSort(event, target) {
    const col = target.dataset.column;
    if (!col) return;
    if (col === this._browseSortCol) {
      this._browseSortAsc = !this._browseSortAsc;
    } else {
      this._browseSortCol = col;
      this._browseSortAsc = true;
    }
    this.render();
  }

  _onBrowseToggleAlign(event, target) {
    const a = target.dataset.alignment;
    if (!a) return;
    const set = new Set(this._browseAlignment);
    if (set.has(a)) set.delete(a);
    else set.add(a);
    this._browseAlignment = [...set];
    this.render();
  }

  _onBrowseToggleMove(event, target) {
    const m = target.dataset.move;
    if (!m) return;
    const set = new Set(this._browseMoves);
    if (set.has(m)) set.delete(m);
    else set.add(m);
    this._browseMoves = [...set];
    this.render();
  }

  _onBrowseToggleDark() {
    this._browseDarkAdapted = !this._browseDarkAdapted;
    this.render();
  }

  _onBrowseToggleSpellcaster() {
    this._browseHasSpellcasting = !this._browseHasSpellcasting;
    this.render();
  }

  /**
   * "+ Build" button on a Browse row. Adds the NPC to the next empty
   * slot in the Build Table tab and switches to that tab so the GM
   * sees the addition immediately.
   */
  async _onBrowseAddToBuild(event, target) {
    const row = target.closest("[data-uuid]");
    const uuid = row?.dataset.uuid;
    if (!uuid) return;
    const actor = await fromUuid(uuid).catch(() => null);
    if (!actor) {
      ui.notifications.error("Couldn't resolve NPC.");
      return;
    }
    // Find first empty slot (no name set).
    const idx = this._buildSlots.findIndex(s => !s.name);
    if (idx === -1) {
      ui.notifications.warn("No empty Build Table slots — click + Slot to add one.");
      return;
    }
    EncounterBuild.fillSlotFromActor(this._buildSlots[idx], actor);
    this._activeTab = "build";
    this.render();
  }

  // ═══ Build Table tab handlers — Slice 1c ════════════════════════════

  _onBuildAddSlot() {
    const nextFace = EncounterBuild.nextFreeFace(this._buildSlots, this._buildDieKey);
    const die = EncounterBuild.getDie(this._buildDieKey);
    // If every face is already covered, extend the last slot instead
    // of erroring — appends a new slot at the die's max.
    const face = nextFace ?? die.max;
    this._buildSlots.push(EncounterBuild.emptySlot(face, face));
    this.render();
  }

  _onBuildRemoveSlot(event, target) {
    const idx = Number(target.closest("[data-slot-idx]")?.dataset.slotIdx);
    if (!Number.isFinite(idx)) return;
    this._buildSlots.splice(idx, 1);
    this.render();
  }

  _onBuildClearSlot(event, target) {
    const idx = Number(target.closest("[data-slot-idx]")?.dataset.slotIdx);
    if (!Number.isFinite(idx) || !this._buildSlots[idx]) return;
    EncounterBuild.clearSlot(this._buildSlots[idx]);
    this.render();
  }

  async _onBuildPostSlot(event, target) {
    const slot = this._slotFromEvent(target);
    if (!slot) return;
    await this._buildResultFromSlot(slot);
    await this._onPostToChat();
  }

  async _onBuildPlaceSlot(event, target) {
    const slot = this._slotFromEvent(target);
    if (!slot) return;
    await this._buildResultFromSlot(slot);
    if (this._lastResult.kind !== "monster") {
      ui.notifications.warn("This slot has no monster to place.");
      return;
    }
    await this._onPlaceTokens();
  }

  async _onBuildSave() {
    if (!this._buildSlots.some(s => s.name)) {
      ui.notifications.warn("Add at least one entry before saving.");
      return;
    }
    const errors = EncounterBuild.validateSlots(this._buildSlots, this._buildDieKey)
      .filter(v => v.severity === "error");
    if (errors.length) {
      ui.notifications.error(`Cannot save — ${errors[0].message}`);
      return;
    }
    try {
      const table = await EncounterBuild.saveAsRollTable({
        name:    this._buildTableName,
        dieKey:  this._buildDieKey,
        slots:   this._buildSlots,
      });
      ui.notifications.info(`Created Roll Table: ${table.name}`);
      // Per design: don't auto-set as active. Hop to the Roll Tables
      // tab and select the new table so the GM can preview it.
      this._selectedTableId = table.id;
      this._activeTab       = "tables";
      this.render();
    } catch (err) {
      console.error(MODULE_ID, "Build save failed:", err);
      ui.notifications.error(`Failed to save Roll Table: ${err.message}`);
    }
  }

  _slotFromEvent(target) {
    const idx = Number(target.closest("[data-slot-idx]")?.dataset.slotIdx);
    if (!Number.isFinite(idx)) return null;
    return this._buildSlots[idx] ?? null;
  }

  /**
   * Build _lastResult from a Build-tab slot, mirroring how
   * _buildResultFrom handles a TableResult. Lets Post / Place reuse the
   * existing card-rendering and token-placement flows without saving
   * the table first.
   */
  async _buildResultFromSlot(slot) {
    if (slot.uuid) {
      const actor = await fromUuid(slot.uuid).catch(() => null);
      if (actor) {
        const count = slot.appearing
          ? (await new Roll(slot.appearing).evaluate()).total
          : 1;
        this._lastResult = {
          kind: "monster",
          uuid: slot.uuid,
          name: actor.name,
          img:  actor.img || "icons/svg/mystery-man.svg",
          count,
          distanceRoll: await this._roll("1d6"),
          activityRoll: await this._roll("2d6"),
          reactionRoll: await this._roll("2d6"),
          chaMod: 0,
        };
        this._updateResultStrings();
        this.render();
        return;
      }
    }
    if (slot.flavor && slot.name) {
      this._lastResult = { kind: "flavor", text: slot.name };
      this.render();
      return;
    }
    this._lastResult = { kind: "empty" };
    this.render();
  }
}

// ───── Helpers ─────────────────────────────────────────────────────

/**
 * Extract the body text of a TableResult across Foundry v12 → v13.
 *
 * Foundry v13 deprecated `TableResult.text` and split it into:
 *   - `name`        — human-readable title (typically auto-set from a
 *                     referenced document, or the user-entered title
 *                     for text-only results)
 *   - `description` — longer body text (rich text, may contain inline
 *                     rolls and document references)
 *
 * We read body text in `description → name → text` order so:
 *   - v13 tables with proper description fields work first
 *   - v13 text-only entries that put everything in `name` still resolve
 *   - v12 tables still using `text` keep working (until v15 removes it)
 *
 * @param {TableResult} r
 * @returns {string}
 */
function _resultBody(r) {
  // Read each field directly; `??` skips empty strings (use `||` to
  // fall through "" → next field). The `text` access still triggers
  // the deprecation warning on v13 but only if the first two are
  // empty, which is the case for old tables we haven't migrated.
  return r?.description || r?.name || r?.text || "";
}
