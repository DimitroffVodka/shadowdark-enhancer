/**
 * The walls and doors that ship for each adventure map (adventure-walls.mjs): the pure planner, and checks on the data
 * itself. The data is the module's own measurement of a map, so it is tested the way a map is judged: nothing is out of
 * bounds, every outline is a closed loop, and a leak test: every numbered room sits inside a region the walls seal from
 * the rock around the dungeon, and the closed doors matter (opened, they join rooms).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADVENTURE_WALLS, wallsFor, hasWalls, planWalls, wallTypes, onFloor } from "../scripts/importer/adventure/adventure-walls.mjs";
import { ADVENTURE_LAYOUTS } from "../scripts/importer/adventure/adventure-layouts.mjs";
import { mapFits } from "../scripts/importer/adventure/map-labels.mjs";
import { ADVENTURE_SITES } from "../scripts/importer/adventure/adventure-manifest.mjs";

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

/** Pins the book puts outside the walls on purpose: Iron Fortress 19, the stalagmite in the cave around the fortress. */
const OUTSIDE = { "cs2-iron-fortress": [19], "wrma-fallen-keep-emerald-knight": [1] };

/** Walls drawn onto a coarse grid (a quarter of a square a cell is plenty), then flood-filled from the page's corner. */
function sealed(id, { doorsClosed, data }) {
  const d = data ?? ADVENTURE_WALLS[id], W = 3600, H = Math.round(3600 / d.aspect), K = 4, w = Math.ceil(W / K) + 2, h = Math.ceil(H / K) + 2;
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
    if (OUTSIDE[id]?.includes(Number(num))) continue;
    let x = Math.round((u * W) / K), y = Math.round((v * H) / K);
    // A pin can sit on a wall line (a number written beside a partition): test from the nearest open cell.
    for (let r = 1; wall[y * w + x] && r < 8; r++) {
      const hit = [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]].find(([dx, dy]) => !wall[(y + dy) * w + x + dx]);
      if (hit) { x += hit[0]; y += hit[1]; }
    }
    if (!region[y * w + x]) fill(x, y);
    const r = region[y * w + x];
    if (r === outside) rooms.set(`out:${num}`, r); else rooms.set(r, [...(rooms.get(r) ?? []), Number(num)]);
  }
  // The corner fill cannot tell a room from an enclosed pocket of rock the walls also seal off. So: a room's region must
  // hold no cell the data's own floor test (loops filled, solids cut out) calls rock. Every 4th cell each way is plenty:
  // a gap that opens a room into a pocket opens it into thousands of cells. (A wall drawn at pixel p fills cells p/K and
  // p/K + 1, so cell x stands at pixel (x - 0.5) * K.)
  const rings = [...d.loops, ...d.solids].map((ring) => ring.map(([u, v]) => [u * W, v * H]));
  const rockRooms = [];
  for (const [rid, nums] of rooms) {
    if (String(rid).startsWith("out:")) continue;
    let rock = 0;
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) if (region[y * w + x] === rid && !onFloor(rings, (x - 0.5) * K, (y - 0.5) * K)) rock++;
    if (rock) rockRooms.push({ rooms: nums, rock });
  }
  return { rockRooms, outside: [...rooms.keys()].filter((k) => String(k).startsWith("out:")), regions: [...rooms.entries()].filter(([k]) => !String(k).startsWith("out:")).map(([, v]) => v) };
}

for (const id of Object.keys(ADVENTURE_WALLS)) {
  test(`leak test: every numbered room of ${id} is sealed from the rock around the dungeon`, () => {
    const r = sealed(id, { doorsClosed: true });
    assert.deepEqual(r.outside, [], "a room that opens onto the rock lets the light and the monsters out");
    assert.deepEqual(r.rockRooms, [], "a room that opens into an enclosed pocket of rock has a gap in its walls");
    assert.ok(r.regions.length >= 1, "every room is in a sealed area");
    if (ADVENTURE_WALLS[id].doors.length >= 6) assert.ok(r.regions.length >= 3, `the closed doors and walls make separate areas (${r.regions.length})`);
  });

  test(`leak test: the doors of ${id} are what separate those areas, so opened they join them`, () => {
    const closed = sealed(id, { doorsClosed: true }), open = sealed(id, { doorsClosed: false });
    if (ADVENTURE_WALLS[id].doors.length) assert.ok(open.regions.length <= closed.regions.length, `${open.regions.length} areas open, ${closed.regions.length} closed`);
    if (ADVENTURE_WALLS[id].doors.length >= 6) assert.ok(open.regions.length < closed.regions.length, `${open.regions.length} areas open, ${closed.regions.length} closed`);
    assert.deepEqual(open.outside, []);
  });
}

