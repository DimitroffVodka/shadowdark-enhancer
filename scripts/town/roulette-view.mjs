/**
 * Shadowdark Enhancer — what the roulette board looks like (pure): the lines of the chat card and the spots, chips and
 * result the window draws. `loc` is the translator the caller passes in (the real one or a test's).
 */
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { BET_KEYS, GAME_ICONS, GAME_KEYS, RESULT_KEYS, ROULETTE_BETS } from "./games-core.mjs";
import { BOARD_ROWS, OUTSIDE, boardStake, chipCount } from "./roulette-core.mjs";

const L = {
  spin: "SDE.town.roulette.line.spin", won: "SDE.town.roulette.line.won", lost: "SDE.town.roulette.line.lost",
  pay1: "SDE.town.roulette.pay1", pay19: "SDE.town.roulette.pay19",
};
const money = (copper) => formatPrice(fromCopper(copper));
/** The chips a player may pick, in copper: 1 sp up to 50 gp. */
export const CHIP_SIZES = [10, 50, 100, 500, 1000, 5000];

/** What a bet is called: Even, Odd, Low 1-10, High 11-20, or "number 17". */
export const betLabel = (pick, loc) => (ROULETTE_BETS.includes(pick) ? loc(BET_KEYS[pick]) : loc(BET_KEYS.number, { n: pick }));

/** The card's lines for a spin: the number it came up on, then how each spot did. */
export function rouletteLines(out, who, loc) {
  const spots = out.spots.map((s) => loc(s.won ? L.won : L.lost, { bet: betLabel(s.pick, loc), price: money(Math.abs(s.net)) }));
  return [loc(L.spin, { who, n: out.d20 }), spots.join(" ")];
}

/**
 * The window's model of a table `{ bets, chip, last }`: the board, the chip sizes within the table's limit, what is laid
 * and what a spin would risk, and how the last spin came out. `ctx` is `{ name, maxBet (gp), loc }`.
 */
export function rouletteView(table, { name, maxBet, loc }) {
  const { bets, chip, last } = table;
  const won = new Set(last?.spots.filter((s) => s.won).map((s) => s.pick));
  const spot = (pick) => ({
    pick, label: ROULETTE_BETS.includes(pick) ? betLabel(pick, loc) : pick, outside: ROULETTE_BETS.includes(pick),
    pay: loc(ROULETTE_BETS.includes(pick) ? L.pay1 : L.pay19), chips: bets[pick] ?? 0, stack: bets[pick] ? money(bets[pick] * chip) : "",
    won: won.has(pick), ball: !!last && !ROULETTE_BETS.includes(pick) && Number(pick) === last.d20,
  });
  return {
    game: "roulette", icon: GAME_ICONS.roulette, name: loc(GAME_KEYS.roulette.name),
    rows: BOARD_ROWS.map((row) => row.map(spot)), outside: OUTSIDE.map(spot),
    chips: CHIP_SIZES.filter((c) => c <= maxBet * 100).map((c) => ({ copper: c, label: money(c), on: c === chip })),
    laid: chipCount(bets), stake: money(boardStake(bets, chip)), canSpin: chipCount(bets) > 0, limit: money(maxBet * 100),
    last: last && { d20: last.d20, tone: last.tone, lines: [...last.lines, loc(RESULT_KEYS[last.result], { who: name, price: money(Math.abs(last.net)) })] },
  };
}
