import test from "node:test";
import assert from "node:assert/strict";

// overland.mjs pulls in crawl-state.mjs, which touches Foundry classes at load.
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const stored = {};
const owner = (userId) => ({ testUserPermission: (u) => u.id === userId });
const actors = {
  mine: { id: "mine", name: "Mine", type: "Player", ...owner("player1") },
  theirs: { id: "theirs", name: "Theirs", type: "Player", ...owner("player2") },
};
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {} }, Hooks: { on() {}, once() {}, callAll() {} }, ui: { notifications: { warn() {} } },
  game: {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
    actors: { get: (id) => actors[id] ?? null, filter: () => [] },
    settings: {
      get: (ns, key) => stored[key],
      set: async (ns, key, value) => { stored[key] = value; },
    },
    socket: { emit() {}, on() {} },
    i18n: { localize: (k) => k, format: (k) => k },
    modules: { get: () => null },
  },
});
const { applyAction, registerOverland } = await import("../scripts/overland/overland.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");

function travelling(members) {
  stored.overlandState = { members, foraged: [] };
  registerOverland();
  CrawlState._state = { ...CrawlState._state, mode: "overland" };
}

test("a player forages for their own travelling character", async () => {
  travelling(["mine", "theirs"]);
  const res = await applyAction({ action: "forage", actorId: "mine" }, { id: "player1", isGM: false });
  assert.equal(res.ok, true);
  assert.deepEqual(stored.overlandState.foraged, ["mine"]);
});

test("a forged forage for someone else's character is refused, and nothing is written", async () => {
  travelling(["mine", "theirs"]);
  const res = await applyAction({ action: "forage", actorId: "theirs" }, { id: "player1", isGM: false });
  assert.equal(res.ok, false);
  assert.deepEqual(stored.overlandState.foraged, []);
});

test("a player cannot start or end travel", async () => {
  travelling(["mine"]);
  for (const action of ["start", "end"]) {
    const res = await applyAction({ action, tokenUuid: "Scene.s.Token.t" }, { id: "player1", isGM: false });
    assert.equal(res.ok, false, action);
  }
});

test("a non-primary GM's client refuses to do the work", async () => {
  travelling(["mine"]);
  globalThis.game.users.activeGM = { id: "other-gm" };
  const res = await applyAction({ action: "forage", actorId: "mine" }, { id: "player1", isGM: false });
  globalThis.game.users.activeGM = { id: "gm" };
  assert.equal(res.ok, false);
  assert.deepEqual(stored.overlandState.foraged, []);
});
