/**
 * Shadowdark Enhancer — Mount sheet, an ApplicationV2 actor sheet.
 *
 * Mounts ARE Shadowdark NPCs: the `shadowdark-enhancer.mount` sub-type reuses a
 * mount-only extension of the system's `NpcSD` data model (register-actors.mjs),
 * so existing NPC stat blocks (abilities, HP/AC, NPC Attacks/Features/Spells)
 * plug straight in and the model's own rolls (`rollHP`, `rollStatCheck`,
 * `rollAttack`, `castSpell`) do the work. The stat block itself (header, HP/AC,
 * attacks, spells, description, effects and their actions) is the shared
 * NpcStatSheet (npc-stat-sheet.mjs); this class adds the Mount's own tabs.
 *
 * Tabs: Stats, Riders, Gear, Mount (Western Reaches mount rules + helper
 * rolls), Spells, Notes, Effects. Occupants and the mount-rule fields live in
 * the actor's flags so the shared NpcSD schema is untouched; the six scores
 * live in the `mountScores` flag (mount-scores.mjs) and are written whole.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { rollToChat, promptNumber } from "./vehicle-rolls.mjs";
import { NpcStatSheet, NPC_STAT_PARTIALS, ABILITY_LABEL_KEYS, choices } from "./npc-stat-sheet.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { scoresOf } from "./mount-scores.mjs";
import { mountScores } from "./mount-scores-core.mjs";
import { garrisonFor } from "./warband-garrison.mjs";
import { visibleBastions } from "../bastion/bastion-panel-core.mjs";

const PHYSICAL_TYPES = ["Weapon", "Armor", "Basic", "Gem", "Potion", "Scroll", "Wand", "Light"];
const RARITIES = ["common", "uncommon", "rare", "legendary"];
const RARITY_LABELS = { common: "SDE.mount.rarity.common", uncommon: "SDE.mount.rarity.uncommon", rare: "SDE.mount.rarity.rare", legendary: "SDE.mount.rarity.legendary" };
const PERSONALITY_LABELS = { horrid: "SDE.mount.personality.horrid", bad: "SDE.mount.personality.bad", neutral: "SDE.mount.personality.neutral", good: "SDE.mount.personality.good", lovely: "SDE.mount.personality.lovely" };
const BLOOD_LABELS = { warm: "SDE.mount.blood.warm", cold: "SDE.mount.blood.cold" };

export class MountSheet extends NpcStatSheet {
  static DEFAULT_OPTIONS = {
    classes: ["sde-mount-npc"],
    position: { width: 620, height: 780 },
    window: { icon: "fa-solid fa-horse" },
    actions: {
      toggleEditStats: MountSheet.prototype._onToggleEditStats,
      placeTokens: MountSheet.prototype._onPlaceTokens,
      openOccupant: MountSheet.prototype._onOpenOccupant,
      removeOccupant: MountSheet.prototype._onRemoveOccupant,
      openItem: MountSheet.prototype._onOpenItem,
      deleteItem: MountSheet.prototype._onDeleteItem,
      levelUp: MountSheet.prototype._onLevelUp,
      push: MountSheet.prototype._onPushCheck,
      morale: MountSheet.prototype._onMoraleCheck,
      personality: MountSheet.prototype._onPersonalityRoll,
      applyBase: MountSheet.prototype._onApplyBaseFromSelect,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/actors/mount-sheet.hbs`, templates: NPC_STAT_PARTIALS },
  };

  static STAT_TABS = [
    ["stats", "SHADOWDARK.sheet.npc.tab.abilities"], ["riders", "SDE.mount.riders"], ["gear", "SDE.mount.inventory"],
    ["mount", "SDE.mount.tabMount"], ["spells", "SHADOWDARK.sheet.npc.tab.spells"],
    ["notes", "SHADOWDARK.sheet.npc.tab.description"], ["effects", "SHADOWDARK.sheet.item.tab.effects"],
  ];

  /** Whether the Stats box shows editable base scores (the pencil), as on the Player sheet. */
  editingStats = false;

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const mount = actor.getFlag(MODULE_ID, "mount") ?? {};
    Object.assign(context, { mount, editingStats: this.editingStats });

    const scores = scoresOf(actor);
    // The system's own order (STR INT / DEX WIS / CON CHA), as on its Player and NPC sheets.
    context.mountAbilities = Object.keys(sys.abilities).filter((key) => key in scores.base).map((key) => ({
      key, base: scores.base[key], damage: scores.damage[key], value: sys.abilities[key].value, mod: sys.abilities[key].mod,
      label: game.i18n.localize(ABILITY_LABEL_KEYS[key]),
    }));

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
    return context;
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

  // ── Form ───────────────────────────────────────────────────────────────────

  /** The six scores are written whole through replaceModuleFlag; predefined effects become effects, not data. */
  async _processSubmitData(event, form, submitData, options = {}) {
    await this._takePredefinedEffects(event, submitData);
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

  // ── Stats ──────────────────────────────────────────────────────────────────

  _onToggleEditStats() {
    this.editingStats = !this.editingStats;
    return this.render();
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
