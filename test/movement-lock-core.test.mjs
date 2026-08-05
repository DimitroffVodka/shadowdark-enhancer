import test from "node:test";
import assert from "node:assert/strict";
import { shouldBlockMovement } from "../scripts/crawl-strip/movement-lock-core.mjs";

// Every gate must hold for a move to be cancelled. BLOCK is the one
// combination that must cancel; every other combination passes through.
const BLOCK = {
  enabled: true,
  combatActive: true,
  isGM: false,
  isCombatant: true,
  isCurrentCombatant: false,
  movesPosition: true,
};

test("shouldBlockMovement: blocks a non-current combatant's move when every gate holds", () => {
  assert.equal(shouldBlockMovement(BLOCK), true);
});

test("shouldBlockMovement: flipping any single gate from the blocking state passes the move through", () => {
  // One flip per issue #14 non-goal: setting off, no started combat, a GM is
  // never blocked, a non-combatant is never blocked, one's own turn is never
  // blocked, and a non-positional update is never blocked.
  const gates = ["enabled", "combatActive", "isGM", "isCombatant", "isCurrentCombatant", "movesPosition"];
  for (const gate of gates) {
    const flipped = { ...BLOCK, [gate]: !BLOCK[gate] };
    assert.equal(shouldBlockMovement(flipped), false, `flipping ${gate} must not block`);
  }
});

test("shouldBlockMovement: combinations of permissive gates are still not blocked", () => {
  assert.equal(shouldBlockMovement({ ...BLOCK, enabled: false, isGM: true }), false);
  assert.equal(shouldBlockMovement({ ...BLOCK, combatActive: false, isCombatant: false }), false);
  assert.equal(shouldBlockMovement({ ...BLOCK, isCurrentCombatant: true, movesPosition: false }), false);
});

test("shouldBlockMovement: partial or missing inputs default to not blocked", () => {
  assert.equal(shouldBlockMovement({}), false);
  assert.equal(shouldBlockMovement({ enabled: true }), false);
  assert.equal(shouldBlockMovement({ enabled: true, combatActive: true, isCombatant: true }), false);
  assert.equal(shouldBlockMovement(undefined), false);
});
