// Warband upkeep on the clock (#284 review): a failed charge tried again without charging twice,
// healing up to a desertion, the sheet's writes and the upkeep on one queue, Pay Arrears paid once
// whichever write fails, and a clock move that a failed card or setting doesn't stop part way.
import test from "node:test";
import assert from "node:assert/strict";
import { gregorian } from "./gregorian-calendar.mjs";

const TYPE = "shadowdark-enhancer.warband";
const MOD = "shadowdark-enhancer";
const later = () => new Promise((resolve) => setImmediate(resolve));
const hooks = new Map();
const settings = new Map();
const settingRejects = new Map();   // setting key → how many of its next writes fail
const chat = [];                    // the cards, and each morale roll announced ({ roll })
const rolls = [];          // totals the next Rolls give, in order; 1 when none are queued
const formulas = [];       // every formula rolled, in order
const warns = [];
let chatRejects = 0;
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), once: (name, fn) => hooks.set(`once:${name}`, fn), callAll() {} };
globalThis._replace = (value) => ({ __replace: value });
globalThis.ui = { notifications: { warn: (m) => warns.push(m), error() {}, info() {} } };
globalThis.CONFIG = { queries: {} };
globalThis.foundry = { data: { fields: { NumberField: class {} } }, utils: { deepClone: (v) => structuredClone(v), randomID: () => Math.random().toString(36).slice(2, 18) } };
globalThis.ChatMessage = {
  create: async (m) => { if (chatRejects > 0) { chatRejects--; throw new Error("card failed"); } chat.push(m); },
  getWhisperRecipients: () => [], getSpeaker: () => ({}),
};
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() { formulas.push(this.formula); this.total = rolls.length ? rolls.shift() : 1; return this; }
  async toMessage() { chat.push({ roll: this.total }); }
};
const actors = [];
actors.get = (id) => actors.find((a) => a.id === id);
const gm = { id: "gm", isGM: true, hasPermission: () => true };
const users = Object.assign([], { activeGM: gm });   // the world's users: the GM, and any player a test adds
globalThis.game = {
  actors, user: gm, users, i18n: { format: (k) => k, localize: (k) => k, lang: "en" },
  time: { worldTime: 0, calendar: gregorian },
  settings: {
    register: (_m, key, cfg) => settings.set(key, cfg.default ?? null),
    get: (_m, key) => settings.get(key) ?? null,
    set: async (_m, key, v) => {
      if (settingRejects.get(key) > 0) { settingRejects.set(key, settingRejects.get(key) - 1); throw new Error("setting write failed"); }
      settings.set(key, v);
    },
  },
};
const pcs = new Map();
globalThis.fromUuid = async (uuid) => pcs.get(uuid) ?? null;

const { registerWarbandUpkeep, PENDING_MONTHS_SETTING } = await import("../scripts/actors/warband-upkeep.mjs");
const { registerWarbandWrites, warbandWrites } = await import("../scripts/actors/warband-npc-sheet.mjs");
const { installAppV2Stub } = await import("./helpers/appv2-stub.mjs");
const core = await import("../scripts/actors/warband-core.mjs");
const { BASTION_TYPE } = await import("../scripts/bastion/bastion-art.mjs");
const bastionCore = await import("../scripts/bastion/bastion-core.mjs");
registerWarbandWrites(TYPE);
registerWarbandUpkeep(TYPE);
const tick = hooks.get(`${MOD}.timeAdvanced`);

const at = (day) => gregorian.componentsToTime({ year: 1301, day });   // day of the year, from 0
/**
 * A document write that lands a moment later and goes as the next of `outcomes` says: "ok" (the
 * default), "reject" (nothing saved), "veto" (a hook stops it: nothing saved, no error) or
 * "savedThenReject" (saved, then a hook throws), as a Foundry update can.
 */
