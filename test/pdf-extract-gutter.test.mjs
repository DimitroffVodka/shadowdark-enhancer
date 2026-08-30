/**
 * Regression tests for the 2026-07-28 silent column-bleed defect.
 *
 * detectGutter used to bin item x-CENTERS and cut at the widest empty run in
 * the central band. A column's ragged right edge empties those bins exactly
 * the way a gutter does, so on a page with an unbalanced left column the cut
 * landed inside that column and moved its trailing words into the other one.
 *
 * The reproduction below is Cursed Scroll 6 p26 (the Downtime spread), with
 * coordinates measured off the real page: page width 419.5, left column body
 * running x=36→~204, a trailing line ending in a short word at x=[177.1,189.0],
 * a full-width heading spanning x=[130.4,289.1], and the right column's
 * bullets at x=220.3 with their text from x=229.3. The old detector cut at
 * x=172 — inside the left column — and welded that trailing word onto a
 * right-column bullet. The parse scored 25 of 25 with no warnings and stored
 * the wrong text, which is why this file also covers the warning path.
 *
 * Only geometry is reproduced here; the strings are placeholders.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { _internals } from "../scripts/importer/pdf-text-extract.mjs";

const { detectGutter, gutterRisks, _rowSplit, layoutPageItems } = _internals;

const W = 419.528;

/** A PDF.js text item spanning [x1,x2] on baseline y. */
const span = (x1, x2, y, str = "x") =>
  ({ str, width: x2 - x1, height: 8, transform: [1, 0, 0, 1, x1, y] });

/**
 * Every text item on CS6 p26 as [x, width, baselineY], measured off the real
 * page with PDF.js. Coordinates only — no book text is reproduced here.
 *
 * Item 15 is the word that bled: x=177.1 w=11.9, centre 183.05, the last word
 * of a left-column line at y=342. The right column carries text on that same
 * baseline (index 48, x=229.3), so a cut at the left column's ragged edge
 * hands the word across and welds it onto that line.
 */
const BLED = 15;
const CS6_P26 = [
  [36, 11.9, 18.9], [130.4, 158.7, 540.5], [36, 56.3, 489], [95, 19.8, 489], [117.5, 52.5, 489], [36, 146.5, 474],
  [36, 129.5, 459], [36, 45.5, 444], [84.2, 104.1, 444], [36, 136.1, 415.5], [36, 153.1, 400.5], [36, 158.4, 385.5],
  [36, 165.8, 370.5], [36, 99.3, 342], [137.9, 36.5, 342], [177.1, 11.9, 342], [36, 158.7, 327], [36, 156.5, 312],
  [36, 108.5, 277.2], [36, 118.9, 257.7], [36, 141.9, 242.7], [36, 57, 214.2], [40.5, 3.1, 185.7], [49.5, 27.4, 185.7],
  [79.6, 85.3, 185.7], [49.5, 131.6, 170.7], [49.5, 100.7, 155.7], [40.5, 3.1, 136.2], [49.5, 30.9, 136.2], [83, 120.7, 136.2],
  [49.5, 71, 121.2], [40.5, 3.1, 101.7], [49.5, 35.1, 101.7], [87.3, 109.6, 101.7], [49.5, 131.6, 86.7], [40.5, 3.1, 67.2],
  [49.5, 35.9, 67.2], [88.1, 96, 67.2], [49.5, 144, 52.2], [215.8, 116, 485.2], [215.8, 143.5, 465.7], [215.8, 124.9, 450.7],
  [215.8, 59, 422.2], [220.3, 3.1, 393.7], [229.3, 27.4, 393.7], [259.5, 100.7, 393.7], [229.3, 129.5, 378.7], [229.3, 135.3, 363.7],
  [229.3, 96.2, 348.7], [220.3, 3.1, 329.2], [229.3, 30.9, 329.2], [262.8, 98.8, 329.2], [229.3, 154.3, 314.2], [220.3, 3.1, 294.7],
  [229.3, 30.9, 294.7], [262.9, 114.2, 294.7], [229.3, 152.8, 279.7], [229.3, 130.1, 264.7], [229.3, 112.3, 249.7], [220.3, 3.1, 230.2],
  [229.3, 31.6, 230.2], [263.7, 104.9, 230.2], [229.3, 153.6, 215.2], [215.8, 57.9, 186.7], [220.3, 3.1, 158.2], [229.3, 35.1, 158.2],
  [267.1, 114.3, 158.2], [229.3, 131.2, 143.2], [229.3, 123.9, 128.2], [229.3, 84.3, 113.2], [316.2, 31.1, 113.2], [347.3, 5.7, 113.2],
  [220.3, 3.1, 93.7], [229.3, 35.9, 93.7], [267.9, 80.9, 93.7], [229.3, 147.9, 78.7], [229.3, 123.9, 63.7], [229.3, 84.3, 48.7],
  [316.2, 31.1, 48.7], [347.3, 5.7, 48.7],
];

