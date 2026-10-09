import { MODULE_ID } from "../shared/module-id.mjs";
import { CampingApp } from "../camping/camping-app.mjs";
import { CarousingApp } from "../carousing/carousing-app.mjs";
import { Party, isNativeParty, isLegacyParty, registerPartyRosterGuard } from "./party.mjs";
import { offerParty } from "./party-create-option.mjs";
import { scopedQuests } from "./party-core.mjs";
import { fillFormation } from "./party-movement-core.mjs";
import { marchState, marchText, partyTabs, tabRow, resolveTab, sheetView, gemSummary, linkedBastion, lastMonthEntry, roomIcon, lightReadout, rationsCount, torchCount, carriesLight, luckCount, statusBar, COIN_REFUSALS, coinsOf, coinText, poolAfterAdd, planGive, planDivide, purseAfter, spellTiers, whoSelection, whoAfter, ROLL_STATS, ROLL_STAT_LABELS, DEFAULT_DC, defaultSource, downtimeSummary, warbandGroups } from "./party-sheet-core.mjs";
import { EMBLEM_FLAG, emblemOf, emblemIconPath, emblemChoices, pickEmblem } from "./party-emblem-core.mjs";
import { BASTION_TYPE } from "../bastion/bastion-art.mjs";
import { stateOf as bastionState, stats as bastionStats, upgradeOf, GRANARY_SAVING_GP } from "../bastion/bastion-core.mjs";
import { logText as bastionLogText } from "../bastion/bastion-text.mjs";
import { configureMovement, requestMovement, movementStatus, inPartyCombat, MOVEMENT_CHANGED } from "./party-movement.mjs";
import { Quests, QUESTS_CHANGED } from "../quests/quests.mjs";
import { QuestLogApp } from "../quests/quest-log-app.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { PartyItemPicker } from "./party-item-picker.mjs";
import { postRollRequest } from "./party-roll.mjs";
import { upkeepGp } from "../actors/warband-core.mjs";
/** A module path as an absolute route: a CSS mask url() resolves against the stylesheet, so a relative path points inside styles/. */
const routeOf = (path) => foundry.utils?.getRoute?.(path) ?? `/${path}`;


const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const t = (key) => game.i18n.localize(key);
const sayWith = (key, data) => game.i18n.format(key, data);
const I18N = { say: t, sayWith };
const LABELS = { characters: "SDE.party.characters", hirelings: "SDE.party.hirelings", mounts: "SDE.party.mounts", missing: "SDE.party.missing" };
/** What the Bastion tab shows of a bastion actor: its numbers, rooms and last month's result. */
function bastionCard(actor) {
  const state = bastionState(actor), st = bastionStats(state), last = lastMonthEntry(state.log);
  return { name: actor.name, img: actor.img, type: t(st.type.name), ac: st.ac, hp: st.hp, maxHp: st.maxHp, breached: st.breached, used: st.used, slots: st.slots, treasury: state.treasury,
    standing: st.standing, building: game.i18n.format("SDE.bastion.building", { weeks: state.weeksLeft }),
    rooms: state.upgrades.filter((u) => upgradeOf(u.id)).map((u) => ({ name: t(upgradeOf(u.id).name), icon: roomIcon(u.id), building: u.weeksLeft > 0, tip: u.weeksLeft > 0 ? game.i18n.format("SDE.bastion.weeksLeft", { weeks: u.weeksLeft }) : "" })),
    lastMonth: last ? bastionLogText(last) : "" };
}
/** The Warband actor sub-type (register-actors.mjs WARBAND_TYPE, written out here so this sheet need not load the actor registry). */
const WARBAND_TYPE = `${MODULE_ID}.warband`;
/** The Downtime window's change hook (downtime-session.mjs HOOK_CHANGED), named here so the sheet need not load the session to listen. */
const DOWNTIME_CHANGED = "sde.downtimeSessionChanged";
// Localized coin labels come from the system's own keys; the sheet draws literal text otherwise.
const COIN_LABELS = { gp: "SHADOWDARK.coins.gp", sp: "SHADOWDARK.coins.sp", cp: "SHADOWDARK.coins.cp" };

