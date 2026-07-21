import test from "node:test";
import assert from "node:assert/strict";
import { titleCaseName, splitStatblocks, parseStatblock } from "../scripts/importer/monsters/statblock-parser.mjs";

test("titleCaseName", () => {
  assert.equal(titleCaseName("GOBLIN"), "Goblin");
  assert.equal(titleCaseName("BAT, GIANT"), "Bat, Giant");
  assert.equal(titleCaseName("will-o'-wisp"), "Will-O'-Wisp");
});

const GOBLIN = [
  "GOBLIN",
  "AC 12, HP 4, ATK 1 shortsword +1 (1d6), MV near,",
  "S -1, D +2, C +0, I -1, W -1, Ch -1, AL C, LV 1",
  "A small, wicked humanoid that hates the sun.",
].join("\n");

test("splitStatblocks identifies a well-formed monster block", () => {
  const { monsters } = splitStatblocks(GOBLIN);
  assert.equal(monsters.length, 1);
  assert.match(monsters[0], /GOBLIN/);
});

test("splitStatblocks skips a non-stat lore block", () => {
  const lore = "THE UNDERWORLD\nA sunless realm beneath the earth where horrors dwell.";
  const { monsters, skipped } = splitStatblocks(lore);
  assert.equal(monsters.length, 0);
  assert.ok(skipped.length >= 1);
});

test("parseStatblock extracts the name, level, and core stats", () => {
  const { draft } = parseStatblock(GOBLIN);
  assert.equal(draft.name, "Goblin");
  assert.equal(draft.level, 1);
  assert.equal(draft.ac, 12);
  assert.equal(draft.hp.value, 4);
  assert.equal(draft.abilities.dex, 2);
});

// ── regressions from running real core-book copies through the parser ──
// Fixtures are copyright-minimal: statline + trait names only, prose trimmed.

// Variable HP/LV (core Hydra "HP *, … LV *"): the old STAT_LV never matched
// "LV *", so statline reassembly consumed feature lines until "Each is LV 2"
// inside the trait — level 2 with NO warning, features destroyed.
const HYDRA = [
  "HYDRA",
  "AC 15, HP *, ATK 2 bite +5 (1d8), MV near (swim),",
  "S +4, D +1, C +3, I -3, W +1, Ch -3, AL N, LV *",
  "Heads. Trimmed trait prose. Each is LV 2 and has 5 HP.",
].join("\n");

test("variable HP/LV (Hydra) ends the statline at 'LV *' and flags both fields", () => {
  const { draft, warnings } = parseStatblock(HYDRA);
  assert.equal(draft.level, 1, "must NOT steal 'LV 2' from the Heads trait");
  assert.equal(draft.hp.value, 1);
  assert.ok(warnings.some((w) => /LV "\*"/.test(w)), `LV * warning missing: ${warnings}`);
  assert.ok(warnings.some((w) => /HP "\*"/.test(w)), `HP * warning missing: ${warnings}`);
  assert.equal(draft.features.length, 1, "Heads trait must survive as a feature");
  assert.equal(draft.features[0].name, "Heads");
  assert.equal(draft.move, "near");
  assert.equal(draft.moveNote, "swim");
});

// Multi-form (core Air Elemental "AC 17/19, HP 29/42, +7/+9, 2d6/3d6, LV 6/9"):
// keep first-form numbers, but warn about every alternate so the GM sees the
// second form in the preview grid instead of losing it silently.
const AIR_ELEMENTAL = [
  "ELEMENTAL, AIR",
  "AC 17/19, HP 29/42, ATK 2 whirlwind +7/+9 (2d6/3d6),",
  "MV double near (fly), S +3, D +7, C +2, I -2, W +1,",
  "Ch -2, AL N, LV 6/9",
  "Whirlwind. Trimmed trait prose.",
].join("\n");

test("multi-form statblock (Air Elemental) keeps first form and warns per field", () => {
  const { draft, warnings } = parseStatblock(AIR_ELEMENTAL);
  assert.equal(draft.ac, 17);
  assert.equal(draft.hp.value, 29);
  assert.equal(draft.level, 6);
  assert.equal(draft.move, "doubleNear");
  assert.equal(draft.actions.length, 1);
  assert.equal(draft.actions[0].bonus, 7);
  assert.equal(draft.actions[0].damage, "2d6");
  for (const alt of ["17/19", "29/42", "6/9", "\\+7/\\+9", "2d6/3d6"]) {
    assert.ok(warnings.some((w) => new RegExp(alt).test(w)),
      `alternate-form warning for ${alt} missing: ${warnings}`);
  }
});

// Unsigned ability mods (Knight-style "S 3, D 0, C 1" — the "+" glyph lost in
// the PDF copy): grabMod required [+-] so all six mods zeroed out, and the MV
// clause (anchored on ", S +d") failed too, losing movement.
const KNIGHT = [
  "KNIGHT",
  "AC 15, HP 22, ATK 2 longsword +3 (1d8), MV near,",
  "S 3, D 0, C 1, I 0, W 1, Ch 2, AL L, LV 4",
].join("\n");