/** The page as PDF.js text items, each labelled by index (never book text). */
function cs6Page26() {
  return CS6_P26.map(([x, w, y], k) =>
    ({ str: k === BLED ? "BLED" : `w${k}`, width: w, height: 8, transform: [1, 0, 0, 1, x, y] }));
}

/** Centre of the item that bled, and the baseline it belongs to. */
const bledCentre = CS6_P26[BLED][0] + CS6_P26[BLED][1] / 2;

test("detectGutter: the cut clears a ragged left column instead of slicing it", () => {
  const its = cs6Page26();
  const cut = detectGutter(its, W, "auto");
  assert.ok(cut != null, "CS6 p26 is a two-column page and must be detected as one");
  // Safe window: right of the left column's last word (189.0), left of the
  // right column's leftmost body item (215.8).
  assert.ok(cut > 189.0 && cut < 215.8,
    `cut=${cut} must land in the true gutter (189.0, 215.8), not on the ragged edge`);
});

test("detectGutter: the word that bled stays in the left column", () => {
  const its = cs6Page26();
  const cut = detectGutter(its, W, "auto");
  assert.ok(bledCentre < cut,
    `the trailing word (centre ${bledCentre}) must fall left of the cut ${cut}`);
  // And it must still read as part of its own line, not welded to the right
  // column's text on the same baseline.
  const { lines } = layoutPageItems(its, W, "auto");
  const withBled = lines.filter((l) => l.includes("BLED"));
  assert.equal(withBled.length, 1);
  assert.ok(!/w4[89]|w5\d/.test(withBled[0]),
    `the left-column word was spliced into right-column text: ${withBled[0]}`);
});

test("the fixture still reproduces the historical ragged-edge cut", () => {
  // Guards the fixture itself: the defect was that the widest empty run in the
  // x-CENTRE histogram fell at x=172, inside the left column. If this stops
  // holding, the geometry above has drifted and the tests above prove nothing.
  const its = cs6Page26();
  const centres = its.map((i) => i.transform[4] + i.width / 2);
  const NB = 50;
  const bins = new Array(NB).fill(0);
  for (const c of centres) bins[Math.min(NB - 1, Math.max(0, Math.floor((c / W) * NB)))]++;
  const lo = Math.floor(NB * 0.3);
  const hi = Math.ceil(NB * 0.7);
  let min = Infinity;
  for (let b = lo; b <= hi; b++) min = Math.min(min, bins[b]);
  let best = null;
  let run = null;
  for (let b = lo; b <= hi + 1; b++) {
    if (b <= hi && bins[b] === min) { run = run ?? { start: b, end: b }; run.end = b; }
    else if (run) { if (!best || run.end - run.start > best.end - best.start) best = run; run = null; }
  }
  const legacy = ((Math.round((best.start + best.end) / 2) + 0.5) / NB) * W;
  assert.ok(Math.abs(legacy - 172) < 1, `legacy centre-histogram cut was ${legacy}, expected ~172`);
  assert.ok(bledCentre > legacy,
    "the word must sit on the WRONG side of the legacy cut — that is the defect");
});