async function write(outcomes, apply) {
  await later();
  const how = outcomes.shift() ?? "ok";
  if (how === "reject") throw new Error("write failed");
  if (how === "veto") return undefined;
  apply();
  if (how === "savedThenReject") throw new Error("saved, then a hook threw");
  return {};
}
function pc(id, gp, { outcomes = [], cha = 0, hitDie = "1d6" } = {}) {
  const p = { uuid: `Actor.${id}`, name: id, type: "Player", pack: null, outcomes,
    system: { coins: { gp, sp: 0, cp: 0 }, abilities: { cha: { mod: cha } }, getClass: async () => ({ system: { hitPoints: hitDie } }) },
    update: (data) => write(p.outcomes, () => { p.system.coins = { gp: data["system.coins.gp"], sp: data["system.coins.sp"], cp: data["system.coins.cp"] }; }),
  };
  pcs.set(p.uuid, p);
  return p;
}
function warband(id, flag, { level = 3, hp = [30, 30] } = {}) {
  const a = {
    id, type: TYPE, name: id, flags: { [MOD]: { warband: flag } }, items: [],
    flagOutcomes: [],        // how its next flag writes go
    duringFlagWrite: null,   // something else that happens while its next flag write is on its way
    system: { level: { value: level }, attributes: { hp: { value: hp[0], max: hp[1] } } },
    _source: { system: { attributes: { ac: { value: 13 }, hp: { value: hp[0], max: hp[1] } } } },
    getFlag: (scope, key) => a.flags[scope]?.[key],
    testUserPermission: () => true,
    update: (data) => {
      const isFlag = Object.keys(data).some((k) => k.startsWith("flags."));
      if (isFlag && a.duringFlagWrite) { a.duringFlagWrite(); a.duringFlagWrite = null; }
      return write(isFlag ? a.flagOutcomes : [], () => {
        for (const [k, v] of Object.entries(data)) {
          if (k.startsWith("flags.")) a.flags[MOD][k.split(".").pop()] = v.__replace;
          else if (k === "system.attributes.hp.value") a.system.attributes.hp = { ...a.system.attributes.hp, value: v };
        }
      });
    },
  };
  actors.push(a);
  return a;
}
const settle = async () => { for (let i = 0; i < 40; i++) await later(); };
/** Every queued warband job done: the clock's moves and the sheet's presses all run on that one queue. */
const drain = () => warbandWrites(() => {});
const reset = () => {
  actors.length = 0; users.length = 0; pcs.clear(); chat.length = 0; rolls.length = 0; formulas.length = 0; warns.length = 0; chatRejects = 0; settingRejects.clear();
  for (const k of settings.keys()) settings.set(k, null);
};
installAppV2Stub();
const { WarbandSheet: Sheet } = await import("../scripts/actors/warband-sheet.mjs");
const sheetOf = (wb) => Object.defineProperty(Object.create(Sheet.prototype), "actor", { value: wb });
/** Pay Arrears pressed on the warband's sheet: true when it went through. */
const pay = (wb) => sheetOf(wb)._sendWrite({ action: "payArrears" }).catch(() => false);
const whispered = (key) => chat.some((m) => m.whisper && m.content?.includes(key));
/** The first week start in [from, to], found the way the upkeep finds it. */
const weekStartIn = (from, to) => core.clockEvents({
  from, to, secondsPerDay: 86400, week: 7, offset: 0,
  monthOf: (t) => core.monthKey(gregorian.timeToComponents(t), 12), lastMonth: 99999, lastWeek: null, maxDays: 366,
}).events.find((e) => e.week).at;

test("a charge whose purse write fails is tried at the next move; the one that paid isn't charged twice", async () => {
  reset();
  const a = pc("A", 100, { outcomes: ["reject"] });
  const b = pc("B", 100);
  const wa = warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
  warband("wb", { commander: b.uuid, upgrades: [] }, { level: 2 });
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });   // over Feb 1
  await settle();
  assert.deepEqual([a.system.coins.gp, b.system.coins.gp], [100, 80], "A's write failed; B paid 20");
  assert.deepEqual(settings.get(PENDING_MONTHS_SETTING).map((e) => e.id), ["wa"], "wa's month is left pending");
  tick({ from: at(31) + 3600, to: at(32) + 3600, crossed: { days: 1 } });
  await settle();
  assert.deepEqual([a.system.coins.gp, b.system.coins.gp], [70, 80], "A charged now, B not again");
  assert.deepEqual(settings.get(PENDING_MONTHS_SETTING), []);
  assert.deepEqual(wa.flags[MOD].warband.settledMonths, [core.monthKey(gregorian.timeToComponents(at(31)), 12)]);
});

