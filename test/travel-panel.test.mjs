// The Travel panel (#257): what a player's panel may show while the GM holds
// an encounter, and the weather that has run out. The day here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";

import { gregorian } from "./gregorian-calendar.mjs";

globalThis.game = { i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` } };
const { travelPanel } = await import("../scripts/overland/travel-panel.mjs");

// Camped for the night; a night check hit at 22:00 and the GM hasn't posted it.
const view = (over = {}) => ({
  state: {
    pending: { reason: "camp" }, pushed: false, budget: 4, pointSeconds: 7200,
    checks: [{ half: "day", at: 36000, chance: 1, rolled: true, hit: false }, { half: "night", at: 79200, chance: 1, rolled: true, hit: true }],
    hex: { region: "Sablewood", terrain: "dense_forest" }, weather: { kind: "stormy", roll: 1, advantage: false },
  },
  model: { dayOpen: true, members: [], method: "walking", climate: "temperate", harsh: false, stormy: false, hexesLeft: 0, budget: 4, leftShare: 0 },
  gm: false, see: null, cal: gregorian, night: true, rules: null, season: "Summer",
  weather: "stormy", extras: false, weatherName: (k) => k, methodName: (k) => k,
  ...over,
});
const current = (html) => html.match(/data-id="(\d)"[^>]*aria-current/)?.[1];

test("a player's panel doesn't move for an encounter the GM holds, nor say the night stopped", () => {
  const html = travelPanel(view());
  assert.equal(current(html), "5");
  assert.ok(!html.includes("SDE.travel.night.stopped"));
  assert.ok(!html.includes('data-action="resume"'));
});

test("the GM's panel opens on the step of the check that hit, and offers Continue", () => {
  const html = travelPanel(view({ gm: true }));
  assert.equal(current(html), "8");
  assert.ok(html.includes("SDE.travel.night.stopped"));
  assert.ok(html.includes('data-action="resume"'));
  // A night check hit while the clock was moved (not at camp): still the night's step.
  const moved = view({ gm: true });
  moved.state.pending = { reason: "clock" };
  assert.equal(current(travelPanel(moved)), "8");
});

test("weather that has run out isn't today's: step 1 says so and sight has no storm", () => {
  const rules = { darkness: -1, stormy: -1, excellent: 1, slight: 1, high: 3, elevation: {} };
  const html = travelPanel(view({ weather: null, see: 1, rules, night: false }));
  assert.ok(html.includes("SDE.travel.weather.none"));
  assert.ok(!html.includes("SDE.travel.weather.effect.stormy"));
  const sight = travelPanel(view({ weather: null, see: 2, rules, night: false }));
  assert.ok(sight.includes("SDE.travel.sight.hex{") && !sight.includes("SDE.travel.sight.part.stormy"), "1 hex, no storm");
});

test("the subtitle names the terrain in words, and Extras' fog is promised only when Extras is on", () => {
  const rules = { darkness: -1, stormy: -1, excellent: 1, slight: 1, high: 3, elevation: {} };
  assert.ok(travelPanel(view()).includes("Sablewood · dense forest · temperate"));
  const sight = (extras) => travelPanel(view({ see: 2, rules, extras }));
  assert.ok(!sight(false).includes("SDE.travel.sight.fog") && sight(false).includes("SDE.travel.sight.noTokenSight"));
  assert.ok(sight(true).includes("SDE.travel.sight.fog"));
});