export class PartyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["shadowdark", "sheet", "party", "sde-party", "sde-ui"], window: { title: "SDE.party.title", icon: "fa-solid fa-users", resizable: true },
    position: { width: 750, height: 650 },
    actions: {
      partyTab: function (_event, el) { this.tab = el.dataset.tab; this.emblemOpen = false; this.render(); },
      emblem: function () { if (!sheetView({ isGM: !!game.user?.isGM, canEdit: Party.canManage(this.actor) }).emblemEdit) return; this.emblemOpen = !this.emblemOpen; this.render(); },
      pickEmblem: function (_event, el) { return this._pickEmblem({ icon: el.dataset.icon, color: el.dataset.color, iconColor: el.dataset.iconColor }); },
      remove: function (_event, el) { return this._change(() => Party.remove(this.actor, el.dataset.uuid)); },
      member: function (_event, el) { Party.rows(this.actor).find((r) => r.uuid === el.dataset.uuid)?.actor?.sheet?.render(true); },
      spendLuck: function (_event, el) { return this._memberCrawl(el, (strip, actor) => strip.spendLuck(actor)); },
      toggleLight: function (_event, el) { return this._memberCrawl(el, (strip, actor) => strip.toggleActorLight(actor)); },
      item: function (_event, el) { if (this.actor?.testUserPermission(game.user, "OBSERVER")) this.actor.items.get(el.dataset.id)?.sheet?.render(true); },
      activityAction: function (event, el) { const app = this._activityController(); return app.constructor.DEFAULT_OPTIONS.actions[el.dataset.activityAction]?.call(app, event, el); },
      questAction: function (event, el) { const app = this._questController(); return QuestLogApp.DEFAULT_OPTIONS.actions[el.dataset.questAction]?.call(app, event, el); },
      create: async function () { this.actor = await Party.create(); Party.select(this.actor); this.render(); },
      adopt: function () { return this._change(() => Party.adopt(this.actor)); },
      leader: function (_event, el) { return this._change(() => configureMovement(this.actor, { leaderUuid: el.dataset.uuid })); },
      placeRecall: function () { return this._change(() => requestMovement(this.actor, "toggle")); },
      camp: function () { this.activity = "camping"; this.tab = "travel"; this.render(); },
      carouse: function () { this.activity = "carousing"; this.tab = "travel"; this.render(); },
      openBastion: function () { this._bastion()?.sheet?.render(true); },
      addCoins: function () { return this._change(() => this._addCoins(this._coinInputs("[data-add-coin]", "addCoin"))); },
      giveCoins: function () { return this._change(() => this._giveCoins(this._coinInputs("[data-give-coin]", "giveCoin"), this.element.querySelector("[data-give-to]")?.value)); },
      divideCoins: function () { return this._change(() => this._divideCoins()); },
      giveItem: function (_event, el) { return this._change(() => this._giveItem(el.dataset.id, el.dataset.uuid)); },
      deleteItem: function (_event, el) { return this._change(() => this._deleteItem(el.dataset.id)); },
      addItemForge: async function () {
        if (!game.user?.isGM || !this.actor?.isOwner) return;
        this.openKeys.delete("addItem"); this.render();
        const { MagicForgeApp } = await import("../magic-forge/magic-forge-app.mjs");
        MagicForgeApp.open({ seed: null, onCreate: (forged) => this._change(() => this._addItemFrom(forged)) });
      },
      addItemCompendium: function () {
        if (!game.user?.isGM || !this.actor?.isOwner) return;
        this.openKeys.delete("addItem"); this.render();
        PartyItemPicker.open({ onPick: (entry) => this._change(async () => this._addItemFrom(await fromUuid(entry.uuid))) });
      },
      // Downtime tab. The GM's session controls are the Downtime window's own handlers, run for this sheet.
      openDowntime: async function () { const { DowntimeApp } = await import("../downtime/downtime-app.mjs"); DowntimeApp.open(); },
      startSession: function () { return this._startDowntime(); },
      lockRolls: function () { return this._downtimeCall("_onLockRolls"); },
      releaseRolls: function () { return this._downtimeCall("_onReleaseRolls"); },
      endSession: function () { return this._downtimeCall("_onEndSession"); },
      gmClearPick: function (_event, el) { return this._downtimeCall("_onGmClearPick", el); },
      gmRollFor: function (_event, el) { return this._downtimeCall("_onGmRollFor", el); },
      // Warbands tab: the sheet's Upkeep controls, sent to the active GM's warband writer like the Warband sheet's own.
      warband: async function (_event, el) { const wb = await fromUuid(el.dataset.uuid); if (wb?.testUserPermission?.(game.user, "OBSERVER")) wb.sheet?.render(true); },
      runMonth: function () { return this._warbandWrite({ action: "runMonth", actorId: this.actor.id }); },
      payArrears: function (_event, el) { return this._warbandWrite({ action: "payArrears", actorId: el.dataset.uuid?.split(".").at(-1) }); },
      returnToService: function (_event, el) { return this._warbandWrite({ action: "returnToService", actorId: el.dataset.uuid?.split(".").at(-1) }); },
      requestRoll: function () { return this._requestRoll(); },
      awardParty: function () { return this._awardParty(); },
      quantity: function (_event, el) { return this._change(async () => { const item = this.actor?.items.get(el.dataset.id); if (!this.actor?.isOwner || !item) return; await item.update({ "system.quantity": Math.max(0, Number(item.system.quantity ?? 1) + Number(el.dataset.delta)) }); }); },
      editDescription: function () { if (this.actor?.isOwner) { this.editingDescription = true; this.render(); } },
      cancelDescription: function () { this.editingDescription = false; this.render(); },
      saveDescription: function () { if (!this.actor?.isOwner) return; const content = this.element.querySelector("[data-party-description]")?.value; if (typeof content !== "string") return; return this._change(async () => { await replaceModuleFlag(this.actor, "partyDescription", content); this.editingDescription = false; }); },
    },
  };
  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/party/party.hbs`, scrollable: [".SD-content-body"] } };
  tab = "members";
  activity = "camping";
  /** The menus and forms the GM has open (Add item, Add coins, Give coins, a row's Give to): they survive a re-render. */
  openKeys = new Set();
  constructor(actor = null, options = {}) { super(options); this.actor = actor; }
  // Resolves once the window exists: render() is async and bringToFront() needs the element.
  /** A member card's Luck or Light mark: the crawl strip's own control, for the character's owner or a GM. */
  async _memberCrawl(el, run) {
    const row = Party.rows(this.actor).find((r) => r.uuid === el.dataset.actorId), actor = row?.actor;
    if (!actor) return;
    if (!(game.user?.isGM || actor.isOwner)) return void ui.notifications?.warn(game.i18n.localize("SDE.party.sheet.notOwner"));
    const { CrawlStrip } = await import("../crawl-strip/crawl-strip.mjs");
    await run(CrawlStrip, actor);
    this.render();
  }

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
  /** The Bastion actor linked to this party that the viewer may see (a GM sees any), or null. */
  _bastion() {
    const canSee = (a) => game.user?.isGM || !!a.testUserPermission?.(game.user, "OBSERVER");
    return linkedBastion(this.actor?.uuid, (game.actors?.contents ?? []).filter((a) => a.type === BASTION_TYPE && !a.pack), canSee);
  }
  /**
   * Today's overland readout while THIS party is the one travelling: terrain, weather and hexes left.
   * Imported when asked: the overland module needs the whole game, and a world with no travel has none to show.
   */
  async _travel() {
    if (!game.shadowdarkEnhancer) return null;
    try {
      const [{ CrawlState }, overland] = await Promise.all([import("../crawl-strip/crawl-state.mjs"), import("../overland/overland.mjs")]);
      if (!CrawlState.isOverland) return null;
      const state = overland.overlandState();
      if (!state.tokenUuid || globalThis.fromUuidSync?.(state.tokenUuid)?.actor?.uuid !== this.actor.uuid) return null;
      const kind = overland.weatherNow();
      return { terrain: state.hex?.terrain ?? null, weather: kind ? overland.weatherName(kind) : null, hexesLeft: state.hexesLeft, budget: state.budget };
    } catch (error) { console.debug(`${MODULE_ID} | Party travel readout`, error); return null; }
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
  /** The party's own coins, read fresh from the document (the older Shadowdark Extras flag until the party has its own). */
  _pool() { return coinsOf(this.actor.flags?.[MODULE_ID]?.partyCoins ?? this.actor.flags?.["shadowdark-extras"]?.coins); }
  /** The numbers typed into one coin form, by type. */
  _coinInputs(selector, key) { return Object.fromEntries([...this.element.querySelectorAll(selector)].map((input) => [input.dataset[key], Number(input.value)])); }
  /** The party's player characters (PCs only: hirelings, mounts and unseen members never get coins). */
  _pcs() { return Party.rows(this.actor).filter((row) => row.group === "characters" && row.actor); }
  /** A refused coin move: say why, change nothing. */
  _refuse(reason) { ui.notifications.warn(t(COIN_REFUSALS[reason])); }
  /**
   * Write the pool and the purses of one coin move. The pool is debited first; a purse that cannot be written
   * puts back the ones already paid and the pool, so coins are never made or lost halfway.
   */
  async _settle(plan, before) {
    const paid = [];
    await replaceModuleFlag(this.actor, "partyCoins", plan.pool);
    try {
      for (const grant of plan.grants) {
        const actor = this._pcs().find((row) => row.actor.id === grant.id)?.actor, purse = coinsOf(actor?.system?.coins);
        await actor.update(Object.fromEntries(Object.entries(purseAfter(purse, grant.coins)).map(([key, value]) => [`system.coins.${key}`, value])));
        paid.push({ actor, purse });
      }
    } catch (error) {
      for (const { actor, purse } of paid) await actor.update(Object.fromEntries(Object.entries(purse).map(([key, value]) => [`system.coins.${key}`, value])));
      await replaceModuleFlag(this.actor, "partyCoins", before);
      throw error;
    }
  }
  _coinLabel(key) { return t({ gp: "SHADOWDARK.coins.gp", sp: "SHADOWDARK.coins.sp", cp: "SHADOWDARK.coins.cp" }[key]); }
  async _addCoins(delta) {
    if (!game.user?.isGM || !this.actor?.isOwner) return;
    const before = this._pool(), next = poolAfterAdd(before, delta);
    await replaceModuleFlag(this.actor, "partyCoins", next);
    this.openKeys.delete("addCoins");
    ui.notifications.info(sayWith("SDE.party.coins.addedNote", { coins: coinText(Object.fromEntries(Object.keys(next).map((key) => [key, next[key] - before[key]])), (key) => this._coinLabel(key)) || "0" }));
  }
  async _giveCoins(amount, to) {
    if (!game.user?.isGM || !this.actor?.isOwner) return;
    const pcs = this._pcs().filter((row) => !to || row.uuid === to), before = this._pool();
    const plan = planGive(before, amount, pcs.map((row) => row.actor.id));
    if (!plan.ok) return this._refuse(plan.reason);
    await this._settle(plan, before);
    this.openKeys.delete("giveCoins");
    ui.notifications.info(sayWith("SDE.party.coins.gaveNote", { coins: coinText(plan.grants[0].coins, (key) => this._coinLabel(key)), names: pcs.map((row) => row.actor.name).join(", ") }));
  }
  async _divideCoins() {
    if (!game.user?.isGM || !this.actor?.isOwner) return;
    const pcs = this._pcs(), before = this._pool(), plan = planDivide(before, pcs.map((row) => row.actor.id));
    if (!plan.ok) return this._refuse(plan.reason);
    await this._settle(plan, before);
    ui.notifications.info(sayWith("SDE.party.coins.dividedNote", { coins: coinText(plan.share, (key) => this._coinLabel(key)), count: pcs.length, rest: coinText(plan.pool, (key) => this._coinLabel(key)) || t("SDE.party.coins.restNone") }));
  }
  /** Copy an Item document (a forged item, a compendium entry) onto the party actor. */
  async _addItemFrom(item) {
    if (!game.user?.isGM || !this.actor?.isOwner || !item) return;
    const data = item.toObject(); delete data._id;
    await this.actor.createEmbeddedDocuments("Item", [data]);
    ui.notifications.info(sayWith("SDE.party.item.added", { item: item.name }));
  }
  /** Move a party item, its whole stack, to one of the party's characters. */
  async _giveItem(id, uuid) {
    if (!game.user?.isGM || !this.actor?.isOwner) return;
    const item = this.actor.items.get(id), target = this._pcs().find((row) => row.uuid === uuid)?.actor;
    this.openKeys.delete(`give:${id}`);
    if (!item || !target) return;
    const data = item.toObject(); delete data._id;
    await target.createEmbeddedDocuments("Item", [data]);
    await item.delete();
    ui.notifications.info(sayWith("SDE.party.item.gave", { item: item.name, name: target.name }));
  }
  /** Remove a party item, its whole stack, after a confirm: nobody receives it. */
  async _deleteItem(id) {
    const item = this.actor?.items.get(id);
    if (!item || !this.actor.isOwner) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      classes: ["sde-ui", "sde-dialog"], window: { title: "SDE.party.item.deleteTitle" }, rejectClose: false,
      content: `<p>${sayWith("SDE.party.item.deleteQuestion", { item: `<strong>${foundry.utils.escapeHTML(item.name)}</strong>` })}</p>`,
    });
    if (!ok) return;
    await item.delete();
    ui.notifications.info(sayWith("SDE.party.item.deleted", { item: item.name }));
  }
  /** The GM bar's fields, kept through a re-render: the ability, the DC as typed (blank: none), who is ticked (null: all PCs), the XP. */
  _form() { return (this.rollForm ??= { stat: "str", dc: String(DEFAULT_DC), who: null, xp: "" }); }
  /** The PCs the Who list has ticked. */
  _asked() { const pcs = this._pcs(); const { uuids } = whoSelection(pcs.map((row) => row.uuid), this._form().who); return pcs.filter((row) => uuids.includes(row.uuid)); }
  /** Request roll: one chat card with a Roll link for each PC ticked. */
  async _requestRoll() {
    if (!game.user?.isGM || !this.actor?.isOwner) return;
    const form = this._form();
    await postRollRequest({ stat: form.stat, dc: form.dc, targets: this._asked().map((row) => ({ uuid: row.uuid, name: row.actor.name })) });
  }
  /** Award XP: the typed amount, in full, to each PC ticked (the party XP tool's rules and chat card). */
  async _awardParty() {
    if (!game.user?.isGM || !this.actor?.isOwner) return;
    const asked = this._asked();
    if (!asked.length) return ui.notifications.warn(t("SDE.party.roll.noTargets"));
    const { PartyXP } = await import("../party-xp/party-xp.mjs");
    const done = await PartyXP.award(this._form().xp, { actorIds: asked.map((row) => row.actor.id) });
    if (done) { this._form().xp = ""; this.render(); }
  }
  /** Run one of the Downtime window's GM handlers for this sheet (a stand-in window that never opens), then redraw. */
  async _downtimeCall(method, el = null) {
    if (!game.user?.isGM) return;
    const { DowntimeApp } = await import("../downtime/downtime-app.mjs");
    const app = new DowntimeApp(); app.render = async () => app;
    await DowntimeApp.prototype[method].call(app, null, el);
    this.render();
  }
  /** Start a session in the first unlocked book (the Downtime window has the book picker for any other). */
  async _startDowntime() {
    if (!game.user?.isGM) return;
    const [{ DowntimeApp }, { DowntimeSession }, { SOURCES }] = await Promise.all([import("../downtime/downtime-app.mjs"), import("../downtime/downtime-session.mjs"), import("../downtime/downtime-skeleton.mjs")]);
    const app = new DowntimeApp(), slug = defaultSource(Object.keys(SOURCES ?? {}), (key) => app._stored(key).ok);
    if (!slug) return ui.notifications.warn(t("SDE.downtime.notify.pickBook"));
    await DowntimeSession.start(slug);
    this.render();
  }
  /** The Downtime tab: the session's status and a row for each character this viewer may see. */
  async _downtime(rows) {
    const [{ DowntimeSession, foundFor, advMode }, { SOURCES }] = await Promise.all([import("../downtime/downtime-session.mjs"), import("../downtime/downtime-skeleton.mjs")]);
    const pcs = rows.filter((row) => row.group === "characters" && row.actor && (game.user?.isGM || row.actor.isOwner)).map((row) => ({ id: row.actor.id, name: row.actor.name }));
    const session = { active: DowntimeSession.active, phase: DowntimeSession.phase, sourceLabel: SOURCES?.[DowntimeSession.source]?.label ?? DowntimeSession.source, days: DowntimeSession.days, picks: DowntimeSession.picks, results: DowntimeSession.results };
    return downtimeSummary(session, pcs, { pickLabel: (pick) => foundFor(pick)?.slot?.label ?? pick.slotKey, advLabel: (pick) => t(advMode(pick.advantage).label) });
  }
  /** The Warbands tab: the warbands under a character of this party that the viewer may see, each with what its upkeep costs now. */
  async _warbands(rows) {
    const [{ warbandState }, { garrisonFor }] = await Promise.all([import("../actors/warband-npc-sheet.mjs"), import("../actors/warband-garrison.mjs")]);
    const commanders = rows.filter((row) => row.group === "characters" && row.actor), bands = [];
    for (const wb of (game.actors?.contents ?? []).filter((a) => a.type === WARBAND_TYPE && !a.pack && a.testUserPermission?.(game.user, "OBSERVER"))) {
      const state = warbandState(wb), garrison = await garrisonFor(state.bastion), hp = wb.system?.attributes?.hp ?? {}, level = wb.system?.level?.value;
      bands.push({ uuid: wb.uuid, name: wb.name, img: wb.img, level, hp: { value: hp.value, max: hp.max }, commander: state.commander, arrears: state.arrears, out: state.deserted || state.routed, upkeepGp: upkeepGp(level, garrison?.granary ? GRANARY_SAVING_GP : 0) });
    }
    return warbandGroups(bands, commanders.map((row) => row.uuid), (uuid) => commanders.find((row) => row.uuid === uuid)?.actor?.name ?? uuid);
  }
  /** One of the Warband tab's upkeep controls, a GM's: sent to the active GM's warband writer, and what it answered shown. */
  async _warbandWrite(data) {
    if (!game.user?.isGM || !data.actorId) return;
    const { sendWarbandWrite } = await import("../actors/warband-npc-sheet.mjs");
    const reply = await sendWarbandWrite(data, WARBAND_TYPE);
    if (reply?.warn) ui.notifications.warn(sayWith(reply.warn.key, reply.warn.data));
    else if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error);
    this.render();
  }
  /** One emblem pick (an icon, a tile colour or an icon colour; a colour may be any hex), written as one flag. The GM's alone. */
  _pickEmblem(pick) {
    if (!sheetView({ isGM: !!game.user?.isGM, canEdit: Party.canManage(this.actor) }).emblemEdit) return;
    const next = pickEmblem(this.actor.flags?.[MODULE_ID]?.[EMBLEM_FLAG], pick);
    return this._change(() => replaceModuleFlag(this.actor, EMBLEM_FLAG, next));
  }
  async _change(write) {
    try { await write(); this.render(); }
    catch (error) { console.error(`${MODULE_ID} | Party write`, error); ui.notifications.warn(t(error.message.startsWith("SDE.") ? error.message : "SDE.party.unknownRoster")); }
  }
  async _prepareContext() {
    const parties = Party.list().map((a) => ({ uuid: a.uuid, name: a.name, selected: a === this.actor }));
    const view = sheetView({ isGM: !!game.user?.isGM, canEdit: Party.canManage(this.actor) });
    const bastionActor = this._bastion();
    const keys = partyTabs({ hasBastion: !!bastionActor }), tab = resolveTab(this.tab, keys);
    const base = { parties, isGM: view.isGM, hasParty: !!this.actor, title: this.actor?.name,
      tabs: tabRow(keys, tab, t),
      membersTab: tab === "members", questsTab: tab === "quests", itemsTab: tab === "items", travelTab: tab === "travel", downtimeTab: tab === "downtime", warbandsTab: tab === "warbands", bastionTab: tab === "bastion", descriptionTab: tab === "description", picker: !this.document };
    if (!this.actor) return base;
    if (!Party.list().includes(this.actor)) return { ...base, hasParty: false };
    if (this.actor.type === "Party") return { ...base, unsupported: true };
    try {
      const data = Party.data(this.actor), rows = Party.rows(this.actor), canEdit = view.canEdit;
      const members = await Promise.all(rows.map(async (row) => {
        const a = row.actor, sys = a?.system ?? {}, hp = sys.attributes?.hp ?? { value: 0, max: 0 };
        let className = "";
        if (sys.class && globalThis.fromUuid) { try { className = (await fromUuid(sys.class))?.name ?? ""; } catch { /* An unresolved class must not hide the member. */ } }
        const items = a?.items?.contents ?? [], percent = Math.max(0, Math.min(100, Math.round(hp.value / (hp.max || 1) * 100)));
        return { ...row, memberKey: row.uuid, name: a?.name ?? t("SDE.party.missing"), img: a?.img ?? "icons/svg/mystery-man.svg", missing: !a, canEdit, isNPC: !!a?.system?.isNPC, className,
          hp: { value: hp.value ?? 0, max: hp.max ?? 0 }, ac: sys.attributes?.ac?.value ?? 0, level: sys.level?.value ?? 1,
          xp: { current: sys.level?.xp ?? 0, next: (sys.level?.value ?? 1) * 10 }, hpPercent: percent, showAbilities: !!a && ["characters", "hirelings"].includes(row.group) && !!sys.abilities,
          slots: { used: inventorySlots(items, sys.coins), max: sys.slots ?? 10 }, abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(key => [key, sys.abilities?.[key]?.mod ?? 0])),
          abilityLabels: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(key => { const mod = sys.abilities?.[key]?.mod ?? 0; return [key, mod >= 0 ? `+${mod}` : String(mod)]; })),
          luck: luckCount(sys.luck), lightOn: carriesLight(items), spellTiers: spellTiers(items), leader: row.uuid === data.leaderUuid };
      }));
      const visible = members.filter(m => !m.missing), players = members.filter(m => m.group === "characters");
      const coins = this.actor.flags?.[MODULE_ID]?.partyCoins ?? this.actor.flags?.["shadowdark-extras"]?.coins ?? { gp: 0, sp: 0, cp: 0 };
      const coinList = Object.entries(COIN_LABELS).map(([key, labelKey]) => ({ key, labelKey, value: Math.max(0, Math.trunc(Number(coins?.[key]) || 0)) }));
      const slotsUsed = inventorySlots(this.actor.items.contents, coins), slotsMax = this.actor.flags?.["shadowdark-extras"]?.partyMaxSlots ?? 10;
      const gemBag = gemSummary(this.actor.items.contents);
      const description = this.actor.flags?.[MODULE_ID]?.partyDescription ?? this.actor.flags?.["shadowdark-extras"]?.description ?? "";
      const editor = globalThis.foundry?.applications?.ux?.TextEditor?.implementation;
      const descriptionHTML = editor ? await editor.enrichHTML(description, { secrets: !!this.actor.isOwner, async: true, relativeTo: this.actor }) : "";
      let activityHTML = "", questHTML = "";
      const renderTemplate = foundry.applications.handlebars?.renderTemplate;
      if (tab === "travel" && renderTemplate) {
        const app = this._activityController();
        activityHTML = (await renderTemplate(app.constructor.PARTS.body.template, await app._prepareContext())).replace(/data-action="([^"]+)"/g, 'data-action="activityAction" data-activity-action="$1"');
      }
      if (tab === "quests" && renderTemplate) {
        const app = this._questController();
        questHTML = (await renderTemplate(QuestLogApp.PARTS.body.template, await app._prepareContext())).replace(/data-action="([^"]+)"/g, 'data-action="questAction" data-quest-action="$1"');
      }
      const bastion = bastionActor ? bastionCard(bastionActor) : null;
      const emblem = emblemOf(this.actor.flags?.[MODULE_ID]?.[EMBLEM_FLAG]), picker = emblemChoices(emblem, t);
      // Light is carried by the party, its characters and its hirelings; rations by the party and its characters.
      // A member the viewer cannot see may hold either, so rations are shown only when there are members and every one is visible.
      const carriers = rows.filter(r => r.actor && ["characters", "hirelings"].includes(r.group)).map(r => r.actor.items?.contents ?? []);
      const partyItems = this.actor.items?.contents ?? [];
      const everyoneVisible = rows.length > 0 && rows.every(r => r.actor);
      const stock = everyoneVisible ? [partyItems, ...rows.filter(r => r.group === "characters").map(r => r.actor.items?.contents ?? [])] : null;
      const readouts = statusBar({ travel: await this._travel(), light: lightReadout([partyItems, ...carriers]),
        torches: stock ? torchCount(stock) : null, rations: stock ? rationsCount(stock) : null }, I18N);
      const formation = fillFormation(data, rows), status = movementStatus(this.actor);
      const combat = inPartyCombat(globalThis.canvas?.scene), leaderActor = rows.find(r => r.uuid === data.leaderUuid)?.actor, hasLeader = !!data.leaderUuid && !!leaderActor;
      const marchLine = marchText(marchState({ follow: data.followLeader, hasToken: !!status.token, reason: status.reason, manager: canEdit, hasLeader }),
        { leaderName: leaderActor?.name, missing: t("SDE.party.missing") }, I18N);
      const march = { ...marchLine, warn: marchLine.mode === "notice" };
      const slots = [];
      for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) {
        const uuid = formation.slots.find(s => s.row === row && s.col === col)?.memberUuid;
        const member = rows.find(r => r.uuid === uuid)?.actor;
        slots.push({ row, col, uuid, name: member?.name, img: member?.img, leader: uuid === data.leaderUuid, disabled: !canEdit || !member });
      }
      const form = this._form(), pcs = players.filter(m => !m.missing), who = whoSelection(pcs.map(m => m.uuid), form.who);
      const gmBar = view.isGM && pcs.length ? {
        stats: ROLL_STATS.map(key => ({ key, label: t(ROLL_STAT_LABELS[key]), selected: key === form.stat })), dc: form.dc, xp: form.xp,
        whoOpen: this.openKeys.has("who"), whoAll: who.all,
        whoLabel: who.all ? t("SDE.party.roll.whoAll") : (pcs.filter(m => who.uuids.includes(m.uuid)).map(m => m.name).join(", ") || t("SDE.party.roll.whoNone")),
        pcs: pcs.map(m => ({ uuid: m.uuid, name: m.name, checked: who.uuids.includes(m.uuid) })) } : null;
      const downtime = tab === "downtime" ? await this._downtime(rows) : null, warbandGroupsList = tab === "warbands" ? await this._warbands(rows) : [];
      return { ...base, gmBar, downtime, warbandGroups: warbandGroupsList, actor: this.actor, canEdit, owner: canEdit, players, members, memberCount: visible.length, coins, coinList, gems: gemBag.rows, gemTotal: gemBag.total, descriptionHTML, description, editingDescription: !!this.editingDescription,
        activityHTML, questHTML, campingActive: this.activity !== "carousing", carousingActive: this.activity === "carousing",
        inventorySlots: { used: slotsUsed, max: slotsMax, over: slotsUsed > slotsMax }, coinSlots: Math.floor(["gp", "sp", "cp"].reduce((n, key) => n + coinList.find(c => c.key === key).value, 0) / 100),
        receivers: players.filter(m => !m.missing).map(m => ({ uuid: m.uuid, name: m.name })),
        addItemOpen: this.openKeys.has("addItem"), addCoinsOpen: this.openKeys.has("addCoins"), giveCoinsOpen: this.openKeys.has("giveCoins"),
        partyStats: { totalHp: visible.reduce((n,m) => n + m.hp.value, 0), maxHp: visible.reduce((n,m) => n + m.hp.max, 0), avgAc: visible.length ? Math.round(visible.reduce((n,m) => n + m.ac, 0) / visible.length) : 0, avgLevel: players.length ? Math.round(players.reduce((n,m) => n + m.level, 0) / players.length) : 0 },
        needsAdoption: canEdit && !this.actor.flags?.[MODULE_ID]?.partyData,
        slots, followLeader: data.followLeader, formationReview: formation.needsReview, march, hasLeader, bastion, status: readouts,
        emblem: { ...emblem, path: emblemIconPath(emblem.icon), maskUrl: routeOf(emblemIconPath(emblem.icon)) }, emblemEdit: view.emblemEdit, emblemOpen: view.emblemEdit && !!this.emblemOpen, emblemIcons: picker.icons, emblemColors: picker.colors, emblemIconColors: picker.iconColors, emblemCustomBox: picker.customBox, emblemCustomIcon: picker.customIcon,
        leaderName: leaderActor?.name ?? t("SDE.party.missing"),
        movementDisabled: !canEdit || !status.token || combat,
        movementReason: !status.token ? t("SDE.party.movement.noToken") : combat ? t("SDE.party.movement.combat") : t("SDE.party.movement.importExport"),
        groups: ["characters", "hirelings", "mounts", "missing"].map((key) => ({ label: t(LABELS[key]), rows: members.filter(r => r.group === key) })),

        quests: this._quests(), items: this.actor.items.contents.filter((i) => i.type !== "Gem").map((i) => ({ id: i.id, name: i.name, img: i.img, quantity: i.system?.quantity ?? 1, slots: inventorySlots([i]), giveOpen: this.openKeys.has(`give:${i.id}`) })) };
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
    // The emblem picker closes on a click anywhere else in the page, not only on its own tile and the tabs.
    globalThis.document?.removeEventListener("pointerdown", this._pickerAway, true);
    if (this.element.querySelector(".sdp-emblems")) {
      this._pickerAway = (event) => {
        if (event.target?.closest?.(".sdp-emblems, .sdp-emblem")) return;
        globalThis.document?.removeEventListener("pointerdown", this._pickerAway, true);
        this.emblemOpen = false; this.render();
      };
      globalThis.document?.addEventListener("pointerdown", this._pickerAway, true);
    }
    // The GM bar: its fields are kept through a re-render, and the Who list changes who the roll and the XP go to.
    const form = this._form(), pcUuids = () => this._pcs().map((row) => row.uuid);
    this.element.querySelector("[data-roll-stat]")?.addEventListener("change", (event) => { form.stat = event.target.value; });
    this.element.querySelector("[data-roll-dc]")?.addEventListener("input", (event) => { form.dc = event.target.value; });
    this.element.querySelector("[data-award-xp]")?.addEventListener("input", (event) => { form.xp = event.target.value; });
    this.element.querySelector("[data-roll-all]")?.addEventListener("change", (event) => { form.who = whoAfter(pcUuids(), form.who, { all: true, on: event.target.checked }); this.render(); });
    for (const box of this.element.querySelectorAll("[data-roll-member]")) box.addEventListener("change", () => { form.who = whoAfter(pcUuids(), form.who, { uuid: box.value, on: box.checked }); this.render(); });
    // An open menu or form stays open through a re-render (a hook, a typed number) until its action closes it.
    for (const details of this.element.querySelectorAll("details[data-open-key]")) details.addEventListener("toggle", () => { this.openKeys[details.open ? "add" : "delete"](details.dataset.openKey); });
    // A custom emblem colour: the colour well and its hex field both pick it; a half-typed hex waits until it is six digits.
    for (const input of this.element.querySelectorAll("[data-color-input], [data-color-hex]")) input.addEventListener("change", () => {
      const part = input.dataset.colorInput ?? input.dataset.colorHex;
      void this._pickEmblem({ [part === "icon" ? "iconColor" : "color"]: input.value });
    });
    // Actors dropped on the Members tab, or on the formation grid of an empty party, join the roster.
    for (const target of this.element.querySelectorAll(".tab-members, [data-drop-members]")) {
      target.addEventListener("dragover", event => { if (Party.canManage(this.actor)) event.preventDefault(); });
      target.addEventListener("drop", event => {
        event.preventDefault();
        try { const data = JSON.parse(event.dataTransfer.getData("text/plain")); if (data.type === "Actor" && data.uuid) void this._change(() => Party.add(this.actor, data.uuid)); } catch { /* Ignore non-document drags. */ }
      });
    }
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
    this._hooks = ["updateActor", "deleteActor", "createActor", "createItem", "updateItem", "deleteItem", "updateRollTable", "createCombat", "updateCombat", "deleteCombat", "canvasReady", MOVEMENT_CHANGED, QUESTS_CHANGED, DOWNTIME_CHANGED].map((name) => [name, Hooks.on(name, () => this._onStateChanged())]);
    await this._hookTravel();
  }
  /** The status bar's Today readout follows the overland state; its change hook is named in the overland module. */
  async _hookTravel() {
    if (!game.shadowdarkEnhancer) return;
    try { const { OVERLAND_CHANGED } = await import("../overland/overland.mjs"); if (this._hooks) this._hooks.push([OVERLAND_CHANGED, Hooks.on(OVERLAND_CHANGED, () => this._onStateChanged())]); }
    catch (error) { console.debug(`${MODULE_ID} | Party travel hook`, error); }
  }
  _onStateChanged() {
    const field = globalThis.document?.activeElement;
    if (!field || !this.element?.contains(field) || !field.matches("textarea, input[type='text'], input[type='number']")) return this.render();
    if (this._heldFor === field) return;
    this._heldFor = field;
    field.addEventListener("blur", event => { this._heldFor = null; if (!event.relatedTarget?.closest("[data-action]")) this.render(); }, { once: true });
  }
  _onClose(options) { for (const [name, id] of this._hooks ?? []) Hooks.off(name, id); this._hooks = null; globalThis.document?.removeEventListener("pointerdown", this._pickerAway, true); return super._onClose(options); }
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
  openKeys = new Set();
  get title() { return this.actor.name; }
  _onRender(context, options) { super._onRender(context, options); this._bindControls(); }
  /** A drag from another actor's sheet moves the item (Ctrl copies), as Shadowdark Extras does on the character sheets. */
  async _onDropItem(event, item) {
    const source = item.parent, result = await super._onDropItem(event, item);
    if (result && source && source.uuid !== this.actor.uuid && !event.ctrlKey && (game.user?.isGM || source.isOwner)) await item.delete();
    return result;
  }
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._hooks = ["updateActor", "deleteActor", "createItem", "updateItem", "deleteItem", "updateRollTable", "createCombat", "updateCombat", "deleteCombat", "canvasReady", MOVEMENT_CHANGED, QUESTS_CHANGED, DOWNTIME_CHANGED].map(name => [name, Hooks.on(name, () => this._onStateChanged())]);
    await this._hookTravel();
  }
  _onClose(options) { for (const [name, id] of this._hooks ?? []) Hooks.off(name, id); this._hooks = null; globalThis.document?.removeEventListener("pointerdown", this._pickerAway, true); return super._onClose(options); }
}
for (const name of ["_prepareContext", "_change", "_pickEmblem", "_pool", "_coinInputs", "_pcs", "_refuse", "_settle", "_coinLabel", "_addCoins", "_giveCoins", "_divideCoins", "_addItemFrom", "_giveItem", "_deleteItem", "_quests", "_bastion", "_travel", "_hookTravel", "_bindControls", "_activityController", "_questController", "_onStateChanged", "_form", "_asked", "_requestRoll", "_awardParty", "_downtimeCall", "_startDowntime", "_downtime", "_warbands", "_warbandWrite"]) PartySheet.prototype[name] = PartyApp.prototype[name];

/** Only native/adopted flagged Parties route here; ordinary NPC sheets stay intact. */
export function registerParty() {
  registerPartyRosterGuard();
  const ActorClass = globalThis.CONFIG?.Actor?.documentClass;
  if (ActorClass) {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(ActorClass, MODULE_ID, PartySheet, { types: ["NPC"], makeDefault: false, label: "SDE.party.title" });
    const original = ActorClass.prototype._getSheetClass;
    ActorClass.prototype._getSheetClass = function () { return isNativeParty(this) ? PartySheet : original.call(this); };
    const create = ActorClass.create;
    ActorClass.create = function (data, options) {
      const convert = value => value.type !== "sde-party" ? value : { ...value, type: "NPC", img: value.img || "icons/environment/people/group.webp", flags: { ...value.flags, [MODULE_ID]: { ...value.flags?.[MODULE_ID], party: true } } };
      return create.call(this, Array.isArray(data) ? data.map(convert) : convert(data), options);
    };
    Hooks.on("renderDialogV2", (_app, html) => offerParty(html.querySelector?.('select[name="type"]'), t("SDE.party.title")));
  }
  // The system's _preCreate forces actorLink off for every non-Player and runs before this hook, so link here.
  // Movement only follows a linked token; an unlinked party token reads as "no party token".
  Hooks.on("preCreateActor", actor => { if (isNativeParty(actor)) actor.updateSource({ "prototypeToken.actorLink": true }); });
  // Heal parties made before this: new tokens come out linked; tokens already on a scene stay unlinked.
  Hooks.once("ready", () => {
    if (!game.user?.isGM) return;
    for (const actor of (game.actors?.contents ?? []).filter(a => isNativeParty(a) && !a.prototypeToken.actorLink)) void actor.update({ "prototypeToken.actorLink": true });
  });
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
