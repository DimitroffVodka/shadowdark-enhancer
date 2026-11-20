import test from "node:test";
import assert from "node:assert/strict";
import { tokenMoveOnly } from "../scripts/crawl-strip/crawl-state-core.mjs";

// The strip skips token updates that only move the token: it rebuilt itself on every drop, as the move animation started.
test("a move, with core's movement bookkeeping, is move-only", () => {
  assert.equal(tokenMoveOnly({ _id: "t", x: 100, _movementHistory: [] }), true);
  assert.equal(tokenMoveOnly({ _id: "t", x: 1, y: 2, elevation: 5, level: "l", rotation: 90, _regions: [] }), true);
});

test("anything the strip draws still redraws it", () => {
  assert.equal(tokenMoveOnly({ _id: "t", flags: { "shadowdark-enhancer": { moveRemaining: 10 } } }), false);
  assert.equal(tokenMoveOnly({ _id: "t", hidden: true }), false);
  assert.equal(tokenMoveOnly({ _id: "t", x: 100, name: "Renamed" }), false);
});
