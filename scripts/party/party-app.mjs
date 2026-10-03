import { MODULE_ID } from "../shared/module-id.mjs";
import { CampingApp } from "../camping/camping-app.mjs";
import { CarousingApp } from "../carousing/carousing-app.mjs";
import { Party, isNativeParty, isLegacyParty } from "./party.mjs";
import { offerParty } from "./party-create-option.mjs";
import { scopedQuests } from "./party-core.mjs";
import { fillFormation } from "./party-movement-core.mjs";
import { configureMovement, requestMovement, movementStatus, inPartyCombat, MOVEMENT_CHANGED } from "./party-movement.mjs";
import { Quests, QUESTS_CHANGED } from "../quests/quests.mjs";
import { QuestLogApp } from "../quests/quest-log-app.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";


const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const t = (key) => game.i18n.localize(key);
const LABELS = { members: "SDE.party.members", quests: "SDE.party.quests", items: "SDE.party.sheet.inventory", travel: "SDE.party.sheet.travel", description: "SDE.party.sheet.description",
  characters: "SDE.party.characters", hirelings: "SDE.party.hirelings", mounts: "SDE.party.mounts", missing: "SDE.party.missing" };
const TAB_ICONS = { members: "fas fa-users", items: "fas fa-box", travel: "fas fa-campground", quests: "fas fa-scroll", description: "fas fa-book-open" };
/** Movement pause reasons name their message with literal keys; a lookup table hides them from the i18n scan. */
function movementMessage(reason) {
  switch (reason) {
    case "noToken": return t("SDE.party.movement.noToken");
    case "free": return t("SDE.party.movement.free");
    case "combat": return t("SDE.party.movement.combat");
    case "scene": return t("SDE.party.movement.scene");
    case "reload": return t("SDE.party.movement.reload");
    case "gathered": return t("SDE.party.movement.gathered");
    case "leader": return t("SDE.party.movement.leader");
    case "teleport": return t("SDE.party.movement.teleport");
    case "missing": return t("SDE.party.movement.missing");
    case "blocked": return t("SDE.party.movement.blocked");
    default: return t("SDE.party.movement.unknown");
  }
}
// Localized coin labels come from the system's own keys; the sheet draws literal text otherwise.
const COIN_LABELS = { gp: "SHADOWDARK.coins.gp", sp: "SHADOWDARK.coins.sp", cp: "SHADOWDARK.coins.cp" };

