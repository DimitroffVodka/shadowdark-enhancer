// Committed regression tests for the per-unlock table SHAPE system
// (table-shapes.mjs + the shape parsers in table-importer.mjs). Pure — no
// Foundry globals. All fixtures are SYNTHETIC placeholder text (no book
// content ships here); the real Core/WR tables are verified live against the
// user's own uploaded PDFs, not in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseByShape, buildTableData, parseTables } from "../scripts/encounter/table-importer.mjs";
import { shapeForName, TABLE_SHAPES } from "../scripts/encounter/table-shapes.mjs";
import { resolveTableFolderPath } from "../scripts/encounter/table-folders.mjs";
import { hasTable, sourcedTableName } from "../scripts/encounter/char-content-manifest.mjs";

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

test("prayer cartesian rows read as a sentence — honor the space separator, not ' | '", () => {
  // Regression: the cartesian-expand path hardcoded " | " even though prayers
  // configure a single-space separator, so expanded rows came out as
  // "Alpha, | beta will | gamma!" instead of a readable sentence. (review 2026-07-12 #3)
  const g = parseByShape(PRAYER_TEXT, PRAYER, { name: "T" }).generators[0];
  assert.equal(g.compound.separator, " ");
  const data = buildTableData(g);
  assert.equal(data.formula, "1d64");                // 4^3, cartesian-expanded
  assert.equal(data.results.length, 64);
  assert.equal(data.results[0].name, "Alpha uno, beta shall gamma delta!");
  assert.ok(!data.results[0].name.includes(" | "));
});

