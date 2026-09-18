import test from "node:test";
import assert from "node:assert/strict";
import { emptyLog, decodeFixes, encodeFixes, recordEdits, withdrawEdits, accuracyReport, bandOf, bandMargin, sameTags , recordLegend, legendReport } from "../scripts/hex-map/tag-corrections.mjs";

const auto = (terrain, margin, extra = {}) => ({ terrain, overlays: [], source: "auto", margin, review: false, ...extra });
const gm = (terrain, overlays = []) => ({ terrain, overlays, source: "gm" });

test("bandOf: 0.1 bands in tenths, everything confident in the top one, never a dot in a key", () => {
  assert.equal(bandOf(1.42), "14");
  assert.equal(bandOf(1.4), "14");
  assert.equal(bandOf(0), "0");
  assert.equal(bandOf(99), "30");
  assert.equal(bandOf(undefined), "0");
  assert.equal(bandMargin(bandOf(1.42)), 1.4);
  // Foundry expands a dotted key into nested objects, which silently mangles the flag.
  for (const m of [0, 0.05, 1.3, 2.999, 42]) assert.ok(!bandOf(m).includes("."), `${m} produced a dotted key`);
});

test("recordEdits: only the classifier's cells count, and leaving one alone is a verdict", () => {
  const log = emptyLog();
  const res = recordEdits(log, [
    { num: 100, before: auto("forest", 1.42), after: gm("swamp") },      // corrected
    { num: 101, before: auto("forest", 1.45), after: gm("forest") },     // confirmed
    { num: 102, before: gm("forest"), after: gm("swamp") },              // a hand tag: not evidence
    { num: 103, before: null, after: gm("desert") },                     // never a guess
  ]);
  assert.deepEqual(res, { judged: 2, wrong: 1 });
  assert.deepEqual([...log.seen.entries()], [["14", { bad: 1, total: 2 }]]);
  assert.deepEqual(log.fixes.get("100"), { was: "forest", now: "swamp", margin: 1.42, review: false });
  assert.equal(log.fixes.has("101"), false, "a confirmed cell is a count, not a fix");
});

test("recordEdits: an overlay-only change is still wrong, and a cleared cell is recorded", () => {
  const log = emptyLog();
  recordEdits(log, [
    { num: 200, before: auto("forest", 2.1), after: gm("forest", ["river"]) },
    { num: 201, before: auto("ocean", 1.1, { review: true }), after: null },
    { num: 202, before: auto("forest", 2.15), after: gm("forest", []) },
  ]);
  assert.equal(log.fixes.get("200").now, "forest;river");
  assert.deepEqual(log.fixes.get("201"), { was: "ocean", now: "(cleared)", margin: 1.1, review: true });
  assert.equal(log.fixes.has("202"), false, "same terrain, same overlays: confirmed");
  assert.deepEqual(log.seen.get("21"), { bad: 1, total: 2 });
});

test("encode/decode round-trips a log", () => {
  const log = emptyLog();
  recordEdits(log, [
    { num: 300, before: auto("forest", 1.42, { review: true }), after: gm("swamp", ["river"]) },
    { num: 301, before: auto("desert", 2.4), after: gm("desert") },
  ]);
  const back = decodeFixes(encodeFixes(log));
  assert.deepEqual([...back.fixes.entries()], [...log.fixes.entries()]);
  assert.deepEqual([...back.seen.entries()], [...log.seen.entries()]);
  assert.deepEqual([...decodeFixes(undefined).fixes.keys()], [], "no flag yet is an empty log");
});

test("accuracyReport: says what the margin in use catches and what would catch the target", () => {
  const log = emptyLog();
  // 10 mistakes: 2 below 1.3, 8 spread up to 2.0 — the shape Patrick describes.
  const t = [];
  for (let i = 0; i < 2; i++) t.push({ num: 400 + i, before: auto("forest", 1.1), after: gm("swamp") });
  for (let i = 0; i < 8; i++) t.push({ num: 410 + i, before: auto("forest", 1.9), after: gm("swamp") });
  for (let i = 0; i < 40; i++) t.push({ num: 500 + i, before: auto("forest", 2.5), after: gm("forest") });
  recordEdits(log, t);
  const r = accuracyReport(log, { margin: 1.3, target: 0.9 });
  assert.equal(r.judged, 50);
  assert.equal(r.wrong, 10);
  assert.equal(r.accuracy, 80);
  assert.equal(r.caught, 20, "the 1.3 queue only catches the two lowest-margin mistakes");
  assert.equal(r.suggested, 2, "flagging under 2.0 catches all ten");
});

test("accuracyReport: nothing to suggest when the queue already catches the target, or with no data", () => {
  const log = emptyLog();
  recordEdits(log, [
    { num: 600, before: auto("forest", 0.5), after: gm("swamp") },
    { num: 601, before: auto("forest", 2.5), after: gm("forest") },
  ]);
  const r = accuracyReport(log, { margin: 1.3, target: 0.9 });
  assert.equal(r.caught, 100);
  assert.equal(r.suggested, null);
  const empty = accuracyReport(emptyLog());
  assert.deepEqual([empty.judged, empty.wrong, empty.accuracy, empty.caught, empty.suggested], [0, 0, null, null, null]);
});

