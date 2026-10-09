// City of Masks holidays (#191): recipes, when they fall, where, and the API.
// Foundry is stubbed: the core calendar and clock (test/gregorian-calendar.mjs), i18n, and the journals
// pack holding what the Chapter-to-journal preset imported.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ANCHORS, HOLIDAYS, HOLIDAY_PRESET, buildLore, withGmOnly, calendarHolidays, calendarHolyDays, holidaysToday, listHolidays, normalizeLore,
  placeMatches, whenMatches,
} from "../scripts/holidays/holidays.mjs";
import { CHAPTER_PRESETS } from "../scripts/importer/chapter-journal.mjs";
import { SYNODIC_DAYS, anchor } from "../scripts/time/time-core.mjs";
import { at, clockAt, gregorian } from "./gregorian-calendar.mjs";

const byKey = Object.fromEntries(HOLIDAYS.map((h) => [h.key, h]));
const on = (month, day, extra = {}) => ({ year: 1300, month, day, dayOfYear: 0, ...extra });

test("four holidays, each with a place, a when rule, carousing mechanics and garb questions", () => {
  assert.deepEqual(HOLIDAYS.map((h) => h.name), ["Lastmoon", "Maytide", "Night of St. Anton", "The Duke's Ball"]);
  for (const h of HOLIDAYS) {
    assert.equal(h.source, "CS6");
    assert.ok([46, 47].includes(h.page), h.key);
    assert.deepEqual(h.place, { name: "City of Masks", hex: "1334" });
    assert.ok(h.when.anchor === "lastFullMoonOfYear" || ANCHORS[h.when.anchor], h.key);
    assert.ok(h.garb.length > 0, `${h.key} has garb questions`);
  }
  // The mechanics the issue lists, as numbers.
  assert.deepEqual(byKey.maytide.carousing, { eventBonus: 1, benefitBonus: 15 });
  assert.equal(byKey["dukes-ball"].carousing.eventBonus, 2);
  assert.equal(byKey["dukes-ball"].carousing.benefitAdvantage, true);
  assert.equal(byKey["st-anton"].carousing.extraMishap, true);
  assert.equal(byKey.lastmoon.carousing.extraBenefit, true);
  assert.deepEqual(byKey.lastmoon.carousing.chances.map((c) => c.oneIn), [20]);
  assert.deepEqual(byKey.maytide.garb.map((g) => g.modifier), [-1, 1, -1]);
  const red = byKey["dukes-ball"].garb.find((g) => g.key === "dukesBallRed");
  assert.equal(red.modifier, -3);
  assert.ok(red.note, "red posts an arrest-risk note");
  assert.equal(byKey["dukes-ball"].garb.find((g) => g.required)?.key, "dukesBallCostume500");
});

test("no book wording ships: every string in a recipe is a name, a key or an en.json key", () => {
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(HOLIDAYS);
  for (const s of strings) {
    assert.ok(s.startsWith("SDE.holidays.") || s.length <= 20, `"${s}" reads like prose`);
  }
});

test("each holiday falls on its anchor and no other day", () => {
  assert.equal(whenMatches(byKey.maytide.when, on(5, 1)), true);
  assert.equal(whenMatches(byKey.maytide.when, on(4, 30)), false);
  assert.equal(whenMatches(byKey["dukes-ball"].when, on(6, 21)), true);
  assert.equal(whenMatches(byKey["st-anton"].when, on(9, 22)), true);
  assert.equal(whenMatches(byKey["st-anton"].when, on(6, 21)), false);
  // Lastmoon is the date's to say: currentDateInfo asks the time API.
  assert.equal(whenMatches(byKey.lastmoon.when, on(12, 20)), false);
  assert.equal(whenMatches(byKey.lastmoon.when, on(12, 20, { isLastFullMoonOfYear: true })), true);
  assert.equal(whenMatches({ anchor: "nonsense" }, on(5, 1)), false);
});

test("a place is a name, a hex number or Extras' settlement id", () => {
  const place = byKey.maytide.place;
  for (const p of ["City of Masks", "city of masks*", 1334, "1334", "settlement-1334", undefined]) {
    assert.equal(placeMatches(place, p), true, String(p));
  }
  for (const p of ["Alkesh", 5063, "settlement-5063"]) assert.equal(placeMatches(place, p), false, String(p));
});

