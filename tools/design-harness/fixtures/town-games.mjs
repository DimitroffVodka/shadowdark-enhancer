// A town's games table. state = idle | win | lose | closed (add -full for the whole window). Built with the window's own rules and strings from sample data.
// Real window: 640 x 720, ApplicationV2.
import { BET_KEYS, GAME_ICONS, GAME_IDS, GAME_KEYS, ROULETTE_BETS, SIDES, SIDE_KEYS, wagerFromSp } from "../../../scripts/town/games-core.mjs";
import { formatPrice, fromCopper } from "../../../scripts/shared/coins.mjs";
import { purseText } from "../../../scripts/town/town-view.mjs";
import { COINS, t } from "./_town.mjs";

const toolbar = `<span>State:</span>${["idle", "win", "win-full", "lose", "closed"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const MAX_BET = 10, EDGE = 5, WAGER_SP = 10;
const LAST = {
  win: { game: t(GAME_KEYS.duel.name), tone: "good", lines: ["Creeg Greythorn rolled 9; the house rolled 5.", "Creeg Greythorn wins 9 sp 5 cp."] },
  lose: { game: t(GAME_KEYS.wheel.name), tone: "bad", lines: ["Creeg Greythorn spun 31: Bust.", "Creeg Greythorn loses 1 gp."] },
};
const build = (state) => {
  const full = state.endsWith("-full"), s = state.replace("-full", "");
  const maxSp = MAX_BET * 10;
  return {
    toolbar, ...(full ? { height: 1260 } : {}),
    context: {
      townName: "Hollowmere", open: s !== "closed", purse: purseText(COINS), maxBet: formatPrice(fromCopper(MAX_BET * 100)), edge: EDGE, maxSp, wagerSp: WAGER_SP,
      wagerText: formatPrice(fromCopper(wagerFromSp(WAGER_SP))),
      chips: [{ sp: 1, label: "1 sp" }, { sp: 10, label: "1 gp" }, { sp: 50, label: "5 gp" }, { sp: maxSp, label: t("SDE.town.games.max") }],
      games: GAME_IDS.map((id) => ({
        id, icon: GAME_ICONS[id], name: t(GAME_KEYS[id].name), rules: t(GAME_KEYS[id].rules), odds: t(GAME_KEYS[id].odds),
        picks: id === "coin" ? SIDES.map((s) => ({ id: s, label: t(SIDE_KEYS[s]) }))
          : id === "roulette" ? ROULETTE_BETS.map((b) => ({ id: b, label: t(BET_KEYS[b]) })) : null,
        numberBet: id === "roulette",
      })),
      number: 7, numberMax: 20,
      last: LAST[s] ?? null, hasPlayer: true,
      actors: [{ id: "a", name: "Creeg Greythorn", selected: true }, { id: "b", name: "Elbin Grizzlegut", selected: false }],
    },
  };
};
export default {
  previewHeight: 720, title: "Games of chance", icon: "fa-solid fa-dice", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-games"], resizable: true, width: 640, height: 720,
  template: "templates/town/town-games.hbs", initial: "idle", toolbar, actions: { s: { state: "{state}" } }, build,
};
