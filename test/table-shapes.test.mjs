// Committed regression tests for the per-unlock table SHAPE system
// (table-shapes.mjs + the shape parsers in table-importer.mjs). Pure — no
// Foundry globals. All fixtures are SYNTHETIC placeholder text (no book
// content ships here); the real Core/WR tables are verified live against the
// user's own uploaded PDFs, not in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseByShape, buildTableData } from "../scripts/encounter/table-importer.mjs";
import { shapeForName, TABLE_SHAPES } from "../scripts/encounter/table-shapes.mjs";
import { resolveTableFolderPath } from "../scripts/encounter/table-folders.mjs";

// ── Prayer ──────────────────────────────────────────────────────────────────
const PRAYER = { kind: "compound", split: "prayer", cols: 3, size: 4, labels: ["Detail 1", "Detail 2", "Detail 3"] };
const PRAYER_TEXT = [
  "PRAYER GENERATOR",
  "d4      Detail 1              Detail 2            Detail 3",
  " 1      Alpha uno,            beta shall          gamma delta!",
  " 2      Epsilon dos, zeta shall                   theta iota!",   // Detail1|2 merge
  "        Kappa                 nu xi will          omicron",       // wrapped row
  " 3      lambda,                                   pi rho!",
  " 4      Sigma cuatro,         tau upsilon will phi chi psi!",     // Detail2|3 merge
].join("\n");

test("prayer shape reconstructs 3 columns incl. merges + a wrapped row", () => {
  const g = parseByShape(PRAYER_TEXT, PRAYER, { name: "T" }).generators[0];
  assert.equal(g.isCompound, true);
  assert.deepEqual(g.columns[0].rows.map((r) => r.text), ["Alpha uno,", "Epsilon dos,", "Kappa lambda,", "Sigma cuatro,"]);
  assert.deepEqual(g.columns[1].rows.map((r) => r.text), ["beta shall", "zeta shall", "nu xi will", "tau upsilon will"]);
  assert.deepEqual(g.columns[2].rows.map((r) => r.text), ["gamma delta!", "theta iota!", "omicron pi rho!", "phi chi psi!"]);
  assert.equal(g.warnings.length, 0);
});

// ── Grid ────────────────────────────────────────────────────────────────────
const gridRow = (die, a, b, c, merge) =>
  die.padStart(2).padEnd(5) + a.padEnd(13) + (merge ? `${b} ${c}` : b.padEnd(16) + c);

test("grid shape: single-space column merge splits at header x-positions", () => {
  const text = [
    "Traps",
    "d3".padEnd(5) + "Trap".padEnd(13) + "Trigger".padEnd(16) + "Damage",
    gridRow("1", "Crossbow", "Tripwire", "1d6", false),
    gridRow("2", "Spiked pit", "Pressure plate", "1d6/sleep", true),   // single-space Trigger|Damage
    gridRow("3", "Blade wall", "Lever", "2d8", false),
  ].join("\n");
  const g = parseByShape(text, { kind: "compound", split: "grid", cols: 3, size: 3, labels: ["Trap", "Trigger", "Damage"] }, { name: "Traps" }).generators[0];
  assert.deepEqual(g.columns[1].rows.map((r) => r.text), ["Tripwire", "Pressure plate", "Lever"]);
  assert.deepEqual(g.columns[2].rows.map((r) => r.text), ["1d6", "1d6/sleep", "2d8"]);
  assert.equal(g.warnings.length, 0);
});

test("grid shape: wrapped cell continuation is NOT dropped (data-loss regression)", () => {
  // Row 2's Trap + Trigger wrap onto a second line with no die number. The old
  // parser skipped every non-die line, silently losing "pit" and "plate".
  const row = (die, a, b, c) => die.padStart(2).padEnd(5) + a.padEnd(13) + b.padEnd(16) + c;
  const text = [
    "d3".padEnd(5) + "Trap".padEnd(13) + "Trigger".padEnd(16) + "Damage",
    row("1", "Crossbow", "Tripwire", "1d6"),
    row("2", "Spiked", "Pressure", "2d8"),   // die line
    row("", "pit", "plate", ""),             // wrap BELOW — must attach to row 2
    row("3", "Blade wall", "Lever", "3d10"),
  ].join("\n");
  const g = parseByShape(text, { kind: "compound", split: "grid", cols: 3, size: 3, labels: ["Trap", "Trigger", "Damage"] }, { name: "Traps" }).generators[0];
  assert.deepEqual(g.columns[0].rows.map((r) => r.text), ["Crossbow", "Spiked pit", "Blade wall"]);
  assert.deepEqual(g.columns[1].rows.map((r) => r.text), ["Tripwire", "Pressure plate", "Lever"]);
  assert.deepEqual(g.columns[2].rows.map((r) => r.text), ["1d6", "2d8", "3d10"]);
  // Every source word survives — nothing truncated.
  const all = g.columns.flatMap((c) => c.rows.map((r) => r.text)).join(" ");
  for (const w of ["pit", "plate"]) assert.ok(all.includes(w), `lost "${w}"`);
});

