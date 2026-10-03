/**
 * Shadowdark Enhancer — Mount sheet, an ApplicationV2 actor sheet.
 *
 * Mounts ARE Shadowdark NPCs: the `shadowdark-enhancer.mount` sub-type reuses a
 * mount-only extension of the system's `NpcSD` data model (register-actors.mjs),
 * so existing NPC stat blocks (abilities, HP/AC, NPC Attacks/Features/Spells)
 * plug straight in and the model's own rolls (`rollHP`, `rollStatCheck`,
 * `rollAttack`, `castSpell`) do the work. The sheet itself is ours and has no
 * ApplicationV1 ancestry: it draws the stat block from the model, and the
 * attack/special lines from the system's own `npc-attack` partial, whose
 * `data-action`s are mapped to V2 actions below.
 *
 * Tabs: Stats, Riders, Gear, Mount (Western Reaches mount rules + helper
 * rolls), Spells, Notes, Effects. Occupants and the mount-rule fields live in
 * the actor's flags so the shared NpcSD schema is untouched; the six scores
 * live in the `mountScores` flag (mount-scores.mjs) and are written whole.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { rollToChat, promptNumber } from "./vehicle-rolls.mjs";
import { injectActorHeaderButtons } from "./vehicle-sheet.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { scoresOf } from "./mount-scores.mjs";
import { mountScores } from "./mount-scores-core.mjs";
import { garrisonFor } from "./warband-garrison.mjs";
import { visibleBastions } from "../bastion/bastion-panel-core.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const PHYSICAL_TYPES = ["Weapon", "Armor", "Basic", "Gem", "Potion", "Scroll", "Wand", "Light"];
const RARITIES = ["common", "uncommon", "rare", "legendary"];
/** The six ability labels are the system's own keys, written out literally (CONTRIBUTING § Localization). */
const ABILITY_LABEL_KEYS = { str: "SHADOWDARK.ability_str", dex: "SHADOWDARK.ability_dex", con: "SHADOWDARK.ability_con", int: "SHADOWDARK.ability_int", wis: "SHADOWDARK.ability_wis", cha: "SHADOWDARK.ability_cha" };
const RARITY_LABELS = { common: "SDE.mount.rarity.common", uncommon: "SDE.mount.rarity.uncommon", rare: "SDE.mount.rarity.rare", legendary: "SDE.mount.rarity.legendary" };
const PERSONALITY_LABELS = { horrid: "SDE.mount.personality.horrid", bad: "SDE.mount.personality.bad", neutral: "SDE.mount.personality.neutral", good: "SDE.mount.personality.good", lovely: "SDE.mount.personality.lovely" };
const BLOOD_LABELS = { warm: "SDE.mount.blood.warm", cold: "SDE.mount.blood.cold" };
const TABS = [
  ["stats", "SHADOWDARK.sheet.npc.tab.abilities"], ["riders", "SDE.mount.riders"], ["gear", "SDE.mount.inventory"],
  ["mount", "SDE.mount.tabMount"], ["spells", "SHADOWDARK.sheet.npc.tab.spells"],
  ["notes", "SHADOWDARK.sheet.npc.tab.description"], ["effects", "SHADOWDARK.sheet.item.tab.effects"],
];

/** Text of an HTML fragment (the system shows NPC feature and spell text as plain, then enriches it). */
const textOf = (html) => { const el = document.createElement("div"); el.innerHTML = html ?? ""; return el.textContent; };
/** {value, label, selected} rows for a <select> from a value→label-key table. */
const choices = (table, current) => Object.entries(table ?? {}).map(([value, label]) => ({ value, label: game.i18n.localize(label), selected: value === current }));

