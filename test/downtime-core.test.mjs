/**
 * Downtime core tests — the DC ladder, per-source cost, the two activity gates,
 * and the stored-record contract. Also pins the shipped skeleton's invariants
 * (slot keys usable as Foundry flag keys, DCs on the ladder, phase-2 safety).
 *
 * No book text: only slot keys, DC numbers and paid flags, all of which are
 * bare mechanics the module is free to ship.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_SLOTS,
  DC_LADDER,
  EXPECTED_SLOT_COUNT,
  PHASE2_ELIGIBLE,
  SKELETON_VERSION,
  SOURCE_SLUGS,
  isPaid,
} from "../scripts/downtime/downtime-skeleton.mjs";
import {
  attemptCost,
  buildUnlockRecord,
  casterListForAbility,
  effectiveDC,
  ladderIndex,
  martialTierForHitDie,
  nextStepsOnFailure,
  readStored,
  slotByKey,
} from "../scripts/downtime/downtime-core.mjs";

const slot = (key) => slotByKey(key).slot;

describe("skeleton invariants", () => {
  test("slot count is pinned", () => {
    assert.equal(ALL_SLOTS.length, EXPECTED_SLOT_COUNT);
  });

  test("slot keys are unique, kebab-case and dot-free", () => {
    const seen = new Set();
    for (const { slot: s } of ALL_SLOTS) {
      assert.match(s.key, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slot key: ${s.key}`);
      assert.equal(seen.has(s.key), false, `duplicate slot key: ${s.key}`);
      seen.add(s.key);
    }
  });

  test("every DC sits on the shared ladder", () => {
    for (const { slot: s } of ALL_SLOTS) assert.ok(DC_LADDER.includes(s.dc), `off-ladder DC: ${s.key}`);
  });

  test("both source slugs use the module's source-title convention", () => {
    assert.deepEqual(SOURCE_SLUGS, ["cs6", "western-reaches"]);
  });

  test("the minor-crime slot is the only paid divergence", () => {
    const diverging = ALL_SLOTS
      .filter(({ slot: s }) => isPaid(s, "cs6") !== isPaid(s, "western-reaches"))
      .map(({ slot: s }) => s.key);
    assert.deepEqual(diverging, ["minor-crime"]);
    assert.equal(isPaid(slot("minor-crime"), "cs6"), true);
    assert.equal(isPaid(slot("minor-crime"), "western-reaches"), false);
  });

  test("phase-2 eligibility excludes every martial tier slot and both scroll slots", () => {
    for (const { activity, slot: s } of ALL_SLOTS) {
      if (activity.key === "martialTraining") assert.equal(PHASE2_ELIGIBLE.has(s.key), false, s.key);
    }
    assert.equal(PHASE2_ELIGIBLE.has("arcane-create-scroll"), false);
    assert.equal(PHASE2_ELIGIBLE.has("divine-create-scroll"), false);
    for (const key of ["church-favor", "spiritual-strengthening", "personal-insight", "spiritual-cleansing", "rumor", "minor-crime"]) {
      assert.equal(PHASE2_ELIGIBLE.has(key), true, key);
    }
  });
});

describe("DC ladder", () => {
  test("ladderIndex", () => {
    assert.deepEqual(DC_LADDER.map(ladderIndex), [0, 1, 2, 3, 4]);
    assert.equal(ladderIndex(13), -1);
  });

  test("each failure steps the DC down one rung", () => {
    const s = slot("arcane-create-wand");
    assert.equal(effectiveDC(s, 0), 20);
    assert.equal(effectiveDC(s, 1), 18);
    assert.equal(effectiveDC(s, 2), 15);
    assert.equal(effectiveDC(s, 4), 9);
  });

  test("the ladder floors at its lowest rung", () => {
    assert.equal(effectiveDC(slot("arcane-create-wand"), 99), 9);
    assert.equal(effectiveDC(slot("church-favor"), 3), 9);
    assert.equal(effectiveDC(slot("church-favor"), -2), 9);
  });

  test("step counter never climbs past the bottom rung", () => {
    const s = slot("extortion");
    assert.equal(nextStepsOnFailure(s, 0), 1);
    assert.equal(nextStepsOnFailure(s, 1), 2);
    assert.equal(nextStepsOnFailure(s, 2), 2);
    assert.equal(nextStepsOnFailure(slot("church-favor"), 0), 0);
  });
});

describe("attemptCost", () => {
  test("cs6 scales with level, western-reaches is flat", () => {
    const paid = slot("personal-insight");
    assert.equal(attemptCost("cs6", paid, 1), 10);
    assert.equal(attemptCost("cs6", paid, 5), 50);
    assert.equal(attemptCost("western-reaches", paid, 5), 50);
    assert.equal(attemptCost("western-reaches", paid, 1), 50);
  });

  test("free slots cost nothing, and the divergent slot follows its source", () => {
    assert.equal(attemptCost("cs6", slot("rumor"), 4), 0);
    assert.equal(attemptCost("cs6", slot("minor-crime"), 3), 30);
    assert.equal(attemptCost("western-reaches", slot("minor-crime"), 3), 0);
  });

  test("a missing or bogus level still charges one level of cs6 cost", () => {
    assert.equal(attemptCost("cs6", slot("personal-insight"), undefined), 10);
  });

  test("rejects an unknown source slug", () => {
    assert.throws(() => attemptCost("cs7", slot("rumor"), 1), /unknown source slug/);
  });
});

describe("activity gates", () => {
  test("martial tier from the class hit die", () => {
    assert.equal(martialTierForHitDie("d4"), "d4");
    assert.equal(martialTierForHitDie("d6"), "d6");
    assert.equal(martialTierForHitDie("d8"), "d8plus");
    assert.equal(martialTierForHitDie("d10"), "d8plus");
    assert.equal(martialTierForHitDie("d12"), "d8plus");
    assert.equal(martialTierForHitDie("1d8"), "d8plus");
    assert.equal(martialTierForHitDie("D6"), "d6");
  });

  test("an unreadable hit die resolves to null rather than a guess", () => {
    for (const bad of ["", null, undefined, "none", "d5"]) assert.equal(martialTierForHitDie(bad), null, String(bad));
  });

  test("caster list from the spellcasting ability", () => {
    assert.equal(casterListForAbility("int"), "arcane");
    assert.equal(casterListForAbility("wis"), "divine");
    assert.equal(casterListForAbility("cha"), "ambiguous");
    assert.equal(casterListForAbility("CHA"), "ambiguous");
    assert.equal(casterListForAbility("str"), null);
    assert.equal(casterListForAbility(""), null);
    assert.equal(casterListForAbility(undefined), null);
  });
});

describe("stored record", () => {
  const AT = "2026-07-28T10:00:00.000Z";

  test("builds from a parse result with the caller's timestamp", () => {
    const record = buildUnlockRecord(
      { filled: { rumor: "a", "lay-low": "b" }, unfilledSlots: ["extortion"] },
      { unlockedAt: AT },
    );
    assert.deepEqual(record, {
      version: SKELETON_VERSION,
      unlockedAt: AT,
      slots: { rumor: "a", "lay-low": "b" },
      missing: ["extortion"],
      partial: true,
    });
  });

  test("partial is false only when nothing is missing", () => {
    assert.equal(buildUnlockRecord({ filled: {}, unfilledSlots: [] }, { unlockedAt: AT }).partial, false);
  });

  test("refuses to invent a timestamp", () => {
    assert.throws(() => buildUnlockRecord({ filled: {}, unfilledSlots: [] }, {}), /unlockedAt/);
    assert.throws(() => buildUnlockRecord({ filled: {}, unfilledSlots: [] }), /unlockedAt/);
  });

  test("reads back a current record", () => {
    const r = readStored({ version: SKELETON_VERSION, unlockedAt: AT, slots: { rumor: "a" } });
    assert.deepEqual(r, { ok: true, stale: false, slots: { rumor: "a" }, droppedKeys: [] });
  });

  test("a version mismatch is stale but keeps the text", () => {
    const r = readStored({ version: "0.9.0", slots: { rumor: "a" } });
    assert.equal(r.stale, true);
    assert.deepEqual(r.slots, { rumor: "a" });
  });

  test("unknown slot keys are dropped, never remapped", () => {
    const r = readStored({ version: SKELETON_VERSION, slots: { rumor: "a", "old-key": "b" } });
    assert.deepEqual(r.slots, { rumor: "a" });
    assert.deepEqual(r.droppedKeys, ["old-key"]);
  });

  test("junk reads as not-ok", () => {
    for (const bad of [null, undefined, {}, { slots: null }, "nope"]) {
      assert.deepEqual(readStored(bad), { ok: false, stale: false, slots: {}, droppedKeys: [] });
    }
  });
});

describe("slotByKey", () => {
  test("resolves a stored key back to its activity", () => {
    const hit = slotByKey("d8-damage-die");
    assert.equal(hit.activity.key, "martialTraining");
    assert.equal(hit.slot.tier, "d8plus");
    assert.equal(hit.slot.dc, 15);
  });

  test("carries the mechanical deltas the books grant", () => {
    assert.equal(slotByKey("spiritual-strengthening").slot.xpDelta, 2);
    assert.equal(slotByKey("church-favor").slot.renownDelta, 1);
    assert.equal(slotByKey("rumor").slot.renownSigned, true);
  });

  test("returns null for an unknown key", () => {
    assert.equal(slotByKey("nope"), null);
  });
});
