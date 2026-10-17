/**
 * Shadowdark Enhancer — how the house plays a hand (pure; see hand-core.mjs).
 *
 * The house reads only what a player at the table could: its own dice, the opponent's dice that are shown, what has been
 * bet and how many dice the opponent rerolled. It never looks at the opponent's hidden dice (`seen` is the one place the
 * state is read, and the tests change the hidden dice and expect the same move). Its play is the odds of winning from
 * what it can see, against the pot odds, plus a little bluffing; `DIALS` are the knobs.
 *
 * `rng` is a function returning a number in [0, 1), so a test can set the house's nerve.
 */
import { HAND_RULES, compareBrag, other } from "./hand-core.mjs";

export const DIALS = {
  betAt: 0.6,         // bets into a check when it wins at least this often
  bluffBelow: 0.4,    // below this it is weak ...
  bluff: 0.15,        // ... and bets anyway this often
  raiseAt: 0.8,       // raises a bet when it wins at least this often ...
  raise: 0.5,         // ... this often
  margin: 0.03,       // calls a little short of the pot odds, as a tavern house does
};

/** Everything the house may use to move: nothing of the opponent's that is not shown. */
export function seen(hand, who) {
  const opp = other(who);
  const bluff = hand.game === "bluff";
  const dice = HAND_RULES[hand.game].dice;
  return {
    game: hand.game, round: hand.round, phase: hand.phase, bet: hand.bet, put: hand.put, unit: hand.unit,
    own: [...hand.dice[who]], ownOpen: hand.open[who],
    oppShown: bluff ? hand.dice[opp].filter((_, i) => hand.open[opp][i]) : [],
    oppHidden: bluff ? hand.open[opp].filter((shown) => !shown).length : dice,
  };
}

const sum = (dice) => dice.reduce((a, b) => a + b, 0);

const distCache = new Map();
/** The chance of each total of `k` dice with `sides` faces: index is the total. */
function totals(k, sides) {
  const key = `${k}d${sides}`;
  if (!distCache.has(key)) {
    let dist = [1];
    for (let i = 0; i < k; i++) {
      const next = new Array(dist.length + sides).fill(0);
      dist.forEach((p, t) => { for (let f = 1; f <= sides; f++) next[t + f] += p / sides; });
      dist = next;
    }
    distCache.set(key, dist);
  }
  return distCache.get(key);
}

/** The chance that a hand totalling `own` beats an opponent who shows `shown` and has `hidden` d10 left (a tie counts half). */
export function bluffOdds(own, shown, hidden) {
  let p = 0;
  totals(hidden, 10).forEach((chance, t) => { const them = shown + t; p += chance * (own > them ? 1 : own === them ? 0.5 : 0); });
  return p;
}

const ALL_BRAG = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) ALL_BRAG.push([a, b, c]);
const strengthCache = new Map();
/** How much of the time a brag hand beats a random one (a tie counts half). */
export function bragStrength(dice) {
  const key = [...dice].sort().join("");
  if (!strengthCache.has(key)) {
    strengthCache.set(key, ALL_BRAG.reduce((acc, other) => { const c = compareBrag(dice, other); return acc + (c > 0 ? 1 : c === 0 ? 0.5 : 0); }, 0) / ALL_BRAG.length);
  }
  return strengthCache.get(key);
}

/** The chance the house wins from what it sees. */
export const oddsOf = (v) => (v.game === "bluff" ? bluffOdds(sum(v.own), sum(v.oppShown), v.oppHidden) : bragStrength(v.own));

const subsets = (n, max) => {
  const out = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const idx = [...Array(n).keys()].filter((i) => mask & (1 << i));
    if (idx.length <= max) out.push(idx);
  }
  return out;
};

/** Which brag dice to reroll: the choice with the best average hand afterwards, keeping all unless a reroll clearly helps. */
export function chooseDraw(dice, max) {
  const expected = (idx) => {
    let total = 0;
    const faces = 6 ** idx.length;
    for (let n = 0; n < faces; n++) {
      const next = [...dice];
      idx.forEach((i, k) => { next[i] = 1 + (Math.floor(n / 6 ** k) % 6); });
      total += bragStrength(next);
    }
    return total / faces;
  };
  let best = [], bestScore = expected([]);
  for (const idx of subsets(dice.length, max)) {
    const score = expected(idx);
    if (score > bestScore + 0.004) { best = idx; bestScore = score; }
  }
  return best;
}

/** Which Bluff die to show: a strong hand tends to hide its best, a weak one shows it off, the rest mix it up. */
function chooseReveal(v, rng) {
  const closed = v.ownOpen.flatMap((shown, i) => (shown ? [] : [i])).sort((i, j) => v.own[i] - v.own[j]);
  const lowest = closed[0], highest = closed.at(-1), any = closed[Math.floor(rng() * closed.length)];
  const total = sum(v.own);
  if (total >= 26) return rng() < 0.6 ? lowest : highest;
  if (total <= 18) return rng() < 0.7 ? highest : any;
  return rng() < 0.5 ? highest : any;
}

function chooseBet(v, rng, dials) {
  const p = oddsOf(v), b = v.bet;
  if (b.facing === 0) return p >= dials.betAt || (p <= dials.bluffBelow && rng() < dials.bluff) ? "bet" : "check";
  const pot = v.put.you + v.put.house, needed = b.facing / (pot + b.facing);
  if (!b.raised && p >= dials.raiseAt && rng() < dials.raise) return "raise";
  return p >= needed - dials.margin ? "call" : "fold";
}

/**
 * The house's move for `who` (normally "house") in `hand`: `{ type: "reveal", idx }`, `{ type: "draw", idx }` (the caller
 * rolls the new faces and adds `values`), or `{ type: "check" | "bet" | "call" | "raise" | "fold" }`. Null when it has no move.
 */
export function houseMove(hand, who, rng, dials = DIALS) {
  if (hand.result || (hand.phase !== "bet" && hand.pending[who])) return null;
  const v = seen(hand, who);
  if (v.phase === "reveal") return { type: "reveal", idx: chooseReveal(v, rng) };
  if (v.phase === "draw") return { type: "draw", idx: chooseDraw(v.own, HAND_RULES.brag.rerolls[v.round - 1]) };
  return hand.bet.turn === who ? { type: chooseBet(v, rng, dials) } : null;
}

