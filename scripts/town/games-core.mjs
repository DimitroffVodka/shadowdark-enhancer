/**
 * Shadowdark Enhancer — the town's games of chance (pure).
 *
 * Four games that settle on one roll, each a plain function of what was rolled, so the rules are pinned by tests and the
 * live side only has to roll. A game returns `mult`: how many times the wager comes back (0 loses it, 1 gives it back,
 * 2 doubles it). `settle` turns that into the coins that move, with the house's cut taken from winnings only.
 *
 *   coin    call heads or tails           wins at 1 to 1
 *   duel    2d6 against the house         wins at 1 to 1, a tie gives the wager back
 *   wheel   d100 on a payout table        from nothing back to 10 to 1
 *   cards   one card each from a deck     higher wins at 1 to 1, the same rank gives the wager back
 *
 * The games that are played over several choices open a table of their own (`SIT_GAMES`): Bluff and Brag are hands of
 * betting over hidden dice (hand-core.mjs), the death roll has a doubling stake (death-core.mjs), the roulette a board
 * of chips (roulette-core.mjs) and blackjack hits, doubles and splits over a shuffled deck (blackjack-core.mjs). This file keeps what they share: the wager limits, `settle`, the strings and the odds
 * of a single roulette bet.
 *
 * With no house cut the coin, duel and cards are exactly fair and the wheel returns 99.5%; the town's cut is what
 * makes the house win over a night.
 *
 * A ninth, Liar's Dice, is a match of many rounds rather than one roll: its rules are in liars-dice-core.mjs, its wager
 * is taken when the match begins and a win pays 1 to 1 through `settle` like the rest.
 */
/** The smallest wager: 1 sp, in copper. */
export const MIN_WAGER = 10;
export const GAME_IDS = ["coin", "duel", "wheel", "cards"];
/** The games played as a hand of betting (hand-core.mjs). */
export const HAND_GAMES = ["bluff", "brag"];
/** The games that open a table of their own instead of settling on one roll, in the order the window lists them. */
export const SIT_GAMES = [...HAND_GAMES, "death", "roulette", "blackjack"];
/** Liar's Dice: a match, not a roll, so it is not one of the `GAME_IDS` that `playGame` rolls. */
export const LIARS = "liars";
/** Everything on the table, in the order the window lists it. */
export const TABLE_GAMES = [...GAME_IDS, ...SIT_GAMES, LIARS];
export const GAME_ICONS = {
  coin: "fa-coins", duel: "fa-dice", wheel: "fa-dharmachakra", cards: "fa-heart",
  death: "fa-skull", roulette: "fa-bullseye", brag: "fa-dice-three", bluff: "fa-eye", liars: "fa-dice-five", blackjack: "fa-diamond",
};
export const SIDES = ["heads", "tails"];
/** The roulette bets that are not a number; a number bet is "1" to "20". */
export const ROULETTE_BETS = ["even", "odd", "low", "high"];
export const ROULETTE_SIZE = 20;
/** The death roll opens on this die. */
export const DEATH_START = 100;

