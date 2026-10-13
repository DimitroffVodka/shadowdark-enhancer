import test from "node:test";
import assert from "node:assert/strict";
import { networkLines, smoothPath, OVERLAY_FLAG } from "../scripts/hex-map/map-network.mjs";

// The shape Extras' hexcrawl builder writes to a scene's `permanentDrawings` flag (HexcrawlBuilderSD).
const network = (over = {}) => ({
  drawingId: "map-network-a", type: "mapNetwork", permanent: true,
  strokeWidth: 38.4, roadColor: "#D8C6A8", riverColor: "#2D9CDB", roadStyle: "art", opacity: 1,
  networkPaths: {
    road: [[[0, 0], [100, 0], [100, 100]]],
    river: [[[0, 50], [200, 50]], [[10, 10], [20, 20], [30, 10]]],
  },
  ...over,
});

test("the flag name is the one Extras writes", () => assert.equal(OVERLAY_FLAG, "permanentDrawings"));

test("rivers go down first so a road over one reads as a bridge", () => {
  const lines = networkLines([network()]);
  assert.deepEqual(lines.map((l) => l.kind), ["river", "river", "road"]);
});

test("each path keeps its ends and takes its colour and width from the entry", () => {
  const [river] = networkLines([network()]);
  assert.equal(river.color, 0x2d9cdb);
  assert.equal(river.width, 38.4);
  assert.equal(river.alpha, 1);
  // a two-point path is a straight line: smoothing leaves it alone
  assert.deepEqual(river.points, [0, 50, 200, 50]);
  const road = networkLines([network()]).find((l) => l.kind === "road");
  assert.equal(road.color, 0xd8c6a8);
  assert.deepEqual(road.points.slice(0, 2), [0, 0]);
  assert.deepEqual(road.points.slice(-2), [100, 100]);
  assert.ok(road.points.length > 6, "the corner is cut, so there are more points than the three given");
});

test("smoothing never moves an end and adds points only for paths with a corner", () => {
  const path = [[0, 0], [10, 0], [10, 10]];
  const out = smoothPath(path);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out.at(-1), [10, 10]);
  assert.deepEqual(smoothPath([[0, 0], [5, 5]]), [[0, 0], [5, 5]]);
  assert.deepEqual(smoothPath(path, 0), path);
});

test("an entry without colours or width falls back to Extras' own defaults", () => {
  const entry = network({ strokeWidth: undefined, roadColor: undefined, riverColor: "not-a-colour", opacity: undefined });
  const lines = networkLines([entry]);
  assert.equal(lines.find((l) => l.kind === "road").color, 0xd8c6a8);
  assert.equal(lines.find((l) => l.kind === "river").color, 0x2d9cdb);
  assert.ok(lines.every((l) => l.width > 0 && l.alpha === 1));
});

test("only road and river networks are drawn; sketches, stamps and malformed paths are not", () => {
  const sketch = { drawingId: "s", type: "box", startX: 0, startY: 0, width: 5, height: 5 };
  const stamp = { drawingId: "t", symbolType: "x", x: 1, y: 1 };
  const bad = network({ networkPaths: { road: [[[0, 0]], "x", [[0, 0], ["a", 1], [5, 5]]], river: null } });
  assert.deepEqual(networkLines([sketch, stamp]), []);
  const lines = networkLines([bad]);
  assert.equal(lines.length, 1, "the one-point and non-array paths are dropped, the bad point filtered");
  assert.deepEqual(lines[0].points, [0, 0, 5, 5]);
});

test("a hidden network is for the GM only", () => {
  const hidden = network({ hidden: true });
  assert.equal(networkLines([hidden]).length, 0);
  assert.equal(networkLines([hidden], { isGM: true }).length, 3);
});

test("no flag, or a flag of the wrong shape, draws nothing and does not throw", () => {
  for (const value of [undefined, null, "", 5, {}, [null], [{}]]) assert.deepEqual(networkLines(value), []);
});
