import test from "node:test";
import assert from "node:assert/strict";
import { placeTiles } from "../scripts/town/town-view.mjs";
import { closeTown } from "../scripts/town/town-entry-points.mjs";

globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base } }, utils: { randomID: () => "x" } };
const { openPlace, nightParty } = await import("../scripts/town/town-live.mjs");

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
function world({ isGM, parties }) {
  globalThis.game = { user: { isGM }, actors: { contents: parties } };
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

test("a GM with no night open starts one on the first party", async () => {
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

test("closing the page closes the shop, the games table and the log with it", () => {
  const closed = [];
  const open = (id) => ({ close: () => closed.push(id) });
  globalThis.foundry = { applications: { instances: new Map(["sde-town", "sde-town-shop", "sde-town-games", "sde-town-log"].map((id) => [id, open(id)])) } };
  closeTown();
  assert.deepEqual(closed.sort(), ["sde-town", "sde-town-games", "sde-town-log", "sde-town-shop"]);
});
