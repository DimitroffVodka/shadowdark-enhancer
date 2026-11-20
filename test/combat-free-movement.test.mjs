/**
 * "Free movement combat" turns off feet tracking in combat: the ruler colours nothing and a move
 * writes no feet-left flag. Drives the REAL updateToken handler MovementTracker.init() registers and
 * the real ruler class, with stubbed Foundry globals (the shape movement-lock-wiring.test.mjs uses).
 */
import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { canvas: { placeables: { tokens: { TokenRuler: class TokenRuler { refresh() {} } } } } };

const { MovementTracker } = await import("../scripts/crawl-strip/movement-tracker.mjs");
const { CrawlStrip } = await import("../scripts/crawl-strip/crawl-strip.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");
const { normalizeCrawlState } = await import("../scripts/crawl-strip/crawl-state-core.mjs");

CrawlStrip.queueRender = () => {};

function boot({ combatFree }) {
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); return 1; } };
  globalThis.CONFIG = { Token: {}, queries: {} };
  globalThis._replace = (value) => value;
  globalThis.canvas = { tokens: { placeables: [], get: () => null }, interface: { grid: { highlight: { children: [] } } } };
  globalThis.game = {
    userId: "u1", user: { isGM: true }, combat: null, actors: [], scenes: { active: null }, folders: [],
    settings: { get: (_m, key) => ({ combatMovementDefault: 30, combatFreeMovement: combatFree })[key] ?? false },
    i18n: { localize: (s) => s },
  };
  CrawlState._state = normalizeCrawlState({ mode: "combat", active: true, members: ["a1"] });
  MovementTracker._pendingDeduct = {};
  MovementTracker._clearTimers = {};
  MovementTracker.init();
  return hooks.updateToken.at(-1);
}

async function drop(updateToken) {
  const updates = [];
  const doc = { id: "t1", actorId: "a1", actor: { system: {} }, getFlag: () => 30, update: async (c) => { updates.push(c); } };
  MovementTracker._pendingDeduct.t1 = 20;
  updateToken(doc, { _id: "t1", x: 500 }, {}, "u1");
  await new Promise((r) => setTimeout(r, 0));
  clearTimeout(MovementTracker._clearTimers.t1);
  return updates;
}

function rulerTracked() {
  const ruler = new globalThis.CONFIG.Token.rulerClass();
  ruler.token = { document: { actorId: "a1", getFlag: () => 30 }, actor: { system: {} } };
  ruler.refresh({});
  return ruler._tracked;
}

test("with Free movement combat off, a combat move is charged and the ruler tracks", async () => {
  const updateToken = boot({ combatFree: false });
  const updates = await drop(updateToken);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]["flags.shadowdark-enhancer.moveRemaining"], 10);
  assert.equal(rulerTracked(), true);
});

test("with Free movement combat on, a combat move writes no feet and the ruler colours nothing", async () => {
  const updateToken = boot({ combatFree: true });
  assert.equal((await drop(updateToken)).length, 0, "no feet-left flag written");
  assert.equal(rulerTracked(), false, "the ruler keeps core's styles");
});