test("detectGutter: a full-width heading bridging the gutter does not defeat it", () => {
  // Drop the one item that spans the gutter (the page's heading). The cut
  // should barely move: the detector is reading the gutter, not just hunting
  // for a band of literally zero ink.
  const its = cs6Page26();
  const bare = its.filter((i, k) => k !== 1);
  const a = detectGutter(its, W, "auto");
  const b = detectGutter(bare, W, "auto");
  assert.ok(Math.abs(a - b) < 12, `heading shifted the cut from ${b} to ${a}`);
});

test("gutterRisks: the old ragged-edge cut is flagged, the correct one is not", () => {
  const its = cs6Page26();
  const bad = gutterRisks(its, W, 172);
  assert.ok(bad.length, "a cut running through body words must warn");
  assert.match(bad[0], /cuts through \d+ word/);
  assert.deepEqual(gutterRisks(its, W, detectGutter(its, W, "auto")), [],
    "the detected gutter is clean and must not cry wolf");
});

test("gutterRisks names the words it flags", () => {
  // "cuts through 1 word" makes the reader proofread a whole page; the word
  // itself makes it one search in the paste box. Live-caught on a CS2 bestiary
  // grab (p40/p43), where two one-item warnings named nothing to look at.
  const its = cs6Page26();
  const [warn] = gutterRisks(its, W, 172);
  assert.match(warn, /cuts through 3 words \("w8", "w14", "w37"\)/, warn);
});

test("gutterRisks: the quoted sample is capped in length and in count", () => {
  const its = [];
  for (let i = 0; i < 18; i++) its.push(span(36, 195, 600 - i * 14, `L${i}`));
  for (let i = 0; i < 18; i++) its.push(span(225, 384, 600 - i * 14, `R${i}`));
  const four = its.concat([
    span(200, 216, 530, "a placeholder run long enough to be cut short"),
    span(201, 217, 516, "beta"), span(202, 218, 502, "gamma"), span(203, 219, 488, "delta"),
  ]);
  const [warn] = gutterRisks(four, W, 210);
  assert.match(warn, /cuts through 4 words/, warn);
  assert.match(warn, /"a placeholder run long…"/, "a long run must be truncated");
  assert.match(warn, /, …\)/, "beyond three flagged words the list must trail off");
  assert.ok(!warn.includes("delta"), `only three words should be quoted: ${warn}`);
});

test("gutterRisks: a centred title split into runs is not read as body text", () => {
  // PDF.js emits letter-spaced display type as several runs, so a centred
  // heading loses the "alone on its baseline" signature that used to mark page
  // furniture — and the run sitting over the gutter scored as a body word.
  // A heading crosses a perfectly good gutter and lands in one column whole.
  const two = [];
  for (let i = 0; i < 18; i++) two.push(span(36, 195, 600 - i * 14, `L${i}`));
  for (let i = 0; i < 18; i++) two.push(span(225, 384, 600 - i * 14, `R${i}`));
  assert.deepEqual(gutterRisks(two, W, 210), [], "the bare two-column page is clean");

  const titled = two.concat([
    span(150, 180, 630, "T1"), span(186, 214, 630, "T2"), span(220, 270, 630, "T3"),
  ]);
  assert.deepEqual(gutterRisks(titled, W, 210), [],
    "a centred title's middle run is furniture, not a word the split stole");

  // The control: the same geometry, but the straddling word belongs to a row
  // of two-column body text — that one must still warn, by name.
  const bled = two.concat([span(200, 216, 530, "BLED")]);
  const [warn] = gutterRisks(bled, W, 210);
  assert.match(warn, /cuts through 1 word \("BLED"\)/, warn);
});

