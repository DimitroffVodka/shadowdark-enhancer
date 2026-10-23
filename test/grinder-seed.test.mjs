/** A world that ran Grinder in Shadowdark Extras brings those values across once, and never reads them again. */
import test from "node:test";
import assert from "node:assert/strict";
import { seedGrinder } from "../scripts/camping/grinder.mjs";

globalThis.Hooks = { once: () => {}, on: () => {} };

/** `store` maps "namespace.key" to a value; a key that is not in it is not registered, so reading it throws as Foundry does. */
function world(store) {
  const writes = [];
  globalThis.game = {
    user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } },
    settings: {
      get: (ns, key) => { if (!(`${ns}.${key}` in store)) throw new Error("not registered"); return store[`${ns}.${key}`]; },
      set: async (ns, key, value) => { store[`${ns}.${key}`] = value; writes.push(`${key}=${value}`); },
    },
  };
  return writes;
}
const mine = (extra = {}) => ({
  "shadowdark-enhancer.modeGrinder": false, "shadowdark-enhancer.modeGrinderHitDice": 1, "shadowdark-enhancer.grinderSeeded": false, ...extra,
});

test("Extras' Grinder on with 3 hit dice becomes the Enhancer's, once", async () => {
  const store = mine({ "shadowdark-extras.grinderMode": true, "shadowdark-extras.grinderHitDice": 3 });
  const writes = world(store);
  await seedGrinder();
  assert.equal(store["shadowdark-enhancer.modeGrinder"], true);
  assert.equal(store["shadowdark-enhancer.modeGrinderHitDice"], 3);
  assert.equal(store["shadowdark-enhancer.grinderSeeded"], true);
  store["shadowdark-extras.grinderMode"] = false;
  const before = writes.length;
  await seedGrinder();
  assert.equal(writes.length, before);
  assert.equal(store["shadowdark-enhancer.modeGrinder"], true);
});

test("Extras' Grinder off leaves the Enhancer's off, and a bad hit dice value reads as 1", async () => {
  const store = mine({ "shadowdark-extras.grinderMode": false, "shadowdark-extras.grinderHitDice": 99 });
  world(store);
  await seedGrinder();
  assert.equal(store["shadowdark-enhancer.modeGrinder"], false);
  assert.equal(store["shadowdark-enhancer.modeGrinderHitDice"], 4);
  assert.equal(store["shadowdark-enhancer.grinderSeeded"], true);
});

test("without Extras nothing is copied, and the seed is still used up", async () => {
  const store = mine();
  world(store);
  await seedGrinder();
  assert.equal(store["shadowdark-enhancer.modeGrinder"], false);
  assert.equal(store["shadowdark-enhancer.modeGrinderHitDice"], 1);
  assert.equal(store["shadowdark-enhancer.grinderSeeded"], true);
});

test("only the active GM seeds", async () => {
  const store = mine({ "shadowdark-extras.grinderMode": true });
  world(store);
  globalThis.game.users.activeGM = { id: "someone-else" };
  await seedGrinder();
  assert.equal(store["shadowdark-enhancer.grinderSeeded"], false);
});
