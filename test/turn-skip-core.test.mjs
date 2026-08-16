import test from "node:test";
import assert from "node:assert/strict";
import {
  combatantEntry,
  isHiddenFromStrip,
  shouldSkipTurn,
} from "../scripts/crawl-strip/turn-skip-core.mjs";

// ── fixtures ────────────────────────────────────────────────────────────────

const pc   = (hp = 5) => ({ hasActor: true, isPlayer: true,  defeated: false, hp });
const npc  = (hp = 5) => ({ hasActor: true, isPlayer: false, defeated: false, hp });
const dead = ()       => ({ hasActor: true, isPlayer: false, defeated: true,  hp: 0 });

// A Combatant-shaped literal for combatantEntry.
const combatant = ({ type = "NPC", hp = 5, defeated = false, actor = undefined } = {}) => ({
  defeated,
  actor: actor === undefined
    ? { type, system: { attributes: { hp: { value: hp } } } }
    : actor,
});

// ── combatantEntry ──────────────────────────────────────────────────────────

test("combatantEntry: reads type, defeated flag and Shadowdark HP", () => {
  assert.deepEqual(combatantEntry(combatant({ type: "Player", hp: 7 })), {
    hasActor: true, isPlayer: true, defeated: false, hp: 7,
  });
  assert.deepEqual(combatantEntry(combatant({ type: "NPC", hp: 0, defeated: true })), {
    hasActor: true, isPlayer: false, defeated: true, hp: 0,
  });
});

test("combatantEntry: falls back to the system.hp.value shape", () => {
  const c = { defeated: false, actor: { type: "NPC", system: { hp: { value: 3 } } } };
  assert.equal(combatantEntry(c).hp, 3);
});

test("combatantEntry: an actorless combatant reports hasActor false, HP defaults alive", () => {
  const entry = combatantEntry(combatant({ actor: null }));
  assert.equal(entry.hasActor, false);
  assert.equal(entry.hp, 1, "an unreadable actor must not read as a corpse");
});

test("combatantEntry: null/undefined combatant does not throw", () => {
  assert.equal(combatantEntry(null).hasActor, false);
  assert.equal(combatantEntry(undefined).hasActor, false);
});

test("combatantEntry: an actor with no HP data at all defaults to 1 (alive)", () => {
  const c = { defeated: false, actor: { type: "NPC", system: {} } };
  assert.equal(combatantEntry(c).hp, 1);
});

// ── isHiddenFromStrip ───────────────────────────────────────────────────────

test("isHiddenFromStrip: a healthy NPC keeps its card", () => {
  assert.equal(isHiddenFromStrip(npc(5)), false);
});

test("isHiddenFromStrip: an NPC at 0 HP is hidden even without the defeated flag", () => {
  // Shadowdark 4.x stamps `defeated` from applyDamage alone — a sheet edit or an
  // effect leaves the flag false (or, where a companion module re-adds the old
  // auto-marking, sets it a beat later), which is why core's skipDefeated isn't
  // enough and why this reads HP.
  assert.equal(isHiddenFromStrip({ ...npc(0) }), true);
});

test("isHiddenFromStrip: an NPC below 0 HP is hidden", () => {
  assert.equal(isHiddenFromStrip(npc(-4)), true);
});

test("isHiddenFromStrip: an NPC flagged defeated is hidden even at full HP", () => {
  assert.equal(isHiddenFromStrip({ ...npc(9), defeated: true }), true);
});

test("isHiddenFromStrip: PCs are never hidden, at 0 HP or flagged defeated", () => {
  assert.equal(isHiddenFromStrip(pc(0)), false);
  assert.equal(isHiddenFromStrip(pc(-3)), false);
  assert.equal(isHiddenFromStrip({ ...pc(0), defeated: true }), false);
});

test("isHiddenFromStrip: no actor, or no entry at all, is hidden", () => {
  assert.equal(isHiddenFromStrip({ hasActor: false, isPlayer: false, defeated: false, hp: 5 }), true);
  assert.equal(isHiddenFromStrip(null), true);
  assert.equal(isHiddenFromStrip(undefined), true);
});

