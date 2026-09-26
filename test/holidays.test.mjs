// City of Masks holidays (#191): recipes, when they fall, where, and the API.
// Foundry is stubbed: the core calendar's components, i18n, and the journals
// pack holding what the Chapter-to-journal preset imported.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ANCHORS, HOLIDAYS, HOLIDAY_PRESET, holidaysToday, listHolidays, placeMatches, whenMatches,
} from "../scripts/holidays/holidays.mjs";
import { CHAPTER_PRESETS } from "../scripts/importer/chapter-journal.mjs";

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
  // No moon yet: Lastmoon waits for a date source that knows it.
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
let components, imported, journalPreset;

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
  components = { year: 1300, month: 4, dayOfMonth: 0, day: 120 };   // May 1 (zero-based month and day)
  imported = ["lastmoon", "maytide", "night-of-st-anton", "the-duke-s-ball"];
  journalPreset = preset.id;
  globalThis.game = {
    time: { get components() { return components; } },
    i18n: { localize: (k) => `<${k}>` },
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
  components = { year: 1300, month: 5, dayOfMonth: 20, day: 171 };  // June 21
  assert.deepEqual((await holidaysToday({ place: "settlement-1334" })).map((h) => h.key), ["dukes-ball"]);
});
