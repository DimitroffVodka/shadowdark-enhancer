/**
 * Blackjack at a town table, the rules (pure). Hands are dealt from a stacked deck so every case is exact: `stack` lists the
 * cards in the order they are dealt (the player's first, the dealer's up card, the player's second, the dealer's hole card,
 * then every card drawn after), written as rank then suit, e.g. "AS" or "10H".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyBlackjack, costOf, count, legalBlackjack, newRound, points, settleRound, shuffle, walkAwayBlackjack } from "../scripts/town/blackjack-core.mjs";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"], SUITS = "SHDC";
const card = (name) => SUITS.indexOf(name.slice(-1)) * 13 + RANKS.indexOf(name.slice(0, -1));
/** A deck that deals `names` in order (the round takes cards off the end). */
const stack = (...names) => [...names].reverse().map(card);
const UNIT = 100;
const deal = (...names) => newRound({ unit: UNIT, deck: stack(...names, "2C", "2D", "2H", "2S") });
const play = (round, ...moves) => moves.reduce((r, type) => applyBlackjack(r, type), round);
const outcomes = (round) => round.result.hands.map((h) => h.outcome);

test("cards count their pips, faces ten, aces eleven or one", () => {
  assert.equal(points(card("7S")), 7);
  assert.deepEqual([points(card("10H")), points(card("JD")), points(card("QC")), points(card("KS"))], [10, 10, 10, 10]);
  assert.equal(points(card("AS")), 11);
  assert.deepEqual(count([card("AS"), card("KH")]), { total: 21, soft: true });
  assert.deepEqual(count([card("AS"), card("6H")]), { total: 17, soft: true });
  assert.deepEqual(count([card("AS"), card("6H"), card("10D")]), { total: 17, soft: false });   // the ace falls back to one
  assert.deepEqual(count([card("AS"), card("AH"), card("9D")]), { total: 21, soft: true });
  assert.deepEqual(count([card("AS"), card("AH"), card("AD"), card("AC")]), { total: 14, soft: true });
  assert.equal(count([card("KS"), card("QH"), card("5D")]).total, 25);
});

test("a shuffle is all 52 cards, once each, and follows the random source", () => {
  let seed = 7;
  const rng = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const a = shuffle(rng), b = shuffle(rng);
  assert.deepEqual([...a].sort((x, y) => x - y), Array.from({ length: 52 }, (_, i) => i));
  assert.notDeepEqual(a, b);
  assert.deepEqual(shuffle(() => 0.999999), Array.from({ length: 52 }, (_, i) => i));    // a source that never swaps leaves the deck in order
});

test("the deal is the player, the dealer's up card, the player, the dealer's hole card", () => {
  const round = deal("10S", "6H", "7D", "9C", "5S");
  assert.deepEqual(round.hands[0].cards, [card("10S"), card("7D")]);
  assert.deepEqual(round.dealer, [card("6H"), card("9C")]);
  assert.deepEqual([round.at, round.result, round.hands[0].bet, round.hands[0].state], [0, null, UNIT, "play"]);
  assert.deepEqual(legalBlackjack(round), { hit: true, stand: true, double: true, split: false });
});

test("a natural pays 3 to 2 and ends the hand, unless the dealer has one too", () => {
  const win = deal("AS", "6H", "KD", "5C");
  assert.deepEqual([outcomes(win), win.result.hands[0].mult, win.dealer.length], [["blackjack"], 2.5, 2]);   // the dealer does not draw
  assert.deepEqual(legalBlackjack(win), { hit: false, stand: false, double: false, split: false });

  const both = deal("AS", "KH", "KD", "AC");
  assert.deepEqual(outcomes(both), ["push"]);

  const dealerOnly = deal("10S", "AH", "9D", "KC");
  assert.deepEqual([outcomes(dealerOnly), dealerOnly.hands[0].bet], [["lose"], UNIT]);   // the peek: nothing more was put on the table
});