test("a move heals the days before a warband deserts at a week start, and none after", async () => {
  reset();
  const cmd = pc("C", 0);
  const wb = warband("wb", { commander: cmd.uuid, upgrades: [], arrears: 30 }, { level: 3, hp: [1, 100] });
  // A week start mid-month; the move starts a day and a half before it.
  const weekStart = weekStartIn(at(40), at(50));
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
  const ticked = sheetOf(wb)._toggleUpgrade("hardy", true);   // reads the flag, then waits on the class
  tick({ from: at(58) + 3600, to: at(59) + 3600, crossed: { days: 1 } });   // over Mar 1, an empty purse
  await settle();
  release();
  assert.equal(await ticked, true);
  await settle();
  assert.deepEqual([wb.flags[MOD].warband.upgrades, wb.flags[MOD].warband.arrears], [["hardy"], 30]);
});

test("a settlement mark that fails to save takes nothing; the retry charges once (#284 review)", async () => {
  reset();
  const a = pc("A", 100);
  const wa = warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
  wa.flagOutcomes = ["reject"];                                             // the mark before the purse
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });   // over Feb 1
  await settle();
  assert.equal(a.system.coins.gp, 100, "the purse isn't touched before the mark is saved");
  tick({ from: at(31) + 3600, to: at(32) + 3600, crossed: { days: 1 } });
  await settle();
  tick({ from: at(32) + 3600, to: at(33) + 3600, crossed: { days: 1 } });
  await settle();
  assert.equal(a.system.coins.gp, 70, "charged once for February");
});

test("a month still owed isn't hidden by a later one paid; a warband that joined since isn't charged for it (#284 review)", async () => {
  reset();
  const a = pc("A", 100, { outcomes: ["reject", "reject"] });             // Feb fails, and its retry at Mar 1 too
  const wa = warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });   // over Feb 1
  await settle();
  const late = pc("L", 100);
  warband("late", { commander: late.uuid, upgrades: [] }, { level: 3 });  // given a commander after Feb 1
  tick({ from: at(58) + 3600, to: at(59) + 3600, crossed: { days: 1 } });   // over Mar 1: Feb's retry fails, Mar is paid
  await settle();
  assert.deepEqual([a.system.coins.gp, late.system.coins.gp], [70, 70]);
  tick({ from: at(59) + 3600, to: at(60) + 3600, crossed: { days: 1 } });   // Feb tried again
  await settle();
  assert.deepEqual([a.system.coins.gp, late.system.coins.gp], [40, 70], "February collected; the late warband owes only March");
  assert.equal(wa.flags[MOD].warband.settledMonths.length, 2);
  assert.deepEqual(settings.get(PENDING_MONTHS_SETTING), []);
});

test("Pay Arrears whose clear fails takes nothing, and the retry takes it once (#284 review)", async () => {
  reset();
  const a = pc("A", 100);
  const wa = warband("wa", { commander: a.uuid, upgrades: [], arrears: 30 });
  wa.flagOutcomes = ["reject"];
  assert.equal(await pay(wa), false);
  assert.deepEqual([a.system.coins.gp, wa.flags[MOD].warband.arrears], [100, 30], "nothing taken, still owed");
  assert.deepEqual(warns, ["SDE.warband.notify.payFailed"]);
  assert.equal(await pay(wa), true);
  assert.deepEqual([a.system.coins.gp, wa.flags[MOD].warband.arrears], [70, 0], "taken once");
});

test("Pay Arrears whose purse write fails owes it again, and the retry takes it once (#284 review)", async () => {
  reset();
  const a = pc("A", 100, { outcomes: ["reject"] });
  const wa = warband("wa", { commander: a.uuid, upgrades: [], arrears: 30 });
  assert.equal(await pay(wa), false);
  assert.deepEqual([a.system.coins.gp, wa.flags[MOD].warband.arrears], [100, 30], "nothing taken, still owed");
  assert.equal(await pay(wa), true);
  assert.deepEqual([a.system.coins.gp, wa.flags[MOD].warband.arrears], [70, 0], "taken once");
});

test("Pay Arrears whose purse write and putting the debt back both fail stays paid and tells the GMs; nothing is taken again (#284 review)", async () => {
  reset();
  const a = pc("A", 100, { outcomes: ["reject"] });
  const wa = warband("wa", { commander: a.uuid, upgrades: [], arrears: 30 });
  wa.flagOutcomes = ["ok", "reject"];         // the arrears come off; putting them back fails
  assert.equal(await pay(wa), false);
  assert.deepEqual([a.system.coins.gp, wa.flags[MOD].warband.arrears], [100, 0]);
  assert.deepEqual(warns, ["SDE.warband.upkeep.unconfirmed"]);
  assert.ok(whispered("SDE.warband.upkeep.unconfirmed"), "the GMs are told to settle it by hand");
  assert.equal(a.system.coins.gp, 100, "nothing is taken until the next press");
  assert.equal(await pay(wa), true);
  assert.deepEqual([a.system.coins.gp, wa.flags[MOD].warband.arrears], [70, 0], "which finds the purse untouched, owes the debt again, and takes it once");
});