test("gutterRisks: a recognised lower full-width band is not checked against the prose gutter", () => {
  // WR p118's BOATS table is below two prose columns. layoutPageItems already
  // keeps that band whole; warning geometry must make the same distinction or
  // every AC cell that happens to overhang the prose gutter becomes an advisory.
  const upper = [];
  for (let i = 0; i < 8; i++) {
    upper.push(span(36, 190, 500 - i * 14, `L${i}`));
    upper.push(span(230, 384, 493 - i * 14, `R${i}`));
  }
  const lower = [
    { ...span(185, 231, 200, "TABLE"), height: 13 },
    span(40, 230, 180, "LOWER-ONE"),
    span(40, 230, 165, "LOWER-TWO"),
    span(196, 212, 180, "LOWER-CELL"),
  ];
  const its = upper.concat(lower);
  const band = _internals._findFullWidthLowerBand(its, W);
  assert.ok(band, "the fixture must reproduce a lower full-width band");
  assert.deepEqual(gutterRisks(its, W, Math.round(band.gutter)), []);
  assert.ok(gutterRisks(its, W, Math.round(band.gutter), { layoutMode: "2" }).length,
    "a forced two-column layout must still warn about the lower band");
});

test("gutterRisks: a sub-point box overhang with a safe centre is not a warning", () => {
  // WR p119's Type header ends 0.408 points beyond the detected cut at
  // 205.56872, but its centre is 12 points to the left. This is PDF glyph-box
  // precision, not a word cut. A centred body item remains a visible control.
  const its = [];
  for (let i = 0; i < 8; i++) {
    its.push(span(36, 190, 500 - i * 14, `L${i}`));
    its.push(span(230, 384, 493 - i * 14, `R${i}`));
  }
  its.push(span(40, 75, 200, "HEADER-LEFT"));
  its.push(span(180.927, 205.977, 200, "HEADER"));
  its.push(span(230, 270, 200, "HEADER-RIGHT"));
  assert.deepEqual(gutterRisks(its, W, 205.56872), []);

  const [warn] = gutterRisks(its.concat([
    span(40, 75, 180, "CONTROL-LEFT"),
    span(200, 220, 180, "CORRUPT"),
    span(230, 270, 180, "CONTROL-RIGHT"),
  ]), W, 205.56872);
  assert.match(warn, /cuts through 1 word \("CORRUPT"\)/, warn);
});

test("gutterRisks: a cut far off the page midline is flagged", () => {
  const its = cs6Page26();
  // 0.15W clear of centre, chosen to sit in white space so only the
  // off-midline check can fire.
  const warns = gutterRisks(its, W, 290);
  assert.ok(warns.some((w) => /off the page midline/.test(w)), warns.join(" | "));
});

test("gutterRisks: single column (null gutter) never warns", () => {
  assert.deepEqual(gutterRisks(cs6Page26(), W, null), []);
});

test("_rowSplit tells the true gutter from the ragged edge", () => {
  const its = cs6Page26();
  const good = _rowSplit(its, 205);
  const bad = _rowSplit(its, 172);
  // The gutter runs through almost nothing and leaves both columns intact;
  // the ragged-edge cut slices seventeen rows of body text.
  assert.ok(good.crossed <= 1, `the gutter should cross ~nothing, crossed ${good.crossed}`);
  assert.ok(bad.crossed > 10, `the ragged-edge cut should shred rows, crossed ${bad.crossed}`);
  // This page's columns sit on independent baselines (only 2 paired rows of
  // 49), so the guard's decision rests on the one-sided rows.
  const sep = (s) => s.paired + Math.min(s.leftOnly, s.rightOnly);
  assert.ok(sep(good) >= good.crossed, "the gutter must read as separating");
  assert.ok(sep(bad) < bad.crossed, "the ragged-edge cut must be rejected by the guard");
});

