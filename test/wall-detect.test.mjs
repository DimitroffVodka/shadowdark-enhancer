/**
 * Walls and doors found on a dungeon map (wall-detect.mjs): a drawn stand-in for a site map, 16 x 12 squares of 40 px with
 * one room (heavy 6 px walls, thin 2 px floor tiles inside, stipple dots outside) and one door glyph on its east wall.
 * Invented art only: the real maps are the GM's.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectWallsAndDoors, toSegments, edgeIndex, EDGE } from "../scripts/importer/adventure/wall-detect.mjs";

const P = 40, COLS = 16, ROWS = 12, W = COLS * P, H = ROWS * P;
const room = { c0: 3, c1: 12, r0: 3, r1: 9 };   // grid lines of the room's corners

/** A white page with a few drawing calls; one byte per pixel, 0 black. */
function page() {
  const gray = new Uint8Array(W * H).fill(255);
  const rect = (x0, y0, x1, y1, v) => { for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) gray[y * W + x] = v; };
  return { gray, rect };
}

function drawRoom({ door = true, stipple = true } = {}) {
  const { gray, rect } = page();
  const x = (c) => c * P, y = (r) => r * P;
  // floor tiles: thin lines on every grid line inside the room
  for (let c = room.c0; c <= room.c1; c++) rect(x(c) - 1, y(room.r0), x(c) + 1, y(room.r1), 70);
  for (let r = room.r0; r <= room.r1; r++) rect(x(room.c0), y(r) - 1, x(room.c1), y(r) + 1, 70);
  // heavy walls, 6 px, centred on the room's outline
  rect(x(room.c0) - 3, y(room.r0) - 3, x(room.c1) + 3, y(room.r0) + 3, 15);
  rect(x(room.c0) - 3, y(room.r1) - 3, x(room.c1) + 3, y(room.r1) + 3, 15);
  rect(x(room.c0) - 3, y(room.r0) - 3, x(room.c0) + 3, y(room.r1) + 3, 15);
  rect(x(room.c1) - 3, y(room.r0) - 3, x(room.c1) + 3, y(room.r1) + 3, 15);
  if (door) {
    // the east wall opens over one edge (row 5), and the glyph sits there: two 5 px strokes 17 px apart, open between
    rect(x(room.c1) - 3, y(5), x(room.c1) + 3, y(6), 255);
    rect(x(room.c1) - 8, y(5) - 2, x(room.c1) - 3, y(6) + 2, 15);   // west stroke
    rect(x(room.c1) + 6, y(5) - 2, x(room.c1) + 11, y(6) + 2, 15);  // east stroke
    rect(x(room.c1) - 8, y(5) - 2, x(room.c1) + 11, y(5) + 1, 15);  // caps
    rect(x(room.c1) - 8, y(6) - 1, x(room.c1) + 11, y(6) + 2, 15);
  }
  if (stipple) {
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 400; i++) { const px = rnd() * W, py = rnd() * H; if (px > x(room.c0) && px < x(room.c1) && py > y(room.r0) && py < y(room.r1)) continue; rect(px, py, px + 3, py + 3, 20); }
  }
  return gray;
}

const edgesOf = (r, kind) => {
  const list = [];
  const [n, m] = kind === "v" ? [r.rows, r.cols + 1] : [r.rows + 1, r.cols];
  for (let j = 0; j < n; j++) for (let c = 0; c < m; c++) { const e = (kind === "v" ? r.vertical : r.horizontal)[edgeIndex(r, kind, j, c)]; if (e) list.push([j, c, e]); }
  return list;
};

