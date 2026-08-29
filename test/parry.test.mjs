/**
 * The Duelist's Parry — "Once per day, an attack of your choice that would hit
 * you misses instead."
 *
 * These cover the decidable half: whether an attack is parryable, and exactly
 * what to undo when the GM already applied the damage. The Foundry-bound half
 * (chat-card button, gm-relay round trip, the actual reversal) is live-verified
 * against a running world.
 *
 * The reversal is where the bodies are buried. `ActorSD.applyDamage` clamps HP
 * to [0, max], so a hit that overkills LOSES the excess — reversing by the
 * number printed on the card would hand back more than was taken. And reaching
 * 0 does more than empty the pool: the system marks the combatant defeated and
 * toggles prone + unconscious onto a Player. Undoing a hit means undoing all of
 * that, but ONLY the parts that hit caused.
 *
 * Fixture numbers are invented.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  damageOutcome, canParry, reversalPlan, defeatStatusesFor,
} from "../scripts/parry/parry-core.mjs";
import { rollHit, isAttackCard } from "../scripts/shared/attack-card.mjs";

// ─── damageOutcome: the clamp is the point ──────────────────────────────────

test("ordinary damage: delta is just the damage", () => {
  assert.deepEqual(damageOutcome({ current: 10, max: 12, amount: 4 }),
    { after: 6, delta: 4, defeats: false });
});

test("overkill is CLAMPED, and only the clamped amount is owed back", () => {
  // 3 HP, hit for 7 → 0 HP. Four points never left a pool that had them.
  const out = damageOutcome({ current: 3, max: 12, amount: 7 });
  assert.equal(out.after, 0);
  assert.equal(out.delta, 3, "give back 3, not 7 — 7 would leave them better off");
  assert.equal(out.defeats, true);
});

test("exactly lethal damage still defeats", () => {
  assert.deepEqual(damageOutcome({ current: 5, max: 12, amount: 5 }),
    { after: 0, delta: 5, defeats: true });
});

test("healing never counts as a defeat, and never exceeds max", () => {
  assert.deepEqual(damageOutcome({ current: 4, max: 10, amount: -3 }),
    { after: 7, delta: -3, defeats: false });
  assert.equal(damageOutcome({ current: 9, max: 10, amount: -6 }).after, 10);
  // A zero-damage "hit" on an already-downed character is not a fresh defeat.
  assert.equal(damageOutcome({ current: 0, max: 10, amount: 0 }).defeats, false);
});

test("damage is floored, as the system floors it", () => {
  assert.equal(damageOutcome({ current: 10, max: 10, amount: 3.7 }).after, 7);
});

// ─── rollHit ────────────────────────────────────────────────────────────────

test("a hit is success, or any critical success", () => {
  assert.equal(rollHit({ success: true }), true);
  assert.equal(rollHit({ success: false, criticalSuccess: true }), true, "a crit hits regardless of AC");
});

test("a miss is failure, and a critical failure beats a passing total", () => {
  assert.equal(rollHit({ success: false }), false);
  assert.equal(rollHit({ success: true, criticalFailure: true }), false);
});

test("no DC means no hit to parry — an untargeted swing", () => {
  // RollSD.success is null with no DC; there is no "you" it hit.
  assert.equal(rollHit({ success: null }), false);
  assert.equal(rollHit({}), false);
});

// ─── isAttackCard: a targeted spell is not a swing ──────────────────────────
//
// `setRollTarget` stamps targetUuid onto ANY roll made with a token targeted,
// so a spell card carries the same target the Duelist's Parry looks for. Its
// `success` is the caster's check against the spell's DC — read as an attack, a
// fumbled spell is a "miss" that arms Taunt and a good one is a "hit" that
// offers Parry. `config.type` is the system's own label for the roll.

const card = (type) => ({ flags: { shadowdark: { rollConfig: { type, targetUuid: "Scene.a.Token.b" } } } });

test("a weapon attack is an attack card", () => {
  assert.equal(isAttackCard(card("attack")), true);
});

test("a targeted spell is NOT, however well it went", () => {
  assert.equal(isAttackCard(card("spell")), false);
});

test("nor is an ability or a stat check", () => {
  assert.equal(isAttackCard(card("ability")), false);
  assert.equal(isAttackCard(card("check")), false);
});

test("a card with no roll config at all is not an attack", () => {
  assert.equal(isAttackCard({ flags: { shadowdark: {} } }), false);
  assert.equal(isAttackCard({}), false);
  assert.equal(isAttackCard(null), false);
  assert.equal(isAttackCard(card("")), false);
});

// ─── canParry ───────────────────────────────────────────────────────────────

const ELIGIBLE = {
  isHit: true, hasTarget: true, parriedBy: null, mayAct: true,
  hasAbility: true, lost: false, usesAvailable: 1,
};

test("the ordinary case: a hit on your Duelist with a use left", () => {
  assert.deepEqual(canParry(ELIGIBLE), { ok: true, reason: "ok" });
});

test("each blocker is reported on its own", () => {
  const cases = {
    "no-target": { hasTarget: false },
    "no-ability": { hasAbility: false },
    "missed": { isHit: false },
    "already-parried": { parriedBy: "abc" },
    "not-yours": { mayAct: false },
    "lost": { lost: true },
    "no-uses": { usesAvailable: 0 },
  };
  for (const [reason, override] of Object.entries(cases)) {
    const v = canParry({ ...ELIGIBLE, ...override });
    assert.equal(v.ok, false, `${reason} should block`);
    assert.equal(v.reason, reason);
  }
});

test("a spent pool blocks however it is expressed", () => {
  for (const usesAvailable of [0, -1, null, undefined, NaN]) {
    assert.equal(canParry({ ...ELIGIBLE, usesAvailable }).ok, false);
  }
});

test("nothing is parryable by default — the shape has to be argued for", () => {
  assert.equal(canParry().ok, false);
  assert.equal(canParry({}).ok, false);
});

// ─── reversalPlan: undo this hit, and nothing else ─────────────────────────

test("a hit that downed the Duelist is undone in full", () => {
  const plan = reversalPlan(
    { before: 3, after: 0, hadStatuses: [], wasDefeated: false },
    { statuses: ["prone", "unconscious"], defeated: true });
  assert.deepEqual(plan, { heal: 3, clearStatuses: ["prone", "unconscious"], clearDefeated: true });
});

test("a status they ALREADY had is left alone", () => {
  // Parrying a blow doesn't stand you up off the floor you were already on.
  const plan = reversalPlan(
    { before: 4, after: 0, hadStatuses: ["prone"], wasDefeated: false },
    { statuses: ["prone", "unconscious"], defeated: true });
  assert.deepEqual(plan.clearStatuses, ["unconscious"]);
  assert.equal(plan.heal, 4);
});

test("a character who was ALREADY defeated stays defeated", () => {
  const plan = reversalPlan(
    { before: 0, after: 0, hadStatuses: ["unconscious"], wasDefeated: true },
    { statuses: ["unconscious"], defeated: true });
  assert.equal(plan.clearDefeated, false);
  assert.deepEqual(plan.clearStatuses, []);
  assert.equal(plan.heal, 0);
});

test("a non-lethal hit restores HP and touches nothing else", () => {
  const plan = reversalPlan(
    { before: 11, after: 7, hadStatuses: [], wasDefeated: false },
    { statuses: [], defeated: false });
  assert.deepEqual(plan, { heal: 4, clearStatuses: [], clearDefeated: false });
});

test("heal never goes negative, and an empty snapshot is a no-op", () => {
  assert.equal(reversalPlan({ before: 4, after: 9 }, {}).heal, 0, "healed in between — nothing owed");
  assert.deepEqual(reversalPlan({}, {}), { heal: 0, clearStatuses: [], clearDefeated: false });
  assert.deepEqual(reversalPlan(), { heal: 0, clearStatuses: [], clearDefeated: false });
});

test("defeat statuses follow the actor type the system branches on", () => {
  assert.deepEqual(defeatStatusesFor("Player"), ["prone", "unconscious"]);
  assert.deepEqual(defeatStatusesFor("NPC"), ["dead"]);
  assert.deepEqual(defeatStatusesFor(undefined), ["dead"]);
});
