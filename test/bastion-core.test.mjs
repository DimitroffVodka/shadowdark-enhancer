// Bastion rules: costs, caps, a place on the plan for each upgrade that stays put, weeks to build, repairs
// and the monthly disaster, all on plain state so the whole result is checked.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BASTION_TYPES, BASTION_UPGRADES, newBastion, stats, worth, canBuild, build, takeDown, changeType,
  damage, startRepair, advanceWeek, rollDisaster, applyDisaster, builtUpgrades, stateOf, updateOf, effects, GRANARY_SAVING_GP, BARRACKS_HEAL,
} from "../scripts/bastion/bastion-core.mjs";

const standing = (type = "keep", treasury = 5000) => ({ ...newBastion(type), weeksLeft: 0, treasury });
const buildAll = (state, ids) => ids.reduce((s, id) => build(s, id).state, state);

test("the four types and twenty upgrades carry the printed numbers", () => {
  assert.deepEqual(BASTION_TYPES.map((t) => [t.id, t.cost, t.ac, t.hp, t.slots, t.weeks]), [
    ["house", 200, 12, 40, 3, 1], ["outpost", 300, 15, 50, 5, 2], ["keep", 1000, 18, 100, 10, 4], ["castle", 5000, 18, 300, 20, 8],
  ]);
  assert.equal(BASTION_UPGRADES.length, 20);
  assert.equal(new Set(BASTION_UPGRADES.map((u) => u.id)).size, 20);
  const cost = Object.fromEntries(BASTION_UPGRADES.map((u) => [u.id, u.cost]));
  assert.equal(cost.aviary, 100); assert.equal(cost.casino, 300); assert.equal(cost.idol, 400);
  assert.equal(cost.vault, 200); assert.equal(cost["wizard-tower"], 400);
});

test("a new bastion is unbuilt, at full HP, with an empty treasury", () => {
  const s = newBastion("outpost");
  assert.equal(s.weeksLeft, 2);
  assert.equal(s.hp.value, 50);
  assert.equal(s.treasury, 0);
  assert.equal(stats(s).standing, false);
  assert.equal(newBastion("nonsense").type, "house");
});

test("nothing is built until the bastion stands", () => {
  assert.equal(canBuild({ ...newBastion("house"), treasury: 1000 }, "stable").reason, "unstanding");
  assert.equal(canBuild(standing("house"), "stable").ok, true);
});

test("an upgrade costs its price from the treasury and a week, and takes the lowest free place", () => {
  const { state, error } = build(standing("keep", 500), "library");
  assert.equal(error, null);
  assert.equal(state.treasury, 100);
  assert.deepEqual(state.upgrades, [{ id: "library", slot: 0, weeksLeft: 1 }]);
  assert.equal(state.log.at(-1).key, "SDE.bastion.log.buildStarted");
});

test("one of each, a cap by type, and gold enough", () => {
  const s = buildAll(standing("house"), ["stable", "vault", "aviary"]);
  assert.equal(s.upgrades.length, 3);
  assert.equal(canBuild(s, "library").reason, "full");
  assert.equal(canBuild(standing("keep"), "nonsense").reason, "unknown");
  const twice = build(standing("keep"), "stable").state;
  assert.equal(canBuild(twice, "stable").reason, "built");
  assert.equal(canBuild(standing("keep", 50), "library").reason, "broke");
  assert.equal(build(standing("keep", 50), "library").state.treasury, 50);
});

test("taking one down frees its place for the next and moves nobody else", () => {
  let s = buildAll(standing("keep"), ["stable", "vault", "aviary"]);   // slots 0 1 2
  s = takeDown(s, "vault").state;
  assert.deepEqual(s.upgrades.map((u) => [u.id, u.slot]), [["stable", 0], ["aviary", 2]]);
  s = build(s, "temple").state;
  assert.deepEqual(s.upgrades.find((u) => u.id === "temple").slot, 1);
  assert.equal(s.treasury, 5000 - 100 - 200 - 100 - 400);   // taking one down refunds nothing
});

test("the moat holds an upgrade slot but no place on the plan", () => {
  const s = buildAll(standing("house"), ["moat", "stable"]);
  assert.deepEqual(s.upgrades.map((u) => [u.id, u.slot]), [["moat", -1], ["stable", 0]]);
  assert.equal(stats(s).used, 2);
});

test("a type change keeps the upgrades when they fit and refuses when they don't", () => {
  const s = buildAll(standing("keep"), ["stable", "vault", "aviary", "temple"]);
  assert.equal(changeType(s, "house").error, "tooMany");
  const up = changeType(s, "castle");
  assert.equal(up.error, null);
  assert.equal(up.state.upgrades.length, 4);
  assert.equal(up.state.hp.value, 300);
  assert.equal(up.state.weeksLeft, 0);   // standing stays standing
  const raising = changeType({ ...newBastion("house"), weeksLeft: 1 }, "castle").state;
  assert.equal(raising.weeksLeft, 8);    // still going up: the new type's weeks
  assert.equal(changeType(s, "nonsense").error, "unknown");
});

test("weeks pass: the bastion rises, then each upgrade finishes", () => {
  let s = { ...newBastion("outpost"), treasury: 1000 };
  s = advanceWeek(s);
  assert.equal(s.weeksLeft, 1);
  s = advanceWeek(s);
  assert.equal(s.weeksLeft, 0);
  assert.equal(s.log.at(-1).key, "SDE.bastion.log.raised");
  s = build(s, "stable").state;
  assert.deepEqual(builtUpgrades(s), []);
  s = advanceWeek(s);
  assert.deepEqual(builtUpgrades(s), ["stable"]);
  assert.equal(s.week, 3);
  assert.equal(s.log.at(-1).key, "SDE.bastion.log.buildDone");
});

