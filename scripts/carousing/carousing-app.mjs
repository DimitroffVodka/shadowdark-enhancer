import { MODULE_ID } from "../shared/module-id.mjs";
import { Party } from "../party/party.mjs";
import { carousingOf, carousingTables, requestCarousing } from "./carousing.mjs";
import { splitCost } from "./carousing-core.mjs";
import { holidaysToday } from "../holidays/holidays.mjs";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const t = (key) => game.i18n.localize(key);
export class CarousingApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { classes: ["shadowdark", "sde-carousing", "sde-ui"], position: { width: 760, height: 700 }, window: { title: "SDE.carousing.title", resizable: true }, actions: {
    begin: function () { return this.change("begin"); }, start: function () { return this.change("start"); }, resume: function () { return this.change("resume"); }, cancel: function () { return this.change("cancel"); },
    confirm: function (_event, el) { return this.change("select", { uuid: el.dataset.uuid, confirm: true }); },
    configure: function (_event, el) { const root = el?.closest(".sde-carousing-body") ?? this.element; const config = Object.fromEntries([...root.querySelectorAll("[data-config]")].map(el => [el.dataset.config, el.value])); return this.change("configure", { config }); },
  } };
  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/carousing/carousing.hbs`, scrollable: [".sde-carousing-body"] } };
  constructor(party, options = {}, host = null) { super(options); this.party = party; this.host = host; }
  static open(party) {
    if (!Party.list().includes(party) || party.type === "Party") return null;
    const id = `sde-carousing-${party.id}`, existing = foundry.applications.instances.get(id);
    if (existing) { existing.render(true); existing.bringToFront(); return existing; }
    const app = new CarousingApp(party, { id }); app.render(true); return app;
  }
  change(action, data = {}) {
    const run = (this.writes ?? Promise.resolve()).catch(() => {}).then(async () => {
      const reply = await requestCarousing(this.party, action, data);
      this.error = reply.ok ? null : reply.error; (this.host ?? this).render(); return reply;
    });
    this.writes = run; return run;
  }
  async _prepareContext() {
    const state = carousingOf(this.party), night = state.current, config = night?.config ?? state.config ?? {}, setup = night?.phase === "setup";
    const holiday = setup && config.place ? (await holidaysToday({ place: config.place }))[0] : night?.holiday;
    const tables = game.user.isGM ? await carousingTables() : [];
    const rows = night?.participants.map(p => {
      const actor = Party.get(p.uuid), result = night.results[p.actorId];
      return { ...p, editable: setup && !!actor?.testUserPermission(game.user, "OWNER"),
        result, status: t(p.confirmed ? "SDE.carousing.confirmed" : "SDE.carousing.unconfirmed") };
    }) ?? [];
    const tier = night?.tiers.find(v => v.id === night.tierId), joining = night?.participants.filter(p => p.participate).length ?? 0, shares = tier ? splitCost(tier.cost, joining) : [];
    const each = shares.length ? (shares[0] === shares.at(-1) ? `${shares[0]}` : `${shares.at(-1)}–${shares[0]}`) : "—", gp = n => game.i18n.format("SDE.carousing.gp", { n });
    return { title: this.party.name, embedded: !!this.host, rows,
      tiers: night?.tiers.map(v => ({ id: v.id, label: game.i18n.format("SDE.carousing.tier", { name: v.description, cost: v.cost, bonus: v.bonus }), selected: night.tierId === v.id })) ?? [],
      tierEditable: setup && Party.canManage(this.party),
      tier: tier ? { bonus: tier.bonus } : null, count: joining, costText: tier ? gp(tier.cost) : "", shareText: shares.length ? gp(each) : each,
      eachLabel: joining ? game.i18n.format("SDE.carousing.eachPays", { n: joining }) : t("SDE.carousing.eachPaysNobody"), error: this.error, manager: Party.canManage(this.party), isGM: game.user.isGM,
      empty: !night, setup, complete: night?.phase === "complete", resume: night && !setup,
      phase: night?.phase, holiday: holiday?.name, manualHoliday: !!holiday && (!!holiday.carousing?.extraBenefit || !!holiday.carousing?.extraMishap || !!holiday.carousing?.benefitBonus || !!holiday.carousing?.benefitAdvantage || !!holiday.carousing?.chances?.length),
      canConfigure: !night || setup || night.phase === "complete", missingTables: setup && (!night.tiers.length || !night.outcomes.length),
      config, events: tables.map(v => ({ ...v, selected: v.uuid === (night?.event ?? config.event) })), outcomes: tables.map(v => ({ ...v, selected: v.uuid === (night?.outcome ?? config.outcome) })),
      settlements: [{ value: "none", label: t("SDE.carousing.noSettlement") }, ...["village", "town", "city", "city_state"].map(value => ({ value, label: t({ village: "SDE.rulesData.settlement.village", town: "SDE.rulesData.settlement.town", city: "SDE.rulesData.settlement.city", city_state: "SDE.rulesData.settlement.city_state" }[value]) }))].map(v => ({ ...v, selected: v.value === (config.settlement ?? "none") })),
      history: [...state.history].reverse().map(h => ({ date: h.date, logId: h.logId, historyOnly: h.historyOnly, entries: h.historyOnly ? h.entries : h.participants.map(p => ({ actorName: p.name, cost: p.cost, outcome: h.results[p.actorId]?.description, benefit: h.results[p.actorId]?.benefit })) })) };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.bindControls(this.element);
  }
  bindControls(root) {
    root.querySelector("[data-tier]")?.addEventListener("change", event => { void this.change("tier", { tierId: event.target.value }); });
    for (const el of root.querySelectorAll("[data-choice]")) el.addEventListener("change", () => { void this.change("select", { uuid: el.closest("[data-uuid]").dataset.uuid, patch: { [el.dataset.choice]: el.type === "checkbox" ? el.checked : el.value } }); });
  }
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.hooks = ["updateActor", "updateRollTable"].map(name => [name, Hooks.on(name, () => this.render())]);
  }
  _onClose(options) { for (const [name, id] of this.hooks ?? []) Hooks.off(name, id); return super._onClose(options); }
}
