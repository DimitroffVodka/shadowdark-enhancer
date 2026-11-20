/**
 * The movement ruler reads its tracking state once per refresh, not once per style call.
 *
 * Core's TokenRuler.refresh asks _getSegmentStyle / _getWaypointStyle / _getGridHighlightStyle /
 * _getWaypointLabelContext once per segment, waypoint, label and grid square, on every drag step and
 * animation frame. Reading settings and walking the party rosters in each of those calls made the ruler
 * 9-15x slower than core's and dropped FPS while dragging or moving a token in a crawl or combat.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";

// Stands in for core: one refresh asks every style hook for each waypoint, as TokenRuler.refresh does.
class TokenRuler {
  constructor(token) { this.token = token; }
  refresh({ waypoints }) {
    for (const w of waypoints) {
      this._getSegmentStyle(w);
      this._getWaypointStyle(w);
      this._getGridHighlightStyle(w, {});
      this._getWaypointLabelContext(w, {});
    }
  }
  _getSegmentStyle() { return {}; }
  _getWaypointStyle() { return {}; }
  _getGridHighlightStyle() { return { alpha: 0.5 }; }
  _getWaypointLabelContext() { return { label: "" }; }
}
globalThis.foundry = { canvas: { placeables: { tokens: { TokenRuler } } } };

const { MovementTracker } = await import("../scripts/crawl-strip/movement-tracker.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");
const { normalizeCrawlState, defaultCrawlState } = await import("../scripts/crawl-strip/crawl-state-core.mjs");

let settingReads = 0;
globalThis.game = {
  settings: { get: (_m, key) => { settingReads++; return { oocMovementBudget: 30, crawlFreeMovement: false }[key]; } },
  i18n: { format: (key, { n }) => `${key}:${n}` },
  actors: { contents: [] },
  combats: { contents: [] },
};
globalThis.Hooks = { on: () => {} };
globalThis.CONFIG = { Token: {}, queries: {} };
globalThis.canvas = { tokens: { placeables: [], get: () => null }, interface: { grid: { highlight: { children: [] } } } };
MovementTracker.init();
const Ruler = globalThis.CONFIG.Token.rulerClass;

/** A pending path of `n` 5 ft steps, linked the way core links TokenRulerWaypoints. */
function path(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ stage: "pending", cost: i === 0 ? 0 : 5, previous: out[i - 1] ?? null });
  return out;
}

test("one refresh reads the settings a fixed number of times, however long the path", () => {
  CrawlState._state = normalizeCrawlState({ ...defaultCrawlState(), mode: "crawl", members: ["pc"] });
  const token = { document: { actorId: "pc", getFlag: () => undefined }, actor: { system: {} } };
  const ruler = new Ruler(token);

  settingReads = 0;
  ruler.refresh({ waypoints: path(5) });
  const short = settingReads;
  settingReads = 0;
  ruler.refresh({ waypoints: path(50) });
  assert.equal(settingReads, short, "settings reads grew with the path: the style hooks are reading state per call again");
  assert.ok(short <= 3, `expected a handful of reads per refresh, got ${short}`);
});

test("a refresh with no path to style reads nothing", () => {
  CrawlState._state = normalizeCrawlState({ ...defaultCrawlState(), mode: "crawl", members: ["pc"] });
  const ruler = new Ruler({ document: { actorId: "pc", getFlag: () => undefined }, actor: { system: {} } });
  settingReads = 0;
  ruler.refresh({ waypoints: [] });  // core still refreshes when movement history is cleared
  assert.equal(settingReads, 0);
});

test("the cached budget still colours and labels the path", () => {
  CrawlState._state = normalizeCrawlState({ ...defaultCrawlState(), mode: "crawl", members: ["pc"] });
  const token = { document: { actorId: "pc", getFlag: (scope, key) => (scope === MODULE_ID && key === "moveRemaining" ? 10 : undefined) }, actor: { system: {} } };
  const ruler = new Ruler(token);
  const wps = path(4);  // cumulative 0, 5, 10, 15 ft against 10 ft left
  ruler.refresh({ waypoints: wps });
  assert.deepEqual(wps.map(w => ruler._getSegmentStyle(w).color), [0x00cc00, 0x00cc00, 0x00cc00, 0xcc2200]);
  assert.equal(ruler._getGridHighlightStyle(wps[3], {}).color, 0xcc2200);
  assert.equal(ruler._getWaypointLabelContext(wps[3], {}).label, "SDE.crawlStrip.movement.over:-5");
});

test("an untracked token keeps core's styles", () => {
  CrawlState._state = normalizeCrawlState({ ...defaultCrawlState(), mode: "crawl", members: ["someone-else"] });
  const ruler = new Ruler({ document: { actorId: "pc", getFlag: () => undefined }, actor: { system: {} } });
  const wps = path(3);
  ruler.refresh({ waypoints: wps });
  assert.equal(ruler._getSegmentStyle(wps[2]).color, undefined);
  assert.equal(ruler._getWaypointLabelContext(wps[2], {}).label, "");
});

test("each refresh re-reads the state: a cache kept for the ruler's lifetime would go stale", () => {
  const flag = { moveRemaining: 10 };
  const ruler = new Ruler({ document: { actorId: "pc", getFlag: (scope, key) => (scope === MODULE_ID ? flag[key] : undefined) }, actor: { system: {} } });
  const wps = path(4);
  CrawlState._state = normalizeCrawlState({ ...defaultCrawlState(), mode: "crawl", members: ["pc"] });
  ruler.refresh({ waypoints: wps });
  assert.equal(ruler._getSegmentStyle(wps[3]).color, 0xcc2200);

  flag.moveRemaining = 20;  // the move was refunded
  ruler.refresh({ waypoints: wps });
  assert.equal(ruler._getSegmentStyle(wps[3]).color, 0x00cc00);

  CrawlState._state = normalizeCrawlState({ ...defaultCrawlState(), mode: "crawl", members: [] });  // removed from the crawl
  ruler.refresh({ waypoints: wps });
  assert.equal(ruler._getSegmentStyle(wps[3]).color, undefined);
});
