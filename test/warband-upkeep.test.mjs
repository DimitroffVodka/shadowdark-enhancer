// Warband upkeep on the clock (#284 review): a failed charge tried again without charging twice,
// healing up to a desertion, and the sheet's writes and the upkeep on one queue.
import test from "node:test";
import assert from "node:assert/strict";
import { gregorian } from "./gregorian-calendar.mjs";

const TYPE = "shadowdark-enhancer.warband";
const MOD = "shadowdark-enhancer";
const later = () => new Promise((resolve) => setImmediate(resolve));
const hooks = new Map();
const settings = new Map();
const chat = [];
const rolls = [];          // totals the next Rolls give, in order; 1 when none are queued
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), once() {}, callAll() {} };
globalThis._replace = (value) => ({ __replace: value });
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.CONFIG = { queries: {} };
globalThis.foundry = { data: { fields: { NumberField: class {} } }, utils: { deepClone: (v) => structuredClone(v) } };
globalThis.ChatMessage = { create: async (m) => { chat.push(m); }, getWhisperRecipients: () => [], getSpeaker: () => ({}) };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() { this.total = rolls.length ? rolls.shift() : 1; return this; }
  async toMessage() {}
};
const actors = [];
actors.get = (id) => actors.find((a) => a.id === id);
const gm = { id: "gm", isGM: true, hasPermission: () => true };
globalThis.game = {
  actors, user: gm, users: { activeGM: gm }, i18n: { format: (k) => k, localize: (k) => k, lang: "en" },
  time: { worldTime: 0, calendar: gregorian },
  settings: { register: (_m, key, cfg) => settings.set(key, cfg.default ?? null), get: (_m, key) => settings.get(key) ?? null, set: async (_m, key, v) => { settings.set(key, v); } },
};
const pcs = new Map();
globalThis.fromUuid = async (uuid) => pcs.get(uuid) ?? null;

const { registerWarbandUpkeep, PENDING_MONTH_SETTING } = await import("../scripts/actors/warband-upkeep.mjs");
const { buildWarbandNpcSheet, registerWarbandWrites } = await import("../scripts/actors/warband-npc-sheet.mjs");
const core = await import("../scripts/actors/warband-core.mjs");
registerWarbandWrites(TYPE);
registerWarbandUpkeep(TYPE);
const tick = hooks.get(`${MOD}.timeAdvanced`);

const at = (day) => gregorian.componentsToTime({ year: 1301, day });   // day of the year, from 0
function pc(id, gp, { rejectOnce = false, cha = 0, hitDie = "1d6" } = {}) {
  const p = { uuid: `Actor.${id}`, name: id, type: "Player", pack: null, rejectOnce,
    system: { coins: { gp, sp: 0, cp: 0 }, abilities: { cha: { mod: cha } }, getClass: async () => ({ system: { hitPoints: hitDie } }) },
    update: async (data) => {
      await later();
      if (p.rejectOnce) { p.rejectOnce = false; throw new Error("purse write failed"); }
      p.system.coins = { gp: data["system.coins.gp"], sp: data["system.coins.sp"], cp: data["system.coins.cp"] };
    } };
  pcs.set(p.uuid, p);
  return p;
}
function warband(id, flag, { level = 3, hp = [30, 30] } = {}) {
  const a = {
    id, type: TYPE, name: id, flags: { [MOD]: { warband: flag } },
    system: { level: { value: level }, attributes: { hp: { value: hp[0], max: hp[1] } } },
    getFlag: (scope, key) => a.flags[scope]?.[key],
    testUserPermission: () => true,
    update: async (data) => {
      await later();
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith("flags.")) a.flags[MOD][k.split(".").pop()] = v.__replace;
        else if (k === "system.attributes.hp.value") a.system.attributes.hp = { ...a.system.attributes.hp, value: v };
      }
    },
  };
  actors.push(a);
  return a;
}
const settle = async () => { for (let i = 0; i < 40; i++) await later(); };
const reset = () => { actors.length = 0; pcs.clear(); chat.length = 0; rolls.length = 0; for (const k of settings.keys()) settings.set(k, null); };

test("a charge whose purse write fails is tried at the next move; the one that paid isn't charged twice", async () => {
  reset();
  const a = pc("A", 100, { rejectOnce: true });
  const b = pc("B", 100);
  const wa = warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
  warband("wb", { commander: b.uuid, upgrades: [] }, { level: 2 });
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });   // over Feb 1
  await settle();
  assert.deepEqual([a.system.coins.gp, b.system.coins.gp], [100, 80], "A's write failed; B paid 20");
  assert.notEqual(settings.get(PENDING_MONTH_SETTING), null, "the month is left pending");
  tick({ from: at(31) + 3600, to: at(32) + 3600, crossed: { days: 1 } });
  await settle();
  assert.deepEqual([a.system.coins.gp, b.system.coins.gp], [70, 80], "A charged now, B not again");
  assert.equal(settings.get(PENDING_MONTH_SETTING), null);
  assert.equal(wa.flags[MOD].warband.settledMonth, core.monthKey(gregorian.timeToComponents(at(31)), 12));
});

test("a move heals the days before a warband deserts at a week start, and none after", async () => {
  reset();
  const cmd = pc("C", 0);
  const wb = warband("wb", { commander: cmd.uuid, upgrades: [], arrears: 30, settledMonth: 99999 }, { level: 3, hp: [1, 100] });
  // A week start mid-month, found the way the upkeep finds it; the move starts a day and a half before it.
  const { events } = core.clockEvents({
    from: at(40), to: at(50), secondsPerDay: 86400, week: 7, offset: 0,
    monthOf: (t) => core.monthKey(gregorian.timeToComponents(t), 12), lastMonth: 99999, lastWeek: null, maxDays: 366,
  });
  const weekStart = events.find((e) => e.week).at;
  settings.set("warbandLastMonth", 99999);
  rolls.push(3, 1);            // the day before: heal 3; then the morale roll: 1, a failure
  tick({ from: weekStart - 86400 - 43200, to: weekStart + 86400 + 43200, crossed: { days: 3 } });
  await settle();
  assert.equal(wb.flags[MOD].warband.deserted, true);
  assert.equal(wb.system.attributes.hp.value, 4, "healed for the day before it deserted, and no more");
});

test("a sheet tick held mid-check and the upkeep run in turn: neither loses the other's write", async () => {
  reset();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const cmd = pc("D", 0);
  cmd.system.getClass = async () => { await held; return { system: { hitPoints: "1d6" } }; };
  const wb = warband("wb", { commander: cmd.uuid, upgrades: [] }, { level: 3 });
  const Sheet = buildWarbandNpcSheet(class { activateListeners() {} }, TYPE);
  const sheet = Object.defineProperty(Object.create(Sheet.prototype), "actor", { value: wb });
  const ticked = sheet._toggleUpgrade("hardy", true);          // reads the flag, then waits on the class
  tick({ from: at(58) + 3600, to: at(59) + 3600, crossed: { days: 1 } });   // over Mar 1, an empty purse
  await settle();
  release();
  assert.equal(await ticked, true);
  await settle();
  assert.deepEqual([wb.flags[MOD].warband.upgrades, wb.flags[MOD].warband.arrears], [["hardy"], 30]);
});
