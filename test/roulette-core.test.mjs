/**
 * The roulette board (pure): chips on spots, and a spin that settles every spot at once. The expected return of any layout
 * is enumerated over the twenty faces, so a mix of fair bets is fair and the town's cut is the only edge.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BOARD_ROWS, OUTSIDE, addChip, boardStake, chipCount, removeChip, spinBoard, validBoard } from "../scripts/town/roulette-core.mjs";

test("the board is the numbers 1 to 20 five to a row, and four outside bets", () => {
  assert.deepEqual(BOARD_ROWS, [["1", "2", "3", "4", "5"], ["6", "7", "8", "9", "10"], ["11", "12", "13", "14", "15"], ["16", "17", "18", "19", "20"]]);
  assert.deepEqual(OUTSIDE, ["even", "odd", "low", "high"]);
});

test("chips are added and taken off one at a time without touching the layout they came from", () => {
  const a = addChip({}, "even");
  const b = addChip(addChip(a, "even"), "7");
  assert.deepEqual([a, b], [{ even: 1 }, { even: 2, 7: 1 }]);
  assert.deepEqual(removeChip(b, "even"), { even: 1, 7: 1 });
  assert.deepEqual(removeChip(removeChip(b, "7"), "7"), { even: 2 });
  assert.deepEqual(removeChip({}, "odd"), {});
  assert.equal(chipCount(b), 3);
  assert.equal(boardStake(b, 100), 300);
  assert.deepEqual(a, { even: 1 });
});

test("a board is valid with at least one real bet and a whole number of chips on each", () => {
  assert.equal(validBoard({ even: 1, 20: 3 }), true);
  for (const bad of [{}, undefined, null, { red: 1 }, { 21: 1 }, { even: 0 }, { even: -1 }, { even: 1.5 }, { even: "2" }]) assert.equal(validBoard(bad), false, JSON.stringify(bad));
});

test("a spin settles every spot: a win pays the odds less the cut, a loss costs the chips, and the spots add up", () => {
  const board = { even: 2, high: 1, 17: 1 };
  const win = spinBoard({ bets: board, chip: 100, d20: 17, edge: 5 });          // odd, high, and the number itself
  const byPick = (r) => Object.fromEntries(r.spots.map((s) => [s.pick, [s.won, s.net]]));
  assert.deepEqual(byPick(win), { even: [false, -200], high: [true, 95], 17: [true, Math.floor(100 * 19 * 0.95)] });
  assert.equal(win.net, -200 + 95 + 1805);
  assert.equal(win.result, "win");
  const lose = spinBoard({ bets: board, chip: 100, d20: 4, edge: 5 });          // even wins, high and 17 lose
  assert.deepEqual(byPick(lose), { even: [true, 190], high: [false, -100], 17: [false, -100] });
  assert.deepEqual([lose.net, lose.result], [-10, "lose"]);
  assert.equal(spinBoard({ bets: { even: 1, odd: 1 }, chip: 100, d20: 6, edge: 0 }).result, "push");   // one wins, one loses, with no cut
  assert.equal(spinBoard({ bets: { even: 1 }, chip: 100, d20: 6, edge: 0 }).d20, 6);
});

test("with no cut any layout of chips returns exactly what is laid, averaged over the twenty faces", () => {
  const layouts = [{ even: 1 }, { odd: 3, 9: 1 }, { low: 1, high: 1 }, { even: 2, odd: 1, low: 1, 1: 1, 20: 2 }, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), 1]))];
  for (const bets of layouts) {
    let net = 0;
    for (let d20 = 1; d20 <= 20; d20++) net += spinBoard({ bets, chip: 100, d20, edge: 0 }).net;
    assert.equal(net, 0, JSON.stringify(bets));
  }
  let withCut = 0;
  for (let d20 = 1; d20 <= 20; d20++) withCut += spinBoard({ bets: { even: 1, 7: 1 }, chip: 100, d20, edge: 5 }).net;
  assert.ok(withCut < 0);                                                        // the cut is the house's whole edge
});
