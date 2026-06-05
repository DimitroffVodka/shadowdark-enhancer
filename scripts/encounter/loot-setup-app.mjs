/**
 * Shadowdark Enhancer — Loot Setup window.
 * Guided onboarding: paste your own Shadowdark treasure tables into 4 labeled
 * slots (or bind tables already in the world); each is auto-bound to
 * lootTierTables so the Loot Generator produces real, level-scaled items.
 * Ships zero book content (see loot-setup-manifest.mjs).
 */
import { MODULE_ID } from "../module-id.mjs";
import { LOOT_SETUP_SLOTS, slotStatus, boundCount } from "./loot-setup-manifest.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootSetupApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-loot-setup",
    tag: "form",
    window: { title: "Loot Setup — Treasure Tables", icon: "fas fa-gear", resizable: true },
    position: { width: 640, height: "auto" },
    actions: {
      importSlot:  LootSetupApp.prototype._onImportSlot,
      useExisting: LootSetupApp.prototype._onUseExisting,
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
  async close(options = {}) { LootSetupApp._instance = null; return super.close(options); }

  async _prepareContext() {
    const map = game.settings.get(MODULE_ID, "lootTierTables") ?? {};
    const allTables = game.tables.contents
      .map(t => ({ uuid: t.uuid, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const slots = slotStatus(map).map(s => ({
      ...s,
      boundName: s.boundUuid ? (fromUuidSync(s.boundUuid)?.name ?? "(missing table)") : null,
      tables: allTables.map(t => ({ ...t, selected: t.uuid === s.boundUuid })),
    }));
    const done = boundCount(map);
    return { slots, done, total: LOOT_SETUP_SLOTS.length, hasTables: allTables.length > 0 };
  }

  // Action handlers added in Task 3.
  async _onImportSlot() {}
  async _onUseExisting() {}
}