// ── Lookup (wrapped) ──────────────────────────────────────────────────────────
test("lookup shape: wrapped cells + centered die regroup (die-indexed)", () => {
  const pad = (die, o, b) => die.padEnd(6) + o.padEnd(24) + b;
  const text = [
    "d3".padEnd(6) + "Outcome".padEnd(24) + "Benefit",
    pad("", "You wake in", ""),          // wrap ABOVE die (centered)
    pad("1", "a ditch", "Gain 1 XP"),
    pad("2", "You made a friend", "Gain 2 XP"),
    pad("", "You lost", ""),
    pad("3", "your boots", "Gain 3 XP"),
  ].join("\n");
  const t = parseByShape(text, { kind: "lookup", cols: 2, size: 3, labels: ["Outcome", "Benefit"] }, { name: "Carousing Outcome" }).tables[0];
  assert.equal(t.formula, "1d3");
  assert.deepEqual(t.rows.map((r) => r.text), [
    "You wake in a ditch | Gain 1 XP",
    "You made a friend | Gain 2 XP",
    "You lost your boots | Gain 3 XP",
  ]);
});

test("lookup shape: cost-indexed (no die), right-aligned first column, wrapped middle", () => {
  const H = "Cost".padStart(10) + "    " + "Event".padEnd(36) + "Bonus";   // Cost@6 Event@14 Bonus@50
  const row = (cost, ev, bon) => (cost ? cost.padStart(13) : " ".repeat(13)) + " " + ev.padEnd(36) + bon;
  const text = [
    H,
    row("30 gp", "A worthy night", "+0"),
    row("", "A full day and", ""),             // wrap ABOVE its cost
    row("100 gp", "night", "+1"),
    row("1,200 gp", "A spirited fete", "+2"),
  ].join("\n");
  const t = parseByShape(text, { kind: "lookup", cols: 3, size: 3, labels: ["Cost", "Event", "Bonus"], dieIndexed: false }, { name: "Carousing Event" }).tables[0];
  assert.deepEqual(t.rows.map((r) => r.text), [
    "30 gp | A worthy night | +0",
    "100 gp | A full day and night | +1",
    "1,200 gp | A spirited fete | +2",
  ]);
});

test("lookup shape: benefit keyword bled into col 1 rejoins its column (col2Starts)", () => {
  const H = "d2".padEnd(5) + "Outcome".padEnd(25) + "Benefit";        // Outcome@5 Benefit@30
  const text = [
    H,
    "1".padEnd(5) + "Short".padEnd(25) + "Gain 1 XP",
    "2".padEnd(5) + "A long outcome here Gain 2 XP",                  // single space; Gain sits left of x30
  ].join("\n");
  const t = parseByShape(text, { kind: "lookup", cols: 2, size: 2, labels: ["Outcome", "Benefit"], col2Starts: "Gain" }, { name: "Carousing Outcome" }).tables[0];
  assert.deepEqual(t.rows.map((r) => r.text), ["Short | Gain 1 XP", "A long outcome here | Gain 2 XP"]);
});

test("lookup shape: a wrapped benefit fragment starting with a big number is not a new row", () => {
  const H = "d2".padEnd(5) + "Outcome".padEnd(15) + "Benefit";        // Outcome@5 Benefit@20
  const text = [
    H,
    "1".padEnd(5) + "Win".padEnd(15) + "Gain 1 XP",
    "2".padEnd(5) + "Lose".padEnd(15) + "Gain 2 XP and an 80-",
    "100 item bonus",                                                // wraps to line start — must NOT become row 100
  ].join("\n");
  const t = parseByShape(text, { kind: "lookup", cols: 2, size: 2, labels: ["Outcome", "Benefit"] }, { name: "Carousing Outcome" }).tables[0];
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows.map((r) => r.min), [1, 2]);
  assert.ok(!t.warnings.some((w) => /reach 100|Value \d+ has no row/.test(w)), "phantom row 100 tripped a coverage warning");
});

