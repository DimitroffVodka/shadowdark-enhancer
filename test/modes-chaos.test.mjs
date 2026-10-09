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

test("a held round carries the turn the old round ended on, because Foundry 14.369 leaves Combat#previous behind", async () => {
  const { holdChaosRound, heldPrevious } = await import("../scripts/modes-of-play/chaos.mjs");
  const settings = { "shadowdark-enhancer.modeChaosInitiative": true, "shadowdark.useClockwiseInitiative": false };
  globalThis.game = { users: { activeGM: { id: "gm" } }, settings: { get: (ns, key) => settings[`${ns}.${key}`] } };
  const current = { round: 1, turn: 2, combatantId: "Cy", tokenId: null };
  const combat = { combatants: { size: 3 }, current, previous: { round: 1, turn: 1, combatantId: "Bo", tokenId: null } };
  const options = { direction: 1 };
  holdChaosRound(combat, { round: 2, turn: 0 }, options);
  assert.equal(options.turnEvents, false);
  assert.deepEqual(heldPrevious(options), current);
  assert.notEqual(heldPrevious(options), current, "a copy: Foundry records later changes into the live state");
  assert.equal(heldPrevious({ direction: 1 }), null, "an update that was not held has nothing to say");
  assert.equal(heldPrevious(undefined), null);
});
