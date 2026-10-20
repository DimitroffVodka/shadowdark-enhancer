// A round of the death roll at a town table. state = start | pre | offered | doubled | won | lost | collect.
// Built with the real engine and view model, so what is drawn is what the window draws. Real window: 640 x 600, ApplicationV2.
import { applyDeath, newDeath } from "../../../scripts/town/death-core.mjs";
import { deathView } from "../../../scripts/town/death-view.mjs";
import { purseText } from "../../../scripts/town/town-view.mjs";
import { COINS, t } from "./_town.mjs";

const STATES = ["start", "pre", "offered", "doubled", "won", "lost", "collect"];
const toolbar = `<span>State:</span>${STATES.map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const UNIT = 100, NAME = "Creeg Greythorn", EDGE = 5;
const act = (s, ...moves) => moves.reduce((acc, [who, action]) => applyDeath(acc, who, typeof action === "string" ? { type: action } : action), s);
const open = () => act(newDeath({ unit: UNIT }), ["house", "skip"]);

function table(state) {
  switch (state) {
    case "pre": return { round: act(open(), ["you", { type: "roll", n: 57 }]), settled: false };
    case "offered": return { round: act(open(), ["you", { type: "roll", n: 38 }], ["you", "skip"], ["house", { type: "roll", n: 3 }], ["house", "double"]), settled: false };
    case "doubled": return { round: act(open(), ["you", { type: "roll", n: 61 }], ["you", "skip"], ["house", { type: "roll", n: 12 }], ["house", "double"], ["you", "take"]), settled: false };
    case "won": return { round: act(open(), ["you", { type: "roll", n: 57 }], ["you", "skip"], ["house", { type: "roll", n: 1 }]), settled: true };
    case "lost": return { round: act(open(), ["you", { type: "roll", n: 61 }], ["you", "skip"], ["house", { type: "roll", n: 12 }], ["house", "double"], ["you", "take"], ["you", { type: "roll", n: 1 }]), settled: true };
    case "collect": return { round: act(open(), ["you", { type: "roll", n: 57 }], ["you", "skip"], ["house", { type: "roll", n: 1 }]), settled: false };
    default: return { round: open(), settled: false };
  }
}

const build = (state) => {
  const view = deathView(table(state), { name: NAME, purse: 55000, edge: EDGE, loc: t });
  return { toolbar, context: { ...view, townName: "Hollowmere", purse: purseText(COINS), playerName: NAME } };
};
export default {
  previewHeight: 600, title: "Games of chance", icon: "fa-solid fa-skull", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-death"], resizable: true, width: 640, height: 600,
  template: "templates/town/town-death.hbs", initial: "start", toolbar, actions: { s: { state: "{state}" } }, build,
};
