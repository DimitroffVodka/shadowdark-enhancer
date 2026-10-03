import test from "node:test";
import assert from "node:assert/strict";
import { coordinateLabels, coordinateVisible } from "../scripts/hex-map/coordinate-overlay.mjs";
import { hexNumberAt } from "../scripts/hex-map/hex-number-api.mjs";
import { cellNumber, foundryOffsetToCube, originFromFlag } from "../scripts/hex-map/geometry.mjs";
import { planPins } from "../scripts/hex-map/hex-pins.mjs";

globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 } };
for (const type of [4, 5]) test(`labels, tagger and keyed pins share shifted ${type} identity`, () => {
  const even = type === 5;
  const cube = foundryOffsetToCube({ i: 3, j: 2 }, even);
  const origin = { ...cube, num: "0001", shifted: "even", bounds: { cols: 3, rows: 3, base: { col: 0, row: 1 } } };
  const scene = { uuid: "Scene.test", grid: { type }, getFlag: () => ({ origin }) };
  const grid = { getCenterPoint: ({ i, j }) => ({ x: j * 75 + 50, y: i * 100 + (j % 2 === Number(even) ? 50 : 0) }) };
  const cells = [];
  for (let i = 1; i < 8; i++) for (let j = 0; j < 7; j++) cells.push({ i, j });
  const labels = coordinateLabels({ scene, grid, cells, numberAt: hexNumberAt, visible: () => true });
  assert.ok(labels.length > 0);
  assert.equal(labels.find(l => l.i === 3 && l.j === 2).text, "0001");
  for (const label of labels) {
    assert.equal(label.num, cellNumber(foundryOffsetToCube(label, even), originFromFlag(origin)).num);
    const pin = planPins([{ id: "page", num: label.num, name: label.text }], new Map([[label.num, label]]), [], { entryId: "entry" }).create[0];
    assert.equal(pin.flags["shadowdark-enhancer"].hexPin.num, label.num);
    assert.equal(pin.x, label.x); assert.equal(pin.y, label.y);
    assert.equal(label.key, `Scene.test:${label.i},${label.j}`);
  }
  assert.equal(coordinateLabels({ scene, grid, cells, numberAt: hexNumberAt, visible: () => false }).length, 0);
});

test("off-map, unsupported and unnumbered cells never invent labels", () => {
  const grid = { getCenterPoint: () => ({ x: 0, y: 0 }) };
  for (const scene of [{ grid: { type: 1 }, getFlag: () => ({ origin: {} }) }, { grid: { type: 4 }, getFlag: () => null }]) {
    assert.deepEqual(coordinateLabels({ scene, grid, cells: [{ i: 0, j: 0 }], numberAt: hexNumberAt, visible: () => true }), []);
  }
});

test("player disclosure follows active fog, fails closed and preserves the GM exception", () => {
  const point = { x: 12, y: 34 }, scene = { tokenVision: false };
  const extras = { active: true, api: { hex: { isPositionRevealed: (s, p) => s === scene && p === point } } };
  assert.equal(coordinateVisible(scene, point, { isGM: false, extras }), true);
  extras.api.hex.isPositionRevealed = () => false;
  assert.equal(coordinateVisible(scene, point, { isGM: false, extras }), false);
  assert.equal(coordinateVisible(scene, point, { isGM: true, extras }), true);
  extras.api.hex.isPositionRevealed = () => { throw Error("unavailable"); };
  assert.equal(coordinateVisible(scene, point, { isGM: false, extras }), false);
  extras.api = {};
  assert.equal(coordinateVisible(scene, point, { isGM: false, extras }), false);
  assert.equal(coordinateVisible(scene, point, { isGM: false }), true, "no fog owner: open map");
  const fogScene = { tokenVision: true };
  assert.equal(coordinateVisible(fogScene, point, { isGM: false, explored: () => false, sight: () => false }), false);
  assert.equal(coordinateVisible(fogScene, point, { isGM: false, explored: () => true }), true);
  assert.equal(coordinateVisible(fogScene, point, { isGM: false, sight: () => true }), true);
});
