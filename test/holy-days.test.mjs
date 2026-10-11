// The gods' holy days on the month view: which day each lands on, which ones are
// only a stretch of a season, and that the import's page keys match the data.
import { test } from "node:test";
import assert from "node:assert/strict";

import { HOLY_DAYS, HOLY_DAY_PRESET, HOLY_DAY_TABLES, holyOnDay, holyWindows, parseHolyDayRows } from "../scripts/holidays/holy-days.mjs";
import { CHAPTER_PRESETS, nameKey } from "../scripts/importer/chapter-journal.mjs";
import { dayEvents } from "../scripts/calendar/calendar-core.mjs";
import { monthGrid } from "../scripts/overland/hud-core.mjs";
import { gregorian, at } from "./gregorian-calendar.mjs";

const month = (y, m) => monthGrid(gregorian, at(y, m, 10), { epoch: 0 });
const names = (list) => list.map((h) => h.name);
const dayCell = (g, d) => g.cells.find((c) => !c.out && c.day === d);

test("the month view knows each day's place in its season", () => {
  const mar = month(1348, 3);
  assert.equal(dayCell(mar, 1).seasonKey, "spring");
  assert.equal(dayCell(mar, 1).seasonDay, 1);
  assert.equal(dayCell(mar, 7).seasonDay, 7);
  const jul = month(1348, 7);
  assert.equal(dayCell(jul, 1).seasonKey, "summer");
  assert.equal(dayCell(jul, 1).seasonDay, 31, "June has 30 days, so 1 July is the 31st of summer");
  const dec = month(1348, 12);
  assert.equal(dayCell(dec, 1).seasonKey, "winter");
  assert.equal(dayCell(month(1348, 2), 28).seasonDay, 90);
});

test("a day of a season shows on that day: the seventh of spring, the first of spring and of autumn", () => {
  const mar = month(1348, 3);
  assert.deepEqual(names(holyOnDay(HOLY_DAYS, dayCell(mar, 7))), ["Feast of the Covenant"]);
  assert.deepEqual(names(holyOnDay(HOLY_DAYS, dayCell(mar, 1))), ["Ram's Run"]);
  assert.deepEqual(names(holyOnDay(HOLY_DAYS, dayCell(mar, 8))), []);
  assert.deepEqual(names(holyOnDay(HOLY_DAYS, dayCell(month(1348, 9), 1))), ["Night of Mourning"], "the first week of autumn, on its first day");
});

test("a stretch of a season is one line for each month it touches, with no day", () => {
  const w = (y, m) => names(holyWindows(HOLY_DAYS, month(y, m).cells));
  assert.deepEqual(w(1348, 7).sort(), ["Binding Day", "Chainbreak", "Remembrance"].sort(), "high summer");
  assert.ok(w(1348, 6).includes("Six-Lash") && !w(1348, 6).includes("Remembrance"), "early summer is June");
  assert.ok(w(1348, 2).includes("The Ascension") && w(1348, 2).includes("The Pale") && w(1348, 2).includes("Bloodletting"), "late winter");
  assert.ok(w(1348, 11).includes("March of Bones") && w(1348, 11).includes("Laying of the Stone"), "late autumn");
  assert.deepEqual(w(1348, 3).sort(), ["Awakening", "Three-Moon"].sort(), "early spring: a day-rule is not a stretch");
  assert.ok(!w(1348, 3).includes("Feast of the Covenant"));
});

test("a moon in a season shows on its days: each new moon of summer, each full moon of winter, winter's first new moon", () => {
  const onMoons = (months, key) => months.flatMap(([y, m]) => month(y, m).cells.filter((c) => !c.out)
    .filter((c) => holyOnDay(HOLY_DAYS, c).some((h) => h.key === key)).map((c) => `${m}/${c.day}`));
  const summer = onMoons([[1348, 6], [1348, 7], [1348, 8]], "night-of-whispers");
  assert.equal(summer.length, 3, `three summer months, three new moons: ${summer}`);
  const winter = onMoons([[1348, 12], [1349, 1], [1349, 2]], "candle-burn");
  assert.equal(winter.length, 3, `${winter}`);
  const first = onMoons([[1348, 12], [1349, 1], [1349, 2]], "equilibrium");
  assert.equal(first.length, 1, `only winter's first new moon: ${first}`);
  assert.ok(first[0].startsWith("12/") || first[0].startsWith("1/"), first[0]);
});

