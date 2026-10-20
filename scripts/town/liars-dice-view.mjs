/**
 * Shadowdark Enhancer — what a Liar's Dice table shows (pure view models; the window and the chat card both read these).
 *
 * `loc` localizes (a `(key, data) => string`); `names` maps a seat id to what the lines should call it. The view of a table
 * (`viewFor` in liars-dice-table.mjs) holds only what this person may see, and nothing here adds to it: another seat's
 * dice are only ever listed in a round's reveal, which the call that ended the round put in the log.
 */
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { FACES, MAX_SEATS, WILD, canBid, minRaise, raisesFrom } from "./liars-dice-core.mjs";

/** A bid in words: "3 × 5s". */
export const bidText = (bid, loc) => loc("SDE.town.games.liars.bid", { qty: bid.qty, face: bid.face });

/** One finished round in a line: who bid, who called, how many were showing, who lost a die. */
export const roundLine = (call, names, loc) => loc("SDE.town.games.liars.round", {
  round: call.round, bidder: names[call.bid.by], bid: bidText(call.bid, loc), caller: names[call.caller], count: call.count, loser: names[call.loser],
});

/** What the log says in lines: each round that was called (and who it put out), and each seat that walked away. */
export function eventLines(log, names, loc) {
  return log.flatMap((e) => {
    if (e.t === "forfeit") return [loc("SDE.town.games.liars.left", { who: names[e.seat] })];
    if (e.t !== "call") return [];
    return e.dice[e.loser] === 0 ? [roundLine(e, names, loc), loc("SDE.town.games.liars.out", { who: names[e.loser] })] : [roundLine(e, names, loc)];
  });
}

/** The names of the seats at a table, by id. */
export const namesOf = (view) => Object.fromEntries((view.seats ?? []).map((x) => [x.id, x.name]));

/** The bid the player has dialed in, or the smallest raise when none is (null when nothing outranks the table). It need not beat the table until it is placed. */
export const pickFor = (view, pick) => pick ?? minRaise({ bid: view.bid, seats: view.seats });

const dieOf = (face, bidFace) => ({ face, wild: face === WILD, hit: face === bidFace || face === WILD });

/** One of the other seats: its cups (a count, never faces), its name, whether it is to move and what it bid. */
const seatLine = (x, view, loc) => ({
  id: x.id, name: x.name, ai: x.ai, out: x.out, count: x.dice, turn: view.turn === x.id,
  cups: Array.from({ length: x.dice }, (_, i) => i), label: loc("SDE.town.games.liars.diceLeft", { count: x.dice }),
  bid: view.bid?.by === x.id ? bidText(view.bid, loc) : "",
});

/**
 * The match as the window draws it for the person at `view.me`. `pick` is their dialed-in `{ qty, face }` (null for the
 * smallest raise). The other seats are cups (a count and no faces); the person's own dice are their hand.
 */
export function tableView(view, pick, loc) {
  const names = namesOf(view);
  const calls = view.log.filter((e) => e.t === "call");
  const last = calls.at(-1);
  const lastAt = last ? view.log.lastIndexOf(last) : -1;
  const sinceCall = view.log.slice(lastAt + 1).filter((e) => e.t === "bid");
  const state = { bid: view.bid, seats: view.seats };
  const total = view.seats.reduce((n, x) => n + x.dice, 0);
  const next = pickFor(view, pick) ?? { qty: 1, face: FACES[0] };
  const me = view.seats.find((x) => x.you);
  const mine = view.turn === view.me && !view.winner;
  const turnSeat = view.seats.find((x) => x.id === view.turn);
  return {
    round: view.round, over: !!view.winner, mine, host: !!view.isHost, names, pot: view.pot, potText: formatPrice(fromCopper(view.pot)),
    you: { name: me?.name ?? "", count: me?.dice ?? 0, out: !!me?.out, dice: (view.hand ?? []).map((f) => ({ face: f, wild: f === WILD })) },
    others: view.seats.filter((x) => !x.you).map((x) => seatLine(x, view, loc)),
    bid: view.bid ? { text: bidText(view.bid, loc), by: names[view.bid.by], theirs: view.bid.by !== view.me } : null,
    waiting: !mine && !view.winner && turnSeat ? { name: turnSeat.name, ai: turnSeat.ai } : null,
    trail: sinceCall.map((e) => ({ who: names[e.who], text: bidText(e, loc), you: e.who === view.me })),
    reveal: last && {
      line: roundLine(last, names, loc), bid: bidText(last.bid, loc), count: last.count,
      rows: view.seats.filter((x) => last.hands[x.id]?.length).map((x) => ({ name: x.name, you: x.you, dice: last.hands[x.id].map((f) => dieOf(f, last.bid.face)) })),
    },
    earlier: eventLines(view.log.slice(0, Math.max(0, lastAt)), names, loc),
    pick: next, pickText: bidText(next, loc), faces: FACES.map((face) => ({ face, on: face === next.face })),
    canBid: mine && canBid(state, next.qty, next.face), canCall: mine && !!view.bid && view.bid.by !== view.me,
    canLess: next.qty > 1, canMore: next.qty < total, hasRaise: raisesFrom(view.bid, total).length > 0,
  };
}

/** The lobby as the window draws it: who is seated, the free seats, and what the host can do. */
export function lobbyView(view, loc) {
  return {
    host: view.isHost, free: view.free, total: view.total, pot: view.pot, price: formatPrice(fromCopper(view.ante)), potText: formatPrice(fromCopper(view.pot)),
    hostName: view.slots.find((x) => x.host)?.name ?? "",
    slots: view.slots.map((s) => (s.kind === "human"
      ? { kind: "human", isHuman: true, name: s.name, you: s.you, host: s.host }
      : { kind: s.kind, isOpen: s.kind === "open", name: loc(s.kind === "open" ? "SDE.town.games.liars.openSeat" : "SDE.town.games.liars.houseSeat") })),
  };
}

/** The open tables as the list draws them. */
export const tablesView = (tables, loc) => [...tables].map((t) => ({
  id: t.id, hostName: t.hostName, town: t.town.name, free: t.free, total: t.total,
  price: formatPrice(fromCopper(t.ante)), freeText: loc("SDE.town.games.liars.freeSeats", { free: t.free }),
}));

/** The set-up screen: how many of the house's players and seats for other people, and what that makes. `ante` is in copper. */
export function setupView(setup, ante, loc) {
  const seats = 1 + setup.ai + setup.humans;
  return {
    ai: setup.ai, humans: setup.humans, seats,
    canAiLess: setup.ai > 0 && seats > 2, canAiMore: seats < MAX_SEATS && setup.ai < 5,
    canHumansLess: setup.humans > 0 && seats > 2, canHumansMore: seats < MAX_SEATS && setup.humans < 5,
    open: setup.humans > 0,
    summary: loc("SDE.town.games.liars.setupSummary", { seats, price: formatPrice(fromCopper(ante)), pot: formatPrice(fromCopper(ante * seats)) }),
  };
}