test("two Pay Arrears presses at once pay once: the second finds nothing owed", async () => {
  reset();
  const a = pc("A", 100);
  const wa = warband("wa", { commander: a.uuid, upgrades: [], arrears: 30 });
  assert.deepEqual(await Promise.all([pay(wa), pay(wa)]), [true, true]);
  assert.deepEqual([a.system.coins.gp, wa.flags[MOD].warband.arrears], [70, 0]);
});

test("Pay Arrears reads its writes back: one saved before it failed counts, one a hook stopped doesn't (#284 review)", async () => {
  reset();
  const a = pc("A", 100, { outcomes: ["savedThenReject"] });
  const wa = warband("wa", { commander: a.uuid, upgrades: [], arrears: 30 });
  wa.flagOutcomes = ["savedThenReject"];
  assert.equal(await pay(wa), true);
  assert.deepEqual([a.system.coins.gp, wa.flags[MOD].warband.arrears], [70, 0], "paid once, and not put back");
  const b = pc("B", 100, { outcomes: ["veto"] });
  const wb = warband("wb", { commander: b.uuid, upgrades: [], arrears: 30 });
  assert.equal(await pay(wb), false);
  assert.deepEqual([b.system.coins.gp, wb.flags[MOD].warband.arrears], [100, 30], "stopped: nothing taken, still owed");
});

test("a purse that changed some other way while its write failed can't be told from paid: it stays paid and the GMs are told (#284 review)", async () => {
  reset();
  const a = pc("A", 100);
  a.update = async () => { await later(); a.system.coins = { ...a.system.coins, gp: 95 }; throw new Error("write failed"); };   // a sale lands; ours doesn't
  const wa = warband("wa", { commander: a.uuid, upgrades: [], arrears: 30 });
  assert.equal(await pay(wa), false);
  assert.deepEqual([a.system.coins.gp, wa.flags[MOD].warband.arrears], [95, 0], "not put back, so never taken twice");
  assert.ok(whispered("SDE.warband.upkeep.unconfirmed"));
});

test("a retried list that fails to save doesn't stop the move, and clears next time without charging twice (#284 review)", async () => {
  reset();
  const a = pc("A", 100, { outcomes: ["reject"] });
  warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });   // over Feb 1: A's write fails
  await drain();
  settingRejects.set(PENDING_MONTHS_SETTING, 1);                           // clearing February once it's paid
  tick({ from: at(58) + 3600, to: at(59) + 3600, crossed: { days: 1 } });   // over Mar 1: February paid, then March
  await drain();
  assert.equal(a.system.coins.gp, 40, "March still charged");
  tick({ from: at(59) + 3600, to: at(60) + 3600, crossed: { days: 1 } });
  await drain();
  assert.equal(a.system.coins.gp, 40, "February not taken again");
  assert.deepEqual(settings.get(PENDING_MONTHS_SETTING), []);
});

test("a month's purse write saved before it failed is paid, and not tried again (#284 review)", async () => {
  reset();
  const a = pc("A", 100, { outcomes: ["savedThenReject"] });
  warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });   // over Feb 1
  tick({ from: at(31) + 3600, to: at(32) + 3600, crossed: { days: 1 } });
  await drain();
  assert.equal(a.system.coins.gp, 70);
  assert.deepEqual(settings.get(PENDING_MONTHS_SETTING) ?? [], []);
});

test("a purchase that lands while the month is being marked isn't written over (#284 review)", async () => {
  reset();
  const a = pc("A", 100);
  const wa = warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
  wa.duringFlagWrite = () => { a.system.coins = { ...a.system.coins, gp: a.system.coins.gp - 5 }; };   // a sale at the shop
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });   // over Feb 1
  await drain();
  assert.equal(a.system.coins.gp, 65, "the 5 gp sale and the 30 gp upkeep both taken");
});

