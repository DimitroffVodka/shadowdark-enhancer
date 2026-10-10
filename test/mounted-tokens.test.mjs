import test from "node:test";
import assert from "node:assert/strict";
import {
  riderCorner, isAtCorner, finalPoint, isCarried, followPath, gapSquares, pickMount,
} from "../scripts/mounted/mounted-core.mjs";

const G = 100;
const horse = { id: "horse", x: 500, y: 300, width: 2, height: 2 };
const knight = { id: "knight", x: 0, y: 0, width: 1, height: 1 };

test("the rider stands in the mount's bottom-left square", () => {
  assert.deepEqual(riderCorner(horse, knight, G), { x: 500, y: 400 });
  assert.ok(isAtCorner({ x: 500, y: 400 }, horse, knight, G));
  assert.ok(!isAtCorner({ x: 600, y: 400 }, horse, knight, G));
  assert.ok(!isAtCorner(null, horse, knight, G));
});

test("a movement ends at its last pending waypoint while paused, else at its destination", () => {
  assert.deepEqual(finalPoint({ destination: { x: 1, y: 2 }, pending: { waypoints: [] } }), { x: 1, y: 2 });
  assert.deepEqual(finalPoint({ destination: { x: 1, y: 2 }, pending: { waypoints: [{ x: 7, y: 8 }] } }), { x: 7, y: 8 });
  assert.equal(finalPoint(undefined), null);
});

test("a move that ends in the mount's corner is the carry; anything else splits the pair", () => {
  const carry = { destination: { x: 500, y: 400 }, pending: { waypoints: [] } };
  const own = { destination: { x: 700, y: 400 }, pending: { waypoints: [] } };
  // Paused at a trap region part way: still the carry, because it is still headed for the corner.
  const paused = { destination: { x: 450, y: 400 }, pending: { waypoints: [{ x: 500, y: 400 }] } };
  assert.ok(isCarried(carry, horse, knight, G));
  assert.ok(isCarried(paused, horse, knight, G));
  assert.ok(!isCarried(own, horse, knight, G));
  assert.ok(!isCarried(carry, null, knight, G), "a deleted mount carries nothing");
});

test("the rider follows the mount's waypoints in its corner, keeping elevation, level and action", () => {
  const path = followPath([
    { x: 600, y: 300, elevation: 0, width: 2, height: 2, action: "walk", level: "L1" },
    { x: 600, y: 500, elevation: 5, width: 2, height: 2, action: "displace" },
  ], knight, G);
  assert.deepEqual(path, [
    { x: 600, y: 400, elevation: 0, level: "L1", action: "walk" },
    { x: 600, y: 600, elevation: 5, action: "displace" },
  ]);
  // No action on the waypoint (the mount's stored position, used to mount up): the rider uses its own.
  assert.deepEqual(followPath([{ x: 0, y: 0, elevation: 0, width: 2, height: 2 }], knight, G), [{ x: 0, y: 100, elevation: 0 }]);
});

test("gap between tokens counts whole squares, touching and diagonal neighbours are 0", () => {
  assert.equal(gapSquares({ x: 400, y: 300, width: 1, height: 1 }, horse, G), 0);
  assert.equal(gapSquares({ x: 400, y: 200, width: 1, height: 1 }, horse, G), 0);
  assert.equal(gapSquares({ x: 300, y: 300, width: 1, height: 1 }, horse, G), 1);
  assert.equal(gapSquares({ x: 900, y: 300, width: 1, height: 1 }, horse, G), 2);
});

test("pick the targeted mount in reach, else the nearest free one", () => {
  const rider = { ...knight, x: 400, y: 300 };
  const pony = { id: "pony", x: 200, y: 300, width: 2, height: 2 };   // 0 squares away (touching on the left)
  const far = { id: "far", x: 1000, y: 300, width: 2, height: 2 };
  assert.equal(pickMount(rider, [horse, pony, far], { gridSize: G }), "horse");
  assert.equal(pickMount(rider, [horse, pony, far], { targets: ["pony"], gridSize: G }), "pony");
  assert.equal(pickMount(rider, [horse, pony, far], { targets: new Set(["far"]), gridSize: G }), "horse", "a target out of reach is not picked");
});

test("no mount: too small, ridden, out of reach, itself, or the rider carries someone", () => {
  const rider = { ...knight, x: 400, y: 300 };
  const dog = { id: "dog", x: 300, y: 300, width: 1, height: 1 };
  assert.equal(pickMount(rider, [dog], { gridSize: G }), null);
  assert.equal(pickMount(rider, [{ ...horse, busy: true }], { gridSize: G }), null);
  assert.equal(pickMount(rider, [{ ...horse, x: 700 }], { gridSize: G }), null);
  assert.equal(pickMount({ ...rider, width: 2, height: 2, id: "horse" }, [horse], { gridSize: G }), null);
  assert.equal(pickMount({ ...rider, busy: true }, [horse], { gridSize: G }), null);
});
