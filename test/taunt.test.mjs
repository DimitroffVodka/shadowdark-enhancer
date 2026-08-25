/**
 * The Duelist's Taunt — "When an enemy misses you with an attack, you have
 * advantage on attacks against that enemy next round."
 *
 * Ruled as: advantage against THAT enemy, until the end of your next turn.
 *
 * The interesting part is the clock. An enemy normally misses on its own turn,
 * so the Duelist's next turn is a later point in the order and the taunt dies at
 * the end of it. But a miss can land during the Duelist's OWN turn — a readied
 * action, a reaction — and then "your next turn" is the one after this, so the
 * turn it was armed in must not consume it. That is the whole reason
 * `shouldExpire` compares strictly greater-than.
 *
 * The Foundry-bound half (arming from a chat card, setting advantage on the
 * roll, expiring on turn change) is live-verified against a running world.
 * Fixture numbers are invented.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  turnSeq, shouldExpire, mergeAdvantage, armsTaunt, tauntApplies, TURNS_PER_ROUND,
} from "../scripts/taunt/taunt-core.mjs";

// ─── turnSeq: one ordinal for round + turn ─────────────────────────────────

test("later turns and later rounds both sort later", () => {
  assert.ok(turnSeq({ round: 1, turn: 3 }) > turnSeq({ round: 1, turn: 2 }));
  assert.ok(turnSeq({ round: 2, turn: 0 }) > turnSeq({ round: 1, turn: 99 }));
});

test("the round dominates the turn index, which restarts each round", () => {
  // Turn 0 of round 2 is AFTER turn 5 of round 1, even though 0 < 5.
  assert.ok(turnSeq({ round: 2, turn: 0 }) > turnSeq({ round: 1, turn: 5 }));
  assert.equal(turnSeq({ round: 1, turn: 0 }), TURNS_PER_ROUND);
});

test("missing pieces read as zero rather than NaN", () => {
  assert.equal(turnSeq(), 0);
  assert.equal(turnSeq({}), 0);
  assert.equal(turnSeq({ round: 3 }), 3 * TURNS_PER_ROUND);
});

// ─── shouldExpire: end of your NEXT turn ───────────────────────────────────

test("the ordinary case: armed on the enemy's turn, gone at the end of yours", () => {
  const armedAt = turnSeq({ round: 1, turn: 2 });          // goblin swings and misses
  // The Duelist's own turn, later in the same round, now ends.
  assert.equal(shouldExpire({ armedAt, endedSeq: turnSeq({ round: 1, turn: 4 }) }), true);
});

test("it survives the turn it was armed IN — that isn't your NEXT turn", () => {
  // Missed during the Duelist's own turn (readied action, reaction).
  const armedAt = turnSeq({ round: 1, turn: 4 });
  assert.equal(shouldExpire({ armedAt, endedSeq: turnSeq({ round: 1, turn: 4 }) }), false);
  // ...and dies at the end of the following round's turn.
  assert.equal(shouldExpire({ armedAt, endedSeq: turnSeq({ round: 2, turn: 4 }) }), true);
});

test("a turn that ended BEFORE it was armed never expires it", () => {
  const armedAt = turnSeq({ round: 2, turn: 1 });
  assert.equal(shouldExpire({ armedAt, endedSeq: turnSeq({ round: 1, turn: 7 }) }), false);
});

test("armed with no combat running: the first turn the holder finishes ends it", () => {
  assert.equal(shouldExpire({ armedAt: null, endedSeq: 0 }), true);
  assert.equal(shouldExpire({ armedAt: undefined, endedSeq: 50_000 }), true);
  assert.equal(shouldExpire({}), true);
});

test("armed at the very start of a combat still expires normally", () => {
  assert.equal(shouldExpire({ armedAt: 0, endedSeq: 0 }), false);
  assert.equal(shouldExpire({ armedAt: 0, endedSeq: 1 }), true);
});

// ─── mergeAdvantage: Shadowdark cancels, it does not stack ─────────────────

test("a normal roll becomes advantage", () => {
  assert.equal(mergeAdvantage(0), 1);
  assert.equal(mergeAdvantage(), 1);
});

test("advantage stays advantage — it does not double up", () => {
  assert.equal(mergeAdvantage(1), 1);
});

test("disadvantage CANCELS to a normal roll, it is not overwritten", () => {
  // The rules cancel the pair. Quietly turning a disadvantaged roll into an
  // advantaged one would hand the player a benefit they never had.
  assert.equal(mergeAdvantage(-1), 0);
});

// ─── armsTaunt ─────────────────────────────────────────────────────────────

const MISS = {
  isHit: false, parried: false, defenderHasTaunt: true,
  attackerId: "goblin", defenderId: "duelist",
};

test("a miss on a Taunt holder arms it", () => {
  assert.deepEqual(armsTaunt(MISS), { ok: true, reason: "ok" });
});

test("a hit does not", () => {
  assert.deepEqual(armsTaunt({ ...MISS, isHit: true }), { ok: false, reason: "hit" });
});

test("a PARRIED hit does — the rules text makes it a miss", () => {
  assert.equal(armsTaunt({ ...MISS, isHit: true, parried: true }).ok, true);
});

test("no talent, no taunt", () => {
  assert.deepEqual(armsTaunt({ ...MISS, defenderHasTaunt: false }),
    { ok: false, reason: "no-talent" });
});

test("you cannot taunt yourself", () => {
  assert.deepEqual(armsTaunt({ ...MISS, attackerId: "duelist" }),
    { ok: false, reason: "self" });
});

test("an attack with nobody on one end of it is ignored", () => {
  assert.equal(armsTaunt({ ...MISS, attackerId: null }).reason, "no-combatants");
  assert.equal(armsTaunt({ ...MISS, defenderId: null }).reason, "no-combatants");
  assert.equal(armsTaunt().ok, false);
});

// ─── tauntApplies: that enemy, and only that enemy ─────────────────────────

test("the advantage applies to the enemy that missed", () => {
  assert.equal(tauntApplies({ enemyId: "goblin" }, "goblin"), true);
});

test("it does not spill onto the goblin's friends", () => {
  assert.equal(tauntApplies({ enemyId: "goblin" }, "orc"), false);
});

test("no taunt, or no target, applies to nothing", () => {
  assert.equal(tauntApplies(null, "goblin"), false);
  assert.equal(tauntApplies({ enemyId: "goblin" }, null), false);
  assert.equal(tauntApplies({}, "goblin"), false);
});
