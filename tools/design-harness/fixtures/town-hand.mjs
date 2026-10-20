// A hand of Beholder's Bluff or Brag at a town table. state = bluff-reveal | bluff-bet | bluff-win | brag-draw | brag-bet | brag-lose | collect.
// Built with the real engine and view model from fixed dice, so what is drawn is what the window draws. Real window: 640 x 720, ApplicationV2.
import { apply, newHand } from "../../../scripts/town/hand-core.mjs";
import { handView } from "../../../scripts/town/hand-view.mjs";
import { COINS, t } from "./_town.mjs";
import { purseText } from "../../../scripts/town/town-view.mjs";

const STATES = ["bluff-reveal", "bluff-bet", "bluff-win", "brag-draw", "brag-bet", "brag-lose", "collect"];
const toolbar = `<span>State:</span>${STATES.map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const UNIT = 100, NAME = "Creeg Greythorn", EDGE = 5;

const step = (h, you, house) => apply(apply(h, "you", you), "house", house);
const play = (h, ...moves) => moves.reduce((acc, [who, type]) => apply(acc, who, { type }), h);
const reveal = (idx, other = 0) => [{ type: "reveal", idx }, { type: "reveal", idx: other }];
const keep = [{ type: "draw", idx: [], values: [] }, { type: "draw", idx: [], values: [] }];

function table(state) {
  const bluff = () => newHand("bluff", { unit: UNIT, you: [10, 9, 8, 2], house: [7, 6, 5, 3] });
  const brag = () => newHand("brag", { unit: UNIT, you: [4, 5, 2], house: [1, 3, 5] });
  switch (state) {
    case "bluff-reveal": return { hand: bluff(), settled: false };
    case "bluff-bet": return { hand: step(bluff(), ...reveal(0, 0)), settled: false };
    case "bluff-win": {
      let h = step(bluff(), ...reveal(0, 0));
      h = play(h, ["you", "bet"], ["house", "call"]);
      h = play(step(h, ...reveal(1, 1)), ["house", "check"], ["you", "check"]);
      h = play(step(h, ...reveal(2, 2)), ["you", "check"], ["house", "check"]);
      return { hand: h, settled: true };
    }
    case "brag-draw": return { hand: brag(), settled: false };
    case "brag-bet": return { hand: step(brag(), { type: "draw", idx: [2], values: [6] }, { type: "draw", idx: [0], values: [5] }), settled: false };
    case "brag-lose": {
      let h = step(brag(), ...keep);
      h = play(h, ["you", "bet"], ["house", "raise"], ["you", "call"]);
      h = play(step(h, ...keep), ["house", "check"], ["you", "check"]);
      return { hand: h, settled: true };
    }
    default: return { hand: play(step(bluff(), ...reveal(0, 0)), ["you", "bet"], ["house", "fold"]), settled: false };
  }
}

const build = (state) => {
  const view = handView(table(state), { name: NAME, purse: 55000, picked: state === "bluff-reveal" ? [0] : state === "brag-draw" ? [0, 1] : [], edge: EDGE, loc: t });
  return { toolbar, context: { ...view, townName: "Hollowmere", purse: purseText(COINS), playerName: NAME } };
};
export default {
  previewHeight: 720, title: "Games of chance", icon: "fa-solid fa-dice", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-hand"], resizable: true, width: 640, height: 720,
  template: "templates/town/town-hand.hbs", initial: "bluff-reveal", toolbar, actions: { s: { state: "{state}" } }, build,
};
