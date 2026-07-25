import test from "node:test";
import assert from "node:assert/strict";
import { summarizeStructuralWarnings } from "../scripts/importer/tables/table-importer.mjs";

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
  // Auto-fix / rebuild notes are informational and never reach this helper,
  // but an unrecognised string must not invent a problem either.
  assert.equal(summarizeStructuralWarnings(["Auto-fixed: row 12 range 21-24 → 23-24."]), "");
});
