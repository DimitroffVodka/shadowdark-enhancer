/**
 * Shadowdark Enhancer — the death roll at a town table (pure): you and the house roll in turn, each on a die as big as the
 * last roll, and whoever rolls a 1 loses the stake. You roll first, on a d100.
 *
 * Between rolls the stake can be doubled, as in backgammon: before a roll the side that is not rolling may offer a double
 * (and the roller may too), the other side takes it (both stakes double and the taker holds the right to double next) or
 * passes (the doubler wins the stake as it stood). Nobody may double above 8 times the wager. The side about to roll is
 * the underdog on every die, never worse than 1 in 3 and never better than even, so the doubling is where the thinking is.
 *
 * `who` is "you" (the player) or "house". The state is a plain object that `applyDeath` turns into the next one.
 */
import { DEATH_START } from "./games-core.mjs";

export const MAX_MULT = 8;
export const otherSide = (who) => (who === "you" ? "house" : "you");

const loses = [0, 1];
/** The exact chance that whoever rolls next on a d(n) is the one who rolls the 1 and loses. */
export function loseChance(n) {
  for (let k = loses.length; k <= n; k++) {
    let others = 0;
    for (let j = 2; j < k; j++) others += 1 - loses[j];
    loses[k] = (2 + others) / (k + 1);
  }
  return loses[n];
}

/** A fresh round: both sides have put one wager (`unit`, copper) on the table and the player is to roll a d100. */
export function newDeath({ unit }) {
  return {
    unit, mult: 1, max: DEATH_START, turn: "you", stage: "pre", cube: null, offer: null,
    put: { you: unit, house: unit }, log: [], result: null,
  };
}

/** What taking a double costs the side that takes it: its own share of the stake as it stands. */
export const takeCost = (s) => s.unit * s.mult;

/** Whether `who` may offer a double now: the non-roller before the roll, or the roller at it, holding the cube, under the cap. */
export function canDouble(s, who) {
  if (s.result || s.offer || s.mult >= MAX_MULT || (s.cube !== null && s.cube !== who)) return false;
  return s.stage === "pre" ? who !== s.turn : who === s.turn;
}

/**
 * What `who` may do: `{ kind: "respond" }` (a double is offered: take or pass), `{ kind: "pre", double }` (not rolling, and
 * may offer a double or let the roll happen), `{ kind: "roll", double }` (rolling, and may offer a double first), or `{ kind: "wait" }`.
 */
export function legalDeath(s, who) {
  if (s.result) return { kind: "wait" };
  if (s.offer) return s.offer.by === who ? { kind: "wait" } : { kind: "respond" };
  if (s.stage === "pre") return who === s.turn ? { kind: "wait" } : { kind: "pre", double: canDouble(s, who) };
  return who === s.turn ? { kind: "roll", double: canDouble(s, who) } : { kind: "wait" };
}

const bad = (message) => { throw new Error(message); };

/** Play `action` as `who`: `{ type: "skip" | "double" | "take" | "pass" }` or `{ type: "roll", n }`. Not allowed throws. */
export function applyDeath(s, who, action) {
  const next = structuredClone(s), { type } = action, move = legalDeath(next, who);
  const ok = type === "roll" ? move.kind === "roll" : type === "skip" ? move.kind === "pre" : type === "double" ? !!move.double : (type === "take" || type === "pass") && move.kind === "respond";
  if (!ok) bad(`${who} cannot ${type} now`);
  if (type === "skip") next.stage = "roll";
  else if (type === "double") {
    next.offer = { by: who };
    next.log.push({ t: "double", by: who });
  } else if (type === "take") {
    next.log.push({ t: "take", by: who });
    next.mult *= 2;
    next.put = { you: next.unit * next.mult, house: next.unit * next.mult };
    next.cube = who;
    next.offer = null;
    next.stage = "roll";
  } else if (type === "pass") {
    next.log.push({ t: "pass", by: who });
    next.offer = null;
    next.result = { winner: otherSide(who), by: "pass" };
  } else {
    const { n } = action;
    if (!Number.isInteger(n) || n < 1 || n > next.max) bad("that roll does not fit the die");
    next.log.push({ t: "roll", by: who, n, max: next.max });
    if (n === 1) next.result = { winner: otherSide(who), by: "roll" };
    else Object.assign(next, { max: n, turn: otherSide(who), stage: "pre" });
  }
  return next;
}

/** The player gives up the round: the house wins what is on the table. */
export function walkAwayDeath(s) {
  const next = structuredClone(s);
  next.offer = null;
  next.result = { winner: "house", by: "walk" };
  return next;
}

export const DEATH_DIALS = {
  doubleAt: 0.55,   // the house offers a double when the roller loses at least this often ...
  double: 0.85,     // ... this often
  takeAt: 0.34,     // it takes a double when it wins at least this often (a tavern house passes at a d2, where it wins 1 in 3)
};

/**
 * The house's move, or null when the decision is the player's. It reads only the die and the stake: there is nothing hidden
 * in a death roll. The caller rolls the die for `{ type: "roll" }`.
 */
export function deathMove(s, rng, dials = DEATH_DIALS) {
  const move = legalDeath(s, "house");
  if (move.kind === "respond") {
    const wins = s.turn === "house" ? 1 - loseChance(s.max) : loseChance(s.max);
    return { type: wins >= dials.takeAt ? "take" : "pass" };
  }
  if (move.kind === "pre") return { type: move.double && loseChance(s.max) >= dials.doubleAt && rng() < dials.double ? "double" : "skip" };
  if (move.kind === "roll") return { type: "roll" };
  return null;
}
