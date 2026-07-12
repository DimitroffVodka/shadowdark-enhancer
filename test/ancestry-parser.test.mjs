// Committed regression tests for the ancestry paste parser
// (char-content-manifest.parseCharContent(text, "ancestries")). Pure — no
// Foundry globals; the language→UUID resolution and talent-item creation are
// commit-time (live-verified, not here). All fixtures are SYNTHETIC placeholder
// text — no book content ships in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCharContent } from "../scripts/encounter/char-content-manifest.mjs";

const anc = (t) => parseCharContent(t, "ancestries")[0]?.draft;

test("simple ancestry: reflowed paste splits flavor / language grant / talent", () => {
  // One row per line, single-spaced (PDF-viewer copy shape). Synthetic content.
  const draft = anc([
    "Sylph",
    "Airy, quick-footed folk with",
    "cloud-pale skin. They laugh",
    "easily and forgive slowly.",
    "You know the Common and",
    "Auran languages, plus one",
    "additional common language.",
    "Weightless. Roll your falling",
    "checks twice and keep the",
    "better result.",
  ].join("\n"));
  // Description = flavor ONLY (no language grant, no talent text).
  assert.equal(draft.description,
    "<p>Airy, quick-footed folk with cloud-pale skin. They laugh easily and forgive slowly.</p>");
  // Talent extracted with its label + rules text.
  assert.deepEqual(draft.talent, {
    name: "Weightless",
    text: "Roll your falling checks twice and keep the better result.",
  });
  assert.equal(draft.talentChoiceCount, 1);
  // Language grant lifted (names; UUID resolution happens at commit).
  assert.deepEqual(draft.languages.fixed, ["Common", "Auran"]);
  assert.equal(draft.languages.common, 1);
});

test("simple ancestry: a two-word talent label is captured whole", () => {
  const draft = anc([
    "Tunnelkin",
    "Stout diggers who prize silence.",
    "You know the Common language.",
    "Keen Ears. You cannot be surprised while underground.",
  ].join("\n"));
  assert.deepEqual(draft.talent, {
    name: "Keen Ears",
    text: "You cannot be surprised while underground.",
  });
  assert.equal(draft.description, "<p>Stout diggers who prize silence.</p>");
  assert.deepEqual(draft.languages.fixed, ["Common"]);
});

test("simple ancestry with no talent: flavor keeps all non-language sentences", () => {
  const draft = anc([
    "Driftborn",
    "Wanderers of the tide. They keep no home and count no coin.",
    "You know the Common and Aquan languages.",
  ].join("\n"));
  assert.equal(draft.talent, undefined);
  assert.equal(draft.talentChoiceCount, undefined);
  assert.equal(draft.description,
    "<p>Wanderers of the tide. They keep no home and count no coin.</p>");
  assert.deepEqual(draft.languages.fixed, ["Common", "Aquan"]);
});

test("rich ancestry (POPULATION/ORIGINS): intro split (talent+language) AND sections kept", () => {
  // Reflowed rich paste: intro (flavor / language grant / talent) precedes the
  // ALL-CAPS lore sections. The intro is split like a simple ancestry; the
  // sections render as bold paragraphs AFTER the flavor.
  const draft = anc([
    "STONEKIN",
    "Silent folk carved from",
    "living rock.",
    "You know the Common and Terran languages.",
    "Unyielding. You cannot be",
    "knocked prone.",
    "POPULATION",
    "They dwell in the deep places,",
    "far from the sun.",
    "ORIGINS",
    "Said to be shaped by the mountain itself.",
  ].join("\n"));
  // Talent extracted from the intro (not lost in the description).
  assert.deepEqual(draft.talent, { name: "Unyielding", text: "You cannot be knocked prone." });
  assert.equal(draft.talentChoiceCount, 1);
  // Languages parsed; grant text NOT left in the description.
  assert.deepEqual(draft.languages.fixed, ["Common", "Terran"]);
  assert.doesNotMatch(draft.description, /languages/i);
  assert.doesNotMatch(draft.description, /Unyielding/);
  // Flavor first, then bold sections.
  assert.match(draft.description, /^<p>Silent folk carved from living rock\.<\/p>/);
  assert.match(draft.description, /<strong>Population\.<\/strong>/);
  assert.match(draft.description, /<strong>Origins\.<\/strong>/);
  assert.match(draft.description, /shaped by the mountain itself/);
});