// Mutation check on the leak test itself: take away the whole outline of a room and the test must notice. Without the rock
// check only a room that falls open to the page margin is noticed; one that falls open into an enclosed pocket is not.
for (const id of Object.keys(ADVENTURE_WALLS)) {
  test(`leak test: ${id} notices a room whose whole outline is gone`, () => {
    const d = ADVENTURE_WALLS[id], H = Math.round(3600 / d.aspect), pins = Object.entries(ADVENTURE_LAYOUTS[id].pins).filter(([n]) => !(OUTSIDE[id] ?? []).includes(Number(n)));
    const hit = d.loops.map((loop, i) => ({ i, ring: loop.map(([u, v]) => [u * 3600, v * H]) })).filter(({ ring }) => pins.some(([, [u, v]]) => onFloor([ring], u * 3600, v * H)));
    assert.ok(hit.length > 0, "some outline holds a room");
    const missed = hit.filter(({ i }) => {
      const r = sealed(id, { doorsClosed: true, data: { ...d, loops: d.loops.filter((_, j) => j !== i) } });
      return !r.outside.length && !r.rockRooms.length;
    }).map(({ i }) => i);
    assert.deepEqual(missed, [], "outlines whose removal the leak test did not flag");
  });
}

// ── lights, and where a creature may stand ──
import { planLights, reachableSquares } from "../scripts/importer/adventure/adventure-walls.mjs";
import { planCreatureTokens } from "../scripts/importer/adventure/adventure-scene.mjs";

/** A 80 x 30 hall of 10 px squares with a dividing wall at x = 40 that has one doorway (a closed door, y 10 to 20), and a pillar at (10..20, 10..20). */
const HALL = {
  loops: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
  solids: [[[0.125, 1 / 3], [0.25, 1 / 3], [0.25, 2 / 3], [0.125, 2 / 3]], [[0.4875, 0], [0.5125, 0], [0.5125, 1 / 3], [0.4875, 1 / 3]], [[0.4875, 2 / 3], [0.5125, 2 / 3], [0.5125, 1], [0.4875, 1]]],
  doors: [[0.5, 1 / 3, 0.5, 2 / 3]],
};
const RECT = { x: 0, y: 0, width: 80, height: 30 };

test("the squares of a room: nearest first, never the pillar's, and never past a closed door or a wall", () => {
  const sq = reachableSquares(HALL, RECT, 10, { x: 5, y: 5 });
  assert.deepEqual(sq[0], [0, 0], "the pin's own square first");
  assert.equal(sq.length, 11, "the 4 x 3 room less the pillar's square");
  assert.ok(sq.every(([c]) => c < 4), "the other room is behind the closed door");
  assert.ok(!sq.some(([c, r]) => c === 1 && r === 1), "not on the pillar");
  const dist = sq.map(([c, r]) => c + r);
  assert.deepEqual(dist, [...dist].sort((a, b) => a - b), "nearest first (steps from the pin)");
});

test("a pin in the rock has no squares, and a pin just off the floor starts from the nearest floor", () => {
  assert.deepEqual(reachableSquares(HALL, RECT, 10, { x: 400, y: 400 }), []);
  assert.ok(reachableSquares(HALL, RECT, 10, { x: 5, y: 31 }).length > 0);
  assert.ok(reachableSquares(HALL, RECT, 10, { x: 15, y: 15 }).length > 0, "a pin on the pillar starts beside it");
});

test("creatures stand in their own room's squares when the walls are known, and around the pin when they are not", () => {
  const args = { creatures: { 1: [{ monster: "Gribble", count: 4 }] }, pins: { 1: { x: 5, y: 5 } }, rect: RECT, gridSize: 10 };
  const walled = planCreatureTokens({ ...args, roomSquares: (n, pin) => reachableSquares(HALL, RECT, 10, pin) });
  assert.equal(walled.length, 4);
  assert.ok(walled.every((p) => p.x < 40 && !(p.x === 10 && p.y === 10) && !(p.x === 0 && p.y === 0)), "in the room, off the pillar, off the pin's square");
  assert.equal(planCreatureTokens(args).length, 4, "no walls: the old squares around the pin");
});

test("more creatures than the room has squares fill the room and stop, rather than spill through a door", () => {
  const plan = planCreatureTokens({ creatures: { 1: [{ monster: "Gribble", count: 30 }] }, pins: { 1: { x: 5, y: 5 } }, rect: RECT, gridSize: 10, roomSquares: (n, pin) => reachableSquares(HALL, RECT, 10, pin) });
  assert.equal(plan.length, 10, "eleven squares less the pin's own");
  assert.ok(plan.every((p) => p.x < 40));
});

