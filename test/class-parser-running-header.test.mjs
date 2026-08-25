/**
 * Running-header regression: the page header glued onto the previous feature.
 *
 * Every class page in the books prints the class's own name as a running header
 * ("Delver Class"). `extractPdfText` emits it wherever it sits in the page's
 * column flow — mid-writeup, between two features, or right after the Hit
 * Points line. It is title-case prose, so `CAPS_CAP` never capped it and
 * `FEATURE_RE` never claimed it: it fell through to `cur.lines.push(line)` and
 * became the last sentence of the preceding feature ("…you regain one use of
 * that item. Delver Class"), or landed in the class flavor when no feature was
 * open yet. Measured on the real book pages: 7 of 9 WR classes glued it onto a
 * feature, the other 2 into the flavor — and the bad text was already committed
 * to world Talents.
 *
 * These tests pin: the header dropped in both positions, the doubled form one
 * page emits, case-insensitivity, and — the part that must not regress — that a
 * feature merely MENTIONING the class name, a feature NAMED after the class,
 * and an all-caps caption are all left exactly as they were.
 *
 * Ships ZERO book content — invented fixture text only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseClassSection } from "../scripts/importer/char-content/class-parser.mjs";

const HEAD = `WARDEN
A stalwart guardian of the wild groves.
Weapons: All melee weapons, longbow
Armor: All armor and shields
Hit Points: 1d10 per level`;

const GROVEKEEPER = "Grovekeeper. You always know which way the nearest grove lies.";
const STORMCALL = "Stormcall. Once per day, call a squall that soaks the field.";

/** Body lines joined, with `extra` spliced in after the Grovekeeper feature. */
const withHeaderAfterFeature = (header) =>
  [HEAD, GROVEKEEPER, header, STORMCALL].join("\n");

const featureNamed = (parsed, n) => parsed.features.find((f) => f.name === n);

test("the running header does not glue onto the preceding feature", () => {
  const parsed = parseClassSection(withHeaderAfterFeature("Warden Class"));
  assert.ok(parsed, "the paste has a Hit Points line, so it parses");
  assert.deepEqual(parsed.features.map((f) => f.name), ["Grovekeeper", "Stormcall"]);
  assert.doesNotMatch(featureNamed(parsed, "Grovekeeper").description, /Warden Class/i);
  assert.match(featureNamed(parsed, "Grovekeeper").description, /nearest grove lies\.<\/p>$/);
});

test("a header printed twice on one extracted line is dropped whole", () => {
  // One WR page emits the two column copies joined: "Duelist ClassDuelist Class".
  const parsed = parseClassSection(withHeaderAfterFeature("Warden ClassWarden Class"));
  assert.doesNotMatch(featureNamed(parsed, "Grovekeeper").description, /Warden/i);
  assert.equal(parsed.features.length, 2);
});

test("a bare duplicate class-name line is dropped too", () => {
  const parsed = parseClassSection(withHeaderAfterFeature("Warden"));
  assert.doesNotMatch(featureNamed(parsed, "Grovekeeper").description, /Warden/i);
  assert.equal(parsed.features.length, 2);
});

test("the header is matched case-insensitively", () => {
  const parsed = parseClassSection(withHeaderAfterFeature("warden class"));
  assert.doesNotMatch(featureNamed(parsed, "Grovekeeper").description, /warden/i);
});

test("a header before any feature stays out of the class flavor", () => {
  // The p63 shape: the header lands straight after the Hit Points line, where
  // no feature is open, so it used to be collected as flavor.
  const parsed = parseClassSection([HEAD, "Warden Class", GROVEKEEPER].join("\n"));
  assert.doesNotMatch(parsed.flavor, /Warden Class/i);
  assert.match(parsed.flavor, /stalwart guardian/);
});

test("a feature that MENTIONS the class name keeps its text", () => {
  const body = [HEAD,
    "Grovekeeper. Any Warden Class ally within near gains your resolve.",
    "Warden Class",
    STORMCALL].join("\n");
  const parsed = parseClassSection(body);
  // The standalone header line goes; the words inside the sentence stay.
  assert.match(featureNamed(parsed, "Grovekeeper").description, /Any Warden Class ally within near/);
  assert.doesNotMatch(featureNamed(parsed, "Grovekeeper").description, /resolve\. Warden Class/);
});

test("a feature NAMED after the class still parses as a feature", () => {
  const parsed = parseClassSection([HEAD, "Warden. You stand your ground.", STORMCALL].join("\n"));
  assert.deepEqual(parsed.features.map((f) => f.name), ["Warden", "Stormcall"]);
  assert.match(featureNamed(parsed, "Warden").description, /stand your ground/);
});

test("an ALL-CAPS copy still caps the feature list, as it always did", () => {
  // CAPS_CAP owns all-caps captions: it closes the open feature and marks the
  // rest trailing. Silently deleting the line instead would move every
  // following line into that feature.
  const body = [HEAD, GROVEKEEPER, "WARDEN CLASS", "A weapon stat line that must not be captured."].join("\n");
  const parsed = parseClassSection(body);
  assert.deepEqual(parsed.features.map((f) => f.name), ["Grovekeeper"]);
  assert.doesNotMatch(featureNamed(parsed, "Grovekeeper").description, /weapon stat line/);
});

