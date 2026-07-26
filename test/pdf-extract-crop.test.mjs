/**
 * Regression tests for the two 2026-07-14 extractor fixes that make shared
 * gear pages (price table + two-column descriptions on one page) extract
 * correctly for the Item Builder:
 *
 *  1. detectGutter picks the WIDEST minimum-density run, not the first
 *     minimum bin — the first-min pick chose an accidental one-bin gap inside
 *     the left column (WR p107: x=138) and beheaded every description entry
 *     ("Ball bearing. ~~A hefty marble of~~").
 *  2. _cropTablePrefix drops a page's leading full-width price-table block
 *     (≥3 contiguous priced rows, wrap rows like "240 gp 1 13 …" counted)
 *     so gutter detection sees only the true two-column region.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { _internals } from "../scripts/importer/pdf-text-extract.mjs";
import { splitStatblocks } from "../scripts/importer/monsters/statblock-parser.mjs";

const { detectGutter, layoutPageItems, _cropTablePrefix, PRICED_ROW_RE } = _internals;

/** One synthetic PDF.js text item whose x-center is `cx`, at height `y`. */
const item = (cx, y, str = "x", width = 2) =>
  ({ str, width, height: 8, transform: [1, 0, 0, 1, cx - width / 2, y] });

test("detectGutter: widest zero run wins over an earlier one-bin gap (forced 2-col)", () => {
  // W=500, NB=50 → 10-unit bins; central band = bins 15..35. Populate every
  // band bin EXCEPT bin 18 (narrow accidental gap) and bins 26-28 (the real
  // three-bin gutter). Flanks populated so the page clearly has two columns.
  const W = 500;
  const its = [];
  for (let bin = 2; bin <= 47; bin++) {
    if (bin === 18 || (bin >= 26 && bin <= 28)) continue;
    its.push(item(bin * 10 + 5, 700 - bin));
  }
  const split = detectGutter(its, W, "2");
  // Old first-min behavior returned the bin-18 gap (~185); the real gutter
  // spans 260-290.
  assert.ok(split > 260 && split < 290, `split=${split} should fall in the wide 260-290 gutter`);
});

test("_cropTablePrefix: drops the priced-table prefix, keeps the description region", () => {
  // Top-of-page table (caption, header, priced rows incl. a line-start-cost
  // wrap row), then two description lines lower down.
  const its = [
    item(200, 700, "ARMOR", 60),
    item(200, 690, "Item Cost Gear Slots AC", 200),
    item(200, 680, "Leather armor 10 gp 1 11 + DEX mod M", 300),
    item(200, 670, "Chainmail 60 gp 2 13 + DEX mod L, M, R", 300),
    item(60, 660, "Chainmail,", 40),
    item(220, 660, "240 gp 1 13 + DEX mod M", 200),
    item(200, 650, "Plate mail 130 gp 3 15 H, L, M", 300),
    item(100, 620, "Carried (C). This armor occupies", 150),
    item(100, 610, "one hand while using it.", 120),
  ];
  const kept = _cropTablePrefix(its);
  const keptText = kept.map((i) => i.str).join(" | ");
  assert.equal(kept.length, 2, `only the 2 description items should survive, got: ${keptText}`);
  assert.match(keptText, /Carried \(C\)/);
  assert.doesNotMatch(keptText, /gp/);
});

test("_cropTablePrefix: a plain descriptions page (no 3-row priced cluster) passes through", () => {
  const its = [
    item(100, 700, "Crossbow bolts. Ammunition for", 150),
    item(100, 690, "crossbows.", 60),
    item(100, 680, "Crowbar. Grants ADV on checks", 150),
    item(100, 670, "to pry open stuck objects. Costs 2 gp at", 150),
    item(100, 660, "most traders.", 80),
  ];
  assert.equal(_cropTablePrefix(its).length, its.length);
});

test("PRICED_ROW_RE matches mid-line and line-start costs, not prose mentions", () => {
  assert.match("Oil, flask 5 sp 1", PRICED_ROW_RE);
  assert.match("240 gp 1 13 + DEX mod M", PRICED_ROW_RE);
  assert.doesNotMatch("worth 10 silver pieces (sp) or 100", PRICED_ROW_RE);
});

test("layoutPageItems preserves a full-width statblock below two columns", () => {
  const W = 420;
  const its = [
    item(105, 540, "SKRELL", 55),
    item(100, 520, "AC 13, HP 5, ATK 1 claw +2 (1d6)", 170),
    item(100, 500, "MV double near, S +2, D +3, C +1, I -3, W +1, Ch -3, AL C, LV 1", 170),
    item(100, 480, "Clever. Advantage on checks", 170),
    item(100, 460, "to repeat the same action", 170),
    item(100, 440, "on a consecutive turn.", 170),
    item(105, 410, "TAR BAT", 58),
    item(100, 390, "AC 13, HP 4, ATK 1 bite +3 (1d4)", 170),
    item(100, 370, "MV near, S -3, D +3, C +0, I -3, W +1, Ch -3, AL N, LV 1", 170),
    item(300, 540, "PLOGRINA B.", 90),
    item(300, 520, "AC 14, HP 25, ATK 2 tendril +4 (1d6)", 170),
    item(300, 500, "MV near, S +0, D +4, C +3, I +1, W +1, Ch +3, AL C, LV 5", 170),
    item(300, 480, "Rubbery. Half damage", 170),
    item(300, 460, "from stabbing weapons.", 170),
    item(300, 440, "Slime Form. Climb walls.", 170),
    { ...item(210, 205, "THE WILLOWMAN", 124), height: 13 },
    item(205, 183, "A pale, faceless man with elongated limbs and curved talons.", 338),
    item(205, 149, "AC 17, HP 61, ATK 3 finger needle +9 (2d10), MV near", 338),
    item(173, 134, "S +5, D +7, C +3, I +4, W +4, Ch +5, AL C, LV 13", 274),
  ];

  const { gutter, lines } = layoutPageItems(its, W, "auto");
  assert.ok(gutter > 150 && gutter < 275, `expected an upper-column gutter, got ${gutter}`);
  assert.deepEqual(lines.slice(0, 3).map((s) => s.split(" ")[0]), ["SKRELL", "AC", "MV"]);
  const willowIdx = lines.indexOf("THE WILLOWMAN");
  const plogrinaIdx = lines.indexOf("PLOGRINA B.");
  assert.ok(willowIdx > plogrinaIdx, "full-width block must follow both upper columns");
  assert.match(lines[willowIdx + 2], /^AC 17, HP 61/);
  assert.match(lines[willowIdx + 3], /LV 13$/);

  const parsed = splitStatblocks(lines.join("\n"));
  assert.deepEqual(parsed.monsters.map((m) => m.split("\n")[0]),
    ["SKRELL", "TAR BAT", "PLOGRINA B.", "THE WILLOWMAN"]);
  assert.deepEqual(parsed.skipped, []);
});