test("a card or a bookkeeping setting that fails doesn't stop the rest of a clock move (#284 review)", async () => {
  reset();
  const cmd = pc("C", 0);
  const wb = warband("wb", { commander: cmd.uuid, upgrades: [] }, { level: 3 });
  chatRejects = 1;                                  // the month's card
  settingRejects.set("warbandLastMonth", 1);        // and the month's marker
  tick({ from: at(30) + 3600, to: at(40) + 3600, crossed: { days: 10 } });   // over Feb 1 and a week start after it
  await drain();
  assert.equal(wb.flags[MOD].warband.arrears, 30, "February unpaid");
  assert.equal(wb.flags[MOD].warband.deserted, true, "and the week start after it still checked morale");
  // A move over a year posts its catch-up card before anything else: that card failing lost the whole year.
  reset();
  const rich = pc("R", 1000);
  warband("wr", { commander: rich.uuid, upgrades: [] }, { level: 1 });
  chatRejects = 1;
  const from = at(0) + 3600;
  const to = from + 400 * 86400;
  const months = core.clockEvents({
    from, to, secondsPerDay: 86400, week: 7, offset: 0,
    monthOf: (t) => core.monthKey(gregorian.timeToComponents(t), 12), maxDays: 366,
  }).events.filter((e) => e.month !== undefined).length;
  tick({ from, to, crossed: { days: 400 } });
  await drain();
  assert.equal(rich.system.coins.gp, 1000 - 10 * months, `the last year's ${months} months charged`);
});

test("a failed charge whose retry can't be kept is told to the GMs to settle by hand (#284 review)", async () => {
  reset();
  const a = pc("A", 100, { outcomes: ["reject"] });
  warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
  settingRejects.set(PENDING_MONTHS_SETTING, 1);
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });   // over Feb 1
  await drain();
  assert.equal(a.system.coins.gp, 100);
  assert.ok(whispered("SDE.warband.upkeep.chargeLost"));
});

test("a morale result that doesn't save isn't announced; the retry rolls and announces once (#284 review)", async () => {
  reset();
  const cmd = pc("C", 0);
  const wb = warband("wb", { commander: cmd.uuid, upgrades: [], arrears: 30 });
  const weekStart = weekStartIn(at(40), at(50));
  wb.flagOutcomes = ["reject"];
  rolls.push(1, 20);                                // a desertion that doesn't save; then the retry's 20
  tick({ from: weekStart - 3600, to: weekStart + 3600, crossed: { days: 1 } });
  await drain();
  assert.deepEqual(chat.filter((m) => "roll" in m), [], "nothing announced");
  tick({ from: weekStart + 3600, to: weekStart + 86400 + 3600, crossed: { days: 1 } });
  await drain();
  assert.deepEqual(chat.filter((m) => "roll" in m).map((m) => m.roll), [20], "rolled again, announced once");
  assert.equal(wb.flags[MOD].warband.deserted, false);
});

test("a warband's owner who names another player's PC by a direct flag write costs that player nothing (#284 review)", async () => {
  reset();
  const alice = { id: "alice", isGM: false }, bob = { id: "bob", isGM: false };
  users.push(alice, bob);
  const mine = pc("Mine", 100), theirs = pc("Bob", 100);
  mine.testUserPermission = (u) => u === alice;
  theirs.testUserPermission = (u) => u === bob;
  const wa = warband("wa", { commander: theirs.uuid, upgrades: [] }, { level: 10 });
  wa.testUserPermission = (u) => u === alice || u.isGM;   // Alice owns it, Bob does not
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });   // over Feb 1
  await settle();
  assert.equal(theirs.system.coins.gp, 100, "Bob's purse is untouched");
  wa.flags[MOD].warband = { ...wa.flags[MOD].warband, commander: mine.uuid };
  tick({ from: at(58) + 3600, to: at(59) + 3600, crossed: { days: 1 } });   // over Mar 1
  await settle();
  assert.equal(mine.system.coins.gp, 0, "a PC the warband's owner owns pays 100 gp");
});

test("a warband no player owns is charged to any PC its GM named", async () => {
  reset();
  users.push({ id: "bob", isGM: false });
  const cmd = pc("Cmd", 100);
  cmd.testUserPermission = () => false;
  const wa = warband("wa", { commander: cmd.uuid, upgrades: [] }, { level: 3 });
  wa.testUserPermission = (u) => u.isGM;
  tick({ from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } });
  await settle();
  assert.equal(cmd.system.coins.gp, 70);
});

