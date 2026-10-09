// The clock HUD's pure half (#253): who sees the bar, the GM's steps, the sky
// dial, the season hatch, the month view and a typed date; and the time core's
// next dawn, noon, dusk and midnight.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  barShown, clockShown, clockSteps, DIAL, dialMarkup, dialModel, pickPartyToken, placeLines, seasonHatch, monthGrid, dateToTime,
  TRAVEL_STEPS, currentStep, sightParts,
} from "../scripts/overland/hud-core.mjs";
import { nextTimeOfDay, sun, dateParts } from "../scripts/time/time-core.mjs";
import { gregorian, quirkyGregorian, at } from "./gregorian-calendar.mjs";

test("the bar shows by the setting, on a hex map only, and to nobody during a combat", () => {
  assert.equal(clockShown({ setting: "all", isGM: false, combat: false, hex: true }), true);
  assert.equal(clockShown({ setting: "gm", isGM: false, combat: false, hex: true }), false);
  assert.equal(clockShown({ setting: "gm", isGM: true, combat: false, hex: true }), true);
  assert.equal(clockShown({ setting: "off", isGM: true, combat: false, hex: true }), false);
  assert.equal(clockShown({ setting: "all", isGM: true, combat: true, hex: true }), false);
});

test("the bar never shows on a scene with no hex grid, whoever the setting is for (#298)", () => {
  for (const setting of ["all", "gm", "off"]) for (const isGM of [true, false]) {
    assert.equal(clockShown({ setting, isGM, combat: false, hex: false }), false, `${setting}, GM ${isGM}`);
  }
  // Viewing another scene flips the answer both ways, with no reload: the caller asks each time.
  const on = (hex) => clockShown({ setting: "all", isGM: false, combat: false, hex });
  assert.deepEqual([on(false), on(true), on(false)], [false, true, false]);
  assert.equal(clockShown({ setting: "all", isGM: false, combat: false }), false, "no answer about the scene is no bar");
});

/** Every input the bar's rule reads, in every combination (a scene that says nothing of its grid included). */
const everyInput = () => ["all", "gm", "off", undefined].flatMap((setting) => [true, false].flatMap((isGM) =>
  [true, false].flatMap((combat) => [true, false, undefined].map((hex) => ({ setting, isGM, combat, hex })))));

test("with no battle the bar is shown exactly when the clock is, for every input (#298 stays as it was)", () => {
  for (const input of everyInput()) {
    const label = JSON.stringify(input);
    assert.equal(barShown(input), clockShown(input), label);
    assert.equal(barShown({ ...input, battle: false }), clockShown(input), label);
  }
});

test("a GM's running battle keeps the bar on a scene with no hex grid, in a combat, and with the clock bar off", () => {
  const gm = { isGM: true, battle: true };
  assert.equal(barShown({ ...gm, setting: "all", combat: false, hex: false }), true, "the battle's own scene");
  assert.equal(barShown({ ...gm, setting: "all", combat: true, hex: true }), true, "the combat the table was brought into");
  assert.equal(barShown({ ...gm, setting: "all", combat: true, hex: false }), true, "both at once, as a live battle is");
  assert.equal(barShown({ ...gm, setting: "off", combat: false, hex: true }), true, "the clock bar turned off");
  assert.equal(barShown({ ...gm, setting: "gm", combat: false, hex: false }), true);
  for (const input of everyInput().filter((i) => i.isGM)) assert.equal(barShown({ ...input, battle: true }), true, JSON.stringify(input));
  // What it keeps is the battle's: the clock itself is still shown by its own rule alone.
  assert.equal(clockShown({ setting: "all", isGM: true, combat: true, hex: false }), false);
});

test("a battle never keeps a player's bar: they get the clock's rule and nothing more", () => {
  for (const input of everyInput().filter((i) => !i.isGM)) {
    assert.equal(barShown({ ...input, battle: true }), clockShown(input), JSON.stringify(input));
  }
  for (const [setting, combat, hex] of [["all", false, false], ["all", true, true], ["off", false, true]]) {
    assert.equal(barShown({ setting, isGM: false, combat, hex, battle: true }), false, `${setting} combat ${combat} hex ${hex}`);
  }
});

