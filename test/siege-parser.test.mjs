import test from "node:test";
import assert from "node:assert/strict";
import { parseSiegeTable, SIEGE_MANIFEST } from "../scripts/importer/boats/siege-parser.mjs";

// Real names (needed for matching) + made-up stats + short property blurbs.
const SPLIT = `
Weapon Cost
Ballista 99 gp
Trebuchet 222 gp
Blast (B). Fake blast blurb
over two lines.
SIEGE WEAPONS
Type Range Damage Properties
R F 1d6 E
M N 2d10 B, E
Exploding (E). Fake exploding blurb.
`;

test("parseSiegeTable returns the weapons plus one ammunition item", () => {
  const out = parseSiegeTable(SPLIT).drafts;
  assert.deepEqual(out.map((x) => x.name), ["Ballista", "Trebuchet", "Siege Weapon Ammunition"]);
});

test("weapon drafts map the stat columns", () => {
  const [b] = parseSiegeTable(SPLIT).drafts;
  assert.equal(b.type, "Weapon");
  assert.equal(b.cost.gp, 99);
  assert.equal(b.wtype, "ranged");
  assert.equal(b.range, "far");
  assert.equal(b.damage.oneHanded, "d6");                             // base die for the SD field
  assert.equal(b.flags["shadowdark-enhancer"].siegeDamage, "1d6");    // full formula kept in a flag
  assert.equal(b.flags["shadowdark-enhancer"].siegeWeapon, true);     // classifies onto the Weapons tab
  assert.equal(b.slots.slots_used, 30);
  assert.equal(b.ammoClass, "Siege Weapon Ammunition");
});

// Whole-row paste (no split header): `<Name> <cost> gp <Type> <Range> <dmg> <props>`.
const WHOLE = `
Ballista 42 gp R F 1d6 E
Trebuchet 99 gp M N 2d10 B, E
Blast (B). Fake blast blurb.
Exploding (E). Fake exploding blurb.
`;

test("parseSiegeTable handles the whole-row fallback layout", () => {
  const out = parseSiegeTable(WHOLE).drafts;
  assert.deepEqual(out.map((x) => x.name), ["Ballista", "Trebuchet", "Siege Weapon Ammunition"]);
});

test("whole-row drafts map every stat column (incl. melee/near codes)", () => {
  const [ballista, treb] = parseSiegeTable(WHOLE).drafts;
  assert.equal(ballista.cost.gp, 42);
  assert.equal(ballista.wtype, "ranged");
  assert.equal(ballista.range, "far");
  assert.equal(ballista.damage.oneHanded, "d6");
  assert.equal(ballista.flags["shadowdark-enhancer"].siegeDamage, "1d6");
  assert.deepEqual(ballista.siegeProperties.map((p) => p.name), ["Exploding"]);
  // Trebuchet row uses the M/N codes → melee/near, and the multi-token props "B, E".
  assert.equal(treb.wtype, "melee");
  assert.equal(treb.range, "near");
  assert.equal(treb.damage.oneHanded, "d10");
  assert.equal(treb.flags["shadowdark-enhancer"].siegeDamage, "2d10");
  assert.deepEqual(treb.siegeProperties.map((p) => p.name), ["Blast", "Exploding"]);
});

test("whole-row fallback de-dupes a repeated weapon row", () => {
  const dup = `${WHOLE}\nBallista 42 gp R F 1d6 E`;
  const names = parseSiegeTable(dup).drafts.map((x) => x.name);
  assert.equal(names.filter((n) => n === "Ballista").length, 1);
});

test("Blast/Exploding become siegeProperties with descriptions parsed off the page", () => {
  const [ballista, treb] = parseSiegeTable(SPLIT).drafts;
  assert.deepEqual(ballista.siegeProperties.map((p) => p.name), ["Exploding"]);
  assert.match(ballista.siegeProperties[0].description, /exploding blurb/i);
  assert.deepEqual(treb.siegeProperties.map((p) => p.name), ["Blast", "Exploding"]);
  assert.match(treb.siegeProperties.find((p) => p.name === "Blast").description, /blast blurb/i);
});

