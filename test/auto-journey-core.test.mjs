// The automatic journey's pure rules: an automatic camp's Entertain turns to someone who can still
// gain luck, and the journey's switch and saved destination survive the travel state's sanitizer.
import test from "node:test";
import assert from "node:assert/strict";
import { luckFull, rotateEntertain } from "../scripts/camping/camping-core.mjs";
import { defaultOverlandState, normalizeOverlandState, setAutoGoal } from "../scripts/overland/overland-state-core.mjs";

test("luck is full at the one token of standard mode, or at the world's Pulp cap", () => {
  assert.equal(luckFull({ system: { luck: { available: true } } }), true);
  assert.equal(luckFull({ system: { luck: { available: false } } }), false);
  assert.equal(luckFull({ system: { luck: { remaining: 3 } } }, { pulp: true, max: 4 }), false);
  assert.equal(luckFull({ system: { luck: { remaining: 4 } } }, { pulp: true, max: 4 }), true);
  assert.equal(luckFull({ system: { luck: { remaining: 1 } } }, { pulp: true, max: 0 }), true, "a cap below 1 is 1");
});

test("an Entertain at a full character turns to the next who can gain luck; none left blocks the camp", () => {
  const camp = { phase: "setup", participants: [
    { uuid: "a", task: "entertain", recipientUuid: "b" }, { uuid: "b", task: "" }, { uuid: "c", task: "" },
  ] };
  assert.equal(rotateEntertain(camp, () => false).camp.participants[0].recipientUuid, "b", "a target with room keeps it");
  const turned = rotateEntertain(camp, (u) => u === "b");
  assert.deepEqual([turned.blocked, turned.camp.participants[0].recipientUuid], [false, "c"]);
  const stuck = rotateEntertain(camp, () => true);
  assert.equal(stuck.blocked, true);
  assert.equal(stuck.camp.participants[0].recipientUuid, "b", "nothing changes when nobody can take it");
  assert.equal(rotateEntertain({ ...camp, phase: "awaitingRest" }, () => true).blocked, false, "only a camp being set up turns");
  const two = { phase: "setup", participants: [
    { uuid: "a", task: "entertain", recipientUuid: "c" }, { uuid: "b", task: "entertain", recipientUuid: "c" }, { uuid: "c", task: "" },
  ] };
  const split = rotateEntertain(two, () => false).camp.participants;
  assert.notEqual(split[0].recipientUuid, split[1].recipientUuid, "two Entertains never aim at one character");
});

test("the journey's switch and destination are kept by the sanitizer", () => {
  assert.deepEqual([defaultOverlandState().auto, defaultOverlandState().autoGoal], [false, null]);
  const s = normalizeOverlandState({ ...defaultOverlandState(), auto: true, autoGoal: { i: 3.7, j: 4 } });
  assert.deepEqual([s.auto, s.autoGoal], [true, { i: 3, j: 4 }]);
  assert.equal(normalizeOverlandState({ autoGoal: { i: "x", j: 1 } }).autoGoal, null);
  const set = setAutoGoal(defaultOverlandState(), { i: 1, j: 2 });
  assert.deepEqual([set.changed, set.state.autoGoal], [true, { i: 1, j: 2 }]);
  assert.equal(setAutoGoal(set.state, { i: 1, j: 2 }).changed, false);
  assert.equal(setAutoGoal(set.state, null).state.autoGoal, null);
});
