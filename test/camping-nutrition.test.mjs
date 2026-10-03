import test from "node:test";
import assert from "node:assert/strict";
import { mealPlan, restEligible } from "../scripts/camping/camping-core.mjs";
const stacks = [{ actorUuid: "a", id: "own", quantity: 1 }, { actorUuid: "party", id: "shared", quantity: 5 }, { actorUuid: "b", id: "hunt", quantity: 10 }];
test("personal first, consent for current shortfall only, never another PC's Hunt", () => {
  assert.deepEqual(mealPlan(stacks, "a", "party", 2, false), { fed: false, own: 1, shortfall: 1, deductions: [] });
  assert.deepEqual(mealPlan(stacks, "a", "party", 2, true).deductions, [{ actorUuid: "a", id: "own", quantity: 1 }, { actorUuid: "party", id: "shared", quantity: 1 }]);
  assert.equal(mealPlan(stacks, "a", "party", 8, true).fed, false);
  assert.deepEqual(mealPlan(stacks, "a", "party", 8, true).deductions, []);
  assert.deepEqual(mealPlan([{ ...stacks[0], quantity: 2 }, stacks[1]], "a", "party", 2, true).deductions, [{ actorUuid: "a", id: "own", quantity: 2 }]);
});
test("fed PCs rest individually; interrupted requires saved CON or Bed Down, hunger never recovers", () => {
  assert.equal(restEligible(false, false, true, true), false);
  assert.equal(restEligible(true, false, false, false), true);
  assert.equal(restEligible(true, true, false, false), false);
  assert.equal(restEligible(true, true, true, false), true);
  assert.equal(restEligible(true, true, false, true), true);
});
