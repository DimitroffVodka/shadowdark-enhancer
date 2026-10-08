/** token.hidden <-> combatant.hidden sync (hidden-sync.mjs): one write per change, from the active GM's tab only. */
import test from "node:test";
import assert from "node:assert/strict";

const hooks = new Map();
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn) };
const { registerHiddenSync } = await import("../scripts/crawl-strip/hidden-sync.mjs");
registerHiddenSync();

function world(userId) {
  const writes = [];
  const combatant = { tokenId: "t1", hidden: false, update: async (c) => { writes.push(["combatant", c]); } };
  globalThis.game = {
    user: { id: userId, isGM: true },
    users: { activeGM: { id: "gm" } },
    combat: { combatants: { find: (fn) => [combatant].find(fn) } },
  };
  return { writes, combatant };
}

test("a GM tab that is not the active GM (the Bridge) does not repeat the sync write", async () => {
  const { writes } = world("bridge");
  await hooks.get("updateToken")({ id: "t1" }, { hidden: true });
  assert.deepEqual(writes, []);
});

test("the active GM writes the combatant to match the token", async () => {
  const { writes } = world("gm");
  await hooks.get("updateToken")({ id: "t1" }, { hidden: true });
  assert.deepEqual(writes, [["combatant", { hidden: true }]]);
});
