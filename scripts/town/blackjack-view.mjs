/**
 * Shadowdark Enhancer — what a hand of blackjack looks like (pure): the lines of the chat card and the cards, totals and
 * controls the window draws. `loc` is the translator the caller passes in (the real one or a test's).
 */
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { GAME_ICONS, GAME_KEYS, RESULT_KEYS, cardName, cardOf } from "./games-core.mjs";
import { costOf, count, legalBlackjack, settleRound } from "./blackjack-core.mjs";

const L = {
  dealer: "SDE.town.blackjack.line.dealer", dealerBust: "SDE.town.blackjack.line.dealerBust", hand: "SDE.town.blackjack.line.hand",
  first: "SDE.town.blackjack.hand.first", second: "SDE.town.blackjack.hand.second", doubled: "SDE.town.blackjack.hand.doubled",
  walk: "SDE.town.hand.line.walk", soft: "SDE.town.blackjack.soft",
};
const OUT = {
  blackjack: "SDE.town.blackjack.out.blackjack", win: "SDE.town.blackjack.out.win", push: "SDE.town.blackjack.out.push",
  lose: "SDE.town.blackjack.out.lose", bust: "SDE.town.blackjack.out.bust",
};
const TONE = { blackjack: "good", win: "good", push: "info", lose: "bad", bust: "bad" };
const money = (copper) => formatPrice(fromCopper(copper));
const cardsText = (cards) => cards.map((c) => cardName(cardOf(c))).join(" ");

/** A card as the window draws it: its rank and suit, and whether the suit is red. */
function face(card) {
  const name = cardName(cardOf(card)), { suit } = cardOf(card);
  return { rank: name.slice(0, -1), suit: name.slice(-1), red: suit === 1 || suit === 2 };
}

/** Who a hand belongs to in a sentence: the player, or "first hand" and "second hand" after a split, plus "doubled". */
function ownerOf(round, i, names, loc) {
  const label = round.hands.length === 1 ? names.you : loc(i === 0 ? L.first : L.second, { who: names.you });
  return round.hands[i].doubled ? loc(L.doubled, { who: label }) : label;
}

/** The round as lines for the card: the dealer's hand, then each of the player's with how it came out. */
export function blackjackLines(round, names, loc) {
  const { total } = count(round.dealer);
  const dealer = loc(total > 21 ? L.dealerBust : L.dealer, { cards: cardsText(round.dealer), total });
  const hands = round.hands.map((hand, i) => loc(L.hand, {
    who: ownerOf(round, i, names, loc), cards: cardsText(hand.cards), total: count(hand.cards).total, outcome: loc(OUT[round.result.hands[i].outcome]),
  }));
  // Walking away leaves the dealer's hole card unturned.
  return round.result.by === "walk" ? [...hands, loc(L.walk, { who: names.you })] : [dealer, ...hands];
}

/**
 * The window's model of a table `{ round, settled }`: the dealer's hand (the hole card face down until the round is over),
 * each of the player's hands with its total, bet and outcome, the controls the player has, and how a finished round came out.
 * `ctx` is `{ name, purse (copper), edge (%), loc }`.
 */
export function blackjackView(table, { name, purse, edge = 0, loc }) {
  const { round } = table, over = !!round.result;
  const legal = legalBlackjack(round);
  const isSoft = (cards) => count(cards).soft && !over;
  const totalText = (cards) => (isSoft(cards) ? loc(L.soft, { n: count(cards).total }) : String(count(cards).total));
  const hands = round.hands.map((hand, i) => {
    const outcome = round.result?.hands[i].outcome ?? null;
    return {
      label: round.hands.length === 1 ? name : loc(i === 0 ? L.first : L.second, { who: name }),
      cards: hand.cards.map(face), total: String(count(hand.cards).total), soft: isSoft(hand.cards), bet: money(hand.bet),
      active: !over && i === round.at, doubled: hand.doubled,
      tag: outcome ? { text: loc(OUT[outcome]), tone: TONE[outcome] } : hand.state === "bust" ? { text: loc(OUT.bust), tone: "bad" } : null,
    };
  });
  const dealer = {
    cards: over ? round.dealer.map(face) : [face(round.dealer[0]), { down: true }],
    total: over ? String(count(round.dealer).total) : null,
  };
  const up = cardName(cardOf(round.dealer[0]));
  const prompt = over ? loc("SDE.town.blackjack.prompt.over")
    : round.hands.length > 1 ? loc("SDE.town.blackjack.prompt.playSplit", { n: round.at + 1, of: round.hands.length, total: totalText(round.hands[round.at].cards), up })
      : loc("SDE.town.blackjack.prompt.play", { total: totalText(round.hands[round.at].cards), up });
  const canPay = (type) => costOf(round, type) <= purse;
  const controls = {
    hit: legal.hit, stand: legal.stand,
    double: legal.double ? { label: loc("SDE.town.blackjack.btn.double", { cost: money(costOf(round, "double")) }), disabled: !canPay("double") } : null,
    split: legal.split ? { label: loc("SDE.town.blackjack.btn.split", { cost: money(costOf(round, "split")) }), disabled: !canPay("split") } : null,
    collect: over && !table.settled,
    over: over && table.settled,
  };
  let result = null;
  if (over) {
    const { net, result: kind } = settleRound(round, edge);
    result = { tone: kind === "win" ? "good" : kind === "lose" ? "bad" : "info", lines: [loc(RESULT_KEYS[kind], { who: name, price: money(Math.abs(net)) })] };
  }
  return {
    game: "blackjack", icon: GAME_ICONS.blackjack, name: loc(GAME_KEYS.blackjack.name), over,
    put: money(round.hands.reduce((sum, h) => sum + h.bet, 0)), dealer, hands, prompt, controls, result,
  };
}