test("damage stops at 0 HP, where the walls are breached", () => {
  let s = damage(standing("house"), 25);
  assert.equal(stats(s).hp, 15);
  s = damage(s, 90);
  assert.equal(stats(s).hp, 0);
  assert.equal(stats(s).breached, true);
  assert.equal(s.log.at(-1).key, "SDE.bastion.log.breached");
});

test("a repair is a week and 1 gp per HP missing, paid once", () => {
  let s = damage(standing("house", 100), 30);
  assert.equal(stats(s).repairCost, 30);
  const r = startRepair(s);
  assert.equal(r.state.treasury, 70);
  assert.equal(stats(r.state).repairCost, 0);
  assert.equal(startRepair(r.state).error, "nothing");
  assert.equal(stats(r.state).hp, 10);   // not mended yet
  s = advanceWeek(r.state);
  assert.equal(stats(s).hp, 40);
  assert.equal(s.log.at(-1).key, "SDE.bastion.log.repaired");
  assert.equal(startRepair(damage(standing("house", 10), 30)).error, "broke");
});

test("the monthly disaster: only a 1 on the d6 rolls the d4", () => {
  const seq = (...rolls) => { const q = [...rolls]; return () => q.shift(); };
  assert.deepEqual(rollDisaster(seq(4)), { d6: 4, d4: null, kind: null });
  assert.deepEqual(rollDisaster(seq(1, 1, 5, 7)), { d6: 1, d4: 1, kind: "warbands", count: 12 });
  assert.deepEqual(rollDisaster(seq(1, 2, 63)), { d6: 1, d4: 2, kind: "natural", damage: 63 });
  assert.equal(rollDisaster(seq(1, 3)).kind, "pestilence");
  assert.equal(rollDisaster(seq(1, 4)).kind, "dragon");
});

test("a natural disaster damages the bastion; the others are logged for the GM", () => {
  const s = standing("house");
  assert.equal(stats(applyDisaster(s, { d6: 1, d4: 2, kind: "natural", damage: 63 })).hp, 0);
  assert.equal(applyDisaster(s, { d6: 1, d4: 2, kind: "natural", damage: 12 }).log.at(-1).key, "SDE.bastion.log.naturalDisaster");
  assert.equal(applyDisaster(s, { d6: 1, d4: 1, kind: "warbands", count: 9 }).log.at(-1).data.count, 9);
  assert.equal(applyDisaster(s, { d6: 5, d4: null, kind: null }).log.at(-1).key, "SDE.bastion.log.quietMonth");
  assert.equal(stats(applyDisaster(s, { d6: 1, d4: 3, kind: "pestilence" })).hp, 40);
});

test("worth is the type plus every upgrade", () => {
  assert.equal(worth(buildAll(standing("keep"), ["library", "stable"])), 1000 + 400 + 100);
});

test("the log keeps its last sixty lines", () => {
  let s = standing("castle");
  for (let i = 0; i < 80; i += 1) s = advanceWeek(damage(s, 1));
  assert.equal(s.log.length, 60);
});

test("a state goes to the actor's fields and back unchanged", () => {
  const hurt = damage(buildAll(standing("keep", 2000), ["moat", "library"]), 12);
  const update = updateOf(hurt);
  assert.equal(update["system.hp.value"], 88);
  assert.deepEqual(update["system.upgrades"].map((u) => u.id), ["moat", "library"]);
  const stored = { type: hurt.type, weeksLeft: hurt.weeksLeft, week: hurt.week, hp: hurt.hp, treasury: hurt.treasury, upgrades: update["system.upgrades"], repair: hurt.repair, log: update["system.log"] };
  assert.deepEqual(stateOf({ system: { toObject: () => stored } }), hurt);
  assert.deepEqual(stateOf({ system: stored }), hurt);   // a plain system object reads the same
  assert.equal(stateOf(null).type, "house");
});

test("a bastion's effects are its finished Granary and Barracks, and only while it stands", () => {
  assert.equal(GRANARY_SAVING_GP, 10);
  assert.deepEqual(BARRACKS_HEAL, { n: 1, faces: 6 });
  const built = advanceWeek(buildAll(standing("keep"), ["granary", "barracks", "stable"]));
  assert.deepEqual(effects(built), { granary: true, barracks: true, casino: false, library: false, trophyRoom: false, vault: false, stable: true, aviary: false, infirmary: false });
  const going = buildAll(standing("keep"), ["granary", "barracks"]);          // a week of building still to go
  assert.deepEqual(effects(going), { granary: false, barracks: false, casino: false, library: false, trophyRoom: false, vault: false, stable: false, aviary: false, infirmary: false });
  assert.deepEqual(effects(advanceWeek(buildAll(standing("keep"), ["stable"]))), { granary: false, barracks: false, casino: false, library: false, trophyRoom: false, vault: false, stable: true, aviary: false, infirmary: false });
  assert.deepEqual(effects({ ...built, weeksLeft: 2 }), { granary: false, barracks: false, casino: false, library: false, trophyRoom: false, vault: false, stable: false, aviary: false, infirmary: false });   // not raised
});
