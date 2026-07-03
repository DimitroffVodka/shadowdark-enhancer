import test from "node:test";
import assert from "node:assert/strict";
import {
  toCopper, fromCopper, formatPrice, canAfford, applySellRatio,
  addToPurse, spendFromPurse, parseCoinsFromText,
} from "../scripts/util/coins.mjs";

test("toCopper / fromCopper round-trip", () => {
  assert.equal(toCopper({ gp: 1, sp: 2, cp: 3 }), 123);
  assert.deepEqual(fromCopper(123), { gp: 1, sp: 2, cp: 3 });
  assert.deepEqual(fromCopper(0), { gp: 0, sp: 0, cp: 0 });
  assert.deepEqual(fromCopper(-50), { gp: 0, sp: 0, cp: 0 }); // clamped
});

test("formatPrice", () => {
  assert.equal(formatPrice({ gp: 2, sp: 5, cp: 0 }), "2 gp 5 sp");
  assert.equal(formatPrice({ gp: 0, sp: 0, cp: 10 }), "10 cp");
  assert.equal(formatPrice({ gp: 0, sp: 0, cp: 0 }), "Free");
});

test("canAfford", () => {
  assert.equal(canAfford({ gp: 1 }, { sp: 5 }), true);
  assert.equal(canAfford({ sp: 4 }, { sp: 5 }), false);
  assert.equal(canAfford({ gp: 1 }, { gp: 1 }), true); // exact
});

test("applySellRatio floors", () => {
  assert.deepEqual(applySellRatio({ gp: 1 }, 50), { gp: 0, sp: 5, cp: 0 });
  assert.deepEqual(applySellRatio({ cp: 5 }, 50), { gp: 0, sp: 0, cp: 2 }); // floor(2.5)
});

test("addToPurse preserves denominations (no renormalization)", () => {
  assert.deepEqual(addToPurse({ gp: 0, sp: 150, cp: 0 }, { sp: 10 }), { gp: 0, sp: 160, cp: 0 });
  assert.deepEqual(addToPurse({ gp: 1, sp: 1, cp: 1 }, { gp: 2, sp: 3, cp: 4 }), { gp: 3, sp: 4, cp: 5 });
});

test("spendFromPurse preserves denominations", () => {
  assert.deepEqual(spendFromPurse({ gp: 0, sp: 150, cp: 0 }, 200), { gp: 0, sp: 130, cp: 0 });
  assert.deepEqual(spendFromPurse({ gp: 5, sp: 0, cp: 0 }, 155), { gp: 3, sp: 4, cp: 5 });
  assert.deepEqual(spendFromPurse({ gp: 2, sp: 5, cp: 0 }, 250), { gp: 0, sp: 0, cp: 0 }); // exact
});

test("spendFromPurse conserves value and never goes negative (property)", () => {
  // Deterministic LCG so the test is reproducible without Math.random.
  let seed = 123456789;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 50000; i++) {
    const purse = { gp: rand(50), sp: rand(50), cp: rand(50) };
    const total = toCopper(purse);
    const cost = rand(total + 1); // always affordable
    const after = spendFromPurse(purse, cost);
    assert.ok(after.gp >= 0 && after.sp >= 0 && after.cp >= 0, `negative coin: ${JSON.stringify(after)}`);
    assert.equal(toCopper(after), total - cost, `value not conserved for ${JSON.stringify(purse)} - ${cost}`);
  }
});

test("parseCoinsFromText", () => {
  assert.deepEqual(parseCoinsFromText("50 gp"), { gp: 50, sp: 0, cp: 0 });
  assert.deepEqual(parseCoinsFromText("3 Silver and 2 copper"), { gp: 0, sp: 3, cp: 2 });
  assert.deepEqual(parseCoinsFromText("a rusty key"), { gp: 0, sp: 0, cp: 0 });
  assert.deepEqual(parseCoinsFromText(""), { gp: 0, sp: 0, cp: 0 });
  assert.deepEqual(parseCoinsFromText(null), { gp: 0, sp: 0, cp: 0 });
});
