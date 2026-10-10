import test from "node:test";
import assert from "node:assert/strict";
import {
  riderCorner, followPath, gapSquares, pickMount, grownSize, CARRY_PREFIX, carryMovementId, isCarryMovement, carryInFlight, snapPoint,
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

/**
 * The rest of the lane repro (14.369, ~1 run in 10): the carry to 1200 was
 * built while core's resumed update to 901 was in flight and was silently
 * dropped, leaving the rider mounted at (600,901) and the horse at (600,1100).
 */
test("reconcile: a rider left behind when the mount stops is put in its corner", () => {
  const horseThere = { x: 600, y: 1100, width: 2, height: 2 };
  const left = { x: 600, y: 901, width: 1, height: 1 };
  assert.deepEqual(snapPoint({ mount: horseThere, rider: left, gridSize: G }), { x: 600, y: 1200 });
});

test("reconcile: nothing when the rider is in its corner, off the mount, or the mount is still on its way", () => {
  const horseThere = { x: 600, y: 1100, width: 2, height: 2 };
  const inCorner = { x: 600, y: 1200, width: 1, height: 1 };
  const left = { x: 600, y: 901, width: 1, height: 1 };
  assert.equal(snapPoint({ mount: horseThere, rider: inCorner, gridSize: G }), null, "already there: idempotent");
  assert.equal(snapPoint({ mount: null, rider: left, gridSize: G }), null, "dismounted, or the mount is gone");
  assert.equal(snapPoint({ mount: horseThere, rider: left, gridSize: G, mountMoving: true }), null,
    "the mount has segments to go; their carries follow");
});

/**
 * The Foundry half, driven through its hooks with stub documents. Core records
 * a client's own token update for Ctrl+Z unless it is an isUndo write, so every
 * write the module makes carries isUndo: Ctrl+Z then finds the mount's move,
 * reverts it (method "undo", a fresh movement id), and the rider follows.
 */
async function wiring() {
  const MOD = "shadowdark-enhancer";
  const hooks = new Map();
  globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), once() {}, callAll() {} };
  globalThis.CONFIG = { queries: {} };
  globalThis.game = { userId: "u1", user: { id: "u1", isGM: true, targets: new Set() }, users: { activeGM: { id: "u1" } }, i18n: { localize: (k) => k } };
  globalThis.foundry = { utils: { randomID: () => "Ab3dEf7h" } };
  globalThis._replace = (v) => ({ replaced: v });
  globalThis._del = Symbol("del");
  const { registerMountedTokens } = await import("../scripts/mounted/mounted-tokens.mjs");
  registerMountedTokens();
  const tokens = new Map();
  const scene = { id: "s", grid: { size: G }, tokens: { get: (id) => tokens.get(id), find: (fn) => [...tokens.values()].find(fn) } };
  const token = (id, src, flags = {}) => {
    const doc = { id, parent: scene, _source: { ...src }, flags: { [MOD]: flags }, movement: null, writes: [], moves: [],
      canUserModify: () => true,
      update: async (changes, options) => { doc.writes.push({ changes, options }); },
      move: async (waypoints, options) => { doc.moves.push({ waypoints, options }); Object.assign(doc._source, waypoints.at(-1)); return true; } };
    tokens.set(id, doc);
    return doc;
  };
  const horse = token("horse", { x: 500, y: 300, width: 2, height: 2 });
  const rider = token("knight", { x: 500, y: 400, width: 1, height: 1 }, { mountedOn: "horse" });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  /** A move this tab made: preMoveToken, then the update lands. */
  const moved = (doc, movement, changes, { here = true } = {}) => {
    if (here) hooks.get("preMoveToken")(doc, movement);
    doc.movement = movement;
    hooks.get("updateToken")(doc, changes, {}, "u1");
  };
  return { MOD, hooks, horse, rider, moved, settle };
}

test("Ctrl+Z on a ridden mount: the mount's undo carries the rider, and no module write enters the undo history", async () => {
  const { horse, rider, moved, settle } = await wiring();
  // Core's undo of the mount's move: a displace back to the origin, method "undo", a new movement id.
  const undo = { id: "UndoMove00000001", chain: [], method: "undo", passed: { waypoints: [{ x: 500, y: 300, width: 2, height: 2, elevation: 0, action: "displace" }] } };
  Object.assign(horse._source, { x: 500, y: 300 });
  rider._source.y = 900;   // where the carry had put it before the undo
  moved(horse, undo, { x: 500, y: 300 });
  await settle();
  assert.equal(rider.moves.length, 1, "one carry");
  const [{ waypoints, options }] = rider.moves;
  assert.deepEqual(waypoints.map((w) => [w.x, w.y, w.action]), [[500, 400, "displace"]], "into the corner");
  assert.equal(options.isUndo, true, "kept out of the undo history");
  assert.ok(isCarryMovement({ id: options.id }));
  assert.equal(rider.writes.length, 0, "the rider stays mounted");

  // That carry landing is not the rider's own move.
  moved(rider, { id: options.id, chain: [] }, { y: 400 });
  await settle();
  assert.equal(rider.writes.length, 0);
});

test("the rider moving on its own dismounts it, unrecorded; another tab of the same user does nothing", async () => {
  const { MOD, rider, horse, moved, settle } = await wiring();
  moved(rider, { id: "OwnMove000000001", chain: [] }, { x: 900 }, { here: false });
  moved(horse, { id: "OwnMove000000002", chain: [], passed: { waypoints: [{ x: 700, y: 300, width: 2, height: 2 }] } }, { x: 700 }, { here: false });
  await settle();
  assert.equal(rider.writes.length + rider.moves.length, 0, "the other tab neither dismounts nor carries");
  moved(rider, { id: "OwnMove000000003", chain: [] }, { x: 900 });
  await settle();
  assert.deepEqual(rider.writes.map((w) => [w.changes[`flags.${MOD}.mountedOn`], w.options.isUndo]), [[{ replaced: null }, true]]);
});

test("a ridden mount that changes size puts its rider in the new bottom-left corner", async () => {
  const { horse, rider, moved, settle } = await wiring();
  Object.assign(horse._source, { width: 3, height: 3 });
  moved(horse, { id: "Resize0000000001", chain: [], passed: { waypoints: [{ x: 500, y: 300, width: 3, height: 3, action: "walk" }] } }, { width: 3, height: 3 });
  await settle();
  assert.deepEqual(rider.moves.map((m) => [m.waypoints.at(-1).x, m.waypoints.at(-1).y]), [[500, 500]]);
});

test("a pasted copy of a rider rides nothing", async () => {
  const { MOD, hooks } = await wiring();
  const sets = [];
  const copy = { flags: { [MOD]: { mountedOn: "horse" } }, updateSource: (d) => sets.push(d) };
  hooks.get("preCreateToken")(copy);
  assert.deepEqual(sets, [{ [`flags.${MOD}.mountedOn`]: globalThis._del }]);
  hooks.get("preCreateToken")({ flags: {}, updateSource: (d) => sets.push(d) });
  assert.equal(sets.length, 1);
});
