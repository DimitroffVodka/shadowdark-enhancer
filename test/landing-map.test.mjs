/**
 * Landing table Map: the pure parts of the table's fogged picture (landing-map.mjs) — where the copy places the map's
 * background, what identifies a copy and a fogged mask, and which fog records a player asks for.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { placement, pictureKey, fogKey, exploredRecords } from "../scripts/town/landing-map.mjs";

const TEXTURES = { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, fit: "fill", scaleX: 1, scaleY: 1, rotation: 0 };
const at = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f].map((n) => Math.round(n * 1000) / 1000 + 0);
const scene = ({ textures = {}, rect = { x: 250, y: 150, width: 1200, height: 600 }, grid = { type: 2, size: 100 } } = {}) => ({
  id: "s1", initialLevel: { id: "L1", background: { src: "maps/m.webp" }, textures: { ...TEXTURES, ...textures } },
  dimensions: { sceneRect: rect }, grid,
});

test("the copy places the background in the scene's rectangle as Foundry does: offset, fit, scale, rotation", () => {
  const rect = { width: 1200, height: 600 };
  // The review's case: offsetX 300 on a 1200x600 scene moves the picture's (450,300) to the scene's (750,300).
  assert.deepEqual(at(placement(rect, { ...TEXTURES, offsetX: 300 }, 1200, 600, 1200), 450, 300), [750, 300]);
  assert.deepEqual(at(placement(rect, TEXTURES, 1200, 600, 1200), 450, 300), [450, 300]);           // default: as it is
  // A 2400-wide copy source fills the rectangle, and the copy is drawn 600 wide: half scale throughout.
  assert.deepEqual(at(placement(rect, TEXTURES, 2400, 1200, 600), 2400, 1200), [600, 300]);
  // contain: a square picture keeps its shape, centred; rotated 90 degrees about its centre.
  assert.deepEqual(at(placement(rect, { ...TEXTURES, fit: "contain" }, 100, 100, 1200), 0, 0), [300, 0]);
  assert.deepEqual(at(placement(rect, { ...TEXTURES, fit: "contain", rotation: 90 }, 100, 100, 1200), 0, 0), [900, 0]);
  // anchor top-left at the centre, flipped by a negative scale.
  assert.deepEqual(at(placement(rect, { ...TEXTURES, anchorX: 0, anchorY: 0, scaleX: -1 }, 1200, 600, 1200), 100, 0), [500, 300]);
});

test("a copy is made again when its picture or where the scene places it changes", () => {
  const base = pictureKey(scene());
  assert.equal(pictureKey(scene()), base);
  for (const textures of [{ offsetX: 300 }, { offsetY: 1 }, { anchorX: 0 }, { fit: "cover" }, { scaleX: 2 }, { rotation: 90 }])
    assert.notEqual(pictureKey(scene({ textures })), base, JSON.stringify(textures));
  assert.notEqual(pictureKey(scene({ rect: { x: 250, y: 150, width: 1200, height: 700 } })), base);
  assert.equal(pictureKey({ initialLevel: { background: { src: null } }, dimensions: { sceneRect: {} } }), null);
});

test("a fogged mask is cached only for the same scene, level, rectangle and grid", () => {
  const key = fogKey(scene(), "u.webp", "3.4");
  assert.equal(fogKey(scene(), "u.webp", "3.4"), key);
  assert.notEqual(fogKey(scene({ grid: { type: 2, size: 150 } }), "u.webp", "3.4"), key);   // the review's grid 100 -> 150
  assert.notEqual(fogKey(scene({ grid: { type: 4, size: 100 } }), "u.webp", "3.4"), key);
  assert.notEqual(fogKey(scene({ rect: { x: 300, y: 150, width: 1200, height: 600 } }), "u.webp", "3.4"), key);
  assert.notEqual(fogKey({ ...scene(), id: "s2" }, "u.webp", "3.4"), key);
  assert.notEqual(fogKey({ ...scene(), initialLevel: { ...scene().initialLevel, id: "L2" } }, "u.webp", "3.4"), key);
});

test("a player asks for the whole table's fog only on a shared-fog scene", async (t) => {
  // The server's FogExploration pre-get: the user filter is lifted only for queryOptions.sharedFog.
  const docs = [{ id: "mine", user: "me", explored: "a" }, { id: "theirs", user: "them", explored: "b" }, { id: "blank", user: "x" }];
  const asked = [];
  globalThis.CONST = { FOG_EXPLORATION_MODES: { DISABLED: 0, INDIVIDUAL: 1, SHARED: 2 } };
  globalThis.game = { user: { id: "me" } };
  globalThis.CONFIG = { FogExploration: { documentClass: { database: { get: async (_cls, op) => {
    asked.push(op);
    return op.queryOptions?.sharedFog ? docs : docs.filter((d) => d.user === op.query.user);
  } } } } };
  t.after(() => { delete globalThis.CONST; delete globalThis.game; delete globalThis.CONFIG; });
  const map = (mode) => ({ ...scene(), fog: { mode } });

  assert.deepEqual((await exploredRecords(map(2))).map((d) => d.id), ["mine", "theirs"]);
  assert.deepEqual(asked.at(-1), { query: { scene: "s1", level: "L1", user: "me" }, queryOptions: { sharedFog: true } });
  assert.deepEqual((await exploredRecords(map(1))).map((d) => d.id), ["mine"]);                // individual stays private
  assert.equal(asked.at(-1).queryOptions, undefined);
  docs.shift();   // a viewer with no record of their own still sees what the table explored
  assert.deepEqual((await exploredRecords(map(2))).map((d) => d.id), ["theirs"]);
  assert.deepEqual(await exploredRecords(map(1)), []);
});
