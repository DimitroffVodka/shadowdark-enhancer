import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeStructuralWarnings, isInformationalWarning,
} from "../scripts/importer/tables/table-importer.mjs";

// What the parser DID vs. what is WRONG. A complete table carrying only these
// notes must still report as correct — a Western Reaches backgrounds paste
// covering all 100 faces was flagged broken purely for the pre-row note.
test("notes about what the parser did are informational, not defects", () => {
  assert.ok(isInformationalWarning("Auto-fixed: row 12 range 21-24 → 23-24."));
  assert.ok(isInformationalWarning("Rebuilt ranges from row order."));
  assert.ok(isInformationalWarning('Pre-row text kept as table description: "BACKGROUNDS d100/d12 Desert"'));
});

test("real defects are not informational", () => {
  assert.equal(isInformationalWarning("Value 7 has no row."), false);
  assert.equal(isInformationalWarning("Roll 49: no row found."), false);
  assert.equal(isInformationalWarning("Rows 3 and 4 overlap."), false);
  assert.equal(isInformationalWarning(""), false);
  assert.equal(isInformationalWarning(), false);
});

// The strings below are exactly what computeWarnings() emits — if that wording
// changes, these tests are what catches the summary silently going blank.

test("names a single missing value", () => {
  assert.equal(summarizeStructuralWarnings(["Value 7 has no row."]), "value 7 has no row");
});

test("collapses a run of missing values into ranges", () => {
  const w = [97, 98, 99, 100].map(n => `Value ${n} has no row.`);
  assert.equal(summarizeStructuralWarnings(w), "values 97-100 have no row");
});

test("mixes singles and ranges, in order", () => {
  const w = ["Value 49 has no row.", "Value 100 has no row.", "Value 97 has no row.", "Value 98 has no row."];
  assert.equal(summarizeStructuralWarnings(w), "values 49, 97-98, 100 have no row");
});

test("reports an overlapping pair, and counts several", () => {
  assert.equal(summarizeStructuralWarnings(["Rows 3 and 4 overlap."]), "rows 3 and 4 overlap");
  assert.equal(
    summarizeStructuralWarnings(["Rows 3 and 4 overlap.", "Rows 8 and 9 overlap."]),
    "2 pairs of rows overlap",
  );
});

test("reports a formula/range mismatch", () => {
  assert.equal(
    summarizeStructuralWarnings(["Rows reach 20 but formula is 1d12."]),
    "rows reach 20 but the formula is 1d12",
  );
});

test("joins every kind of problem into one line", () => {
  const w = ["Rows 3 and 4 overlap.", "Value 7 has no row.", "Rows reach 20 but formula is 1d12."];
  assert.equal(
    summarizeStructuralWarnings(w),
    "value 7 has no row; rows 3 and 4 overlap; rows reach 20 but the formula is 1d12",
  );
});

test("says nothing when there is nothing structural to say", () => {
  assert.equal(summarizeStructuralWarnings([]), "");
  assert.equal(summarizeStructuralWarnings(), "");
});

// A seeded import runs the shape recipes in table-shapes.mjs, which report the
// SAME defect in different words ("Roll 49: no row found." — :1335). Missing
// this is what made the banner fall back to the vague wording on a real
// Western Reaches backgrounds paste.
test("understands the shape parser's wording for a missing roll", () => {
  const w = [49, 97, 98, 99, 100].map(n => `Roll ${n}: no row found.`);
  assert.equal(summarizeStructuralWarnings(w), "values 49, 97-100 have no row");
});

test("mixes both vocabularies into one list", () => {
  assert.equal(
    summarizeStructuralWarnings(["Roll 3: no row found.", "Value 5 has no row."]),
    "values 3, 5 have no row",
  );
});

test("reports rolls that fell outside the die", () => {
  assert.equal(
    summarizeStructuralWarnings(["Roll 21 is outside 1–20 — check the die size."]),
    "roll 21 fell outside the die",
  );
});

test("an unrecognised warning is quoted verbatim rather than dropped", () => {
  // Guards the failure mode this helper shipped with: an unknown string made
  // the summary empty, so the banner said nothing concrete.
  assert.equal(
    summarizeStructuralWarnings(["Lookup parse: 12 rows found, expected 20 — check the paste."]),
    "Lookup parse: 12 rows found, expected 20 — check the paste",
  );
});
