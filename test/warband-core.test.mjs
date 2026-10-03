// Warband rules (#200, #202): the commander's allowance, the upgrade list, and
// a creature made into a warband.
import test from "node:test";
import assert from "node:assert/strict";

import {
  UPGRADES, MOST_UPGRADES, allowanceFor, canMakeWarband, cleanUpgrades, commandRefusal, upgradeRefusal,
  tripleDice, warbandStats, warbandAttack, warbandHp, warbandRolledHp,
  upkeepGp, moraleDC, routChance, healPlan, monthKey, clockEvents, moraleTriggered, moraleFormula, decidePayment,
  STOCK_WARBANDS, addDie, upgradeActorChanges, upgradeAttackChanges, parseUpgradeLines, toughHp,
} from "../scripts/actors/warband-core.mjs";

test("eighteen upgrades, and a commander's allowance by hit die", () => {
  assert.equal(UPGRADES.length, 18);
  assert.equal(new Set(UPGRADES).size, 18);
  assert.deepEqual(allowanceFor("d4"), { warbands: 2, upgrades: 2 });
  assert.deepEqual(allowanceFor("d6"), { warbands: 4, upgrades: 3 });
  assert.deepEqual(allowanceFor("d8plus"), { warbands: 6, upgrades: 4 });
  assert.equal(allowanceFor(null), null);
  assert.equal(MOST_UPGRADES, 4);
});

test("a d6 commander: 4 warbands and 3 upgrades in all; a 5th warband or 4th upgrade is refused", () => {
  const d6 = allowanceFor("d6");
  assert.equal(commandRefusal(d6, { otherWarbands: 3, otherUpgrades: 1, upgrades: 2 }), null, "the 4th, at 3 upgrades");
  assert.equal(commandRefusal(d6, { otherWarbands: 4, otherUpgrades: 0, upgrades: 0 }), "warbands", "a 5th");
  assert.equal(commandRefusal(d6, { otherWarbands: 1, otherUpgrades: 3, upgrades: 1 }), "upgrades", "bringing a 4th upgrade");
  assert.equal(commandRefusal(null, { otherWarbands: 9, otherUpgrades: 9, upgrades: 9 }), null, "an unknown die checks nothing");
  assert.equal(upgradeRefusal("tough", ["loyal"], { allowance: d6, otherUpgrades: 1 }), null, "the 3rd");
  assert.equal(upgradeRefusal("tough", ["loyal", "fast"], { allowance: d6, otherUpgrades: 1 }), "upgrades", "a 4th");
});

test("an upgrade can't be ticked twice on one warband, and a list is cleaned to the book's order", () => {
  assert.equal(upgradeRefusal("tough", ["tough"], { allowance: allowanceFor("d8plus") }), "duplicate");
  assert.equal(upgradeRefusal("flying", [], { allowance: allowanceFor("d8plus") }), "unknown");
  assert.equal(upgradeRefusal("tough", ["a", "b", "c", "d"].map(() => "x"), { allowance: null }), "upgrades", "no commander: at most 4");
  assert.deepEqual(cleanUpgrades(["withdraw", "tough", "tough", "flying", "accurate"]), ["accurate", "tough", "withdraw"]);
});

test("only level 1-5 creatures can be made into a warband", () => {
  assert.deepEqual([0, 1, 5, 6, 2.5].map(canMakeWarband), [false, true, true, false, false]);
});

test("a level 2 goblin, +1 for 1d6, becomes a level 4 warband: HP 32 + CON, +3 for 3d6, one attack", () => {
  const stats = warbandStats({ level: 2, conMod: 1 });
  assert.deepEqual(stats, { level: 4, gained: 2, hp: 33 });
  assert.deepEqual(warbandAttack({ attackBonus: 1, damage: "1d6" }, stats.gained), { num: 1, attackBonus: 3, damage: "3d6" });
  assert.deepEqual(warbandAttack({ attackBonus: 0, damage: null }, 3), { num: 1, attackBonus: 3, damage: null }, "a special attack");
});

test("damage dice are tripled wherever they are; a flat number stays", () => {
  assert.equal(tripleDice("1d6"), "3d6");
  assert.equal(tripleDice("2d4+1"), "6d4+1");
  assert.equal(tripleDice("d8"), "3d8");
  assert.equal(tripleDice("1d6+1d4"), "3d6+3d4");
  assert.equal(tripleDice("1"), "1");
});

test("a warband's HP is fixed: 8 per level plus CON, at least 1", () => {
  assert.equal(warbandHp(4, 1), 33);
  assert.equal(warbandHp(2, -3), 13);
  assert.equal(warbandHp(0, -2), 1);
});

test("upkeep is 10 gp a level; morale is DC 15 (Loyal 9), rout 3-in-6 (Withdraw 1)", () => {
  assert.equal(upkeepGp(4), 40);
  assert.equal(upkeepGp(undefined), 0);
  assert.equal(moraleDC([]), 15);
  assert.equal(moraleDC(["loyal"]), 9);
  assert.equal(routChance(["tough"]), 3);
  assert.equal(routChance(["withdraw"]), 1);
});

