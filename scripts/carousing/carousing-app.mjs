import { MODULE_ID } from "../shared/module-id.mjs";
import { Party } from "../party/party.mjs";
import { carousingOf, carousingTables, cooldownSeconds, lastCarousedAt, requestCarousing } from "./carousing.mjs";
import { splitCost, resultLine, bookChoices, COOLDOWN_DAYS } from "./carousing-core.mjs";
import { holidaysToday } from "../holidays/holidays.mjs";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const t = (key) => game.i18n.localize(key);
export class CarousingApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { classes: ["shadowdark", "sde-carousing", "sde-ui"], position: { width: 760, height: 700 }, window: { title: "SDE.carousing.title", resizable: true }, actions: {
    begin: function () { return this.change("begin"); }, start: function () { return this.change("start"); }, resume: function () { return this.change("resume"); }, cancel: function () { return this.change("cancel"); },
    confirm: function (_event, el) { return this.change("select", { uuid: el.dataset.uuid, confirm: true }); },
    // A rulebook select still on the option it was drawn with sends nothing: it was only a default (blank saved, or the other copy of the same book), and a changed outcome clears the book's own tables.
    configure: function (_event, el) { const root = el?.closest(".sde-carousing-body") ?? this.element; const config = Object.fromEntries([...root.querySelectorAll("[data-config]")].filter(el => !(el.dataset.config === "outcome" && el.selectedOptions[0]?.defaultSelected)).map(el => [el.dataset.config, el.value])); return this.change("configure", { config }); },
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
    const choices = bookChoices(game.user.isGM ? await carousingTables() : [], config.outcome);
    // What a settlement lets the party spend, from the Rules Data table; the same number the Start check reads. null is a table nobody filled in.
    const limitOf = kind => game.shadowdarkEnhancer.rules.carousingLimit(kind);
    const limit = limitOf(config.settlement || "none") ?? Infinity;
    const settlementLabel = kind => {
      const name = t(`SDE.rulesData.settlement.${kind}`), n = limitOf(kind);
      return game.i18n.format(n === null ? "SDE.carousing.settlementUnset" : n === Infinity ? "SDE.carousing.settlementNoLimit" : "SDE.carousing.settlementUpTo", { name, n });
    };
    const world = game.time.worldTime, wait = cooldownSeconds();
    // Each benefit and mishap shows the d100 it came from: the die, the row's modifier, and the number the table was read at.
    const diceNote = (e, modifier) => e.dice === undefined ? "" : game.i18n.format(modifier ? "SDE.carousing.diceNote" : "SDE.carousing.diceNoteFlat", { dice: e.dice, mod: `${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}`, roll: e.roll });
    const noted = r => r?.mode === "expanded" ? { ...r, benefits: r.benefits.map(e => ({ ...e, note: diceNote(e, r.modifier) })), mishaps: r.mishaps.map(e => ({ ...e, note: diceNote(e, r.modifier) })) } : r;
    const rows = night?.participants.map(p => {
      const actor = Party.get(p.uuid), result = noted(night.results[p.actorId]), last = setup && p.participate ? lastCarousedAt(actor) : -Infinity;
      // Inside the 14 game days since this character's last outing: a warning the GM can switch off for this outing.
      return { ...p, editable: setup && !!actor?.testUserPermission(game.user, "OWNER"),
        recent: world - last < wait ? game.i18n.format("SDE.carousing.recent", { n: Math.max(0, Math.floor((world - last) / (wait / COOLDOWN_DAYS))), of: COOLDOWN_DAYS }) : "",
        result, status: t(p.confirmed ? "SDE.carousing.confirmed" : "SDE.carousing.unconfirmed") };
    }) ?? [];
    const tier = night?.tiers.find(v => v.id === night.tierId), joining = night?.participants.filter(p => p.participate).length ?? 0, shares = tier ? splitCost(tier.cost, joining) : [];
    const each = shares.length ? (shares[0] === shares.at(-1) ? `${shares[0]}` : `${shares.at(-1)}–${shares[0]}`) : "—", gp = n => game.i18n.format("SDE.carousing.gp", { n });
    return { title: this.party.name, embedded: !!this.host, rows,
      tiers: night?.tiers.map(v => ({ id: v.id, label: game.i18n.format("SDE.carousing.tier", { name: v.description, cost: v.cost, bonus: v.bonus }), selected: night.tierId === v.id, disabled: v.cost > limit })) ?? [],
      tierEditable: setup && Party.canManage(this.party),
      tier: tier ? { bonus: tier.bonus } : null, count: joining, costText: tier ? gp(tier.cost) : "", shareText: shares.length ? gp(each) : each,
      eachLabel: joining ? game.i18n.format("SDE.carousing.eachPays", { n: joining }) : t("SDE.carousing.eachPaysNobody"), error: this.error, manager: Party.canManage(this.party), isGM: game.user.isGM,
      cooldownWarning: rows.some(r => r.recent), ignoreCooldown: night?.ignoreCooldown === true,
      empty: !night, setup, complete: night?.phase === "complete",
      // Resume / retry recap is for an outing that did not finish, or whose recap never went out; on a finished, reported one it re-sends the recap and shows nothing.
      resume: !!night && !setup && !(night.phase === "complete" && night.reported),
      phase: night?.phase, holiday: holiday?.name, expanded: night?.mode === "expanded",
      manualHoliday: !!holiday && (!!holiday.carousing?.chances?.length || (night?.mode !== "expanded" && (!!holiday.carousing?.extraBenefit || !!holiday.carousing?.extraMishap || !!holiday.carousing?.benefitBonus || !!holiday.carousing?.benefitAdvantage))),
      canConfigure: !night || setup || night.phase === "complete", missingTables: setup && (!night.tiers.length || !night.outcomes.length || (night.mode === "expanded" && !(night.benefits?.length && night.mishaps?.length))),
      config, books: choices.books.map(b => ({ ...b, label: t(b.label) })), ownBook: choices.own && { value: choices.own.value, label: game.i18n.format("SDE.carousing.ownTables", { name: choices.own.name }) }, showBooks: choices.books.length > 1 || !!choices.own,
      settlements: [{ value: "none", label: t("SDE.carousing.noSettlement") }, ...["village", "town", "city", "city_state"].map(value => ({ value, label: settlementLabel(value) }))].map(v => ({ ...v, selected: v.value === (config.settlement ?? "none") })),
      history: [...state.history].reverse().map(h => ({ date: h.date, logId: h.logId, historyOnly: h.historyOnly, entries: h.historyOnly ? h.entries : h.participants.map(p => ({ actorName: p.name, cost: p.cost, ...resultLine(h.results[p.actorId], n => game.i18n.format("SDE.carousing.xpLine", { n })) })) })) };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.bindControls(this.element);
  }
  bindControls(root) {
    root.querySelector("[data-tier]")?.addEventListener("change", event => { void this.change("tier", { tierId: event.target.value }); });
    root.querySelector("[data-cooldown]")?.addEventListener("change", event => { void this.change("cooldown", { value: event.target.checked }); });
    for (const el of root.querySelectorAll("[data-choice]")) el.addEventListener("change", () => { void this.change("select", { uuid: el.closest("[data-uuid]").dataset.uuid, patch: { [el.dataset.choice]: el.type === "checkbox" ? el.checked : el.value } }); });
  }
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.hooks = ["updateActor", "updateRollTable"].map(name => [name, Hooks.on(name, () => this.render())]);
  }
  _onClose(options) { for (const [name, id] of this.hooks ?? []) Hooks.off(name, id); return super._onClose(options); }
}