export class PartyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["shadowdark", "sheet", "party", "sde-party"], window: { title: "SDE.party.title", icon: "fa-solid fa-users", resizable: true },
    position: { width: 750, height: 650 },
    actions: {
      partyTab: function (_event, el) { this.tab = el.dataset.tab; this.render(); },
      remove: function (_event, el) { return this._change(() => Party.remove(this.actor, el.dataset.uuid)); },
      member: function (_event, el) { Party.rows(this.actor).find((r) => r.uuid === el.dataset.uuid)?.actor?.sheet?.render(true); },
      item: function (_event, el) { if (this.actor?.testUserPermission(game.user, "OBSERVER")) this.actor.items.get(el.dataset.id)?.sheet?.render(true); },
      activityAction: function (event, el) { const app = this._activityController(); return app.constructor.DEFAULT_OPTIONS.actions[el.dataset.activityAction]?.call(app, event, el); },
      questAction: function (event, el) { const app = this._questController(); return QuestLogApp.DEFAULT_OPTIONS.actions[el.dataset.questAction]?.call(app, event, el); },
      create: async function () { this.actor = await Party.create(); Party.select(this.actor); this.render(); },
      adopt: function () { return this._change(() => Party.adopt(this.actor)); },
      leader: function (_event, el) { return this._change(() => configureMovement(this.actor, { leaderUuid: el.dataset.uuid })); },
      placeRecall: function () { return this._change(() => requestMovement(this.actor, "toggle")); },
      resumeFollow: function () { return this._change(() => requestMovement(this.actor, "resume")); },
      camp: function () { this.activity = "camping"; this.tab = "travel"; this.render(); },
      carouse: function () { this.activity = "carousing"; this.tab = "travel"; this.render(); },
      createItem: function () { return this._change(() => this.actor?.isOwner && this.actor.createEmbeddedDocuments("Item", [{ name: t("SDE.party.sheet.newItem"), type: "Basic", img: "icons/svg/item-bag.svg" }])); },
      quantity: function (_event, el) { return this._change(async () => { const item = this.actor?.items.get(el.dataset.id); if (!this.actor?.isOwner || !item) return; await item.update({ "system.quantity": Math.max(0, Number(item.system.quantity ?? 1) + Number(el.dataset.delta)) }); }); },
      editDescription: function () { if (this.actor?.isOwner) { this.editingDescription = true; this.render(); } },
      cancelDescription: function () { this.editingDescription = false; this.render(); },
      saveDescription: function () { if (!this.actor?.isOwner) return; const content = this.element.querySelector("[data-party-description]")?.value; if (typeof content !== "string") return; return this._change(async () => { await replaceModuleFlag(this.actor, "partyDescription", content); this.editingDescription = false; }); },
    },
  };
  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/party/party.hbs`, scrollable: [".SD-content-body"] } };
  tab = "members";
  activity = "camping";
  constructor(actor = null, options = {}) { super(options); this.actor = actor; }
  // Resolves once the window exists: render() is async and bringToFront() needs the element.
  static async open(ref = null, activity = null) {
    const actor = ref ? Party.get(ref) : Party.selected();
    if (actor && !Party.list().includes(actor)) return null;
    if (actor) Party.select(actor);
    if (isNativeParty(actor) && actor.sheet instanceof PartySheet) { const app = actor.sheet; if (activity) { app.activity = activity; app.tab = "travel"; } await app.render(true); app.bringToFront(); return app; }
    // The picker and Create retarget this window; its identity must not retain
    // the first Party's id. Explicit actor/token opens always retarget it too.
    const id = "sde-party";
    const existing = foundry.applications.instances?.get(id);
    if (existing) { existing.actor = actor; if (activity) { existing.activity = activity; existing.tab = "travel"; } await existing.render(true); existing.bringToFront(); return existing; }
    const app = new PartyApp(actor, { id }); if (activity) { app.activity = activity; app.tab = "travel"; } await app.render(true); return app;
  }
  _quests() { return scopedQuests(Quests.list(), this.actor.uuid, Party.members(this.actor)); }
  _activityController() {
    const Class = this.activity === "carousing" ? CarousingApp : CampingApp;
    if (this._activity?.party !== this.actor || !(this._activity instanceof Class)) this._activity = new Class(this.actor, {}, this);
    return this._activity;
  }
  _questController() {
    if (this._questLog?.partyScope !== this.actor.uuid) {
      this._questLog = new QuestLogApp({}, this);
      this._questLog.partyScope = this.actor.uuid;
    }
    return this._questLog;
  }
  async _change(write) {
    try { await write(); this.render(); }
    catch (error) { console.error(`${MODULE_ID} | Party write`, error); ui.notifications.warn(t(error.message.startsWith("SDE.") ? error.message : "SDE.party.unknownRoster")); }
  }
  async _prepareContext() {
    const parties = Party.list().map((a) => ({ uuid: a.uuid, name: a.name, selected: a === this.actor }));
    const base = { parties, isGM: !!game.user?.isGM, hasParty: !!this.actor, title: this.actor?.name,
      tabs: ["members", "items", "travel", "quests", "description"].map((key) => ({ key, label: t(LABELS[key]), icon: TAB_ICONS[key], active: this.tab === key })),
      membersTab: this.tab === "members", questsTab: this.tab === "quests", itemsTab: this.tab === "items", travelTab: this.tab === "travel", descriptionTab: this.tab === "description", picker: !this.document };
    if (!this.actor) return base;
    if (!Party.list().includes(this.actor)) return { ...base, hasParty: false };
    if (this.actor.type === "Party") return { ...base, unsupported: true };
    try {
      const data = Party.data(this.actor), rows = Party.rows(this.actor), canEdit = Party.canManage(this.actor);
      const members = await Promise.all(rows.map(async (row) => {
        const a = row.actor, sys = a?.system ?? {}, hp = sys.attributes?.hp ?? { value: 0, max: 0 };
        let className = "";
        if (sys.class && globalThis.fromUuid) { try { className = (await fromUuid(sys.class))?.name ?? ""; } catch { /* An unresolved class must not hide the member. */ } }
        const items = a?.items?.contents ?? [], percent = Math.max(0, Math.min(100, Math.round(hp.value / (hp.max || 1) * 100)));
        return { ...row, memberKey: row.uuid, name: a?.name ?? t("SDE.party.missing"), img: a?.img ?? "icons/svg/mystery-man.svg", missing: !a, canEdit, isNPC: !!a?.system?.isNPC, className,
          hp: { value: hp.value ?? 0, max: hp.max ?? 0 }, ac: sys.attributes?.ac?.value ?? 0, level: sys.level?.value ?? 1,
          xp: { current: sys.level?.xp ?? 0, next: (sys.level?.value ?? 1) * 10 }, hpPercent: percent, hpWavesEnabled: true, hpWaveTranslate: Math.max(0, percent - 15), hpWaveColor: "#dc2626", hpWaveClass: percent >= 100 ? "hp-full" : percent <= 0 ? "hp-dead" : "",
          slots: { used: inventorySlots(items, sys.coins), max: sys.slots ?? 10 }, abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(key => [key, sys.abilities?.[key]?.mod ?? 0])),
          abilityLabels: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(key => { const mod = sys.abilities?.[key]?.mod ?? 0; return [key, mod >= 0 ? `+${mod}` : String(mod)]; })),
          effects: (a?.effects?.contents ?? a?.effects ?? []).filter(e => !e.disabled).map(e => ({ name: e.name, img: e.img ?? "icons/svg/aura.svg" })), leader: row.uuid === data.leaderUuid };
      }));
      const visible = members.filter(m => !m.missing), players = members.filter(m => m.group === "characters");
      const coins = this.actor.flags?.[MODULE_ID]?.partyCoins ?? this.actor.flags?.["shadowdark-extras"]?.coins ?? { gp: 0, sp: 0, cp: 0 };
      const coinLabels = Object.fromEntries(Object.keys(coins ?? {}).map(key => [key, COIN_LABELS[key] ?? key]));
      const description = this.actor.flags?.[MODULE_ID]?.partyDescription ?? this.actor.flags?.["shadowdark-extras"]?.description ?? "";
      const editor = globalThis.foundry?.applications?.ux?.TextEditor?.implementation;
      const descriptionHTML = editor ? await editor.enrichHTML(description, { secrets: !!this.actor.isOwner, async: true, relativeTo: this.actor }) : "";
      let activityHTML = "", questHTML = "";
      const renderTemplate = foundry.applications.handlebars?.renderTemplate;
      if (this.tab === "travel" && renderTemplate) {
        const app = this._activityController();
        activityHTML = (await renderTemplate(app.constructor.PARTS.body.template, await app._prepareContext())).replace(/data-action="([^"]+)"/g, 'data-action="activityAction" data-activity-action="$1"');
      }
      if (this.tab === "quests" && renderTemplate) {
        const app = this._questController();
        questHTML = (await renderTemplate(QuestLogApp.PARTS.body.template, await app._prepareContext())).replace(/data-action="([^"]+)"/g, 'data-action="questAction" data-quest-action="$1"');
      }
      const formation = fillFormation(data, rows), status = movementStatus(this.actor);
      const reason = !status.token ? t("SDE.party.movement.noToken") : status.reason ? movementMessage(status.reason) : t("SDE.party.movement.marching");
      const slots = [];
      for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) {
        const uuid = formation.slots.find(s => s.row === row && s.col === col)?.memberUuid;
        const member = rows.find(r => r.uuid === uuid)?.actor;
        slots.push({ row, col, uuid, name: member?.name, img: member?.img, leader: uuid === data.leaderUuid, disabled: !canEdit || !member });
      }
      return { ...base, actor: this.actor, canEdit, owner: canEdit, players, members, memberCount: visible.length, coins, coinLabels, descriptionHTML, description, editingDescription: !!this.editingDescription,
        activityHTML, questHTML, campingActive: this.activity !== "carousing", carousingActive: this.activity === "carousing",
        inventorySlots: { used: inventorySlots(this.actor.items.contents, coins), max: this.actor.flags?.["shadowdark-extras"]?.partyMaxSlots ?? 10 },
        partyStats: { totalHp: visible.reduce((n,m) => n + m.hp.value, 0), maxHp: visible.reduce((n,m) => n + m.hp.max, 0), avgAc: visible.length ? Math.round(visible.reduce((n,m) => n + m.ac, 0) / visible.length) : 0, avgLevel: players.length ? Math.round(players.reduce((n,m) => n + m.level, 0) / players.length) : 0 },
        needsAdoption: canEdit && !this.actor.flags?.[MODULE_ID]?.partyData,
        slots, followLeader: data.followLeader, formationReview: formation.needsReview,
        leaderName: rows.find(r => r.uuid === data.leaderUuid)?.actor?.name ?? t("SDE.party.missing"),
        hasLeader: !!data.leaderUuid && !!rows.find(r => r.uuid === data.leaderUuid)?.actor,
        followStatus: status.pausedMemberUuid && ["blocked", "missing"].includes(status.reason)
          ? game.i18n.format("SDE.party.movement.pausedMember", { status: reason, name: rows.find(r => r.uuid === status.pausedMemberUuid)?.actor?.name ?? t("SDE.party.missing") }) : reason,
        canResume: canEdit && data.followLeader && status.deployed && !!status.reason && !inPartyCombat(globalThis.canvas?.scene),
        movementDisabled: !canEdit || !status.token || inPartyCombat(globalThis.canvas?.scene),
        movementReason: !status.token ? t("SDE.party.movement.noToken") : inPartyCombat(globalThis.canvas?.scene) ? t("SDE.party.movement.combat") : t("SDE.party.movement.importExport"),
        groups: ["characters", "hirelings", "mounts", "missing"].map((key) => ({ label: t(LABELS[key]), rows: members.filter(r => r.group === key) })),

        quests: this._quests(), items: this.actor.items.contents.map((i) => ({ id: i.id, name: i.name, img: i.img, quantity: i.system?.quantity ?? 1, slots: inventorySlots([i]) })) };
    } catch (error) { console.error(`${MODULE_ID} | Party roster read`, error); return { ...base, unknown: true }; }
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this._bindControls();
  }
  _bindControls() {
    const activityRoot = this.element.querySelector(".sde-camping-body, .sde-carousing-body");
    if (activityRoot) this._activityController().bindControls(activityRoot);
    const questRoot = this.element.querySelector(".sde-quest-log-root");
    if (questRoot) this._questController().bindControls(questRoot, { isGM: !!game.user?.isGM, quest: !!this._questLog.selectedId });
    for (const control of this.element.querySelectorAll("a[data-action]")) {
      control.setAttribute("role", "button"); control.tabIndex = 0;
      control.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); control.click(); } });
    }
    this.element.querySelector('[name="name"]')?.addEventListener("change", event => { if (this.actor?.isOwner) void this._change(() => this.actor.update({ name: event.target.value })); });
    for (const input of this.element.querySelectorAll("[data-coin]")) input.addEventListener("change", () => {
      if (!this.actor?.isOwner) return;
      const coins = this.actor.flags?.[MODULE_ID]?.partyCoins ?? this.actor.flags?.["shadowdark-extras"]?.coins ?? {};
      void this._change(() => replaceModuleFlag(this.actor, "partyCoins", { ...coins, [input.dataset.coin]: Math.max(0, Math.trunc(Number(input.value) || 0)) }));
    });
    this.element.querySelector(".tab-members")?.addEventListener("dragover", event => { if (Party.canManage(this.actor)) event.preventDefault(); });
    this.element.querySelector(".tab-members")?.addEventListener("drop", event => {
      event.preventDefault();
      try { const data = JSON.parse(event.dataTransfer.getData("text/plain")); if (data.type === "Actor" && data.uuid) void this._change(() => Party.add(this.actor, data.uuid)); } catch { /* Ignore non-document drags. */ }
    });
    this.element.querySelector("[data-party-choice]")?.addEventListener("change", (event) => { this.actor = Party.get(event.target.value); Party.select(this.actor); this.render(); });
    this.element.querySelector('[data-movement-setting="followLeader"]')?.addEventListener("change", event => this._change(() => configureMovement(this.actor, { followLeader: event.target.checked })));
    for (const slot of this.element.querySelectorAll("[data-formation-slot]")) {
      slot.addEventListener("dragstart", event => { if (!Party.canManage(this.actor) || !slot.dataset.uuid) return event.preventDefault(); event.dataTransfer.setData("text/plain", slot.dataset.uuid); });
      slot.addEventListener("dragover", event => { if (Party.canManage(this.actor)) event.preventDefault(); });
      slot.addEventListener("drop", event => {
        event.preventDefault();
        const uuid = event.dataTransfer.getData("text/plain");
        if (!Party.canManage(this.actor)) return;
        const saved = fillFormation(Party.data(this.actor), Party.rows(this.actor));
        // A retained oversized formation is unusable; a drop rebuilds it from its valid slots.
        const formation = saved.needsReview ? fillFormation({ formation: { slots: saved.slots.filter(s => [-1, 0, 1].includes(s.col) && [-1, 0, 1].includes(s.row)) } }, Party.rows(this.actor)) : saved;
        const source = formation.slots.find(s => s.memberUuid === uuid);
        if (!source) return;
        const target = formation.slots.find(s => s.row === Number(slot.dataset.row) && s.col === Number(slot.dataset.col));
        const slots = formation.slots.map(s => s === source ? { ...s, col: Number(slot.dataset.col), row: Number(slot.dataset.row) } : s === target ? { ...s, col: source.col, row: source.row } : s);
        void this._change(() => configureMovement(this.actor, { formation: { slots } }));
      });
    }
  }
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._hooks = ["updateActor", "deleteActor", "createActor", "createItem", "updateItem", "deleteItem", "updateRollTable", "createCombat", "updateCombat", "deleteCombat", "canvasReady", MOVEMENT_CHANGED, QUESTS_CHANGED].map((name) => [name, Hooks.on(name, () => this._onStateChanged())]);
  }
  _onStateChanged() {
    const field = globalThis.document?.activeElement;
    if (!field || !this.element?.contains(field) || !field.matches("textarea, input[type='text'], input[type='number']")) return this.render();
    if (this._heldFor === field) return;
    this._heldFor = field;
    field.addEventListener("blur", event => { this._heldFor = null; if (!event.relatedTarget?.closest("[data-action]")) this.render(); }, { once: true });
  }
  _onClose(options) { for (const [name, id] of this._hooks ?? []) Hooks.off(name, id); return super._onClose(options); }
}

// The SDX inventory slot calculation, independent of its runtime module.
function inventorySlots(items, coins = {}) {
  const seen = new Map();
  return items.reduce((sum, item) => {
    const s = item.system ?? {};
    if (!s.isPhysical || s.stashed || item.type === "Gem") return sum;
    const free = Math.max(0, Number(s.slots?.free_carry ?? 0) - (seen.get(item.name) ?? 0));
    seen.set(item.name, (seen.get(item.name) ?? 0) + free);
    return sum + (Math.ceil(Number(s.quantity ?? 1) / (Number(s.slots?.per_slot) || 1)) - free) * Number(s.slots?.slots_used ?? 0);
  }, Math.floor(["gp", "sp", "cp"].reduce((n, key) => n + Math.max(0, Number(coins?.[key]) || 0), 0) / 100));
}

/** A real ActorSheetV2 for normal Actor-directory and token double-clicks. */
export class PartySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = { ...PartyApp.DEFAULT_OPTIONS, window: { icon: "fa-solid fa-users", resizable: true } };
  static PARTS = PartyApp.PARTS;
  tab = "members";
  activity = "camping";
  get title() { return this.actor.name; }
  _onRender(context, options) { super._onRender(context, options); this._bindControls(); }
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._hooks = ["updateActor", "deleteActor", "createItem", "updateItem", "deleteItem", "updateRollTable", "createCombat", "updateCombat", "deleteCombat", "canvasReady", MOVEMENT_CHANGED, QUESTS_CHANGED].map(name => [name, Hooks.on(name, () => this._onStateChanged())]);
  }
  _onClose(options) { for (const [name, id] of this._hooks ?? []) Hooks.off(name, id); return super._onClose(options); }
}
for (const name of ["_prepareContext", "_change", "_quests", "_bindControls", "_activityController", "_questController", "_onStateChanged"]) PartySheet.prototype[name] = PartyApp.prototype[name];

/** Only native/adopted flagged Parties route here; ordinary NPC sheets stay intact. */
export function registerParty() {
  const ActorClass = globalThis.CONFIG?.Actor?.documentClass;
  if (ActorClass) {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(ActorClass, MODULE_ID, PartySheet, { types: ["NPC"], makeDefault: false, label: "SDE.party.title" });
    const original = ActorClass.prototype._getSheetClass;
    ActorClass.prototype._getSheetClass = function () { return isNativeParty(this) ? PartySheet : original.call(this); };
    const create = ActorClass.create;
    ActorClass.create = function (data, options) {
      const convert = value => value.type !== "sde-party" ? value : { ...value, type: "NPC", img: value.img || "icons/environment/people/group.webp", flags: { ...value.flags, [MODULE_ID]: { ...value.flags?.[MODULE_ID], party: true } }, prototypeToken: { ...value.prototypeToken, actorLink: true } };
      return create.call(this, Array.isArray(data) ? data.map(convert) : convert(data), options);
    };
    Hooks.on("renderDialogV2", (_app, html) => offerParty(html.querySelector?.('select[name="type"]'), t("SDE.party.title")));
  }
  Hooks.on("getActorContextOptions", (directory, entries) => {
    const actorOf = (el) => directory.collection.get(el.closest("[data-entry-id]")?.dataset.entryId);
    entries.push({ label: "SDE.party.open", icon: "fa-solid fa-users",
      visible: (el) => Party.list().includes(actorOf(el)), onClick: (_event, el) => PartyApp.open(actorOf(el)) });
  });
  Hooks.on("renderTokenHUD", (app, html) => {
    const actor = app.object?.actor;
    if (!(isNativeParty(actor) || isLegacyParty(actor)) || !Party.list().includes(actor)) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".sde-party-launch")) return;
    const button = document.createElement("button"); button.type = "button"; button.className = "control-icon sde-party-launch";
    button.title = t("SDE.party.open"); button.setAttribute("aria-label", t("SDE.party.open")); button.innerHTML = '<i class="fa-solid fa-users" inert></i>';
    button.addEventListener("click", () => PartyApp.open(actor)); root.querySelector(".col.right")?.append(button);
  });
  // Actor sidebar remains available when core.noCanvas is enabled.
  Hooks.on("renderActorDirectory", (_app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".sde-party-launch")) return;
    const button = document.createElement("button"); button.type = "button"; button.className = "sde-party-launch"; button.textContent = t("SDE.party.open");
    button.addEventListener("click", () => PartyApp.open()); (root.querySelector(".directory-footer") ?? root).append(button);
  });
}
