import test from "node:test";
import assert from "node:assert/strict";
import { isCriticalFailure, luckGrantingSource, LUCK_GRANTING } from "../scripts/luck-reroll/hard-luck.mjs";

test("a critical failure is the system's call, including a widened failure range", () => {
  assert.equal(isCriticalFailure({ criticalFailure: true, dice: [{ faces: 20, results: [{ result: 2 }] }] }), true,
    "an effect made 2 a critical failure");
  assert.equal(isCriticalFailure({ criticalFailure: false, dice: [{ faces: 20, results: [{ result: 1 }] }] }), false,
    "the system says no, so no");
  assert.equal(isCriticalFailure({ criticalFailure: null, dice: [{ faces: 20, results: [{ result: 1 }] }] }), false,
    "a roll that cannot critical is not a critical failure");
  assert.equal(isCriticalFailure({ dice: [{ faces: 20, results: [{ result: 1, active: true }] }] }), true, "a plain Roll: a d20 showing 1");
  assert.equal(isCriticalFailure({ dice: [{ faces: 20, results: [{ result: 1, active: false }, { result: 14 }] }] }), false,
    "a discarded 1 (advantage) does not count");
  assert.equal(isCriticalFailure(null), false);
});

test("a roll made with Bless, Trance or Omen is found by name; others are not", () => {
  const names = { "Actor.a.Item.bless": "Bless", "Actor.a.Item.omen": "Omen", "Actor.a.Item.scroll": "Scroll of Trance",
    "Compendium.x.Item.trance": "Trance", "Actor.a.Item.mm": "Magic Missile" };
  const nameOf = (uuid) => names[uuid] ?? null;
  assert.equal(luckGrantingSource({ itemUuid: "Actor.a.Item.bless", cast: { spellUuid: "Actor.a.Item.bless" } }, nameOf), "Bless");
  assert.equal(luckGrantingSource({ itemUuid: "Actor.a.Item.omen" }, nameOf), "Omen", "a class ability");
  assert.equal(luckGrantingSource({ itemUuid: "Actor.a.Item.inspire" }, (u) => (u.endsWith("inspire") ? "Inspire" : null)), "Inspire", "the Bard's Inspire");
  assert.equal(luckGrantingSource({ itemUuid: "Actor.a.Item.scroll", cast: { spellUuid: "Compendium.x.Item.trance" } }, nameOf), "Trance",
    "a scroll is judged by the spell it casts");
  assert.equal(luckGrantingSource({ itemUuid: "Actor.a.Item.mm", cast: { spellUuid: "Actor.a.Item.mm" } }, nameOf), null);
  assert.equal(luckGrantingSource({}, nameOf), null, "a plain check");
  assert.equal(luckGrantingSource(undefined, nameOf), null);
  assert.equal(luckGrantingSource({ itemUuid: "Actor.a.Item.gone" }, nameOf), null, "an item that no longer resolves");
  assert.deepEqual(LUCK_GRANTING, ["Bless", "Inspire", "Trance", "Omen"]);
});