// A client lost between the mark and the purse write (#284 review): the mark alone can't prove the gold was taken.
const feb = { from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } };
const next = { from: at(31) + 3600, to: at(32) + 3600, crossed: { days: 1 } };
const OUTCOMES = [
  ["landed", 70, 70, false],
  ["not landed", 100, 70, false],
  ["unclear", 95, 95, true],
];
/** A restarted client: nothing but the persisted flag and world settings carry over, the purse is what it is now. */
const restartFrom = (flag, kept, gp) => {
  reset();
  for (const [k, v] of kept) settings.set(k, v);
  return [pc("A", gp), warband("wa", flag, { level: 3 })];
};

for (const [name, gpNow, gpAfter, told] of OUTCOMES) {
  test(`a client lost after the month's mark and before its purse write, purse ${name}: the next move settles it once (#284 review)`, async () => {
    reset();
    const a = pc("A", 100);
    let lose;
    a.update = () => new Promise((_, reject) => { lose = () => reject(new Error("client lost")); });   // never reaches the server
    const wa = warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
    tick(feb);
    await settle();
    const flag = structuredClone(wa.flags[MOD].warband);
    const kept = structuredClone([...settings]);
    lose();                                             // the old client's rollback runs on documents nobody reads any more
    await drain();
    assert.equal(flag.settledMonths.length, 1, "marked");
    assert.ok(flag.payment, "and the intent to pay came with the mark, in the same write");
    const [b, wb] = restartFrom(flag, kept, gpNow);
    tick(next);
    await drain();
    assert.equal(b.system.coins.gp, gpAfter);
    assert.equal(wb.flags[MOD].warband.payment ?? null, null, "the intent is cleared");
    assert.equal(wb.flags[MOD].warband.settledMonths.length, 1, "February is paid, or the GM has been told");
    assert.equal(whispered("SDE.warband.upkeep.paymentUnclear"), told);
    assert.deepEqual(settings.get(PENDING_MONTHS_SETTING) ?? [], []);
    tick({ from: next.to, to: next.to + 86400, crossed: { days: 1 } });
    await drain();
    assert.equal(b.system.coins.gp, gpAfter, "and never again");
  });

  test(`a client lost after Pay Arrears' mark and before its purse write, purse ${name}: the next press settles it once (#284 review)`, async () => {
    reset();
    const a = pc("A", 100);
    let lose;
    a.update = () => new Promise((_, reject) => { lose = () => reject(new Error("client lost")); });
    const wa = warband("wa", { commander: a.uuid, upgrades: [], arrears: 30 });
    const pressed = pay(wa);
    await settle();
    const flag = structuredClone(wa.flags[MOD].warband);
    const kept = structuredClone([...settings]);
    lose();
    await pressed;
    assert.equal(flag.arrears, 0);
    assert.ok(flag.payment, "the intent came with the mark");
    const [b, wb] = restartFrom(flag, kept, gpNow);
    assert.equal(await pay(wb), true);
    assert.equal(b.system.coins.gp, gpAfter);
    assert.equal(wb.flags[MOD].warband.arrears, 0);
    assert.equal(wb.flags[MOD].warband.payment ?? null, null);
    assert.equal(whispered("SDE.warband.upkeep.paymentUnclear"), told);
    assert.equal(await pay(wb), true);
    assert.equal(b.system.coins.gp, gpAfter, "and never again");
  });
}

test("a GM who starts up with a payment left half done reconciles it before any clock move (#284 review)", async () => {
  reset();
  const a = pc("A", 100);
  let lose;
  a.update = () => new Promise((_, reject) => { lose = () => reject(new Error("client lost")); });
  const wa = warband("wa", { commander: a.uuid, upgrades: [] }, { level: 3 });
  tick(feb);
  await settle();
  const flag = structuredClone(wa.flags[MOD].warband);
  const kept = structuredClone([...settings]);
  lose();
  await drain();
  const [b, wb] = restartFrom(flag, kept, 100);
  await hooks.get("once:ready")();
  assert.equal(wb.flags[MOD].warband.payment ?? null, null);
  assert.deepEqual(wb.flags[MOD].warband.settledMonths, [], "the month is owed again");
  assert.equal(settings.get(PENDING_MONTHS_SETTING).length, 1, "and the next move collects it");
  assert.equal(b.system.coins.gp, 100, "recovery takes no gold itself");
  tick(next);
  await drain();
  assert.equal(b.system.coins.gp, 70);
});

