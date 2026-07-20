/**
 * Shadowdark Enhancer — Loot Generator window (M2.1 / G4).
 * Vagabond-Crawler-style: pick a loot RollTable, "Roll Loot" (or "Roll for
 * Selected Token" → whisper a claimable card to its owner), and work a running
 * history where each result can be posted to chat or given to a player.
 */
import { MODULE_ID } from "../module-id.mjs";
import { LootSetupApp } from "./loot-setup-app.mjs";
import { boundCount, gatherLootTables } from "./loot-table-catalog.mjs";
import { LootGenerator } from "./loot-generator.mjs";
import { LootDelivery } from "./loot-delivery.mjs";
import { MagicForgeApp } from "./magic-forge-app.mjs";
import { inferSeedFromName } from "./magic-forge.mjs";
import { ItemDrops } from "./item-drops.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-loot-generator",
    tag: "form",
    window: { title: "Loot Generator", icon: "fas fa-coins", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      rollLoot:       LootGeneratorApp.prototype._onRollLoot,
      rollForToken:   LootGeneratorApp.prototype._onRollForToken,
      postEntry:      LootGeneratorApp.prototype._onPostEntry,
      giveEntry:      LootGeneratorApp.prototype._onGiveEntry,
      dropEntryCoins: LootGeneratorApp.prototype._onDropEntryCoins,
      dropCoinsPrompt: LootGeneratorApp.prototype._onDropCoinsPrompt,
      clearHistory:   LootGeneratorApp.prototype._onClearHistory,
      forgeEntryItem: LootGeneratorApp.prototype._onForgeEntryItem,
      openSetup: LootGeneratorApp.prototype._onOpenSetup,
    },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/loot-generator.hbs" },
  };

  // ─── Singleton (mirrors EncounterRollerApp) ───

  static _instance = null;

  static open() {
    if (!this._instance) this._instance = new LootGeneratorApp();
    if (!this._instance.rendered) this._instance.render(true);
    else { this._instance.bringToFront(); this._instance.render(); }
    return this._instance;
  }

  constructor(options = {}) {
    super(options);
    /** @type {{id:string,tableName:string,batch:object}[]} newest-first */
    this._history = [];
    this._selectedTableUuid = null;
  }

  async close(options = {}) {
    LootGeneratorApp._instance = null;
    return super.close(options);
  }

  // ─── Data Preparation ───

  /**
   * The picker options: curated loot/treasure tables across the world AND the
   * sde-tables / Shadowdark system compendia (loot-table-catalog classifier).
   * No longer falls back to listing every world table — the list is curated
   * end to end, so `noneMarked` is always false now.
   */
  async _lootTables() {
    const tables = await gatherLootTables();
    return { noneMarked: false, tables };
  }

  async _prepareContext() {
    const { tables, noneMarked } = await this._lootTables();
    // Reset the selection if it was filtered out (e.g. a now-unmarked table).
    if (this._selectedTableUuid && !tables.some(t => t.uuid === this._selectedTableUuid)) this._selectedTableUuid = null;
    if (!this._selectedTableUuid && tables.length) this._selectedTableUuid = tables[0].uuid;

    const party = game.actors
      .filter(a => a.type === "Player" && a.hasPlayerOwner)
      .map(a => ({ id: a.id, name: a.name }));

    const history = this._history.map(e => {
      const c = e.batch.coins ?? { gp: 0, sp: 0, cp: 0 };
      const coinsParts = ["gp", "sp", "cp"].filter(k => c[k] > 0).map(k => `${c[k]} ${k}`);
      const items = (e.batch.items ?? []).map((i, idx) => ({ name: i.name, img: i.img ?? "icons/svg/item-bag.svg", idx, forgeable: i.forgeable ?? false }));
      const notes = e.batch.notes ?? [];
      return {
        id: e.id,
        tableName: e.tableName,
        items,
        notes,
        hasCoins: coinsParts.length > 0,
        coinsLabel: coinsParts.join(", "),
        isEmpty: !items.length && coinsParts.length === 0 && !notes.length,
        party,
      };
    });

    return {
      tables: tables.map(t => ({ ...t, isSelected: t.uuid === this._selectedTableUuid })),
      hasTables: tables.length > 0,
      noneMarked,
      history,
      hasHistory: this._history.length > 0,
      needsSetup: boundCount(game.settings.get(MODULE_ID, "lootTierTables") ?? {}) < 4,
    };
  }

  // ─── Render ───

  _onRender(context, options) {
    super._onRender?.(context, options);
    const sel = this.element.querySelector("select[data-loot-table]");
    if (sel) sel.addEventListener("change", () => { this._selectedTableUuid = sel.value || null; });
  }

  // ─── Rolling ───

  /** Roll the selected table once → { table, batch }, or null with a warning. */
  async _roll() {
    const uuid = this._selectedTableUuid;
    if (!uuid) { ui.notifications.warn("Select a loot table first."); return null; }
    const table = await fromUuid(uuid).catch(() => null);
    const level = LootGenerator.levelForTier(LootGenerator.tierForTable(uuid));
    const batch = await LootGenerator.generate(level, { rolls: 1, tableUuid: uuid });
    if (batch.error) { ui.notifications.warn("That table couldn't be rolled."); return null; }
    return { table, batch };
  }

  async _onRollLoot() {
    const r = await this._roll();
    if (!r) return;
    this._history.unshift({ id: foundry.utils.randomID(), tableName: r.table?.name ?? "Loot", batch: r.batch });
    this.render();
  }

  async _onRollForToken() {
    const token = canvas.tokens?.controlled?.[0];
    if (!token?.actor) { ui.notifications.warn("Select a token first."); return; }
    const r = await this._roll();
    if (!r) return;
    r.batch.source = r.table?.name ?? "Loot";
    this._history.unshift({ id: foundry.utils.randomID(), tableName: r.batch.source, batch: r.batch });
    await LootDelivery.postCard(r.batch, { whisperToActor: token.actor });
    this.render();
  }

  // ─── Per-entry actions ───

  async _onPostEntry(event, target) {
    const entry = this._history.find(e => e.id === target.dataset.entryId);
    if (!entry) return;
    await LootDelivery.postCard({ ...entry.batch, source: entry.tableName });
  }

  async _onGiveEntry(event, target) {
    const entry = this._history.find(e => e.id === target.dataset.entryId);
    if (!entry) return;
    const sel = this.element.querySelector(`.sde-lootgen-recipient[data-entry-id="${entry.id}"]`);
    const actor = game.actors.get(sel?.value);
    if (!actor) { ui.notifications.warn("Pick a recipient first."); return; }
    await LootDelivery.depositToActor(actor, entry.batch);
    ui.notifications.info(`Gave ${entry.tableName} loot to ${actor.name}.`);
  }

  /** Prompt for an arbitrary coin amount and drop it on the canvas (GM). */
  async _onDropCoinsPrompt() {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Drop Coins on Canvas", icon: "fas fa-coins" },
      content: `<div style="padding:8px;display:flex;gap:12px;align-items:flex-end;">
        <label style="display:flex;flex-direction:column;gap:2px;">GP<input type="number" name="gp" value="0" min="0" step="1" style="width:5em;"></label>
        <label style="display:flex;flex-direction:column;gap:2px;">SP<input type="number" name="sp" value="0" min="0" step="1" style="width:5em;"></label>
        <label style="display:flex;flex-direction:column;gap:2px;">CP<input type="number" name="cp" value="0" min="0" step="1" style="width:5em;"></label>
      </div>
      <p class="notes" style="padding:0 8px;">Drops a pickup-able coin pile at your view centre (or on a selected token). Players grab it from the token's HUD.</p>`,
      buttons: [
        { action: "ok", label: "Drop", default: true, icon: "fas fa-coins", callback: (_e, _b, dlg) => {
          const q = (n) => Number(dlg.element.querySelector(`input[name="${n}"]`).value) || 0;
          return { gp: q("gp"), sp: q("sp"), cp: q("cp") };
        } },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!result || result === "cancel") return;
    const actor = await ItemDrops.dropCoins(result);
    if (actor) ui.notifications.info(`Dropped ${actor.name} on the canvas — players can pick it up from the token.`);
  }

  /** Drop this entry's coins onto the canvas as a pickup-able pile (GM). */
  async _onDropEntryCoins(event, target) {
    const entry = this._history.find(e => e.id === target.dataset.entryId);
    if (!entry) return;
    const coins = entry.batch.coins ?? { gp: 0, sp: 0, cp: 0 };
    if ((coins.gp || 0) + (coins.sp || 0) + (coins.cp || 0) <= 0) {
      ui.notifications.warn("This result has no coins to drop.");
      return;
    }
    const actor = await ItemDrops.dropCoins(coins, { source: entry.tableName });
    if (actor) ui.notifications.info(`Dropped ${entry.tableName} coins on the canvas — players can pick them up from the token.`);
  }

  _onClearHistory() {
    this._history = [];
    this.render();
  }

  _onOpenSetup() { LootSetupApp.open(); }

  async _onForgeEntryItem(event, target) {
    const entry = this._history.find(e => e.id === target.dataset.entryId);
    if (!entry) return;
    const it = entry.batch.items[Number(target.dataset.itemIndex)];
    if (!it) return;
    // Prefer the stable forgeType hint; legacy history entries fall back to the
    // name-only inference for the initial UI seed only.
    MagicForgeApp.open({
      seed: { ...inferSeedFromName(it.name), forgeType: it.forgeType ?? null },
      onCreate: (forged) => { it.uuid = forged.uuid; it.name = forged.name; it.img = forged.img ?? it.img; it.forgeable = false; this.render(); },
    });
  }
}