test("the GM's steps: a day, 8 hours, an hour, 10 minutes and a round", () => {
  assert.deepEqual(clockSteps(gregorian, 6).map((s) => s.seconds), [86400, 28800, 3600, 600, 6]);
});

test("the dial turns 15 degrees an hour, with day between sunrise and sunset", () => {
  const noon = dialModel({ hour: 12, sunrise: 6, sunset: 18, moonFraction: 0.5 });
  assert.equal(noon.rotate, 180);
  assert.equal(noon.isDay, true);
  assert.deepEqual(noon.next, { kind: "sets", hour: 18 });
  const night = dialModel({ hour: 23, sunrise: 6, sunset: 18, moonFraction: 0 });
  assert.equal(night.isDay, false);
  assert.equal(night.next.kind, "rises", "after sunset the next is tomorrow's sunrise");
  assert.equal(dialModel({ hour: 5, sunrise: 6, sunset: 18, moonFraction: 0 }).next.hour, 6);
  assert.equal(dialModel({ hour: 18.3, sunrise: 6, sunset: 18, moonFraction: 0 }).isDay, false, "twilight is not day");
  assert.equal(night.moon.shadow, 0, "a new moon's shadow covers it");
  assert.equal(noon.moon.shadow, 2 * DIAL.moonR, "a full moon's is pushed off it");
});

test("the season hatch grows over a season's last 30 days, to 30%", () => {
  assert.equal(seasonHatch(40), 0);
  assert.equal(seasonHatch(30), 0);
  assert.equal(seasonHatch(15), 15);
  assert.equal(seasonHatch(0), 30);
});

test("next dawn, noon, dusk and midnight: always after now", () => {
  const t = at(1301, 6, 21, 12);                                // noon on the longest day
  assert.equal(nextTimeOfDay(gregorian, t, "noon"), at(1301, 6, 22, 12), "exactly noon: the next noon is tomorrow's");
  assert.equal(nextTimeOfDay(gregorian, t, "midnight"), at(1301, 6, 22, 0));
  const { sunset } = sun(gregorian, t);
  assert.equal(nextTimeOfDay(gregorian, t, "dusk"), at(1301, 6, 21) + Math.round(sunset * 3600));
  const dawn = nextTimeOfDay(gregorian, t, "dawn");
  assert.ok(dawn > at(1301, 6, 22) && dawn < at(1301, 6, 22, 6), "tomorrow's sunrise, early in the summer");
  const late = at(1301, 6, 21, 22);
  assert.ok(nextTimeOfDay(gregorian, late, "dusk") > at(1301, 6, 22), "after dusk: tomorrow's");
});

test("the month view: weeks from weekday 0, today, the moon's quarters, leading and trailing days", () => {
  const t = at(1301, 5, 14, 9);
  const g = monthGrid(gregorian, t, { epoch: 0 });
  assert.equal(g.month, "CALENDAR.GREGORIAN.May");
  assert.equal(g.year, 1301);
  const inMonth = g.cells.filter((c) => !c.out);
  assert.equal(inMonth.length, 31);
  assert.equal(g.cells.length % 7, 0, "whole weeks");
  assert.equal(inMonth.find((c) => c.today)?.day, 14);
  const lead = g.cells.findIndex((c) => !c.out);
  const firstWeekday = gregorian.timeToComponents(at(1301, 5, 1)).dayOfWeek;
  assert.equal(lead, firstWeekday, "day 1 sits under its own weekday");
  const quarters = inMonth.filter((c) => c.moon).map((c) => c.moon);
  assert.ok(quarters.length >= 3 && quarters.length <= 5, `a month has about four quarters: ${quarters}`);
  assert.ok(quarters.includes("full"));
  assert.equal(g.fullMoon, inMonth.find((c) => c.moon === "full").day);
});