test("a day heals 1d4 (Hardy 2d6); a long rest that must fill it needs no roll", () => {
  assert.deepEqual(healPlan(1, 10, []), { full: false, formula: "1d4" });
  assert.deepEqual(healPlan(3, 10, ["hardy"]), { full: false, formula: "6d6" });
  assert.deepEqual(healPlan(30, 12, []), { full: true, formula: null }, "30 days heal at least 30");
  assert.deepEqual(healPlan(2, 0, []), { full: false, formula: null }, "not hurt");
  assert.deepEqual(healPlan(0, 5, []), { full: false, formula: null });
});

test("a clock move's month and week starts come in order, each once, over its last year", () => {
  // 30-day months, 7-day weeks starting on day 0, one second a day for readability.
  const move = { secondsPerDay: 1, week: 7, offset: 0, monthOf: (at) => Math.floor(at / 30) };
  const { events } = clockEvents({ ...move, from: 20, to: 45 });
  assert.deepEqual(events, [{ at: 21, week: true }, { at: 28, week: true }, { at: 30, month: 1 }, { at: 35, week: true }, { at: 42, week: true }],
    "the arrears weeks after the month start follow it");
  assert.deepEqual(clockEvents({ ...move, from: 20, to: 45, lastMonth: 1, lastWeek: 35 }).events, [{ at: 42, week: true }],
    "a clock set back and moved on again handles nothing twice");
  const long = clockEvents({ ...move, from: 0, to: 1000, maxDays: 100 });
  assert.equal(long.skippedDays, 900);
  assert.equal(long.events.filter((e) => e.month !== undefined).length, 3, "days 901-1000 hold the month starts 930, 960 and 990");
  assert.deepEqual(clockEvents({ ...move, from: 5, to: 5 }).events, []);
  assert.equal(monthKey({ year: 1300, month: 2 }, 12), 15602, "a month's key: year x 12 + month");
});

test("morale: checked on falling to half and on every hit below it, never while standing firm or at 0", () => {
  assert.equal(moraleTriggered(20, 10, 20), true, "falls to half");
  assert.equal(moraleTriggered(10, 7, 20), true, "hit again below half");
  assert.equal(moraleTriggered(20, 11, 20), false, "still above half");
  assert.equal(moraleTriggered(10, 0, 20), false, "at 0 it is down, not wavering");
  assert.equal(moraleTriggered(8, 12, 20), false, "healing");
  assert.equal(moraleTriggered(17, 8, 17), true, "odd max: 8 is at most half of 17");
  assert.equal(moraleFormula(2, false), "1d20 + 2");
  assert.equal(moraleFormula(-1, true), "2d20kh + -1");
});

// ── #201 ─────────────────────────────────────────────────────────────────────

test("eight stock warbands, by the importer's names", () => {
  assert.equal(STOCK_WARBANDS.length, 8);
  assert.ok(STOCK_WARBANDS.includes("Melee, Light") && STOCK_WARBANDS.includes("Rabble"));
});

test("Weapons Upgrade adds one die of the same kind; taking it off removes one", () => {
  assert.equal(addDie("3d8", 1), "4d8");
  assert.equal(addDie("4d8", -1), "3d8");
  assert.equal(addDie("2d6+1", 1), "3d6+1");
  assert.equal(addDie("d6", 1), "2d6");
  assert.equal(addDie("1d6", -1), null, "never below one die");
  assert.equal(addDie("5", 1), null, "no die to add to");
});

test("Armor Upgrade and Tough change the actor; unticking Tough never hurts it", () => {
  assert.deepEqual(upgradeActorChanges("armorUpgrade", true, { ac: 13, hpMax: 25, hpValue: 25 }), { "system.attributes.ac.value": 14 });
  assert.deepEqual(upgradeActorChanges("armorUpgrade", false, { ac: 0, hpMax: 25, hpValue: 25 }), { "system.attributes.ac.value": 0 });
  assert.deepEqual(upgradeActorChanges("tough", true, { ac: 13, hpMax: 25, hpValue: 20 }),
    { "system.attributes.hp.max": 40, "system.attributes.hp.value": 35 });
  assert.deepEqual(upgradeActorChanges("tough", true, { ac: 13, hpMax: 25, hpValue: 0 }),
    { "system.attributes.hp.max": 40, "system.attributes.hp.value": 0 }, "a fallen warband isn't raised");
  assert.deepEqual(upgradeActorChanges("tough", false, { ac: 13, hpMax: 40, hpValue: 30 }),
    { "system.attributes.hp.max": 25, "system.attributes.hp.value": 15 }, "the damage taken stays");
  assert.deepEqual(upgradeActorChanges("tough", false, { ac: 13, hpMax: 40, hpValue: 12 }),
    { "system.attributes.hp.max": 25, "system.attributes.hp.value": 1 }, "a standing warband stays standing");
  assert.deepEqual(upgradeActorChanges("tough", false, { ac: 13, hpMax: 40, hpValue: 0 }),
    { "system.attributes.hp.max": 25, "system.attributes.hp.value": 0 });
  const on = upgradeActorChanges("tough", true, { ac: 13, hpMax: 25, hpValue: 10 });
  const off = upgradeActorChanges("tough", false, { ac: 13, hpMax: on["system.attributes.hp.max"], hpValue: on["system.attributes.hp.value"] });
  assert.deepEqual([off["system.attributes.hp.max"], off["system.attributes.hp.value"]], [25, 10], "ticked and unticked, no HP gained or lost");
  assert.deepEqual(upgradeActorChanges("loyal", true, { ac: 13, hpMax: 25, hpValue: 25 }), {});
  assert.equal(toughHp(["tough"]), 15);
  assert.equal(toughHp(["loyal"]), 0);
});