test("unsigned ability mods (Knight) parse as positive and keep movement", () => {
  const { draft, warnings } = parseStatblock(KNIGHT);
  assert.deepEqual(draft.abilities, { str: 3, dex: 0, con: 1, int: 0, wis: 1, cha: 2 });
  assert.equal(draft.move, "near");
  assert.ok(!warnings.some((w) => /ability mods not parsed/.test(w)), `${warnings}`);
  assert.ok(!warnings.some((w) => /movement not found/.test(w)), `${warnings}`);
});

// Charisma glyph artifact: some PDFs copy the "Ch" prefix as "X" or "Z"
// ("X +2, AL L"). Accepted only in charisma position (after the W mod).
test("charisma copied as an X/Z glyph is read as cha", () => {
  for (const glyph of ["X", "Z"]) {
    const { draft, warnings } = parseStatblock([
      "BANDIT",
      "AC 13, HP 9, ATK 1 club +1 (1d4), MV near,",
      `S +1, D +1, C +1, I -1, W +0, ${glyph} +2, AL C, LV 2`,
    ].join("\n"));
    assert.equal(draft.abilities.cha, 2, `glyph ${glyph}`);
    assert.ok(!warnings.some((w) => /ability mods not parsed/.test(w)), `${warnings}`);
  }
});

test("an X inside the ATK clause is NOT mistaken for charisma", () => {
  const { draft, warnings } = parseStatblock([
    "AUTOMATON",
    "AC 12, HP 8, ATK 1 X +4 (1d6), MV near,",
    "S +1, D +1, C +0, I +0, W +0, AL N, LV 2",
  ].join("\n"));
  assert.equal(draft.abilities.cha, 0);
  assert.ok(warnings.some((w) => /ability mods not parsed: cha/.test(w)), `${warnings}`);
  assert.equal(draft.actions[0].name, "X");
  assert.equal(draft.actions[0].bonus, 4);
});

// ALL-CAPS names wrapped across two PDF lines used to split into a skipped
// half-name block + a monster with only the second half of its name.
test("splitStatblocks merges consecutive ALL-CAPS name lines (wrapped names)", () => {
  const { monsters, skipped } = splitStatblocks([
    "MINOTAUR",
    "LORD",
    "AC 14, HP 25, ATK 2 gore +4 (2d6), MV near,",
    "S +4, D +1, C +2, I -1, W +1, Ch +0, AL C, LV 6",
  ].join("\n"));
  assert.equal(monsters.length, 1);
  assert.equal(skipped.length, 0);
  assert.equal(parseStatblock(monsters[0]).draft.name, "Minotaur Lord");
});

test("splitStatblocks rejoins a hyphen-wrapped ALL-CAPS name", () => {
  const { monsters } = splitStatblocks([
    "SHIELD-",
    "BEARER",
    "AC 16, HP 12, ATK 1 spear +2 (1d6), MV near,",
    "S +2, D +0, C +1, I +0, W +0, Ch +0, AL L, LV 3",
  ].join("\n"));
  assert.equal(monsters.length, 1);
  assert.equal(parseStatblock(monsters[0]).draft.name, "Shield-Bearer");
});

// Core-book statblocks separate a damage die from its rider with a COMMA as
// well as a "+" — the Azer's "(1d10, ignites flammables)" and the Salamander's
// "(1d6, ignites flammables)". Splitting on "+" alone failed the dice test and
// blanked the PRIMARY attack's damage. Found by parsing 279 real statblocks;
// these two were the only cases in the whole corpus.
test("comma-separated damage rider keeps the dice (Azer / Salamander)", () => {
  const AZER = [
    "AZER",
    "AC 17, HP 26, ATK 2 flaming warhammer +3 (1d10, ignites flammables) or 1 crossbow (far) +0 (1d6), MV near,",
    "S +2, D +1, C +2, I +0, W +1, Ch +0, AL L, LV 5",
  ].join("\n");
  const { draft, warnings } = parseStatblock(AZER);
  const atks = draft.actions.filter((a) => a.type === "NPC Attack");
  assert.equal(atks[0].damage, "1d10");
  assert.equal(atks[0].description, "ignites flammables");
  assert.equal(atks[1].damage, "1d6");
  assert.equal(warnings.filter((w) => /isn't dice/.test(w)).length, 0);
});

test("a '+' rider is still rejoined with '+', not a comma", () => {
  const SB = [
    "TEST BEAST",
    "AC 13, HP 10, ATK 1 bite +3 (1d8 + poison + curse), MV near,",
    "S +1, D +0, C +1, I -2, W +0, Ch -1, AL C, LV 2",
  ].join("\n");
  const a = parseStatblock(SB).draft.actions.find((x) => x.type === "NPC Attack");
  assert.equal(a.damage, "1d8");
  assert.equal(a.description, "poison + curse");
});

test("flat damage modifiers are still absorbed, not split off by the comma change", () => {
  const SB = [
    "TEST BEAST",
    "AC 13, HP 10, ATK 1 slam +3 (1d6 + 2), MV near,",
    "S +1, D +0, C +1, I -2, W +0, Ch -1, AL C, LV 2",
  ].join("\n");
  const a = parseStatblock(SB).draft.actions.find((x) => x.type === "NPC Attack");
  assert.equal(a.damage, "1d6 + 2");
  assert.equal(a.description, "");
});
