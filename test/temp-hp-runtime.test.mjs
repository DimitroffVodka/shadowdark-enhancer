import test from "node:test";
import assert from "node:assert/strict";

// The client globals temp-hp.mjs touches, and just enough of an actor to see what it writes.
class Replacement { constructor(value) { this.value = value; } }
globalThis._replace = (value) => new Replacement(value);
const ready = [];
globalThis.Hooks = { once: (name, fn) => { if (name === "ready") ready.push(fn); }, on() {} };
globalThis.game = { time: { worldTime: 0 }, user: { isGM: false }, users: {}, actors: { contents: [] } };

const MOD = "shadowdark-enhancer";
class Actor {
  constructor({ hp = 3, max = 3, flags = {} } = {}) {
    this.system = { attributes: { hp: { value: hp, max } } };
    this.flags = { [MOD]: structuredClone(flags) };
    this.systemCalls = [];
    this.defeated = false;
  }
  // The system's own applyDamage: floors, clamps to [0, max], marks defeat at 0.
  async applyDamage(damage, multiplier = 1) {
    this.systemCalls.push([damage, multiplier]);
    const hp = this.system.attributes.hp, amount = Math.floor(parseInt(damage) * multiplier);
    hp.value = Math.min(Math.max(hp.value - amount, 0), hp.max);
    if (hp.value === 0 && multiplier === 1) this.defeated = true;
  }
  async update(data) {
    for (const [path, value] of Object.entries(data)) {
      if (path === "system.attributes.hp.value") this.system.attributes.hp.value = value;
      else if (path.startsWith(`flags.${MOD}.`)) {
        const key = path.slice(`flags.${MOD}.`.length);
        this.flags[MOD][key] = value instanceof Replacement ? structuredClone(value.value) : structuredClone(value);
      }
    }
  }
}
globalThis.CONFIG = { Actor: { documentClass: Actor } };

const { registerTempHp, tempHpOf, setTempHp, giveTempHp, expireTempHp } = await import("../scripts/shared/temp-hp.mjs");
registerTempHp();
for (const fn of ready) fn();

const pool = (value, expires = null) => ({ tempHp: { value, expires } });

test("damage under the pool takes nothing from HP, and HP is never touched", async () => {
  const a = new Actor({ hp: 3, max: 3, flags: pool(5) });
  await a.applyDamage(3);
  assert.equal(a.system.attributes.hp.value, 3);
  assert.equal(tempHpOf(a), 2);
  assert.deepEqual(a.systemCalls, [], "the system never saw it");
  assert.equal(a.defeated, false);
});

test("damage past the pool spends it and lands the rest on HP", async () => {
  const a = new Actor({ hp: 3, max: 3, flags: pool(2) });
  await a.applyDamage(4);
  assert.equal(tempHpOf(a), 0);
  assert.equal(a.flags[MOD].tempHp, null, "an empty pool is cleared");
  assert.equal(a.system.attributes.hp.value, 1);
  assert.deepEqual(a.systemCalls, [[2, 1]]);
});

test("a resisted hit is halved before the pool, and a rest that empties HP defeats", async () => {
  const a = new Actor({ hp: 1, max: 3, flags: pool(1) });
  await a.applyDamage(6, 0.5);
  assert.equal(tempHpOf(a), 0);
  assert.equal(a.system.attributes.hp.value, 0);
  assert.equal(a.defeated, true);
});

test("healing and an actor with no pool take the system's path unchanged", async () => {
  const hurt = new Actor({ hp: 1, max: 3, flags: pool(2) });
  await hurt.applyDamage(5, -1);
  assert.equal(hurt.system.attributes.hp.value, 3, "healing clamps to the maximum");
  assert.equal(tempHpOf(hurt), 2, "and leaves the pool alone");
  const plain = new Actor({ hp: 3, max: 3 });
  await plain.applyDamage(2);
  assert.equal(plain.system.attributes.hp.value, 1);
  assert.deepEqual(plain.systemCalls, [[2, 1]]);
});

test("an expired pool absorbs nothing and is retired", async () => {
  const a = new Actor({ hp: 3, max: 3, flags: pool(2, 100) });
  globalThis.game.time.worldTime = 100;
  await a.applyDamage(1);
  assert.equal(a.system.attributes.hp.value, 2);
  await expireTempHp(a);
  assert.equal(a.flags[MOD].tempHp, null);
  globalThis.game.time.worldTime = 0;
});

test("set, grant and the no-stacking rule", async () => {
  const a = new Actor();
  assert.equal(await giveTempHp(a, 2, { expires: 50 }), 2);
  assert.equal(await giveTempHp(a, 1), 2, "a smaller grant changes nothing");
  assert.equal(await giveTempHp(a, 4), 4);
  await setTempHp(a, 7);
  assert.equal(tempHpOf(a), 7);
  assert.equal(a.flags[MOD].tempHp.expires, null, "set keeps the pool's own expiry, here none");
  await setTempHp(a, 0);
  assert.equal(a.flags[MOD].tempHp, null);
});

test("a Cook surplus the old meal left over the maximum moves into the pool, once", async () => {
  const a = new Actor({ hp: 5, max: 3, flags: { campCook: { campId: "c", remaining: 2, expires: 500, expired: false } } });
  await expireTempHp(a);
  assert.equal(a.system.attributes.hp.value, 3);
  assert.deepEqual(a.flags[MOD].tempHp, { value: 2, expires: 500 });
  assert.equal(a.flags[MOD].campCook.remaining, 0);
  await expireTempHp(a);
  assert.deepEqual(a.flags[MOD].tempHp, { value: 2, expires: 500 }, "idempotent");
  assert.equal(a.system.attributes.hp.value, 3);
});
