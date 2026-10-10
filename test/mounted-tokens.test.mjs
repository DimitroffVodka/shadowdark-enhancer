import test from "node:test";
import assert from "node:assert/strict";
import {
  riderCorner, followPath, gapSquares, pickMount, grownSize, CARRY_PREFIX, carryMovementId, isCarryMovement, carryInFlight,
} from "../scripts/mounted/mounted-core.mjs";

const G = 100;
const horse = { id: "horse", x: 500, y: 300, width: 2, height: 2 };
const knight = { id: "knight", x: 0, y: 0, width: 1, height: 1 };

test("the rider stands in the mount's bottom-left square", () => {
  assert.deepEqual(riderCorner(horse, knight, G), { x: 500, y: 400 });
});

test("a carry's movement id is a valid Foundry id that says it is a carry", () => {
  const id = carryMovementId("Ab3dEf7h");
  assert.match(id, /^[a-zA-Z0-9]{16}$/);
  assert.ok(id.startsWith(CARRY_PREFIX));
});

/**
 * The lane repro (#326): a Trap Region covers y 900-1000 (grid 100). The mount
 * (2x2 at 600,600, rider at 600,700) moves south to 600,1100. Core pauses the
 * mount at y 801, so the mount moves in two segments and the module starts a
 * carry for each. The first carry is itself paused at y 851 with 901 pending;
 * core may resume it (a NEW movement id, chain = [first carry's id]) after the
 * mount's second segment has moved it to 1100, so that resumed move ends at the
 * mount's PREVIOUS corner (901), not its current one (1200).
 */
test("a carry a Region paused and core resumed is still a carry; the rider's own moves are not", () => {
  const first = carryMovementId("AAAAAAAA");
  const second = carryMovementId("BBBBBBBB");
  const carry1 = { id: first, chain: [], destination: { x: 600, y: 851 }, pending: { waypoints: [{ x: 600, y: 901 }] }, state: "pending" };
  const carry1Resumed = { id: "Zq81LmNo0PpQrStU", chain: [first], destination: { x: 600, y: 901 }, pending: { waypoints: [] }, state: "completed" };
  const carry2 = { id: second, chain: [], destination: { x: 600, y: 951 }, pending: { waypoints: [{ x: 600, y: 1200 }] }, state: "pending" };
  const carry2Resumed = { id: "Yx72KkMm1NnOoPpQ", chain: [second], destination: { x: 600, y: 1200 }, pending: { waypoints: [] }, state: "completed" };
  for (const move of [carry1, carry1Resumed, carry2, carry2Resumed]) assert.ok(isCarryMovement(move), move.id);

  // The rider dragged on its own, and that drag resumed after its own Region pause: both split the pair.
  const own = { id: "Hh12Jj34Kk56Ll78", chain: [], destination: { x: 700, y: 851 }, pending: { waypoints: [{ x: 700, y: 1000 }] } };
  const ownResumed = { id: "Mm90Nn12Oo34Pp56", chain: [own.id], destination: { x: 700, y: 1000 }, pending: { waypoints: [] } };
  assert.ok(!isCarryMovement(own));
  assert.ok(!isCarryMovement(ownResumed));
  assert.ok(!isCarryMovement(undefined));
  assert.ok(!isCarryMovement({ id: "", chain: [] }), "a token that never moved (core's empty movement)");
});

test("one carry in flight: the mount's next segment stops a carry still paused part way", () => {
  const first = carryMovementId("AAAAAAAA");
  assert.ok(carryInFlight({ id: first, chain: [], state: "pending" }), "paused at y 851, 901 pending: stop it");
  assert.ok(carryInFlight({ id: "Zq81LmNo0PpQrStU", chain: [first], state: "pending" }), "a resumed part, paused again");
  assert.ok(!carryInFlight({ id: first, chain: [], state: "completed" }), "already arrived: nothing to stop");
  assert.ok(!carryInFlight({ id: first, chain: [], state: "stopped" }));
  assert.ok(!carryInFlight({ id: "Hh12Jj34Kk56Ll78", chain: [], state: "pending" }), "the rider's own paused move is not ours to stop");
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

test("no mount: ridden, out of reach, itself, or the rider carries someone", () => {
  const rider = { ...knight, x: 400, y: 300 };
  assert.equal(pickMount(rider, [{ ...horse, busy: true }], { gridSize: G }), null);
  assert.equal(pickMount(rider, [{ ...horse, x: 700 }], { gridSize: G }), null);
  assert.equal(pickMount({ ...rider, width: 2, height: 2, id: "horse" }, [horse], { gridSize: G }), null);
  assert.equal(pickMount({ ...rider, busy: true }, [horse], { gridSize: G }), null);
});

test("a mount's token grows to 2x2 and never shrinks", () => {
  assert.deepEqual(grownSize({ width: 1, height: 1 }), { width: 2, height: 2 });
  assert.deepEqual(grownSize({ width: 2, height: 1 }), { width: 2, height: 2 });
  assert.deepEqual(grownSize({ width: 3, height: 1 }), { width: 3, height: 2 });
  assert.deepEqual(grownSize({}), { width: 2, height: 2 }, "a prototype token with no size set is 1x1");
  assert.equal(grownSize({ width: 2, height: 2 }), null);
  assert.equal(grownSize({ width: 3, height: 3 }), null);
});

test("a small mount in reach is picked; it is grown before the rider is placed", () => {
  const rider = { ...knight, x: 400, y: 300 };
  const pony = { id: "pony", x: 500, y: 300, width: 1, height: 1 };
  assert.equal(pickMount(rider, [pony], { gridSize: G }), "pony");
  const grown = { ...pony, ...grownSize(pony) };
  assert.deepEqual(riderCorner(grown, rider, G), { x: 500, y: 400 });
});