test("the month view turns months, across a year's end", () => {
  const t = at(1301, 12, 20);
  const next = monthGrid(gregorian, t, { offset: 1 });
  assert.equal(next.month, "CALENDAR.GREGORIAN.January");
  assert.equal(next.year, 1302);
  const back = monthGrid(gregorian, t, { offset: -2 });
  assert.equal(back.month, "CALENDAR.GREGORIAN.October");
  assert.equal(back.cells.filter((c) => !c.out).length, 31);
  const feb = monthGrid(gregorian, at(1301, 2, 10));
  assert.equal(feb.cells.filter((c) => !c.out).length, 28);
});

test("the month view names each day's holidays", () => {
  const g = monthGrid(gregorian, at(1301, 5, 1), { holidaysOn: (d) => (d.month === 5 && d.day === 1 ? ["Maytide"] : []) });
  assert.deepEqual(g.cells.find((c) => !c.out && c.day === 1).holidays, ["Maytide"]);
  assert.deepEqual(g.cells.find((c) => !c.out && c.day === 2).holidays, []);
});

test("a typed date lands on that day and time, or on nothing", () => {
  const t = dateToTime(gregorian, { year: 1301, month: 5, day: 14, hour: 9, minute: 30 });
  assert.equal(t, at(1301, 5, 14, 9, 30));
  assert.equal(dateParts(gregorian, t).time, "09:30");
  assert.equal(dateToTime(gregorian, { year: 1301, month: 13, day: 1 }), null);
  assert.equal(dateToTime(gregorian, { year: 1301, month: 2, day: 30 }), null, "no 30 February");
});

test("core's leap-year quirk: January shows 1 January twice, and the month before is December", () => {
  const leap = gregorian.componentsToTime({ year: 1304 });                    // 1304 is 366 days long
  const jan = monthGrid(quirkyGregorian, leap);
  assert.equal(jan.month, "CALENDAR.GREGORIAN.January");
  assert.equal(jan.cells.filter((c) => !c.out).length, 32, "every day core shows as January");
  const back = monthGrid(quirkyGregorian, leap + 15 * 86400, { offset: -1 });
  assert.equal(back.month, "CALENDAR.GREGORIAN.December");
  assert.equal(back.year, 1303);
});

test("a typed time the calendar's day doesn't have is refused", () => {
  const short = { ...gregorian, days: { ...gregorian.days, hoursPerDay: 20 } };
  assert.equal(dateToTime(short, { year: 1301, month: 5, day: 14, hour: 22 }), null);
  assert.equal(dateToTime(gregorian, { year: 1301, month: 5, day: 14, hour: 9, minute: 60 }), null);
});

test("the travel day's step: weather before a day, traveling during it, 6 or 8 while an encounter holds the clock", () => {
  assert.equal(TRAVEL_STEPS.length, 8);
  assert.equal(currentStep({ dayOpen: false, pending: null }), 1);
  assert.equal(currentStep({ dayOpen: true, pending: null }), 5);
  assert.equal(currentStep({ dayOpen: true, pending: { reason: "move" } }), 6);
  assert.equal(currentStep({ dayOpen: true, pending: { reason: "camp" } }), 8);
  // By the check that hit, when known: a night check hit by moving the clock, a day one at camp.
  assert.equal(currentStep({ dayOpen: true, pending: { reason: "clock" }, heldHalf: "night" }), 8);
  assert.equal(currentStep({ dayOpen: true, pending: { reason: "camp" }, heldHalf: "day" }), 6);
});

test("the travel day's step stands on Resting while a camp is set up and on Night while it runs", () => {
  assert.equal(currentStep({ dayOpen: true, pending: null, camp: "setup" }), 7);
  assert.equal(currentStep({ dayOpen: true, pending: null, camp: "night" }), 8);
  assert.equal(currentStep({ dayOpen: true, pending: { reason: "move" }, camp: "night" }), 6, "a held encounter still wins");
  assert.equal(currentStep({ dayOpen: false, pending: null, camp: "setup" }), 1);
});

