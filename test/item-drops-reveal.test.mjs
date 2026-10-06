/** A dropped pile is a 0.5-size token: after a GM drop the view pings it and pans to it when it is off screen. */
import test from "node:test";
import assert from "node:assert/strict";

async function drops(canvasStub) {
  globalThis.foundry = { applications: { handlebars: { renderTemplate: async () => "" } }, utils: { deepClone: (o) => structuredClone(o) } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, TOKEN_DISPOSITIONS: { NEUTRAL: 0 } };
  globalThis.game = { user: { isGM: true }, settings: { get: () => true }, i18n: { localize: (k) => k, format: (k) => k } };
  globalThis.canvas = canvasStub;
  return await import("../scripts/loot/item-drops.mjs");
}

// The surface v14 really has: stage.pivot is the canvas point at the screen centre (board.mjs), stage.scale the zoom,
// app.renderer.screen the viewport in pixels. There is no canvas.visibleRect.
const view = (pivot, scale = 0.5, screen = { width: 1000, height: 600 }) => ({ stage: { pivot, scale: { x: scale } }, app: { renderer: { screen } } });

test("pointInView: the screen size over the zoom, around the pivot", async () => {
  const { pointInView } = await drops({});
  const screen = { width: 1000, height: 600 };
  // zoom 0.5: the view is 2000 x 1200 canvas units around the pivot
  assert.equal(pointInView({ x: 5050 + 999, y: 3300 }, { x: 5050, y: 3300 }, 0.5, screen), true);
  assert.equal(pointInView({ x: 5050 + 1001, y: 3300 }, { x: 5050, y: 3300 }, 0.5, screen), false);
  assert.equal(pointInView({ x: 5050, y: 3300 - 601 }, { x: 5050, y: 3300 }, 0.5, screen), false);
  assert.equal(pointInView({ x: 3850, y: 3250 }, { x: 5050, y: 3300 }, 0.5, screen), false, "the stale-selection drop of 2026-10-05, 1200 units left of the view");
});

test("pointInView: anything missing counts as in view, so no pan from guessed numbers", async () => {
  const { pointInView } = await drops({});
  assert.equal(pointInView({ x: 0, y: 0 }, undefined, 1, { width: 1, height: 1 }), true);
  assert.equal(pointInView({ x: 0, y: 0 }, { x: 5, y: 5 }, 0, { width: 1, height: 1 }), true);
  assert.equal(pointInView({ x: 0, y: 0 }, { x: 5, y: 5 }, 1, undefined), true);
});

test("a drop on the viewed scene is pinged, and panned to only when it is off screen", async () => {
  const pings = [];
  const pans = [];
  const { ItemDrops } = await drops({ scene: { id: "s1" }, ...view({ x: 5050, y: 3300 }), ping: (p) => pings.push(p), animatePan: async (p) => { pans.push(p); } });
  await ItemDrops._revealDrop({ id: "s1" }, 5100, 3300);
  assert.deepEqual([pings.length, pans.length], [1, 0], "on screen: ping only");
  await ItemDrops._revealDrop({ id: "s1" }, 3850, 3250);
  assert.deepEqual(pings[1], { x: 3850, y: 3250 });
  assert.equal(pans.length, 1, "off screen: pan there as well");
  assert.equal(pans[0].x, 3850);
});

test("a drop on a scene the GM is not viewing is left alone", async () => {
  const pings = [];
  const { ItemDrops } = await drops({ scene: { id: "s1" }, ping: (p) => pings.push(p) });
  await ItemDrops._revealDrop({ id: "other" }, 10, 10);
  assert.equal(pings.length, 0);
});
