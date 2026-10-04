import { MODULE_ID } from "../shared/module-id.mjs";
import { Party } from "../party/party.mjs";
import { requestCamp, campOf, campTorchPlan } from "./camping.mjs";
import { CAMP_LABELS } from "./camping-core.mjs";
import { foodPreview } from "./camping-nutrition.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const t = (key) => game.i18n.localize(key);
export class CampingApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { classes: ["shadowdark", "sde-camping"], position: { width: 820, height: 700 }, window: { title: "SDE.camping.title", resizable: true }, actions: {
    begin: function () { return this.change("begin"); }, resolve: function () { return this.change("resolve"); },
    resume: function () { return this.change("resume"); }, cancel: function () { return this.change("cancel"); },
    acceptFuel: function () { return this.change("fuel", { accept: true, deductions: this.fuelPreview }); },
    declineFuel: function () { return this.change("fuel", { accept: false }); },
    confirmChoice: function (_event, el) { return this.change("select", { uuid: el.dataset.uuid, patch: {} }); },
    night: function () { return this.change("night"); },
    acceptShortages: function () { return this.change("night", { acceptShortages: true }); },
  } };
  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/camping/camping.hbs`, scrollable: [".sde-camping-body"] } };
  constructor(party, options = {}, host = null) { super(options); this.party = party; this.host = host; }
  static open(party) {
    if (!Party.list().includes(party) || party.type === "Party") return null;
    const id = `sde-camping-${party.id}`, existing = foundry.applications.instances.get(id);
    if (existing) { existing.render(true); existing.bringToFront(); return existing; }
    const app = new CampingApp(party, { id }); app.render(true); return app;
  }
  async change(action, data = {}) {
    const run = (this.writes ?? Promise.resolve()).catch(() => {}).then(async () => {
      try {
        const overland = action === "night" ? await import("../overland/overland.mjs") : null;
        const result = overland ? await (overland.overlandState().pending?.reason === "camp" ? overland.resume(this.party) : overland.makeCamp(this.party, data.acceptShortages === true)) : await requestCamp(this.party, action, data);
        this.error = result.ok ? null : result.error;
        if (!result.ok && !this.host) ui.notifications.warn(result.error);
        return result;
      }
      finally { (this.host ?? this).render(); }
    });
    this.writes = run;
    return run;
  }
  async _prepareContext() {
    const camp = campOf(this.party), manager = Party.canManage(this.party);
    if (!camp) return { title: this.party.name, manager, empty: true, error: this.error };
    const setup = camp.phase === "setup", fuel = camp.phase === "fuel", plan = campTorchPlan(this.party, camp);
    const { campContext } = await import("../overland/overland.mjs");
    const context = campContext(), food = foodPreview(this.party, camp, camp.each ?? context.each, camp.day ?? context.day);
    this.fuelPreview = plan.deductions;
    return { title: this.party.name, manager, setup, fuel, isGM: game.user.isGM, error: this.error,
      phase: t(CAMP_LABELS.phase[camp.phase]), fire: t(camp.fire?.lit ? "SDE.camping.fireLit" : "SDE.camping.noFire"), hasResults: Object.keys(camp.results).length > 0,
      awaitingRest: camp.phase === "awaitingRest", complete: camp.phase === "complete", shortageWarning: camp.shortageWarning,
      canNight: manager && camp.phase === "awaitingRest", canResolve: manager && setup, canResume: manager && (camp.phase === "complete" ? !game.messages.has(camp.reportId) : !setup && !fuel && camp.phase !== "awaitingRest"),
      fuelChoices: ["none", "wood", "torches"].map(value => ({ value, label: t(CAMP_LABELS.fuel[value]), selected: camp.fuel === value })),
      available: plan.available, canFuel: manager && plan.ok,
      deductions: plan.deductions.map(d => { const a = game.actors.contents.find(a => a.uuid === d.actorUuid); return { ...d, name: a?.name, item: a?.items.get(d.id)?.name }; }),
      mounts: (camp.mounts ?? []).map(p => {
        const actor = game.actors.contents.find(a => a.uuid === p.uuid), meal = food.find(f => f.actorId === p.actorId);
        return { ...p, meal, name: actor?.name ?? t("SDE.party.missing"), foodStatus: t(meal.fed ? "SDE.camping.fed" : "SDE.camping.unfed"), deathWarning: !meal.fed && meal.con <= (meal.saved ? 0 : 1) };
      }),
      rows: camp.participants.map(p => {
        const actor = game.actors.contents.find(a => a.uuid === p.uuid), task = camp.tasks.find(t => t.key === p.task), result = camp.results[p.actorId];
        const description = task?.descriptionKey ? t(task.descriptionKey) : task?.description;
        const meal = food.find(f => f.actorId === p.actorId);
        return { ...p, meal,
          foodStatus: t(meal.fed ? "SDE.camping.fed" : "SDE.camping.unfed"), deathWarning: !meal.fed && meal.con <= (meal.saved ? 0 : 1),
          restStatus: meal.rest === null ? null : t(meal.rest ? "SDE.camping.rested" : "SDE.camping.noRest"),
          name: actor?.name ?? t("SDE.party.missing"), editable: setup && !!actor?.testUserPermission(game.user, "OWNER"),
          tasks: [{ key: "", name: t("SDE.camping.noTask"), selected: !p.task }, ...camp.tasks.map(v => ({ key: v.key, name: v.name ?? t(v.label), selected: p.task === v.key }))],
          abilities: (task?.abilities ?? []).map(value => ({ value, label: value.toUpperCase(), selected: p.ability === value })),
          dc: task?.dc, taskName: task?.name ?? (task ? t(task.label) : t("SDE.camping.noTask")), description, campfire: !!task?.campfire,
          craftTask: p.task === "craft", entertainTask: p.task === "entertain", watchTask: p.task === "keepWatch", repair: p.craft === "repair",
          outputs: ["torch", "arrows", "bolts", "slingStones", "repair"].map(value => ({ value, label: t(CAMP_LABELS.gear[value]), selected: p.craft === value })),
          repairs: actor?.items.filter(i => i.id === p.repairItemId || (i.system.isPhysical && i.system.broken && !i.system.magicItem)).map(i => ({ id: i.id, name: i.name, selected: p.repairItemId === i.id })) ?? [],
          recipients: camp.participants.filter(v => v.uuid !== p.uuid).map(v => ({ uuid: v.uuid, name: game.actors.contents.find(a => a.uuid === v.uuid)?.name, selected: p.recipientUuid === v.uuid })),
          halves: ["first", "second"].map(value => ({ value, label: t(CAMP_LABELS.half[value]), selected: p.watchHalf === value })),
          result: result ? { ...result, status: t(result.success ? "SDE.camping.success" : "SDE.camping.failure"), effect: t(CAMP_LABELS.effect[camp.effects[p.actorId] ?? "pending"]) } : null,
        };
      }),
    };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.bindControls(this.element);
  }
  bindControls(root) {
    for (const el of root.querySelectorAll("[data-choice]")) el.addEventListener("change", () => {
      const row = el.closest("[data-uuid]");
      const patch = { [el.dataset.choice]: el.type === "checkbox" ? el.checked : el.value };
      void this.change("select", { uuid: row.dataset.uuid, patch });
    });
    root.querySelector("[data-fuel]")?.addEventListener("change", event => { void this.change("fuelChoice", { fuel: event.target.value }); });
    for (const el of root.querySelectorAll("[data-dc]")) el.addEventListener("change", () => { void this.change("dc", { task: el.dataset.dc, dc: Number(el.value) }); });
  }
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.hooks = ["updateActor", "updateItem", "createItem", "deleteItem"].map(name => [name, Hooks.on(name, () => this.render())]);
  }
  _onClose(options) { for (const [name, id] of this.hooks ?? []) Hooks.off(name, id); return super._onClose(options); }
}