/**
 * The heading isn't always line 0. `extractPdfText` emits the running header
 * wherever the page's column flow puts it, and on the Duelist page (WR p42 /
 * CS6 p15) that is mid-column — so the extract OPENS with the flavor and the
 * class name appears nowhere else but the header. The parser used to take line
 * 0 as the name, which meant (a) the class imported as "Spinning swordsmen and
 * fast-", (b) the flavor lost its first line, and (c) the header sweep above,
 * keyed on that bogus name, could not match the real header — so it glued onto
 * the feature above it ("…misses instead. Duelist ClassDuelist Class", the
 * reported bug). Same headless shape, invented text.
 */
const HEADLESS = `Stalwart guardians of the wild
groves, sworn to the old oaks.
Weapons: All melee weapons, longbow
Armor: All armor and shields
Hit Points: 1d10 per level`;

test("a header printed mid-column names the class when line 0 is the flavor", () => {
  const parsed = parseClassSection([HEADLESS, GROVEKEEPER, "Warden Class", STORMCALL].join("\n"));
  assert.equal(parsed.name, "Warden");
  // The flavor keeps BOTH lines — line 0 is no longer eaten as the name.
  assert.match(parsed.flavor, /Stalwart guardians of the wild groves, sworn to the old oaks\./);
  assert.doesNotMatch(parsed.flavor, /Warden Class/);
  assert.doesNotMatch(featureNamed(parsed, "Grovekeeper").description, /Warden Class/);
});

test("the doubled mid-column header — the exact reported shape — names the class", () => {
  const parsed = parseClassSection([HEADLESS, GROVEKEEPER, "Warden ClassWarden Class", STORMCALL].join("\n"));
  assert.equal(parsed.name, "Warden");
  assert.match(featureNamed(parsed, "Grovekeeper").description, /nearest grove lies\.<\/p>$/);
});

test("a multi-word class name survives the trip through the header", () => {
  const parsed = parseClassSection([HEADLESS, GROVEKEEPER, "Grove Warden Class", STORMCALL].join("\n"));
  assert.equal(parsed.name, "Grove Warden");
});

test("a header line is dropped on its shape alone, however the name was resolved", () => {
  // The name comes from line 0 here, so the name-keyed sweep is looking for
  // "Warden" — the generic pass is what drops a header that doesn't match it.
  const parsed = parseClassSection([HEAD, GROVEKEEPER, "Grove Warden Class", STORMCALL].join("\n"));
  assert.equal(parsed.name, "Warden");
  assert.doesNotMatch(featureNamed(parsed, "Grovekeeper").description, /Grove Warden/);
});

/**
 * Every class page signs off with a flavor quote and its attribution. Both are
 * plain prose and the talent-table caption above them is already in the walk's
 * skip set, so nothing capped the last feature: it stayed open and swallowed the
 * sign-off (Duelist "Taunt", Necromancer "River of Death", Roustabout
 * "Surprising Guts" all shipped with a chunk of quote on the end).
 */
const SIGNOFF = ['"Have I told you about the oak that talked back?"',
  "-Reginald Merrymay, human warden"];

test("the page's closing quote does not glue onto the last feature", () => {
  const parsed = parseClassSection([HEAD, GROVEKEEPER, STORMCALL, ...SIGNOFF].join("\n"));
  assert.deepEqual(parsed.features.map((f) => f.name), ["Grovekeeper", "Stormcall"]);
  assert.match(featureNamed(parsed, "Stormcall").description, /soaks the field\.<\/p>$/);
  assert.doesNotMatch(featureNamed(parsed, "Stormcall").description, /oak that talked back|Merrymay/);
});

test("the closing quote does not land in the class flavor either", () => {
  const parsed = parseClassSection([HEAD, GROVEKEEPER, ...SIGNOFF].join("\n"));
  assert.doesNotMatch(parsed.flavor, /oak that talked back|Merrymay/);
  assert.match(parsed.flavor, /stalwart guardian/);
});

test("a bulleted line inside a feature is not mistaken for the attribution", () => {
  // The sign-off cap keys on the QUOTE mark only. A dash rule would be tempting
  // (the attribution starts with one) but "- Gain…" is how features print their
  // bullet lists, and eating those would silently truncate the rules text.
  const parsed = parseClassSection([HEAD,
    "Grovekeeper. Choose one boon each dawn:", "- Gain advantage on one check.",
    "- Regain one use of a spent item.", STORMCALL].join("\n"));
  const d = featureNamed(parsed, "Grovekeeper").description;
  assert.match(d, /Gain advantage on one check/);
  assert.match(d, /Regain one use of a spent item/);
});

test("the talent table is untouched by the header sweep", () => {
  const body = [HEAD, GROVEKEEPER, "Warden Class",
    "WARDEN TALENTS", "2d6 Effect",
    "2 Gain a grove ward", "3-6 +1 to melee attacks and damage",
    "7-9 +2 to Strength, Dexterity, or Constitution stat",
    "10-11 Gain a second squall", "12 Choose a talent or +2 points to distribute to stats",
  ].join("\n");
  const parsed = parseClassSection(body);
  assert.equal(parsed.talentTable.formula, "2d6");
  assert.deepEqual(parsed.talentTable.rows.map((r) => [r.lo, r.hi]),
    [[2, 2], [3, 6], [7, 9], [10, 11], [12, 12]]);
  assert.doesNotMatch(featureNamed(parsed, "Grovekeeper").description, /Warden Class/i);
});