test("detectGutter: single-column prose is not split", () => {
  // Full-measure lines with a ragged right edge and nothing to the right.
  const its = [];
  for (let i = 0; i < 24; i++) its.push(span(36, 330 - (i % 5) * 12, 600 - i * 14, "prose"));
  assert.equal(detectGutter(its, W, "auto"), null,
    "a single column must never be cut in half — that interleaves the page");
});

test("detectGutter: two columns on independent baselines are still detected", () => {
  // No row holds ink from both columns, so row PAIRING alone sees nothing;
  // the left-only/right-only split has to carry the decision.
  const its = [];
  for (let i = 0; i < 20; i++) its.push(span(36, 190, 600 - i * 14, "left"));
  for (let i = 0; i < 20; i++) its.push(span(230, 384, 593 - i * 14, "right"));
  const cut = detectGutter(its, W, "auto");
  assert.ok(cut != null && cut > 190 && cut < 230, `expected a gutter in (190,230), got ${cut}`);
});

test("extraction pins keep their exact contracts", () => {
  const its = cs6Page26();
  assert.equal(detectGutter(its, W, "1"), null, '"1" is single column');
  assert.equal(detectGutter(its, W, "layout"), null, '"layout" is single column');
  assert.equal(detectGutter(its, W, "2mid"), W / 2, '"2mid" is the page midline, no detection');
  // "2" is forced two-column: always a number, even where auto declines.
  const single = [];
  for (let i = 0; i < 24; i++) single.push(span(36, 330, 600 - i * 14, "prose"));
  assert.equal(detectGutter(single, W, "auto"), null);
  assert.equal(typeof detectGutter(single, W, "2"), "number", '"2" never returns null');
  assert.equal(detectGutter([span(10, 20, 5)], W, "2"), W / 2,
    '"2" falls back to the midline on a near-empty page');
});

test("gutterRisks: the near-miss warning names its items too", () => {
  // The straddle warning and this one are the two halves of the same fix, and
  // this is the half the live CS2 p40 grab actually raised — it must quote the
  // text as well, or that page still names nothing to look at.
  const its = [];
  for (let i = 0; i < 18; i++) its.push(span(36, 195, 600 - i * 14, `L${i}`));
  for (let i = 0; i < 18; i++) its.push(span(225, 384, 600 - i * 14, `R${i}`));
  // A narrow body run that stops ON the cut: its centre sits within a glyph of
  // the gutter, but its box never crosses it, so only the near check can fire.
  const grazed = its.concat([span(204, 210, 530, "GRAZED")]);
  const warns = gutterRisks(grazed, W, 210);
  assert.ok(!warns.some((w) => /cuts through/.test(w)),
    `nothing straddles this cut: ${warns.join(" | ")}`);
  assert.match(warns.find((w) => /runs within a glyph/.test(w)) ?? "",
    /runs within a glyph of 1 item \("GRAZED"\)/, warns.join(" | "));
});

test("gutterRisks: the trailing … promises only words it can actually show", () => {
  // The count that decides the "…" must be the flagged items that CARRY text,
  // not the raw flagged list: a straddler PDF.js hands over with no string of
  // its own can never be quoted, so counting it advertises a fourth word the
  // reader then goes looking for and cannot find.
  const its = [];
  for (let i = 0; i < 18; i++) its.push(span(36, 195, 600 - i * 14, `L${i}`));
  for (let i = 0; i < 18; i++) its.push(span(225, 384, 600 - i * 14, `R${i}`));
  const four = its.concat([
    span(200, 216, 530, "alpha"), span(201, 217, 516, ""),
    span(202, 218, 502, "   "), span(203, 219, 488, "beta"),
  ]);
  const [warn] = gutterRisks(four, W, 210);
  assert.match(warn, /cuts through 4 words/, warn);
  assert.match(warn, /\("alpha", "beta"\)/, `both quotable words should show: ${warn}`);
  assert.ok(!warn.includes(", …"),
    `only two of the four carry text, so nothing is being held back: ${warn}`);
});
