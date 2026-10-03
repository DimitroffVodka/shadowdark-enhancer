import { test } from "node:test";
import assert from "node:assert/strict";
import { fillFormation, followOrder, deploymentOrder, planPlacement, safeFootprint } from "../scripts/party/party-movement-core.mjs";
import { normalizeParty, removeMember } from "../scripts/party/party-core.mjs";
const rows = Array.from({ length: 12 }, (_, i) => ({ uuid: `Actor.${i}`, group: "characters" }));
test("new parties default to marching; explicit Free survives and leader removal selects next", () => {
  assert.equal(normalizeParty().followLeader, true); assert.equal(normalizeParty({ followLeader: false }).followLeader, false);
  const d = normalizeParty({ members: ["a", "b"], leaderUuid: "a" }); assert.equal(removeMember(d, "a").leaderUuid, "b");
});
test("formation fills nine fixed slots, keeps valid arrangement, and orders overflow; mounts never follow", () => {
  const data = { members: rows.map(r => r.uuid), formation: { slots: [{ memberUuid: "Actor.1", col: 1, row: 1 }] }, leaderUuid: "Actor.0", includeMounts: true /* an old world may still hold it: it is ignored */ };
  const f = fillFormation(data, rows);
  assert.equal(f.slots.length, 9);
  assert.deepEqual(f.slots.find(s => s.memberUuid === "Actor.1"), data.formation.slots[0]);
  assert.deepEqual(f.slots.find(s => s.memberUuid === "Actor.0"), { memberUuid: "Actor.0", col: 0, row: -1 });
  assert.equal(followOrder({ ...data, formation: f }, rows)[0], "Actor.0");
  const ordered = deploymentOrder({ ...data, formation: f }, [...rows, { uuid: "mount", group: "mounts" }]);
  assert.equal(ordered.length, 12); assert.ok(!ordered.some(s => s.memberUuid === "mount"));
  assert.ok(ordered.slice(9).every(s => s.row > 1));
});
test("larger saved formation is retained and marked for review", () => {
  const formation = { slots: [{ memberUuid: "Actor.0", col: 2, row: 2 }] };
  const f = fillFormation({ formation }, rows);
  assert.equal(f.needsReview, true); assert.deepEqual(f.slots, formation.slots);
});
const grid = { getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), getTopLeftPoint: o => ({ x: o.j * 100, y: o.i * 100 }) };
const base = { grid, anchor: { x: 300, y: 300 }, bounds: { x: 0, y: 0, width: 800, height: 800 }, sizeX: 100, sizeY: 100 };
test("planner uses free wall-safe slots, full footprint and stacks before crossing a wall", () => {
  const blocked = (a, b) => (a.x < 400 && b.x >= 400) || (a.x >= 400 && b.x < 400);
  const plan = planPlacement({ ...base, anchor: { x: 200, y: 300 }, blocked, occupied: [], entries: [{ memberUuid: "one", col: 1, row: 0, width: 1, height: 1 }, { memberUuid: "big", col: 1, row: 1, width: 2, height: 2 }] });
  assert.ok(plan.every(p => p.x + p.width * 100 <= 400));
  const stacked = planPlacement({ ...base, bounds: { x: 300, y: 300, width: 100, height: 100 }, blocked: () => false, occupied: [{ x: 300, y: 300, width: 100, height: 100 }], entries: [{ memberUuid: "one", col: 1, row: 0, width: 1, height: 1 }] });
  assert.equal(stacked[0].stacked, true); assert.equal(stacked[0].x, 300);
  assert.equal(planPlacement({ ...base, blocked: () => true, entries: [{ memberUuid: "one", col: 0, row: 0, width: 1, height: 1 }] })[0].blocked, true);
});
test("hex planner uses grid positions instead of square pixel offsets", () => {
  const hex = { getOffset: grid.getOffset, getTopLeftPoint: o => ({ x: o.j * 75, y: o.i * 100 + (o.j % 2) * 50 }) };
  const plan = planPlacement({ ...base, anchor: { x: 150, y: 200 }, grid: hex, blocked: () => false, entries: [{ memberUuid: "one", col: 1, row: 0, width: 1, height: 1 }] });
  assert.equal(plan[0].x % 75, 0);
});
test("corridor, scene edges, internal walls and corners use the whole footprint", () => {
  const bounds = { x: 0, y: 0, width: 600, height: 100 };
  assert.equal(safeFootprint({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, 200, bounds, () => false), false);
  assert.equal(safeFootprint({ x: 0, y: 0 }, { x: 600, y: 0 }, 100, 100, bounds, () => false), false);
  assert.equal(safeFootprint({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, 100, bounds, () => false, () => true), false);
  const corner = (a, b) => a.y < 150 && b.y >= 150;
  assert.equal(safeFootprint({ x: 0, y: 0 }, { x: 100, y: 100 }, 100, 100, base.bounds, corner), false);
  const plan = planPlacement({ ...base, bounds, anchor: { x: 0, y: 0 }, blocked: () => false, entries: [{ memberUuid: "one", col: 0, row: 1, width: 1, height: 1 }] });
  assert.equal(plan[0].y, 0);
});
test("stack touching room boundaries survives native integer collision rounding", () => {
  const point = { x: 600, y: 400 }, room = { x: 600, y: 400, width: 100, height: 100 };
  const rounded = (a, b) => [a, b].some(p => [600, 700].includes(Math.round(p.x)) || [400, 500].includes(Math.round(p.y)));
  assert.equal(safeFootprint(point, point, 100, 100, room, rounded), true);
});
test("placement bounds its candidate search to the anchor's neighbourhood", () => {
  let calls = 0;
  const spy = { getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), getTopLeftPoint: o => { calls += 1; return { x: o.j * 100, y: o.i * 100 }; } };
  const plan = planPlacement({ grid: spy, anchor: { x: 4000, y: 3000 }, bounds: { x: 0, y: 0, width: 8000, height: 6000 }, sizeX: 100, sizeY: 100, blocked: () => false,
    entries: [{ memberUuid: "one", col: 1, row: 0, width: 1, height: 1 }] });
  assert.equal(plan[0].blocked, undefined);
  assert.equal(plan[0].x, 4100, "the preferred free slot is still found");
  assert.ok(calls <= 400, `candidate search stays local, not scene-sized (${calls} lookups)`);
});
