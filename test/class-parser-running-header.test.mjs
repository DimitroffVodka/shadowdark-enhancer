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
