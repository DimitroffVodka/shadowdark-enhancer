// The clock bar's weather switch: it draws for everyone, flips this device's Show weather effects setting,
// and redraws when that setting changes from anywhere (the bar's own button, or Module Settings).
import test from "node:test";
import assert from "node:assert/strict";

// overland-bar.mjs pulls in crawl-state.mjs and the vehicle sheets, which touch Foundry classes at load.
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const stored = {};
const sets = [];
const hooks = {};
const game = {
  user: { isGM: false, id: "p1" },
  i18n: { localize: (k) => k, format: (k) => k },
  settings: {
    get: (ns, key) => (key === "clockBar" ? "all" : stored[key]),
    set: async (ns, key, value) => { sets.push([ns, key, value]); stored[key] = value; },
  },
  time: { worldTime: 0, calendar: {} },
  combat: null, combats: { get: () => undefined }, scenes: { get: () => undefined },
};
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {} }, Hooks: { on(name, fn) { hooks[name] = fn; }, once() {}, callAll() {} },
  ui: { notifications: { warn() {}, error() {} } }, canvas: { tokens: { placeables: [] }, grid: { isHexagonal: false } },
  game, document: { body: { classList: { toggle() {} } }, activeElement: null, getElementById: () => null },
  window: { addEventListener() {} },
});
const { TravelBar } = await import("../scripts/overland/overland-bar.mjs");

Object.assign(TravelBar, {
  _now: () => ({ now: 0, parts: { weekday: "w", day: 1, month: "m", year: 1301, time: "12:00" } }),
  _open: null, _stack: null, _sky: false, _el: { contains: () => true },
});
const click = (action) => TravelBar._onClick({ target: { closest: () => ({ dataset: { action }, matches: () => false }) } });
const weatherButton = (html) => html.match(/<button[^>]*data-action="weather"[^>]*>/)?.[0];

test("the switch is on the bar for a player too, lit only while this device draws no weather", () => {
  const on = weatherButton(TravelBar._bar());
  assert.ok(on, "a player sees it");
  assert.match(on, /aria-pressed="true"/, "pressed says the weather is on, as the name does");
  assert.doesNotMatch(on, /sde-hud-cloud-off/);
  assert.match(TravelBar._bar(), /fa-cloud-rain/);
  stored.weatherVisuals = false;
  const off = weatherButton(TravelBar._bar());
  assert.match(off, /aria-pressed="false"/);
  assert.match(off, /sde-hud-cloud-off/, "off: lit by its class");
  assert.match(off, /SDE\.clock\.weatherShow/, "off: its tooltip offers to show them");
  delete stored.weatherVisuals;
});

test("pressing it flips this device's setting, both ways", async () => {
  sets.length = 0;
  await click("weather");
  assert.deepEqual(sets, [["shadowdark-enhancer", "weatherVisuals", false]], "on to off");
  await click("weather");
  assert.deepEqual(sets.at(-1), ["shadowdark-enhancer", "weatherVisuals", true], "and back");
  delete stored.weatherVisuals;
});

test("the bar redraws when the setting changes, and for no other setting", () => {
  let renders = 0;
  TravelBar.render = () => { renders++; };
  TravelBar.mount = () => {};                                  // the bar's element is not under test
  TravelBar.init();
  assert.equal(typeof hooks.clientSettingChanged, "function");
  hooks.clientSettingChanged("shadowdark-enhancer.weatherVisuals", false, {});
  assert.equal(renders, 1);
  hooks.clientSettingChanged("shadowdark-enhancer.somethingElse", false, {});
  hooks.clientSettingChanged("core.rollMode", "gm", {});
  assert.equal(renders, 1, "other settings do not");
});