export class MountSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["shadowdark", "shadowdark-enhancer", "sde-vehicle-sheet", "sde-mount-npc"],
    position: { width: 620, height: 780 },
    window: { resizable: true, icon: "fa-solid fa-horse" },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      changeTab: MountSheet.prototype._onChangeTab,
      editImage: MountSheet.prototype._onEditImage,
      toggleEditStats: MountSheet.prototype._onToggleEditStats,
      rollAbility: MountSheet.prototype._onRollAbility,
      rollHp: MountSheet.prototype._onRollHp,
      placeTokens: MountSheet.prototype._onPlaceTokens,
      openOccupant: MountSheet.prototype._onOpenOccupant,
      removeOccupant: MountSheet.prototype._onRemoveOccupant,
      openItem: MountSheet.prototype._onOpenItem,
      deleteItem: MountSheet.prototype._onDeleteItem,
      itemCreate: MountSheet.prototype._onItemCreate,
      effectControl: MountSheet.prototype._onEffectControl,
      levelUp: MountSheet.prototype._onLevelUp,
      push: MountSheet.prototype._onPushCheck,
      morale: MountSheet.prototype._onMoraleCheck,
      personality: MountSheet.prototype._onPersonalityRoll,
      applyBase: MountSheet.prototype._onApplyBaseFromSelect,
      // The system's own attack, feature and spell markup carries these action names.
      "item-attack": MountSheet.prototype._onRollAttack,
      "display-feature": MountSheet.prototype._onDisplayFeature,
      "cast-npc-spell": MountSheet.prototype._onCastSpell,
      "focus-npc-spell": MountSheet.prototype._onCastSpell,
      "toggle-lost": MountSheet.prototype._onToggleLost,
      "show-details": MountSheet.prototype._onShowDetails,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/actors/mount-sheet.hbs` },
  };

  /** Active tab id; preserved across re-renders. */
  _activeTab = "stats";

  /** Whether the Stats box shows editable base scores (the pencil), as on the Player sheet. */
  editingStats = false;

  /** Titled with just the mount's name, like the system's own actor sheets. */
  get title() { return this.actor.name; }

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const mount = actor.getFlag(MODULE_ID, "mount") ?? {};
    Object.assign(context, {
      actor, system: sys, mount, owner: actor.isOwner, editable: this.isEditable, editingStats: this.editingStats,
      tabs: TABS.map(([id, label]) => ({ id, label: game.i18n.localize(label), active: id === this._activeTab })),
      tab: Object.fromEntries(TABS.map(([id]) => [id, id === this._activeTab])),
      moves: choices(CONFIG.SHADOWDARK.NPC_MOVES, sys.move),
      alignments: choices(CONFIG.SHADOWDARK.ALIGNMENTS, sys.alignment),
      castingAbilities: choices(CONFIG.SHADOWDARK.ABILITIES_LONG, sys.spellcasting?.ability),
    });

    const scores = scoresOf(actor);
    // The system's own order (STR INT / DEX WIS / CON CHA), as on its Player and NPC sheets.
    context.mountAbilities = Object.keys(sys.abilities).filter((key) => key in scores.base).map((key) => ({
      key, base: scores.base[key], damage: scores.damage[key], value: sys.abilities[key].value, mod: sys.abilities[key].mod,
      label: game.i18n.localize(ABILITY_LABEL_KEYS[key]),
    }));

    await this._prepareItems(context);

    // The bastion it is stabled at: a finished Stable there means it needs no grazing or rations.
    const stabled = await garrisonFor(mount.bastion);
    context.stabling = {
      bastions: visibleBastions(game.actors.contents, { user: game.user }).map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === mount.bastion })),
      missing: !!mount.bastion && !stabled,
      line: stabled?.stable ? game.i18n.format("SDE.mount.stabledLine", { bastion: stabled.name }) : null,
    };

    context.occupants = await this._prepareOccupants();
    context.occupantCount = context.occupants.length;
    context.tabs.find((t) => t.id === "riders").count = context.occupantCount;

    // Physical items only: attacks, features and spells stay on their own tabs.
    context.inventory = actor.items.filter((i) => PHYSICAL_TYPES.includes(i.type)).map((i) => ({
      id: i.id, name: i.name, img: i.img, type: i.type, quantity: i.system?.quantity ?? 1, slots: this._slotsForItem(i),
    }));
    const slotsUsed = context.inventory.reduce((s, i) => s + i.slots, 0);

    // Derived mount values
    const strMod = sys.abilities?.str?.mod ?? 0;
    const lvl = sys.level?.value ?? 0;
    let gearMax = 5 * strMod;
    if (mount.properties?.sturdy) gearMax += 5;
    if (mount.tack?.wagon) gearMax += 15;
    const riderSlots = context.occupantCount * 10;
    context.derived = {
      gearSlotsMax: Math.max(0, gearMax), slotsUsed, riderSlots, slotsTotal: slotsUsed + riderSlots,
      attackBonus: Math.floor(lvl / 2), canAttack: lvl >= 7, pushHexesPerDay: sys.abilities?.con?.mod ?? 0,
      personalityBonus: mount.properties?.goodTempered ? 2 : 0,
      needsTraining: RARITIES.slice(2).includes(mount.rarity),
      thirstDanger: (mount.feeding?.daysSinceWater ?? 0) >= 3,
      starveDanger: !stabled?.stable && (mount.feeding?.daysSinceFood ?? 0) >= 21,
    };
    context.choices = {
      rarities: choices(RARITY_LABELS, mount.rarity ?? "common"),
      personalities: choices(PERSONALITY_LABELS, mount.personality ?? "neutral"),
      bloodTypes: choices(BLOOD_LABELS, mount.bloodType ?? "warm"),
    };
    // World NPCs available as a stat base (compendium NPCs via drag-drop).
    context.npcChoices = game.actors
      .filter((a) => a.type === "NPC" && a.id !== actor.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ uuid: a.uuid, name: a.name }));

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

  async _prepareOccupants() {
    const uuids = this.actor.getFlag(MODULE_ID, "occupants") ?? [];
    const cards = [];
    for (const uuid of uuids) {
      let actor = null;
      try { actor = await fromUuid(uuid); } catch { /* unresolved */ }
      if (!actor) { cards.push({ uuid, broken: true, name: game.i18n.localize("SDE.vehicle.missingActor") }); continue; }
      const s = actor.system ?? {};
      const ab = s.abilities ?? {};
      const fmt = (k) => { const n = ab[k]?.mod ?? ab[k]?.value ?? 0; return (n >= 0 ? "+" : "") + n; };
      cards.push({
        uuid, id: actor.id, name: actor.name, img: actor.img,
        isNPC: actor.type === "NPC",
        subtitle: actor.items?.find?.((i) => i.type === "Class")?.name ?? actor.type,
        hp: { value: s.attributes?.hp?.value ?? 0, max: s.attributes?.hp?.max ?? 0 },
        ac: s.attributes?.ac?.value ?? 0,
        level: s.level?.value ?? null,
        abilities: { str: fmt("str"), dex: fmt("dex"), con: fmt("con"), int: fmt("int"), wis: fmt("wis"), cha: fmt("cha") },
      });
    }
    return cards;
  }

  _slotsForItem(item) {
    const sl = item.system?.slots;
    if (!sl) return 0;
    const per = sl.per_slot || 1;
    const used = sl.slots_used ?? 1;
    const qty = item.system?.quantity ?? 1;
    return Math.ceil(qty / per) * used;
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

  /** The six scores are written whole through replaceModuleFlag; predefined effects become effects, not data. */
  async _processSubmitData(event, form, submitData, options = {}) {
    const predefined = submitData.predefinedEffects;
    delete submitData.predefinedEffects;
    if (predefined && event?.target?.name === "predefinedEffects") await shadowdark.effects.createPredefinedEffect(this.actor, predefined);
    const base = submitData.flags?.[MODULE_ID]?.mountScores?.base;
    if (!base) return super._processSubmitData(event, form, submitData, options);
    delete submitData.flags[MODULE_ID].mountScores;
    const state = scoresOf(this.actor);
    for (const [key, raw] of Object.entries(base)) {
      if (!(key in state.base)) continue;
      const value = Number(raw);
      if (!Number.isInteger(value)) throw new Error(game.i18n.localize("SDE.mount.invalidScore"));
      state.base[key] = value;
    }
    return replaceModuleFlag(this.actor, "mountScores", state, foundry.utils.flattenObject(submitData), options);
  }

  // ── Drops ──────────────────────────────────────────────────────────────────

  /**
   * Actor drops are routed by the zone they land on:
   *   • the "Base creature" box  → copy the NPC's stats
   *   • the Riders drop zone      → add as a rider occupant
   *   • anywhere else             → ignored (so a near-miss never adds a rider)
   */
  async _onDropActor(event, actor) {
    const zone = event.target?.closest?.("[data-drop]")?.dataset.drop;
    if (zone === "base-npc") return this._applyBaseFromUuid(actor.uuid);
    if (zone === "occupant") return this._onDropOccupant(actor);
    return null;
  }

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

  async _onDropOccupant(actor) {
    if (!["Player", "NPC"].includes(actor.type)) {
      ui.notifications?.warn(game.i18n.localize("SDE.mount.notify.onlyActorsRide"));
      return null;
    }
    const current = this.actor.getFlag(MODULE_ID, "occupants") ?? [];
    if (current.includes(actor.uuid)) return null;
    await this.actor.setFlag(MODULE_ID, "occupants", [...current, actor.uuid]);
    return actor;
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

  _onToggleEditStats() {
    this.editingStats = !this.editingStats;
    return this.render();
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
          window: { title: "SHADOWDARK.sheet.general.active_effects.delete_effect.tooltip" },
          content: `<p>${game.i18n.localize("SHADOWDARK.dialog.general.yes")}?</p>`, rejectClose: false,
        });
        return ok ? effect.delete() : null;
      }
    }
    return null;
  }

  // ── Riders and gear ────────────────────────────────────────────────────────

  async _onOpenOccupant(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const actor = uuid ? await fromUuid(uuid).catch(() => null) : null;
    actor?.sheet?.render(true);
  }

  async _onRemoveOccupant(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const next = (this.actor.getFlag(MODULE_ID, "occupants") ?? []).filter((u) => u !== uuid);
    await this.actor.setFlag(MODULE_ID, "occupants", next);
  }

  _onOpenItem(event, target) {
    this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId)?.sheet?.render(true);
  }

  _onDeleteItem(event, target) {
    return this._confirmDeleteItem(target.closest("[data-item-id]")?.dataset.itemId);
  }

  async _confirmDeleteItem(id) {
    const item = this.actor.items.get(id);
    if (!item) return null;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "SHADOWDARK.sheet.general.item_delete.title" },
      content: `<p>${foundry.utils.escapeHTML(item.name)}</p>`, rejectClose: false,
    });
    return ok ? this.actor.deleteEmbeddedDocuments("Item", [id]) : null;
  }

  /** Place tokens for occupants not already on the canvas. */
  async _onPlaceTokens() {
    const scene = canvas?.scene;
    if (!scene) { ui.notifications?.warn(game.i18n.localize("SDE.vehicle.notify.noScene")); return; }
    const uuids = this.actor.getFlag(MODULE_ID, "occupants") ?? [];
    const actors = (await Promise.all(uuids.map((u) => fromUuid(u).catch(() => null)))).filter(Boolean);
    if (!actors.length) { ui.notifications?.warn(game.i18n.localize("SDE.mount.notify.noRiders")); return; }
    const gs = scene.grid?.size ?? 100;
    const base = this.actor.getActiveTokens?.()[0];
    let ox, oy;
    if (base) { ox = base.x + gs; oy = base.y; }
    else { const c = canvas.stage?.pivot ?? { x: scene.width / 2, y: scene.height / 2 }; ox = c.x; oy = c.y; }
    const toCreate = [];
    let col = 0;
    for (const actor of actors) {
      if (actor.getActiveTokens?.().length) continue;
      const td = await actor.getTokenDocument({ x: Math.round(ox + (col % 4) * gs), y: Math.round(oy + Math.floor(col / 4) * gs) });
      toCreate.push(td.toObject());
      col++;
    }
    if (!toCreate.length) { ui.notifications?.info(game.i18n.localize("SDE.mount.notify.allPlaced")); return; }
    await scene.createEmbeddedDocuments("Token", toCreate);
    ui.notifications?.info(game.i18n.format("SDE.vehicle.notify.placed", { count: toCreate.length }));
  }

  // ── Base creature ──────────────────────────────────────────────────────────

  _onApplyBaseFromSelect() {
    const uuid = this.element.querySelector("[data-sde-base-select]")?.value;
    if (!uuid) { ui.notifications?.warn(game.i18n.localize("SDE.mount.notify.chooseNpc")); return; }
    return this._applyBaseFromUuid(uuid);
  }

  async _applyBaseFromUuid(uuid) {
    const source = await fromUuid(uuid).catch(() => null);
    if (!source) { ui.notifications?.warn(game.i18n.localize("SDE.mount.notify.loadFailed")); return; }
    if (source.id === this.actor.id) return;
    if (source.type !== "NPC") {
      ui.notifications?.warn(game.i18n.localize("SDE.mount.notify.pickNpc"));
      return;
    }
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "SDE.mount.copyStats.title" },
      content: `<p>${game.i18n.format("SDE.mount.copyStats.question", { name: `<strong>${source.name}</strong>` })}</p>`
        + `<p>${game.i18n.localize("SDE.mount.copyStats.warning")}</p>`,
      rejectClose: false,
    });
    if (!ok) return;
    await this._applyBaseNpc(source);
    ui.notifications?.info(game.i18n.format("SDE.mount.notify.copied", { source: source.name, mount: this.actor.name }));
  }

  /** Copy an NPC's system data, image, and stat items onto this mount. */
  async _applyBaseNpc(source) {
    const STAT_TYPES = ["NPC Attack", "NPC Special Attack", "NPC Feature", "Spell"];

    // System data + portrait (mount-rule flags & name are preserved).
    await replaceModuleFlag(this.actor, "mountScores", mountScores(source.toObject().system.abilities, { damage: scoresOf(this.actor).damage }), {
      system: foundry.utils.duplicate(source.toObject().system),
      img: source.img,
    });

    // Replace stat items (attacks/specials/features/spells); keep gear.
    const toRemove = this.actor.items.filter((i) => STAT_TYPES.includes(i.type)).map((i) => i.id);
    if (toRemove.length) await this.actor.deleteEmbeddedDocuments("Item", toRemove);
    const toAdd = source.items.filter((i) => STAT_TYPES.includes(i.type)).map((i) => i.toObject());
    if (toAdd.length) await this.actor.createEmbeddedDocuments("Item", toAdd);
  }

  // ── Helper rolls ───────────────────────────────────────────────────────────

  async _onLevelUp() {
    const roll = await rollToChat("1d8", { actor: this.actor, flavor: game.i18n.format("SDE.mount.chat.levelUp", { name: this.actor.name }) });
    const gain = roll.total;
    const sys = this.actor.system;
    await this.actor.update({
      "system.level.value": (sys.level?.value ?? 0) + 1,
      "system.attributes.hp.max": (sys.attributes?.hp?.max ?? 0) + gain,
      "system.attributes.hp.value": (sys.attributes?.hp?.value ?? 0) + gain,
    });
  }

  async _onPushCheck() {
    const mount = this.actor.getFlag(MODULE_ID, "mount") ?? {};
    const dc = 12 + (mount.pushing?.consecutiveDays ?? 0);
    const conMod = this.actor.system.abilities?.con?.mod ?? 0;
    const roll = await new Roll(`1d20 + ${conMod}`).evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `<strong>${game.i18n.format("SDE.mount.chat.pushCheck", { dc })}</strong><br>${
        game.i18n.localize(roll.total >= dc ? "SDE.mount.chat.pushHolds" : "SDE.mount.chat.pushFails")}`,
      flags: { [MODULE_ID]: { vehicleRoll: true } },
    });
  }

  async _onMoraleCheck() {
    const cha = await promptNumber({
      title: "SDE.mount.moraleCheck", label: game.i18n.localize("SDE.mount.moraleChaLabel"), initial: 0,
    });
    if (cha === null) return;
    await rollToChat(`1d20 + ${cha}`, {
      actor: this.actor, flavor: game.i18n.format("SDE.mount.chat.morale", { bonus: `${cha >= 0 ? "+" : ""}${cha}` }),
    });
  }

  async _onPersonalityRoll() {
    const mount = this.actor.getFlag(MODULE_ID, "mount") ?? {};
    const bonus = mount.properties?.goodTempered ? 2 : 0;
    const roll = await rollToChat(`1d20 + ${bonus}`, {
      actor: this.actor,
      flavor: game.i18n.localize(bonus ? "SDE.mount.chat.personalityGoodTempered" : "SDE.mount.chat.personality"),
    });
    const t = roll.total;
    const band = t <= 4 ? "horrid" : t <= 8 ? "bad" : t <= 12 ? "neutral" : t <= 16 ? "good" : "lovely";
    await this.actor.setFlag(MODULE_ID, "mount", { ...mount, personality: band });
  }
}