test("the ammunition item is a Basic ammo item, 1 gp / 2 slots", () => {
  const ammo = parseSiegeTable(SPLIT).drafts.at(-1);
  assert.equal(ammo.name, "Siege Weapon Ammunition");
  assert.equal(ammo.type, "Basic");
  assert.equal(ammo.isAmmunition, true);
  assert.equal(ammo.cost.gp, 1);
  assert.equal(ammo.slots.slots_used, 2);
});

test("no weapons parsed → empty (no orphan ammunition)", () => {
  assert.deepEqual(parseSiegeTable("just prose, no table").drafts, []);
});

test("SIEGE_MANIFEST is names + source only", () => {
  assert.equal(SIEGE_MANIFEST.length, 4);
  for (const s of SIEGE_MANIFEST) {
    assert.deepEqual(Object.keys(s).sort(), ["name", "page", "src"]);
    assert.equal(s.src, "WR");
    assert.equal(s.page, "119");
  }
});

// ---------------------------------------------------------------------------
// Layout regressions — the p119 grab shapes that used to import NOTHING.
//
// Reported live: "Importer > Vehicles > Siege Weapons" warned "gutter at x=206
// cuts through 1 word", then "No siege weapons found", for every one of the
// four weapons. The table is printed full width on a two-column page, so the
// grab's column split cut every row in half; the old parser accepted exactly
// two shapes and gave up whole — one unreadable cell cost all four weapons.
// Stats below are invented; only the NAMES are the book's.
// ---------------------------------------------------------------------------

/** The four manifest names with made-up stats, whole rows on one line. */
const FOUR = `
SIEGE WEAPONS
Weapon Cost Type Range Damage Properties
Ballista 111 gp R F 1d6 E
Catapult 222 gp R F 2d6 B
Crossbow, heavy 333 gp R N 3d6 -
Trebuchet 4,444 gp M C 4d6 B, E
Blast (B). Fake blast blurb.
Exploding (E). Fake exploding blurb.
`;

/** name → the cells the drafts should carry, for the shape assertions below. */
const expected = (drafts) => Object.fromEntries(
  drafts.filter((d) => d.type === "Weapon").map((d) => [d.name, [
    d.cost.gp, d.wtype, d.range,
    d.flags["shadowdark-enhancer"].siegeDamage,
    d.siegeProperties.map((p) => p.name).join("+") || "-",
  ]]),
);

const FOUR_CELLS = {
  "Ballista": [111, "ranged", "far", "1d6", "Exploding"],
  "Catapult": [222, "ranged", "far", "2d6", "Blast"],
  "Crossbow, heavy": [333, "ranged", "near", "3d6", "-"],
  "Trebuchet": [4444, "melee", "close", "4d6", "Blast+Exploding"],
};

test("all four weapons parse from whole rows, commas and all", () => {
  assert.deepEqual(expected(parseSiegeTable(FOUR).drafts), FOUR_CELLS);
});

test("a row with no properties cell no longer stops the table", () => {
  // The old right-half reader break'd on the first line that didn't match its
  // four-cell pattern, so a blank Properties cell dropped every row after it.
  const blank = FOUR.replace("Crossbow, heavy 333 gp R N 3d6 -", "Crossbow, heavy 333 gp R N 3d6");
  const out = expected(parseSiegeTable(blank).drafts);
  assert.equal(Object.keys(out).length, 4);
  assert.deepEqual(out["Crossbow, heavy"], [333, "ranged", "near", "3d6", "-"]);
  assert.deepEqual(out["Trebuchet"], FOUR_CELLS["Trebuchet"], "rows after the blank cell survive");
});

test("an en-dash in the properties cell reads as no properties", () => {
  const dashed = parseSiegeTable(FOUR.replace("3d6 -", "3d6 –")).drafts;
  assert.deepEqual(dashed.find((d) => d.name === "Crossbow, heavy").siegeProperties, []);
});

/** The gutter-split shape: a `Weapon Cost` half above a stat half. */
const GUTTER = `
SIEGE WEAPONS
Weapon Cost
Ballista 111 gp
Catapult 222 gp
Crossbow, heavy 333 gp
Trebuchet 4,444 gp
Blast (B). Fake blast blurb.
Type Range Damage Properties
R F 1d6 E
R F 2d6 B
R N 3d6 -
M C 4d6 B, E
Exploding (E). Fake exploding blurb.
`;

