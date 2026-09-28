// The Trouble tracker's rules (#193). Table rows here are invented in the
// book's shape.
import test from "node:test";
import assert from "node:assert/strict";

import {
  checkChance, weeklyCheck, weekStarts, settlementKind, inlineDetail,
  urgencyRow, schedule, stageAt, nextChange,
} from "../scripts/troubles/trouble-core.mjs";

test("the chance grows one in six per quiet week, and a stir starts it again", () => {
  assert.deepEqual([0, 1, 2, 5, 9].map(checkChance), [1, 2, 3, 6, 6]);
  assert.deepEqual(weeklyCheck(0, 2), { chance: 1, stirs: false, quiet: 1 }, "then 2-in-6");
  assert.deepEqual(weeklyCheck(1, 2), { chance: 2, stirs: true, quiet: 0 });
});

test("week starts: weekday 0 at 00:00, each one inside the jump", () => {
  const cal = { secondsPerDay: 86400, week: 7, offset: 0 };
  assert.deepEqual(weekStarts(cal, 6 * 86400 + 3600, 7 * 86400), [7 * 86400], "Sunday 01:00 to Monday 00:00");
  assert.deepEqual(weekStarts(cal, 0, 20 * 86400), [7 * 86400, 14 * 86400], "a jump of 20 days crosses two");
  assert.deepEqual(weekStarts(cal, 7 * 86400, 8 * 86400), [], "starting on one doesn't count it again");
  assert.deepEqual(weekStarts({ ...cal, offset: 3 }, 0, 7 * 86400), [4 * 86400]);
});

test("settlement rows give a kind; city-state is not a city", () => {
  assert.equal(settlementKind("A village"), "village");
  assert.equal(settlementKind("A town (reroll if none)"), "town");
  assert.equal(settlementKind("A city (reroll if none)"), "city");
  assert.equal(settlementKind("A city-state (reroll if none)"), "city_state");
  assert.equal(settlementKind("A ruin"), null);
});

test("a Type of Trouble row imported whole gives its type and inline options", () => {
  assert.deepEqual(inlineDetail("Omen. 1d4: 1. Red sky 2. Two moons 3. Silent birds 4. Salt rain"),
    { type: "Omen", formula: "1d4", options: ["Red sky", "Two moons", "Silent birds", "Salt rain"] });
  assert.equal(inlineDetail("Omen"), null, "a split import has no inline list");
});

test("urgency rows give a stage, its die and its symptoms", () => {
  assert.deepEqual(urgencyRow("1d4 weeks away Whispers, unease"), { stage: "weeks", formula: "1d4", symptoms: "Whispers, unease" });
  assert.deepEqual(urgencyRow("1d12 hours away Panic"), { stage: "hours", formula: "1d12", symptoms: "Panic" });
  assert.deepEqual(urgencyRow("Already happened Ruin"), { stage: "happened", formula: null, symptoms: "Ruin" });
  assert.equal(urgencyRow("Soon"), null);
});

test("the countdown: weeks, then days and hours before it arrives", () => {
  const secs = { hour: 3600, day: 86400, week: 7 * 86400 };
  const s = schedule("weeks", 0, { weeks: 2, days: 3, hours: 5 }, secs);
  assert.deepEqual(s, { daysAt: 11 * 86400, hoursAt: 14 * 86400 - 5 * 3600, arriveAt: 14 * 86400 });
  assert.deepEqual([0, 11 * 86400, s.hoursAt, s.arriveAt].map((t) => stageAt(t, s)), ["weeks", "days", "hours", "happened"]);
  assert.equal(stageAt(0, schedule("weeks", 0, { weeks: 1, days: 8 }, secs)), "days", "a lead longer than the weeks starts in days");
  assert.equal(stageAt(0, schedule("happened", 0, {}, secs)), "happened");
  assert.equal(nextChange(0, { ...s, resolved: false }), 11 * 86400);
  assert.equal(nextChange(0, { ...s, resolved: true }), Infinity);
  assert.equal(nextChange(s.arriveAt, s), Infinity);
});
