// The Casino's income on the world clock: 2d20 gp a month into the treasury of a standing bastion with a
// finished Casino, each month once, whatever the clock does.
import test from "node:test";
import assert from "node:assert/strict";
import { gregorian } from "./gregorian-calendar.mjs";

const MOD = "shadowdark-enhancer";
const hooks = new Map();
const chat = [];                 // chat cards and roll messages, in order
const formulas = [];             // every formula rolled
const rolls = [];                // totals the next rolls give; 7 when none are queued
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn) };
globalThis.foundry = { utils: {}, applications: {} };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() { formulas.push(this.formula); this.total = rolls.length ? rolls.shift() : 7; return this; }
  async toMessage(m) { chat.push({ roll: this.total, ...m }); }
};
globalThis.ChatMessage = { create: async (m) => { chat.push(m); }, getWhisperRecipients: () => ["gm"] };
const actors = [];
const gm = { id: "gm", isGM: true };
globalThis.game = {
  user: gm, actors, i18n: { format: (k, d) => `${k} ${JSON.stringify(d)}`, localize: (k) => k },
  time: { worldTime: 0, calendar: gregorian },
};

const { BASTION_TYPE } = await import("../scripts/bastion/bastion-art.mjs");
const core = await import("../scripts/bastion/bastion-core.mjs");
const { registerBastionIncome } = await import("../scripts/bastion/bastion-income.mjs");
registerBastionIncome();
const tick = hooks.get(`${MOD}.timeAdvanced`);
const later = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 30; i++) await later(); };

const at = (day) => gregorian.componentsToTime({ year: 1301, day });
const keyOf = (t) => { const c = gregorian.timeToComponents(t); return c.year * 12 + c.month; };

/** A bastion actor holding `state` as its stored data; `outcomes` says how its next writes go ("ok" or "veto"). */
function bastion(name, state, outcomes = []) {
  const raw = structuredClone(state);
  const a = {
    id: name, name, type: BASTION_TYPE, img: "x.svg", prototypeToken: { texture: { src: "x.svg" } }, outcomes,
    get raw() { return raw; },
    system: { type: raw.type, toObject: () => structuredClone(raw), get party() { return ""; } },
    update: async (data) => {
      await later();
      if ((a.outcomes.shift() ?? "ok") === "veto") return undefined;
      for (const [path, value] of Object.entries(data)) {
        if (!path.startsWith("system.")) continue;
        const keys = path.split(".").slice(1);
        let o = raw;
        for (const k of keys.slice(0, -1)) o = o[k];
        o[keys.at(-1)] = structuredClone(value);
      }
      return a;
    },
  };
  actors.push(a);
  return a;
}
/** A keep that stands, with these upgrades built (finished unless `going`). */
const keep = (ids, { going = false, treasury = 100 } = {}) => {
  let s = { ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 };
  for (const id of ids) s = core.build(s, id).state;
  if (!going) s = core.advanceWeek(s);
  return { ...s, treasury };
};
const reset = () => { actors.length = 0; chat.length = 0; formulas.length = 0; rolls.length = 0; };
const feb1 = { from: at(30) + 3600, to: at(31) + 3600, crossed: { days: 1 } };
const mar1 = { from: at(58) + 3600, to: at(59) + 3600, crossed: { days: 1 } };

test("a finished Casino earns 2d20 gp into the treasury at a month start, with the month marked and a roll in chat", async () => {
  reset();
  rolls.push(23);
  const b = bastion("Hold", keep(["casino"]));
  tick(feb1);
  await settle();
  assert.deepEqual(formulas, ["2d20"]);
  assert.equal(b.raw.treasury, 123);
  assert.deepEqual(b.raw.incomeMonths, [keyOf(at(31))]);
  assert.equal(b.raw.log.at(-1).key, "SDE.bastion.log.income");
  const message = chat.find((m) => m.roll === 23);
  assert.match(message.flavor, /SDE\.bastion\.income\.flavor .*"gp":23/);
  assert.equal(message.speaker.alias, "Hold");
});

test("a month is paid once: the same move seen again, or the clock set back and moved on, pays nothing more", async () => {
  reset();
  const b = bastion("Hold", keep(["casino"]));
  tick(feb1);
  await settle();
  tick(feb1);
  await settle();
  assert.equal(b.raw.treasury, 107);
  assert.equal(formulas.length, 1);
  tick(mar1);
  await settle();
  assert.equal(b.raw.treasury, 114, "the next month pays");
  assert.deepEqual(b.raw.incomeMonths, [keyOf(at(31)), keyOf(at(59))]);
});

