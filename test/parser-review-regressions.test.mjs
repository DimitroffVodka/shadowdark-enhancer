/**
 * Regression fixtures from the 2026-07-11 PDF-parser code review
 * (docs/PDF-PARSER-CODE-REVIEW-2026-07-11.md, findings #4–#11).
 * All fixture text is invented — no book content.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { splitStatblocks, parseStatblock } from "../scripts/encounter/statblock-parser.mjs";
import { parseItem } from "../scripts/encounter/item-parser.mjs";
import { parseSpell } from "../scripts/encounter/spell-parser.mjs";
import { parseTables, buildTableData } from "../scripts/encounter/table-importer.mjs";
import { parseClassSection } from "../scripts/encounter/class-parser.mjs";

// ── #4 ALL-CAPS monster feature detachment ──────────────────────────────────

const FROG_KING = [
  "FROG KING",
  "AC 12, HP 9, ATK 1 bite +2 (1d6), MV near, S +1, D +1, C +0, I -1, W +0, Ch +1, AL C, LV 2",
  "AMPHIBIOUS",
  "Can breathe air and water.",
].join("\n");

test("#4: ALL-CAPS feature caption stays attached to the monster", () => {
  const { monsters, skipped } = splitStatblocks(FROG_KING);
  assert.equal(monsters.length, 1);
  assert.equal(skipped.length, 0);
  const { draft, warnings } = parseStatblock(monsters[0]);
  assert.deepEqual(draft.features, [{ name: "Amphibious", description: "Can breathe air and water." }]);
  assert.ok(warnings.some((w) => w.includes("Amphibious")), "warning surfaces on the monster card");
});

test("#4 guard: item/spell/table content after a monster is NOT absorbed", () => {
  const item = "CURSED MIRROR\nBenefit. Sees the truth. 30 gp";
  const { monsters, skipped } = splitStatblocks(`${FROG_KING.split("\nAMPHIBIOUS")[0]}\n\n${item}`);
  assert.equal(monsters.length, 1);
  assert.ok(!monsters[0].includes("CURSED MIRROR"));
  assert.equal(skipped[0]?.name, "CURSED MIRROR");
});

// ── #5 gear descriptions sharing a line with cost/slots ────────────────────

test("#5: gear description survives on a shared cost/slot line", () => {
  const r = parseItem("Silk Rope\n50 feet long, 5 gp, 1 slot");
  assert.equal(r.draft.name, "Silk Rope");
  assert.equal(r.draft.description, "<p>50 feet long</p>");
  assert.deepEqual(r.draft.cost, { gp: 5, sp: 0, cp: 0 });
  assert.equal(r.draft.slots.slots_used, 1);
});

test("#5: inline first-line gear text survives", () => {
  const r = parseItem("Rope, 5 gp, 1 slot, 50 feet of hemp");
  assert.equal(r.draft.name, "Rope");
  assert.equal(r.draft.description, "<p>50 feet of hemp</p>");
});

// ── #6 same-line magic-item riders ──────────────────────────────────────────

test("#6: inline rider splits off the name and stays magical", () => {
  const r = parseItem("Flame Ring Benefit. You resist fire.");
  assert.equal(r.draft.name, "Flame Ring");
  assert.deepEqual(r.draft.riders.benefit, ["You resist fire."]);
  assert.match(r.draft.description, /Benefit.+You resist fire\./);
});

// ── #7 heading above a spell name ───────────────────────────────────────────

test("#7: heading above the name never becomes the spell name", () => {
  const r = parseSpell("SPELLS\nFIRE BOLT\nTier 1, wizard\nDuration: Instant\nRange: Near\nDeals 1d6 damage.");
  assert.equal(r.draft.name, "Fire Bolt");
  assert.ok(r.warnings.some((w) => w.includes("SPELLS")), "ignored lead line is surfaced");
});

// ── #8 interleaved spell metadata ───────────────────────────────────────────

test("#8: prose interleaved between metadata lines is preserved in order", () => {
  const r = parseSpell("ARC LIGHT\nTier 1, Wizard\nRange: Near\nThis sentence is between metadata.\nDuration: 3 rounds\nFinal sentence.");
  assert.equal(r.draft.description, "<p>This sentence is between metadata. Final sentence.</p>");
  assert.deepEqual(r.draft.duration, { type: "rounds", value: "3" });
});

// ── #9 defaulted spell metadata warns ───────────────────────────────────────

test("#9: missing duration/range default WITH a warning", () => {
  const noDur = parseSpell("GLIMMER\nTier 1, Wizard\nRange: Near\nShiny.");
  assert.equal(noDur.draft.duration.type, "instant");
  assert.ok(noDur.warnings.some((w) => w.startsWith("duration: line missing")));
  const noRange = parseSpell("GLIMMER\nTier 1, Wizard\nDuration: Focus\nShiny.");
  assert.equal(noRange.draft.range, "close");
  assert.ok(noRange.warnings.some((w) => w.startsWith("range: line missing")));
});

// ── #10 table instructions before the first row ─────────────────────────────

test("#10: pre-row instruction text becomes the table description + warning", () => {
  const tables = parseTables("d6 Weather\nRoll once each morning\n1 Rain\n2 Sun");
  assert.equal(tables.length, 1);
  const pt = tables[0];
  assert.equal(pt.description, "Roll once each morning");
  assert.ok(pt.warnings.some((w) => w.includes("Roll once each morning")));
  const data = buildTableData(pt);
  assert.equal(data.description, "Roll once each morning");
  assert.equal(data.results.length, 2);
});

// ── #11 Weapons: none ────────────────────────────────────────────────────────

test("#11: 'Weapons: none' grants no weapon named none", () => {
  const d = parseClassSection("TESTCLASS\nBrave test heroes.\nWeapons: none\nArmor: none\nHit Points: 1d6 per level");
  assert.deepEqual(d.weaponNames, []);
  assert.deepEqual(d.armorNames, []);
});

// ── 2026-07-13 shared-start range auto-repair (repairSharedStartRanges) ───────
// A row whose low bound repeats the PREVIOUS row's low bound (a common single-
// digit source typo, e.g. the printed "21-24" that should read "23-24") has its
// low shifted to prev.max+1, with an "Auto-fixed:" note. Fixtures are invented.

test("range repair: a shared-start typo shifts the low bound and notes it", () => {
  const [pt] = parseTables("d10 Detail\n1-2 alpha\n3-4 beta\n3-6 gamma\n7-8 delta\n9-10 epsilon");
  const gamma = pt.rows.find((r) => r.text === "gamma");
  assert.equal(gamma.min, 5, "low shifted from 3 to prev.max+1");
  assert.equal(gamma.max, 6, "high bound is untouched");
  assert.ok(pt.warnings.some((w) => /^Auto-fixed:/.test(w)), "repair is announced, not silent");
  assert.ok(!pt.warnings.some((w) => /overlap/i.test(w)), "the overlap is resolved, not warned");
});

test("range repair guard: independent adjacent ranges are left alone", () => {
  const [pt] = parseTables("d10 Detail\n1-2 a\n3-4 b\n5-6 c\n7-8 d\n9-10 e");
  assert.deepEqual(pt.rows.map((r) => [r.min, r.max]), [[1,2],[3,4],[5,6],[7,8],[9,10]]);
  assert.ok(!pt.warnings.some((w) => /^Auto-fixed:/.test(w)), "nothing to repair, no note");
});

// ── 2026-07-13 empty-row filter (page-number / caption artifacts) ─────────────
// A bare number left on its own line (e.g. a page number swept in by extraction)
// parses to an empty-text range row and is dropped, so it can't inflate the
// formula or false-overlap a real row.

test("empty-row filter: a bare page number is not kept as a table row", () => {
  const [pt] = parseTables("d6 Detail\n1 a\n2 b\n3 c\n4 d\n5 e\n6 f\n99");
  assert.equal(pt.rows.length, 6, "the stray '99' line is dropped");
  assert.ok(!pt.rows.some((r) => r.min === 99), "no phantom row at the page number");
  assert.ok(pt.rows.every((r) => String(r.text).trim().length > 0), "every kept row has text");
});

// ── 2026-07-13 stray page-number formula pollution (dropStrayPageNumber) ──────
// A shapeless generator whose source page number is extracted WITH trailing
// text (so the empty-row filter can't catch it) landed a lone high row like
// [284,284,"MAGIC ITEM GENERATOR"], headlining the table as 1d284 with a flood
// of "no row" warnings. The isolated above-die-range outlier is now dropped
// with a visible note, so the die is inferred from the real coverage. Fixtures
// are invented. (Recommendation #1 / §07 bug #2 of the PDF-import review.)

test("stray page number: an isolated high row is dropped and the die is corrected", () => {
  // "284" leads the block and swallows the header line as its continuation, so
  // it carries text and survives the empty-row filter — the real pollution shape.
  const [pt] = parseTables("284\nMAGIC ITEM GENERATOR\n1 alpha\n2 beta\n3 gamma\n4 delta\n5 epsilon\n6 zeta");
  assert.ok(!pt.rows.some((r) => r.max === 284), "the page-number row is gone");
  assert.equal(pt.formula, "1d6", "die inferred from the real 6-row body, not the page cite");
  assert.ok(pt.warnings.some((w) => /page-number row 284/.test(w)), "the drop is announced, not silent");
  assert.ok(!pt.warnings.some((w) => /has no row/.test(w)), "no phantom coverage gaps up to 284");
});

test("stray page number guard: a legitimate d100 table is left intact", () => {
  const [pt] = parseTables("d100 Loot\n1-40 copper\n41-80 silver\n81-100 gold");
  assert.equal(pt.formula, "1d100", "d100 header stands");
  assert.equal(pt.rows.length, 3, "no row dropped");
  assert.ok(!pt.warnings.some((w) => /page-number/.test(w)), "d100's reach of 100 is not a page cite");
});

test("stray page number guard: a headerless d100 reaching 100 is not mistaken for a page cite", () => {
  const [pt] = parseTables("1-50 low\n51-90 mid\n91-100 high\n100 top");
  assert.ok(pt.rows.some((r) => r.max === 100), "the top row at 100 survives");
  assert.ok(!pt.warnings.some((w) => /page-number/.test(w)), "100 is a standard die face, never a stray");
});

test("stray page number guard: a legitimate wide RANGE row is never dropped (Codex #2)", () => {
  // A high top row that is a SPAN (81-200), not a lone value, is real table data
  // — a page cite is always a single number. It must survive untouched.
  const [pt] = parseTables("1-20 a\n21-40 b\n41-80 c\n81-200 d");
  assert.equal(pt.formula, "1d200", "die reflects the real 200-face span, not a trimmed 1d80");
  assert.ok(pt.rows.some((r) => r.min === 81 && r.max === 200), "the 81-200 range row is intact");
  assert.ok(!pt.warnings.some((w) => /page-number/.test(w)), "a span is not mistaken for a page cite");
});
