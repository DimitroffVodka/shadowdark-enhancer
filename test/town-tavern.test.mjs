import test from "node:test";
import assert from "node:assert/strict";
import { placeTiles } from "../scripts/town/town-view.mjs";
import { closeTown } from "../scripts/town/town-entry-points.mjs";

globalThis.foundry = { canvas: { placeables: { tokens: { TokenRuler: class {} } } }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base } }, utils: { randomID: () => "x" } };
const { openPlace, nightParty, redrawOnChange } = await import("../scripts/town/town-live.mjs");

// rumors.mjs pulls in the whole module graph; a catch-all foundry lets it load so the real openRumorsHeard runs.
const deep = () => new Proxy(class {}, { get: (t, k) => (k in t ? t[k] : k === "then" ? undefined : deep()) });
const stubbed = globalThis.foundry;
const wrap = (o) => new Proxy(o, { get: (t, k) => (k in t ? (t[k] && typeof t[k] === "object" ? wrap(t[k]) : t[k]) : deep()) });
globalThis.foundry = wrap(stubbed);
const { openRumorsHeard } = await import("../scripts/rumors/rumors.mjs");
globalThis.foundry = stubbed;

const t = (key) => key;
const base = { isGM: false, hasParty: true, downtimeOpen: false, activeQuests: 0, t };
const tile = (id, over) => placeTiles([id], { ...base, ...over })[0];

test("carouse tile: a GM always opens it; a player needs an open night and a GM online", () => {
  assert.equal(tile("carouse", { isGM: true }).disabled, false);
  assert.deepEqual([tile("carouse").disabled, tile("carouse").hint], [true, "SDE.town.hint.carouse"]);
  assert.equal(tile("carouse", { nightOpen: true }).disabled, false);
  assert.deepEqual([tile("carouse", { nightOpen: true, gmOnline: false }).disabled, tile("carouse", { nightOpen: true, gmOnline: false }).hint], [true, "SDE.town.hint.carouseGM"]);
});

test("rumors tile: a GM always runs it; a player needs the Rumors Heard journal", () => {
  assert.equal(tile("rumors", { isGM: true }).disabled, false);
  assert.deepEqual([tile("rumors").disabled, tile("rumors").hint], [true, "SDE.town.hint.rumors"]);
  assert.equal(tile("rumors", { rumorsHeard: true }).disabled, false);
  assert.equal(tile("rumors").icon, "fa-comments");
});

const party = (id, current) => ({ id, type: "NPC", flags: { "shadowdark-enhancer": { party: true, carousing: { history: [], current } } } });
const seenWarn = [];
function world({ isGM, parties }) {
  globalThis.game = { user: { isGM }, actors: { contents: parties }, i18n: { localize: (k) => k } };
  globalThis.ui = { notifications: { warn: (m) => seenWarn.push(m) } };
  const seen = [];
  const deps = {
    partyApp: async () => ({ open: (p, tab) => seen.push(["party", p.id, tab]) }),
    rumors: async () => ({ askAndGive: () => seen.push(["give"]), openRumorsHeard: () => { seen.push(["heard"]); return true; } }),
  };
  return { seen, deps };
}
const seeIt = { testUserPermission: () => true };

test("the carouse handler opens the Party sheet's carousing tab on the night's party", async () => {
  const night = { ...party("p2", { phase: "events" }), ...seeIt }, idle = { ...party("p1", null), ...seeIt };
  const { seen, deps } = world({ isGM: false, parties: [idle, night] });
  assert.equal(nightParty().id, "p2");
  await openPlace("carouse", null, deps);
  assert.deepEqual(seen, [["party", "p2", "carousing"]]);
});

test("a finished night is not open, and a player with no open night opens nothing", async () => {
  const { seen, deps } = world({ isGM: false, parties: [{ ...party("p1", { phase: "complete" }), ...seeIt }] });
  assert.equal(nightParty(), null);
  await openPlace("carouse", null, deps);
  assert.deepEqual(seen, []);
});

test("a player counts only the parties they can observe", async () => {
  const hidden = { ...party("p9", { phase: "events" }), testUserPermission: () => false };
  const { seen, deps } = world({ isGM: false, parties: [hidden] });
  assert.equal(nightParty(), null);
  await openPlace("carouse", null, deps);
  assert.deepEqual(seen, []);
});

test("a GM skips a selected legacy party and starts on a native one, and is told when there is none", async () => {
  const legacy = { id: "L", type: "NPC", flags: { "shadowdark-extras": { isParty: true } }, ...seeIt };
  const native = { ...party("p1", null), ...seeIt };
  let w = world({ isGM: true, parties: [legacy, native] });
  await openPlace("carouse", null, w.deps);
  assert.deepEqual(w.seen, [["party", "p1", "carousing"]]);
  seenWarn.length = 0;
  w = world({ isGM: true, parties: [legacy] });
  await openPlace("carouse", null, w.deps);
  assert.deepEqual([w.seen, seenWarn], [[], ["SDE.town.noParty"]]);
});

test("a GM with no night open gets the carousing tab of the first party", async () => {
  const { seen, deps } = world({ isGM: true, parties: [party("p1", null), party("p2", null)] });
  await openPlace("carouse", null, deps);
  assert.deepEqual(seen, [["party", "p1", "carousing"]]);
});

test("the rumors handler runs the flow for a GM and opens the journal for a player", async () => {
  let w = world({ isGM: true, parties: [] });
  await openPlace("rumors", null, w.deps);
  assert.deepEqual(w.seen, [["give"]]);
  w = world({ isGM: false, parties: [] });
  await openPlace("rumors", null, w.deps);
  assert.deepEqual(w.seen, [["heard"]]);
});

test("Rumors Heard: false and nothing opened without the journal, or when the user cannot see it; the sheet opens otherwise", () => {
  const opened = [];
  const entry = (over) => ({ getFlag: () => true, sheet: { render: () => opened.push("sheet") }, ...over });
  globalThis.game = { journal: [] };
  assert.equal(openRumorsHeard(), false);
  globalThis.game = { journal: [entry({ visible: false })] };
  assert.equal(openRumorsHeard(), false);
  assert.deepEqual(opened, []);
  globalThis.game = { journal: [entry({ visible: true })] };
  assert.equal(openRumorsHeard(), true);
  assert.deepEqual(opened, ["sheet"]);
});

test("an open window redraws when a user connects, and a closed one does not", async () => {
  const handlers = {};
  globalThis.Hooks = { on: (name, fn) => { handlers[name] = fn; return name; }, off: () => {} };
  globalThis.foundry.utils.debounce = (fn) => fn;
  let renders = 0;
  const app = { rendered: true, render: () => renders++ };
  const stop = redrawOnChange(app);
  handlers.userConnected();
  assert.equal(renders, 1);
  app.rendered = false;
  handlers.userConnected();
  assert.equal(renders, 1);
  stop();
});

test("closing the page closes the shop, the games table and the log with it", () => {
  const closed = [];
  const open = (id) => ({ close: () => closed.push(id) });
  globalThis.foundry = { applications: { instances: new Map(["sde-town", "sde-town-shop", "sde-town-games", "sde-town-log"].map((id) => [id, open(id)])) } };
  closeTown();
  assert.deepEqual(closed.sort(), ["sde-town", "sde-town-games", "sde-town-log", "sde-town-shop"]);
});
