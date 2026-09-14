/**
 * Western Reaches Bard unlock (#157) — the two pieces that are not data.
 *
 * 1. A feature header may carry a PARENTHETICAL qualifier ("Fascinate (Focus).").
 *    FEATURE_RE's name group had no parentheses in it, so such a line matched
 *    nothing: the feature — and the Class Ability the system stores it as —
 *    vanished from the import with no warning at all. The Bard is the one WR
 *    class that prints one, but the grammar is what is fixed, so the fixture
 *    here is a synthetic class (book text stays in the book).
 *
 * 2. The char builder must not offer "<X> (Legacy)" and "<X>" side by side.
 *    Keyed on the name, not on "Bard" — the system may retire other classes the
 *    same way.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseClassSection } from "../scripts/importer/char-content/class-parser.mjs";
import { ClassStep } from "../scripts/char-builder/steps/class-step.mjs";
import { CLASS_OVERLAYS } from "../scripts/importer/char-content/class-overlays.mjs";
import { MANIFEST_CLASSES } from "../scripts/importer/char-content/char-content-manifest.mjs";

const classPaste = (featureHeader) => [
  "Warden Class",
  "A stalwart guardian of the wild groves.",
  "Weapons: Crossbow, dagger, staff",
  "Armor: Leather armor, shields",
  "Hit Points: 1d6 per level",
  `${featureHeader} Make a DC 12 CHA check. On a success, the target is held.`,
  "If you fail, excluding focus, you can't use this again until you rest.",
  "WARDEN TALENTS",
  "2d6 Effect (2 duplicate = reroll)",
  "2 You gain an extra gear slot",
  "3-6 +1 to melee and ranged attacks or +1 to Beguile rolls",
  "7-9 +2 points to distribute to any stats",
  "10-11 Add +2 to your group's carousing event rolls",
  "12 Choose a talent",
].join("\n");

test("a parenthesised feature header parses, and detects as a Class Ability", () => {
  const p = parseClassSection(classPaste("Beguile (Focus)."));
  const feat = p.features.find((f) => f.name === "Beguile (Focus)");
  assert.ok(feat, `feature kept its printed name, got: ${p.features.map((f) => f.name).join(", ")}`);
  assert.equal(feat.classAbility?.ability, "cha");
  assert.equal(feat.classAbility?.dc, 12);
  assert.equal(feat.classAbility?.loseOnFailure, true, "'until you rest' is a lose-on-failure power");
  // The qualifier must not leak into the table walk: all five bands still parse.
  assert.equal(p.talentTable?.rows.length, 5);
  assert.equal(p.hitPoints, "d6");
});

test("an unqualified header still parses the same way", () => {
  const p = parseClassSection(classPaste("Beguile."));
  assert.ok(p.features.some((f) => f.name === "Beguile"));
});

test("the 3-6 choice row splits into its two options", () => {
  const row = parseClassSection(classPaste("Beguile (Focus).")).talentTable.rows.find((r) => r.lo === 3);
  assert.equal(row.kind, "choice");
  assert.deepEqual(row.options, ["+1 to melee and ranged attacks", "+1 to Beguile rolls"]);
});

test("the Bard is an unlockable class with a WR page cite and overlay-named rows", () => {
  assert.ok(MANIFEST_CLASSES.includes("Bard"), "Bard is offered as an unlock");
  const overlay = CLASS_OVERLAYS.bard;
  assert.equal(overlay.source, "WR");
  assert.equal(overlay.pages, "34");
  // Only the bands the book leaves unnamed; 7-9 and 12 resolve without help.
  assert.deepEqual(Object.keys(overlay.rowTalents).sort(), ["10-11", "2", "3-6"]);
  // Every overlay band must exist in the parsed table, or the commit warns and
  // the authored names silently mask a shifted/short parse.
  const bands = new Set(parseClassSection(classPaste("Beguile (Focus)."))
    .talentTable.rows.map((r) => (r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`)));
  for (const band of Object.keys(overlay.rowTalents))
    assert.ok(bands.has(band), `overlay band ${band} is a real 2d6 talent band`);
});

test("loadItems hides '<X> (Legacy)' only when '<X>' is also present", async () => {
  const names = ["Bard (Legacy)", "Bard", "Fighter", "Ranger (Legacy)", "Level 0"];
  const saved = globalThis.shadowdark;
  globalThis.shadowdark = { compendiums: { classes: async () => names.map((name) => ({ name })) } };
  try {
    const got = (await ClassStep.prototype.loadItems.call({})).map((c) => c.name);
    assert.deepEqual(got, ["Bard", "Fighter", "Ranger (Legacy)"]);
  } finally {
    if (saved === undefined) delete globalThis.shadowdark; else globalThis.shadowdark = saved;
  }
});
