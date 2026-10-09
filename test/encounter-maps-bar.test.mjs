// Encounter battle maps, part D2: the clock HUD's side of it. When the bar shows for a battle, when its panel opens and
// folds, and what the Keep tick and the preload readout do across the bar's constant redraws. The bar's own clock half
// and the battle parts are fakes; the battle is invented.
import test from "node:test";
import assert from "node:assert/strict";

// overland-bar.mjs pulls in crawl-state.mjs and the vehicle sheets, which touch Foundry classes at load.
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const game = {
  user: { isGM: true, id: "gm1" },
  i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` },
  settings: { get: (ns, key) => (key === "clockBar" ? "all" : undefined) },
  time: { worldTime: 0, calendar: {} },
  combat: null,
  combats: { get: () => undefined },
  scenes: { get: () => undefined },
};
const grid = { isHexagonal: false };
const body = { toggles: [], classList: { toggle(name, on) { body.toggles.push([name, on]); } } };
const document = { body, activeElement: null, getElementById: () => null };
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {} }, Hooks: { on() {}, once() {}, callAll() {} }, ui: { notifications: { warn() {}, error() {} } },
  canvas: { tokens: { placeables: [] }, grid }, game, document,
});
const { TravelBar } = await import("../scripts/overland/overland-bar.mjs");

// The bar's clock half needs a calendar and the time API: not what is tested here.
Object.assign(TravelBar, {
  _bar: () => '<div class="sde-hud-bar">CLOCK</div>', _stacks: () => "", _stamp: () => "stamp",
  _seasonBand: () => "", _dial: () => "", _timePanel: () => '<div class="sde-hud-panel">TIME</div>',
});
const el = { innerHTML: "", visible: null, classList: { toggle(name, on) { el.visible = on; } }, contains: () => true, querySelector: () => null };

/** The battle parts, faked: a record the test changes, a readout it changes, and the calls the bar made. */
const fake = { record: null, snapshot: null, listeners: new Set(), returns: [], returnAnswer: null, calls: [] };
const parts = {
  BattleMaps: { current: () => fake.record },
  getEncounterMap: (id) => ({ labelKey: `map.${id}` }),
  preloadSnapshot: () => fake.snapshot,
  onPreloadChange: (fn) => { fake.listeners.add(fn); return () => { fake.listeners.delete(fn); }; },
};
const io = {
  battle: async () => ({
    returnToTravel: async (id, opts) => { fake.returns.push({ id, ...opts }); return fake.returnAnswer; },
    bringTable: async (id) => { fake.calls.push(["bringTable", id]); return { ok: true }; },
  }),
};
const staged = (over = {}) => ({ id: "b1", status: "staged", mapId: "forest-woods", sceneId: "S1", terrain: "forest", encounter: { name: "Wolf", count: 3 }, ...over });
const live = (over = {}) => staged({ status: "live", combatId: "c1", ...over });
const row = (name, state, pct = 0) => ({ userId: name, name, state, loaded: 1, total: 4, pct });
const snap = (...rows) => ({ rows, ready: rows.filter((r) => r.state === "ready").length, expected: rows.length, allReady: rows.length > 0 && rows.every((r) => r.state === "ready") });

/** A bar as it stands at the start of a test: nothing open, no battle, the viewed scene a battle map (no hex grid). */
function reset({ hex = false } = {}) {
  Object.assign(TravelBar, {
    _el: el, _parts: parts, _io: io, _view: null, _preload: null, _readout: "", _watch: null, _keep: false, _stage: null,
    _clock: true, _acting: false, _open: null, _stack: null, _sceneKind: hex ? "hex" : "other",
  });
  Object.assign(fake, { record: null, snapshot: null, returns: [], returnAnswer: null, calls: [] });
  fake.listeners.clear();
  grid.isHexagonal = hex;
  game.user.isGM = true;
  game.combats.get = () => undefined;
  document.activeElement = null;
  el.innerHTML = "";
  el.visible = null;
}
const panelShown = () => el.innerHTML.includes("sde-hud-battle-panel");
const click = (action, data = {}) => TravelBar._onClick({ target: { closest: () => ({ dataset: { action, ...data }, matches: () => false }) } });
const tick = (checked) => TravelBar._onChange({ target: { dataset: { action: "keepBattle" }, checked } });

test("a staged battle opens its panel on its own scene, once: folded by the GM, it stays folded", async () => {
  reset();
  fake.record = staged();
  fake.snapshot = snap(row("Ann", "loading", 0.25));
  TravelBar.render();
  assert.equal(el.visible, true, "the bar stays for the battle, though the scene has no hex grid");
  assert.ok(!el.innerHTML.includes("CLOCK"), "only the battle's, not the clock");
  assert.equal(TravelBar._open, "battle");
  assert.ok(panelShown() && el.innerHTML.includes("Ann"), "the readout is in view");
  await click("open", { id: "battle" });
  assert.equal(TravelBar._open, null);
  assert.ok(!panelShown() && el.innerHTML.includes("sde-hud-bar"), "folded: the slim bar stays");
  TravelBar.render();
  TravelBar.render();
  assert.equal(TravelBar._open, null, "a redraw does not reopen what the GM folded");
});

test("when the table is brought the panel folds, so the combat's cards under the bar are not covered", async () => {
  reset();
  fake.record = staged();
  TravelBar.render();
  assert.equal(TravelBar._open, "battle");
  fake.record = live();
  TravelBar.render();
  assert.equal(TravelBar._open, null, "staged to live folds it");
  assert.ok(!panelShown(), "no panel over the Crawl Strip");
  assert.ok(el.innerHTML.includes("sde-hud-bar") && el.visible === true, "the slim battle bar is still there");
  await click("open", { id: "battle" });
  assert.ok(panelShown(), "the GM can open it by hand");
  TravelBar.render();
  assert.ok(panelShown(), "and a redraw leaves it as they left it");
});

test("a battle first seen live, as after a reload in the middle of a fight, is left folded", () => {
  reset();
  fake.record = live();
  TravelBar.render();
  assert.equal(TravelBar._open, null);
  assert.ok(!panelShown() && el.visible === true);
  reset();
  fake.record = staged();
  TravelBar.render();
  assert.equal(TravelBar._open, "battle", "while one first seen staged is opened");
});

test("going live folds the battle's panel and no other: a panel the GM opened themselves stays", () => {
  reset({ hex: true });
  fake.record = staged();
  TravelBar.render();
  assert.equal(TravelBar._open, "battle");
  assert.ok(el.innerHTML.includes("CLOCK"), "on a hex map the clock is there too");
  TravelBar._open = "time";
  fake.record = live();
  TravelBar.render();
  assert.equal(TravelBar._open, "time");
  assert.ok(el.innerHTML.includes("TIME"));
});

test("a change of scene keeps a staged battle's panel open and leaves a live battle's folded", () => {
  reset({ hex: true });
  fake.record = staged();
  TravelBar.render();
  grid.isHexagonal = false;
  TravelBar._onScene();
  assert.equal(TravelBar._open, "battle", "the readout stays in view on the battle's own scene");
  assert.equal(TravelBar._sceneKind, "other");
  reset({ hex: true });
  fake.record = live();
  TravelBar.render();
  TravelBar._open = "battle";
  grid.isHexagonal = false;
  TravelBar._onScene();
  assert.equal(TravelBar._open, null, "the table's combat cards are not covered");
  reset({ hex: true });
  TravelBar._open = "time";
  grid.isHexagonal = false;
  TravelBar._onScene();
  assert.equal(TravelBar._open, null, "no battle: a new kind of scene starts afresh, as it always did");
});

test("a battle that is gone closes its panel and unticks Keep; the bar goes with it where the clock is hidden", async () => {
  reset();
  fake.record = staged();
  TravelBar.render();
  tick(true);
  assert.equal(TravelBar._keep, true);
  TravelBar.render();
  assert.ok(el.innerHTML.includes('data-action="keepBattle" checked>'), "the tick survives the bar's redraws");
  fake.record = null;
  TravelBar.render();
  assert.deepEqual([TravelBar._open, TravelBar._keep, el.visible, el.innerHTML], [null, false, false, ""]);
});

test("Return with Keep ticked: when the copy could not be made and nothing came down, the tick stays and the next Return keeps again", async () => {
  reset();
  fake.record = live();
  TravelBar.render();
  await click("open", { id: "battle" });   // a live battle's panel is folded until the GM opens it
  tick(true);
  fake.returnAnswer = null;   // B takes nothing down when a requested copy fails
  await click("returnToTravel");
  assert.equal(fake.returns.length, 1);
  assert.equal(fake.returns[0].keep, true);
  assert.equal(TravelBar._keep, true, "the battle is still there, so is the tick");
  assert.ok(el.innerHTML.includes('data-action="keepBattle" checked>'), "and the checkbox shows it");
  await click("returnToTravel");
  assert.deepEqual(fake.returns.map((r) => r.keep), [true, true], "pressed again, it still keeps: the battle is not discarded");
  // It works the third time: the battle goes, and so does the tick.
  fake.returnAnswer = { ok: true };
  const finished = click("returnToTravel");
  fake.record = null;
  await finished;
  assert.deepEqual([fake.returns.map((r) => r.keep), TravelBar._keep], [[true, true, true], false]);
});

test("Return without Keep does not ask for a copy, and one battle step runs at a time", async () => {
  reset();
  fake.record = live();
  TravelBar.render();
  await click("returnToTravel");
  assert.equal(fake.returns[0].keep, false);
  let release;
  fake.returnAnswer = new Promise((resolve) => { release = resolve; });
  const first = click("returnToTravel");
  await new Promise((resolve) => setImmediate(resolve));
  await click("returnToTravel");
  assert.equal(fake.returns.length, 2, "a second click while one runs is ignored");
  release({ ok: true });
  await first;
});

test("a change in the preload readout redraws only where it shows, never under a GM typing the date, and only if it moved", async () => {
  reset({ hex: true });
  const timers = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  try {
    fake.record = staged();
    fake.snapshot = snap(row("Ann", "loading", 0.25));
    TravelBar.render();
    TravelBar._listen();
    TravelBar.render();   // listens now: one battle staged
    assert.equal(fake.listeners.size, 1);
    const progress = () => { [...fake.listeners][0](); timers.splice(0).forEach((fn) => fn()); };
    let drawn = 0;
    const render = TravelBar.render;
    TravelBar.render = function counted() { drawn++; return render.call(this); };
    try {
      fake.snapshot = snap(row("Ann", "loading", 0.75));
      TravelBar._open = "time";
      progress();
      assert.equal(drawn, 0, "the Time panel is open: nothing to show, and the date field could lose its focus");
      TravelBar._open = "battle";
      document.activeElement = { id: "sde-hud-when" };
      progress();
      assert.equal(drawn, 0, "a date being typed is not interrupted");
      document.activeElement = null;
      progress();
      assert.equal(drawn, 1, "the battle's panel shows it");
      progress();
      assert.equal(drawn, 1, "the same readout again draws nothing");
      TravelBar._open = "encounter";
      fake.snapshot = snap(row("Ann", "ready", 1));
      progress();
      assert.equal(drawn, 2, "the Encounter panel carries the readout too");
      TravelBar._open = null;
      fake.snapshot = snap(row("Ann", "failed", 1));
      progress();
      assert.equal(drawn, 2, "folded: nothing on the screen to update");
    } finally {
      TravelBar.render = render;
    }
  } finally {
    globalThis.setTimeout = real;
  }
});

test("the bar shows for a GM's battle on any scene, in a combat, and with the clock bar off, and never for a player", () => {
  reset();
  fake.record = staged();
  TravelBar.render();
  assert.equal(el.visible, true, "no hex grid");
  assert.ok(body.toggles.at(-1)[1], "and the Crawl Strip is pushed down under it, as under the clock");
  game.settings.get = (ns, key) => (key === "clockBar" ? "off" : undefined);
  TravelBar.render();
  assert.equal(el.visible, true, "the clock bar set off");
  game.settings.get = (ns, key) => (key === "clockBar" ? "all" : undefined);
  game.user.isGM = false;
  TravelBar.render();
  assert.deepEqual([el.visible, el.innerHTML], [false, ""], "a player is not shown the battle, however the GM's scene looks");
  game.user.isGM = true;
  reset({ hex: true });
  TravelBar.render();
  assert.ok(el.innerHTML.includes("CLOCK") && !panelShown(), "with no battle it is the clock, as before");
});

test("the battle's status line says the combat is over once its combat is gone, not that it waits to start", () => {
  reset();
  fake.record = live();
  game.combats.get = (id) => (id === "c1" ? { started: false, round: 0 } : undefined);
  TravelBar._open = "battle";
  TravelBar._stage = "live";
  TravelBar.render();
  assert.ok(el.innerHTML.includes("SDE.encounterMaps.hud.live{") && !el.innerHTML.includes("hud.liveEnded"), "made and waiting");
  game.combats.get = () => undefined;
  TravelBar.render();
  assert.ok(el.innerHTML.includes("SDE.encounterMaps.hud.liveEnded{"), "ended from the tracker or the crawl bar");
});
