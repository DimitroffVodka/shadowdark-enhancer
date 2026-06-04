/**
 * Shadowdark Enhancer — Loot Generator window (M2.1 / G4).
 * Vagabond-Crawler-style: pick a loot RollTable, "Roll Loot" (or "Roll for
 * Selected Token" → whisper a claimable card to its owner), and work a running
 * history where each result can be posted to chat or given to a player.
 */
import { LootGenerator } from "./loot-generator.mjs";
import { LootDelivery } from "./loot-delivery.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-loot-generator",
    tag: "form",
    window: { title: "Loot Generator", icon: "fas fa-coins", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      rollLoot:     LootGeneratorApp.prototype._onRollLoot,
      rollForToken: LootGeneratorApp.prototype._onRollForToken,
      postEntry:    LootGeneratorApp.prototype._onPostEntry,
      giveEntry:    LootGeneratorApp.prototype._onGiveEntry,
      clearHistory: LootGeneratorApp.prototype._onClearHistory,
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

  /** All world RollTables, name-sorted — the picker options. */
  _lootTables() {
    return game.tables.contents
      .map(t => ({ uuid: t.uuid, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _prepareContext() {
    const tables = this._lootTables();
    if (!this._selectedTableUuid && tables.length) this._selectedTableUuid = tables[0].uuid;

    const party = game.actors
      .filter(a => a.type === "Player" && a.hasPlayerOwner)
      .map(a => ({ id: a.id, name: a.name }));

    const history = this._history.map(e => {
      const c = e.batch.coins ?? { gp: 0, sp: 0, cp: 0 };
      const coinsParts = ["gp", "sp", "cp"].filter(k => c[k] > 0).map(k => `${c[k]} ${k}`);
      const items = (e.batch.items ?? []).map(i => ({ name: i.name, img: i.img ?? "icons/svg/item-bag.svg" }));
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
      history,
      hasHistory: this._history.length > 0,
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
    const batch = await LootGenerator.generate(0, { rolls: 1, tableUuid: uuid });
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

  _onClearHistory() {
    this._history = [];
    this.render();
  }
}
