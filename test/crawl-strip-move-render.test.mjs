/**
 * A token drop rebuilds the crawl strip once, for the feet-left flag, not three times: not for the
 * move itself, and not again from the movement tracker after its flag write. These drive the REAL
 * updateToken handlers that CrawlStrip.init() and MovementTracker.init() register, with stubbed
 * Foundry globals (the shape movement-lock-wiring.test.mjs uses), and count queueRender calls.
 */
import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { canvas: { placeables: { tokens: { TokenRuler: class TokenRuler {} } } } };

const { CrawlStrip, tokenMoveOnly } = await import("../scripts/crawl-strip/crawl-strip.mjs");
const { MovementTracker } = await import("../scripts/crawl-strip/movement-tracker.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");
const { normalizeCrawlState } = await import("../scripts/crawl-strip/crawl-state-core.mjs");

let renders = 0;
CrawlStrip.queueRender = () => { renders++; };

function boot() {
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); return 1; } };
  globalThis.CONFIG = { Token: {}, queries: {} };
  globalThis._replace = (value) => value;
  globalThis.canvas = { tokens: { placeables: [], get: () => null }, interface: { grid: { highlight: { children: [] } } } };
  globalThis.game = {
    userId: "u1", user: { isGM: true }, combat: null,
    settings: { get: (_m, key) => ({ combatMovementDefault: 30 })[key] ?? false },
    i18n: { localize: (s) => s },
  };
  CrawlState._state = normalizeCrawlState({ mode: "combat", active: true, members: [] });
  MovementTracker._pendingDeduct = {};
  MovementTracker._clearTimers = {};
  CrawlStrip._hookIds = [];
  CrawlStrip.mount = () => {};
  // The strip shows a card for token t1 only.
  CrawlStrip._el = { querySelector: (sel) => (sel.includes('"t1"') ? {} : null) };
  CrawlStrip.init();
  MovementTracker.init();
  return { strip: hooks.updateToken[0], tracker: hooks.updateToken[1] };
}

test("the strip's updateToken hook skips a move and redraws for anything it draws", () => {
  const { strip } = boot();
  const td = { id: "t1", actorId: "a1" };
  renders = 0;
  strip(td, { _id: "t1", x: 500, _movementHistory: [] });
  strip(td, { _id: "t1", x: 1, y: 2, elevation: 5, level: "l", rotation: 90, _regions: [] });
  assert.equal(renders, 0, "a move alone does not rebuild the strip");
  strip(td, { _id: "t1", flags: { "shadowdark-enhancer": { moveRemaining: 10 } } });
  strip(td, { _id: "t1", hidden: true });
  strip(td, { _id: "t1", x: 100, name: "Renamed" });
  assert.equal(renders, 3, "flags, hidden and a rename still redraw");
  strip({ id: "t9", actorId: "a9" }, { _id: "t9", name: "Off the strip" });
  assert.equal(renders, 3, "a token without a card never redraws");
});

test("the tracker's deduction writes the flag and leaves the redraw to the strip's hook", async () => {
  const { tracker } = boot();
  const updates = [];
  const doc = { id: "t1", actorId: "a1", actor: { system: {} }, getFlag: () => 30, update: async (c) => { updates.push(c); } };
  MovementTracker._pendingDeduct.t1 = 20;
  renders = 0;
  tracker(doc, { _id: "t1", x: 500 }, {}, "u1");
  await new Promise((r) => setTimeout(r, 0));
  clearTimeout(MovementTracker._clearTimers.t1);
  assert.equal(updates.length, 1, "one flag write");
  assert.equal(updates[0]["flags.shadowdark-enhancer.moveRemaining"], 10, "30 ft less 20 ft leaves 10");
  assert.equal(renders, 0, "no second render queued after the write");
});

test("tokenMoveOnly: core's movement bookkeeping is a move; anything else is not", () => {
  assert.equal(tokenMoveOnly({ _id: "t", x: 100, _movementHistory: [] }), true);
  assert.equal(tokenMoveOnly({ _id: "t", flags: {} }), false);
});
