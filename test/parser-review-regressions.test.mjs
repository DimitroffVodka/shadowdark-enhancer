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
