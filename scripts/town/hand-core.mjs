/**
 * Shadowdark Enhancer — the town's hand games (pure): Beholder's Bluff and three-dice Brag, one player against the house.
 *
 * Both are the same game of betting over hidden dice, so they share one engine: an ante, then a few rounds each of which
 * is a step with the dice (Bluff: each side shows one of its dice; Brag: each side may reroll some) and a round of
 * betting, then a showdown. Betting is fixed-limit: a bet is one wager, a raise is one more, and a round allows one raise.
 *
 *   bluff  4d10 each, in secret. Round 1 to 3: each side shows one die, then bet. The last die shows at the showdown.
 *          The higher total wins; equal totals give every wager back.
 *   brag   3d6 each, in secret. Round 1: reroll up to two dice, then bet. Round 2: reroll one die, then bet. The better
 *          hand wins (see `bragHand`); equal hands give every wager back.
 *
 * A hand is a plain object that `apply` turns into the next one, so the rules are pinned by tests and the live side only
 * rolls and moves coins. `who` is "you" (the player) or "house". The house has no purse, so only the player's moves cost
 * coins; `costOf` says how many.
 */
import { bragHand, settle } from "./games-core.mjs";

export const HAND_RULES = {
  bluff: { dice: 4, sides: 10, rounds: 3, first: ["you", "house", "you"], rerolls: [] },
  brag: { dice: 3, sides: 6, rounds: 2, first: ["you", "house"], rerolls: [2, 1] },
};
export const other = (who) => (who === "you" ? "house" : "you");

/** The most wagers one side can have in at the end of a hand: the ante, then a bet and a raise in every round. */
export const maxWagers = (game) => 1 + 2 * HAND_RULES[game].rounds;

/** A fresh hand: both sides have anted one wager (`unit`, in copper) and been dealt `you` and `house` (arrays of faces). */
export function newHand(game, { unit, you, house }) {
  return {
    game, unit, round: 1, phase: game === "bluff" ? "reveal" : "draw",
    dice: { you: [...you], house: [...house] },
    open: { you: you.map(() => false), house: house.map(() => false) },   // Bluff: the dice shown
    drew: { you: [], house: [] },                                        // Brag: how many dice each side rerolled, per round
    pending: { you: null, house: null },                                 // a choice made at the same time as the other side's
    put: { you: unit, house: unit },                                     // what each side has in the pot
    bet: null,
    log: [],
    result: null,
  };
}

export const pot = (hand) => hand.put.you + hand.put.house;

/** What a betting move costs the side that makes it, in copper. */
export function costOf(hand, type) {
  const facing = hand.bet?.facing ?? 0;
  return type === "bet" ? hand.unit : type === "call" ? facing : type === "raise" ? facing + hand.unit : 0;
}

const BET_MOVES = {
  check: (b) => b.facing === 0,
  bet: (b) => b.facing === 0,
  call: (b) => b.facing > 0,
  raise: (b) => b.facing > 0 && !b.raised,
  fold: (b) => b.facing > 0,
};
const betMoves = (hand) => Object.keys(BET_MOVES).filter((type) => BET_MOVES[type](hand.bet));

/**
 * What `who` may do now, for a window to offer: `{ kind: "reveal", idx }` (the dice not yet shown), `{ kind: "draw", max }`
 * (how many dice may be rerolled), `{ kind: "bet", moves: [{ type, cost, afford }] }` (`afford` against `purse`, for the
 * player; the house has no purse), or `{ kind: "wait" }` (not this side's move, or the hand is over).
 */
export function legalMoves(hand, who, purse = Infinity) {
  if (hand.result) return { kind: "wait" };
  if (hand.phase === "reveal") {
    return hand.pending[who] ? { kind: "wait" } : { kind: "reveal", idx: hand.open[who].flatMap((shown, i) => (shown ? [] : [i])) };
  }
  if (hand.phase === "draw") {
    return hand.pending[who] ? { kind: "wait" } : { kind: "draw", max: HAND_RULES[hand.game].rerolls[hand.round - 1] };
  }
  if (hand.bet.turn !== who) return { kind: "wait" };
  return { kind: "bet", moves: betMoves(hand).map((type) => ({ type, cost: costOf(hand, type), afford: costOf(hand, type) <= purse })) };
}

const bad = (message) => { throw new Error(message); };
const inRange = (n, size) => Number.isInteger(n) && n >= 0 && n < size;

/** Play `action` as `who`, and return the next hand (the given one is left alone). Anything not allowed throws. */
export function apply(hand, who, action) {
  const next = structuredClone(hand);
  if (next.result) bad("the hand is over");
  if (action.type === "reveal" || action.type === "draw") return choose(next, who, action);
  return bet(next, who, action);
}

