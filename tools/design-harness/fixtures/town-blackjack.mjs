// A hand of blackjack at a town table. state = start | soft | split | won | blackjack | bust | collect.
// Built with the real engine and view model, so what is drawn is what the window draws. Real window: 640 x 640, ApplicationV2.
import { applyBlackjack, newRound } from "../../../scripts/town/blackjack-core.mjs";
import { blackjackView } from "../../../scripts/town/blackjack-view.mjs";
import { purseText } from "../../../scripts/town/town-view.mjs";
import { COINS, t } from "./_town.mjs";

const STATES = ["start", "soft", "split", "won", "blackjack", "bust", "collect"];
const toolbar = `<span>State:</span>${STATES.map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const UNIT = 100, NAME = "Creeg Greythorn", EDGE = 5;
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"], SUITS = "SHDC";
const card = (name) => SUITS.indexOf(name.slice(-1)) * 13 + RANKS.indexOf(name.slice(0, -1));
/** Deals `names` in order: the player's first card, the dealer's up card, the player's second, the dealer's hole card, then the draws. */
const deal = (...names) => newRound({ unit: UNIT, deck: [...names, "2C", "2D", "2H", "2S"].reverse().map(card) });
const play = (round, ...moves) => moves.reduce((r, type) => applyBlackjack(r, type), round);

function table(state) {
  switch (state) {
    case "soft": return { round: deal("AS", "9H", "6D", "7C", "4S"), settled: false };
    case "split": return { round: play(deal("8S", "10H", "8D", "7C", "3S", "2H", "10D"), "split"), settled: false };
    case "won": return { round: play(deal("KS", "6H", "QD", "10C", "9S"), "stand"), settled: true };
    case "blackjack": return { round: deal("AS", "6H", "KD", "5C"), settled: true };
    case "bust": return { round: play(deal("10S", "7H", "6D", "9C", "KD"), "hit"), settled: true };
    case "collect": return { round: play(deal("KS", "6H", "QD", "10C", "9S"), "stand"), settled: false };
    default: return { round: deal("8S", "10H", "8D", "7C", "3S"), settled: false };
  }
}

const build = (state) => {
  const view = blackjackView(table(state), { name: NAME, purse: 55000, edge: EDGE, loc: t });
  return { toolbar, context: { ...view, townName: "Hollowmere", purse: purseText(COINS), playerName: NAME } };
};
export default {
  previewHeight: 640, title: "Games of chance", icon: "fa-solid fa-diamond", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-blackjack"], resizable: true, width: 640, height: 640,
  template: "templates/town/town-blackjack.hbs", initial: "start", toolbar, actions: { s: { state: "{state}" } }, build,
};
