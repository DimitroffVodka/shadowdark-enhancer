/**
 * Shadowdark Enhancer — blackjack at a town table (pure): you against the dealer, over one freshly shuffled deck of 52 for
 * every hand, so counting cards earns nothing.
 *
 * The usual casino rules. Cards count their pips, faces ten, an ace eleven or one, whichever is better. You and the dealer
 * get two cards and one of the dealer's stays face down. A natural 21 on your first two cards pays 3 to 2; the dealer has
 * looked at its hole card by then, so if it has a natural too the hand is a push, and if only it has one you lose the
 * wager before you can put more on the table. Then you hit, stand, double down (one more card and no more, for a second
 * wager, on a hand of two cards) or split a pair of the same value into two hands with a second wager (once; split aces
 * take one card each; 21 on a split hand pays 1 to 1). Over 21 loses at once. The dealer draws to 17 and stands on every 17,
 * soft ones too, and does not draw at all when every hand of yours has bust. Insurance and surrender are not offered.
 *
 * The state is a plain object that `applyBlackjack` turns into the next one. A card is a place in the deck, 0 to 51, as in
 * games-core's `cardOf`. Money is copper: `settleRound` works out what comes back, with the town's cut taken from winnings only.
 */
import { cardOf, settle } from "./games-core.mjs";

/** What a hand pays, by how it came out: how many times its wager comes back. */
const OUTCOMES = {
  blackjack: { outcome: "blackjack", mult: 2.5 }, win: { outcome: "win", mult: 2 }, push: { outcome: "push", mult: 1 },
  lose: { outcome: "lose", mult: 0 }, bust: { outcome: "bust", mult: 0 },
};

/** What a card counts: its pips, ten for a face, eleven for an ace (`count` takes the eleven back when it must). */
export const points = (card) => { const { rank } = cardOf(card); return rank === 14 ? 11 : Math.min(rank, 10); };

/** The best total of `cards` and whether an ace is still counted as eleven. */
export function count(cards) {
  let total = 0, aces = 0;
  for (const card of cards) {
    const p = points(card);
    total += p;
    if (p === 11) aces += 1;
  }
  while (total > 21 && aces) { total -= 10; aces -= 1; }
  return { total, soft: aces > 0 };
}

const natural = (cards) => cards.length === 2 && count(cards).total === 21;

/** A deck in a random order, from `rng` (a function giving [0, 1)). */
export function shuffle(rng) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const newHand = (cards, bet, split = false) => ({ cards, bet, state: "play", split, doubled: false });

/** Count the hands up (bust at 22, a hand on 21 stands) and settle the round when no hand is left to play. */
function advance(round) {
  for (const hand of round.hands) {
    const { total } = count(hand.cards);
    if (total > 21) hand.state = "bust";
    else if (total === 21 && hand.state === "play") hand.state = "stand";
  }
  const next = round.hands.findIndex((h) => h.state === "play");
  if (next < 0) return resolve(round, true);
  round.at = next;
  return round;
}

/** Finish the round: the dealer plays out its hand (unless there is nothing left to beat) and every hand is called. */
function resolve(round, dealerPlays) {
  if (dealerPlays && round.hands.some((h) => h.state !== "bust")) {
    while (count(round.dealer).total < 17) round.dealer.push(round.deck.pop());
  }
  const dealer = count(round.dealer).total, dealerNatural = natural(round.dealer);
  round.result = {
    by: "play",
    hands: round.hands.map((h) => {
      const mine = count(h.cards).total;
      if (h.state === "bust") return OUTCOMES.bust;
      if (!h.split && natural(h.cards)) return dealerNatural ? OUTCOMES.push : OUTCOMES.blackjack;
      if (dealerNatural) return OUTCOMES.lose;
      if (dealer > 21 || mine > dealer) return OUTCOMES.win;
      return mine === dealer ? OUTCOMES.push : OUTCOMES.lose;
    }),
  };
  return round;
}

/**
 * A fresh round from a shuffled `deck`: the player's first card, the dealer's up card, the player's second, the dealer's
 * hole card. `unit` is the wager in copper. A natural on either side ends the round on the spot.
 */
export function newRound({ unit, deck }) {
  const rest = [...deck];
  const [a, up, b, hole] = [rest.pop(), rest.pop(), rest.pop(), rest.pop()];
  const round = { unit, deck: rest, dealer: [up, hole], hands: [newHand([a, b], unit)], at: 0, result: null };
  return natural(round.hands[0].cards) || natural(round.dealer) ? resolve(round, false) : round;
}

/** What the player may do with the hand in play: `{ hit, stand, double, split }`. */
export function legalBlackjack(round) {
  if (round.result) return { hit: false, stand: false, double: false, split: false };
  const hand = round.hands[round.at], two = hand.cards.length === 2;
  return { hit: true, stand: true, double: two, split: two && round.hands.length === 1 && points(hand.cards[0]) === points(hand.cards[1]) };
}

/** What a move puts on the table besides the wager already there, in copper: a double or a split is one more wager. */
export const costOf = (round, type) => (type === "double" || type === "split" ? round.hands[round.at].bet : 0);

/** Play `type` (`"hit" | "stand" | "double" | "split"`) on the hand in play. Not allowed throws. */
export function applyBlackjack(round, type) {
  const next = structuredClone(round), hand = next.hands[next.at];
  if (!legalBlackjack(next)[type]) throw new Error(`cannot ${type} now`);
  if (type === "hit") hand.cards.push(next.deck.pop());
  else if (type === "stand") hand.state = "stand";
  else if (type === "double") {
    Object.assign(hand, { bet: hand.bet * 2, doubled: true, state: "stand" });
    hand.cards.push(next.deck.pop());
  } else {
    const aces = points(hand.cards[0]) === 11;
    next.hands = hand.cards.map((card) => newHand([card, next.deck.pop()], next.unit, true));
    // Split aces take their one card each and are done.
    if (aces) for (const h of next.hands) h.state = "stand";
  }
  return advance(next);
}

/** The player gives up the round, or closes its window: whatever is on the table is the house's. */
export function walkAwayBlackjack(round) {
  const next = structuredClone(round);
  next.result = { by: "walk", hands: next.hands.map(() => OUTCOMES.lose) };
  return next;
}

/**
 * What a finished round comes to: `put` (every wager on the table), `net` (copper won or lost, the town's cut taken from
 * each hand's winnings), `payBack` (what goes back to the purse, the wagers that survived and the winnings) and the `result`.
 */
export function settleRound(round, edge) {
  let put = 0, net = 0;
  round.hands.forEach((hand, i) => {
    put += hand.bet;
    net += settle(hand.bet, round.result.hands[i].mult, edge).net;
  });
  return { put, net, payBack: put + net, result: net > 0 ? "win" : net < 0 ? "lose" : "push" };
}
