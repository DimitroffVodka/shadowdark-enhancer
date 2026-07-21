/**
 * Shadowdark Enhancer — Mount sheet, built as a subclass of the Shadowdark
 * system's NPC sheet (NpcSheetSD, AppV1).
 *
 * Mounts ARE Shadowdark NPCs: the `shadowdark-enhancer.mount` sub-type reuses
 * the system's `NpcSD` data model, so existing NPC stat blocks (abilities,
 * HP/AC, NPC Attacks/Features/Spells) plug straight in. This sheet reuses the
 * system's own `actors/npc/*` Handlebars partials so the Abilities / Spells /
 * Description / Effects tabs are pixel-identical to a native NPC, and injects
 * three extra tabs: Riders (party-style occupants), Inventory, and Mount
 * (Western Reaches mount rules + helper rolls).
 *
 * Occupants and the mount-rule fields live in the actor's flags so the shared
 * NpcSD schema is untouched.
 *
 * The base class is resolved at registration time (CONFIG.Actor.sheetClasses)
 * and passed in, so we never hard-import from the system bundle.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { rollToChat, promptNumber } from "./vehicle-rolls.mjs";

const PHYSICAL_TYPES = ["Weapon", "Armor", "Basic", "Gem", "Potion", "Scroll", "Wand", "Light"];
const RARITIES = ["common", "uncommon", "rare", "legendary"];
const PERSONALITIES = ["horrid", "bad", "neutral", "good", "lovely"];

/** Build the Mount sheet class as a subclass of the live NpcSheetSD. */
export function buildMountNpcSheet(BaseNpcSheet) {
  return class MountNpcSheetSD extends BaseNpcSheet {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ["shadowdark", "sheet", "npc", "sde-mount-npc"],
        width: 600,
        height: 760,
        scrollY: ["section.SD-content-body"],
        tabs: [{ navSelector: ".SD-nav", contentSelector: ".SD-content-body", initial: "tab-abilities" }],
      });
    }

    get template() {
      return `modules/${MODULE_ID}/templates/actors/mount-npc.hbs`;
    }

    /** @override — add Riders / Inventory / Mount context on top of the NPC context. */
    async getData(options) {
      const context = await super.getData(options);
      const sys = this.actor.system;
      const mount = this.actor.getFlag(MODULE_ID, "mount") ?? {};
      context.mount = mount;
      context.occupantLabel = "Riders";

      // Riders
      context.occupants = await this._prepareOccupants();
      context.occupantCount = context.occupants.length;

      // Inventory (physical items only — attacks/features/spells stay on their tabs)
      const physical = this.actor.items.filter((i) => PHYSICAL_TYPES.includes(i.type));
      context.inventory = physical.map((i) => ({
        id: i.id, name: i.name, img: i.img, type: i.type,
        quantity: i.system?.quantity ?? 1, slots: this._slotsForItem(i),
      }));
      const slotsUsed = context.inventory.reduce((s, i) => s + i.slots, 0);

      // Derived mount values
      const ab = sys.abilities ?? {};
      const strMod = ab.str?.mod ?? 0;
      const conMod = ab.con?.mod ?? 0;
      const lvl = sys.level?.value ?? 0;
      let gearMax = 5 * strMod;
      if (mount.properties?.sturdy) gearMax += 5;
      if (mount.tack?.wagon) gearMax += 15;
      if (gearMax < 0) gearMax = 0;
      const riderSlots = context.occupantCount * 10;
      context.derived = {
        gearSlotsMax: gearMax,
        slotsUsed,
        riderSlots,
        slotsTotal: slotsUsed + riderSlots,
        attackBonus: Math.floor(lvl / 2),
        canAttack: lvl >= 7,
        pushHexesPerDay: conMod,
        personalityBonus: mount.properties?.goodTempered ? 2 : 0,
        needsTraining: RARITIES.slice(2).includes(mount.rarity),
        thirstDanger: (mount.feeding?.daysSinceWater ?? 0) >= 3,
        starveDanger: (mount.feeding?.daysSinceFood ?? 0) >= 21,
      };

      const opt = (vals, cur, labels) => vals.map((v) => ({
        value: v, selected: v === cur,
        label: labels?.[v] ?? (v.charAt(0).toUpperCase() + v.slice(1)),
      }));
      context.choices = {
        rarities: opt(RARITIES, mount.rarity ?? "common"),
        personalities: opt(PERSONALITIES, mount.personality ?? "neutral"),
        bloodTypes: opt(["warm", "cold"], mount.bloodType ?? "warm",
          { warm: "Warm-blooded", cold: "Cold-blooded / camel" }),
      };
      // World NPCs available as a stat base (compendium NPCs via drag-drop).
      context.npcChoices = game.actors
        .filter((a) => a.type === "NPC" && a.id !== this.actor.id)
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
        if (!actor) { cards.push({ uuid, broken: true, name: "(missing actor)" }); continue; }
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

    /** @override — wire our buttons, then let the system bind its own. */
    activateListeners(html) {
      const root = html[0] ?? html;

      root.querySelectorAll("[data-sde-action='place-tokens']").forEach((el) =>
        el.addEventListener("click", () => this._onPlaceTokens()));
      root.querySelectorAll("[data-sde-action='open-occupant']").forEach((el) =>
        el.addEventListener("click", (e) => this._onOpenOccupant(e)));
      root.querySelectorAll("[data-sde-action='remove-occupant']").forEach((el) =>
        el.addEventListener("click", (e) => this._onRemoveOccupant(e)));
      root.querySelectorAll("[data-sde-action='open-item']").forEach((el) =>
        el.addEventListener("click", (e) => this._onOpenItem(e)));
      root.querySelectorAll("[data-sde-action='delete-item']").forEach((el) =>
        el.addEventListener("click", (e) => this._onDeleteItem(e)));
      root.querySelectorAll("[data-sde-action='levelup']").forEach((el) =>
        el.addEventListener("click", () => this._onLevelUp()));
      root.querySelectorAll("[data-sde-action='push']").forEach((el) =>
        el.addEventListener("click", () => this._onPushCheck()));
      root.querySelectorAll("[data-sde-action='morale']").forEach((el) =>
        el.addEventListener("click", () => this._onMoraleCheck()));
      root.querySelectorAll("[data-sde-action='personality']").forEach((el) =>
        el.addEventListener("click", () => this._onPersonalityRoll()));
      root.querySelectorAll("[data-sde-action='apply-base']").forEach((el) =>
        el.addEventListener("click", () => this._onApplyBaseFromSelect()));

      super.activateListeners(html);
    }

    /**
     * @override — Actor drops are routed by the specific drop zone they land on:
     *   • the "Base creature" box  → copy the NPC's stats
     *   • the Riders drop zone      → add as a rider occupant
     *   • anywhere else             → ignored (so a near-miss never adds a rider)
     * Non-actor drops (items/spells) defer to the system handler.
     */
    async _onDrop(event) {
      let data = null;
      try { data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event); } catch { /* */ }
      if (data?.type === "Actor") {
        const target = event.target;
        if (target?.closest?.("[data-drop='base-npc']")) return this._applyBaseFromUuid(data.uuid);
        if (target?.closest?.("[data-drop='occupant']")) return this._onDropOccupant(data);
        return; // actor dropped outside a recognised zone — do nothing
      }
      return super._onDrop(event);
    }

    _onApplyBaseFromSelect() {
      const sel = (this.element[0] ?? this.element)?.querySelector("[data-sde-base-select]");
      const uuid = sel?.value;
      if (!uuid) { ui.notifications?.warn("Choose an NPC to copy stats from."); return; }
      return this._applyBaseFromUuid(uuid);
    }

    async _applyBaseFromUuid(uuid) {
      const source = await fromUuid(uuid).catch(() => null);
      if (!source) { ui.notifications?.warn("Could not load that actor."); return; }
      if (source.id === this.actor.id) return;
      if (source.type !== "NPC") {
        ui.notifications?.warn("Pick an NPC statblock to use as a base.");
        return;
      }
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Copy NPC Stats" },
        content: `<p>Copy abilities, HP, AC, level, movement, alignment, and Attacks/Features/Spells from <strong>${source.name}</strong> onto this mount?</p>`
          + `<p>This overwrites the mount's current stats and stat items. Riders, gear, and mount settings are kept.</p>`,
        rejectClose: false,
      });
      if (!ok) return;
      await this._applyBaseNpc(source);
      ui.notifications?.info(`Copied ${source.name}'s statblock onto ${this.actor.name}.`);
    }

    /** Copy an NPC's system data, image, and stat items onto this mount. */
    async _applyBaseNpc(source) {
      const STAT_TYPES = ["NPC Attack", "NPC Special Attack", "NPC Feature", "Spell"];

      // System data + portrait (mount-rule flags & name are preserved).
      await this.actor.update({
        system: foundry.utils.duplicate(source.toObject().system),
        img: source.img,
      });

      // Replace stat items (attacks/specials/features/spells); keep gear.
      const toRemove = this.actor.items.filter((i) => STAT_TYPES.includes(i.type)).map((i) => i.id);
      if (toRemove.length) await this.actor.deleteEmbeddedDocuments("Item", toRemove);
      const toAdd = source.items.filter((i) => STAT_TYPES.includes(i.type)).map((i) => i.toObject());
      if (toAdd.length) await this.actor.createEmbeddedDocuments("Item", toAdd);
    }

    async _onDropOccupant(data) {
      const actor = await fromUuid(data.uuid).catch(() => null);
      if (!actor) return;
      if (!["Player", "NPC"].includes(actor.type)) {
        ui.notifications?.warn("Only Player or NPC actors can ride.");
        return;
      }
      const current = this.actor.getFlag(MODULE_ID, "occupants") ?? [];
      if (current.includes(actor.uuid)) return;
      await this.actor.setFlag(MODULE_ID, "occupants", [...current, actor.uuid]);
    }

    async _onOpenOccupant(event) {
      const uuid = event.currentTarget.closest("[data-uuid]")?.dataset.uuid;
      const actor = uuid ? await fromUuid(uuid).catch(() => null) : null;
      actor?.sheet?.render(true);
    }

    async _onRemoveOccupant(event) {
      const uuid = event.currentTarget.closest("[data-uuid]")?.dataset.uuid;
      if (!uuid) return;
      const next = (this.actor.getFlag(MODULE_ID, "occupants") ?? []).filter((u) => u !== uuid);
      await this.actor.setFlag(MODULE_ID, "occupants", next);
    }

    _onOpenItem(event) {
      const id = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      this.actor.items.get(id)?.sheet?.render(true);
    }

    async _onDeleteItem(event) {
      const id = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      if (id) await this.actor.deleteEmbeddedDocuments("Item", [id]);
    }

    // ── Helper rolls ─────────────────────────────────────────────────────────

    async _onLevelUp() {
      const roll = await rollToChat("1d8", { actor: this.actor, flavor: `${this.actor.name} levels up (+1d8 HP)` });
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
        flavor: `<strong>Push check — CON vs DC ${dc}</strong><br>${
          roll.total >= dc ? "Holds up — can travel tomorrow." : "Cannot travel the following day."}`,
        flags: { [MODULE_ID]: { vehicleRoll: true } },
      });
    }

    async _onMoraleCheck() {
      const cha = await promptNumber({ title: "Morale Check", label: "Rider's Charisma modifier:", initial: 0 });
      if (cha === null) return;
      await rollToChat(`1d20 + ${cha}`, { actor: this.actor, flavor: `Morale check — rider CHA (${cha >= 0 ? "+" : ""}${cha})` });
    }

    async _onPersonalityRoll() {
      const mount = this.actor.getFlag(MODULE_ID, "mount") ?? {};
      const bonus = mount.properties?.goodTempered ? 2 : 0;
      const roll = await rollToChat(`1d20 + ${bonus}`, { actor: this.actor, flavor: `Personality roll${bonus ? " (Good-Tempered +2)" : ""}` });
      const t = roll.total;
      const band = t <= 4 ? "horrid" : t <= 8 ? "bad" : t <= 12 ? "neutral" : t <= 16 ? "good" : "lovely";
      await this.actor.setFlag(MODULE_ID, "mount", { ...mount, personality: band });
    }

    /** Place tokens for occupants not already on the canvas. */
    async _onPlaceTokens() {
      const scene = canvas?.scene;
      if (!scene) { ui.notifications?.warn("No active scene to place tokens on."); return; }
      const uuids = this.actor.getFlag(MODULE_ID, "occupants") ?? [];
      const actors = (await Promise.all(uuids.map((u) => fromUuid(u).catch(() => null)))).filter(Boolean);
      if (!actors.length) { ui.notifications?.warn("No riders to place."); return; }
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
      if (!toCreate.length) { ui.notifications?.info("All riders already have tokens on the scene."); return; }
      await scene.createEmbeddedDocuments("Token", toCreate);
      ui.notifications?.info(`Placed ${toCreate.length} token(s).`);
    }
  };
}
