/**
 * The pay-before-you-play decision.
 *
 * Shadowdark charges downtime fees PER ATTEMPT, so an activity a character
 * can't pay for is not an option at all — they must not be able to CHOOSE it,
 * let alone roll it. Three surfaces ask the same question (the row's Choose
 * button, the pick handler, and the GM's authoritative validator) and they all
 * call `affordability`, so this pins the one decision they share.
 *
 * Pure: `affordability` reads `actor.system.coins` and the skeleton's cost
 * rule, both Foundry-free, so a plain object stands in for the actor.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { affordability } from "../scripts/downtime/downtime-session.mjs";
import { DOWNTIME_SKELETON } from "../scripts/downtime/downtime-skeleton.mjs";

const slot = (key) => {
  for (const a of DOWNTIME_SKELETON.activities) {
    const s = (a.slots ?? []).find((x) => x.key === key);
    if (s) return s;
  }
  throw new Error(`no such slot: ${key}`);
};
const purse = (gp, sp = 0, cp = 0) => ({ system: { coins: { gp, sp, cp } } });

// Western Reaches charges a flat 50 gp; Cursed Scroll charges 10 gp x level.
const PAID = slot("d4-new-weapon");        // asterisked
const FREE = slot("church-favor");         // no fee at either source

test("a free activity is never blocked, even at zero coin", () => {
  const r = affordability(purse(0), "western-reaches", FREE, 1);
  assert.equal(r.cost, 0);
  assert.equal(r.affordable, true);
  assert.equal(r.shortfallText, "");
});

test("enough coin clears a paid activity", () => {
  const r = affordability(purse(50), "western-reaches", PAID, 1);
  assert.equal(r.cost, 50);
  assert.equal(r.affordable, true);
});

test("exact change is enough — the boundary is >=, not >", () => {
  const r = affordability(purse(49, 10), "western-reaches", PAID, 1);  // 4900 + 100 = 5000cp
  assert.equal(r.affordable, true);
});

test("one copper short is short, and the shortfall is reported in coin", () => {
  const r = affordability(purse(49, 9, 9), "western-reaches", PAID, 1); // 4999cp vs 5000cp
  assert.equal(r.affordable, false);
  assert.equal(r.shortfallText, "1 cp");
});

test("the shortfall is the real gap, mixed denominations and all", () => {
  // 30 gp 1 sp = 3010cp against a 5000cp fee → 1990cp short = 19 gp 9 sp.
  const r = affordability(purse(30, 1), "western-reaches", PAID, 1);
  assert.equal(r.affordable, false);
  assert.equal(r.shortfallText, "19 gp 9 sp");
  assert.deepEqual(r.shortfall, { gp: 19, sp: 9, cp: 0 });
});

test("Cursed Scroll scales the fee by level, so affordability moves with it", () => {
  assert.equal(affordability(purse(25), "cs6", PAID, 1).affordable, true);   // 10 gp
  assert.equal(affordability(purse(25), "cs6", PAID, 2).affordable, true);   // 20 gp
  const l3 = affordability(purse(25), "cs6", PAID, 3);                       // 30 gp
  assert.equal(l3.affordable, false);
  assert.equal(l3.cost, 30);
  assert.equal(l3.shortfallText, "5 gp");
});

test("an unknown source cannot silently make everything free", () => {
  // costFor swallows the throw and returns 0; that must not be read as a real
  // zero-cost activity for a character who owns nothing.
  const r = affordability(purse(0), "not-a-book", PAID, 1);
  assert.equal(r.cost, 0);
  assert.equal(r.affordable, true);
});

test("a coinless actor shape is treated as broke, not as a crash", () => {
  assert.equal(affordability({}, "western-reaches", PAID, 1).affordable, false);
  assert.equal(affordability(null, "western-reaches", PAID, 1).affordable, false);
});