/** The strings each game, side, wheel slot and result uses (written out in full: the code never builds a key from pieces). */
export const GAME_KEYS = {
  coin: { name: "SDE.town.games.coin.name", rules: "SDE.town.games.coin.rules", odds: "SDE.town.games.coin.odds", line: "SDE.town.games.line.coin" },
  duel: { name: "SDE.town.games.duel.name", rules: "SDE.town.games.duel.rules", odds: "SDE.town.games.duel.odds", line: "SDE.town.games.line.duel" },
  wheel: { name: "SDE.town.games.wheel.name", rules: "SDE.town.games.wheel.rules", odds: "SDE.town.games.wheel.odds", line: "SDE.town.games.line.wheel" },
  cards: { name: "SDE.town.games.cards.name", rules: "SDE.town.games.cards.rules", odds: "SDE.town.games.cards.odds", line: "SDE.town.games.line.cards" },
  death: { name: "SDE.town.games.death.name", rules: "SDE.town.games.death.rules", odds: "SDE.town.games.death.odds" },
  roulette: { name: "SDE.town.games.roulette.name", rules: "SDE.town.games.roulette.rules", odds: "SDE.town.games.roulette.odds" },
  brag: { name: "SDE.town.games.brag.name", rules: "SDE.town.games.brag.rules", odds: "SDE.town.games.brag.odds" },
  bluff: { name: "SDE.town.games.bluff.name", rules: "SDE.town.games.bluff.rules", odds: "SDE.town.games.bluff.odds" },
  liars: { name: "SDE.town.games.liars.name", rules: "SDE.town.games.liars.rules", odds: "SDE.town.games.liars.odds" },
  blackjack: { name: "SDE.town.games.blackjack.name", rules: "SDE.town.games.blackjack.rules", odds: "SDE.town.games.blackjack.odds" },
};
export const SIDE_KEYS = { heads: "SDE.town.games.side.heads", tails: "SDE.town.games.side.tails" };
export const BET_KEYS = {
  even: "SDE.town.games.bet.even", odd: "SDE.town.games.bet.odd", low: "SDE.town.games.bet.low", high: "SDE.town.games.bet.high",
  number: "SDE.town.games.bet.number",
};
export const HAND_KEYS = {
  prial: "SDE.town.games.hand.prial", straight: "SDE.town.games.hand.straight", flush: "SDE.town.games.hand.flush",
  pair: "SDE.town.games.hand.pair", high: "SDE.town.games.hand.high",
};
export const SLOT_KEYS = {
  bust: "SDE.town.games.slot.bust", half: "SDE.town.games.slot.half", double: "SDE.town.games.slot.double",
  triple: "SDE.town.games.slot.triple", jackpot: "SDE.town.games.slot.jackpot",
};
export const RESULT_KEYS = { win: "SDE.town.games.win", lose: "SDE.town.games.lose", push: "SDE.town.games.push" };
export const WAGER_KEYS = { min: "SDE.town.games.wagerMin", max: "SDE.town.games.wagerMax", poor: "SDE.town.games.wagerPoor", broke: "SDE.town.games.houseBroke" };

/** The wheel, by d100: the roll up to which a slot holds, and what comes back of the wager. */
export const WHEEL = [
  { upTo: 45, key: "bust", mult: 0 },
  { upTo: 68, key: "half", mult: 0.5 },
  { upTo: 90, key: "double", mult: 2 },
  { upTo: 98, key: "triple", mult: 3 },
  { upTo: 100, key: "jackpot", mult: 10 },
];

/**
 * The coins that move, in copper from the player's side: positive is a win, negative a loss. A wager that comes back
 * in part or in full is not touched by the house's cut; only winnings are cut, rounded down.
 */
export function settle(wager, mult, edge) {
  const stake = Math.max(0, Math.floor(wager));
  // Whole-number arithmetic until the one division, so a payout that should be 855 is never 854.99999.
  const net = mult >= 1 ? Math.floor(stake * (mult - 1) * (100 - Math.min(100, Math.max(0, edge))) / 100) : Math.floor(stake * mult) - stake;
  return { net, result: net > 0 ? "win" : net < 0 ? "lose" : "push" };
}

/** A wager typed in silver, as copper (nothing usable gives 0). */
export const wagerFromSp = (sp) => Math.max(0, Math.floor(Number(sp) || 0)) * 10;

/** The most the house at a table may lose in one session, in gp, by settlement size (a stock-generator SIZES id). */
export const HOUSE_BANK_GP = { village: 50, town: 100, city: 500, city_state: 2000 };

/**
 * What the house at `sceneId` may still lose this session, in copper: its bank for `size` less what players have won
 * there, net of what they lost, in the game entries (town-log-core's) made at or after `since` (ms).
 */
export function houseLeft(entries, { sceneId, since = 0, size }) {
  let won = 0;
  for (const e of entries) if (e.kind === "game" && e.sceneId === sceneId && e.at >= since) won += e.net;
  return (HOUSE_BANK_GP[size] ?? HOUSE_BANK_GP.town) * 100 - won;
}