test("the Halls: a creature filed under a room never stands in rock, another room, or past a door", () => {
  const d = ADVENTURE_WALLS["cs1-mugdulblub"], rect = { x: 0, y: 0, width: 3600, height: 2329 }, pins = ADVENTURE_LAYOUTS["cs1-mugdulblub"].pins;
  const pinPx = (n) => ({ x: pins[n][0] * rect.width, y: pins[n][1] * rect.height });
  const squareOf = (p) => [Math.floor(p.x / 53), Math.floor(p.y / 53)].join(",");
  const cache = new Map();
  const mine = (n) => cache.get(n) ?? cache.set(n, new Set(reachableSquares(d, rect, 53, pinPx(n)).map((s) => s.join(",")))).get(n);
  assert.ok(mine(12).size >= 15 && mine(12).size < 80, `room 12 has its own squares (${mine(12).size})`);
  for (const n of [4, 8, 9, 10, 11, 12, 18, 21, 25]) assert.ok(mine(n).size > 0, `room ${n} has floor to stand on`);
  // The sealed areas the closed doors make (the leak test above): a creature never reaches a pin in another area.
  const areaOf = new Map();
  for (const area of sealed("cs1-mugdulblub", { doorsClosed: true }).regions) for (const n of area) areaOf.set(n, area);
  const leaks = [];
  for (const [a, area] of areaOf) for (const b of areaOf.keys()) if (a !== b && !area.includes(b) && mine(a).has(squareOf(pinPx(b)))) leaks.push(`${a}->${b}`);
  assert.deepEqual(leaks, [], "no room's squares reach a pin the walls and closed doors separate it from");
});

for (const id of Object.keys(ADVENTURE_WALLS)) {
  test(`${id}: a creature filed under a room never stands in rock, another room, or past a door`, () => {
    const d = ADVENTURE_WALLS[id], H = Math.round(3600 / d.aspect), rect = { x: 0, y: 0, width: 3600, height: H }, pins = ADVENTURE_LAYOUTS[id].pins;
    const cols = Object.values(ADVENTURE_SITES).flat().find((x) => x.id === id).grid[0], grid = 3600 / cols;
    const pinPx = (n) => ({ x: pins[n][0] * rect.width, y: pins[n][1] * rect.height });
    const squareOf = (p) => [Math.floor(p.x / grid), Math.floor(p.y / grid)].join(",");
    const cache = new Map();
    const mine = (n) => cache.get(n) ?? cache.set(n, new Set(reachableSquares(d, rect, grid, pinPx(n)).map((q) => q.join(",")))).get(n);
    const rooms = Object.keys(pins).filter((n) => !(OUTSIDE[id] ?? []).includes(Number(n)));
    for (const n of rooms) assert.ok(mine(n).size >= 1, `room ${n} has floor to stand on`);
    const areaOf = new Map();
    for (const area of sealed(id, { doorsClosed: true }).regions) for (const n of area) areaOf.set(String(n), area.map(String));
    const leaks = [];
    for (const [a, area] of areaOf) for (const b of areaOf.keys()) if (a !== b && !area.includes(b) && mine(a).has(squareOf(pinPx(b)))) leaks.push(`${a}->${b}`);
    assert.deepEqual(leaks, [], "no room's squares reach a pin the walls and closed doors separate it from");
  });
}

test("a room of more than 200 squares is filled whole: the Sea Wolf's room 4 takes 300 creatures, none dropped", () => {
  const id = "cs3-sea-wolf", d = ADVENTURE_WALLS[id], H = Math.round(3600 / d.aspect), rect = { x: 0, y: 0, width: 3600, height: H }, pins = ADVENTURE_LAYOUTS[id].pins;
  const grid = 3600 / Object.values(ADVENTURE_SITES).flat().find((x) => x.id === id).grid[0], px = { 4: { x: pins[4][0] * 3600, y: pins[4][1] * H } };
  const room = reachableSquares(d, rect, grid, px[4]);
  assert.ok(room.length > 800, `room 4 has ${room.length} squares`);
  const plan = planCreatureTokens({ creatures: { 4: [{ monster: "Sea Rat", count: 300 }] }, pins: px, rect, gridSize: grid, roomSquares: (n, pin) => reachableSquares(d, rect, grid, pin) });
  assert.equal(plan.length, 300, "every creature has a square");
  assert.equal(new Set(plan.map((p) => `${p.x},${p.y}`)).size, 300, "no two share one");
  const mine = new Set(room.map(([c, r]) => `${c * grid},${r * grid}`));
  assert.ok(plan.every((p) => mine.has(`${p.x},${p.y}`)), "all in the room");
});

test("the Iron Fortress's lights are the magma river and the fire curtain, each inside the fortress", () => {
  const l = planLights(ADVENTURE_WALLS["cs2-iron-fortress"], { x: 0, y: 0, width: 3600, height: 2800 });
  assert.equal(l.length, 10);
  assert.ok(l.every((x) => x.x > 0 && x.x < 3600 && x.y > 0 && x.y < 2800 && x.config.dim > x.config.bright));
  assert.equal(l.filter((x) => /curtain/i.test(x.flags["shadowdark-enhancer"].adventureLight)).length, 1);
});

test("the lights ship in the scene's pixels with the fire's radii, flagged for a re-run", () => {
  const l = planLights(ADVENTURE_WALLS["cs1-mugdulblub"], { x: 100, y: 0, width: 3600, height: 2329 });
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].config.bright, l[0].config.dim], [20, 40]);
  assert.ok(l[0].x > 100 && l[0].y > 0 && l[0].flags["shadowdark-enhancer"].adventureLight);
  assert.deepEqual(l[0].config.darkness, { min: 0.5, max: 1 }, "it only lights up once the GM darkens the scene");
  assert.deepEqual(planLights(null, RECT), []);
});
