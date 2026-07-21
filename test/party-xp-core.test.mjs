import test from "node:test";
import assert from "node:assert/strict";
import { normalizeXp, pickItemXp, planAward, XP_PER_LEVEL } from "../scripts/party-xp/party-xp-core.mjs";

test("normalizeXp treats missing as null, not zero", () => {
  assert.equal(normalizeXp(null), null);
  assert.equal(normalizeXp(undefined), null);
  assert.equal(normalizeXp(""), null);
  assert.equal(normalizeXp("abc"), null);
  assert.equal(normalizeXp(-5), null);
  assert.equal(normalizeXp(0), 0);
  assert.equal(normalizeXp("7"), 7);
  assert.equal(normalizeXp(3.6), 4); // rounds
});

test("pickItemXp prefers a tagged value over the loot score", () => {
  const r = pickItemXp({ flagXp: 12, gp: 100, magic: true }, {});
  assert.equal(r.xp, 12);
  assert.equal(r.source, "flag");
});

test("pickItemXp falls back to the loot score when untagged", () => {
  const r = pickItemXp({ flagXp: null, gp: 0, magic: false, bonus: 0 }, {});
  assert.equal(r.source, "score");
  assert.equal(typeof r.xp, "number");
  assert.ok(r.xp >= 0);
});

test("planAward computes before/added/after and level readiness", () => {
  assert.deepEqual(planAward(3, 4), { before: 3, added: 4, after: 7, readyToLevel: false });
  const r = planAward(6, 4);
  assert.equal(r.after, XP_PER_LEVEL);
  assert.equal(r.readyToLevel, true);
  // missing inputs coerce to 0, not NaN
  assert.deepEqual(planAward(null, null), { before: 0, added: 0, after: 0, readyToLevel: false });
});
