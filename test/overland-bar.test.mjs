// The travel bar (#234, Overland O8): where the sun and moon stand on the
// dome, the moon's shadow, and what each viewer is shown.
import test from "node:test";
import assert from "node:assert/strict";
import { DOME, barModel, domePoint, moonShadow, skyPosition } from "../scripts/overland/overland-bar-core.mjs";

test("the sun rises at 0 and sets at 1; at night the moon runs from sunset to the next sunrise", () => {
  const sky = { sunrise: 6, sunset: 18 };
  assert.deepEqual(skyPosition({ hour: 6, ...sky }), { isDay: true, progress: 0 });
  assert.deepEqual(skyPosition({ hour: 12, ...sky }), { isDay: true, progress: 0.5 });
  assert.deepEqual(skyPosition({ hour: 18, ...sky }), { isDay: false, progress: 0 });
  assert.deepEqual(skyPosition({ hour: 0, ...sky }), { isDay: false, progress: 0.5 }, "midnight, halfway through the night");
  assert.equal(skyPosition({ hour: 5.99, ...sky }).isDay, false);
});

test("the dome's arc: left horizon, overhead, right horizon", () => {
  assert.deepEqual(domePoint(0), { x: DOME.cx - DOME.r, y: DOME.cy });
  assert.deepEqual(domePoint(0.5), { x: DOME.cx, y: DOME.cy - DOME.r });
  assert.deepEqual(domePoint(1), { x: DOME.cx + DOME.r, y: DOME.cy });
  assert.deepEqual(domePoint(2), domePoint(1), "clamped");
});

test("the moon's shadow covers it at new and clears it at full; waxing lights the right side", () => {
  assert.equal(moonShadow({ fraction: 0, illumination: 0 }), -0);
  assert.equal(moonShadow({ fraction: 0.5, illumination: 1 }), 2, "full: off the disc");
  assert.equal(moonShadow({ fraction: 0.25, illumination: 0.5 }), -1, "first quarter: shadow on the left");
  assert.equal(moonShadow({ fraction: 0.75, illumination: 0.5 }), 1, "last quarter: shadow on the right");
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
  assert.equal(m.spentShare, 0.25);
  assert.equal(m.climate, "Scorching");
});

test("a player sees no check hours, no Continue, and Forage only on a character they own", () => {
  const m = barModel({ state: STATE, isGM: false, owns: (id) => id === "mine", actors: ACTORS });
  assert.deepEqual(m.checks, []);
  assert.equal(m.pending, false);
  assert.deepEqual(m.members.map((p) => p.canForage), [true, false]);
  const pushed = barModel({ state: { ...STATE, pushed: true }, isGM: false, owns: () => true, actors: ACTORS });
  assert.deepEqual(pushed.members.map((p) => p.canForage), [false, false], "not on a pushed day");
  const noDay = barModel({ state: { ...STATE, day: null }, isGM: false, owns: () => true, actors: ACTORS });
  assert.equal(noDay.dayOpen, false);
  assert.deepEqual(noDay.members.map((p) => p.canForage), [false, false], "not before the day starts");
});
