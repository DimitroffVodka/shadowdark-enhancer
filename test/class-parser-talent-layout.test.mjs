/**
 * Talent-table boundary regression (AI-Council correction #1).
 *
 * The generic `_isFeatureHeader()` break added in ab723a7 fixed the
 * post-talents-box Spellcasting capture (WR Green Knight p44) but shears a
 * COLUMN-COPY talent table whose first effect is itself a titled feature-shape
 * line such as "Weapon Mastery. Choose one weapon to master." — the break
 * fired on row 1, so the table returned zero rows (talentTable:null) even
 * though Spellcasting was captured.
 *
 * The structurally-correct boundary: a feature header only ends a column-copy
 * run once every expected effect (one per roll range) is already collected. So
 * a titled EFFECT stays in the table and a real POST-table feature still stops
 * it. These tests pin: exact row counts/order, titled effects preserved,
 * table-then-Spellcasting, both column layouts, row-major, and equivalent
 * blank/header noise forms.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseClassSection } from "../scripts/encounter/class-parser.mjs";

const HEADER = `WARDEN
A stalwart guardian of the wild groves.
Weapons: All melee weapons, longbow
Armor: All armor and shields
Hit Points: 1d10 per level`;

// The five Warden effects — row 1 is deliberately a titled feature-shape line.
const EFFECTS = [
  "Weapon Mastery. Choose one weapon to master.",
  "Gain a +1 bonus to your Armor Class.",
  "Increase one ability score by 2.",
  "Gain advantage on Wisdom checks in the wild.",
  "Choose a talent, or +2 points to distribute to stats.",
];
const SPELLCASTING = "Spellcasting. You can cast grove spells you know using your Wisdom (see pg. 166).";

const EXPECTED_ROWS = [
  [2, 2, EFFECTS[0]],
  [3, 6, EFFECTS[1]],
  [7, 9, EFFECTS[2]],
  [10, 11, EFFECTS[3]],
  [12, 12, EFFECTS[4]],
];

function assertWardenTable(parsed) {
  assert.ok(parsed, "paste parsed to a class unit");
  assert.ok(parsed.talentTable, "talentTable is not null");
  assert.equal(parsed.talentTable.formula, "2d6");
  const got = parsed.talentTable.rows.map((r) => [r.lo, r.hi, r.text]);
  assert.deepEqual(got, EXPECTED_ROWS, "exact 5 rows, ranges and effect text in order");
  assert.ok(
    !parsed.warnings.some((w) => /BLOCKER/i.test(w)),
    `no BLOCKER warnings, got: ${parsed.warnings.filter((w) => /BLOCKER/i.test(w)).join(" | ")}`
  );
}

test("column copy, ranges-first: titled effect kept, Spellcasting captured (exact 5 rows)", () => {
  const text = [
    HEADER,
    "2", "3-6", "7-9", "10-11", "12",
    "WARDEN TALENTS", "Effect",
    ...EFFECTS,
    SPELLCASTING,
  ].join("\n");
  const p = parseClassSection(text);
  assertWardenTable(p);
  assert.ok(p.spellcasting, "Spellcasting feature printed after the talents box is captured");
  assert.equal(p.spellcasting.ability, "wis", "casting ability read from the Spellcasting paragraph");
});

test("column copy, caption-first: caption, then bare ranges, then titled effects", () => {
  const text = [
    HEADER,
    "WARDEN TALENTS", "2d6", "Effect",
    "2", "3-6", "7-9", "10-11", "12",
    ...EFFECTS,
    SPELLCASTING,
  ].join("\n");
  const p = parseClassSection(text);
  assertWardenTable(p);
  assert.ok(p.spellcasting, "Spellcasting captured in the caption-first layout too");
});

test("row-major layout: range+effect on one line, Spellcasting resumes after", () => {
  const text = [
    HEADER,
    "WARDEN TALENTS", "2d6 Effect",
    "2 Weapon Mastery. Choose one weapon to master.",
    "3-6 Gain a +1 bonus to your Armor Class.",
    "7-9 Increase one ability score by 2.",
    "10-11 Gain advantage on Wisdom checks in the wild.",
    "12 Choose a talent, or +2 points to distribute to stats.",
    SPELLCASTING,
  ].join("\n");
  const p = parseClassSection(text);
  assertWardenTable(p);
  assert.ok(p.spellcasting, "row-major: post-table Spellcasting captured");
});

test("no post-table feature: titled first effect still yields all 5 rows", () => {
  const text = [
    HEADER,
    "2", "3-6", "7-9", "10-11", "12",
    "WARDEN TALENTS", "Effect",
    ...EFFECTS,
    // trailing flavor quote, not a feature
    '"The grove remembers." — Eloä, human warden',
  ].join("\n");
  const p = parseClassSection(text);
  assertWardenTable(p);
});

test("blank/header noise forms are equivalent (page number + blank lines around the table)", () => {
  // Blank lines are dropped by the parser's line filter; a stray page-footer
  // number between the effects and Spellcasting must not shift the pairing.
  const text = [
    HEADER,
    "",
    "2", "3-6", "7-9", "10-11", "12",
    "",
    "WARDEN TALENTS", "Effect",
    ...EFFECTS,
    "44",                       // page-footer stray
    SPELLCASTING,
  ].join("\n");
  const p = parseClassSection(text);
  assertWardenTable(p);
  assert.ok(p.spellcasting, "page-footer noise before Spellcasting doesn't drop it");
});

test("table-then-Spellcasting WITH a SPELLS KNOWN grid raises no not-a-caster BLOCKER", () => {
  // The grid-without-Spellcasting BLOCKER must NOT fire when Spellcasting is
  // captured — the exact regression the boundary was meant to protect.
  const text = [
    HEADER,
    "2", "3-6", "7-9", "10-11", "12",
    "WARDEN TALENTS", "Effect",
    ...EFFECTS,
    SPELLCASTING,
    "WARDEN SPELLS KNOWN",
    "Level 1 2 3 4 5",
    "1 2 - - - -",
    "2 3 - - - -",
    "3 3 2 - - -",
  ].join("\n");
  const p = parseClassSection(text);
  assertWardenTable(p);
  assert.ok(p.spellcasting, "Spellcasting captured");
  assert.ok(p.spellsKnown.length >= 3, "spells-known grid parsed");
  assert.ok(
    !p.warnings.some((w) => /BLOCKER/i.test(w)),
    "grid + captured Spellcasting => no not-a-caster BLOCKER"
  );
});

test("multiple titled effects in one column-copy table are all preserved", () => {
  const titled = [
    "Weapon Mastery. Choose one weapon to master.",
    "Armor Mastery. Choose one type of armor to master.",
    "Grove Ward. Gain resistance to poison.",
    "Wild Step. Ignore difficult terrain in the wild.",
    "Eye of Yag-Kesh. See in magical darkness.",
  ];
  const text = [
    HEADER,
    "2", "3-6", "7-9", "10-11", "12",
    "WARDEN TALENTS", "Effect",
    ...titled,
    SPELLCASTING,
  ].join("\n");
  const p = parseClassSection(text);
  assert.ok(p.talentTable, "talentTable not null");
  assert.equal(p.talentTable.rows.length, 5, "all five titled effects kept as rows");
  assert.deepEqual(
    p.talentTable.rows.map((r) => r.text),
    titled,
    "each titled effect preserved verbatim and in order"
  );
  assert.ok(p.spellcasting, "post-table Spellcasting still captured");
});
