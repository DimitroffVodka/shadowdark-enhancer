/**
 * Shadowdark Enhancer — Loot Setup window.
 *
 * One browsable Loot & Treasure Library (Core + Cursed Scroll). Each row is a
 * treasure table you can:
 *   • UNLOCK from your own source PDF through the Importer Hub (files into
 *     sde-tables, then shows as present), and
 *   • BIND to its level tier — the four Core bands feed the Loot Generator's
 *     automatic, level-scaled drops.
 * Plus a "Bind another table" picker for binding any loot table you own — a
 * homebrew table, a compendium table, or one from a book we don't catalog.
 *
 * Ships zero book content — only table names + page cites (see
 * loot-table-catalog.mjs). All imports flow through the Importer unlock system.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { ImporterHubApp } from "../importer/importer-hub-app.mjs";
import {
  LOOT_TIER_ENTRIES,
  LOOT_LIBRARY,
  LOOT_PICKER_SETTING,
  boundCount,
  getPickerExtras,
  gatherLootTables,
  gatherLootLibraryCensus,
  gatherAddableTables,
  gatherPickerManaged,
  unlockSeedFor,
} from "./loot-table-catalog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootSetupApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-loot-setup",
    tag: "form",
    window: { title: "Loot Setup — Treasure Tables", icon: "fas fa-gear", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      bindLibrary:   LootSetupApp.prototype._onBindLibrary,
      bindCustom:    LootSetupApp.prototype._onBindCustom,
      unlockLibrary: LootSetupApp.prototype._onUnlockLibrary,
      addPicker:     LootSetupApp.prototype._onAddPicker,
      removePicker:  LootSetupApp.prototype._onRemovePicker,
    },
  };

  static PARTS = { body: { template: "modules/shadowdark-enhancer/templates/loot-setup.hbs" } };

  static _instance = null;
  static open() {
    if (!this._instance) this._instance = new LootSetupApp();
    if (!this._instance.rendered) this._instance.render(true);
    else { this._instance.bringToFront(); this._instance.render(); }
    return this._instance;
  }

  /** Hook id for the `contentUnlocked` subscription (see _onFirstRender). */
  _contentHookId = null;

  /**
   * Cache of the "Add to Loot Generator" candidate list. gatherAddableTables
   * sweeps EVERY RollTable compendium index, so we must not re-run it on every
   * render (the auto-refresh hook, add/remove, and every bind all re-render).
   * Invalidated by _invalidateAddable() after any change that alters it.
   */
  _addableCache = null;
  async _getAddable() {
    if (!this._addableCache) this._addableCache = await gatherAddableTables();
    return this._addableCache;
  }
  _invalidateAddable() { this._addableCache = null; }

  /**
   * Subscribe once to `contentUnlocked` so the library refreshes the moment a
   * table is unlocked through the Importer Hub — otherwise a just-imported
   * treasure table stays "missing" until this window is closed and reopened.
   * Kept out of _onRender so a hook-driven re-render can't re-subscribe;
   * unsubscribed in close().
   */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._contentHookId = Hooks.on(`${MODULE_ID}.contentUnlocked`, () => {
      this._invalidateAddable();   // a new import may have added a table
      if (this.rendered) this.render();
    });
  }

  async close(options = {}) {
    LootSetupApp._instance = null;
    if (this._contentHookId) { Hooks.off(`${MODULE_ID}.contentUnlocked`, this._contentHookId); this._contentHookId = null; }
    return super.close(options);
  }

  async _prepareContext() {
    const map = game.settings.get(MODULE_ID, "lootTierTables") ?? {};

    // Curated loot tables (world + sde-tables + system pack) for the custom
    // "bind another table" picker — never every table in the world.
    const lootTables = await gatherLootTables();

    // Live census of the loot/treasure library. Drop empty source groups
    // (e.g. Western Reaches, which ships no dedicated treasure table).
    const census = await gatherLootLibraryCensus();
    const library = census
      .filter((g) => g.entries.length > 0)
      .map((g) => ({
        label: g.label,
        entries: g.entries.map((e) => {
          const boundUuid = e.tier ? (map[e.tier] || null) : null;
          return {
            name: e.name,
            displayName: e.displayName,
            src: e.src,
            page: e.page,
            tier: e.tier,
            isTier: !!e.tier,
            present: e.present,
            uuid: e.uuid,
            // A tier row is "bound" only when THIS table is what's bound to it.
            boundHere: !!(e.tier && e.present && boundUuid && boundUuid === e.uuid),
          };
        }),
      }));

    // Tier options for the custom picker — label carries the current binding so
    // the four tiers' state is visible without a second list of tables.
    const tierOptions = LOOT_TIER_ENTRIES.map((e) => ({
      tier: e.tier,
      label: e.label.replace(/^Treasure — /, ""),
      boundName: map[e.tier] ? (fromUuidSync(map[e.tier])?.name ?? "(missing table)") : null,
    }));

    // "Add to Loot Generator" section: what's currently in the picker (with a
    // Remove), and every other table you could add (world + all compendia).
    const managed = await gatherPickerManaged();
    const addable = await this._getAddable();

    return {
      library,
      lootTables,
      tierOptions,
      hasLootTables: lootTables.length > 0,
      done: boundCount(map),
      total: LOOT_TIER_ENTRIES.length,
      managed,
      addable,
      hasAddable: addable.length > 0,
    };
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Bind a Core tier row's present table to its level tier. */
  async _onBindLibrary(event, target) {
    if (!game.user.isGM) return;
    const { tier, uuid } = target.dataset;
    if (!tier || !uuid) return;
    await this._bind(tier, uuid);
    ui.notifications.info(`Treasure ${tier}: bound.`);
    this.render();
  }

  /** Bind any curated loot table (custom picker) to a chosen tier. */
  async _onBindCustom(event, target) {
    if (!game.user.isGM) return;
    const tier = this.element.querySelector("select[data-custom-tier]")?.value;
    const uuid = this.element.querySelector("select[data-custom-table]")?.value;
    if (!tier) { ui.notifications.warn("Pick a tier first."); return; }
    if (!uuid) { ui.notifications.warn("Pick a loot table first."); return; }
    await this._bind(tier, uuid);
    ui.notifications.info(`Treasure ${tier}: bound to the selected table.`);
    this.render();
  }

  /** Open the Importer Hub seeded to unlock a library entry (Core/CS). */
  _onUnlockLibrary(event, target) {
    const { name, src } = target.dataset;
    const entry = LOOT_LIBRARY.flatMap((g) => g.entries).find((e) => e.name === name && e.src === src);
    if (!entry) return;
    ImporterHubApp.openContentUnlock(unlockSeedFor(entry));
    ui.notifications.info(`Opening the Importer to unlock “${entry.displayName ?? entry.name}”.`);
  }

  /**
   * Add the picker-dropdown's table to the Loot Generator. World tables get the
   * isLootTable flag (matching the sidebar "Mark as Loot Table"); compendium
   * tables — which can't be flagged in place — are stored in the lootPickerTables
   * setting. Both surface in the picker via gatherLootTables.
   */
  async _onAddPicker(event, target) {
    if (!game.user.isGM) return;
    const uuid = this.element.querySelector("select[data-picker-add]")?.value;
    if (!uuid) { ui.notifications.warn("Pick a table to add first."); return; }
    if (uuid.startsWith("Compendium.")) {
      const extras = [...getPickerExtras()];
      if (!extras.includes(uuid)) { extras.push(uuid); await game.settings.set(MODULE_ID, LOOT_PICKER_SETTING, extras); }
    } else {
      const doc = await fromUuid(uuid).catch(() => null);
      await doc?.setFlag(MODULE_ID, "isLootTable", true);
    }
    ui.notifications.info("Added to the Loot Generator.");
    this._invalidateAddable();
    this._refreshGenerator();
    this.render();
  }

  /** Remove a table from the Loot Generator (unset flag and/or drop from list). */
  async _onRemovePicker(event, target) {
    if (!game.user.isGM) return;
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    const extras = getPickerExtras();
    const trimmed = extras.filter((u) => u !== uuid);
    if (trimmed.length !== extras.length) await game.settings.set(MODULE_ID, LOOT_PICKER_SETTING, trimmed);
    if (!uuid.startsWith("Compendium.")) {
      const doc = await fromUuid(uuid).catch(() => null);
      if (doc?.getFlag(MODULE_ID, "isLootTable") === true) await doc.unsetFlag(MODULE_ID, "isLootTable");
    }
    ui.notifications.info("Removed from the Loot Generator.");
    this._invalidateAddable();
    this._refreshGenerator();
    this.render();
  }

  /** Re-render the Loot Generator window if it's open so its picker updates. */
  _refreshGenerator() {
    try { foundry.applications.instances?.get?.("sde-loot-generator")?.render?.(); } catch (_) { /* not open */ }
  }

  /** Write one tier->table binding into the lootTierTables world setting. */
  async _bind(tier, uuid) {
    const map = { ...(game.settings.get(MODULE_ID, "lootTierTables") ?? {}) };
    map[tier] = uuid;
    await game.settings.set(MODULE_ID, "lootTierTables", map);
  }
}
