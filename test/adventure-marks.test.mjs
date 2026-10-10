import test from "node:test";
import assert from "node:assert/strict";
import { planMarks, markKey, markIcon, MARK_FLAG } from "../scripts/importer/adventure/adventure-marks.mjs";

// Invented geometry throughout.
const rect = { x: 100, y: 200, width: 1000, height: 400 };
const marks = [{ kind: "secret", x: 0.5, y: 0.25 }, { kind: "locked", x: 0.1, y: 0.5 }, { kind: "barricaded", x: 0.9, y: 0.75 }];

test("planMarks: each mark is a hidden tile of its SVG, the book's size, its letter on the mark's place", () => {
  const plan = planMarks({ marks, rect, gridSize: 100, siteId: "x" });
  assert.equal(plan.length, 3);
  const [secret, locked, bar] = plan.map((p) => p.data);
  assert.equal(secret.hidden, true);
  assert.deepEqual([secret.width, secret.height], [101, 101]);   // a square across, as the book draws it
  assert.deepEqual([secret.x, secret.y], [550, 250]);   // centred on its place: 600 and 300 less half of 101, rounded
  assert.match(secret.texture.src, /icons\/adventure-pins\/mark-secret\.svg$/);
  assert.equal(secret.texture.src, markIcon("secret"));
  assert.deepEqual([locked.width, bar.width], [118, 136]);   // the barricade is the larger one
  assert.equal(locked.y, Math.round(400 - 115 * 0.4));   // a triangle's letter sits above its middle, so the tile sits lower
  assert.equal(secret.flags["shadowdark-enhancer"][MARK_FLAG].key, markKey(marks[0]));
});

test("planMarks: a mark already on the scene is left out, so a re-run never doubles it; so is a repeat in the read", () => {
  const first = planMarks({ marks, rect, gridSize: 100, siteId: "x" });
  assert.deepEqual(planMarks({ marks, rect, gridSize: 100, siteId: "x", placed: first.map((p) => p.key) }), []);
  assert.equal(planMarks({ marks: [marks[0], marks[0]], rect, gridSize: 100, siteId: "x" }).length, 1);
});

test("planMarks: a kind it does not draw is skipped", () => {
  assert.deepEqual(planMarks({ marks: [{ kind: "illusory", x: 0.5, y: 0.5 }], rect, gridSize: 100, siteId: "x" }), []);
});
