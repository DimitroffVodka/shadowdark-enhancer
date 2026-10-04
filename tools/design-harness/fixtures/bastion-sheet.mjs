// The Bastion sheet (ApplicationV2 at runtime) as a GM sees it: a Keep with eight upgrades built or building, a vault,
// a trophy room, an aviary, three shops, a log. State comes from the real rules (bastion-core.mjs) and the plan from the
// real renderPlan; only game.i18n is stubbed with languages/en.json. The sprite sheet the sheet loads at runtime is put
// in the harness toolbar so the room art draws.
//   state: <tab>[.<view>[.roofs]]  tab = overview | upgrades | plan | log   view = ext | in
import { readFileSync } from "node:fs";
const en = JSON.parse(readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));
const fill = (s, d = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => d[k] ?? m);
globalThis.game = { i18n: { localize: (k) => en[k] ?? k, format: (k, d) => fill(en[k] ?? k, d) } };
const core = await import("../../../scripts/bastion/bastion-core.mjs");
const { renderPlan } = await import("../../../scripts/bastion/bastion-plan.mjs");
const { t, format, logText } = await import("../../../scripts/bastion/bastion-text.mjs");
const { openShops } = await import("../../../scripts/bastion/bastion-shop-core.mjs");
const sprites = readFileSync(new URL("../../../assets/bastion/sprites.svg", import.meta.url), "utf8");

const ups = [["barracks", 0], ["blacksmith", 0], ["library", 0], ["stable", 0], ["trophy-room", 0], ["vault", 0], ["aviary", 0], ["wizard-tower", 2], ["granary", 1]].map(([id, weeksLeft], slot) => ({ id, slot, weeksLeft }));
const state = { ...core.newBastion("keep"), weeksLeft: 0, week: 14, hp: { value: 82 }, treasury: 240, upgrades: ups, trophies: ["Black dragon scale", "Gnoll chieftain's banner"], pigeonDay: null,
  log: [["SDE.bastion.log.raised", { type: "SDE.bastion.type.keep.name" }], ["SDE.bastion.log.buildDone", { upgrade: "SDE.bastion.upgrade.library.name" }], ["SDE.bastion.log.dragon", {}], ["SDE.bastion.log.damaged", { amount: 18 }], ["SDE.bastion.log.quietMonth", { d6: 4 }], ["SDE.bastion.log.buildStarted", { upgrade: "SDE.bastion.upgrade.wizardTower.name", cost: 400 }]].map(([key, data], i) => ({ week: 8 + i * 1, key, data })) };
const TABS = ["overview", "upgrades", "plan", "log"];

const build = (s) => {
  const [tab = "overview", view = "ext", roofs] = (s ?? "overview").split(".");
  const st = core.stats(state), fx = core.effects(state);
  const plan = renderPlan({ type: state.type, slots: st.slots, upgrades: state.upgrades, built: st.standing, name: "Ashdown Keep", view, roofs: !!roofs,
    label: (id) => { const u = core.upgradeOf(id); return `${t(u.name)}: ${t(u.effect)}`; }, t });
  return {
    context: {
      gm: true, editable: true, document: { name: "Ashdown Keep", img: "/modules/shadowdark-enhancer/assets/bastion/art/keep.svg" },
      tab: Object.fromEntries(TABS.map((id) => [id, id === tab])), system: { treasury: state.treasury, notes: "The party's seat in the Western Reaches. Lord Ashdown holds the north gate." },
      types: core.BASTION_TYPES.map((ty) => ({ id: ty.id, name: t(ty.name), selected: ty.id === state.type, line: format("SDE.bastion.type.line", { cost: ty.cost, ac: ty.ac, hp: ty.hp, slots: ty.slots }) })),
      type: { name: t(st.type.name), blurb: t(st.type.blurb), cost: st.type.cost, weeks: st.type.weeks },
      stats: { ac: st.ac, hp: st.hp, maxHp: st.maxHp, used: st.used, slots: st.slots, breached: false, standing: true, repairCost: 18, worth: core.worth(state), weeksLeft: 0, week: state.week, repairing: true },
      upgrades: core.BASTION_UPGRADES.map((u) => { const have = state.upgrades.find((x) => x.id === u.id); const check = core.canBuild(state, u.id);
        return { id: u.id, name: t(u.name), effect: t(u.effect), cost: u.cost, isBuilt: !!have && have.weeksLeft <= 0, isBuilding: !!have && have.weeksLeft > 0, isNone: !have, weeksLeft: have?.weeksLeft ?? 0, canBuild: check.ok, why: check.ok ? "" : t("SDE.bastion.why." + check.reason) }; }),
      vault: { shown: true, open: true, used: 7, max: 100, items: [["Rope, 60'", 1, 1], ["Longsword", 2, 2], ["Potion of healing", 3, 1], ["Crate of crossbow bolts", 1, 3]].map(([name, quantity, slots], i) => ({ id: "v" + i, name, img: "/icons/svg/item-bag.svg", quantity, slots })) },
      shops: openShops({ armorer: true, blacksmith: true, tradingPost: true }).map((sh) => ({ id: sh.id, name: t(sh.name) })),
      aviary: { open: true, flown: false }, trophyRoom: fx.trophyRoom, trophies: state.trophies.map((name, index) => ({ name, index })),
      log: state.log.map((e) => ({ week: e.week, text: logText(e) })).reverse(),
      plan: { markup: plan.markup, viewBox: plan.viewBox }, parties: [{ uuid: "Actor.p", name: "The Lantern Guild", selected: true }],
      view: { ext: view === "ext", in: view === "in" }, roofs: !!roofs, enrichedNotes: "<p>The party's seat.</p>",
    },
    toolbar: `<span>State:</span>${TABS.map((id) => `<button data-action="changeTab" data-tab="${id}">${id}</button>`).join("")}<button data-action="setView" data-view="ext">exterior</button><button data-action="setView" data-view="in">interior</button><button data-action="toggleRoofs">roofs</button>${sprites}`,
  };
};
export default {
  previewHeight: 800, title: "Ashdown Keep", icon: "fa-solid fa-chess-rook", classes: ["shadowdark", "sheet", "shadowdark-enhancer", "sde-bastion-sheet"],
  width: 980, height: 760, resizable: true, template: "templates/actors/bastion-sheet.hbs", initial: "overview", build,
  actions: { changeTab: { state: "{tab}.{1}.{2}" }, setView: { state: "{0}.{view}.{2}" }, toggleRoofs: { state: "{0}.{1}.{2|}" } },
};
