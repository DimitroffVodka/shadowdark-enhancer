import test from "node:test";
import assert from "node:assert/strict";
import { trapCandidates, squareOutline, planSiteTraps, trapsFor, ADVENTURE_TRAPS, PLACE_ADVENTURE_TRAPS } from "../scripts/importer/adventure/adventure-traps.mjs";
import { ADVENTURE_LAYOUTS } from "../scripts/importer/adventure/adventure-layouts.mjs";
import { ADVENTURE_WALLS } from "../scripts/importer/adventure/adventure-walls.mjs";

// Invented lines in the shapes adventures print their traps in (the repo carries no book text).
const blocks = [
  { kind: "p", text: "A low chamber that smells of tallow." },
  { kind: "li", text: "Ceiling. Dozens of tiny holes (trap, see below)." },
  { kind: "li", text: "Trap. The door seals and gas seeps in. DC 14 CON or 1d4/round." },
  { kind: "li", text: "Table. A long oak table, scarred and heavy." },
  { kind: "li", text: "Door. Iron-banded and barred. DC 18 STR to break." },
  { kind: "li", text: "Floor. Sticky tar pit trap. DC 12 DEX to escape, 1d6 damage/round." },
  { kind: "p", text: "Trap. A paragraph is not a bulleted line." },
];

test("the candidates are the bulleted lines that open like a hazard and talk like one, in order", () => {
  assert.deepEqual(trapCandidates(blocks), [
    "Ceiling. Dozens of tiny holes (trap, see below).",
    "Trap. The door seals and gas seeps in. DC 14 CON or 1d4/round.",
    "Floor. Sticky tar pit trap. DC 12 DEX to escape, 1d6 damage/round.",
  ]);
  assert.deepEqual(trapCandidates(undefined), []);
});

test("bold markers do not change what a line says", () => {
  assert.deepEqual(trapCandidates([{ kind: "li", text: "\u0001Trap.\u0002 Gas. DC 14 CON or 1d4/round." }]), ["Trap. Gas. DC 14 CON or 1d4/round."]);
});

test("squares become one polygon around each patch, with no corner that is only a point on a straight line", () => {
  const shapes = squareOutline([[3, 5], [4, 5], [5, 5], [3, 6], [8, 6]], { x: 100, y: 200 }, 50);
  assert.equal(shapes.length, 2, "two patches, two polygons");
  const corners = (s) => { const out = []; for (let i = 0; i < s.points.length; i += 2) out.push([(s.points[i] - 100) / 50, (s.points[i + 1] - 200) / 50]); return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]); };
  assert.deepEqual(corners(shapes[0]), [[3, 5], [3, 7], [4, 6], [4, 7], [6, 5], [6, 6]], "an L of four squares has six corners");
  assert.deepEqual(corners(shapes[1]), [[8, 6], [8, 7], [9, 6], [9, 7]]);
  assert.ok(shapes.every((s) => s.type === "polygon" && s.hole === false));
  assert.deepEqual(squareOutline([], { x: 0, y: 0 }, 50), []);
});

test("a gap inside a patch is a hole, listed after the outline", () => {
  const ring = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
  const shapes = squareOutline(ring, { x: 0, y: 0 }, 10);
  assert.deepEqual(shapes.map((s) => s.hole), [false, true]);
  assert.equal(shapes[0].points.length, 8, "a 3 by 3 outline has four corners");
  assert.equal(shapes[1].points.length, 8, "and so does the single missing square");
});

const rect = { x: 0, y: 0, width: 1000, height: 500 };
const squares = [[4, 4], [5, 4], [4, 5], [9, 9]];
const common = { pins: { 7: { x: 225, y: 225 } }, rect, gridSize: 50, squaresOf: () => squares };

test("a trap is read from its line, bounded by its radius, and named for its area", () => {
  const { traps, skipped } = planSiteTraps({ ...common, entries: [{ pin: 7, nth: 2, dc: 14, radius: 2 }], texts: { 7: trapCandidates(blocks) } });
  assert.deepEqual(skipped, []);
  assert.equal(traps.length, 1);
  assert.equal(traps[0].name, "7. The door seals and gas seeps in");
  assert.deepEqual({ ...traps[0].system, effect: "" }, {
    trap: "The door seals and gas seeps in", trigger: "", effect: "", checkAbility: "con", checkDc: 14, damage: "1d4", holds: false, when: "round", chance: "",
  });
  assert.equal(traps[0].shapes.length, 1, "one polygon: the far square (9, 9) is outside the radius");
});

test("a square close in a straight line but far on foot is not in the trap's reach", () => {
  const texts = { 7: trapCandidates(blocks) };
  const near = [[4, 4, 0], [5, 4, 1], [5, 5, 9]];   // (5, 5) is next door through a wall: nine steps round
  const { traps } = planSiteTraps({ ...common, texts, squaresOf: () => near, entries: [{ pin: 7, nth: 2, dc: 14, radius: 2 }] });
  assert.deepEqual(traps[0].shapes[0].points, [200, 200, 300, 200, 300, 250, 200, 250], "two squares side by side: the pin's and the one beside it");
});

