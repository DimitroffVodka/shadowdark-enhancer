/**
 * Borrowed variant-list caster wiring (Green Knight → neutral Wizard/Druid list).
 *
 * A Wizard-variant list ("casts druid spells") is a SUBSET of the Wizard pool
 * gated by alignment, NOT a class. Wiring the class to the whole Wizard class
 * would make the system's alignment-blind level-up spellbook offer all ~108
 * wizard spells; instead the borrower is a self-contained own-list caster and
 * its uuid is stamped onto exactly its variant's spells. These cover the pure
 * decision helpers; the Foundry-bound sweep (tagBorrowedSpellLists) is
 * live-verified via the MCP bridge. All fixture data is invented — no book
 * content. "Wizard"/"Druid"/"green-knight" are rules identifiers, not prose.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { _internals, classifySpellWiring, borrowedTagsForSpell } from "../scripts/encounter/class-unit-importer.mjs";
import { SPELL_LIST_VARIANTS, SPELL_LIST_CLASS_ALIASES } from "../scripts/encounter/char-content-manifest.mjs";

test("SPELL_LIST_VARIANTS: the three Wizard variants map to their alignments", () => {
  assert.deepEqual(SPELL_LIST_VARIANTS.druid,    { casterClass: "Wizard", alignment: "neutral" });
  assert.deepEqual(SPELL_LIST_VARIANTS.mage,     { casterClass: "Wizard", alignment: "lawful"  });
  assert.deepEqual(SPELL_LIST_VARIANTS.sorcerer, { casterClass: "Wizard", alignment: "chaotic" });
});

test("SPELL_LIST_CLASS_ALIASES stays derived from the variants (name only)", () => {
  assert.deepEqual(SPELL_LIST_CLASS_ALIASES, { druid: "Wizard", mage: "Wizard", sorcerer: "Wizard" });
});

test("classifySpellWiring: non-caster → none", () => {
  assert.deepEqual(classifySpellWiring(null), { kind: "none" });
  assert.deepEqual(classifySpellWiring(undefined), { kind: "none" });
});

test("classifySpellWiring: caster with no list → own", () => {
  assert.deepEqual(classifySpellWiring({ ability: "int", spellList: null, spellClass: null }), { kind: "own" });
  assert.deepEqual(classifySpellWiring({ ability: "int", spellList: "", spellClass: null }), { kind: "own" });
});

test("classifySpellWiring: Wizard-variant list → variant (self-contained)", () => {
  assert.deepEqual(classifySpellWiring({ ability: "wis", spellList: "druid", spellClass: null }),
    { kind: "variant", variant: "druid" });
  // case / whitespace tolerant
  assert.deepEqual(classifySpellWiring({ ability: "cha", spellList: " Sorcerer ", spellClass: null }),
    { kind: "variant", variant: "sorcerer" });
});

test("classifySpellWiring: an explicit preview lender pick → borrow (no listName to resolve)", () => {
  const pick = { uuid: "Compendium.x.Item.witch", name: "Witch", slug: "witch" };
  assert.deepEqual(classifySpellWiring({ ability: "cha", spellList: "druid", spellClass: pick }),
    { kind: "borrow", listName: null });   // explicit pick wins even over a variant name
});

test("classifySpellWiring: a list naming a real class → borrow with that name to resolve", () => {
  assert.deepEqual(classifySpellWiring({ ability: "cha", spellList: "witch", spellClass: null }),
    { kind: "borrow", listName: "witch" });
});

test("classifySpellWiring: injectable variants map (decoupled from the real one)", () => {
  const variants = { foo: { casterClass: "Bar", alignment: "lawful" } };
  assert.deepEqual(classifySpellWiring({ spellList: "foo", spellClass: null }, variants),
    { kind: "variant", variant: "foo" });
  // "druid" is NOT in the injected map → treated as a real-class borrow
  assert.deepEqual(classifySpellWiring({ spellList: "druid", spellClass: null }, variants),
    { kind: "borrow", listName: "druid" });
});

// ── borrowedTagsForSpell ─────────────────────────────────────────────────────

const WIZ = "Compendium.shadowdark.classes.Item.wizard";
const GK = "Compendium.world.classes.Item.greenknight";
const gkTarget = { borrowerUuid: GK, alignment: "neutral", lenderUuids: [WIZ] };

test("borrowedTagsForSpell: a neutral Wizard spell gains the borrower uuid (lender kept)", () => {
  // returns only the ADDITIONS — the caller appends, so the Wizard link survives.
  assert.deepEqual(borrowedTagsForSpell([WIZ], "neutral", [gkTarget]), [GK]);
});

test("borrowedTagsForSpell: wrong alignment is never tagged", () => {
  assert.deepEqual(borrowedTagsForSpell([WIZ], "lawful", [gkTarget]), []);   // mage spell
  assert.deepEqual(borrowedTagsForSpell([WIZ], "", [gkTarget]), []);          // universal wizard spell
});

test("borrowedTagsForSpell: a spell not linked to the lender is skipped", () => {
  const other = "Compendium.shadowdark.classes.Item.priest";
  assert.deepEqual(borrowedTagsForSpell([other], "neutral", [gkTarget]), []);
});

test("borrowedTagsForSpell: idempotent — already-tagged spell yields no addition", () => {
  assert.deepEqual(borrowedTagsForSpell([WIZ, GK], "neutral", [gkTarget]), []);
});

test("borrowedTagsForSpell: string (non-array) system.class is handled", () => {
  assert.deepEqual(borrowedTagsForSpell(WIZ, "neutral", [gkTarget]), [GK]);
  assert.deepEqual(borrowedTagsForSpell("", "neutral", [gkTarget]), []);
});

test("borrowedTagsForSpell: two borrowers of the SAME variant both tag one spell", () => {
  const GK2 = "Compendium.world.classes.Item.greenknight2";
  const t2 = { borrowerUuid: GK2, alignment: "neutral", lenderUuids: [WIZ] };
  assert.deepEqual(borrowedTagsForSpell([WIZ], "neutral", [gkTarget, t2]), [GK, GK2]);
});

test("borrowedTagsForSpell: borrowers of different alignments only match their own", () => {
  const mageBorrower = { borrowerUuid: "Compendium.world.classes.Item.magus", alignment: "lawful", lenderUuids: [WIZ] };
  assert.deepEqual(borrowedTagsForSpell([WIZ], "neutral", [gkTarget, mageBorrower]), [GK]);
  assert.deepEqual(borrowedTagsForSpell([WIZ], "lawful", [gkTarget, mageBorrower]), [mageBorrower.borrowerUuid]);
});

test("borrowedTagsForSpell: matches when the spell links ANY of the lender's uuids", () => {
  // A world may hold both a system Wizard and a suite Wizard; a spell tagged to
  // either counts as being in that lender's list.
  const suiteWiz = "Compendium.world.classes.Item.wizard2";
  const t = { borrowerUuid: GK, alignment: "neutral", lenderUuids: [WIZ, suiteWiz] };
  assert.deepEqual(borrowedTagsForSpell([suiteWiz], "neutral", [t]), [GK]);
});

test("_internals re-exports the pure borrowed-list helpers", () => {
  assert.equal(_internals.classifySpellWiring, classifySpellWiring);
  assert.equal(_internals.borrowedTagsForSpell, borrowedTagsForSpell);
});