/**
 * When the house's session began (ms): the Session Recap's session start; between sessions (the recap clears it when a
 * session is saved), when the last saved session ended, so play between sessions has a bank of its own; else 0.
 * `history` is the recap's saved sessions, newest first.
 */
export const houseSince = (sessionStart, history) => Number(sessionStart) || Number(history?.[0]?.endTime) || 0;

/** A win cut to what the house has `left` (copper); a loss or a push is untouched. No `left` is no cap. */
export const capWin = (net, left = Infinity) => (net > 0 ? Math.min(net, Math.max(0, left)) : net);

/**
 * Whether `copper` may be played: at least 1 sp, within the table's limit (in gp), within the purse (a copper total)
 * and while the house has something `left` to lose this session.
 */
export function checkWager(copper, { maxBetGp, purse, left = Infinity }) {
  if (left <= 0) return { ok: false, why: "broke" };
  if (!Number.isFinite(copper) || copper < MIN_WAGER) return { ok: false, why: "min" };
  if (copper > maxBetGp * 100) return { ok: false, why: "max" };
  if (copper > purse) return { ok: false, why: "poor" };
  return { ok: true };
}

/** Coin toss: `flip` is a d2 (1 heads, 2 tails). */
export function coin({ pick, flip }) {
  const side = flip === 1 ? "heads" : "tails";
  return { side, mult: side === pick ? 2 : 0 };
}

/** Dice duel: each side's two d6. A tie gives the wager back. */
export function duel({ you, house }) {
  const y = you[0] + you[1], h = house[0] + house[1];
  return { you: y, house: h, mult: y > h ? 2 : y === h ? 1 : 0 };
}

/** The wheel: a d100. */
export function wheel({ d100 }) {
  const slot = WHEEL.find((s) => d100 <= s.upTo) ?? WHEEL[0];
  return { d100, slot: slot.key, mult: slot.mult };
}

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["♠", "♥", "♦", "♣"];
/** A card from its place in a 52-card deck (0 to 51): rank 2 to 14 (ace high) and suit 0 to 3. */
export const cardOf = (index) => ({ rank: 2 + (index % 13), suit: Math.floor(index / 13) });
export const cardName = ({ rank, suit }) => `${RANKS[rank - 2]}${SUITS[suit]}`;

/** Card draw: two different places in the deck, yours and the dealer's. The same rank gives the wager back. */
export function cards({ you, house }) {
  const y = cardOf(you), h = cardOf(house);
  return { you: y, house: h, mult: y.rank > h.rank ? 2 : y.rank === h.rank ? 1 : 0 };
}

/** Whether `pick` is a roulette bet: even, odd, low (1 to 10), high (11 to 20) or one number from 1 to 20. */
export const isRouletteBet = (pick) => ROULETTE_BETS.includes(pick) || /^(?:[1-9]|1\d|20)$/.test(String(pick));

/** Roulette on a d20. The even-money bets cover ten numbers, a number pays 19 to 1: all fair before the house's cut. */
export function roulette({ pick, d20 }) {
  const win = pick === "even" ? d20 % 2 === 0 : pick === "odd" ? d20 % 2 === 1 : pick === "low" ? d20 <= 10 : pick === "high" ? d20 > 10 : Number(pick) === d20;
  return { d20, mult: !win ? 0 : ROULETTE_BETS.includes(pick) ? 2 : ROULETTE_SIZE };
}

/**
 * A brag hand from three d6, best first by `score` (compared left to right): a prial (all three alike), a straight
 * (three in a row), a flush (all odd or all even), a pair, then the high dice. A pair of one parity is a flush.
 */
export function bragHand(dice) {
  const [a, b, c] = [...dice].sort((x, y) => y - x);
  if (a === c) return { hand: "prial", score: [4, a] };
  if (a - b === 1 && b - c === 1) return { hand: "straight", score: [3, a] };
  if (a % 2 === b % 2 && b % 2 === c % 2) return { hand: "flush", score: [2, a, b, c] };
  if (a === b || b === c) return { hand: "pair", score: [1, b, a === b ? c : a] };
  return { hand: "high", score: [0, a, b, c] };
}