test("a leading \"The\" and a zero-padded hex number still name the place", () => {
  const place = byKey.maytide.place;
  for (const p of ["The City of Masks", "the city of masks", "01334", "settlement-01334"]) {
    assert.equal(placeMatches(place, p), true, String(p));
  }
  assert.equal(placeMatches(place, "The Alkesh"), false);
  assert.equal(placeMatches(place, "13340"), false, "a different number is a different hex");
  assert.equal(placeMatches({ name: "Nowhere" }, 1334), false, "a place with no hex matches no number");
});

// ── the API, against a stubbed world ─────────────────────────────────────────

const preset = CHAPTER_PRESETS.find((p) => p.id === HOLIDAY_PRESET);
let now, imported, journalPreset;

function journalsPack() {
  const entry = {
    pages: imported.map((key) => ({
      uuid: `Compendium.world.sde-journal.JournalEntry.h.JournalEntryPage.${key}`,
      getFlag: (mod, flag) => (flag === "chapter" ? { key } : undefined),
    })),
  };
  return {
    collection: "world.sde-journal",
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Journals" },
    getIndex: async () => (imported.length
      ? [{ _id: "h", flags: { "shadowdark-enhancer": { chapter: { src: preset.src, pages: preset.pages, preset: journalPreset } } } }]
      : []),
    getDocument: async () => entry,
  };
}

beforeEach(() => {
  now = at(1300, 5, 1);
  imported = ["lastmoon", "maytide", "night-of-st-anton", "the-duke-s-ball"];
  journalPreset = preset.id;
  globalThis.game = {
    get time() { return clockAt(now); },
    i18n: { localize: (k) => `<${k}>` },
    settings: { get: () => 1 },                       // a GM's moon epoch, one second in: the moon was new at the calendar's start
    get packs() { return [journalsPack()]; },
  };
});

test("list() returns the imported holidays, labels localised and pages linked", async () => {
  const list = await listHolidays();
  assert.equal(list.length, 4);
  const maytide = list.find((h) => h.key === "maytide");
  assert.match(maytide.pageUuid, /JournalEntryPage\.maytide$/);
  assert.equal(maytide.garb[0].label, "<SDE.holidays.garb.maytideNoFloral>");
  assert.equal(HOLIDAYS[1].garb[0].label, "SDE.holidays.garb.maytideNoFloral", "the recipe itself is untouched");
});

test("what list() returns is the caller's own copy, all the way down", async () => {
  const before = JSON.stringify(HOLIDAYS);
  const [first] = await listHolidays();
  first.when.anchor = "winterSolstice";
  first.place.hex = "9999";
  first.carousing.extraBenefit = false;
  first.carousing.chances.push({ key: "x" });
  first.garb[0].modifier = 5;
  assert.equal(JSON.stringify(HOLIDAYS), before, "the recipes are untouched");
  const [again] = await listHolidays();
  assert.equal(again.when.anchor, "lastFullMoonOfYear");
  assert.equal(again.place.hex, "1334");
});

test("nothing is listed until the journal is imported", async () => {
  imported = [];
  assert.deepEqual(await listHolidays(), []);
});

test("a free-range journal over the same pages is not the holidays journal", async () => {
  journalPreset = "custom";
  assert.deepEqual(await listHolidays(), []);
});

test("today() names Maytide on May 1 in the City of Masks, and nothing elsewhere", async () => {
  assert.deepEqual((await holidaysToday({ place: "City of Masks" })).map((h) => h.key), ["maytide"]);
  assert.deepEqual(await holidaysToday({ place: "Alkesh" }), []);
  // The Duke's Ball is the summer solstice, which the 1300 calendar shows on 13 June, not 21 June.
  now = at(1300, 6, 13, 20);
  assert.deepEqual((await holidaysToday({ place: "settlement-1334" })).map((h) => h.key), ["dukes-ball"]);
  now = at(1300, 6, 21, 20);
  assert.deepEqual(await holidaysToday({ place: "settlement-1334" }), []);
});