test("a table split down the page gutter zips back together", () => {
  assert.deepEqual(expected(parseSiegeTable(GUTTER).drafts), FOUR_CELLS);
});

test("a gutter-split table parses with its header row missing", () => {
  // Without the `Type Range Damage Properties` header the last NAME line sits
  // directly above the first stat half. Reading straight on would weld them —
  // Trebuchet with Ballista's stats — so the halves are paired, never glued.
  const noHdr = GUTTER
    .replace("Type Range Damage Properties\n", "")
    .replace("Weapon Cost\n", "")
    .replace("Blast (B). Fake blast blurb.\n", "");
  assert.deepEqual(expected(parseSiegeTable(noHdr).drafts), FOUR_CELLS);
});

test("one cell pushed across the gutter costs that row nothing", () => {
  // The grab's own "cuts through 1 word" warning: a straddling cell lands on
  // the wrong side, so ONE row's split falls a column later than the rest. The
  // halves pair on the column they meet at, so all four still come through.
  const straddled = GUTTER
    .replace("Crossbow, heavy 333 gp", "Crossbow, heavy 333 gp R")
    .replace("R N 3d6 -", "N 3d6 -");
  assert.deepEqual(expected(parseSiegeTable(straddled).drafts), FOUR_CELLS);
});

test("the seeded title line doesn't unbalance the split halves", () => {
  // The unlock seeds the paste box with the weapon's name on its own line.
  assert.deepEqual(expected(parseSiegeTable(`Trebuchet\n${GUTTER}`).drafts), FOUR_CELLS);
});

test("a grab that supplies the page twice parses it once", () => {
  const out = parseSiegeTable(`${FOUR}\n\n${GUTTER}`).drafts;
  assert.deepEqual(expected(out), FOUR_CELLS);
  assert.equal(out.length, 5, "four weapons + one ammunition item");
});

test("the name is read however the printing punctuates it", () => {
  for (const spelling of ["Crossbow (heavy)", "Heavy crossbow", "Crossbow"]) {
    const out = parseSiegeTable(`${spelling} 333 gp R N 3d6 -`).drafts;
    assert.deepEqual(out.map((d) => d.name), ["Crossbow, heavy", "Siege Weapon Ammunition"], spelling);
  }
});

test("one cell per line reads as a row", () => {
  const stacked = "Ballista\n111 gp\nR\nF\n1d6\nE\nCatapult\n222 gp\nR\nF\n2d6\nB\n";
  assert.deepEqual(expected(parseSiegeTable(stacked).drafts), {
    "Ballista": FOUR_CELLS["Ballista"], "Catapult": FOUR_CELLS["Catapult"],
  });
});

// --- parseSiegeTable: what to tell a GM whose page didn't come through ------

test("parseSiegeTable reports the weapons it could not read", () => {
  const report = parseSiegeTable(FOUR.replace("Trebuchet 4,444 gp M C 4d6 B, E\n", ""));
  assert.equal(report.weapons.length, 3);
  assert.deepEqual(report.missing, ["Trebuchet"]);
  assert.match(report.note, /3 of 4/);
  assert.match(report.note, /Trebuchet/);
});

test("a clean parse of all four reports nothing to fix", () => {
  const report = parseSiegeTable(FOUR);
  assert.deepEqual(report.missing, []);
  assert.equal(report.note, null);
});

test("names with no stat rows blame the column split, not the page cite", () => {
  const report = parseSiegeTable("Ballista\nCatapult\nTrebuchet\n");
  assert.deepEqual(report.drafts, []);
  assert.deepEqual(report.mentioned, ["Ballista", "Catapult", "Trebuchet"]);
  assert.match(report.note, /column split/i);
});

