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

// ─── Out-of-combat regime (issue #14 part 2) ────────────────────────────────
// The OOC lock engages only once EVERY crawl member has rolled — an
// incomplete order is not an order, so nobody is frozen mid-roll. A complete
// order blocks every member except the current turn-holder; the setting
// still gates everything; combat rules take over the moment a combat starts.

const BLOCK_OOC = {
  enabled: true,
  combatActive: false,
  isGM: false,
  isCombatant: false,        // irrelevant out of combat
  isCurrentCombatant: false, // irrelevant out of combat
  movesPosition: true,
  oocMemberCount: 2,         // two members in the crawl
  oocRolledCount: 2,         // both have rolled — the order is COMPLETE
  isOocMember: true,
  isCurrentOocHolder: false,
};

test("shouldBlockMovement: OOC — a complete order blocks every member except the holder", () => {
  assert.equal(shouldBlockMovement(BLOCK_OOC), true, "a non-holder member is blocked");
  assert.equal(shouldBlockMovement({ ...BLOCK_OOC, isCurrentOocHolder: true }), false, "the holder's own move is never blocked");
  assert.equal(shouldBlockMovement({ ...BLOCK_OOC, isOocMember: false }), false, "non-members are never locked");
});

test("shouldBlockMovement: OOC — an incomplete order (a member missing a roll) blocks nobody", () => {
  // Flipping the rolled count below the member count must release EVERYONE —
  // a party mid-roll is never partially frozen.
  assert.equal(shouldBlockMovement({ ...BLOCK_OOC, oocRolledCount: 1 }), false, "one member has not rolled yet");
  assert.equal(shouldBlockMovement({ ...BLOCK_OOC, oocRolledCount: 1, isCurrentOocHolder: true }), false);
  assert.equal(shouldBlockMovement({ ...BLOCK_OOC, oocRolledCount: 0 }), false, "no rolls at all");
});

test("shouldBlockMovement: OOC — no roster, or an impossible over-count, means nobody is locked", () => {
  assert.equal(shouldBlockMovement({ ...BLOCK_OOC, oocMemberCount: 0, oocRolledCount: 0 }), false, "an empty roster is not an order");
  assert.equal(shouldBlockMovement({ ...BLOCK_OOC, oocMemberCount: 2, oocRolledCount: 3 }), false, "rolled > members is an impossible state — stays non-blocking");
});

test("shouldBlockMovement: OOC — flipping any single gate from the blocking state passes the move through", () => {
  const gates = ["enabled", "isGM", "movesPosition", "oocRolledCount", "isOocMember", "isCurrentOocHolder"];
  for (const gate of gates) {
    const flipped = { ...BLOCK_OOC, [gate]: !BLOCK_OOC[gate] };
    assert.equal(shouldBlockMovement(flipped), false, `flipping ${gate} must not block`);
  }
});

test("shouldBlockMovement: OOC — the setting off lets every move through", () => {
  assert.equal(shouldBlockMovement({ ...BLOCK_OOC, enabled: false }), false);
});

test("shouldBlockMovement: OOC — a non-positional update is never blocked", () => {
  assert.equal(shouldBlockMovement({ ...BLOCK_OOC, movesPosition: false }), false);
});

test("shouldBlockMovement: combat wins over a stale OOC order", () => {
  // Combat started mid-crawl: the OOC order is dormant, so the COMBAT rules
  // decide — a crawl member who is NOT a combatant is not blocked, and a
  // non-current combatant IS.
  const withCombat = { ...BLOCK_OOC, combatActive: true, isCombatant: false };
  assert.equal(shouldBlockMovement(withCombat), false, "combat regime: non-combatant passes");

  const combatant = { ...BLOCK_OOC, combatActive: true, isCombatant: true, isCurrentCombatant: false };
  assert.equal(shouldBlockMovement(combatant), true, "combat regime: non-current combatant blocked");
});
