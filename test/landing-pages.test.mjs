/**
 * Make a landing page and the toolbar's list: the page a click makes, the form's defaults, where Return goes, the
 * list's rows (pages and Western Reaches settlements), and the GM's go / return dispatch with a stubbed Foundry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PICTURES, PLAYER_MAP, madeLanding, madeSceneData, pageRows, pictureChoices, placesFor, readMakeForm, returnFor, settlementRows,
} from "../scripts/town/landing-pages-core.mjs";
import { landingOf } from "../scripts/town/town-core.mjs";

const MOD = "shadowdark-enhancer";
const sceneOf = (id, page, extra = {}) => ({ id, name: `Scene ${id}`, flags: { [MOD]: { ...(page ? { landing: page } : {}), ...extra } } });
const ALL = ["coin", "duel", "wheel", "cards", "bluff", "brag", "death", "roulette", "blackjack", "liars"];

test("a made page: Quests, Journals, Party and Map on, Downtime from a Town up, Carouse and Rumors off", () => {
  assert.deepEqual(placesFor("village"), ["quests", "journals", "party", "map"]);
  for (const size of ["town", "city", "city_state"]) assert.deepEqual(placesFor(size), ["quests", "journals", "party", "map", "downtime"]);
});

test("a made page has its name, size, games, one rolled merchant for its size, and is up", () => {
  const page = madeLanding({ name: "Low Ford", size: "town", games: ["coin", "liars"], merchantId: "m1", actorId: "a1", role: "Goods", tagline: "Town" });
  assert.equal(page.title, "Low Ford");
  assert.equal(page.size, "town");
  assert.equal(page.tagline, "Town");
  assert.equal(page.shown, true);
  assert.deepEqual(page.games.list, ["coin", "liars"]);
  assert.equal(page.merchants.length, 1);
  assert.deepEqual(page.merchants[0].stock, { kind: "outfitter", size: "town" });
  assert.equal(page.merchants[0].role, "Goods");
  assert.deepEqual(madeLanding({ name: "X", size: "village", games: [] }).merchants, []);
});

test("the form's defaults: Market, a Town, the first picture, and only the games ticked", () => {
  const pictures = pictureChoices(null);
  assert.deepEqual(readMakeForm({}, pictures, "Market"), { name: "Market", size: "town", src: PICTURES[0].src, games: [] });
  const asked = readMakeForm({ name: "  Bone Choir ", size: "city_state", picture: "tavern", "game.liars": "on", "game.coin": "on", "game.nope": "on" }, pictures, "Market");
  assert.deepEqual(asked, { name: "Bone Choir", size: "city_state", src: PICTURES[2].src, games: ["coin", "liars"] });
  assert.equal(readMakeForm({ size: "metropolis", picture: "nope" }, pictures, "Market").size, "town");
});

test("the player map is the first picture, and so the default, once the import made it", () => {
  assert.deepEqual(pictureChoices(null).map((p) => p.id), ["town", "market", "tavern"]);
  const withMap = pictureChoices("worlds/w/landing/player-map.webp");
  assert.equal(withMap[0].id, PLAYER_MAP);
  assert.equal(readMakeForm({}, withMap, "Market").src, "worlds/w/landing/player-map.webp");
});

test("the made scene: the picture at its own size, no grid, no token vision or fog, out of the navigation bar", () => {
  const data = madeSceneData({ name: "Low Ford", src: "a.webp", width: 2048, height: 1489, landing: { title: "Low Ford" }, folder: "f1", settlement: { num: 1403 } });
  assert.deepEqual([data.width, data.height, data.grid.type, data.tokenVision, data.fog.exploration, data.navigation, data.folder], [2048, 1489, 0, false, false, false, "f1"]);
  assert.equal(data.levels[0].background.src, "a.webp");
  assert.deepEqual(data.flags[MOD].landingSettlement, { num: 1403 });
  assert.equal(data.flags[MOD].landing.title, "Low Ford");
  assert.equal("landingSettlement" in madeSceneData({ name: "A", src: "a", width: 1, height: 1, landing: {} }).flags[MOD], false);
});

test("Return goes to the scene the table came from; from another page, to where that page returns", () => {
  const dungeon = sceneOf("D"), a = sceneOf("A", { title: "A", returnTo: "D" }), b = sceneOf("B", { title: "B", returnTo: "old" });
  assert.equal(returnFor(b, dungeon, landingOf), "D");
  assert.equal(returnFor(b, a, landingOf), "D");             // page to page keeps the way back to the adventure
  assert.equal(returnFor(b, b, landingOf), "old");           // already there: unchanged
  assert.equal(returnFor(b, null, landingOf), "old");
  assert.equal(returnFor(b, sceneOf("A", { title: "A" }), landingOf), null);
});

test("the list: every page A to Z, where the table is, hidden ones marked", () => {
  const rows = pageRows([sceneOf("2", { title: "Zed", size: "city", shown: false }), sceneOf("1", { title: "Ash" }), sceneOf("3")], "2", landingOf);
  assert.deepEqual(rows.map((r) => [r.sceneId, r.name, r.size, r.here, r.shown]), [["1", "Ash", null, false, true], ["2", "Zed", "city", true, false]]);
});

test("the settlements: settlement rows only, one per hex, biggest first then A to Z, with the page once made", () => {
  const keyed = [
    { num: "0412", name: "Low Ford", feature: "town" }, { num: "1403", name: "Bone Choir", feature: "city" },
    { num: "0101", name: "A Cave", feature: "keyed_location" }, { num: "0412", name: "Low Ford", feature: "town" },
    { num: "0900", name: "Alkesh", feature: "city_state" }, { num: "0200", name: "Ash", feature: "town" }, { num: "0300", name: "", feature: "village" },
  ];
  const rows = settlementRows(keyed, [sceneOf("s1", { title: "Low Ford" }, { landingSettlement: { num: 412 } })]);
  assert.deepEqual(rows.map((r) => [r.num, r.name, r.size, r.sceneId]), [[900, "Alkesh", "city_state", null], [1403, "Bone Choir", "city", null], [200, "Ash", "town", null], [412, "Low Ford", "town", "s1"]]);
  assert.deepEqual(settlementRows(undefined, []), []);
});

test("every game is ticked in the Make form's list", () => {
  assert.deepEqual(readMakeForm(Object.fromEntries(ALL.map((id) => [`game.${id}`, "on"])), pictureChoices(null), "M").games, ALL);
});

// ── the GM's dispatch, with a stubbed Foundry ────────────────────────────────────────────────────────────────────

function world({ active = "D" } = {}) {
  const scenes = new Map();
  const make = (id, page) => {
    const s = { id, name: `Scene ${id}`, flags: { [MOD]: page ? { landing: page } : {} }, get active() { return globalThis.game.scenes.active?.id === id; }, activated: 0,
      async activate() { this.activated++; globalThis.game.scenes.activeId = id; return this; },
      async update(data) { for (const [k, v] of Object.entries(data)) if (k === `flags.${MOD}`) Object.assign(this.flags[MOD], v); else if (k.startsWith(`flags.${MOD}.`)) this.flags[MOD][k.split(".").pop().replace(/^==/, "")] = v; return this; } };
    scenes.set(id, s);
    return s;
  };
  globalThis._replace = (v) => v;
  globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b }, instances: new Map() }, utils: { randomID: () => "rid", debounce: (f) => f, getRoute: (p) => p } };
  const warned = [];
  globalThis.ui = { notifications: { warn: (m) => warned.push(m), info() {}, error() {} } };
  globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
  globalThis.game = {
    user: { isGM: true }, i18n: { localize: (k) => k, format: (k) => k }, settings: { get: () => "" },
    scenes: { activeId: active, get active() { return scenes.get(this.activeId) ?? null; }, get: (id) => scenes.get(id), get contents() { return [...scenes.values()]; } },
  };
  return { make, warned };
}

test("Take everyone there: the page goes up, remembers the scene the table was on, and is activated", async () => {
  const { make } = world({ active: "D" });
  make("D");
  const page = make("P", { title: "Market", shown: false });
  const { goToPage } = await import("../scripts/town/landing-pages.mjs");
  await goToPage(page);
  assert.equal(page.activated, 1);
  assert.equal(landingOf(page).shown, true);
  assert.equal(landingOf(page).returnTo, "D");
  await goToPage(page);                                         // already there: no second activation, the way back kept
  assert.equal(page.activated, 1);
  assert.equal(landingOf(page).returnTo, "D");
});

test("Return takes everyone back to where they came from, and says so when it does not know", async () => {
  const { make, warned } = world({ active: "P" });
  const dungeon = make("D"), page = make("P", { title: "Market", returnTo: "D" }), lost = make("Q", { title: "Lost" });
  const { returnFromPage } = await import("../scripts/town/landing-pages.mjs");
  await returnFromPage(page);
  assert.equal(dungeon.activated, 1);
  assert.equal(await returnFromPage(lost), null);
  assert.equal(warned.length, 1);
  globalThis.game.user.isGM = false;
  assert.equal(await returnFromPage(page), null);               // only the GM moves the table
  assert.equal(dungeon.activated, 1);
});
