/**
 * Shadowdark Enhancer — Magic Item Forge window (Task 2).
 *
 * Roll-then-refine UI for assembling magic items from the GM's loaded tables.
 * Uses MagicForge (Task 1) for all dice/table logic; this file owns only the
 * ApplicationV2 shell, DOM wiring, and the _applyBonus mechanic.
 *
 * SD +N Mechanism — LIVE-VERIFIED (v14.361 / shadowdark 4.0.4):
 *   Weapon: Two ActiveEffects on the Item itself (transfer: false, type: "base"):
 *     - key: "system.bonuses.attackBonus",  type: "add", value: N
 *     - key: "system.bonuses.damageBonus",  type: "add", value: N
 *   Armor:  Direct system field — system.ac.modifier += N (no AE needed).
 *   Source: Examined real world magic weapon items "Asterion" and "Bloodlust"
 *   via MCP evaluate; both use this exact AE shape. Armor system.ac.modifier
 *   confirmed as the dedicated bonus slot (base = base AC, modifier = magic bonus).
 */
import { MagicForge, TYPE_IDS, TYPE_LABELS, assembleItemData } from "./magic-forge.mjs";
import { MODULE_ID } from "../module-id.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MagicForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-magic-forge",
    tag: "form",
    window: { title: "Magic Item Forge", icon: "fas fa-hammer", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      forgeRoll:     MagicForgeApp.prototype._onForgeRoll,
      reroll:        MagicForgeApp.prototype._onReroll,
      addBenefit:    MagicForgeApp.prototype._onAddBenefit,
      removeBenefit: MagicForgeApp.prototype._onRemoveBenefit,
      createItem:    MagicForgeApp.prototype._onCreateItem,
    },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/magic-forge.hbs" },
  };

  // ─── Singleton ───

  static _instance = null;

  static open() {
    if (!this._instance) this._instance = new MagicForgeApp();
    if (!this._instance.rendered) this._instance.render(true);
    else { this._instance.bringToFront(); this._instance.render(); }
    return this._instance;
  }

  constructor(options = {}) {
    super(options);
    this._draft = null;
  }

  async close(options = {}) {
    MagicForgeApp._instance = null;
    return super.close(options);
  }

  // ─── Data ───

  async _prepareContext() {
    return {
      types: TYPE_IDS.map(id => ({ id, label: TYPE_LABELS[id], selected: id === this._draft?.type })),
      draft: this._draft,
      hasDraft: !!this._draft,
      hasBonus: this._draft ? ["weapon", "armor"].includes(this._draft.type) : false,
      benefits: (this._draft?.benefits ?? []).map((b, idx) => ({ idx, text: b })),
    };
  }

  // ─── Render ───

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;

    // Type selector — rerolls draft for the new type
    const typeSel = el.querySelector("select[name='type']");
    if (typeSel) {
      typeSel.addEventListener("change", async () => {
        this._draft = await MagicForge.rollDraft({ type: typeSel.value });
        this.render();
      });
    }

    // Text inputs / number inputs — commit on change
    for (const input of el.querySelectorAll("input[name]")) {
      input.addEventListener("change", () => this._commitInput(input));
    }

    // Bonus input wiring (also covered above via input[name])
    // Curse checkbox
    const hasCurse = el.querySelector("input[name='hasCurse']");
    if (hasCurse && this._draft) {
      hasCurse.addEventListener("change", () => {
        if (hasCurse.checked) {
          if (!this._draft.curse) this._draft.curse = "";
        } else {
          this._draft.curse = null;
        }
        this.render();
      });
    }

    // Personality checkbox
    const hasPersonality = el.querySelector("input[name='hasPersonality']");
    if (hasPersonality && this._draft) {
      hasPersonality.addEventListener("change", () => {
        this._draft.personality.present = hasPersonality.checked;
        this.render();
      });
    }
  }

  /** Commit a named input's value back to this._draft. */
  _commitInput(input) {
    if (!this._draft) return;
    const name = input.name;
    const val = input.value;
    if (name === "name") this._draft.name = val;
    else if (name === "baseItem") this._draft.baseItem = val;
    else if (name === "feature") this._draft.feature = val;
    else if (name === "bonus") this._draft.bonus = Math.max(0, Math.min(3, Number(val) || 0));
    else if (name === "curse") this._draft.curse = val;
    else if (name === "virtue") this._draft.personality.virtue = val;
    else if (name === "flaw") this._draft.personality.flaw = val;
    else if (name === "trait") this._draft.personality.trait = val;
    else if (name.startsWith("benefit-")) {
      const idx = Number(name.split("-")[1]);
      if (this._draft.benefits[idx] !== undefined) this._draft.benefits[idx] = val;
    }
  }

  // ─── Actions ───

  async _onForgeRoll() {
    this._draft = await MagicForge.rollDraft();
    this.render();
  }

  async _onReroll(event, target) {
    if (!this._draft) return;
    this._draft = await MagicForge.rerollPart(this._draft, target.dataset.part);
    this.render();
  }

  _onAddBenefit() {
    if (!this._draft) return;
    this._draft.benefits.push("");
    this.render();
  }

  _onRemoveBenefit(event, target) {
    if (!this._draft) return;
    this._draft.benefits.splice(Number(target.dataset.idx), 1);
    this.render();
  }

  async _onCreateItem() {
    if (!game.user.isGM) { ui.notifications.warn("GM only."); return; }
    if (!this._draft) { ui.notifications.warn("Forge an item first."); return; }
    const data = assembleItemData(this._draft);
    this._applyBonus(data, this._draft.type, this._draft.bonus ?? 0);
    const folder = await this._ensureForgedFolder();
    data.folder = folder.id;
    const item = await Item.create(data);
    ui.notifications.info(`Forged "${item.name}".`);
  }

  // ─── Helpers ───

  /**
   * Apply the +N bonus mechanic to itemData in-place.
   *
   * LIVE-VERIFIED SD 4.0.4 / v14.361:
   *   Weapon: add two AEs (attackBonus, damageBonus) with type "add".
   *           transfer: false — AE lives on the item, applies when equipped.
   *   Armor:  set system.ac.modifier directly (dedicated bonus slot).
   *
   * @param {object} itemData  - assembleItemData() result (mutated in place)
   * @param {string} type      - draft type ("weapon", "armor", ...)
   * @param {number} bonus     - 0–3
   */
  _applyBonus(itemData, type, bonus) {
    if (!bonus || bonus <= 0) return;

    if (type === "weapon") {
      if (!itemData.effects) itemData.effects = [];
      itemData.effects.push(
        {
          name: "Weapon Attack Roll Bonus",
          type: "base",
          transfer: false,
          disabled: false,
          changes: [{ key: "system.bonuses.attackBonus", type: "add", value: bonus, priority: 0 }],
          flags: { [MODULE_ID]: { forgeBonus: true } },
        },
        {
          name: "Weapon Attack Damage Bonus",
          type: "base",
          transfer: false,
          disabled: false,
          changes: [{ key: "system.bonuses.damageBonus", type: "add", value: bonus, priority: 0 }],
          flags: { [MODULE_ID]: { forgeBonus: true } },
        },
      );
      // Also set system.magicItem so the system UI treats it as magic
      itemData.system.magicItem = true;
    } else if (type === "armor") {
      // system.ac.modifier is the dedicated numeric bonus slot (live-verified)
      if (!itemData.system.ac) itemData.system.ac = { attribute: "", base: 0, modifier: 0 };
      itemData.system.ac.modifier = bonus;
      itemData.system.magicItem = true;
    }
  }

  async _ensureForgedFolder() {
    return (
      game.folders.find(f => f.type === "Item" && f.name === "Forged Items" && !f.folder)
      ?? await Folder.create({ name: "Forged Items", type: "Item" })
    );
  }
}
