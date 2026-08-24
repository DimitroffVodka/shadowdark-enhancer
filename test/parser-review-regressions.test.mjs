/**
 * Regression fixtures from the 2026-07-11 PDF-parser code review
 * (docs/PDF-PARSER-CODE-REVIEW-2026-07-11.md, findings #4–#11).
 * All fixture text is invented — no book content.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { splitStatblocks, parseStatblock } from "../scripts/importer/monsters/statblock-parser.mjs";
import { parseItem } from "../scripts/importer/items/item-parser.mjs";
import { parseSpell } from "../scripts/importer/spells/spell-parser.mjs";
import { parseTables, buildTableData } from "../scripts/importer/tables/table-importer.mjs";
import { parseClassSection, sliceSpellsKnown } from "../scripts/importer/char-content/class-parser.mjs";

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

// ── 2026-07-13 caster spells-known grid slice (sliceSpellsKnown) ──────────────
// A caster class's SPELLS KNOWN grid lives on the page after the writeup; a
// single-column grab of that page carries the grid plus surrounding prose (and
// the writeup's own "…Spells Known" reference sentence). The slicer must anchor
// on the standalone ALL-CAPS caption, not the prose, and return just the grid.

const CASTER_PAGE = [
  "Armor: Leather armor, chainmail Necro Spells Known",   // prose reference — must NOT anchor here
  "Hit Points: 1d6 per level",
  "Death Sense. You can sense the undead.",
  "NECRO SPELLS KNOWN",                                    // real caption
  "Spells Known By Spell Tier",
  "Level 1 2 3",
  "1 1 - -",
  "2 2 - -",
  "3 2 1 -",
  "The game continues with more prose.",                  // trailing prose — grid ended
].join("\n");

test("spells-known slice: anchors on the ALL-CAPS caption, not a prose reference", () => {
  const block = sliceSpellsKnown(CASTER_PAGE);
  assert.equal(block.split("\n")[0], "NECRO SPELLS KNOWN", "not the 'chainmail … Spells Known' prose line");
  assert.ok(/^Level 1 2 3$/m.test(block), "keeps the tier header");
  assert.ok(!/chainmail|game continues/.test(block), "drops surrounding prose");
});

test("spells-known slice: the sliced block parses into a level×tier grid; non-casters slice to null", () => {
  const d = parseClassSection(`TESTCASTER\nBrave casters.\nHit Points: 1d6 per level\n${sliceSpellsKnown(CASTER_PAGE)}`);
  assert.deepEqual(d.spellsKnown.map((r) => [r.level, ...r.tiers]), [[1, 1, 0, 0], [2, 2, 0, 0], [3, 2, 1, 0]]);
  // A page that only mentions "spells known" in prose yields no grid.
  assert.equal(sliceSpellsKnown("A class that references spells known casually.\nHit Points: 1d8"), null);
});

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

test("stray page number: a page footer is dropped even under an explicit dN header", () => {
  // A section-sliced "d20 Type" table can sweep in its page footer (e.g. 290).
  // With a die header the formula is already 1d20, but the footer still adds a
  // phantom face-290 row + a false overlap — the drop must run here too.
  const rows = Array.from({ length: 20 }, (_, i) => `${i + 1} item${i + 1}`).join("\n");
  const [pt] = parseTables(`d20 Kind\n${rows}\n290 Utility`);
  assert.equal(pt.formula, "1d20");
  assert.equal(pt.rows.length, 20, "the 290 footer row is dropped");
  assert.ok(!pt.rows.some((r) => r.max === 290), "no phantom face at the page number");
  // The die-bound drop (E2E W3) announces "out-of-bounds row N"; the legacy
  // headerless outlier path says "page-number row N" — either proves the drop.
  assert.ok(pt.warnings.some((w) => /out-of-bounds row 290|page-number row 290/.test(w)), "the drop is announced");
});

test("stray page number guard: a legitimate wide RANGE row is never dropped (Codex #2)", () => {
  // A high top row that is a SPAN (81-200), not a lone value, is real table data
  // — a page cite is always a single number. It must survive untouched.
  const [pt] = parseTables("1-20 a\n21-40 b\n41-80 c\n81-200 d");
  assert.equal(pt.formula, "1d200", "die reflects the real 200-face span, not a trimmed 1d80");
  assert.ok(pt.rows.some((r) => r.min === 81 && r.max === 200), "the 81-200 range row is intact");
  assert.ok(!pt.warnings.some((w) => /page-number/.test(w)), "a span is not mistaken for a page cite");
});

// ── Two-column page furniture stranded between the columns ──────────────────
//
// A d100 table printed in two columns repeats its caption and "dN Details"
// header above column two, and whatever the page prints in that gap sits
// between the columns. Every WR ancestry Trinket page puts an aside there.
// Stripping the caption and header leaves that aside looking exactly like a
// wrapped row, so it folded onto column one's last row (user-reported
// 2026-08-24: "49-50 Goat hair blanket PCs may start with one trinket; it is
// free to carry."). Fixture text is invented — no book content.

const twoColumnPage = (gap) => [
  "d100 Details",
  "1-2 Alpha bauble",
  "3-4 Beta charm",
  "5-6 Gamma relic",
  ...gap,
  "GIZMO TRINKET",
  "d100 Details",
  "7-8 Delta token",
  "9-10 Epsilon idol",
].join("\n");

test("an aside stranded between two columns is not folded onto the last row", async () => {
  const { stripSeedNoise } = await import("../scripts/importer/tables/table-importer.mjs");
  const text = twoColumnPage(["PCs may start with one trinket; it is free to carry."]);
  const { text: cleaned } = stripSeedNoise(text, { name: "Gizmo Trinket", pages: "19" });
  const [pt] = parseTables(cleaned);
  assert.equal(pt.rows.length, 5, "every row survives");
  assert.equal(pt.rows[2].text, "Gamma relic", "column one's last row keeps only its own text");
  assert.ok(!pt.rows.some((r) => /PCs may start/.test(r.text)), "the aside is gone");
  // Column two still follows on cleanly.
  assert.deepEqual(pt.rows.map((r) => `${r.min}-${r.max}`),
    ["1-2", "3-4", "5-6", "7-8", "9-10"]);
});

test("…but a genuinely wrapped row in that same position is kept", async () => {
  const { stripSeedNoise } = await import("../scripts/importer/tables/table-importer.mjs");
  // A wrap tail resumes mid-phrase — uncapitalized, unpunctuated — which is
  // what separates it from an aside. Dropping it would silently lose data.
  const text = twoColumnPage(["carved from river driftwood"]);
  const { text: cleaned } = stripSeedNoise(text, { name: "Gizmo Trinket", pages: "19" });
  const [pt] = parseTables(cleaned);
  assert.equal(pt.rows.length, 5);
  assert.equal(pt.rows[2].text, "Gamma relic carved from river driftwood");
});

test("…and a sentence that is NOT preceded by a die row is left alone", async () => {
  const { stripSeedNoise } = await import("../scripts/importer/tables/table-importer.mjs");
  // A usage instruction above the first row is the table's description, not
  // furniture — parseSingleDieBlock deliberately keeps it (review #10).
  const text = ["Roll once each morning.", "d100 Details", "1-2 Alpha bauble", "3-4 Beta charm"].join("\n");
  const { text: cleaned } = stripSeedNoise(text, { name: "Gizmo Trinket", pages: "19" });
  assert.match(cleaned, /Roll once each morning\./);
});

test("…and a sentence above a bare PAGE NUMBER is left alone", async () => {
  // Review finding, 2026-08-24: the orphan drop was wired to every stripped
  // line, page footers included. A page number is the bottom of the page, where
  // the line above is ordinary table text — not the two-column gap an aside
  // prints in — so running the drop there deleted real content. `stripSeedNoise`
  // runs on EVERY seeded import, so this was not trinket-specific.
  const { stripSeedNoise } = await import("../scripts/importer/tables/table-importer.mjs");
  const text = [
    "d100 Details",
    "1-2 Alpha bauble",
    "3-4 Beta charm",
    "Treat a rolled duplicate as the next entry down.",
    "19",
  ].join("\n");
  const { text: cleaned, dropped, asides } = stripSeedNoise(text, { name: "Gizmo Trinket", pages: "19" });
  assert.match(cleaned, /Treat a rolled duplicate as the next entry down\./);
  assert.deepEqual(asides, [], "nothing was treated as a stranded aside");
  assert.equal(dropped, 2, "only the header and the page number go");
});

test("a dropped aside is REPORTED, not swallowed", async () => {
  // The caption-stranded drop is the one judgement call in the sweep: extraction
  // can break a row exactly at a sentence boundary, and such a tail is
  // indistinguishable from an aside. It is surfaced so a GM can paste it back.
  const { stripSeedNoise } = await import("../scripts/importer/tables/table-importer.mjs");
  const { asides } = stripSeedNoise(
    twoColumnPage(["PCs may start with one trinket; it is free to carry."]),
    { name: "Gizmo Trinket", pages: "19" });
  assert.deepEqual(asides, ["PCs may start with one trinket; it is free to carry."]);
});
