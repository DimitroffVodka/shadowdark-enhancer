/**
 * The PDF text extractor run through REAL pdf.js, on PDFs built in memory.
 *
 * Every other extractor suite hands `layoutPageItems` / `_readingSpace` a
 * hand-built `{ str, width, transform }` array, so nothing between the PDF
 * bytes and those arrays is tested: how pdf.js splits a run into items, the
 * whitespace-only items extractPageLines filters, the transform a sideways run
 * gets, and the `/Rotate` handling behind the rotation:0 viewport. This suite
 * writes tiny PDFs (test/pdf-synth/pdf-writer.mjs), opens them with pdf.js and
 * calls `_internals.extractPageLines`. The hand-built suites stay: they pin
 * exact geometry and are faster.
 *
 * Each fixture asserts the CLAIMS first: what pdf.js itself returned (item
 * strings and positions). If a pdf.js change moves those, the claims fail and
 * say "pdf.js changed"; only when the claims hold does a failing extractor
 * assertion mean "our code broke".
 *
 * pdfjs-dist is pinned to 4.0.379, the pdf.js Foundry 14.364 bundles
 * (@foundryvtt/pdfjs 4.0.379-1). Move the pin when the Foundry build that
 * module.json verifies moves pdf.js.
 *
 * Invented text only: no line here comes from a Shadowdark book.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDocument } from "pdfjs-dist";
import { _internals } from "../scripts/importer/pdf-text-extract.mjs";
import { writePdf } from "./pdf-synth/pdf-writer.mjs";

const { extractPageLines } = _internals;

/** Thirty distinct short lines (each fits a 130pt column at 10pt Helvetica). */
const L = [
  "Brine drips from the low arch", "A cracked bell hangs unrung", "Ferns crowd the flooded steps",
  "Tallow candles line the sill", "Someone left a wet cloak", "The lock is green with rust",
  "Chalk marks climb the beam", "A kettle sings to itself", "Ash covers the old hearth",
  "Three crows watch the door", "Moss softens every corner", "The rope ladder is missing",
  "A stair leads down to mud", "Copper pipes knock in turn", "The well answers late",
  "Salt crusts the far wall", "A lamp burns without oil", "Bones are stacked by size",
  "Tiles rattle underfoot", "The gate hangs by one hinge", "Wax seals the last shelf",
  "Rain taps a hollow drum", "A ledger lies face down", "Grit fills every footprint",
  "Wind finds the loose slate", "An echo repeats the last word", "The floor slopes toward a drain",
  "A sack of turnips sits alone", "Frost rims the water butt", "Smoke stains the ceiling",
];

/** `n` lines from L, stacked down from `y`, as text runs at column `x`. */
const column = (x, y, lines, step = 14) =>
  lines.map((text, i) => ({ x, y: y - i * step, text }));

/** Open a one-page PDF with pdf.js, hand the page and its raw items to `fn`. */
async function withPage(page, fn) {
  const doc = await getDocument({ data: writePdf([page]), verbosity: 0 }).promise;
  try {
    const pdfPage = await doc.getPage(1);
    const items = (await pdfPage.getTextContent()).items;
    return await fn(pdfPage, items);
  } finally {
    await doc.destroy();
  }
}

/**
 * The claims layer: pdf.js returned one item per drawn run, with that run's
 * string, its origin in unrotated page space, and a width it measured itself.
 */
function claimRuns(items, runs) {
  for (const run of runs) {
    const it = items.find((i) => i.str === run.text);
    assert.ok(it, `pdf.js returned no item for "${run.text}"`);
    assert.ok(Math.abs(it.transform[4] - run.x) < 0.5, `"${run.text}" x: ${it.transform[4]} vs ${run.x}`);
    assert.ok(Math.abs(it.transform[5] - run.y) < 0.5, `"${run.text}" y: ${it.transform[5]} vs ${run.y}`);
    assert.ok(it.width > 0, `"${run.text}" width is ${it.width}`);
  }
}

test("single column: one column of lines, no gutter, no warnings", async () => {
  const runs = column(72, 700, L.slice(0, 12));
  await withPage({ runs }, async (page, items) => {
    claimRuns(items, runs);
    const out = await extractPageLines(page, "auto");
    assert.deepEqual(out.lines, L.slice(0, 12));
    assert.equal(out.gutter, null);
    assert.deepEqual(out.warnings, []);
  });
});

test("whitespace-only runs are dropped before layout", async () => {
  const runs = [...column(72, 700, L.slice(0, 4)), { x: 300, y: 690, text: "   " }];
  await withPage({ runs }, async (page, items) => {
    claimRuns(items, runs.slice(0, 4));
    const out = await extractPageLines(page, "auto");
    assert.deepEqual(out.lines, L.slice(0, 4));
  });
});

test("two columns on independent baselines: the left column is read whole, then the right", async () => {
  const left = column(72, 700, L.slice(0, 10));
  const right = column(330, 693, L.slice(10, 20));   // 7pt lower: no shared baseline
  await withPage({ runs: [...left, ...right] }, async (page, items) => {
    claimRuns(items, [...left, ...right]);
    const out = await extractPageLines(page, "auto");
    assert.deepEqual(out.lines, L.slice(0, 20));
    assert.ok(out.gutter > 240 && out.gutter < 330, `gutter ${out.gutter}`);
    assert.deepEqual(out.warnings, []);
  });
});