test("Training and Weapons Upgrade change each attack; others don't touch attacks", () => {
  assert.deepEqual(upgradeAttackChanges("training", true, { attackBonus: 3, damage: "3d6" }), { "system.bonuses.attackBonus": 4 });
  assert.deepEqual(upgradeAttackChanges("training", false, { attackBonus: 0, damage: "3d4" }), { "system.bonuses.attackBonus": 0 });
  assert.deepEqual(upgradeAttackChanges("weaponsUpgrade", true, { attackBonus: 3, damage: "3d6" }), { "system.damage.value": "4d6" });
  assert.deepEqual(upgradeAttackChanges("weaponsUpgrade", true, { attackBonus: 3, damage: undefined }), {}, "a special attack has no die");
  assert.equal(upgradeAttackChanges("tough", true, { attackBonus: 3, damage: "3d6" }), null);
});

test("upgrade text: one line each after the heading, known names only, stopping at the stat blocks", () => {
  const page = [
    "WARBAND UPGRADES",
    "Accurate. Placeholder text one.",
    "Armor Upgrade. Placeholder text two.",
    "Weapons Upgrade. Placeholder text three.",
    "MELEE, LIGHT MELEE, HEAVY",
    "Stealthy. A talent, not an upgrade.",
  ].join("\n");
  assert.deepEqual(parseUpgradeLines(page), {
    accurate: "Placeholder text one.", armorUpgrade: "Placeholder text two.", weaponsUpgrade: "Placeholder text three.",
  });
  assert.deepEqual(parseUpgradeLines("Stealthy. No heading here."), {});
});

test("the system's HP roll keeps a warband's current HP: placing a linked token never heals it (#283 review)", () => {
  assert.deepEqual(warbandRolledHp({ level: 4, conMod: 1, value: 7, max: 33 }), { max: 33, value: 7 });
  assert.deepEqual(warbandRolledHp({ level: 3, conMod: 1, value: 33, max: 33 }), { max: 25, value: 25 }, "clamped to a lower max");
  assert.deepEqual(warbandRolledHp({ level: 4, conMod: 1, value: 0, max: 0 }), { max: 33, value: 33 }, "one never given HP starts full");
  assert.deepEqual(warbandRolledHp({ level: 4, conMod: 1, value: 0, max: 33 }), { max: 33, value: 0 }, "a fallen warband stays down");
  assert.deepEqual(warbandRolledHp({ level: 4, conMod: 1, value: 20, max: 48, extra: 15 }), { max: 48, value: 20 }, "Tough's 15 stays in the max");
});

test("a payment marked before its gold was taken: landed, not landed, or unclear, from the purse now (#284 review)", () => {
  const intent = { before: 10000, cost: 3000 };
  const table = [[7000, "landed"], [10000, "not-landed"], [9500, "unclear"], [0, "unclear"], [13000, "unclear"], [null, "unclear"], [6999, "unclear"], [7001, "unclear"], [10001, "unclear"]];
  for (const [purse, want] of table) assert.equal(decidePayment(intent, purse), want, `purse ${purse}`);
});

test("a warband's upkeep can be less by a saving, never below nothing", () => {
  assert.equal(upkeepGp(3), 30);
  assert.equal(upkeepGp(3, 10), 20);
  assert.equal(upkeepGp(1, 10), 0);
  assert.equal(upkeepGp(1, 25), 0);
  assert.equal(upkeepGp(0, 10), 0);
});

test("healing with a die a day more: the dice add, and a full heal counts the least they roll", () => {
  const extra = { n: 1, faces: 6 };
  assert.deepEqual(healPlan(1, 50, [], extra), { full: false, formula: "1d4 + 1d6" });
  assert.deepEqual(healPlan(3, 50, ["hardy"], extra), { full: false, formula: "6d6 + 3d6" });
  assert.deepEqual(healPlan(2, 4, [], extra), { full: true, formula: null });     // 2 + 2 >= 4
  assert.deepEqual(healPlan(2, 5, [], extra), { full: false, formula: "2d4 + 2d6" });
  assert.deepEqual(healPlan(2, 5, []), { full: false, formula: "2d4" });          // without it, as before
  assert.deepEqual(healPlan(1, 0, [], extra), { full: false, formula: null });
});
