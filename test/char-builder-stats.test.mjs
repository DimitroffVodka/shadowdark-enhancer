import test from "node:test";
import assert from "node:assert/strict";
import * as constants from "../scripts/char-builder/constants.mjs";
import { CharBuilderState } from "../scripts/char-builder/state.mjs";
import { StatsStep } from "../scripts/char-builder/steps/stats-step.mjs";
import { GoldStep } from "../scripts/char-builder/steps/gold-step.mjs";
import { HpStep } from "../scripts/char-builder/steps/hp-step.mjs";

const {
  ABILITY_ORDER,
  STAT_METHODS,
  pointBuyCost,
  pointBuySpent,
} = constants;

const previousGame = globalThis.game;
globalThis.game = { i18n: { localize: (key) => key } };
test.after(() => {
  if (previousGame === undefined) delete globalThis.game;
  else globalThis.game = previousGame;
});

function stepFor(statMethod) {
  const builderState = new CharBuilderState({ statMethod });
  return new StatsStep({ builderState, render: async () => {} });
}

test("the four existing stat methods retain their declarations", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(STAT_METHODS).filter(([key]) => [
      "3d6-down", "3d6-reroll", "3d6-assign", "4d6h3-down", "4d6h3-assign",
    ].includes(key))),
    {
      "3d6-down": {
        label: "SDE.charBuilder.stats.method.3d6Down",
        formula: "3d6", assign: false, rerollUnder14: false,
      },
      "3d6-reroll": {
        label: "SDE.charBuilder.stats.method.3d6Reroll",
        formula: "3d6", assign: false, rerollUnder14: true,
      },
      "3d6-assign": {
        label: "SDE.charBuilder.stats.method.3d6Assign",
        formula: "3d6", assign: true, rerollUnder14: false,
      },
      "4d6h3-down": {
        label: "SDE.charBuilder.stats.method.4d6Down",
        formula: "4d6kh3", assign: false, rerollUnder14: false,
      },
      "4d6h3-assign": {
        label: "SDE.charBuilder.stats.method.4d6Assign",
        formula: "4d6kh3", assign: true, rerollUnder14: false,
      },
    },
  );
});

test("an existing stored method key still resolves to the same method", () => {
  const step = stepFor("3d6-reroll");
  assert.equal(step.method, STAT_METHODS["3d6-reroll"]);
  assert.equal(step.method.formula, "3d6");
  assert.equal(step.method.assign, false);
  assert.equal(step.method.rerollUnder14, true);
});

