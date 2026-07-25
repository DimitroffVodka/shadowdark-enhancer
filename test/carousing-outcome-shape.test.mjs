import test from "node:test";
import assert from "node:assert/strict";
import { parseByShape } from "../scripts/importer/tables/table-importer.mjs";
import { resolveShape } from "../scripts/importer/tables/table-shapes.mjs";

/**
 * WR pg 237 / CS6 pg 29 "Carousing Outcome", as the single-column extractor
 * emits it. Every cell is one token: a count, a signed modifier, or "-" for
 * none. Range-prefixed parsing read "5 - 1" as the range 5–1, so EVERY row
 * whose Mishap column was "-" vanished — the reported gaps (5, 8, 11-12,
 * 14-15, 17-18, 20-21, 23-24) are exactly those rows.
 */
const PAGE = [
  "Carousing Outcome",
  "CAROUSING OUTCOME",
  "d8 Mishap Benefit d100 Modifier XP",
  "1 2 - -20 2",
  "2 1 - -20 2",
  "3 1 - -15 3",
  "4 1 1 -15 3",
  "5 - 1 -10 3",
  "6 1 - - 4",
  "7 1 1 - 4",
  "8 - 1 - 4",
  "9 1 - - 5",
  "10 1 1 - 5",
  "11 - 1 +5 5",
  "12 - 2 +5 5",
  "13 1 1 +5 6",
  "14 - 1 +5 6",
  "15 - 2 +5 6",
  "16 1 1 +10 7",
  "17 - 1 +10 7",
  "18 - 2 +10 7",
  "19 1 1 +15 8",
  "20 - 1 +15 8",
  "21 - 2 +15 8",
  "22 1 1 +20 9",
  "23 - 2 +20 9",
  "24 - 2 +25 10",
  "25+ - 3 +25 10",
  "237",
].join("\n");

const parse = (src) => {
  const shape = resolveShape({ name: "Carousing Outcome", src });
  return { shape, table: parseByShape(PAGE, shape, { name: "Carousing Outcome" })?.tables?.[0] };
};

for (const src of ["WR", "CS6"]) {
  test(`${src}: all 25 faces get a row, including every "-" row`, () => {
    const { table } = parse(src);
    assert.equal(table.rows.length, 25);
    assert.equal(table.formula, "1d25");
    assert.deepEqual(table.rows.map(r => r.min), Array.from({ length: 25 }, (_, i) => i + 1));
  });

  test(`${src}: cells land in their own columns`, () => {
    const { table } = parse(src);
    const at = (n) => table.rows.find(r => r.min === n).text;
    assert.equal(at(1), "2 | - | -20 | 2");
    assert.equal(at(5), "- | 1 | -10 | 3", 'the row that used to disappear');
    assert.equal(at(12), "- | 2 | +5 | 5");
    assert.equal(at(25), "- | 3 | +25 | 10", '"25+" is face 25');
  });

  test(`${src}: a clean page raises no warnings`, () => {
    assert.deepEqual(parse(src).table.warnings, []);
  });
}

test("the page footer is not read as a row", () => {
  const { table } = parse("WR");
  assert.ok(!table.rows.some(r => r.text.includes("237")));
});

test("a wrapped paste that glues two rows onto one line still reads both", () => {
  const wrapped = PAGE.replace("2 1 - -20 2\n3 1 - -15 3", "2 1 - -20 2 3 1 - -15 3");
  const shape = resolveShape({ name: "Carousing Outcome", src: "WR" });
  const t = parseByShape(wrapped, shape, { name: "Carousing Outcome" })?.tables?.[0];
  assert.equal(t.rows.length, 25);
  assert.equal(t.rows.find(r => r.min === 3).text, "1 | - | -15 | 3");
});
