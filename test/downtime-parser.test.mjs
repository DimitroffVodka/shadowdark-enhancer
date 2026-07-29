/**
 * Downtime unlock parser tests.
 *
 * Every fixture below is INVENTED for this test suite — synthetic outcome
 * sentences that share the published *structure* (headers, check lines, tier
 * lines, "DC n:" bullets, page-number artifacts) without reproducing a single
 * sentence of anyone's book. That is the whole point: the parser must be
 * provable without shipping the text it parses.
 *
 * Pure string work, no Foundry globals, runs under `node --test`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseDowntimeText } from "../scripts/downtime/downtime-parser.mjs";

const codes = (result) => result.warnings.map((w) => w.code);
const keys = (result) => Object.keys(result.filled);

// --- F1: clean sequential parse, one tier segment -------------------------
// Keywords intentionally hit: "armor or weapon" @9, "hit and damage" @12,
// "damage die" @15 — all inside the d8+ segment. The DC 15 bullet also wraps
// across a line on a hyphen, to exercise continuation re-gluing.
const F1_CLEAN = `
MARTIAL TRAINING
Coaching from a grizzled veteran.
d8+. INT, STR, or DEX Check
• DC 9*: Borrow a rack of spare armor or weapon kit.
• DC 12*: Sharpen one blade for +1 hit and damage marks.
• DC 15*: Swap the damage die of a favored two-
handed axe upward.
`;

// --- F2: column-interleaved spiritualism / skulduggery --------------------
// Reproduces the extraction defect: both activity headers and both check lines
// land before any bullets, so the four spiritualism bullets arrive inside the
// skulduggery CHA segment. Keywords hit in phase 1: rumor/lay low/extortion/
// hide out (CHA) and petty theft/murder (DEX). Rescued in phase 2 by globally
// unique keywords: church/strengthening/insight/curse. "26" is a page artifact.
const F2_INTERLEAVED = `
SPIRITUALISM
Quiet contemplation in a drafty hall.
WIS Check
SKULDUGGERY
Back-alley dealings and loose talk.
CHA Check
• DC 9: Spread a rumor about a rival. Their standing shifts by 1.
• DC 12: Lay low in a cellar until the heat fades.
• DC 15: Extortion nets you a better bargain either way.
• DC 18: Hide out beyond the walls for a season.
• DC 9: Sweep the church steps and earn goodwill.
• DC 12: A week of strengthening drills steadies you.
• DC 15*: A flash of insight lets you revisit an old choice.
• DC 18*: A cleansing rite lifts one curse from your bones.
DEX Check
• DC 15*: Lift a purse by petty theft without being seen.
• DC 18*: Get clean away after a murder in the market.
26
`;

// --- F3: martial tier disambiguation --------------------------------------
// "hit and damage" @12 appears in two tiers and "new weapon" in two more.
// Only the tier headers can tell them apart.
const F3_TIERS = `
MARTIAL TRAINING
d4. INT, STR, or DEX Check
• DC 15*: Drill until you gain +1 hit or damage with a club.
• DC 18*: Take up a new weapon of modest heft.
d6. INT, STR, or DEX Check
• DC 12*: Drill until you gain +1 hit and damage with a club.
• DC 15*: Take up a new weapon, or heavier plate.
d8+. INT, STR, or DEX Check
• DC 12*: Drill until you gain +1 hit and damage with a maul.
• DC 15*: Swap the damage die of a favored axe upward.
`;

const F3_NO_TIERS = F3_TIERS.split("\n").filter((l) => !/^d[468]/.test(l)).join("\n");
const F3_NO_TIERS_ORPHAN = `SPIRITUALISM\nQuiet contemplation in a drafty hall.\nWIS Check\n${F3_NO_TIERS}`;

// --- F4: asterisk mismatch + unmatched bullet -----------------------------
// Parsed as western-reaches, where the DC 15 crime slot is free: the starred
// bullet disagrees with the skeleton. The DC 12 bullet matches no DEX slot.
const F4_MIXED = `
SKULDUGGERY
DEX Check
• DC 15*: Lift a purse by petty theft without being seen.
• DC 12: Bribe a dockhand to lose a manifest.
MAGICAL RESEARCH
INT or CHA Spellcasters
• DC 15*: Bind one potion of drifting mist.
• DC 20*: Bind a wand that hums when carried.
`;

// --- F5: wrong-source authority cross-check -------------------------------
const F5_AUTHORITY = `
SKULDUGGERY
DEX Check
• DC 15*: Lift a purse by petty theft while the City Guard naps.
`;

describe("parseDowntimeText — clean sequential", () => {
  test("fills a tier segment and re-glues a hyphen-wrapped bullet", () => {
    const r = parseDowntimeText(F1_CLEAN, { source: "cs6" });
    assert.deepEqual(keys(r), ["d8-new-armor-weapon", "d8-hit-and-damage", "d8-damage-die"]);
    assert.equal(r.filled["d8-damage-die"], "Swap the damage die of a favored two-handed axe upward.");
    assert.deepEqual(r.unmatchedBullets, []);
    assert.equal(r.unfilledSlots.length, 22);
    assert.deepEqual(codes(r), ["incomplete-unlock"]);
  });
});

describe("parseDowntimeText — column interleave", () => {
  test("phase 2 rescues the orphaned spiritualism bullets", () => {
    const r = parseDowntimeText(F2_INTERLEAVED, { source: "cs6" });
    assert.deepEqual(keys(r).sort(), [
      "church-favor", "extortion", "hide-out", "lay-low", "major-crime",
      "minor-crime", "personal-insight", "rumor", "spiritual-cleansing",
      "spiritual-strengthening",
    ]);
    assert.deepEqual(r.unmatchedBullets, []);
    assert.deepEqual(codes(r), [
      "segment-overflow", "orphan-segment",
      "phase2-fill", "phase2-fill", "phase2-fill", "phase2-fill",
      "incomplete-unlock",
    ]);
    const overflow = r.warnings.find((w) => w.code === "segment-overflow");
    assert.deepEqual(
      { segmentId: overflow.segmentId, bullets: overflow.bullets, slots: overflow.slots },
      { segmentId: "skulduggery.cha", bullets: 8, slots: 4 },
    );
    assert.equal(r.warnings.find((w) => w.code === "orphan-segment").activity, "spiritualism");
    // The page-number artifact never lands in a slot.
    assert.ok(!Object.values(r.filled).some((t) => /^\d+$/.test(t)));
  });

  test("rescued bullets do not leave phase-1 noise behind", () => {
    const r = parseDowntimeText(F2_INTERLEAVED, { source: "cs6" });
    assert.equal(codes(r).includes("keyword-miss"), false);
  });

  test("stored text is byte-identical to the pasted bullet", () => {
    const r = parseDowntimeText(F2_INTERLEAVED, { source: "cs6" });
    for (const text of Object.values(r.filled)) assert.ok(F2_INTERLEAVED.includes(text));
  });

  test("is deterministic", () => {
    const a = parseDowntimeText(F2_INTERLEAVED, { source: "cs6" });
    const b = parseDowntimeText(F2_INTERLEAVED, { source: "cs6" });
    assert.deepEqual(a, b);
  });

  test("the same paste read as western-reaches flags exactly one asterisk mismatch", () => {
    const r = parseDowntimeText(F2_INTERLEAVED, { source: "western-reaches" });
    const mismatches = r.warnings.filter((w) => w.code === "asterisk-mismatch");
    assert.equal(mismatches.length, 1);
    assert.deepEqual(
      { slot: mismatches[0].slot, bulletStar: mismatches[0].bulletStar, skeletonPaid: mismatches[0].skeletonPaid },
      { slot: "minor-crime", bulletStar: true, skeletonPaid: false },
    );
    // Skeleton wins: the slot still fills.
    assert.ok(r.filled["minor-crime"]);
    assert.equal(Object.keys(r.filled).length, 10);
  });
});

describe("parseDowntimeText — martial tier disambiguation", () => {
  test("tier headers route the repeated wording to the right tier", () => {
    const r = parseDowntimeText(F3_TIERS, { source: "cs6" });
    assert.deepEqual(keys(r), [
      "d4-hit-or-damage", "d4-new-weapon", "d6-hit-and-damage",
      "d6-new-weapon", "d8-hit-and-damage", "d8-damage-die",
    ]);
    assert.ok(r.filled["d6-hit-and-damage"].includes("club"));
    assert.ok(r.filled["d8-hit-and-damage"].includes("maul"));
    assert.deepEqual(r.unmatchedBullets, []);
  });

  test("without tier headers nothing is guessed", () => {
    const r = parseDowntimeText(F3_NO_TIERS, { source: "cs6" });
    assert.deepEqual(r.filled, {});
    assert.equal(r.unmatchedBullets.length, 6);
    assert.ok(r.unmatchedBullets.every((b) => b.reason === "unresolved-segment"));
  });

  test("phase 2 never reaches martial slots even under a corruption signature", () => {
    const r = parseDowntimeText(F3_NO_TIERS_ORPHAN, { source: "cs6" });
    assert.ok(codes(r).includes("orphan-segment"));
    assert.equal(codes(r).includes("phase2-fill"), false);
    assert.deepEqual(r.filled, {});
    assert.equal(r.unmatchedBullets.length, 6);
  });
});

describe("parseDowntimeText — mismatches and leftovers", () => {
  test("reports the unmatched bullet verbatim and leaves its sibling slot empty", () => {
    const r = parseDowntimeText(F4_MIXED, { source: "western-reaches" });
    assert.deepEqual(keys(r), ["minor-crime", "arcane-create-potion", "arcane-create-wand"]);
    assert.deepEqual(r.unmatchedBullets, [{
      dc: 12,
      paid: false,
      text: "Bribe a dockhand to lose a manifest.",
      segmentId: "skulduggery.dex",
      reason: "dc-not-in-segment",
    }]);
    assert.ok(r.unfilledSlots.includes("arcane-create-scroll"));
    assert.deepEqual(codes(r), ["asterisk-mismatch", "dc-not-in-segment", "incomplete-unlock"]);
  });

  test("cs6 charges the same crime slot, so no mismatch there", () => {
    const r = parseDowntimeText(F4_MIXED, { source: "cs6" });
    assert.equal(codes(r).includes("asterisk-mismatch"), false);
  });

  test("flags a paste that names the other book's authority", () => {
    const wr = parseDowntimeText(F5_AUTHORITY, { source: "western-reaches" });
    const found = wr.warnings.find((w) => w.code === "authority-mismatch");
    assert.deepEqual({ expected: found.expected, found: found.found }, { expected: "authorities", found: "City Guard" });
    const cs6 = parseDowntimeText(F5_AUTHORITY, { source: "cs6" });
    assert.equal(codes(cs6).includes("authority-mismatch"), false);
  });

  test("rejects an unknown source slug", () => {
    assert.throws(() => parseDowntimeText(F1_CLEAN, { source: "cs7" }), /unknown source slug/);
  });

  test("empty input reports every slot unfilled and nothing matched", () => {
    const r = parseDowntimeText("", { source: "cs6" });
    assert.deepEqual(r.filled, {});
    assert.equal(r.unfilledSlots.length, 25);
    assert.deepEqual(r.unmatchedBullets, []);
    assert.deepEqual(codes(r), ["incomplete-unlock"]);
  });
});
