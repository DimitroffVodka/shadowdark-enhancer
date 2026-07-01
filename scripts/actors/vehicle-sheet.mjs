/**
 * Shadowdark Enhancer — shared base for the Mount & Boat actor sheets.
 *
 * Models the vehicle as a party-like container (mirroring shadowdark-extras'
 * PartySheetSD, but as a real ApplicationV2 sub-type): tabbed Overview /
 * Occupants / Inventory / Description, droppable occupant actors with NPC-style
 * stat cards, a Place Tokens button, and embedded-item inventory with a gear
 * slot tally.
 *
 * Subclasses (MountSheet / BoatSheet) supply their own template (whose Overview
 * tab renders the vehicle's own stats + helper rolls) and extend
 * `_prepareContext` with type-specific data.
 */

import { MODULE_ID } from "../module-id.mjs";

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
      description: this._activeTab === "description",
    };

    context.occupants = await this._prepareOccupants();
    context.occupantCount = context.occupants.length;

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
    const cards = [];
    for (const uuid of uuids) {
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

  /** Embedded items + a Shadowdark-style slot tally. */
  _prepareInventory() {
    const items = this.document.items.map((i) => ({
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

    const invZone = root.querySelector('[data-drop="inventory"]');
    if (invZone) {
      invZone.addEventListener("dragover", (e) => { e.preventDefault(); invZone.classList.add("sde-drag-over"); });
      invZone.addEventListener("dragleave", () => invZone.classList.remove("sde-drag-over"));
      invZone.addEventListener("drop", (e) => { invZone.classList.remove("sde-drag-over"); this._onDropItem(e); });
    }
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

  async _onDropItem(event) {
    event.preventDefault();
    const data = this._getDragData(event);
    if (!data || data.type !== "Item") return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item) return;
    // Skip dropping an item already owned by this vehicle (a reorder, not an add).
    if (item.parent?.id === this.document.id) return;
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
    await this.document.update({ "system.occupants": next });
  }

  async _onOpenItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    this.document.items.get(id)?.sheet?.render(true);
  }

  async _onDeleteItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if (id) await this.document.deleteEmbeddedDocuments("Item", [id]);
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