test("Lastmoon falls on the day of the year's last full moon, through the time API (#227)", async () => {
  const day = anchor(gregorian, "lastFullMoon", 1300, 1);       // the moon's epoch is the calendar's start (the setting above)
  now = day + 21 * 3600;
  assert.deepEqual((await holidaysToday({ place: "City of Masks" })).map((h) => h.key), ["lastmoon"]);
  now = day - 3600;                                               // the evening before
  assert.deepEqual(await holidaysToday({ place: "City of Masks" }), []);
  now = day - SYNODIC_DAYS * 86400;                               // the full moon before it
  assert.deepEqual(await holidaysToday({ place: "City of Masks" }), []);
});

test("a date that knows its sun's day decides the solar holidays; one that does not, the fixed date", () => {
  const solstice = { anchor: "summerSolstice" };
  assert.equal(whenMatches(solstice, { month: 6, day: 13, solar: "summerSolstice" }), true);
  assert.equal(whenMatches(solstice, { month: 6, day: 21, solar: null }), false, "21 June is not the solstice in 1348");
  assert.equal(whenMatches(solstice, { month: 6, day: 21 }), true, "no solar field: the fixed date as before");
  assert.equal(whenMatches({ anchor: "springCrossQuarter" }, { month: 5, day: 1, solar: null }), true, "May Day stays fixed");
});

test("the players' copy is the imported pages' text and the holy days' keys, in a fixed order", () => {
  const lore = buildLore([{ key: "maytide", paras: ["b"] }, { key: "lastmoon", paras: ["a"] }], ["rams-run", "forgefire"]);
  assert.deepEqual(Object.keys(lore.holidays), ["lastmoon", "maytide"]);
  assert.deepEqual(lore.holy, ["forgefire", "rams-run"]);
  assert.equal(JSON.stringify(buildLore([{ key: "lastmoon", paras: ["a"] }, { key: "maytide", paras: ["b"] }], ["forgefire", "rams-run"])), JSON.stringify(lore), "the same copy compares equal");
});

test("a stored copy is trusted only where it has the right shape", () => {
  assert.deepEqual(normalizeLore(undefined), { holidays: {}, holy: [] });
  assert.deepEqual(normalizeLore({ holidays: { a: ["x", 3], b: "no" }, holy: ["k", 5] }), { holidays: { a: ["x"] }, holy: ["k"] });
});

test("a player sees the holidays and holy days from the copy, with their text and no page to open; a GM reads the pack", async () => {
  const lore = { holidays: { maytide: ["Spring text."] }, holy: ["forgefire", "rams-run"] };
  globalThis.game.settings = { get: () => lore };
  globalThis.game.user = { isGM: false };
  const holidays = await calendarHolidays();
  assert.deepEqual(holidays.map((h) => h.key), ["maytide"], "only the ones in the copy");
  assert.deepEqual(holidays[0].paras, ["Spring text."]);
  assert.equal(holidays[0].pageUuid, null);
  assert.equal(holidays[0].garb[0].label, "<SDE.holidays.garb.maytideNoFloral>", "labels localised for the player");
  const holy = await calendarHolyDays();
  assert.deepEqual(holy.map((h) => h.key), ["forgefire", "rams-run"]);
  assert.equal(holy[0].pageUuid, null);
  globalThis.game.user = { isGM: true };
  assert.deepEqual((await calendarHolidays()).map((h) => h.key), ["lastmoon", "maytide", "st-anton", "dukes-ball"], "a GM's come from the journal");
  assert.ok((await calendarHolidays())[0].pageUuid);
});

test("a holiday or holy day switched to GM only is left out of the players' copy", () => {
  const pages = [{ key: "lastmoon", paras: ["a"] }, { key: "maytide", paras: ["b"] }];
  const lore = buildLore(pages, ["forgefire", "rams-run"], ["maytide", "rams-run"]);
  assert.deepEqual(Object.keys(lore.holidays), ["lastmoon"]);
  assert.deepEqual(lore.holy, ["forgefire"]);
  assert.deepEqual(buildLore(pages, ["forgefire"]).holy, ["forgefire"], "nothing hidden by default");
  assert.deepEqual(withGmOnly(["b"], "a", true), ["a", "b"]);
  assert.deepEqual(withGmOnly(["a", "b"], "a", false), ["b"]);
  assert.deepEqual(withGmOnly(["a"], "a", true), ["a"], "switching on twice changes nothing");
});