test("sight in hexes: the book's sum, as Extras' hex fog counts it; nothing without the rules data", () => {
  const rules = { darkness: -1, stormy: -1, excellent: 1, slight: 1, high: 3, elevation: { mountain: "high", hills: "slight" } };
  assert.equal(sightParts(rules, { terrain: "grassland", night: false, weather: "fair" }).radius, 1);
  assert.equal(sightParts(rules, { terrain: "Mountain", night: false, weather: "excellent" }).radius, 5);
  assert.equal(sightParts(rules, { terrain: "grassland", night: true, weather: "stormy" }).radius, 0, "never below 0");
  assert.deepEqual(sightParts(rules, { terrain: "hills", night: true, weather: null }).parts, [["base", 1], ["darkness", -1], ["slight", 1]]);
  assert.equal(sightParts({}, { terrain: "hills", night: false, weather: null }), null);
});

test("the dial is a half disc: its centre is the top edge and nothing is placed above it", () => {
  assert.equal(DIAL.cy, 0);
  assert.equal(DIAL.cx, DIAL.w / 2, "centred in its svg");
  const d = dialModel({ hour: 15.4, sunrise: 8.2, sunset: 16.7, moonFraction: 0.26 });
  for (const [x, y] of [d.rise, d.set]) assert.ok(Math.abs(Math.hypot(x - DIAL.cx, y - DIAL.cy) - (DIAL.ringMid + 2)) < 0.2, "the badges sit on the hour ring (the ring turns them into view)");
  assert.ok(d.moon.y >= 0 && d.moon.x >= 0 && d.moon.x <= DIAL.w, "the moon rides the lower half, whatever the hour");
  assert.equal(d.ticks.length, 24);
  assert.equal(d.ticks.filter((k) => k.weight === 2).length, 4, "a long tick every six hours");
});

test("sunrise and sunset are badges on the hour ring, with their times as tooltips, not text on the dial", () => {
  const d = dialModel({ hour: 15.4, sunrise: 8.2, sunset: 16.7, moonFraction: 0.26 });
  const svg = dialMarkup({ d, region: "Sablewood", terrain: "forest", label: "l", riseTip: "sun rises 08:12", setTip: "sun sets 16:42" });
  assert.equal(svg.match(/data-dial-chip/g).length, 2);
  assert.match(svg, /data-tooltip="sun rises 08:12"/);
  assert.match(svg, /data-tooltip="sun sets 16:42"/);
  assert.doesNotMatch(svg.replace(/data-tooltip="[^"]*"/g, ""), /sun (rises|sets)/, "no sun text is drawn");
  assert.equal(svg.match(/data-dial-turn/g).length, 2, "the disc and the hour ring turn together");
});

test("the place is fitted to the disc: one line when it fits, two when long, never cut when it can wrap", () => {
  const one = placeLines({ region: "Sablewood", terrain: "Forest" });
  assert.equal(one.region.length, 1);
  assert.equal(one.region[0].text, "SABLEWOOD");
  assert.equal(one.terrain.text, "forest");
  const long = placeLines({ region: "The Sundered Marches of Karthak", terrain: "mountain forest" });
  assert.deepEqual(long.region.map((l) => l.text), ["THE SUNDERED", "MARCHES OF KARTHAK"]);
  assert.ok(long.terrain.y > long.region[1].y, "the terrain sits below the region");
  assert.ok([...long.region, long.terrain].every((l) => l.size >= 11), "every line stays readable");
  assert.deepEqual(placeLines({}), { region: [], terrain: null });
});

test("finding the party picks the selected party's token, else the travelling party's, else the only one, else none", () => {
  const tokens = [{ id: "a", actorUuid: "Actor.one" }, { id: "b", actorUuid: "Actor.two" }];
  assert.equal(pickPartyToken(tokens, "Actor.two").id, "b");
  assert.equal(pickPartyToken(tokens, "Actor.gone", "Actor.two").id, "b", "no selection: the party that is travelling");
  assert.equal(pickPartyToken(tokens, "Actor.two", "Actor.one").id, "b", "the selection wins over the travel");
  assert.equal(pickPartyToken(tokens, "Actor.gone"), null, "several parties and nobody named: it does not guess the first");
  assert.equal(pickPartyToken(tokens), null);
  assert.equal(pickPartyToken([tokens[0]]).id, "a", "one party is the party");
  assert.equal(pickPartyToken([tokens[0], { id: "c", actorUuid: "Actor.one" }]).id, "a", "two tokens of one party are still one party");
  assert.equal(pickPartyToken([], "Actor.one"), null);
});
