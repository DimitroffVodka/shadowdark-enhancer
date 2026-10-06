/**
 * The walls and doors that ship for each adventure map (adventure-walls.mjs): the pure planner, and checks on the data
 * itself. The data is the module's own measurement of a map, so it is tested the way a map is judged: nothing is out of
 * bounds, every outline is a closed loop, and a leak test: every numbered room sits inside a region the walls seal from
 * the rock around the dungeon, and the closed doors matter (opened, they join rooms).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADVENTURE_WALLS, wallsFor, hasWalls, planWalls, wallTypes } from "../scripts/importer/adventure/adventure-walls.mjs";
import { ADVENTURE_LAYOUTS } from "../scripts/importer/adventure/adventure-layouts.mjs";
import { mapFits } from "../scripts/importer/adventure/map-labels.mjs";

const TYPES = wallTypes({});

test("a ring becomes one wall per edge, closed back to its start, in the scene's pixels", () => {
  const data = { loops: [[[0, 0], [1, 0], [1, 1], [0, 1]]], solids: [], doors: [] };
  const w = planWalls(data, { x: 100, y: 50, width: 200, height: 100 }, TYPES);
  assert.deepEqual(w.map((x) => x.c), [[100, 50, 300, 50], [300, 50, 300, 150], [300, 150, 100, 150], [100, 150, 100, 50]]);
  assert.ok(w.every((x) => x.door === 0 && x.move === 20 && x.sight === 20), "plain walls: block movement and sight");
});

test("a door is one closed door segment, and a solid is walled all the way round", () => {
  const data = { loops: [], solids: [[[0.1, 0.1], [0.2, 0.1], [0.15, 0.2]]], doors: [[0.5, 0.2, 0.5, 0.3]] };
  const w = planWalls(data, { x: 0, y: 0, width: 1000, height: 1000 }, TYPES);
  assert.equal(w.length, 4);
  assert.deepEqual(w.at(-1).c, [500, 200, 500, 300]);
  assert.deepEqual([w.at(-1).door, w.at(-1).ds], [1, 0], "a closed door");
  assert.equal(w.filter((x) => x.door === 0).length, 3);
});

test("a repeated point makes no zero-length wall", () => {
  const w = planWalls({ loops: [[[0, 0], [0, 0], [1, 0], [1, 1]]], doors: [] }, { x: 0, y: 0, width: 10, height: 10 }, TYPES);
  assert.ok(w.every((x) => x.c[0] !== x.c[2] || x.c[1] !== x.c[3]));
});

test("a site with no data has no walls to build", () => {
  assert.equal(wallsFor("cs3-nothing"), null);
  assert.equal(hasWalls("cs3-nothing"), false);
  assert.deepEqual(planWalls(null, { x: 0, y: 0, width: 1, height: 1 }, TYPES), []);
});

test("the data is inside the map, and every outline is a loop of three or more points", () => {
  for (const [id, d] of Object.entries(ADVENTURE_WALLS)) {
    for (const ring of [...d.loops, ...d.solids]) {
      assert.ok(ring.length >= 3, `${id}: a loop of ${ring.length} points`);
      for (const [x, y] of ring) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${id}: a point outside the map`);
    }
    for (const dr of d.doors) assert.ok(dr.length === 4 && dr.every((v) => v >= 0 && v <= 1), `${id}: a door outside the map`);
    assert.ok(mapFits(d.aspect, 3600, Math.round(3600 / d.aspect)), `${id}: aspect`);
  }
});

/** Walls drawn onto a coarse grid (a quarter of a square a cell is plenty), then flood-filled from the page's corner. */
function sealed(id, { doorsClosed }) {
  const d = ADVENTURE_WALLS[id], W = 3600, H = Math.round(3600 / d.aspect), K = 4, w = Math.ceil(W / K) + 2, h = Math.ceil(H / K) + 2;
  const wall = new Uint8Array(w * h);
  const line = (x1, y1, x2, y2) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / K));
    for (let i = 0; i <= n; i++) {
      const cx = Math.round((x1 + ((x2 - x1) * i) / n) / K), cy = Math.round((y1 + ((y2 - y1) * i) / n) / K);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) wall[(cy + dy) * w + cx + dx] = 1;   // two cells thick: no diagonal leaks
    }
  };
  for (const w2 of planWalls({ ...d, doors: doorsClosed ? d.doors : [] }, { x: 0, y: 0, width: W, height: H }, TYPES)) line(...w2.c);
  const region = new Int32Array(w * h);
  let next = 0;
  const fill = (sx, sy) => {
    const id = ++next, stack = [sy * w + sx];
    region[stack[0]] = id;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!wall[q] && !region[q]) { region[q] = id; stack.push(q); }
      }
    }
  };
  fill(0, 0);
  const outside = region[0], rooms = new Map();
  for (const [num, [u, v]] of Object.entries(ADVENTURE_LAYOUTS[id].pins)) {
    const x = Math.round((u * W) / K), y = Math.round((v * H) / K);
    if (!region[y * w + x]) fill(x, y);
    const r = region[y * w + x];
    if (r === outside) rooms.set(`out:${num}`, r); else rooms.set(r, [...(rooms.get(r) ?? []), Number(num)]);
  }
  return { outside: [...rooms.keys()].filter((k) => String(k).startsWith("out:")), regions: [...rooms.entries()].filter(([k]) => !String(k).startsWith("out:")).map(([, v]) => v) };
}

test("leak test: every numbered room of The Hideous Halls is sealed from the rock around the dungeon", () => {
  const r = sealed("cs1-mugdulblub", { doorsClosed: true });
  assert.deepEqual(r.outside, [], "a room that opens onto the rock lets the light and the monsters out");
  assert.ok(r.regions.length >= 6, `the closed doors and walls make separate areas (${r.regions.length})`);
});

test("leak test: the doors are what separate those areas, so opened they join them", () => {
  const closed = sealed("cs1-mugdulblub", { doorsClosed: true }), open = sealed("cs1-mugdulblub", { doorsClosed: false });
  assert.ok(open.regions.length < closed.regions.length, `${open.regions.length} areas open, ${closed.regions.length} closed`);
  assert.deepEqual(open.outside, []);
});
