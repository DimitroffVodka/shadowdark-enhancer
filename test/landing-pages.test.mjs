/**
 * The one landing page: the page and scene the module makes, a new settlement size, where Return goes, and the GM's
 * dispatch (the toolbar to the table and back, Take everyone there, Return) with a stubbed Foundry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { madeLanding, madeSceneData, placesFor, resized, returnFor, TABLE_FLAG } from "../scripts/town/landing-pages-core.mjs";
import { landingOf } from "../scripts/town/town-core.mjs";

const MOD = "shadowdark-enhancer";
const sceneOf = (id, page, extra = {}) => ({ id, name: `Scene ${id}`, flags: { [MOD]: { ...(page ? { landing: page } : {}), ...extra } } });
const ALL = ["coin", "duel", "wheel", "cards", "bluff", "brag", "death", "roulette", "blackjack", "liars"];

test("the table has Quests, Journals, Party, Map and Carouse on, Downtime from a Town up, Rumors off", () => {
  assert.deepEqual(placesFor("village"), ["quests", "journals", "party", "map", "carouse"]);
  for (const size of ["town", "city", "city_state"]) assert.deepEqual(placesFor(size), ["quests", "journals", "party", "map", "downtime", "carouse"]);
});

test("the table's page: its name and size, every game, one rolled merchant for its size, up", () => {
  const page = madeLanding({ name: "The Table", size: "city", merchantId: "m1", actorId: "a1", role: "Goods" });
  assert.deepEqual([page.title, page.size, page.shown, page.games.list], ["The Table", "city", true, ALL]);
  assert.deepEqual(page.merchants.map((m) => [m.id, m.actorId, m.role, m.stock]), [["m1", "a1", "Goods", { kind: "outfitter", size: "city" }]]);
  assert.deepEqual(madeLanding({ name: "X", size: "town" }).merchants, []);
});

test("the table's scene: the picture at its own size, no grid, no token vision or fog, out of the navigation bar, marked as the table", () => {
  const data = madeSceneData({ name: "The Table", src: "t.webp", width: 2560, height: 1440, landing: { title: "The Table" } });
  assert.deepEqual([data.width, data.height, data.grid.type, data.tokenVision, data.fog.exploration, data.navigation], [2560, 1440, 0, false, false, false]);
  assert.equal(data.levels[0].background.src, "t.webp");
  assert.equal(data.flags[MOD][TABLE_FLAG], true);
  assert.equal(data.flags[MOD].landing.title, "The Table");
});

test("a new settlement size rolls the market again for it; Downtime goes in a Village and comes back after", () => {
  const page = madeLanding({ name: "T", size: "town", merchantId: "m1", actorId: "a1" });
  const village = resized(page, "village");
  assert.equal(village.size, "village");
  assert.equal(village.places.includes("downtime"), false);
  assert.deepEqual([village.merchants[0].stock.size, village.merchants[0].rev], ["village", 1]);
  const city = resized(village, "city");
  assert.equal(city.places.includes("downtime"), true);
  assert.equal(city.merchants[0].rev, 2);
  assert.equal(resized(city, "city").merchants[0].rev, 2);
  const hand = resized({ ...page, merchants: [{ id: "m2", actorId: "a2" }] }, "city");
  assert.deepEqual([hand.merchants[0].rev, hand.merchants[0].stock], [0, null]);   // a hand-stocked NPC is left alone
});

test("Return goes to the scene the table came from; from another page, to where that page returns", () => {
  const dungeon = sceneOf("D"), a = sceneOf("A", { title: "A", returnTo: "D" }), b = sceneOf("B", { title: "B", returnTo: "old" });
  assert.equal(returnFor(b, dungeon, landingOf), "D");
  assert.equal(returnFor(b, a, landingOf), "D");
  assert.equal(returnFor(b, b, landingOf), "old");
  assert.equal(returnFor(b, null, landingOf), "old");
});

// ── the GM's dispatch, with a stubbed Foundry ────────────────────────────────────────────────────────────────────

function world({ active = "D", gm = true } = {}) {
  const scenes = new Map(), created = [];
  const make = (id, flags = {}) => {
    const s = {
      id, name: `Scene ${id}`, flags: { [MOD]: { ...flags } }, activated: 0,
      get active() { return globalThis.game.scenes.activeId === id; },
      async activate() { this.activated++; globalThis.game.scenes.activeId = id; return this; },
      getFlag(scope, key) { return this.flags[scope]?.[key]; },
      async update(data) { for (const [k, v] of Object.entries(data)) if (k.startsWith(`flags.${MOD}.`)) this.flags[MOD][k.split(".").pop().replace(/^==/, "")] = v; else if (k === `flags.${MOD}`) Object.assign(this.flags[MOD], v); return this; },
    };
    scenes.set(id, s);
    return s;
  };
  globalThis._replace = (v) => v;
  globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b }, instances: new Map() }, utils: { randomID: () => "rid", debounce: (f) => f, getRoute: (p) => p } };
  const warned = [];
  globalThis.ui = { notifications: { warn: (m) => warned.push(m), info() {}, error() {} } };
  globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
  globalThis.fromUuidSync = () => null;
  globalThis.Scene = { create: async (data) => { const s = make(`T${created.length}`, data.flags[MOD]); s.name = data.name; created.push(data); return s; } };
  globalThis.game = {
    user: { isGM: gm }, i18n: { localize: (k) => k, format: (k) => k }, settings: { get: () => ({}) },
    actors: { get: () => null }, packs: { get: () => null }, folders: { find: () => null },
    scenes: { activeId: active, get active() { return scenes.get(this.activeId) ?? null; }, get: (id) => scenes.get(id), find: (f) => [...scenes.values()].find(f), get contents() { return [...scenes.values()]; } },
  };
  return { make, warned, created, scenes };
}

test("the toolbar: the first press makes the table and takes everyone there; on the table it takes everyone back", async () => {
  const { make, created, warned } = world({ active: "D" });
  const dungeon = make("D");
  const lp = await import("../scripts/town/landing-pages.mjs");
  await lp.toggleTable();
  assert.equal(created.length, 1, "made once");
  const table = lp.tableScene();
  assert.ok(table);
  assert.equal(table.activated, 1);
  assert.equal(landingOf(table).returnTo, "D");
  assert.equal(landingOf(table).size, "town");                    // no hex says otherwise
  await lp.toggleTable();                                          // on the table: back
  assert.equal(dungeon.activated, 1);
  await lp.toggleTable();                                          // again: to the same table, not a second one
  assert.equal(created.length, 1);
  assert.equal(table.activated, 2);
  assert.deepEqual(warned, ["SDE.town.editor.generateEmpty"], "no gear packs in this world: the table is made without a shop, and says so");
});

test("Return says so when it does not know where the table came from, and only the GM moves the table", async () => {
  const { make, warned } = world({ active: "P" });
  const dungeon = make("D"), page = make("P", { landing: { title: "T", returnTo: "D" } }), lost = make("Q", { landing: { title: "L" } });
  const { returnFromPage, toggleTable } = await import("../scripts/town/landing-pages.mjs");
  assert.equal(await returnFromPage(lost), null);
  assert.equal(warned.length, 1);
  globalThis.game.user.isGM = false;
  assert.equal(await returnFromPage(page), null);
  assert.equal(await toggleTable(), null);
  assert.equal(dungeon.activated, 0);
});
