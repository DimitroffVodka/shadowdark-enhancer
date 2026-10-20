// A town's games table. state = idle | win | lose | closed | idle-tables | rules | setup | setup-open | lobby-host | lobby-guest | joining |
// table-open | table-bid | table-wait | table-reveal | table-out | table-over | cancelled (add -full for a taller window, -tall for the tallest).
// Built with the window's own rules, view models and strings from sample data.
// Real window: 640 x 720, ApplicationV2.
import { GAME_ICONS, GAME_KEYS, LIARS, SIDES, SIDE_KEYS, TABLE_GAMES, wagerFromSp } from "../../../scripts/town/games-core.mjs";
import { lobbyView, setupView, tableView, tablesView } from "../../../scripts/town/liars-dice-view.mjs";
import { formatPrice, fromCopper } from "../../../scripts/shared/coins.mjs";
import { purseText } from "../../../scripts/town/town-view.mjs";
import { ACTOR, COINS, t } from "./_town.mjs";

const STATES = ["idle", "win", "lose", "closed", "idle-tables", "rules", "setup", "setup-open", "lobby-host", "lobby-guest", "joining", "table-open", "table-bid", "table-wait", "table-reveal", "table-out", "table-over", "cancelled"];
const toolbar = `<span>State:</span>${STATES.map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const MAX_BET = 10, EDGE = 5, WAGER_SP = 10;
const LAST = {
  win: { game: t(GAME_KEYS.duel.name), tone: "good", lines: ["Creeg Greythorn rolled 9; the house rolled 5.", "Creeg Greythorn wins 9 sp 5 cp."] },
  lose: { game: t(GAME_KEYS.wheel.name), tone: "bad", lines: ["Creeg Greythorn spun 31: Bust.", "Creeg Greythorn loses 1 gp."] },
  "table-over": { game: t(GAME_KEYS[LIARS].name), tone: "bad", lines: ["Brannoch wins the match.", "Creeg Greythorn loses 1 gp."] },
};

// ─── a Liar's Dice table of four, as one person's client holds it ──────────────────────────────────────────────────
const TOWN = { name: "Hollowmere", sceneId: "s1", edge: EDGE };
const seat = (id, name, dice, ai = false, you = false) => ({ id, name, ai, dice, out: dice === 0, you });
const SEATS = [seat("me", ACTOR, 4, false, true), seat("ai1", "Brannoch", 3, true), seat("u2", "Elbin Grizzlegut", 5), seat("ai2", "Old Mags", 2, true)];
const HANDS = { me: [1, 2, 5, 6, 6], ai1: [2, 3, 3, 4], u2: [1, 4, 4, 5, 6], ai2: [5, 6] };
/** A round that was called: `count` showing of `bid`, `loser` a die down. */
const call = (round, caller, bid, count, loser, dice) => ({ t: "call", round, caller, bid, count, held: count >= bid.qty, loser, hands: HANDS, dice });
const EARLIER = [
  { t: "bid", who: "me", qty: 2, face: 5, round: 1 }, { t: "bid", who: "ai1", qty: 3, face: 5, round: 1 },
  call(1, "u2", { qty: 3, face: 5, by: "ai1" }, 4, "u2", { me: 5, ai1: 4, u2: 5, ai2: 5 }),
  call(2, "ai2", { qty: 4, face: 6, by: "me" }, 3, "me", { me: 4, ai1: 4, u2: 5, ai2: 5 }),
];
const base = { id: "T1", hostId: "me", phase: "playing", ante: 100, town: TOWN, total: 4, pot: 400, me: "me", isHost: true, round: 3, bid: null, turn: "me", winner: null, result: null, seats: SEATS, hand: HANDS.me.slice(0, 4), log: EARLIER };
const bid = (who, qty, face) => ({ t: "bid", who, qty, face, round: 3 });
const VIEWS = {
  "table-open": base,
  "table-bid": { ...base, bid: { qty: 3, face: 4, by: "u2" }, log: [...EARLIER, bid("ai1", 2, 3), bid("u2", 3, 4)] },
  "table-wait": { ...base, bid: { qty: 2, face: 3, by: "me" }, turn: "ai2", log: [...EARLIER, bid("me", 2, 3)] },
  "table-reveal": { ...base, round: 4, bid: null, turn: "me", seats: [seat("me", ACTOR, 3, false, true), SEATS[1], SEATS[2], SEATS[3]], hand: [2, 4, 6], log: [...EARLIER, bid("me", 2, 3), call(3, "ai1", { qty: 2, face: 3, by: "me" }, 4, "ai1", { me: 4, ai1: 2, u2: 5, ai2: 2 })].map((e) => (e.t === "call" && e.round === 3 ? { ...e, dice: { me: 3, ai1: 3, u2: 5, ai2: 2 }, loser: "me", caller: "ai1", held: true } : e)) },
  "table-out": { ...base, seats: [seat("me", ACTOR, 0, false, true), seat("ai1", "Brannoch", 3, true), seat("u2", "Elbin Grizzlegut", 4), seat("ai2", "Old Mags", 2, true)], hand: null, turn: "u2", bid: { qty: 2, face: 5, by: "ai1" }, log: [...EARLIER, bid("ai1", 2, 5)] },
  "table-over": { ...base, turn: null, winner: "ai1", seats: [seat("me", ACTOR, 0, false, true), seat("ai1", "Brannoch", 2, true), seat("u2", "Elbin Grizzlegut", 0), seat("ai2", "Old Mags", 0, true)], hand: null, round: 9, result: { winner: "ai1" }, log: [...EARLIER, call(8, "ai1", { qty: 2, face: 6, by: "me" }, 1, "ai1", { me: 0, ai1: 2, u2: 0, ai2: 0 })] },
};
const LOBBY = { id: "T1", hostId: "me", phase: "lobby", ante: 100, town: TOWN, total: 4, pot: 400, me: "me", isHost: true, free: 1, slots: [{ kind: "human", id: "me", name: ACTOR, host: true, you: true }, { kind: "human", id: "u2", name: "Elbin Grizzlegut", host: false, you: false }, { kind: "open" }, { kind: "ai" }] };
const TABLES = [{ id: "a", hostName: "Elbin Grizzlegut", ante: 100, town: { name: "Hollowmere" }, free: 2, total: 4 }, { id: "b", hostName: "Hiralia", ante: 500, town: { name: "Hollowmere" }, free: 1, total: 3 }];

const build = (state) => {
  const tall = state.endsWith("-tall"), full = tall || state.endsWith("-full"), s = state.replace(/-(full|tall)$/, "");
  const maxSp = MAX_BET * 10;
  const screen = { rules: "rules", setup: "setup", "setup-open": "setup", "lobby-host": "lobby", "lobby-guest": "lobby", joining: "joining", cancelled: "cancelled" }[s] ?? (s.startsWith("table") ? "table" : null);
  const view = VIEWS[s];
  const setup = s === "setup" ? { ai: 1, humans: 0 } : s === "setup-open" ? { ai: 2, humans: 1 } : null;
  const lobby = s === "lobby-host" ? LOBBY : s === "lobby-guest" ? { ...LOBBY, isHost: false, slots: LOBBY.slots.map((x) => (x.id === "me" ? { ...x, host: false } : x.id === "u2" ? { ...x, host: true } : x)) } : null;
  return {
    toolbar, ...(full ? { height: tall ? 1500 : 1260 } : {}),
    context: {
      townName: "Hollowmere", open: s !== "closed", purse: purseText(COINS), maxBet: formatPrice(fromCopper(MAX_BET * 100)), edge: EDGE, maxSp, wagerSp: WAGER_SP,
      wagerText: formatPrice(fromCopper(wagerFromSp(WAGER_SP))),
      chips: [{ sp: 1, label: "1 sp" }, { sp: 10, label: "1 gp" }, { sp: 50, label: "5 gp" }, { sp: maxSp, label: t("SDE.town.games.max") }],
      games: TABLE_GAMES.map((id) => ({
        id, icon: GAME_ICONS[id], name: t(GAME_KEYS[id].name), rules: t(GAME_KEYS[id].rules), odds: t(GAME_KEYS[id].odds), rulesBtn: id === LIARS,
        picks: id === "coin" ? SIDES.map((side) => ({ id: side, label: t(SIDE_KEYS[side]) })) : null,
      })),
      screen, isScreen: { [screen ?? "list"]: true },
      setup: setup && setupView(setup, wagerFromSp(WAGER_SP), t),
      lobby: lobby && lobbyView(lobby, t),
      match: view && tableView(view, null, t),
      tables: s === "idle-tables" ? tablesView(TABLES, t) : [],
      last: LAST[s] ?? null, hasPlayer: true, atTable: !!screen,
      actors: [{ id: "a", name: ACTOR, selected: true }, { id: "b", name: "Elbin Grizzlegut", selected: false }],
    },
  };
};
export default {
  previewHeight: 720, title: "Games of chance", icon: "fa-solid fa-dice", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-games"], resizable: true, width: 640, height: 720,
  template: "templates/town/town-games.hbs", initial: "idle", toolbar, actions: { s: { state: "{state}" } }, build,
};