// Every way the two flag writes and the purse write around a payment can go: never charged twice, and a debt
// marked paid without its gold is always the GM's to hear of.
const HOW = ["ok", "reject", "veto", "savedThenReject"];
for (const kind of ["month", "arrears"]) {
  test(`${kind}: every ok/reject/veto/saved-then-reject of the mark, the purse and the write after it charges once at most and never loses a debt silently (#284 review)`, async () => {
    for (const w1 of HOW) for (const p of HOW) for (const w2 of HOW) {
      reset();
      const a = pc("A", 100, { outcomes: [p] });
      const wa = warband("wa", { commander: a.uuid, upgrades: [], ...(kind === "arrears" ? { arrears: 30 } : {}) }, { level: 3 });
      wa.flagOutcomes = [w1, w2];
      const label = `${w1}/${p}/${w2}`;
      if (kind === "month") { tick(feb); await drain(); tick(next); await drain(); tick({ from: next.to, to: next.to + 86400, crossed: { days: 1 } }); await drain(); }
      else { await pay(wa); await pay(wa); await pay(wa); }
      const st = wa.flags[MOD].warband;
      assert.ok([70, 100].includes(a.system.coins.gp), `${label}: charged at most once (${a.system.coins.gp})`);
      const paid = kind === "month" ? st.settledMonths?.length > 0 : !st.arrears;
      if (paid && a.system.coins.gp === 100) assert.ok(chat.some((m) => m.whisper), `${label}: marked paid with no gold taken, and nobody told`);
      assert.equal(st.payment ?? null, null, `${label}: no intent left behind`);
    }
  });
}

// ---- Bastions: a warband garrisoned at a standing bastion (the Granary and the Barracks).
/** A bastion actor the clock can find by its UUID. */
function bastion(id, state, { type = BASTION_TYPE } = {}) {
  const b = { uuid: `Actor.${id}`, name: id, type, pack: null, system: { toObject: () => state }, testUserPermission: () => true };
  pcs.set(b.uuid, b);
  return b;
}
/** A keep that stands, with the upgrades built (and `weeks` of them gone by). */
const keepWith = (ids, weeks = 1) => {
  let s = { ...bastionCore.newBastion("keep"), weeksLeft: 0, treasury: 5000 };
  for (const id of ids) s = bastionCore.build(s, id).state;
  for (let i = 0; i < weeks; i++) s = bastionCore.advanceWeek(s);
  return s;
};
const feb1 = { from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } };

test("a warband garrisoned under a finished Granary costs 10 gp less a month, and the card says so", async () => {
  reset();
  const cmd = pc("Cmd", 100);
  const hold = bastion("Hold", keepWith(["granary"]));
  warband("wb", { commander: cmd.uuid, upgrades: [], bastion: hold.uuid }, { level: 3 });
  tick(feb1);
  await settle();
  assert.equal(cmd.system.coins.gp, 80, "30 gp less the Granary's 10");
  assert.ok(chat.some((m) => m.content?.includes("SDE.warband.upkeep.paidGarrison")), "the line names the saving");
});

test("the Granary saves nothing for a bastion still going up, one without it, a bastion that isn't one, or one that is gone", async () => {
  for (const [label, setup] of [
    ["a Granary still building", () => bastion("Hold", keepWith(["granary"], 0))],
    ["no Granary", () => bastion("Hold", keepWith(["stable"]))],
    ["a bastion not yet raised", () => bastion("Hold", { ...bastionCore.newBastion("keep"), treasury: 5000 })],
    ["a stand-in that isn't a bastion", () => bastion("Hold", keepWith(["granary"]), { type: "NPC" })],
    ["a bastion that is gone", () => ({ uuid: "Actor.gone" })],
  ]) {
    reset();
    const cmd = pc("Cmd", 100);
    const hold = setup();
    warband("wb", { commander: cmd.uuid, upgrades: [], bastion: hold.uuid }, { level: 3 });
    tick(feb1);
    await settle();
    assert.equal(cmd.system.coins.gp, 70, label);
    assert.ok(!chat.some((m) => m.content?.includes("paidGarrison")), label);
  }
});