test("a hit takes a card, 21 stands by itself and going over loses at once", () => {
  const hit = play(deal("5S", "10H", "6D", "7C", "10S"), "hit");
  assert.deepEqual([hit.hands[0].cards.length, hit.hands[0].state, hit.result?.by], [3, "stand", "play"]);   // 5 + 6 + 10 = 21: no choice left
  assert.deepEqual(outcomes(hit), ["win"]);                                     // the dealer's 7 and 10 make 17: 21 wins ...
  const bust = play(deal("10S", "6H", "6D", "9C", "KD"), "hit");
  assert.deepEqual([bust.hands[0].state, outcomes(bust), bust.dealer.length], ["bust", ["bust"], 2]);          // ... and when every hand has bust the dealer does not draw
});

test("the dealer draws to 17 and stands on every 17, soft ones too", () => {
  const draws = play(deal("10S", "6H", "8D", "10C", "5S", "4D"), "stand");
  assert.deepEqual([draws.dealer.length, count(draws.dealer).total, outcomes(draws)], [3, 21, ["lose"]]);   // 16 draws a 5
  const soft17 = play(deal("10S", "AH", "8D", "6C"), "stand");
  assert.deepEqual([soft17.dealer.length, count(soft17.dealer), outcomes(soft17)], [2, { total: 17, soft: true }, ["win"]]);
  const bustsOut = play(deal("10S", "6H", "8D", "10C", "KS"), "stand");
  assert.deepEqual([count(bustsOut.dealer).total, outcomes(bustsOut)], [26, ["win"]]);
  const tie = play(deal("10S", "9H", "8D", "9C"), "stand");
  assert.deepEqual(outcomes(tie), ["push"]);
});

test("a double is one more wager and exactly one more card, on a hand of two cards", () => {
  const start = deal("6S", "10H", "5D", "7C", "10D");
  assert.equal(costOf(start, "double"), UNIT);
  assert.equal(costOf(start, "hit"), 0);
  const doubled = play(start, "double");
  assert.deepEqual([doubled.hands[0].bet, doubled.hands[0].doubled, doubled.hands[0].cards.length, outcomes(doubled)], [200, true, 3, ["win"]]);   // 21 against 17
  assert.throws(() => applyBlackjack(play(deal("2S", "10H", "3D", "7C", "2D"), "hit"), "double"), /cannot double/);
  const over = play(deal("10S", "10H", "6D", "7C", "KD"), "double");
  assert.deepEqual([over.hands[0].bet, outcomes(over)], [200, ["bust"]]);
});

test("a pair splits into two hands, each with a new card and its own wager, and only once", () => {
  const start = deal("8S", "10H", "8D", "7C", "3S", "2H", "10D", "KC");
  assert.deepEqual(legalBlackjack(start), { hit: true, stand: true, double: true, split: true });
  assert.equal(costOf(start, "split"), UNIT);
  const split = applyBlackjack(start, "split");
  assert.deepEqual(split.hands.map((h) => h.cards), [[card("8S"), card("3S")], [card("8D"), card("2H")]]);
  assert.deepEqual(split.hands.map((h) => [h.bet, h.split]), [[UNIT, true], [UNIT, true]]);
  assert.deepEqual([split.at, legalBlackjack(split).split], [0, false]);          // no splitting again
  const one = play(split, "hit");                                                   // 8 + 3 + 10 = 21 stands by itself
  assert.deepEqual([one.at, one.hands[0].state], [1, "stand"]);
  const done = play(one, "stand");                                                  // 10 against the dealer's 17 ...
  assert.deepEqual(outcomes(done), ["win", "lose"]);                                // ... 21 wins, 10 loses
  assert.equal(costOf(split, "double"), UNIT);                                      // a split hand may double

  const faces = applyBlackjack(deal("KS", "6H", "QD", "9C", "2S", "2D"), "split");   // ten-value cards pair up
  assert.equal(faces.hands.length, 2);
  assert.throws(() => applyBlackjack(deal("KS", "6H", "9D", "9C"), "split"), /cannot split/);
  assert.throws(() => applyBlackjack(play(deal("2S", "6H", "2D", "9C", "3S"), "hit"), "split"), /cannot split/);
});

