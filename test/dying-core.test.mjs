import test from "node:test";
import assert from "node:assert/strict";
import {
  DYING_KEYS, modifier, timerRoll, deathTimer, stabilizeDC, riseMin, turnOutcome, hpAction, shouldTick, badge,
  checkedNatural, cardStabilizes,
} from "../scripts/dying/dying-core.mjs";

const actorWith = (flags) => ({ flags: { "shadowdark-enhancer": flags } });

test("the death timer is 1d4 + CON modifier, with a die and a bonus from modifiers", () => {
  assert.deepEqual(timerRoll({ con: 2 }), { formula: "1d4 + 2", faces: 4, mod: 2 });
  assert.deepEqual(timerRoll({ con: -1 }), { formula: "1d4 - 1", faces: 4, mod: -1 });
  assert.deepEqual(timerRoll({}), { formula: "1d4", faces: 4, mod: 0 });
  // River of Death's d6 and the Gladiator's +1.
  assert.deepEqual(timerRoll({ die: 6, bonus: 1, con: 0 }), { formula: "1d6 + 1", faces: 6, mod: 1 });
  assert.deepEqual(timerRoll({ die: 6, bonus: 1, con: -2 }), { formula: "1d6 - 2 + 1", faces: 6, mod: -1 });
});

test("Deadly's timer of 1 beats every die and bonus: there is no roll", () => {
  assert.equal(timerRoll({ deadly: true, die: 6, bonus: 3, con: 4 }), null);
});

test("the timer is at least 1, whatever the CON modifier", () => {
  assert.equal(deathTimer(1 - 3), 1, "1 on the d4 with CON -3");
  assert.equal(deathTimer(0), 1);
  assert.equal(deathTimer(5), 5);
  assert.equal(deathTimer(undefined), 1);
});

test("stabilize is DC 15, 18 under Deadly or near a Draugr, and the helper's own DC beats both", () => {
  assert.equal(stabilizeDC({}), 15);
  assert.equal(stabilizeDC({ deadly: true }), 18);
  assert.equal(stabilizeDC({ nearDCs: [18] }), 18, "Death Chill");
  assert.equal(stabilizeDC({ nearDCs: [undefined, 12] }), 15, "a near DC never lowers it");
  assert.equal(stabilizeDC({ ownDC: 12, deadly: true }), 12, "Heath Witch training keeps DC 12 under Deadly");
  assert.equal(stabilizeDC({ ownDC: 12, nearDCs: [18] }), 12);
  assert.equal(stabilizeDC({ ownDC: undefined, deadly: true }), 18);
});

test("a natural 20 rises; a 19 does not unless a rise range applies", () => {
  assert.deepEqual(turnOutcome({ natural: 20, timer: 3 }), { result: "rise", timer: 3 });
  assert.deepEqual(turnOutcome({ natural: 19, timer: 3 }), { result: "tick", timer: 2 });
  assert.deepEqual(turnOutcome({ natural: 19, timer: 3, riseMin: 18 }), { result: "rise", timer: 3 });
});

test("the timer drops by one a turn and the PC dies at 0", () => {
  assert.deepEqual(turnOutcome({ natural: 5, timer: 2 }), { result: "tick", timer: 1 });
  assert.deepEqual(turnOutcome({ natural: 5, timer: 1 }), { result: "dead", timer: 0 });
  assert.deepEqual(turnOutcome({ natural: 20, timer: 1 }), { result: "rise", timer: 1 }, "a 20 on the last round still rises");
});

test("the rise range: Last Stand or an ally's Inspiring Presence, never below 2", () => {
  assert.equal(riseMin({}), 20);
  assert.equal(riseMin({ own: 18 }), 18);
  assert.equal(riseMin({ near: [undefined, 17] }), 17, "Improved Inspiring Presence");
  assert.equal(riseMin({ own: 18, near: [17] }), 17);
  assert.equal(riseMin({ own: 1 }), 2, "a natural 1 never rises");
  assert.equal(riseMin({ own: 25 }), 20);
});

test("0 HP starts dying, or kills under Fatality; healing above 0 clears", () => {
  assert.equal(hpAction({ hp: 0, tracked: false, dead: false }), "dying");
  assert.equal(hpAction({ hp: 0, tracked: false, dead: false, fatality: true }), "die");
  assert.equal(hpAction({ hp: 0, tracked: true, dead: false }), null, "already dying or stable");
  assert.equal(hpAction({ hp: 4, tracked: true, dead: false }), "clear");
  assert.equal(hpAction({ hp: 4, tracked: false, dead: false }), null);
  assert.equal(hpAction({ hp: 0, tracked: false, dead: true }), null, "the dead stay dead");
  assert.equal(hpAction({ hp: 5, tracked: false, dead: true, fatality: true }), null);
});

