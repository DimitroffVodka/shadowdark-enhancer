/**
 * Shadowdark Enhancer — Magic Item Forge window (working-items rebuild).
 *
 * A focused builder for items that actually function in the Shadowdark system:
 *   Weapon / Armor — forge a +N onto a real base item (carries its damage die /
 *                    AC / properties). +N rides the current SD effect keys.
 *   Scroll / Wand  — pick a real Spell; the item references it so the system's
 *                    own casting pipeline runs (DC = tier + 10, scroll expend,
 *                    wand fail/break).
 *
 * All item-shape correctness lives in the pure `assembleItemData` (magic-forge.mjs);
 * this file owns only the ApplicationV2 shell, selectors, live preview, and the
 * create flow. Public API (`open({seed, onCreate})`) and the forged-flag contract
 * are preserved for the loot generator / loot delivery integrations.
 */
import { assembleItemData, composeName, WORKING_TYPES, TYPE_LABELS } from "./magic-forge.mjs";
import { MODULE_ID } from "../module-id.mjs";
import { esc } from "../util/esc.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TYPE_ICON = { weapon: "fa-gavel", armor: "fa-shield-halved", scroll: "fa-scroll", wand: "fa-wand-sparkles" };

export class MagicForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-magic-forge",
    tag: "form",
    window: { title: "Magic Item Forge", icon: "fas fa-hammer", resizable: true },
    position: { width: 720, height: "auto" },
    actions: {
      setType:     MagicForgeApp.prototype._onSetType,
      setBonus:    MagicForgeApp.prototype._onSetBonus,
      pickBase:    MagicForgeApp.prototype._onPickBase,
      clearBase:   MagicForgeApp.prototype._onClearBase,
      toggleSpell: MagicForgeApp.prototype._onToggleSpell,
      createItem:  MagicForgeApp.prototype._onCreateItem,
    },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/magic-forge.hbs" },
  };

  // ─── Singleton ───

  static _instance = null;

  static open({ seed = null, onCreate = null } = {}) {
    if (!this._instance) this._instance = new MagicForgeApp();
    const inst = this._instance;
    inst._onCreate = onCreate;
    if (seed) inst._applySeed(seed);
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }

  constructor(options = {}) {
    super(options);
    this._type = "weapon";
    this._bonus = 1;
    this._name = "";          // manual name override ("" = derive)
    this._baseUuid = null;
    this._baseData = null;    // toObject() of the chosen base Weapon/Armor
    this._spellUuids = [];    // selected spell uuids (scroll: [0]; wand: all)
    this._identified = true;
    this._onCreate = null;
    // search queries (DOM-filtered, no re-render)
    this._baseQuery = "";
    this._spellQuery = "";
    // caches
    this._baseLists = null;   // { weapon: [...], armor: [...] }
    this._spellList = null;   // [{ uuid, name, tier, img }]
    this._spellByUuid = new Map();
  }

  /** Preset type + bonus from an inferred seed ({type, bonus}). */
  _applySeed(seed) {
    if (WORKING_TYPES.includes(seed.type)) this._type = seed.type;
    else if (seed.type === "potion" || seed.type === "utility") this._type = "wand"; // nearest working type
    if (typeof seed.bonus === "number") this._bonus = Math.max(0, Math.min(3, seed.bonus));
    // reset per-forge selections so a fresh seed starts clean
    this._name = ""; this._baseUuid = null; this._baseData = null; this._spellUuids = [];
  }

  async close(options = {}) {
    MagicForgeApp._instance = null;
    return super.close(options);
  }

  // ─── Data ───

  async _ensureCaches() {
    if (!this._baseLists) {
      const map = async (coll) => [...coll.contents]
        .map(i => ({ uuid: i.uuid, name: i.name, img: i.img }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this._baseLists = {
        weapon: await map(await shadowdark.compendiums.baseWeapons()),
        armor:  await map(await shadowdark.compendiums.baseArmor()),
      };
    }
    if (!this._spellList) {
      const spells = [...(await shadowdark.compendiums.spells()).contents];
      this._spellList = spells
        .map(s => ({ uuid: s.uuid, name: s.name, tier: s.system?.tier ?? 1, img: s.img }))
        .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
      this._spellByUuid = new Map(this._spellList.map(s => [s.uuid, s]));
    }
  }

  async _prepareContext() {
    await this._ensureCaches();
    const isGear = this._type === "weapon" || this._type === "armor";
    const isSpellItem = this._type === "scroll" || this._type === "wand";

    const types = WORKING_TYPES.map(id => ({
      id, label: TYPE_LABELS[id], icon: TYPE_ICON[id], active: id === this._type,
    }));

    const baseList = isGear ? (this._baseLists[this._type] ?? []) : [];
    const bases = baseList.map(b => ({ ...b, nameLower: b.name.toLowerCase(), selected: b.uuid === this._baseUuid }));

    const spells = isSpellItem
      ? this._spellList.map(s => ({ ...s, nameLower: s.name.toLowerCase(), dc: s.tier + 10, selected: this._spellUuids.includes(s.uuid) }))
      : [];

    return {
      types,
      isGear, isSpellItem,
      isWand: this._type === "wand",
      typeLabel: TYPE_LABELS[this._type],
      bonus: this._bonus,
      bonusOptions: [0, 1, 2, 3].map(n => ({ n, active: n === this._bonus })),
      name: this._name,
      identified: this._identified,
      baseSelected: this._baseData ? { name: this._baseData.name, img: this._baseData.img } : null,
      bases,
      spells,
      preview: this._preview(),
      canForge: this._canForge(),
    };
  }

  /** Derive the item name shown in the preview / used on create. */
  _deriveName() {
    if (this._name.trim()) return this._name.trim();
    if (this._type === "scroll" || this._type === "wand") {
      const first = this._spellByUuid.get(this._spellUuids[0]);
      const word = this._type === "scroll" ? "Scroll" : "Wand";
      return first ? `${word} of ${first.name}` : word;
    }
    return composeName({ type: this._type, baseItem: this._baseData?.name ?? "", bonus: this._bonus });
  }

  _canForge() {
    if (this._type === "weapon" || this._type === "armor") return !!this._baseData;
    if (this._type === "scroll") return this._spellUuids.length === 1;
    if (this._type === "wand") return this._spellUuids.length >= 1;
    return false;
  }

  /** Build the live-preview view-model. */
  _preview() {
    const name = this._deriveName();
    const lines = [];
    if (this._type === "weapon" || this._type === "armor") {
      lines.push(this._baseData ? `Base: ${this._baseData.name}` : "Pick a base item");
      if (this._bonus > 0) lines.push(`Magic bonus: +${this._bonus}`);
    } else {
      const spells = this._spellUuids.map(u => this._spellByUuid.get(u)).filter(Boolean);
      if (!spells.length) lines.push("Pick a spell");
      for (const s of spells) lines.push(`${s.name} — cast DC ${s.tier + 10} (tier ${s.tier})`);
    }
    return { name, typeLabel: TYPE_LABELS[this._type], icon: TYPE_ICON[this._type], lines };
  }

  // ─── Render / wiring ───

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;

    // Name override — commit without re-render (preserve focus); patch preview.
    const nameInput = el.querySelector("input[name='name']");
    nameInput?.addEventListener("input", () => { this._name = nameInput.value; this._patchPreview(); }, { signal });

    // Identified toggle.
    const ident = el.querySelector("input[name='identified']");
    ident?.addEventListener("change", () => { this._identified = ident.checked; }, { signal });

    // Base-item search — DOM filter, focus-preserving.
    const baseSearch = el.querySelector(".sde-forge-base-search");
    baseSearch?.addEventListener("input", () => {
      this._baseQuery = baseSearch.value.toLowerCase();
      this._filterList(el, ".sde-forge-base-row", this._baseQuery);
    }, { signal });

    // Spell search — DOM filter.
    const spellSearch = el.querySelector(".sde-forge-spell-search");
    spellSearch?.addEventListener("input", () => {
      this._spellQuery = spellSearch.value.toLowerCase();
      this._filterList(el, ".sde-forge-spell-row", this._spellQuery);
    }, { signal });

    // Re-apply standing queries after a render.
    if (this._baseQuery) this._filterList(el, ".sde-forge-base-row", this._baseQuery);
    if (this._spellQuery) this._filterList(el, ".sde-forge-spell-row", this._spellQuery);
  }

  /** Toggle row visibility by a substring of its data-name. No re-render. */
  _filterList(el, rowSel, query) {
    for (const row of el.querySelectorAll(rowSel)) {
      const name = row.dataset.name ?? "";
      row.toggleAttribute("hidden", !!query && !name.includes(query));
    }
  }

  /** Patch just the preview name node without a full render. */
  _patchPreview() {
    const node = this.element?.querySelector(".sde-forge-preview-name");
    if (node) node.textContent = this._deriveName();
  }

  // ─── Actions ───

  _onSetType(event, target) {
    const t = target.dataset.type;
    if (!WORKING_TYPES.includes(t) || t === this._type) return;
    this._type = t;
    // selections are type-specific — reset on switch
    this._baseUuid = null; this._baseData = null; this._spellUuids = [];
    this._baseQuery = ""; this._spellQuery = "";
    this.render();
  }

  _onSetBonus(event, target) {
    this._bonus = Math.max(0, Math.min(3, Number(target.dataset.bonus) || 0));
    this.render();
  }

  async _onPickBase(event, target) {
    const uuid = target.dataset.uuid;
    const item = await fromUuid(uuid);
    if (!item) { ui.notifications.warn("Could not load that base item."); return; }
    this._baseUuid = uuid;
    this._baseData = item.toObject();
    this.render();
  }

  _onClearBase() {
    this._baseUuid = null; this._baseData = null;
    this.render();
  }

  _onToggleSpell(event, target) {
    const uuid = target.dataset.uuid;
    if (this._type === "scroll") {
      this._spellUuids = this._spellUuids[0] === uuid ? [] : [uuid];
    } else { // wand — multi
      const i = this._spellUuids.indexOf(uuid);
      if (i >= 0) this._spellUuids.splice(i, 1);
      else this._spellUuids.push(uuid);
    }
    this.render();
  }

  async _onCreateItem() {
    if (!game.user.isGM) { ui.notifications.warn("GM only."); return; }
    if (!this._canForge()) {
      const need = (this._type === "weapon" || this._type === "armor")
        ? "Pick a base item first." : "Pick a spell first.";
      ui.notifications.warn(need);
      return;
    }

    const isGear = this._type === "weapon" || this._type === "armor";
    const draft = {
      type: this._type,
      name: this._deriveName(),
      baseItem: this._baseData?.name ?? "",
      baseItemData: isGear ? this._baseData : null,
      bonus: this._bonus,
      spellUuids: this._spellUuids,
      identified: this._identified,
    };
    const data = assembleItemData(draft);
    if (!data.img && this._baseData?.img) data.img = this._baseData.img;

    const folder = await this._ensureForgedFolder();
    data.folder = folder.id;

    const item = await Item.create(data);
    if (!item) { ui.notifications.error("Forge failed — see console."); return; }

    await this._onCreate?.(item);
    this._onCreate = null;
    await this._postChatCard(item);
    ui.notifications.info(`Forged "${item.name}".`);
  }

  // ─── Helpers ───

  async _postChatCard(item) {
    const sub = this._previewSubtitle(item);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content: `<div class="shadowdark-enhancer sde-forge-card" style="display:flex;align-items:center;gap:8px;">
        <img src="${esc(item.img)}" alt="" width="36" height="36" style="border:none;flex:0 0 auto;">
        <div><strong>Forged:</strong> ${esc(item.name)}<br><span style="opacity:0.8;">${esc(sub)}</span></div>
      </div>`,
    });
  }

  _previewSubtitle(item) {
    if (this._type === "weapon" || this._type === "armor")
      return this._bonus > 0 ? `Magic ${TYPE_LABELS[this._type]} +${this._bonus}` : `Magic ${TYPE_LABELS[this._type]}`;
    const spells = this._spellUuids.map(u => this._spellByUuid.get(u)).filter(Boolean);
    return spells.map(s => `${s.name} (DC ${s.tier + 10})`).join(", ");
  }

  async _ensureForgedFolder() {
    return (
      game.folders.find(f => f.type === "Item" && f.name === "Forged Items" && !f.folder)
      ?? await Folder.create({ name: "Forged Items", type: "Item" })
    );
  }
}
