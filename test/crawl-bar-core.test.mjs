// The crawl bar's one row: which controls each mode shows and what the Tools panel holds (what the bar does is in crawl-bar.mjs; this is the part
// that needs no Foundry).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUTTONS, barItems, toolsSections } from "../scripts/crawl-bar/crawl-bar-core.mjs";
import { ICONS } from "../scripts/shared/icons.mjs";

const en = JSON.parse(readFileSync("languages/en.json", "utf8"));

test("crawl: Next round is first, End last, with Tools before it", () => {
  assert.deepEqual(barItems({ mode: "crawl" }),
    ["badge", "nextCrawlTurn", "addSelectedTokens", "startCombat", "spacer", "tools", "endCrawl"]);
});

test("idle: Start replaces End, and no disabled Next round or Combat is drawn", () => {
  const idle = barItems({ mode: "off" });
  assert.deepEqual(idle, ["badge", "addSelectedTokens", "spacer", "tools", "startCrawl"]);
  assert.ok(!idle.includes("nextCrawlTurn") && !idle.includes("startCombat") && !idle.includes("endCrawl"));
});

test("idle on a hex map keeps the one Travel button", () => {
  assert.deepEqual(barItems({ mode: "off", hexScene: true }), ["badge", "addSelectedTokens", "startTravel", "spacer", "tools", "startCrawl"]);
  assert.ok(!barItems({ mode: "crawl", hexScene: true }).includes("startTravel"), "Travel is for when nothing is running");
});

test("overland: one primary, Continue while a day is pending, else Start day; no Add Tokens", () => {
  assert.deepEqual(barItems({ mode: "overland", pending: true }), ["badge", "resumeTravel", "makeCamp", "spacer", "tools", "endTravel"]);
  assert.deepEqual(barItems({ mode: "overland" }), ["badge", "startDay", "makeCamp", "spacer", "tools", "endTravel"]);
});

test("every control on the bar has a label and an icon", () => {
  const ids = ["off", "crawl", "overland"].flatMap((mode) => [barItems({ mode, hexScene: true }), barItems({ mode, pending: true })].flat());
  for (const id of new Set(ids)) {
    if (["badge", "spacer", "tools"].includes(id)) continue;
    const b = BUTTONS[id];
    assert.ok(b, `${id} has a button`);
    assert.ok(en[b.label], `${id}: ${b.label}`);
    assert.ok(!b.tip || en[b.tip], `${id}: ${b.tip}`);
    assert.ok(ICONS[b.icon], `${id}: icon ${b.icon}`);
  }
});

const entries = (opts) => toolsSections(opts).flatMap((s) => s.entries.map((e) => e.action));

test("Tools: sections in order, 'This travel day' only while travelling", () => {
  assert.deepEqual(toolsSections({ mode: "crawl" }).map((s) => s.id), ["table", "between", "setup"]);
  assert.deepEqual(toolsSections({ mode: "overland" }).map((s) => s.id), ["travelDay", "table", "between", "setup"]);
  assert.deepEqual(toolsSections({ mode: "overland" })[0].entries.map((e) => e.action), ["startDay", "forage", "rollWeather", "startCrawl"]);
});

test("Tools: the table, between-sessions and set-up entries", () => {
  const [table, between, setup] = toolsSections({ mode: "off" });
  assert.deepEqual(table.entries.map((e) => e.action), ["encounter", "rollTables", "lootGen", "magicForge", "merchant", "party"]);
  assert.deepEqual(between.entries.map((e) => e.action), ["partyXp", "downtime", "training", "renown", "rumors", "recap", "pitFighting"]);
  assert.deepEqual(setup.entries.map((e) => e.action), ["importer"]);
});

test("Tools: Bastions only once the world has one; Reset initiative only in a crawl", () => {
  assert.ok(!entries({ mode: "off" }).includes("bastions"));
  assert.ok(entries({ mode: "off", hasBastion: true }).includes("bastions"));
  assert.ok(entries({ mode: "crawl" }).includes("resetOocInit"));
  assert.ok(!entries({ mode: "off" }).includes("resetOocInit") && !entries({ mode: "overland" }).includes("resetOocInit"));
});

test("Tools: no entry is listed twice, and every one has a label and an icon", () => {
  for (const mode of ["off", "crawl", "overland"]) {
    const all = toolsSections({ mode, hasBastion: true });
    const actions = all.flatMap((s) => s.entries.map((e) => e.action));
    assert.equal(new Set(actions).size, actions.length, mode);
    for (const s of all) {
      assert.ok(en[s.label], s.label);
      for (const e of s.entries) {
        assert.ok(en[e.label], e.label);
        assert.ok(!e.tip || en[e.tip], e.tip);
        assert.ok(ICONS[e.icon], `icon ${e.icon}`);
      }
    }
  }
});
