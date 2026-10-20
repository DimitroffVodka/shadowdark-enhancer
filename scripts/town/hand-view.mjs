/**
 * Shadowdark Enhancer — what a hand looks like (pure): the lines of the chat card and the numbers and rows the window draws.
 *
 * The window and the card read the same hand, and neither shows what the player could not know: the house's dice stay
 * hidden until they are shown or the hand is over. `loc` is the translator the caller passes in (the real one or a test's).
 */
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { GAME_ICONS, GAME_KEYS, HAND_KEYS, RESULT_KEYS } from "./games-core.mjs";
import { HAND_RULES, legalMoves, pot, settleHand } from "./hand-core.mjs";

const L = {
  round: "SDE.town.hand.line.round", reveal: "SDE.town.hand.line.reveal", draw: "SDE.town.hand.line.draw", drawOne: "SDE.town.hand.line.drawOne", keep: "SDE.town.hand.line.keep",
  check: "SDE.town.hand.line.check", bet: "SDE.town.hand.line.bet", call: "SDE.town.hand.line.call", raise: "SDE.town.hand.line.raise",
  fold: "SDE.town.hand.line.fold", walk: "SDE.town.hand.line.walk", totals: "SDE.town.hand.line.totals", hands: "SDE.town.hand.line.hands",
};
const MOVE_LINES = { check: L.check, bet: L.bet, call: L.call, raise: L.raise, fold: L.fold };
export const HAND_BUTTONS = {
  roll: "SDE.town.hand.btn.roll", keep: "SDE.town.hand.btn.keep",
  check: "SDE.town.hand.btn.check", bet: "SDE.town.hand.btn.bet", call: "SDE.town.hand.btn.call", raise: "SDE.town.hand.btn.raise", fold: "SDE.town.hand.btn.fold",
};
const PROMPTS = { reveal: "SDE.town.hand.prompt.reveal", draw: "SDE.town.hand.prompt.draw", bet: "SDE.town.hand.prompt.bet", over: "SDE.town.hand.prompt.over" };

const dice = (list) => list.join(" ");

function sentence(e, names, loc) {
  const who = names[e.by];
  if (e.t === "reveal") return loc(L.reveal, { who, face: e.face });
  if (e.t === "draw") return e.n === 0 ? loc(L.keep, { who }) : e.n === 1 ? loc(L.drawOne, { who }) : loc(L.draw, { who, n: e.n });
  return loc(MOVE_LINES[e.t], { who });
}

/** One line a round: what was shown or rerolled, then the betting. */
export function roundLines(hand, names, loc) {
  const rounds = new Map();
  for (const e of hand.log) if (e.t !== "end") rounds.set(e.round, [...(rounds.get(e.round) ?? []), e]);
  return [...rounds].map(([n, entries]) => [loc(L.round, { n }), ...entries.map((e) => sentence(e, names, loc))].join(" "));
}

/** The reveal of a hand that went to the showdown, or the walk-away of one that did not: both sides' dice and what they make. */
export function endLines(hand, names, loc) {
  const r = hand.result;
  if (r.by === "walk") return [loc(L.walk, { who: names.you })];
  if (r.by !== "showdown") return [];
  return ["you", "house"].map((who) => (hand.game === "bluff"
    ? loc(L.totals, { who: names[who], dice: dice(hand.dice[who]), total: r.totals[who] })
    : loc(L.hands, { who: names[who], dice: dice(hand.dice[who]), hand: loc(HAND_KEYS[r.hands[who]]) })));
}

/** Everything the chat card says about a finished hand, ahead of the outcome line. */
export const handLines = (hand, names, loc) => [...roundLines(hand, names, loc), ...endLines(hand, names, loc)];

const money = (copper) => formatPrice(fromCopper(copper));

/** The faces on one side's row: `face` is null where the dice are hidden from the player. */
function row(hand, who, over) {
  const mine = who === "you", bluff = hand.game === "bluff";
  return hand.dice[who].map((face, i) => {
    const shown = hand.open[who][i], visible = mine || over || shown;
    return { i, face: visible ? face : null, shown: bluff && shown, d10: bluff, pips: !bluff && visible };
  });
}

/**
 * The window's model of a table `{ hand, settled }`: both rows, the pot and what the player has in, the prompt, the controls
 * for the step the hand is at, and, once it is over, how it came out. `ctx` is `{ name, purse (copper), picked (the dice
 * selected, by index), edge (the town's cut, %), loc }`.
 */
export function handView(table, { name, purse, picked = [], edge = 0, loc }) {
  const { hand } = table, over = !!hand.result, rules = HAND_RULES[hand.game];
  const move = legalMoves(hand, "you", purse);
  const names = { you: name, house: loc("SDE.town.hand.house") };
  const rows = ["house", "you"].map((who) => ({
    who, label: names[who],
    dice: row(hand, who, over).map((d) => ({
      ...d,
      pickable: who === "you" && !over && ((move.kind === "reveal" && move.idx.includes(d.i)) || move.kind === "draw"),
      picked: who === "you" && picked.includes(d.i),
    })),
  }));
  const controls = {
    reveal: move.kind === "reveal" ? { ready: picked.length === 1 } : null,
    draw: move.kind === "draw" ? { n: picked.length, label: picked.length ? loc(HAND_BUTTONS.roll, { n: picked.length }) : loc(HAND_BUTTONS.keep) } : null,
    bet: move.kind === "bet" ? move.moves.map((m) => ({ type: m.type, ghost: m.type === "fold", label: loc(HAND_BUTTONS[m.type], { price: money(m.cost) }), disabled: !m.afford })) : null,
    collect: over && !table.settled,
    over: over && table.settled,
  };
  let result = null;
  if (over) {
    const { net, result: kind } = settleHand(hand, edge);
    result = {
      tone: kind === "win" ? "good" : kind === "lose" ? "bad" : "info",
      lines: [...endLines(hand, names, loc), loc(RESULT_KEYS[kind], { who: name, price: money(Math.abs(net)) })],
    };
  }
  const promptKey = over ? "over" : controls.reveal ? "reveal" : controls.draw ? "draw" : "bet";
  return {
    game: hand.game, icon: GAME_ICONS[hand.game], name: loc(GAME_KEYS[hand.game].name), round: hand.round, rounds: rules.rounds, over,
    pot: money(pot(hand)), put: money(hand.put.you), prompt: loc(PROMPTS[promptKey], { max: move.max }),
    rows, controls, result, log: roundLines(hand, names, loc),
  };
}