test("the hidden timer: players never see the count, the GM always does", () => {
  const dying = { timer: 3, stable: false };
  assert.deepEqual(badge(dying, { hidden: true, isGM: false }), { kind: "dying", rounds: null });
  assert.deepEqual(badge(dying, { hidden: true, isGM: true }), { kind: "dying", rounds: 3 });
  assert.deepEqual(badge(dying, { hidden: false, isGM: false }), { kind: "dying", rounds: 3 });
  assert.deepEqual(badge({ timer: null, stable: true }, { hidden: false, isGM: true }), { kind: "stable", rounds: null });
  assert.equal(badge(null, { hidden: false, isGM: true }), null);
});

test("modifiers are read off the actor's derived flags, numbers from strings too", () => {
  assert.equal(modifier(actorWith({ dyingTimerDie: 6 }), "timerDie"), 6);
  assert.equal(modifier(actorWith({ stabilizeDC: "12" }), "stabilizeDC"), 12);
  assert.equal(modifier(actorWith({}), "timerBonus"), undefined);
  assert.equal(modifier(actorWith({ dyingRiseMin: "x" }), "riseMin"), undefined);
  assert.equal(modifier({}, "riseMin"), undefined);
  assert.equal(modifier(actorWith({ noDeathAtZeroCon: true }), "noDeathAtZeroCon"), true);
  assert.equal(modifier(actorWith({}), "noDeathAtZeroCon"), false);
  assert.equal(modifier(actorWith({ noDeathAtZeroCon: 1 }), "noDeathAtZeroCon"), true, "training effects carry numbers");
  assert.equal(modifier(actorWith({ noDeathAtZeroCon: 0 }), "noDeathAtZeroCon"), false);
  assert.equal(DYING_KEYS.timerDie, "flags.shadowdark-enhancer.dyingTimerDie");
  assert.ok(Object.values(DYING_KEYS).every((k) => k.split(".").length === 3), "no dot inside a flag key");
});

test("only a real natural die comes back from a player; the GM adds the modifiers", () => {
  assert.equal(checkedNatural({ ok: true, natural: 14 }, 20), 14);
  assert.equal(checkedNatural({ natural: 21 }, 20), null);
  assert.equal(checkedNatural({ natural: 0 }, 4), null);
  assert.equal(checkedNatural({ natural: "3" }, 4), null);
  assert.equal(checkedNatural({ total: 3 }, 4), null, "a total alone is never taken");
  assert.equal(checkedNatural(null, 20), null);
  // The timer is the natural die plus what the GM works out, minimum 1.
  const r = timerRoll({ con: -2, bonus: 1 });
  assert.equal(deathTimer(checkedNatural({ natural: 4, total: 99 }, r.faces) + r.mod), 3);
});

test("a round counts once: the same round again does not", () => {
  assert.equal(shouldTick(null, "c1", 1), true, "the first turn after dropping");
  assert.equal(shouldTick({ scope: "c1", round: 3 }, "c1", 3), false, "a second turn start in round 3 (Chaos, a replay)");
  assert.equal(shouldTick({ scope: "c1", round: 3 }, "c1", 4), true);
});

test("a rewind and the replay forward never cost a round twice", () => {
  // Ticked in round 3; the GM goes back to round 2, then forward again. Foundry
  // starts every turn passed, so round 2's turn and round 3's both fire.
  const last = { scope: "c1", round: 3 };
  assert.equal(shouldTick(last, "c1", 2), false);
  assert.equal(shouldTick(last, "c1", 3), false);
  assert.equal(shouldTick(last, "c1", 4), true, "round 4 is new");
  // The same for the crawl's rounds.
  assert.equal(shouldTick({ scope: "crawl", round: 7 }, "crawl", 5), false);
  assert.equal(shouldTick({ scope: "crawl", round: 7 }, "crawl", 8), true);
});

test("a new combat, or the crawl after one, always counts", () => {
  assert.equal(shouldTick({ scope: "c1", round: 5 }, "c2", 1), true);
  assert.equal(shouldTick({ scope: "c1", round: 5 }, "crawl", 2), true);
  assert.equal(shouldTick({ scope: "crawl", round: 9 }, "c1", 1), true);
  assert.equal(shouldTick(null, "c1", undefined), false, "no round, no tick");
});

test("a stabilize card counts only from the helper's owner or a GM, on the GM's DC", () => {
  const card = { authorIsGM: false, authorOwnsHelper: true, helperIsTarget: false, total: 15, dc: 15 };
  assert.equal(cardStabilizes(card), true);
  assert.equal(cardStabilizes({ ...card, total: 14 }), false, "a failed check, or a card claiming a lower DC");
  assert.equal(cardStabilizes({ ...card, authorOwnsHelper: false }), false, "someone else's character");
  assert.equal(cardStabilizes({ ...card, authorOwnsHelper: false, authorIsGM: true }), true, "a GM rolling an NPC ally");
  assert.equal(cardStabilizes({ ...card, helperIsTarget: true }), false, "nobody stabilizes themselves");
  assert.equal(cardStabilizes({ ...card, total: undefined }), false);
  assert.equal(cardStabilizes({ ...card, total: 20, dc: 18 }), true, "Deadly");
});
