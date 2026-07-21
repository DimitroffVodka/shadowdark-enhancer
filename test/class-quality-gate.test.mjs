/**
 * Shared class quality gate (AI-Council correction #2).
 *
 * Every UI adapter (dedicated Class Importer + Importer Hub) and the low-level
 * persistence share ONE issue computation, so blockers are enforced
 * consistently. These cover the pure gate logic; the fail-closed sentinel that
 * createClassUnit / mergeClassSupplement return is Foundry-bound and asserted
 * by static wiring (the adapters call confirmClassGate then pass allowInvalid).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  classGateBlockers,
  supplementGateBlockers,
  classGateIssues,
} from "../scripts/importer/char-content/class-quality-gate.mjs";

test("classGateBlockers extracts only BLOCKER-tagged warnings, tag stripped", () => {
  const warnings = [
    "Spellcaster: the class's spell list must be imported separately.",
    "BLOCKER: talent bands don't tile 2..12 — the pairing may be shifted.",
    "No TITLES table in the paste.",
    "blocker: lowercase tag is also matched",
  ];
  assert.deepEqual(classGateBlockers(warnings), [
    "talent bands don't tile 2..12 — the pairing may be shifted.",
    "lowercase tag is also matched",
  ]);
});

test("classGateBlockers tolerates empty / missing input", () => {
  assert.deepEqual(classGateBlockers(), []);
  assert.deepEqual(classGateBlockers([]), []);
  assert.deepEqual(classGateBlockers(["nothing blocking here"]), []);
});

test("supplementGateBlockers: SPELLS KNOWN grid onto a NON-caster is a blocker", () => {
  const sup = { spellsKnown: [{ level: 1, tiers: [2, 0, 0, 0, 0] }], warnings: [] };
  const issues = supplementGateBlockers("__not_spellcaster__", sup, "Green Knight");
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Green Knight/);
  assert.match(issues[0], /NOT a spellcaster/);
  assert.match(issues[0], /SPELLS KNOWN/);
});

test("supplementGateBlockers: caster class with a grid is NOT blocked", () => {
  const sup = { spellsKnown: [{ level: 1, tiers: [2, 0, 0, 0, 0] }], warnings: [] };
  // A real caster carries a class UUID (not the sentinel) — grid is fine.
  assert.deepEqual(supplementGateBlockers("Compendium.shadowdark.classes.Item.abc", sup), []);
  // Own-list caster: empty string means "casts its own list" — also fine.
  assert.deepEqual(supplementGateBlockers("", sup), []);
});

test("supplementGateBlockers: no grid means no not-a-caster blocker even on a non-caster", () => {
  const sup = { titles: [{ from: 1, to: 2 }], warnings: [] };
  assert.deepEqual(supplementGateBlockers("__not_spellcaster__", sup), []);
});

test("supplementGateBlockers carries through supplement BLOCKER warnings and de-dupes the grid message", () => {
  const sup = {
    spellsKnown: [{ level: 1, tiers: [1, 0, 0, 0, 0] }],
    warnings: ["BLOCKER: the paste has a SPELLS KNOWN grid but no Spellcasting feature was captured"],
  };
  const issues = supplementGateBlockers("__not_spellcaster__", sup, "Warden");
  // The pre-existing SPELLS KNOWN blocker is kept; the generated one is skipped
  // (its de-dupe guard matches the /SPELLS KNOWN/ text already present).
  assert.equal(issues.length, 1);
  assert.match(issues[0], /SPELLS KNOWN/);
});

test("classGateIssues: missing talent table flagged unless it's a supplement", () => {
  assert.deepEqual(
    classGateIssues({ warnings: [], hasTalentTable: false, isSupplement: false }),
    ["No talent table — the class will be created without its level-up rolls."]
  );
  assert.deepEqual(classGateIssues({ hasTalentTable: true }), []);
  assert.deepEqual(classGateIssues({ hasTalentTable: false, isSupplement: true }), []);
});

test("report dedupe: a supplement blocker already in warnings is not re-listed on override", () => {
  // mergeClassSupplement, on the allowInvalid override, surfaces GENERATED gate
  // blockers but must skip any already present in sup.warnings (else the same
  // BLOCKER shows twice and inflates the review-note count). This pins the exact
  // strip-equality predicate that code relies on.
  const supWarnings = ["BLOCKER: talent bands (2, 4-6, 7-9) don't tile 2..12"];
  const report = { warnings: [...supWarnings] };
  const gateBlockers = supplementGateBlockers("__not_spellcaster__", { warnings: supWarnings, spellsKnown: [{ level: 1, tiers: [1, 0, 0, 0, 0] }] }, "Warden");
  for (const b of gateBlockers) {
    if (!report.warnings.some((w) => classGateBlockers([w])[0] === b)) report.warnings.push(`BLOCKER: ${b}`);
  }
  // The pre-existing "don't tile" blocker appears once; the generated
  // not-a-caster blocker is added once — total 2, no duplicate.
  assert.equal(report.warnings.length, 2);
  assert.equal(report.warnings.filter((w) => /don't tile/.test(w)).length, 1, "existing blocker not duplicated");
  assert.equal(report.warnings.filter((w) => /NOT a spellcaster/.test(w)).length, 1, "generated blocker added once");
});

test("classGateIssues aggregates table, BLOCKER, and title-split issues in order", () => {
  const issues = classGateIssues({
    warnings: ["BLOCKER: talent bands don't tile 2..12", "informational only"],
    hasTalentTable: false,
    isSupplement: false,
    titleWarnings: ["Titles row 9-10: couldn't split into Lawful/Chaotic/Neutral"],
  });
  assert.deepEqual(issues, [
    "No talent table — the class will be created without its level-up rolls.",
    "talent bands don't tile 2..12",
    "Titles row 9-10: couldn't split into Lawful/Chaotic/Neutral",
  ]);
});