test("two columns over a full-width lower band: the band is not cut at the gutter", async () => {
  const runs = [
    ...column(72, 700, L.slice(0, 8)),
    ...column(330, 700, L.slice(8, 16)),
    { x: 246, y: 570, text: "CAVERN OF ECHOES", size: 16 },
    ...[
      "The lower chamber runs the full width of the page and no column edge ever divides a sentence here",
      "so each of these long lines has to stay in one piece even though it passes right over the gutter",
      "of the two columns printed above it on the same sheet of paper",
    ].map((text, i) => ({ x: 72, y: 545 - i * 14, text })),
  ];
  await withPage({ runs }, async (page, items) => {
    claimRuns(items, runs);
    const out = await extractPageLines(page, "auto");
    assert.deepEqual(out.lines, [
      ...L.slice(0, 16), "CAVERN OF ECHOES", ...runs.slice(-3).map((r) => r.text)]);
    assert.ok(out.gutter > 240 && out.gutter < 330, `gutter ${out.gutter}`);
    assert.deepEqual(out.warnings, []);
  });
});

test("topband: full-width lines above two columns stay whole, then each column is read in turn", async () => {
  const top = [
    "A full-width note runs above both columns and crosses the gutter without being split in two",
    "and a second full-width note follows it, again running well past the middle of the page",
    "then a third, so the band is unmistakably a band and not a stray heading over the columns",
  ].map((text, i) => ({ x: 72, y: 700 - i * 14, text }));
  const runs = [...top, ...column(72, 640, L.slice(0, 8)), ...column(330, 640, L.slice(8, 16))];
  await withPage({ runs }, async (page, items) => {
    claimRuns(items, runs);
    const out = await extractPageLines(page, "topband");
    assert.deepEqual(out.lines, [...top.map((r) => r.text), ...L.slice(0, 16)]);
    assert.ok(out.gutter > 240 && out.gutter < 330, `gutter ${out.gutter}`);
    assert.deepEqual(out.warnings, []);
  });
});

test("sideways text: the page is rotated into reading space before the columns are found", async () => {
  // Drawn at +90 degrees: each printed line runs UP the page and successive lines
  // step to the right. Two printed columns start at y=72 and y=420 of a 612x792
  // page, so the reading-space width is the page HEIGHT.
  const printed = (y, lines) => lines.map((text, i) => ({ x: 100 + i * 14, y, text, angle: 90 }));
  const left = printed(72, L.slice(0, 6));
  const right = printed(420, L.slice(6, 12));
  const runs = [...left, ...right];
  await withPage({ runs }, async (page, items) => {
    claimRuns(items, runs);
    // pdf.js reports a sideways run as [0, s, -s, 0, e, f], not as an upright one.
    for (const it of items) {
      assert.ok(Math.abs(it.transform[0]) < 1e-6 && Math.abs(it.transform[1] - 10) < 1e-6, `${it.str}: ${it.transform}`);
    }
    const out = await extractPageLines(page, "auto");
    assert.deepEqual(out.lines, L.slice(0, 12));
    assert.ok(out.gutter > 300 && out.gutter < 500, `gutter ${out.gutter}`);
  });
});

test("/Rotate 90 page: text items and viewport share the unrotated frame", async () => {
  // 420x600 page marked /Rotate 90. The gutter is narrow and the page has a wide
  // blank right margin, so a viewport that reports the ROTATED width (600) moves
  // the detector's central band onto that margin and it finds no gutter at all.
  const left = column(30, 560, L.slice(0, 10));
  const right = column(180, 560, L.slice(10, 20));
  await withPage({ width: 420, height: 600, rotate: 90, runs: [...left, ...right] }, async (page, items) => {
    claimRuns(items, [...left, ...right]);
    assert.equal(page.rotate, 90);
    assert.equal(page.getViewport({ scale: 1 }).width, 600);
    assert.equal(page.getViewport({ scale: 1, rotation: 0 }).width, 420);
    const out = await extractPageLines(page, "auto");
    assert.deepEqual(out.lines, L.slice(0, 20));
    assert.ok(out.gutter > 155 && out.gutter < 185, `gutter ${out.gutter}`);
  });
});

test("leading priced table then two columns: cropTablePrefix drops the table before column detection", async () => {
  const table = [
    ["Rope, hemp", "1 gp"], ["Torch, pitch", "5 cp"], ["Oil, flask", "5 sp"], ["Hooded lantern", "5 gp"],
  ].flatMap(([name, cost], i) => [
    { x: 72, y: 720 - i * 14, text: name }, { x: 330, y: 720 - i * 14, text: cost }]);
  const left = column(72, 640, L.slice(0, 8));
  const right = column(330, 640, L.slice(8, 16));
  await withPage({ runs: [...table, ...left, ...right] }, async (page, items) => {
    claimRuns(items, [...table, ...left, ...right]);
    const out = await extractPageLines(page, "auto", { cropTablePrefix: true });
    assert.deepEqual(out.lines, L.slice(0, 16));
    assert.ok(out.gutter > 240 && out.gutter < 330, `gutter ${out.gutter}`);
    assert.deepEqual(out.warnings, []);
    // Without the option the table rows are ordinary text and stay in the output.
    const kept = await extractPageLines(page, "auto");
    assert.ok(kept.lines.some((l) => l.includes("Rope, hemp")));
  });
});

test("a body line crossing the gutter is reported as a warning", async () => {
  const left = column(72, 700, L.slice(0, 10));
  const right = column(330, 700, L.slice(10, 20));
  // On row 5 the left run is cut short and a mid-page run spans the gutter.
  const crossing = { x: 255, y: 700 - 5 * 14, text: "Straddling" };
  const runs = [...left.filter((_, i) => i !== 5), { ...left[5], text: "Ash" }, crossing, ...right];
  await withPage({ runs }, async (page, items) => {
    claimRuns(items, runs);
    const out = await extractPageLines(page, "auto");
    assert.equal(out.warnings.length, 1, out.warnings.join(" | "));
    assert.match(out.warnings[0], /cuts through 1 word \("Straddling"\)/);
  });
});
