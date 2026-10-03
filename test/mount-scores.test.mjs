import test from "node:test";
import assert from "node:assert/strict";
import { mountScores, effectiveMountScores, mountModifier, damageMountScores } from "../scripts/actors/mount-scores-core.mjs";
const abilities = Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((k, n) => [k, { mod: [3, 0, 3, -2, 1, -3][n] }]));
test("camel defaults round-trip all six modifiers; NPC extremes are not PC-capped", () => {
  const state = mountScores(abilities);
  assert.deepEqual(state.base, { str: 16, dex: 10, con: 16, int: 6, wis: 12, cha: 4 });
  for (const [key, value] of Object.entries(abilities)) assert.equal(mountModifier(state.base[key]), value.mod);
  for (const mod of [-6, -5, 5, 8]) assert.equal(mountModifier(mountScores({ str: { mod } }).base.str), mod);
});
test("adoption fills missing scores once without overwriting edits or damage on reload", () => {
  const saved = { base: { con: 17, cha: 5 }, damage: { con: 2 } };
  const state = mountScores(abilities, saved);
  assert.equal(state.base.con, 17); assert.equal(state.base.cha, 5);
  assert.deepEqual(mountScores({ con: { mod: 99 } }, JSON.parse(JSON.stringify(state))), state);
  assert.equal(effectiveMountScores(state).con, 15);
});
test("CON damage reduces full scores, never stored modifiers; death boundary is full score zero", () => {
  const state = mountScores(abilities), one = damageMountScores(state, "con", 1);
  assert.equal(one.base.con, 16); assert.equal(one.damage.con, 1);
  assert.equal(effectiveMountScores(one).con, 15); assert.equal(mountModifier(effectiveMountScores(one).con), 2);
  assert.deepEqual(effectiveMountScores(one), effectiveMountScores(JSON.parse(JSON.stringify(one))));
  const zeroMod = damageMountScores(state, "con", 6);
  assert.equal(effectiveMountScores(zeroMod).con, 10); assert.equal(mountModifier(effectiveMountScores(zeroMod).con), 0);
  assert.equal(effectiveMountScores(damageMountScores(state, "con", 16)).con, 0);
  assert.equal(state.damage.con, 0);
});