test("cartesian expansion honors the compound separator (space vs ' | ')", () => {
  // Same columns, different configured separators → different joined text.
  const mk = (separator) => ({
    isCompound: true, name: "G", compound: { separator, columns: [
      { label: "A", formula: "1d2", rows: [{ min: 1, max: 1, text: "Alpha," }, { min: 2, max: 2, text: "Beta," }] },
      { label: "B", formula: "1d2", rows: [{ min: 1, max: 1, text: "one!" }, { min: 2, max: 2, text: "two!" }] },
    ] },
  });
  assert.equal(buildTableData(mk(" ")).results[0].name, "Alpha, one!");        // prayer style
  assert.equal(buildTableData(mk(" | ")).results[0].name, "Alpha, | one!");    // grid style
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

test("grid shape: REFLOWED paste (single-spaced) splits via reflow cap+dice boundaries", () => {
  // A PDF-viewer copy reflows to one row per line, single-spaced — the aligned
  // header parser can't read column x-positions, so a `reflow` recipe splits
  // each row: col1→col2 at the next Capitalized word, col2→col3 at the first
  // dice expression. Synthetic content (no book text).
  const shape = { kind: "compound", split: "grid", cols: 3, size: 3,
    labels: ["Alpha", "Bravo", "Charlie"], reflow: ["cap", "dice"] };
  const text = [
    "Widgets",                                 // title (no leading die → skipped)
    "d3 Alpha Bravo Charlie",                  // single-spaced header → skipped
    "1 Zeta Yankee 1d6",                       // one-word cols
    "2 Foxtrot golf hotel India juliet 2d8/sleep",  // multi-word col1 + col2
    "3 Kilo lima Mike november 3d10/blind",
  ].join("\n");
  const g = parseByShape(text, shape, { name: "Widgets" }).generators[0];
  assert.deepEqual(g.columns[0].rows.map((r) => r.text), ["Zeta", "Foxtrot golf hotel", "Kilo lima"]);
  assert.deepEqual(g.columns[1].rows.map((r) => r.text), ["Yankee", "India juliet", "Mike november"]);
  assert.deepEqual(g.columns[2].rows.map((r) => r.text), ["1d6", "2d8/sleep", "3d10/blind"]);
  assert.deepEqual(g.warnings ?? [], []);       // all 3 rows fully filled, none missing
});

test("grid shape: a manual | on a reflowed paste still wins (reflow deferred)", () => {
  // With a "|" present, the reflow parser defers to the proven parseGenerators
  // delimiter path so the manual boundary is authoritative.
  const shape = { kind: "compound", split: "grid", cols: 3, size: 2,
    labels: ["Alpha", "Bravo", "Charlie"], reflow: ["cap", "dice"] };
  const text = [
    "d2 Alpha Bravo Charlie",
    "1 Zeta one| Yankee two| 1d6",
    "2 Foxtrot three| India four| 2d8",
  ].join("\n");
  const g = parseByShape(text, shape, { name: "Widgets" }).generators[0];
  assert.deepEqual(g.columns[0].rows.map((r) => r.text), ["Zeta one", "Foxtrot three"]);
  assert.deepEqual(g.columns[1].rows.map((r) => r.text), ["Yankee two", "India four"]);
  assert.deepEqual(g.columns[2].rows.map((r) => r.text), ["1d6", "2d8"]);
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

test("lookup shape: a manually-typed | wins over the col2Starts keyword", () => {
  const text = [
    "Carousing Outcome",
    "d2 Outcome Benefit",
    "1 You Gain a lot of nerve | Gain 1 XP",   // "Gain" is in the outcome; the | is the real split
    "2 Plain outcome Gain 2 XP",               // no |, falls back to the keyword split
  ].join("\n");
  const t = parseByShape(text, { kind: "lookup", cols: 2, size: 2, labels: ["Outcome", "Benefit"], col2Starts: "Gain" }, { name: "Carousing Outcome" }).tables[0];
  assert.equal(t.rows[0].text, "You Gain a lot of nerve | Gain 1 XP");
  assert.equal(t.rows[1].text, "Plain outcome | Gain 2 XP");
});

test("lookup shape: cost-indexed | paste — a number in col 1 is NOT a die face (Carousing Event)", () => {
  // Real-paste regression: Carousing Event has no die column (keyed by Cost).
  // The old parser read "30" as die 30 (Cost became "gp") and dropped comma
  // costs like "1,200 gp". A cost-indexed | paste must number rows in order.
  const text = [
    "Carousing Event",
    "Cost Event Bonus",                                  // header — skipped
    "30 gp| A worthy night of festivity |+0",
    "100 gp| A full day and night |+1",
    "1,200 gp| A spirited fete with a comma cost |+5",   // comma must not drop the row
  ].join("\n");
  const t = parseByShape(text, { kind: "lookup", cols: 3, size: 7, labels: ["Cost", "Event", "Bonus"], dieIndexed: false }, { name: "Carousing Event" }).tables[0];
  assert.deepEqual(t.rows.map((r) => r.min), [1, 2, 3]);   // sequential, NOT 30/100/1200
  assert.deepEqual(t.rows.map((r) => r.text), [
    "30 gp | A worthy night of festivity | +0",
    "100 gp | A full day and night | +1",
    "1,200 gp | A spirited fete with a comma cost | +5",
  ]);
});

test("lookup shape: raw wrapped copy parses via rowStart/colLast anchoring (Carousing Event)", () => {
  // No |, no alignment: the first column (Cost "N gp") anchors each row, the last
  // (Bonus "+N") ends it, and the Event wraps across lines in between.
  const text = [
    "Cost Event Bonus",                    // header — dropped (not a cost line)
    "30 gp A worthy night +0",             // all on one line
    "100 gp A full day and night,",        // event wraps…
    "and recounting exploits +1",          // …bonus at the end
    "1,200 gp",                            // cost alone (comma), event + bonus wrap below
    "A spirited fete over a city",
    "+5",
  ].join("\n");
  const t = parseByShape(text, { kind: "lookup", cols: 3, size: 7, labels: ["Cost", "Event", "Bonus"], dieIndexed: false, rowStart: "[\\d,]+\\s*gp", colLast: "\\+\\d+" }, { name: "Carousing Event" }).tables[0];
  assert.deepEqual(t.rows.map((r) => r.min), [1, 2, 3]);
  assert.deepEqual(t.rows.map((r) => r.text), [
    "30 gp | A worthy night | +0",
    "100 gp | A full day and night, and recounting exploits | +1",
    "1,200 gp | A spirited fete over a city | +5",
  ]);
});

test("lookup shape: a typed | wins even on the column-aligned (geometry) path", () => {
  // A 2+-space header routes to the x-band/geometry path; a "|" in a row must
  // still win over the geometry slice (and over the col2Starts keyword).
  const text = [
    "Carousing Outcome",
    "d2".padEnd(6) + "Outcome".padEnd(30) + "Benefit",             // aligned header
    "1".padEnd(6) + "You Gain courage | Actually Gain 1 XP",       // typed |, "Gain" also in outcome
    "2".padEnd(6) + "Plain outcome".padEnd(24) + "Gain 2 XP",      // no |, geometry/keyword
  ].join("\n");
  const t = parseByShape(text, { kind: "lookup", cols: 2, size: 2, labels: ["Outcome", "Benefit"], col2Starts: "Gain" }, { name: "Carousing Outcome" }).tables[0];
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0].text, "You Gain courage | Actually Gain 1 XP");   // | wins, not the first "Gain"
  assert.equal(t.rows[1].text, "Plain outcome | Gain 2 XP");
});

test("cartesian expand flag raises the cap; without it a big compound stays compound", () => {
  const mk = (cols, size, expand) => ({ isCompound: true, name: "G", ...(expand ? { expand } : {}),
    compound: { separator: " | ", columns: Array.from({ length: cols }, (_, c) => ({
      label: `C${c}`, formula: `1d${size}`,
      rows: Array.from({ length: size }, (_, i) => ({ min: i + 1, max: i + 1, text: `c${c}r${i}` })),
    })) } });
  const big = buildTableData(mk(3, 20, "cartesian"));   // 8,000 — over the 2000 auto-cap
  assert.equal(big.formula, "1d8000");
  assert.ok(!big.flags?.["shadowdark-enhancer"]?.compound);
  const auto = buildTableData(mk(3, 20));               // same table, no flag → stays compound
  assert.ok(auto.flags?.["shadowdark-enhancer"]?.compound);
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

test("single-column table with an ellipsis header is not split into a fake matrix", () => {
  // "Played For…" is one truncated label, not two columns. The rows happen to be
  // two words each ("Single drinks"), which used to satisfy the matrix heuristic
  // and truncate them to the first word (Wizards & Thieves stakes bug).
  const t = parseTables("LOW STAKES\nd4 Played For...\n1 Copper\n2 Single drinks\n3 Bragging rights\n4 Minor baubles")[0];
  assert.equal(t.formula, "1d4");
  assert.deepEqual(t.rows.map((r) => r.text), ["Copper", "Single drinks", "Bragging rights", "Minor baubles"]);
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

test("census presence resolves a legacy 'Core PDF pNNN:' rep against the real table name", () => {
  // Regression: an import lands under the real name ("Traps"), but the manifest
  // still probes the legacy group rep ("Core PDF p118: Traps"). hasTable strips
  // the rep prefix so the imported table clears the Import button.
  assert.equal(hasTable(new Set(["traps"]), "Core PDF p118: Traps"), true);
  assert.equal(hasTable(new Set(["core rulebook - traps"]), "Core PDF p118: Traps"), true);  // source-prefixed
  assert.equal(hasTable(new Set(["hazards"]), "Core PDF p118: Traps"), false);               // wrong table
  assert.equal(hasTable(new Set(["treasure 0-3"]), "TREASURE 0-3"), true);                    // no prefix → unchanged
  assert.equal(hasTable(new Set([]), "Core PDF p118: Traps"), false);                          // absent stays locked
});

test("ancestry NAME tables import as 'Character Names: Source Ancestry' (dropdown-visible)", () => {
  // The Shadowdark ancestry sheet's Random Name Table dropdown only lists
  // RollTables matching /Character Names/i (CompendiumsSD.ancestryNameTables),
  // so imported name tables must carry that prefix; Trinkets keep "Source - X".
  assert.equal(sourcedTableName("Western Reaches", "Dwarf Names"), "Character Names: Western Reaches Dwarf");
  assert.equal(sourcedTableName("Western Reaches", "Half-Elf Names"), "Character Names: Western Reaches Half-Elf");
  assert.equal(sourcedTableName("Western Reaches", "Dwarf Trinket"), "Western Reaches - Dwarf Trinket");
  // Ancestry casing is normalized so an all-caps page caption doesn't leak through.
  assert.equal(sourcedTableName("Western Reaches", "DWARF NAMES"), "Character Names: Western Reaches Dwarf");
  assert.equal(sourcedTableName("Western Reaches", "HALF-ELF names"), "Character Names: Western Reaches Half-Elf");
  // Census present-check accepts the new form, requires the source qualifier, and
  // still honors the legacy "Source - X Names" prefix (already-imported tables).
  assert.equal(hasTable(new Set(["character names: western reaches dwarf"]), "Dwarf Names"), true);
  assert.equal(hasTable(new Set(["character names: western reaches half-elf"]), "Elf Names"), false);   // half-elf ≠ elf
  assert.equal(hasTable(new Set(["character names: dwarf"]), "Dwarf Names"), false);                    // core (no source) ≠ WR gap
  assert.equal(hasTable(new Set(["western reaches - dwarf names"]), "Dwarf Names"), true);              // legacy prefix
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

// Column drift: a cell wider than its header ("1,200 gp" under "Cost") pushes
// every later boundary on that line right of its header x. Searching around the
// raw x then found no gap in the window and fell back to a word-snap, cutting
// the next cell mid-phrase ("You make | a friend   +2"). Each search is now
// centred on the header x plus the drift already observed. Synthetic fixture.
test("lookup shape: a wide first cell doesn't cut the next column mid-phrase", () => {
  const text = [
    "Cost   Event   Bonus",
    "30 gp   You win at cards   +1",
    "60 gp   You make a friend   +2",
    "1,200 gp   A spirited fete   +3",
  ].join("\n");
  const shape = { kind: "lookup", cols: 3, size: 3, labels: ["Cost", "Event", "Bonus"],
    dieIndexed: false, rowStart: "[\\d,]+\\s*gp", colLast: "\\+\\d+" };
  const rows = parseByShape(text, shape, { name: "Drift Check" }).tables[0].rows;
  assert.deepEqual(rows.map((r) => r.text), [
    "30 gp | You win at cards | +1",
    "60 gp | You make a friend | +2",
    "1,200 gp | A spirited fete | +3",
  ]);
});

// A blank interior cell must stay blank: the value to its right belongs to the
// column it was printed under, not the empty one. NOTE the header spacing —
// parseGridShape needs `cols + 1` layout pieces, so the die label must be
// separated from the first column by 2+ spaces. With a single space "d4 Poor"
// merges into one piece, the shape bails, and the caller falls back to a
// delimiter parser that DOES shift the row (it warns, but the data is wrong).
test("grid shape: a blank middle cell keeps its neighbour in the right column", () => {
  const text = [
    "FOOD",
    "d4   Poor      Standard    Wealthy",
    "1    Gruel     Bread       Pheasant",
    "2    Turnip                Venison",
    "3    Crust     Porridge    Swan",
    "4    Rind      Stew        Boar",
  ].join("\n");
  const g = parseByShape(text, { kind: "compound", split: "grid", cols: 3, size: 4,
    labels: ["Poor", "Standard", "Wealthy"] }, { name: "Food" }).generators[0];
  const at = (col, face) => g.columns[col].rows.find((r) => r.min === face)?.text;
  assert.equal(at(0, 2), "Turnip");
  assert.equal(at(1, 2), "");          // blank in the source stays blank
  assert.equal(at(2, 2), "Venison");   // NOT pulled left into Standard
  assert.equal(at(1, 3), "Porridge");  // later rows unaffected
});
