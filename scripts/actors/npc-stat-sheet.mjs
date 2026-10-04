/**
 * Shadowdark Enhancer — the NPC stat block as an ApplicationV2 actor sheet.
 *
 * Mounts and Warbands ARE Shadowdark NPCs (register-actors.mjs gives each its
 * own sub-type over the system's `NpcSD` model), so both draw the same stat
 * block: HP/AC/level, movement, alignment, NPC Attacks, Specials and Features,
 * Spells, the description and the Effects tab. That block lives here once; the
 * Mount and the Warband sheets extend this class with their own tabs.
 *
 * The sheet has no ApplicationV1 ancestry. The attack/special lines come from
 * the system's own `npc-attack` partial, whose `data-action`s (`item-attack`,
 * `display-feature`, `cast-npc-spell`, ...) are mapped to V2 actions below, and
 * the model's own rolls (`rollHP`, `rollStatCheck`, `rollAttack`, `castSpell`)
 * do the work. The shared markup is in `templates/actors/npc-stat/`.
 */

import { injectActorHeaderButtons } from "./vehicle-sheet.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** The shared stat-block partials a sheet lists in its PARTS (`templates`) so they are loaded before the first render. */
export const NPC_STAT_PARTIALS = ["header", "top", "traits", "attacks", "spells", "notes", "effects"]
  .map((name) => `modules/${MODULE_ID}/templates/actors/npc-stat/${name}.hbs`);

/** The six ability labels are the system's own keys, written out literally (CONTRIBUTING § Localization). */
export const ABILITY_LABEL_KEYS = { str: "SHADOWDARK.ability_str", dex: "SHADOWDARK.ability_dex", con: "SHADOWDARK.ability_con", int: "SHADOWDARK.ability_int", wis: "SHADOWDARK.ability_wis", cha: "SHADOWDARK.ability_cha" };

/** Text of an HTML fragment (the system shows NPC feature and spell text as plain, then enriches it). */
const textOf = (html) => { const el = document.createElement("div"); el.innerHTML = html ?? ""; return el.textContent; };
/** {value, label, selected} rows for a <select> from a value→label-key table. */
export const choices = (table, current) => Object.entries(table ?? {}).map(([value, label]) => ({ value, label: game.i18n.localize(label), selected: value === current }));

