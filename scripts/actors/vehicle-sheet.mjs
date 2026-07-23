/**
 * Shadowdark Enhancer — ApplicationV2 base for the Boat actor sheet.
 *
 * Models the vehicle as a party-like container (mirroring shadowdark-extras'
 * PartySheetSD, but as a real ApplicationV2 sub-type): tabbed Overview /
 * Occupants / Inventory / Weapons / Description, droppable occupant actors with
 * NPC-style stat cards, a Place Tokens button, and embedded-item inventory with a
 * gear slot tally.
 *
 * Currently only `BoatSheet` extends this — the Mount actor sub-type is instead
 * an NPC-based sheet (`mount-npc-sheet.mjs`, a subclass of the system's
 * NpcSheetSD), not a VehicleSheet. The one subclass supplies its own template
 * (whose Overview renders the vessel's stats + helper rolls) and extends
 * `_prepareContext` with type-specific data.
 */


import { rollToChat, promptSiegeAttack } from "./vehicle-rolls.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class VehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["shadowdark-enhancer", "sde-vehicle-sheet"],
    position: { width: 560, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      changeTab: VehicleSheet.prototype._onChangeTab,
      placeTokens: VehicleSheet.prototype._onPlaceTokens,
      openOccupant: VehicleSheet.prototype._onOpenOccupant,
      removeOccupant: VehicleSheet.prototype._onRemoveOccupant,
      openItem: VehicleSheet.prototype._onOpenItem,
      deleteItem: VehicleSheet.prototype._onDeleteItem,
      weaponAttack: VehicleSheet.prototype._onWeaponAttack,
      weaponDamage: VehicleSheet.prototype._onWeaponDamage,
    },
  };

  /** Active tab id; preserved across re-renders. */
  _activeTab = "overview";

  /** Occupant label, e.g. "Riders" / "Passengers & Crew". Override. */
  get occupantLabel() { return "Occupants"; }

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    context.system = sys;
    context.derived = sys.derived ?? {};
    context.editable = this.isEditable;
    context.occupantLabel = this.occupantLabel;

    context.tab = {
      overview: this._activeTab === "overview",
      occupants: this._activeTab === "occupants",
      inventory: this._activeTab === "inventory",
      weapons: this._activeTab === "weapons",
      description: this._activeTab === "description",
    };

    context.occupants = await this._prepareOccupants();
    context.occupantCount = context.occupants.length;

    // Siege weapons (classified by flag, NOT item type — so an ordinary sword in
    // the hold doesn't masquerade as a mounted weapon) live on their own tab.
    context.weapons = this.document.items
      .filter((i) => this._isSiegeWeapon(i))
      .map((i) => ({
        id: i.id, name: i.name, img: i.img,
        damage: i.getFlag("shadowdark-enhancer", "siegeDamage")
          || i.system?.damage?.oneHanded || i.system?.damage?.twoHanded || "",
        slots: this._slotsForItem(i),
      }));
    context.weaponCount = context.weapons.length;

    const inv = this._prepareInventory();
    context.items = inv.items;
    context.slotsUsed = inv.slotsUsed;
    // Default slot tally; subclasses refine (mount adds rider slots + max, etc.)
    context.slotInfo = { used: inv.slotsUsed, max: null };

    context.enrichedNotes = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      sys.notes ?? "", { secrets: this.document.isOwner, relativeTo: this.document }
    );
    return context;
  }

  /** Resolve occupant UUIDs into stat-card data. */
  async _prepareOccupants() {
    const uuids = this.document.system.occupants ?? [];
    const roles = this.document.system.roles ?? [];
    const roleFor = (u) => roles.find((r) => r.uuid === u)?.role || "";
    const cards = [];
    for (const uuid of uuids) {
      const role = roleFor(uuid);
      let actor = null;
      try { actor = await fromUuid(uuid); } catch { /* unresolved */ }
      if (!actor) { cards.push({ uuid, broken: true, name: "(missing actor)" }); continue; }
      const s = actor.system ?? {};
      const ab = s.abilities ?? {};
      const fmt = (k) => {
        const n = ab[k]?.mod ?? ab[k]?.value ?? 0;
        return (n >= 0 ? "+" : "") + n;
      };
      cards.push({
        uuid,
        id: actor.id,
        name: actor.name,
        img: actor.img,
        role,
        isCaptain: role === "captain",
        isGunner: role === "gunner",
        isCrew: role === "crew",
        isNPC: actor.type === "NPC",
        subtitle: actor.items?.find?.((i) => i.type === "Class")?.name ?? actor.type,
        hp: { value: s.attributes?.hp?.value ?? 0, max: s.attributes?.hp?.max ?? 0 },
        ac: s.attributes?.ac?.value ?? 0,
        level: s.level?.value ?? null,
        abilities: {
          str: fmt("str"), dex: fmt("dex"), con: fmt("con"),
          int: fmt("int"), wis: fmt("wis"), cha: fmt("cha"),
        },
      });
    }
    return cards;
  }

  /** True when an item is a mounted siege weapon (flagged, not merely type Weapon). */
  _isSiegeWeapon(item) {
    if (item?.type !== "Weapon") return false;
    return item.getFlag?.("shadowdark-enhancer", "siegeWeapon") === true
      || !!item.getFlag?.("shadowdark-enhancer", "siegeDamage");
  }

  /** Embedded cargo items (siege weapons live on the Weapons tab) + a slot tally. */
  _prepareInventory() {
    const items = this.document.items
      .filter((i) => !this._isSiegeWeapon(i))
      .map((i) => ({
        id: i.id,
        name: i.name,
        img: i.img,
        type: i.type,
        quantity: i.system?.quantity ?? 1,
        slots: this._slotsForItem(i),
      }));
    const slotsUsed = items.reduce((sum, i) => sum + i.slots, 0);
    return { items, slotsUsed };
  }

  _slotsForItem(item) {
    const sl = item.system?.slots;
    if (!sl) return 0;
    const per = sl.per_slot || 1;
    const used = sl.slots_used ?? 1;
    const qty = item.system?.quantity ?? 1;
    return Math.ceil(qty / per) * used;
  }

  // ── Render: drag-drop wiring ────────────────────────────────────────────────

  _onRender(context, options) {
    super._onRender?.(context, options);
    if (!this.isEditable) return;
    const root = this.element;

    const occZone = root.querySelector('[data-drop="occupant"]');
    if (occZone) {
      occZone.addEventListener("dragover", (e) => { e.preventDefault(); occZone.classList.add("sde-drag-over"); });
      occZone.addEventListener("dragleave", () => occZone.classList.remove("sde-drag-over"));
      occZone.addEventListener("drop", (e) => { occZone.classList.remove("sde-drag-over"); this._onDropActor(e); });
    }

    // Item drops: the Cargo zone loads gear; the Weapons zone mounts siege weapons
    // (the destination is passed so the handler can classify/gate).
    for (const sel of ['[data-drop="inventory"]', '[data-drop="weapon"]']) {
      const zone = root.querySelector(sel);
      if (!zone) continue;
      const kind = zone.dataset.drop; // "inventory" | "weapon"
      zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("sde-drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("sde-drag-over"));
      zone.addEventListener("drop", (e) => { zone.classList.remove("sde-drag-over"); this._onDropItem(e, kind); });
    }

    // Crew role dropdowns (Passengers tab) — plain <select>s, no form name, so a
    // change writes the role map directly.
    for (const sel of root.querySelectorAll("select[data-role]")) {
      sel.addEventListener("change", () => this._onSetRole(sel.dataset.uuid, sel.value));
    }
  }

  /**
   * Assign (or clear) a crew role for an occupant; roles are an [{uuid,role}] list.
   * A boat has a single captain, so assigning Captain demotes any previous one.
   * Gunners are unrestricted (a vessel can crew more than one weapon).
   */
  async _onSetRole(uuid, role) {
    if (!uuid) return;
    const roles = (this.document.system.roles ?? []).filter((r) =>
      r.uuid !== uuid && !(role === "captain" && r.role === "captain"));
    if (role) roles.push({ uuid, role });
    await this.document.update({ "system.roles": roles });
  }

  _getDragData(event) {
    try {
      return foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    } catch {
      try { return JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return null; }
    }
  }

  async _onDropActor(event) {
    event.preventDefault();
    const data = this._getDragData(event);
    if (!data || data.type !== "Actor") return;
    const actor = await fromUuid(data.uuid).catch(() => null);
    if (!actor) return;
    if (!["Player", "NPC"].includes(actor.type)) {
      ui.notifications?.warn("Only Player or NPC actors can ride/board.");
      return;
    }
    const uuid = actor.uuid;
    const current = this.document.system.occupants ?? [];
    if (current.includes(uuid)) return;
    await this.document.update({ "system.occupants": [...current, uuid] });
  }

  async _onDropItem(event, zone = "inventory") {
    event.preventDefault();
    const data = this._getDragData(event);
    if (!data || data.type !== "Item") return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item) return;
    // Skip dropping an item already owned by this vehicle (a reorder, not an add).
    if (item.parent?.id === this.document.id) return;

    if (zone === "weapon") {
      if (item.type !== "Weapon") {
        ui.notifications?.warn(`Only weapons can be mounted — drop ${item.name} under ${this.occupantLabel === "Occupants" ? "Inventory" : "Cargo"}.`);
        return;
      }
      // Soft WR checks (the module adjudicates rather than hard-blocks): up to two
      // siege weapons, trebuchets galleon-only, and a Weapons property to mount.
      const sys = this.document.system;
      const mounted = this.document.items.filter((i) => this._isSiegeWeapon(i)).length;
      if (!sys.properties?.weapons)
        ui.notifications?.warn(`${this.document.name} has no Weapons property — mounting anyway.`);
      if (mounted >= 2)
        ui.notifications?.warn(`WR allows up to two siege weapons — this makes ${mounted + 1}. Mounting anyway.`);
      if (/trebuchet/i.test(item.name ?? "") && sys.boatType !== "Galleon")
        ui.notifications?.warn(`WR: trebuchets are galleon-only — mounting on this ${sys.boatType || "vessel"} anyway.`);
      // Stamp the siege flag so it's classified onto the Weapons tab (supports
      // home-brew weapons dropped here, not just imported ones).
      const obj = item.toObject();
      obj.flags ??= {};
      obj.flags["shadowdark-enhancer"] = { ...(obj.flags["shadowdark-enhancer"] ?? {}), siegeWeapon: true };
      await this.document.createEmbeddedDocuments("Item", [obj]);
      return;
    }
    await this.document.createEmbeddedDocuments("Item", [item.toObject()]);
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  _onChangeTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab) return;
    this._activeTab = tab;
    const root = this.element;
    root.querySelectorAll("[data-tab-content]").forEach((el) =>
      el.classList.toggle("active", el.dataset.tabContent === tab));
    root.querySelectorAll("[data-tab]").forEach((el) =>
      el.classList.toggle("active", el.dataset.tab === tab));
  }

  async _onOpenOccupant(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const actor = uuid ? await fromUuid(uuid).catch(() => null) : null;
    actor?.sheet?.render(true);
  }

  async _onRemoveOccupant(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const next = (this.document.system.occupants ?? []).filter((u) => u !== uuid);
    // Drop any crew role that referenced the removed occupant.
    const roles = (this.document.system.roles ?? []).filter((r) => r.uuid !== uuid);
    await this.document.update({ "system.occupants": next, "system.roles": roles });
  }

  async _onOpenItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    this.document.items.get(id)?.sheet?.render(true);
  }

  async _onDeleteItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if (id) await this.document.deleteEmbeddedDocuments("Item", [id]);
  }

  /**
   * Attack with a mounted weapon, operated by a crew member (a Passenger).
   *
   * Per the designer's ruling the operator uses their *ranged* attack bonus:
   * the ability modifier (DEX for the ranged siege weapons, STR for any melee
   * weapon) plus any flat attack bonuses the actor carries. Shadowdark has no
   * level-based attack scaling, so ability mod is the whole of it for most crew.
   * An untrained operator fires at disadvantage (Kelsey's house rule) — offered
   * as a roll-mode choice, not forced, so ADV (e.g. a Thief's Thievery) can
   * cancel it into a flat roll.
   */
  async _onWeaponAttack(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;

    const uuids = this.document.system.occupants ?? [];
    const crew = (await Promise.all(uuids.map((u) => fromUuid(u).catch(() => null)))).filter(Boolean);
    if (!crew.length) {
      ui.notifications?.warn(`Add a crew member under ${this.occupantLabel} to operate ${item.name}.`);
      return;
    }

    // An assigned Gunner (Passengers tab) is the default operator.
    const roles = this.document.system.roles ?? [];
    const roleOf = (a) => roles.find((r) => r.uuid === a.uuid)?.role || "";
    const gunner = crew.find((a) => roleOf(a) === "gunner");
    const picked = await promptSiegeAttack({
      title: `${item.name} — Attack`,
      operators: crew.map((a) => ({
        value: a.uuid,
        label: roleOf(a) === "gunner" ? `${a.name} (Gunner)` : a.name,
      })),
      preselect: gunner?.uuid,
    });
    if (!picked) return;
    const operator = crew.find((a) => a.uuid === picked.operator);
    if (!operator) return;

    const ranged = item.system?.type !== "melee"; // siege weapons import as ranged
    const abl = ranged ? "dex" : "str";
    const mod = Number(operator.system?.abilities?.[abl]?.mod ?? 0) || 0;
    const b = operator.system?.bonuses ?? {};
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const extra = num(b.attackBonus) + (ranged ? num(b.rangedAttackBonus) : num(b.meleeAttackBonus));
    const total = mod + extra;

    // Shadowdark advantage/disadvantage: keep highest / lowest of two d20.
    const d20 = picked.mode === "advantage" ? "2d20kh1"
      : picked.mode === "disadvantage" ? "2d20kl1" : "1d20";
    const modeLabel = picked.mode === "advantage" ? " with advantage"
      : picked.mode === "disadvantage" ? " with disadvantage (untrained)" : "";
    const sign = total >= 0 ? "+" : "";
    const esc = foundry.utils.escapeHTML;
    await rollToChat(`${d20} + ${total}`, {
      actor: operator,
      flavor: `${esc(item.name)} attack — ${esc(operator.name)} operating ${esc(this.document.name)} (${abl.toUpperCase()} ${sign}${total})${modeLabel}`,
    });
  }

  /** Roll a mounted weapon's damage (its own damage die, e.g. a siege 3d6). */
  async _onWeaponDamage(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    // Siege weapons keep their full multi-die formula ("3d6") in a flag; regular
    // weapons carry a single die in system.damage.
    const die = item.getFlag("shadowdark-enhancer", "siegeDamage")
      || item.system?.damage?.oneHanded || item.system?.damage?.twoHanded || "";
    if (!die) { ui.notifications?.warn(`${item.name} has no damage die set.`); return; }
    const formula = /^\d/.test(die) ? die : `1${die}`;   // "d8" → "1d8"; "3d6" stays
    await rollToChat(formula, { actor: this.document, flavor: `${foundry.utils.escapeHTML(item.name)} damage (${formula})` });
  }

  /** Place tokens for every occupant that isn't already on the canvas. */
  async _onPlaceTokens() {
    const scene = canvas?.scene;
    if (!scene) { ui.notifications?.warn("No active scene to place tokens on."); return; }

    const uuids = this.document.system.occupants ?? [];
    const actors = (await Promise.all(uuids.map((u) => fromUuid(u).catch(() => null)))).filter(Boolean);
    if (!actors.length) { ui.notifications?.warn(`No ${this.occupantLabel.toLowerCase()} to place.`); return; }

    const gs = scene.grid?.size ?? 100;
    const base = this.document.getActiveTokens?.()[0];
    let ox, oy;
    if (base) { ox = base.x + gs; oy = base.y; }
    else {
      const c = canvas.stage?.pivot ?? { x: scene.width / 2, y: scene.height / 2 };
      ox = c.x; oy = c.y;
    }

    const toCreate = [];
    let col = 0;
    for (const actor of actors) {
      if (actor.getActiveTokens?.().length) continue; // already on canvas
      const td = await actor.getTokenDocument({
        x: Math.round(ox + (col % 4) * gs),
        y: Math.round(oy + Math.floor(col / 4) * gs),
      });
      toCreate.push(td.toObject());
      col++;
    }
    if (!toCreate.length) { ui.notifications?.info("All occupants already have tokens on the scene."); return; }
    await scene.createEmbeddedDocuments("Token", toCreate);
    ui.notifications?.info(`Placed ${toCreate.length} token(s).`);
  }
}
