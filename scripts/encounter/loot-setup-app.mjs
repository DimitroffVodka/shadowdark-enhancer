/**
 * Shadowdark Enhancer — Loot Setup window.
 * Guided onboarding: paste your own Shadowdark treasure tables into 4 labeled
 * slots (or bind tables already in the world); each is auto-bound to
 * lootTierTables so the Loot Generator produces real, level-scaled items.
 * Ships zero book content (see loot-setup-manifest.mjs).
 */
import { MODULE_ID } from "../module-id.mjs";
import { LOOT_SETUP_SLOTS, slotStatus, boundCount } from "./loot-setup-manifest.mjs";
import { TableImporter } from "./table-importer.mjs";
import { LootCatalog } from "./loot-catalog.mjs";
import { findSuitePack } from "./compendium-suite.mjs";

// The Shadowdark system ships exactly one treasure table in its compendium.
const SYSTEM_PACK = "shadowdark.rollable-tables";
const SYSTEM_TREASURE_TIER = "0-3";

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
      useSystem:   LootSetupApp.prototype._onUseSystem,
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

    // Build the full table list from world tables + sde-tables pack (D-08 / REQ-30).
    // The loot generator already resolves via fromUuid(uuid).draw(), which is
    // pack-capable — so we only need to make pack tables selectable here.
    const allTables = game.tables.contents
      .map(t => ({ uuid: t.uuid, name: t.name }));

    const tablesPack = findSuitePack("sde-tables");
    if (tablesPack) {
      try {
        const packIndex = await tablesPack.getIndex();
        for (const entry of packIndex) {
          const packUuid = `Compendium.${tablesPack.collection}.RollTable.${entry._id}`;
          allTables.push({ uuid: packUuid, name: `[Pack] ${entry.name}` });
        }
      } catch (_) {
        // Pack not yet indexed — silently skip; pack tables appear on next render.
      }
    }

    allTables.sort((a, b) => a.name.localeCompare(b.name));

    const slots = slotStatus(map).map(s => ({
      ...s,
      boundName: s.boundUuid ? (fromUuidSync(s.boundUuid)?.name ?? "(missing table)") : null,
      tables: allTables.map(t => ({ ...t, selected: t.uuid === s.boundUuid })),
      // Only the 0-3 tier can be filled from the Shadowdark system compendium
      // (it ships just the one treasure table).
      canUseSystem: s.tier === SYSTEM_TREASURE_TIER,
    }));
    const done = boundCount(map);
    return { slots, done, total: LOOT_SETUP_SLOTS.length, hasTables: allTables.length > 0 };
  }

  async _onImportSlot(event, target) {
    if (!game.user.isGM) return;
    const slot = LOOT_SETUP_SLOTS.find(s => s.id === target.dataset.slotId);
    if (!slot) return;
    const ta = this.element.querySelector(`textarea[data-slot-id="${slot.id}"]`);
    const text = (ta?.value ?? "").trim();
    if (!text) { ui.notifications.warn("Paste the table text first."); return; }
    const parsed = TableImporter.parse(text);
    const pt = parsed?.[0];
    if (!pt || !(pt.rows?.length)) { ui.notifications.warn("Couldn't parse any rows — check the paste against the format hint."); return; }
    pt.name = slot.label;        // canonical, recognizable name
    pt.category = "loot";        // files under Imported Tables/Loot + tags tableType:"loot"
    const table = await TableImporter.createTable(pt, { onConflict: () => "rename" });
    if (!table) return;
    await this._bind(slot.tier, table.uuid);
    ui.notifications.info(`${slot.label}: imported ${pt.rows.length} rows and bound.`);
    this.render();
  }

  async _onUseExisting(event, target) {
    if (!game.user.isGM) return;
    const slot = LOOT_SETUP_SLOTS.find(s => s.id === target.dataset.slotId);
    if (!slot) return;
    const sel = this.element.querySelector(`select[data-slot-id="${slot.id}"]`);
    const uuid = sel?.value;
    if (!uuid) { ui.notifications.warn("Pick a table from the dropdown first."); return; }
    await this._bind(slot.tier, uuid);
    ui.notifications.info(`${slot.label}: bound to existing table.`);
    this.render();
  }

  /**
   * Import the Shadowdark system's built-in Treasure 0-3 into the world,
   * enhance it (link items / keep coins; existing document links preserved),
   * and bind it to the 0-3 loot tier. Re-uses a prior import instead of
   * duplicating. GM-only.
   */
  async _onUseSystem(event, target) {
    if (!game.user.isGM) return;
    const slot = LOOT_SETUP_SLOTS.find(s => s.id === target.dataset.slotId);
    if (!slot) return;
    const pack = game.packs.get(SYSTEM_PACK);
    if (!pack) { ui.notifications.warn(`Compendium "${SYSTEM_PACK}" not found.`); return; }
    const idx = await pack.getIndex();
    const entry = idx.find(e => /^\s*treasure\s*0\s*-\s*3\s*$/i.test(e.name))
      ?? idx.find(e => /treasure\s*0\s*-\s*3/i.test(e.name));
    if (!entry) { ui.notifications.warn("Couldn't find a 'Treasure 0-3' table in the Shadowdark compendium."); return; }

    const name = "Treasure 0-3 (Shadowdark)";
    let table = game.tables.find(t => t.name === name);
    if (!table) {
      const src = await pack.getDocument(entry._id);
      const data = src.toObject();
      delete data._id;
      data.name = name;
      data.folder = (await this._ensureLootFolder())?.id ?? null;
      data.flags = {
        ...(data.flags ?? {}),
        [MODULE_ID]: { ...((data.flags ?? {})[MODULE_ID] ?? {}), tableType: "loot", isLootTable: true },
      };
      table = await RollTable.create(data);
    }
    await LootCatalog.linkTableItems(table);
    await this._bind(slot.tier, table.uuid);
    ui.notifications.info(`${slot.label}: imported Shadowdark's Treasure 0-3 (${table.results.size} rows) and bound.`);
    this.render();
  }

  /** Find-or-create the Imported Tables/Loot folder for RollTables. */
  async _ensureLootFolder() {
    const root = game.folders.find(f => f.type === "RollTable" && f.name === "Imported Tables" && !f.folder)
      ?? await Folder.create({ name: "Imported Tables", type: "RollTable" });
    return game.folders.find(f => f.type === "RollTable" && f.name === "Loot" && f.folder?.id === root.id)
      ?? await Folder.create({ name: "Loot", type: "RollTable", folder: root.id });
  }

  /** Write one tier->table binding into the lootTierTables world setting. */
  async _bind(tier, uuid) {
    const map = { ...(game.settings.get(MODULE_ID, "lootTierTables") ?? {}) };
    map[tier] = uuid;
    await game.settings.set(MODULE_ID, "lootTierTables", map);
  }
}
