/**
 * Shadowdark Enhancer — Loot Generator window (M2.1 / G4).
 * GM tool: map each treasure band to a RollTable + roll a hoard onto a card.
 */
import { MODULE_ID } from "../module-id.mjs";
import { TREASURE_TABLES } from "./treasure-data.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-loot-generator",
    tag: "form",
    window: { title: "Loot Generator", icon: "fas fa-coins", resizable: true },
    position: { width: 520, height: "auto" },
    actions: { generate: LootGeneratorApp.prototype._onGenerate },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/loot-generator.hbs" },
  };

  // ─── Singleton ───

  static _instance = null;

  static open() {
    if (!this._instance) {
      this._instance = new LootGeneratorApp();
    }
    if (!this._instance.rendered) {
      this._instance.render(true);
    } else {
      this._instance.bringToFront();
      this._instance.render();
    }
    return this._instance;
  }

  async close(options = {}) {
    LootGeneratorApp._instance = null;
    return super.close(options);
  }

  // ─── Data Preparation ───

  async _prepareContext() {
    const map = game.settings.get(MODULE_ID, "lootTierTables") ?? {};
    const all = game.tables.contents
      .map(t => ({ uuid: t.uuid, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      bands: TREASURE_TABLES.map(t => {
        const sel = map[t.id] ?? "";
        const maxLabel = (t.max === Infinity || t.max == null) ? "+" : `–${t.max}`;
        return {
          id: t.id,
          label: `Treasure ${t.id} (levels ${t.min}${maxLabel})`,
          noneSelected: !sel,
          tables: all.map(x => ({ ...x, isSelected: x.uuid === sel })),
        };
      }),
    };
  }

  // ─── Render ───

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelectorAll("select[data-tier]").forEach(sel => {
      sel.addEventListener("change", async () => {
        const map = { ...(game.settings.get(MODULE_ID, "lootTierTables") ?? {}) };
        if (sel.value) map[sel.dataset.tier] = sel.value;
        else delete map[sel.dataset.tier];
        await game.settings.set(MODULE_ID, "lootTierTables", map);
      });
    });
  }

  // ─── Actions ───

  async _onGenerate() {
    const level = Number(this.element.querySelector('[name="level"]')?.value) || 1;
    const rolls  = Math.max(1, Number(this.element.querySelector('[name="rolls"]')?.value) || 1);
    await game.shadowdarkEnhancer.loot.generateHoard(level, rolls);
  }
}
