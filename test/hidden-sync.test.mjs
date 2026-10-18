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

function chat(speaker, combatants, tokens = {}) {
  globalThis.canvas = { scene: null };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    scenes: { get: () => ({ tokens: { get: (id) => tokens[id] } }) },
    combat: { combatants: { find: (fn) => combatants.find(fn) } },
  };
  return hooks.get("preCreateChatMessage")({}, { flags: { core: { initiativeRoll: true } }, speaker });
}

test("a hidden tokenless foe's initiative card is cancelled, found by speaker.actor", () => {
  assert.equal(chat({ actor: "a1" }, [{ actorId: "a1", hidden: true }]), false);
  assert.equal(chat({ actor: "a1" }, [{ actorId: "a1", hidden: false }]), undefined, "visible foe still posts");
  assert.equal(chat({ actor: "a1" }, [{ actorId: "a2", hidden: true }]), undefined, "another actor");
  assert.equal(chat({ actor: "a1" }, [{ actorId: "a1", tokenId: "t9", hidden: true }]), undefined, "a tokened combatant is not matched by actor");
});

test("the token path is unchanged", () => {
  assert.equal(chat({ token: "t1", scene: "s" }, [], { t1: { hidden: true } }), false);
  assert.equal(chat({ token: "t1", scene: "s" }, [{ tokenId: "t1", hidden: true }], {}), false);
  assert.equal(chat({ token: "t1", scene: "s" }, [{ tokenId: "t1", hidden: false }], {}), undefined);
});