test("the shipped firing setting wins over what the words say", () => {
  const { traps } = planSiteTraps({ ...common, entries: [{ pin: 7, nth: 3, dc: 12, when: "manual" }], texts: { 7: trapCandidates(blocks) } });
  assert.equal(traps[0].system.when, "manual");
});

test("a line that is missing, or whose DC is not the one the data was made for, makes no trap", () => {
  const texts = { 7: trapCandidates(blocks) };
  const out = planSiteTraps({ ...common, texts, entries: [{ pin: 7, nth: 9 }, { pin: 7, nth: 3, dc: 15 }, { pin: 7, nth: 1, dc: 12 }, { pin: 8, nth: 1 }] });
  assert.deepEqual(out.traps, []);
  assert.deepEqual(out.skipped.map((s) => s.why), ["text", "dc", "dc", "text"]);
});

test("no pin on the scene, or no floor around it, makes no trap", () => {
  const texts = { 7: trapCandidates(blocks) };
  assert.deepEqual(planSiteTraps({ ...common, texts, pins: {}, entries: [{ pin: 7, nth: 2 }] }).skipped.map((s) => s.why), ["pin"]);
  assert.deepEqual(planSiteTraps({ ...common, texts, squaresOf: () => [], entries: [{ pin: 7, nth: 2 }] }).skipped.map((s) => s.why), ["floor"]);
});

test("a trap with a shape is a polygon of that shape on the scene, needing no pin or floor", () => {
  const texts = { 7: trapCandidates(blocks) };
  const { traps } = planSiteTraps({ ...common, texts, pins: {}, squaresOf: () => [], entries: [{ pin: 7, nth: 2, dc: 14, shape: [[0.1, 0.2], [0.3, 0.2], [0.3, 0.4]] }] });
  assert.deepEqual(traps[0].shapes, [{ type: "polygon", points: [100, 100, 300, 100, 300, 200], hole: false }]);
});

test("a trap with a box is one plain rectangle of that size, needing no pin or floor", () => {
  const texts = { 7: trapCandidates(blocks) };
  const { traps } = planSiteTraps({ ...common, texts, pins: {}, squaresOf: () => [], entries: [{ pin: 7, nth: 2, dc: 14, box: [0.1, 0.2, 0.3, 0.4] }] });
  assert.deepEqual(traps[0].shapes, [{ type: "rectangle", x: 100, y: 100, width: 300, height: 200, rotation: 0, hole: false }]);
});

test("a site with trap data also has the pins and walls that place them", () => {
  for (const [id, entries] of Object.entries(ADVENTURE_TRAPS)) {
    assert.ok(ADVENTURE_LAYOUTS[id], `${id} has no pin layout`);
    assert.ok(ADVENTURE_WALLS[id], `${id} has no walls to bound its traps`);
    const seen = new Set();
    for (const e of entries) {
      assert.ok(ADVENTURE_LAYOUTS[id].pins[e.pin], `${id}: pin ${e.pin} is not on the layout`);
      assert.ok(Number.isInteger(e.nth) && e.nth >= 1, `${id}: pin ${e.pin} nth`);
      assert.ok(!seen.has(`${e.pin}/${e.nth}`), `${id}: pin ${e.pin} trap ${e.nth} twice`);
      seen.add(`${e.pin}/${e.nth}`);
      assert.ok(e.radius === undefined || e.radius >= 1, `${id}: pin ${e.pin} radius`);
      assert.ok(!e.box || (e.box.length === 4 && e.box[0] >= 0 && e.box[1] >= 0 && e.box[2] > 0 && e.box[3] > 0 && e.box[0] + e.box[2] <= 1 && e.box[1] + e.box[3] <= 1), `${id}: pin ${e.pin} box`);
      assert.ok(!e.shape || (e.shape.length >= 3 && e.shape.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1)), `${id}: pin ${e.pin} shape`);
      assert.ok(e.when === undefined || ["enter", "round", "manual"].includes(e.when), `${id}: pin ${e.pin} when`);
    }
  }
  assert.equal(trapsFor("nowhere"), null);
});

test("the importer places a map's book traps only while the switch is on; the data is kept either way", () => {
  assert.ok(ADVENTURE_TRAPS["cs1-mugdulblub"].length > 0);
  assert.deepEqual(trapsFor("cs1-mugdulblub"), PLACE_ADVENTURE_TRAPS ? ADVENTURE_TRAPS["cs1-mugdulblub"] : null);
  assert.equal(PLACE_ADVENTURE_TRAPS, false);   // held back for a later release
});
