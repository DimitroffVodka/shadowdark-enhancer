// The Warband sheet's writes go to one writer, the active GM, one at a time (#283 reviews).
import test from "node:test";
import assert from "node:assert/strict";
import { buildWarbandNpcSheet, registerWarbandWrites, WARBAND_QUERY } from "../scripts/actors/warband-npc-sheet.mjs";

const TYPE = "shadowdark-enhancer.warband";
const MOD = "shadowdark-enhancer";
const later = () => new Promise((resolve) => setImmediate(resolve));
globalThis._replace = (value) => ({ __replace: value });
globalThis.ui = { notifications: { warn() {}, error() {} } };
globalThis.CONFIG = { queries: {} };
const actors = [];
actors.get = (id) => actors.find((a) => a.id === id);
const activeGM = { id: "gm", isGM: true };
globalThis.game = {
  actors, user: { ...activeGM, hasPermission: () => true }, users: { activeGM },
  i18n: { format: (k) => k, localize: (k) => k },
};
const pc = { uuid: "Actor.pc", name: "Pc", type: "Player", system: { getClass: async () => ({ system: { hitPoints: "1d6" } }) } };
globalThis.fromUuid = async (uuid) => (uuid === pc.uuid ? pc : null);
registerWarbandWrites(TYPE);

function warband(id, flag) {
  const a = {
    id, type: TYPE, flags: { [MOD]: { warband: flag } },
    getFlag: (scope, key) => a.flags[scope]?.[key],
    testUserPermission: () => true,
    // The write lands a moment later, as a real update does.
    update: async (data) => { await later(); for (const [k, v] of Object.entries(data)) a.flags[MOD][k.split(".").pop()] = v.__replace; },
  };
  actors.push(a);
  return a;
}
const Sheet = buildWarbandNpcSheet(class { activateListeners() {} }, TYPE);
const sheetOf = (actor) => Object.defineProperty(Object.create(Sheet.prototype), "actor", { value: actor });

test("two quick ticks on one warband both stay", async () => {
  actors.length = 0;
  const a = warband("a", { commander: null, upgrades: [] });
  const sheet = sheetOf(a);
  assert.deepEqual(await Promise.all([sheet._toggleUpgrade("fast", true), sheet._toggleUpgrade("tough", true)]), [true, true]);
  assert.deepEqual(a.flags[MOD].warband.upgrades, ["fast", "tough"]);
});

test("two warbands can't both take a commander's last upgrade slot", async () => {
  actors.length = 0;
  // A d6 commander has 3 upgrades in all: 2 are taken, so one slot is left.
  const a = warband("a", { commander: pc.uuid, upgrades: ["fast"] });
  const b = warband("b", { commander: pc.uuid, upgrades: ["tough"] });
  const replies = await Promise.all([sheetOf(a)._toggleUpgrade("scout", true), sheetOf(b)._toggleUpgrade("hardy", true)]);
  assert.deepEqual(replies, [true, false]);
  assert.equal(a.flags[MOD].warband.upgrades.length + b.flags[MOD].warband.upgrades.length, 3);
});

test("two GMs on other clients, at once: both go to the active GM's writer, and the cap holds (#283 review)", async () => {
  actors.length = 0;
  const a = warband("a", { commander: pc.uuid, upgrades: ["fast"] });
  const b = warband("b", { commander: pc.uuid, upgrades: ["tough"] });
  const sent = [];
  // This client is a GM but not the active one: its sheets write nothing themselves.
  globalThis.game.user = { id: "gm2", isGM: true, hasPermission: () => true };
  globalThis.game.users.activeGM = { id: "gm", query: (name, data) => { sent.push(name); return globalThis.CONFIG.queries[name](data, { user: { id: "gm3", isGM: true } }); } };
  try {
    const replies = await Promise.all([sheetOf(a)._toggleUpgrade("scout", true), sheetOf(b)._toggleUpgrade("hardy", true)]);
    assert.deepEqual(sent, [WARBAND_QUERY, WARBAND_QUERY], "both sent to the active GM");
    assert.deepEqual(replies.sort(), [false, true]);
    assert.equal(a.flags[MOD].warband.upgrades.length + b.flags[MOD].warband.upgrades.length, 3);
  } finally {
    globalThis.game.user = { ...activeGM, hasPermission: () => true };
    globalThis.game.users.activeGM = activeGM;
  }
});
