// The roulette board at a town table. state = empty | laid | won | lost.
// Built with the real board and view model, so what is drawn is what the window draws. Real window: 640 x 720, ApplicationV2.
import { spinBoard } from "../../../scripts/town/roulette-core.mjs";
import { rouletteLines, rouletteView } from "../../../scripts/town/roulette-view.mjs";
import { purseText } from "../../../scripts/town/town-view.mjs";
import { COINS, t } from "./_town.mjs";

const STATES = ["empty", "laid", "won", "lost"];
const toolbar = `<span>State:</span>${STATES.map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const NAME = "Creeg Greythorn", EDGE = 5, MAX_BET = 10;
const BETS = { even: 2, 17: 1, high: 1 };

function table(state) {
  if (state === "empty") return { bets: {}, chip: 100, last: null };
  if (state === "laid") return { bets: BETS, chip: 100, last: null };
  const out = spinBoard({ bets: BETS, chip: 100, d20: state === "won" ? 17 : 4, edge: EDGE });
  return { bets: BETS, chip: 100, last: { ...out, lines: rouletteLines(out, NAME, t), tone: out.result === "win" ? "good" : "bad" } };
}

const build = (state) => {
  const view = rouletteView(table(state), { name: NAME, maxBet: MAX_BET, loc: t });
  return { toolbar, context: { ...view, townName: "Hollowmere", purse: purseText(COINS), playerName: NAME } };
};
export default {
  previewHeight: 720, title: "Games of chance", icon: "fa-solid fa-bullseye", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-roulette"], resizable: true, width: 640, height: 720,
  template: "templates/town/town-roulette.hbs", initial: "laid", toolbar, actions: { s: { state: "{state}" } }, build,
};
