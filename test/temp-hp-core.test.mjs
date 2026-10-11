import test from "node:test";
import assert from "node:assert/strict";
import { tempHpValue, spendTempHp, tempHpFlag, largerPool, legacyCookSurplus } from "../scripts/shared/temp-hp-core.mjs";

test("a pool reads as its points until it expires, and a missing or malformed one as 0", () => {
  assert.equal(tempHpValue({ value: 2, expires: null }, 5), 2);
  assert.equal(tempHpValue({ value: 2, expires: 10 }, 9), 2);
  assert.equal(tempHpValue({ value: 2, expires: 10 }, 10), 0);
  for (const bad of [undefined, null, {}, { value: "x" }, { value: -3 }, { value: 0 }]) assert.equal(tempHpValue(bad, 0), 0);
});

test("damage spends the pool first and only the overflow lands on HP", () => {
  const pool = { value: 5, expires: null };
  assert.deepEqual(spendTempHp(pool, 3, 0), { left: 2, rest: 0 });
  assert.deepEqual(spendTempHp(pool, 5, 0), { left: 0, rest: 0 });
  assert.deepEqual(spendTempHp(pool, 8, 0), { left: 0, rest: 3 });
  assert.deepEqual(spendTempHp({ value: 5, expires: 1 }, 4, 1), { left: 0, rest: 4 }, "an expired pool absorbs nothing");
});

test("temp HP do not stack: a grant replaces the pool only when larger", () => {
  const pool = { value: 4, expires: 100 };
  assert.equal(largerPool(pool, 2, 200, 0), null);
  assert.equal(largerPool(pool, 4, 200, 0), null);
  assert.deepEqual(largerPool(pool, 6, 200, 0), { value: 6, expires: 200 });
  assert.deepEqual(largerPool(pool, 1, null, 100), { value: 1, expires: null }, "an expired pool is as good as none");
  assert.equal(largerPool(null, 0, null, 0), null);
});

test("an empty pool is stored as no flag", () => {
  assert.equal(tempHpFlag(0), null);
  assert.deepEqual(tempHpFlag(3, 50), { value: 3, expires: 50 });
});

test("only the Cook surplus still over the maximum moves into the pool", () => {
  const live = { remaining: 2, expires: 100 };
  assert.equal(legacyCookSurplus({ value: 5, max: 3 }, live), 2);
  assert.equal(legacyCookSurplus({ value: 4, max: 3 }, live), 1, "one point was already spent");
  assert.equal(legacyCookSurplus({ value: 3, max: 3 }, live), 0);
  assert.equal(legacyCookSurplus({ value: 9, max: 3 }, { remaining: 2 }), 2, "a hand-raised surplus is not the meal's");
  assert.equal(legacyCookSurplus({ value: 5, max: 3 }, { ...live, remaining: 0 }), 0, "already moved");
  assert.equal(legacyCookSurplus({ value: 5, max: 3 }, { ...live, expired: true }), 0);
  assert.equal(legacyCookSurplus({ value: 5, max: 3 }, { campId: "c", expires: 100 }), 0, "a new-shape meal has none");
});
