// Encounter battle maps, part D2: the clock bar's side of it, after the battle's controls moved to the Crawl Bar (#485).
// The clock bar keeps the battle's state (its view, readout, Keep tick and whether its panel is open) and runs its steps;
// what these tests pin is that it draws nothing of the battle itself, when it tells the Crawl Bar to redraw, and when
// the panel opens and folds across the bar's constant redraws. The bar's own clock half and the battle parts are
// fakes; the battle is invented.
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
const told = [];
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {} }, Hooks: { on() {}, once() {}, callAll(name) { told.push(name); } },
  ui: { notifications: { warn() {}, error() {} } }, canvas: { tokens: { placeables: [] }, grid }, game, document,
});
const { TravelBar } = await import("../scripts/overland/overland-bar.mjs");
const { battleItem } = await import("../scripts/overland/encounter-panel.mjs");

// The bar's clock half needs a calendar and the time API: not what is tested here.
Object.assign(TravelBar, {
  _bar: () => '<div class="sde-hud-bar">CLOCK</div>', _stacks: () => "", _stamp: () => "stamp",
  _seasonBand: () => "", _dial: () => "", _timePanel: () => '<div class="sde-hud-panel">TIME</div>',
  _now: () => ({ now: 0 }), _dialKey: () => "dial",
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
  continueTravel: async (battle) => { fake.calls.push(["continueTravel", battle]); return null; },
};
const staged = (over = {}) => ({ id: "b1", status: "staged", mapId: "forest-woods", sceneId: "S1", terrain: "forest", encounter: { name: "Wolf", count: 3 }, ...over });
const live = (over = {}) => staged({ status: "live", combatId: "c1", ...over });
const row = (name, state, pct = 0) => ({ userId: name, name, state, loaded: 1, total: 4, pct });
const snap = (...rows) => ({ rows, ready: rows.filter((r) => r.state === "ready").length, expected: rows.length, allReady: rows.length > 0 && rows.every((r) => r.state === "ready") });

/** A bar as it stands at the start of a test: nothing open, no battle, the viewed scene a battle map (no hex grid). */
function reset({ hex = false } = {}) {
  Object.assign(TravelBar, {
    _el: el, _parts: parts, _io: io, _view: null, _preload: null, _readout: "", _watch: null, _keep: false, _stage: null,
    _battleOpen: false, _battleDrawn: "", _acting: false, _open: null, _stack: null, _sceneKind: hex ? "hex" : "other",
  });
  Object.assign(fake, { record: null, snapshot: null, returns: [], returnAnswer: null, calls: [] });
  fake.listeners.clear();
  told.length = 0;
  grid.isHexagonal = hex;
  game.user.isGM = true;
  game.combats.get = () => undefined;
  document.activeElement = null;
  el.innerHTML = "";
  el.visible = null;
}
/** What the Crawl Bar would draw for the battle's panel now. */
const itemHtml = () => battleItem({ ...TravelBar.battleBar(), open: true });
const click = (action, data = {}) => TravelBar._onClick({ target: { closest: () => ({ dataset: { action, ...data }, matches: () => false }) } });
const tick = (checked) => TravelBar._onChange({ target: { dataset: { action: "keepBattle" }, checked } });

test("a staged battle opens its panel on its own scene, once: folded by the GM, it stays folded", () => {
  reset();
  fake.record = staged();
  fake.snapshot = snap(row("Ann", "loading", 0.25));
  TravelBar.render();
  assert.equal(TravelBar._battleOpen, true);
  assert.deepEqual(TravelBar.battleBar().open, true, "the Crawl Bar is handed the panel open");
  assert.ok(itemHtml().includes("Ann"), "the readout is in view there");
  TravelBar.battle("battle");
  assert.equal(TravelBar._battleOpen, false);
  TravelBar.render();
  TravelBar.render();
  assert.equal(TravelBar._battleOpen, false, "a redraw does not reopen what the GM folded");
});

test("when the table is brought the panel folds, and the GM can open it by hand", () => {
  reset();
  fake.record = staged();
  TravelBar.render();
  assert.equal(TravelBar._battleOpen, true);
  fake.record = live();
  TravelBar.render();
  assert.equal(TravelBar._battleOpen, false, "staged to live folds it");
  assert.equal(TravelBar.battleBar().battle.status, "live", "the item is still there");
  TravelBar.battle("battle");
  assert.equal(TravelBar._battleOpen, true);
  TravelBar.render();
  assert.equal(TravelBar._battleOpen, true, "and a redraw leaves it as they left it");
});

test("a battle first seen live, as after a reload in the middle of a fight, is left folded", () => {
  reset();
  fake.record = live();
  TravelBar.render();
  assert.equal(TravelBar._battleOpen, false);
  reset();
  fake.record = staged();
  TravelBar.render();
  assert.equal(TravelBar._battleOpen, true, "while one first seen staged is opened");
});

test("the battle's panel is its own: the clock's panels neither close it nor are closed by it", () => {
  reset({ hex: true });
  TravelBar._open = "time";
  fake.record = staged();
  TravelBar.render();
  assert.deepEqual([TravelBar._battleOpen, TravelBar._open], [true, "time"], "a battle staged leaves the Time panel open");
  assert.ok(el.innerHTML.includes("TIME") && el.innerHTML.includes("CLOCK"));
  fake.record = live();
  TravelBar.render();
  assert.deepEqual([TravelBar._battleOpen, TravelBar._open], [false, "time"], "going live folds the battle's panel and not the Time panel");
  assert.ok(el.innerHTML.includes("TIME"));
});

test("a change of scene keeps a staged battle's panel open and leaves a live battle's folded", () => {
  reset({ hex: true });
  fake.record = staged();
  TravelBar.render();
  grid.isHexagonal = false;
  TravelBar._onScene();
  assert.equal(TravelBar._battleOpen, true, "the readout stays in view on the battle's own scene");
  assert.equal(TravelBar._sceneKind, "other");
  reset({ hex: true });
  fake.record = live();
  TravelBar.render();
  TravelBar._battleOpen = true;
  grid.isHexagonal = false;
  TravelBar._onScene();
  assert.equal(TravelBar._battleOpen, false, "the panel does not sit over the table's combat");
  reset({ hex: true });
  TravelBar._open = "time";
  grid.isHexagonal = false;
  TravelBar._onScene();
  assert.equal(TravelBar._open, null, "no battle: a new kind of scene starts afresh, as it always did");
});

test("a battle that is gone closes its panel and unticks Keep, and the Crawl Bar has no item", () => {
  reset();
  fake.record = staged();
  TravelBar.render();
  tick(true);
  assert.equal(TravelBar._keep, true);
  TravelBar.render();
  assert.ok(itemHtml().includes('data-action="keepBattle" checked>'), "the tick survives the redraws");
  fake.record = null;
  TravelBar.render();
  assert.deepEqual([TravelBar._battleOpen, TravelBar._keep, TravelBar.battleBar()], [false, false, null]);
});

test("Return with Keep ticked: when the copy could not be made and nothing came down, the tick stays and the next Return keeps again", async () => {
  reset();
  fake.record = live();
  TravelBar.render();
  tick(true);
  fake.returnAnswer = null;   // B takes nothing down when a requested copy fails
  await click("returnToTravel");
  assert.equal(fake.returns.length, 1);
  assert.equal(fake.returns[0].keep, true);
  assert.equal(TravelBar._keep, true, "the battle is still there, so is the tick");
  assert.ok(itemHtml().includes('data-action="keepBattle" checked>'), "and the checkbox shows it");
  await click("returnToTravel");
  assert.deepEqual(fake.returns.map((r) => r.keep), [true, true], "pressed again, it still keeps: the battle is not discarded");
  // It works the third time: the battle goes, and so does the tick.
  fake.returnAnswer = { ok: true };
  const finished = click("returnToTravel");
  fake.record = null;
  await finished;
  assert.deepEqual([fake.returns.map((r) => r.keep), TravelBar._keep], [[true, true, true], false]);
  assert.deepEqual(fake.calls.filter(([name]) => name === "continueTravel"), [["continueTravel", { travelling: false }]], "the travel carried on once, when the battle came down, not on the returns that did not");
});

test("Return from a battle that was only set up leaves the held encounter alone; from a live one the travel carries on", async () => {
  reset();
  fake.record = staged();
  fake.returnAnswer = { ok: true };
  TravelBar.render();
  await click("returnToTravel");
  assert.equal(fake.returns.length, 1);
  assert.deepEqual(fake.calls, [], "staged: the encounter stays held, Continue is the GM's");
  reset();
  fake.record = live();
  fake.returnAnswer = { ok: true };
  TravelBar.render();
  await click("returnToTravel");
  assert.deepEqual(fake.calls, [["continueTravel", { travelling: false }]], "live: the fight is over and the clock goes on");
  reset();
  fake.record = live({ travelling: true });
  fake.returnAnswer = { ok: true };
  TravelBar.render();
  await click("returnToTravel");
  assert.deepEqual(fake.calls, [["continueTravel", { travelling: true }]], "a battle set up on the road says so, and the travel is put back");
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

test("the Crawl Bar's controls run the same steps: Return takes the tick it shows, Bring the table runs, the tick sets Keep", async () => {
  reset();
  fake.record = live();
  TravelBar.render();
  await TravelBar.battle("returnToTravel", { keep: true });
  assert.deepEqual(fake.returns.map((r) => r.keep), [true], "the checkbox as the Crawl Bar shows it");
  await TravelBar.battle("returnToTravel", {});
  assert.equal(fake.returns[1].keep, false, "with no checkbox to read it is the bar's own tick");
  TravelBar.battle("keepBattle", { keep: true });
  assert.equal(TravelBar._keep, true);
  await TravelBar.battle("returnToTravel", {});
  assert.equal(fake.returns[2].keep, true);
  await TravelBar.battle("bringTable");
  assert.deepEqual(fake.calls.filter(([name]) => name === "bringTable"), [["bringTable", "b1"]]);
  assert.equal(await TravelBar.battle("nonsense"), undefined, "an action it does not know is nothing");
});

test("a change in the preload readout redraws only where it shows, never under a GM typing the date, and only if it moved", () => {
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
      TravelBar._battleOpen = false;
      TravelBar._open = "time";
      progress();
      assert.equal(drawn, 0, "the Time panel is open: nothing to show, and the date field could lose its focus");
      TravelBar._battleOpen = true;
      document.activeElement = { id: "sde-hud-d-day" };
      progress();
      assert.equal(drawn, 0, "a date being typed is not interrupted");
      document.activeElement = null;
      progress();
      assert.equal(drawn, 1, "the battle's panel shows it");
      progress();
      assert.equal(drawn, 1, "the same readout again draws nothing");
      TravelBar._battleOpen = false;
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

test("a GM's battle never keeps the clock bar up or the strip pushed down: the top slot is the clock's alone (#485)", () => {
  reset();
  fake.record = staged();
  TravelBar.render();
  assert.deepEqual([el.visible, el.innerHTML, body.toggles.at(-1)[1]], [false, "", false], "its own scene, no hex grid");
  game.combat = { started: true };
  TravelBar.render();
  assert.deepEqual([el.visible, el.innerHTML], [false, ""], "the combat the table was brought into");
  game.combat = null;
  game.settings.get = (ns, key) => (key === "clockBar" ? "off" : undefined);
  grid.isHexagonal = true;
  TravelBar.render();
  assert.deepEqual([el.visible, el.innerHTML], [false, ""], "the clock bar turned off");
  assert.equal(TravelBar.battleBar().battle.status, "staged", "the Crawl Bar still has the battle");
  game.settings.get = (ns, key) => (key === "clockBar" ? "all" : undefined);
  TravelBar.render();
  assert.ok(el.visible && el.innerHTML.includes("CLOCK"), "on a hex map with the clock on, the clock");
  assert.ok(!el.innerHTML.includes("sde-hud-battle-panel") && !el.innerHTML.includes("swords"), "and nothing of the battle beside it");
  assert.equal(body.toggles.at(-1)[1], true, "the strip is held under the clock, as before");
  game.user.isGM = false;
  TravelBar.render();
  assert.equal(TravelBar.battleBar(), null, "a player is never handed a battle, however the GM's scene looks");
});

test("the Crawl Bar is told when what it draws for the battle changes, and not on every redraw", () => {
  reset({ hex: true });
  const calls = () => told.filter((name) => name.endsWith(".battleBarChanged")).length;
  TravelBar.render();
  assert.equal(calls(), 0, "no battle, nothing drawn, nothing to say");
  fake.record = staged();
  fake.snapshot = snap(row("Ann", "loading", 0.25));
  TravelBar.render();
  assert.equal(calls(), 1, "a battle appeared");
  TravelBar.render();
  TravelBar.render();
  assert.equal(calls(), 1, "a redraw of the same battle says nothing");
  fake.snapshot = snap(row("Ann", "loading", 0.75));
  TravelBar.render();
  assert.equal(calls(), 2, "the readout moved");
  TravelBar.battle("battle");
  assert.equal(calls(), 3, "the panel folded");
  tick(true);
  TravelBar.render();
  assert.equal(calls(), 4, "Keep was ticked");
  fake.record = null;
  TravelBar.render();
  assert.equal(calls(), 5, "the battle is gone");
  TravelBar.render();
  assert.equal(calls(), 5);
});

test("the battle's status line says the combat is over once its combat is gone, not that it waits to start", () => {
  reset();
  fake.record = live();
  game.combats.get = (id) => (id === "c1" ? { started: false, round: 0 } : undefined);
  TravelBar.render();
  assert.ok(itemHtml().includes("SDE.encounterMaps.hud.live{") && !itemHtml().includes("hud.liveEnded"), "made and waiting");
  game.combats.get = () => undefined;
  TravelBar.render();
  assert.ok(itemHtml().includes("SDE.encounterMaps.hud.liveEnded{"), "ended from the tracker or the crawl bar");
});

test("the readout's hold goes to the preload watch", () => {
  reset();
  const holds = [];
  TravelBar._watch = { hold: (on) => holds.push(on) };
  TravelBar.holdReadout();
  assert.deepEqual(holds, [true]);
});