test("lookup shape: REFLOWED paste (one row per line, single-spaced) splits at col2Starts + handles N+", () => {
  // This is what you get copying from a PDF viewer: no column alignment, one row
  // per line. The x-band path can't see columns, so it falls to _lookupSimple,
  // which must split at the benefit keyword ("Gain") and accept a trailing "+".
  const text = [
    "Carousing Outcome",
    "d4 Outcome Benefit",                                             // single-spaced header
    "1 You wake up in your bed Gain 1 XP",
    "2 The Thieves' Guild bilked you Gain 2 XP and a debt",          // extra capitals — used to fold to "The | ..."
    "3 You reflected it off your cup Gain 3 XP and a luck token",    // trailing word stays in the benefit
    "4+ You wake up in the stronghold Gain 4 XP, if you escape",     // "+" must not drop the row
  ].join("\n");
  const t = parseByShape(text, { kind: "lookup", cols: 2, size: 4, labels: ["Outcome", "Benefit"], col2Starts: "Gain" }, { name: "Carousing Outcome" }).tables[0];
  assert.equal(t.formula, "1d4");
  assert.deepEqual(t.rows.map((r) => r.min), [1, 2, 3, 4]);          // 4+ → 4, nothing dropped
  assert.deepEqual(t.rows.map((r) => r.text), [
    "You wake up in your bed | Gain 1 XP",
    "The Thieves' Guild bilked you | Gain 2 XP and a debt",
    "You reflected it off your cup | Gain 3 XP and a luck token",
    "You wake up in the stronghold | Gain 4 XP, if you escape",
  ]);
  assert.equal(t.warnings.length, 0);
});

// ── Expansion cap ─────────────────────────────────────────────────────────────
test("expansion cap: <=2000 expands to a flat table, larger stays compound", () => {
  const mk = (cols, size) => ({ isCompound: true, name: "G",
    compound: { separator: " | ", columns: Array.from({ length: cols }, (_, c) => ({
      label: `C${c}`, formula: `1d${size}`,
      rows: Array.from({ length: size }, (_, i) => ({ min: i + 1, max: i + 1, text: `c${c}r${i}` })),
    })) } });
  const traps = buildTableData(mk(3, 12));                 // 1,728
  assert.equal(traps.formula, "1d1728");
  assert.ok(!traps.flags?.["shadowdark-enhancer"]?.compound);
  const gen = buildTableData(mk(3, 20));                   // 8,000
  assert.ok(gen.flags?.["shadowdark-enhancer"]?.compound); // stays compound
});

// ── Registry + folder resolution ──────────────────────────────────────────────
test("shapeForName resolves exact + suffix-prefixed import names", () => {
  assert.equal(shapeForName("Gede Prayers")?.split, "prayer");
  assert.equal(shapeForName("Western Reaches - Gede Prayers")?.split, "prayer");
  assert.equal(shapeForName("Core Rulebook - Carousing Outcome")?.kind, "lookup");
  assert.equal(shapeForName("Carousing Event")?.dieIndexed, false);
  for (const n of ["Traps", "Hazards", "Tavern Generator", "NPC Qualities", "Party Name"]) {
    assert.equal(shapeForName(n)?.split, "grid", n);
  }
  assert.equal(shapeForName("Totally Unknown Table"), null);
  assert.ok(Object.keys(TABLE_SHAPES).length >= 18);
});

test("folder resolver mirrors the Manage tree (category-first)", () => {
  const p = (o) => resolveTableFolderPath(o).join(" / ");
  assert.equal(p({ name: "Traps", category: "traps", source: "Core Rulebook" }), "Gameplay / Core Rulebook / Traps & Hazards");
  assert.equal(p({ name: "Carousing Outcome", category: "carousing", source: "Core Rulebook" }), "Gameplay / Core Rulebook / Carousing");
  assert.equal(p({ name: "Gede Prayers", category: "other", source: "Western Reaches" }), "Character Content / Patrons & Deities");
  assert.equal(p({ name: "Western Reaches - Dwarf Names", category: "character-names", source: "Western Reaches" }), "Character Content / Ancestries / Names");
  assert.equal(p({ name: "My Homebrew", category: "custom", customLabel: "Gameplay" }), "Gameplay");   // typed custom folder → top level
  assert.equal(p({ name: "Random Junk", category: "other", source: "CS9 Zine" }), "Roll Tables / CS9 Zine");
});