test("split aces take one card each and stand, and 21 on a split hand is not a blackjack", () => {
  const split = applyBlackjack(deal("AS", "6H", "AD", "10C", "KS", "5D", "9C", "2H"), "split");
  assert.deepEqual(split.hands.map((h) => h.state), ["stand", "stand"]);
  assert.deepEqual(split.hands.map((h) => count(h.cards).total), [21, 16]);
  assert.deepEqual([outcomes(split)[0], split.result.hands[0].mult], ["win", 2]);   // 21 pays 1 to 1 here
});

test("settling: wagers that survive come back, the town's cut is only taken from winnings", () => {
  const lost = play(deal("10S", "6H", "9D", "10C", "5S", "KD"), "stand");          // the dealer's 16 draws a 5 to make 21 against 19
  assert.deepEqual(outcomes(lost), ["lose"]);
  assert.deepEqual(settleRound(lost, 5), { put: 100, net: -100, payBack: 0, result: "lose" });

  const normal = play(deal("10S", "6H", "9D", "10C", "KS"), "stand");              // dealer busts
  assert.deepEqual(settleRound(normal, 5), { put: 100, net: 95, payBack: 195, result: "win" });
  assert.deepEqual(settleRound(normal, 0), { put: 100, net: 100, payBack: 200, result: "win" });

  const natural = deal("AS", "6H", "KD", "5C");
  assert.deepEqual(settleRound(natural, 0), { put: 100, net: 150, payBack: 250, result: "win" });
  assert.deepEqual(settleRound(natural, 5), { put: 100, net: 142, payBack: 242, result: "win" });

  const push = play(deal("10S", "9H", "8D", "9C"), "stand");
  assert.deepEqual(settleRound(push, 5), { put: 100, net: 0, payBack: 100, result: "push" });

  const doubledLoss = play(deal("6S", "10H", "5D", "9C", "2D"), "double");           // 13 against 19
  assert.deepEqual(settleRound(doubledLoss, 5), { put: 200, net: -200, payBack: 0, result: "lose" });

  const twoHands = play(applyBlackjack(deal("8S", "10H", "8D", "7C", "3S", "2H", "10D", "KC"), "split"), "hit", "stand");
  assert.deepEqual(outcomes(twoHands), ["win", "lose"]);
  assert.deepEqual(settleRound(twoHands, 5), { put: 200, net: 95 - 100, payBack: 195, result: "lose" });   // a win and a loss, the cut on the win only
});

test("walking away gives the house everything on the table, and the dealer's hole card stays down", () => {
  const split = applyBlackjack(deal("8S", "10H", "8D", "7C", "3S", "2H"), "split");
  const walked = walkAwayBlackjack(split);
  assert.deepEqual([walked.result.by, outcomes(walked), walked.dealer.length], ["walk", ["lose", "lose"], 2]);
  assert.deepEqual(settleRound(walked, 5), { put: 200, net: -200, payBack: 0, result: "lose" });
  assert.equal(split.result, null);                                                  // the round it came from is untouched
});

test("nothing is allowed once the hand is over, and the round it came from is never changed", () => {
  const over = deal("AS", "6H", "KD", "5C");
  for (const type of ["hit", "stand", "double", "split"]) assert.throws(() => applyBlackjack(over, type), /cannot/);
  const start = deal("10S", "6H", "9D", "10C", "KS");
  const before = JSON.stringify(start);
  applyBlackjack(start, "hit");
  assert.equal(JSON.stringify(start), before);
});

test("copying the dealer loses what the casinos say it does, about 5.5% (a check that the whole engine pays right)", () => {
  let seed = 1234567;
  const rng = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  let put = 0, net = 0;
  for (let i = 0; i < 60000; i++) {
    let round = newRound({ unit: UNIT, deck: shuffle(rng) });
    while (!round.result) round = applyBlackjack(round, count(round.hands[round.at].cards).total < 17 ? "hit" : "stand");
    const s = settleRound(round, 0);
    put += s.put;
    net += s.net;
  }
  const edge = -net / put;
  assert.ok(edge > 0.04 && edge < 0.07, `house edge ${(edge * 100).toFixed(2)}%`);
});