test("a move across several month starts pays each one, with its own roll", async () => {
  reset();
  rolls.push(11, 22, 33);
  const b = bastion("Hold", keep(["casino"]));
  tick({ from: at(30) + 3600, to: at(120) + 3600, crossed: { days: 90 } });   // Feb 1, Mar 1, Apr 1 (and May 1 on day 120)
  await settle();
  assert.ok(formulas.length >= 3);
  assert.equal(b.raw.treasury, 100 + 11 + 22 + 33 + 7 * (formulas.length - 3));
  assert.equal(b.raw.incomeMonths.length, formulas.length);
});

test("nothing is earned without a standing bastion and a finished Casino", async () => {
  for (const [label, state] of [
    ["no Casino", keep(["stable"])],
    ["a Casino still building", keep(["casino"], { going: true })],
    ["a bastion not yet raised", { ...core.newBastion("keep"), treasury: 100 }],
  ]) {
    reset();
    const b = bastion("Hold", state);
    tick(feb1);
    await settle();
    assert.equal(b.raw.treasury, 100, label);
    assert.deepEqual(formulas, [], label);
  }
});

test("each bastion with a Casino rolls for itself; the others are left alone", async () => {
  reset();
  rolls.push(5, 9);
  const a = bastion("Ash", keep(["casino"])), b = bastion("Bay", keep(["casino"])), c = bastion("Cove", keep(["vault"]));
  tick(feb1);
  await settle();
  assert.deepEqual([a.raw.treasury, b.raw.treasury, c.raw.treasury], [105, 109, 100]);
  assert.deepEqual(formulas, ["2d20", "2d20"]);
});

test("a move that crosses no day does nothing", async () => {
  reset();
  const b = bastion("Hold", keep(["casino"]));
  tick({ from: at(30) + 3600, to: at(30) + 7200, crossed: { days: 0 } });
  tick({ from: at(30) + 3600, to: at(30) + 7200 });
  await settle();
  assert.equal(b.raw.treasury, 100);
  assert.deepEqual(formulas, []);
});

test("an income the treasury would not save is told to the GMs, with the gold, and the month stays unmarked", async () => {
  reset();
  rolls.push(31);
  const b = bastion("Hold", keep(["casino"]), ["veto"]);
  tick(feb1);
  await settle();
  assert.equal(b.raw.treasury, 100, "nothing saved");
  assert.deepEqual(b.raw.incomeMonths, [], "so not marked, and a clock set back over it pays it");
  const card = chat.find((m) => m.whisper);
  assert.match(card.content, /SDE\.bastion\.income\.lost .*gp&quot;:31/);
  assert.deepEqual(card.whisper, ["gm"]);
  assert.ok(!chat.some((m) => "roll" in m), "no roll message for a payment that wasn't saved");
  tick(feb1);   // the clock set back and moved on
  await settle();
  assert.equal(b.raw.treasury, 107, "it pays then");
});

test("a failed bastion doesn't stop the others", async () => {
  reset();
  const broken = bastion("Ash", keep(["casino"]));
  broken.update = async () => { throw new Error("hook threw"); };
  const fine = bastion("Bay", keep(["casino"]));
  const quiet = console.error;
  console.error = () => {};
  try { tick(feb1); await settle(); } finally { console.error = quiet; }
  assert.equal(fine.raw.treasury, 107);
});

test("an update that rejects after it was saved counts as paid: the bastion is read back, and the GMs aren't told to add it twice", async () => {
  reset();
  rolls.push(12);
  const b = bastion("Hold", keep(["casino"]));
  const real = b.update;
  b.update = async (data) => { await real(data); throw new Error("a hook threw after the save"); };
  const quiet = console.error;
  console.error = () => {};
  try { tick(feb1); await settle(); } finally { console.error = quiet; }
  assert.equal(b.raw.treasury, 112);
  assert.ok(!chat.some((m) => m.whisper), "nobody is told to add it by hand");
  assert.ok(chat.some((m) => m.roll === 12), "the roll is shown");
});

test("an income of a month in the state is checked in the pure rules: owed once, a whole non-negative gold", () => {
  const s = keep(["casino"]);
  assert.equal(core.owesIncome(s, 5), true);
  const paid = core.payIncome(s, 5, 12);
  assert.equal(paid.state.treasury, 112);
  assert.equal(core.owesIncome(paid.state, 5), false);
  assert.equal(core.payIncome(paid.state, 5, 12).error, "none");
  assert.equal(core.payIncome(s, 6, 1.5).error, "amount");
  assert.equal(core.payIncome(s, 6, -1).error, "amount");
  assert.equal(core.payIncome(keep(["stable"]), 5, 12).error, "none");
  let many = s;
  for (let m = 1; m <= 30; m++) many = core.payIncome(many, m, 1).state;
  assert.equal(many.incomeMonths.length, 24, "the last two years are kept");
  assert.equal(many.incomeMonths.at(-1), 30);
});
