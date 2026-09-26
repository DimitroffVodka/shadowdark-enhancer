import test from "node:test";
import assert from "node:assert/strict";
import { isChaosRound, chaosOrder } from "../scripts/modes-of-play/chaos.mjs";

test("only a new round from 2 on, going forward, rerolls", () => {
  assert.equal(isChaosRound({ round: 2 }, { direction: 1 }), true);
  assert.equal(isChaosRound({ round: 7 }), true);
  assert.equal(isChaosRound({ round: 1 }, { direction: 1 }), false, "round 1 is untouched");
  assert.equal(isChaosRound({ round: 3 }, { direction: -1 }), false, "going back a round is not a new round");
  assert.equal(isChaosRound({ turn: 2 }), false, "a turn change");
  assert.equal(isChaosRound({ round: 0 }), false);
  assert.equal(isChaosRound(undefined), false);
});

test("the card lists the new order, highest first, ties in tracker order, hidden combatants left out", () => {
  const rows = chaosOrder([
    { name: "Ana", hidden: false, total: 12, formula: "1d20 + 1" },
    { name: "Lurker", hidden: true, total: 19, formula: "1d20 + 3" },
    { name: "Bo", hidden: false, total: 17, formula: "1d20" },
    { name: "Cy", hidden: false, total: 12, formula: "1d20 + 2" },
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.total]), [["Bo", 17], ["Ana", 12], ["Cy", 12]]);
  assert.deepEqual(chaosOrder(), []);
});