test("existing methods keep their roll-to-state behavior", async () => {
  const savedRoll = globalThis.Roll;
  try {
    for (const [methodKey, expected] of [
      ["3d6-down", { assign: false, formula: "3d6" }],
      ["3d6-reroll", { assign: false, formula: "3d6" }],
      ["3d6-assign", { assign: true, formula: "3d6" }],
      ["4d6h3-down", { assign: false, formula: "4d6kh3" }],
      ["4d6h3-assign", { assign: true, formula: "4d6kh3" }],
    ]) {
      const results = [3, 4, 5, 6, 7, 8];
      const formulas = [];
      globalThis.Roll = class {
        constructor(formula) { formulas.push(formula); }
        async evaluate() { return { total: results.shift(), dice: [] }; }
      };
      const step = stepFor(methodKey);
      step._postRollCard = async () => {};
      await step._roll();
      assert.deepEqual(formulas, Array(6).fill(expected.formula), methodKey);
      assert.deepEqual(step.state.stats.pool, [3, 4, 5, 6, 7, 8], methodKey);
      assert.equal(step.isAssign, expected.assign, methodKey);
      assert.deepEqual(
        step.state.stats.values,
        expected.assign
          ? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
          : { str: 3, dex: 4, con: 5, int: 6, wis: 7, cha: 8 },
        methodKey,
      );
    }
  } finally {
    if (savedRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = savedRoll;
  }
});

test("standard array exposes exactly one assignable 15, 14, 13, 12, 10, 8 pool", async () => {
  const method = STAT_METHODS["standard-array"];
  assert.ok(method, "standard-array method is registered");
  assert.deepEqual(method.fixed, [15, 14, 13, 12, 10, 8]);
  assert.equal(method.assign, true);

  const step = stepFor("standard-array");
  const context = await step.prepareContext();
  assert.equal(context.isAssign, true);
  assert.equal(context.rolled, true);
  assert.deepEqual(context.poolChips.map(({ value }) => value), [15, 14, 13, 12, 10, 8]);
  assert.equal(context.poolChips.filter(({ used }) => used).length, 0);

  for (const [index, ability] of ABILITY_ORDER.entries()) step._assign(ability, index);
  assert.deepEqual(step.state.stats.values, {
    str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8,
  });
  assert.deepEqual(new Set(Object.values(step.state.stats.assignment)), new Set([0, 1, 2, 3, 4, 5]));
  step._resetRoll();
  assert.deepEqual(step.state.stats.pool, [15, 14, 13, 12, 10, 8]);
  assert.deepEqual(step.state.stats.values, {
    str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
  });
});

test("point-buy costs are cumulative and its budget boundaries are exact", () => {
  const costs = new Map([
    [8, 0], [9, 1], [10, 2], [11, 3],
    [12, 4], [13, 5], [14, 7], [15, 9],
  ]);
  for (const [score, cost] of costs) assert.equal(pointBuyCost(score), cost, `score ${score}`);

  assert.equal(pointBuySpent({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }), 0);
  assert.equal(pointBuySpent({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }), 27);
  assert.equal(pointBuySpent({ str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 }), 28);
});

test("point-buy starts at six 8s and spends at most 27 points", async () => {
  const step = stepFor("point-buy");
  assert.deepEqual(step.state.stats.values, {
    str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8,
  });
  const initial = await step.prepareContext();
  assert.equal(initial.remaining, 27);
  assert.equal(initial.complete, true);

  for (const ability of ["str", "dex", "con"]) {
    for (let score = 8; score < 15; score++) assert.equal(step._adjustPointBuy(ability, 1), true);
  }
  assert.equal(pointBuySpent(step.state.stats.values), 27);
  assert.equal(step._adjustPointBuy("int", 1), false, "a 28th point is refused");
  assert.equal(step.state.stats.values.int, 8);
});

test("point-buy enforces the 8–15 score bounds", () => {
  const step = stepFor("point-buy");
  assert.equal(step._adjustPointBuy("str", -1), false);
  assert.equal(step.state.stats.values.str, 8);
  for (let score = 8; score < 15; score++) assert.equal(step._adjustPointBuy("str", 1), true);
  assert.equal(step.state.stats.values.str, 15);
  assert.equal(step._adjustPointBuy("str", 1), false);
  assert.equal(step.state.stats.values.str, 15);
});

test("point-buy buttons route through the stats step", async () => {
  const step = stepFor("point-buy");
  const target = { dataset: { ability: "wis" } };
  assert.equal(await step.handleAction("cb-point-buy-increase", null, target), true);
  assert.equal(step.state.stats.values.wis, 9);
  assert.equal(await step.handleAction("cb-point-buy-decrease", null, target), true);
  assert.equal(step.state.stats.values.wis, 8);
  assert.equal(await step.handleAction("cb-point-buy-increase", null, { dataset: { ability: "nope" } }), false);
});

test("the GM lock removes every way for a player to roll abilities again", async () => {
  globalThis.game.user = { isGM: false };
  globalThis.game.settings = { get: (_ns, key) => key === "charBuilderLockStatRolls" };
  try {
    const step = stepFor("3d6-down");
    step.state.stats.pool = [10, 11, 12, 13, 9, 8];
    assert.equal(step.rollLocked, true);
    const ctx = await step.prepareContext();
    assert.equal(ctx.rollLocked, true);
    assert.equal(ctx.showReset, false);
    assert.equal(step.supportsRandom(), false);
    // Rolling needs the Roll global, which is absent here: the guards must
    // return before any of these paths reach it.
    assert.equal(await step.handleAction("cb-roll-stats"), false);
    assert.equal(await step.handleAction("cb-reset-stats"), false);
    await step.randomize();
    assert.deepEqual(step.state.stats.pool, [10, 11, 12, 13, 9, 8]);

    // The 3d6 method's own under-14 reroll is a rule, not a reroll — it stays.
    const under14 = stepFor("3d6-reroll");
    under14.state.stats.pool = [10, 11, 12, 13, 9, 8];
    const ctx14 = await under14.prepareContext();
    assert.equal(ctx14.rollLocked, true);
    assert.equal(ctx14.canReroll, true);

    globalThis.game.user.isGM = true;
    assert.equal(step.rollLocked, false, "GMs are never locked");
    globalThis.game.user.isGM = false;
    step.state.stats.pool = [];
    assert.equal(step.rollLocked, false, "nothing to lock before the first roll");
  } finally {
    delete globalThis.game.user;
    delete globalThis.game.settings;
  }
});

test("the GM lock removes every way for a player to roll gold again", async () => {
  globalThis.game.user = { isGM: false };
  globalThis.game.settings = { get: (_ns, key) => (key === "charBuilderLockGoldRolls" ? true : 0) };
  try {
    const builderState = new CharBuilderState({ statMethod: "3d6-down" });
    const step = new GoldStep({ builderState, render: async () => {} });
    assert.equal(step.rollLocked, false, "nothing to lock before the first roll");
    step.state.coins.gp = 35;
    step.state.goldRolled = true;
    assert.equal(step.rollLocked, true);
    const ctx = await step.prepareContext();
    assert.equal(ctx.rollLocked, true);
    assert.equal(ctx.canEdit, false, "the manual box is GM-only");
    assert.equal(step.supportsRandom(), false);
    // Rolling needs the Roll global, which is absent here: the guards must
    // return before either path reaches it.
    assert.equal(await step.handleAction("cb-roll-gold"), false);
    await step.randomize();
    assert.equal(step.state.coins.gp, 35);
    globalThis.game.user.isGM = true;
    assert.equal(step.rollLocked, false, "GMs are never locked");
    assert.equal((await step.prepareContext()).canEdit, true);
  } finally {
    delete globalThis.game.user;
    delete globalThis.game.settings;
  }
});

test("the GM lock removes every way for a player to roll HP again", async () => {
  globalThis.game.user = { isGM: false };
  globalThis.game.settings = { get: (_ns, key) => key === "charBuilderLockHpRolls" };
  try {
    const builderState = new CharBuilderState({ statMethod: "3d6-down" });
    builderState.class = { uuid: "x", name: "Fighter", item: { system: { hitPoints: "d8" } } };
    const step = new HpStep({ builderState, render: async () => {} });
    assert.equal(step.rollLocked, false, "nothing to lock before the first roll");
    assert.equal(step.supportsRandom(), true);
    step.state.hp = { max: 7, rolled: 7 };
    assert.equal(step.rollLocked, true);
    const ctx = await step.prepareContext();
    assert.equal(ctx.rollLocked, true);
    assert.equal(step.supportsRandom(), false);
    // Rolling needs the Roll global, which is absent here: the guards must
    // return before any of these paths reaches it.
    assert.equal(await step.handleAction("cb-roll-hp"), false);
    assert.equal(await step.handleAction("cb-max-hp"), false);
    await step.randomize();
    assert.equal(step.state.hp.max, 7);
    globalThis.game.user.isGM = true;
    assert.equal(step.rollLocked, false, "GMs are never locked");
  } finally {
    delete globalThis.game.user;
    delete globalThis.game.settings;
  }
});
