import test from "node:test";
import assert from "node:assert/strict";
import { haggleControl, haggleResult, haggleState, haggleFlagPaths } from "../scripts/merchant/haggle-core.mjs";

const MOD = "shadowdark-enhancer";
const pctAt = (d20, mod = 0) => { const r = haggleResult(d20, mod); return r.banned ? "ban" : r.pct; };

test("the ladder, edge by edge, at CHA +0", () => {
  const want = { 1: "ban", 2: 25, 4: 25, 5: 10, 7: 10, 8: 0, 10: 0, 11: -5, 13: -5, 14: -10, 16: -10, 17: -15, 19: -15, 20: -25 };
  for (const [d20, pct] of Object.entries(want)) assert.equal(pctAt(Number(d20)), pct, `d20 ${d20}`);
});

test("a natural 1 is a ban even with a big bonus, a natural 20 is the top step even with a penalty", () => {
  assert.equal(pctAt(1, 4), "ban");
  assert.equal(pctAt(20, -3), -25);
});

test("the modifier moves the total: +3 turns a 14 into a 17; a total of 1 or less is a ban without a natural 1", () => {
  assert.equal(pctAt(14, 3), -15);
  assert.equal(pctAt(4, -3), "ban");
  assert.equal(pctAt(5, -3), 25);
  assert.equal(pctAt(2, -1), "ban");
  assert.equal(pctAt(3, -1), 25);
});

const merchant = { id: "m1", rev: 2 };
test("haggle state reads the character's flags: one attempt per restock, a ban for good", () => {
  const none = { flags: {} };
  assert.deepEqual(haggleState(none, merchant), { banned: false, rev: 2, haggled: false, pct: 0, tier: "", canHaggle: true });
  const done = { flags: { [MOD]: { shopHaggle: { m1: { rev: 2, pct: -10, tier: "good" } } } } };
  assert.deepEqual(haggleState(done, merchant), { banned: false, rev: 2, haggled: true, pct: -10, tier: "good", canHaggle: false });
  const restocked = haggleState(done, { ...merchant, rev: 3 });
  assert.deepEqual([restocked.pct, restocked.canHaggle], [0, true]);
  const banned = { flags: { [MOD]: { shopBan: { m1: true }, shopHaggle: { m1: { rev: 0, pct: 0, tier: "banned" } } } } };
  assert.deepEqual([haggleState(banned, { ...merchant, rev: 9 }).banned, haggleState(banned, { ...merchant, rev: 9 }).canHaggle], [true, false]);
  assert.equal(haggleState(none, { ...merchant, haggle: false }).canHaggle, false);
});

test("flag paths are dotted and refuse an id that is not a key", () => {
  assert.deepEqual(haggleFlagPaths(merchant), { haggle: `flags.${MOD}.shopHaggle.m1`, ban: `flags.${MOD}.shopBan.m1`, banKey: "shopBan.m1" });
  assert.throws(() => haggleFlagPaths({ id: "a.b" }));
});

test("the header control does not depend on the cart: shown when open and allowed, enabled while an attempt is open", () => {
  const fresh = haggleState({ flags: {} }, merchant);
  assert.deepEqual(haggleControl(fresh, merchant), { show: true, canHaggle: true, enabled: true });
  assert.equal(haggleControl(fresh, merchant, { busy: true }).enabled, false);
  assert.equal(haggleControl(fresh, { ...merchant, haggle: false }).show, false);
  assert.equal(haggleControl(fresh, merchant, { open: false }).show, false);
  const tried = haggleState({ flags: { [MOD]: { shopHaggle: { m1: { rev: 2, pct: -5, tier: "fair" } } } } }, merchant);
  assert.deepEqual(haggleControl(tried, merchant), { show: true, canHaggle: false, enabled: false });
});
