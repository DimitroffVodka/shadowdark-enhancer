// The Crawl Bar's side of the battle's item (#485): it draws one item for a GM's running battle in every mode, in the
// combat row too, and nothing when there is none. The clock bar, which holds the battle's state, is a fake here.
import test from "node:test";
import assert from "node:assert/strict";

// crawl-bar.mjs pulls in crawl-state.mjs and the overland bar, which touch Foundry classes at load.
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const game = {
  user: { isGM: true, id: "gm1" },
  i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` },
  settings: { get: () => undefined },
  time: { worldTime: 0, calendar: {} },
  combat: null, combats: { get: () => undefined }, scenes: { get: () => undefined, active: null }, actors: [],
};
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {} }, Hooks: { on() {}, once() {}, callAll() {} }, ui: { notifications: { warn() {}, error() {} } },
  canvas: { tokens: { placeables: [] }, grid: { isHexagonal: false } }, game, document: { body: { classList: { toggle() {} } }, getElementById: () => null, addEventListener() {}, removeEventListener() {} },
});
const { CrawlBar } = await import("../scripts/crawl-bar/crawl-bar.mjs");
const { TravelBar } = await import("../scripts/overland/overland-bar.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");

const el = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
const battle = (over = {}) => ({ battle: { id: "b1", status: "staged", sceneId: "S1", label: "Forest Woods", combat: null, ...over }, preload: null, keep: false, open: false });
const mode = (name) => Object.defineProperty(CrawlState, "mode", { get: () => name, configurable: true });
const draw = (view, m = "off") => {
  CrawlBar._el = el;
  mode(m);
  TravelBar.battleBar = () => view;
  CrawlBar.render();
  return el.innerHTML;
};

test("the battle's item is on the bar in every mode, before Tools, and not when there is no battle", () => {
  for (const m of ["off", "crawl", "overland"]) {
    const html = draw(battle(), m);
    assert.ok(html.includes('data-action="battle"') && html.includes("SDE.encounterMaps.hud.status.staged"), `${m}: the item`);
    assert.ok(html.indexOf('data-action="battle"') < html.indexOf('data-action="tools"'), `${m}: right before Tools`);
    assert.ok(!draw(null, m).includes('data-action="battle"'), `${m}: no battle, no item`);
  }
});

test("the brought combat's row carries the item too, with its panel when it is open", () => {
  const folded = draw(battle({ status: "live" }), "combat");
  assert.ok(folded.includes('data-action="endEncounter"') || folded.includes('data-action="beginEncounter"'), "the combat row");
  assert.ok(folded.includes('data-action="battle"') && folded.includes("SDE.encounterMaps.hud.status.live"));
  assert.ok(!folded.includes("sde-hud-battle-panel"));
  const open = draw({ ...battle({ status: "live" }), open: true }, "combat");
  assert.ok(open.includes("sde-bar-battle-menu") && open.includes('data-action="returnToTravel"'));
  assert.ok(!draw(null, "combat").includes('data-action="battle"'));
});

test("Start Combat is refused with a zone fight running, and unchanged without one", async () => {
  const warns = [];
  const created = [];
  globalThis.ui.notifications.warn = (m) => warns.push(m);
  globalThis.Combat = { create: async (d) => { created.push(d); return { active: true, combatants: [] }; } };
  globalThis.TokenDocument = { implementation: { createCombatants: async () => { created.push("enrol"); } } };
  globalThis.canvas.scene = { id: "S1", tokens: [{ id: "t1", actor: { type: "Player" } }] };
  CrawlBar.render = () => {};
  game.combats = [{ scene: null, flags: { "shadowdark-enhancer": { zoneFight: { id: "z" } } }, combatants: [] }];
  game.combat = game.combats[0];
  await CrawlBar._startCombat();
  assert.deepEqual(created, [], "nothing created or enrolled");
  assert.deepEqual(warns, ["SDE.stage.zone.crawlRefused"]);
  game.combats = []; game.combat = null; warns.length = 0;
  await CrawlBar._startCombat();
  assert.equal(created.length, 2, "the old path creates the combat and enrols");
  assert.deepEqual(warns, []);
});

test("Add Selected Tokens is refused with a zone fight running, and enrols without one", async () => {
  const warns = [], created = [];
  globalThis.ui.notifications.warn = (m) => warns.push(m);
  globalThis.ui.notifications.info = () => {};
  globalThis.TokenDocument = { implementation: { createCombatants: async (d) => { created.push(d.length); } } };
  globalThis.canvas.tokens.controlled = [{ document: { id: "t9" } }];
  mode("combat");
  CrawlBar.render = () => {};
  game.combats = [{ scene: null, flags: { "shadowdark-enhancer": { zoneFight: { id: "z" } } }, combatants: [] }];
  game.combat = game.combats[0];
  await CrawlBar._addSelectedTokens();
  assert.deepEqual(created, [], "nothing enrolled");
  assert.deepEqual(warns, ["SDE.stage.zone.crawlRefused"]);
  game.combats = []; game.combat = { combatants: [] }; warns.length = 0;
  await CrawlBar._addSelectedTokens();
  assert.deepEqual(created, [1]);
  assert.deepEqual(warns, []);
});
