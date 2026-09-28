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

test("the Method step reads the party: each member's mount or on foot, and what the next dawn brings (#257)", () => {
  const members = [{ id: "a", uuid: "Actor.a", name: "Mira", rations: 2 }, { id: "b", uuid: "Actor.b", name: "Tor", rations: 1 }];
  const v = view({ see: 3, party: { method: "mounted", ride: { "Actor.a": "Bessie", "Actor.b": "Nib" } }, nextBase: 6 });
  v.model = { ...v.model, members, method: "walking" };
  v.state.base = 4;
  const html = travelPanel(v);
  assert.ok(html.includes('SDE.travel.method.rides{&quot;mount&quot;:&quot;Bessie&quot;}'));
  assert.ok(html.includes("SDE.travel.method.nextDawn"), "mounted from the next dawn");
  v.party = { method: "walking", ride: {} };
  assert.ok(travelPanel(v).includes("SDE.travel.method.onFoot") && !travelPanel(v).includes("SDE.travel.method.nextDawn"));
});

test("the Encounters step: the GM's Adjust rows, the setting pressed and the book's marked; players get neither (#257)", () => {
  const v = view({ see: 6, gm: true, adjust: true, frequency: { chance: 3, day: 1, night: 2 } });
  v.state = { ...v.state, pending: null, pushed: true };
  const html = travelPanel(v);
  assert.ok(html.includes('data-action="adjust" aria-expanded="true"') && html.includes('data-action="checkNow"'));
  const pressed = [...html.matchAll(/data-id="(\w+)" data-n="(\d)" aria-pressed="true"/g)].map((m) => `${m[1]}${m[2]}`);
  assert.deepEqual(pressed, ["chance3", "day1", "night2"], "each row presses the setting's number");
  assert.equal([...html.matchAll(/data-action="encSet"/g)].length, 15, "chance 1-5, 0-4 by day, 0-4 by night");
  const book = [...html.matchAll(/data-id="(\w+)" data-n="(\d)" aria-pressed="\w+">\d <span class="sde-hud-book">/g)].map((m) => `${m[1]}${m[2]}`);
  assert.deepEqual(book, ["chance1", "day2", "night2"], "the book's value in each row");
  assert.ok(html.includes("SDE.travel.encounters.adjustNote"));
  assert.ok(html.includes('SDE.travel.encounters.summary{"chance":"<b>4</b>"'), "the chance now: 3, one more pushed");
  assert.ok(html.includes("SDE.travel.encounters.pushed"));

  // Folded: the Adjust key, no rows.
  const folded = travelPanel({ ...v, adjust: false });
  assert.ok(folded.includes('aria-expanded="false"') && !folded.includes('data-action="encSet"'));

  // A player: the summary only, whatever the view says.
  const player = travelPanel({ ...v, gm: false });
  assert.ok(player.includes("SDE.travel.encounters.summary"));
  for (const bit of ['data-action="adjust"', 'data-action="encSet"', 'data-action="checkNow"', "SDE.travel.encounters.adjustNote"]) {
    assert.ok(!player.includes(bit), `no ${bit} for a player`);
  }
});

test("the Encounters step counts today's checks, or the settings' before a day starts, and says when a day has none (#257)", () => {
  const v = view({ see: 6, gm: true, frequency: { chance: 1, day: 3, night: 0 } });
  v.state = { ...v.state, pending: null, checks: [] };
  const summary = (html) => html.match(/SDE\.travel\.encounters\.summary(\{[^}]*\})/)[1];
  const today = travelPanel(v);
  assert.deepEqual(JSON.parse(summary(today)), { chance: "<b>1</b>", day: "<b>0</b>", night: "<b>0</b>" }, "a day open: today's, none");
  assert.ok(today.includes("SDE.travel.encounters.noneToday"));
  const before = travelPanel({ ...v, model: { ...v.model, dayOpen: false } });
  assert.deepEqual(JSON.parse(summary(before)), { chance: "<b>1</b>", day: "<b>3</b>", night: "<b>0</b>" }, "no day: the next dawn's");
  assert.ok(before.includes("SDE.travel.encounters.none") && !before.includes("SDE.travel.encounters.noneToday"));
});

test("the Speed step: the GM's Normal | Push switch, and a change that waits for the next dawn (#257)", () => {
  const v = view({ see: 4, gm: true, nextBase: 4 });
  v.state = { ...v.state, pending: null, pace: "push", pushed: false, base: 4 };
  const html = travelPanel(v);
  assert.ok(html.includes('data-action="pace" data-id="push" aria-pressed="true"'));
  assert.ok(html.includes("SDE.travel.speed.pushNextDawn"));
  assert.ok(html.includes('SDE.travel.speed.numbers{&quot;base&quot;:4,&quot;push&quot;:6}'));
  const player = travelPanel({ ...v, gm: false });
  assert.ok(!player.includes('data-action="pace"') && player.includes("SDE.travel.speed.pushing"));
});

test("the Night step names the hour a creature woke the camp to the GM only (#282 review)", () => {
  const state = { ...view().state, camp: { extras: false, interrupted: 79200, ate: true } };
  const model = (gm) => ({ ...view().model, interrupted: gm ? 79200 : null });
  const player = travelPanel(view({ state, model: model(false), see: 8 }));
  const gm = travelPanel(view({ state, model: model(true), gm: true, see: 8 }));
  assert.ok(!player.includes("SDE.travel.night.interrupted"), "the player's panel says nothing of it");
  assert.ok(gm.includes("SDE.travel.night.interrupted"));
});
