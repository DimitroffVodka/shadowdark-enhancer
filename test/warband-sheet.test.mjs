// The Warband sheet's writes, one at a time (#283 review): quick ticks and a shared allowance.
import test from "node:test";
import assert from "node:assert/strict";
import { buildWarbandNpcSheet } from "../scripts/actors/warband-npc-sheet.mjs";

const TYPE = "shadowdark-enhancer.warband";
const MOD = "shadowdark-enhancer";
const later = () => new Promise((resolve) => setImmediate(resolve));
globalThis._replace = (value) => ({ __replace: value });
globalThis.ui = { notifications: { warn() {}, error() {} } };
const actors = [];
globalThis.game = { actors, i18n: { format: (k) => k, localize: (k) => k }, time: { worldTime: 0, calendar: null } };
const pc = { uuid: "Actor.pc", name: "Pc", type: "Player", system: { getClass: async () => ({ system: { hitPoints: "1d6" } }) } };
globalThis.fromUuid = async (uuid) => (uuid === pc.uuid ? pc : null);

function warband(id, flag) {
  const a = {
    id, type: TYPE, flags: { [MOD]: { warband: flag } },
    getFlag: (scope, key) => a.flags[scope]?.[key],
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
