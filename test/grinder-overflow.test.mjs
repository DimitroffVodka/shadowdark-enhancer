/**
 * Grinder's option: a hit past 0 HP puts the rest on CON as stat damage. Run against the real wrappers
 * (this one and temp HP's) around a stand-in for the system's applyDamage, which clamps at 0 as the system's does.
 */
import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
class Replacement { constructor(value) { this.value = value; } }
globalThis._replace = (value) => new Replacement(value);
const ready = [];
const listeners = new Set();
globalThis.Hooks = {
  once: (name, fn) => { if (name === "ready") ready.push(fn); },
  on: (name, fn) => { if (name === "updateActor") listeners.add(fn); return fn; },
  off: (_name, fn) => listeners.delete(fn),
  callAll: (_name, ...args) => { for (const fn of [...listeners]) fn(...args); },
};
const settings = { modeGrinder: true, modeGrinderOverflowCon: true };
globalThis.game = {
  settings: { get: (_ns, key) => settings[key], set: async () => {} },
  i18n: { localize: (k) => k, format: (k, d = {}) => ("ability" in d ? `${d.amount} ${d.ability} damage` : k) },
  time: { worldTime: 0 }, user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } }, actors: { contents: [] },
};
const posted = [];
globalThis.ChatMessage = { getSpeaker: ({ actor }) => ({ alias: actor.name }), create: async (data) => posted.push(data) };

class Actor {
  constructor({ type = "Player", hp = 3, max = 10, pool = 0 } = {}) {
    this.type = type; this.name = "Hero"; this.id = "a1"; this.uuid = "Actor.a1"; this.documentName = "Actor";
    this.statuses = new Set(); this.store = new Map(); this.next = 0;
    this.system = { attributes: { hp: { value: hp, max } }, abilities: { con: { value: 10 } } };
    this.flags = { [MOD]: pool ? { tempHp: { value: pool, expires: null } } : {} };
  }
  get effects() { return [...this.store.values()]; }
  async applyDamage(damage, multiplier = 1) {
    const hp = this.system.attributes.hp, amount = Math.floor(parseInt(damage) * multiplier);
    const next = Math.min(Math.max(hp.value - amount, 0), hp.max);
    // The system does not await its HP write: applyDamage resolves first, the value lands later.
    setTimeout(() => { hp.value = next; globalThis.Hooks.callAll("updateActor", this); }, 5);
  }
  async update(data) {
    for (const [path, value] of Object.entries(data)) {
      if (path.startsWith(`flags.${MOD}.`)) this.flags[MOD][path.slice(`flags.${MOD}.`.length)] = value instanceof Replacement ? structuredClone(value.value) : value;
    }
  }
  async deleteEmbeddedDocuments(_type, ids) { for (const id of ids) this.store.delete(id); }
  async createEmbeddedDocuments(_type, data) { for (const d of data) { const id = `e${++this.next}`; this.store.set(id, { ...structuredClone(d), id, parent: this }); } }
}
globalThis.CONFIG = { Actor: { documentClass: Actor }, queries: {} };

const { registerGrinder } = await import("../scripts/camping/grinder.mjs");
const { registerTempHp } = await import("../scripts/shared/temp-hp.mjs");
// The order main calls them in: Grinder wraps the system's method first, so temp HP's wrapper goes around it.
registerGrinder(); registerTempHp();
for (const fn of ready) fn();

const conDamage = (actor) => actor.effects.map((e) => -Number(e.changes[0].value));

test("1 HP and a hit for 5 leaves 0 HP and 4 CON damage", async () => {
  const a = new Actor({ hp: 1 });
  await a.applyDamage(5);
  assert.equal(a.system.attributes.hp.value, 0);
  assert.deepEqual(conDamage(a), [4]);
  assert.equal(posted.length, 1);
});

test("a hit that does not pass 0 HP costs no CON", async () => {
  const a = new Actor({ hp: 5 });
  await a.applyDamage(5);
  assert.equal(a.system.attributes.hp.value, 0);
  assert.deepEqual(conDamage(a), []);
});

test("at 0 HP the whole hit goes to CON", async () => {
  const a = new Actor({ hp: 0 });
  await a.applyDamage(3);
  assert.deepEqual(conDamage(a), [3]);
});

test("temp HP is spent first, then HP, and only the rest past 0 is CON damage", async () => {
  const a = new Actor({ hp: 1, pool: 3 });
  await a.applyDamage(5);
  assert.equal(a.flags[MOD].tempHp, null);
  assert.equal(a.system.attributes.hp.value, 0);
  assert.deepEqual(conDamage(a), [1]);
});

test("a hit that temp HP and HP cover costs no CON", async () => {
  const a = new Actor({ hp: 2, pool: 3 });
  await a.applyDamage(5);
  assert.deepEqual(conDamage(a), []);
});

test("half damage floors, and a heal never overflows", async () => {
  const a = new Actor({ hp: 1 });
  await a.applyDamage(9, 0.5);
  assert.deepEqual(conDamage(a), [3]);
  const b = new Actor({ hp: 1 });
  await b.applyDamage(5, -1);
  assert.deepEqual(conDamage(b), []);
});

test("off unless Grinder is on as well; an NPC takes none", async () => {
  settings.modeGrinder = false;
  const a = new Actor({ hp: 1 });
  await a.applyDamage(5);
  assert.deepEqual(conDamage(a), []);
  settings.modeGrinder = true;
  const npc = new Actor({ type: "NPC", hp: 1 });
  await npc.applyDamage(5);
  assert.deepEqual(conDamage(npc), []);
  settings.modeGrinderOverflowCon = false;
  const c = new Actor({ hp: 1 });
  await c.applyDamage(5);
  assert.deepEqual(conDamage(c), []);
});

test("two awaited hits each meet the HP the one before left, not the HP before it", async () => {
  settings.modeGrinderOverflowCon = true;
  const a = new Actor({ hp: 5 });
  await a.applyDamage(4);
  await a.applyDamage(4);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(a.system.attributes.hp.value, 0);
  assert.deepEqual(conDamage(a), [3]);
});

test("hits fired together are applied in order, each against the HP the last left", async () => {
  settings.modeGrinderOverflowCon = true;
  const a = new Actor({ hp: 5 });
  await Promise.all([a.applyDamage(4), a.applyDamage(4), a.applyDamage(4)]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(a.system.attributes.hp.value, 0);
  assert.equal(conDamage(a).reduce((n, v) => n + v, 0), 7);
});

test("with the option off a hit goes straight through: no queue, no wait for updateActor, no timer", async () => {
  settings.modeGrinderOverflowCon = false;
  const a = new Actor({ hp: 5 });
  await a.applyDamage(4);
  assert.equal(a.system.attributes.hp.value, 5, "returned before the system's HP write landed");
  assert.equal(listeners.size, 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(a.system.attributes.hp.value, 1);
  settings.modeGrinderOverflowCon = true;
});