test("a page with none of the names points at the page cite", () => {
  // Cites assume the V1 printing and PAGE_OFFSETS has no WR entry, so a GM who
  // uploaded another printing lands on the wrong page — and there is no offset
  // control to send them to, so the message must not invent one.
  const report = parseSiegeTable("Some other page, all prose, no table.");
  assert.deepEqual(report.drafts, []);
  assert.deepEqual(report.mentioned, []);
  assert.match(report.note, /printing/i);
  assert.doesNotMatch(report.note, /sets the page offset/i);
});

test("the whole-sentence reading of a property wins over a welded one", () => {
  // A single-column pass welds the neighbouring column's words onto the rule
  // text; a column-aware pass reads it clean. Both can reach the parser.
  const both = "Ballista 111 gp R F 1d6 B\n"
    + "Blast (B). Fake blast blurb welded to a neighbouring column's words\n\n"
    + "Ballista 111 gp R F 1d6 B\n"
    + "Blast (B). Fake blast blurb.\n";
  const [ballista] = parseSiegeTable(both).drafts;
  assert.equal(ballista.siegeProperties[0].description, "<p>Fake blast blurb.</p>");
});

test("a two-word name stacked over its cells still reads as a row", () => {
  const stacked = "Crossbow,\nheavy\n333 gp\nR\nN\n3d6\n-\n";
  assert.deepEqual(parseSiegeTable(stacked).drafts.map((d) => d.name),
    ["Crossbow, heavy", "Siege Weapon Ammunition"]);
});

test("a stacked name doesn't reach past the next row for cells", () => {
  // "Ballista" has no cells of its own here; Catapult's must not be borrowed.
  const out = parseSiegeTable("Ballista\nCatapult\n222 gp\nR\nF\n2d6\nB\n").drafts;
  assert.deepEqual(out.map((d) => d.name), ["Catapult", "Siege Weapon Ammunition"]);
});

test("a name cell wrapped by a narrow column still finds its row", () => {
  const wrapped = GUTTER.replace("Crossbow, heavy 333 gp", "Crossbow,\nheavy 333 gp");
  assert.deepEqual(expected(parseSiegeTable(wrapped).drafts), FOUR_CELLS);
});

// ── What the gutter does to a cell, and what can be recovered ──────────────
// The split has two failure modes and they are not the same problem. It can
// RELOCATE a cell (the boundary lands a column earlier for one row) — that is
// recoverable, and grouping recovers it. It can also CORRUPT one ("333 gp"
// arriving as "3 33gp"), which is not: nothing left in the text says which
// stat half that name had been aligned with.

const COL0 = `
SIEGE WEAPONS
Weapon
Ballista
Catapult
Crossbow, heavy
Trebuchet
Cost Type Range Damage Properties
111 gp R F 1d6 E
222 gp R F 2d6 B
333 gp R N 3d6 -
4,444 gp M C 4d6 B, E
`;

test("a seeded title line doesn't cost the table when the split falls at the name", () => {
  // The seed prints its own name above the paste. Where the split leaves a cell
  // on each head, the title lands in its own group and is ignored — but at the
  // NAME column every head carries no cells either, so the title read as a
  // fifth head and unbalanced the group into being dropped: four weapons to
  // none, for one duplicated line.
  const base = parseSiegeTable(COL0).drafts.map((d) => d.name);
  assert.deepEqual(base.slice(0, 4), ["Ballista", "Catapult", "Crossbow, heavy", "Trebuchet"]);
  assert.deepEqual(parseSiegeTable(`Ballista\n${COL0}`).drafts.map((d) => d.name), base);
});

test("a cell the gutter corrupted is reported, never guessed at", () => {
  // Pairing the survivors by position would hand one weapon another's cost and
  // damage — a complete, plausible, wrong row, which is the one outcome worse
  // than importing nothing. So: no drafts, and a note that says what to do.
  for (const [what, text] of [
    ["a corrupted cost cell", COL0.replace("333 gp", "3 33gp")],
    ["a garbled damage die", COL0.replace("3d6", "3dd6")],
  ]) {
    const r = parseSiegeTable(text);
    assert.deepEqual(r.drafts, [], `${what} must not produce a guessed row`);
    assert.match(r.note, /no complete stat row/, what);
    assert.match(r.note, /Open PDF/, `${what}: the note must say how to fix it`);
  }
});