export class NpcStatSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["shadowdark", "shadowdark-enhancer", "sde-vehicle-sheet", "sde-npc-sheet"],
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      changeTab: NpcStatSheet.prototype._onChangeTab,
      editImage: NpcStatSheet.prototype._onEditImage,
      rollAbility: NpcStatSheet.prototype._onRollAbility,
      rollHp: NpcStatSheet.prototype._onRollHp,
      itemCreate: NpcStatSheet.prototype._onItemCreate,
      effectControl: NpcStatSheet.prototype._onEffectControl,
      // The system's own attack, feature and spell markup carries these action names.
      "item-attack": NpcStatSheet.prototype._onRollAttack,
      "display-feature": NpcStatSheet.prototype._onDisplayFeature,
      "cast-npc-spell": NpcStatSheet.prototype._onCastSpell,
      "focus-npc-spell": NpcStatSheet.prototype._onCastSpell,
      "toggle-lost": NpcStatSheet.prototype._onToggleLost,
      "show-details": NpcStatSheet.prototype._onShowDetails,
    },
  };

  /** The tabs, `[id, label key]` in order; the first is open at first. A subclass lists its own. */
  static STAT_TABS = [];

  /** Active tab id; preserved across re-renders. */
  _activeTab = this.constructor.STAT_TABS[0]?.[0];

  /** Titled with just the actor's name, like the system's own actor sheets. */
  get title() { return this.actor.name; }

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const tabs = this.constructor.STAT_TABS;
    Object.assign(context, {
      actor, system: sys, owner: actor.isOwner, editable: this.isEditable,
      tabs: tabs.map(([id, label]) => ({ id, label: game.i18n.localize(label), active: id === this._activeTab })),
      tab: Object.fromEntries(tabs.map(([id]) => [id, id === this._activeTab])),
      moves: choices(CONFIG.SHADOWDARK.NPC_MOVES, sys.move),
      alignments: choices(CONFIG.SHADOWDARK.ALIGNMENTS, sys.alignment),
      castingAbilities: choices(CONFIG.SHADOWDARK.ABILITIES_LONG, sys.spellcasting?.ability),
    });
    await this._prepareItems(context);
    context.enrichedNotes = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      sys.notes ?? "", { secrets: actor.isOwner, relativeTo: actor });
    return context;
  }

  /** Attacks, specials, features, spells and effects, built the way the system's NPC sheet builds them. */
  async _prepareItems(context) {
    const actor = this.actor;
    const enrich = (html) => foundry.applications.ux.TextEditor.implementation.enrichHTML(textOf(html), { relativeTo: actor });
    const attacks = [], specials = [], features = [], spells = [];
    const effects = {
      effect: { label: game.i18n.localize("SHADOWDARK.item.effect.category.effect"), items: [] },
      condition: { label: game.i18n.localize("SHADOWDARK.item.effect.category.condition"), items: [] },
    };
    for (const i of Array.from(actor.items).sort((a, b) => a.name.localeCompare(b.name))) {
      if (i.type === "NPC Attack") attacks.push({ itemId: i.id, display: await actor.system.buildNpcAttackDisplays(i.id) });
      else if (i.type === "NPC Special Attack") specials.push({ itemId: i.id, display: await actor.system.buildNpcSpecialDisplays(i.id) });
      else if (i.type === "NPC Feature") features.push({ itemId: i.id, name: i.name, description: await enrich(i.system.description) });
      else if (i.type === "Spell") {
        spells.push({
          id: i.id, uuid: i.uuid, name: i.name, img: i.img, lost: !!i.system.lost, dc: i.system.dc,
          focus: i.system.duration?.type === "focus",
          duration: Handlebars.helpers.getSpellDuration(i.system.duration?.type, i.system.duration?.value),
          range: game.i18n.localize(CONFIG.SHADOWDARK.SPELL_RANGES[i.system.range] ?? ""),
          description: await enrich(i.system.description),
        });
      }
      else if (i.type === "Effect") effects[i.system.category]?.items.push({ id: i.id, uuid: i.uuid, name: i.name, img: i.img, unlimited: i.system.duration?.type === "unlimited" });
    }
    Object.assign(context, { attacks, specials, features, spells, effects: Object.values(effects) });
    // v14 effects carry no label of their own: a duration is finite or event-based when isTemporary, and the
    // prepared duration tells how long is left (Infinity for an event with no timer).
    context.activeEffects = actor.allApplicableEffects().filter((e) => !e.isSuppressed).map((e) => {
      const left = e.duration?.remaining;
      return {
        uuid: e.uuid, name: e.name, img: e.img, source: e.parent?.name, disabled: e.disabled, situational: !!e.isSituational,
        unlimited: !e.isTemporary,
        duration: e.isTemporary && Number.isFinite(left) ? `${Math.max(0, Math.ceil(left))} ${e.duration.units}` : "",
      };
    });
    context.predefinedEffects = await shadowdark.effects.getPredefinedEffectsList();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Right-click an attack, feature, spell or effect line for Edit / Delete, as on the system's sheets.
    this._createContextMenu(this._getItemContextOptions, ".item");
  }

  _getItemContextOptions() {
    const item = (el) => this.actor.items.get(el.dataset.itemId);
    return [
      { name: "SHADOWDARK.sheet.general.item_edit.title", icon: '<i class="fas fa-edit"></i>', condition: (el) => this.actor.isOwner && !!item(el), callback: (el) => item(el)?.sheet.render(true) },
      { name: "SHADOWDARK.sheet.general.item_delete.title", icon: '<i class="fas fa-trash"></i>', condition: (el) => this.actor.isOwner && !!item(el), callback: (el) => this._confirmDeleteItem(el.dataset.itemId) },
    ];
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    injectActorHeaderButtons(this.element);
    if (!this.isEditable) return;
    // Drop zones light up under a drag; the drop itself is routed in _onDropActor.
    for (const zone of this.element.querySelectorAll("[data-drop]")) {
      zone.addEventListener("dragover", () => zone.classList.add("sde-drag-over"));
      zone.addEventListener("dragleave", () => zone.classList.remove("sde-drag-over"));
      zone.addEventListener("drop", () => zone.classList.remove("sde-drag-over"));
    }
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  /** A predefined effect picked from the Effects tab's list becomes an effect on the actor, not data. */
  async _takePredefinedEffects(event, submitData) {
    const predefined = submitData.predefinedEffects;
    delete submitData.predefinedEffects;
    if (predefined && event?.target?.name === "predefinedEffects") await shadowdark.effects.createPredefinedEffect(this.actor, predefined);
  }

  async _processSubmitData(event, form, submitData, options = {}) {
    await this._takePredefinedEffects(event, submitData);
    return super._processSubmitData(event, form, submitData, options);
  }

  // ── Drops ──────────────────────────────────────────────────────────────────

  async _onDropItem(event, item) {
    if (item.type === "Effect" && item.system.duration?.type === "rounds" && !game.combat) {
      ui.notifications.warn(game.i18n.localize("SHADOWDARK.item.effect.warning.add_round_item_outside_combat"));
      return null;
    }
    return super._onDropItem(event, item);
  }

  /** The system drops an item onto a sheet when it is dropped on a token on the canvas. */
  async emulateItemDrop(data) {
    return this._onDropItem({}, await Item.implementation.fromDropData(data));
  }

  // ── Tabs and stats ─────────────────────────────────────────────────────────

  _onChangeTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab) return;
    this._activeTab = tab;
    const root = this.element;
    root.querySelectorAll("[data-tab-content]").forEach((el) => el.classList.toggle("active", el.dataset.tabContent === tab));
    root.querySelectorAll("[data-tab]").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  }

  _onEditImage() {
    return new foundry.applications.apps.FilePicker.implementation({
      type: "image", current: this.actor.img, callback: (path) => this.actor.update({ img: path }),
    }).browse();
  }

  _onRollAbility(event, target) {
    const ability = target.dataset.ability;
    if (ability) this.actor.system.rollStatCheck(ability, { skipPrompt: event.shiftKey });
  }

  _onRollHp() { return this.actor.system.rollHP(); }

  _onRollAttack(event, target) {
    const data = { skipPrompt: event.shiftKey };
    if (target.dataset.attackType) data.attack = { type: target.dataset.attackType };
    return this.actor.system.rollAttack(target.dataset.itemId, data);
  }

  _onDisplayFeature(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    return item ? shadowdark.chat.showItemCard(item.uuid) : null;
  }

  _onCastSpell(event, target) {
    return this.actor.system.castSpell(target.dataset.itemUuid, event.shiftKey ? { skipPrompt: true } : undefined);
  }

  _onToggleLost(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    return item?.update({ "system.lost": !item.system.lost });
  }

  _onShowDetails(event, target) { return shadowdark.utils.toggleItemDetails(target); }

  async _onItemCreate(event, target) {
    const type = target.dataset.itemType;
    const system = type === "Spell" ? { tier: 1 } : {};
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name: `New ${type}`, type, system }]);
    item?.sheet.render(true);
  }

  async _confirmDeleteItem(id) {
    const item = this.actor.items.get(id);
    if (!item) return null;
    const ok = await foundry.applications.api.DialogV2.confirm({
      classes: ["sde-ui", "sde-dialog"],
      window: { title: "SHADOWDARK.sheet.general.item_delete.title" },
      content: `<p>${foundry.utils.escapeHTML(item.name)}</p>`, rejectClose: false,
    });
    return ok ? this.actor.deleteEmbeddedDocuments("Item", [id]) : null;
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  async _onEffectControl(event, target) {
    const action = target.dataset.effectAction;
    const uuid = target.closest("[data-effect-uuid]")?.dataset.effectUuid;
    const effect = uuid ? await fromUuid(uuid) : null;
    switch (action) {
      case "create": {
        const name = game.i18n.localize("SHADOWDARK.effect.new");
        const [created] = await this.actor.createEmbeddedDocuments("ActiveEffect", [{ name, img: "icons/commodities/tech/cog-steel-grey.webp", origin: this.actor.uuid }]);
        return created?.sheet.render(true);
      }
      case "edit": return effect?.sheet.render(true);
      case "toggle": return effect?.update({ disabled: !effect.disabled });
      case "toggle-situational": return effect?.toggleSituational();
      case "delete": {
        if (!effect) return null;
        const ok = await foundry.applications.api.DialogV2.confirm({
          classes: ["sde-ui", "sde-dialog"],
          window: { title: "SHADOWDARK.sheet.general.active_effects.delete_effect.tooltip" },
          content: `<p>${game.i18n.localize("SHADOWDARK.dialog.general.yes")}?</p>`, rejectClose: false,
        });
        return ok ? effect.delete() : null;
      }
    }
    return null;
  }
}