test("withdrawEdits: an undone stroke takes its verdicts with it", () => {
  const log = emptyLog();
  recordEdits(log, [
    { num: 700, before: auto("ocean", 1.42), after: gm("arctic_sea") },
    { num: 701, before: auto("ocean", 1.45), after: gm("arctic_sea") },
    { num: 702, before: auto("ocean", 1.44), after: gm("ocean") },        // confirmed, not a fix
  ]);
  assert.deepEqual(log.seen.get("14"), { bad: 2, total: 3 });
  assert.equal(withdrawEdits(log, [700, 701, 999]), 2, "only the cells that carried a fix");
  assert.equal(log.fixes.size, 0);
  assert.deepEqual(log.seen.get("14"), { bad: 0, total: 1 }, "the confirmation it did not undo stays");
});

test("withdrawEdits: a band with nothing left in it goes away", () => {
  const log = emptyLog();
  recordEdits(log, [{ num: 800, before: auto("ocean", 2.05), after: gm("arctic_sea") }]);
  withdrawEdits(log, [800]);
  assert.equal(log.seen.has("20"), false);
  assert.deepEqual(accuracyReport(log).judged, 0);
});

test("sameTags: the brush skips a hex that already says what it says", () => {
  assert.equal(sameTags({ terrain: "arctic_sea", overlays: [] }, { terrain: "arctic_sea", overlays: [] }), true);
  assert.equal(sameTags({ terrain: "arctic_sea", overlays: ["river"] }, { terrain: "arctic_sea", overlays: [] }), false);
  assert.equal(sameTags({ terrain: "ocean", overlays: [] }, { terrain: "arctic_sea", overlays: [] }), false);
  assert.equal(sameTags(null, { terrain: "ocean", overlays: [] }), false);
});

test("accuracyReport: says re-classify, not re-threshold, when the examples are the problem", () => {
  const bad = emptyLog();
  const t = [];
  for (let i = 0; i < 30; i++) t.push({ num: 900 + i, before: auto("ocean", 1.5 + i / 100), after: gm("arctic_sea") });
  recordEdits(bad, t);
  const r = accuracyReport(bad);
  assert.equal(r.accuracy, 0, "30 of 30 wrong");
  assert.equal(r.retag, true, "no threshold saves a classifier this wrong; its examples do");

  const okay = emptyLog();
  const u = [];
  for (let i = 0; i < 30; i++) u.push({ num: 950 + i, before: auto("ocean", 2.5), after: gm("ocean") });
  for (let i = 0; i < 5; i++) u.push({ num: 980 + i, before: auto("ocean", 1.1), after: gm("arctic_sea") });
  recordEdits(okay, u);
  const r2 = accuracyReport(okay);
  assert.equal(r2.retag, false, "mostly right: the threshold is the lever, not the examples");

  const few = emptyLog();
  recordEdits(few, [{ num: 990, before: auto("ocean", 1.1), after: gm("arctic_sea") }]);
  assert.equal(accuracyReport(few).retag, false, "one correction is not evidence of anything");
});

test("the legend's answers are recorded, and survive the round trip to a flag", () => {
  const log = emptyLog();
  assert.equal(legendReport(log), null, "nothing applied yet, nothing to report");

  const core = (from, n) => Array.from({ length: n }, (_, i) => from + i);
  const n = recordLegend(log, [
    { size: 228, core: core(1000, 40), name: "arctic_sea", opened: false },
    { size: 147, core: core(2000, 40), name: "forest", opened: false },
    { size: 61, core: core(3000, 40), name: "", opened: true },
    { size: 12, core: core(4000, 12), name: "", opened: false },
  ], { at: 1000 });
  assert.equal(n, 4);

  const back = decodeFixes(encodeFixes(log));
  const r = legendReport(back);
  assert.deepEqual(
    { cards: r.cards, named: r.named, skipped: r.skipped, opened: r.opened, hexes: r.hexes },
    { cards: 4, named: 2, skipped: 2, opened: 1, hexes: 448 },
  );
});

test("the legend record keeps the recent passes and not every pass ever", () => {
  const log = emptyLog();
  for (let i = 0; i < 9; i++) recordLegend(log, [{ size: i + 1, name: `pass${i}` }], { at: i });
  const back = decodeFixes(encodeFixes(log));
  assert.equal(back.legend.length, 5, "a GM who re-runs the legend all night must not grow the flag");
  assert.equal(legendReport(back).cards, 1);
  assert.equal(back.legend.at(-1).cards[0].name, "pass8", "the latest pass is the one kept");
});

test("a card whose own core the GM keeps correcting is named as the suspect", () => {
  const log = emptyLog();
  const a = Array.from({ length: 40 }, (_, i) => 900 + i);      // named right
  const b = Array.from({ length: 40 }, (_, i) => 100 + i);      // named wrong
  recordLegend(log, [{ size: 100, name: "desert", core: a }, { size: 100, name: "jungle", core: b }]);
  for (let i = 0; i < 12; i++) log.fixes.set(String(100 + i), { was: "jungle", now: "desert" });
  log.fixes.set("900", { was: "desert", now: "forest" });

  // no callback needed: the cores are in the record
  const r = legendReport(decodeFixes(encodeFixes(log)));
  assert.equal(r.worst[0].name, "jungle");
  assert.equal(r.worst[0].wrong, 12);
  assert.equal(r.suspect.name, "jungle", "a quarter of its own core corrected");

  // confirming a hex is evidence FOR a card, never against it
  const clean = emptyLog();
  recordLegend(clean, [{ size: 100, name: "forest", core: a }]);
  for (const n of a.slice(0, 20)) clean.fixes.set(String(n), { was: "forest", now: "forest" });
  assert.equal(legendReport(clean).suspect, null);
});
