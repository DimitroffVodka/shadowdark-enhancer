/**
 * Shadowdark Enhancer — the town's roulette (pure): a board of twenty numbers and four outside bets, chips laid on it in
 * any mix, one d20 spin that settles them all.
 *
 * The wheel is a d20. An outside bet (Even, Odd, Low 1-10, High 11-20) covers ten numbers and pays 1 to 1, a number pays
 * 19 to 1, so every chip is fair before the town's cut of the winnings (see `roulette` and `settle` in games-core.mjs).
 * `bets` is `{ pick: chips }`, with picks as `isRouletteBet` knows them and every chip worth the same amount, `chip`.
 */
import { ROULETTE_BETS, isRouletteBet, roulette, settle } from "./games-core.mjs";

/** The numbers as laid out on the board, five to a row. */
export const BOARD_ROWS = [0, 1, 2, 3].map((r) => [1, 2, 3, 4, 5].map((c) => String(r * 5 + c)));
export const OUTSIDE = ROULETTE_BETS;

export const addChip = (bets, pick) => ({ ...bets, [pick]: (bets[pick] ?? 0) + 1 });
export function removeChip(bets, pick) {
  const { [pick]: chips = 0, ...rest } = bets;
  return chips > 1 ? { ...rest, [pick]: chips - 1 } : rest;
}
export const chipCount = (bets) => Object.values(bets).reduce((a, b) => a + b, 0);
export const boardStake = (bets, chip) => chipCount(bets) * chip;

/** Whether every pick on the board is a real bet with a whole, positive number of chips, and there is at least one. */
export const validBoard = (bets) => {
  const entries = Object.entries(bets ?? {});
  return entries.length > 0 && entries.every(([pick, chips]) => isRouletteBet(pick) && Number.isInteger(chips) && chips > 0);
};

/**
 * Spin the board: every spot settles on `d20` (`net` is the change in coins, negative a loss). A winning spot pays its
 * chips' odds less the town's cut of the winnings; a losing one costs its chips.
 */
export function spinBoard({ bets, chip, d20, edge }) {
  const spots = Object.entries(bets).map(([pick, chips]) => {
    const { mult } = roulette({ pick, d20 });
    return { pick, chips, won: mult > 0, net: settle(chips * chip, mult, edge).net };
  });
  const net = spots.reduce((sum, s) => sum + s.net, 0);
  return { d20, net, result: net > 0 ? "win" : net < 0 ? "lose" : "push", spots };
}
