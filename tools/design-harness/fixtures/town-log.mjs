// The GM's sales log. state = town | game | empty (add -loss for a night the town lost money). Built with the window's own
// row and total functions from sample cards. Real window: 660 x 720, ApplicationV2.
import { formatPrice, fromCopper } from "../../../scripts/shared/coins.mjs";
import { entriesFrom, filterEntries, logFlag, logRows, placesIn, totals } from "../../../scripts/town/town-log-core.mjs";
import { t } from "./_town.mjs";

const MOD = "shadowdark-enhancer";
const NOW = Date.UTC(2026, 9, 16, 19, 40);
const card = (n, minutesAgo, flag) => ({ id: `c${n}`, timestamp: NOW - minutesAgo * 60000, flags: { [MOD]: { townLog: logFlag({ sceneId: "s1", ...flag }) } } });
const CARDS = [
  card(1, 4, { kind: "game", placeId: "wheel", place: "Hollowmere", charId: "a", charName: "Creeg Greythorn", what: "Fortune wheel", net: -100, wager: 100, result: "lose" }),
  card(2, 9, { kind: "game", placeId: "duel", place: "Hollowmere", charId: "b", charName: "Elbin Grizzlegut", what: "Dice duel", net: 95, wager: 100, result: "win" }),
  card(3, 22, { kind: "buy", placeId: "m1", place: "Hargrave the Smith", charId: "a", charName: "Creeg Greythorn", what: "Longsword", net: -990 }),
  card(4, 31, { kind: "sell", placeId: "m1", place: "Hargrave the Smith", charId: "a", charName: "Creeg Greythorn", what: "Dagger, notched", net: 55 }),
  card(5, 47, { kind: "buy", placeId: "m3", place: "The Gilded Flagon", charId: "b", charName: "Elbin Grizzlegut", what: "Rations (3 days)", qty: 4, net: -200 }),
  card(6, 60, { kind: "game", placeId: "coin", place: "Hollowmere", charId: "b", charName: "Elbin Grizzlegut", what: "Coin toss", net: 0, wager: 50, result: "push" }),
  card(7, 95, { kind: "buy", placeId: "m2", place: "Ysolde Vane", charId: "a", charName: "Creeg Greythorn", what: "Chainmail", net: -6600 }),
  card(8, 130, { kind: "game", placeId: "wheel", place: "Hollowmere", charId: "a", charName: "Creeg Greythorn", what: "Fortune wheel", net: 855, wager: 100, result: "win" }),
];
const toolbar = `<span>State:</span>${["town", "game", "empty", "town-loss"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const price = (c) => formatPrice(fromCopper(Math.abs(c)));
const when = new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
const build = (state) => {
  const loss = state.endsWith("-loss"), s = state.replace("-loss", "");
  const all = s === "empty" ? [] : entriesFrom(CARDS);
  const here = filterEntries(all, { sceneId: "s1" });
  const shown = filterEntries(here, { kind: s === "game" ? "game" : "" });
  const sum = totals(loss ? shown.filter((e) => e.net > 0 || e.kind !== "buy") : shown);
  return {
    toolbar,
    context: {
      townName: "Hollowmere", scopeTown: true, hasScene: true,
      kinds: [["", "SDE.town.log.kindAll"], ["buy", "SDE.town.log.kindBuy"], ["sell", "SDE.town.log.kindSell"], ["game", "SDE.town.log.kindGame"]].map(([id, key]) => ({ id, label: t(key), on: id === (s === "game" ? "game" : "") })),
      places: placesIn(here).map((p) => ({ ...p, selected: false })),
      paidIn: price(sum.paidIn), paidOut: price(sum.paidOut), kept: `${sum.kept < 0 ? "−" : ""}${price(sum.kept)}`, keptLoss: sum.kept < 0, count: sum.count,
      rows: logRows(shown, { t, price, when: (at) => when.format(new Date(at)) }),
    },
  };
};
export default {
  previewHeight: 720, title: "Sales log", icon: "fa-solid fa-receipt", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-log"], resizable: true, width: 660, height: 720,
  template: "templates/town/town-log.hbs", initial: "town", toolbar, actions: { s: { state: "{state}" } }, build,
};