test("a day's events carry its holy days, between the season and the eclipses", () => {
  const mar = month(1348, 3);
  const ev = dayEvents({ cell: dayCell(mar, 1), year: mar.year, month: mar.monthNumber, spd: 86400, holy: HOLY_DAYS });
  assert.deepEqual(ev.map((e) => e.kind), ["season", "holy"]);
  assert.equal(dayEvents({ cell: dayCell(mar, 1), year: mar.year, month: mar.monthNumber, spd: 86400 }).length, 1, "no holy days passed, none shown");
});

test("every holy day's page key is a section of the preset the import files", () => {
  const preset = CHAPTER_PRESETS.find((p) => p.id === HOLY_DAY_PRESET);
  assert.equal(preset.src, "WR", "the Player's Guide");
  const keys = preset.sections.map((s) => nameKey(s.name).replace(/ /g, "-"));
  for (const h of HOLY_DAYS) assert.ok(keys.includes(h.pageKey), `${h.name}: ${h.pageKey}`);
  const pages = preset.sections.flatMap((s) => s.pages.split("-").map(Number));
  for (const h of HOLY_DAYS) assert.ok(h.page >= Math.min(...pages) && h.page <= Math.max(...pages), `${h.name} p. ${h.page}`);
  assert.equal(new Set(HOLY_DAYS.map((h) => h.key)).size, HOLY_DAYS.length, "keys are unique");
});

test("no holy day's wording ships: no `about` field and no holy.about strings", async () => {
  const en = JSON.parse((await import("node:fs")).readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));
  for (const h of HOLY_DAYS) assert.equal("about" in h, false, h.name);
  assert.deepEqual(Object.keys(en).filter((k) => k.startsWith("SDE.calendar.holy.about.")), []);
});

test("every dated holy day's page has a table the reader knows the names of", () => {
  for (const h of HOLY_DAYS) assert.ok(HOLY_DAY_TABLES.get(h.page)?.includes(h.name), `${h.name} p. ${h.page}`);
  assert.equal([...HOLY_DAY_TABLES.values()].flat().length, HOLY_DAYS.length + 4, "the four undated names are known too");
});

// Invented tables in the shapes the extractor's "layout" columns give a vertically centred cell.
const NAMES = ["Moss Vigil", "Ember Walk", "Lantern Tide", "Quiet Hour"];
const TABLE = [
  "Some heading above",
  "HOLY DAYS",
  "Name            Details",
  "On the first dusk, the keepers",
  "Moss Vigil      light a row of green candles and",
  "sing until the last one gutters",
  "Barefoot pilgrims cross a bed",
  "Ember Walk",
  "of coals before the sun is up",
  "Paper lamps are made all day,",
  "Lantern Tide    and set on the river at dusk;",
  "each floats until the water takes it",
  "Nothing is told",
  "Quiet Hour",
  "of this day",
  "PRAYER GENERATOR",
  "d6  Detail 1",
].join("\n");

test("parseHolyDayRows cuts rows by the centred name: inline names, names on their own line, odd and even cells", () => {
  const rows = parseHolyDayRows(TABLE, NAMES);
  assert.equal(rows["Moss Vigil"], "On the first dusk, the keepers light a row of green candles and sing until the last one gutters");
  assert.equal(rows["Ember Walk"], "Barefoot pilgrims cross a bed of coals before the sun is up");
  assert.equal(rows["Lantern Tide"], "Paper lamps are made all day, and set on the river at dusk; each floats until the water takes it");
  assert.equal(rows["Quiet Hour"], "Nothing is told of this day");
});

test("parseHolyDayRows stops at the next heading and reads nothing from a page with no table", () => {
  assert.equal(Object.keys(parseHolyDayRows(TABLE, NAMES)).length, 4);
  assert.deepEqual(parseHolyDayRows("PRAYER GENERATOR\nd6 Detail 1", NAMES), {});
  assert.deepEqual(parseHolyDayRows("", NAMES), {});
  assert.deepEqual(parseHolyDayRows(null, NAMES), {});
});

test("parseHolyDayRows leaves out a day whose name the table does not print", () => {
  const rows = parseHolyDayRows(TABLE, ["Moss Vigil", "Not Here"]);
  assert.deepEqual(Object.keys(rows), ["Moss Vigil"]);
});
