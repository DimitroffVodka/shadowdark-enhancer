/**
 * Martial training's tier gate.
 *
 * The regression this exists for: martial training is the only activity whose
 * EVERY slot carries a tier, so when the class hit die couldn't be read the
 * window narrowed to a tier of `null`, matched no slots, and dropped the whole
 * activity — a classless (level 0) character, or any actor whose class item
 * wouldn't load, simply never saw Martial Training. The documented behaviour is
 * the opposite: every tier shows, all of it dead, with the note saying why
 * (docs/wiki/Downtime.md, "Martial Training").
 *
 * Pure: `martialTierBuckets` takes `isGM` and the actor's name as arguments and
 * reads nothing off a Foundry global, so plain objects stand in for the facts.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { martialTierBuckets } from "../scripts/downtime/downtime-session.mjs";
import { DOWNTIME_SKELETON } from "../scripts/downtime/downtime-skeleton.mjs";

const MARTIAL = DOWNTIME_SKELETON.activities.find((a) => a.key === "martialTraining");
const TIERS = MARTIAL.gate.tiers;

/** classFacts() shape for a character whose class read cleanly. */
const readable = (tier) => ({ martialTier: tier, classError: null });
/** classFacts() shape for the two ways a class read can fail. */
const unreadable = (why) => ({ martialTier: null, classError: why });

const slotKeys = (buckets) => buckets.flatMap((b) => b.slots.map((s) => s.key));

describe("unreadable hit die", () => {
  const blocked = martialTierBuckets(MARTIAL, {
    facts: unreadable("no class is set on this character"),
    casterList: null,
    isGM: false,
    actorName: "Nub",
  });

  test("every tier is still on screen — the activity is never dropped", () => {
    assert.equal(blocked.buckets.length, TIERS.length);
    assert.deepEqual(blocked.buckets.map((b) => b.key), TIERS);
    // The bug: any empty bucket here means no rows, and no rows means the
    // window drops the activity entirely.
    for (const b of blocked.buckets) assert.ok(b.slots.length > 0, `${b.key} bucket is empty`);
    // Nothing is lost or duplicated across the three tiers.
    assert.deepEqual(
      [...slotKeys(blocked.buckets)].sort(),
      MARTIAL.slots.map((s) => s.key).sort(),
    );
  });

  test("all of it is dead, and each tier is labelled", () => {
    assert.equal(blocked.gateBlocked, true);
    for (const b of blocked.buckets) {
      assert.equal(b.enabled, false);
      assert.ok(b.label, `${b.key} bucket has no printed label`);
    }
  });

  test("the note names why, quoting the class error", () => {
    assert.match(blocked.gateNote, /Showing every tier/);
    assert.match(blocked.gateNote, /no class is set on this character/);
  });

  test("a missing class error still yields a note, never `undefined`", () => {
    const r = martialTierBuckets(MARTIAL, { facts: { martialTier: null }, casterList: null });
    assert.match(r.gateNote, /couldn't read class hit die/);
    assert.doesNotMatch(r.gateNote, /undefined|null/);
  });

  test("no tier picker: every tier is already shown, and the gate is shut for a GM too", () => {
    assert.equal(blocked.tierPicker, null);
    const asGm = martialTierBuckets(MARTIAL, {
      facts: unreadable("the class item could not be loaded"), casterList: null, isGM: true,
    });
    // slotAllowed() refuses an unreadable hit die server-side, so a live button
    // here would promise something the GM's own validator would reject.
    for (const b of asGm.buckets) assert.equal(b.enabled, false);
  });
});

describe("readable hit die", () => {
  test("shows the character's own tier, live, with no gate note", () => {
    const r = martialTierBuckets(MARTIAL, {
      facts: readable("d8plus"), casterList: null, isGM: false, actorName: "Vera",
    });
    assert.equal(r.gateBlocked, false);
    assert.equal(r.gateNote, null);
    assert.equal(r.buckets.length, 1);
    assert.equal(r.buckets[0].key, "d8plus");
    assert.equal(r.buckets[0].enabled, true);
    assert.equal(r.buckets[0].reason, null);
    assert.deepEqual(slotKeys(r.buckets), MARTIAL.slots.filter(s => s.tier === "d8plus").map(s => s.key));
  });

  test("the picker offers every tier once and marks the character's own", () => {
    const r = martialTierBuckets(MARTIAL, { facts: readable("d6"), casterList: null });
    assert.deepEqual(r.tierPicker.options.map((o) => o.key), TIERS);
    assert.deepEqual(r.tierPicker.options.filter((o) => o.detected).map((o) => o.key), ["d6"]);
    assert.deepEqual(r.tierPicker.options.filter((o) => o.selected).map((o) => o.key), ["d6"]);
  });

  test("a player browsing a foreign tier reads it, dead, with their own tier named", () => {
    const r = martialTierBuckets(MARTIAL, {
      facts: readable("d4"), casterList: null, isGM: false, viewingTier: "d8plus", actorName: "Vera",
    });
    assert.equal(r.buckets[0].key, "d8plus");
    assert.equal(r.buckets[0].enabled, false);
    assert.equal(r.buckets[0].reason, "Vera trains at d4.");
    assert.ok(r.buckets[0].slots.length > 0, "a browsed tier still shows its rows");
  });

  test("a GM may attempt a foreign tier", () => {
    const r = martialTierBuckets(MARTIAL, {
      facts: readable("d4"), casterList: null, isGM: true, viewingTier: "d8plus",
    });
    assert.equal(r.buckets[0].enabled, true);
    assert.equal(r.buckets[0].reason, null);
  });

  test("a viewing tier the gate doesn't define falls back to the character's own", () => {
    const r = martialTierBuckets(MARTIAL, {
      facts: readable("d6"), casterList: null, viewingTier: "d20",
    });
    assert.equal(r.buckets[0].key, "d6");
  });
});