test("isHiddenFromStrip: a missing hp field defaults to alive", () => {
  assert.equal(isHiddenFromStrip({ hasActor: true, isPlayer: false, defeated: false }), false);
});

// ── shouldSkipTurn ──────────────────────────────────────────────────────────

test("shouldSkipTurn: the reported bug — the pointer resting on a dead enemy", () => {
  const turns = [pc(), dead(), npc()];
  assert.equal(shouldSkipTurn(turns, 1), true);
});

test("shouldSkipTurn: a turn that renders a card is left alone", () => {
  const turns = [pc(), dead(), npc()];
  assert.equal(shouldSkipTurn(turns, 0), false);
  assert.equal(shouldSkipTurn(turns, 2), false);
});

test("shouldSkipTurn: an NPC at 0 HP with no defeated flag is still skipped", () => {
  assert.equal(shouldSkipTurn([pc(), npc(0)], 1), true);
});

test("shouldSkipTurn: a downed PC's turn is never skipped", () => {
  assert.equal(shouldSkipTurn([npc(), pc(0)], 1), false);
  assert.equal(shouldSkipTurn([npc(), { ...pc(0), defeated: true }], 1), false);
});

test("shouldSkipTurn: an actorless combatant's turn is skipped (it renders no card)", () => {
  const turns = [pc(), { hasActor: false, isPlayer: false, defeated: false, hp: 5 }];
  assert.equal(shouldSkipTurn(turns, 1), true);
});

test("shouldSkipTurn: nowhere to land — every combatant hidden — never moves", () => {
  // The wipe/corpse-tracker case. Advancing here would roll rounds forever.
  assert.equal(shouldSkipTurn([dead(), dead(), dead()], 0), false);
  assert.equal(shouldSkipTurn([dead(), dead(), dead()], 2), false);
});

test("shouldSkipTurn: a lone survivor is enough to justify skipping", () => {
  assert.equal(shouldSkipTurn([dead(), dead(), pc(1)], 0), true);
});

test("shouldSkipTurn: null turn (combat not started) never moves", () => {
  assert.equal(shouldSkipTurn([pc(), dead()], null), false);
  assert.equal(shouldSkipTurn([pc(), dead()], undefined), false);
});

test("shouldSkipTurn: an out-of-range or non-integer pointer is left to Foundry", () => {
  const turns = [pc(), dead()];
  assert.equal(shouldSkipTurn(turns, 2), false);
  assert.equal(shouldSkipTurn(turns, -1), false);
  assert.equal(shouldSkipTurn(turns, 1.5), false);
  assert.equal(shouldSkipTurn(turns, "1"), false);
});

test("shouldSkipTurn: an empty or non-array turn list never moves", () => {
  assert.equal(shouldSkipTurn([], 0), false);
  assert.equal(shouldSkipTurn(null, 0), false);
  assert.equal(shouldSkipTurn(undefined, 0), false);
});

test("shouldSkipTurn: walking a run of corpses terminates on the survivor", () => {
  // Mirrors what turn-skip.mjs does: advance one, re-ask, until it says stop.
  const turns = [pc(), dead(), dead(), dead(), npc()];
  let turn = 1;
  let steps = 0;
  while (shouldSkipTurn(turns, turn)) {
    turn = (turn + 1) % turns.length;
    assert.ok(++steps <= turns.length, "must terminate within one lap");
  }
  assert.equal(turn, 4, "lands on the surviving NPC");
  assert.equal(steps, 3);
});

test("shouldSkipTurn: a corpse in the last slot wraps to the top of the order", () => {
  const turns = [pc(), npc(), dead()];
  let turn = 2;
  let steps = 0;
  while (shouldSkipTurn(turns, turn)) {
    turn = (turn + 1) % turns.length;
    assert.ok(++steps <= turns.length, "must terminate within one lap");
  }
  assert.equal(turn, 0, "wraps into the next round on the first PC");
});
