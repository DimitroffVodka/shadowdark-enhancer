// The travel panel (#234, Overland O8): what each viewer is shown, and when
// the clock HUD redraws.
import test from "node:test";
import assert from "node:assert/strict";
import { barModel, itemTouchesBar, redrawStamp, hhmm } from "../scripts/overland/overland-bar-core.mjs";

test("sunrise and sunset labels read in the calendar's own hours and minutes", () => {
  assert.equal(hhmm(19.75, { minutesPerHour: 60, hoursPerDay: 24 }), "19:45");
  assert.equal(hhmm(19.75, { minutesPerHour: 100, hoursPerDay: 24 }), "19:75");
  assert.equal(hhmm(25.5, { minutesPerHour: 60, hoursPerDay: 26 }), "25:30", "a 26-hour day does not wrap at 24");
  assert.equal(hhmm(6.5, undefined), "06:30", "no calendar: Foundry's own 60 and 24");
});

const STATE = {
  day: 100, budget: 4, spent: 1, hexesLeft: 3, method: "walking", pushed: false, mounts: 2,
  weather: { kind: "stormy" }, stormy: true, harsh: true, climate: { label: "Scorching" },
  members: ["mine", "theirs", "gone"], foraged: ["theirs"], pending: { until: 5, reason: "move" },
  checks: [{ half: "day", at: 10, rolled: true, hit: false }, { half: "night", at: 20, rolled: false, hit: null }],
};
const ACTORS = { mine: { name: "Mine", rations: 2 }, theirs: { name: "Theirs", rations: 0 } };

test("a GM sees the checks, Continue, and every member's forage state", () => {
  const m = barModel({ state: STATE, isGM: true, owns: () => true, actors: ACTORS });
  assert.equal(m.checks.length, 2);
  assert.equal(m.pending, true);
  assert.deepEqual(m.members.map((p) => [p.name, p.rations, p.foraged, p.canForage]),
    [["Mine", 2, false, true], ["Theirs", 0, true, false]], "a member with no actor is left out");
  assert.equal(m.leftShare, 0.75, "the bar fills to the hexes left");
  assert.equal(m.climate, "Scorching");
});

test("a player sees no check hours, no Continue, and Forage only on a character they own", () => {
  const m = barModel({ state: STATE, isGM: false, owns: (id) => id === "mine", actors: ACTORS });
  assert.deepEqual(m.checks, []);
  assert.equal(m.pending, false);
  const woken = { ...STATE, camp: { party: null, interrupted: 79200, ate: true } };
  assert.equal(barModel({ state: woken, isGM: false, owns: () => true, actors: ACTORS }).interrupted, null, "nor when a creature woke the camp");
  assert.equal(barModel({ state: woken, isGM: true, owns: () => true, actors: ACTORS }).interrupted, 79200);
  assert.deepEqual(m.members.map((p) => p.canForage), [true, false]);
  assert.equal(m.canPace, true, "a player with a travelling character sets the pace");
  assert.equal(barModel({ state: STATE, isGM: false, owns: () => false, actors: ACTORS }).canPace, false);
  const pushed = barModel({ state: { ...STATE, pushed: true }, isGM: false, owns: () => true, actors: ACTORS });
  assert.deepEqual(pushed.members.map((p) => p.canForage), [false, false], "not on a pushed day");
  const noDay = barModel({ state: { ...STATE, day: null }, isGM: false, owns: () => true, actors: ACTORS });
  assert.equal(noDay.dayOpen, false);
  assert.deepEqual(noDay.members.map((p) => p.canForage), [false, false], "not before the day starts");
});

test("the clock redraws the bar once a minute, and after a jump of whole days too (#249 review)", () => {
  const t = 1000 * 60 + 5;
  assert.equal(redrawStamp(t, 60, "fair"), redrawStamp(t + 30, 60, "fair"), "the same minute: no redraw");
  assert.notEqual(redrawStamp(t, 60, "fair"), redrawStamp(t + 60, 60, "fair"), "the next minute");
  assert.notEqual(redrawStamp(t, 60, "fair"), redrawStamp(t + 86400, 60, "fair"), "24 hours later, same HH:MM");
  assert.notEqual(redrawStamp(t, 60, "fair"), redrawStamp(t, 60, null), "the weather ended");
  assert.notEqual(redrawStamp(t, 60, "fair", null), redrawStamp(t, 60, "fair", { until: 5 }), "an encounter holds the clock");
});

test("an item change redraws the bar when it's on a travelling member (#249 review)", () => {
  const on = (id) => ({ parent: { documentName: "Actor", id } });
  assert.equal(itemTouchesBar(on("mine"), ["mine", "theirs"]), true);
  assert.equal(itemTouchesBar(on("stranger"), ["mine"]), false);
  assert.equal(itemTouchesBar({ parent: null }, ["mine"]), false, "a world item");
});