/** A step both sides take at once (Bluff's reveal, Brag's draw): it is settled when the second side has chosen. */
function choose(hand, who, action) {
  const { type, idx } = action, rules = HAND_RULES[hand.game];
  if (hand.phase !== type || hand.pending[who]) bad(`${who} cannot ${type} now`);
  if (type === "reveal") {
    if (!inRange(idx, rules.dice) || hand.open[who][idx]) bad("that die cannot be shown");
  } else {
    const faces = action.values;
    if (!Array.isArray(idx) || new Set(idx).size !== idx.length || !idx.every((i) => inRange(i, rules.dice))) bad("those dice cannot be rerolled");
    if (idx.length > rules.rerolls[hand.round - 1]) bad("too many dice to reroll");
    if (!Array.isArray(faces) || faces.length !== idx.length || !faces.every((n) => Number.isInteger(n) && n >= 1 && n <= rules.sides)) bad("the new faces do not match");
  }
  hand.pending[who] = action;
  if (!hand.pending.you || !hand.pending.house) return hand;
  for (const side of ["you", "house"]) {
    const a = hand.pending[side];
    if (a.type === "reveal") {
      hand.open[side][a.idx] = true;
      hand.log.push({ t: "reveal", by: side, round: hand.round, face: hand.dice[side][a.idx] });
    } else {
      a.idx.forEach((i, n) => { hand.dice[side][i] = a.values[n]; });
      hand.drew[side].push(a.idx.length);
      hand.log.push({ t: "draw", by: side, round: hand.round, n: a.idx.length });
    }
  }
  hand.pending = { you: null, house: null };
  hand.phase = "bet";
  hand.bet = { turn: rules.first[hand.round - 1], facing: 0, raised: false, checked: false };
  return hand;
}

function bet(hand, who, action) {
  const { type } = action, b = hand.bet;
  if (hand.phase !== "bet" || b.turn !== who) bad(`${who} cannot bet now`);
  if (!BET_MOVES[type]?.(b)) bad(`${who} cannot ${type} now`);
  hand.log.push({ t: type, by: who, round: hand.round });
  hand.put[who] += costOf(hand, type);
  if (type === "fold") return end(hand, { winner: other(who), by: "fold", folder: who });
  if (type === "call") return nextRound(hand);
  if (type === "check") {
    if (b.checked) return nextRound(hand);
    b.checked = true;
  } else {
    b.facing = hand.unit;
    if (type === "raise") b.raised = true;
  }
  b.turn = other(who);
  return hand;
}

/** The player leaves the table in the middle of a hand: the house wins what is in the pot. */
export function walkAway(hand) {
  return end(structuredClone(hand), { winner: "house", by: "walk", folder: "you" });
}

function nextRound(hand) {
  hand.bet = null;
  if (hand.round < HAND_RULES[hand.game].rounds) {
    hand.round += 1;
    hand.phase = hand.game === "bluff" ? "reveal" : "draw";
    return hand;
  }
  return end(hand, showdown(hand));
}

function end(hand, result) {
  hand.phase = "done";
  hand.bet = null;
  hand.result = result;
  hand.log.push({ t: "end", by: result.winner, how: result.by });
  return hand;
}

const sum = (dice) => dice.reduce((a, b) => a + b, 0);

/** Compare two brag hands: positive when `a` is better, negative when `b` is, 0 when they are equal. */
export function compareBrag(a, b) {
  const x = bragHand(a).score, y = bragHand(b).score;
  const at = x.findIndex((n, i) => n !== y[i]);
  return at < 0 ? 0 : x[at] - y[at];
}

function showdown(hand) {
  const { you, house } = hand.dice;
  if (hand.game === "bluff") {
    const totals = { you: sum(you), house: sum(house) };
    return { winner: totals.you > totals.house ? "you" : totals.you < totals.house ? "house" : null, by: "showdown", totals };
  }
  const c = compareBrag(you, house);
  return { winner: c > 0 ? "you" : c < 0 ? "house" : null, by: "showdown", hands: { you: bragHand(you).hand, house: bragHand(house).hand } };
}

/**
 * The coins of a finished hand, from the player's side. The player's own coins went into the pot as they were bet, so a
 * win hands them back with the house's share (less the town's cut of that winnings), a tie hands them back, a loss
 * hands back nothing. `net` is the change from before the hand: positive wins, negative loses.
 */
export function settleHand(hand, edge) {
  const mine = hand.put.you;
  if (hand.result.winner === "you") {
    const { net, result } = settle(hand.put.house, 2, edge);
    return { net, result, payBack: mine + net };
  }
  if (hand.result.winner === null) return { net: 0, result: "push", payBack: mine };
  return { net: -mine, result: "lose", payBack: 0 };
}
