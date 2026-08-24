/**
 * Delver Scavenger rules (pure core).
 *
 * > When you expend the last of a consumable item you've carried since your
 * > last rest, roll a d6. On a 5 or 6, you regain one use of that item.
 *
 * The cases worth pinning are the ones a naive implementation gets wrong:
 *
 *  - Shadowdark has NO per-item uses counter, so "one use" is one point of
 *    `system.quantity`, and consumption arrives as either a 1 → 0 decrement OR
 *    an outright document delete depending on which system path ran.
 *  - `PlayerSD.usePotion` deletes the WHOLE stack even at quantity 3. An
 *    "item vanished → trigger" rule pays out for a stack the character never
 *    finished, so a delete only counts when the quantity was 1.
 *  - Item hooks fire on every connected client. Without a deterministic
 *    election, a five-player table posts five cards and restores the torch
 *    five times.
 *
 * Ships ZERO book content — invented fixture text only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_SUCCESS_LOW,
  MIN_SUCCESS_LOW,
  WATCHED_TYPES,
  classifyExpenditure,
  responsibleUserId,
  scavengerProfile,
  successLow,
  successRangeLabel,
} from "../scripts/scavenger/scavenger-core.mjs";

const MOD = "shadowdark-enhancer";

// ── Success range ───────────────────────────────────────────────────────────

test("the base success range is the book's 5-6", () => {
  assert.equal(successLow(0), BASE_SUCCESS_LOW);
  assert.equal(successRangeLabel(0), "5-6");
});

test("each Master Scavenger widens the range by one point", () => {
  assert.equal(successRangeLabel(1), "4-6");
  assert.equal(successRangeLabel(2), "3-6");
});

test("the range floors at 3-6 — the book's own cap", () => {
  // The Delver talent table header reads "reroll 10-11 if Scavenger success
  // range is 3-6", so a third copy can never be acquired, and a hand-built
  // actor carrying one must not reach 2-6.
  assert.equal(successLow(3), MIN_SUCCESS_LOW);
  assert.equal(successLow(99), MIN_SUCCESS_LOW);
  assert.equal(successRangeLabel(5), "3-6");
});

test("a nonsense boost count degrades to the base range", () => {
  for (const bad of [undefined, null, -4, NaN, "two", {}]) {
    assert.equal(successLow(bad), BASE_SUCCESS_LOW, `boosts=${String(bad)}`);
  }
});

// ── Talent detection ────────────────────────────────────────────────────────

const flagged = (role) => ({ name: "irrelevant", flags: { [MOD]: { scavenger: { role } } } });

test("the talent is found by its overlay flag, whatever it is called", () => {
  const p = scavengerProfile([flagged("base")], MOD);
  assert.deepEqual(p, { has: true, boosts: 0 });
});

test("flagged boosts accumulate", () => {
  const p = scavengerProfile([flagged("base"), flagged("boost"), flagged("boost")], MOD);
  assert.deepEqual(p, { has: true, boosts: 2 });
});

test("talents imported before the flag existed still resolve by name", () => {
  // The regression that matters for existing worlds: those Talents carry only
  // `{imported: true}`, so a flag-only lookup would silently do nothing.
  const legacy = [
    { name: "Scavenger", flags: { [MOD]: { imported: true } } },
    { name: "Master Scavenger", flags: { [MOD]: { imported: true } } },
  ];
  assert.deepEqual(scavengerProfile(legacy, MOD), { has: true, boosts: 1 });
});

test("an unrelated talent is not mistaken for Scavenger", () => {
  const others = [{ name: "Trailblazer" }, { name: "Trusty Gear" }, { name: "Deep Pockets" }];
  assert.deepEqual(scavengerProfile(others, MOD), { has: false, boosts: 0 });
});

test("a boost without the base talent still counts as a Scavenger", () => {
  // Not a legal Delver, but reachable via a hand-built actor — better to honour
  // the boost than to silently do nothing.
  assert.deepEqual(scavengerProfile([flagged("boost")], MOD), { has: true, boosts: 1 });
});

test("an empty or missing talent list is inert", () => {
  assert.deepEqual(scavengerProfile([], MOD), { has: false, boosts: 0 });
  assert.deepEqual(scavengerProfile(undefined, MOD), { has: false, boosts: 0 });
});

// ── What counts as expending the last use ───────────────────────────────────

const spend = (over = {}) => classifyExpenditure({ type: "Basic", before: 1, after: 0, ...over });

test("the last unit spent down to zero triggers", () => {
  assert.equal(spend().triggers, true);
  assert.equal(spend().reason, "spent-last");
});

test("spending one of several does not trigger", () => {
  assert.equal(spend({ before: 3, after: 2 }).triggers, false);
  assert.equal(spend({ before: 2, after: 1 }).triggers, false);
});

test("an item deleted at quantity 1 triggers — potions and burnt-out torches", () => {
  const r = spend({ type: "Potion", before: 1, after: undefined, deleted: true });
  assert.equal(r.triggers, true);
  assert.equal(r.reason, "deleted-last");
});

test("a STACK deleted whole never triggers", () => {
  // usePotion throws away all 3; the character did not expend "the last" of it.
  const r = spend({ type: "Potion", before: 3, after: undefined, deleted: true });
  assert.equal(r.triggers, false);
  assert.equal(r.reason, "deleted-stack");
});

test("gaining quantity never triggers", () => {
  assert.equal(spend({ before: 0, after: 1 }).triggers, false);
  assert.equal(spend({ before: 1, after: 5 }).triggers, false);
});

test("wands are never watched, scrolls always are", () => {
  assert.equal(spend({ type: "Wand" }).triggers, false);
  assert.equal(spend({ type: "Wand" }).reason, "type-not-watched");
  assert.equal(spend({ type: "Scroll" }).triggers, true);
  assert.ok(!WATCHED_TYPES.includes("Wand"));
  assert.ok(!WATCHED_TYPES.includes("Gem"));
});

test("ammunition follows its own setting", () => {
  const ammo = { type: "Basic", isAmmunition: true, before: 1, after: 0 };
  assert.equal(classifyExpenditure({ ...ammo, watchAmmo: true }).triggers, true);
  assert.equal(classifyExpenditure({ ...ammo, watchAmmo: false }).triggers, false);
  assert.equal(classifyExpenditure({ ...ammo, watchAmmo: false }).reason, "ammo-excluded");
  // The setting only gates ammunition — ordinary gear is unaffected by it.
  assert.equal(classifyExpenditure({ type: "Basic", before: 1, after: 0, watchAmmo: false }).triggers, true);
});

test("an item already at zero has nothing left to expend", () => {
  assert.equal(spend({ before: 0, after: 0 }).triggers, false);
  assert.equal(spend({ before: 0, after: 0, deleted: true }).triggers, false);
  assert.equal(spend({ before: undefined, after: 0 }).triggers, false);
});

test("a non-quantity change is not an expenditure", () => {
  assert.equal(spend({ before: 1, after: undefined }).triggers, false);
  assert.equal(spend({ before: 1, after: NaN }).triggers, false);
});

// ── Which client rolls ──────────────────────────────────────────────────────

test("the owner's own connected session rolls, not the GM", () => {
  const id = responsibleUserId({
    ownerIds: ["player1"], activeUserIds: ["player1", "gm"], activeGmId: "gm",
  });
  assert.equal(id, "player1");
});

test("the GM covers for an offline owner", () => {
  const id = responsibleUserId({
    ownerIds: ["player1"], activeUserIds: ["gm"], activeGmId: "gm",
  });
  assert.equal(id, "gm");
});

test("co-owners elect the same single client from every session", () => {
  // Every client runs this independently; if they disagreed, two would roll.
  const args = { ownerIds: ["zeta", "alpha"], activeUserIds: ["zeta", "alpha", "gm"], activeGmId: "gm" };
  assert.equal(responsibleUserId(args), "alpha");
  assert.equal(responsibleUserId({ ...args, ownerIds: ["alpha", "zeta"] }), "alpha");
});

test("nobody connected means nobody rolls", () => {
  assert.equal(responsibleUserId({ ownerIds: ["p1"], activeUserIds: [], activeGmId: "gm" }), null);
  assert.equal(responsibleUserId({ ownerIds: [], activeUserIds: ["p2"], activeGmId: null }), null);
  assert.equal(responsibleUserId(), null);
});

test("a GM listed as active-GM but not connected does not get elected", () => {
  assert.equal(responsibleUserId({ ownerIds: [], activeUserIds: ["p2"], activeGmId: "gm" }), null);
});
