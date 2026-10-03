// The Infirmary: a pestilence roll names it, so the patients make the CON check with advantage; other disasters don't.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.game = { i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d ?? {})}` } };
const core = await import("../scripts/bastion/bastion-core.mjs");
const { monthLine } = await import("../scripts/bastion/bastion-text.mjs");

const keep = (ids) => {
  let s = { ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 };
  for (const id of ids) s = core.build(s, id).state;
  return core.advanceWeek(s);
};
/** The state after a monthly roll that came up this kind (the d6 and d4 are chosen to land on it). */
const rolled = (state, kind) => {
  const roll = { warbands: { d6: 1, d4: 1 }, natural: { d6: 1, d4: 2 }, pestilence: { d6: 1, d4: 3 }, dragon: { d6: 1, d4: 4 } }[kind];
  return core.applyDisaster(state, core.rollDisaster((n) => (n === 6 ? roll.d6 : roll.d4)));
};

test("a finished Infirmary is an effect only while the bastion stands", () => {
  assert.equal(core.effects(keep(["infirmary"])).infirmary, true);
  assert.equal(core.effects(keep(["stable"])).infirmary, false);
  assert.equal(core.effects(core.build({ ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 }, "infirmary").state).infirmary, false, "still building");
});

test("a pestilence under an Infirmary says the patients have advantage; without one it is just the log line", () => {
  const withIt = monthLine(rolled(keep(["infirmary"]), "pestilence"));
  assert.match(withIt, /SDE\.bastion\.log\.pestilence/);
  assert.match(withIt, /SDE\.bastion\.infirmary\.pestilence/);
  const without = monthLine(rolled(keep(["stable"]), "pestilence"));
  assert.match(without, /SDE\.bastion\.log\.pestilence/);
  assert.doesNotMatch(without, /infirmary/);
});

test("other disasters never mention the Infirmary", () => {
  for (const kind of ["warbands", "natural", "dragon"]) {
    assert.doesNotMatch(monthLine(rolled(keep(["infirmary"]), kind)), /infirmary/, kind);
  }
});