test("a warband not garrisoned pays in full, and a level 1 warband under a Granary costs nothing", async () => {
  reset();
  const a = pc("A", 100), b = pc("B", 100);
  const hold = bastion("Hold", keepWith(["granary"]));
  warband("plain", { commander: a.uuid, upgrades: [] }, { level: 3 });
  const small = warband("small", { commander: b.uuid, upgrades: [], bastion: hold.uuid }, { level: 1 });
  tick(feb1);
  await settle();
  assert.deepEqual([a.system.coins.gp, b.system.coins.gp], [70, 100], "10 gp upkeep, all of it saved");
  assert.deepEqual(small.flags[MOD].warband.settledMonths ?? [], [], "nothing was charged, so nothing is marked");
});

test("a commander who can't cover the reduced upkeep owes the reduced amount in arrears", async () => {
  reset();
  const cmd = pc("Cmd", 5);
  const hold = bastion("Hold", keepWith(["granary"]));
  const wb = warband("wb", { commander: cmd.uuid, upgrades: [], bastion: hold.uuid }, { level: 3 });
  tick(feb1);
  await settle();
  assert.equal(cmd.system.coins.gp, 5, "untouched");
  assert.equal(wb.flags[MOD].warband.arrears, 20, "20 owed, not 30");
});

test("under a finished Barracks a warband heals a die more each day; without one it heals as before", async () => {
  for (const [label, state, expect] of [
    ["with a Barracks", keepWith(["barracks"]), "1d4 + 1d6"],
    ["without", keepWith(["stable"]), "1d4"],
    ["a Barracks still building", keepWith(["barracks"], 0), "1d4"],
  ]) {
    reset();
    const hold = bastion("Hold", state);
    const wb = warband("wb", { commander: null, upgrades: [], bastion: hold.uuid }, { level: 3, hp: [10, 100] });
    settings.set("warbandLastMonth", 99999);
    rolls.push(7);
    tick({ from: at(40) + 3600, to: at(41) + 3600, crossed: { days: 1 } });
    await settle();
    assert.deepEqual(formulas, [expect], label);
    assert.equal(wb.system.attributes.hp.value, 17, `${label}: healed what was rolled`);
    assert.equal(chat.some((m) => m.content?.includes("healedBarracks")), expect.includes("d6"), label);
  }
});

test("a Barracks heals a nearly healed warband to full without a roll when the least it rolls would", async () => {
  reset();
  const hold = bastion("Hold", keepWith(["barracks"]));
  const wb = warband("wb", { commander: null, upgrades: [], bastion: hold.uuid }, { level: 3, hp: [98, 100] });
  settings.set("warbandLastMonth", 99999);
  tick({ from: at(40) + 3600, to: at(41) + 3600, crossed: { days: 1 } });   // 1 + 1 >= 2
  await settle();
  assert.equal(wb.system.attributes.hp.value, 100);
  assert.deepEqual(formulas, [], "no dice");
});

test("the garrison write sets, clears and refuses a bastion, and writes nothing else of the warband's state", async () => {
  reset();
  const hold = bastion("Hold", keepWith(["granary"]));
  const cmd = pc("Cmd", 100);
  const wb = warband("wb", { commander: cmd.uuid, upgrades: ["hardy"], arrears: 7 }, { level: 3 });
  const garrison = (uuid) => sheetOf(wb)._sendWrite({ action: "garrison", bastionUuid: uuid }).catch(() => false);
  assert.equal(await garrison(hold.uuid), true);
  assert.deepEqual([wb.flags[MOD].warband.bastion, wb.flags[MOD].warband.commander, wb.flags[MOD].warband.arrears, wb.flags[MOD].warband.upgrades], [hold.uuid, cmd.uuid, 7, ["hardy"]]);
  assert.equal(await garrison(hold.uuid), true, "again changes nothing and answers the same");
  assert.equal(await garrison(cmd.uuid), false, "a character is not a bastion");
  assert.ok(warns.includes("SDE.warband.notify.garrisonBastion"));
  assert.equal(wb.flags[MOD].warband.bastion, hold.uuid, "a refused one leaves it as it was");
  assert.equal(await garrison(null), true);
  assert.equal(wb.flags[MOD].warband.bastion, null);
  assert.equal(await sheetOf(wb)._sendWrite({ action: "garrison", bastionUuid: 5 }).catch(() => false), false, "a payload of the wrong type is refused");
});