test("the room's outline is found edge by edge, and the floor tiles and the stipple are not", () => {
  const r = detectWallsAndDoors({ gray: drawRoom({ door: false }), width: W, height: H, cols: COLS, rows: ROWS });
  const walls = (k) => edgesOf(r, k).filter(([, , e]) => e === EDGE.WALL);
  const horizontals = walls("h").map(([j, c]) => `${j},${c}`).sort();
  const expectH = [];
  for (let c = room.c0; c < room.c1; c++) expectH.push(`${room.r0},${c}`, `${room.r1},${c}`);
  assert.deepEqual(horizontals, expectH.sort());
  const verticals = walls("v").map(([j, c]) => `${j},${c}`).sort();
  const expectV = [];
  for (let j = room.r0; j < room.r1; j++) expectV.push(`${j},${room.c0}`, `${j},${room.c1}`);
  assert.deepEqual(verticals, expectV.sort());
  assert.equal(r.doors, 0);
  assert.equal(r.confident, true);
  assert.ok(Math.abs(r.offsetX) < 2 && Math.abs(r.offsetY) < 2, "the first grid line is at the corner of the page");
});

test("a door glyph over one edge of a wall is a door, and the wall around it stays wall", () => {
  const r = detectWallsAndDoors({ gray: drawRoom(), width: W, height: H, cols: COLS, rows: ROWS });
  const doors = [...edgesOf(r, "v"), ...edgesOf(r, "h")].filter(([, , e]) => e === EDGE.DOOR);
  assert.deepEqual(edgesOf(r, "v").filter(([, , e]) => e === EDGE.DOOR).map(([j, c]) => [j, c]), [[5, room.c1]]);
  assert.equal(doors.length, 1, "no other edge is mistaken for a door");
  // the east wall is wall on every edge but the door's
  const east = edgesOf(r, "v").filter(([, c]) => c === room.c1).map(([j, , e]) => [j, e]);
  assert.deepEqual(east, [[3, 1], [4, 1], [5, 2], [6, 1], [7, 1], [8, 1]]);
});

test("a blank page has no walls and no doors", () => {
  const r = detectWallsAndDoors({ gray: new Uint8Array(W * H).fill(255), width: W, height: H, cols: COLS, rows: ROWS });
  assert.deepEqual([r.walls, r.doors, r.confident], [0, 0, false]);
});

test("straight runs join into one wall each, and every door is its own", () => {
  const r = detectWallsAndDoors({ gray: drawRoom(), width: W, height: H, cols: COLS, rows: ROWS });
  const segs = toSegments(r);
  const doors = segs.filter((s) => s.door), walls = segs.filter((s) => !s.door);
  assert.equal(doors.length, 1);
  // north and south walls, the west wall, and the east wall in two pieces around the door
  assert.equal(walls.length, 5);
  const north = walls.find((s) => Math.abs(s.c[1] - room.r0 * P) < 2 && Math.abs(s.c[3] - room.r0 * P) < 2);
  assert.ok(Math.abs(north.c[0] - room.c0 * P) < 2 && Math.abs(north.c[2] - room.c1 * P) < 2, "the whole length, corner to corner");
  const [x0, y0, x1, y1] = doors[0].c;
  assert.ok(Math.abs(x0 - room.c1 * P) < 2 && Math.abs(x1 - room.c1 * P) < 2, "on the east wall's line");
  assert.ok(Math.abs(y0 - 5 * P) < 2 && Math.abs(y1 - 6 * P) < 2, "over the one edge");
});

test("segments are placed in the scene: an offset and a scale carry the image's pixels to the scene's", () => {
  const r = detectWallsAndDoors({ gray: drawRoom({ door: false }), width: W, height: H, cols: COLS, rows: ROWS });
  const plain = toSegments(r).find((s) => s.c[0] === s.c[2] && Math.abs(s.c[0] - room.c0 * P) < 2);
  const placed = toSegments(r, { x: 100, y: 50, sx: 2, sy: 2 }).find((s) => s.c[0] === s.c[2] && Math.abs(s.c[0] - (100 + room.c0 * P * 2)) < 4);
  assert.ok(plain && placed);
  assert.ok(Math.abs(placed.c[1] - (50 + plain.c[1] * 2)) < 2);
});
