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
      width: 720,
      height: "auto",
    },
    actions: {
      setAsActive: EncounterRollerApp.prototype._onSetAsActive,
      rollTable: EncounterRollerApp.prototype._onRollTable,
      reroll: EncounterRollerApp.prototype._onReroll,
      chaDec: EncounterRollerApp.prototype._onChaDec,
      chaInc: EncounterRollerApp.prototype._onChaInc,
      postToChat: EncounterRollerApp.prototype._onPostToChat,
      placeTokens: EncounterRollerApp.prototype._onPlaceTokens,
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
    this._selectedTableId = game.settings.get(MODULE_ID, "encounterTableUuid");
    this._lastResult = null;
    // Track the in-flight Place-Tokens listener so we can cancel it on
    // close / escape / app reopen — prevents stale handlers from firing
    // a stray token-drop after the GM moved on.
    this._placeAbort = null;
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

    return {
      activeTab: this._activeTab,
      selectedTableId: this._selectedTableId,
      tableGroups,
      lastResult: this._lastResult,
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
    const id = tableId || game.tables.getByUUID(game.settings.get(MODULE_ID, "encounterTableUuid"))?.id;
    if (!id) {
      ui.notifications.warn("No active table selected.");
      return;
    }

    const table = game.tables.get(id);
    if (!table) return;

    const draw = await table.draw({ displayChat: false });
    const result = draw.results[0];

    if (!result) {
      this._lastResult = { empty: true };
      this.render();
      return;
    }

    // Parse monster from result
    const monster = await this._parseMonsterFromResult(result);
    if (!monster) {
      this._lastResult = { empty: true };
    } else {
      this._lastResult = {
        empty: false,
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
    }
    this.render();
  }

  async _parseMonsterFromResult(result) {
    // Priority: result.documentCollection + result.documentId
    if (result.documentCollection === "Actor" || result.type === CONST.TABLE_RESULT_TYPES.DOCUMENT) {
      const actor = game.actors.get(result.documentId) || await fromUuid(result.uuid);
      if (actor && actor.type === "NPC") return actor;
    }

    // Try to find UUID in description
    const uuidMatch = result.text.match(/@UUID\[([^\]]+)\]/);
    if (uuidMatch) {
      const doc = await fromUuid(uuidMatch[1]);
      if (doc instanceof Actor) return doc;
    }

    return null;
  }

  async _rollCount(result) {
    // Priority 1: SDE flag (later slice)
    const flagCount = result.getFlag(MODULE_ID, "appearing");
    if (flagCount) return (await new Roll(flagCount.toString()).evaluate()).total;

    // Priority 2: Inline formula [[/r N]]
    const formulaMatch = result.text.match(/\[\[\/r\s+([^\]]+)\]\]/);
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
    if (!this._lastResult) return;

    const content = await renderTemplate(
      "modules/shadowdark-enhancer/templates/chat/encounter-result.hbs",
      this._lastResult,
    );
    const gmOnly = game.settings.get(MODULE_ID, "encounterRollGMOnly");

    await ChatMessage.create({
      user: game.user.id,
      content,
      whisper: gmOnly ? ChatMessage.getWhisperRecipients("GM") : [],
    });
  }

  async _onPlaceTokens() {
    if (!this._lastResult) return;
    if (!canvas.ready) {
      ui.notifications.warn("No active scene.");
      return;
    }

    const actor = await fromUuid(this._lastResult.uuid);
    if (!actor) {
      ui.notifications.error("Monster actor not found.");
      return;
    }

    const count = this._lastResult.count;
    ui.notifications.info(`Click on the canvas to place ${count} token${count === 1 ? "" : "s"} (Esc to cancel).`);
    this.close();

    // Cancellable click + escape listener. The AbortController gives us
    // one switch to tear down both listeners — clicking the canvas, or
    // pressing escape, both abort the operation.
    const ctrl = new AbortController();
    this._placeAbort = ctrl;

    const onClick = async (ev) => {
      // Compute the cursor's grid-snapped position, then offset each
      // token by one grid cell so we don't stack them all on top of
      // each other. Layout is a row, wrapping after every 5 tokens.
      const local = ev.data.getLocalPosition(canvas.app.stage);
      const snap = canvas.grid.getSnappedPoint({ x: local.x, y: local.y }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX });
      const gridSize = canvas.grid.size;

      const tokenSource = (await actor.getTokenDocument()).toObject();
      const tokensToCreate = [];
      for (let i = 0; i < count; i++) {
        const col = i % 5;
        const row = Math.floor(i / 5);
        tokensToCreate.push({
          ...tokenSource,
          x: snap.x + col * gridSize,
          y: snap.y + row * gridSize,
        });
      }
      await canvas.scene.createEmbeddedDocuments("Token", tokensToCreate);
      ctrl.abort();
    };

    const onKey = (ev) => {
      if (ev.key === "Escape") {
        ui.notifications.info("Token placement cancelled.");
        ctrl.abort();
      }
    };

    canvas.stage.once("mousedown", onClick);
    document.addEventListener("keydown", onKey);

    ctrl.signal.addEventListener("abort", () => {
      // Remove the mousedown listener if we aborted before it fired.
      canvas.stage.off("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      if (this._placeAbort === ctrl) this._placeAbort = null;
    });
  }

  // Aborts any in-flight Place-Tokens listener.
  _cancelPlaceTokens() {
    if (this._placeAbort) {
      this._placeAbort.abort();
      this._placeAbort = null;
    }
  }
}
