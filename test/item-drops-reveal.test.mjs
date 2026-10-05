/** A dropped pile is a 0.5-size token: after a GM drop the view pings it and pans to it when it is off screen. */
import test from "node:test";
import assert from "node:assert/strict";

async function drops(canvasStub) {
  globalThis.foundry = { applications: { handlebars: { renderTemplate: async () => "" } }, utils: { deepClone: (o) => structuredClone(o) } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, TOKEN_DISPOSITIONS: { NEUTRAL: 0 } };
  globalThis.game = { user: { isGM: true }, settings: { get: () => true }, i18n: { localize: (k) => k, format: (k) => k } };
  globalThis.canvas = canvasStub;
  return (await import("../scripts/loot/item-drops.mjs")).ItemDrops;
}

test("a drop on the viewed scene is pinged, and panned to only when it is off screen", async () => {
  const pings = [];
  const pans = [];
  const view = { contains: (x, y) => x < 1000 && y < 1000 };
  const ItemDrops = await drops({
    scene: { id: "s1" },
    visibleRect: view,
    ping: (p) => pings.push(p),
    animatePan: async (p) => { pans.push(p); },
  });
  await ItemDrops._revealDrop({ id: "s1" }, 500, 500);
  assert.deepEqual([pings.length, pans.length], [1, 0], "on screen: ping only");
  await ItemDrops._revealDrop({ id: "s1" }, 3825, 3250);
  assert.deepEqual(pings[1], { x: 3825, y: 3250 });
  assert.equal(pans.length, 1, "off screen: pan there as well");
});

test("a drop on a scene the GM is not viewing is left alone", async () => {
  const pings = [];
  const ItemDrops = await drops({ scene: { id: "s1" }, ping: (p) => pings.push(p) });
  await ItemDrops._revealDrop({ id: "other" }, 10, 10);
  assert.equal(pings.length, 0);
});
