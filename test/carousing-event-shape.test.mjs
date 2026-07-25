import test from "node:test";
import assert from "node:assert/strict";
import { parseByShape } from "../scripts/importer/tables/table-importer.mjs";
import { resolveShape } from "../scripts/importer/tables/table-shapes.mjs";

/**
 * CORE p92 "Carousing Event", as the layout extractor emits it: the Cost and
 * Bonus sit on one line, vertically centred against an Event that wraps above
 * AND below them. Reproduced verbatim (column spacing included) from the real
 * PDF text — the whole bug lived in how these fragments get grouped.
 */
const LAYOUT = [
  "CAROUSING EVENT",
  "Cost    Event                                  Bonus",
  "30 gp    A worthy night of drinking and festivity       +0",
  "A full day and night of revelry, gambling,",
  "100 gp                                        +1",
  "and recounting your exploits",
  "Two days of crawling dozens of taverns",
  "300 gp                                        +2",
  "to sing, buy rounds, and celebrate",
  "A three-day voyage into the finest food,",
  "600 gp                                        +3",
  "drink, and gambling you can find",
  "A hazy, weeklong bender that runs",
  "900 gp                                        +4",
  "multiple well-known taverns dry",
  "A spirited fete lasting ten days that",
  "1,200 gp   attracts hordes of revelers and takes         +5",
  "over an entire town or a city district",
  "Two legendary weeks of drinking and",
  "debauchery widespread enough to take",
  "1,800 gp   over a whole city. It attracts countless        +6",
  "celebrants, including famous nobles",
  "and bards; the streets run red with wine",
].join("\n");

const parse = () => {
  const shape = resolveShape({ name: "Carousing Event", src: "CORE" });
  return { shape, table: parseByShape(LAYOUT, shape, { name: "Carousing Event" })?.tables?.[0] };
};

test("the shape asks for layout extraction (reading order interleaves the columns)", () => {
  const { shape } = parse();
  assert.equal(shape.extractCols, "layout");
  assert.equal(shape.dieIndexed, false);
});

test("seven rows, not one per wrapped line", () => {
  // The bug: every wrapped line became its own row, because a no-die first
  // column starts at x=0 so each fragment looked like a new anchor.
  const { table } = parse();
  assert.equal(table.rows.length, 7);
  assert.equal(table.formula, "1d7");
});

test("each row keeps its cost, its whole event text, and its bonus", () => {
  const { table } = parse();
  const cells = table.rows.map(r => r.text.split(" | ").map(s => s.trim()));
  assert.deepEqual(cells.map(c => c[0]),
    ["30 gp", "100 gp", "300 gp", "600 gp", "900 gp", "1,200 gp", "1,800 gp"]);
  assert.deepEqual(cells.map(c => c[2]), ["+0", "+1", "+2", "+3", "+4", "+5", "+6"]);
  // Text wrapping ABOVE its cost line and BELOW it both belong to that row.
  assert.equal(cells[1][1], "A full day and night of revelry, gambling, and recounting your exploits");
  assert.equal(cells[4][1], "A hazy, weeklong bender that runs multiple well-known taverns dry");
  // The longest entry wraps twice above and twice below its anchor.
  assert.match(cells[6][1], /^Two legendary weeks of drinking and debauchery/);
  assert.match(cells[6][1], /the streets run red with wine$/);
});

test("no cost bleeds into the event text", () => {
  // Fragments used to be x-sliced, scattering their first word into the Cost
  // column ("100 gp A full").
  const { table } = parse();
  for (const r of table.rows) {
    const [cost, event] = r.text.split(" | ");
    assert.match(cost.trim(), /^[\d,]+ gp$/);
    assert.doesNotMatch(event ?? "", /\bgp\b/);
  }
});

test("a clean parse raises no warnings", () => {
  const { table } = parse();
  assert.deepEqual(table.warnings, []);
});
